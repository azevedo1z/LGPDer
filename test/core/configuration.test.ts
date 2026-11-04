import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PurposeConfig } from 'lgpder';

import { createConsentManager } from '../../src/index.ts';
import { decisionOf, serialized } from '../support/records.ts';
import {
  DAY,
  DEFAULT_MAX_AGE,
  PURPOSES,
  START,
  START_OF_DAY,
  createClock,
  createUntyped,
  setup,
  withObjectPollution,
  withPrototype,
} from '../support/setup.ts';

describe('validation order of the options', () => {
  const VALIDATION_ORDER = [
    {
      scenario: 'an unknown option is rejected before an invalid purposes',
      options: { purposes: [], storage: {} },
      message: '[lgpder] Unknown option: "storage".',
    },
    {
      scenario: 'the first unknown option in Object.keys order wins',
      options: { inital: {}, purposes: PURPOSES, storage: {} },
      message: '[lgpder] Unknown option: "inital".',
    },
    {
      scenario: 'purposes without purposes is rejected before an invalid now',
      options: { now: 123, purposes: {} },
      message: '[lgpder] "purposes" must declare at least one purpose.',
    },
    {
      scenario: 'an invalid purpose is rejected before an invalid now',
      options: { now: 'Date.now', purposes: { ads: { individualGrant: 'yes' } } },
      message: '[lgpder] "individualGrant" of purpose "ads" must be a boolean.',
    },
    {
      scenario: 'an invalid now is rejected before an invalid maxAge',
      options: { maxAge: 0, now: 'Date.now', purposes: PURPOSES },
      message: '[lgpder] "now" must be a function; received: string.',
    },
    {
      scenario: 'the purposes are validated in Object.keys order',
      options: { purposes: { ads: null, '*': {} } },
      message:
        '[lgpder] The configuration of purpose "ads" must be a plain object; received: null.',
    },
    {
      scenario: 'the id is validated before the configuration of the same purpose',
      options: { purposes: { '*': null } },
      message: '[lgpder] Invalid purpose id: "*".',
    },
    {
      scenario: 'an unknown key is rejected before an invalid version declared before it',
      options: { purposes: { ads: { version: '', verison: '1' } } },
      message: '[lgpder] Purpose "ads" has the unknown property "verison".',
    },
    {
      scenario: 'version is validated before a category declared before it',
      options: { purposes: { ads: { category: 'mar keting', version: '' } } },
      message: '[lgpder] The version of purpose "ads" must be a non-empty string.',
    },
    {
      scenario: 'category is validated before an individualGrant declared before it',
      options: { purposes: { ads: { individualGrant: 'yes', category: '' } } },
      message: '[lgpder] The category of purpose "ads" must be a valid id.',
    },
  ] as const;

  for (const { scenario, options, message } of VALIDATION_ORDER) {
    it(`with two problems, the first one wins: ${scenario}`, () => {
      assert.throws(() => createUntyped(options), { name: 'TypeError', message });
    });
  }

  it('accepts null-prototype objects as options, purposes and configuration', () => {
    const config = withPrototype({ version: '1' }, null);
    const options = withPrototype({ purposes: withPrototype({ ads: config }, null) }, null);

    const consent = createUntyped(options);

    assert.deepStrictEqual(consent.purposes, { ads: { version: '1' } });
  });
});

