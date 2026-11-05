/**
 * Type tests of the public API of lgpder/google, checked by `tsc` and never run. Each `Expect`
 * requires `true`, and each `@ts-expect-error` requires the compile error described on the same
 * line.
 */
import type {
  ConsentGoogle,
  ConsentType,
  GoogleOptions,
  GooglePurposeOptions,
  Integration,
} from 'lgpder/google';
import type { Integration as ScriptsIntegration } from 'lgpder/scripts';

import { createConsentManager } from '../../src/index.ts';
import { connectGoogle, consentDefaultSnippet } from '../../src/google/index.ts';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- T is the very mechanism of the exact type comparison */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;

const consent = createConsentManager({
  purposes: { analytics: { version: '2026-10' }, ads: {} },
});
type Id = 'analytics' | 'ads';

// The handle, with destroy only.
export const google = connectGoogle(consent, {
  purposes: {
    analytics: { integrations: ['google-analytics'] },
    ads: { integrations: ['google-ads'], consentMode: ['ad_storage', 'personalization_storage'] },
  },
  debug: true,
});
export type Handle = Expect<Equal<typeof google, ConsentGoogle>>;
export type Destroy = Expect<Equal<ConsentGoogle['destroy'], () => void>>;

// The built-in integrations are the ones of the scripts layer (D41).
export type Integrations = Expect<Equal<Integration, 'google-analytics' | 'google-ads'>>;
export type SameIntegrations = Expect<Equal<Integration, ScriptsIntegration>>;

// The seven consent types of the Consent Mode v2.
export type ConsentTypes = Expect<
  Equal<
    ConsentType,
    | 'ad_storage'
    | 'ad_user_data'
    | 'ad_personalization'
    | 'analytics_storage'
    | 'functionality_storage'
    | 'personalization_storage'
    | 'security_storage'
  >
>;

// The options of a purpose.
export type PurposeOptions = Expect<
  Equal<
    GooglePurposeOptions,
    {
      readonly integrations?: readonly Integration[] | undefined;
      readonly consentMode?: readonly ConsentType[] | undefined;
    }
  >
>;

// The purposes of the options are the ones of the manager.
export const options: GoogleOptions<Id> = { purposes: { ads: {} } };

// The snippet is a string.
export type Snippet = Expect<Equal<typeof consentDefaultSnippet, string>>;

// @ts-expect-error purposes is required
connectGoogle(consent, {});

// @ts-expect-error unknown purpose in the purposes option
connectGoogle(consent, { purposes: { typo: {} } });

// @ts-expect-error unknown integration
connectGoogle(consent, { purposes: { ads: { integrations: ['meta-pixel'] } } });

// @ts-expect-error unknown consent type
connectGoogle(consent, { purposes: { ads: { consentMode: ['ads_storage'] } } });

// @ts-expect-error unknown option
connectGoogle(consent, { purposes: {}, wait_for_update: 500 });
