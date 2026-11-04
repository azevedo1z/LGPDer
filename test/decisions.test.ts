import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentChange } from 'lgpder';

import { createConsentManager } from '../src/index.ts';
import { decisionOf, recordOf } from './support/records.ts';
import {
  PURPOSES,
  START,
  createUntyped,
  decideUntyped,
  setup,
  withArrayPollution,
  withObjectPollution,
  withPrototype,
} from './support/setup.ts';

/** Registro com `analytics` concedida sob a versão vigente da fixture. */
const ANALYTICS_GRANTED = recordOf({ analytics: decisionOf('granted', { version: '2026-10' }) });

describe('decide: conceder, recusar e revogar', () => {
  it('conceder grava status, a versão vigente da finalidade e o instante do relógio', () => {
    const { consent } = setup();

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: { status: 'granted', version: '2026-10', decidedAt: START },
    });
  });

  it('finalidade sem versão configurada grava decisão sem version', () => {
    const { consent } = setup();

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: { status: 'denied', decidedAt: START },
    });
  });

  for (const status of ['granted', 'denied'] as const) {
    it(`decidir '${status}' torna a situação '${status}'`, () => {
      const { consent } = setup();

      consent.decide({ ads: status });

      assert.equal(consent.getSnapshot().status.ads, status);
    });
  }

  it('revogar grava nova decisão denied com novo decidedAt, e o registro guarda só a última', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    clock.advance(60_000);

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: decisionOf('denied', { decidedAt: START + 60_000 }),
    });
  });

  it('a notificação da revogação traz previous com granted e snapshot com denied', () => {
    const { consent, changes } = setup();
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: 'denied' });

    const [, revocation] = changes;
    assert.ok(revocation);
    assert.deepStrictEqual(
      [revocation.previous.status.ads, revocation.snapshot.status.ads],
      ['granted', 'denied'],
    );
  });

  it('sem limite de frequência: conceder e revogar em sequência, no mesmo instante, grava tudo', () => {
    const { consent, changes } = setup();

    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });
    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });

    assert.equal(changes.length, 4);
  });

  it('individualGrant não impede decide de conceder', () => {
    const { consent } = setup();

    consent.decide({ health: 'granted' });

    assert.equal(consent.getSnapshot().status.health, 'granted');
  });
});

