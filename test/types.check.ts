/**
 * Type tests of the public API, checked by `tsc` and never run. Each `Expect` requires `true`, and
 * each `@ts-expect-error` requires the compile error described on the same line.
 */
import type {
  ChangeSource,
  ConsentChange,
  ConsentDecision,
  ConsentManager,
  ConsentSnapshot,
  DecidedStatus,
  PurposeConfig,
} from 'lgpder';

import { createConsentManager } from '../src/index.ts';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- T is the very mechanism of the exact type comparison */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;
type Assignable<From, To> = [From] extends [To] ? true : false;

/** Local copy of the signature of the React `useSyncExternalStore`. */
declare function useSyncExternalStore<Snapshot>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot?: () => Snapshot,
): Snapshot;

// P and C inferred from the object written in the call.
const consent = createConsentManager({
  purposes: {
    analytics: { version: '2026-10', category: 'statistics' },
    ads: { category: 'marketing' },
    health: { version: '1', individualGrant: true },
  },
});
type Id = 'analytics' | 'ads' | 'health';
export type InlineInference = Expect<
  Equal<typeof consent, ConsentManager<Id, 'statistics' | 'marketing'>>
>;

// C is never when no purpose declares a category.
export const withoutCategories = createConsentManager({
  purposes: { a: {}, b: { version: '1' } },
});
export type NeverCategory = Expect<
  Equal<typeof withoutCategories, ConsentManager<'a' | 'b', never>>
>;

// Configuration in a variable without as const: literal P and string C, the default of ConsentManager.
const variablePurposes = { analytics: { category: 'statistics' }, ads: {} };
export const fromVariable = createConsentManager({ purposes: variablePurposes });
export type VariableInference = Expect<
  Equal<typeof fromVariable, ConsentManager<'analytics' | 'ads'>>
>;

// as const satisfies Record<string, PurposeConfig>: literal P and C.
const CONSTANT_PURPOSES = {
  analytics: { version: '2026-10', category: 'statistics' },
  ads: { category: 'marketing' },
} as const satisfies Record<string, PurposeConfig>;
export const fromConstant = createConsentManager({ purposes: CONSTANT_PURPOSES });
export type ConstantInference = Expect<
  Equal<typeof fromConstant, ConsentManager<'analytics' | 'ads', 'statistics' | 'marketing'>>
>;

// A dynamic configuration, annotated as Record<string, PurposeConfig>, produces
// ConsentManager<string, string>, that is, ConsentManager with the default parameters.
const dynamicPurposes: Record<string, PurposeConfig> = { ads: {} };
export const dynamic = createConsentManager({ purposes: dynamicPurposes });
export type DynamicConfiguration = Expect<Equal<typeof dynamic, ConsentManager>>;

// Protection against a typo in the category is up to the application, with satisfies.
type Category = 'statistics' | 'marketing';
export const TYPO_PROTECTED = {
  analytics: { version: '2026-10', category: 'statistics' },
  // @ts-expect-error category outside the Category union
  ads: { category: 'marketng' },
} as const satisfies Record<string, PurposeConfig<Category>>;

// Expected compile errors in the configuration.
createConsentManager({
  // @ts-expect-error unknown property in the purpose
  purposes: { ads: { verison: '1' } },
});
createConsentManager({
  purposes: { ads: {} },
  // @ts-expect-error unknown option
  storage: {},
});
createConsentManager({
  // @ts-expect-error non-boolean individualGrant
  purposes: { ads: { individualGrant: 'yes' } },
});
createConsentManager({
  purposes: { ads: {} },
  // @ts-expect-error clock that returns a string, not a number
  now: () => '1',
});
createConsentManager({
  purposes: { ads: {} },
  // @ts-expect-error maxAge as a string, not a number
  maxAge: '365d',
});

// Expected compile errors in the use of the manager.
// @ts-expect-error unknown id in decide
consent.decide({ typo: 'granted' });
// @ts-expect-error unknown id in decide, even with the value undefined
consent.decide({ typo: undefined });
// @ts-expect-error boolean value in decide
consent.decide({ ads: true });
// @ts-expect-error value 'pending' in decide
consent.decide({ ads: 'pending' });
// @ts-expect-error argument in grantAll
consent.grantAll({ health: 'granted' });
// @ts-expect-error argument in denyAll
consent.denyAll(true);

