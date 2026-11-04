import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentManager, PurposeConfig } from 'lgpder';

import { createConsentManager } from '../src/index.ts';
import { decisionOf, serialized } from './support/records.ts';
import {
  PURPOSES,
  START,
  createClock,
  createUntyped,
  setup,
  withObjectPollution,
  withPrototype,
  type TestClock,
} from './support/setup.ts';

describe('ordem de validação das opções', () => {
  const VALIDATION_ORDER = [
    {
      scenario: 'opção desconhecida é recusada antes de purposes inválido',
      options: { purposes: [], storage: {} },
      message: '[lgpder] Opção desconhecida: "storage".',
    },
    {
      scenario: 'vale a primeira opção desconhecida na ordem de Object.keys',
      options: { inital: {}, purposes: PURPOSES, storage: {} },
      message: '[lgpder] Opção desconhecida: "inital".',
    },
    {
      scenario: 'purposes sem finalidades é recusado antes de now inválido',
      options: { now: 123, purposes: {} },
      message: '[lgpder] "purposes" deve declarar ao menos uma finalidade.',
    },
    {
      scenario: 'finalidade inválida é recusada antes de now inválido',
      options: { now: 'Date.now', purposes: { ads: { individualGrant: 'yes' } } },
      message: '[lgpder] "individualGrant" da finalidade "ads" deve ser booleano.',
    },
    {
      scenario: 'as finalidades são validadas na ordem de Object.keys',
      options: { purposes: { ads: null, '*': {} } },
      message:
        '[lgpder] A configuração da finalidade "ads" deve ser um objeto simples; recebido: null.',
    },
    {
      scenario: 'o id é validado antes da configuração da mesma finalidade',
      options: { purposes: { '*': null } },
      message: '[lgpder] Identificador de finalidade inválido: "*".',
    },
    {
      scenario: 'chave desconhecida é recusada antes de version inválida declarada antes dela',
      options: { purposes: { ads: { version: '', verison: '1' } } },
      message: '[lgpder] A finalidade "ads" tem a propriedade desconhecida "verison".',
    },
    {
      scenario: 'version é validada antes de category declarada antes dela',
      options: { purposes: { ads: { category: 'mar keting', version: '' } } },
      message: '[lgpder] A versão da finalidade "ads" deve ser um texto não vazio.',
    },
    {
      scenario: 'category é validada antes de individualGrant declarado antes dela',
      options: { purposes: { ads: { individualGrant: 'yes', category: '' } } },
      message: '[lgpder] A categoria da finalidade "ads" deve ser um identificador válido.',
    },
  ] as const;

  for (const { scenario, options, message } of VALIDATION_ORDER) {
    it(`com dois problemas, vale o primeiro: ${scenario}`, () => {
      assert.throws(() => createUntyped(options), { name: 'TypeError', message });
    });
  }

  it('a verificação de opções desconhecidas não lê valores: opção desconhecida lança sem que purposes seja lido', () => {
    let reads = 0;
    const options = {
      get purposes() {
        reads += 1;
        return PURPOSES;
      },
      storage: {},
    };

    assert.throws(() => createUntyped(options), TypeError);

    assert.equal(reads, 0);
  });

  it('o valor de um id inválido não é lido: o id é validado antes', () => {
    let reads = 0;
    const purposes = {
      get '*'() {
        reads += 1;
        return {};
      },
    };

    assert.throws(() => createUntyped({ purposes }), TypeError);

    assert.equal(reads, 0);
  });

  it('record só é lido depois das demais opções: now inválido lança sem que record seja lido', () => {
    let reads = 0;
    const options = {
      purposes: PURPOSES,
      get record() {
        reads += 1;
        return serialized({ ads: decisionOf('granted') });
      },
      now: 123,
    };

    assert.throws(() => createUntyped(options), TypeError);

    assert.equal(reads, 0);
  });

  it('aceita objetos de protótipo nulo como opções, purposes e configuração', () => {
    const config = withPrototype({ version: '1' }, null);
    const options = withPrototype({ purposes: withPrototype({ ads: config }, null) }, null);

    const consent = createUntyped(options);

    assert.deepStrictEqual(consent.purposes, { ads: { version: '1' } });
  });
});

