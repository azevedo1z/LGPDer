/**
 * The documentation follows the code: its links resolve, its quick start is the acceptance test,
 * its snippet and CSP hashes are the ones the code produces, and every message the code throws or
 * warns is documented, with no documented message the code does not have.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import { consentDefaultSnippet } from '../../src/google/index.ts';
import { testDom } from '../support/dom.ts';
import {
  anchorsOf,
  documentedMessages,
  documentPaths,
  prefixCount,
  readText,
  relativeLinksOf,
  sourceMessages,
  sourcePaths,
} from '../support/markdown.ts';
import { closeUis, openUi, styleSheetOf } from '../support/ui.ts';

afterEach(() => {
  closeUis();
  testDom.reset();
});

/** The Google tag of the example of section 3 of the specification, as written there. */
const SPEC_TAG = `<script type="text/plain" data-consent="analytics"
        data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>`;

/** Documents that show the quick start of the specification. */
const QUICK_STARTS = ['README.md', 'README.pt-BR.md', 'docs/init.md'];

/** CSP source of `text`, as a policy lists it. */
function hashSource(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** Options given to `init` in the example of the acceptance test, without indentation. */
function exampleOptions(): string {
  const lines = readText('test/init/acceptance.test.ts').split('\n');
  const start = lines.indexOf('  return init({');
  const end = lines.indexOf('  });', start);
  assert.ok(start !== -1 && end > start, 'the example is in the acceptance test');
  return lines
    .slice(start + 1, end)
    .map((line) => line.slice(2))
    .join('\n');
}

describe('the documents', () => {
  it('are the two READMEs, the changelog and one guide per subject', () => {
    assert.deepStrictEqual(documentPaths(), [
      'README.md',
      'README.pt-BR.md',
      'CHANGELOG.md',
      'docs/api.md',
      'docs/evidence.md',
      'docs/google.md',
      'docs/init.md',
      'docs/lgpd.md',
      'docs/scripts.md',
      'docs/ssr-react.md',
      'docs/storage.md',
      'docs/ui.md',
    ]);
  });
});

describe('the relative links of the documents', () => {
  for (const path of documentPaths()) {
    it(`resolve to a file and a heading, in ${path}`, () => {
      const broken = relativeLinksOf(path, readText(path))
        .filter(
          ({ path: target, anchor }) =>
            !existsSync(new URL(`../../${target}`, import.meta.url)) ||
            (anchor !== undefined && !anchorsOf(readText(target)).has(anchor)),
        )
        .map(({ text, path: target, anchor }) => `[${text}](${target}#${String(anchor)})`);

      assert.deepStrictEqual(broken, []);
    });
  }
});

describe('the quick start', () => {
  for (const path of QUICK_STARTS) {
    it(`is the example of the acceptance test, in ${path}`, () => {
      const text = readText(path);

      assert.ok(text.includes(`init({\n${exampleOptions()}\n});`), 'the options of init');
      assert.ok(text.includes(SPEC_TAG), 'the Google tag marked with data-consent');
    });
  }
});

describe('the consent default and the CSP hashes', () => {
  it('show the exact snippet in the google guide and in the READMEs', () => {
    for (const path of ['docs/google.md', 'README.md', 'README.pt-BR.md']) {
      assert.ok(readText(path).includes(consentDefaultSnippet), path);
    }
  });

  it('give the hash of the snippet in the google guide and in the changelog', () => {
    const hash = hashSource(consentDefaultSnippet);

    assert.ok(readText('docs/google.md').includes(hash), hash);
    assert.ok(readText('CHANGELOG.md').includes(hash), hash);
  });

  it('give the hash of the style sheet of the components in the ui guide and in the changelog', () => {
    openUi();
    const hash = hashSource(styleSheetOf('lgpder-banner'));

    assert.ok(readText('docs/ui.md').includes(hash), hash);
    assert.ok(readText('CHANGELOG.md').includes(hash), hash);
  });
});

describe('the error and warning messages', () => {
  const patterns = sourcePaths().flatMap((path) => sourceMessages(readText(path)));
  const documented = documentPaths().flatMap((path) => documentedMessages(readText(path)));

  it('are found in the code', () => {
    assert.ok(patterns.length > 50, `${String(patterns.length)} messages`);
  });

  it('are every [lgpder] of the code, so none is left out of the cross-check', () => {
    const prefixes = sourcePaths().reduce((count, path) => count + prefixCount(readText(path)), 0);

    assert.equal(patterns.length, prefixes);
  });

  it('are read from the code in single quotes, double quotes and backticks', () => {
    const source = [
      "throw new TypeError('[lgpder] Single.');",
      'throw new TypeError("[lgpder] Can\'t be double.");',
      'throw new TypeError(`[lgpder] Template ${String(1)}.`);',
    ].join('\n');

    assert.deepStrictEqual(
      sourceMessages(source).map((pattern) => pattern.source),
      [
        String.raw`^\[lgpder\] Single\.$`,
        String.raw`^\[lgpder\] Can't be double\.$`,
        String.raw`^\[lgpder\] Template .+?\.$`,
      ],
    );
  });

  it('are read from the documents alone or as the argument of an error', () => {
    const markdown =
      "Throws `Error('[lgpder] Destroyed.')`, or `[lgpder] Unknown option: {json(key)}.`.";

    assert.deepStrictEqual(documentedMessages(markdown), [
      '[lgpder] Unknown option: {json(key)}.',
      '[lgpder] Destroyed.',
    ]);
  });

  it('of the code are all documented', () => {
    const missing = patterns.filter(
      (pattern) => !documented.some((message) => pattern.test(message)),
    );

    assert.deepStrictEqual(
      missing.map((pattern) => pattern.source),
      [],
    );
  });

  it('documented are all messages of the code', () => {
    const unknown = documented.filter(
      (message) => !patterns.some((pattern) => pattern.test(message)),
    );

    assert.deepStrictEqual(unknown, []);
  });
});
