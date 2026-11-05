/** Validation of the options: unknown keys, invalid values, order, own properties only. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ConsentGoogle } from 'lgpder/google';

import { connectGoogle } from '../../src/google/index.ts';
import { captureWarnings } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import {
  closeGoogles,
  connectGoogleTo,
  consentWith,
  dataLayer,
  lastUpdate,
  type GooglePage,
} from '../support/google.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, setup, withObjectPollution, withPrototype } from '../support/setup.ts';

afterEach(() => {
  closeGoogles();
  testDom.reset();
});

/** `connectGoogle` called from JavaScript, with any value (or none) as options, then destroyed. */
function connectUntyped(...options: unknown[]): void {
  const { consent } = setup();
  callUntyped<ConsentGoogle>(connectGoogle, consent, ...options).destroy();
}

interface InvalidOptions {
  readonly case: string;
  readonly options: unknown;
  readonly name: 'TypeError' | 'RangeError';
  readonly message: string;
}

const OPTIONS_OBJECT = '[lgpder] Options must be an object.';
const PURPOSES_OBJECT = '[lgpder] "purposes" must be an object.';

const AD_TYPES = ['ad_storage', 'ad_user_data', 'ad_personalization'] as const;

/** `items` followed by a hole, as `[...items, ,]` would write it. */
function withHole(...items: string[]): string[] {
  const list = [...items];
  list.length += 1;
  return list;
}

