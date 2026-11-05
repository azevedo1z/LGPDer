/**
 * Validation of the options of mountUi and createPlaceholder (D42): complete, before any effect,
 * and only on own properties (D43).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createPlaceholder, mountUi } from '../../src/ui/index.ts';
import { testDom } from '../support/dom.ts';
import { callUntyped, setup, withObjectPollution, withPrototype } from '../support/setup.ts';
import { closeUis, isShown, mountOn, textsOf } from '../support/ui.ts';
import { decisionOf, serialized } from '../support/records.ts';

afterEach(() => {
  closeUis();
  testDom.reset();
});

interface InvalidCase {
  readonly name: string;
  readonly options: unknown;
  readonly error: { readonly name: string; readonly message: string };
}

/** Invalid options shared by mountUi and createPlaceholder. */
const SHARED_CASES: readonly InvalidCase[] = [
  {
    name: 'options that are not an object',
    options: 'all',
    error: { name: 'TypeError', message: '[lgpder] Options must be an object.' },
  },
  {
    name: 'null options',
    options: null,
    error: { name: 'TypeError', message: '[lgpder] Options must be an object.' },
  },
  {
    name: 'actions without decide, grantAll and denyAll',
    options: { actions: { decide: () => undefined } },
    error: {
      name: 'TypeError',
      message: '[lgpder] "actions" must have the functions decide, grantAll and denyAll.',
    },
  },
  {
    name: 'actions that are not an object',
    options: { actions: () => undefined },
    error: {
      name: 'TypeError',
      message: '[lgpder] "actions" must have the functions decide, grantAll and denyAll.',
    },
  },
  {
    name: 'purposes that are not an object',
    options: { purposes: 'ads' },
    error: { name: 'TypeError', message: '[lgpder] "purposes" must be an object.' },
  },
  {
    name: 'texts of a purpose that is not configured',
    options: { purposes: { typo: { title: 'Typo' } } },
    error: { name: 'RangeError', message: '[lgpder] Unknown purpose: "typo".' },
  },
  {
    name: 'texts of a purpose that are not an object',
    options: { purposes: { ads: 'Ads' } },
    error: { name: 'TypeError', message: '[lgpder] The texts of "ads" must be an object.' },
  },
  {
    name: 'an unknown key in the texts of a purpose',
    options: { purposes: { ads: { label: 'Ads' } } },
    error: { name: 'TypeError', message: '[lgpder] Unknown option: "label".' },
  },
  {
    name: 'an empty title of a purpose',
    options: { purposes: { ads: { title: '' } } },
    error: {
      name: 'TypeError',
      message: '[lgpder] "purposes.ads.title" must be a non-empty string.',
    },
  },
  {
    name: 'a description of a purpose that is not a string',
    options: { purposes: { ads: { description: 1 } } },
    error: {
      name: 'TypeError',
      message: '[lgpder] "purposes.ads.description" must be a non-empty string.',
    },
  },
];

describe('mountUi rejects, before mounting anything', () => {
  const cases: readonly InvalidCase[] = [
    ...SHARED_CASES,
    {
      name: 'an unknown option',
      options: { floating: false },
      error: { name: 'TypeError', message: '[lgpder] Unknown option: "floating".' },
    },
    {
      name: 'wouldReload that is not a function',
      options: { wouldReload: true },
      error: { name: 'TypeError', message: '[lgpder] "wouldReload" must be a function.' },
    },
    {
      name: 'floatingButton that is not a boolean',
      options: { floatingButton: 'no' },
      error: { name: 'TypeError', message: '[lgpder] "floatingButton" must be a boolean.' },
    },
  ];
  for (const { name, options, error } of cases) {
    it(name, () => {
      const { consent } = setup();
      let subscribed = 0;
      const spied = {
        ...consent,
        subscribe: (...args: Parameters<typeof consent.subscribe>) => {
          subscribed += 1;
          return consent.subscribe(...args);
        },
      };

      assert.throws(() => callUntyped(mountUi, spied, options), error);
      assert.equal(document.body.childElementCount, 0);
      assert.equal(subscribed, 0);
    });
  }
});

describe('createPlaceholder rejects', () => {
  const cases: readonly InvalidCase[] = [
    ...SHARED_CASES,
    {
      name: 'an option of mountUi only',
      options: { floatingButton: false },
      error: { name: 'TypeError', message: '[lgpder] Unknown option: "floatingButton".' },
    },
  ];
  for (const { name, options, error } of cases) {
    it(name, () => {
      const { consent } = setup();

      assert.throws(() => callUntyped(createPlaceholder, consent, options), error);
    });
  }
});

describe('valid options', () => {
  it('may be a null-prototype object, with undefined values meaning the defaults', () => {
    const tab = setup();
    const options = withPrototype(
      {
        actions: undefined,
        purposes: undefined,
        texts: undefined,
        wouldReload: undefined,
        floatingButton: undefined,
      },
      null,
    );

    mountOn(tab, options as Parameters<typeof mountUi>[1]);

    assert.equal(isShown('lgpder-banner'), true);
  });

  it('inherited from a polluted prototype are ignored (D43)', () => {
    const tab = setup({
      record: serialized({
        analytics: decisionOf('granted', { version: '2026-10' }),
        ads: decisionOf('denied'),
      }),
    });

    withObjectPollution(
      { floatingButton: false, texts: { button: { label: 'Hijacked' } }, actions: 1 },
      () => {
        mountOn(tab, {});
      },
    );

    assert.equal(isShown('lgpder-button'), true);
  });

  it('texts inherited by a purpose are ignored', () => {
    const tab = setup();

    withObjectPollution({ title: 'Hijacked' }, () => {
      mountOn(tab, { purposes: { ads: {} } });
    });

    assert.deepStrictEqual(textsOf('lgpder-banner', 'purpose'), ['analytics', 'ads']);
  });
});
