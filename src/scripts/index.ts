/**
 * LGPDer scripts: blocks scripts, iframes and images until their purposes are granted, runs the
 * code of the application on a grant and gives a revocation real effect on the page.
 *
 * Elements marked with `data-consent` stay blocked until every purpose they name is granted. A
 * revocation blocks the iframes and images of the purpose again, stops the code registered with
 * `onGranted`, removes the cookies of the purpose and, when code that cannot be stopped is still
 * running, reloads the page. The layer decides from the current state of the manager, never from
 * the notification alone, so a decision made while a notification is delivered is never undone.
 *
 * @packageDocumentation
 */

import type { ConsentChoices, ConsentManager, ConsentSnapshot, ConsentStatus } from '../index.ts';
import {
  activatedPurposes,
  activateScript,
  blockEmbed,
  createEntry,
  findBlocked,
  findUnblocked,
  loadEmbed,
  purposesOf,
  removePlaceholder,
  showPlaceholder,
  type EmbedEntry,
  type Entry,
} from './blocking.ts';
import { COOKIES, detectIntegration, isIntegration } from './catalog.ts';
import { cookieMatcher, deleteCookies, parsePattern, type CookieMatcher } from './cookies.ts';
import { describeItem } from './describe.ts';

/* eslint-disable @typescript-eslint/consistent-indexed-object-style -- the mapped type of
 * `ScriptsOptions.purposes` is the shape of the published API, as in the core. */

/** Built-in integration: brings the list of cookies removed on a revocation. */
export type Integration = 'google-analytics' | 'google-ads';

/** Options of one purpose in {@link ScriptsOptions.purposes}. */
export interface ScriptsPurposeOptions {
  /**
   * Built-in integrations used by the purpose, whose cookies are removed when it is not granted:
   * `'google-analytics'` (`_ga`, `_ga_*`, `_gid`, `_gat`, `_gat_*`, `_gac_*`) and `'google-ads'`
   * (`_gcl_*`).
   */
  readonly integrations?: readonly Integration[] | undefined;
  /**
   * Own cookie names of the purpose, removed when it is not granted; a trailing `*` matches any
   * suffix (`'my_tracker_*'`). A lone `'*'` is refused.
   */
  readonly cookies?: readonly string[] | undefined;
}

/**
 * Revocation reported by {@link ScriptsOptions.onRevoke}. Frozen object.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface RevokeEvent<P extends string = string> {
  /** Revoked purposes, in configuration order. */
  readonly purposes: readonly P[];
  /** Whether code that cannot be stopped is still running on this page. */
  readonly requiresReload: boolean;
}

/**
 * What a placeholder needs to know about the blocked iframe it stands for. Frozen object.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface PlaceholderContext<P extends string = string> {
  /** The blocked iframe (hidden while the placeholder is shown). */
  readonly element: HTMLIFrameElement;
  /** Every purpose of its data-consent, in attribute order. */
  readonly purposes: readonly P[];
  /** Loads this element only, on this page, without recording a decision. */
  readonly load: () => void;
}

/**
 * Builds the placeholder shown before a blocked iframe, such as the one of `createPlaceholder` of
 * the ui layer. Called once each time the iframe becomes blocked; anything other than an element
 * is refused, and nothing is inserted.
 *
 * @typeParam P - Union of the purpose ids.
 */
export type PlaceholderRenderer<P extends string = string> = (
  context: PlaceholderContext<P>,
) => Element;

/**
 * Options of {@link connectScripts}. Read only as own properties; unknown keys are rejected.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface ScriptsOptions<P extends string = string> {
  /** Cookies of each purpose, removed when it is not granted. */
  readonly purposes?: { readonly [K in P]?: ScriptsPurposeOptions } | undefined;
  /**
   * What to do when a revoked purpose left code running that cannot be stopped: a script it
   * activated, or an `onGranted` function without cleanup. `'reload'` reloads the page once the
   * notification is delivered; `'manual'` leaves it to `onRevoke`. Default: `'reload'`.
   */
  readonly revocation?: 'reload' | 'manual' | undefined;
  /** Called on every revocation, in both modes, after the page was cleaned. */
  readonly onRevoke?: ((event: RevokeEvent<P>) => void) | undefined;
  /** Builds the placeholder of each blocked iframe. Without it, nothing is inserted. */
  readonly renderPlaceholder?: PlaceholderRenderer<P> | undefined;
  /**
   * Checked right before reloading: the reload happens only if it returns `true`, such as
   * `isPersisted` of the storage layer, since reloading without the revocation saved would bring
   * back the grant. Default: `() => true`.
   */
  readonly canReload?: (() => boolean) | undefined;
  /** Warns in the console about elements and scripts that are not blocked as expected. */
  readonly debug?: boolean | undefined;
}

