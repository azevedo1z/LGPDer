import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentManager } from 'lgpder';

import { createConsentManager } from '../../src/index.ts';
import { decisionOf, recordOf } from '../support/records.ts';
import {
  DAY,
  DEFAULT_MAX_AGE,
  PURPOSES,
  START,
  START_OF_DAY,
  createClock,
  createUntyped,
  setup,
} from '../support/setup.ts';

/** `maxAge` of the scenarios below: 30 days. */
const MAX_AGE = 30 * DAY;

/** Record with `ads` decided `age` milliseconds before {@link START}, the instant of the clock. */
function adsDecidedAgo(age: number, status: 'granted' | 'denied' = 'granted') {
  return recordOf({ ads: decisionOf(status, { decidedAt: START - age }) });
}

describe('maxAge of the manager', () => {
  it('defaults to 365 days', () => {
    const { consent } = setup();

    assert.equal(consent.maxAge, DEFAULT_MAX_AGE);
  });

  it('exposes the value given in the options', () => {
    const { consent } = setup({ maxAge: MAX_AGE });

    assert.equal(consent.maxAge, MAX_AGE);
  });
});

describe('a decision is current while 0 <= now - decidedAt < maxAge', () => {
  const AGES = [
    { scenario: 'decided at the instant of the clock', age: 0, status: 'granted' },
    { scenario: 'one millisecond before maxAge', age: MAX_AGE - 1, status: 'granted' },
    { scenario: 'exactly maxAge old', age: MAX_AGE, status: 'pending' },
    { scenario: 'older than maxAge', age: MAX_AGE + DAY, status: 'pending' },
    { scenario: 'dated one millisecond after the clock', age: -1, status: 'pending' },
    { scenario: 'dated years after the clock', age: -10 * DEFAULT_MAX_AGE, status: 'pending' },
  ] as const;

  for (const { scenario, age, status } of AGES) {
    it(`hydration of a grant ${scenario}: '${status}'`, () => {
      const { consent } = setup({ record: adsDecidedAgo(age), maxAge: MAX_AGE });

      assert.equal(consent.getSnapshot().status.ads, status);
    });

    it(`restore of a grant ${scenario}: '${status}'`, () => {
      const { consent } = setup({ maxAge: MAX_AGE });

      consent.restore(adsDecidedAgo(age));

      assert.equal(consent.getSnapshot().status.ads, status);
    });
  }

  it('the default maxAge keeps a decision one millisecond younger than 365 days', () => {
    const { consent } = setup({ record: adsDecidedAgo(DEFAULT_MAX_AGE - 1) });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('the default maxAge discards a decision of exactly 365 days', () => {
    const { consent } = setup({ record: adsDecidedAgo(DEFAULT_MAX_AGE) });

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });
});

describe('an expired decision is discarded as if it did not exist', () => {
  it('expired refusals are discarded too: the purpose goes back to pending', () => {
    const { consent } = setup({ record: adsDecidedAgo(MAX_AGE, 'denied'), maxAge: MAX_AGE });

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('the expired decision is absent from snapshot.record, and the current one stays', () => {
    const current = decisionOf('granted', { version: '2026-10' });
    const { consent } = setup({
      record: recordOf({ analytics: current, ads: decisionOf('granted', { decidedAt: 0 }) }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { analytics: current });
  });

  it('an expired outdated decision is discarded and is no longer flagged in outdated', () => {
    const { consent } = setup({
      record: recordOf({ analytics: decisionOf('granted', { version: '2025-01', decidedAt: 0 }) }),
    });

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', false]);
  });

  it('with every decision expired, the initial snapshot is the server snapshot', () => {
    const { consent } = setup({ record: adsDecidedAgo(MAX_AGE), maxAge: MAX_AGE });

    assert.equal(consent.getSnapshot(), consent.getServerSnapshot());
  });
});

describe('restore evaluates the expiry of the record it adopts', () => {
  /** Hydrates a current grant of `ads` and lets `elapsed` milliseconds pass on the clock. */
  function hydratedThenElapsed(elapsed: number) {
    const tab = setup({ record: adsDecidedAgo(0), maxAge: MAX_AGE });
    tab.clock.advance(elapsed);
    return tab;
  }

  it('restoring the current record after maxAge discards the expired decision', () => {
    const { consent } = hydratedThenElapsed(MAX_AGE);

    consent.restore(consent.getSnapshot().record);

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('the discard is notified with source restore and the purpose in changed', () => {
    const { consent, changes } = hydratedThenElapsed(MAX_AGE);

    consent.restore(consent.getSnapshot().record);

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['restore', ['ads']]],
    );
  });

  it('restoring a record of only expired decisions over no decision does not notify', () => {
    const { consent, changes } = setup({ maxAge: MAX_AGE });
    const before = consent.getSnapshot();

    consent.restore(adsDecidedAgo(MAX_AGE));

    assert.equal(consent.getSnapshot(), before);
    assert.deepStrictEqual(changes, []);
  });

  it('restoring the current record before maxAge changes nothing and does not notify', () => {
    const { consent, changes } = hydratedThenElapsed(MAX_AGE - 1);
    const before = consent.getSnapshot();

    consent.restore(before.record);

    assert.equal(consent.getSnapshot(), before);
    assert.deepStrictEqual(changes, []);
  });

  it('calls the clock once per restore of a record with decisions', () => {
    const { consent, clock } = setup();

    consent.restore(recordOf({ analytics: decisionOf('granted'), ads: decisionOf('denied') }));

    assert.equal(clock.calls(), 1);
  });

  it('does not call the clock to restore a record without valid decisions', () => {
    const { consent, clock } = setup();

    consent.restore(recordOf({ ads: { status: 'granted' } }));

    assert.equal(clock.calls(), 0);
  });
});

describe('expiry is not evaluated continuously', () => {
  /** Hydrates a current grant of `ads` and lets the whole `maxAge` pass on the clock. */
  function expiredInMemory() {
    const tab = setup({ record: adsDecidedAgo(0), maxAge: MAX_AGE });
    tab.clock.advance(MAX_AGE);
    return tab;
  }

  it('getSnapshot keeps returning the same snapshot after maxAge passes', () => {
    const { consent, clock } = setup({ record: adsDecidedAgo(0), maxAge: MAX_AGE });
    const before = consent.getSnapshot();

    clock.advance(MAX_AGE);

    assert.equal(consent.getSnapshot(), before);
  });

  it('a decision about another purpose keeps the expired decision in memory', () => {
    const { consent } = expiredInMemory();

    consent.decide({ analytics: 'denied' });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('a decision about the expired purpose is recorded with the new instant', () => {
    const { consent } = expiredInMemory();

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(
      consent.getSnapshot().record.decisions.ads,
      decisionOf('denied', { decidedAt: START + MAX_AGE }),
    );
  });
});

describe('a clock that fails during the evaluation discards every decision, without throwing', () => {
  const INVALID_CLOCKS = [
    { scenario: 'returns NaN', now: () => Number.NaN },
    { scenario: 'returns -1', now: () => -1 },
    { scenario: 'returns 1.5', now: () => 1.5 },
    { scenario: "returns the text '1'", now: () => '1' },
    {
      scenario: 'throws',
      now: () => {
        throw new Error('clock unavailable');
      },
    },
  ] as const;

  /** Record with a current decision for every purpose of the fixture. */
  const CURRENT_RECORD = recordOf({
    analytics: decisionOf('granted', { version: '2026-10' }),
    ads: decisionOf('granted'),
    health: decisionOf('denied', { version: '1' }),
  });

  /** Creates the fixture with an invalid clock, from untyped JavaScript. */
  function createWithClock(now: () => unknown, record?: unknown): ConsentManager {
    return createUntyped({ purposes: PURPOSES, record, now });
  }

  for (const { scenario, now } of INVALID_CLOCKS) {
    it(`hydration with a clock that ${scenario}: server snapshot`, () => {
      const consent = createWithClock(now, CURRENT_RECORD);

      assert.equal(consent.getSnapshot(), consent.getServerSnapshot());
    });

    it(`restore with a clock that ${scenario}: empty record, without throwing`, () => {
      const consent = createWithClock(now);

      consent.restore(CURRENT_RECORD);

      assert.deepStrictEqual(consent.getSnapshot().record.decisions, {});
    });
  }

  it('a clock that recovers makes the next restore adopt the record', () => {
    let instant: unknown = Number.NaN;
    const consent = createUntyped({ purposes: PURPOSES, now: () => instant });
    consent.restore(CURRENT_RECORD);
    instant = START;

    consent.restore(CURRENT_RECORD);

    assert.deepStrictEqual(consent.getSnapshot().record, CURRENT_RECORD);
  });
});

describe('expiry with the default clock', () => {
  it('evaluates the age from the start of the current UTC day', (t) => {
    // Precise age of two and a half days; rounded age of two days, within maxAge.
    t.mock.method(Date, 'now', () => START_OF_DAY + 2 * DAY + DAY / 2);
    const consent = createConsentManager({
      purposes: PURPOSES,
      record: recordOf({ ads: decisionOf('granted', { decidedAt: START_OF_DAY }) }),
      maxAge: 2 * DAY + 1,
    });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('a decision recorded today with a precise clock is dated after the rounded clock', (t) => {
    t.mock.method(Date, 'now', () => START);
    const precise = createConsentManager({ purposes: PURPOSES, now: createClock().now });
    precise.decide({ ads: 'granted' });

    const rounded = createConsentManager({
      purposes: PURPOSES,
      record: precise.getSnapshot().record,
    });

    assert.equal(rounded.getSnapshot().status.ads, 'pending');
  });
});
