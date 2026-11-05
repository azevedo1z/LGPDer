/**
 * Height of the banner, checked in the style sheet of the components: a fixed element does not
 * scroll with the page, so a banner taller than the viewport (zoom, small screen) would hide its
 * title and description above the top of the window (WCAG 1.4.4 and 1.4.10). jsdom has no layout,
 * so the limit is read from the rules.
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

/** The style sheet of the components. */
function styleSheet(): string {
  openUi();
  return styleSheetOf('lgpder-banner');
}

/** The rule with exactly `selector`; fails the test when there is none. */
function ruleOf(css: string, selector: string): CssRule {
  const rule = parseRules(css).find((candidate) => candidate.selector === selector);
  if (rule === undefined) throw new Error(`No rule ${selector}.`);
  return rule;
}

/** The viewport height left by the padding of the banner host, above and below it. */
function limitOf(css: string, unit: 'vh' | 'dvh'): string {
  const padding = pixels(ruleOf(css, ':host(lgpder-banner)').declarations.get('padding'));
  return `calc(100${unit} - ${String(2 * (padding ?? Number.NaN))}px)`;
}

describe('the banner fits the viewport', () => {
  it('is never taller than the dynamic viewport, less the padding of its host', () => {
    const css = styleSheet();

    assert.equal(ruleOf(css, '[part~=banner]').declarations.get('max-height'), limitOf(css, 'dvh'));
  });

  it('declares the same limit in vh first, for the browsers without dvh', () => {
    const css = styleSheet();

    assert.ok(
      css.includes(`max-height:${limitOf(css, 'vh')};max-height:${limitOf(css, 'dvh')}`),
      'no vh fallback before the dvh limit',
    );
  });

  it('scrolls its content when it reaches the limit', () => {
    assert.equal(ruleOf(styleSheet(), '[part~=banner]').declarations.get('overflow'), 'auto');
  });
});
