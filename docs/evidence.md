# Evidence of consent (`lgpder/evidence`)

Under the LGPD, the burden of proving that consent was obtained lawfully is on the controller (art. 8, § 2), and the records of LGPDer are not proof on their own (see the [notice](../README.md#legal-notice)): a record with a valid structure is accepted even if the data subject or a script of the page edited it. `lgpder/evidence` hands each decision of the data subject to the application, through a hook and, optionally, a `POST` to an endpoint of the application itself, so the backend can keep its own evidence. [`init`](init.md) connects it with `endpoint`, `onDecision` or `onError`.

```ts
import { createConsentManager } from 'lgpder';
import { connectEvidence } from 'lgpder/evidence';

const consent = createConsentManager({ purposes: { analytics: { version: '2026-10' } } });
connectEvidence(consent, {
  endpoint: '/api/consent-evidence',
  onError: (error) => {
    console.error(error);
  },
});
```

| Export                                               | Kind      | Role                               |
| ---------------------------------------------------- | --------- | ---------------------------------- |
| [`connectEvidence`](#connectevidenceconsent-options) | function  | connects a manager to the evidence |
| [`EvidenceOptions<P>`](#evidenceoptions)             | interface | options of `connectEvidence`       |
| [`EvidencePayload<P>`](#evidencepayload)             | interface | JSON body sent to the endpoint     |
| [`ConsentEvidence`](#connectevidenceconsent-options) | interface | handle                             |

## What counts as evidence

Only changes with source `'decision'` count: `decide`, `grantAll` and `denyAll`, called on an explicit action of the data subject. Restoring, syncing between tabs and hydrating are never an expression of the data subject, so they are never reported, and neither are the decisions made before the layer connected. Nothing is generated in the browser to identify the data subject or the receipt: no id, no user agent, no instant other than the `decidedAt` of the record, which comes from the clock of the client (rounded to the day by default). The precise instant of a decision is the time the backend receives it.

## `connectEvidence(consent, options)`

```ts
export declare function connectEvidence<P extends string>(
  consent: ConsentManager<P>,
  options: EvidenceOptions<P>,
): ConsentEvidence;

export interface ConsentEvidence {
  readonly destroy: () => void;
}
```

On each change with source `'decision'`, the layer calls `onDecision(change)` and then, with `endpoint`, sends an [`EvidencePayload`](#evidencepayload) by `POST`, as `application/json`:

1. `navigator.sendBeacon(endpoint, body)`, so the send survives the page being closed;
2. when the beacon is missing, returns `false` or throws, `fetch(endpoint, { method: 'POST', body, keepalive: true, credentials: 'same-origin', redirect: 'error' })`.

A failed `fetch` (a network error, a redirect, or a response whose status is not 2xx) is reported to `onError`. Nothing is sent again, and the consent never depends on the send. An exception of `onDecision` or `onError` is rethrown in a microtask, and the layer goes on: the evidence of a decision is sent even if `onDecision` throws. A decision made inside `onDecision` is reported after the current one, in the order of the manager.

- Parameters: `consent`, the manager whose decisions are reported; `options` ([`EvidenceOptions<P>`](#evidenceoptions)), required.
- Returns: frozen handle. `destroy()` stops following the manager: nothing new is reported or sent, but the failure of a send already started still reaches `onError`. A `destroy` called inside `onDecision` prevents the send of that decision. Idempotent.
- Errors: `TypeError` for invalid options, validated before any effect, in this order: options, unknown keys, `endpoint`, `onDecision`, `onError` and, last, the requirement of `endpoint` or `onDecision`. The messages are in [Errors](#errors).

Outside the browser (no `document`), the options are validated (an absolute `endpoint` is checked as in the browser; a relative one is accepted, since only the page can resolve it) and the handle does nothing.

## `EvidenceOptions`

```ts
export interface EvidenceOptions<P extends string = string> {
  readonly endpoint?: string | undefined;
  readonly onDecision?: ((change: ConsentChange<P>) => void) | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
}
```

`endpoint` or `onDecision` is required; `onError` alone is refused, since without `endpoint` there is no send that could fail. Read only as own properties, so an `endpoint` planted on a polluted prototype never sends the record to another site; unknown keys are refused.

- `endpoint`: endpoint of the application that receives the evidence. It is resolved once, against the address of the page, when the layer connects, and must use HTTPS, or HTTP on `localhost`, `127.0.0.1` or `[::1]`: the evidence carries the record, so it never travels in clear text to another host. A navigation of a SPA after the connection does not change it. An empty or blank string is refused, since it would resolve to the page itself. The origin of the endpoint is a choice of the controller and is not checked.
- `onDecision`: called with each change of source `'decision'` (a frozen [`ConsentChange`](api.md#consentchange)), before the send.
- `onError`: called when a send by the `fetch` fallback fails. Without it, failures are silent.

### Beacon and `fetch`

The two ways of sending behave differently, and the page cannot choose between them per request:

- A beacon accepted by the browser cannot be observed: `sendBeacon` returning `true` only says the body was queued. Its failures never reach `onError`.
- The beacon follows redirects; the `fetch` treats any redirect as a failure, since following a 301, 302 or 303 turns the `POST` into a `GET` without the body, and the evidence would be lost while the response says success.
- The beacon carries the cookies of the endpoint (credentials `include`) and, on another origin, needs a CORS preflight that allows credentials (`Access-Control-Allow-Credentials: true` and an explicit origin), because `application/json` is not a simple content type. The `fetch` carries cookies only to the origin of the page.

So use an endpoint **on the origin of the page, at its final address** (with or without the trailing slash, exactly as the server routes it): there, both ways behave the same.

## `EvidencePayload`

```ts
export interface EvidencePayload<P extends string = string> {
  readonly record: ConsentRecord<P>;
  readonly changed: readonly P[];
  readonly versions: { readonly [K in P]?: string };
}
```

- `record`: the full record after the decision.
- `changed`: the purposes changed by the decision, in configuration order.
- `versions`: the configured version of every versioned purpose, in configuration order.

For `consent.decide({ analytics: 'granted' })` on 2026-10-31, with the default clock, the body is:

```json
{
  "record": {
    "format": 1,
    "decisions": {
      "analytics": { "status": "granted", "version": "2026-10", "decidedAt": 1793404800000 }
    }
  },
  "changed": ["analytics"],
  "versions": { "analytics": "2026-10" }
}
```

## On the backend

The record received is data sent by the browser, which the data subject or a script of the page can change. To give it value as evidence:

- record the time of the server when the request arrives, since `decidedAt` comes from the clock of the client, which may be wrong or changed, and is rounded to the day by default;
- tie the record to the data subject, when applicable (for example, to the account of an authenticated user, through the session cookie the request carries);
- keep the content shown in each version of each purpose (titles, descriptions, texts of the banner), since `versions` only names it;
- define for how long the evidence is kept, and protect it as personal data;
- answer with a 2xx status and without a redirect.

Without an endpoint, `onDecision` lets the application build its own send (for example, with an authenticated API client):

```ts
connectEvidence(consent, {
  onDecision: ({ changed, snapshot }) => {
    sendConsentEvidence(
      changed.map((purpose) => ({ purpose, ...snapshot.record.decisions[purpose] })),
    );
  },
});
```

`sendConsentEvidence` is a function of the application.

## Errors

All of them are thrown synchronously, before any effect, except the status error, which is passed to `onError`.

| Function          | Class       | When                                                                     | Message                                                           |
| ----------------- | ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `connectEvidence` | `TypeError` | options are not an object                                                | `[lgpder] Options must be an object.`                             |
| `connectEvidence` | `TypeError` | unknown option                                                           | `[lgpder] Unknown option: {json(key)}.`                           |
| `connectEvidence` | `TypeError` | `endpoint` is not a string, or is blank                                  | `[lgpder] "endpoint" must be a non-empty string.`                 |
| `connectEvidence` | `TypeError` | `endpoint` is not a valid URL, or is neither HTTPS nor HTTP on localhost | `[lgpder] "endpoint" must be an HTTPS URL, or HTTP on localhost.` |
| `connectEvidence` | `TypeError` | `onDecision` is not a function                                           | `[lgpder] "onDecision" must be a function.`                       |
| `connectEvidence` | `TypeError` | `onError` is not a function                                              | `[lgpder] "onError" must be a function.`                          |
| `connectEvidence` | `TypeError` | neither `endpoint` nor `onDecision`                                      | `[lgpder] "endpoint" or "onDecision" is required.`                |
| `onError`         | `Error`     | the `fetch` got a response whose status is not 2xx                       | `[lgpder] Evidence endpoint responded with status {status}.`      |

A network error or a redirect of the `fetch` reaches `onError` as the error of `fetch` itself.
