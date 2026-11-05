/**
 * Type tests of the public API of lgpder/scripts, checked by `tsc` and never run. Each `Expect`
 * requires `true`, and each `@ts-expect-error` requires the compile error described on the same
 * line.
 */
import type { ConsentChoices } from 'lgpder';
import type {
  ConsentScripts,
  Integration,
  PlaceholderContext,
  PlaceholderRenderer,
  RevokeEvent,
  ScriptsOptions,
} from 'lgpder/scripts';

import { createConsentManager } from '../../src/index.ts';
import { connectScripts } from '../../src/scripts/index.ts';

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

// P inferred from the manager, also in the event of onRevoke.
const events: RevokeEvent<Id>[] = [];
const scripts = connectScripts(consent, {
  purposes: { analytics: { integrations: ['google-analytics'], cookies: ['my_*'] } },
  revocation: 'manual',
  onRevoke: (event) => {
    events.push(event);
  },
  canReload: () => true,
  debug: true,
});
export type Inference = Expect<Equal<typeof scripts, ConsentScripts<Id>>>;

// The built-in integrations.
export type Integrations = Expect<Equal<Integration, 'google-analytics' | 'google-ads'>>;

// @ts-expect-error unknown integration
connectScripts(consent, { purposes: { ads: { integrations: ['meta-pixel'] } } });

// @ts-expect-error unknown purpose in the purposes option
connectScripts(consent, { purposes: { typo: {} } });

// @ts-expect-error unknown revocation mode
connectScripts(consent, { revocation: 'never' });

// @ts-expect-error unknown option
connectScripts(consent, { revoke: 'manual' });

// onGranted takes the purposes of the manager, and a fn with or without cleanup.
scripts.onGranted('ads', () => undefined);
scripts.onGranted('ads', () => () => undefined);
export type Cancel = Expect<Equal<ReturnType<typeof scripts.onGranted>, () => void>>;

// @ts-expect-error unknown purpose in onGranted
scripts.onGranted('typo', () => undefined);

// wouldReload takes the same choices as decide.
export type SameChoices = Expect<
  Equal<Parameters<typeof scripts.wouldReload>[0], ConsentChoices<Id>>
>;

// @ts-expect-error unknown purpose in wouldReload
scripts.wouldReload({ typo: 'denied' });

// A renderer receives the iframe and the purposes of the manager, and returns an element.
export type RendererContext = Expect<
  Equal<Parameters<PlaceholderRenderer<Id>>[0], PlaceholderContext<Id>>
>;
export type ContextElement = Expect<Equal<PlaceholderContext['element'], HTMLIFrameElement>>;
export const options: ScriptsOptions<Id> = {
  renderPlaceholder: ({ purposes, load }) => {
    const button = document.createElement('button');
    button.textContent = purposes.join(', ');
    button.addEventListener('click', load);
    return button;
  },
};

// The general handle, of any purposes, is assignable to the one of these purposes.
export type GeneralAssignable = Expect<Assignable<ConsentScripts, ConsentScripts<Id>>>;
