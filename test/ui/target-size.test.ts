/**
 * Size of the targets, checked in the style sheet of the components (D58): every button and switch
 * at least 24 by 24 CSS pixels (WCAG 2.5.8). axe passes `target-size` without layout, so it checks
 * nothing in jsdom.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { parseRules, pixels, type CssRule } from '../support/css.ts';
import { testDom } from '../support/dom.ts';
import { closeUis, openUi, styleSheetOf } from '../support/ui.ts';

afterEach(() => {
  closeUis();
  testDom.reset();
});

const MINIMUM = 24;

/** The rules of the style sheet of the components. */
function rules(): CssRule[] {
  openUi();
  return parseRules(styleSheetOf('lgpder-banner'));
}

/** Whether the rule styles the box of a button or a switch (not a pseudo-element inside it). */
function stylesTarget({ selector }: CssRule): boolean {
  return /button|switch/.test(selector) && !selector.includes('::');
}

describe('the targets of the components', () => {
  it('every button, switches included, has a minimum width and height of 24px', () => {
    const base = rules().find(({ selector }) => selector === 'button');

    assert.equal(pixels(base?.declarations.get('min-width')), MINIMUM);
    assert.equal(pixels(base?.declarations.get('min-height')), MINIMUM);
  });

  it('no rule of a button or a switch sets a size below 24px', () => {
    const sizes = rules()
      .filter(stylesTarget)
      .flatMap(({ selector, declarations }) =>
        ['width', 'height', 'min-width', 'min-height'].flatMap((property) => {
          const value = pixels(declarations.get(property));
          return value === undefined ? [] : [{ selector, property, value }];
        }),
      );

    assert.ok(sizes.length >= 6, 'no size found');
    for (const { selector, property, value } of sizes) {
      assert.ok(value >= MINIMUM, `${selector} ${property}: ${String(value)}px`);
    }
  });

  it('the floating button is 48 by 48 pixels', () => {
    const floating = rules().find(({ selector }) => selector === ':host(lgpder-button) button');

    assert.deepStrictEqual(
      [pixels(floating?.declarations.get('width')), pixels(floating?.declarations.get('height'))],
      [48, 48],
    );
  });
});
