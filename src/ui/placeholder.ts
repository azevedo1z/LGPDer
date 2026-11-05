/** The placeholder shown by the scripts layer before each blocked iframe. */

import type { ConsentManager } from '../index.ts';
import type { PlaceholderRenderer } from '../scripts/index.ts';
import { button, h } from './dom.ts';
import { createHost, defineElements, PLACEHOLDER } from './elements.ts';
import { callGuarded } from './guard.ts';
import { parsePlaceholderOptions, type PlaceholderOptions } from './options.ts';

/** A size attribute of the iframe as a CSS length: a bare number is in pixels. */
function cssLength(value: string): string {
  return /^\d+$/.test(value) ? `${value}px` : value;
}

/**
 * Creates the renderer of the placeholders, to pass as `renderPlaceholder` to `connectScripts`.
 * Each placeholder names the purposes of its iframe and has two buttons: "Carregar" loads only
 * this content, on this page, without recording a decision; "Permitir sempre" grants every
 * purpose of the iframe through `actions.decide`. The placeholder takes the `width` and `height`
 * of the iframe.
 *
 * Outside the browser (no `document`), the options are validated and the renderer is never
 * called.
 *
 * @typeParam P - Union of the purpose ids.
 * @param consent - Manager whose purposes the iframes name.
 * @param options - Decision actions and texts.
 * @returns Renderer of the placeholders.
 * @throws {TypeError} Invalid options.
 * @throws {RangeError} `options.purposes` has a purpose that is not configured.
 * @throws {Error} A custom element of the components is defined by another copy of the library.
 *
 * @example
 * ```ts
 * const consent = createConsentManager({ purposes: { videos: {} } });
 * const storage = connectStorage(consent);
 * connectScripts(consent, {
 *   renderPlaceholder: createPlaceholder(consent, {
 *     actions: storage,
 *     purposes: { videos: { title: 'Vídeos do YouTube' } },
 *   }),
 * });
 * ```
 */
export function createPlaceholder<P extends string>(
  consent: ConsentManager<P>,
  options?: PlaceholderOptions<P>,
): PlaceholderRenderer<P>;
export function createPlaceholder(consent: ConsentManager, options?: unknown): PlaceholderRenderer {
  const { actions, texts, title } = parsePlaceholderOptions(consent, options);
  const { placeholder } = texts;
  if (typeof document !== 'undefined') defineElements();

  return ({ element, purposes, load }) => {
    const host = createHost(PLACEHOLDER, texts.lang);
    for (const name of ['width', 'height']) {
      const size = element.getAttribute(name);
      if (size !== null) host.style.setProperty(name, cssLength(size));
    }
    const names = purposes.map(title).join(', ');
    const allowAlways = (): void => {
      callGuarded(() => {
        actions.decide(Object.fromEntries(purposes.map((id) => [id, 'granted'])));
      });
    };
    host.shadowRoot.append(
      h(
        'div',
        { part: 'placeholder' },
        h(
          'p',
          { part: 'description', id: 'description' },
          placeholder.description.replaceAll('{purposes}', () => names),
        ),
        h(
          'div',
          { part: 'actions' },
          button('button', placeholder.load, load, { 'aria-describedby': 'description' }),
          button('button', placeholder.allowAlways, allowAlways, {
            'aria-describedby': 'description',
          }),
        ),
      ),
    );
    return host;
  };
}
