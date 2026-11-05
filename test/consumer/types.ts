/**
 * Type tests compiled against the published `.d.ts` files, with the TypeScript version of the
 * repository and without the DOM types (`lib: ["es2022"]`): the core, lgpder/storage and
 * lgpder/google must not require them from the consumer. They repeat a
 * representative subset of `test/types.check.ts`, `test/storage/types.check.ts` and
 * `test/google/types.check.ts`.
 */
import { createConsentManager, type ConsentManager, type ConsentSnapshot } from 'lgpder';
import {
  connectGoogle,
  consentDefaultSnippet,
  type ConsentGoogle,
  type ConsentType,
  type GoogleOptions,
} from 'lgpder/google';
import {
  connectStorage,
  cookieAdapter,
  localStorageAdapter,
  type ConsentStorage,
  type StorageAdapter,
} from 'lgpder/storage';

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
    health: { version: '1', category: 'health', individualGrant: true },
  },
  maxAge: 180 * 24 * 60 * 60 * 1000,
});
type Id = 'analytics' | 'health';
export type Inference = Expect<Equal<typeof consent, ConsentManager<Id, 'statistics' | 'health'>>>;

// @ts-expect-error unknown id in decide
consent.decide({ typo: 'granted' });

// The effective maxAge is a number.
export type MaxAgeIsNumber = Expect<Equal<typeof consent.maxAge, number>>;

// ConsentManager<P, C> is assignable to ConsentManager.
export type AssignableToGeneral = Expect<Assignable<typeof consent, ConsentManager>>;

// Compatibility with useSyncExternalStore and type of the returned snapshot.
export const state = useSyncExternalStore(
  consent.subscribe,
  consent.getSnapshot,
  consent.getServerSnapshot,
);
export type SyncExternalStoreSnapshot = Expect<Equal<typeof state, ConsentSnapshot<Id>>>;

// lgpder/storage: P inferred from the manager, and the built-in adapters are storages.
const storage = connectStorage(consent, { storage: 'cookie', key: 'consent', crossTab: true });
export type StorageInference = Expect<Equal<typeof storage, ConsentStorage<Id>>>;
export const adapters: readonly StorageAdapter[] = [
  localStorageAdapter({ key: 'consent' }),
  cookieAdapter({ maxAge: consent.maxAge }),
];

// @ts-expect-error unknown id in the decide of the storage
storage.decide({ typo: 'granted' });

// lgpder/google: the options take the purposes of the manager, and the snippet is a string.
const googleOptions: GoogleOptions<Id> = {
  purposes: {
    analytics: { integrations: ['google-analytics'], consentMode: ['functionality_storage'] },
  },
};
export const google: ConsentGoogle = connectGoogle(consent, googleOptions);
export const snippet: string = consentDefaultSnippet;
export const types: readonly ConsentType[] = ['ad_storage', 'security_storage'];

// @ts-expect-error unknown consent type
connectGoogle(consent, { purposes: { analytics: { consentMode: ['ads_storage'] } } });
