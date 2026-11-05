/**
 * Type tests of the public API of lgpder/ui, checked by `tsc` and never run. Each `Expect`
 * requires `true`, and each `@ts-expect-error` requires the compile error described on the same
 * line.
 */
import type { ConsentChoices } from 'lgpder';
import type { PlaceholderRenderer } from 'lgpder/scripts';
import type {
  ConsentUi,
  PlaceholderOptions,
  UiActions,
  UiOptions,
  UiTexts,
  UiTextsOverride,
} from 'lgpder/ui';

import { createConsentManager } from '../../src/index.ts';
import { connectScripts } from '../../src/scripts/index.ts';
import { connectStorage } from '../../src/storage/index.ts';
import { createPlaceholder, mountUi, ptBR } from '../../src/ui/index.ts';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- T is the very mechanism of the exact type comparison */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;
type Assignable<From, To> = [From] extends [To] ? true : false;

const consent = createConsentManager({
  purposes: { analytics: { category: 'statistics' }, ads: {} },
});
type Id = 'analytics' | 'ads';

// P inferred from the manager; the storage actions and wouldReload of scripts fit as they are.
const storage = connectStorage(consent);
const scripts = connectScripts(consent);
const ui = mountUi(consent, {
  actions: storage,
  wouldReload: scripts.wouldReload,
  purposes: { analytics: { title: 'Estatísticas', description: 'Google Analytics.' } },
  texts: { banner: { title: 'Cookies' }, categories: { statistics: 'Estatísticas' } },
  floatingButton: true,
});
export type Inference = Expect<Equal<typeof ui, ConsentUi<Id>>>;

// The manager itself is a set of actions.
export type ManagerActions = Expect<Assignable<typeof consent, UiActions<Id>>>;

// openPreferences takes nothing, or a list of the purposes of the manager.
ui.openPreferences();
ui.openPreferences(['ads']);
// @ts-expect-error unknown purpose in openPreferences
ui.openPreferences(['typo']);

// @ts-expect-error unknown purpose in the texts of the purposes
mountUi(consent, { purposes: { typo: { title: 'Typo' } } });

// @ts-expect-error unknown option
mountUi(consent, { floating: false });

// @ts-expect-error unknown field of a group of texts
mountUi(consent, { texts: { banner: { accept: 'Ok' } } });

// wouldReload takes the choices of decide.
export type ReloadChoices = Expect<
  Equal<Parameters<NonNullable<UiOptions<Id>['wouldReload']>>[0], ConsentChoices<Id>>
>;

// createPlaceholder returns the renderer of the scripts layer, for the same purposes.
const renderPlaceholder = createPlaceholder(consent, { actions: storage });
export type Renderer = Expect<Equal<typeof renderPlaceholder, PlaceholderRenderer<Id>>>;
connectScripts(consent, { renderPlaceholder });

// @ts-expect-error an option of mountUi only
createPlaceholder(consent, { floatingButton: false });

// The options of mountUi extend those of createPlaceholder.
export type Extends = Expect<Assignable<UiOptions<Id>, PlaceholderOptions<Id>>>;

// ptBR is a complete set of texts; an override is partial, group by group.
export type Complete = Expect<Equal<typeof ptBR, UiTexts>>;
export const override: UiTextsOverride = { lang: 'pt-PT', necessary: { title: 'Essenciais' } };
export const complete: UiTextsOverride = ptBR;
