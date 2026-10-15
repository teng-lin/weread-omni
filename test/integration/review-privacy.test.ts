import { describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";
import { MobileApiClient } from "../../src/index.js";

function harness(env: NodeJS.ProcessEnv = {}) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    requests.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    return Response.json({ reviewId: "review" });
  });
  const client = new MobileApiClient({
    credentials: { vid: "123", accessToken: "test-access", refreshToken: "test-refresh", deviceId: "test-device" },
    env,
    fetchImpl,
  });
  return { client, requests, fetchImpl };
}

describe("review privacy", () => {
  it.each([true, false, undefined])("SDK preserves isPrivate=%s on create and edit", async (isPrivate) => {
    const { client, requests } = harness();
    await client.review.add({ bookId: "book", content: "note", chapterUid: 15, range: "1002-1012", isPrivate });
    await client.review.edit("review", "replacement", { isPrivate });
    const privacy = isPrivate === undefined ? {} : { isPrivate: isPrivate ? 1 : 0 };
    expect(requests).toEqual([
      {
        path: "/review/add",
        body: { bookId: "book", content: "note", type: 1, chapterUid: 15, range: "1002-1012", ...privacy },
      },
      { path: "/review/useredit", body: { reviewId: "review", content: "replacement", ...privacy } },
    ]);
  });

  it.each(["add", "edit"] as const)("%s rejects invalid privacy before sending a request", (action) => {
    const { client, fetchImpl } = harness();
    const invalid = { isPrivate: 1 };
    if (action === "add") {
      // @ts-expect-error SDK 使用布尔值，避免误把网页 UI 的状态值 2 当作接口参数。
      expect(() => client.review.add({ bookId: "book", content: "note", ...invalid })).toThrow("isPrivate");
    } else {
      // @ts-expect-error SDK 使用布尔值，由资源层转换为协议中的 0 或 1。
      expect(() => client.review.edit("review", "note", invalid)).toThrow("isPrivate");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { flags: ["--private"], expected: 1 },
    { flags: ["--no-private"], expected: 0 },
    { flags: [], expected: undefined },
  ])("CLI sends the intended privacy for $flags", async ({ flags, expected }) => {
    const { client, requests } = harness();
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    for (const action of ["add", "edit"]) {
      const code = await runCli(["node", "weread-omni", "review", action, "id", "note", ...flags, "--json"], {
        getClient: () => client,
        env: {},
        stdout,
        stderr,
        isTTY: false,
      });
      expect(code).toBe(0);
    }
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      if (expected === undefined) expect(request.body).not.toHaveProperty("isPrivate");
      else expect(request.body.isPrivate).toBe(expected);
      expect(request.body).not.toHaveProperty("private");
    }
    expect(stderr.write).not.toHaveBeenCalled();
  });

  it.each(["add", "edit"])("readonly still refuses private %s", async (action) => {
    const env = { WEREAD_READONLY: "1" };
    const { client, fetchImpl } = harness(env);
    const code = await runCli(["node", "weread-omni", "review", action, "id", "note", "--private", "--json"], {
      getClient: () => client,
      env,
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      isTTY: false,
    });
    expect(code).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
