# Single entry point (`lgpder/init`)

`init(options)` creates the consent manager and connects every layer to it: the [storage](storage.md), the [Google Consent Mode](google.md), the [evidence](evidence.md), the [components](ui.md) and the [blocking of scripts](scripts.md). It is the plug-and-play way to use LGPDer; the layers stay available one by one for applications that need full control.

```ts
import { init } from 'lgpder/init';

const app = init({
  purposes: {
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
  },
});
```

<!-- prettier-ignore -->
```html
<script type="text/plain" data-consent="analytics"
        data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
```

With this, the page has the banner, the preferences center, the floating button, persistence in `localStorage`, sync between tabs, the Google tag blocked until `analytics` is granted, the Consent Mode updated and, on a revocation, the cookies of Google Analytics removed and the page reloaded. This example is the acceptance test of the project (`test/init/acceptance.test.ts`).

| Export                                | Kind      | Role                            |
| ------------------------------------- | --------- | ------------------------------- |
| [`init`](#initoptions)                | function  | creates and connects everything |
| [`InitOptions<P, C>`](#initoptions-1) | interface | options of `init`               |
| [`InitPurpose<C>`](#initpurpose)      | interface | configuration of a purpose      |
| [`ConsentApp<P, C>`](#consentapp)     | interface | what `init` returns             |

## `init(options)`

```ts
export declare function init<P extends string, C extends string = never>(
  options: InitOptions<P, C>,
): ConsentApp<P, C>;
```

Splits the options among the core and the layers and connects them, in this order:

1. the core (`createConsentManager`);
2. the storage, which saves each decision before the other layers react to it;
3. the Google Consent Mode, only when some purpose has `integrations` or `consentMode` (a non-empty list), so that its update reaches the `dataLayer` before the tags a grant activates and its `'denied'` goes out before the cleanup of a revocation;
4. the evidence, only with `endpoint`, `onDecision` or `onError`;
5. the placeholder and the components, which decide through the actions of the storage;
6. the scripts layer, last, because activating a script is the only effect that cannot be undone. Its `canReload` is `isPersisted` of the storage, so a revocation reloads the page only when the storage confirms the revocation saved (see [Reload only with the revocation saved](storage.md#reload-only-with-the-revocation-saved)).

Every layer validates its options before any effect. A layer that refuses them throws, and the layers already connected are disconnected, in reverse order, before the error is rethrown: a failed `init` leaves no component, listener or activated script on the page. When the Google layer was connected, it then sends an update with every type `'denied'` (its `withdraw()`): the update it sent on connection reflects the saved record and may grant types, and nothing on the page would retract it anymore, not even a revocation in another tab. Two effects stay: the commands in the `dataLayer` (the default, the update of the saved record and the final update that denies every type), and a saved record without any current decision, removed by the first sync of the storage; neither grants anything.

- Parameter: `options` ([`InitOptions<P, C>`](#initoptions-1)).
- Returns: frozen [`ConsentApp<P, C>`](#consentapp).
- Errors: `TypeError` for invalid options, of `init` or of any layer; `Error` when another instance is alive on this page or when a custom element of the components is defined by another copy of the library. The messages are in [Errors](#errors) and in the guide of each layer.

Outside the browser (no `document`), the options are validated and the app works in memory, with every layer inert: nothing is read, written, inserted or sent.

## `InitOptions`

```ts
export interface InitOptions<P extends string = string, C extends string = string> {
  readonly purposes: { readonly [K in P]: InitPurpose<C> };
  readonly storage?: StorageOptions['storage'];
  readonly revocation?: ScriptsOptions<P>['revocation'];
  readonly onRevoke?: ScriptsOptions<P>['onRevoke'];
  readonly maxAge?: ConsentOptions['maxAge'];
  readonly now?: ConsentOptions['now'];
  readonly endpoint?: EvidenceOptions<P>['endpoint'];
  readonly onDecision?: EvidenceOptions<P>['onDecision'];
  readonly onError?: EvidenceOptions<P>['onError'];
  readonly necessary?: UiTextsOverride['necessary'];
  readonly texts?: UiOptions<P>['texts'];
  readonly floatingButton?: UiOptions<P>['floatingButton'];
  readonly debug?: ScriptsOptions<P>['debug'];
}
```

The types come from the layers, so the options of `init` never drift from them. The options, `purposes` and each purpose are copied to null-prototype objects before anything is read, so a value planted on a polluted prototype (an `endpoint` of another site, `revocation: 'manual'`, `floatingButton: false`) is never read; unknown keys are refused.

| Option           | Goes to         | Meaning                                                                                                               |
| ---------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `purposes`       | all             | the purposes, in the order they are shown; at least one ([`InitPurpose`](#initpurpose))                               |
| `storage`        | storage         | `'localStorage'` (default), `'cookie'` or a [`StorageAdapter`](storage.md#storageadapter); the key is always `lgpder` |
| `maxAge`, `now`  | core            | maximum age of a decision (default: 365 days) and clock (default: start of the UTC day)                               |
| `revocation`     | scripts         | `'reload'` (default) or `'manual'` (see [Revocation](scripts.md#revocation))                                          |
| `onRevoke`       | scripts         | called on every revocation, in both modes                                                                             |
| `debug`          | scripts, google | warnings in the console about content not blocked as expected and a missing Consent Mode default                      |
| `endpoint`       | evidence        | endpoint of the application that receives the evidence of each decision; nothing is sent without it                   |
| `onDecision`     | evidence        | called on each decision of the data subject                                                                           |
| `onError`        | evidence        | called when sending the evidence fails; requires `endpoint` or `onDecision`                                           |
| `texts`          | ui              | texts merged over the built-in Brazilian Portuguese (see [Texts and languages](ui.md#texts-and-languages))            |
| `necessary`      | ui              | texts of the section of the necessary cookies, the same as `texts.necessary`; giving both is refused                  |
| `floatingButton` | ui              | whether to show the floating button (default: `true`); hide it only with another access to the preferences            |

`record` is refused: the first sync of the storage would replace it right away. Adopt an external record, such as the one of the backend, with [`app.adopt`](#consentapp).

### `InitPurpose`

```ts
export interface InitPurpose<C extends string = string>
  extends PurposeConfig<C>, UiPurposeTexts, ScriptsPurposeOptions {
  readonly consentMode?: GooglePurposeOptions['consentMode'];
}
```

Each purpose takes, together, the keys of every layer, and `init` hands each part to its layer:

| Key               | Goes to         | Meaning                                                                                              |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `version`         | core            | version of the information shown; a new version asks the data subject again                          |
| `category`        | core            | group of the purpose in the center                                                                   |
| `individualGrant` | core            | out of "Aceitar todas"; asked in the center or with `openPreferences([id])`                          |
| `title`           | ui              | title of the purpose and name of its switch; default: the id                                         |
| `description`     | ui              | description of the purpose                                                                           |
| `integrations`    | scripts, google | `'google-analytics'`, `'google-ads'`: the cookies removed on a revocation and the Consent Mode types |
| `cookies`         | scripts         | own cookie names removed on a revocation; a trailing `*` matches any suffix                          |
| `consentMode`     | google          | Consent Mode types controlled by the purpose, besides the ones of its integrations                   |

With `storage: 'cookie'`, a cookie pattern that matches `lgpder` (`'lgpder'`, `'lg*'` and so on) is refused, since removing the cookie of the record on a revocation would lose the decision just saved.

## `ConsentApp`

```ts
export interface ConsentApp<P extends string = string, C extends string = string> {
  readonly manager: ConsentManager<P, C>;
  readonly decide: (choices: ConsentChoices<P>) => void;
  readonly grantAll: () => void;
  readonly denyAll: () => void;
  readonly adopt: (record: unknown) => void;
  readonly sync: () => void;
  readonly openPreferences: ConsentUi<P>['openPreferences'];
  readonly onGranted: ConsentScripts<P>['onGranted'];
  readonly scan: ConsentScripts<P>['scan'];
  readonly destroy: () => void;
}
```

Frozen object; the functions do not depend on `this`.

- `manager`: the [manager](api.md#consentmanager), to read the state (`getSnapshot`) and subscribe to it (`subscribe`), such as with `useSyncExternalStore`. **Do not decide on it**: a decision made on the manager skips the adoption of the saved record that precedes each decision. The storage still reads before writing it and removes the saved record instead of overwriting a newer one (see [Decisions made on the manager itself](storage.md#decisions-made-on-the-manager-itself)), but the decision then holds only on this page.
- `decide`, `grantAll`, `denyAll`: the actions of the storage, which adopt the saved record and then decide. Call them only in response to an explicit action of the data subject, such as a control of an interface of the application.
- `adopt(record)`: adopts an external record, such as the one of the backend for an authenticated user, and saves it.
- `sync()`: adopts the saved record if it changed since this page last read or wrote it.
- `openPreferences(purposes?)`: opens the preferences center, with every purpose or only the ones listed (see [Asking for a purpose in context](ui.md#asking-for-a-purpose-in-context)).
- `onGranted(purpose, fn)`: runs code of the application while a purpose is granted (see [`onGranted`](scripts.md#ongrantedpurpose-fn)).
- `scan(root?)`: processes the `[data-consent]` elements inserted after `init`, such as the ones of a new route of a SPA.
- `destroy()`: disconnects every layer in reverse order and removes the components. Idempotent. After it, every other function throws `Error('[lgpder] This instance was destroyed.')`, and `manager` stays usable.

```ts
// A link in the footer that reopens the preferences, besides the floating button.
document.querySelector('#privacy-preferences')?.addEventListener('click', () => {
  app.openPreferences();
});

// A widget of the application that runs only while its purpose is granted.
app.onGranted('analytics', () => {
  const widget = mountAnalyticsWidget();
  return () => {
    widget.unmount();
  };
});
```

`mountAnalyticsWidget` is a function of the application.

## One instance per page

In the browser, only one instance may be alive: two would show two banners, subscribe twice and process the iframes twice. A second `init` while another is alive throws `Error('[lgpder] init() was already called; call destroy() first.')`; returning the existing instance would ignore the new options without warning. Call `app.destroy()` before calling `init` again, for example in the cleanup of the hot module replacement of Vite:

```ts
import.meta.hot?.dispose(() => {
  app.destroy();
});
```

With React, call `init` once per page, at module scope of a client module, not inside a component, where StrictMode runs effects twice (see [SSR, Next.js and React](ssr-react.md)). On the server there is no such guard, since each request may create its own instance.

## Content Security Policy

With a strict policy, allow:

- the activated scripts: the nonce of the page on each `<script type="text/plain">`, or `'strict-dynamic'`, or their hosts (see [scripts](scripts.md#content-security-policy));
- the inline snippet of the Consent Mode default, by nonce or by its hash (see [google](google.md#content-security-policy));
- the `<style>` of the components, by its hash or `'unsafe-inline'` in `style-src` (see [ui](ui.md#content-security-policy));
- with `endpoint`, its origin in `connect-src`, which covers both the beacon and the `fetch`.

## Errors

The errors of `init` itself are thrown before anything is created, in this order: options that are not an object, `record`, `purposes` that is not an object; then each purpose, in key order: a purpose that is not an object, then, with `storage: 'cookie'`, a cookie pattern of it that matches the record; then `necessary` with `texts.necessary`, and the guard of instance. Then each layer validates its own options, with the messages of its guide; the options of the core, including unknown keys of `init` and of each purpose, are validated by the core (see [core errors](api.md#errors)).

| Class       | When                                                 | Message                                                                                               |
| ----------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `TypeError` | options are not an object                            | `[lgpder] Options must be an object.`                                                                 |
| `TypeError` | `record` was given, even as `undefined`              | `[lgpder] Unknown option: "record".`                                                                  |
| `TypeError` | `purposes` is not an object                          | `[lgpder] "purposes" must be an object.`                                                              |
| `TypeError` | a purpose is not an object                           | `[lgpder] The configuration of purpose {json(id)} must be an object.`                                 |
| `TypeError` | with `storage: 'cookie'`, a pattern matches `lgpder` | `[lgpder] The cookie pattern {json(pattern)} of {json(id)} matches the cookie of the consent record.` |
| `TypeError` | `texts` is not an object, given with `necessary`     | `[lgpder] "texts" must be an object.`                                                                 |
| `TypeError` | `necessary` and `texts.necessary`                    | `[lgpder] Use "necessary" or "texts.necessary", not both.`                                            |
| `Error`     | another instance is alive on this page               | `[lgpder] init() was already called; call destroy() first.`                                           |
| `Error`     | a function of the app is called after `destroy`      | `[lgpder] This instance was destroyed.`                                                               |
