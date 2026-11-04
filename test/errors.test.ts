import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PURPOSES,
  callUntyped,
  createUntyped,
  decideUntyped,
  setup,
  withPrototype,
} from './support/setup.ts';

/** Mensagem do relógio inválido, a mesma para qualquer valor inválido que ele devolva. */
const INVALID_CLOCK_MESSAGE =
  '[lgpder] "now" deve retornar um inteiro não negativo (milissegundos desde a época Unix).';

describe('mensagens de createConsentManager', () => {
  const CREATE_ERRORS = [
    {
      call: 'createConsentManager(null)',
      args: [null],
      message: '[lgpder] As opções devem ser um objeto simples; recebido: null.',
    },
    {
      call: 'createConsentManager() sem argumento, em JavaScript',
      args: [],
      message: '[lgpder] As opções devem ser um objeto simples; recebido: undefined.',
    },
    {
      call: 'opções em array',
      args: [[]],
      message: '[lgpder] As opções devem ser um objeto simples; recebido: array.',
    },
    {
      call: 'opções em texto',
      args: ['purposes'],
      message: '[lgpder] As opções devem ser um objeto simples; recebido: string.',
    },
    {
      call: 'opções em função',
      args: [() => PURPOSES],
      message: '[lgpder] As opções devem ser um objeto simples; recebido: function.',
    },
    {
      call: 'opções com outro protótipo',
      args: [withPrototype({ purposes: PURPOSES }, {})],
      message: '[lgpder] As opções devem ser um objeto simples; recebido: object.',
    },
    {
      call: 'createConsentManager({ purposes: { ads: {} }, storage: {} })',
      args: [{ purposes: { ads: {} }, storage: {} }],
      message: '[lgpder] Opção desconhecida: "storage".',
    },
    {
      call: 'opção inital',
      args: [{ purposes: { ads: {} }, inital: {} }],
      message: '[lgpder] Opção desconhecida: "inital".',
    },
    {
      call: 'opção com aspas, escapada como JSON',
      args: [{ purposes: { ads: {} }, 'a"b': 1 }],
      message: '[lgpder] Opção desconhecida: "a\\"b".',
    },
    {
      call: 'createConsentManager({ purposes: [] })',
      args: [{ purposes: [] }],
      message: '[lgpder] "purposes" deve ser um objeto simples; recebido: array.',
    },
    {
      call: 'purposes ausente',
      args: [{}],
      message: '[lgpder] "purposes" deve ser um objeto simples; recebido: undefined.',
    },
    {
      call: 'purposes não enumerável',
      args: [Object.defineProperty({}, 'purposes', { value: PURPOSES, enumerable: false })],
      message: '[lgpder] "purposes" deve ser um objeto simples; recebido: undefined.',
    },
    {
      call: 'purposes na forma literal { __proto__: {} }, que define o protótipo',
      args: [{ purposes: { __proto__: {} } }],
      message: '[lgpder] "purposes" deve ser um objeto simples; recebido: object.',
    },
    {
      call: 'purposes em Map',
      args: [{ purposes: new Map() }],
      message: '[lgpder] "purposes" deve ser um objeto simples; recebido: object.',
    },
    {
      call: 'createConsentManager({ purposes: {} })',
      args: [{ purposes: {} }],
      message: '[lgpder] "purposes" deve declarar ao menos uma finalidade.',
    },
    {
      call: "createConsentManager({ purposes: { '*': {} } })",
      args: [{ purposes: { '*': {} } }],
      message: '[lgpder] Identificador de finalidade inválido: "*".',
    },
    {
      call: 'id vazio',
      args: [{ purposes: { '': {} } }],
      message: '[lgpder] Identificador de finalidade inválido: "".',
    },
    {
      call: 'id iniciado por dígito',
      args: [{ purposes: { '1abc': {} } }],
      message: '[lgpder] Identificador de finalidade inválido: "1abc".',
    },
    {
      call: 'id com espaço',
      args: [{ purposes: { 'a b': {} } }],
      message: '[lgpder] Identificador de finalidade inválido: "a b".',
    },
    {
      call: 'id com acento',
      args: [{ purposes: { estatística: {} } }],
      message: '[lgpder] Identificador de finalidade inválido: "estatística".',
    },
    {
      call: 'id __proto__ como propriedade própria, criada com chave computada',
      args: [{ purposes: { ['__proto__']: {} } }],
      message: '[lgpder] Identificador de finalidade inválido: "__proto__".',
    },
    {
      call: 'id com aspas e quebra de linha, escapado como JSON',
      args: [{ purposes: { 'a"b\nc': {} } }],
      message: '[lgpder] Identificador de finalidade inválido: "a\\"b\\nc".',
    },
    {
      call: 'createConsentManager({ purposes: { ads: null } })',
      args: [{ purposes: { ads: null } }],
      message:
        '[lgpder] A configuração da finalidade "ads" deve ser um objeto simples; recebido: null.',
    },
    {
      call: 'configuração em array',
      args: [{ purposes: { ads: [] } }],
      message:
        '[lgpder] A configuração da finalidade "ads" deve ser um objeto simples; recebido: array.',
    },
    {
      call: 'configuração em texto',
      args: [{ purposes: { ads: 'granted' } }],
      message:
        '[lgpder] A configuração da finalidade "ads" deve ser um objeto simples; recebido: string.',
    },
    {
      call: 'configuração com outro protótipo',
      args: [{ purposes: { ads: new Map() } }],
      message:
        '[lgpder] A configuração da finalidade "ads" deve ser um objeto simples; recebido: object.',
    },
    {
      call: "createConsentManager({ purposes: { ads: { verison: '1' } } })",
      args: [{ purposes: { ads: { verison: '1' } } }],
      message: '[lgpder] A finalidade "ads" tem a propriedade desconhecida "verison".',
    },
    {
      call: 'propriedade com aspas, escapada como JSON',
      args: [{ purposes: { ads: { 'a"b': '1' } } }],
      message: '[lgpder] A finalidade "ads" tem a propriedade desconhecida "a\\"b".',
    },
    {
      call: "createConsentManager({ purposes: { ads: { version: '' } } })",
      args: [{ purposes: { ads: { version: '' } } }],
      message: '[lgpder] A versão da finalidade "ads" deve ser um texto não vazio.',
    },
    {
      call: 'version numérica',
      args: [{ purposes: { ads: { version: 2 } } }],
      message: '[lgpder] A versão da finalidade "ads" deve ser um texto não vazio.',
    },
    {
      call: 'version null',
      args: [{ purposes: { ads: { version: null } } }],
      message: '[lgpder] A versão da finalidade "ads" deve ser um texto não vazio.',
    },
    {
      call: "createConsentManager({ purposes: { ads: { category: 'mar keting' } } })",
      args: [{ purposes: { ads: { category: 'mar keting' } } }],
      message: '[lgpder] A categoria da finalidade "ads" deve ser um identificador válido.',
    },
    {
      call: 'category vazia',
      args: [{ purposes: { ads: { category: '' } } }],
      message: '[lgpder] A categoria da finalidade "ads" deve ser um identificador válido.',
    },
    {
      call: 'category numérica',
      args: [{ purposes: { ads: { category: 2 } } }],
      message: '[lgpder] A categoria da finalidade "ads" deve ser um identificador válido.',
    },
    {
      call: 'category null, comum em configuração vinda do servidor em JSON',
      args: [{ purposes: { ads: { category: null } } }],
      message: '[lgpder] A categoria da finalidade "ads" deve ser um identificador válido.',
    },
    {
      call: 'category booleana',
      args: [{ purposes: { ads: { category: true } } }],
      message: '[lgpder] A categoria da finalidade "ads" deve ser um identificador válido.',
    },
    {
      call: 'category em array',
      args: [{ purposes: { ads: { category: ['statistics'] } } }],
      message: '[lgpder] A categoria da finalidade "ads" deve ser um identificador válido.',
    },
    {
      call: "createConsentManager({ purposes: { ads: { individualGrant: 'yes' } } })",
      args: [{ purposes: { ads: { individualGrant: 'yes' } } }],
      message: '[lgpder] "individualGrant" da finalidade "ads" deve ser booleano.',
    },
    {
      call: 'individualGrant numérico',
      args: [{ purposes: { ads: { individualGrant: 1 } } }],
      message: '[lgpder] "individualGrant" da finalidade "ads" deve ser booleano.',
    },
    {
      call: 'individualGrant null',
      args: [{ purposes: { ads: { individualGrant: null } } }],
      message: '[lgpder] "individualGrant" da finalidade "ads" deve ser booleano.',
    },
    {
      call: 'createConsentManager({ purposes: { ads: {} }, now: 123 })',
      args: [{ purposes: { ads: {} }, now: 123 }],
      message: '[lgpder] "now" deve ser uma função; recebido: number.',
    },
    {
      call: "now: 'Date.now'",
      args: [{ purposes: { ads: {} }, now: 'Date.now' }],
      message: '[lgpder] "now" deve ser uma função; recebido: string.',
    },
    {
      call: 'now: null',
      args: [{ purposes: { ads: {} }, now: null }],
      message: '[lgpder] "now" deve ser uma função; recebido: null.',
    },
  ] as const;

  for (const { call, args, message } of CREATE_ERRORS) {
    it(call, () => {
      assert.throws(() => createUntyped(...args), { name: 'TypeError', message });
    });
  }
});