/**
 * Handle of the scripts layer. Frozen object; the functions do not depend on `this`. After
 * {@link ConsentScripts.destroy}, every other function throws
 * `Error('[lgpder] This instance was destroyed.')`.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface ConsentScripts<P extends string = string> {
  /** Processes [data-consent] elements not yet seen under `root` (default: document). */
  readonly scan: (root?: ParentNode) => void;
  /**
   * Runs `fn` when `purpose` is granted, right away if it already is. If `fn` returns a function,
   * it is called when the purpose stops being granted, and `fn` runs again on a new grant;
   * otherwise `fn` never runs again on this page, and a revocation of the purpose requires a
   * reload.
   *
   * @returns Function that cancels the registration and calls the pending cleanup.
   * @throws {RangeError} `purpose` is not configured.
   * @throws {TypeError} `fn` is not a function.
   */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- fn may return nothing or a cleanup
  readonly onGranted: (purpose: P, fn: () => void | (() => void)) => () => void;
  /**
   * Whether applying `choices` would reload the page: in the `'reload'` mode, when it revokes a
   * purpose that left code running.
   *
   * @throws {TypeError} `choices` is not a plain object, or a value is not `'granted'`, `'denied'`
   * or `undefined`.
   * @throws {RangeError} `choices` has a purpose that is not configured.
   */
  readonly wouldReload: (choices: ConsentChoices<P>) => boolean;
  /**
   * Stops following the manager, calls the pending cleanups of `onGranted` and removes the
   * placeholders; loaded content stays. Idempotent.
   */
  readonly destroy: () => void;
}

/* eslint-enable @typescript-eslint/consistent-indexed-object-style */

const DESTROYED = '[lgpder] This instance was destroyed.';
const ROOT = '[lgpder] "root" must be a document, an element or a fragment.';
const PLACEHOLDER = '[lgpder] "renderPlaceholder" must return an element.';

/** `Node.ELEMENT_NODE`, without reading the global `Node`. */
const ELEMENT_NODE = 1;

/** Keys of {@link ScriptsOptions}, in validation order. */
const OPTION_KEYS = [
  'purposes',
  'revocation',
  'onRevoke',
  'renderPlaceholder',
  'canReload',
  'debug',
] as const;

/** Options that hold functions of the application, in validation order. */
const CALLBACK_KEYS = ['onRevoke', 'renderPlaceholder', 'canReload'] as const;

/** The options of {@link CALLBACK_KEYS}, once validated. */
type Callbacks = Pick<ScriptsOptions, (typeof CALLBACK_KEYS)[number]>;

/** Keys of {@link ScriptsPurposeOptions}. */
const PURPOSE_KEYS = ['integrations', 'cookies'] as const;

/** Validated options. */
interface Settings {
  /** Cookies of each purpose that has any. */
  readonly cookies: ReadonlyMap<string, CookieMatcher>;
  readonly reload: boolean;
  readonly onRevoke: ((event: RevokeEvent) => void) | undefined;
  readonly renderPlaceholder: PlaceholderRenderer | undefined;
  readonly canReload: () => boolean;
  readonly debug: boolean;
  /** Writes to the console with `debug`; does nothing otherwise. */
  readonly warn: (message: string) => void;
}

/** A function registered with `onGranted`. */
interface Registration {
  readonly purpose: string;
  readonly fn: () => unknown;
  /** Cleanup returned by the last run, pending until the purpose stops being granted. */
  cleanup: (() => unknown) | undefined;
  /** Whether it ran without returning a cleanup, so it never runs again. */
  spent: boolean;
}

