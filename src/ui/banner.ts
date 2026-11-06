/** The banner: a non-modal region with the three decisions, all with the same emphasis. */

import { button, h } from './dom.ts';
import { BANNER, createHost, type Host } from './elements.ts';
import type { Settings } from './options.ts';

/** What the buttons of the banner do. */
export interface BannerHandlers {
  readonly acceptAll: () => void;
  readonly rejectAll: () => void;
  readonly customize: () => void;
}

/**
 * Creates the banner. It lists the purposes reached by "Aceitar todas", so the data subject knows
 * what each button decides.
 *
 * @param ids - Purposes without `individualGrant`, in configuration order.
 */
export function createBanner(
  { texts, title }: Settings,
  ids: readonly string[],
  handlers: BannerHandlers,
): Host {
  const host = createHost(BANNER, texts.lang);
  const { banner } = texts;
  host.shadowRoot.append(
    h(
      'div',
      {
        part: 'banner',
        role: 'region',
        'aria-labelledby': 'title',
        'aria-describedby': 'description',
      },
      h('h2', { part: 'title', id: 'title' }, banner.title),
      h('p', { part: 'description', id: 'description' }, banner.description),
      ids.length > 0 &&
        h(
          'ul',
          { part: 'purposes', role: 'list' },
          ...ids.map((id) => h('li', { part: 'purpose' }, title(id))),
        ),
      // Same part, same style and this order for the three: none is nudged (ANPD guidance).
      h(
        'div',
        { part: 'actions' },
        button('button', banner.acceptAll, handlers.acceptAll),
        button('button', banner.rejectAll, handlers.rejectAll),
        button('button', banner.customize, handlers.customize),
      ),
    ),
  );
  return host;
}