describe('nomes de propriedades de Object.prototype são recusados como id e categoria', () => {
  const RESERVED_NAMES = [
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    'toString',
    'valueOf',
  ] as const;

  for (const reserved of RESERVED_NAMES) {
    it(`id '${reserved}'`, () => {
      assert.throws(() => createUntyped({ purposes: { [reserved]: {} } }), {
        name: 'TypeError',
        message: `[lgpder] Identificador de finalidade inválido: "${reserved}".`,
      });
    });

    it(`categoria '${reserved}'`, () => {
      assert.throws(() => createUntyped({ purposes: { ads: { category: reserved } } }), {
        name: 'TypeError',
        message: '[lgpder] A categoria da finalidade "ads" deve ser um identificador válido.',
      });
    });
  }
});

describe('mensagens de decide', () => {
  const DECIDE_ERRORS = [
    {
      call: 'consent.decide(null)',
      args: [null],
      name: 'TypeError',
      message: '[lgpder] As decisões devem ser um objeto simples; recebido: null.',
    },
    {
      call: 'decide([])',
      args: [[]],
      name: 'TypeError',
      message: '[lgpder] As decisões devem ser um objeto simples; recebido: array.',
    },
    {
      call: 'decide(new Map())',
      args: [new Map()],
      name: 'TypeError',
      message: '[lgpder] As decisões devem ser um objeto simples; recebido: object.',
    },
    {
      call: "decide('x')",
      args: ['x'],
      name: 'TypeError',
      message: '[lgpder] As decisões devem ser um objeto simples; recebido: string.',
    },
    {
      call: 'decide() sem argumento, em JavaScript',
      args: [],
      name: 'TypeError',
      message: '[lgpder] As decisões devem ser um objeto simples; recebido: undefined.',
    },
    {
      call: 'escolhas criadas com outro protótipo',
      args: [withPrototype({ ads: 'granted' }, {})],
      name: 'TypeError',
      message: '[lgpder] As decisões devem ser um objeto simples; recebido: object.',
    },
    {
      call: "consent.decide({ analytic: 'granted' })",
      args: [{ analytic: 'granted' }],
      name: 'RangeError',
      message: '[lgpder] Finalidade desconhecida: "analytic".',
    },
    {
      call: "decide({ analytics: 'granted', typo: 'denied' })",
      args: [{ analytics: 'granted', typo: 'denied' }],
      name: 'RangeError',
      message: '[lgpder] Finalidade desconhecida: "typo".',
    },
    {
      call: 'decide({ typo: true })',
      args: [{ typo: true }],
      name: 'RangeError',
      message: '[lgpder] Finalidade desconhecida: "typo".',
    },
    {
      call: 'decide({ typo: undefined })',
      args: [{ typo: undefined }],
      name: 'RangeError',
      message: '[lgpder] Finalidade desconhecida: "typo".',
    },
    {
      call: 'finalidade com aspas, escapada como JSON',
      args: [{ 'a"b': 'granted' }],
      name: 'RangeError',
      message: '[lgpder] Finalidade desconhecida: "a\\"b".',
    },
    {
      call: 'consent.decide({ ads: true })',
      args: [{ ads: true }],
      name: 'TypeError',
      message: '[lgpder] A decisão para "ads" deve ser "granted" ou "denied"; recebido: boolean.',
    },
    {
      call: "decide({ ads: 'GRANTED' })",
      args: [{ ads: 'GRANTED' }],
      name: 'TypeError',
      message: '[lgpder] A decisão para "ads" deve ser "granted" ou "denied"; recebido: string.',
    },
    {
      call: "decide({ ads: 'pending' })",
      args: [{ ads: 'pending' }],
      name: 'TypeError',
      message: '[lgpder] A decisão para "ads" deve ser "granted" ou "denied"; recebido: string.',
    },
    {
      call: 'decide({ ads: null })',
      args: [{ ads: null }],
      name: 'TypeError',
      message: '[lgpder] A decisão para "ads" deve ser "granted" ou "denied"; recebido: null.',
    },
    {
      call: 'decide({ ads: 1 })',
      args: [{ ads: 1 }],
      name: 'TypeError',
      message: '[lgpder] A decisão para "ads" deve ser "granted" ou "denied"; recebido: number.',
    },
  ] as const;

  for (const { call, args, name, message } of DECIDE_ERRORS) {
    it(call, () => {
      const { consent } = setup();

      assert.throws(
        () => {
          decideUntyped(consent, ...args);
        },
        { name, message },
      );
    });
  }
});

