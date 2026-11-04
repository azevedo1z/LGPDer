/**
 * Built-in adapters of the storage layer, and the reading of options they share with
 * `connectStorage`. The barrel re-exports only the adapters.
 */
import type { StorageAdapter } from './index.ts';

/** Default `localStorage` key and cookie name. */
const DEFAULT_KEY = 'lgpder';

/** Cookie name: an HTTP token (RFC 9110, section 5.6.2). */
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** IPv4 or IPv6 hostname, which has no parent domain. */
const IP_ADDRESS = /^[\d.]+$|:/;

/**
 * Copies the own enumerable properties of `options` to a null-prototype object and rejects unknown
 * keys. An inherited property, planted on a polluted prototype, is never read.
 *
 * @throws {TypeError} `options` is neither `undefined` nor an object, or has an unknown key.
 */
export function ownOptions(
  options: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw new TypeError('[lgpder] Options must be an object.');
  }
  const own: Readonly<Record<string, unknown>> = Object.assign(
    Object.create(null) as Record<string, unknown>,
    options,
  );
  const unknown = Object.keys(own).find((key) => !keys.includes(key));
  if (unknown !== undefined) {
    throw new TypeError(`[lgpder] Unknown option: ${JSON.stringify(unknown)}.`);
  }
  return own;
}

/**
 * Validated `localStorage` key or `BroadcastChannel` name, or {@link DEFAULT_KEY} when absent.
 *
 * @throws {TypeError} Empty or non-string key.
 */
export function parseKey(key: unknown): string {
  if (key === undefined) return DEFAULT_KEY;
  if (typeof key !== 'string' || key === '') {
    throw new TypeError('[lgpder] "key" must be a non-empty string.');
  }
  return key;
}

/**
 * Validated cookie name, or {@link DEFAULT_KEY} when absent.
 *
 * @throws {TypeError} Key that is not an HTTP token.
 */
export function parseCookieName(key: unknown): string {
  if (key === undefined) return DEFAULT_KEY;
  if (typeof key !== 'string' || !COOKIE_NAME.test(key)) {
    throw new TypeError('[lgpder] "key" must be a valid cookie name.');
  }
  return key;
}

/**
 * Throws outside the browser. The only environment signal is `document`: Node exposes other
 * browser globals, and some versions a process-wide `localStorage`, which would leak the record of
 * one data subject to another between requests.
 */
function assertBrowser(): void {
  if (typeof document === 'undefined') {
    throw new Error('[lgpder] Storage adapters work only in the browser.');
  }
}

/**
 * Adapter that keeps the record in `localStorage`, under `key`. `localStorage` is resolved on each
 * call, so a storage blocked by the browser throws on use, never on creation.
 *
 * @param options - `key`: the `localStorage` key, a non-empty string. Default: `'lgpder'`.
 * @returns Frozen adapter. Outside the browser (no `document`), its methods throw.
 * @throws {TypeError} Invalid options.
 */
export function localStorageAdapter(options?: {
  readonly key?: string | undefined;
}): StorageAdapter {
  const { key } = ownOptions(options, ['key']);
  const name = parseKey(key);
  return Object.freeze({
    read: (): string | null => {
      assertBrowser();
      return localStorage.getItem(name);
    },
    write: (value: string): void => {
      assertBrowser();
      localStorage.setItem(name, value);
    },
    remove: (): void => {
      assertBrowser();
      localStorage.removeItem(name);
    },
  });
}

/**
 * Adapter that keeps the record in a first-party cookie named `key`, with `Path=/`,
 * `SameSite=Lax`, `Max-Age` of `maxAge` rounded down to seconds, renewed on each write, and
 * `Secure` when the page is served over HTTPS. The value is encoded with `encodeURIComponent`, so
 * `read` returns exactly the written text. The cookie goes to the server on every request, which
 * lets server rendering read the consent.
 *
 * A cookie name that appears more than once (for example, one set with `Domain` by the server or
 * by another subdomain) makes `read` throw: which one is the record cannot be told. `remove`
 * expires the host-only cookie and the cookie of each parent domain.
 *
 * @param options - `key`: the cookie name, an HTTP token (default `'lgpder'`); `maxAge`: the
 * lifetime in milliseconds, a positive safe integer, usually the `maxAge` of the manager.
 * @returns Frozen adapter. Outside the browser (no `document`), its methods throw.
 * @throws {TypeError} Invalid options.
 */
export function cookieAdapter(options: {
  readonly key?: string | undefined;
  readonly maxAge: number;
}): StorageAdapter {
  const { key, maxAge } = ownOptions(options, ['key', 'maxAge']);
  const name = parseCookieName(key);
  if (typeof maxAge !== 'number' || !Number.isSafeInteger(maxAge) || maxAge <= 0) {
    throw new TypeError('[lgpder] "maxAge" must be a positive safe integer (milliseconds).');
  }
  const lifetime = `; Path=/; Max-Age=${String(Math.floor(maxAge / 1000))}; SameSite=Lax`;
  const prefix = `${name}=`;

  /** `; Secure` on HTTPS pages, evaluated on each write. */
  const secure = (): string => (location.protocol === 'https:' ? '; Secure' : '');

  return Object.freeze({
    read: (): string | null => {
      assertBrowser();
      const values = document.cookie.split('; ').filter((pair) => pair.startsWith(prefix));
      const [first] = values;
      if (first === undefined) return null;
      if (values.length > 1) throw new Error(`[lgpder] More than one cookie named "${name}".`);
      return decodeURIComponent(first.slice(prefix.length));
    },
    write: (value: string): void => {
      assertBrowser();
      document.cookie = `${prefix}${encodeURIComponent(value)}${lifetime}${secure()}`;
    },
    remove: (): void => {
      assertBrowser();
      const expired = `${prefix}; Path=/; Max-Age=0${secure()}`;
      document.cookie = expired;
      for (const domain of parentDomains(location.hostname)) {
        document.cookie = `${expired}; Domain=${domain}`;
      }
    },
  });
}

/**
 * Every suffix of `hostname` with at least two labels, from the longest: `www.example.com.br`
 * gives itself, `example.com.br` and `com.br`. The browser ignores the public suffixes. None for an
 * IP address or a hostname without a dot.
 */
function parentDomains(hostname: string): string[] {
  if (IP_ADDRESS.test(hostname)) return [];
  const labels = hostname.split('.');
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join('.'));
}
