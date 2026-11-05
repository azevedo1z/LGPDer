/**
 * Server environment: this file does not install the DOM, so `document` and `window` do not exist,
 * as in Node. The layer validates its options and returns a handle that does nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { connectGoogle } from '../../src/google/index.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, setup } from '../support/setup.ts';

const OPTIONS = {
  purposes: {
    analytics: { integrations: ['google-analytics'] },
    ads: { integrations: ['google-ads'], consentMode: ['personalization_storage'] },
  },
  debug: true,
} as const;

describe('connectGoogle without document', () => {
  it('runs without document and window', () => {
    assert.equal(typeof document, 'undefined');
    assert.equal(typeof window, 'undefined');
  });

  it('connects, follows decisions, destroys and withdraws without throwing or creating globals', () => {
    const { consent } = setup({ record: serialized({ ads: decisionOf('granted') }) });

    assert.doesNotThrow(() => {
      const google = connectGoogle(consent, OPTIONS);
      consent.decide({ ads: 'denied' });
      google.destroy();
      google.destroy();
      google.withdraw();
    });
    assert.equal(Reflect.has(globalThis, 'dataLayer'), false);
    assert.equal(Reflect.has(globalThis, 'gtag'), false);
  });

  it('never subscribes to the manager', (t) => {
    const { consent } = setup();
    // The functions of the manager do not depend on this, so a copy works as the manager.
    const subscribe = t.mock.fn(consent.subscribe);

    connectGoogle({ ...consent, subscribe }, OPTIONS).destroy();

    assert.equal(subscribe.mock.callCount(), 0);
  });

  it('the options are still validated', () => {
    const { consent } = setup();

    assert.throws(() => callUntyped(connectGoogle, consent, { purposes: { typo: {} } }), {
      name: 'RangeError',
      message: '[lgpder] Unknown purpose: "typo".',
    });
    assert.throws(() => callUntyped(connectGoogle, consent, { purposes: {}, debug: 1 }), {
      name: 'TypeError',
      message: '[lgpder] "debug" must be a boolean.',
    });
  });

  it('the handle is frozen', () => {
    const { consent } = setup();
    const google = connectGoogle(consent, OPTIONS);

    assert.ok(Object.isFrozen(google));
    google.destroy();
  });
});