describe('mensagem do relógio inválido', () => {
  const INVALID_INSTANTS = [
    { scenario: '1.5', value: 1.5 },
    { scenario: 'NaN', value: Number.NaN },
    { scenario: '-1', value: -1 },
    { scenario: "o texto '1'", value: '1' },
    { scenario: 'um objeto Date', value: new Date(0) },
  ] as const;

  for (const { scenario, value } of INVALID_INSTANTS) {
    it(`decide efetivo com now devolvendo ${scenario}`, () => {
      const consent = createUntyped({ purposes: PURPOSES, now: () => value });

      assert.throws(
        () => {
          consent.decide({ ads: 'granted' });
        },
        { name: 'TypeError', message: INVALID_CLOCK_MESSAGE },
      );
    });
  }

  it('grantAll com now devolvendo 1.5', () => {
    const consent = createUntyped({ purposes: PURPOSES, now: () => 1.5 });

    assert.throws(
      () => {
        consent.grantAll();
      },
      { name: 'TypeError', message: INVALID_CLOCK_MESSAGE },
    );
  });

  it('denyAll com now devolvendo 1.5', () => {
    const consent = createUntyped({ purposes: PURPOSES, now: () => 1.5 });

    assert.throws(
      () => {
        consent.denyAll();
      },
      { name: 'TypeError', message: INVALID_CLOCK_MESSAGE },
    );
  });
});

