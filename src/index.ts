/**
 * LGPDer: consent and privacy preference management core for web applications.
 *
 * Keeps, per purpose, the consent decisions that the application records in response to actions
 * of the data subject, reports the status of each purpose and notifies changes. It does not access
 * the network, storage or browser APIs, does not collect data on its own initiative and performs
 * no tracking or telemetry.
 *
 * Using LGPDer does not guarantee compliance with the LGPD (Brazilian Law No. 13,709/2018).
 * Compliance depends on the context of the processing and on how the application uses the library.
 *
 * @packageDocumentation
 */

import { createManager } from './manager.ts';

/* eslint-disable @typescript-eslint/consistent-indexed-object-style -- the mapped types
 * (`{ readonly [K in P]: T }`) are the shape of the published API, checked for the inference of
 * `P` and `C`; the `Record` form would change the `.d.ts`. */

/**
 * Effective status of a purpose.
 *
 * - `'pending'`: there is no current decision. There was never a decision, the last one was
 *   recorded under another version of the purpose (see {@link ConsentSnapshot.outdated}), or it
 *   expired (see {@link ConsentOptions.maxAge}).
 * - `'granted'`: consent granted under the current version.
 * - `'denied'`: consent refused or revoked under the current version.
 *
 * Only `'granted'` authorizes consent-based processing.
 */
export type ConsentStatus = 'pending' | 'granted' | 'denied';

/**
 * Outcome that a decision records: a grant (`'granted'`) or a refusal (`'denied'`).
 * Revoking consent is recording `'denied'`.
 */
export type DecidedStatus = Exclude<ConsentStatus, 'pending'>;

/**
 * Configuration of a consent-based processing purpose.
 *
 * @typeParam C - Union of the category ids.
 */
export interface PurposeConfig<C extends string = string> {
  /**
   * Version of the information presented to the data subject about this purpose: a non-empty
   * opaque string, compared by strict equality, without ordering. A decision recorded under
   * another version is no longer current: the purpose goes back to `'pending'` and is flagged in
   * `outdated`. Absent: the purpose is not versioned.
   */
  readonly version?: string | undefined;
  /**
   * Category used only to group purposes (for example, in the interface). It has no consent state
   * of its own and changes no rule of the core. Follows the format of purpose ids.
   */
  readonly category?: C | undefined;
  /**
   * If `true`, {@link ConsentManager.grantAll} does not reach this purpose: it is only granted
   * when named in {@link ConsentManager.decide}. {@link ConsentManager.denyAll} includes it as
   * usual. Meant for purposes that require a specific decision, such as those involving sensitive
   * personal data or data of children. Default: `false`.
   */
  readonly individualGrant?: boolean | undefined;
}

/**
 * Options of {@link createConsentManager}.
 *
 * @typeParam P - Union of the purpose ids.
 * @typeParam C - Union of the category ids.
 */
export interface ConsentOptions<P extends string = string, C extends string = string> {
  /**
   * Consent-based purposes, indexed by id; at least one. An id starts with an ASCII letter and
   * contains only ASCII letters, digits, `_`, `-` and `.`; names of `Object.prototype` properties
   * (such as `toString`) are rejected. The key order defines the order used in snapshots, records
   * and notifications.
   */
  readonly purposes: { readonly [K in P]: PurposeConfig<C> };
  /**
   * Previously saved record, as an object or as JSON text. It is treated as untrusted data and
   * read only as an own property of the options, so an inherited `record` is ignored. Missing or
   * invalid content is discarded without error, and so are decisions that are no longer current
   * (see {@link ConsentOptions.maxAge}); the affected purpose stays `'pending'`.
   */
  readonly record?: unknown;
  /**
   * Clock used for `decidedAt` and for the expiry of decisions. Must return milliseconds since
   * 1970-01-01T00:00:00Z as a non-negative safe integer. Called without `this`. Default: the start
   * of the current UTC day, from `Date.now` as read when the manager is created. The rounding keeps
   * `decidedAt` from singling out the device; pass a more precise clock, such as `Date.now`, only
   * if the application needs it. Read only as an own property of the options.
   */
  readonly now?: (() => number) | undefined;
  /**
   * Maximum age of a decision, grant or refusal, in milliseconds: a positive safe integer.
   * Default: 365 days. A decision is current while `0 <= now() - decidedAt < maxAge`. Expiry is
   * evaluated, with the configured clock, when the manager hydrates `record` and on each
   * {@link ConsentManager.restore}, never continuously: a decision that expires while the page is
   * open stays current until the next restore. An expired decision, or one dated after the clock,
   * is discarded as if it did not exist, and if the clock throws or returns an invalid value, every
   * decision being evaluated is discarded. Read only as an own property of the options, so an
   * inherited `maxAge` never revives an expired decision.
   */
  readonly maxAge?: number | undefined;
}