// Assigning to any public field is a compile error.
const snapshot = consent.getSnapshot();
const server = consent.getServerSnapshot();
declare const decision: ConsentDecision;
// @ts-expect-error assignment to the status of the snapshot
snapshot.status = server.status;
// @ts-expect-error assignment to a field of the status of the snapshot
snapshot.status.ads = 'granted';
// @ts-expect-error assignment to the outdated of the snapshot
snapshot.outdated = server.outdated;
// @ts-expect-error assignment to a field of the outdated of the snapshot
snapshot.outdated.analytics = true;
// @ts-expect-error assignment to the record of the snapshot
snapshot.record = server.record;
// @ts-expect-error assignment to the format of the record
snapshot.record.format = 1;
// @ts-expect-error assignment to the decisions of the record
snapshot.record.decisions = server.record.decisions;
// @ts-expect-error assignment to an entry of the decisions of the record
snapshot.record.decisions.ads = decision;
// @ts-expect-error assignment to the status of a decision
decision.status = 'denied';
// @ts-expect-error assignment to the version of a decision
decision.version = '2';
// @ts-expect-error assignment to the instant of a decision
decision.decidedAt = 0;
// @ts-expect-error assignment to the configuration of a purpose
consent.purposes.ads = {};
// @ts-expect-error assignment to the maxAge of the manager
consent.maxAge = 0;

// Every input accepts an explicit undefined.
const explicitUndefined = createConsentManager({
  purposes: { ads: { version: undefined, category: undefined, individualGrant: undefined } },
  record: undefined,
  now: undefined,
  maxAge: undefined,
});
explicitUndefined.decide({ ads: undefined });

// maxAge accepts a number of milliseconds.
export const withMaxAge = createConsentManager({
  purposes: { ads: {} },
  maxAge: 180 * 24 * 60 * 60 * 1000,
});

// ConsentManager<P, C> is assignable to ConsentManager, for extensions that accept any manager.
export type AssignableToGeneral = Expect<
  Assignable<ConsentManager<'a' | 'b', 'x'>, ConsentManager>
>;

// Compatibility with useSyncExternalStore, with getServerSnapshot as the third argument, and type
// of the returned snapshot.
export const state = useSyncExternalStore(
  consent.subscribe,
  consent.getSnapshot,
  consent.getServerSnapshot,
);
export type SyncExternalStoreSnapshot = Expect<Equal<typeof state, ConsentSnapshot<Id>>>;

// Types derived from the manager.
type ListenerArgument = Parameters<Parameters<typeof consent.subscribe>[0]>[0];
export type ListenerReceivesChange = Expect<Equal<ListenerArgument, ConsentChange<Id>>>;
export type PurposeKeys = Expect<Equal<keyof typeof consent.purposes, Id>>;
export type DecidedValues = Expect<Equal<DecidedStatus, 'granted' | 'denied'>>;
export type RestoreAcceptsAnyValue = Expect<Equal<Parameters<typeof consent.restore>[0], unknown>>;
export type MaxAgeIsNumber = Expect<Equal<typeof consent.maxAge, number>>;

// Members pinned with literal types: comparing a public type with itself would not detect a
// change in its declaration.
export type ChangedIds = Expect<Equal<ConsentChange<Id>['changed'], readonly Id[]>>;
export type ChangeSources = Expect<Equal<ChangeSource, 'decision' | 'restore'>>;
export type ChangeSourceField = Expect<Equal<ConsentChange['source'], ChangeSource>>;
export type DecisionStatus = Expect<Equal<ConsentDecision['status'], 'granted' | 'denied'>>;
export type RecordFormat = Expect<Equal<(typeof snapshot)['record']['format'], 1>>;
export type ServerSnapshotIds = Expect<
  Equal<ReturnType<typeof consent.getServerSnapshot>, ConsentSnapshot<Id>>
>;

// The functions are properties without this and work destructured.
const { decide } = consent;
decide({ ads: 'granted' });
