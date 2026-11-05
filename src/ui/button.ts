/** The floating button that reopens the preferences center, so revoking stays one click away. */

import { button } from './dom.ts';
import { BUTTON, createHost, type Host } from './elements.ts';
import type { UiTexts } from './texts.ts';

const SVG = 'http://www.w3.org/2000/svg';

/** Outline of a cookie with three bites, drawn in the color of the text. */
const ICON =
  'M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5Zm-3.5 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-5 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z';

/** The floating button. */
export interface ButtonView {
  readonly host: Host;
  readonly focus: () => void;
}

/** Creates the floating button, whose accessible name is `texts.button.label`. */
export function createButton(texts: UiTexts, open: () => void): ButtonView {
  const host = createHost(BUTTON, texts.lang);
  const control = button('button', '', open, { 'aria-label': texts.button.label });
  const icon = document.createElementNS(SVG, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', ICON);
  icon.append(path);
  control.append(icon);
  host.shadowRoot.append(control);
  return {
    host,
    focus: () => {
      control.focus();
    },
  };
}
