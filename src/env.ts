/**
 * The single parser shared by every environment gate.
 *
 * A supplied value reads as true only when it is `1`, `true`, or `yes` (case-insensitive); anything
 * else, including an absent value, reads as false. A caller that wants a different default for a
 * blank value substitutes it before calling, as `operation-policy.ts` does with `?.trim() || "0"`.
 *
 * Kept in one place so an extension's gates parse identically to the built-in ones rather than
 * reimplementing the rule in parallel.
 */
export const envEnabled = (value: string | undefined): boolean => /^(?:1|true|yes)$/i.test(value || "");
