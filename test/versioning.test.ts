import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decisionOf, recordOf, serialized } from './support/records.ts';
import { setup } from './support/setup.ts';

describe('situação efetiva a partir da versão configurada e da decisão registrada', () => {
  const CASES = [
    {
      scenario: 'sem decisão, finalidade versionada',
      config: { version: '1' },
      record: undefined,
      status: 'pending',
      outdated: false,
    },
    {
      scenario: 'sem decisão, finalidade sem versão',
      config: {},
      record: undefined,
      status: 'pending',
      outdated: false,
    },
    {
      scenario: 'concessão sob a versão vigente',
      config: { version: '1' },
      record: recordOf({ item: decisionOf('granted', { version: '1' }) }),
      status: 'granted',
      outdated: false,
    },
    {
      scenario: 'recusa sob a versão vigente',
      config: { version: '1' },
      record: recordOf({ item: decisionOf('denied', { version: '1' }) }),
      status: 'denied',
      outdated: false,
    },
    {
      scenario: 'concessão sem versão em finalidade sem versão (ausente e ausente são iguais)',
      config: {},
      record: recordOf({ item: decisionOf('granted') }),
      status: 'granted',
      outdated: false,
    },
    {
      scenario: 'recusa sem versão em finalidade sem versão',
      config: {},
      record: recordOf({ item: decisionOf('denied') }),
      status: 'denied',
      outdated: false,
    },
    {
      scenario: 'concessão sob versão anterior',
      config: { version: '2' },
      record: recordOf({ item: decisionOf('granted', { version: '1' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: 'recusa sob versão anterior',
      config: { version: '2' },
      record: recordOf({ item: decisionOf('denied', { version: '1' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: "versões '10' e '9' são apenas diferentes, sem ordenação",
      config: { version: '9' },
      record: recordOf({ item: decisionOf('granted', { version: '10' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: 'versões comparadas por igualdade estrita, sem normalizar caixa',
      config: { version: 'v1' },
      record: recordOf({ item: decisionOf('granted', { version: 'V1' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: 'decisão com versão em finalidade sem versão',
      config: {},
      record: recordOf({ item: decisionOf('granted', { version: '1' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: 'decisão sem versão em finalidade versionada',
      config: { version: '1' },
      record: recordOf({ item: decisionOf('granted') }),
      status: 'pending',
      outdated: true,
    },
  ] as const;

  for (const { scenario, config, record, status, outdated } of CASES) {
    it(`${scenario}: '${status}', outdated ${String(outdated)}`, () => {
      const { consent } = setup({ purposes: { item: config }, record });

      const snapshot = consent.getSnapshot();

      assert.deepStrictEqual(
        { status: snapshot.status.item, outdated: snapshot.outdated.item },
        { status, outdated },
      );
    });
  }
});

describe('somente granted autoriza, e só uma concessão explícita o produz', () => {
  const PATHS = [
    { path: 'criação sem registro', consentAfter: () => setup().consent },
    {
      path: 'hidratação de concessão sem decidedAt',
      consentAfter: () =>
        setup({ record: '{"format":1,"decisions":{"ads":{"status":"granted"}}}' }).consent,
    },
    {
      path: 'hidratação de concessão sob outra versão',
      consentAfter: () =>
        setup({ record: recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) }) })
          .consent,
    },
    {
      path: 'decide com denied',
      consentAfter: () => {
        const { consent } = setup();
        consent.decide({ analytics: 'denied', ads: 'denied' });
        return consent;
      },
    },
    {
      path: 'denyAll',
      consentAfter: () => {
        const { consent } = setup();
        consent.denyAll();
        return consent;
      },
    },
    {
      path: 'restore de registro inválido depois de grantAll',
      consentAfter: () => {
        const { consent } = setup();
        consent.grantAll();
        consent.restore('{"format":1,');
        return consent;
      },
    },
  ] as const;

  for (const { path, consentAfter } of PATHS) {
    it(`${path}: nenhuma finalidade fica granted`, () => {
      const consent = consentAfter();

      const statuses = Object.values(consent.getSnapshot().status);

      assert.equal(statuses.includes('granted'), false);
    });
  }
});

describe('chaves do snapshot na ordem da configuração', () => {
  it('status e outdated listam todas as finalidades configuradas, na ordem da configuração', () => {
    const { consent } = setup({
      purposes: { zeta: {}, alpha: { version: '1' }, mid: {} },
      record: recordOf({
        mid: decisionOf('granted'),
        alpha: decisionOf('denied', { version: '0' }),
      }),
    });

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual(
      [Object.keys(status), Object.keys(outdated)],
      [
        ['zeta', 'alpha', 'mid'],
        ['zeta', 'alpha', 'mid'],
      ],
    );
  });

  it('record.decisions tem só as finalidades decididas, vigentes ou desatualizadas, em ordem', () => {
    const { consent } = setup({
      record: recordOf({
        health: decisionOf('granted', { version: '0' }),
        analytics: decisionOf('denied', { version: '2026-10' }),
      }),
    });

    const { decisions } = consent.getSnapshot().record;

    assert.deepStrictEqual(Object.keys(decisions), ['analytics', 'health']);
  });
});

describe('retorno a pending', () => {
  it('restore sem decisão válida para a finalidade a devolve a pending', () => {
    const { consent } = setup();
    consent.decide({ analytics: 'granted', ads: 'granted' });

    consent.restore(recordOf({ analytics: decisionOf('granted', { version: '2026-10' }) }));

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('restore de decisão registrada sob outra versão devolve a finalidade a pending, com outdated true', () => {
    const { consent } = setup();
    consent.decide({ analytics: 'granted' });

    consent.restore(recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) }));

    const { status, outdated } = consent.getSnapshot();
    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', true]);
  });
});

describe('outdated volta a false quando a decisão desatualizada é substituída ou removida', () => {
  /** analytics concedida sob a versão anterior à da fixture: pending e desatualizada. */
  const STALE_ANALYTICS = recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) });

  it('nova decisão sobre a finalidade desatualizada: granted, com outdated false', () => {
    const { consent } = setup({ record: STALE_ANALYTICS });

    consent.decide({ analytics: 'granted' });

    const { status, outdated } = consent.getSnapshot();
    assert.deepStrictEqual([status.analytics, outdated.analytics], ['granted', false]);
  });

  it('restore que remove a decisão desatualizada: pending, com outdated false', () => {
    const { consent } = setup({ record: STALE_ANALYTICS });

    consent.restore(null);

    const { status, outdated } = consent.getSnapshot();
    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', false]);
  });
});

describe('versão vigente e decisões desatualizadas', () => {
  it('a versão vigente não muda durante a vida da instância, mesmo alterando a configuração', () => {
    const analytics = { version: '1' };
    const { consent } = setup({ purposes: { analytics } });

    analytics.version = '2';
    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '1' }),
    });
  });

  it('decisão desatualizada permanece intacta no registro, sem virar denied, até ser substituída', () => {
    const outdated = decisionOf('granted', { version: '2025-01' });
    const { consent } = setup({ record: recordOf({ analytics: outdated }) });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions.analytics, outdated);
  });

  it('o registro usa format 1, independentemente das versões das finalidades', () => {
    const { consent } = setup({ purposes: { analytics: { version: '2' } } });

    consent.decide({ analytics: 'granted' });

    assert.equal(consent.getSnapshot().record.format, 1);
  });
});

describe('versão alterada entre deploys', () => {
  const NEXT_PURPOSES = { analytics: { version: '2026-11' } } as const;

  /** Registro gravado pelo deploy anterior, que concedeu analytics na versão 2026-10. */
  function previousDeployRecord(): string {
    const { consent } = setup({ purposes: { analytics: { version: '2026-10' } } });
    consent.decide({ analytics: 'granted' });
    return JSON.stringify(consent.getSnapshot().record);
  }

  it('a finalidade fica pending, com outdated true', () => {
    const { consent } = setup({ purposes: NEXT_PURPOSES, record: previousDeployRecord() });

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', true]);
  });

  it('a decisão anterior é preservada no registro', () => {
    const { consent } = setup({ purposes: NEXT_PURPOSES, record: previousDeployRecord() });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '2026-10' }),
    });
  });

  it('nova decisão com o mesmo valor grava a versão nova e notifica', () => {
    const { consent, changes } = setup({
      purposes: NEXT_PURPOSES,
      record: previousDeployRecord(),
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '2026-11' }),
    });
    assert.equal(changes.length, 1);
  });
});

describe('mudanças de configuração entre deploys', () => {
  it('voltar à versão anterior torna vigentes de novo as decisões registradas sob ela', () => {
    const first = setup({ purposes: { analytics: { version: '1' } } });
    first.consent.decide({ analytics: 'granted' });
    const second = setup({
      purposes: { analytics: { version: '2' } },
      record: JSON.stringify(first.consent.getSnapshot().record),
    });

    const third = setup({
      purposes: { analytics: { version: '1' } },
      record: JSON.stringify(second.consent.getSnapshot().record),
    });

    assert.equal(third.consent.getSnapshot().status.analytics, 'granted');
  });

  const VERSION_CHANGES = [
    {
      scenario: 'versão removida: a decisão com versão fica desatualizada',
      before: { version: '1' },
      after: {},
    },
    {
      scenario: 'versão adicionada: a decisão sem versão fica desatualizada',
      before: {},
      after: { version: '1' },
    },
  ] as const;

  for (const { scenario, before, after } of VERSION_CHANGES) {
    it(scenario, () => {
      const previous = setup({ purposes: { analytics: before } });
      previous.consent.decide({ analytics: 'granted' });

      const { consent } = setup({
        purposes: { analytics: after },
        record: JSON.stringify(previous.consent.getSnapshot().record),
      });

      const { status, outdated } = consent.getSnapshot();
      assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', true]);
    });
  }

  it('finalidade nova nasce pending, sem outdated', () => {
    const { consent } = setup({
      purposes: { analytics: { version: '1' }, newsletter: {} },
      record: serialized({ analytics: decisionOf('granted', { version: '1' }) }),
    });

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual([status.newsletter, outdated.newsletter], ['pending', false]);
  });

  it('decisão de finalidade removida é ignorada e some do registro a gravar', () => {
    const { consent } = setup({
      purposes: { analytics: { version: '1' } },
      record: serialized({
        analytics: decisionOf('granted', { version: '1' }),
        legacy: decisionOf('granted'),
      }),
    });

    assert.equal(
      JSON.stringify(consent.getSnapshot().record),
      serialized({ analytics: decisionOf('granted', { version: '1' }) }),
    );
  });
});
