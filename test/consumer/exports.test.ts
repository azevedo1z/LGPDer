import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConsentManager } from 'lgpder';

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