describe('record, now and maxAge are read only as own properties', () => {
  const GRANTED_ADS = serialized({ ads: decisionOf('granted') });
  /** Grant dated 400 days before the test clock: expired under the default maxAge. */
  const EXPIRED_ADS = serialized({ ads: decisionOf('granted', { decidedAt: START - 400 * DAY }) });

  it('ignores an inherited record: ads stays pending and the clock is not called', () => {
    const clock = createClock();

    const consent = withObjectPollution({ record: GRANTED_ADS }, () =>
      createConsentManager({ purposes: { ads: {} }, now: clock.now }),
    );

    assert.equal(consent.getSnapshot(), consent.getServerSnapshot());
    assert.equal(clock.calls(), 0);
  });

  it('ignores an inherited maxAge: an expired grant stays pending', () => {
    const consent = withObjectPollution({ maxAge: Number.MAX_SAFE_INTEGER }, () =>
      createConsentManager({ purposes: { ads: {} }, record: EXPIRED_ADS, now: () => START }),
    );

    assert.deepStrictEqual(consent.getSnapshot().status, { ads: 'pending' });
    assert.equal(consent.maxAge, DEFAULT_MAX_AGE);
  });

  it('ignores an inherited now: the polluted clock is never called', () => {
    const polluted = createClock(START - 400 * DAY);
    const consent = withObjectPollution({ now: polluted.now }, () =>
      createConsentManager({ purposes: { ads: {} }, record: EXPIRED_ADS }),
    );

    consent.grantAll();

    assert.equal(polluted.calls(), 0);
  });

  it('ignores an inherited now that is not a function', () => {
    const consent = withObjectPollution({ now: 'Date.now' }, () =>
      createConsentManager({ purposes: { ads: {} } }),
    );

    assert.deepStrictEqual(consent.getSnapshot().status, { ads: 'pending' });
  });

  it('hydrates an own record of null-prototype options', () => {
    const options = withPrototype(
      { purposes: { ads: {} }, record: GRANTED_ADS, now: () => START },
      null,
    );

    const consent = createUntyped(options);

    assert.deepStrictEqual(consent.getSnapshot().status, { ads: 'granted' });
  });
});

describe('unknown keys are the own enumerable string keys', () => {
  const EXTRA = Symbol('extra');
  const SYMBOL_KEYS = [
    { level: 'in the options', options: { purposes: { ads: {} }, [EXTRA]: true } },
    { level: 'in purposes', options: { purposes: { ads: {}, [EXTRA]: {} } } },
    { level: 'in the purpose configuration', options: { purposes: { ads: { [EXTRA]: '1' } } } },
  ] as const;

  for (const { level, options } of SYMBOL_KEYS) {
    it(`ignores a symbol key ${level}`, () => {
      const consent = createUntyped(options);

      assert.deepStrictEqual(consent.purposes, { ads: {} });
    });
  }
});

describe('exceptions thrown while reading the options propagate intact', () => {
  const FAILURE = new Error('hostile read');
  const THROWING_OPTIONS = [
    {
      place: 'options proxy when listing the keys',
      options: new Proxy(
        { purposes: PURPOSES },
        {
          ownKeys: () => {
            throw FAILURE;
          },
        },
      ),
    },
    {
      place: 'purposes getter',
      options: {
        get purposes() {
          throw FAILURE;
        },
      },
    },
    {
      place: 'getter of the configuration of a purpose',
      options: {
        purposes: {
          get ads() {
            throw FAILURE;
          },
        },
      },
    },
    {
      place: 'version getter',
      options: {
        purposes: {
          ads: {
            get version() {
              throw FAILURE;
            },
          },
        },
      },
    },
    {
      place: 'now getter',
      options: {
        purposes: PURPOSES,
        get now() {
          throw FAILURE;
        },
      },
    },
    {
      place: 'record getter, because the options object is written by the developer',
      options: {
        purposes: PURPOSES,
        get record() {
          throw FAILURE;
        },
      },
    },
  ] as const;

  for (const { place, options } of THROWING_OPTIONS) {
    it(`the exception of the ${place} reaches the caller intact`, () => {
      assert.throws(
        () => createUntyped(options),
        (error) => error === FAILURE,
      );
    });
  }
});

