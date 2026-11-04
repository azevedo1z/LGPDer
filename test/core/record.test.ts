import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import type { ConsentManager } from 'lgpder';

import { createConsentManager } from '../../src/index.ts';
import { decisionOf, recordOf, serialized } from '../support/records.ts';
import {
  PURPOSES,
  START,
  createClock,
  setup,
  withArrayPollution,
  withObjectPollution,
  withPrototype,
  type PurposeId,
} from '../support/setup.ts';

const EMPTY_RECORD = { format: 1, decisions: {} };

/** Valid decisions that a record invalid at the root cannot make effective. */
const VALID_DECISIONS = { ads: decisionOf('granted') };

const VALID_ANALYTICS = decisionOf('granted', { version: '2026-10' });

/**
 * Exact text of the record with `analytics` granted and `ads` denied: decisions in configuration
 * order and fields in the order `status`, `version`, `decidedAt`.
 */
const SERIALIZED_RECORD =
  '{"format":1,"decisions":{' +
  '"analytics":{"status":"granted","version":"2026-10","decidedAt":1793448000000},' +
  '"ads":{"status":"denied","decidedAt":1793448000000}}}';

describe('a record invalid at the root is an empty record', () => {
  const INVALID_ROOTS = [
    { scenario: 'null', record: null },
    { scenario: 'undefined', record: undefined },
    { scenario: 'text with invalid JSON', record: '{"format":1,' },
    { scenario: "empty text ''", record: '' },
    { scenario: "the text 'null'", record: 'null' },
    { scenario: "the text '[]'", record: '[]' },
    { scenario: 'the number 42', record: 42 },
    { scenario: 'the boolean true', record: true },
    { scenario: 'an array', record: [VALID_DECISIONS] },
    {
      scenario: 'an object with another prototype',
      record: withPrototype({ format: 1, decisions: VALID_DECISIONS }, {}),
    },
    { scenario: 'format equal to 2', record: { format: 2, decisions: VALID_DECISIONS } },
    {
      scenario: 'format equal to the text "1"',
      record: { format: '1', decisions: VALID_DECISIONS },
    },
    { scenario: 'missing format', record: { decisions: VALID_DECISIONS } },
    { scenario: 'missing decisions', record: { format: 1 } },
    { scenario: 'null decisions', record: { format: 1, decisions: null } },
    {
      scenario: 'decisions in an array',
      record: { format: 1, decisions: [decisionOf('granted')] },
    },
    {
      scenario: 'decisions with another prototype',
      record: { format: 1, decisions: withPrototype({ ads: decisionOf('granted') }, {}) },
    },
  ] as const;

  for (const { scenario, record } of INVALID_ROOTS) {
    it(`hydration with ${scenario}: empty record, without throwing`, () => {
      const { consent } = setup({ record });

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });

    it(`restore with ${scenario}, from a state with decisions: empty record, without throwing`, () => {
      const { consent } = setup();
      consent.grantAll();

      consent.restore(record);

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });
  }
});

