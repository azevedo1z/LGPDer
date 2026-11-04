import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentRecord } from 'lgpder';

import { decisionOf, recordOf, serialized } from './support/records.ts';
import { START, setup, withObjectPollution, type PurposeId } from './support/setup.ts';

const ANALYTICS_GRANTED = decisionOf('granted', { version: '2026-10' });

describe('restore substitui todas as decisões pelo conteúdo válido, sem mesclar', () => {
  it('as decisões ausentes do registro adotado são removidas', () => {
    const { consent } = setup();
    consent.decide({ analytics: 'granted', ads: 'denied' });

    consent.restore(recordOf({ health: decisionOf('denied', { version: '1' }) }));

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      health: decisionOf('denied', { version: '1' }),
    });
  });

  it('não chama o relógio', () => {
    const { consent, clock } = setup();

    consent.restore(recordOf({ ads: decisionOf('granted') }));

    assert.equal(clock.calls(), 0);
  });
});

describe('comparação entrada a entrada e notificação', () => {
  it('uma notificação de origem restore, com adicionadas, removidas e alteradas em ordem', () => {
    const { consent, changes } = setup({
      record: recordOf({ analytics: ANALYTICS_GRANTED, ads: decisionOf('granted') }),
    });

    consent.restore(
      recordOf({ health: decisionOf('granted', { version: '1' }), ads: decisionOf('denied') }),
    );

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['restore', ['analytics', 'ads', 'health']]],
    );
  });

  const SINGLE_FIELD_CHANGES = [
    { difference: 'no status', next: decisionOf('denied', { version: '2026-10' }) },
    { difference: 'na version', next: decisionOf('granted', { version: '2025-01' }) },
    {
      difference: 'no decidedAt',
      next: decisionOf('granted', { version: '2026-10', decidedAt: START + 1 }),
    },
    { difference: 'na presença de version', next: decisionOf('granted') },
  ] as const;

  for (const { difference, next } of SINGLE_FIELD_CHANGES) {
    it(`entrada que difere só ${difference} é alterada e notificada`, () => {
      const { consent, changes } = setup({ record: recordOf({ analytics: ANALYTICS_GRANTED }) });

      consent.restore(recordOf({ analytics: next }));

      assert.deepStrictEqual(
        changes.map(({ changed }) => changed),
        [['analytics']],
      );
    });
  }

  it('version herdada de Object.prototype poluído não iguala decisão sem version a decisão com version', () => {
    const { consent, changes } = setup({ record: recordOf({ ads: decisionOf('granted') }) });

    withObjectPollution({ version: '1' }, () => {
      consent.restore(recordOf({ ads: decisionOf('granted', { version: '1' }) }));
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: decisionOf('granted', { version: '1' }),
    });
    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['restore', ['ads']]],
    );
  });

  it('mudança só de decidedAt notifica restore com a finalidade em changed e mantém status', () => {
    const { consent, changes } = setup({ record: recordOf({ analytics: ANALYTICS_GRANTED }) });
    const before = consent.getSnapshot();

    consent.restore(
      recordOf({ analytics: decisionOf('granted', { version: '2026-10', decidedAt: START + 1 }) }),
    );

    assert.deepStrictEqual(
      changes.map(({ source, changed }) => [source, changed]),
      [['restore', ['analytics']]],
    );
    assert.equal(consent.getSnapshot().status, before.status);
  });
});

describe('restore sem nenhuma entrada diferente é no-op', () => {
  interface RoundTrip {
    readonly form: string;
    readonly toInput: (record: ConsentRecord<PurposeId>) => unknown;
  }

  const ROUND_TRIPS = [
    { form: 'objeto', toInput: (record) => record },
    { form: 'texto JSON', toInput: (record) => JSON.stringify(record) },
    {
      form: 'objeto vindo de JSON.parse',
      toInput: (record): unknown => JSON.parse(JSON.stringify(record)),
    },
  ] as const satisfies readonly RoundTrip[];

  for (const { form, toInput } of ROUND_TRIPS) {
    it(`restore do próprio registro em ${form}: mesmo snapshot e nenhuma notificação`, () => {
      const { consent, changes } = setup({
        record: recordOf({ analytics: ANALYTICS_GRANTED, ads: decisionOf('denied') }),
      });
      const before = consent.getSnapshot();

      consent.restore(toInput(before.record));

      assert.equal(consent.getSnapshot(), before);
      assert.deepStrictEqual(changes, []);
    });
  }

  it('restore(null) sem decisões: mesmo snapshot e nenhuma notificação', () => {
    const { consent, changes } = setup();
    const before = consent.getSnapshot();

    consent.restore(null);

    assert.equal(consent.getSnapshot(), before);
    assert.deepStrictEqual(changes, []);
  });
});

describe('entradas iguais mantêm a referência da decisão atual', () => {
  it('a decisão igual por valor, vinda de texto JSON, mantém o objeto atual', () => {
    const { consent } = setup({
      record: recordOf({ analytics: ANALYTICS_GRANTED, ads: decisionOf('granted') }),
    });
    const kept = consent.getSnapshot().record.decisions.analytics;

    consent.restore(serialized({ analytics: ANALYTICS_GRANTED, ads: decisionOf('denied') }));

    assert.equal(consent.getSnapshot().record.decisions.analytics, kept);
  });
});

describe('restore adota um registro externo e não é revogação', () => {
  it('restore(null) com decisões deixa todas as finalidades pending, e não denied, e notifica restore', () => {
    const { consent, changes } = setup();
    consent.grantAll();

    consent.restore(null);

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'pending',
      ads: 'pending',
      health: 'pending',
    });
    assert.deepStrictEqual(
      changes.map(({ source }) => source),
      ['decision', 'restore'],
    );
  });

  it('restore de registro antigo substitui uma revogação local mais recente', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    const backendRecord = JSON.stringify(consent.getSnapshot().record);
    clock.advance(60_000);
    consent.decide({ ads: 'denied' });

    consent.restore(backendRecord);

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });
});
