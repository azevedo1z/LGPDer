import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PURPOSES,
  callUntyped,
  createUntyped,
  decideUntyped,
  setup,
  withPrototype,
} from '../support/setup.ts';

/** Message of the invalid clock, the same for any invalid value it returns. */
const INVALID_CLOCK_MESSAGE =
  '[lgpder] "now" must return a non-negative safe integer (milliseconds since the Unix epoch).';

/** Message of an invalid maxAge, the same for any invalid value. */
const INVALID_MAX_AGE_MESSAGE = '[lgpder] "maxAge" must be a positive safe integer (milliseconds).';

describe('messages of createConsentManager', () => {
  const CREATE_ERRORS = [
    {
      call: 'createConsentManager(null)',
      args: [null],
      message: '[lgpder] Options must be a plain object; received: null.',
    },
    {
      call: 'createConsentManager() without argument, in JavaScript',
      args: [],
      message: '[lgpder] Options must be a plain object; received: undefined.',
    },
    {
      call: 'options in an array',
      args: [[]],
      message: '[lgpder] Options must be a plain object; received: array.',
    },
    {
      call: 'options in a string',
      args: ['purposes'],
      message: '[lgpder] Options must be a plain object; received: string.',
    },
    {
      call: 'options in a function',
      args: [() => PURPOSES],
      message: '[lgpder] Options must be a plain object; received: function.',
    },
    {
      call: 'options with another prototype',
      args: [withPrototype({ purposes: PURPOSES }, {})],
      message: '[lgpder] Options must be a plain object; received: object.',
    },
    {
      call: 'createConsentManager({ purposes: { ads: {} }, storage: {} })',
      args: [{ purposes: { ads: {} }, storage: {} }],
      message: '[lgpder] Unknown option: "storage".',
    },
    {
      call: 'option inital',
      args: [{ purposes: { ads: {} }, inital: {} }],
      message: '[lgpder] Unknown option: "inital".',
    },
    {
      call: 'option with quotes, escaped as JSON',
      args: [{ purposes: { ads: {} }, 'a"b': 1 }],
      message: '[lgpder] Unknown option: "a\\"b".',
    },
    {
      call: 'createConsentManager({ purposes: [] })',
      args: [{ purposes: [] }],
      message: '[lgpder] "purposes" must be a plain object; received: array.',
    },
    {
      call: 'missing purposes',
      args: [{}],
      message: '[lgpder] "purposes" must be a plain object; received: undefined.',
    },
    {
      call: 'purposes in the literal form { __proto__: {} }, which sets the prototype',
      args: [{ purposes: { __proto__: {} } }],
      message: '[lgpder] "purposes" must be a plain object; received: object.',
    },
    {
      call: 'purposes in a Map',
      args: [{ purposes: new Map() }],
      message: '[lgpder] "purposes" must be a plain object; received: object.',
    },
    {
      call: 'createConsentManager({ purposes: {} })',
      args: [{ purposes: {} }],
      message: '[lgpder] "purposes" must declare at least one purpose.',
    },
    {
      call: "createConsentManager({ purposes: { '*': {} } })",
      args: [{ purposes: { '*': {} } }],
      message: '[lgpder] Invalid purpose id: "*".',
    },
    {
      call: 'empty id',
      args: [{ purposes: { '': {} } }],
      message: '[lgpder] Invalid purpose id: "".',
    },
    {
      call: 'id starting with a digit',
      args: [{ purposes: { '1abc': {} } }],
      message: '[lgpder] Invalid purpose id: "1abc".',
    },
    {
      call: 'id with a space',
      args: [{ purposes: { 'a b': {} } }],
      message: '[lgpder] Invalid purpose id: "a b".',
    },
    {
      call: 'id with an accent',
      args: [{ purposes: { estatística: {} } }],
      message: '[lgpder] Invalid purpose id: "estatística".',
    },
    {
      call: 'id __proto__ as an own property, created with a computed key',
      args: [{ purposes: { ['__proto__']: {} } }],
      message: '[lgpder] Invalid purpose id: "__proto__".',
    },
    {
      call: 'id with quotes and a line break, escaped as JSON',
      args: [{ purposes: { 'a"b\nc': {} } }],
      message: '[lgpder] Invalid purpose id: "a\\"b\\nc".',
    },
    {
      call: 'createConsentManager({ purposes: { ads: null } })',
      args: [{ purposes: { ads: null } }],
      message:
        '[lgpder] The configuration of purpose "ads" must be a plain object; received: null.',
    },
    {
      call: 'configuration in an array',
      args: [{ purposes: { ads: [] } }],
      message:
        '[lgpder] The configuration of purpose "ads" must be a plain object; received: array.',
    },
    {
      call: 'configuration in a string',
      args: [{ purposes: { ads: 'granted' } }],
      message:
        '[lgpder] The configuration of purpose "ads" must be a plain object; received: string.',
    },
    {
      call: 'configuration with another prototype',
      args: [{ purposes: { ads: new Map() } }],
      message:
        '[lgpder] The configuration of purpose "ads" must be a plain object; received: object.',
    },
    {
      call: "createConsentManager({ purposes: { ads: { verison: '1' } } })",
      args: [{ purposes: { ads: { verison: '1' } } }],
      message: '[lgpder] Purpose "ads" has the unknown property "verison".',
    },
    {
      call: 'property with quotes, escaped as JSON',
      args: [{ purposes: { ads: { 'a"b': '1' } } }],
      message: '[lgpder] Purpose "ads" has the unknown property "a\\"b".',
    },
    {
      call: "createConsentManager({ purposes: { ads: { version: '' } } })",
      args: [{ purposes: { ads: { version: '' } } }],
      message: '[lgpder] The version of purpose "ads" must be a non-empty string.',
    },
    {
      call: 'numeric version',
      args: [{ purposes: { ads: { version: 2 } } }],
      message: '[lgpder] The version of purpose "ads" must be a non-empty string.',
    },
    {
      call: 'version null',
      args: [{ purposes: { ads: { version: null } } }],
      message: '[lgpder] The version of purpose "ads" must be a non-empty string.',
    },
    {
      call: "createConsentManager({ purposes: { ads: { category: 'mar keting' } } })",
      args: [{ purposes: { ads: { category: 'mar keting' } } }],
      message: '[lgpder] The category of purpose "ads" must be a valid id.',
    },
    {
      call: 'empty category',
      args: [{ purposes: { ads: { category: '' } } }],
      message: '[lgpder] The category of purpose "ads" must be a valid id.',
    },
    {
      call: 'numeric category',
      args: [{ purposes: { ads: { category: 2 } } }],
      message: '[lgpder] The category of purpose "ads" must be a valid id.',
    },
    {
      call: 'null category, common in configuration coming from the server as JSON',
      args: [{ purposes: { ads: { category: null } } }],
      message: '[lgpder] The category of purpose "ads" must be a valid id.',
    },
    {
      call: 'boolean category',
      args: [{ purposes: { ads: { category: true } } }],
      message: '[lgpder] The category of purpose "ads" must be a valid id.',
    },
    {
      call: 'category in an array',
      args: [{ purposes: { ads: { category: ['statistics'] } } }],
      message: '[lgpder] The category of purpose "ads" must be a valid id.',
    },
    {
      call: "createConsentManager({ purposes: { ads: { individualGrant: 'yes' } } })",
      args: [{ purposes: { ads: { individualGrant: 'yes' } } }],
      message: '[lgpder] "individualGrant" of purpose "ads" must be a boolean.',
    },
    {
      call: 'numeric individualGrant',
      args: [{ purposes: { ads: { individualGrant: 1 } } }],
      message: '[lgpder] "individualGrant" of purpose "ads" must be a boolean.',
    },
    {
      call: 'individualGrant null',
      args: [{ purposes: { ads: { individualGrant: null } } }],
      message: '[lgpder] "individualGrant" of purpose "ads" must be a boolean.',
    },
    {
      call: 'createConsentManager({ purposes: { ads: {} }, now: 123 })',
      args: [{ purposes: { ads: {} }, now: 123 }],
      message: '[lgpder] "now" must be a function; received: number.',
    },
    {
      call: "now: 'Date.now'",
      args: [{ purposes: { ads: {} }, now: 'Date.now' }],
      message: '[lgpder] "now" must be a function; received: string.',
    },
    {
      call: 'now: null',
      args: [{ purposes: { ads: {} }, now: null }],
      message: '[lgpder] "now" must be a function; received: null.',
    },
  ] as const;

  for (const { call, args, message } of CREATE_ERRORS) {
    it(call, () => {
      assert.throws(() => createUntyped(...args), { name: 'TypeError', message });
    });
  }
});

