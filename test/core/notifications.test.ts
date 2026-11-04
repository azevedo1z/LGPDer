import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import type { ConsentChange, ConsentManager, ConsentStatus } from 'lgpder';

import { decisionOf, recordOf } from '../support/records.ts';
import { callUntyped, setup, type PurposeId } from '../support/setup.ts';

/** `analytics` and `ads` granted: everything `grantAll` reaches in the fixture. */
const ELIGIBLE_GRANTED = recordOf({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('granted'),
});

/** Every purpose of the fixture denied. */
const ALL_DENIED = recordOf({
  analytics: decisionOf('denied', { version: '2026-10' }),
  ads: decisionOf('denied'),
  health: decisionOf('denied', { version: '1' }),
});

describe('subscription and cancellation', () => {
  it('subscribe returns the function that cancels the subscription', () => {
    const { consent } = setup();
    const received: ConsentChange<PurposeId>[] = [];
    const unsubscribe = consent.subscribe((change) => {
      received.push(change);
    });

    unsubscribe();
    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(received, []);
  });

  it('subscribe with a value that is not a function throws TypeError', () => {
    const { consent } = setup();

    assert.throws(() => callUntyped(consent.subscribe, 'x'), TypeError);
  });

  it('the same function subscribed twice is called twice per notification', () => {
    const { consent } = setup();
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    consent.subscribe(listener);
    consent.subscribe(listener);

    consent.decide({ ads: 'granted' });

    assert.equal(calls, 2);
  });

  it('cancelling the same subscription twice removes only it', () => {
    const { consent } = setup();
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    const cancelFirst = consent.subscribe(listener);
    consent.subscribe(listener);

    cancelFirst();
    cancelFirst();
    consent.decide({ ads: 'granted' });

    assert.equal(calls, 1);
  });
});

describe('there is a notification if and only if the record changes', () => {
  it('creation and hydration do not notify, not even after a turn of the event loop', async () => {
    const { changes } = setup({ record: ELIGIBLE_GRANTED });

    await setImmediate();

    assert.deepStrictEqual(changes, []);
  });

  interface SilentOperation {
    readonly operation: string;
    readonly record: unknown;
    readonly act: (consent: ConsentManager<PurposeId>) => void;
  }

  const SILENT_OPERATIONS = [
    {
      operation: 'decide({})',
      record: undefined,
      act: (consent) => {
        consent.decide({});
      },
    },
    {
      operation: 'decide that reconfirms the current status',
      record: ELIGIBLE_GRANTED,
      act: (consent) => {
        consent.decide({ ads: 'granted' });
      },
    },
    {
      operation: 'grantAll without an eligible purpose to change',
      record: ELIGIBLE_GRANTED,
      act: (consent) => {
        consent.grantAll();
      },
    },
    {
      operation: 'denyAll without a purpose to change',
      record: ALL_DENIED,
      act: (consent) => {
        consent.denyAll();
      },
    },
    {
      operation: 'restore of the current record',
      record: ELIGIBLE_GRANTED,
      act: (consent) => {
        consent.restore(consent.getSnapshot().record);
      },
    },
  ] as const satisfies readonly SilentOperation[];

  for (const { operation, record, act } of SILENT_OPERATIONS) {
    it(`${operation} does not notify`, () => {
      const { consent, changes } = setup({ record });

      act(consent);

      assert.deepStrictEqual(changes, []);
    });
  }
});

describe('shape of the notification', () => {
  it('has the keys source, changed, snapshot and previous, in this order', () => {
    const { consent, changes } = setup();

    consent.decide({ ads: 'granted' });

    const [change] = changes;
    assert.ok(change);
    assert.deepStrictEqual(Object.keys(change), ['source', 'changed', 'snapshot', 'previous']);
  });

  it('snapshot is the state committed by the change', () => {
    const { consent, changes } = setup();

    consent.decide({ ads: 'granted' });

    const [change] = changes;
    assert.ok(change);
    assert.equal(change.snapshot, consent.getSnapshot());
  });

  it('previous is the snapshot right before the change', () => {
    const { consent, changes } = setup();
    consent.decide({ analytics: 'granted' });
    const before = consent.getSnapshot();

    consent.decide({ ads: 'granted' });

    const [, change] = changes;
    assert.ok(change);
    assert.equal(change.previous, before);
  });
});

