import { WeReadApiError } from "../errors.js";
import type { MobileResponse } from "./mobile.js";

/**
 * The wire-to-public seam.
 *
 * `MobileClient.call` casts the parsed JSON to the operation's declared type and checks only that
 * the body is a non-null object. Upstream is a private API this package neither owns nor versions,
 * so every field a declared type promises is a promise nothing enforces.
 *
 * For a scalar that is survivable: a caller reading `undefined` where a number was declared gets a
 * wrong answer, not a crash, and `types.ts` now says `?` wherever that is the truth. For an array
 * field it is not: `books: null` becomes a `TypeError` inside the consumer's own `.map()`, with
 * nothing in the stack naming this SDK or the request that produced it. `book.chapters` already
 * hit exactly that (a string arrived where `ChapterInfo[]` was declared) and fixed it in one place;
 * these helpers apply the same check at the other seams, and raise a `WeReadApiError` carrying the
 * operation's path so the failure is attributable.
 *
 * Deliberately not a validator framework. No schema, no element inspection, no field-type table —
 * each resource names the array fields its own declared type says are always there, and nothing
 * else is looked at. A field this file does not check is optional in `types.ts`; that is the whole
 * contract, and it is the only reason the declarations can be read as guarantees at all.
 */

const shapeOf = (value: unknown): string => {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const type = typeof value;
  return type === "object" ? "an object" : `a ${type}`;
};

const reject = (path: string, status: number, detail: string): never => {
  throw new WeReadApiError(`mobile ${path}: ${detail}`, { path, status });
};

const assertArray = (value: unknown, label: string, path: string, status: number): void => {
  if (!Array.isArray(value)) reject(path, status, `${label} is ${shapeOf(value)}, not an array`);
};

/**
 * Assert the array fields of a response body, and hand the body back unchanged.
 *
 * `required` names fields the declared type says are always present. `optional` names fields the
 * declared type marks `?`: absent is a legitimate answer, and so is an explicit `null`, which is
 * normalised away so the runtime value cannot contradict the `X[] | undefined` the caller was
 * given. Anything else present under either name is a shape violation.
 */
export function expectArrayFields<T>(
  response: MobileResponse<T>,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): T {
  const body = response.body as Record<string, unknown>;
  for (const field of required) assertArray(body[field], field, path, response.status);
  for (const field of optional) {
    const value = body[field];
    if (value === undefined) continue;
    if (value === null) {
      delete body[field];
      continue;
    }
    assertArray(value, field, path, response.status);
  }
  return response.body;
}

/**
 * The same required/optional assertions one level down, for a response whose list is wrapped in
 * an envelope object (`/book/detailinfo` answers `{ booksimilar: { books: [...] } }`). The envelope
 * itself has to be an object before its fields mean anything, so that is checked first.
 */
export function expectNestedArrayFields<T>(
  response: MobileResponse<T>,
  path: string,
  container: string,
  required: readonly string[],
  optional: readonly string[] = [],
): T {
  const envelope = (response.body as Record<string, unknown>)[container];
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    reject(path, response.status, `${container} is ${shapeOf(envelope)}, not an object`);
  }
  const inner = envelope as Record<string, unknown>;
  for (const field of required) assertArray(inner[field], `${container}.${field}`, path, response.status);
  for (const field of optional) {
    const value = inner[field];
    if (value === undefined) continue;
    if (value === null) {
      delete inner[field];
      continue;
    }
    assertArray(value, `${container}.${field}`, path, response.status);
  }
  return response.body;
}
