/**
 * Reader of the style sheet of the components, for the checks that need a layout jsdom does not
 * have: contrast of the default theme and size of the targets. It reads flat rules
 * (`selector{property:value;...}`), the only form the style sheet uses.
 */

/** A rule of the style sheet. */
export interface CssRule {
  readonly selector: string;
  /** Declarations, by property, in source order. */
  readonly declarations: ReadonlyMap<string, string>;
}

/** The rules of `css`, in source order. */
export function parseRules(css: string): CssRule[] {
  return css
    .split('}')
    .filter((chunk) => chunk.includes('{'))
    .map((chunk) => {
      const [selector = '', body = ''] = chunk.split('{');
      const declarations = new Map<string, string>();
      for (const declaration of body.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon > 0) {
          declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
        }
      }
      return { selector: selector.trim(), declarations };
    });
}

/**
 * The default color of each private property of `:host`, such as `--_bg` for
 * `var(--lgpder-color-background,#ffffff)`.
 */
export function themeOf(rules: readonly CssRule[]): ReadonlyMap<string, string> {
  const host = rules.find(({ selector }) => selector === ':host');
  const theme = new Map<string, string>();
  for (const [property, value] of host?.declarations ?? []) {
    const fallback = /^var\(--lgpder-[a-z-]+,(#[0-9a-f]{6})\)$/.exec(value)?.[1];
    if (property.startsWith('--_') && fallback !== undefined) theme.set(property, fallback);
  }
  return theme;
}

/** The color a value refers to, through `var(--_*)`; `undefined` when it names none. */
export function colorOf(
  value: string | undefined,
  theme: ReadonlyMap<string, string>,
): string | undefined {
  const name = /var\((--_[a-z]+)\)/.exec(value ?? '')?.[1];
  return name === undefined ? undefined : theme.get(name);
}

/** Relative luminance of a `#rrggbb` color, as defined by WCAG 2. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two `#rrggbb` colors, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** The value of a length in CSS pixels; `undefined` when it is not in `px`. */
export function pixels(value: string | undefined): number | undefined {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value ?? '');
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
