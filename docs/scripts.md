# Scripts, iframes and revocation (`lgpder/scripts`)

`lgpder/scripts` keeps scripts, iframes and images blocked until their purposes are granted, runs code of the application on a grant and gives a revocation real effect on the page: it blocks the content of the purpose again, stops the code that can be stopped, removes the cookies of the purpose and, when code that cannot be stopped is still running, reloads the page. [`init`](init.md) connects it for you.

```html
<script
  type="text/plain"
  data-consent="analytics"
  data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"
></script>
<script type="text/plain" data-consent="analytics">
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', 'G-XXXX');
</script>
<iframe
  data-consent="videos"
  data-src="https://www.youtube-nocookie.com/embed/VIDEO"
  width="560"
  height="315"
  title="Video"
></iframe>
<img data-consent="ads" data-src="https://ads.example.com/pixel.gif" alt="" />
```

```ts
import { createConsentManager } from 'lgpder';
import { connectScripts } from 'lgpder/scripts';
import { connectStorage } from 'lgpder/storage';

const consent = createConsentManager({ purposes: { analytics: {}, ads: {}, videos: {} } });
const storage = connectStorage(consent);
const scripts = connectScripts(consent, {
  purposes: {
    analytics: { integrations: ['google-analytics'] },
    ads: { integrations: ['google-ads'], cookies: ['my_tracker_*'] },
  },
  canReload: storage.isPersisted,
});
```

