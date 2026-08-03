import { OPERATIONS, type OperationGate } from "./api/operation-spec.js";
import { envEnabled } from "./env.js";

/** The single switch that closes every write. */
export const READONLY_ENVIRONMENT_VARIABLE = "WEREAD_READONLY";

const GATE_SUBJECTS: Readonly<Record<OperationGate, string>> = Object.freeze({
  upload: "upload",
  delete: "delete",
  shelf: "shelf writes",
  review: "review writes",
  notes: "notes writes",
});

/** Canonical operation identifier to its optional write gate. */
export const OPERATION_GATES: Readonly<Record<string, OperationGate | undefined>> = Object.freeze(
  Object.fromEntries(
    Object.values(OPERATIONS).map((operation) => [`${operation.resource}.${operation.action}`, operation.gate]),
  ),
);

export const operationGate = (operation: string): OperationGate | undefined => OPERATION_GATES[operation];

export const gateDisabledMessage = (gate: OperationGate): string =>
  `${GATE_SUBJECTS[gate]} disabled by ${READONLY_ENVIRONMENT_VARIABLE} (unset it, or set it to 0)`;

/**
 * Every write is permitted by default; one variable closes them all, which is how an operator locks
 * a deployment down. Unset, empty, and whitespace all mean "default", so a blank line in a `.env`
 * cannot change policy. Otherwise `1`/`true`/`yes` closes writes and anything else leaves them open.
 *
 * The gate taxonomy survives because it still says which operations are writes -- it just no longer
 * selects between variables. Reads have no gate and are never affected.
 */
export const gateEnabled = (gate: OperationGate | undefined, env: NodeJS.ProcessEnv): boolean =>
  gate === undefined || !envEnabled(env[READONLY_ENVIRONMENT_VARIABLE]?.trim() || "0");

/** True for known reads; for known writes, true unless the read-only switch is set. */
export const operationEnabled = (operation: string, env: NodeJS.ProcessEnv): boolean =>
  Object.hasOwn(OPERATION_GATES, operation) && gateEnabled(operationGate(operation), env);
