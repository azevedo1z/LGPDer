import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentRecord } from 'lgpder';

import { decisionOf, recordOf, serialized } from '../support/records.ts';
import { START, setup, withObjectPollution, type PurposeId } from '../support/setup.ts';

const ANALYTICS_GRANTED = decisionOf('granted', { version: '2026-10' });

describe('restore replaces every decision with the valid content, without merging', () => {
  it('the decisions missing from the adopted record are removed', () => {
    const { consent } = setup();
    consent.decide({ analytics: 'granted', ads: 'denied' });

    consent.restore(recordOf({ health: decisionOf('denied', { version: '1' }) }));

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      health: decisionOf('denied', { version: '1' }),
    });
  });
});

describe('entry-by-entry comparison and notification', () => {
  it('one notification with source restore, with added, removed and changed entries in order', () => {
    const { consent, changes } = setup({
      record: recordOf({ analytics: ANALYTICS_GRANTED, ads: decisionOf('granted') }),
    });

    consent.restore(
      recordOf({ health: decisionOf('granted', { version: '1' }), ads: decisionOf('denied') }),
    );

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['restore', ['analytics', 'ads', 'health']]],
    );
  });

  const SINGLE_FIELD_CHANGES = [
    { difference: 'in the status', next: decisionOf('denied', { version: '2026-10' }) },
    { difference: 'in the version', next: decisionOf('granted', { version: '2025-01' }) },
    {
      difference: 'in decidedAt',
      next: decisionOf('granted', { version: '2026-10', decidedAt: START - 1 }),
    },
    { difference: 'in the presence of version', next: decisionOf('granted') },
  ] as const;

  for (const { difference, next } of SINGLE_FIELD_CHANGES) {
    it(`an entry that differs only ${difference} is changed and notified`, () => {
      const { consent, changes } = setup({ record: recordOf({ analytics: ANALYTICS_GRANTED }) });

      consent.restore(recordOf({ analytics: next }));

      assert.deepStrictEqual(
        changes.map(({ changed }) => changed),
        [['analytics']],
      );
    });
  }

  it('a version inherited from a polluted Object.prototype does not make a decision without version equal to one with version', () => {
    const { consent, changes } = setup({ record: recordOf({ ads: decisionOf('granted') }) });

    withObjectPollution({ version: '1' }, () => {
      consent.restore(recordOf({ ads: decisionOf('granted', { version: '1' }) }));
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: decisionOf('granted', { version: '1' }),
    });
    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['restore', ['ads']]],
    );
  });

  it('a change only of decidedAt notifies restore with the purpose in changed and keeps status', () => {
    const { consent, changes } = setup({ record: recordOf({ analytics: ANALYTICS_GRANTED }) });
    const before = consent.getSnapshot();

    consent.restore(
      recordOf({ analytics: decisionOf('granted', { version: '2026-10', decidedAt: START - 1 }) }),
    );

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['restore', ['analytics']]],
    );
    assert.equal(consent.getSnapshot().status, before.status);
  });
});

describe('restore without any different entry is a no-op', () => {
  interface RoundTrip {
    readonly form: string;
    readonly toInput: (record: ConsentRecord<PurposeId>) => unknown;
  }

  const ROUND_TRIPS = [
    { form: 'an object', toInput: (record) => record },
    { form: 'JSON text', toInput: (record) => JSON.stringify(record) },
    {
      form: 'an object from JSON.parse',
      toInput: (record): unknown => JSON.parse(JSON.stringify(record)),
    },
  ] as const satisfies readonly RoundTrip[];

  for (const { form, toInput } of ROUND_TRIPS) {
    it(`restore of its own record as ${form}: same snapshot and no notification`, () => {
      const { consent, changes } = setup({
        record: recordOf({ analytics: ANALYTICS_GRANTED, ads: decisionOf('denied') }),
      });
      const before = consent.getSnapshot();

      consent.restore(toInput(before.record));

      assert.equal(consent.getSnapshot(), before);
      assert.deepStrictEqual(changes, []);
    });
  }

  it('restore(null) without decisions: same snapshot and no notification', () => {
    const { consent, changes } = setup();
    const before = consent.getSnapshot();

    consent.restore(null);

    assert.equal(consent.getSnapshot(), before);
    assert.deepStrictEqual(changes, []);
  });
});

describe('equal entries keep the reference of the current decision', () => {
  it('a decision equal by value, coming from JSON text, keeps the current object', () => {
    const { consent } = setup({
      record: recordOf({ analytics: ANALYTICS_GRANTED, ads: decisionOf('granted') }),
    });
    const kept = consent.getSnapshot().record.decisions.analytics;

    consent.restore(serialized({ analytics: ANALYTICS_GRANTED, ads: decisionOf('denied') }));

    assert.equal(consent.getSnapshot().record.decisions.analytics, kept);
  });
});

describe('restore adopts an external record and is not a revocation', () => {
  it('restore(null) with decisions leaves every purpose pending, not denied, and notifies restore', () => {
    const { consent, changes } = setup();
    consent.grantAll();

    consent.restore(null);

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'pending',
      ads: 'pending',
      health: 'pending',
    });
    assert.deepStrictEqual(
      changes.map(({ source }) => source),
      ['decision', 'restore'],
    );
  });

  it('restore of an old record replaces a more recent local revocation', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    const backendRecord = JSON.stringify(consent.getSnapshot().record);
    clock.advance(60_000);
    consent.decide({ ads: 'denied' });

    consent.restore(backendRecord);

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });
});
