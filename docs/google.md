# Google Consent Mode v2 (`lgpder/google`)

`lgpder/google` drives the [Google Consent Mode v2](https://developers.google.com/tag-platform/security/guides/consent) from the consent of each purpose. It is the only third-party integration of this version. [`init`](init.md) connects it when some purpose maps a Consent Mode type.

```ts
import { createConsentManager } from 'lgpder';
import { connectGoogle } from 'lgpder/google';

const consent = createConsentManager({ purposes: { analytics: {}, ads: {} } });
connectGoogle(consent, {
  purposes: {
    analytics: { integrations: ['google-analytics'] },
    ads: { integrations: ['google-ads'] },
  },
});
```

| Export                                                        | Kind      | Role                                           |
| ------------------------------------------------------------- | --------- | ---------------------------------------------- |
| [`connectGoogle`](#connectgoogleconsent-options)              | function  | connects a manager to the Consent Mode         |
| [`consentDefaultSnippet`](#the-default-before-the-google-tag) | string    | inline script of the default, for the `<head>` |
| [`GoogleOptions<P>`](#googleoptions)                          | interface | options of `connectGoogle`                     |
| [`GooglePurposeOptions`](#googleoptions)                      | interface | Consent Mode types of a purpose                |
| [`ConsentGoogle`](#connectgoogleconsent-options)              | interface | handle                                         |
| [`ConsentType`](#mapping)                                     | type      | consent type of the Consent Mode v2            |
| [`Integration`](#mapping)                                     | type      | built-in integration                           |

## Mapping

Each purpose declares the Consent Mode types it controls, directly (`consentMode: ['analytics_storage']`) or through a built-in integration:

| Integration          | Consent Mode types                                 |
| -------------------- | -------------------------------------------------- |
| `'google-analytics'` | `analytics_storage`                                |
| `'google-ads'`       | `ad_storage`, `ad_user_data`, `ad_personalization` |

The seven types (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`, `functionality_storage`, `personalization_storage`, `security_storage`) are always sent. A type is `'granted'` only when some purpose controls it and **every** purpose that controls it is granted; the types no purpose controls stay `'denied'`.

```ts
const consent = createConsentManager({ purposes: { analytics: {}, ads: {}, remarketing: {} } });
connectGoogle(consent, {
  purposes: {
    analytics: { integrations: ['google-analytics'] },
    ads: { integrations: ['google-ads'] },
    // ad_storage and ad_personalization are granted only while ads and remarketing both are.
    remarketing: { consentMode: ['ad_storage', 'ad_personalization'] },
  },
});
```

## Basic mode (recommended) and advanced mode

- **Basic mode, recommended.** The Google tag stays blocked by `data-consent` until its purpose is granted (see [scripts](scripts.md#blocked-elements)), so nothing is loaded and nothing is sent to Google before consent. The Consent Mode still matters: the update tells the tag, once activated, which types were granted, and a revocation sends `'denied'` before the page is cleaned.
- **Advanced mode.** The tag loads before consent and, with the types denied, sends cookieless signals to Google (pings without identifiers, used by Google for modeling). Whether such signals may be sent without consent is a legal decision of the controller, not a technical one, and it is not the default of LGPDer. If the controller chooses it, load the tag without `data-consent`, and run [`consentDefaultSnippet`](#the-default-before-the-google-tag) in the `<head>` before the tag, which is then required: the default pushed by the layer would come too late. With `debug`, the scripts layer warns about Google Analytics and Google Ads scripts without `data-consent` (such as `gtag/js` with a `G-` or `AW-` id); a Google Tag Manager container (`gtm.js`) is not detected, and the warning blocks nothing.

## The default before the Google tag

The tag must find the consent default, every type denied, before it loads. Since the library is installed from npm, its bundle loads after the `<head>`, so the default must be an inline script in the `<head>`, before the tag. `consentDefaultSnippet` is the text of that script:

<!-- prettier-ignore -->
```js
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'denied',wait_for_update:500});
```

It creates `window.dataLayer` and `gtag`, as the official snippet does, and sets every type to `'denied'` with `wait_for_update: 500`. Include it in plain HTML:

<!-- prettier-ignore -->
```html
<head>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'denied',wait_for_update:500});</script>
  <!-- then the Google tag, blocked by data-consent in the basic mode -->
</head>
```

or from the export, in frameworks that render the `<head>` (see the [Next.js recipe](ssr-react.md#nextjs-app-router)):

```tsx
import { consentDefaultSnippet } from 'lgpder/google';

<script dangerouslySetInnerHTML={{ __html: consentDefaultSnippet }} />;
```

If the `dataLayer` has no consent default when the layer connects (a common configuration error), the layer pushes the same default, before its first update; with `debug`, it warns. In the basic mode, where the tag waits for consent and `init` connects this layer before the scripts layer, this keeps the order even without the snippet. A default of the page with other values, or with `region`, is a choice of the controller and is not duplicated; only a command pushed as an `arguments` object counts, since the tag ignores an array.

## `connectGoogle(consent, options)`

```ts
export declare function connectGoogle<P extends string>(
  consent: ConsentManager<P>,
  options: GoogleOptions<P>,
): ConsentGoogle;

export interface ConsentGoogle {
  readonly destroy: () => void;
  readonly withdraw: () => void;
}
```

On connection, the layer pushes the default if it is missing, then sends `gtag('consent', 'update', {...})` with the seven types, and sends a new update on every notification of the manager, computed from its current state (`getSnapshot()`), never from the notification alone. A decision made by code of the page while it handled the first update is sent right after the subscription. There is no deduplication: each notification sends its update.

Commands go through `window.gtag` when it is a function, and otherwise are queued in `window.dataLayer`, created if missing, as the `arguments` object the tag reads. The layer never defines `window.gtag`. An exception of the `gtag` of the page, or a `dataLayer` without `push`, is rethrown in a microtask, and the layer goes on: the `'denied'` of a later revocation is still tried.

Connect it before the [scripts layer](scripts.md), so that the update reaches the `dataLayer` before the tag a grant activates, and before the cleanup of a revocation; `init` does so.

- Parameters: `consent`, the manager whose purposes control the consent types; `options` ([`GoogleOptions<P>`](#googleoptions)), required.
- Returns: frozen handle, whose functions do not depend on `this`. `destroy()` stops following the manager, without sending anything. Idempotent. `withdraw()` stops following it too, and sends an update with every type `'denied'`, whatever the manager grants, so that no grant already sent outlives the layer: use it when nothing on the page will follow the decisions anymore, such as when a setup that connected the layer fails. Each call sends the update; outside the browser, it does nothing.
- Errors: `TypeError` for invalid options and `RangeError` for a purpose that is not configured, validated before any effect, in this order: options, unknown keys, `purposes` (each purpose: configured, `undefined` or an object with known keys, `integrations`, `consentMode`), `debug`. The messages are in [Errors and warnings](#errors-and-warnings).

Outside the browser (no `document`), the options are validated and the handle does nothing.

## `GoogleOptions`

```ts
export interface GooglePurposeOptions {
  readonly integrations?: readonly Integration[] | undefined;
  readonly consentMode?: readonly ConsentType[] | undefined;
}

export interface GoogleOptions<P extends string = string> {
  readonly purposes: { readonly [K in P]?: GooglePurposeOptions };
  readonly debug?: boolean | undefined;
}
```

Read only as own properties, and the lists only by own index, so a `consentMode` planted on a polluted prototype never changes which purposes control a type; unknown keys are refused. A type listed twice, also by an integration and by `consentMode`, is accepted and changes nothing.

- `purposes`: the Consent Mode types controlled by each purpose.
- `debug`: warns in the console when the default had to be pushed by the layer.

## Content Security Policy

The snippet is an inline script with a fixed text. Allow it by the nonce of the page (`<script nonce="...">`) or by its hash. The hash of the snippet of this version is:

```text
'sha256-bwiEGrWus2Rs6F3b0yuALxS0J1DFbgWl4lLMtYRMl7E='
```

The hash covers the exact text of `consentDefaultSnippet`, so it changes only when the snippet changes; the [CHANGELOG](../CHANGELOG.md) says when. The Google tag itself is an activated script (see [scripts](scripts.md#content-security-policy)).

## Errors and warnings

All errors are thrown synchronously, before any effect. `{json(x)}` is `JSON.stringify(x)` of a string; `{quoted(x)}` quotes a value given in a list or as an argument: a string as `JSON.stringify(x)`, any other primitive as `JSON.stringify(String(x))` (`1` gives `"1"`, a hole of an array gives `"undefined"`), and an object or a function by its type (`"object"`, `"function"`), without calling its code.

| Function        | Class        | When                                      | Message                                                 |
| --------------- | ------------ | ----------------------------------------- | ------------------------------------------------------- |
| `connectGoogle` | `TypeError`  | options are not an object                 | `[lgpder] Options must be an object.`                   |
| `connectGoogle` | `TypeError`  | unknown option, also of a purpose         | `[lgpder] Unknown option: {json(key)}.`                 |
| `connectGoogle` | `TypeError`  | `purposes` is not an object               | `[lgpder] "purposes" must be an object.`                |
| `connectGoogle` | `RangeError` | `purposes` names a purpose not configured | `[lgpder] Unknown purpose: {json(id)}.`                 |
| `connectGoogle` | `TypeError`  | options of a purpose are not an object    | `[lgpder] The options of {json(id)} must be an object.` |
| `connectGoogle` | `TypeError`  | `integrations` is not an array            | `[lgpder] "integrations" must be an array.`             |
| `connectGoogle` | `TypeError`  | unknown integration                       | `[lgpder] Unknown integration: {quoted(item)}.`         |
| `connectGoogle` | `TypeError`  | `consentMode` is not an array             | `[lgpder] "consentMode" must be an array.`              |
| `connectGoogle` | `TypeError`  | unknown consent type                      | `[lgpder] Unknown consent type: {quoted(item)}.`        |
| `connectGoogle` | `TypeError`  | `debug` is not a boolean                  | `[lgpder] "debug" must be a boolean.`                   |

Warning of `debug` (`console.warn`), when the layer pushed the default:

`[lgpder] No consent default was found in the dataLayer; it was pushed now. Run consentDefaultSnippet in the <head>, before the Google tag.`
