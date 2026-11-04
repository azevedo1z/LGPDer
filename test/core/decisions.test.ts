import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentChange } from 'lgpder';

import { createConsentManager } from '../../src/index.ts';
import { decisionOf, recordOf } from '../support/records.ts';
import {
  PURPOSES,
  START,
  createUntyped,
  decideUntyped,
  setup,
  withObjectPollution,
  withPrototype,
} from '../support/setup.ts';

/** Record with `analytics` granted under the current version of the fixture. */
const ANALYTICS_GRANTED = recordOf({ analytics: decisionOf('granted', { version: '2026-10' }) });

describe('decide: grant, refuse and revoke', () => {
  it('granting records the status, the current version of the purpose and the clock instant', () => {
    const { consent } = setup();

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: { status: 'granted', version: '2026-10', decidedAt: START },
    });
  });

  it('a purpose without a configured version records a decision without version', () => {
    const { consent } = setup();

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: { status: 'denied', decidedAt: START },
    });
  });

  for (const status of ['granted', 'denied'] as const) {
    it(`deciding '${status}' makes the status '${status}'`, () => {
      const { consent } = setup();

      consent.decide({ ads: status });

      assert.equal(consent.getSnapshot().status.ads, status);
    });
  }

  it('revoking records a new denied decision with a new decidedAt, and the record keeps only the last', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    clock.advance(60_000);

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: decisionOf('denied', { decidedAt: START + 60_000 }),
    });
  });

  it('the notification of the revocation has previous with granted and snapshot with denied', () => {
    const { consent, changes } = setup();
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: 'denied' });

    const [, revocation] = changes;
    assert.ok(revocation);
    assert.deepStrictEqual(
      [revocation.previous.status.ads, revocation.snapshot.status.ads],
      ['granted', 'denied'],
    );
  });

  it('no rate limit: granting and revoking in sequence, at the same instant, records everything', () => {
    const { consent, changes } = setup();

    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });
    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });

    assert.equal(changes.length, 4);
  });

  it('individualGrant does not prevent decide from granting', () => {
    const { consent } = setup();

    consent.decide({ health: 'granted' });

    assert.equal(consent.getSnapshot().status.health, 'granted');
  });
});