describe('an explicit undefined is the same as absent', () => {
  it('record: undefined is the same as a missing record', () => {
    const consent = createConsentManager({ purposes: PURPOSES, record: undefined });

    assert.equal(consent.getSnapshot(), consent.getServerSnapshot());
  });

  it('now: undefined uses the default clock', (t) => {
    t.mock.method(Date, 'now', () => START);
    const consent = createConsentManager({ purposes: PURPOSES, now: undefined });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: decisionOf('granted', { decidedAt: START_OF_DAY }),
    });
  });

  it('maxAge: undefined uses the default of 365 days', () => {
    const consent = createConsentManager({ purposes: PURPOSES, maxAge: undefined });

    assert.equal(consent.maxAge, DEFAULT_MAX_AGE);
  });

  it('version, category and individualGrant with undefined do not enter the copied configuration', () => {
    const consent = createConsentManager({
      purposes: { ads: { version: undefined, category: undefined, individualGrant: undefined } },
    });

    assert.deepStrictEqual(consent.purposes, { ads: {} });
  });

  it('individualGrant: undefined does not exclude the purpose from grantAll', () => {
    const { consent } = setup({ purposes: { ads: { individualGrant: undefined } } });

    consent.grantAll();

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });
});

describe('purpose and category ids', () => {
  const VALID_IDS = [
    { scenario: '"all", without special meaning', id: 'all' },
    { scenario: 'of a single letter', id: 'a' },
    { scenario: 'with an uppercase letter followed by a digit', id: 'Z9' },
    { scenario: 'with underscore, dot and hyphen after the first letter', id: 'a_b.c-d' },
    { scenario: 'long, because there is no length limit', id: 'x'.repeat(10_000) },
  ] as const;

  for (const { scenario, id } of VALID_IDS) {
    it(`accepts an id ${scenario}`, () => {
      const consent = createConsentManager({ purposes: { [id]: {} } });

      assert.deepStrictEqual(Object.keys(consent.purposes), [id]);
    });
  }

  it('the purpose "all" is an ordinary one: granting it does not reach the others', () => {
    const { consent } = setup({ purposes: { all: {}, ads: {} } });

    consent.decide({ all: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().status, { all: 'granted', ads: 'pending' });
  });

  it('accepts a category with a typo, because it is a valid id', () => {
    const consent = createConsentManager({ purposes: { ads: { category: 'marketng' } } });

    assert.equal(consent.purposes.ads.category, 'marketng');
  });

  it('a dynamic configuration typed as Record<string, PurposeConfig> is validated at run time', () => {
    const fromServer: Record<string, PurposeConfig> = { 'a b': {} };

    assert.throws(() => createConsentManager({ purposes: fromServer }), TypeError);
  });
});

describe('copy of the configuration', () => {
  it('each copied configuration has only the properties given with a defined value', () => {
    const consent = createConsentManager({
      purposes: {
        health: { version: '1', individualGrant: true },
        ads: { version: undefined, category: 'marketing', individualGrant: false },
      },
    });

    assert.deepStrictEqual(consent.purposes, {
      health: { version: '1', individualGrant: true },
      ads: { category: 'marketing', individualGrant: false },
    });
  });

  it('the copy follows the purpose order and the order version, category, individualGrant', () => {
    const consent = createConsentManager({
      purposes: {
        health: { individualGrant: true, category: 'health', version: '1' },
        ads: { category: 'marketing', version: '2' },
      },
    });

    assert.equal(
      JSON.stringify(consent.purposes),
      '{"health":{"version":"1","category":"health","individualGrant":true},' +
        '"ads":{"version":"2","category":"marketing"}}',
    );
  });

  it('each copied configuration is a new object, and not the received configuration', () => {
    const health = { version: '1', individualGrant: true };

    const consent = createConsentManager({ purposes: { health } });

    assert.notEqual(consent.purposes.health, health);
  });

  it('the received options, purposes and configurations are not frozen', () => {
    const ads = { category: 'marketing' };
    const purposes = { ads };
    const options = { purposes };

    createConsentManager(options);

    assert.deepStrictEqual(
      [Object.isFrozen(options), Object.isFrozen(purposes), Object.isFrozen(ads)],
      [false, false, false],
    );
  });

  it('the received configuration is not changed, not even in the keys with undefined', () => {
    const ads = { version: undefined, individualGrant: false };

    createConsentManager({ purposes: { ads } });

    assert.deepStrictEqual(ads, { version: undefined, individualGrant: false });
  });

  it('changing the original configuration after creation does not change the behavior', () => {
    const ads = { individualGrant: false };
    const purposes: Record<string, PurposeConfig> = { ads };
    const consent = createConsentManager({ purposes });

    ads.individualGrant = true;
    purposes['health'] = {};
    consent.grantAll();

    assert.deepStrictEqual(consent.getSnapshot().status, { ads: 'granted' });
  });
});

describe('clock fixed at creation', () => {
  it('calls now without this', () => {
    const receivers: unknown[] = [];
    const consent = createConsentManager({
      purposes: PURPOSES,
      now: function (this: unknown) {
        receivers.push(this);
        return START;
      },
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(receivers, [undefined]);
  });

  const DEFAULT_CLOCK_INSTANTS = [
    { scenario: 'midday', instant: START, expected: START_OF_DAY },
    { scenario: 'the first millisecond of the day', instant: START_OF_DAY, expected: START_OF_DAY },
    {
      scenario: 'the last millisecond of the day',
      instant: START_OF_DAY + DAY - 1,
      expected: START_OF_DAY,
    },
    { scenario: 'the epoch', instant: 0, expected: 0 },
  ] as const;

  for (const { scenario, instant, expected } of DEFAULT_CLOCK_INSTANTS) {
    it(`without now, decidedAt is the start of the UTC day of Date.now: ${scenario}`, (t) => {
      t.mock.method(Date, 'now', () => instant);
      const consent = createConsentManager({ purposes: PURPOSES });

      consent.decide({ ads: 'granted' });

      assert.equal(consent.getSnapshot().record.decisions.ads?.decidedAt, expected);
    });
  }

  it('without now, Date.now replaced after creation does not change the clock of the instance', (t) => {
    const consent = createConsentManager({ purposes: PURPOSES });
    const replacement = t.mock.method(Date, 'now', () => START);

    consent.decide({ ads: 'granted' });

    assert.equal(replacement.mock.callCount(), 0);
  });

  it('a precise clock given in now is used as is, without rounding', () => {
    const consent = createConsentManager({ purposes: PURPOSES, now: () => START + 1 });

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.ads?.decidedAt, START + 1);
  });
});

describe('creation', () => {
  it('calls the clock once to evaluate the expiry of a hydrated record', () => {
    const { clock } = setup({ record: serialized({ ads: decisionOf('granted') }) });

    assert.equal(clock.calls(), 1);
  });

  const NOTHING_TO_EVALUATE = [
    { scenario: 'without a record', record: undefined },
    { scenario: 'with an invalid record', record: '{"format":1,' },
    { scenario: 'with a record without decisions', record: serialized({}) },
  ] as const;

  for (const { scenario, record } of NOTHING_TO_EVALUATE) {
    it(`does not call the clock ${scenario}`, () => {
      const { clock } = setup({ record });

      assert.equal(clock.calls(), 0);
    });
  }

  it('does not schedule microtasks', (t) => {
    const schedule = t.mock.method(globalThis, 'queueMicrotask');

    createConsentManager({
      purposes: PURPOSES,
      record: serialized({ ads: decisionOf('granted') }),
      now: () => START,
    });

    assert.equal(schedule.mock.callCount(), 0);
  });
});

describe('properties of the manager', () => {
  it('has exactly the public properties, in this order', () => {
    const { consent } = setup();

    assert.deepStrictEqual(Reflect.ownKeys(consent), [
      'purposes',
      'maxAge',
      'getSnapshot',
      'getServerSnapshot',
      'decide',
      'grantAll',
      'denyAll',
      'restore',
      'subscribe',
    ]);
  });

  it('every function works destructured, without this', () => {
    const { consent } = setup();
    const { getSnapshot, getServerSnapshot, decide, grantAll, denyAll, restore, subscribe } =
      consent;
    const sources: string[] = [];

    const unsubscribe = subscribe(({ source }) => {
      sources.push(source);
    });
    grantAll();
    decide({ ads: 'denied' });
    denyAll();
    restore(getServerSnapshot().record);
    unsubscribe();
    decide({ ads: 'granted' });

    assert.deepStrictEqual(sources, ['decision', 'decision', 'decision', 'restore']);
    assert.equal(getSnapshot().status.ads, 'granted');
  });
});