/** Code left running on the page by the revoked purposes, and what the layer does about it. */
interface Revocation {
  /** Purposes that left code running on this page, which only a reload stops. */
  readonly running: Set<string>;
  /** Whether a reload is scheduled: nothing else is activated meanwhile. */
  readonly reloading: () => boolean;
  /** Whether revoking `revoked` would reload the page. */
  readonly wouldReload: (revoked: readonly string[]) => boolean;
  /** Reports `revoked` to `onRevoke` and, if it left code running, reloads or warns. */
  readonly revoke: (revoked: readonly string[]) => void;
}

/** Does nothing. */
function ignore(): void {
  // nothing to do
}

/**
 * Calls a function that may throw: one of the application, or a browser API the page may refuse,
 * such as `document.cookie` in an opaque origin. An exception is rethrown in a microtask, as the
 * manager does with its listeners, so the layer goes on and the error stays visible.
 */
function callGuarded<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
    return undefined;
  }
}

/**
 * Copies the own enumerable properties of `value` to a null-prototype object, so that a property
 * planted on a polluted prototype is never read.
 *
 * @throws {TypeError} `value` is neither `undefined` nor an object, with `message`.
 */
function copyOwn(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (value !== undefined && (typeof value !== 'object' || value === null)) {
    throw new TypeError(message);
  }
  return Object.assign(Object.create(null) as Record<string, unknown>, value);
}

/** @throws {TypeError} `own` has a key outside `keys`. */
function rejectUnknownKeys(own: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const unknown = Object.keys(own).find((key) => !keys.includes(key));
  if (unknown !== undefined) {
    throw new TypeError(`[lgpder] Unknown option: ${JSON.stringify(unknown)}.`);
  }
}

/** @throws {TypeError} `value` is neither `undefined` nor a function. */
function assertOptionalFunction(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError(`[lgpder] "${name}" must be a function.`);
  }
}

/**
 * Validates every item of an optional array.
 *
 * @throws {TypeError} `value` is neither `undefined` nor an array, or `parse` refuses an item.
 */
function parseList<T>(value: unknown, name: string, parse: (item: unknown) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`[lgpder] "${name}" must be an array.`);
  // Every index is visited and read only as an own property: a hole of a sparse array is refused
  // by `parse`, never filled with a value planted on a polluted prototype.
  return Array.from({ length: value.length }, (_, index) =>
    parse(Object.hasOwn(value, index) ? value[index] : undefined),
  );
}

/** @throws {TypeError} `value` is not a built-in integration. */
function parseIntegration(value: unknown): Integration {
  if (!isIntegration(value)) {
    throw new TypeError(`[lgpder] Unknown integration: ${describeItem(value)}.`);
  }
  return value;
}

/**
 * The cookies of each purpose: the ones of its integrations and its own.
 *
 * @throws {RangeError} A purpose is not configured.
 * @throws {TypeError} Invalid options of a purpose.
 */
function parsePurposes(consent: ConsentManager, purposes: unknown): Map<string, CookieMatcher> {
  const cookies = new Map<string, CookieMatcher>();
  const own = copyOwn(purposes, '[lgpder] "purposes" must be an object.');
  for (const [id, value] of Object.entries(own)) {
    if (!Object.hasOwn(consent.purposes, id)) {
      throw new RangeError(`[lgpder] Unknown purpose: ${JSON.stringify(id)}.`);
    }
    const options = copyOwn(
      value,
      `[lgpder] The options of ${JSON.stringify(id)} must be an object.`,
    );
    rejectUnknownKeys(options, PURPOSE_KEYS);
    const patterns = [
      ...parseList(options['integrations'], 'integrations', parseIntegration).flatMap(
        (integration) => COOKIES[integration],
      ),
      ...parseList(options['cookies'], 'cookies', parsePattern),
    ];
    if (patterns.length > 0) cookies.set(id, cookieMatcher(patterns));
  }
  return cookies;
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
  const cookies = parsePurposes(consent, own['purposes']);
  const { revocation = 'reload', debug = false } = own;
  if (revocation !== 'reload' && revocation !== 'manual') {
    throw new TypeError('[lgpder] "revocation" must be "reload" or "manual".');
  }
  for (const name of CALLBACK_KEYS) assertOptionalFunction(own[name], name);
  const { onRevoke, renderPlaceholder, canReload = (): boolean => true } = own as Callbacks;
  if (typeof debug !== 'boolean') throw new TypeError('[lgpder] "debug" must be a boolean.');
  return {
    cookies,
    reload: revocation === 'reload',
    onRevoke,
    renderPlaceholder,
    canReload,
    debug,
    warn: debug
      ? (message): void => {
          console.warn(message);
        }
      : ignore,
  };
}

