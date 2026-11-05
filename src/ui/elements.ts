/**
 * Custom elements of the components, registered on demand: importing the layer defines nothing,
 * so it has no side effect and runs on the server, where `HTMLElement` does not exist.
 */

import { STYLES } from './styles.ts';

export const BANNER = 'lgpder-banner';
export const PREFERENCES = 'lgpder-preferences';
export const BUTTON = 'lgpder-button';
export const PLACEHOLDER = 'lgpder-placeholder';

/** Tag name of a component. */
export type Tag = typeof BANNER | typeof PREFERENCES | typeof BUTTON | typeof PLACEHOLDER;

const TAGS: readonly Tag[] = [BANNER, PREFERENCES, BUTTON, PLACEHOLDER];

/** A component, whose open shadow root holds the style sheet and the content. */
export type Host = HTMLElement & { readonly shadowRoot: ShadowRoot };

/** Classes of this copy of the library, created on the first registration. */
let classes: ReadonlyMap<Tag, CustomElementConstructor> | undefined;

/** One class per tag, since a custom element name takes a constructor of its own. */
function createClasses(): ReadonlyMap<Tag, CustomElementConstructor> {
  return new Map(
    TAGS.map((tag) => [
      tag,
      class extends HTMLElement {
        constructor() {
          super();
          const style = document.createElement('style');
          style.textContent = STYLES;
          this.attachShadow({ mode: 'open' }).append(style);
        }
      },
    ]),
  );
}

/**
 * Defines the custom elements of the components, once; later calls do nothing. Every tag is
 * checked before any is defined, so a failure defines nothing.
 *
 * @throws {Error} A tag is already defined by another class, such as another copy of the library.
 */
export function defineElements(): void {
  classes ??= createClasses();
  for (const [tag, own] of classes) {
    const defined = customElements.get(tag);
    if (defined !== undefined && defined !== own) {
      throw new Error(
        `[lgpder] The custom element "${tag}" is already defined by another copy of lgpder.`,
      );
    }
  }
  for (const [tag, own] of classes) {
    if (customElements.get(tag) === undefined) customElements.define(tag, own);
  }
}

/** Creates a component, in the language of `lang`. Requires {@link defineElements}. */
export function createHost(tag: Tag, lang: string): Host {
  const host = document.createElement(tag) as Host;
  host.lang = lang;
  return host;
}