describe('message of an invalid maxAge', () => {
  const INVALID_MAX_AGES = [
    { scenario: 'zero', value: 0 },
    { scenario: '-1', value: -1 },
    { scenario: '1.5', value: 1.5 },
    { scenario: 'NaN', value: Number.NaN },
    { scenario: 'Infinity', value: Number.POSITIVE_INFINITY },
    { scenario: 'an integer above Number.MAX_SAFE_INTEGER', value: 2 ** 53 },
    { scenario: "the string '1000'", value: '1000' },
    { scenario: 'null', value: null },
  ] as const;

  for (const { scenario, value } of INVALID_MAX_AGES) {
    it(`maxAge ${scenario}`, () => {
      assert.throws(() => createUntyped({ purposes: PURPOSES, maxAge: value }), {
        name: 'TypeError',
        message: INVALID_MAX_AGE_MESSAGE,
      });
    });
  }

  it('accepts maxAge 1, the smallest positive safe integer', () => {
    const consent = createUntyped({ purposes: PURPOSES, maxAge: 1 });

    assert.equal(consent.maxAge, 1);
  });

  it('accepts maxAge Number.MAX_SAFE_INTEGER', () => {
    const consent = createUntyped({ purposes: PURPOSES, maxAge: Number.MAX_SAFE_INTEGER });

    assert.equal(consent.maxAge, Number.MAX_SAFE_INTEGER);
  });
});