/**
 * The revocation policy of an instance (D24, D33): the reload is scheduled once, in a microtask.
 * When `canReload` refuses it, the schedule is dropped, so that a later revocation tries again, and
 * `resume` applies the state held back meanwhile.
 *
 * @param isAlive - Whether the instance was not destroyed.
 * @param resume - Applies the current state of the manager again.
 */
function createRevocation(
  settings: Settings,
  isAlive: () => boolean,
  resume: () => void,
): Revocation {
  const running = new Set<string>();
  let reloading = false;

  const needsReload = (revoked: readonly string[]): boolean =>
    revoked.some((id) => running.has(id));

  const reload = (): void => {
    if (!isAlive()) return;
    if (callGuarded(settings.canReload) === true) {
      location.reload();
      return;
    }
    reloading = false;
    settings.warn('[lgpder] Reload skipped: the revocation is not known to be saved.');
    resume();
  };

  return {
    running,
    reloading: () => reloading,
    wouldReload: (revoked) => settings.reload && needsReload(revoked),
    revoke: (revoked) => {
      const requiresReload = needsReload(revoked);
      const { onRevoke } = settings;
      if (onRevoke !== undefined) {
        const event = Object.freeze({ purposes: Object.freeze(revoked), requiresReload });
        callGuarded(() => {
          onRevoke(event);
        });
      }
      if (!requiresReload) return;
      if (!settings.reload) {
        settings.warn(
          `[lgpder] Revoked purposes left code running until a reload: ${revoked.join(', ')}.`,
        );
      } else if (!reloading) {
        reloading = true;
        // After every listener received the notification, so the storage has saved the revocation.
        queueMicrotask(reload);
      }
    },
  };
}

/** Whether `value` is an element, also one from another realm. */
function isElement(value: unknown): value is Element {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly nodeType?: unknown }).nodeType === ELEMENT_NODE
  );
}

/** Whether `value` can be scanned: a document, an element or a fragment. */
function isParentNode(value: unknown): value is ParentNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly querySelectorAll?: unknown }).querySelectorAll === 'function'
  );
}

/** Whether `value` is an object whose prototype is `Object.prototype` or `null`. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Connects a manager to the elements of the page and to the code of the application.
 *
 * Blocked elements, all with `data-consent` listing one or more purposes separated by spaces:
 *
 * - `<script type="text/plain" data-consent="..." [data-src="..."]>`, inline or external: activated
 *   once, as a real script with the other attributes, the `nonce` and `async = false`. It is never
 *   run again on this page.
 * - `<iframe data-consent="..." data-src="...">` and `<img data-consent="..." data-src="...">`:
 *   without `src` until loaded, and blocked again on a revocation. A blocked iframe shows the
 *   placeholder of `renderPlaceholder`.
 *
 * An element is activated only when every purpose it names is configured and granted; an empty
 * `data-consent` never is. Activated elements get the `data-consent-active` attribute, so a later
 * instance on the same page knows which code is running. Elements inserted later are processed by
 * {@link ConsentScripts.scan}; there is no automatic interception.
 *
 * On connection, the cookies of every purpose that is not granted are removed. On a revocation
 * (a purpose this layer applied as granted that no longer is), in any mode: iframes and images of
 * the purpose are blocked again, the cleanups of `onGranted` are called, the cookies of the purpose
 * are removed and `onRevoke` is called. If the purpose activated a script on this page or ran an
 * `onGranted` function without cleanup, the `'reload'` mode reloads the page once, in a microtask,
 * if `canReload()` allows it; once a reload is scheduled, nothing else is activated. A reload that
 * `canReload()` refuses is dropped: activation goes on, and a later revocation tries again.
 *
 * Outside the browser (no `document`), the options are validated and the handle does nothing.
 *
 * Connect the storage first, so that the revocation is saved before the reload.
 *
 * @typeParam P - Union of the purpose ids.
 * @param consent - Manager whose purposes control the page.
 * @param options - Cookies per purpose, revocation mode, callbacks and debug warnings.
 * @returns Frozen handle.
 * @throws {TypeError} Invalid options.
 * @throws {RangeError} `options.purposes` has a purpose that is not configured.
 *
 * @example
 * ```ts
 * const consent = createConsentManager({ purposes: { analytics: {} } });
 * const storage = connectStorage(consent);
 * const scripts = connectScripts(consent, {
 *   purposes: { analytics: { integrations: ['google-analytics'] } },
 *   canReload: storage.isPersisted,
 * });
 * ```
 */