describe('validação da entrada inteira antes de qualquer efeito', () => {
  const INVALID_CHOICES = [
    {
      scenario: 'id desconhecido depois de uma escolha válida',
      args: [{ analytics: 'granted', typo: 'denied' }],
      error: RangeError,
    },
    {
      scenario: 'valor booleano no meio do lote',
      args: [{ analytics: 'granted', ads: true, health: 'denied' }],
      error: TypeError,
    },
    {
      scenario: "valor 'GRANTED'",
      args: [{ analytics: 'granted', ads: 'GRANTED' }],
      error: TypeError,
    },
    {
      scenario: "valor 'pending'",
      args: [{ analytics: 'granted', ads: 'pending' }],
      error: TypeError,
    },
    { scenario: 'escolhas null', args: [null], error: TypeError },
    { scenario: 'escolhas em array', args: [['analytics']], error: TypeError },
    {
      scenario: 'escolhas em Map',
      args: [new Map([['analytics', 'granted']])],
      error: TypeError,
    },
    { scenario: 'escolhas em texto', args: ['analytics'], error: TypeError },
    { scenario: 'nenhum argumento', args: [], error: TypeError },
    {
      scenario: 'escolhas com outro protótipo',
      args: [withPrototype({ analytics: 'granted' }, {})],
      error: TypeError,
    },
  ] as const;

  for (const { scenario, args, error } of INVALID_CHOICES) {
    it(`${scenario}: lança ${error.name} sem aplicar nada, sem chamar o relógio e sem notificar`, () => {
      const { consent, clock, changes } = setup();
      const before = consent.getSnapshot();

      assert.throws(() => {
        decideUntyped(consent, ...args);
      }, error);

      assert.equal(consent.getSnapshot(), before);
      assert.equal(clock.calls(), 0);
      assert.deepStrictEqual(changes, []);
    });
  }

  const FIRST_VIOLATION = [
    {
      scenario: 'a chave é verificada antes do valor inválido',
      choices: { typo: true },
      error: RangeError,
    },
    {
      scenario: 'a chave é verificada antes do valor undefined',
      choices: { typo: undefined },
      error: RangeError,
    },
    {
      scenario: 'valor inválido em chave anterior a uma chave desconhecida',
      choices: { ads: 'GRANTED', typo: 'denied' },
      error: TypeError,
    },
    {
      scenario: 'chave desconhecida anterior a um valor inválido',
      choices: { typo: 'denied', ads: 'GRANTED' },
      error: RangeError,
    },
  ] as const;

  for (const { scenario, choices, error } of FIRST_VIOLATION) {
    it(`a primeira violação na ordem de Object.keys define o erro: ${scenario}`, () => {
      const { consent } = setup();

      assert.throws(() => {
        decideUntyped(consent, choices);
      }, error);
    });
  }

  it('lê o valor de cada escolha uma única vez', () => {
    const { consent } = setup();
    let reads = 0;

    consent.decide({
      get ads() {
        reads += 1;
        return 'granted' as const;
      },
    });

    assert.equal(reads, 1);
  });

  it('depois de um erro, as inscrições continuam ativas', () => {
    const { consent, changes } = setup();
    assert.throws(() => {
      decideUntyped(consent, { typo: 'granted' });
    }, RangeError);

    consent.decide({ ads: 'granted' });

    assert.equal(changes.length, 1);
  });

  it('ignora chaves símbolo e propriedades não enumeráveis das escolhas', () => {
    const { consent } = setup();
    const choices = Object.defineProperty({ ads: 'granted', [Symbol('extra')]: 'denied' }, 'typo', {
      value: 'denied',
      enumerable: false,
    });

    decideUntyped(consent, choices);

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'pending',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('ignora escolhas herdadas de um Object.prototype poluído', () => {
    const { consent } = setup();

    withObjectPollution({ analytics: 'granted' }, () => {
      consent.decide({ ads: 'denied' });
    });

    assert.equal(consent.getSnapshot().status.analytics, 'pending');
  });

  it('escolhas com protótipo nulo são aceitas', () => {
    const { consent } = setup();

    decideUntyped(consent, withPrototype({ ads: 'granted' }, null));

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });
});

describe('erro ao confirmar uma decisão não deixa efeito parcial', () => {
  it('a decisão seguinte a uma que lançou ao montar o snapshot não publica a decisão que lançou', () => {
    const { consent, changes } = setup({ purposes: { ads: {}, other: {} } });
    // Propriedade herdada somente leitura com o nome de uma finalidade, criada depois da criação:
    // montar o snapshot atribui status.other e lança.
    withObjectPollution(
      { other: 'pending' },
      () => {
        assert.throws(() => {
          consent.decide({ ads: 'granted' });
        }, TypeError);
      },
      { writable: false },
    );

    consent.decide({ other: 'denied' });

    assert.deepStrictEqual(
      changes.map(({ snapshot }) => snapshot.status),
      [{ ads: 'pending', other: 'denied' }],
    );
  });
});

describe('chamadas sem mudança', () => {
  const NO_OPS = [
    { scenario: 'decide({})', choices: {} },
    { scenario: 'finalidade com undefined', choices: { ads: undefined } },
    { scenario: 'reconfirmação da situação vigente', choices: { analytics: 'granted' } },
  ] as const;

  for (const { scenario, choices } of NO_OPS) {
    it(`${scenario} é no-op completo: mesmo snapshot e relógio não chamado`, () => {
      const { consent, clock } = setup({ record: ANALYTICS_GRANTED });
      const before = consent.getSnapshot();

      consent.decide(choices);

      assert.equal(consent.getSnapshot(), before);
      assert.equal(clock.calls(), 0);
    });
  }

  it('reconfirmar preserva a decisão vigente, com o mesmo decidedAt', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    const decision = consent.getSnapshot().record.decisions.ads;
    clock.advance(60_000);

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.ads, decision);
  });

  it('no lote com outras mudanças, a finalidade reconfirmada mantém a decisão anterior', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    const decision = consent.getSnapshot().record.decisions.ads;
    clock.advance(60_000);

    consent.decide({ ads: 'granted', analytics: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.ads, decision);
  });

  it('finalidade com undefined não muda, mesmo no lote com outras mudanças', () => {
    const { consent, changes } = setup();
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: undefined, analytics: 'granted' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['ads'], ['analytics']],
    );
  });

  it('com Array.prototype poluído por granted, as finalidades omitidas não mudam', () => {
    const { consent } = setup();

    withArrayPollution('granted', () => {
      consent.decide({ analytics: 'granted' });
    });

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'pending',
      health: 'pending',
    });
  });
});

describe('a finalidade só é gravada se o valor pedido difere da situação efetiva', () => {
  const CASES = [
    {
      scenario: 'finalidade sem decisão é gravada',
      record: undefined,
      expected: [['analytics']],
    },
    {
      scenario: 'decisão desatualizada é gravada, mesmo com o mesmo valor',
      record: recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) }),
      expected: [['analytics']],
    },
    {
      scenario: 'decisão vigente com o valor oposto é gravada',
      record: recordOf({ analytics: decisionOf('denied', { version: '2026-10' }) }),
      expected: [['analytics']],
    },
    {
      scenario: 'decisão vigente com o mesmo valor não é gravada',
      record: ANALYTICS_GRANTED,
      expected: [],
    },
  ] as const;

  for (const { scenario, record, expected } of CASES) {
    it(scenario, () => {
      const { consent, changes } = setup({ record });

      consent.decide({ analytics: 'granted' });

      assert.deepStrictEqual(
        changes.map(({ changed }) => changed),
        expected,
      );
    });
  }
});