/** Decision recorded for a purpose. Frozen object. */
export interface ConsentDecision {
  /** `'granted'` for a grant; `'denied'` for a refusal or revocation. */
  readonly status: DecidedStatus;
  /** Version of the purpose at the time of the decision; absent if it was not versioned. */
  readonly version?: string;
  /** Instant of the decision, in milliseconds since 1970-01-01T00:00:00Z, from the configured clock. */
  readonly decidedAt: number;
}

/**
 * Serializable record of the decisions. It is what the application persists, with
 * `JSON.stringify(snapshot.record)`, and gives back in `record` or in `restore()`. It contains no
 * identifier assigned by LGPDer; the instant of each decision, depending on the precision of the
 * clock (`now`), could single out the device. Frozen object.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface ConsentRecord<P extends string = string> {
  /** Version of the record format, independent of the purpose versions and of the package. */
  readonly format: 1;
  /**
   * Last decision of each configured purpose that has one, current or outdated, in configuration
   * order.
   */
  readonly decisions: { readonly [K in P]?: ConsentDecision };
}

/**
 * Immutable state of the preferences at an instant. Frozen object.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface ConsentSnapshot<P extends string = string> {
  /** Effective status of each configured purpose, in configuration order. */
  readonly status: { readonly [K in P]: ConsentStatus };
  /**
   * `true` when the purpose has a decision recorded under a version other than the current one;
   * the status is then `'pending'`. Lets the application inform the data subject about the change
   * and collect a new decision. It is not a revocation.
   */
  readonly outdated: { readonly [K in P]: boolean };
  /** Serializable record matching this state. */
  readonly record: ConsentRecord<P>;
}

/**
 * Source of a change.
 *
 * - `'decision'`: decision recorded in this instance by `decide`, `grantAll` or `denyAll`.
 * - `'restore'`: external record adopted by `restore`. It does not represent a new expression of
 *   the will of the data subject.
 */
export type ChangeSource = 'decision' | 'restore';

/**
 * Notification delivered to the listeners after each change of the record. Frozen object.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface ConsentChange<P extends string = string> {
  /** Source of the change. */
  readonly source: ChangeSource;
  /**
   * Purposes whose record entry changed, in configuration order; never empty. In changes with
   * source `'restore'`, it may include purposes whose effective status did not change (for
   * example, when only `decidedAt` changed): compare `previous.status` and `snapshot.status` to
   * react to status changes.
   */
  readonly changed: readonly P[];
  /** State right after this change. */
  readonly snapshot: ConsentSnapshot<P>;
  /** State right before this change. */
  readonly previous: ConsentSnapshot<P>;
}

/**
 * Function called after each change of the record. The returned value is ignored.
 *
 * @typeParam P - Union of the purpose ids.
 */
export type ConsentListener<P extends string = string> = (change: ConsentChange<P>) => void;

/**
 * Decisions to record, per purpose. Omitted purposes, or purposes with `undefined`, do not change.
 *
 * @typeParam P - Union of the purpose ids.
 */
export type ConsentChoices<P extends string = string> = {
  readonly [K in P]?: DecidedStatus | undefined;
};

/**
 * Consent manager. Frozen object; the functions do not depend on `this` and can be destructured or
 * passed along, for example to the `useSyncExternalStore` hook of React.
 *
 * @typeParam P - Union of the purpose ids.
 * @typeParam C - Union of the category ids.
 */
export interface ConsentManager<P extends string = string, C extends string = string> {
  /**
   * Frozen copy of the purpose configuration, in declared order. Each configuration contains only
   * the properties given with a value other than `undefined`.
   */
  readonly purposes: { readonly [K in P]: PurposeConfig<C> };

  /**
   * Effective maximum age of a decision, in milliseconds: {@link ConsentOptions.maxAge} or its
   * default of 365 days. Lets persistence align the lifetime of the stored record, such as a
   * cookie `max-age`, with the expiry of the decisions.
   */
  readonly maxAge: number;

