import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConsentManager } from 'lgpder';
import { connectScripts } from 'lgpder/scripts';
import { connectStorage } from 'lgpder/storage';

/** 2026-10-31T12:00:00.000Z. */
const INSTANT = 1_793_448_000_000;

describe('compiled package, imported by the name lgpder', () => {
  it('the only runtime export is createConsentManager', async () => {
    const exported = await import('lgpder');

    assert.deepStrictEqual(Object.keys(exported), ['createConsentManager']);
  });

  it('runs the minimal flow: create, decide and read', () => {
    const consent = createConsentManager({
      purposes: { analytics: { version: '2026-10' }, ads: {} },
      now: () => INSTANT,
    });

    consent.decide({ analytics: 'granted', ads: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record, {
      format: 1,
      decisions: {
        analytics: { status: 'granted', version: '2026-10', decidedAt: INSTANT },
        ads: { status: 'denied', decidedAt: INSTANT },
      },
    });
  });

  it('hydration discards a decision older than maxAge', () => {
    const consent = createConsentManager({
      purposes: { ads: {} },
      record: { format: 1, decisions: { ads: { status: 'granted', decidedAt: INSTANT - 1_000 } } },
      now: () => INSTANT,
      maxAge: 1_000,
    });

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });
});

describe('compiled package, imported by the name lgpder/storage', () => {
  it('the runtime exports are connectStorage, cookieAdapter and localStorageAdapter', async () => {
    const exported = await import('lgpder/storage');

    assert.deepStrictEqual(Object.keys(exported), [
      'connectStorage',
      'cookieAdapter',
      'localStorageAdapter',
    ]);
  });

  it('on the server, without document, connects in memory and decides', () => {
    const consent = createConsentManager({ purposes: { ads: {} }, now: () => INSTANT });
    const storage = connectStorage(consent);

    storage.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
    assert.equal(storage.isPersisted(), false);
    storage.destroy();
  });
});

describe('compiled package, imported by the name lgpder/scripts', () => {
  it('the only runtime export is connectScripts', async () => {
    const exported = await import('lgpder/scripts');

    assert.deepStrictEqual(Object.keys(exported), ['connectScripts']);
  });

  it('on the server, without document, connects an inert handle', () => {
    const consent = createConsentManager({ purposes: { ads: {} }, now: () => INSTANT });
    const scripts = connectScripts(consent, {
      purposes: { ads: { integrations: ['google-ads'] } },
    });
    const log: string[] = [];

    consent.decide({ ads: 'granted' });
    scripts.onGranted('ads', () => {
      log.push('fn ran');
    });

    assert.deepStrictEqual(log, []);
    assert.equal(scripts.wouldReload({ ads: 'denied' }), false);
    scripts.destroy();
  });
});
