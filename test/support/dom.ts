/**
 * Browser environment for the tests of the layers: one jsdom window per test file, installed as the
 * globals the layers read. Importing this module installs it; the test files that do not import it
 * keep running as on the server.
 *
 * Only the globals below are installed, through getters, so that `navigate` can change the page.
 * `Event`, `EventTarget`, `MessageEvent`, `CustomEvent` and the other event classes stay the ones
 * of Node (replacing them breaks the `BroadcastChannel` of Node): tests build events with
 * `testDom.window.StorageEvent` and similar. `BroadcastChannel`, `Blob`, `fetch` and
 * `queueMicrotask` are the ones of Node.
 */
import { JSDOM, type DOMWindow } from 'jsdom';

/** Address of the page, unless a test calls `navigate`. */
export const DEFAULT_URL = 'https://www.example.com.br/';

export interface TestDom {
  /** The jsdom instance, with scripts never run and a visible page. */
  readonly jsdom: JSDOM;
  readonly window: DOMWindow;
  /** How many times `location.reload()` was called. */
  readonly reloads: () => number;
  /**
   * Clears head, body, `localStorage`, cookies, `dataLayer` and `gtag`, resets `reloads` and goes
   * back to {@link DEFAULT_URL}.
   */
  readonly reset: () => void;
  /** Changes the URL (scheme, hostname) through `jsdom.reconfigure`. */
  readonly navigate: (url: string) => void;
}

const jsdom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: DEFAULT_URL,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = jsdom;
let reloads = 0;

/** Stand-in for `location`: reads the page address and counts the reloads. */
const location = Object.freeze({
  get protocol(): string {
    return window.location.protocol;
  },
  get hostname(): string {
    return window.location.hostname;
  },
  get href(): string {
    return window.location.href;
  },
  reload: (): void => {
    reloads += 1;
  },
});

const globals: Readonly<Record<string, () => unknown>> = {
  window: () => window,
  document: () => window.document,
  localStorage: () => window.localStorage,
  navigator: () => window.navigator,
  customElements: () => window.customElements,
  HTMLElement: () => window.HTMLElement,
  Element: () => window.Element,
  Node: () => window.Node,
  getComputedStyle: () => window.getComputedStyle.bind(window),
  location: () => location,
};
for (const [name, get] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { get, configurable: true });
}

const navigate = (url: string): void => {
  jsdom.reconfigure({ url });
};

export const testDom: TestDom = Object.freeze({
  jsdom,
  window,
  reloads: () => reloads,
  reset: () => {
    navigate(DEFAULT_URL);
    window.document.head.replaceChildren();
    window.document.body.replaceChildren();
    window.localStorage.clear();
    jsdom.cookieJar.removeAllCookiesSync();
    Reflect.deleteProperty(window, 'dataLayer');
    Reflect.deleteProperty(window, 'gtag');
    reloads = 0;
  },
  navigate,
});

/** Fires on the window the `storage` event that the browser fires in the other tabs. */
export function fireStorageEvent(init: {
  readonly key: string | null;
  readonly storageArea: Storage;
}): void {
  window.dispatchEvent(new window.StorageEvent('storage', init));
}

/** Another tab saves `text` in localStorage under `key` and the browser fires `storage` here. */
export function writeFromAnotherTab(text: string, key = 'lgpder'): void {
  window.localStorage.setItem(key, text);
  fireStorageEvent({ key, storageArea: window.localStorage });
}

/**
 * Makes `document.readyState` read `'loading'` until {@link finishLoading}, as when a layer is
 * connected by a script in the `<head>`.
 */
export function startLoading(): void {
  Object.defineProperty(window.document, 'readyState', {
    configurable: true,
    get: () => 'loading',
  });
}

/** Ends the state set by {@link startLoading} and fires `DOMContentLoaded`. */
export function finishLoading(): void {
  Reflect.deleteProperty(window.document, 'readyState');
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
}

// `document.readyState` becomes 'complete' only after the load event.
if (window.document.readyState !== 'complete') {
  await new Promise((resolve) => {
    window.addEventListener('load', resolve, { once: true });
  });
}
