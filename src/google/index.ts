/**
 * LGPDer google: drives the Google Consent Mode v2 from the consent of each purpose.
 *
 * Each purpose declares the Consent Mode types it controls, directly or through a built-in
 * integration. A type is granted only while every purpose that controls it is granted; the types
 * no purpose controls stay denied. The layer sends the seven types on connection and on every
 * notification of the manager, from its current state.
 *
 * @packageDocumentation
 */

import type { ConsentManager, ConsentSnapshot, ConsentStatus } from '../index.ts';

/* eslint-disable @typescript-eslint/consistent-indexed-object-style -- the mapped type of
 * `GoogleOptions.purposes` is the shape of the published API, as in the core. */

/** Built-in integration: brings the Consent Mode types it uses. */
export type Integration = 'google-analytics' | 'google-ads';

/** Consent type of the Google Consent Mode v2. */
export type ConsentType =
  | 'ad_storage'
  | 'ad_user_data'
  | 'ad_personalization'
  | 'analytics_storage'
  | 'functionality_storage'
  | 'personalization_storage'
  | 'security_storage';

/** Options of one purpose in {@link GoogleOptions.purposes}. */
export interface GooglePurposeOptions {
  /**
   * Built-in integrations used by the purpose: `'google-analytics'` controls `analytics_storage`,
   * and `'google-ads'` controls `ad_storage`, `ad_user_data` and `ad_personalization`.
   */
  readonly integrations?: readonly Integration[] | undefined;
  /** Consent Mode types controlled by the purpose, besides the ones of its integrations. */
  readonly consentMode?: readonly ConsentType[] | undefined;
}

/**
 * Options of {@link connectGoogle}. Read only as own properties; unknown keys are rejected.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface GoogleOptions<P extends string = string> {
  /** Consent Mode types controlled by each purpose. */
  readonly purposes: { readonly [K in P]?: GooglePurposeOptions };
  /** Warns in the console when the consent default had to be pushed by the layer. */
  readonly debug?: boolean | undefined;
}

/* eslint-enable @typescript-eslint/consistent-indexed-object-style */

/** Handle of the google layer. Frozen object; `destroy` does not depend on `this`. */
export interface ConsentGoogle {
  /** Stops following the manager, without sending anything. Idempotent. */
  readonly destroy: () => void;
}

/** Value of a consent type in a command. */
type ConsentValue = 'granted' | 'denied';

/** Parameters of a consent command: every type, in the order of {@link CONSENT_TYPES}. */
type ConsentParams = Readonly<Record<string, ConsentValue | number>>;

/** Signature of `gtag` for the consent commands. */
type Gtag = (command: 'consent', action: 'default' | 'update', params: ConsentParams) => void;

/** Globals of the Google tag, read from `window` when used. */
interface GooglePage {
  dataLayer?: unknown;
  readonly gtag?: unknown;
}

/** Every consent type, in the order they are sent. */
const CONSENT_TYPES: readonly ConsentType[] = [
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'analytics_storage',
  'functionality_storage',
  'personalization_storage',
  'security_storage',
];

/** Consent types of each built-in integration. */
const INTEGRATION_TYPES: Readonly<Record<Integration, readonly ConsentType[]>> = {
  'google-analytics': ['analytics_storage'],
  'google-ads': ['ad_storage', 'ad_user_data', 'ad_personalization'],
};

/** Every built-in integration. */
const INTEGRATIONS = Object.keys(INTEGRATION_TYPES) as readonly Integration[];

/** Milliseconds the Google tag waits for the first update after the default. */
const WAIT_FOR_UPDATE = 500;

/** Keys of {@link GoogleOptions}, in validation order. */
const OPTION_KEYS = ['purposes', 'debug'] as const;

/** Keys of {@link GooglePurposeOptions}, in validation order. */
const PURPOSE_KEYS = ['integrations', 'consentMode'] as const;

/**
 * Inline script to run in the `<head>` before the Google tag, such as through the `<Script>` of a
 * framework: it creates `window.dataLayer` and `gtag`, as the official snippet does, and sets every
 * consent type to `'denied'` with `wait_for_update: 500`. Without it, {@link connectGoogle} pushes
 * the same default when it connects, which may be after a tag already loaded.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- required by isolatedDeclarations
export const consentDefaultSnippet: string = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{${CONSENT_TYPES.map((type) => `${type}:'denied'`).join(',')},wait_for_update:${String(WAIT_FOR_UPDATE)}});`;

/** Validated options. */
interface Settings {
  /** Purposes that control each consent type, in the order of {@link CONSENT_TYPES}. */
  readonly controllers: readonly (readonly [ConsentType, readonly string[]])[];
  /** Writes to the console with `debug`; does nothing otherwise. */
  readonly warn: (message: string) => void;
}

