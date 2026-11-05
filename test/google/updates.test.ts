/**
 * When the layer sends `gtag('consent', 'update', ...)`: on connection and on every notification,
 * always from the current state of the manager, and never after `destroy`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { GoogleOptions } from 'lgpder/google';

import { testDom } from '../support/dom.ts';
import {
  closeGoogles,
  connectGoogleTo,
  consentWith,
  openGoogle,
  queued,
  updates,
} from '../support/google.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { assignUntyped, setup, type PurposeId } from '../support/setup.ts';

afterEach(() => {
  closeGoogles();
  testDom.reset();
});

const OPTIONS: GoogleOptions<PurposeId> = {
  purposes: {
    analytics: { integrations: ['google-analytics'] },
    ads: { integrations: ['google-ads'] },
  },
};

const AD_TYPES = ['ad_storage', 'ad_user_data', 'ad_personalization'] as const;

describe('update on connection', () => {
  it('with nothing decided, denies every type', () => {
    openGoogle(OPTIONS);

    assert.deepStrictEqual(updates(), [consentWith()]);
  });

  it('follows the record hydrated by the manager', () => {
    openGoogle(OPTIONS, {
      record: serialized({ analytics: decisionOf('granted', { version: '2026-10' }) }),
    });

    assert.deepStrictEqual(updates(), [consentWith('analytics_storage')]);
  });

  it('comes after the default the layer pushed', () => {
    openGoogle(OPTIONS);

    assert.deepStrictEqual(
      queued().map(([, action]) => action),
      ['default', 'update'],
    );
  });
});

describe('decision made by the page while it handles the first update', () => {
  it('is sent once the layer has subscribed, so a revocation reaches Google', () => {
    const tab = setup({ record: serialized({ ads: decisionOf('granted') }) });
    const sent: unknown[] = [];
    // A gtag of the page that revokes ads while it handles the first update.
    Reflect.set(testDom.window, 'gtag', (_command: string, action: string, params: unknown) => {
      if (action !== 'update') return;
      sent.push(params);
      if (sent.length === 1) tab.consent.decide({ ads: 'denied' });
    });

    connectGoogleTo(tab, OPTIONS);

    assert.deepStrictEqual(sent, [consentWith(...AD_TYPES), consentWith()]);
  });
});

describe('update on every notification', () => {
  it('sends one update per decision, granting and revoking', () => {
    const { consent } = openGoogle(OPTIONS);

    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied', analytics: 'granted' });

    assert.deepStrictEqual(updates(), [
      consentWith(),
      consentWith(...AD_TYPES),
      consentWith('analytics_storage'),
    ]);
  });

  it('sends an update on a restore, such as a revocation adopted from another tab', () => {
    const { consent } = openGoogle(OPTIONS);
    consent.decide({ ads: 'granted' });

    consent.restore(serialized({ ads: decisionOf('denied') }));

    assert.deepStrictEqual(updates().at(-1), consentWith());
  });

  it('sends an update even when no type changed, without deduplication', () => {
    const { consent } = openGoogle(OPTIONS);

    consent.decide({ health: 'granted' });

    assert.deepStrictEqual(updates(), [consentWith(), consentWith()]);
  });

  it('is computed from the current state, not from the notification being delivered', () => {
    // A listener subscribed before the layer revokes analytics as soon as it is granted.
    const tab = setup();
    tab.consent.subscribe(({ snapshot }) => {
      if (snapshot.status.analytics === 'granted') tab.consent.decide({ analytics: 'denied' });
    });
    connectGoogleTo(tab, OPTIONS);

    tab.consent.decide({ analytics: 'granted' });

    assert.equal(tab.changes.length, 2);
    assert.deepStrictEqual(updates(), [consentWith(), consentWith(), consentWith()]);
  });
});

describe('destroy', () => {
  it('stops the updates and sends nothing itself', () => {
    const { consent, google } = openGoogle(OPTIONS);
    const before = queued();

    google.destroy();
    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(queued(), before);
  });

  it('is idempotent', () => {
    const { google } = openGoogle(OPTIONS);

    google.destroy();

    assert.doesNotThrow(() => {
      google.destroy();
    });
  });

  it('does not depend on this', () => {
    const { consent, google } = openGoogle(OPTIONS);
    const { destroy } = google;

    destroy();
    consent.decide({ ads: 'granted' });

    assert.equal(updates().length, 1);
  });

  it('the handle is frozen, with destroy only', () => {
    const { google } = openGoogle(OPTIONS);

    assert.ok(Object.isFrozen(google));
    assert.deepStrictEqual(Object.keys(google), ['destroy']);
    assert.throws(() => {
      assignUntyped(google, 'destroy', () => undefined);
    }, TypeError);
  });
});
