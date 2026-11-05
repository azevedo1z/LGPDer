/**
 * Type tests compiled against the published `.d.ts` files of the subpaths whose types use the DOM
 * (`lib: ["es2022", "dom"]`). They repeat a representative subset of `test/scripts/types.check.ts`.
 */
import { createConsentManager } from 'lgpder';
import {
  connectScripts,
  type ConsentScripts,
  type PlaceholderRenderer,
  type RevokeEvent,
} from 'lgpder/scripts';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- T is the very mechanism of the exact type comparison */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
type Expect<T extends true> = T;

const consent = createConsentManager({ purposes: { analytics: {}, ads: {} } });
type Id = 'analytics' | 'ads';

const renderPlaceholder: PlaceholderRenderer<Id> = ({ element, purposes, load }) => {
  const button = document.createElement('button');
  button.textContent = `${purposes.join(', ')} (${element.title})`;
  button.addEventListener('click', load);
  return button;
};

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
