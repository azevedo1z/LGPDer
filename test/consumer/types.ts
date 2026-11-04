/**
 * Type tests compiled against the published `dist/index.d.ts`, with the TypeScript version of the
 * repository. They repeat a representative subset of `test/types.check.ts`.
 */
import { createConsentManager, type ConsentManager, type ConsentSnapshot } from 'lgpder';

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
