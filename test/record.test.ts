import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import type { ConsentManager } from 'lgpder';

import { createConsentManager } from '../src/index.ts';
import { decisionOf, recordOf, serialized } from './support/records.ts';
import {
  PURPOSES,
  START,
  setup,
  withArrayPollution,
  withObjectPollution,
  withPrototype,
  type PurposeId,
} from './support/setup.ts';

const EMPTY_RECORD = { format: 1, decisions: {} };

/** Decisões válidas que um registro inválido na raiz não pode fazer valer. */
const VALID_DECISIONS = { ads: decisionOf('granted') };

const VALID_ANALYTICS = decisionOf('granted', { version: '2026-10' });

/**
 * Texto exato do registro com `analytics` concedida e `ads` recusada: decisões na ordem da
 * configuração e campos na ordem `status`, `version`, `decidedAt`.
 */
const SERIALIZED_RECORD =
  '{"format":1,"decisions":{' +
  '"analytics":{"status":"granted","version":"2026-10","decidedAt":1793448000000},' +
  '"ads":{"status":"denied","decidedAt":1793448000000}}}';

describe('registro inválido na raiz equivale a registro vazio', () => {
  const INVALID_ROOTS = [
    { scenario: 'null', record: null },
    { scenario: 'undefined', record: undefined },
    { scenario: 'texto com JSON inválido', record: '{"format":1,' },
    { scenario: "texto vazio ''", record: '' },
    { scenario: "texto 'null'", record: 'null' },
    { scenario: "texto '[]'", record: '[]' },
    { scenario: 'número 42', record: 42 },
    { scenario: 'booleano true', record: true },
    { scenario: 'array', record: [VALID_DECISIONS] },
    {
      scenario: 'objeto com outro protótipo',
      record: withPrototype({ format: 1, decisions: VALID_DECISIONS }, {}),
    },
    { scenario: 'format igual a 2', record: { format: 2, decisions: VALID_DECISIONS } },
    {
      scenario: 'format igual ao texto "1"',
      record: { format: '1', decisions: VALID_DECISIONS },
    },
    { scenario: 'format ausente', record: { decisions: VALID_DECISIONS } },
    { scenario: 'decisions ausente', record: { format: 1 } },
    { scenario: 'decisions null', record: { format: 1, decisions: null } },
    {
      scenario: 'decisions em array',
      record: { format: 1, decisions: [decisionOf('granted')] },
    },
    {
      scenario: 'decisions com outro protótipo',
      record: { format: 1, decisions: withPrototype({ ads: decisionOf('granted') }, {}) },
    },
  ] as const;

  for (const { scenario, record } of INVALID_ROOTS) {
    it(`hidratação com ${scenario}: registro vazio, sem lançar`, () => {
      const { consent } = setup({ record });

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });

    it(`restore com ${scenario}, a partir de um estado com decisões: registro vazio, sem lançar`, () => {
      const { consent } = setup();
      consent.grantAll();

      consent.restore(record);

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });
  }
});

