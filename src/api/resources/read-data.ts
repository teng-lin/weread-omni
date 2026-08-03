import { assertOperationArguments, OPERATIONS } from "../operation-spec.js";
import { expectArrayFields } from "../response-guards.js";
import type { MobileTransport, ReadDataOptions, ReadDataResponse } from "../types.js";

/** Every list `/readdata/detail` can carry is optional upstream, so each is checked only if present. */
const READ_DATA_LISTS = [
  "readStat",
  "readLongest",
  "preferCategory",
  "preferTime",
  "preferAuthor",
  "preferPublisher",
  "preferCp",
  "medals",
  "preferBooks",
  "yearReport",
  "readTimeGears",
] as const;

export function readDataModule(mobile: MobileTransport) {
  return {
    detail(options: ReadDataOptions = {}): Promise<ReadDataResponse> {
      const mode = options.mode ?? "monthly";
      assertOperationArguments(OPERATIONS.readDataDetail, { mode, baseTime: options.baseTime });
      return mobile
        .call<ReadDataResponse>("GET", "/readdata/detail", {
          query: { mode, baseTime: options.baseTime },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/readdata/detail", [], READ_DATA_LISTS));
    },
  };
}
