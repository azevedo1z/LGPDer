import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConsentManager } from '../../src/index.ts';
import { decisionOf, recordOf } from '../support/records.ts';
import { PURPOSES, START, callUntyped, createUntyped, setup } from '../support/setup.ts';

describe('grantAll', () => {
  it('grants only the purposes without individualGrant: health stays pending', () => {
    const { consent } = setup();

    consent.grantAll();

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('records one decision per eligible purpose, all with the same decidedAt', () => {
    let tick = START;
    const consent = createConsentManager({ purposes: PURPOSES, now: () => tick++ });

    consent.grantAll();

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '2026-10' }),
      ads: decisionOf('granted'),
    });
  });

  it('produces a single notification with source decision and the written purposes', () => {
    const { consent, changes } = setup();

    consent.grantAll();

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['decision', ['analytics', 'ads']]],
    );
  });

  it('individualGrant: false given explicitly keeps the purpose eligible', () => {
    const { consent } = setup({ purposes: { ads: { individualGrant: false } } });

    consent.grantAll();

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('writes only the eligible purposes whose status changes', () => {
    const { consent, changes } = setup({
      record: recordOf({
        analytics: decisionOf('granted', { version: '2026-10' }),
        ads: decisionOf('denied'),
      }),
    });

    consent.grantAll();

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['ads']],
    );
  });

  it('the second call in a row is a no-op: same snapshot and the clock is not called again', () => {
    const { consent, clock } = setup();
    consent.grantAll();
    const after = consent.getSnapshot();

    consent.grantAll();

    assert.equal(consent.getSnapshot(), after);
    assert.equal(clock.calls(), 1);
  });

  it('with every purpose marked individualGrant, it is a no-op', () => {
    const { consent, clock } = setup({
      purposes: { health: { individualGrant: true }, kids: { individualGrant: true } },
    });
    const before = consent.getSnapshot();

    consent.grantAll();

    assert.equal(consent.getSnapshot(), before);
    assert.equal(clock.calls(), 0);
  });

  it('arguments are ignored: they do not grant health', () => {
    const { consent } = setup();

    callUntyped(consent.grantAll, { health: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('invalid clock: TypeError and nothing changes', () => {
    const consent = createUntyped({ purposes: PURPOSES, now: () => 1.5 });
    const before = consent.getSnapshot();

    assert.throws(() => {
      consent.grantAll();
    }, TypeError);

    assert.equal(consent.getSnapshot(), before);
  });
});

describe('denyAll', () => {
  it('refuses every purpose, including health, marked with individualGrant', () => {
    const { consent } = setup();

    consent.denyAll();

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'denied',
      health: 'denied',
    });
  });

  it('pending purposes get a recorded refusal, with the same decidedAt', () => {
    let tick = START;
    const consent = createConsentManager({ purposes: PURPOSES, now: () => tick++ });

    consent.denyAll();

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('denied', { version: '2026-10' }),
      ads: decisionOf('denied'),
      health: decisionOf('denied', { version: '1' }),
    });
  });

  it('revokes the granted purposes with a new decidedAt', () => {
    const { consent, clock } = setup();
    consent.grantAll();
    clock.advance(60_000);

    consent.denyAll();

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('denied', { version: '2026-10', decidedAt: START + 60_000 }),
      ads: decisionOf('denied', { decidedAt: START + 60_000 }),
      health: decisionOf('denied', { version: '1', decidedAt: START + 60_000 }),
    });
  });

  it('produces a single notification with source decision and the written purposes', () => {
    const { consent, changes } = setup({ record: recordOf({ ads: decisionOf('denied') }) });

    consent.denyAll();

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['decision', ['analytics', 'health']]],
    );
  });

  it('the second call in a row is a no-op: same snapshot and the clock is not called again', () => {
    const { consent, clock } = setup();
    consent.denyAll();
    const after = consent.getSnapshot();

    consent.denyAll();

    assert.equal(consent.getSnapshot(), after);
    assert.equal(clock.calls(), 1);
  });

  it('refuses the individualGrant purposes, which grantAll does not reach', () => {
    const { consent } = setup({
      purposes: { health: { individualGrant: true }, kids: { individualGrant: true } },
    });

    consent.denyAll();

    assert.deepStrictEqual(consent.getSnapshot().status, { health: 'denied', kids: 'denied' });
  });

  it('arguments are ignored: they do not grant ads', () => {
    const { consent } = setup();

    callUntyped(consent.denyAll, { ads: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'denied',
      health: 'denied',
    });
  });

  it('invalid clock: TypeError and nothing changes', () => {
    const consent = createUntyped({ purposes: PURPOSES, now: () => 1.5 });
    const before = consent.getSnapshot();

    assert.throws(() => {
      consent.denyAll();
    }, TypeError);

    assert.equal(consent.getSnapshot(), before);
  });
});