describe('mensagem de subscribe', () => {
  const SUBSCRIBE_ERRORS = [
    {
      call: "consent.subscribe('x')",
      args: ['x'],
      message: '[lgpder] O ouvinte deve ser uma função; recebido: string.',
    },
    {
      call: 'subscribe(null)',
      args: [null],
      message: '[lgpder] O ouvinte deve ser uma função; recebido: null.',
    },
    {
      call: 'subscribe({})',
      args: [{}],
      message: '[lgpder] O ouvinte deve ser uma função; recebido: object.',
    },
    {
      call: 'subscribe() sem argumento, em JavaScript',
      args: [],
      message: '[lgpder] O ouvinte deve ser uma função; recebido: undefined.',
    },
  ] as const;

  for (const { call, args, message } of SUBSCRIBE_ERRORS) {
    it(call, () => {
      const { consent } = setup();

      assert.throws(() => callUntyped(consent.subscribe, ...args), { name: 'TypeError', message });
    });
  }
});

describe('erros nativos, sem congelamento e sem cause', () => {
  /** Executa `act` e devolve o valor lançado. */
  function thrownBy(act: () => unknown): unknown {
    try {
      act();
    } catch (error) {
      return error;
    }
    return assert.fail('a chamada deveria lançar');
  }

  const SAMPLES = [
    {
      scenario: 'erro de opções inválidas em createConsentManager',
      act: () => createUntyped(null),
      type: TypeError,
    },
    {
      scenario: 'erro de finalidade desconhecida em decide',
      act: () => {
        decideUntyped(setup().consent, { typo: 'granted' });
      },
      type: RangeError,
    },
    {
      scenario: 'erro do relógio inválido',
      act: () => {
        createUntyped({ purposes: PURPOSES, now: () => -1 }).decide({ ads: 'granted' });
      },
      type: TypeError,
    },
    {
      scenario: 'erro de ouvinte inválido em subscribe',
      act: () => callUntyped(setup().consent.subscribe, 'x'),
      type: TypeError,
    },
  ] as const;

  for (const { scenario, act, type } of SAMPLES) {
    it(`${scenario} é instância direta de ${type.name}`, () => {
      const error = thrownBy(act);

      assert.equal(Object.getPrototypeOf(error), type.prototype);
    });

    it(`${scenario} não é congelado e não tem cause`, () => {
      const error = thrownBy(act);

      assert.ok(error instanceof Error);
      assert.equal(Object.isFrozen(error), false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
    });
  }
});
