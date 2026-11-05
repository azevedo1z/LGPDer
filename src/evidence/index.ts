/**
 * LGPDer evidence: hands each decision of the data subject to the application, as evidence of the
 * consent, through a hook and, optionally, a POST to an endpoint of the application itself.
 *
 * Only changes with source `'decision'` count: restoring, syncing and hydrating are never an
 * expression of the data subject. Nothing is generated in the browser to identify the data subject
 * or the receipt; the precise instant of a decision is the time the backend receives it.
 *
 * @packageDocumentation
 */

import type { ConsentChange, ConsentManager, ConsentRecord } from '../index.ts';

/* eslint-disable @typescript-eslint/consistent-indexed-object-style -- the mapped type of
 * `EvidencePayload.versions` is the shape of the published API, as in the core. */

/**
 * JSON body sent to {@link EvidenceOptions.endpoint} for each decision. It has no identifier, no
 * user agent and no instant other than the `decidedAt` of the record.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface EvidencePayload<P extends string = string> {
  /** Full record after the decision. */
  readonly record: ConsentRecord<P>;
  /** Purposes changed by the decision, in configuration order. */
  readonly changed: readonly P[];
  /** Configured version of every versioned purpose, at send time, in configuration order. */
  readonly versions: { readonly [K in P]?: string };
}

/* eslint-enable @typescript-eslint/consistent-indexed-object-style */

/**
 * Options of {@link connectEvidence}: `endpoint`, `onDecision` or both. Read only as own
 * properties; unknown keys are rejected.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface EvidenceOptions<P extends string = string> {
  /**
   * Endpoint of the application that receives the {@link EvidencePayload} of each decision, by
   * POST, as JSON. Resolved against the address of the page when the layer connects; it must use
   * HTTPS, or HTTP on `localhost`, `127.0.0.1` or `[::1]`.
   *
   * The beacon carries the cookies of the endpoint, follows redirects and, on another origin, needs
   * a CORS preflight that allows credentials; the `fetch` fallback carries cookies only to the
   * origin of the page and treats a redirect as a failure. An endpoint on the origin of the page,
   * at its final address, behaves the same on both.
   */
  readonly endpoint?: string | undefined;
  /** Called with each change of source `'decision'`, before it is sent to `endpoint`. */
  readonly onDecision?: ((change: ConsentChange<P>) => void) | undefined;
  /**
   * Called when a send by the `fetch` fallback fails: a network error, a redirect, or a response
   * whose status is not 2xx. A body that `navigator.sendBeacon` queued cannot be observed, so its
   * failures never reach it. The consent is not affected, and nothing is sent again. Without it,
   * failures are silent.
   */
  readonly onError?: ((error: unknown) => void) | undefined;
}

/** Handle of the evidence layer. Frozen object; `destroy` does not depend on `this`. */
export interface ConsentEvidence {
  /** Stops following the manager; sends already started go on. Idempotent. */
  readonly destroy: () => void;
}

/** Keys of {@link EvidenceOptions}, in validation order. */
const OPTION_KEYS = ['endpoint', 'onDecision', 'onError'] as const;

/** Hostnames of the device itself, the only ones an endpoint may reach over plain HTTP. */
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Base of a relative endpoint on the server, where the page has no address. Only its scheme
 * matters: on the server only an absolute endpoint can be refused, and in the browser a relative one
 * is resolved, and checked, against the page.
 */
const SERVER_BASE = 'https://localhost/';

/** Validated options. */
interface Settings {
  /** Absolute address of the endpoint; `undefined` when nothing is sent. */
  readonly endpoint: string | undefined;
  readonly onDecision: ((change: ConsentChange) => void) | undefined;
  readonly onError: ((error: unknown) => void) | undefined;
}

/**
 * Calls a function of the application that may throw. An exception is rethrown in a microtask, as
 * the manager does with its listeners, so the layer goes on and the error stays visible.
 */
function callGuarded(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

/**
 * Copies the own enumerable properties of `value` to a null-prototype object, so that a property
 * planted on a polluted prototype, such as an `endpoint` of another site, is never read.
 *
 * @throws {TypeError} `value` is not an object.
 */
function copyOwn(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('[lgpder] Options must be an object.');
  }
  return Object.assign(Object.create(null) as Record<string, unknown>, value);
}

/** @throws {TypeError} `own` has a key outside {@link OPTION_KEYS}. */
function rejectUnknownKeys(own: Readonly<Record<string, unknown>>): void {
  const unknown = Object.keys(own).find((key) => !(OPTION_KEYS as readonly string[]).includes(key));
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
 * `value` resolved against the address of the page (on the server, against {@link SERVER_BASE});
 * `undefined` when it is not a valid URL.
 */
function resolveUrl(value: string): URL | undefined {
  try {
    return new URL(value, typeof document === 'undefined' ? SERVER_BASE : location.href);
  } catch {
    return undefined;
  }
}

/** Whether `url` uses HTTPS, or HTTP on a loopback host. */
function isSecure(url: URL | undefined): url is URL {
  return (
    url?.protocol === 'https:' ||
    (url?.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))
  );
}

/**
 * The absolute address of the endpoint. The evidence carries the record, so it never travels in
 * clear text to another host.
 *
 * @throws {TypeError} `value` is neither `undefined` nor a non-blank string, is not a valid URL, or
 * uses neither HTTPS nor HTTP on a loopback host.
 */
function parseEndpoint(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  // A blank endpoint would resolve to the page itself.
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('[lgpder] "endpoint" must be a non-empty string.');
  }
  const url = resolveUrl(value);
  if (!isSecure(url)) {
    throw new TypeError('[lgpder] "endpoint" must be an HTTPS URL, or HTTP on localhost.');
  }
  return url.href;
}