/** Does nothing. */
function ignore(): void {
  // nothing to do
}

/**
 * Copies the own enumerable properties of `value` to a null-prototype object, so that a property
 * planted on a polluted prototype is never read.
 *
 * @throws {TypeError} `value` is not an object, with `message`.
 */
function copyOwn(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) throw new TypeError(message);
  return Object.assign(Object.create(null) as Record<string, unknown>, value);
}

/** @throws {TypeError} `own` has a key outside `keys`. */
function rejectUnknownKeys(own: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const unknown = Object.keys(own).find((key) => !keys.includes(key));
  if (unknown !== undefined) {
    throw new TypeError(`[lgpder] Unknown option: ${JSON.stringify(unknown)}.`);
  }
}

/**
 * A list item as quoted text for an error message: a primitive as `String` writes it, and an
 * object or a function as its type, so that no code of the application (`toString`) runs.
 */
function describeItem(entry: unknown): string {
  const isObject = (typeof entry === 'object' && entry !== null) || typeof entry === 'function';
  return JSON.stringify(isObject ? typeof entry : String(entry));
}

/**
 * Validates every item of an optional array, which must be one of `allowed`.
 *
 * @throws {TypeError} `value` is neither `undefined` nor an array, or an item is not allowed.
 */
function parseList<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
  item: string,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`[lgpder] "${name}" must be an array.`);
  // Every index is visited and read only as an own property: a hole of a sparse array is refused,
  // never filled with a value planted on a polluted prototype.
  return Array.from({ length: value.length }, (_, index) => {
    const entry: unknown = Object.hasOwn(value, index) ? value[index] : undefined;
    if (!allowed.includes(entry as T)) {
      throw new TypeError(`[lgpder] Unknown ${item}: ${describeItem(entry)}.`);
    }
    return entry as T;
  });
}

/**
 * The consent types controlled by each configured purpose.
 *
 * @throws {RangeError} A purpose is not configured.
 * @throws {TypeError} Invalid options of a purpose.
 */
function parsePurposes(consent: ConsentManager, purposes: unknown): Settings['controllers'] {
  const own = copyOwn(purposes, '[lgpder] "purposes" must be an object.');
  const controllers = new Map<ConsentType, string[]>(CONSENT_TYPES.map((type) => [type, []]));
  for (const [id, value] of Object.entries(own)) {
    if (!Object.hasOwn(consent.purposes, id)) {
      throw new RangeError(`[lgpder] Unknown purpose: ${JSON.stringify(id)}.`);
    }
    if (value === undefined) continue;
    const options = copyOwn(
      value,
      `[lgpder] The options of ${JSON.stringify(id)} must be an object.`,
    );
    rejectUnknownKeys(options, PURPOSE_KEYS);
    const integrations = parseList(
      options['integrations'],
      'integrations',
      INTEGRATIONS,
      'integration',
    );
    const types = new Set([
      ...integrations.flatMap((integration) => INTEGRATION_TYPES[integration]),
      ...parseList(options['consentMode'], 'consentMode', CONSENT_TYPES, 'consent type'),
    ]);
    for (const type of types) controllers.get(type)?.push(id);
  }
  return [...controllers];
}

/**
 * Validates every option, in the order of {@link OPTION_KEYS}, before any effect.
 *
 * @throws {TypeError} Invalid options.
 * @throws {RangeError} `purposes` has a purpose that is not configured.
 */
function parseOptions(consent: ConsentManager, options: unknown): Settings {
  const own = copyOwn(options, '[lgpder] Options must be an object.');
  rejectUnknownKeys(own, OPTION_KEYS);
  const controllers = parsePurposes(consent, own['purposes']);
  const { debug = false } = own;
  if (typeof debug !== 'boolean') throw new TypeError('[lgpder] "debug" must be a boolean.');
  return {
    controllers,
    warn: debug
      ? (message): void => {
          console.warn(message);
        }
      : ignore,
  };
}

/**
 * Every consent type, granted only when some purpose controls it and every purpose that controls
 * it is granted.
 */
function consentParams(
  controllers: Settings['controllers'],
  status: Readonly<Record<string, ConsentStatus>>,
): ConsentParams {
  const params: Record<string, ConsentValue> = {};
  for (const [type, purposes] of controllers) {
    const granted = purposes.length > 0 && purposes.every((id) => status[id] === 'granted');
    params[type] = granted ? 'granted' : 'denied';
  }
  return params;
}

