import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentChange, ConsentDecision, ConsentManager, ConsentSnapshot } from 'lgpder';

import { decisionOf, recordOf } from '../support/records.ts';
import { START, assignUntyped, setup, type PurposeId } from '../support/setup.ts';

interface PublicObjects {
  readonly consent: ConsentManager<PurposeId>;
  readonly snapshot: ConsentSnapshot<PurposeId>;
  readonly server: ConsentSnapshot<PurposeId>;
  readonly change: ConsentChange<PurposeId>;
  /** Decision created by `decide`. */
  readonly decided: ConsentDecision;
  /** Decision read from the hydrated record. */
  readonly hydrated: ConsentDecision;
}

/** State that reaches every public object: hydrated decision, new decision and notification. */
function publicObjects(): PublicObjects {
  const { consent, changes } = setup({
    record: recordOf({ health: decisionOf('denied', { version: '1' }) }),
  });
  consent.decide({ analytics: 'granted', ads: 'denied' });
  const snapshot = consent.getSnapshot();
  const [change] = changes;
  const { analytics: decided, health: hydrated } = snapshot.record.decisions;
  assert.ok(change && decided && hydrated);
  return { consent, snapshot, server: consent.getServerSnapshot(), change, decided, hydrated };
}

interface PublicObject {
  readonly name: string;
  readonly pick: (objects: PublicObjects) => unknown;
}

const PUBLIC_OBJECTS = [
  { name: 'the manager', pick: ({ consent }) => consent },
  { name: 'the purposes object', pick: ({ consent }) => consent.purposes },
  { name: 'the configuration of analytics', pick: ({ consent }) => consent.purposes.analytics },
  { name: 'the configuration of ads', pick: ({ consent }) => consent.purposes.ads },
  { name: 'the configuration of health', pick: ({ consent }) => consent.purposes.health },
  { name: 'the snapshot', pick: ({ snapshot }) => snapshot },
  { name: 'the status of the snapshot', pick: ({ snapshot }) => snapshot.status },
  { name: 'the outdated of the snapshot', pick: ({ snapshot }) => snapshot.outdated },
  { name: 'the record of the snapshot', pick: ({ snapshot }) => snapshot.record },
  {
    name: 'the record.decisions of the snapshot',
    pick: ({ snapshot }) => snapshot.record.decisions,
  },
  { name: 'the decision written by decide', pick: ({ decided }) => decided },
  { name: 'the decision read from the record', pick: ({ hydrated }) => hydrated },
  { name: 'the server snapshot', pick: ({ server }) => server },
  { name: 'the status of the server snapshot', pick: ({ server }) => server.status },
  { name: 'the outdated of the server snapshot', pick: ({ server }) => server.outdated },
  { name: 'the record of the server snapshot', pick: ({ server }) => server.record },
  {
    name: 'the record.decisions of the server snapshot',
    pick: ({ server }) => server.record.decisions,
  },
  { name: 'the notification', pick: ({ change }) => change },
  { name: 'the hydrated snapshot, delivered in previous', pick: ({ change }) => change.previous },
] as const satisfies readonly PublicObject[];

describe('frozen public objects', () => {
  for (const { name, pick } of PUBLIC_OBJECTS) {
    it(`Object.isFrozen is true for ${name}`, () => {
      const value = pick(publicObjects());

      assert.equal(typeof value, 'object');
      assert.ok(Object.isFrozen(value));
    });
  }

  it('Object.isFrozen is true for the changed of the notification', () => {
    const { change } = publicObjects();

    assert.ok(Object.isFrozen(change.changed));
  });
});

describe('reference of the snapshot', () => {
  it('getSnapshot returns the same reference while there is no committed change', () => {
    const { consent } = setup();
    consent.decide({ ads: 'granted' });
    const snapshot = consent.getSnapshot();

    consent.decide({ ads: 'granted' });
    consent.restore(snapshot.record);

    assert.equal(consent.getSnapshot(), snapshot);
  });

  it('going back to a previous state produces a new snapshot, not the previous one', () => {
    const { consent } = setup();
    consent.decide({ ads: 'granted' });
    const granted = consent.getSnapshot();

    consent.decide({ ads: 'denied' });
    consent.decide({ ads: 'granted' });

    assert.notEqual(consent.getSnapshot(), granted);
  });

  it('going back to the state without decisions produces a new snapshot, not the server one', () => {
    const { consent } = setup();
    consent.decide({ ads: 'granted' });

    consent.restore(null);

    assert.notEqual(consent.getSnapshot(), consent.getServerSnapshot());
  });
});

describe('server snapshot', () => {
  it('getServerSnapshot always returns the same object, even after changes', () => {
    const { consent } = setup();
    const server = consent.getServerSnapshot();

    consent.grantAll();
    consent.restore(null);

    assert.equal(consent.getServerSnapshot(), server);
  });

  it('has everything pending, nothing outdated and an empty record, even with a hydrated record', () => {
    const { consent } = setup({ record: recordOf({ ads: decisionOf('granted') }) });

    assert.deepStrictEqual(consent.getServerSnapshot(), {
      status: { analytics: 'pending', ads: 'pending', health: 'pending' },
      outdated: { analytics: false, ads: false, health: false },
      record: { format: 1, decisions: {} },
    });
  });
});

