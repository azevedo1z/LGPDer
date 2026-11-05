/**
 * Server environment: this file does not install the DOM, so `document` does not exist, as in
 * Node. The layer validates its options and returns a handle that does nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentManager } from 'lgpder';

import { createPlaceholder, mountUi } from '../../src/ui/index.ts';
import { callUntyped, setup, type PurposeId } from '../support/setup.ts';

/** A copy of the manager that counts its subscriptions; its functions do not depend on `this`. */
function countingSubscriptions(consent: ConsentManager<PurposeId>): {
  readonly consent: ConsentManager<PurposeId>;
  readonly subscriptions: () => number;
} {
  let count = 0;
  return {
    consent: {
      ...consent,
      subscribe: (listener) => {
        count += 1;
        return consent.subscribe(listener);
      },
    },
    subscriptions: () => count,
  };
}

describe('mountUi without document', () => {
  it('runs without document nor custom elements', () => {
    assert.equal(typeof document, 'undefined');
    assert.equal(typeof customElements, 'undefined');
  });

  it('mounts an inert handle that never subscribes to the manager', () => {
    const { consent, subscriptions } = countingSubscriptions(setup().consent);

    const ui = mountUi(consent, { floatingButton: false, texts: { lang: 'en' } });
    ui.openPreferences();
    ui.openPreferences(['ads']);
    consent.grantAll();
    ui.destroy();
    ui.destroy();

    assert.equal(subscriptions(), 0);
  });

  it('still validates the options and the list of openPreferences', () => {
    const { consent } = setup();
    const ui = mountUi(consent);

    assert.throws(() => callUntyped(mountUi, consent, { floating: true }), TypeError);
    assert.throws(() => callUntyped(mountUi, consent, { purposes: { typo: {} } }), RangeError);
    assert.throws(
      () => callUntyped(mountUi, consent, { texts: { banner: { title: '' } } }),
      TypeError,
    );
    assert.throws(() => {
      callUntyped(ui.openPreferences, ['typo']);
    }, RangeError);
    assert.throws(() => {
      callUntyped(ui.openPreferences, []);
    }, TypeError);
    ui.destroy();
  });

  it('a destroyed handle throws as in the browser', () => {
    const ui = mountUi(setup().consent);
    ui.destroy();

    assert.throws(
      () => {
        ui.openPreferences();
      },
      { message: '[lgpder] This instance was destroyed.' },
    );
  });
});

describe('createPlaceholder without document', () => {
  it('validates the options and returns a renderer, which the scripts layer never calls here', () => {
    const { consent } = setup();

    assert.equal(
      typeof createPlaceholder(consent, { purposes: { ads: { title: 'Ads' } } }),
      'function',
    );
    assert.throws(() => callUntyped(createPlaceholder, consent, { actions: {} }), TypeError);
  });
});
