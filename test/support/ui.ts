/**
 * Pages for the tests of the ui layer: managers with the components mounted, and readers of what
 * the components show, found through their open shadow roots. Importing this module installs the
 * DOM. Every ui mounted here must be destroyed with {@link closeUis} in `afterEach`.
 */
import type { ConsentChoices, ConsentManager } from 'lgpder';
import type { ConsentUi, UiActions, UiOptions } from 'lgpder/ui';

import { mountUi } from '../../src/ui/index.ts';
import { testDom } from './dom.ts';
import { setup, type FixtureSetupOptions, type PurposeId, type Setup } from './setup.ts';

/** Tag name of a component. */
export type Tag = 'lgpder-banner' | 'lgpder-preferences' | 'lgpder-button' | 'lgpder-placeholder';

/** Manager, its recorder and the components mounted on it. */
export interface Screen<P extends string = PurposeId> extends Setup<P> {
  readonly ui: ConsentUi<P>;
}

const destroys: (() => void)[] = [];

/** Creates the manager of the default fixture and mounts the components with `options`. */
export function openUi(options?: UiOptions<PurposeId>, fixture?: FixtureSetupOptions): Screen {
  return mountOn(setup(fixture), options);
}

/** Mounts the components, with `options`, on a manager already set up. */
export function mountOn<P extends string>(tab: Setup<P>, options?: UiOptions<P>): Screen<P> {
  const ui = mountUi(tab.consent, options);
  destroys.push(ui.destroy);
  return { ...tab, ui };
}

/** Destroys every ui mounted since the last call. */
export function closeUis(): void {
  for (const destroy of destroys.splice(0)) destroy();
}

/** The component `tag` on the page; fails the test when there is none. */
export function host(tag: Tag): HTMLElement {
  const element = document.querySelector<HTMLElement>(tag);
  if (element === null) throw new Error(`No ${tag} on the page.`);
  return element;
}

/** The shadow root of the component `tag`. */
export function shadow(tag: Tag): ShadowRoot {
  const root = host(tag).shadowRoot;
  if (root === null) throw new Error(`${tag} has no open shadow root.`);
  return root;
}

/** Whether the component `tag` is on the page and not hidden. */
export function isShown(tag: Tag): boolean {
  const element = document.querySelector<HTMLElement>(tag);
  return element !== null && !element.hidden;
}

/** The elements of the component `tag` whose `part` lists `part`. */
export function parts(tag: Tag, part: string): HTMLElement[] {
  return [...shadow(tag).querySelectorAll<HTMLElement>(`[part~="${part}"]`)];
}

/** The text of each element of the component `tag` whose `part` lists `part`. */
export function textsOf(tag: Tag, part: string): string[] {
  return parts(tag, part).map((element) => element.textContent);
}

/** The buttons of the component `tag`, in document order. */
export function buttonsOf(tag: Tag): HTMLButtonElement[] {
  return [...shadow(tag).querySelectorAll('button')];
}

/** The button of the component `tag` with the text or the accessible name `name`. */
export function buttonNamed(tag: Tag, name: string): HTMLButtonElement {
  const found = buttonsOf(tag).find(
    (button) => button.textContent === name || button.getAttribute('aria-label') === name,
  );
  if (found === undefined) throw new Error(`No button "${name}" in ${tag}.`);
  return found;
}

/** Clicks the button of the component `tag` named `name`. */
export function clickButton(tag: Tag, name: string): void {
  buttonNamed(tag, name).click();
}

/** The switch of the preferences center labelled by the purpose title `title`. */
export function switchOf(title: string): HTMLButtonElement {
  const label = parts('lgpder-preferences', 'purpose-title').find(
    (element) => element.textContent === title,
  );
  if (label === undefined) throw new Error(`No purpose "${title}" in the preferences.`);
  const toggle = shadow('lgpder-preferences').querySelector<HTMLButtonElement>(
    `[role="switch"][aria-labelledby="${label.id}"]`,
  );
  if (toggle === null) throw new Error(`No switch labelled by "${title}".`);
  return toggle;
}

/** Whether the switch of the purpose titled `title` is on. */
export function isOn(title: string): boolean {
  return switchOf(title).getAttribute('aria-checked') === 'true';
}

/** The titles of the purposes in the preferences center, in document order. */
export function purposeTitles(): string[] {
  return textsOf('lgpder-preferences', 'purpose-title');
}

/** Each category section of the preferences center: its title and the titles of its purposes. */
export function categories(): { readonly title: string; readonly purposes: string[] }[] {
  return parts('lgpder-preferences', 'category').map((section) => ({
    title: section.querySelector('h3')?.textContent ?? '',
    purposes: [...section.querySelectorAll('[part~="purpose-title"]')].map(
      (element) => element.textContent,
    ),
  }));
}

/** The focused element, looked up through the open shadow roots. */
export function focused(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Dispatches a `keydown` of `key` on the focused element, as the keyboard would. */
export function press(key: string, { shiftKey = false } = {}): KeyboardEvent {
  const event = new testDom.window.KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  (focused() ?? document.body).dispatchEvent(event);
  return event;
}

/** Decision actions that record each call before calling the manager. */
export interface RecordingActions<P extends string> {
  readonly actions: UiActions<P>;
  /** Each call, as `[name]` or `['decide', choices]`, in call order. */
  readonly calls: (readonly [string, ConsentChoices<P>?])[];
}

export function recordingActions<P extends string>(
  consent: ConsentManager<P>,
): RecordingActions<P> {
  const calls: (readonly [string, ConsentChoices<P>?])[] = [];
  return {
    calls,
    actions: {
      decide: (choices) => {
        calls.push(['decide', choices]);
        consent.decide(choices);
      },
      grantAll: () => {
        calls.push(['grantAll']);
        consent.grantAll();
      },
      denyAll: () => {
        calls.push(['denyAll']);
        consent.denyAll();
      },
    },
  };
}

/** Decision actions that always throw `error`, as a manager with a faulty clock would. */
export function failingActions(error: Error): UiActions {
  const fail = (): never => {
    throw error;
  };
  return { decide: fail, grantAll: fail, denyAll: fail };
}

/** The style sheet of the shadow root of the component `tag`. */
export function styleSheetOf(tag: Tag): string {
  return shadow(tag).querySelector('style')?.textContent ?? '';
}
