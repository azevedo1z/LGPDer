/**
 * Type tests of the public API of lgpder/evidence, checked by `tsc` and never run. Each `Expect`
 * requires `true`, and each `@ts-expect-error` requires the compile error described on the same
 * line.
 */
import type { ConsentChange, ConsentRecord } from 'lgpder';
import type { ConsentEvidence, EvidenceOptions, EvidencePayload } from 'lgpder/evidence';

import { createConsentManager } from '../../src/index.ts';
import { connectEvidence } from '../../src/evidence/index.ts';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- T is the very mechanism of the exact type comparison */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;

const consent = createConsentManager({
  purposes: { analytics: { version: '2026-10' }, ads: {} },
});
type Id = 'analytics' | 'ads';

// The handle, with destroy only; the hook receives the changes of the manager.
const changedPurposes: Id[] = [];
export const evidence = connectEvidence(consent, {
  endpoint: '/api/consent',
  onDecision: ({ changed }) => {
    changedPurposes.push(...changed);
  },
  onError: () => undefined,
});
export type Handle = Expect<Equal<typeof evidence, ConsentEvidence>>;
export type Destroy = Expect<Equal<ConsentEvidence['destroy'], () => void>>;

// The functions of the application.
export type DecisionHook = Expect<
  Equal<NonNullable<EvidenceOptions<Id>['onDecision']>, (change: ConsentChange<Id>) => void>
>;
export type ErrorHook = Expect<
  Equal<NonNullable<EvidenceOptions<Id>['onError']>, (error: unknown) => void>
>;

// The payload sent to the endpoint.
export type Payload = Expect<
  Equal<
    EvidencePayload<Id>,
    {
      readonly record: ConsentRecord<Id>;
      readonly changed: readonly Id[];
      readonly versions: { readonly analytics?: string; readonly ads?: string };
    }
  >
>;

// Every option is optional in the type; the runtime requires endpoint or onDecision.
export const options: EvidenceOptions<Id> = {};
export const onlyHook: EvidenceOptions<Id> = { onDecision: () => undefined };

// @ts-expect-error unknown option
connectEvidence(consent, { endpoint: '/api/consent', retry: true });

// @ts-expect-error the endpoint is a string
connectEvidence(consent, { endpoint: new URL('https://www.example.com.br/') });

// @ts-expect-error the hook receives the change of the manager, not of another purpose union
connectEvidence(consent, { onDecision: (change: ConsentChange<'typo'>) => change });

// @ts-expect-error options are required
connectEvidence(consent);