describe('validation of the whole input before any effect', () => {
  const INVALID_CHOICES = [
    {
      scenario: 'unknown id after a valid choice',
      args: [{ analytics: 'granted', typo: 'denied' }],
      error: RangeError,
    },
    {
      scenario: 'boolean value in the middle of the batch',
      args: [{ analytics: 'granted', ads: true, health: 'denied' }],
      error: TypeError,
    },
    {
      scenario: "value 'GRANTED'",
      args: [{ analytics: 'granted', ads: 'GRANTED' }],
      error: TypeError,
    },
    {
      scenario: "value 'pending'",
      args: [{ analytics: 'granted', ads: 'pending' }],
      error: TypeError,
    },
    { scenario: 'null choices', args: [null], error: TypeError },
    { scenario: 'choices in an array', args: [['analytics']], error: TypeError },
    {
      scenario: 'choices in a Map',
      args: [new Map([['analytics', 'granted']])],
      error: TypeError,
    },
    { scenario: 'choices in a string', args: ['analytics'], error: TypeError },
    { scenario: 'no argument', args: [], error: TypeError },
    {
      scenario: 'choices with another prototype',
      args: [withPrototype({ analytics: 'granted' }, {})],
      error: TypeError,
    },
  ] as const;

  for (const { scenario, args, error } of INVALID_CHOICES) {
    it(`${scenario}: throws ${error.name} without applying anything, calling the clock or notifying`, () => {
      const { consent, clock, changes } = setup();
      const before = consent.getSnapshot();

      assert.throws(() => {
        decideUntyped(consent, ...args);
      }, error);

      assert.equal(consent.getSnapshot(), before);
      assert.equal(clock.calls(), 0);
      assert.deepStrictEqual(changes, []);
    });
  }

  const FIRST_VIOLATION = [
    {
      scenario: 'the key is checked before the invalid value',
      choices: { typo: true },
      error: RangeError,
    },
    {
      scenario: 'the key is checked before the undefined value',
      choices: { typo: undefined },
      error: RangeError,
    },
    {
      scenario: 'invalid value in a key before an unknown key',
      choices: { ads: 'GRANTED', typo: 'denied' },
      error: TypeError,
    },
    {
      scenario: 'unknown key before an invalid value',
      choices: { typo: 'denied', ads: 'GRANTED' },
      error: RangeError,
    },
  ] as const;

  for (const { scenario, choices, error } of FIRST_VIOLATION) {
    it(`the first violation in Object.keys order defines the error: ${scenario}`, () => {
      const { consent } = setup();

      assert.throws(() => {
        decideUntyped(consent, choices);
      }, error);
    });
  }

  it('after an error, the subscriptions stay active', () => {
    const { consent, changes } = setup();
    assert.throws(() => {
      decideUntyped(consent, { typo: 'granted' });
    }, RangeError);

    consent.decide({ ads: 'granted' });

    assert.equal(changes.length, 1);
  });

  it('ignores symbol keys and non-enumerable properties of the choices', () => {
    const { consent } = setup();
    const choices = Object.defineProperty({ ads: 'granted', [Symbol('extra')]: 'denied' }, 'typo', {
      value: 'denied',
      enumerable: false,
    });

    decideUntyped(consent, choices);

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'pending',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('null-prototype choices are accepted', () => {
    const { consent } = setup();

    decideUntyped(consent, withPrototype({ ads: 'granted' }, null));

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });
});

describe('an error while committing a decision leaves no partial effect', () => {
  it('the decision after one that threw while building the snapshot does not publish the one that threw', () => {
    const { consent, changes } = setup({ purposes: { ads: {}, other: {} } });
    // Inherited read-only property named after a purpose, created after the manager: building the
    // snapshot assigns status.other and throws.
    withObjectPollution(
      { other: 'pending' },
      () => {
        assert.throws(() => {
          consent.decide({ ads: 'granted' });
        }, TypeError);
      },
      { writable: false },
    );

    consent.decide({ other: 'denied' });

    assert.deepStrictEqual(
      changes.map(({ snapshot }) => snapshot.status),
      [{ ads: 'pending', other: 'denied' }],
    );
  });
});

describe('calls without change', () => {
  const NO_OPS = [
    { scenario: 'decide({})', choices: {} },
    { scenario: 'purpose with undefined', choices: { ads: undefined } },
    { scenario: 'reconfirmation of the current status', choices: { analytics: 'granted' } },
  ] as const;

  for (const { scenario, choices } of NO_OPS) {
    it(`${scenario} is a complete no-op: same snapshot and the clock is not called`, () => {
      const { consent, clock } = setup({ record: ANALYTICS_GRANTED });
      const before = consent.getSnapshot();
      const hydrationCalls = clock.calls();

      consent.decide(choices);

      assert.equal(consent.getSnapshot(), before);
      assert.equal(clock.calls(), hydrationCalls);
    });
  }

  it('reconfirming keeps the current decision, with the same decidedAt', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    const decision = consent.getSnapshot().record.decisions.ads;
    clock.advance(60_000);

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.ads, decision);
  });

  it('in a batch with other changes, the reconfirmed purpose keeps the previous decision', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    const decision = consent.getSnapshot().record.decisions.ads;
    clock.advance(60_000);

    consent.decide({ ads: 'granted', analytics: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.ads, decision);
  });

  it('a purpose with undefined does not change, even in a batch with other changes', () => {
    const { consent, changes } = setup();
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: undefined, analytics: 'granted' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['ads'], ['analytics']],
    );
  });
});

describe('a purpose is only written if the requested value differs from the effective status', () => {
  const CASES = [
    {
      scenario: 'a purpose without a decision is written',
      record: undefined,
      expected: [['analytics']],
    },
    {
      scenario: 'an outdated decision is written, even with the same value',
      record: recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) }),
      expected: [['analytics']],
    },
    {
      scenario: 'a current decision with the opposite value is written',
      record: recordOf({ analytics: decisionOf('denied', { version: '2026-10' }) }),
      expected: [['analytics']],
    },
    {
      scenario: 'a current decision with the same value is not written',
      record: ANALYTICS_GRANTED,
      expected: [],
    },
  ] as const;

  for (const { scenario, record, expected } of CASES) {
    it(scenario, () => {
      const { consent, changes } = setup({ record });

      consent.decide({ analytics: 'granted' });

      assert.deepStrictEqual(
        changes.map(({ changed }) => changed),
        expected,
      );
    });
  }
});

