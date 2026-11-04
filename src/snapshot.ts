import type { Model } from './config.ts';
import type { ConsentDecision, ConsentRecord, ConsentSnapshot, ConsentStatus } from './index.ts';
import { versionOf, type Decisions } from './record.ts';

/** Server snapshot: every purpose `'pending'`, nothing `outdated` and no decisions. */
export function buildServerSnapshot(ids: readonly string[]): ConsentSnapshot {
  const status: Record<string, ConsentStatus> = {};
  const outdated: Record<string, boolean> = {};
  for (const id of ids) {
    status[id] = 'pending';
    outdated[id] = false;
  }
  const record: ConsentRecord = { format: 1, decisions: Object.freeze({}) };
  return Object.freeze({
    status: Object.freeze(status),
    outdated: Object.freeze(outdated),
    record: Object.freeze(record),
  });
}

/**
 * Frozen snapshot of the decisions. Reuses `status` and `outdated` from `previous` when no value
 * changed; `record` and `record.decisions` are always new. Decisions are kept by reference, so an
 * unchanged decision keeps its own.
 */
export function buildSnapshot(
  model: Model,
  decisions: Decisions,
  previous: ConsentSnapshot,
): ConsentSnapshot {
  const { ids, versions } = model;
  const { status: previousStatus, outdated: previousOutdated } = previous;
  const status: Record<string, ConsentStatus> = {};
  const outdated: Record<string, boolean> = {};
  const recorded: Record<string, ConsentDecision> = {};
  let statusChanged = false;
  let outdatedChanged = false;
  for (const [index, id] of ids.entries()) {
    const decision = decisions[index];
    let current: ConsentStatus = 'pending';
    let stale = false;
    if (decision !== undefined) {
      recorded[id] = decision;
      // A decision recorded under another version is not current: 'pending', and flagged.
      if (versionOf(decision) === versions[index]) current = decision.status;
      else stale = true;
    }
    status[id] = current;
    outdated[id] = stale;
    if (current !== previousStatus[id]) statusChanged = true;
    if (stale !== previousOutdated[id]) outdatedChanged = true;
  }
  const record: ConsentRecord = { format: 1, decisions: Object.freeze(recorded) };
  return Object.freeze({
    status: statusChanged ? Object.freeze(status) : previousStatus,
    outdated: outdatedChanged ? Object.freeze(outdated) : previousOutdated,
    record: Object.freeze(record),
  });
}