describe('relógio das decisões', () => {
  it('é chamado exatamente uma vez por chamada efetiva, mesmo com várias finalidades', () => {
    const { consent, clock } = setup();

    consent.decide({ analytics: 'granted', ads: 'granted', health: 'denied' });

    assert.equal(clock.calls(), 1);
  });

  it('decidedAt é o valor devolvido pelo relógio', () => {
    const { consent, clock } = setup();
    clock.advance(1_234);

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.ads?.decidedAt, START + 1_234);
  });

  it('subscribe, getSnapshot e getServerSnapshot não chamam o relógio', () => {
    const { consent, clock } = setup();

    consent.subscribe(() => undefined);
    consent.getSnapshot();
    consent.getServerSnapshot();

    assert.equal(clock.calls(), 0);
  });

  const VALID_INSTANTS = [
    { scenario: 'zero', value: 0 },
    { scenario: 'Number.MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
  ] as const;

  for (const { scenario, value } of VALID_INSTANTS) {
    it(`aceita ${scenario} como instante`, () => {
      const consent = createConsentManager({ purposes: PURPOSES, now: () => value });

      consent.decide({ ads: 'granted' });

      assert.equal(consent.getSnapshot().record.decisions.ads?.decidedAt, value);
    });
  }

  const INVALID_INSTANTS = [
    { scenario: 'NaN', value: Number.NaN },
    { scenario: '1.5', value: 1.5 },
    { scenario: '-1', value: -1 },
    { scenario: "o texto '1'", value: '1' },
    { scenario: 'um objeto Date', value: new Date(START) },
    { scenario: 'Infinity', value: Number.POSITIVE_INFINITY },
    { scenario: 'inteiro acima de Number.MAX_SAFE_INTEGER', value: 2 ** 53 },
  ] as const;

  for (const { scenario, value } of INVALID_INSTANTS) {
    it(`relógio que devolve ${scenario}: TypeError, nada aplicado e nada notificado`, () => {
      const consent = createUntyped({ purposes: PURPOSES, now: () => value });
      const changes: ConsentChange[] = [];
      consent.subscribe((change) => {
        changes.push(change);
      });
      const before = consent.getSnapshot();

      assert.throws(() => {
        consent.decide({ ads: 'granted' });
      }, TypeError);

      assert.equal(consent.getSnapshot(), before);
      assert.deepStrictEqual(changes, []);
    });
  }

  it('relógio que lança: a exceção se propaga intacta e nada é aplicado', () => {
    const failure = new Error('relógio indisponível');
    const consent = createConsentManager({
      purposes: PURPOSES,
      now: () => {
        throw failure;
      },
    });
    const before = consent.getSnapshot();

    assert.throws(
      () => {
        consent.decide({ ads: 'granted' });
      },
      (error) => error === failure,
    );

    assert.equal(consent.getSnapshot(), before);
  });
});

describe('decisões de uma mesma chamada', () => {
  it('compartilham o mesmo decidedAt, mesmo com relógio que avança a cada leitura', () => {
    let tick = START;
    const consent = createConsentManager({ purposes: PURPOSES, now: () => tick++ });

    consent.decide({ analytics: 'granted', ads: 'granted', health: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '2026-10' }),
      ads: decisionOf('granted'),
      health: decisionOf('denied', { version: '1' }),
    });
  });
});

describe('snapshot e notificação de uma chamada efetiva', () => {
  it('produz exatamente um snapshot novo e uma notificação de origem decision', () => {
    const { consent, changes } = setup();
    const before = consent.getSnapshot();

    consent.decide({ analytics: 'granted', ads: 'denied' });

    assert.notEqual(consent.getSnapshot(), before);
    assert.deepStrictEqual(
      changes.map(({ source }) => source),
      ['decision'],
    );
  });

  it('changed segue a ordem da configuração, e não a ordem das escolhas', () => {
    const { consent, changes } = setup();

    consent.decide({ health: 'denied', ads: 'granted', analytics: 'granted' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['analytics', 'ads', 'health']],
    );
  });

  it('changed lista só as finalidades gravadas', () => {
    const { consent, changes } = setup({ record: ANALYTICS_GRANTED });

    consent.decide({ analytics: 'granted', ads: 'denied' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['ads']],
    );
  });
});

describe('o core nunca compara instantes', () => {
  it('relógio que volta no tempo: a nova decisão vale, mesmo com decidedAt menor', () => {
    const { consent, clock } = setup();
    consent.decide({ ads: 'granted' });
    clock.advance(-60_000);

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      ads: decisionOf('denied', { decidedAt: START - 60_000 }),
    });
  });
});