export function connectScripts<P extends string>(
  consent: ConsentManager<P>,
  options?: ScriptsOptions<P>,
): ConsentScripts<P>;
export function connectScripts(consent: ConsentManager, options?: unknown): ConsentScripts {
  const settings = parseOptions(consent, options);
  const { warn } = settings;
  const ids = Object.keys(consent.purposes);
  const isPurpose = (id: string): boolean => Object.hasOwn(consent.purposes, id);
  const inBrowser = typeof document !== 'undefined';

  // Every node the layer handled, including the ones it inserted, so that a scan skips them.
  const states = new WeakMap<Element, Entry>();
  // Handled elements still in the document, pruned on each scan and reconciliation.
  let known: Entry[] = [];
  // Scripts already reported by the debug warnings.
  const reported = new WeakSet<Element>();
  const registrations = new Set<Registration>();
  // Status this layer last applied to the page; every purpose starts pending.
  let applied: Readonly<Record<string, ConsentStatus>> = consent.getServerSnapshot().status;
  let swept = false;
  let reconciling = false;
  // Reconciliations requested, including the ones folded into the loop of a running one.
  let requests = 0;
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  const revocation = createRevocation(
    settings,
    () => !destroyed,
    () => {
      reconcile();
    },
  );
  const { running } = revocation;

  const assertAlive = (): void => {
    if (destroyed) throw new Error(DESTROYED);
  };

  const isGranted = (entry: Entry, status: Readonly<Record<string, ConsentStatus>>): boolean =>
    entry.valid && entry.purposes.every((id) => status[id] === 'granted');

  /** Drops the entries whose node left the document, and the activated scripts, which are done. */
  const prune = (): void => {
    known = known.filter((entry) => {
      if (entry.node.isConnected) return entry.kind === 'embed' || !entry.active;
      states.delete(entry.node);
      if (entry.kind === 'embed') entry.placeholder?.remove();
      return false;
    });
  };

  /**
   * Blocks again the iframes and images that lost a purpose. Content loaded by a placeholder,
   * without consent, stays until one of its purposes is denied.
   */
  const blockUngranted = (
    status: Readonly<Record<string, ConsentStatus>>,
    previous: Readonly<Record<string, ConsentStatus>>,
  ): void => {
    const deniedNow = (id: string): boolean => status[id] === 'denied' && previous[id] !== 'denied';
    for (const entry of known) {
      if (entry.kind !== 'embed' || !entry.active) continue;
      if (isGranted(entry, status)) {
        entry.loaded = false;
      } else if (!entry.loaded || entry.purposes.some(deniedNow)) {
        states.set(blockEmbed(entry), entry);
      }
    }
  };

  /** Calls the pending cleanups of the purposes that are no longer granted. */
  const stopUngranted = (status: Readonly<Record<string, ConsentStatus>>): void => {
    for (const registration of registrations) {
      const { cleanup } = registration;
      if (cleanup === undefined || status[registration.purpose] === 'granted') continue;
      registration.cleanup = undefined;
      callGuarded(cleanup);
    }
  };

  /**
   * Removes the cookies of `purposes`. On a page that refuses cookies (an opaque origin), the error
   * is rethrown and the revocation goes on.
   */
  const removeCookies = (purposes: readonly string[]): void => {
    const matchers = purposes.flatMap((id) => settings.cookies.get(id) ?? []);
    if (matchers.length === 0) return;
    callGuarded(() => {
      deleteCookies((name) => matchers.some((matches) => matches(name)));
    });
  };

  /** Runs a registration whose purpose is granted. */
  const run = (registration: Registration): void => {
    const cleanup = callGuarded(registration.fn);
    if (typeof cleanup !== 'function') {
      registration.spent = true;
      running.add(registration.purpose);
    } else if (registrations.has(registration)) {
      registration.cleanup = cleanup as () => unknown;
    } else {
      callGuarded(cleanup as () => unknown); // cancelled while running
    }
  };

  /**
   * Activates the granted elements and runs the granted registrations, while `snapshot` is still
   * the state of the manager: code run here may decide again.
   */
  const activateGranted = (snapshot: ConsentSnapshot): void => {
    const { status } = snapshot;
    const current = (): boolean =>
      !revocation.reloading() && !destroyed && consent.getSnapshot() === snapshot;
    for (const entry of known) {
      if (!current()) return;
      if (entry.active || !isGranted(entry, status)) continue;
      if (entry.kind === 'embed') loadEmbed(entry);
      else {
        // Before inserting: an inline script runs on insertion and may revoke at once.
        for (const id of entry.purposes) running.add(id);
        activateScript(entry);
      }
    }
    for (const registration of registrations) {
      if (!current()) return;
      const { spent, cleanup, purpose } = registration;
      if (!spent && cleanup === undefined && status[purpose] === 'granted') run(registration);
    }
  };

  /** Whether `element` is still the blocked node of `entry`, in a live instance. */
  const isBlocked = (entry: EmbedEntry, element: Element): boolean =>
    !destroyed && !entry.active && entry.node === element;

  /** Loads only this iframe, without a decision, unless it changed since its placeholder. */
  const load = (entry: EmbedEntry, element: Element): void => {
    if (revocation.reloading() || !isBlocked(entry, element)) return;
    loadEmbed(entry);
    entry.loaded = true;
  };

  /**
   * Calls the renderer once per block of each iframe, whatever it does. When it throws or returns
   * something other than an element, nothing is inserted and the error is rethrown.
   */
  const showPlaceholders = (): void => {
    const { renderPlaceholder } = settings;
    if (renderPlaceholder === undefined) return;
    for (const entry of known) {
      if (destroyed) return; // by onRevoke, by code activated just now or by the renderer
      if (entry.kind !== 'embed' || entry.active || !entry.valid || entry.rendered) continue;
      if (entry.node.localName !== 'iframe') continue;
      entry.rendered = true;
      const element = entry.node as HTMLIFrameElement;
      const context = Object.freeze({
        element,
        purposes: entry.purposes,
        load: (): void => {
          load(entry, element);
        },
      });
      callGuarded(() => {
        const placeholder: unknown = renderPlaceholder(context);
        if (!isElement(placeholder)) throw new TypeError(PLACEHOLDER);
        if (isBlocked(entry, element)) showPlaceholder(entry, placeholder);
      });
    }
  };

  /** Applies `snapshot` to the page, from what was applied last. */
  const apply = (snapshot: ConsentSnapshot): void => {
    const { status } = snapshot;
    const previous = applied;
    applied = status;
    const revoked = ids.filter((id) => previous[id] === 'granted' && status[id] !== 'granted');
    prune();
    blockUngranted(status, previous);
    stopUngranted(status);
    // The first time, every purpose not granted: a grant may have expired before the connection.
    removeCookies(swept ? revoked : ids.filter((id) => status[id] !== 'granted'));
    swept = true;
    // A cleanup may have destroyed the instance, whose owner no longer expects onRevoke.
    if (destroyed) return;
    if (revoked.length > 0) revocation.revoke(revoked);
    activateGranted(snapshot);
    if (consent.getSnapshot() === snapshot) showPlaceholders();
  };

  /**
   * Applies the current state of the manager until it holds still. A call made while applying,
   * by code of the application or by a notification it caused, is folded into the loop.
   */
  const reconcile = (): void => {
    requests += 1;
    if (reconciling) return;
    reconciling = true;
    try {
      let handled: number;
      let snapshot: ConsentSnapshot;
      do {
        handled = requests;
        snapshot = consent.getSnapshot();
        apply(snapshot);
      } while (!destroyed && (requests !== handled || consent.getSnapshot() !== snapshot));
    } finally {
      reconciling = false;
    }
  };

  /**
   * Warns, once per script, about the scripts under `root` that run without consent: the ones of
   * known integrations without data-consent, and the ones with data-consent but without
   * `type="text/plain"`.
   */
  const warnUnblocked = (root: ParentNode): void => {
    for (const script of root.querySelectorAll<HTMLScriptElement>(
      'script[src]:not([data-consent])',
    )) {
      if (reported.has(script)) continue;
      reported.add(script);
      const { src } = script;
      const integration = detectIntegration(src);
      if (integration !== undefined) {
        warn(`[lgpder] Script of the "${integration}" integration has no data-consent: ${src}.`);
      }
    }
    for (const script of findUnblocked(root)) {
      if (reported.has(script)) continue;
      reported.add(script);
      warn(
        `[lgpder] data-consent="${purposesOf(script).join(' ')}" is on a script without type="text/plain"; it runs without consent.`,
      );
    }
  };

  const scanRoot = (root: ParentNode): void => {
    const { status } = consent.getSnapshot();
    for (const element of findBlocked(root)) {
      if (states.has(element)) continue;
      const entry = createEntry(element, isPurpose);
      states.set(element, entry);
      known.push(entry);
      const attribute = entry.purposes.join(' ');
      if (!entry.valid) {
        warn(
          `[lgpder] data-consent="${attribute}" names an unknown purpose or none; it stays blocked.`,
        );
      } else if (entry.active && !isGranted(entry, status)) {
        warn(
          `[lgpder] data-consent="${attribute}" was loaded before consent; it is blocked again.`,
        );
      }
    }
    for (const id of activatedPurposes()) running.add(id);
    if (settings.debug) warnUnblocked(root);
    reconcile();
  };

  const onReady = (): void => {
    if (!destroyed) scanRoot(document);
  };

  if (inBrowser) {
    // Subscribed after the first reconciliation, so that a failure leaves nothing behind; a
    // decision made by code it runs is applied by its loop.
    if (document.readyState === 'loading') {
      reconcile();
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      scanRoot(document);
    }
    unsubscribe = consent.subscribe(reconcile);
  }

  return Object.freeze({
    scan: (root?: unknown): void => {
      assertAlive();
      if (root !== undefined && !isParentNode(root)) throw new TypeError(ROOT);
      if (inBrowser) scanRoot(root ?? document);
    },
    onGranted: (purpose: unknown, fn: unknown): (() => void) => {
      assertAlive();
      if (typeof purpose !== 'string' || !isPurpose(purpose)) {
        throw new RangeError(`[lgpder] Unknown purpose: ${describeItem(purpose)}.`);
      }
      if (typeof fn !== 'function') throw new TypeError('[lgpder] "fn" must be a function.');
      if (!inBrowser) return ignore;
      const registration: Registration = {
        purpose,
        fn: fn as () => unknown,
        cleanup: undefined,
        spent: false,
      };
      registrations.add(registration);
      reconcile();
      return (): void => {
        if (!registrations.delete(registration)) return;
        const { cleanup } = registration;
        registration.cleanup = undefined;
        if (cleanup !== undefined) callGuarded(cleanup);
      };
    },
    wouldReload: (choices: unknown): boolean => {
      assertAlive();
      if (!isPlainObject(choices)) throw new TypeError('[lgpder] Choices must be a plain object.');
      const { status } = consent.getSnapshot();
      const revoked: string[] = [];
      for (const [id, value] of Object.entries(choices)) {
        if (!isPurpose(id)) {
          throw new RangeError(`[lgpder] Unknown purpose: ${JSON.stringify(id)}.`);
        }
        if (value !== undefined && value !== 'granted' && value !== 'denied') {
          throw new TypeError(
            `[lgpder] The choice for ${JSON.stringify(id)} must be "granted" or "denied".`,
          );
        }
        if (value === 'denied' && status[id] === 'granted') revoked.push(id);
      }
      return revocation.wouldReload(revoked);
    },
    destroy: (): void => {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      if (!inBrowser) return;
      document.removeEventListener('DOMContentLoaded', onReady);
      const pending = [...registrations];
      registrations.clear();
      for (const { cleanup } of pending) if (cleanup !== undefined) callGuarded(cleanup);
      for (const entry of known) if (entry.kind === 'embed') removePlaceholder(entry);
      known = [];
    },
  });
}