/** Every consent type denied, with the wait for the first update. */
function defaultParams(): ConsentParams {
  return {
    ...Object.fromEntries(CONSENT_TYPES.map((type) => [type, 'denied'])),
    wait_for_update: WAIT_FOR_UPDATE,
  };
}

/**
 * Whether `entry` of the dataLayer is a `gtag('consent', 'default', ...)` command: an `arguments`
 * object, of any realm, as the Google tag reads it. An array or a plain object with the same items
 * is ignored by the tag, so it is not a default.
 */
function isConsentDefault(entry: unknown): boolean {
  if (Object.prototype.toString.call(entry) !== '[object Arguments]') return false;
  const command = entry as IArguments;
  return command[0] === 'consent' && command[1] === 'default';
}

/** Whether the dataLayer already has a consent default, such as the one of the snippet. */
function hasConsentDefault(): boolean {
  const { dataLayer } = window as GooglePage;
  return Array.isArray(dataLayer) && dataLayer.some(isConsentDefault);
}

/**
 * Queues a command in the dataLayer as the official snippet does: the Google tag reads the
 * `arguments` object of each command, and ignores an array.
 */
const queue: Gtag = function (): void {
  const page = window as GooglePage;
  // A dataLayer of the page without `push` throws here, and `send` rethrows the error.
  const dataLayer = (page.dataLayer ??= []) as unknown[];
  // eslint-disable-next-line prefer-rest-params -- the Google tag requires the arguments object
  dataLayer.push(arguments);
};

/**
 * Sends a consent command through the `gtag` of the page or, without one, through the dataLayer.
 * The layer never defines `gtag`. An exception of the page is rethrown in a microtask, as the
 * manager does with its listeners, so the layer goes on and the error stays visible.
 */
function send(action: 'default' | 'update', params: ConsentParams): void {
  const { gtag } = window as GooglePage;
  try {
    (typeof gtag === 'function' ? (gtag as Gtag) : queue)('consent', action, params);
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

/**
 * Connects a manager to the Google Consent Mode v2.
 *
 * A consent type is `'granted'` only when some purpose controls it, directly through
 * `consentMode` or through a built-in integration, and every purpose that controls it is granted.
 * The seven types are always sent, the ones no purpose controls as `'denied'`.
 *
 * On connection, if the dataLayer has no consent default (such as the one of
 * {@link consentDefaultSnippet}), the layer pushes one, with every type denied. Then it sends
 * `gtag('consent', 'update', ...)` on connection and on every notification of the manager,
 * computed from its current state. Commands go through `window.gtag` when it is a function, and
 * otherwise are queued in `window.dataLayer`, created if missing; the layer never defines `gtag`.
 *
 * Outside the browser (no `document`), the options are validated and the handle does nothing.
 *
 * Connect it before the scripts layer, so that the update reaches the dataLayer before the Google
 * tag a grant activates, and before the cleanup of a revocation.
 *
 * @typeParam P - Union of the purpose ids.
 * @param consent - Manager whose purposes control the consent types.
 * @param options - Consent types of each purpose and debug warnings.
 * @returns Frozen handle.
 * @throws {TypeError} Invalid options.
 * @throws {RangeError} `options.purposes` has a purpose that is not configured.
 *
 * @example
 * ```ts
 * const consent = createConsentManager({ purposes: { analytics: {}, ads: {} } });
 * connectGoogle(consent, {
 *   purposes: {
 *     analytics: { integrations: ['google-analytics'] },
 *     ads: { integrations: ['google-ads'] },
 *   },
 * });
 * ```
 */
export function connectGoogle<P extends string>(
  consent: ConsentManager<P>,
  options: GoogleOptions<P>,
): ConsentGoogle;
export function connectGoogle(consent: ConsentManager, options: unknown): ConsentGoogle {
  const { controllers, warn } = parseOptions(consent, options);
  let unsubscribe: (() => void) | undefined;

  if (typeof document !== 'undefined') {
    if (!hasConsentDefault()) {
      warn(
        '[lgpder] No consent default was found in the dataLayer; it was pushed now. Run consentDefaultSnippet in the <head>, before the Google tag.',
      );
      send('default', defaultParams());
    }
    const sendUpdate = (snapshot: ConsentSnapshot): void => {
      send('update', consentParams(controllers, snapshot.status));
    };
    const update = (): void => {
      sendUpdate(consent.getSnapshot());
    };
    const first = consent.getSnapshot();
    sendUpdate(first);
    unsubscribe = consent.subscribe(update);
    // A decision made by code of the page while it handled the first update is not notified to a
    // subscription made after it, so it is sent now.
    if (consent.getSnapshot() !== first) update();
  }

  return Object.freeze({
    destroy: (): void => {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  });
}