describe('names of Object.prototype properties are rejected as id and category', () => {
  const RESERVED_NAMES = [
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    'toString',
    'valueOf',
  ] as const;

  for (const reserved of RESERVED_NAMES) {
    it(`id '${reserved}'`, () => {
      assert.throws(() => createUntyped({ purposes: { [reserved]: {} } }), {
        name: 'TypeError',
        message: `[lgpder] Invalid purpose id: "${reserved}".`,
      });
    });

    it(`category '${reserved}'`, () => {
      assert.throws(() => createUntyped({ purposes: { ads: { category: reserved } } }), {
        name: 'TypeError',
        message: '[lgpder] The category of purpose "ads" must be a valid id.',
      });
    });
  }
});

describe('messages of decide', () => {
  const DECIDE_ERRORS = [
    {
      call: 'consent.decide(null)',
      args: [null],
      name: 'TypeError',
      message: '[lgpder] Choices must be a plain object; received: null.',
    },
    {
      call: 'decide([])',
      args: [[]],
      name: 'TypeError',
      message: '[lgpder] Choices must be a plain object; received: array.',
    },
    {
      call: 'decide(new Map())',
      args: [new Map()],
      name: 'TypeError',
      message: '[lgpder] Choices must be a plain object; received: object.',
    },
    {
      call: "decide('x')",
      args: ['x'],
      name: 'TypeError',
      message: '[lgpder] Choices must be a plain object; received: string.',
    },
    {
      call: 'decide() without argument, in JavaScript',
      args: [],
      name: 'TypeError',
      message: '[lgpder] Choices must be a plain object; received: undefined.',
    },
    {
      call: 'choices created with another prototype',
      args: [withPrototype({ ads: 'granted' }, {})],
      name: 'TypeError',
      message: '[lgpder] Choices must be a plain object; received: object.',
    },
    {
      call: "consent.decide({ analytic: 'granted' })",
      args: [{ analytic: 'granted' }],
      name: 'RangeError',
      message: '[lgpder] Unknown purpose: "analytic".',
    },
    {
      call: "decide({ analytics: 'granted', typo: 'denied' })",
      args: [{ analytics: 'granted', typo: 'denied' }],
      name: 'RangeError',
      message: '[lgpder] Unknown purpose: "typo".',
    },
    {
      call: 'decide({ typo: true })',
      args: [{ typo: true }],
      name: 'RangeError',
      message: '[lgpder] Unknown purpose: "typo".',
    },
    {
      call: 'decide({ typo: undefined })',
      args: [{ typo: undefined }],
      name: 'RangeError',
      message: '[lgpder] Unknown purpose: "typo".',
    },
    {
      call: 'purpose with quotes, escaped as JSON',
      args: [{ 'a"b': 'granted' }],
      name: 'RangeError',
      message: '[lgpder] Unknown purpose: "a\\"b".',
    },
    {
      call: 'consent.decide({ ads: true })',
      args: [{ ads: true }],
      name: 'TypeError',
      message: '[lgpder] The choice for "ads" must be "granted" or "denied"; received: boolean.',
    },
    {
      call: "decide({ ads: 'GRANTED' })",
      args: [{ ads: 'GRANTED' }],
      name: 'TypeError',
      message: '[lgpder] The choice for "ads" must be "granted" or "denied"; received: string.',
    },
    {
      call: "decide({ ads: 'pending' })",
      args: [{ ads: 'pending' }],
      name: 'TypeError',
      message: '[lgpder] The choice for "ads" must be "granted" or "denied"; received: string.',
    },
    {
      call: 'decide({ ads: null })',
      args: [{ ads: null }],
      name: 'TypeError',
      message: '[lgpder] The choice for "ads" must be "granted" or "denied"; received: null.',
    },
    {
      call: 'decide({ ads: 1 })',
      args: [{ ads: 1 }],
      name: 'TypeError',
      message: '[lgpder] The choice for "ads" must be "granted" or "denied"; received: number.',
    },
  ] as const;

  for (const { call, args, name, message } of DECIDE_ERRORS) {
    it(call, () => {
      const { consent } = setup();

      assert.throws(
        () => {
          decideUntyped(consent, ...args);
        },
        { name, message },
      );
    });
  }
});

