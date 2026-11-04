import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConsentManager } from '../src/index.ts';
import { decisionOf, recordOf } from './support/records.ts';
import { PURPOSES, START, callUntyped, createUntyped, setup } from './support/setup.ts';

describe('grantAll', () => {
  it('concede só as finalidades sem individualGrant: health continua pending', () => {
    const { consent } = setup();

    consent.grantAll();

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('grava uma decisão por finalidade elegível, todas com o mesmo decidedAt', () => {
    let tick = START;
    const consent = createConsentManager({ purposes: PURPOSES, now: () => tick++ });

    consent.grantAll();

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '2026-10' }),
      ads: decisionOf('granted'),
    });
  });

  it('produz uma única notificação de origem decision com as finalidades gravadas', () => {
    const { consent, changes } = setup();

    consent.grantAll();

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['decision', ['analytics', 'ads']]],
    );
  });

  it('individualGrant: false informado explicitamente mantém a finalidade elegível', () => {
    const { consent } = setup({ purposes: { ads: { individualGrant: false } } });

    consent.grantAll();

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('grava só as finalidades elegíveis cuja situação muda', () => {
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

  it('a segunda chamada seguida é no-op: mesmo snapshot e relógio não chamado de novo', () => {
    const { consent, clock } = setup();
    consent.grantAll();
    const after = consent.getSnapshot();

    consent.grantAll();

    assert.equal(consent.getSnapshot(), after);
    assert.equal(clock.calls(), 1);
  });

  it('com todas as finalidades marcadas individualGrant, é no-op', () => {
    const { consent, clock } = setup({
      purposes: { health: { individualGrant: true }, kids: { individualGrant: true } },
    });
    const before = consent.getSnapshot();

    consent.grantAll();

    assert.equal(consent.getSnapshot(), before);
    assert.equal(clock.calls(), 0);
  });

  it('argumentos são ignorados: não concedem health', () => {
    const { consent } = setup();

    callUntyped(consent.grantAll, { health: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('relógio inválido: TypeError e nada é alterado', () => {
    const consent = createUntyped({ purposes: PURPOSES, now: () => 1.5 });
    const before = consent.getSnapshot();

    assert.throws(() => {
      consent.grantAll();
    }, TypeError);

    assert.equal(consent.getSnapshot(), before);
  });
});

describe('denyAll', () => {
  it('recusa todas as finalidades, inclusive health, marcada com individualGrant', () => {
    const { consent } = setup();

    consent.denyAll();

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'denied',
      health: 'denied',
    });
  });

  it('finalidades pending passam a ter recusa registrada, com o mesmo decidedAt', () => {
    let tick = START;
    const consent = createConsentManager({ purposes: PURPOSES, now: () => tick++ });

    consent.denyAll();

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('denied', { version: '2026-10' }),
      ads: decisionOf('denied'),
      health: decisionOf('denied', { version: '1' }),
    });
  });

  it('revoga as finalidades concedidas com novo decidedAt', () => {
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

  it('produz uma única notificação de origem decision com as finalidades gravadas', () => {
    const { consent, changes } = setup({ record: recordOf({ ads: decisionOf('denied') }) });

    consent.denyAll();

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['decision', ['analytics', 'health']]],
    );
  });

  it('a segunda chamada seguida é no-op: mesmo snapshot e relógio não chamado de novo', () => {
    const { consent, clock } = setup();
    consent.denyAll();
    const after = consent.getSnapshot();

    consent.denyAll();

    assert.equal(consent.getSnapshot(), after);
    assert.equal(clock.calls(), 1);
  });

  it('recusa as finalidades individualGrant, que grantAll não alcança', () => {
    const { consent } = setup({
      purposes: { health: { individualGrant: true }, kids: { individualGrant: true } },
    });

    consent.denyAll();

    assert.deepStrictEqual(consent.getSnapshot().status, { health: 'denied', kids: 'denied' });
  });

  it('argumentos são ignorados: não concedem ads', () => {
    const { consent } = setup();

    callUntyped(consent.denyAll, { ads: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'denied',
      health: 'denied',
    });
  });

  it('relógio inválido: TypeError e nada é alterado', () => {
    const consent = createUntyped({ purposes: PURPOSES, now: () => 1.5 });
    const before = consent.getSnapshot();

    assert.throws(() => {
      consent.denyAll();
    }, TypeError);

    assert.equal(consent.getSnapshot(), before);
  });
});
