/**
 * Type tests of the public API of lgpder/storage, checked by `tsc` and never run. Each `Expect`
 * requires `true`, and each `@ts-expect-error` requires the compile error described on the same
 * line.
 */
import type { ConsentChoices } from 'lgpder';
import type { ConsentStorage, StorageAdapter, StorageOptions } from 'lgpder/storage';

import { createConsentManager } from '../../src/index.ts';
import { connectStorage, cookieAdapter, localStorageAdapter } from '../../src/storage/index.ts';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- T is the very mechanism of the exact type comparison */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;
type Assignable<From, To> = [From] extends [To] ? true : false;

const consent = createConsentManager({
  purposes: { analytics: { version: '2026-10' }, ads: {} },
});
type Id = 'analytics' | 'ads';

// P inferred from the manager.
const storage = connectStorage(consent);
export type Inference = Expect<Equal<typeof storage, ConsentStorage<Id>>>;

// The decision actions take the same choices as the manager.
export type SameChoices = Expect<Equal<Parameters<typeof storage.decide>[0], ConsentChoices<Id>>>;

// @ts-expect-error unknown id in decide
storage.decide({ typo: 'granted' });

// @ts-expect-error unknown storage kind
connectStorage(consent, { storage: 'sessionStorage' });

// @ts-expect-error unknown option
connectStorage(consent, { crossTabSync: false });

// The built-in adapters and any object with read, write and remove are storages.
export type BuiltInAdapters = Expect<
  Assignable<ReturnType<typeof localStorageAdapter | typeof cookieAdapter>, StorageAdapter>
>;
const custom = {
  read: (): string | null => null,
  write: (): void => undefined,
  remove: (): void => undefined,
};
export const customOptions: StorageOptions = { storage: custom, key: 'consent', crossTab: false };

// @ts-expect-error cookieAdapter requires maxAge
cookieAdapter({ key: 'lgpder' });

// ConsentStorage<P> is assignable to ConsentStorage, as the layers that take actions expect.
export type AssignableToGeneral = Expect<Assignable<ConsentStorage<Id>, ConsentStorage>>;

// isPersisted is a boolean predicate.
export type IsPersisted = Expect<Equal<ReturnType<typeof storage.isPersisted>, boolean>>;
