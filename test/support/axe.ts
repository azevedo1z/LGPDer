/**
 * axe-core in the test window. Importing this module installs the DOM and injects axe into it.
 *
 * axe runs on the host of a component, never on the document: on a bare test document, page rules
 * such as `document-title` and `landmark-one-main` would fail for reasons outside the components.
 * `color-contrast` is off because jsdom has no layout (contrast is computed from the style sheet,
 * in `contrast.test.ts`), and `target-size` passes for the same reason without checking anything
 * (sizes are checked in the style sheet, in `target-size.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { AxeResults, RunOptions } from 'axe-core';

import { testDom } from './dom.ts';

/** The part of the axe API these tests use. */
interface Axe {
  readonly run: (context: Element, options: RunOptions) => Promise<AxeResults>;
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const source = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
testDom.window.eval(source);
const { axe } = testDom.window as unknown as { readonly axe: Axe };

/** Runs axe on `host` and its shadow tree, with the WCAG 2.2 AA tags and the best practices. */
export function runAxe(host: Element): Promise<AxeResults> {
  return axe.run(host, {
    runOnly: { type: 'tag', values: TAGS },
    rules: { 'color-contrast': { enabled: false } },
  });
}

/**
 * Each violation of `results`, as `rule: targets`, for a readable failure message. The arrays of
 * axe belong to the test window, so the result is built as an array of this realm.
 */
export function describeViolations({ violations }: AxeResults): string[] {
  return Array.from(
    violations,
    ({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(' ')).join(', ')}`,
  );
}
