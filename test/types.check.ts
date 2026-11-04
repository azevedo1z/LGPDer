/**
 * Testes de tipos da API pública, verificados pelo `tsc` e nunca executados. Cada `Expect` exige
 * `true`, e cada `@ts-expect-error` exige o erro de compilação descrito na mesma linha.
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
    ads: { category: 'marketing' },
    health: { version: '1', individualGrant: true },
  },
});
type Id = 'analytics' | 'ads' | 'health';
export type InlineInference = Expect<
  Equal<typeof consent, ConsentManager<Id, 'statistics' | 'marketing'>>
>;

// C é never quando nenhuma finalidade declara categoria.
export const withoutCategories = createConsentManager({
  purposes: { a: {}, b: { version: '1' } },
});
export type NeverCategory = Expect<
  Equal<typeof withoutCategories, ConsentManager<'a' | 'b', never>>
>;

// Configuração em variável sem as const: P literal e C string, o padrão de ConsentManager.
const variablePurposes = { analytics: { category: 'statistics' }, ads: {} };
export const fromVariable = createConsentManager({ purposes: variablePurposes });
export type VariableInference = Expect<
  Equal<typeof fromVariable, ConsentManager<'analytics' | 'ads'>>
>;

// as const satisfies Record<string, PurposeConfig>: P e C literais.
const CONSTANT_PURPOSES = {
  analytics: { version: '2026-10', category: 'statistics' },
  ads: { category: 'marketing' },
} as const satisfies Record<string, PurposeConfig>;
export const fromConstant = createConsentManager({ purposes: CONSTANT_PURPOSES });
export type ConstantInference = Expect<
  Equal<typeof fromConstant, ConsentManager<'analytics' | 'ads', 'statistics' | 'marketing'>>
>;

// Configuração dinâmica, anotada como Record<string, PurposeConfig>, produz
// ConsentManager<string, string>, isto é, ConsentManager com os parâmetros padrão.
const dynamicPurposes: Record<string, PurposeConfig> = { ads: {} };
export const dynamic = createConsentManager({ purposes: dynamicPurposes });
export type DynamicConfiguration = Expect<Equal<typeof dynamic, ConsentManager>>;

// A proteção contra erro de digitação na categoria fica com a aplicação, por satisfies.
type Category = 'statistics' | 'marketing';
export const TYPO_PROTECTED = {
  analytics: { version: '2026-10', category: 'statistics' },
  // @ts-expect-error categoria fora da união Category
  ads: { category: 'marketng' },
} as const satisfies Record<string, PurposeConfig<Category>>;

// Erros de compilação esperados na configuração.
createConsentManager({
  // @ts-expect-error propriedade desconhecida na finalidade
  purposes: { ads: { verison: '1' } },
});
createConsentManager({
  purposes: { ads: {} },
  // @ts-expect-error opção desconhecida
  storage: {},
});
createConsentManager({
  // @ts-expect-error individualGrant não booleano
  purposes: { ads: { individualGrant: 'yes' } },
});
createConsentManager({
  purposes: { ads: {} },
  // @ts-expect-error relógio que devolve texto, e não número
  now: () => '1',
});

// Erros de compilação esperados no uso do gerenciador.
// @ts-expect-error id desconhecido em decide
consent.decide({ typo: 'granted' });
// @ts-expect-error id desconhecido em decide, mesmo com valor undefined
consent.decide({ typo: undefined });
// @ts-expect-error valor booleano em decide
consent.decide({ ads: true });
// @ts-expect-error valor 'pending' em decide
consent.decide({ ads: 'pending' });
// @ts-expect-error argumento em grantAll
consent.grantAll({ health: 'granted' });
// @ts-expect-error argumento em denyAll
consent.denyAll(true);

// Atribuição a qualquer campo público é erro de compilação.
const snapshot = consent.getSnapshot();
const server = consent.getServerSnapshot();
declare const decision: ConsentDecision;
// @ts-expect-error atribuição ao status do snapshot
snapshot.status = server.status;
// @ts-expect-error atribuição a campo de status do snapshot
snapshot.status.ads = 'granted';
// @ts-expect-error atribuição ao outdated do snapshot
snapshot.outdated = server.outdated;
// @ts-expect-error atribuição a campo de outdated do snapshot
snapshot.outdated.analytics = true;
// @ts-expect-error atribuição ao registro do snapshot
snapshot.record = server.record;
// @ts-expect-error atribuição ao format do registro
snapshot.record.format = 1;
// @ts-expect-error atribuição às decisões do registro
snapshot.record.decisions = server.record.decisions;
// @ts-expect-error atribuição a uma entrada das decisões do registro
snapshot.record.decisions.ads = decision;
// @ts-expect-error atribuição ao status de uma decisão
decision.status = 'denied';
// @ts-expect-error atribuição à versão de uma decisão
decision.version = '2';
// @ts-expect-error atribuição ao instante de uma decisão
decision.decidedAt = 0;
// @ts-expect-error atribuição à configuração de uma finalidade
consent.purposes.ads = {};

// Todas as entradas aceitam undefined explícito.
const explicitUndefined = createConsentManager({
  purposes: { ads: { version: undefined, category: undefined, individualGrant: undefined } },
  record: undefined,
  now: undefined,
});
explicitUndefined.decide({ ads: undefined });

// ConsentManager<P, C> é atribuível a ConsentManager, para extensões que aceitam qualquer gerenciador.
export type AssignableToGeneral = Expect<
  Assignable<ConsentManager<'a' | 'b', 'x'>, ConsentManager>
>;

// Compatibilidade com useSyncExternalStore, com getServerSnapshot no terceiro argumento, e tipo
// do snapshot devolvido.
export const state = useSyncExternalStore(
  consent.subscribe,
  consent.getSnapshot,
  consent.getServerSnapshot,
);
export type SyncExternalStoreSnapshot = Expect<Equal<typeof state, ConsentSnapshot<Id>>>;

// Tipos derivados do gerenciador.
type ListenerArgument = Parameters<Parameters<typeof consent.subscribe>[0]>[0];
export type ListenerReceivesChange = Expect<Equal<ListenerArgument, ConsentChange<Id>>>;
export type PurposeKeys = Expect<Equal<keyof typeof consent.purposes, Id>>;
export type DecidedValues = Expect<Equal<DecidedStatus, 'granted' | 'denied'>>;
export type RestoreAcceptsAnyValue = Expect<Equal<Parameters<typeof consent.restore>[0], unknown>>;

// Membros fixados com tipos literais: comparar um tipo público com ele mesmo não detectaria uma
// mudança na sua declaração.
export type ChangedIds = Expect<Equal<ConsentChange<Id>['changed'], readonly Id[]>>;
export type ChangeSources = Expect<Equal<ChangeSource, 'decision' | 'restore'>>;
export type ChangeSourceField = Expect<Equal<ConsentChange['source'], ChangeSource>>;
export type DecisionStatus = Expect<Equal<ConsentDecision['status'], 'granted' | 'denied'>>;
export type RecordFormat = Expect<Equal<(typeof snapshot)['record']['format'], 1>>;
export type ServerSnapshotIds = Expect<
  Equal<ReturnType<typeof consent.getServerSnapshot>, ConsentSnapshot<Id>>
>;

// As funções são propriedades sem this e funcionam desestruturadas.
const { decide } = consent;
decide({ ads: 'granted' });