| Export                                             | Kind      | Role                                      |
| -------------------------------------------------- | --------- | ----------------------------------------- |
| [`connectScripts`](#connectscriptsconsent-options) | function  | connects a manager to the page            |
| [`ScriptsOptions<P>`](#scriptsoptions)             | interface | options of `connectScripts`               |
| [`ScriptsPurposeOptions`](#scriptsoptions)         | interface | integrations and cookies of a purpose     |
| [`ConsentScripts<P>`](#consentscripts)             | interface | handle                                    |
| [`RevokeEvent<P>`](#revocation)                    | interface | revocation given to `onRevoke`            |
| [`PlaceholderContext<P>`](#placeholders)           | interface | what a placeholder knows about its iframe |
| [`PlaceholderRenderer<P>`](#placeholders)          | type      | builds the placeholder of an iframe       |
| [`Integration`](#cookie-cleanup)                   | type      | built-in integration                      |

## Blocked elements

Every element is marked with `data-consent`, which lists one or more purposes separated by spaces. An element is activated only when **every** purpose it names is configured and granted. An empty `data-consent`, one with only spaces or one that names a purpose not configured is never activated (a polluted `Object.prototype` does not count as a purpose); with `debug`, the console says why.

- `<script type="text/plain" data-consent="..." [data-src="..."]>`, inline or external. On activation, a real `<script>` replaces it, with the other attributes (all but `type`, `data-src` and `async`), the `nonce`, `src` from `data-src` or else the inline content, and `async = false`, so external scripts keep the document order. An activated script is never run again on this page, also after a revocation and a new grant. Module scripts are out of scope in this version: there is no `data-type`, and a `type="module"` script is not blocked.
- `<iframe data-consent="..." data-src="...">`: without `src` until loaded. While blocked, it shows the placeholder of `renderPlaceholder`. A revocation blocks it again.
- `<img data-consent="..." data-src="...">`: for tracking pixels. Loaded on a grant and blocked again on a revocation.

Activated elements get the `data-consent-active` attribute, read by a later instance on the same page (React StrictMode, hot reload, a `destroy` followed by a new `init`), so it knows which code is running. An iframe or image found with `src`, `srcset` or `data-consent-active` while its purposes are not all granted (an error of the author, or an earlier instance) is replaced by a blocked copy, with a `debug` warning. Removing `src` does not unload the content in every browser, so blocking an iframe or image again replaces it with a copy of its blocked state.

### Elements inserted later

Elements present when the layer connects are processed then (or on `DOMContentLoaded`, while the document loads). Elements inserted later, such as the ones of a new route of a SPA, are processed by an explicit [`scan(root)`](#consentscripts); `init` exposes it as `app.scan`. There is no automatic interception of dynamically inserted scripts (`MutationObserver`, an override of `createElement`): the technique is fragile and fails silently. Insert the markup with `data-consent` and call `scan`, or load the code with [`onGranted`](#ongrantedpurpose-fn).

The layer keeps its state per element in a `WeakMap`, and drops the elements that left the document on each scan, so a SPA that scans on every route does not accumulate them. An element removed and inserted again is treated as new on the next scan; an activated script is never run again.

### Order of inline and external scripts

`async = false` orders the external scripts among themselves, but an inline script runs as soon as it is inserted, so an inline script activated right after an external one may run before the external one finished loading. The usual code of the Google tag is written for this: the inline part only queues commands in the `dataLayer`, which the tag reads when it loads. Code that calls an API of the external script right away must wait for it, for example by listening to the `load` event of the activated script, or load it with `onGranted`.

## `connectScripts(consent, options?)`

```ts
export declare function connectScripts<P extends string>(
  consent: ConsentManager<P>,
  options?: ScriptsOptions<P>,
): ConsentScripts<P>;
```

Connects a manager to the elements of the page and to the code of the application. On connection, the options are validated, the blocked elements are processed, the cookies of every purpose that is not granted are removed (so a grant that expired, or a read failure, does not leave the `_ga` of an earlier grant behind) and the layer subscribes to the manager. With the document still loading, the scan waits for `DOMContentLoaded`, and `destroy` before it cancels it.

The layer decides from the current state of the manager (`getSnapshot()`), never from the notification alone: a decision made while a notification is delivered, by another listener, by an `onGranted` function or by an activated inline script, is never undone, and nothing is activated from a state that is no longer the one of the manager.

Connect the storage first, so that the revocation is saved before the reload. Connect [`lgpder/google`](google.md) before this layer, so that the Consent Mode update reaches the `dataLayer` before the tag a grant activates.

- Parameters: `consent`, the manager whose purposes control the page; `options` ([`ScriptsOptions<P>`](#scriptsoptions)).
- Returns: frozen [`ConsentScripts<P>`](#consentscripts).
- Errors: `TypeError` for invalid options and `RangeError` for a purpose that is not configured, validated before any effect, in this order: options, unknown keys, `purposes` (each purpose: configured, an object with known keys, `integrations`, `cookies`), `revocation`, `onRevoke`, `renderPlaceholder`, `canReload`, `debug`. The messages are in [Errors and warnings](#errors-and-warnings).

Outside the browser (no `document`), the options and the arguments are validated and the handle does nothing: `scan` processes nothing, `onGranted` neither registers nor runs `fn` and returns an empty function, and `wouldReload` returns `false`. No code of a purpose runs on the server.

## `ScriptsOptions`

```ts
export interface ScriptsPurposeOptions {
  readonly integrations?: readonly Integration[] | undefined;
  readonly cookies?: readonly string[] | undefined;
}

export interface ScriptsOptions<P extends string = string> {
  readonly purposes?: { readonly [K in P]?: ScriptsPurposeOptions } | undefined;
  readonly revocation?: 'reload' | 'manual' | undefined;
  readonly onRevoke?: ((event: RevokeEvent<P>) => void) | undefined;
  readonly renderPlaceholder?: PlaceholderRenderer<P> | undefined;
  readonly canReload?: (() => boolean) | undefined;
  readonly debug?: boolean | undefined;
}
```

Read only as own properties, so a `revocation: 'manual'` planted on a polluted prototype never turns the reload off; unknown keys, also in the options of a purpose, are refused.

- `purposes`: the cookies of each purpose, removed when it is not granted: the ones of its `integrations` and its own `cookies` (see [Cookie cleanup](#cookie-cleanup)).
- `revocation`: what to do when a revoked purpose left code running that cannot be stopped. `'reload'` (default) reloads the page; `'manual'` leaves it to `onRevoke`.
- `onRevoke`: called on every revocation, in both modes, after the page was cleaned.
- `renderPlaceholder`: builds the placeholder of each blocked iframe, such as the one of [`createPlaceholder`](ui.md#createplaceholderconsent-options) of `lgpder/ui`. Without it, nothing is inserted, and the iframe stays as the author wrote it, without `src`.
- `canReload`: checked right before reloading; the reload happens only if it returns `true`. Pass `isPersisted` of the storage (see [Reload only with the revocation saved](storage.md#reload-only-with-the-revocation-saved)). Default: `() => true`.
- `debug`: warns in the console about elements and scripts that are not blocked as expected. Never blocks anything. Without it, the console is never touched.

## `ConsentScripts`

```ts
export interface ConsentScripts<P extends string = string> {
  readonly scan: (root?: ParentNode) => void;
  readonly onGranted: (purpose: P, fn: () => void | (() => void)) => () => void;
  readonly wouldReload: (choices: ConsentChoices<P>) => boolean;
  readonly destroy: () => void;
}
```

Frozen object; the functions do not depend on `this`. After `destroy`, every other function throws `Error('[lgpder] This instance was destroyed.')`, except the cancel functions returned by `onGranted`, which stay idempotent so a late unmount of a framework does not break.

- `scan(root?)`: processes the `[data-consent]` elements not yet seen under `root` (a document, an element or a fragment; default: `document`) and applies the current state to them.
- `onGranted(purpose, fn)`: see below.
- `wouldReload(choices)`: whether applying `choices` would reload the page: in the `'reload'` mode, when it revokes a purpose that left code running. It validates `choices` as `decide` does. The preferences center of `lgpder/ui` uses it to label the save button "Salvar e recarregar". It does not ask `canReload`, since the outcome of the write cannot be foreseen.
- `destroy()`: stops following the manager, calls the pending cleanups of `onGranted` and removes the placeholders, giving the iframes back their `hidden` attribute; loaded content stays. Idempotent. After it, the layer can no longer stop code on a revocation, so stopping it on `destroy` is the closed side.

### `onGranted(purpose, fn)`

Runs `fn` when `purpose` is granted, right away if it already is, and on each new grant. If `fn` returns a function, it is called when the purpose stops being granted (revocation, restore from another tab, expiry), and `fn` runs again on a new grant. If `fn` returns nothing, or throws, the code is considered still running: `fn` never runs again on this page, and a revocation of the purpose requires a reload. It returns a function that cancels the registration and calls the pending cleanup.

```ts
const stop = scripts.onGranted('analytics', () => {
  const tracker = startTracker(); // code of the application
  return () => {
    tracker.stop(); // called on the revocation: no reload needed for this code
  };
});
```

`startTracker` is a function of the application. The same pattern loads a third-party script from code, which suits applications whose DOM is managed by a framework (see [SSR, Next.js and React](ssr-react.md#blocked-elements-in-a-react-tree)):

```ts
scripts.onGranted('analytics', () => {
  const tag = document.createElement('script');
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXX';
  document.head.append(tag);
  // No cleanup: the tag cannot be unloaded, so revoking analytics reloads the page.
});
```

## Revocation

A revoked purpose is one this layer applied as `'granted'` that no longer is, in a notification with source `'decision'` or `'restore'` (a revocation from another tab, or an expiry noticed on a restore). Always, in any mode:

1. the iframes and images of the purpose are blocked again and show their placeholder; content loaded by "Carregar" (`load()`) is blocked again when one of its purposes becomes `'denied'`, by a decision or a restore, and stays while they are `'pending'`;
2. the cleanups of `onGranted` are called;
3. the cookies of the purpose are removed (see [Cookie cleanup](#cookie-cleanup));
4. `onRevoke({ purposes, requiresReload })` is called.

The Google Consent Mode update with `'denied'` is sent by [`lgpder/google`](google.md), which `init` connects before this layer, so it goes out first.

Then, if a revoked purpose **activated a script on this page** or **ran an `onGranted` function without cleanup**, code is left running:

- `revocation: 'reload'` (default): once every listener received the notification (so the storage has saved the revocation), in a microtask, the page reloads, only if `canReload()` returns `true`. A tab in the background reloads right away. Once a reload is scheduled, nothing else is activated. A reload refused by `canReload()` is dropped: activation goes on, a `debug` warning says so, and a later revocation tries again.
- `revocation: 'manual'`: no reload; `onRevoke` receives `requiresReload: true`, and the application decides what to do (for example, ask the data subject to reload). With `debug`, the console lists the purposes.

If nothing was left running, there is no reload in any mode. There is no risk of a loop: after the reload, the purpose is refused and nothing is activated again.

```ts
export interface RevokeEvent<P extends string = string> {
  readonly purposes: readonly P[]; // revoked purposes, in configuration order
  readonly requiresReload: boolean; // code that cannot be stopped is still running
}
```

## Placeholders

```ts
export interface PlaceholderContext<P extends string = string> {
  readonly element: HTMLIFrameElement;
  readonly purposes: readonly P[];
  readonly load: () => void;
}

export type PlaceholderRenderer<P extends string = string> = (
  context: PlaceholderContext<P>,
) => Element;
```

With `renderPlaceholder`, the renderer is called once each time an iframe with a valid `data-consent` becomes blocked; the element it returns is inserted before the iframe, which is hidden meanwhile. `context.element` is the blocked iframe, `context.purposes` its purposes in attribute order (frozen, without repetition), and `context.load()` loads this iframe only, on this page, **without recording a decision**. `load()` does nothing after `destroy`, with a reload scheduled or when the iframe is no longer blocked. A renderer that throws, or returns something other than an element, inserts nothing, and its error is rethrown in a microtask; the iframe stays as the author wrote it.

[`createPlaceholder`](ui.md#createplaceholderconsent-options) of `lgpder/ui` is a ready renderer, with "Carregar" (`load()`) and "Permitir sempre" (grants the purposes of the iframe). A headless application writes its own:

```ts
connectScripts(consent, {
  renderPlaceholder: ({ purposes, load }) => {
    const box = document.createElement('div');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Load content (${purposes.join(', ')})`;
    button.addEventListener('click', load);
    box.append(button);
    return box;
  },
});
```

## Cookie cleanup

When a purpose stops being granted, and on connection for every purpose that is not granted, the layer removes the cookies of the purpose: the union of the built-in list of its integrations and of its own list.

| Integration          | Cookies                                            |
| -------------------- | -------------------------------------------------- |
| `'google-analytics'` | `_ga`, `_ga_*`, `_gid`, `_gat`, `_gat_*`, `_gac_*` |
| `'google-ads'`       | `_gcl_*`                                           |

A pattern is a cookie name (an HTTP token) optionally followed by one `*`, which matches any suffix: `'my_tracker_*'`. A lone `'*'` is refused, since it would also remove the consent record and the session of the application; with `storage: 'cookie'`, `init` also refuses a pattern that matches the cookie `lgpder` of the record. The name written in the removal is always the real name read from `document.cookie`.

Each matching cookie is expired with `Path=/` on the current host (host-only) and on each parent domain (`www.example.com.br`, `example.com.br`, `com.br`; the browser ignores the public suffixes), because integrations such as Google Analytics write on the registrable domain. On HTTPS, the removal carries `Secure`, which the `__Secure-` and `__Host-` names require. For an IP address or a hostname without a dot, only the host-only cookie.

Limits, which no script of the page can overcome:

- `HttpOnly` cookies are invisible to `document.cookie`; the server that set them must expire them.
- Cookies set with a `Path` other than `/` are not reached, since a removal must name the same path.
- Cookies of other domains (third-party cookies, such as the ones of `doubleclick.net`) are out of reach of the page.
- `Partitioned` cookies (CHIPS) are not removed: the removal does not carry the `Partitioned` attribute. No integration of the catalog uses partitioned cookies on the top-level site.
- Data an integration keeps elsewhere (`localStorage`, `sessionStorage`, IndexedDB) is not erased; remove it with the cleanup of an `onGranted` function.
- In an opaque origin (an iframe with `sandbox` without `allow-same-origin`), reading `document.cookie` throws; the error is rethrown in a microtask and the rest of the revocation goes on.

## Content Security Policy

- **Nonce.** Put the nonce of the page on the blocked `<script type="text/plain" nonce="...">`: the browser hides the attribute from scripts, but the layer copies the `nonce` property to the activated script, which the policy then accepts.
- **`'strict-dynamic'`.** With it, scripts inserted by a trusted script are allowed, which covers the activated scripts as long as the bundle of the application is trusted (by nonce or hash).
- **Hashes.** An inline blocked script can also be allowed by the hash of its content, which the activated script keeps unchanged. An external one needs its host (such as `https://www.googletagmanager.com`) or the nonce.
- The snippet of the Consent Mode default has a fixed text and hash (see [google](google.md#content-security-policy)), and the style sheet of the components is a `<style>` in their shadow roots (see [ui](ui.md#content-security-policy)).

## Development warnings

With `debug: true`, the layer warns in the console, once per element and only under the scanned root:

- about scripts of known integrations (Google Analytics and Google Ads addresses) without `data-consent`, which run without consent;
- about scripts with `data-consent` but without `type="text/plain"`, which the browser runs anyway (including `type="module"`);
- about a `data-consent` that names an unknown purpose or none;
- about an iframe or image loaded before consent, blocked again;
- about a revocation that left code running in the `'manual'` mode, and a reload skipped by `canReload`.

It only warns: nothing is blocked because of `debug`.

## Errors and warnings

Errors are thrown synchronously and before any effect, except the ones of the renderer and of functions of the application (`onGranted`, its cleanups, `onRevoke`, `canReload`), which are rethrown in a microtask while the layer goes on, as the manager does with its listeners. A `canReload` that throws counts as `false`. `{json(x)}` is `JSON.stringify(x)` of a string; `{quoted(x)}` quotes a value given in a list or as an argument: a string as `JSON.stringify(x)`, any other primitive as `JSON.stringify(String(x))` (`1` gives `"1"`, a hole of an array gives `"undefined"`), and an object or a function by its type (`"object"`, `"function"`), without calling its code.

| Function                      | Class        | When                                      | Message                                                                                            |
| ----------------------------- | ------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `connectScripts`              | `TypeError`  | options are not an object                 | `[lgpder] Options must be an object.`                                                              |
| `connectScripts`              | `TypeError`  | unknown option, also of a purpose         | `[lgpder] Unknown option: {json(key)}.`                                                            |
| `connectScripts`              | `TypeError`  | `purposes` is not an object               | `[lgpder] "purposes" must be an object.`                                                           |
| `connectScripts`              | `RangeError` | `purposes` names a purpose not configured | `[lgpder] Unknown purpose: {json(id)}.`                                                            |
| `connectScripts`              | `TypeError`  | options of a purpose are not an object    | `[lgpder] The options of {json(id)} must be an object.`                                            |
| `connectScripts`              | `TypeError`  | `integrations` is not an array            | `[lgpder] "integrations" must be an array.`                                                        |
| `connectScripts`              | `TypeError`  | unknown integration                       | `[lgpder] Unknown integration: {quoted(item)}.`                                                    |
| `connectScripts`              | `TypeError`  | `cookies` is not an array                 | `[lgpder] "cookies" must be an array.`                                                             |
| `connectScripts`              | `TypeError`  | invalid cookie pattern                    | `[lgpder] Invalid cookie pattern: {quoted(pattern)}; use a cookie name, optionally ending in "*".` |
| `connectScripts`              | `TypeError`  | invalid `revocation`                      | `[lgpder] "revocation" must be "reload" or "manual".`                                              |
| `connectScripts`              | `TypeError`  | `onRevoke` is not a function              | `[lgpder] "onRevoke" must be a function.`                                                          |
| `connectScripts`              | `TypeError`  | `renderPlaceholder` is not a function     | `[lgpder] "renderPlaceholder" must be a function.`                                                 |
| `connectScripts`              | `TypeError`  | `canReload` is not a function             | `[lgpder] "canReload" must be a function.`                                                         |
| `connectScripts`              | `TypeError`  | `debug` is not a boolean                  | `[lgpder] "debug" must be a boolean.`                                                              |
| `scan`                        | `TypeError`  | `root` cannot be scanned                  | `[lgpder] "root" must be a document, an element or a fragment.`                                    |
| `onGranted`                   | `RangeError` | `purpose` is not configured               | `[lgpder] Unknown purpose: {quoted(purpose)}.`                                                     |
| `onGranted`                   | `TypeError`  | `fn` is not a function                    | `[lgpder] "fn" must be a function.`                                                                |
| `wouldReload`                 | `TypeError`  | `choices` is not a plain object           | `[lgpder] Choices must be a plain object.`                                                         |
| `wouldReload`                 | `RangeError` | `choices` names a purpose not configured  | `[lgpder] Unknown purpose: {json(id)}.`                                                            |
| `wouldReload`                 | `TypeError`  | invalid value                             | `[lgpder] The choice for {json(id)} must be "granted" or "denied".`                                |
| renderer (rethrown)           | `TypeError`  | the renderer did not return an element    | `[lgpder] "renderPlaceholder" must return an element.`                                             |
| functions of `ConsentScripts` | `Error`      | called after `destroy`                    | `[lgpder] This instance was destroyed.`                                                            |

Warnings of `debug` (`console.warn`):

| When                                                   | Message                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| script of a known integration without `data-consent`   | `[lgpder] Script of the "{integration}" integration has no data-consent: {src}.`                        |
| `data-consent` on a script without `type="text/plain"` | `[lgpder] data-consent="{purposes}" is on a script without type="text/plain"; it runs without consent.` |
| `data-consent` with an unknown purpose or none         | `[lgpder] data-consent="{purposes}" names an unknown purpose or none; it stays blocked.`                |
| iframe or image loaded before consent                  | `[lgpder] data-consent="{purposes}" was loaded before consent; it is blocked again.`                    |
| `'manual'` revocation that left code running           | `[lgpder] Revoked purposes left code running until a reload: {purposes}.`                               |
| reload refused by `canReload`                          | `[lgpder] Reload skipped: the revocation is not known to be saved.`                                     |
