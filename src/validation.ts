import type { DecidedStatus } from './index.ts';

/** Plain object already checked: properties read by string key, with untrusted values. */
export type PlainObject = Readonly<Record<string, unknown>>;

/** Function received from outside: its signature cannot be checked at run time. */
export type ExternalFunction = (...args: unknown[]) => unknown;

/** Pattern of purpose and category ids. */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/**
 * Names of `Object.prototype` properties that match {@link ID_PATTERN}. They are rejected as ids so
 * that a purpose or category never collides with a property every object inherits.
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
 * Plain object: `typeof` equal to `'object'`, not `null`, with prototype `Object.prototype` or
 * `null`. Arrays, class instances and objects from another realm are not plain objects.
 */
export function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Function from outside, such as the clock (`now`) and the listeners. */
export function isFunction(value: unknown): value is ExternalFunction {
  return typeof value === 'function';
}

/** Valid purpose or category id. */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value) && !RESERVED_IDS.has(value);
}

/** Valid version: non-empty opaque string. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Outcome of a decision: `'granted'` or `'denied'`. */
export function isDecidedStatus(value: unknown): value is DecidedStatus {
  return value === 'granted' || value === 'denied';
}

/** Valid instant: non-negative safe integer, in milliseconds. */
export function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Valid duration: positive safe integer, in milliseconds. */
export function isDuration(value: unknown): value is number {
  return isTimestamp(value) && value > 0;
}

/**
 * Value of an own property. Inherited properties are `undefined`, so that a polluted prototype
 * never completes the record nor the options that decide whether a decision is still current.
 */
export function ownValue(object: PlainObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** Type of `value` in error messages: `null`, `array` or the result of `typeof`. */
export function describe(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}
