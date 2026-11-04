import type { ConsentDecision, DecidedStatus } from './index.ts';
import {
  isDecidedStatus,
  isPlainObject,
  isTimestamp,
  isVersion,
  type PlainObject,
} from './validation.ts';

/** Decisão de cada finalidade, alinhada aos ids configurados; `undefined` quando não há decisão. */
export type Decisions = readonly (ConsentDecision | undefined)[];

/**
 * Cria a decisão congelada, com os campos na ordem `status`, `version`, `decidedAt`, que torna a
 * serialização determinística.
 */
export function createDecision(
  status: DecidedStatus,
  version: string | undefined,
  decidedAt: number,
): ConsentDecision {
  // -0 vira 0: o JSON não preserva o sinal, e a ida e volta do registro precisa ser exata.
  const instant = decidedAt + 0;
  return Object.freeze(
    version === undefined
      ? { status, decidedAt: instant }
      : { status, version, decidedAt: instant },
  );
}

/**
 * Versão de uma decisão, ou `undefined` se ela não tem. A propriedade ausente não é lida, porque a
 * leitura consultaria o protótipo, que pode estar poluído.
 */
export function versionOf(decision: ConsentDecision): string | undefined {
  return Object.hasOwn(decision, 'version') ? decision.version : undefined;
}

/** Igualdade de entradas do registro: ambas ausentes ou com os mesmos três campos. */
export function sameDecision(
  a: ConsentDecision | undefined,
  b: ConsentDecision | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.status === b.status && versionOf(a) === versionOf(b) && a.decidedAt === b.decidedAt;
}

/**
 * Lê um registro não confiável e devolve um array novo, alinhado a `ids`, que o chamador pode
 * alterar. Nunca lança: conteúdo ausente ou inválido equivale a registro vazio, e entrada inválida
 * equivale a ausência de decisão. As chaves do registro nunca são iteradas.
 */
export function readRecord(
  input: unknown,
  ids: readonly string[],
): (ConsentDecision | undefined)[] {
  try {
    const root: unknown = typeof input === 'string' ? JSON.parse(input) : input;
    const decisions = readDecisions(root);
    if (decisions !== undefined) return ids.map((id) => readEntry(decisions, id));
  } catch {
    // Texto que não é JSON, getter que lança ou proxy hostil: registro vazio.
  }
  // Preenchido, sem buracos: uma posição vazia seria lida do protótipo, que pode estar poluído.
  return new Array<ConsentDecision | undefined>(ids.length).fill(undefined);
}

/**
 * Valor de uma propriedade própria. Propriedades herdadas valem `undefined`, para que um protótipo
 * poluído não complete o registro.
 */
function ownValue(object: PlainObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** Objeto `decisions` de uma raiz válida, ou `undefined`. */
function readDecisions(root: unknown): PlainObject | undefined {
  if (!isPlainObject(root) || ownValue(root, 'format') !== 1) return undefined;
  const decisions = ownValue(root, 'decisions');
  return isPlainObject(decisions) ? decisions : undefined;
}

/** Entrada válida de uma finalidade configurada, ou `undefined`. */
function readEntry(decisions: PlainObject, id: string): ConsentDecision | undefined {
  const entry = ownValue(decisions, id);
  if (!isPlainObject(entry)) return undefined;
  const status = ownValue(entry, 'status');
  if (!isDecidedStatus(status)) return undefined;
  const decidedAt = ownValue(entry, 'decidedAt');
  if (!isTimestamp(decidedAt)) return undefined;
  const version = ownValue(entry, 'version');
  if (version !== undefined && !isVersion(version)) return undefined;
  // Campos extras não são copiados, para minimizar os dados do registro.
  return createDecision(status, version, decidedAt);
}
