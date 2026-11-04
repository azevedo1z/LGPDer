/**
 * Testes de tipos compilados contra o `dist/index.d.ts` publicado, com TypeScript 5.6.3, 6.0.3 e
 * 7.0.2. Repetem um subconjunto representativo de `test/types.check.ts`.
 */
import { createConsentManager, type ConsentManager, type ConsentSnapshot } from 'lgpder';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- o T é o próprio mecanismo da comparação exata de tipos */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;
type Assignable<From, To> = [From] extends [To] ? true : false;

/** Cópia local da assinatura de `useSyncExternalStore` do React. */
declare function useSyncExternalStore<Snapshot>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot?: () => Snapshot,
): Snapshot;

// P e C inferidos do objeto escrito na chamada.
const consent = createConsentManager({
  purposes: {
    analytics: { version: '2026-10', category: 'statistics' },
    health: { version: '1', category: 'health', individualGrant: true },
  },
});
type Id = 'analytics' | 'health';
export type Inference = Expect<Equal<typeof consent, ConsentManager<Id, 'statistics' | 'health'>>>;

// @ts-expect-error id desconhecido em decide
consent.decide({ typo: 'granted' });

// ConsentManager<P, C> é atribuível a ConsentManager.
export type AssignableToGeneral = Expect<Assignable<typeof consent, ConsentManager>>;

// Compatibilidade com useSyncExternalStore e tipo do snapshot devolvido.
export const state = useSyncExternalStore(
  consent.subscribe,
  consent.getSnapshot,
  consent.getServerSnapshot,
);
export type SyncExternalStoreSnapshot = Expect<Equal<typeof state, ConsentSnapshot<Id>>>;
