/** Builders of records in the `format: 1` shape. */
import type { ConsentDecision, DecidedStatus } from 'lgpder';

import { START } from './setup.ts';

export interface DecisionFields {
  readonly version?: string | undefined;
  readonly decidedAt?: number | undefined;
}

/** Valid decision, with the fields in the order `status`, `version`, `decidedAt`. */
export function decisionOf(
  status: DecidedStatus,
  { version, decidedAt = START }: DecisionFields = {},
): ConsentDecision {
  return version === undefined ? { status, decidedAt } : { status, version, decidedAt };
}

/** Record `{ format: 1, decisions }` with the given entries, valid or not. */
export function recordOf(decisions: Readonly<Record<string, unknown>>) {
  return { format: 1, decisions } as const;
}

/** JSON text of the record, as the application writes it. */
export function serialized(decisions: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(recordOf(decisions));
}