describe('an invalid entry is discarded alone', () => {
  const INVALID_ENTRIES = [
    { scenario: "status 'GRANTED'", entry: { status: 'GRANTED', decidedAt: START } },
    { scenario: 'status true', entry: { status: true, decidedAt: START } },
    { scenario: 'missing status', entry: { decidedAt: START } },
    { scenario: "status 'pending'", entry: { status: 'pending', decidedAt: START } },
    {
      scenario: "decidedAt in the text '1793448000000'",
      entry: { status: 'granted', decidedAt: '1793448000000' },
    },
    { scenario: 'decidedAt -1', entry: { status: 'granted', decidedAt: -1 } },
    { scenario: 'decidedAt 1.5', entry: { status: 'granted', decidedAt: 1.5 } },
    { scenario: 'decidedAt null', entry: { status: 'granted', decidedAt: null } },
    { scenario: 'missing decidedAt', entry: { status: 'granted' } },
    {
      scenario: 'decidedAt above Number.MAX_SAFE_INTEGER',
      entry: { status: 'granted', decidedAt: 2 ** 53 },
    },
    { scenario: "version ''", entry: { status: 'granted', version: '', decidedAt: START } },
    { scenario: 'version 2', entry: { status: 'granted', version: 2, decidedAt: START } },
    {
      scenario: 'version null',
      entry: { status: 'granted', version: null, decidedAt: START },
    },
    { scenario: 'null entry', entry: null },
    { scenario: 'entry in an array', entry: [] },
    { scenario: "entry in the text 'granted'", entry: 'granted' },
    {
      scenario: 'entry with another prototype',
      entry: withPrototype({ status: 'granted', decidedAt: START }, {}),
    },
  ] as const;

  for (const { scenario, entry } of INVALID_ENTRIES) {
    it(`ads entry with ${scenario}: only ads has no decision`, () => {
      const { consent } = setup({ record: recordOf({ analytics: VALID_ANALYTICS, ads: entry }) });

      assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
        analytics: VALID_ANALYTICS,
      });
    });
  }

  it('version with undefined in the read object is the same as a missing version', () => {
    const { consent } = setup({
      record: recordOf({ ads: { status: 'granted', version: undefined, decidedAt: START } }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('record, decisions and entries with a null prototype are plain objects and are accepted', () => {
    const entry = withPrototype({ status: 'granted', decidedAt: START }, null);
    const record = withPrototype(
      { format: 1, decisions: withPrototype({ ads: entry }, null) },
      null,
    );

    const { consent } = setup({ record });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });
});

describe('the record as untrusted data', () => {
  it('extra fields in the entry are ignored and not copied', () => {
    const { consent } = setup({
      record: recordOf({ ads: { status: 'granted', decidedAt: START, userId: 'u-1' } }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('extra fields at the root are ignored and not copied', () => {
    const { consent } = setup({
      record: { format: 1, decisions: VALID_DECISIONS, userId: 'u-1' },
    });

    assert.deepStrictEqual(consent.getSnapshot().record, recordOf(VALID_DECISIONS));
  });

  it('unknown ids in decisions are ignored', () => {
    const { consent } = setup({
      record: recordOf({ typo: decisionOf('granted'), ads: decisionOf('granted') }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('a __proto__ key in JSON text is ignored and no prototype is changed', () => {
    const record =
      '{"format":1,"decisions":{' +
      `"__proto__":{"status":"granted","decidedAt":${String(START)}},` +
      `"ads":{"status":"denied","decidedAt":${String(START)}}}}`;

    const { decisions } = setup({ record }).consent.getSnapshot().record;

    assert.deepStrictEqual(decisions, { ads: decisionOf('denied') });
    assert.equal(Object.getPrototypeOf(decisions), Object.prototype);
  });

  /** Hydrates the fixture with properties inherited from `Object.prototype` and undoes the pollution. */
  function hydrateUnderPollution(
    pollution: Readonly<Record<string, unknown>>,
    record: unknown,
  ): ConsentManager<PurposeId> {
    const { now } = createClock();
    return withObjectPollution(pollution, () =>
      createConsentManager({ purposes: PURPOSES, record, now }),
    );
  }

  // One inherited field at a time, with the others own and valid: the read of each field is
  // checked alone, without another missing field keeping the entry or the root invalid.
  const POLLUTIONS = [
    {
      scenario: 'an inherited format does not complete the root',
      pollution: { format: 1 },
      record: { decisions: VALID_DECISIONS },
    },
    {
      scenario: 'an inherited decisions does not complete the root',
      pollution: { decisions: VALID_DECISIONS },
      record: { format: 1 },
    },
    {
      scenario: 'an inherited entry does not complete decisions',
      pollution: { ads: decisionOf('granted') },
      record: recordOf({}),
    },
    {
      scenario: 'an inherited status does not complete the entry',
      pollution: { status: 'granted' },
      record: recordOf({ ads: { decidedAt: START } }),
    },
    {
      scenario: 'an inherited decidedAt does not complete the entry',
      pollution: { decidedAt: START },
      record: recordOf({ ads: { status: 'granted' } }),
    },
    {
      scenario: 'inherited status and decidedAt do not complete entries',
      pollution: { status: 'granted', decidedAt: START },
      record: recordOf({ ads: {}, analytics: { status: 'granted', version: '2026-10' } }),
    },
    {
      scenario: 'inherited format and decisions do not complete the root',
      pollution: { format: 1, decisions: VALID_DECISIONS },
      record: {},
    },
  ] as const;

  for (const { scenario, pollution, record } of POLLUTIONS) {
    it(`polluted Object.prototype: ${scenario}`, () => {
      const consent = hydrateUnderPollution(pollution, record);

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });
  }

  it('Object.prototype polluted with version: a decision saved without version stays outdated', () => {
    const consent = hydrateUnderPollution(
      { version: '2026-10' },
      recordOf({ analytics: decisionOf('granted') }),
    );

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', true]);
  });

  it('Array.prototype polluted with a decision: restore of invalid content is an empty record', () => {
    const { consent } = setup();

    withArrayPollution(decisionOf('granted'), () => {
      consent.restore(null);
    });

    assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
  });

  const FOREIGN_SOURCE = `({ format: 1, decisions: { ads: { status: 'granted', decidedAt: ${String(START)} } } })`;

  it('an object created in another realm is not a plain object: empty record', () => {
    const foreign: unknown = runInNewContext(FOREIGN_SOURCE);

    const { consent } = setup({ record: foreign });

    assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
  });

  it('the same content from another realm, as JSON text, is accepted', () => {
    const foreign: unknown = runInNewContext(FOREIGN_SOURCE);

    const { consent } = setup({ record: JSON.stringify(foreign) });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('a record with a valid structure edited by the data subject is accepted', () => {
    const edited = serialized({ ads: decisionOf('denied') }).replace('"denied"', '"granted"');

    const { consent } = setup({ record: edited });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('a decidedAt after the clock is discarded, because its age cannot be established', () => {
    const future = START + 10 * 365 * 24 * 60 * 60 * 1_000;

    const { consent } = setup({
      record: recordOf({ ads: decisionOf('granted', { decidedAt: future }) }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
  });
});

describe('a throwing getter or a hostile proxy results in an empty record, without error', () => {
  const HOSTILE = new Error('hostile record');

  /** Proxy that throws on any inspection. */
  function hostileProxy(): object {
    const fail = (): never => {
      throw HOSTILE;
    };
    return new Proxy(
      {},
      { getPrototypeOf: fail, get: fail, has: fail, ownKeys: fail, getOwnPropertyDescriptor: fail },
    );
  }

  const HOSTILE_RECORDS = [
    { scenario: 'a proxy that throws on any inspection', record: hostileProxy() },
    {
      scenario: 'a format getter that throws',
      record: {
        get format() {
          throw HOSTILE;
        },
        decisions: VALID_DECISIONS,
      },
    },
    {
      scenario: 'a decisions getter that throws',
      record: {
        format: 1,
        get decisions() {
          throw HOSTILE;
        },
      },
    },
    { scenario: 'decisions in a hostile proxy', record: { format: 1, decisions: hostileProxy() } },
    {
      scenario: 'a getter of an entry that throws, even with another valid entry',
      record: {
        format: 1,
        decisions: {
          analytics: VALID_ANALYTICS,
          get ads() {
            throw HOSTILE;
          },
        },
      },
    },
    {
      scenario: 'a status getter that throws, even with another valid entry',
      record: {
        format: 1,
        decisions: {
          analytics: VALID_ANALYTICS,
          ads: {
            get status() {
              throw HOSTILE;
            },
            decidedAt: START,
          },
        },
      },
    },
  ] as const;

  for (const { scenario, record } of HOSTILE_RECORDS) {
    it(`hydration with ${scenario}: empty record, without throwing`, () => {
      const { consent } = setup({ record });

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });

    it(`restore with ${scenario}: empty record, without throwing`, () => {
      const { consent } = setup({ record: recordOf(VALID_DECISIONS) });

      consent.restore(record);

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });
  }
});

describe('the initial snapshot is the server one when hydration produces no current decision', () => {
  const NO_VALID_DECISION = [
    { scenario: 'without a record', record: undefined },
    { scenario: 'an invalid record', record: '{"format":1,' },
    {
      scenario: 'a record with only unknown ids',
      record: recordOf({ typo: decisionOf('granted') }),
    },
    {
      scenario: 'a record with only invalid entries',
      record: recordOf({ ads: { status: 'granted' } }),
    },
  ] as const;

  for (const { scenario, record } of NO_VALID_DECISION) {
    it(`${scenario}: getSnapshot returns the very object of getServerSnapshot`, () => {
      const { consent } = setup({ record });

      assert.equal(consent.getSnapshot(), consent.getServerSnapshot());
    });
  }
});

describe('round trip and deterministic serialization', () => {
  it('the instant -0 of the clock is written as 0, and the JSON round trip is exact', () => {
    const now = (): number => -0;
    const consent = createConsentManager({ purposes: { ads: {} }, now });
    consent.decide({ ads: 'granted' });
    const { record } = consent.getSnapshot();

    const copy = createConsentManager({
      purposes: { ads: {} },
      record: JSON.stringify(record),
      now,
    });

    assert.deepStrictEqual(copy.getSnapshot().record, record);
  });

  it('JSON.stringify of the record produces the exact text, with the decisions in configuration order', () => {
    const { consent } = setup();

    consent.decide({ ads: 'denied', analytics: 'granted' });

    assert.equal(JSON.stringify(consent.getSnapshot().record), SERIALIZED_RECORD);
  });

  it('a record hydrated with keys in another order is serialized in the canonical order', () => {
    const { consent } = setup({
      record: {
        decisions: {
          ads: { decidedAt: START, status: 'denied' },
          analytics: { decidedAt: START, version: '2026-10', status: 'granted' },
        },
        format: 1,
      },
    });

    assert.equal(JSON.stringify(consent.getSnapshot().record), SERIALIZED_RECORD);
  });

  it('another instance with the same configuration and the record as JSON has an equal snapshot', () => {
    const { consent } = setup();
    consent.decide({ analytics: 'granted', health: 'denied' });
    const snapshot = consent.getSnapshot();

    const copy = setup({ record: JSON.stringify(snapshot.record) }).consent;

    assert.deepStrictEqual(copy.getSnapshot(), snapshot);
  });
});