describe('somente propriedades próprias enumeráveis com chave texto', () => {
  const EXTRA = Symbol('extra');
  const SYMBOL_KEYS = [
    { level: 'nas opções', options: { purposes: { ads: {} }, [EXTRA]: true } },
    { level: 'em purposes', options: { purposes: { ads: {}, [EXTRA]: {} } } },
    { level: 'na configuração da finalidade', options: { purposes: { ads: { [EXTRA]: '1' } } } },
  ] as const;

  for (const { level, options } of SYMBOL_KEYS) {
    it(`ignora chave símbolo ${level}`, () => {
      const consent = createUntyped(options);

      assert.deepStrictEqual(consent.purposes, { ads: {} });
    });
  }

  it('ignora propriedade não enumerável na configuração da finalidade', () => {
    const config = Object.defineProperty({}, 'version', { value: '1', enumerable: false });

    const consent = createUntyped({ purposes: { ads: config } });

    assert.deepStrictEqual(consent.purposes, { ads: {} });
  });

  it('now não enumerável é ignorado: o relógio informado nunca é chamado e vale Date.now', (t) => {
    t.mock.method(Date, 'now', () => START);
    const informed = createClock(0);
    const options = Object.defineProperty({ purposes: PURPOSES }, 'now', {
      value: informed.now,
      enumerable: false,
    });
    const consent = createConsentManager(options);

    consent.decide({ ads: 'granted' });

    assert.equal(informed.calls(), 0);
    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('purposes não enumerável é ignorado: a criação lança TypeError', () => {
    const options = Object.defineProperty({}, 'purposes', { value: PURPOSES, enumerable: false });

    assert.throws(() => createUntyped(options), TypeError);
  });
});

describe('Object.prototype poluído com record, now e version durante a criação', () => {
  /** Cria `{ purposes: { ads: {} } }` com a poluição ativa e a desfaz logo em seguida. */
  function createUnderPollution(pollutedClock: TestClock): ConsentManager<'ads', never> {
    const pollution = {
      record: serialized({ ads: decisionOf('granted') }),
      now: pollutedClock.now,
      version: '1',
    };
    return withObjectPollution(pollution, () => createConsentManager({ purposes: { ads: {} } }));
  }

  it('ignora record herdado: ads continua pending', () => {
    const consent = createUnderPollution(createClock());

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('ignora version herdada: a configuração copiada fica vazia e a decisão não tem version', (t) => {
    t.mock.method(Date, 'now', () => START);
    const consent = createUnderPollution(createClock());

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(consent.purposes, { ads: {} });
    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('ignora now herdado: o relógio poluído nunca é chamado e vale Date.now', (t) => {
    t.mock.method(Date, 'now', () => START);
    const pollutedClock = createClock(0);
    const consent = createUnderPollution(pollutedClock);

    consent.decide({ ads: 'granted' });

    assert.equal(pollutedClock.calls(), 0);
    assert.equal(consent.getSnapshot().record.decisions.ads?.decidedAt, START);
  });
});

describe('cada propriedade é lida uma única vez', () => {
  it('lê purposes uma única vez', () => {
    let reads = 0;

    createConsentManager({
      get purposes() {
        reads += 1;
        return PURPOSES;
      },
    });

    assert.equal(reads, 1);
  });

  it('lê record uma única vez', () => {
    let reads = 0;

    createConsentManager({
      purposes: PURPOSES,
      get record() {
        reads += 1;
        return serialized({ ads: decisionOf('granted') });
      },
    });

    assert.equal(reads, 1);
  });

  it('lê now uma única vez, na criação, mesmo com várias decisões depois', () => {
    let reads = 0;
    const clock = createClock();
    const consent = createConsentManager({
      purposes: PURPOSES,
      get now() {
        reads += 1;
        return clock.now;
      },
    });

    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });

    assert.equal(reads, 1);
  });

  it('lê a configuração de cada finalidade e cada um de seus campos uma única vez', () => {
    const reads = { config: 0, version: 0, category: 0, individualGrant: 0 };
    const config = {
      get version() {
        reads.version += 1;
        return '1';
      },
      get category() {
        reads.category += 1;
        return 'health';
      },
      get individualGrant() {
        reads.individualGrant += 1;
        return true;
      },
    };

    createConsentManager({
      purposes: {
        get health() {
          reads.config += 1;
          return config;
        },
      },
    });

    assert.deepStrictEqual(reads, { config: 1, version: 1, category: 1, individualGrant: 1 });
  });
});

describe('exceções lançadas durante a validação das opções se propagam intactas', () => {
  const FAILURE = new Error('leitura hostil');
  const THROWING_OPTIONS = [
    {
      place: 'proxy das opções ao listar as chaves',
      options: new Proxy(
        { purposes: PURPOSES },
        {
          ownKeys: () => {
            throw FAILURE;
          },
        },
      ),
    },
    {
      place: 'getter de purposes',
      options: {
        get purposes() {
          throw FAILURE;
        },
      },
    },
    {
      place: 'getter da configuração de uma finalidade',
      options: {
        purposes: {
          get ads() {
            throw FAILURE;
          },
        },
      },
    },
    {
      place: 'getter de version',
      options: {
        purposes: {
          ads: {
            get version() {
              throw FAILURE;
            },
          },
        },
      },
    },
    {
      place: 'getter de now',
      options: {
        purposes: PURPOSES,
        get now() {
          throw FAILURE;
        },
      },
    },
  ] as const;

  for (const { place, options } of THROWING_OPTIONS) {
    it(`a exceção do ${place} chega intacta a quem chamou`, () => {
      assert.throws(
        () => createUntyped(options),
        (error) => error === FAILURE,
      );
    });
  }
});

describe('undefined explícito equivale a ausente', () => {
  it('record: undefined equivale a registro ausente', () => {
    const consent = createConsentManager({ purposes: PURPOSES, record: undefined });

    assert.equal(consent.getSnapshot(), consent.getServerSnapshot());
  });

  it('now: undefined usa o relógio padrão Date.now', (t) => {
    t.mock.method(Date, 'now', () => START);
    const consent = createConsentManager({ purposes: PURPOSES, now: undefined });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('version, category e individualGrant com undefined não entram na configuração copiada', () => {
    const consent = createConsentManager({
      purposes: { ads: { version: undefined, category: undefined, individualGrant: undefined } },
    });

    assert.deepStrictEqual(consent.purposes, { ads: {} });
  });

  it('individualGrant: undefined não exclui a finalidade de grantAll', () => {
    const { consent } = setup({ purposes: { ads: { individualGrant: undefined } } });

    consent.grantAll();

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });
});

describe('identificadores de finalidade e de categoria', () => {
  const VALID_IDS = [
    { scenario: '"all", sem significado especial', id: 'all' },
    { scenario: 'de uma única letra', id: 'a' },
    { scenario: 'com letra maiúscula seguida de dígito', id: 'Z9' },
    { scenario: 'com sublinhado, ponto e hífen depois da primeira letra', id: 'a_b.c-d' },
    { scenario: 'longo, porque não há limite de tamanho', id: 'x'.repeat(10_000) },
  ] as const;

  for (const { scenario, id } of VALID_IDS) {
    it(`aceita id ${scenario}`, () => {
      const consent = createConsentManager({ purposes: { [id]: {} } });

      assert.deepStrictEqual(Object.keys(consent.purposes), [id]);
    });
  }

  it('a finalidade "all" é comum: concedê-la não alcança as demais', () => {
    const { consent } = setup({ purposes: { all: {}, ads: {} } });

    consent.decide({ all: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().status, { all: 'granted', ads: 'pending' });
  });

  it('aceita categoria com erro de digitação, porque é identificador válido', () => {
    const consent = createConsentManager({ purposes: { ads: { category: 'marketng' } } });

    assert.equal(consent.purposes.ads.category, 'marketng');
  });

  it('a lista de nomes recusados é fixa: id acrescentado a Object.prototype continua válido', () => {
    const consent = withObjectPollution({ ads: {} }, () =>
      createConsentManager({ purposes: { ads: {} } }),
    );

    assert.deepStrictEqual(Object.keys(consent.purposes), ['ads']);
  });

  it('configuração dinâmica tipada como Record<string, PurposeConfig> é validada em tempo de execução', () => {
    const fromServer: Record<string, PurposeConfig> = { 'a b': {} };

    assert.throws(() => createConsentManager({ purposes: fromServer }), TypeError);
  });
});

describe('cópia da configuração', () => {
  it('cada configuração copiada tem só as propriedades informadas com valor definido', () => {
    const consent = createConsentManager({
      purposes: {
        health: { version: '1', individualGrant: true },
        ads: { version: undefined, category: 'marketing', individualGrant: false },
      },
    });

    assert.deepStrictEqual(consent.purposes, {
      health: { version: '1', individualGrant: true },
      ads: { category: 'marketing', individualGrant: false },
    });
  });

  it('a cópia segue a ordem das finalidades e a ordem version, category, individualGrant', () => {
    const consent = createConsentManager({
      purposes: {
        health: { individualGrant: true, category: 'health', version: '1' },
        ads: { category: 'marketing', version: '2' },
      },
    });

    assert.equal(
      JSON.stringify(consent.purposes),
      '{"health":{"version":"1","category":"health","individualGrant":true},' +
        '"ads":{"version":"2","category":"marketing"}}',
    );
  });

  it('cada configuração copiada é um objeto novo, e não a configuração recebida', () => {
    const health = { version: '1', individualGrant: true };

    const consent = createConsentManager({ purposes: { health } });

    assert.notEqual(consent.purposes.health, health);
  });

  it('as opções, purposes e cada configuração recebidas não são congeladas', () => {
    const ads = { category: 'marketing' };
    const purposes = { ads };
    const options = { purposes };

    createConsentManager(options);

    assert.deepStrictEqual(
      [Object.isFrozen(options), Object.isFrozen(purposes), Object.isFrozen(ads)],
      [false, false, false],
    );
  });

  it('a configuração recebida não é alterada, nem nas chaves com undefined', () => {
    const ads = { version: undefined, individualGrant: false };

    createConsentManager({ purposes: { ads } });

    assert.deepStrictEqual(ads, { version: undefined, individualGrant: false });
  });

  it('alterar a configuração original depois da criação não muda o comportamento', () => {
    const ads = { individualGrant: false };
    const purposes: Record<string, PurposeConfig> = { ads };
    const consent = createConsentManager({ purposes });

    ads.individualGrant = true;
    purposes['health'] = {};
    consent.grantAll();

    assert.deepStrictEqual(consent.getSnapshot().status, { ads: 'granted' });
  });
});

describe('relógio definido na criação', () => {
  it('chama now sem this', () => {
    const receivers: unknown[] = [];
    const consent = createConsentManager({
      purposes: PURPOSES,
      now: function (this: unknown) {
        receivers.push(this);
        return START;
      },
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(receivers, [undefined]);
  });

  it('sem now, Date.now substituído depois da importação e antes da criação define o decidedAt', (t) => {
    t.mock.method(Date, 'now', () => START);
    const consent = createConsentManager({ purposes: PURPOSES });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('sem now, Date.now substituído depois da criação não altera o relógio da instância', (t) => {
    const consent = createConsentManager({ purposes: PURPOSES });
    const replacement = t.mock.method(Date, 'now', () => START);

    consent.decide({ ads: 'granted' });

    assert.equal(replacement.mock.callCount(), 0);
  });
});

describe('a criação não tem efeitos', () => {
  it('não chama o relógio, mesmo hidratando um registro', () => {
    const { clock } = setup({ record: serialized({ ads: decisionOf('granted') }) });

    assert.equal(clock.calls(), 0);
  });

  it('não agenda microtarefas', (t) => {
    const schedule = t.mock.method(globalThis, 'queueMicrotask');

    createConsentManager({
      purposes: PURPOSES,
      record: serialized({ ads: decisionOf('granted') }),
    });

    assert.equal(schedule.mock.callCount(), 0);
  });
});

describe('propriedades do gerenciador', () => {
  it('tem exatamente as propriedades públicas, nesta ordem', () => {
    const { consent } = setup();

    assert.deepStrictEqual(Reflect.ownKeys(consent), [
      'purposes',
      'getSnapshot',
      'getServerSnapshot',
      'decide',
      'grantAll',
      'denyAll',
      'restore',
      'subscribe',
    ]);
  });

  it('todas as funções funcionam desestruturadas, sem this', () => {
    const { consent } = setup();
    const { getSnapshot, getServerSnapshot, decide, grantAll, denyAll, restore, subscribe } =
      consent;
    const sources: string[] = [];

    const unsubscribe = subscribe(({ source }) => {
      sources.push(source);
    });
    grantAll();
    decide({ ads: 'denied' });
    denyAll();
    restore(getServerSnapshot().record);
    unsubscribe();
    decide({ ads: 'granted' });

    assert.deepStrictEqual(sources, ['decision', 'decision', 'decision', 'restore']);
    assert.equal(getSnapshot().status.ads, 'granted');
  });
});
