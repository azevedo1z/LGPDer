import type { DecidedStatus } from './index.ts';

/** Objeto simples já verificado: propriedades lidas por chave texto, com valores não confiáveis. */
export type PlainObject = Readonly<Record<string, unknown>>;

/** Função recebida de fora: a assinatura não é verificável em tempo de execução. */
export type ExternalFunction = (...args: unknown[]) => unknown;

/** Padrão dos identificadores de finalidade e de categoria. */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/**
 * Nomes de propriedades de `Object.prototype` que casam com {@link ID_PATTERN}. A lista é fixa de
 * propósito: se fosse calculada a partir de `Object.prototype` em tempo de execução, mudaria com
 * um protótipo poluído.
 */
const RESERVED_IDS: ReadonlySet<string> = new Set([
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
]);

/**
 * Objeto simples: `typeof` igual a `'object'`, diferente de `null`, com protótipo `Object.prototype`
 * ou `null`. Arrays, instâncias de classes e objetos de outro realm não são objetos simples.
 */
export function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Função de origem externa, como o relógio (`now`) e os ouvintes. */
export function isFunction(value: unknown): value is ExternalFunction {
  return typeof value === 'function';
}

/** Identificador válido de finalidade ou de categoria. */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value) && !RESERVED_IDS.has(value);
}

/** Versão válida: texto opaco não vazio. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Resultado de uma decisão: `'granted'` ou `'denied'`. */
export function isDecidedStatus(value: unknown): value is DecidedStatus {
  return value === 'granted' || value === 'denied';
}

/** Instante válido: inteiro seguro não negativo, em milissegundos. */
export function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Tipo de `value` nas mensagens de erro: `null`, `array` ou o resultado de `typeof`. */
export function describe(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}
