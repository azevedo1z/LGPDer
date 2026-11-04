import type { PurposeConfig } from './index.ts';
import {
  describe,
  isDuration,
  isFunction,
  isPlainObject,
  isValidId,
  isVersion,
  ownValue,
  type PlainObject,
} from './validation.ts';

/** One day, in milliseconds. */
const DAY = 86_400_000;

/** Default `maxAge`: 365 days. */
const DEFAULT_MAX_AGE = 365 * DAY;

/** Validated and copied configuration. Frozen object. */
export interface Model {
  /** Purpose ids, in configuration order. */
  readonly ids: readonly string[];
  /** Position of each id in `ids`. */
  readonly positions: ReadonlyMap<string, number>;
  /** Configured version of each purpose, aligned with `ids`; `undefined` when not versioned. */
  readonly versions: readonly (string | undefined)[];
  /** Whether `grantAll` reaches each purpose, aligned with `ids` (no `individualGrant: true`). */
  readonly grantable: readonly boolean[];
  /** Public frozen copy of the configuration. */
  readonly purposes: Readonly<Record<string, PurposeConfig>>;
  /** Clock fixed at creation, called without `this`. */
  readonly now: () => unknown;
  /** Maximum age of a decision, in milliseconds. */
  readonly maxAge: number;
}

/** Result of {@link parseOptions}. */
export interface ParsedOptions {
  readonly model: Model;
  /**
   * Value of `options.record` when it is an own property. Kept out of the model so that the
   * received object is not retained.
   */
  readonly record: unknown;
}

const OPTION_KEYS: readonly string[] = ['purposes', 'record', 'now', 'maxAge'];
const PURPOSE_KEYS: readonly string[] = ['version', 'category', 'individualGrant'];

/**
 * Validates `options` and copies the configuration. The options are written by the developer, so
 * they are checked directly for type and format. Checks run in a fixed order, which defines the
 * error thrown when there is more than one problem: the options object, unknown options,
 * `purposes` and each purpose in key order, `now` and `maxAge`. `record` is untrusted data: it is
 * read only as an own property and never validated here. `now` and `maxAge`, which govern the
 * expiry of the record, are also read only as own properties.
 */
export function parseOptions(options: unknown): ParsedOptions {
  if (!isPlainObject(options)) {
    throw new TypeError(`[lgpder] Options must be a plain object; received: ${describe(options)}.`);
  }
  const unknownOption = findUnknownKey(options, OPTION_KEYS);
  if (unknownOption !== undefined) {
    throw new TypeError(`[lgpder] Unknown option: ${JSON.stringify(unknownOption)}.`);
  }
  const { purposes } = options;
  // `record` is the entry point of untrusted data, and `now` and `maxAge` decide whether its
  // decisions are still current: an inherited value, planted on a polluted prototype, would hydrate
  // decisions the data subject never made or revive expired ones.
  const record = ownValue(options, 'record');
  const now = ownValue(options, 'now');
  const maxAge = ownValue(options, 'maxAge');
  const parsed = parsePurposes(purposes);
  if (now !== undefined && !isFunction(now)) {
    throw new TypeError(`[lgpder] "now" must be a function; received: ${describe(now)}.`);
  }
  if (maxAge !== undefined && !isDuration(maxAge)) {
    throw new TypeError('[lgpder] "maxAge" must be a positive safe integer (milliseconds).');
  }

  const model: Model = {
    ...parsed,
    now: now ?? createDefaultClock(),
    maxAge: maxAge ?? DEFAULT_MAX_AGE,
  };
  return { model: Object.freeze(model), record };
}

/** Part of the model that comes from `purposes`. */
type PurposesModel = Pick<Model, 'ids' | 'positions' | 'versions' | 'grantable' | 'purposes'>;

/** Validates `purposes`, each purpose in key order, and builds its part of the model. */
function parsePurposes(purposes: unknown): PurposesModel {
  if (!isPlainObject(purposes)) {
    throw new TypeError(
      `[lgpder] "purposes" must be a plain object; received: ${describe(purposes)}.`,
    );
  }
  const entries = Object.entries(purposes);
  if (entries.length === 0) {
    throw new TypeError('[lgpder] "purposes" must declare at least one purpose.');
  }
  const ids: string[] = [];
  const positions = new Map<string, number>();
  const versions: (string | undefined)[] = [];
  const grantable: boolean[] = [];
  const copies: Record<string, PurposeConfig> = {};
  for (const [index, [id, value]] of entries.entries()) {
    if (!isValidId(id)) {
      throw new TypeError(`[lgpder] Invalid purpose id: ${JSON.stringify(id)}.`);
    }
    const config = parsePurpose(id, value);
    ids.push(id);
    positions.set(id, index);
    versions.push(config.version);
    grantable.push(config.individualGrant !== true);
    copies[id] = config;
  }
  return {
    ids: Object.freeze(ids),
    positions,
    versions: Object.freeze(versions),
    grantable: Object.freeze(grantable),
    purposes: Object.freeze(copies),
  };
}

/**
 * Validates the configuration of one purpose and returns a frozen copy with only the properties
 * given with a value other than `undefined`, in the order `version`, `category`,
 * `individualGrant`.
 */
function parsePurpose(id: string, value: unknown): PurposeConfig {
  if (!isPlainObject(value)) {
    throw new TypeError(
      `[lgpder] The configuration of purpose ${JSON.stringify(id)} must be a plain object; received: ${describe(value)}.`,
    );
  }
  const unknownKey = findUnknownKey(value, PURPOSE_KEYS);
  if (unknownKey !== undefined) {
    throw new TypeError(
      `[lgpder] Purpose ${JSON.stringify(id)} has the unknown property ${JSON.stringify(unknownKey)}.`,
    );
  }
  const { version, category, individualGrant } = value;
  if (version !== undefined && !isVersion(version)) {
    throw new TypeError(
      `[lgpder] The version of purpose ${JSON.stringify(id)} must be a non-empty string.`,
    );
  }
  if (category !== undefined && !isValidId(category)) {
    throw new TypeError(
      `[lgpder] The category of purpose ${JSON.stringify(id)} must be a valid id.`,
    );
  }
  if (individualGrant !== undefined && typeof individualGrant !== 'boolean') {
    throw new TypeError(
      `[lgpder] "individualGrant" of purpose ${JSON.stringify(id)} must be a boolean.`,
    );
  }

  const copy: { version?: string; category?: string; individualGrant?: boolean } = {};
  if (version !== undefined) copy.version = version;
  if (category !== undefined) copy.category = category;
  if (individualGrant !== undefined) copy.individualGrant = individualGrant;
  return Object.freeze(copy);
}

/** First own enumerable string key of `object` that is not in `allowed`. */
function findUnknownKey(object: PlainObject, allowed: readonly string[]): string | undefined {
  return Object.keys(object).find((key) => !allowed.includes(key));
}

/**
 * Default clock: the start of the current UTC day. A precise instant, persisted and possibly sent
 * to the server, would work as a pseudo-identifier of the browser. `Date.now` is read when the
 * manager is created, not when the module is imported, and replacing it later does not affect the
 * manager.
 */
function createDefaultClock(): () => number {
  const dateNow = Date.now;
  return () => Math.floor(dateNow() / DAY) * DAY;
}