describe('order of an effective operation', () => {
  it('the listeners are called in subscription order', () => {
    const { consent } = setup();
    const order: string[] = [];
    consent.subscribe(() => {
      order.push('first');
    });
    consent.subscribe(() => {
      order.push('second');
    });
    consent.subscribe(() => {
      order.push('third');
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(order, ['first', 'second', 'third']);
  });

  it('during the notification, getSnapshot already returns the committed snapshot', () => {
    const { consent } = setup();
    let seen: ConsentStatus | undefined;
    consent.subscribe(() => {
      seen = consent.getSnapshot().status.ads;
    });

    consent.decide({ ads: 'granted' });

    assert.equal(seen, 'granted');
  });

  it('the notification is delivered synchronously, before the call returns', () => {
    const { consent, changes } = setup();

    consent.decide({ ads: 'granted' });

    assert.equal(changes.length, 1);
  });

  it('outside listeners, the call only returns after also delivering the queued notifications', () => {
    const { consent, changes } = setup();
    consent.subscribe(({ changed }) => {
      if (changed.includes('analytics')) consent.decide({ ads: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['analytics'], ['ads']],
    );
  });
});

describe('listener error', () => {
  /** Replaces the global queueMicrotask with a collector, so the rethrown error does not end the test. */
  function captureMicrotasks(t: TestContext): (() => void)[] {
    const scheduled: (() => void)[] = [];
    t.mock.method(globalThis, 'queueMicrotask', (callback: () => void) => {
      scheduled.push(callback);
    });
    return scheduled;
  }

  it('the next listeners are called and the operation returns normally', (t) => {
    captureMicrotasks(t);
    const { consent } = setup();
    const calls: string[] = [];
    consent.subscribe(() => {
      throw new Error('faulty listener');
    });
    consent.subscribe(() => {
      calls.push('next');
    });

    assert.doesNotThrow(() => {
      consent.decide({ ads: 'granted' });
    });

    assert.deepStrictEqual(calls, ['next']);
  });

  it('schedules, through the global queueMicrotask in effect, replaced after import, one microtask per error, when the error happens', (t) => {
    const log: string[] = [];
    t.mock.method(globalThis, 'queueMicrotask', () => {
      log.push('microtask scheduled');
    });
    const { consent } = setup();
    consent.subscribe(() => {
      log.push('first listener');
      throw new Error('first defect');
    });
    consent.subscribe(() => {
      log.push('second listener');
      throw new Error('second defect');
    });
    consent.subscribe(() => {
      log.push('third listener');
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, [
      'first listener',
      'microtask scheduled',
      'second listener',
      'microtask scheduled',
      'third listener',
    ]);
  });

  it('the scheduled microtask rethrows intact the value thrown by the listener', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('faulty listener');
    const { consent } = setup();
    consent.subscribe(() => {
      throw failure;
    });

    consent.decide({ ads: 'granted' });

    const [rethrow] = scheduled;
    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === failure);
  });
});

describe('reentrancy', () => {
  it('decide called inside a listener is committed at once', () => {
    const { consent } = setup();
    let statusInsideListener: ConsentStatus | undefined;
    consent.subscribe(({ changed }) => {
      if (!changed.includes('analytics')) return;
      consent.decide({ ads: 'denied' });
      statusInsideListener = consent.getSnapshot().status.ads;
    });

    consent.decide({ analytics: 'granted' });

    assert.equal(statusInsideListener, 'denied');
  });

  it('the reentrant call returns before its notification, delivered after the current one to everyone, in the same order', () => {
    const { consent } = setup();
    const log: string[] = [];
    consent.subscribe(({ changed }) => {
      log.push(`first listener: ${changed.join()}`);
      if (!changed.includes('analytics')) return;
      consent.decide({ ads: 'denied' });
      log.push('reentrant decide returned');
    });
    consent.subscribe(({ changed }) => {
      log.push(`second listener: ${changed.join()}`);
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(log, [
      'first listener: analytics',
      'reentrant decide returned',
      'second listener: analytics',
      'first listener: ads',
      'second listener: ads',
    ]);
  });

  it('the previous of each notification is the snapshot of the previous notification', () => {
    const { consent, changes } = setup();
    consent.subscribe(({ changed }) => {
      if (changed.includes('analytics')) consent.decide({ ads: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    const [first, second] = changes;
    assert.ok(first && second);
    assert.equal(second.previous, first.snapshot);
  });

  it('two reentrant calls in the same listener are delivered in commit order (FIFO)', () => {
    const { consent, changes } = setup();
    consent.subscribe(({ changed }) => {
      if (!changed.includes('analytics')) return;
      consent.decide({ ads: 'granted' });
      consent.decide({ health: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['analytics'], ['ads'], ['health']],
    );
  });

  it('restore called inside a listener is committed at once', () => {
    const { consent } = setup();
    let statusInsideListener: ConsentStatus | undefined;
    consent.subscribe(({ source }) => {
      if (source !== 'decision') return;
      consent.restore(null);
      statusInsideListener = consent.getSnapshot().status.ads;
    });

    consent.decide({ ads: 'granted' });

    assert.equal(statusInsideListener, 'pending');
  });

  it('restore called inside a listener is notified after the current notification', () => {
    const { consent } = setup();
    const sources: string[] = [];
    consent.subscribe(({ source }) => {
      if (source === 'decision') consent.restore(null);
    });
    consent.subscribe(({ source }) => {
      sources.push(source);
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(sources, ['decision', 'restore']);
  });
});

describe('cancellation during delivery', () => {
  it('a listener cancelled by another during delivery does not receive even the current notification', () => {
    const { consent } = setup();
    const received: string[] = [];
    consent.subscribe(() => {
      cancelSecond();
    });
    const cancelSecond = consent.subscribe(() => {
      received.push('second');
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(received, []);
  });

  it('a listener that cancels itself does not receive the notifications already queued', () => {
    const { consent } = setup();
    const received: string[] = [];
    const unsubscribe = consent.subscribe(({ changed }) => {
      received.push(changed.join());
      unsubscribe();
      consent.decide({ ads: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(received, ['analytics']);
  });
});

describe('subscription during delivery', () => {
  it('receives only the changes committed after it', () => {
    const { consent } = setup();
    const late: string[] = [];
    consent.subscribe(({ changed }) => {
      if (!changed.includes('analytics')) return;
      consent.decide({ ads: 'granted' });
      consent.subscribe((change) => {
        late.push(change.changed.join());
      });
      consent.decide({ health: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(late, ['health']);
  });
});

describe('no cascade limit', () => {
  it('changes chained by a listener are all delivered', () => {
    const { consent, changes } = setup();
    consent.subscribe(({ snapshot }) => {
      if (changes.length >= 1_000) return;
      consent.decide({ ads: snapshot.status.ads === 'granted' ? 'denied' : 'granted' });
    });

    consent.decide({ ads: 'granted' });

    assert.equal(changes.length, 1_000);
  });
});

describe('argument and return value of the listener', () => {
  it('the listener is called without this', () => {
    const { consent } = setup();
    const receivers: unknown[] = [];
    consent.subscribe(function (this: unknown) {
      receivers.push(this);
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(receivers, [undefined]);
  });

  it('the listener receives the notification as its only argument', () => {
    const { consent } = setup();
    const argumentCounts: number[] = [];
    consent.subscribe((...args: unknown[]) => {
      argumentCounts.push(args.length);
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(argumentCounts, [1]);
  });

  it('the returned value is ignored: returning false does not stop the next listeners', () => {
    const { consent } = setup();
    const calls: string[] = [];
    consent.subscribe(() => false);
    consent.subscribe(() => {
      calls.push('next');
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(calls, ['next']);
  });

  it('a listener without parameters, like the useSyncExternalStore callback, works', () => {
    const { consent } = setup();
    let storeChanges = 0;
    const onStoreChange = (): void => {
      storeChanges += 1;
    };
    const unsubscribe = consent.subscribe(onStoreChange);

    consent.decide({ ads: 'granted' });
    unsubscribe();
    consent.decide({ ads: 'denied' });

    assert.equal(storeChanges, 1);
  });
});
