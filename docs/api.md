# Core API reference (`lgpder`)

Complete reference of the core: signatures, parameters, return values, errors and examples of each export, typing, error messages and notifications. The non-compliance notice and the overview are in the [README](../README.md); the layers built on the core have their own guides: [storage](storage.md), [scripts](scripts.md), [google](google.md), [evidence](evidence.md), [ui](ui.md) and [init](init.md).

The only runtime export is `createConsentManager`; the others are types. The signatures below reproduce the published `dist/index.d.ts`, which also carries the documentation as TSDoc.

| Export                                          | Kind      | Role                       |
| ----------------------------------------------- | --------- | -------------------------- |
| [`createConsentManager`](#createconsentmanager) | function  | creates the manager        |
| [`ConsentManager<P, C>`](#consentmanager)       | interface | manager                    |
| [`ConsentOptions<P, C>`](#consentoptions)       | interface | creation options           |
| [`PurposeConfig<C>`](#purposeconfig)            | interface | configuration of a purpose |
| [`ConsentStatus`](#consentstatus)               | type      | effective status           |
| [`DecidedStatus`](#decidedstatus)               | type      | outcome of a decision      |
| [`ConsentChoices<P>`](#consentchoices)          | type      | input of `decide`          |
| [`ConsentDecision`](#consentdecision)           | interface | recorded decision          |
| [`ConsentRecord<P>`](#consentrecord)            | interface | serializable record        |
| [`ConsentSnapshot<P>`](#consentsnapshot)        | interface | immutable state            |
| [`ChangeSource`](#changesource)                 | type      | source of a change         |
| [`ConsentChange<P>`](#consentchange)            | interface | notification               |
| [`ConsentListener<P>`](#consentlistener)        | type      | listener                   |

`P` is the union of the purpose ids, and `C` the union of the category ids.

## `createConsentManager`

```ts
export declare function createConsentManager<P extends string, C extends string = never>(
  options: ConsentOptions<P, C>,
): ConsentManager<P, C>;
```

Creates a consent manager. The purpose and category ids are inferred as literal unions from `options.purposes` (`C` is `never` when no purpose declares a category). The configuration is validated and copied; `options.record`, if given as an own property, is read as untrusted data. Creation does not notify. It calls the clock at most once, to evaluate the expiry of the hydrated decisions (see [`maxAge`](#consentoptions)), and only if `options.record` has at least one valid decision.

- Parameter `options` (`ConsentOptions<P, C>`): purposes, saved record, clock and maximum age of the decisions.
- Returns: frozen manager (`ConsentManager<P, C>`).
- Errors: `TypeError` for an invalid configuration. Validation is synchronous and throws at the first problem, in this order: `options` is a plain object; each key of `options` is `purposes`, `record`, `now` or `maxAge`; `purposes` is a plain object with at least one purpose; for each purpose, in key order, the id is valid, the configuration is a plain object, each of its keys is `version`, `category` or `individualGrant`, `version` is `undefined` or a non-empty string, `category` is `undefined` or a valid id and `individualGrant` is `undefined` or a boolean; `now` is `undefined` or a function; `maxAge` is `undefined` or a positive safe integer. The content of `options.record` never causes an error. The messages are in [Errors](#errors).

The configuration is written by the developer and is not untrusted data: types and formats are validated directly, without hardening against a polluted prototype. Unknown keys are looked up among the own enumerable string keys (the ones returned by `Object.keys`) of `options`, of `purposes` and of each configuration, and symbol keys are ignored. The exceptions are `options.record`, the entry point of untrusted data, and `now` and `maxAge`, which decide whether its decisions are still current: the three are read only as own properties, and a value inherited from a polluted prototype is ignored, so that it never grants a purpose without an action of the data subject nor revives an expired decision. Exceptions thrown by getters or proxies of the options, including the one of `record`, propagate without effect. The given object is neither changed nor frozen, and changing it after creation has no effect.

```ts
import { createConsentManager } from 'lgpder';

export const consent = createConsentManager({
  purposes: {
    analytics: { version: '2026-10', category: 'statistics' },
    ads: { category: 'marketing' },
    healthReminders: { version: '1', category: 'health', individualGrant: true },
  },
});
```

The other examples of this document use this `consent`, each from the initial state, without decisions.

## `ConsentManager`

```ts
export interface ConsentManager<P extends string = string, C extends string = string> {
  readonly purposes: { readonly [K in P]: PurposeConfig<C> };
  readonly maxAge: number;
  readonly getSnapshot: () => ConsentSnapshot<P>;
  readonly getServerSnapshot: () => ConsentSnapshot<P>;
  readonly decide: (choices: ConsentChoices<P>) => void;
  readonly grantAll: () => void;
  readonly denyAll: () => void;
  readonly restore: (record: unknown) => void;
  readonly subscribe: (listener: ConsentListener<P>) => () => void;
}
```

Consent manager: a frozen object with exactly these properties, in this order. The functions are properties (`readonly decide: (...) => void`), not methods: they do not depend on `this` and can be destructured or passed along, for example to the `useSyncExternalStore` hook of React.

```ts
const { decide, getSnapshot } = consent;
decide({ analytics: 'granted' });
getSnapshot().status.analytics; // 'granted'
```

With [`lgpder/storage`](storage.md) or [`lgpder/init`](init.md), the application decides through the actions of the storage, which adopt the saved record before each decision, and uses the manager to read the state and subscribe to it.

### `purposes`

Frozen copy of the purpose configuration, in declared order. Each configuration is a new frozen object that contains only the properties given with a value other than `undefined`, in the order `version`, `category` and `individualGrant`; `individualGrant: false` given explicitly is kept.

```ts
consent.purposes.ads; // { category: 'marketing' }
consent.purposes.healthReminders; // { version: '1', category: 'health', individualGrant: true }
```

### `maxAge`

Effective maximum age of a decision, in milliseconds: the value of the [`maxAge`](#consentoptions) option or the default of 365 days. It lets persistence align the lifetime of the saved record, such as the `Max-Age` of a cookie, with the expiry of the decisions, using only the public API; the cookie of [`lgpder/storage`](storage.md#cookieadapteroptions) does so.

```ts
consent.maxAge; // 31536000000 (365 days)
```

### `getSnapshot()`

Returns the current state (`ConsentSnapshot<P>`). Between two notifications, it always returns the same object; at each confirmed change, it starts returning a new object. It has constant cost and allocates no memory.

```ts
const before = consent.getSnapshot();
before.status.analytics; // 'pending'
consent.decide({ analytics: 'granted' });
consent.getSnapshot() === before; // false: there was a change
consent.getSnapshot().status.analytics; // 'granted'
```

### `getServerSnapshot()`

Returns a state without any decision: every purpose `'pending'`, `outdated` all `false` and `record` equal to `{ format: 1, decisions: {} }`. It is created at construction and is always the same object. It is meant for server rendering and for hydration when the record only exists in the browser (see [SSR, Next.js and React](ssr-react.md)). When hydration produces no valid decision, the initial snapshot is the server snapshot itself.

```ts
consent.getServerSnapshot().record; // { format: 1, decisions: {} }
consent.getSnapshot() === consent.getServerSnapshot(); // true: there was no saved record
```

### `decide(choices)`

Records, changes or revokes decisions in one atomic operation. Revoking is recording `'denied'` for a granted purpose (see [`DecidedStatus`](#decidedstatus)). Omitted purposes, or purposes with `undefined`, do not change, and repeating the current status changes nothing (not even `decidedAt`). Call `decide` only in response to an explicit action of the data subject.

- Parameter `choices` (`ConsentChoices<P>`): decision per purpose.
- Returns: nothing.
- Errors: `TypeError` if `choices` is not a plain object, if a value is not `'granted'`, `'denied'` or `undefined`, or if the clock did not return a non-negative integer; `RangeError` if `choices` has a key that is not a configured purpose, even with the value `undefined`. On any error, nothing changes and nothing is notified.

The whole input is validated before any effect. For each key, in the order of `Object.keys(choices)`, first the key must be a configured purpose and then the value must be `undefined`, `'granted'` or `'denied'`; the first violation in this order determines the error. A purpose is recorded only if the requested value differs from the current effective status, which covers a purpose without decision, a purpose with an outdated decision (even with the same value) and a purpose with the opposite value. If no purpose changes, the call has no effect: it does not call the clock, does not create a snapshot and does not notify. So repeated calls do not fabricate recent dates; renewal is done with a new version.

In an effective call, the clock is called exactly once, after validation, and every recorded decision shares the same `decidedAt`. The value of the clock must be a non-negative safe integer; `NaN`, `1.5`, `-1`, `'1'` or a `Date` object cause a `TypeError`, and a clock that throws has its exception propagated intact, without changing anything. The call produces a new snapshot and a notification with source `'decision'`, whose `changed` lists the recorded purposes in configuration order, not in the key order of `choices`. `individualGrant` does not affect `decide`.

```ts
consent.decide({ analytics: 'granted', ads: 'denied' }); // one operation, one decidedAt
consent.decide({ ads: 'denied' }); // no effect: ads is already 'denied'
consent.decide({ analytics: 'denied' }); // revokes analytics
consent.decide({ healthReminders: 'granted' }); // grants: individualGrant does not affect decide
```

### `grantAll()`

Grants, in one atomic operation, the configured purposes without `individualGrant: true`. It records one decision per purpose: it creates no generic authorization and does not reach purposes declared later. Purposes already granted under the current version do not change, and if no purpose is eligible or none changes, the call has no effect. Arguments passed in JavaScript are ignored; in TypeScript, they are a compile error. Call `grantAll` only in response to an explicit action of the data subject.

- Returns: nothing.
- Errors: `TypeError` if the clock did not return a non-negative integer. Nothing changes in that case.

```ts
consent.grantAll();
consent.getSnapshot().status;
// { analytics: 'granted', ads: 'granted', healthReminders: 'pending' }
```

### `denyAll()`

Refuses or revokes, in one atomic operation, every configured purpose, including the ones marked with `individualGrant: true`. Purposes `'pending'` become `'denied'`, a recorded refusal. The rules of `grantAll` about the clock, notification, calls without effect and arguments apply.

- Returns: nothing.
- Errors: `TypeError` if the clock did not return a non-negative integer. Nothing changes in that case.

```ts
consent.denyAll();
consent.getSnapshot().status;
// { analytics: 'denied', ads: 'denied', healthReminders: 'denied' }
```

### `restore(record)`

Replaces every decision with the valid content of an external record (object or JSON text), treated as untrusted data; missing or invalid content, including `null`, `undefined` and `''`, is an empty record. It does not merge: purposes without a valid decision in the adopted record become `'pending'`. Use `restore` to adopt the record written by another tab or loaded from the backend of the application, before collecting new decisions: restoring is not an expression of the will of the data subject, is not a revocation and replaces more recent local decisions. So adopting an old record after a local revocation replaces that revocation.

- Parameter `record` (`unknown`): record to adopt.
- Returns: nothing.
- Errors: never throws.

It notifies with source `'restore'` if any entry changes. Two entries are equal when both are absent or when they have the same `status`, the same `version` and the same `decidedAt`. Equal entries keep the current reference, and if no entry differs the call has no effect: `restore(consent.getSnapshot().record)`, as an object or as JSON text, changes nothing while the decisions are within their maximum age. Adopting an empty record leaves the purposes `'pending'`, but it is not a revocation and erases no data. `restore` writes nothing.

`restore` evaluates the expiry of the decisions of the adopted record, with the configured clock: it calls the clock once, only if the record has at least one valid decision, and discards the expired decisions (see [`maxAge`](#consentoptions)). So adopting the own record again after a decision expired discards it and notifies the change.

```ts
// Record written by another tab, as JSON text.
consent.restore(
  '{"format":1,"decisions":{"analytics":{"status":"granted","version":"2026-10","decidedAt":1793404800000}}}',
);
consent.getSnapshot().status.analytics; // 'granted'
```

### `subscribe(listener)`

Subscribes a listener, called synchronously after each change of the record, in subscription order. Exceptions of a listener interrupt neither the others nor the operation: they are rethrown in a microtask (see [Listener errors](#listener-errors)). Each call creates an independent subscription (see [Subscriptions](#subscriptions)). Compatible with the `useSyncExternalStore` hook of React.

- Parameter `listener` (`ConsentListener<P>`): function that receives each notification.
- Returns: idempotent function that cancels this subscription.
- Errors: `TypeError` if `listener` is not a function.

```ts
const unsubscribe = consent.subscribe((change) => {
  console.log(change.source, change.changed); // 'decision' ['ads']
});
consent.decide({ ads: 'denied' });
unsubscribe(); // calling it again has no effect
```

## `ConsentOptions`

```ts
export interface ConsentOptions<P extends string = string, C extends string = string> {
  readonly purposes: { readonly [K in P]: PurposeConfig<C> };
  readonly record?: unknown;
  readonly now?: (() => number) | undefined;
  readonly maxAge?: number | undefined;
}
```

Options of `createConsentManager`. Unknown options cause a `TypeError` at runtime and a compile error, and a key present with the value `undefined` is the same as an absent key.

- `purposes`: consent-based purposes, indexed by id; at least one. The id follows the [format of identifiers](#format-of-identifiers). The key order defines the order used in snapshots, records and notifications.
- `record`: previously saved record, as an object or as JSON text. It is treated as untrusted data: missing or invalid content and expired decisions are discarded without error, and the affected purpose stays `'pending'`. Hydration does not notify.
- `now`: clock used for `decidedAt` and for the evaluation of expiry. It must return milliseconds since 1970-01-01T00:00:00Z as a non-negative safe integer and is called without `this`. Default: the start of the UTC day of `Date.now()`, with `Date.now` read when the manager is created; replacing `Date.now` after creation does not affect the instance. The rounding keeps `decidedAt` from singling out the device; pass a more precise clock, such as `Date.now`, only if the application needs it. The clock must not call functions of the manager; if it does, the behavior is not specified.
- `maxAge`: maximum age of the decisions, grants and refusals, in milliseconds; a positive safe integer. Default: 365 days. A decision is current while `0 <= now() - decidedAt < maxAge`. Expiry is evaluated, with the configured clock, when `record` is hydrated and on each `restore`, and never continuously, to keep the snapshot stable as `useSyncExternalStore` requires: a decision that expires while the page is open stays current until the next restore. An expired decision, or one dated after the clock (whose age cannot be established), is discarded as if it did not exist, and the purpose stays `'pending'`, without `outdated`. If the clock throws or returns an invalid value in this evaluation, every decision evaluated is discarded (fail closed), without error. The effective value is in [`consent.maxAge`](#maxage).

```ts
import { createConsentManager } from 'lgpder';

const DAY = 24 * 60 * 60 * 1000; // one day in milliseconds

export const consent = createConsentManager({
  purposes: { analytics: { version: '2026-10' } },
  record: savedRecord, // JSON text saved by the application, or null
  maxAge: 180 * DAY, // decisions are current for 180 days
});
```

`savedRecord` is the text the application read from its storage. With [`lgpder/storage`](storage.md), the storage adopts the saved record on connection, and `record` is not needed.

### Expiry in a long-lived tab

Since expiry is evaluated only when a record is hydrated or restored, a tab kept open for a long time notices it only on a `restore` that receives a new text (for example, when another tab saves a decision) or on the next load. The storage layer does not restore an unchanged text, so its periodic syncs (`visibilitychange`, `pageshow`) do not expire a decision either. This keeps the snapshot stable while the page is open, as `useSyncExternalStore` requires; the next load always applies the maximum age.

### Format of identifiers

Purpose and category ids start with an ASCII letter and contain only ASCII letters, digits, `_`, `-` and `.` (pattern `/^[A-Za-z][A-Za-z0-9_.-]*$/`, without a length limit). The names of `Object.prototype` properties that match the pattern (`constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString` and `valueOf`) are refused, and names starting with `_`, such as `__proto__`, do not match the pattern. So `'*'`, `''`, `'1abc'`, `'a b'` and `'estatística'` are invalid, and `'all'` is accepted as a regular purpose, without special meaning.

## `PurposeConfig`

```ts
export interface PurposeConfig<C extends string = string> {
  readonly version?: string | undefined;
  readonly category?: C | undefined;
  readonly individualGrant?: boolean | undefined;
}
```

Configuration of a consent-based processing purpose. Unknown properties cause a `TypeError` at runtime and a compile error.

- `version`: version of the information presented to the data subject about this purpose: an opaque non-empty string, compared by strict equality, without ordering. A decision recorded under another version is no longer current: the purpose goes back to `'pending'` and is flagged in `outdated` (see [Version and `outdated`](#version-and-outdated)). Absent: the purpose is not versioned.
- `category`: category used only to group purposes (for example, in the interface). It has no consent state nor operation of its own and changes no rule of the core: batches by category are built by the application with `decide` and record one decision per purpose (see [Batch by category and pending purposes](storage.md#batch-by-category-and-pending-purposes)). It follows the [format of identifiers](#format-of-identifiers). A misspelled category, such as `'marketng'`, is accepted and forms another group; preventing it is up to the typing of the application (see [Typing](#typing)).
- `individualGrant`: if `true`, `grantAll` does not reach this purpose, which is only granted when named in `decide`; `denyAll` includes it as usual. Since the mark is in the configuration, any "accept all" button built on `grantAll` leaves this purpose out by construction. Meant for purposes that require a specific decision, such as the ones involving sensitive personal data or data of children; the relation with the LGPD is in the topics [Dados sensíveis](lgpd.md#dados-sensíveis) and [Crianças e adolescentes](lgpd.md#crianças-e-adolescentes) (in Portuguese). Default: `false`.

```ts
import type { PurposeConfig } from 'lgpder';

export const healthReminders: PurposeConfig<'health'> = {
  version: '2026-10', // change it only when the change requires a new expression of the data subject
  category: 'health',
  individualGrant: true, // out of grantAll: granted only when named in decide
};
```

### Version and `outdated`

`version` is optional, defined per purpose and opaque: a non-empty string compared by strict equality, without ordering (`'10'` and `'9'` are only different). Each decision records the current version of the purpose. A decision recorded under another version is `'pending'`, is flagged with `outdated: true` and stays in the record until replaced. It is neither changed nor turned into `'denied'`: `outdated` is not a revocation. The flag lets the application inform the data subject about the change and collect a new decision; the [banner of `lgpder/ui`](ui.md#banner) opens again in that case.

- In the comparison, absent and absent are equal, and absent and a string are different: if the purpose has no configured version and the saved decision has one, or the opposite, the decision is outdated.
- A new decision on an outdated purpose records the current version, even if the value is the same as before, and notifies.
- Going back to an earlier version makes the decisions recorded under it current again.
- A new purpose starts `'pending'`, with `outdated: false`. The saved decision of a purpose removed from the configuration is ignored when read and does not appear in the record.
- There is no global version: a constant shared among purposes covers general changes (such as `TERMS` in [Binding to `localStorage`](storage.md#binding-to-localstorage)).
- The configuration is immutable during the life of the instance: changing purposes or versions requires a new instance (for example, in a new deploy).

When to change the version, and what the LGPD requires in that case, is in [versionamento e reconsentimento](lgpd.md#alteração-de-informações-ou-de-finalidade-versionamento-e-reconsentimento) (in Portuguese).

## `ConsentStatus`

```ts
export type ConsentStatus = 'pending' | 'granted' | 'denied';
```

Effective status of a purpose, computed from the recorded decision and the current version of the purpose:

- `'pending'`: there is no current decision. There was never a decision, the last one was recorded under another version of the purpose, or it expired.
- `'granted'`: consent granted under the current version.
- `'denied'`: consent refused or revoked under the current version.

| Condition                                            | `status[id]`             | `outdated[id]` |
| ---------------------------------------------------- | ------------------------ | -------------- |
| no decision                                          | `'pending'`              | `false`        |
| decision recorded under a version other than current | `'pending'`              | `true`         |
| decision recorded under the current version          | `status` of the decision | `false`        |

Only `'granted'` authorizes consent-based processing; `'pending'` and `'denied'` do not. The absence of a decision is `'pending'` and never amounts to consent. Every purpose starts `'pending'`, and only `decide` and `grantAll` produce `'granted'`: there is no initial value option, no inference from browsing or from another purpose, and no automatic conversion of `'pending'`. A purpose only goes back to `'pending'` through a new instance with a different version, through expiry or through a `restore` of a record without a valid decision for it or with a decision recorded under another version (then with `outdated: true`).

```ts
import type { ConsentStatus } from 'lgpder';

// 'pending' and 'denied' do not authorize the processing.
export const authorizes = (status: ConsentStatus): boolean => status === 'granted';
```

## `DecidedStatus`

```ts
export type DecidedStatus = Exclude<ConsentStatus, 'pending'>;
```

Outcome that a decision records: a grant (`'granted'`) or a refusal (`'denied'`).

- A refusal is a recorded and stable decision, distinct from `'pending'`, which lets the application not ask again on each visit. No operation requires a purpose to be granted.
- Revoking consent is recording `'denied'` (`decide` or `denyAll`), with the same call shape as granting, without confirmation, precondition or limit. A revocation creates a new dated decision and a notification, has no retroactive effect and does not erase data processed by the application.

```ts
import type { DecidedStatus } from 'lgpder';

// Switch of a preferences center: on grants; off refuses or revokes.
export function toggleAnalytics(checked: boolean): void {
  const status: DecidedStatus = checked ? 'granted' : 'denied';
  consent.decide({ analytics: status });
}
```

## `ConsentChoices`

```ts
export type ConsentChoices<P extends string = string> = {
  readonly [K in P]?: DecidedStatus | undefined;
};
```

Decisions to record, per purpose: the input of `decide`. Omitted purposes, or purposes with `undefined`, do not change.

```ts
import type { ConsentChoices } from 'lgpder';

const choices: ConsentChoices<keyof typeof consent.purposes> = {
  analytics: 'granted',
  ads: undefined, // no change
};
consent.decide(choices);
```

## `ConsentDecision`

```ts
export interface ConsentDecision {
  readonly status: DecidedStatus;
  readonly version?: string;
  readonly decidedAt: number;
}
```

Decision recorded for a purpose. Frozen object.

- `status`: `'granted'` for a grant; `'denied'` for a refusal or revocation.
- `version`: version of the purpose at the time of the decision; absent if the purpose was not versioned.
- `decidedAt`: instant of the decision, in milliseconds since 1970-01-01T00:00:00Z, from the configured clock (by default, the start of the UTC day). `decide`, `grantAll` and `denyAll` do not compare instants: the current decision is the last one recorded, whatever its `decidedAt`. The only use of `decidedAt` by the core is expiry, evaluated on hydration and in `restore` (see [`maxAge`](#consentoptions)).

In the example, the decision happens on 2026-10-31, and the default clock records the start of that UTC day (`1793404800000`):

```ts
consent.decide({ analytics: 'granted', ads: 'denied' });
consent.getSnapshot().record.decisions.analytics;
// { status: 'granted', version: '2026-10', decidedAt: 1793404800000 }
consent.getSnapshot().record.decisions.ads; // { status: 'denied', decidedAt: 1793404800000 }
```

## `ConsentRecord`

```ts
export interface ConsentRecord<P extends string = string> {
  readonly format: 1;
  readonly decisions: { readonly [K in P]?: ConsentDecision };
}
```

Serializable record of the decisions. It is what the application persists, with `JSON.stringify(snapshot.record)`, and gives back in `record` or in `restore()`; [`lgpder/storage`](storage.md) does both. It contains no identifier assigned by LGPDer; the instant of each decision, depending on the precision of the clock (`now`), could single out the device. Frozen object.

- `format`: version of the record format, independent of the purpose versions and of the package.
- `decisions`: last decision of each configured purpose that has one, current or outdated, in configuration order.

`JSON.stringify(snapshot.record)` is deterministic for the same state: keys `format` and `decisions`, in this order; decisions in configuration order; fields of each decision in the order `status`, `version`, `decidedAt`. Each purpose usually takes 50 to 90 bytes, depending on the length of the id and of the version.

In the example, the decision happens on 2026-10-31, with the default clock:

```ts
consent.decide({ analytics: 'granted', ads: 'denied' });
JSON.stringify(consent.getSnapshot().record); // text below, formatted for reading
```

```json
{
  "format": 1,
  "decisions": {
    "analytics": { "status": "granted", "version": "2026-10", "decidedAt": 1793404800000 },
    "ads": { "status": "denied", "decidedAt": 1793404800000 }
  }
}
```

Every received record, on hydration or in `restore`, is treated as untrusted data: it is validated strictly, without throwing, and whatever is invalid becomes the absence of a decision. Then the expired decisions are discarded (see [`maxAge`](#consentoptions)). No read failure grants consent. Text is read with `JSON.parse`, and invalid text, including `''`, is an empty record. Accepted format:

| Path                       | Type                      | Required | Rule                                                                       |
| -------------------------- | ------------------------- | -------- | -------------------------------------------------------------------------- |
| root                       | plain object              | yes      | another type invalidates the whole record                                  |
| `format`                   | number `1`                | yes      | any other value (including `"1"`) invalidates the whole record             |
| `decisions`                | plain object              | yes      | only the keys equal to configured ids are read                             |
| `decisions.<id>`           | plain object              | no       | an invalid entry is discarded alone                                        |
| `decisions.<id>.status`    | `"granted"` or `"denied"` | yes      |                                                                            |
| `decisions.<id>.version`   | non-empty string          | no       | absent: the purpose was not versioned at the decision                      |
| `decisions.<id>.decidedAt` | safe integer >= 0         | yes      | milliseconds since the Unix epoch; past the maximum age, the entry expires |

Only own properties are considered, and the keys of the record are never iterated: the core looks up only the configured ids. Extra fields are ignored and not copied, and any exception during the read (a getter that throws, a proxy) results in an empty record. The `__proto__` key in JSON text is never read, because it is not a valid id. Objects created in another realm (for example, in an iframe) are not plain objects and result in an empty record; in that case, pass the JSON text. There is no size limit: the cost is proportional to the number of configured purposes, and the source of the data is controlled by the application.

## `ConsentSnapshot`

```ts
export interface ConsentSnapshot<P extends string = string> {
  readonly status: { readonly [K in P]: ConsentStatus };
  readonly outdated: { readonly [K in P]: boolean };
  readonly record: ConsentRecord<P>;
}
```

Immutable state of the preferences at an instant. Frozen object, and so are `status`, `outdated`, `record`, `record.decisions` and each decision.

- `status`: effective status of each configured purpose, in configuration order.
- `outdated`: `true` when the purpose has a decision recorded under a version other than the current one; the status is then `'pending'` (see [Version and `outdated`](#version-and-outdated)).
- `record`: serializable record matching this state.

Consecutive snapshots share the unchanged parts: each unchanged decision keeps its reference, `status` keeps its reference if no status changed and `outdated` keeps its reference if no flag changed; `record` and `record.decisions` are new objects at each change. Trying to change a snapshot throws a `TypeError` in strict mode and does not affect the state. The public objects have the `Object.prototype` prototype (and `changed` is a regular array), so `assert.deepStrictEqual` accepts literals as the expected value.

```ts
consent.getSnapshot();
// {
//   status: { analytics: 'pending', ads: 'pending', healthReminders: 'pending' },
//   outdated: { analytics: false, ads: false, healthReminders: false },
//   record: { format: 1, decisions: {} },
// }
```

## `ChangeSource`

```ts
export type ChangeSource = 'decision' | 'restore';
```

Source of a change:

- `'decision'`: decision recorded in this instance by `decide`, `grantAll` or `denyAll`.
- `'restore'`: external record adopted by `restore`. It does not represent a new expression of the will of the data subject.

Hydration does not notify. Restoring and hydrating never represent an expression of the will of the data subject; so the evidence of the decisions of the data subject is recorded only from notifications with source `'decision'`, as [`lgpder/evidence`](evidence.md) does.

```ts
import type { ChangeSource } from 'lgpder';

// Only the decisions recorded in this page are a new expression of the data subject.
export const isLocalDecision = (source: ChangeSource): boolean => source === 'decision';
```

## `ConsentChange`

```ts
export interface ConsentChange<P extends string = string> {
  readonly source: ChangeSource;
  readonly changed: readonly P[];
  readonly snapshot: ConsentSnapshot<P>;
  readonly previous: ConsentSnapshot<P>;
}
```

Notification delivered to the listeners after each change of the record. Frozen object.

- `source`: source of the change.
- `changed`: purposes whose record entry changed, in configuration order; a frozen array, never empty. In changes with source `'restore'`, it may include purposes whose effective status did not change (see [`changed` in restores](#changed-in-restores)).
- `snapshot`: state right after this change.
- `previous`: state right before this change.

```ts
import type { ConsentChange } from 'lgpder';

type PurposeId = keyof typeof consent.purposes;

// Purposes whose effective status changed in this change.
export const statusChanges = ({ changed, previous, snapshot }: ConsentChange<PurposeId>) =>
  changed.filter((id) => previous.status[id] !== snapshot.status[id]);
```

## `ConsentListener`

```ts
export type ConsentListener<P extends string = string> = (change: ConsentChange<P>) => void;
```

Function called after each change of the record, with the notification as its only argument. The returned value is ignored, and listeners without parameters, such as the callback of `useSyncExternalStore`, work.

```ts
import type { ConsentListener } from 'lgpder';

const logChange: ConsentListener<keyof typeof consent.purposes> = ({ source, changed }) => {
  console.info(`consent (${source}): ${changed.join(', ')}`);
};
consent.subscribe(logChange);
```

## Typing

- `P` is inferred from the keys of `options.purposes` as a literal union, also when the configuration is in a variable without `as const`.
- `C` is inferred from the union of the `category` values: literal when written in the object of the call or with `as const`; `string` when it comes from a variable without `as const`; `never` when no purpose declares a category.
- Protection against a misspelled category is up to the application, with `satisfies`:

```ts
import type { PurposeConfig } from 'lgpder';

type Category = 'statistics' | 'marketing';

export const PURPOSES = {
  analytics: { version: '2026-10', category: 'statistics' },
  // @ts-expect-error compile error: 'marketng' is out of the Category union
  ads: { category: 'marketng' },
} as const satisfies Record<string, PurposeConfig<Category>>;
```

- A configuration annotated as `Record<string, PurposeConfig>`, for example coming from the server, produces `ConsentManager<string, string>`; runtime validation covers ids and values.
- `ConsentManager<P, C>` is assignable to `ConsentManager` (defaults `string`), for extensions that accept any manager.
- Compile errors: unknown property in a purpose, unknown option, unknown id in `decide`, value other than `'granted'`, `'denied'` or `undefined` in `decide`, arguments in `grantAll` and `denyAll` and assignment to any field of a snapshot.
- Inputs accept an explicit `undefined` in `version`, `category`, `individualGrant`, `record`, `now`, `maxAge` and in the values of `decide`, which is compatible with `exactOptionalPropertyTypes`.
- `keyof typeof consent.purposes` gives `P`; there are no type aliases for the ids.

## Errors

Programming errors throw native `TypeError` or `RangeError` instances, synchronously and without partial effect: on any error, nothing changes and nothing is notified. They are errors to fix in the code, not conditions to handle at runtime. The error objects are not frozen and have no `cause`. Saved data never causes an error: `restore` and hydration never throw.

The messages are fixed, in English, with the `[lgpder] ` prefix and ending in a period, and never reproduce values read from records. In the table, `{json(x)}` is `JSON.stringify(x)` applied to a string (the string between double quotes, with escapes), and `{type(x)}` is `null` for `null`, `array` for arrays and, otherwise, the result of `typeof x`. The layers follow the same format; their messages are in their guides.

| Function                        | Class        | When                                             | Message                                                                                             |
| ------------------------------- | ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `createConsentManager`          | `TypeError`  | `options` is not a plain object                  | `[lgpder] Options must be a plain object; received: {type(options)}.`                               |
| `createConsentManager`          | `TypeError`  | unknown key in `options`                         | `[lgpder] Unknown option: {json(key)}.`                                                             |
| `createConsentManager`          | `TypeError`  | `purposes` is not a plain object                 | `[lgpder] "purposes" must be a plain object; received: {type(purposes)}.`                           |
| `createConsentManager`          | `TypeError`  | `purposes` without purposes                      | `[lgpder] "purposes" must declare at least one purpose.`                                            |
| `createConsentManager`          | `TypeError`  | invalid purpose id                               | `[lgpder] Invalid purpose id: {json(id)}.`                                                          |
| `createConsentManager`          | `TypeError`  | configuration of a purpose is not a plain object | `[lgpder] The configuration of purpose {json(id)} must be a plain object; received: {type(value)}.` |
| `createConsentManager`          | `TypeError`  | unknown key in a purpose                         | `[lgpder] Purpose {json(id)} has the unknown property {json(key)}.`                                 |
| `createConsentManager`          | `TypeError`  | invalid `version`                                | `[lgpder] The version of purpose {json(id)} must be a non-empty string.`                            |
| `createConsentManager`          | `TypeError`  | invalid `category`                               | `[lgpder] The category of purpose {json(id)} must be a valid id.`                                   |
| `createConsentManager`          | `TypeError`  | invalid `individualGrant`                        | `[lgpder] "individualGrant" of purpose {json(id)} must be a boolean.`                               |
| `createConsentManager`          | `TypeError`  | `now` is not a function                          | `[lgpder] "now" must be a function; received: {type(now)}.`                                         |
| `createConsentManager`          | `TypeError`  | `maxAge` is not a positive safe integer          | `[lgpder] "maxAge" must be a positive safe integer (milliseconds).`                                 |
| `decide`                        | `TypeError`  | `choices` is not a plain object                  | `[lgpder] Choices must be a plain object; received: {type(choices)}.`                               |
| `decide`                        | `RangeError` | purpose not configured in `decide`               | `[lgpder] Unknown purpose: {json(key)}.`                                                            |
| `decide`                        | `TypeError`  | invalid value in `decide`                        | `[lgpder] The choice for {json(id)} must be "granted" or "denied"; received: {type(value)}.`        |
| `decide`, `grantAll`, `denyAll` | `TypeError`  | the clock returned an invalid value              | `[lgpder] "now" must return a non-negative safe integer (milliseconds since the Unix epoch).`       |
| `subscribe`                     | `TypeError`  | `listener` is not a function                     | `[lgpder] The listener must be a function; received: {type(listener)}.`                             |

Examples:

| Call                                                            | Message                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `createConsentManager({ purposes: [] })`                        | `[lgpder] "purposes" must be a plain object; received: array.`                    |
| `createConsentManager({ purposes: { '*': {} } })`               | `[lgpder] Invalid purpose id: "*".`                                               |
| `createConsentManager({ purposes: { ads: { verison: '1' } } })` | `[lgpder] Purpose "ads" has the unknown property "verison".`                      |
| `consent.decide({ analytic: 'granted' })`                       | `[lgpder] Unknown purpose: "analytic".` (`RangeError`)                            |
| `consent.decide({ ads: true })`                                 | `[lgpder] The choice for "ads" must be "granted" or "denied"; received: boolean.` |
| `consent.subscribe('x')`                                        | `[lgpder] The listener must be a function; received: string.`                     |

A plain object is a value whose `typeof` is `'object'`, other than `null`, whose prototype is `Object.prototype` or `null`. Arrays, `Map` instances and objects created in another realm are not plain objects.

The messages must not be used for control flow; changes to them follow the [versioning of the package](../README.md#versioning).

### Listener errors

The exception thrown by a listener is caught: the following listeners are called, and the operation that caused the notification returns normally. The thrown value is rethrown intact by `queueMicrotask`, once per error, so the defect stays visible. In the browser, it shows up as an unhandled exception; in Node.js, it raises `uncaughtException`, which ends the process by default. Handle the errors in the listener itself, with `try/catch`:

```ts
consent.subscribe(({ snapshot }) => {
  try {
    applyConsent(snapshot.status);
  } catch (error) {
    reportIntegrationError(error);
  }
});
```

`applyConsent` and `reportIntegrationError` are functions of the application.

### Listeners in a loop

There is no cascade limit. Listeners that change the state indefinitely, such as two listeners that flip the same purpose between `'granted'` and `'denied'`, create an infinite loop, which is a defect of the application.

## Notifications

There is a notification if and only if the record changes: an effective call of `decide`, `grantAll` or `denyAll` produces a notification with source `'decision'`, and a `restore` that changes some entry produces a notification with source `'restore'`. Creation, hydration, calls without effect and calls that throw do not notify. The notification is delivered only to the subscribers of the instance, without global events and without network. Each notification is a frozen [`ConsentChange`](#consentchange) object.

### Order

An effective operation follows this order:

1. validates the input (in `restore`, reads the record and, if it has valid decisions, reads the clock to discard the expired ones);
2. computes the changes;
3. reads the clock, for `decidedAt` (only `decide`, `grantAll` and `denyAll`);
4. commits the change: from here on, `getSnapshot()` returns the new state;
5. notifies the listeners synchronously, in subscription order.

When the call does not happen inside a listener, every notification, including the ones queued by listeners, is delivered before it returns.

### Reentrancy

`decide`, `grantAll`, `denyAll` and `restore` called inside a listener are validated and committed immediately (`getSnapshot()` reflects the change at once) and return before their notification is delivered. The notification goes to the end of a FIFO queue and is delivered only after the current notification reaches every listener. Every listener receives the notifications in commit order, and the `previous` of each notification is the `snapshot` of the previous one. This is why the layers that act on the page ([scripts](scripts.md), [google](google.md) and [ui](ui.md)) decide from `getSnapshot()`, never from the notification alone: a decision made while a notification is delivered is never undone.

### Subscriptions

- Each `subscribe` creates an independent subscription: the same function subscribed twice is called twice per notification. The cancel function is idempotent and removes only its own subscription.
- Cancelling a subscription during a delivery takes effect immediately: the cancelled subscription is not called for any notification it did not receive yet, including the current one.
- A subscription receives only notifications of changes committed after it. A subscription created during a delivery receives neither the current notification nor the ones already queued.

### Initial state of integrations

Hydration does not notify, and the changes committed before a subscription never reach it. [`connectStorage`](storage.md), for example, adopts the saved record with `restore` as soon as it is connected, usually before the integrations subscribe. So an integration first applies the state of `getSnapshot()` and then compares each notification with the status it already applied:

```ts
let analyticsActive = consent.getSnapshot().status.analytics === 'granted';
if (analyticsActive) startAnalytics();

consent.subscribe(({ snapshot }) => {
  const granted = snapshot.status.analytics === 'granted';
  if (granted === analyticsActive) return;
  analyticsActive = granted;
  if (granted) startAnalytics();
  else stopAnalytics(); // revocation or restore: stop the processing
});
```

`startAnalytics` and `stopAnalytics` are functions of the application. This way, whoever comes back to the site with `analytics` granted has the processing started when the page loads. [`onGranted`](scripts.md#ongrantedpurpose-fn) of `lgpder/scripts` does this for the application.

### `changed` in restores

In notifications with source `'restore'`, `changed` lists the purposes whose record entry changed (added, removed or changed) and may include purposes whose effective status did not change, for example when only `decidedAt` changed. Integrations react to the effective status (`snapshot.status`, compared with `previous.status` or with the status already applied), not to the presence in `changed`.

## Server rendering

The core works the same on the server, without `window`, and never accesses storage, not even a global `localStorage` offered by Node.js. An instance created at module scope on the server is shared by every request and must never receive decisions. To use the record of the data subject on the server, create one instance per request, from the cookie of the request, and render with its `getSnapshot`; when the record exists only in the browser, render with `getServerSnapshot`. The recipes for React and Next.js are in [SSR, Next.js and React](ssr-react.md).
