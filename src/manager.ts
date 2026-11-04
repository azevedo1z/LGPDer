import { parseOptions } from './config.ts';
import type {
  ChangeSource,
  ConsentChange,
  ConsentDecision,
  ConsentManager,
  ConsentSnapshot,
  DecidedStatus,
} from './index.ts';
import {
  createDecision,
  discardExpired,
  readRecord,
  sameDecision,
  type Decisions,
} from './record.ts';
import { buildServerSnapshot, buildSnapshot } from './snapshot.ts';
import { describe, isDecidedStatus, isFunction, isPlainObject, isTimestamp } from './validation.ts';

// The core compiles without DOM and Node types (tsconfig.core.json), hence the declaration. The
// call resolves the global in effect when the error happens, not the one at import time.
declare function queueMicrotask(callback: () => void): void;

/** Decision request aligned with the configured ids; `undefined` means "no change". */
type Request = readonly (DecidedStatus | undefined)[];

/** Write computed by a mutation: position in `ids`, id and requested status. */
type Write = readonly [index: number, id: string, status: DecidedStatus];

interface Subscription {
  readonly listener: (change: ConsentChange) => unknown;
  /** Number of changes committed before the subscription: none of them is delivered. */
  readonly since: number;
}

interface Pending {
  /** Commit order of the change, starting at 1. */
  readonly seq: number;
  readonly change: ConsentChange;
}

/** Creates the manager: state, operations, notification queue and delivery. */
export function createManager(options: unknown): ConsentManager {
  const { model, record } = parseOptions(options);
  const { ids, positions, versions, grantable, now, maxAge } = model;
  const serverSnapshot = buildServerSnapshot(ids);

  /** Reads an untrusted record and discards the decisions that are no longer current. */
  const readCurrent = (input: unknown): (ConsentDecision | undefined)[] =>
    discardExpired(readRecord(input, ids), now, maxAge);

  // Hydration: does not notify and, without a current decision, adopts the server snapshot.
  let decisions: Decisions = readCurrent(record);
  let snapshot = decisions.some((decision) => decision !== undefined)
    ? buildSnapshot(model, decisions, serverSnapshot)
    : serverSnapshot;

  const subscriptions = new Set<Subscription>();
  const queue: Pending[] = [];
  let commits = 0;
  let delivering = false;

  // Fixed requests of the bulk operations: the configuration does not change during the lifetime
  // of the instance.
  const grantAllRequest: Request = grantable.map((reached) => (reached ? 'granted' : undefined));
  const denyAllRequest: Request = ids.map(() => 'denied');

  /** Delivers the queue in FIFO order until it is empty, including what listeners enqueue. */
  const deliver = (): void => {
    delivering = true;
    try {
      for (let pending = queue.shift(); pending !== undefined; pending = queue.shift()) {
        // Set iteration is live: a subscription cancelled during delivery is not visited.
        for (const subscription of subscriptions) {
          if (subscription.since >= pending.seq) continue;
          // Called without `this`, so the subscription is not exposed to the listener.
          const { listener } = subscription;
          try {
            listener(pending.change);
          } catch (error) {
            // The other listeners and the operation go on; the error stays visible.
            queueMicrotask(() => {
              throw error;
            });
          }
        }
      }
    } finally {
      delivering = false;
    }
  };

  /** Commits the change and notifies it. */
  const commit = (next: Decisions, changed: string[], source: ChangeSource): void => {
    const previous = snapshot;
    // The snapshot and the notification are built before the state changes: if building throws,
    // nothing changes.
    const current = buildSnapshot(model, next, previous);
    const change: ConsentChange = Object.freeze({
      source,
      changed: Object.freeze(changed),
      snapshot: current,
      previous,
    });
    decisions = next;
    snapshot = current;
    commits += 1;
    queue.push({ seq: commits, change });
    // Reentrancy: the delivery in progress takes this notification after the current one.
    if (!delivering) deliver();
  };

  /** Writes, in one atomic operation, the requests that change the effective status. */
  const apply = (requested: Request): void => {
    const { status } = snapshot;
    const writes: Write[] = [];
    for (const [index, id] of ids.entries()) {
      const value = requested[index];
      if (value !== undefined && value !== status[id]) writes.push([index, id, value]);
    }
    if (writes.length === 0) return;
    // One clock read per effective call, after validation and computation: the batch shares the
    // instant, and invalid input and no-ops never call the clock.
    const decidedAt = now();
    if (!isTimestamp(decidedAt)) {
      throw new TypeError(
        '[lgpder] "now" must return a non-negative safe integer (milliseconds since the Unix epoch).',
      );
    }
    const next = decisions.slice();
    const changed: string[] = [];
    for (const [index, id, value] of writes) {
      next[index] = createDecision(value, versions[index], decidedAt);
      changed.push(id);
    }
    commit(next, changed, 'decision');
  };

  const getSnapshot = (): ConsentSnapshot => snapshot;
  const getServerSnapshot = (): ConsentSnapshot => serverSnapshot;

  const decide = (choices: unknown): void => {
    if (!isPlainObject(choices)) {
      throw new TypeError(
        `[lgpder] Choices must be a plain object; received: ${describe(choices)}.`,
      );
    }
    // The whole input is validated before any effect.
    const requested = new Array<DecidedStatus | undefined>(ids.length).fill(undefined);
    for (const [key, value] of Object.entries(choices)) {
      const index = positions.get(key);
      if (index === undefined) {
        throw new RangeError(`[lgpder] Unknown purpose: ${JSON.stringify(key)}.`);
      }
      if (value !== undefined && !isDecidedStatus(value)) {
        throw new TypeError(
          `[lgpder] The choice for ${JSON.stringify(key)} must be "granted" or "denied"; received: ${describe(value)}.`,
        );
      }
      requested[index] = value;
    }
    apply(requested);
  };

  const grantAll = (): void => {
    apply(grantAllRequest);
  };

  const denyAll = (): void => {
    apply(denyAllRequest);
  };

  /** Replaces every decision with the current valid content of `input`, without merging. */
  const restore = (input: unknown): void => {
    const next = readCurrent(input);
    const changed: string[] = [];
    for (const [index, id] of ids.entries()) {
      const current = decisions[index];
      // An equal entry keeps the reference of the current decision, stable across snapshots.
      if (sameDecision(current, next[index])) next[index] = current;
      else changed.push(id);
    }
    if (changed.length > 0) commit(next, changed, 'restore');
  };

  const subscribe = (listener: unknown): (() => void) => {
    if (!isFunction(listener)) {
      throw new TypeError(
        `[lgpder] The listener must be a function; received: ${describe(listener)}.`,
      );
    }
    const subscription: Subscription = { listener, since: commits };
    subscriptions.add(subscription);
    return () => {
      subscriptions.delete(subscription);
    };
  };

  return Object.freeze({
    purposes: model.purposes,
    maxAge,
    getSnapshot,
    getServerSnapshot,
    decide,
    grantAll,
    denyAll,
    restore,
    subscribe,
  });
}