describe('message of the invalid clock', () => {
  const INVALID_INSTANTS = [
    { scenario: '1.5', value: 1.5 },
    { scenario: 'NaN', value: Number.NaN },
    { scenario: '-1', value: -1 },
    { scenario: "the string '1'", value: '1' },
    { scenario: 'a Date object', value: new Date(0) },
  ] as const;

  for (const { scenario, value } of INVALID_INSTANTS) {
    it(`effective decide with now returning ${scenario}`, () => {
      const consent = createUntyped({ purposes: PURPOSES, now: () => value });

      assert.throws(
        () => {
          consent.decide({ ads: 'granted' });
        },
        { name: 'TypeError', message: INVALID_CLOCK_MESSAGE },
      );
    });
  }

  it('grantAll with now returning 1.5', () => {
    const consent = createUntyped({ purposes: PURPOSES, now: () => 1.5 });

    assert.throws(
      () => {
        consent.grantAll();
      },
      { name: 'TypeError', message: INVALID_CLOCK_MESSAGE },
    );
  });

  it('denyAll with now returning 1.5', () => {
    const consent = createUntyped({ purposes: PURPOSES, now: () => 1.5 });

    assert.throws(
      () => {
        consent.denyAll();
      },
      { name: 'TypeError', message: INVALID_CLOCK_MESSAGE },
    );
  });
});

describe('message of subscribe', () => {
  const SUBSCRIBE_ERRORS = [
    {
      call: "consent.subscribe('x')",
      args: ['x'],
      message: '[lgpder] The listener must be a function; received: string.',
    },
    {
      call: 'subscribe(null)',
      args: [null],
      message: '[lgpder] The listener must be a function; received: null.',
    },
    {
      call: 'subscribe({})',
      args: [{}],
      message: '[lgpder] The listener must be a function; received: object.',
    },
    {
      call: 'subscribe() without argument, in JavaScript',
      args: [],
      message: '[lgpder] The listener must be a function; received: undefined.',
    },
  ] as const;

  for (const { call, args, message } of SUBSCRIBE_ERRORS) {
    it(call, () => {
      const { consent } = setup();

      assert.throws(() => callUntyped(consent.subscribe, ...args), { name: 'TypeError', message });
    });
  }
});

describe('native errors, not frozen and without cause', () => {
  /** Runs `act` and returns the thrown value. */
  function thrownBy(act: () => unknown): unknown {
    try {
      act();
    } catch (error) {
      return error;
    }
    return assert.fail('the call should throw');
  }

  const SAMPLES = [
    {
      scenario: 'the error of invalid options in createConsentManager',
      act: () => createUntyped(null),
      type: TypeError,
    },
    {
      scenario: 'the error of an unknown purpose in decide',
      act: () => {
        decideUntyped(setup().consent, { typo: 'granted' });
      },
      type: RangeError,
    },
    {
      scenario: 'the error of the invalid clock',
      act: () => {
        createUntyped({ purposes: PURPOSES, now: () => -1 }).decide({ ads: 'granted' });
      },
      type: TypeError,
    },
    {
      scenario: 'the error of an invalid listener in subscribe',
      act: () => callUntyped(setup().consent.subscribe, 'x'),
      type: TypeError,
    },
  ] as const;

  for (const { scenario, act, type } of SAMPLES) {
    it(`${scenario} is a direct instance of ${type.name}`, () => {
      const error = thrownBy(act);

      assert.equal(Object.getPrototypeOf(error), type.prototype);
    });

    it(`${scenario} is not frozen and has no cause`, () => {
      const error = thrownBy(act);

      assert.ok(error instanceof Error);
      assert.equal(Object.isFrozen(error), false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
    });
  }
});