describe('entrada inválida é descartada sozinha', () => {
  const INVALID_ENTRIES = [
    { scenario: "status 'GRANTED'", entry: { status: 'GRANTED', decidedAt: START } },
    { scenario: 'status true', entry: { status: true, decidedAt: START } },
    { scenario: 'status ausente', entry: { decidedAt: START } },
    { scenario: "status 'pending'", entry: { status: 'pending', decidedAt: START } },
    {
      scenario: "decidedAt em texto '1793448000000'",
      entry: { status: 'granted', decidedAt: '1793448000000' },
    },
    { scenario: 'decidedAt -1', entry: { status: 'granted', decidedAt: -1 } },
    { scenario: 'decidedAt 1.5', entry: { status: 'granted', decidedAt: 1.5 } },
    { scenario: 'decidedAt null', entry: { status: 'granted', decidedAt: null } },
    { scenario: 'decidedAt ausente', entry: { status: 'granted' } },
    {
      scenario: 'decidedAt acima de Number.MAX_SAFE_INTEGER',
      entry: { status: 'granted', decidedAt: 2 ** 53 },
    },
    { scenario: "version ''", entry: { status: 'granted', version: '', decidedAt: START } },
    { scenario: 'version 2', entry: { status: 'granted', version: 2, decidedAt: START } },
    {
      scenario: 'version null',
      entry: { status: 'granted', version: null, decidedAt: START },
    },
    { scenario: 'entrada null', entry: null },
    { scenario: 'entrada em array', entry: [] },
    { scenario: "entrada em texto 'granted'", entry: 'granted' },
    {
      scenario: 'entrada com outro protótipo',
      entry: withPrototype({ status: 'granted', decidedAt: START }, {}),
    },
  ] as const;

  for (const { scenario, entry } of INVALID_ENTRIES) {
    it(`entrada de ads com ${scenario}: só ads fica sem decisão`, () => {
      const { consent } = setup({ record: recordOf({ analytics: VALID_ANALYTICS, ads: entry }) });

      assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
        analytics: VALID_ANALYTICS,
      });
    });
  }

  it('version com undefined no objeto lido equivale a version ausente', () => {
    const { consent } = setup({
      record: recordOf({ ads: { status: 'granted', version: undefined, decidedAt: START } }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('registro, decisions e entradas com protótipo nulo são objetos simples e são aceitos', () => {
    const entry = withPrototype({ status: 'granted', decidedAt: START }, null);
    const record = withPrototype(
      { format: 1, decisions: withPrototype({ ads: entry }, null) },
      null,
    );

    const { consent } = setup({ record });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });
});

describe('registro como dado não confiável', () => {
  it('campos extras na entrada são ignorados e não copiados', () => {
    const { consent } = setup({
      record: recordOf({ ads: { status: 'granted', decidedAt: START, userId: 'u-1' } }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('campos extras na raiz são ignorados e não copiados', () => {
    const { consent } = setup({
      record: { format: 1, decisions: VALID_DECISIONS, userId: 'u-1' },
    });

    assert.deepStrictEqual(consent.getSnapshot().record, recordOf(VALID_DECISIONS));
  });

  it('ids desconhecidos em decisions são ignorados', () => {
    const { consent } = setup({
      record: recordOf({ typo: decisionOf('granted'), ads: decisionOf('granted') }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('chave __proto__ em texto JSON é ignorada e nenhum protótipo é alterado', () => {
    const record =
      '{"format":1,"decisions":{' +
      `"__proto__":{"status":"granted","decidedAt":${String(START)}},` +
      `"ads":{"status":"denied","decidedAt":${String(START)}}}}`;

    const { decisions } = setup({ record }).consent.getSnapshot().record;

    assert.deepStrictEqual(decisions, { ads: decisionOf('denied') });
    assert.equal(Object.getPrototypeOf(decisions), Object.prototype);
  });

  /** Hidrata a fixture com propriedades herdadas de `Object.prototype` e desfaz a poluição. */
  function hydrateUnderPollution(
    pollution: Readonly<Record<string, unknown>>,
    record: unknown,
  ): ConsentManager<PurposeId> {
    return withObjectPollution(pollution, () =>
      createConsentManager({ purposes: PURPOSES, record }),
    );
  }

  // Um campo herdado por vez, com os demais próprios e válidos: assim a leitura de cada campo é
  // verificada sozinha, sem que outro campo ausente mantenha a entrada ou a raiz inválida.
  const POLLUTIONS = [
    {
      scenario: 'format herdado não completa a raiz',
      pollution: { format: 1 },
      record: { decisions: VALID_DECISIONS },
    },
    {
      scenario: 'decisions herdado não completa a raiz',
      pollution: { decisions: VALID_DECISIONS },
      record: { format: 1 },
    },
    {
      scenario: 'entrada herdada não completa decisions',
      pollution: { ads: decisionOf('granted') },
      record: recordOf({}),
    },
    {
      scenario: 'status herdado não completa a entrada',
      pollution: { status: 'granted' },
      record: recordOf({ ads: { decidedAt: START } }),
    },
    {
      scenario: 'decidedAt herdado não completa a entrada',
      pollution: { decidedAt: START },
      record: recordOf({ ads: { status: 'granted' } }),
    },
    {
      scenario: 'status e decidedAt herdados não completam entradas',
      pollution: { status: 'granted', decidedAt: START },
      record: recordOf({ ads: {}, analytics: { status: 'granted', version: '2026-10' } }),
    },
    {
      scenario: 'format e decisions herdados não completam a raiz',
      pollution: { format: 1, decisions: VALID_DECISIONS },
      record: {},
    },
  ] as const;

  for (const { scenario, pollution, record } of POLLUTIONS) {
    it(`Object.prototype poluído: ${scenario}`, () => {
      const consent = hydrateUnderPollution(pollution, record);

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });
  }

  it('Object.prototype poluído com version: decisão salva sem versão continua desatualizada', () => {
    const consent = hydrateUnderPollution(
      { version: '2026-10' },
      recordOf({ analytics: decisionOf('granted') }),
    );

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', true]);
  });

  it('Array.prototype poluído com uma decisão: restore de conteúdo inválido equivale a registro vazio', () => {
    const { consent } = setup();

    withArrayPollution(decisionOf('granted'), () => {
      consent.restore(null);
    });

    assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
  });

  const FOREIGN_SOURCE = `({ format: 1, decisions: { ads: { status: 'granted', decidedAt: ${String(START)} } } })`;

  it('objeto criado em outro realm não é objeto simples: registro vazio', () => {
    const foreign: unknown = runInNewContext(FOREIGN_SOURCE);

    const { consent } = setup({ record: foreign });

    assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
  });

  it('o mesmo conteúdo de outro realm, em texto JSON, é aceito', () => {
    const foreign: unknown = runInNewContext(FOREIGN_SOURCE);

    const { consent } = setup({ record: JSON.stringify(foreign) });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('registro com estrutura válida editado pelo titular é aceito', () => {
    const edited = serialized({ ads: decisionOf('denied') }).replace('"denied"', '"granted"');

    const { consent } = setup({ record: edited });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('decidedAt no futuro é aceito', () => {
    const future = START + 10 * 365 * 24 * 60 * 60 * 1_000;

    const { consent } = setup({
      record: recordOf({ ads: decisionOf('granted', { decidedAt: future }) }),
    });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: decisionOf('granted', { decidedAt: future }),
    });
  });

  it('getter de options.record que lança: a criação não lança e o registro é vazio', () => {
    const consent = createConsentManager({
      purposes: PURPOSES,
      get record(): unknown {
        throw new Error('registro indisponível');
      },
    });

    assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
  });
});

describe('getter que lança ou proxy hostil resultam em registro vazio, sem erro', () => {
  const HOSTILE = new Error('registro hostil');

  /** Proxy que lança em qualquer inspeção. */
  function hostileProxy(): object {
    const fail = (): never => {
      throw HOSTILE;
    };
    return new Proxy(
      {},
      { getPrototypeOf: fail, get: fail, has: fail, ownKeys: fail, getOwnPropertyDescriptor: fail },
    );
  }

  const HOSTILE_RECORDS = [
    { scenario: 'proxy que lança em qualquer inspeção', record: hostileProxy() },
    {
      scenario: 'getter de format que lança',
      record: {
        get format() {
          throw HOSTILE;
        },
        decisions: VALID_DECISIONS,
      },
    },
    {
      scenario: 'getter de decisions que lança',
      record: {
        format: 1,
        get decisions() {
          throw HOSTILE;
        },
      },
    },
    { scenario: 'decisions em proxy hostil', record: { format: 1, decisions: hostileProxy() } },
    {
      scenario: 'getter de uma entrada que lança, mesmo com outra entrada válida',
      record: {
        format: 1,
        decisions: {
          analytics: VALID_ANALYTICS,
          get ads() {
            throw HOSTILE;
          },
        },
      },
    },
    {
      scenario: 'getter de status que lança, mesmo com outra entrada válida',
      record: {
        format: 1,
        decisions: {
          analytics: VALID_ANALYTICS,
          ads: {
            get status() {
              throw HOSTILE;
            },
            decidedAt: START,
          },
        },
      },
    },
  ] as const;

  for (const { scenario, record } of HOSTILE_RECORDS) {
    it(`hidratação com ${scenario}: registro vazio, sem lançar`, () => {
      const { consent } = setup({ record });

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });

    it(`restore com ${scenario}: registro vazio, sem lançar`, () => {
      const { consent } = setup({ record: recordOf(VALID_DECISIONS) });

      consent.restore(record);

      assert.deepStrictEqual(consent.getSnapshot().record, EMPTY_RECORD);
    });
  }
});

describe('snapshot inicial é o de servidor quando a hidratação não produz decisão válida', () => {
  const NO_VALID_DECISION = [
    { scenario: 'sem registro', record: undefined },
    { scenario: 'registro inválido', record: '{"format":1,' },
    {
      scenario: 'registro só com ids desconhecidos',
      record: recordOf({ typo: decisionOf('granted') }),
    },
    {
      scenario: 'registro só com entradas inválidas',
      record: recordOf({ ads: { status: 'granted' } }),
    },
  ] as const;

  for (const { scenario, record } of NO_VALID_DECISION) {
    it(`${scenario}: getSnapshot devolve o próprio objeto de getServerSnapshot`, () => {
      const { consent } = setup({ record });

      assert.equal(consent.getSnapshot(), consent.getServerSnapshot());
    });
  }
});

describe('ida e volta e serialização determinística', () => {
  it('instante -0 do relógio é gravado como 0, e a ida e volta pelo JSON é exata', () => {
    const consent = createConsentManager({ purposes: { ads: {} }, now: () => -0 });
    consent.decide({ ads: 'granted' });
    const { record } = consent.getSnapshot();

    const copy = createConsentManager({ purposes: { ads: {} }, record: JSON.stringify(record) });

    assert.deepStrictEqual(copy.getSnapshot().record, record);
  });

  it('JSON.stringify do registro produz o texto exato, com as decisões na ordem da configuração', () => {
    const { consent } = setup();

    consent.decide({ ads: 'denied', analytics: 'granted' });

    assert.equal(JSON.stringify(consent.getSnapshot().record), SERIALIZED_RECORD);
  });

  it('registro hidratado com chaves em outra ordem é serializado na ordem canônica', () => {
    const { consent } = setup({
      record: {
        decisions: {
          ads: { decidedAt: START, status: 'denied' },
          analytics: { decidedAt: START, version: '2026-10', status: 'granted' },
        },
        format: 1,
      },
    });

    assert.equal(JSON.stringify(consent.getSnapshot().record), SERIALIZED_RECORD);
  });

  it('outra instância com a mesma configuração e o registro em JSON tem snapshot igual', () => {
    const { consent } = setup();
    consent.decide({ analytics: 'granted', health: 'denied' });
    const snapshot = consent.getSnapshot();

    const copy = createConsentManager({
      purposes: PURPOSES,
      record: JSON.stringify(snapshot.record),
    });

    assert.deepStrictEqual(copy.getSnapshot(), snapshot);
  });
});
