# Storage and cross-tab sync (`lgpder/storage`)

The core neither reads nor writes storage: its input is `options.record` and `restore()`, and its output is `snapshot.record` and the notifications (see the [core reference](api.md)). `lgpder/storage` connects a manager to a storage of the browser, adopts the saved record, saves each decision of the data subject and keeps the tabs in sync. [`init`](init.md) connects it for you; this guide is for applications that use the layers one by one and for the details of persistence.

```ts
import { createConsentManager } from 'lgpder';
import { connectStorage } from 'lgpder/storage';

const consent = createConsentManager({ purposes: { analytics: {}, ads: {} } });
const storage = connectStorage(consent); // localStorage, key 'lgpder', cross-tab sync on

storage.decide({ analytics: 'granted' }); // the interface calls the actions of the storage
consent.getSnapshot().status.analytics; // 'granted', saved and seen by the other tabs
```

| Export                                               | Kind      | Role                                         |
| ---------------------------------------------------- | --------- | -------------------------------------------- |
| [`connectStorage`](#connectstorageconsent-options)   | function  | connects a manager to a storage              |
| [`localStorageAdapter`](#localstorageadapteroptions) | function  | adapter of `localStorage`                    |
| [`cookieAdapter`](#cookieadapteroptions)             | function  | adapter of a first-party cookie              |
| [`StorageOptions`](#storageoptions)                  | interface | options of `connectStorage`                  |
| [`ConsentStorage<P>`](#consentstorage)               | interface | decision actions and handle                  |
| [`StorageAdapter`](#storageadapter)                  | interface | synchronous storage of the serialized record |

## `connectStorage(consent, options?)`

```ts
export declare function connectStorage<P extends string>(
  consent: ConsentManager<P>,
  options?: StorageOptions,
): ConsentStorage<P>;
```

Connects a manager to a storage and returns the actions the application uses instead of the ones of the manager. On connection, the saved record is adopted with `restore`. Then:

- Before each decision, the actions adopt the saved record. So an outdated tab never writes back as granted a purpose revoked in another tab.
- Only changes with source `'decision'` and the records adopted by `adopt` are written, always as the complete record. Restores are never written: the ones of `sync` came from the storage itself, so there is no loop between tabs.
- Each write is confirmed by reading it back, because some storages, such as the cookie, discard a write without throwing. A write that fails or is not confirmed removes the saved record, so it is never more permissive than the page; the decision holds only on this page.
- Before writing a decision made on the manager itself, which skips the adoption of the actions, the storage is read again: if the read fails or the saved text changed since this page last read or wrote it, the memory may be outdated, so the saved record is removed instead of overwritten, and the next successful read adopts what is saved.
- A decision that is no longer the memory when it is delivered, because a listener committed another change meanwhile, is not written: the later change, already queued, carries the memory.
- A saved record that no longer holds any decision (all expired, invalid or of purposes no longer configured) is removed when adopted.
- A read failure keeps the memory: no storage failure grants anything.

Connect the storage before the other subscribers of the manager, so that a decision is saved before they react to it; `init` does so.

- Parameters: `consent`, the manager to persist; `options` ([`StorageOptions`](#storageoptions)).
- Returns: frozen [`ConsentStorage<P>`](#consentstorage).
- Errors: `TypeError` for invalid options, validated before any effect, in this order: `options` is `undefined` or an object, its keys are known, `storage`, `key`, `crossTab`. The messages are in [Errors](#errors).

Outside the browser (no `document`), the storage is never touched: the actions only act on the manager, in memory, and `isPersisted()` returns `false`. The only environment signal is `document`: Node.js exposes other browser globals, and some versions a process-wide `localStorage`, which would leak the record of one data subject to another between requests.

## `StorageOptions`

```ts
export interface StorageOptions {
  readonly storage?: 'localStorage' | 'cookie' | StorageAdapter | undefined;
  readonly key?: string | undefined;
  readonly crossTab?: boolean | undefined;
}
```

Read only as own properties, so a value planted on a polluted prototype is never read; unknown keys are refused.

- `storage`: where the record is saved. Default: `'localStorage'`.
  - `'localStorage'`: [`localStorageAdapter`](#localstorageadapteroptions); other tabs are followed through the `storage` event.
  - `'cookie'`: [`cookieAdapter`](#cookieadapteroptions), with the `maxAge` of the manager; other tabs are followed through a `BroadcastChannel`. Use it when the server needs to read the consent (see [SSR, Next.js and React](ssr-react.md)).
  - a [`StorageAdapter`](#storageadapter) of the application; other tabs are followed through a `BroadcastChannel`.
- `key`: `localStorage` key or cookie name, also used to name the `BroadcastChannel` (`lgpder:<key>`). A non-empty string; for the cookie, an HTTP token (ASCII letters, digits and ``!#$%&'*+-.^_`|~``). Default: `'lgpder'`. `init` always uses `'lgpder'`.
- `crossTab`: whether this tab adopts, right away, the record saved by another tab, and also when it becomes visible or is restored from the back/forward cache. With `false`, no global listener is added and no channel is opened; the saved record is still adopted on connection and before each action, and read again before writing a decision made on the manager. Default: `true`.

## `ConsentStorage`

```ts
export interface ConsentStorage<P extends string = string> {
  readonly decide: (choices: ConsentChoices<P>) => void;
  readonly grantAll: () => void;
  readonly denyAll: () => void;
  readonly adopt: (record: unknown) => void;
  readonly sync: () => void;
  readonly isPersisted: () => boolean;
  readonly destroy: () => void;
}
```

Frozen object; the functions do not depend on `this`. After `destroy`, every other function throws `Error('[lgpder] This instance was destroyed.')`, so a revocation made after it never stays only in memory without warning; the manager itself stays usable.

- `decide(choices)`, `grantAll()`, `denyAll()`: adopt the saved record, then call the same function of the manager, with the same errors. Call them only in response to an explicit action of the data subject. Pass to `decide` only the purposes the data subject changed in this interaction, not the whole state of a form built earlier, and keep the interface bound to the snapshot, which changes on notifications with source `'restore'`. The [ui](ui.md) follows these rules.
- `adopt(record)`: adopts an external record (object or JSON text), such as the one of the backend of the application, with `restore`, and writes the result, also when it has no decision. The adopted record replaces the saved one in every tab: adopt only a record that already reflects the latest decisions of this browser, since an old record undoes the revocations saved after it.
- `sync()`: adopts the saved record with `restore` if it changed since the last read or write of this page. It never throws because of the storage: when the read fails, the memory holds.
- `isPersisted()`: whether the saved record is known to be no more permissive than the memory: nothing is saved, the saved text is the record in memory, or it is the text the memory was restored from, not changed since, which a reload hydrates again (for example, one with purposes of another configuration or with expired decisions). `false` while unknown, such as after a write and a removal that were not confirmed, and outside the browser.
- `destroy()`: stops reading, writing and following other tabs, and releases every listener. Idempotent.

### Reload only with the revocation saved

A revocation that left code running on the page is completed by a reload (see [scripts](scripts.md#revocation)). Reloading before the revocation is saved would hydrate the old grant: the data subject would see the revocation undone and the code would run again. So the scripts layer asks `canReload` right before reloading, and `init` binds it to `isPersisted`. When the storage cannot confirm that what is saved is no more permissive than the memory (a cookie set by the server with `Domain` that the removal cannot reach, an adapter whose removal fails), the reload is skipped, `onRevoke` already reported `requiresReload: true`, and with `debug` the console says `[lgpder] Reload skipped: the revocation is not known to be saved.`.

```ts
const storage = connectStorage(consent);
const scripts = connectScripts(consent, { canReload: storage.isPersisted });
```

## `StorageAdapter`

```ts
export interface StorageAdapter {
  read(): string | null;
  write(value: string): void;
  remove(): void;
}
```

Synchronous storage of the serialized record. `read` returns the saved text exactly as written, or `null` when there is none. Any method may throw: a failure keeps the consent in memory and never grants anything. The methods are called on the adapter (`adapter.read()`), so an instance of a class works. With an adapter of the application, `key` names only the `BroadcastChannel`.

```ts
import { connectStorage, type StorageAdapter } from 'lgpder/storage';

// Keeps the record for the session only: the data subject is asked again in a new session.
const sessionAdapter: StorageAdapter = {
  read: () => sessionStorage.getItem('consent'),
  write: (value) => {
    sessionStorage.setItem('consent', value);
  },
  remove: () => {
    sessionStorage.removeItem('consent');
  },
};

const storage = connectStorage(consent, { storage: sessionAdapter, key: 'consent' });
```

## `localStorageAdapter(options?)`

```ts
export declare function localStorageAdapter(options?: {
  readonly key?: string | undefined;
}): StorageAdapter;
```

Adapter that keeps the record in `localStorage`, under `key` (default `'lgpder'`). `localStorage` is resolved on each call, so a storage blocked by the browser throws on use, never on creation. Outside the browser (no `document`), its methods throw `Error('[lgpder] Storage adapters work only in the browser.')`. It is what `storage: 'localStorage'` uses.

## `cookieAdapter(options)`

```ts
export declare function cookieAdapter(options: {
  readonly key?: string | undefined;
  readonly maxAge: number;
}): StorageAdapter;
```

Adapter that keeps the record in a first-party cookie named `key` (default `'lgpder'`), with `Path=/`, `SameSite=Lax`, `Max-Age` of `maxAge` rounded down to seconds, renewed on each write, and `Secure` when the page is served over HTTPS (checked on each write). The value is encoded with `encodeURIComponent`, so `read` returns exactly the written text. `maxAge` is in milliseconds, usually the `maxAge` of the manager; `storage: 'cookie'` passes `consent.maxAge`. Outside the browser, its methods throw.

- A cookie name that appears more than once in `document.cookie` (for example, one set with `Domain` by the server or by another subdomain) makes `read` throw `Error('[lgpder] More than one cookie named "<key>".')`: which one is the record cannot be told, so nothing is adopted.
- `remove` expires the host-only cookie and the cookie of each parent domain (`www.example.com.br`, `example.com.br`, `com.br`; the browser ignores the public suffixes), with `Secure` on HTTPS. For an IP address or a hostname without a dot, only the host-only cookie.

## Binding to `localStorage`

A configuration shared by the examples of the guides: a constant version shared by the purposes plays the role of a global version, and `satisfies` checks the categories.

```ts
import { createConsentManager, type PurposeConfig } from 'lgpder';
import { connectStorage } from 'lgpder/storage';

type Category = 'statistics' | 'marketing' | 'health';
const TERMS = '2026-10';

export const PURPOSES = {
  analytics: { version: TERMS, category: 'statistics' },
  personalizedAds: { version: TERMS, category: 'marketing' },
  newsletter: { version: '2025-03', category: 'marketing' },
  healthReminders: { version: TERMS, category: 'health', individualGrant: true },
} as const satisfies Record<string, PurposeConfig<Category>>;

export type PurposeId = keyof typeof PURPOSES;

export const consent = createConsentManager({ purposes: PURPOSES });
export const actions = connectStorage(consent, { key: 'my-store:consent' });
```

The interface uses `actions.decide`, `actions.grantAll` and `actions.denyAll` instead of the functions of the manager, and the application adopts external records with `actions.adopt`; `consent` is still used to read the state and subscribe to it. On the server, the actions only act on the manager (see [SSR, Next.js and React](ssr-react.md)).

## Cookie

With `storage: 'cookie'`, the record goes to the server on every request to the domain, which lets server rendering read the consent and render without the banner flicker (see [SSR, Next.js and React](ssr-react.md)). The default clock of the core already rounds `decidedAt` to the start of the UTC day, so the cookie does not carry a high-entropy instant that could single out the browser.

- **Prefix `__Host-`.** On sites served only over HTTPS, `connectStorage(consent, { storage: 'cookie', key: '__Host-lgpder' })` makes the browser refuse the cookie without `Secure`, with `Domain` or with a `Path` other than `/`. Without the prefix, a cookie with the same name set by another host of the same registrable domain, or with a more specific `Path`, could be the one read; the adapter refuses a duplicated name, which keeps the purposes `'pending'` until the data subject decides again. `init` does not expose `key` and uses `lgpder`, since `Secure` holds only on HTTPS and `__Host-` requires it.
- **Size.** The browser discards, without an error, a cookie whose name and value add up to more than 4096 bytes. With `encodeURIComponent`, each purpose takes about 120 bytes (an id of 12 characters and the version `2026-10`), more with long ids or versions: the limit comes at about 30 purposes, or about 20 with versions of 64 characters, such as a content hash. For configurations of that size, use `localStorage`. Since each write is confirmed by reading it back, a discarded cookie does not count as saved: the previous record is removed, and the decision holds only on this page; after a reload, the purposes are `'pending'` again and the banner asks again, so a grant never comes back.
- **Lifetime.** `Max-Age` is the `maxAge` of the manager, counted from the last write. Since each write rewrites the whole record and each decision expires at `decidedAt + maxAge`, the cookie may outlive the oldest decisions it holds. So whoever reads the cookie, including the server, must pass its content through the core (`record` or `restore`), which discards the expired decisions, instead of trusting what is stored, and must adopt nothing when the name appears more than once, as the adapter does (see [What runs on the server](ssr-react.md#what-runs-on-the-server)).
- **Other tabs.** The `storage` event does not fire for cookies; the layer posts an empty message on the `BroadcastChannel` `lgpder:<key>` after each confirmed write and each removal by the page, and the other tabs read the cookie again. The record never travels on the channel.

## How a revocation reaches the other tabs

- `storage` event, with `localStorage`: fired in the other documents of the same origin when the saved value changes. The layer calls `sync()`, which reads the current value instead of using `event.newValue`: one read path, and the most recent value.
- `BroadcastChannel`, with the cookie and with an adapter of the application: an empty message after each write and removal; browsers without `BroadcastChannel` rely on the next items.
- `pageshow` with `persisted`: a page restored from the back/forward cache did not receive the events while suspended.
- `visibilitychange` to `visible`: the tab becomes visible again.
- The adoption before each decision: `decide`, `grantAll` and `denyAll` adopt the saved record before deciding.

The tab that adopts a revocation calls `restore`, and the [scripts layer](scripts.md#revocation) treats it as any revocation: it blocks the content of the purpose again, removes its cookies and, if code is left running, reloads right away, also in a background tab.

Residual limits: two tabs that write at the same instant may overwrite each other, because Web Storage has no transactions; the window is of microseconds and requires simultaneous actions of the data subject in two tabs. A decision that expires while a tab is open is noticed only on a restore with a new text or on the next load (see [Expiry in a long-lived tab](api.md#expiry-in-a-long-lived-tab)).

## Decisions made on the manager itself

The guarantee of the first item of [`connectStorage`](#connectstorageconsent-options) depends on the decisions going through the actions of the storage. A decision made with `consent.decide` (or `app.manager.decide`, with `init`) skips the adoption of the saved record. The storage still reads the storage before writing it: if another tab changed the record meanwhile, the saved record is removed instead of overwritten, and the decision holds only on this page until the next read adopts what is saved. Decide through the actions, and use the manager to read the state and subscribe to it.

## Asynchronous storage and the backend

Adapters are synchronous. With an asynchronous storage (IndexedDB, or the backend of the application), connect a synchronous one (`localStorage` or the cookie) and adopt the external record with `actions.adopt(record)` when the read ends, before enabling the decision interface, since `restore` replaces more recent local decisions. The same holds for the record of an authenticated user that comes from the backend: load it before collecting decisions. `adopt` writes the result to the storage, with the same confirmation by reading, so the other tabs and the next loads receive it; `consent.restore` alone would not be written.

## Record lifecycle

- Write: `JSON.stringify(snapshot.record)` on each decision, and on `adopt`.
- Load: the saved record is adopted on connection, on each action and when another tab changes it.
- Lifetime: each decision is current for `maxAge` (default: 365 days); on hydration and in `restore`, an expired decision is discarded and the purpose goes back to `'pending'`. A saved record left without any current decision is removed when adopted, so a record the data subject never answered again does not stay in the storage indefinitely. In the storage, the record lasts as the storage allows: the `Max-Age` of the cookie follows `consent.maxAge`; `localStorage` has no lifetime of its own, but the browser may erase it: Safari erases the storage written by script after 7 days of use without interaction with the site, and limits to 7 days the lifetime of cookies written by script. In those cases, the purposes go back to `'pending'` and the banner asks again.
- Purposes removed from the configuration disappear from the storage on the next write; new purposes start `'pending'`.
- A record with a `format` other than `1` (for example, written by a future version of the package) is ignored and replaced on the next write.
- A future incompatible format will use `format: 2`, reading the format `1`, in a major version of the package.

## Batch by category and pending purposes

A category has no operation of its own: the application builds the batch with `decide`, which records one decision per purpose. The example uses `consent`, `actions`, `PurposeId` and `Category` of the [binding to `localStorage`](#binding-to-localstorage) and, in a grant, leaves out the purposes with `individualGrant: true`, as `grantAll` does. `pendingPurposes` and `outdatedPurposes` take the current snapshot, such as `pendingPurposes(consent.getSnapshot())`, and tell what to ask the data subject and which purposes changed version. The [ui](ui.md) does this for you; the functions are for a headless interface.

```ts
import type { ConsentChoices, ConsentSnapshot, DecidedStatus } from 'lgpder';

// Safe: purposes is a frozen copy that holds only the configured purposes.
const purposeIds = Object.keys(consent.purposes) as PurposeId[];

export function decideCategory(category: Category, status: DecidedStatus): void {
  const choices: ConsentChoices<PurposeId> = Object.fromEntries(
    purposeIds
      .filter((id) => consent.purposes[id].category === category)
      .filter((id) => status === 'denied' || consent.purposes[id].individualGrant !== true)
      .map((id) => [id, status]),
  );
  actions.decide(choices);
}

// They take the current snapshot (from getSnapshot, from the React hook or from a notification): a
// list computed once would be outdated after the next decision or restore.
export function pendingPurposes({ status }: ConsentSnapshot<PurposeId>): PurposeId[] {
  return purposeIds.filter((id) => status[id] === 'pending');
}

export function outdatedPurposes({ outdated }: ConsentSnapshot<PurposeId>): PurposeId[] {
  return purposeIds.filter((id) => outdated[id]);
}
```

## Security

- The storage of the browser can be read or changed by any script of the same origin: protect the application against XSS and assess the third-party scripts it loads. A record changed this way is valid for the core (see the [notice](../README.md#notice-lgpder-does-not-guarantee-lgpd-compliance)).
- With the cookie, the record goes to the server on every request to the domain, and other hosts of the same registrable domain can set cookies visible to the page; prefer `__Host-` on sites served only over HTTPS.
- The record holds only, per purpose, the decided status, the version and the instant of the decision, besides the `format` field. Depending on the context, for example when tied to an account, it may be personal data (LGPD, art. 5, I).

## Errors

All of them are thrown synchronously, before any effect. `{json(x)}` is `JSON.stringify(x)`.

| Function                                                 | Class       | When                                                 | Message                                                                                                   |
| -------------------------------------------------------- | ----------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `connectStorage`, `localStorageAdapter`, `cookieAdapter` | `TypeError` | options are not an object                            | `[lgpder] Options must be an object.`                                                                     |
| `connectStorage`, `localStorageAdapter`, `cookieAdapter` | `TypeError` | unknown option                                       | `[lgpder] Unknown option: {json(key)}.`                                                                   |
| `connectStorage`                                         | `TypeError` | invalid `storage`                                    | `[lgpder] "storage" must be "localStorage", "cookie" or an object with read, write and remove functions.` |
| `connectStorage`, `localStorageAdapter`                  | `TypeError` | `key` of `localStorage` or of the channel is invalid | `[lgpder] "key" must be a non-empty string.`                                                              |
| `connectStorage`, `cookieAdapter`                        | `TypeError` | cookie name is invalid                               | `[lgpder] "key" must be a valid cookie name.`                                                             |
| `connectStorage`                                         | `TypeError` | `crossTab` is not a boolean                          | `[lgpder] "crossTab" must be a boolean.`                                                                  |
| `cookieAdapter`                                          | `TypeError` | `maxAge` is not a positive safe integer              | `[lgpder] "maxAge" must be a positive safe integer (milliseconds).`                                       |
| methods of the adapters                                  | `Error`     | called outside the browser                           | `[lgpder] Storage adapters work only in the browser.`                                                     |
| `read` of `cookieAdapter`                                | `Error`     | the cookie name appears more than once               | `[lgpder] More than one cookie named "{key}".`                                                            |
| functions of `ConsentStorage`                            | `Error`     | called after `destroy`                               | `[lgpder] This instance was destroyed.`                                                                   |

`connectStorage` treats an error of an adapter as a storage failure: it never reaches the application.
