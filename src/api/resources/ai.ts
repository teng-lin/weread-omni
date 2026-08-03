import { toTransportError } from "../../errors.js";
import { assertOperationArguments, OPERATIONS } from "../operation-spec.js";
import { expectArrayFields } from "../response-guards.js";
import { abortableDelay } from "../signal.js";
import type { AskBookInput, AskBookResult, MobileTransport, SuggestInput, SuggestResponse } from "../types.js";

const ASK_LABEL = "ai.askBook";

/** Every list `/ai/chat/suggest` can carry is optional upstream, so each is checked only if present. */
const SUGGEST_LISTS = ["questions", "questionHints", "prompts"] as const;

/**
 * The between-polls delay. It takes the signal because a loop that only checks cancellation
 * between requests still makes an abandoned caller wait out a full delay first.
 */
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

interface ChatResponse {
  chatid?: string;
  session_id?: string;
  request_interval?: number;
  result?: { text?: string; has_more?: number };
  thinking_result?: { text?: string };
  extra_sections?: { has_more?: boolean };
}

export function aiModule(
  mobile: MobileTransport,
  sleep: Sleep = (milliseconds, signal) => abortableDelay(milliseconds, ASK_LABEL, signal),
) {
  return {
    async askBook(input: AskBookInput): Promise<AskBookResult> {
      const { bookId, query, intent = "", maxPolls = 80, delayCapMs = 1500, signal } = input;
      assertOperationArguments(OPERATIONS.aiAskBook, { bookId, query, intent, maxPolls, delayCapMs });
      const base = {
        accept_text_type: 1,
        bookId,
        query,
        scene: 1,
        isPlugin: false,
        intent,
        weread_opt: { intent, query_context: "" },
      };
      let chatid = "";
      let sessionId = "";
      let body: ChatResponse = {};
      let text = "";
      let thinking = "";
      let complete = false;

      for (let poll = 0; poll < maxPolls; poll++) {
        body = await mobile
          .call<ChatResponse>("POST", "/ai/chatv2", {
            // Only a continuation poll is replay-safe. The opening request carries no chatid or
            // session_id — those are learned from the response — so replaying it would start a
            // second inference session rather than resume this one.
            idempotent: chatid !== "",
            body: { ...base, chatid, session_id: sessionId },
            signal,
          })
          .then((response) => response.body);
        chatid = body.chatid || chatid;
        sessionId = body.session_id || sessionId;
        // `result.text` is a cumulative snapshot, not a delta, and the terminal frame need
        // not repeat it — so keep the last non-empty value rather than overwriting. The
        // termination test below must stay on THIS frame's text: switching it to the kept
        // value would change its meaning to "text ever arrived" and stop a frame early.
        const frameText = body.result?.text || "";
        text = frameText || text;
        thinking = body.thinking_result?.text || thinking;
        const streamDone = body.result?.has_more === 0;
        const sectionsDone = body.extra_sections?.has_more === false;
        if (streamDone || (sectionsDone && frameText !== "")) {
          // An empty answer is not a completed one; `complete` is the field a caller checks.
          complete = text !== "";
          break;
        }
        await sleep(Math.min(body.request_interval ?? 200, delayCapMs), signal);
        // An injected sleep need not honour the signal, and the default one cannot see an abort
        // that lands between resolving and here. Re-check so cancelling never costs another poll.
        if (signal?.aborted) throw toTransportError(signal.reason, ASK_LABEL);
      }
      return {
        text,
        thinking,
        chatid,
        sessionId,
        complete,
      };
    },
    suggest(input: SuggestInput): Promise<SuggestResponse> {
      const { bookId, chapterUid = 0, toolbar = false, range = "", mpReviewId = "", signal } = input;
      assertOperationArguments(OPERATIONS.aiSuggest, { bookId, chapterUid, toolbar, range, mpReviewId });
      const body = toolbar ? { bookId, chapterUid, cmd: "toolbar" } : { bookId, chapterUid, mpReviewId, range };
      return mobile
        .call<SuggestResponse>("POST", "/ai/chat/suggest", { body, idempotent: true, signal })
        .then((response) => expectArrayFields(response, "/ai/chat/suggest", [], SUGGEST_LISTS));
    },
  };
}
