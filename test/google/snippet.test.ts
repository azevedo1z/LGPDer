/**
 * The consent default snippet: its exact text, and its effect when run in the page before the
 * layer connects.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { GoogleOptions } from 'lgpder/google';

import { consentDefaultSnippet } from '../../src/google/index.ts';
import { testDom } from '../support/dom.ts';
import {
  DEFAULT_COMMAND,
  closeGoogles,
  consentWith,
  dataLayer,
  isArguments,
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

/** The snippet of contract C7, character by character. */
const EXPECTED =
  "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'denied',wait_for_update:500});";

/** Runs the snippet in the page, as an inline script in the `<head>` would. */
function runSnippet(): void {
  testDom.window.eval(consentDefaultSnippet);
}

describe('consentDefaultSnippet', () => {
  it('is the exact text', () => {
    assert.equal(consentDefaultSnippet, EXPECTED);
  });

  it('run in the page, defines gtag and queues the default as an arguments object', () => {
    runSnippet();

    const entries = dataLayer() as readonly unknown[];
    assert.equal(entries.length, 1);
    assert.ok(isArguments(entries[0]));
    assert.deepStrictEqual(queued(), [DEFAULT_COMMAND]);
    assert.equal(typeof Reflect.get(testDom.window, 'gtag'), 'function');
  });

  it('keeps a dataLayer that already exists', () => {
    const existing = { event: 'gtm.js' };
    setDataLayer([existing]);

    runSnippet();

    assert.equal((dataLayer() as readonly unknown[])[0], existing);
    assert.deepStrictEqual(queued().slice(1), [DEFAULT_COMMAND]);
  });

  it('queues the same default the layer pushes without it', () => {
    runSnippet();
    const fromSnippet = queued()[0];
    testDom.reset();

    openGoogle(OPTIONS);

    assert.deepStrictEqual(queued()[0], fromSnippet);
  });

  it('after it, the layer pushes no other default and updates through its gtag', () => {
    runSnippet();
    const { consent } = openGoogle(OPTIONS);

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(queued(), [
      DEFAULT_COMMAND,
      ['consent', 'update', consentWith()],
      ['consent', 'update', consentWith('analytics_storage')],
    ]);
    assert.ok((dataLayer() as readonly unknown[]).every(isArguments));
  });
});
