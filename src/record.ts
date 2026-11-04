import type { ConsentDecision, DecidedStatus } from './index.ts';
import {
  isDecidedStatus,
  isPlainObject,
  isTimestamp,
  isVersion,
  ownValue,
  type PlainObject,
} from './validation.ts';

/** Decision of each purpose, aligned with the configured ids; `undefined` when there is none. */
export type Decisions = readonly (ConsentDecision | undefined)[];

/**
 * Creates the frozen decision, with the fields in the order `status`, `version`, `decidedAt`, which
 * makes serialization deterministic.
 */
export function createDecision(
  status: DecidedStatus,
  version: string | undefined,
  decidedAt: number,
): ConsentDecision {
  // -0 becomes 0: JSON does not keep the sign, and the record round trip must be exact.
  const instant = decidedAt + 0;
  return Object.freeze(
    version === undefined
      ? { status, decidedAt: instant }
      : { status, version, decidedAt: instant },
  );
}

/**
 * Version of a decision, or `undefined` if it has none. A missing property is not read, because
 * the read would reach the prototype, which may be polluted.
 */
export function versionOf(decision: ConsentDecision): string | undefined {
  return Object.hasOwn(decision, 'version') ? decision.version : undefined;
}

/** Equality of record entries: both absent, or with the same three fields. */
export function sameDecision(
  a: ConsentDecision | undefined,
  b: ConsentDecision | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.status === b.status && versionOf(a) === versionOf(b) && a.decidedAt === b.decidedAt;
}

/**
 * Reads an untrusted record and returns a new array, aligned with `ids`, that the caller may
 * change. Never throws: missing or invalid content is an empty record, and an invalid entry is the
 * absence of a decision. The keys of the record are never iterated.
 */
export function readRecord(
  input: unknown,
  ids: readonly string[],
): (ConsentDecision | undefined)[] {
  try {
    const root: unknown = typeof input === 'string' ? JSON.parse(input) : input;
    const decisions = readDecisions(root);
    if (decisions !== undefined) return ids.map((id) => readEntry(decisions, id));
  } catch {
    // Text that is not JSON, a throwing getter or a hostile proxy: empty record.
  }
  // Filled, without holes: a hole would be read from the prototype, which may be polluted.
  return new Array<ConsentDecision | undefined>(ids.length).fill(undefined);
}

/**
 * Returns a new array, aligned with `decisions`, that keeps only the decisions current at the
 * instant returned by `now`; the caller may change it. A decision is current while
 * `0 <= instant - decidedAt < maxAge`: an expired decision, or one dated after the instant, whose
 * age cannot be established, is discarded as if it did not exist. The clock is called once, and
 * only when there is a decision to evaluate. If the clock throws or returns an invalid instant,
 * every decision is discarded (fail closed). Never throws.
 */
export function discardExpired(
  decisions: Decisions,
  now: () => unknown,
  maxAge: number,
): (ConsentDecision | undefined)[] {
  const instant = decisions.some((decision) => decision !== undefined) ? readClock(now) : undefined;
  return decisions.map((decision) =>
    decision !== undefined && isCurrent(decision, instant, maxAge) ? decision : undefined,
  );
}

/** Whether `decision` is current at `instant`; never, when the instant is unknown. */
function isCurrent(
  decision: ConsentDecision,
  instant: number | undefined,
  maxAge: number,
): boolean {
  if (instant === undefined) return false;
  const age = instant - decision.decidedAt;
  return age >= 0 && age < maxAge;
}

/** Instant returned by the clock, or `undefined` if the clock throws or returns an invalid value. */
function readClock(now: () => unknown): number | undefined {
  try {
    const instant = now();
    return isTimestamp(instant) ? instant : undefined;
  } catch {
    // A failing clock cannot vouch for any decision: same as an invalid instant.
    return undefined;
  }
}

/** `decisions` object of a valid root, or `undefined`. */
function readDecisions(root: unknown): PlainObject | undefined {
  if (!isPlainObject(root) || ownValue(root, 'format') !== 1) return undefined;
  const decisions = ownValue(root, 'decisions');
  return isPlainObject(decisions) ? decisions : undefined;
}

/** Valid entry of a configured purpose, or `undefined`. */
function readEntry(decisions: PlainObject, id: string): ConsentDecision | undefined {
  const entry = ownValue(decisions, id);
  if (!isPlainObject(entry)) return undefined;
  const status = ownValue(entry, 'status');
  if (!isDecidedStatus(status)) return undefined;
  const decidedAt = ownValue(entry, 'decidedAt');
  if (!isTimestamp(decidedAt)) return undefined;
  const version = ownValue(entry, 'version');
  if (version !== undefined && !isVersion(version)) return undefined;
  // Extra fields are not copied, to minimize the data in the record.
  return createDecision(status, version, decidedAt);
}
