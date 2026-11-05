/**
 * Type tests of the public API of lgpder/init, checked by `tsc` and never run. Each `Expect`
 * requires `true`, and each `@ts-expect-error` requires the compile error described on the same
 * line.
 */
import type { ConsentChange, ConsentManager } from 'lgpder';
import type { EvidenceOptions } from 'lgpder/evidence';
import type { GooglePurposeOptions, Integration as GoogleIntegration } from 'lgpder/google';
import type { ConsentApp, InitOptions, InitPurpose } from 'lgpder/init';
import type {
  ConsentScripts,
  Integration as ScriptsIntegration,
  RevokeEvent,
  ScriptsOptions,
} from 'lgpder/scripts';
import type { StorageOptions } from 'lgpder/storage';
import type { ConsentUi, UiOptions, UiTextsOverride } from 'lgpder/ui';

import { init } from '../../src/init/index.ts';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- T is the very mechanism of the exact type comparison */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;

type Id = 'analytics' | 'ads';

// The built-in integrations are the same for the scripts layer and the google layer (D41).
export type SameIntegrations = Expect<Equal<ScriptsIntegration, GoogleIntegration>>;
export type PurposeIntegrations = Expect<
  Equal<InitPurpose['integrations'], GooglePurposeOptions['integrations']>
>;

// P and C inferred from the purposes; the functions of the app are the ones of the layers.
const app = init({
  purposes: {
    analytics: {
      category: 'statistics',
      title: 'Estatísticas',
      integrations: ['google-analytics'],
    },
    ads: { category: 'marketing', consentMode: ['ad_storage'], cookies: ['my_ads_*'] },
  },
  onRevoke: ({ purposes }) => purposes.length,
  onDecision: ({ changed }) => changed.length,
});
export type Inference = Expect<Equal<typeof app, ConsentApp<Id, 'statistics' | 'marketing'>>>;
export type Manager = Expect<Equal<ConsentApp<Id, 'x'>['manager'], ConsentManager<Id, 'x'>>>;
export type OpenPreferences = Expect<
  Equal<ConsentApp<Id>['openPreferences'], ConsentUi<Id>['openPreferences']>
>;
export type OnGranted = Expect<Equal<ConsentApp<Id>['onGranted'], ConsentScripts<Id>['onGranted']>>;
export type Scan = Expect<Equal<ConsentApp<Id>['scan'], ConsentScripts<Id>['scan']>>;

// Without categories, C is never.
export const plain = init({ purposes: { chat: { title: 'Chat' } } });
export type PlainInference = Expect<Equal<typeof plain, ConsentApp<'chat', never>>>;

// The options are the ones of the layers.
export type Storage = Expect<Equal<InitOptions['storage'], StorageOptions['storage']>>;
export type Revocation = Expect<
  Equal<InitOptions<Id>['revocation'], ScriptsOptions<Id>['revocation']>
>;
export type OnRevoke = Expect<
  Equal<NonNullable<InitOptions<Id>['onRevoke']>, (event: RevokeEvent<Id>) => void>
>;
export type OnDecision = Expect<
  Equal<NonNullable<InitOptions<Id>['onDecision']>, (change: ConsentChange<Id>) => void>
>;
export type Endpoint = Expect<Equal<InitOptions<Id>['endpoint'], EvidenceOptions<Id>['endpoint']>>;
export type Texts = Expect<Equal<InitOptions<Id>['texts'], UiOptions<Id>['texts']>>;
export type Necessary = Expect<Equal<InitOptions['necessary'], UiTextsOverride['necessary']>>;

app.decide({ analytics: 'granted', ads: 'denied' });
app.openPreferences(['ads']);
export const cancel: () => void = app.onGranted('analytics', () => () => undefined);

// @ts-expect-error unknown purpose in decide
app.decide({ typo: 'granted' });

// @ts-expect-error unknown purpose in openPreferences
app.openPreferences(['typo']);

// @ts-expect-error unknown purpose in onGranted
app.onGranted('typo', () => undefined);

// @ts-expect-error record is not an option of init: adopt it
init({ purposes: { chat: {} }, record: null });

// @ts-expect-error the key of the storage is not an option of init
init({ purposes: { chat: {} }, key: 'consent' });

// @ts-expect-error unknown storage
init({ purposes: { chat: {} }, storage: 'sessionStorage' });

// @ts-expect-error unknown revocation mode
init({ purposes: { chat: {} }, revocation: 'never' });

// @ts-expect-error unknown integration
init({ purposes: { chat: { integrations: ['meta-pixel'] } } });

// @ts-expect-error unknown consent type
init({ purposes: { chat: { consentMode: ['ads_storage'] } } });

// @ts-expect-error unknown key of a purpose
init({ purposes: { chat: { titel: 'Chat' } } });

// @ts-expect-error unknown group of texts
init({ purposes: { chat: {} }, necessary: { label: 'Essenciais' } });
