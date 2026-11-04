/**
 * Builders do gerenciador e do relógio de teste, além dos únicos pontos de conversão de tipo usados
 * para simular chamadas feitas de JavaScript sem tipos.
 */
import type { ConsentChange, ConsentManager, PurposeConfig } from 'lgpder';

import { createConsentManager } from '../../src/index.ts';

/** 2026-10-31T12:00:00.000Z, instante inicial do relógio de teste. */
export const START = 1_793_448_000_000;

/**
 * Fixture padrão: uma finalidade versionada, uma sem versão e uma que só é concedida quando nomeada
 * em `decide`.
 */
export const PURPOSES = {
  analytics: { version: '2026-10', category: 'statistics' },
  ads: { category: 'marketing' },
  health: { version: '1', category: 'health', individualGrant: true },
} as const satisfies Record<string, PurposeConfig>;

export type PurposeId = keyof typeof PURPOSES;

/** Relógio determinístico: devolve sempre o instante atual, que só muda com `advance`. */
export interface TestClock {
  readonly now: () => number;
  readonly advance: (ms: number) => void;
  /** Quantas vezes `now` foi chamado. */
  readonly calls: () => number;
}

export function createClock(start = START): TestClock {
  let current = start;
  let calls = 0;
  return {
    now: () => {
      calls += 1;
      return current;
    },
    advance: (ms) => {
      current += ms;
    },
    calls: () => calls,
  };
}

export interface SetupOptions<P extends string> {
  readonly purposes: Readonly<Record<P, PurposeConfig>>;
  readonly record?: unknown;
}

export interface Setup<P extends string> {
  readonly consent: ConsentManager<P>;
  readonly clock: TestClock;
  /** Notificações recebidas pelo primeiro ouvinte inscrito, na ordem de entrega. */
  readonly changes: ConsentChange<P>[];
}

/** Cria o gerenciador da fixture padrão com o relógio de teste e o gravador de notificações. */
export function setup(options?: { readonly record?: unknown }): Setup<PurposeId>;
/** Cria o gerenciador com finalidades próprias, o relógio de teste e o gravador de notificações. */
export function setup<P extends string>(options: SetupOptions<P>): Setup<P>;
export function setup({
  purposes = PURPOSES,
  record,
}: Partial<SetupOptions<string>> = {}): Setup<string> {
  const clock = createClock();
  const consent = createConsentManager({ purposes, record, now: clock.now });
  const changes: ConsentChange[] = [];
  consent.subscribe((change) => {
    changes.push(change);
  });
  return { consent, clock, changes };
}

/**
 * Chama `fn` com quaisquer argumentos (inclusive nenhum), como faria um código JavaScript sem
 * tipos. Concentra a conversão de tipo das chamadas inválidas, em vez de `as never` espalhado
 * pelos testes.
 */
export function callUntyped<R>(fn: (...args: never[]) => R, ...args: unknown[]): R {
  return (fn as (...values: unknown[]) => R)(...args);
}

/** `createConsentManager` chamado de JavaScript, com qualquer valor (ou nenhum) como opções. */
export function createUntyped(...args: unknown[]): ConsentManager {
  return callUntyped<ConsentManager>(createConsentManager, ...args);
}

/** `decide` chamado de JavaScript, com qualquer valor (ou nenhum) como escolhas. */
export function decideUntyped(consent: ConsentManager, ...args: unknown[]): void {
  callUntyped(consent.decide, ...args);
}

/** Atribui `value` a `target[key]` sem verificação de tipos, para tentar alterar objetos congelados. */
export function assignUntyped(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

/**
 * Devolve o próprio `value` com o protótipo trocado. Com `null`, o resultado continua sendo objeto
 * simples; com outro objeto, deixa de ser.
 */
export function withPrototype(value: object, prototype: object | null): unknown {
  Object.setPrototypeOf(value, prototype);
  return value;
}

/**
 * Executa `act` com `Array.prototype` poluído por `value` em uma posição numérica por finalidade
 * da fixture, como faria um script hostil, e desfaz a poluição ao final.
 */
export function withArrayPollution(value: unknown, act: () => void): void {
  const positions = Object.keys(PURPOSES).map((_, position) => position);
  try {
    for (const position of positions) Reflect.set(Array.prototype, position, value);
    act();
  } finally {
    for (const position of positions) Reflect.deleteProperty(Array.prototype, position);
  }
}

export interface ObjectPollutionOptions {
  /**
   * Com `false`, as propriedades poluídas são somente leitura: em modo estrito, atribuir a uma
   * propriedade de mesmo nome em qualquer objeto simples lança `TypeError`. Padrão: `true`.
   */
  readonly writable?: boolean;
}

/**
 * Executa `act` com `Object.prototype` poluído pelas propriedades de `pollution`, como faria um
 * script hostil, e devolve o resultado. A poluição é desfeita em `finally`, com o descritor
 * original de cada chave restaurado.
 */
export function withObjectPollution<T>(
  pollution: Readonly<Record<string, unknown>>,
  act: () => T,
  { writable = true }: ObjectPollutionOptions = {},
): T {
  const keys = Object.keys(pollution);
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
  try {
    for (const key of keys) {
      Object.defineProperty(Object.prototype, key, {
        value: pollution[key],
        writable,
        enumerable: true,
        configurable: true,
      });
    }
    return act();
  } finally {
    for (const [index, key] of keys.entries()) {
      const original = originals[index];
      if (original === undefined) Reflect.deleteProperty(Object.prototype, key);
      else Object.defineProperty(Object.prototype, key, original);
    }
  }
}
