/**
 * How commands reach the Google tag: through `window.gtag` when the page has one, and otherwise
 * queued in `window.dataLayer` as `arguments` objects. The layer never defines `gtag`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { GoogleOptions } from 'lgpder/google';

import { captureMicrotasks } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import {
  DEFAULT_COMMAND,
  closeGoogles,
  consentWith,
  dataLayer,
  installGtag,
  isArguments,
  openGoogle,
  queued,
  setDataLayer,
  updates,
  updatesIn,
} from '../support/google.ts';
import type { PurposeId } from '../support/setup.ts';

afterEach(() => {
  closeGoogles();
  testDom.reset();
});

const OPTIONS: GoogleOptions<PurposeId> = {
  purposes: { analytics: { integrations: ['google-analytics'] } },
};

describe('without gtag on the page', () => {
  it('creates window.dataLayer when missing', () => {
    assert.equal(dataLayer(), undefined);

    openGoogle(OPTIONS);

    assert.ok(Array.isArray(dataLayer()));
  });

  it('queues every command as an arguments object, as the official snippet does', () => {
    const { consent } = openGoogle(OPTIONS);

    consent.decide({ analytics: 'granted' });

    const entries = dataLayer() as readonly unknown[];
    assert.equal(entries.length, 3);
    assert.ok(entries.every(isArguments));
  });

  it('never defines window.gtag', () => {
    const { consent } = openGoogle(OPTIONS);

    consent.decide({ analytics: 'granted' });

    assert.equal(Reflect.has(testDom.window, 'gtag'), false);
  });

  it('keeps the entries already in the dataLayer, and appends after them', () => {
    const existing = { event: 'gtm.js' };
    setDataLayer([existing]);

    openGoogle(OPTIONS);

    const entries = dataLayer() as readonly unknown[];
    assert.equal(entries[0], existing);
    assert.deepStrictEqual(queued().slice(1), [
      DEFAULT_COMMAND,
      ['consent', 'update', consentWith()],
    ]);
  });
});

describe('with gtag on the page', () => {
  it('sends every command through it, and never through the dataLayer', () => {
    const calls = installGtag();
    const { consent } = openGoogle(OPTIONS);

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(calls, [
      DEFAULT_COMMAND,
      ['consent', 'update', consentWith()],
      ['consent', 'update', consentWith('analytics_storage')],
    ]);
    assert.equal(dataLayer(), undefined);
  });

  it('reads gtag when sending, so a gtag defined after the connection is used', () => {
    const { consent } = openGoogle(OPTIONS);
    const calls = installGtag();

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(updatesIn(calls), [consentWith('analytics_storage')]);
    assert.deepStrictEqual(updates(), [consentWith()]);
  });

  it('a gtag property that is not a function is ignored, and the dataLayer is used', () => {
    Reflect.set(testDom.window, 'gtag', 'not a function');

    openGoogle(OPTIONS);

    assert.deepStrictEqual(updates(), [consentWith()]);
  });
});

describe('failures of the page', () => {
  it('a gtag that throws: rethrown in a microtask, and later updates are still sent', (t) => {
    const microtasks = captureMicrotasks(t);
    const failure = new Error('gtag failed');
    const calls: unknown[] = [];
    Reflect.set(testDom.window, 'gtag', (...args: unknown[]) => {
      calls.push(args);
      throw failure;
    });

    const { consent } = openGoogle(OPTIONS);
    consent.decide({ analytics: 'granted' });

    assert.equal(calls.length, 3);
    assert.equal(microtasks.length, 3);
    for (const microtask of microtasks) assert.throws(microtask, (error) => error === failure);
  });

  it('a dataLayer without push: the connection does not throw, and the error is rethrown', (t) => {
    const microtasks = captureMicrotasks(t);
    setDataLayer('not a list');

    assert.doesNotThrow(() => openGoogle(OPTIONS));

    assert.equal(microtasks.length, 2);
    for (const microtask of microtasks) assert.throws(microtask, TypeError);
  });
});