describe('clock of the decisions', () => {
  it('is called exactly once per effective call, even with several purposes', () => {
    const { consent, clock } = setup();

    consent.decide({ analytics: 'granted', ads: 'granted', health: 'denied' });

    assert.equal(clock.calls(), 1);
  });

  it('decidedAt is the value returned by the clock', () => {
    const { consent, clock } = setup();
    clock.advance(1_234);

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.ads?.decidedAt, START + 1_234);
  });

  it('subscribe, getSnapshot and getServerSnapshot do not call the clock', () => {
    const { consent, clock } = setup();

    consent.subscribe(() => undefined);
    consent.getSnapshot();
    consent.getServerSnapshot();

    assert.equal(clock.calls(), 0);
  });

  const VALID_INSTANTS = [
    { scenario: 'zero', value: 0 },
    { scenario: 'Number.MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
  ] as const;

  for (const { scenario, value } of VALID_INSTANTS) {
    it(`accepts ${scenario} as an instant`, () => {
      const consent = createConsentManager({ purposes: PURPOSES, now: () => value });

      consent.decide({ ads: 'granted' });

      assert.equal(consent.getSnapshot().record.decisions.ads?.decidedAt, value);
    });
  }

  const INVALID_INSTANTS = [
    { scenario: 'NaN', value: Number.NaN },
    { scenario: '1.5', value: 1.5 },
    { scenario: '-1', value: -1 },
    { scenario: "the string '1'", value: '1' },
    { scenario: 'a Date object', value: new Date(START) },
    { scenario: 'Infinity', value: Number.POSITIVE_INFINITY },
    { scenario: 'an integer above Number.MAX_SAFE_INTEGER', value: 2 ** 53 },
  ] as const;

  for (const { scenario, value } of INVALID_INSTANTS) {
    it(`a clock that returns ${scenario}: TypeError, nothing applied and nothing notified`, () => {
      const consent = createUntyped({ purposes: PURPOSES, now: () => value });
      const changes: ConsentChange[] = [];
      consent.subscribe((change) => {
        changes.push(change);
      });
      const before = consent.getSnapshot();

      assert.throws(() => {
        consent.decide({ ads: 'granted' });
      }, TypeError);

      assert.equal(consent.getSnapshot(), before);
      assert.deepStrictEqual(changes, []);
    });
  }

  it('a clock that throws: the exception propagates intact and nothing is applied', () => {
    const failure = new Error('clock unavailable');
    const consent = createConsentManager({
      purposes: PURPOSES,
      now: () => {
        throw failure;
      },
    });
    const before = consent.getSnapshot();

    assert.throws(
      () => {
        consent.decide({ ads: 'granted' });
      },
      (error) => error === failure,
    );

    assert.equal(consent.getSnapshot(), before);
  });
});

describe('decisions of the same call', () => {
  it('share the same decidedAt, even with a clock that advances on each read', () => {
    let tick = START;
    const consent = createConsentManager({ purposes: PURPOSES, now: () => tick++ });

    consent.decide({ analytics: 'granted', ads: 'granted', health: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '2026-10' }),
      ads: decisionOf('granted'),
      health: decisionOf('denied', { version: '1' }),
    });
  });
});

describe('snapshot and notification of an effective call', () => {
  it('produces exactly one new snapshot and one notification with source decision', () => {
    const { consent, changes } = setup();
    const before = consent.getSnapshot();

    consent.decide({ analytics: 'granted', ads: 'denied' });

    assert.notEqual(consent.getSnapshot(), before);
    assert.deepStrictEqual(
      changes.map(({ source }) => source),
      ['decision'],
    );
  });

  it('changed follows the configuration order, not the order of the choices', () => {
    const { consent, changes } = setup();

    consent.decide({ health: 'denied', ads: 'granted', analytics: 'granted' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['analytics', 'ads', 'health']],
    );
  });

  it('changed lists only the written purposes', () => {
    const { consent, changes } = setup({ record: ANALYTICS_GRANTED });

    consent.decide({ analytics: 'granted', ads: 'denied' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['ads']],
    );
  });
});

describe('decide never compares instants', () => {
  it('a clock that goes back in time: the new decision wins, even with a smaller decidedAt', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    clock.advance(-60_000);

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: decisionOf('denied', { decidedAt: START - 60_000 }),
    });
  });
});