describe('structural sharing between consecutive snapshots', () => {
  it('an unchanged decision keeps its reference', () => {
    const { consent } = setup({
      record: recordOf({ analytics: decisionOf('granted', { version: '2026-10' }) }),
    });
    const { analytics } = consent.getSnapshot().record.decisions;

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.analytics, analytics);
  });

  /** Snapshots before and after removing the outdated decision: only the flag of analytics changes. */
  function clearStaleAnalytics() {
    const { consent } = setup({
      record: recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) }),
    });
    const before = consent.getSnapshot();
    consent.restore(null);
    return { before, after: consent.getSnapshot() };
  }

  it('status keeps its reference when no status changes, even if outdated changes', () => {
    const { before, after } = clearStaleAnalytics();

    assert.equal(after.status, before.status);
  });

  it('outdated is a new object, with the updated flag, when some flag changes', () => {
    const { before, after } = clearStaleAnalytics();

    assert.notEqual(after.outdated, before.outdated);
    assert.equal(after.outdated.analytics, false);
  });

  it('outdated keeps its reference when no flag changes', () => {
    const { consent } = setup();
    const { outdated } = consent.getSnapshot();

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().outdated, outdated);
  });

  it('record and record.decisions are new objects on each change', () => {
    const { consent } = setup({ record: recordOf({ ads: decisionOf('granted') }) });
    const { record } = consent.getSnapshot();

    consent.restore(recordOf({ ads: decisionOf('granted', { decidedAt: START - 1 }) }));

    const next = consent.getSnapshot().record;
    assert.notEqual(next, record);
    assert.notEqual(next.decisions, record.decisions);
  });
});

describe('attempt to change a public object', () => {
  interface Mutation {
    readonly attempt: string;
    readonly act: (objects: PublicObjects) => void;
  }

  const MUTATIONS = [
    {
      attempt: 'replacing a function of the manager',
      act: ({ consent }) => {
        assignUntyped(consent, 'decide', () => undefined);
      },
    },
    {
      attempt: 'replacing the maxAge of the manager',
      act: ({ consent }) => {
        assignUntyped(consent, 'maxAge', Number.MAX_SAFE_INTEGER);
      },
    },
    {
      attempt: 'making health eligible for grantAll',
      act: ({ consent }) => {
        assignUntyped(consent.purposes.health, 'individualGrant', false);
      },
    },
    {
      attempt: 'adding a purpose to purposes',
      act: ({ consent }) => {
        assignUntyped(consent.purposes, 'extra', {});
      },
    },
    {
      attempt: 'granting ads through the status of the snapshot',
      act: ({ snapshot }) => {
        assignUntyped(snapshot.status, 'ads', 'granted');
      },
    },
    {
      attempt: 'flagging health as outdated',
      act: ({ snapshot }) => {
        assignUntyped(snapshot.outdated, 'health', true);
      },
    },
    {
      attempt: 'replacing the record of the snapshot',
      act: ({ snapshot }) => {
        assignUntyped(snapshot, 'record', { format: 1, decisions: {} });
      },
    },
    {
      attempt: 'replacing a decision of the record',
      act: ({ snapshot }) => {
        assignUntyped(snapshot.record.decisions, 'ads', decisionOf('granted'));
      },
    },
    {
      attempt: 'replacing the status of a decision',
      act: ({ decided }) => {
        assignUntyped(decided, 'status', 'denied');
      },
    },
    {
      attempt: 'granting ads through the server snapshot',
      act: ({ server }) => {
        assignUntyped(server.status, 'ads', 'granted');
      },
    },
    {
      attempt: 'replacing the source of the notification',
      act: ({ change }) => {
        assignUntyped(change, 'source', 'restore');
      },
    },
    {
      attempt: 'replacing an item of changed',
      act: ({ change }) => {
        assignUntyped(change.changed, '0', 'health');
      },
    },
  ] as const satisfies readonly Mutation[];

  for (const { attempt, act } of MUTATIONS) {
    it(`${attempt} throws TypeError and does not change the state`, () => {
      const objects = publicObjects();

      assert.throws(() => {
        act(objects);
      }, TypeError);

      assert.deepStrictEqual(objects.consent.getSnapshot(), publicObjects().snapshot);
    });
  }
});

describe('received objects are not retained', () => {
  it('changing the record passed in record after creation does not change the state', () => {
    const entry = { status: 'granted', decidedAt: START };
    const { consent } = setup({ record: { format: 1, decisions: { ads: entry } } });

    entry.status = 'denied';

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('changing the record passed to restore after the call does not change the state', () => {
    const entry = { status: 'granted', decidedAt: START };
    const { consent } = setup();
    consent.restore({ format: 1, decisions: { ads: entry } });

    entry.status = 'denied';

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });
});

describe('prototypes and key order', () => {
  for (const { name, pick } of PUBLIC_OBJECTS) {
    it(`${name} has the prototype Object.prototype`, () => {
      const value = pick(publicObjects());

      assert.equal(Object.getPrototypeOf(value), Object.prototype);
    });
  }

  it('changed is an ordinary array, with the prototype Array.prototype', () => {
    const { change } = publicObjects();

    assert.equal(Object.getPrototypeOf(change.changed), Array.prototype);
  });

  it('the keys of the snapshot and of the server snapshot come in the order status, outdated, record', () => {
    const { snapshot, server } = publicObjects();

    assert.deepStrictEqual(
      [Object.keys(snapshot), Object.keys(server)],
      [
        ['status', 'outdated', 'record'],
        ['status', 'outdated', 'record'],
      ],
    );
  });

  it('assert.deepStrictEqual accepts literals as the expected value of a snapshot', () => {
    const { snapshot } = publicObjects();

    assert.deepStrictEqual(snapshot, {
      status: { analytics: 'granted', ads: 'denied', health: 'denied' },
      outdated: { analytics: false, ads: false, health: false },
      record: {
        format: 1,
        decisions: {
          analytics: { status: 'granted', version: '2026-10', decidedAt: START },
          ads: { status: 'denied', decidedAt: START },
          health: { status: 'denied', version: '1', decidedAt: START },
        },
      },
    });
  });
});
