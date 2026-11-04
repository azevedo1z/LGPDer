/** Builders de registros no formato `format: 1`. */
import type { ConsentDecision, DecidedStatus } from 'lgpder';

import { START } from './setup.ts';

export interface DecisionFields {
  readonly version?: string | undefined;
  readonly decidedAt?: number | undefined;
}

/** Decisão válida, com os campos na ordem `status`, `version`, `decidedAt`. */
export function decisionOf(
  status: DecidedStatus,
  { version, decidedAt = START }: DecisionFields = {},
): ConsentDecision {
  return version === undefined ? { status, decidedAt } : { status, version, decidedAt };
}

/** Registro `{ format: 1, decisions }` com as entradas informadas, válidas ou não. */
export function recordOf(decisions: Readonly<Record<string, unknown>>) {
  return { format: 1, decisions } as const;
}

/** Texto JSON do registro, como a aplicação o grava. */
export function serialized(decisions: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(recordOf(decisions));
}