  /**
   * Returns the current state. Between two notifications, always returns the same object.
   */
  readonly getSnapshot: () => ConsentSnapshot<P>;

  /**
   * Returns a state without any decision (every purpose `'pending'`), created at construction and
   * always the same object. Meant for server rendering and for hydration when the record only
   * exists in the browser.
   */
  readonly getServerSnapshot: () => ConsentSnapshot<P>;

  /**
   * Records, changes or revokes decisions in one atomic operation. Revoking is recording
   * `'denied'` for a granted purpose. Omitted purposes, or purposes with `undefined`, do not
   * change, and repeating the current status changes nothing (not even `decidedAt`). The
   * application must call it only in response to an explicit action of the data subject.
   *
   * @param choices - Decision per purpose.
   * @throws {TypeError} `choices` is not a plain object, a value is not `'granted'`, `'denied'` or
   * `undefined`, or the clock did not return a non-negative safe integer.
   * @throws {RangeError} `choices` has a key that is not a configured purpose, even with the value
   * `undefined`.
   * On any error, nothing changes and nothing is notified.
   */
  readonly decide: (choices: ConsentChoices<P>) => void;

  /**
   * Grants, in one atomic operation, the configured purposes without `individualGrant: true`.
   * Records one decision per purpose: it creates no generic authorization and does not reach
   * purposes declared later.
   *
   * @throws {TypeError} The clock did not return a non-negative safe integer. Nothing changes.
   */
  readonly grantAll: () => void;

  /**
   * Refuses or revokes, in one atomic operation, every configured purpose, including those marked
   * with `individualGrant: true`.
   *
   * @throws {TypeError} The clock did not return a non-negative safe integer. Nothing changes.
   */
  readonly denyAll: () => void;

  /**
   * Replaces every decision with the valid and current content of an external record (object or
   * JSON text), treated as untrusted data; missing or invalid content is an empty record, and
   * expired decisions are discarded (see {@link ConsentOptions.maxAge}). Notifies with
   * `source: 'restore'` if any entry changes. Use it to adopt the record written by another tab or
   * loaded from the backend of the application, before collecting new decisions: restoring does
   * not represent an expression of the will of the data subject, is not a revocation and replaces
   * more recent local decisions. Never throws.
   *
   * @param record - Record to adopt.
   */
  readonly restore: (record: unknown) => void;

  /**
   * Subscribes a listener, called synchronously after each change of the record, in subscription
   * order. Exceptions thrown by a listener interrupt neither the other listeners nor the operation:
   * they are rethrown in a microtask. Compatible with the `useSyncExternalStore` hook of React.
   *
   * @param listener - Function that receives each notification.
   * @returns Idempotent function that cancels this subscription.
   * @throws {TypeError} `listener` is not a function.
   */
  readonly subscribe: (listener: ConsentListener<P>) => () => void;
}

/* eslint-enable @typescript-eslint/consistent-indexed-object-style */

/**
 * Creates a consent manager.
 *
 * The purpose and category ids are inferred as literal unions from `options.purposes`. The
 * configuration is written by the developer: it is validated directly, for type and format, and
 * copied, and unknown keys are rejected. `options.record`, if given as an own property, is read as
 * untrusted data. Creation does not notify. It calls the clock at most once, to evaluate the
 * expiry of the hydrated decisions, and only if `options.record` has at least one valid decision.
 *
 * @typeParam P - Union of the purpose ids.
 * @typeParam C - Union of the category ids (`never` when no purpose declares a category).
 * @param options - Purposes, saved record, clock and maximum age of the decisions.
 * @returns Frozen manager.
 * @throws {TypeError} Invalid configuration.
 *
 * @example
 * ```ts
 * const consent = createConsentManager({
 *   purposes: {
 *     analytics: { version: '2026-10', category: 'statistics' },
 *     ads: { version: '2026-10', category: 'marketing' },
 *   },
 * });
 * consent.decide({ analytics: 'granted', ads: 'denied' });
 * consent.getSnapshot().status.analytics; // 'granted'
 * ```
 */
export function createConsentManager<P extends string, C extends string = never>(
  options: ConsentOptions<P, C>,
): ConsentManager<P, C>;
export function createConsentManager(options: unknown): ConsentManager {
  return createManager(options);
}
