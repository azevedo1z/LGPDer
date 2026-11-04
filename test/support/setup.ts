/**
 * Builders of the manager and of the test clock, plus the only type conversion points used to
 * simulate calls made from untyped JavaScript.
 */
import type { ConsentChange, ConsentManager, PurposeConfig } from 'lgpder';

import { createConsentManager } from '../../src/index.ts';

/** One day, in milliseconds. */
export const DAY = 86_400_000;

/** 2026-10-31T12:00:00.000Z, initial instant of the test clock. */
export const START = 1_793_448_000_000;

/** 2026-10-31T00:00:00.000Z: the start of the UTC day of {@link START}. */
export const START_OF_DAY = 1_793_404_800_000;

/** Default `maxAge`: 365 days. */
export const DEFAULT_MAX_AGE = 365 * DAY;

/**
 * Default fixture: a versioned purpose, an unversioned one and one that is only granted when named
 * in `decide`.
 */
export const PURPOSES = {
  analytics: { version: '2026-10', category: 'statistics' },
  ads: { category: 'marketing' },
  health: { version: '1', category: 'health', individualGrant: true },
} as const satisfies Record<string, PurposeConfig>;

export type PurposeId = keyof typeof PURPOSES;

/** Deterministic clock: always returns the current instant, which only changes with `advance`. */
export interface TestClock {
  readonly now: () => number;
  readonly advance: (ms: number) => void;
  /** How many times `now` was called. */
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
  readonly maxAge?: number | undefined;
}

export interface Setup<P extends string> {
  readonly consent: ConsentManager<P>;
  readonly clock: TestClock;
  /** Notifications received by the first subscribed listener, in delivery order. */
  readonly changes: ConsentChange<P>[];
}

/** Options of {@link setup} for the default fixture. */
export interface FixtureSetupOptions {
  readonly record?: unknown;
  readonly maxAge?: number | undefined;
}

/** Creates the manager of the default fixture with the test clock and the notification recorder. */
export function setup(options?: FixtureSetupOptions): Setup<PurposeId>;
/** Creates the manager with its own purposes, the test clock and the notification recorder. */
export function setup<P extends string>(options: SetupOptions<P>): Setup<P>;
export function setup({
  purposes = PURPOSES,
  record,
  maxAge,
}: Partial<SetupOptions<string>> = {}): Setup<string> {
  const clock = createClock();
  const consent = createConsentManager({ purposes, record, maxAge, now: clock.now });
  const changes: ConsentChange[] = [];
  consent.subscribe((change) => {
    changes.push(change);
  });
  return { consent, clock, changes };
}

/**
 * Calls `fn` with any arguments (including none), as untyped JavaScript code would. Concentrates
 * the type conversion of invalid calls, instead of `as never` spread across the tests.
 */
export function callUntyped<R>(fn: (...args: never[]) => R, ...args: unknown[]): R {
  return (fn as (...values: unknown[]) => R)(...args);
}

/** `createConsentManager` called from JavaScript, with any value (or none) as options. */
export function createUntyped(...args: unknown[]): ConsentManager {
  return callUntyped<ConsentManager>(createConsentManager, ...args);
}

/** `decide` called from JavaScript, with any value (or none) as choices. */
export function decideUntyped(consent: ConsentManager, ...args: unknown[]): void {
  callUntyped(consent.decide, ...args);
}

/** Assigns `value` to `target[key]` without type checks, to try to change frozen objects. */
export function assignUntyped(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

/**
 * Returns `value` itself with its prototype replaced. With `null`, the result is still a plain
 * object; with another object, it is not.
 */
export function withPrototype(value: object, prototype: object | null): unknown {
  Object.setPrototypeOf(value, prototype);
  return value;
}

/**
 * Runs `act` with `Array.prototype` polluted by `value` at one numeric position per purpose of the
 * fixture, as a hostile script would, and undoes the pollution at the end.
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
   * With `false`, the polluted properties are read-only: in strict mode, assigning a property of
   * the same name on any plain object throws `TypeError`. Default: `true`.
   */
  readonly writable?: boolean;
}

/**
 * Runs `act` with `Object.prototype` polluted by the properties of `pollution`, as a hostile script
 * would, and returns the result. The pollution is undone in `finally`, with the original
 * descriptor of each key restored.
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
