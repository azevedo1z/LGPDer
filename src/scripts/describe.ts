/**
 * `value` as quoted text for an error message: a primitive as `String` writes it, and an object or
 * a function as its type, so that no code of the application (`toString`) runs and building the
 * message never throws.
 */
export function describeItem(value: unknown): string {
  const isObject = (typeof value === 'object' && value !== null) || typeof value === 'function';
  return JSON.stringify(isObject ? typeof value : String(value));
}
