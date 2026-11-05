import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConsentManager } from 'lgpder';
import { connectEvidence } from 'lgpder/evidence';
import { connectGoogle, consentDefaultSnippet } from 'lgpder/google';
import { connectScripts } from 'lgpder/scripts';
import { connectStorage } from 'lgpder/storage';
import { createPlaceholder, mountUi, ptBR } from 'lgpder/ui';

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

describe('compiled package, imported by the name lgpder/google', () => {
  it('the runtime exports are connectGoogle and consentDefaultSnippet', async () => {
    const exported = await import('lgpder/google');

    assert.deepStrictEqual(Object.keys(exported), ['connectGoogle', 'consentDefaultSnippet']);
    assert.match(consentDefaultSnippet, /^window\.dataLayer=window\.dataLayer\|\|\[\];/);
  });

  it('on the server, without document, validates and connects an inert handle', () => {
    const consent = createConsentManager({ purposes: { ads: {} }, now: () => INSTANT });
    const google = connectGoogle(consent, {
      purposes: { ads: { integrations: ['google-ads'] } },
    });

    consent.decide({ ads: 'granted' });

    assert.equal(Reflect.has(globalThis, 'dataLayer'), false);
    google.destroy();
    assert.throws(
      () => Reflect.apply(connectGoogle, undefined, [consent, { purposes: { typo: {} } }]),
      { name: 'RangeError', message: '[lgpder] Unknown purpose: "typo".' },
    );
  });
});

describe('compiled package, imported by the name lgpder/evidence', () => {
  it('the only runtime export is connectEvidence', async () => {
    const exported = await import('lgpder/evidence');

    assert.deepStrictEqual(Object.keys(exported), ['connectEvidence']);
  });

  it('on the server, without document, validates and connects an inert handle', () => {
    const consent = createConsentManager({ purposes: { ads: {} }, now: () => INSTANT });
    const reported: unknown[] = [];
    const evidence = connectEvidence(consent, {
      endpoint: '/api/consent',
      onDecision: (change) => {
        reported.push(change);
      },
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(reported, []);
    evidence.destroy();
    assert.throws(() => connectEvidence(consent, { endpoint: 'http://a.test/' }), {
      name: 'TypeError',
      message: '[lgpder] "endpoint" must be an HTTPS URL, or HTTP on localhost.',
    });
  });
});

describe('compiled package, imported by the name lgpder/ui', () => {
  it('the runtime exports are createPlaceholder, mountUi and ptBR', async () => {
    const exported = await import('lgpder/ui');

    assert.deepStrictEqual(Object.keys(exported), ['createPlaceholder', 'mountUi', 'ptBR']);
    assert.equal(ptBR.lang, 'pt-BR');
  });

  it('on the server, without document, validates and mounts an inert handle', () => {
    const consent = createConsentManager({ purposes: { ads: {} }, now: () => INSTANT });
    const ui = mountUi(consent, { purposes: { ads: { title: 'Publicidade' } } });

    ui.openPreferences(['ads']);
    ui.destroy();

    assert.equal(typeof createPlaceholder(consent), 'function');
    assert.throws(() => mountUi(consent, { texts: { banner: { title: '' } } }), {
      name: 'TypeError',
      message: '[lgpder] "texts.banner.title" must be a non-empty string.',
    });
  });
});
