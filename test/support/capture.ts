/**
 * Collectors of what the code under test sends outside of its return value, for the tests of any
 * layer: the microtasks it schedules and the warnings it writes. Both are mocks of the test context,
 * restored when the test ends.
 */
import type { TestContext } from 'node:test';

/**
 * Replaces the global `queueMicrotask` with a collector, so that an error rethrown by the code under
 * test does not end the test. Returns the scheduled callbacks, which the test may run.
 */
export function captureMicrotasks(t: TestContext): (() => void)[] {
  const scheduled: (() => void)[] = [];
  t.mock.method(globalThis, 'queueMicrotask', (callback: () => void) => {
    scheduled.push(callback);
  });
  return scheduled;
}

/** Records the messages written with `console.warn` during the test, without printing them. */
export function captureWarnings(t: TestContext): string[] {
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => {
    warnings.push(message);
  });
  return warnings;
}