/**
 * Validates every option, in the order of {@link OPTION_KEYS}, before any effect.
 *
 * @throws {TypeError} Invalid options, or neither `endpoint` nor `onDecision`.
 */
function parseOptions(options: unknown): Settings {
  const own = copyOwn(options);
  rejectUnknownKeys(own);
  const endpoint = parseEndpoint(own['endpoint']);
  const { onDecision, onError } = own;
  assertOptionalFunction(onDecision, 'onDecision');
  assertOptionalFunction(onError, 'onError');
  if (endpoint === undefined && onDecision === undefined) {
    throw new TypeError('[lgpder] "endpoint" or "onDecision" is required.');
  }
  return {
    endpoint,
    onDecision: onDecision as Settings['onDecision'],
    onError: onError as Settings['onError'],
  };
}

/** Configured version of every versioned purpose of `consent`, in configuration order. */
function versionsOf(consent: ConsentManager): EvidencePayload['versions'] {
  const versions: Record<string, string> = {};
  for (const [id, { version }] of Object.entries(consent.purposes)) {
    if (version !== undefined) versions[id] = version;
  }
  return versions;
}

/**
 * Tries `navigator.sendBeacon`, and tells whether the browser queued the body. A missing beacon,
 * or one that throws (such as for a type it refuses), counts as not queued.
 */
function beacon(url: string, body: Blob): boolean {
  try {
    return navigator.sendBeacon(url, body);
  } catch {
    return false;
  }
}

/**
 * Sends `body` to `url`: by `navigator.sendBeacon` and, when it does not queue the body, by `fetch`
 * with `keepalive`, so that the send survives the page being closed. A failure of `fetch` is passed
 * to `report`; nothing is sent again. `fetch` refuses redirects: following a 301, 302 or 303 would
 * turn the POST into a GET without the body, answered with success, and the evidence would be lost
 * in silence, or sent to an address that was never validated.
 */
function send(url: string, body: Blob, report: (error: unknown) => void): void {
  if (beacon(url, body)) return;
  // The executor runs at once, so `fetch` is called now, and a synchronous exception rejects.
  new Promise<Response>((resolve) => {
    resolve(
      fetch(url, {
        method: 'POST',
        body,
        keepalive: true,
        credentials: 'same-origin',
        redirect: 'error',
      }),
    );
  }).then((response) => {
    if (!response.ok) {
      report(
        new Error(`[lgpder] Evidence endpoint responded with status ${String(response.status)}.`),
      );
    }
  }, report);
}

/**
 * Connects a manager to the evidence of the decisions of the data subject.
 *
 * On each change with source `'decision'` (from `decide`, `grantAll` or `denyAll`), the layer
 * calls `onDecision(change)` and then, with `endpoint`, sends an {@link EvidencePayload} by POST,
 * as `application/json`: `navigator.sendBeacon` first and, when the beacon is missing, returns
 * `false` or throws, `fetch` with `keepalive: true`, `credentials: 'same-origin'` and
 * `redirect: 'error'`. A failed `fetch`, a redirect, or a response whose status is not 2xx, is
 * reported to `onError` and never retried; the consent does not depend on it. The browser does not
 * tell the page what became of a queued beacon, so its failures are not reported. Changes with
 * source `'restore'` are never reported.
 *
 * An exception of `onDecision` or `onError` is rethrown in a microtask, and the layer goes on: the
 * evidence of a decision is sent even if `onDecision` throws.
 *
 * Outside the browser (no `document`), the options are validated and the handle does nothing.
 *
 * @typeParam P - Union of the purpose ids.
 * @param consent - Manager whose decisions are reported.
 * @param options - Endpoint and functions of the application; `endpoint` or `onDecision` is
 * required.
 * @returns Frozen handle.
 * @throws {TypeError} Invalid options, or neither `endpoint` nor `onDecision`.
 *
 * @example
 * ```ts
 * const consent = createConsentManager({ purposes: { analytics: { version: '2026-10' } } });
 * connectEvidence(consent, {
 *   endpoint: '/api/consent-evidence',
 *   onError: (error) => console.error(error),
 * });
 * ```
 */
export function connectEvidence<P extends string>(
  consent: ConsentManager<P>,
  options: EvidenceOptions<P>,
): ConsentEvidence;
export function connectEvidence(consent: ConsentManager, options: unknown): ConsentEvidence {
  const { endpoint, onDecision, onError } = parseOptions(options);
  let unsubscribe: (() => void) | undefined;
  let destroyed = false;

  if (typeof document !== 'undefined') {
    const versions = versionsOf(consent);
    const report = (error: unknown): void => {
      if (onError === undefined) return;
      callGuarded(() => {
        onError(error);
      });
    };
    unsubscribe = consent.subscribe((change) => {
      if (change.source !== 'decision') return;
      if (onDecision !== undefined) {
        callGuarded(() => {
          onDecision(change);
        });
      }
      // `onDecision` may have destroyed the layer, whose owner no longer expects a send.
      if (destroyed || endpoint === undefined) return;
      const payload: EvidencePayload = {
        record: change.snapshot.record,
        changed: change.changed,
        versions,
      };
      send(endpoint, new Blob([JSON.stringify(payload)], { type: 'application/json' }), report);
    });
  }

  return Object.freeze({
    destroy: (): void => {
      destroyed = true;
      unsubscribe?.();
      unsubscribe = undefined;
    },
  });
}
