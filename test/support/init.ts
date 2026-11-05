/**
 * Apps for the tests of lgpder/init: `init` called on the test page, and probes of what it leaves
 * on the page. Importing this module installs the DOM. Every app started here must be destroyed
 * with {@link closeApps} in `afterEach`: only one instance may be alive on a page.
 */
import type { TestContext } from 'node:test';

import type { ConsentDecision, DecidedStatus } from 'lgpder';
import type { ConsentApp, InitOptions, InitPurpose } from 'lgpder/init';

import { init } from '../../src/init/index.ts';
import { testDom } from './dom.ts';
import { lastUpdate, type ConsentParams } from './google.ts';
import { decisionOf } from './records.ts';
import { DAY } from './setup.ts';

/** Purposes of the example of section 3 of the specification. */
export const PURPOSES = {
  analytics: {
    category: 'statistics',
    title: 'Estatísticas',
    description: 'Usamos o Google Analytics para entender como o site é usado.',
    integrations: ['google-analytics'],
  },
  ads: {
    category: 'marketing',
    title: 'Publicidade',
    description: 'Anúncios personalizados do Google Ads.',
    integrations: ['google-ads'],
  },
} as const satisfies Record<string, InitPurpose>;

export type PurposeId = keyof typeof PURPOSES;

/** The start of the current UTC day: the instant of the default clock of `init`. */
export const TODAY = Math.floor(Date.now() / DAY) * DAY;

/** A decision taken today, still current for the default clock of `init`. */
export function decidedToday(status: DecidedStatus): ConsentDecision {
  return decisionOf(status, { decidedAt: TODAY });
}

/** The Google tag of the example, blocked until `analytics` is granted. */
export const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id=G-XXXX';
export const GTAG_SCRIPT = `<script type="text/plain" data-consent="analytics" data-src="${GTAG_SRC}"></script>`;

/** Tags of the components. */
const COMPONENTS = 'lgpder-banner, lgpder-preferences, lgpder-button, lgpder-placeholder';

const destroys: (() => void)[] = [];

/** Registers `app` for {@link closeApps} and returns it. */
export function keepApp<P extends string, C extends string>(
  app: ConsentApp<P, C>,
): ConsentApp<P, C> {
  destroys.push(app.destroy);
  return app;
}

/** Calls `init` with `options` and registers the app for {@link closeApps}. */
export function startApp<P extends string, C extends string = never>(
  options: InitOptions<P, C>,
): ConsentApp<P, C> {
  return keepApp(init(options));
}

/** Calls `init` with the purposes of the example and `options`. */
export function startExample(
  options: Omit<InitOptions<PurposeId>, 'purposes'> = {},
): ConsentApp<PurposeId, 'statistics' | 'marketing'> {
  return startApp({ purposes: PURPOSES, ...options });
}

/** Destroys every app started since the last call. */
export function closeApps(): void {
  for (const destroy of destroys.splice(0)) destroy();
}

/** The record saved in `localStorage` by the storage layer, parsed; `null` when there is none. */
export function savedRecord(): unknown {
  const saved = localStorage.getItem('lgpder');
  return saved === null ? null : JSON.parse(saved);
}

/** The status saved for `purpose`, if any. */
export function savedStatus(purpose: string): unknown {
  const record = savedRecord() as { decisions?: Record<string, { status?: unknown }> } | null;
  return record?.decisions?.[purpose]?.status;
}

/** The components on the page, by tag name, in document order. */
export function components(): string[] {
  return [...document.querySelectorAll(COMPONENTS)].map((element) => element.localName);
}

/** The scripts the scripts layer activated, in document order. */
export function activeScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>('script[data-consent-active]')];
}

/** The scripts still blocked, in document order. */
export function blockedScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>('script[type="text/plain"]')];
}

/** Sets a cookie of the page, with `Path=/`. */
export function setCookie(name: string): void {
  document.cookie = `${name}=1; Path=/`;
}