const INVALID_OPTIONS: readonly InvalidOptions[] = [
  { case: 'no options', options: undefined, name: 'TypeError', message: OPTIONS_OBJECT },
  { case: 'null options', options: null, name: 'TypeError', message: OPTIONS_OBJECT },
  { case: 'string options', options: 'ads', name: 'TypeError', message: OPTIONS_OBJECT },
  {
    case: 'an unknown option',
    options: { purposes: {}, consentMode: ['ad_storage'] },
    name: 'TypeError',
    message: '[lgpder] Unknown option: "consentMode".',
  },
  { case: 'no purposes', options: {}, name: 'TypeError', message: PURPOSES_OBJECT },
  {
    case: 'purposes as a string',
    options: { purposes: 'ads' },
    name: 'TypeError',
    message: PURPOSES_OBJECT,
  },
  {
    case: 'purposes as null',
    options: { purposes: null },
    name: 'TypeError',
    message: PURPOSES_OBJECT,
  },
  {
    case: 'a purpose that is not configured',
    options: { purposes: { typo: {} } },
    name: 'RangeError',
    message: '[lgpder] Unknown purpose: "typo".',
  },
  {
    case: 'a purpose named after an Object.prototype property',
    options: { purposes: { toString: {} } },
    name: 'RangeError',
    message: '[lgpder] Unknown purpose: "toString".',
  },
  {
    case: 'purpose options that are not an object',
    options: { purposes: { ads: 'google-ads' } },
    name: 'TypeError',
    message: '[lgpder] The options of "ads" must be an object.',
  },
  {
    case: 'purpose options as null',
    options: { purposes: { ads: null } },
    name: 'TypeError',
    message: '[lgpder] The options of "ads" must be an object.',
  },
  {
    case: 'an unknown purpose option',
    options: { purposes: { ads: { cookies: ['_gcl_*'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown option: "cookies".',
  },
  {
    case: 'integrations that are not an array',
    options: { purposes: { ads: { integrations: 'google-ads' } } },
    name: 'TypeError',
    message: '[lgpder] "integrations" must be an array.',
  },
  {
    case: 'an unknown integration',
    options: { purposes: { ads: { integrations: ['meta-pixel'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown integration: "meta-pixel".',
  },
  {
    case: 'an integration named after an Object.prototype property',
    options: { purposes: { ads: { integrations: ['toString'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown integration: "toString".',
  },
  {
    case: 'an integration list with a hole',
    options: { purposes: { ads: { integrations: withHole('google-ads') } } },
    name: 'TypeError',
    message: '[lgpder] Unknown integration: "undefined".',
  },
  {
    case: 'consentMode that is not an array',
    options: { purposes: { ads: { consentMode: 'ad_storage' } } },
    name: 'TypeError',
    message: '[lgpder] "consentMode" must be an array.',
  },
  {
    case: 'an unknown consent type',
    options: { purposes: { ads: { consentMode: ['ads_storage'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown consent type: "ads_storage".',
  },
  {
    case: 'a consent type that is not a string',
    options: { purposes: { ads: { consentMode: [1] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown consent type: "1".',
  },
  {
    case: 'a consent type as a null-prototype object',
    options: { purposes: { ads: { consentMode: [Object.create(null)] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown consent type: "object".',
  },
  {
    case: 'an integration whose toString throws, which is never called',
    options: {
      purposes: {
        ads: {
          integrations: [
            {
              toString: (): never => {
                throw new Error('toString was called');
              },
            },
          ],
        },
      },
    },
    name: 'TypeError',
    message: '[lgpder] Unknown integration: "object".',
  },
  {
    case: 'a consent type as a function',
    options: { purposes: { ads: { consentMode: [(): string => 'ad_storage'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown consent type: "function".',
  },
  {
    case: 'wait_for_update as a consent type',
    options: { purposes: { ads: { consentMode: ['wait_for_update'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown consent type: "wait_for_update".',
  },
  {
    case: 'a consent type list with a hole',
    options: { purposes: { ads: { consentMode: withHole('ad_storage') } } },
    name: 'TypeError',
    message: '[lgpder] Unknown consent type: "undefined".',
  },
  {
    case: 'debug that is not a boolean',
    options: { purposes: {}, debug: 'yes' },
    name: 'TypeError',
    message: '[lgpder] "debug" must be a boolean.',
  },
  // Order of the checks: purposes (each one: object, keys, integrations, consentMode), debug.
  {
    case: 'every option invalid',
    options: { purposes: { typo: {} }, debug: 1 },
    name: 'RangeError',
    message: '[lgpder] Unknown purpose: "typo".',
  },
  {
    case: 'integrations and consentMode invalid',
    options: { purposes: { ads: { integrations: ['x'], consentMode: ['y'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown integration: "x".',
  },
];

describe('invalid options', () => {
  for (const { case: label, options, name, message } of INVALID_OPTIONS) {
    it(`${label}: ${name}`, () => {
      assert.throws(
        () => {
          connectUntyped(options);
        },
        { name, message },
      );
    });
  }
});

describe('valid options', () => {
  it('accepts empty purposes and undefined values', () => {
    for (const options of [
      { purposes: {} },
      { purposes: { ads: undefined }, debug: undefined },
      { purposes: { ads: { integrations: undefined, consentMode: undefined } } },
      { purposes: { ads: {} }, debug: false },
    ]) {
      assert.doesNotThrow(() => {
        connectUntyped(options);
      });
    }
  });

  it('a consent type listed twice is granted with the purpose', () => {
    const { consent } = connectGoogleTo(setup(), {
      purposes: { ads: { consentMode: ['ad_storage', 'ad_storage'] } },
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(lastUpdate(), consentWith('ad_storage'));
  });

  it('reads the values of null-prototype objects', () => {
    const purpose = withPrototype({ integrations: ['google-ads'] }, null);
    const options = withPrototype({ purposes: withPrototype({ ads: purpose }, null) }, null);
    const { consent } = callUntyped<GooglePage>(connectGoogleTo, setup(), options);

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(lastUpdate(), consentWith(...AD_TYPES));
  });
});

describe('validation before any effect', () => {
  it('an invalid option sends nothing, creates no dataLayer and does not subscribe', () => {
    const { consent } = setup();

    assert.throws(() =>
      callUntyped(connectGoogle, consent, {
        purposes: { ads: { integrations: ['google-ads'] } },
        debug: 'yes',
      }),
    );
    consent.decide({ ads: 'granted' });

    assert.equal(dataLayer(), undefined);
  });
});

describe('inherited options are never read', () => {
  /** Connects the layer to a manager with ads granted, with `pollution` planted meanwhile. */
  function connectPolluted(
    pollution: Readonly<Record<string, unknown>>,
    options: object,
  ): GooglePage {
    // The manager is created first: the core reads its own configuration directly (6.1.3).
    const tab = setup({ record: serialized({ ads: decisionOf('granted') }) });
    return withObjectPollution(pollution, () =>
      callUntyped<GooglePage>(connectGoogleTo, tab, options),
    );
  }

  it('an inherited consentMode or integrations grants no type', () => {
    connectPolluted(
      { consentMode: ['ad_storage'], integrations: ['google-ads'] },
      { purposes: { ads: {} } },
    );

    assert.deepStrictEqual(lastUpdate(), consentWith());
  });

  const POLLUTED_HOLES = [
    {
      list: 'integrations',
      pollution: { 1: 'google-ads' },
      options: { purposes: { ads: { integrations: withHole('google-analytics') } } },
      message: '[lgpder] Unknown integration: "undefined".',
    },
    {
      list: 'consentMode',
      pollution: { 1: 'ad_storage' },
      options: { purposes: { ads: { consentMode: withHole('analytics_storage') } } },
      message: '[lgpder] Unknown consent type: "undefined".',
    },
  ];

  for (const { list, pollution, options, message } of POLLUTED_HOLES) {
    it(`a hole of ${list} is refused, never filled with an inherited index`, () => {
      assert.throws(() => connectPolluted(pollution, options), { name: 'TypeError', message });
    });
  }

  it('an inherited purpose entry is ignored', () => {
    connectPolluted({ ads: { integrations: ['google-ads'] } }, { purposes: {} });

    assert.deepStrictEqual(lastUpdate(), consentWith());
  });

  it('an inherited purposes is not read, so the own one is still required', () => {
    assert.throws(
      () => connectPolluted({ purposes: { ads: { integrations: ['google-ads'] } } }, {}),
      { name: 'TypeError', message: PURPOSES_OBJECT },
    );
  });

  it('an inherited debug does not turn the warnings on', (t) => {
    const warnings = captureWarnings(t);

    connectPolluted({ debug: true }, { purposes: {} });

    assert.deepStrictEqual(warnings, []);
  });
});
