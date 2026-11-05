/**
 * The consent default: pushed by the layer on connection when the dataLayer has none, before the
 * first update, and never duplicated when the page already set one.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { GoogleOptions } from 'lgpder/google';

import { captureWarnings } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import {
  DEFAULT_COMMAND,
  DEFAULT_PARAMS,
  closeGoogles,
  consentWith,
  installGtag,
  openGoogle,
  queued,
  setDataLayer,
} from '../support/google.ts';
import type { PurposeId } from '../support/setup.ts';

afterEach(() => {
  closeGoogles();
  testDom.reset();
});

const OPTIONS: GoogleOptions<PurposeId> = {
  purposes: { analytics: { integrations: ['google-analytics'] } },
};

const UPDATE_DENIED = ['consent', 'update', consentWith()] as const;

const MISSING_DEFAULT =
  '[lgpder] No consent default was found in the dataLayer; it was pushed now. Run consentDefaultSnippet in the <head>, before the Google tag.';

/** The `arguments` object of a call, as a gtag of the page queues it. */
const argumentsOf: (...args: unknown[]) => IArguments = function () {
  // eslint-disable-next-line prefer-rest-params -- the entry under test is an arguments object
  return arguments;
};

describe('consent default missing', () => {
  it('pushes every type denied, with wait_for_update 500, before the first update', () => {
    openGoogle(OPTIONS);

    assert.deepStrictEqual(queued(), [DEFAULT_COMMAND, UPDATE_DENIED]);
  });

  it('sends it through the gtag of the page, when there is one', () => {
    const calls = installGtag();

    openGoogle(OPTIONS);

    assert.deepStrictEqual(calls, [DEFAULT_COMMAND, UPDATE_DENIED]);
  });

  it('pushes it only on connection, never on a later notification', () => {
    const { consent } = openGoogle(OPTIONS);

    consent.decide({ analytics: 'granted' });
    consent.decide({ analytics: 'denied' });

    assert.equal(queued().filter(([, action]) => action === 'default').length, 1);
  });

  it('a consent update in the dataLayer is not a default', () => {
    setDataLayer([argumentsOf('consent', 'update', consentWith())]);

    openGoogle(OPTIONS);

    assert.deepStrictEqual(queued().slice(1), [DEFAULT_COMMAND, UPDATE_DENIED]);
  });

  const IGNORED_BY_THE_TAG = [
    { case: 'an array', entry: ['consent', 'default', DEFAULT_PARAMS] },
    { case: 'a plain object', entry: { 0: 'consent', 1: 'default', 2: DEFAULT_PARAMS } },
  ];

  for (const { case: name, entry } of IGNORED_BY_THE_TAG) {
    it(`a default queued as ${name}, which the Google tag ignores, is not a default`, () => {
      setDataLayer([entry]);

      openGoogle(OPTIONS);

      assert.deepStrictEqual(queued().slice(1), [DEFAULT_COMMAND, UPDATE_DENIED]);
    });
  }

  it('other entries of the dataLayer are not a default', () => {
    setDataLayer([{ event: 'gtm.js' }, null, 'consent', argumentsOf('config', 'G-XXXX')]);

    openGoogle(OPTIONS);

    assert.deepStrictEqual(queued().slice(4), [DEFAULT_COMMAND, UPDATE_DENIED]);
  });

  it('with debug, warns that the snippet is missing', (t) => {
    const warnings = captureWarnings(t);

    openGoogle({ ...OPTIONS, debug: true });

    assert.deepStrictEqual(warnings, [MISSING_DEFAULT]);
  });

  it('without debug, never warns', (t) => {
    const warnings = captureWarnings(t);

    openGoogle(OPTIONS);

    assert.deepStrictEqual(warnings, []);
  });
});

describe('consent default already set', () => {
  const EXISTING = [
    { case: 'as an arguments object', entry: argumentsOf('consent', 'default', DEFAULT_PARAMS) },
    {
      case: 'with other values, such as a region',
      entry: argumentsOf('consent', 'default', { analytics_storage: 'denied', region: ['BR'] }),
    },
  ];

  for (const { case: name, entry } of EXISTING) {
    it(`is not duplicated, ${name}`, () => {
      setDataLayer([entry]);

      openGoogle(OPTIONS);

      assert.deepStrictEqual(queued().slice(1), [UPDATE_DENIED]);
    });
  }

  it('is found after other entries', () => {
    setDataLayer([{ event: 'gtm.js' }, argumentsOf('consent', 'default', DEFAULT_PARAMS)]);

    openGoogle(OPTIONS);

    assert.deepStrictEqual(queued().slice(2), [UPDATE_DENIED]);
  });

  it('with debug, nothing is warned', (t) => {
    const warnings = captureWarnings(t);
    setDataLayer([argumentsOf('consent', 'default', DEFAULT_PARAMS)]);

    openGoogle({ ...OPTIONS, debug: true });

    assert.deepStrictEqual(warnings, []);
  });
});