/**
 * Records, at each call of `location.reload()` until the end of the test, what `read` returns, so
 * that a test sees what was saved when the page reloaded. The reload is still counted by the DOM.
 */
export function readAtReload<T>(t: TestContext, read: () => T): T[] {
  const seen: T[] = [];
  const page = location;
  const watched: Location = Object.create(page, {
    reload: {
      value: (): void => {
        seen.push(read());
        page.reload();
      },
    },
  }) as Location;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, get: () => watched });
  t.after(() => {
    if (original !== undefined) Object.defineProperty(globalThis, 'location', original);
  });
  return seen;
}

/** A function of the DOM, as `Reflect.apply` calls it. */
type Method = (...args: unknown[]) => unknown;

/** The method `name` defined on `owner` itself, such as a prototype of the DOM. */
function ownMethod(owner: object, name: string): Method {
  return Object.getOwnPropertyDescriptor(owner, name)?.value as Method;
}

/**
 * Calls `act` right after each script element is inserted in place of another, until the end of the
 * test: when the scripts layer activates a blocked script, as the code of that script would run.
 */
export function afterScriptInsertion(t: TestContext, act: () => void): void {
  const { Element, HTMLScriptElement } = testDom.window;
  const replaceWith = ownMethod(Element.prototype, 'replaceWith');
  t.mock.method(Element.prototype, 'replaceWith', function (this: Element, ...nodes: unknown[]) {
    Reflect.apply(replaceWith, this, nodes);
    if (nodes.some((node) => node instanceof HTMLScriptElement)) act();
  });
}

/**
 * Records, at each activation of a blocked script until the end of the test, the last consent
 * update in the dataLayer: what the Google tag of the activated script finds when it runs.
 */
export function updatesAtScriptInsertion(t: TestContext): (ConsentParams | undefined)[] {
  const seen: (ConsentParams | undefined)[] = [];
  afterScriptInsertion(t, () => {
    seen.push(lastUpdate());
  });
  return seen;
}

/** A listener added to the window or to the document, and not yet removed. */
interface Listener {
  readonly target: 'window' | 'document';
  readonly type: string;
  readonly listener: unknown;
  readonly capture: boolean;
}

/** Whether `options` of `addEventListener` or `removeEventListener` ask for the capture phase. */
function isCapture(options: unknown): boolean {
  return typeof options === 'boolean'
    ? options
    : (options as { readonly capture?: unknown } | undefined)?.capture === true;
}

/**
 * Follows, until the end of the test, the listeners added to the window and to the document and
 * not yet removed. Returns a reader of them, as `'<target> <type>'`.
 */
export function trackListeners(t: TestContext): () => string[] {
  const active: Listener[] = [];
  const { prototype } = testDom.window.EventTarget;
  const addEventListener = ownMethod(prototype, 'addEventListener');
  const removeEventListener = ownMethod(prototype, 'removeEventListener');
  const targets = { window: testDom.window, document: testDom.window.document } as const;
  for (const [name, target] of Object.entries(targets) as [Listener['target'], EventTarget][]) {
    t.mock.method(
      target,
      'addEventListener',
      (type: string, listener: unknown, options: unknown) => {
        active.push({ target: name, type, listener, capture: isCapture(options) });
        Reflect.apply(addEventListener, target, [type, listener, options]);
      },
    );
    t.mock.method(
      target,
      'removeEventListener',
      (type: string, listener: unknown, options: unknown) => {
        const index = active.findIndex(
          (entry) =>
            entry.target === name &&
            entry.type === type &&
            entry.listener === listener &&
            entry.capture === isCapture(options),
        );
        if (index !== -1) active.splice(index, 1);
        Reflect.apply(removeEventListener, target, [type, listener, options]);
      },
    );
  }
  return () => active.map(({ target, type }) => `${target} ${type}`);
}
