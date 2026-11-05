/**
 * Contrast of the default theme, computed from the style sheet of the components (D58): at least
 * 4.5:1 for text (WCAG 1.4.3) and 3:1 for the focus outline and the parts of a switch (1.4.11).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { colorOf, contrastRatio, parseRules, themeOf, type CssRule } from '../support/css.ts';
import { testDom } from '../support/dom.ts';
import { closeUis, openUi, styleSheetOf } from '../support/ui.ts';

afterEach(() => {
  closeUis();
  testDom.reset();
});

/** The rules and the default theme of the style sheet of the components. */
function styleSheet(): { readonly rules: CssRule[]; readonly theme: ReadonlyMap<string, string> } {
  openUi();
  const rules = parseRules(styleSheetOf('lgpder-banner'));
  return { rules, theme: themeOf(rules) };
}

/** The rule with exactly `selector`; fails the test when there is none. */
function ruleOf(rules: readonly CssRule[], selector: string): CssRule {
  const rule = rules.find((candidate) => candidate.selector === selector);
  if (rule === undefined) throw new Error(`No rule ${selector}.`);
  return rule;
}

describe('the contrast ratio of the test', () => {
  it('follows WCAG: 21 for black on white, 1 for a color on itself', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#0b57d0', '#0b57d0'), 1);
  });
});

describe('the default theme', () => {
  it('reads every documented custom property, with its default', () => {
    const { theme } = styleSheet();

    assert.deepStrictEqual(Object.fromEntries(theme), {
      '--_bg': '#ffffff',
      '--_tx': '#1f2328',
      '--_mu': '#57606a',
      '--_pr': '#0b57d0',
      '--_on': '#ffffff',
      '--_bd': '#d0d7de',
      '--_fo': '#0b57d0',
    });
  });

  it('gives every text color at least 4.5:1 against its own background or the components', () => {
    const { rules, theme } = styleSheet();
    const background = theme.get('--_bg') ?? '';
    const texts = rules.filter(({ declarations }) => declarations.has('color'));

    assert.ok(texts.length >= 4, 'no text color found');
    for (const { selector, declarations } of texts) {
      const color = colorOf(declarations.get('color'), theme) ?? '';
      const behind = colorOf(declarations.get('background'), theme) ?? background;
      assert.ok(
        contrastRatio(color, behind) >= 4.5,
        `${selector}: ${color} on ${behind} is ${contrastRatio(color, behind).toFixed(2)}:1`,
      );
    }
  });

  const nonText = [
    {
      name: 'focus outline',
      selector: 'button:focus-visible',
      property: 'outline',
      against: '--_bg',
    },
    {
      name: 'border of a switch off',
      selector: '[role=switch]',
      property: 'border',
      against: '--_bg',
    },
    {
      name: 'knob of a switch off',
      selector: '[role=switch]::before',
      property: 'background',
      against: '--_bg',
    },
    {
      name: 'knob of a switch on',
      selector: '[aria-checked=true]::before',
      property: 'background',
      against: '--_pr',
    },
    {
      name: 'border of a purpose with individualGrant',
      selector: '[part~=individual]',
      property: 'border',
      against: '--_bg',
    },
  ] as const;
  for (const { name, selector, property, against } of nonText) {
    it(`gives the ${name} at least 3:1`, () => {
      const { rules, theme } = styleSheet();
      const color = colorOf(ruleOf(rules, selector).declarations.get(property), theme) ?? '';

      assert.ok(contrastRatio(color, theme.get(against) ?? '') >= 3);
    });
  }
});
