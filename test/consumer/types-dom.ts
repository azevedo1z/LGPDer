/**
 * Type tests compiled against the published `.d.ts` files of the subpaths whose types use the DOM
 * (`lib: ["es2022", "dom"]`). They repeat a representative subset of `test/scripts/types.check.ts`,
 * `test/ui/types.check.ts` and `test/init/types.check.ts`.
 */
import { createConsentManager } from 'lgpder';
import { init, type ConsentApp, type InitOptions } from 'lgpder/init';
import {
  connectScripts,
  type ConsentScripts,
  type PlaceholderRenderer,
  type RevokeEvent,
} from 'lgpder/scripts';
import {
  createPlaceholder,
  mountUi,
  ptBR,
  type ConsentUi,
  type UiOptions,
  type UiTexts,
} from 'lgpder/ui';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- T is the very mechanism of the exact type comparison */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;

const consent = createConsentManager({ purposes: { analytics: {}, ads: {} } });
type Id = 'analytics' | 'ads';

const ownPlaceholder: PlaceholderRenderer<Id> = ({ element, purposes, load }) => {
  const button = document.createElement('button');
  button.textContent = `${purposes.join(', ')} (${element.title})`;
  button.addEventListener('click', load);
  return button;
};

// lgpder/ui: the renderer of createPlaceholder is the one of lgpder/scripts.
const renderPlaceholder: PlaceholderRenderer<Id> = createPlaceholder(consent, {
  purposes: { ads: { title: 'Publicidade' } },
});
export const renderers: readonly PlaceholderRenderer<Id>[] = [ownPlaceholder, renderPlaceholder];

// lgpder/scripts: P inferred from the manager.
const scripts = connectScripts(consent, {
  purposes: { analytics: { integrations: ['google-analytics'], cookies: ['my_*'] } },
  revocation: 'manual',
  onRevoke: (event: RevokeEvent<Id>) => event.requiresReload,
  renderPlaceholder,
  canReload: () => true,
});
export type ScriptsInference = Expect<Equal<typeof scripts, ConsentScripts<Id>>>;

scripts.scan(document.body);
export const cancel: () => void = scripts.onGranted('ads', () => () => undefined);
export const reloads: boolean = scripts.wouldReload({ analytics: 'denied' });

// @ts-expect-error unknown purpose in onGranted
scripts.onGranted('typo', () => undefined);

// lgpder/ui: P inferred from the manager, wouldReload of scripts injected.
const options: UiOptions<Id> = {
  actions: consent,
  wouldReload: scripts.wouldReload,
  texts: { banner: { title: 'Cookies' } },
  floatingButton: false,
};
const ui = mountUi(consent, options);
export type UiInference = Expect<Equal<typeof ui, ConsentUi<Id>>>;
export const texts: UiTexts = ptBR;
ui.openPreferences(['analytics']);

// @ts-expect-error unknown purpose in openPreferences
ui.openPreferences(['typo']);

// lgpder/init: P and C inferred from the purposes, which take the keys of every layer.
const initOptions = {
  purposes: {
    analytics: {
      category: 'statistics',
      title: 'Estatísticas',
      integrations: ['google-analytics'],
      cookies: ['my_*'],
    },
    ads: { consentMode: ['ad_storage'] },
  },
  storage: 'cookie',
  revocation: 'manual',
  onRevoke: (event: RevokeEvent<Id>) => event.requiresReload,
  necessary: { title: 'Essenciais' },
  floatingButton: false,
} as const satisfies InitOptions<Id, 'statistics'>;
const app = init(initOptions);
export type InitInference = Expect<Equal<typeof app, ConsentApp<Id, 'statistics'>>>;
app.decide({ ads: 'granted' });
app.scan(document.body);

// @ts-expect-error record is not an option of init
init({ purposes: { ads: {} }, record: null });
