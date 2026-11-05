import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Root of the repository, where `npm pack` runs. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Every guide of `docs/`, all published with the package; which guides exist is checked by the test
 * of the documentation.
 */
function guides(): readonly string[] {
  return readdirSync(new URL('../../docs/', import.meta.url))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`);
}

interface PackResult {
  readonly files: readonly { readonly path: string }[];
}

/** Paths, relative to the root and with `/`, of the files `npm pack` would publish. */
function packedFiles(): ReadonlySet<string> {
  // A single command line, so that the shell resolves `npm` (`npm.cmd` on Windows).
  const { stdout, stderr, status } = spawnSync('npm pack --dry-run --json --ignore-scripts', {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
  });
  assert.equal(status, 0, stderr);
  const [result] = JSON.parse(stdout) as readonly PackResult[];
  assert.ok(result, 'npm pack returned no package.');
  return new Set(result.files.map(({ path }) => path.replaceAll('\\', '/')));
}

/** Compiled `.js` and `.d.ts` files of `dist/`, relative to the root and with `/`. */
function compiledFiles(): readonly string[] {
  return readdirSync(new URL('../../dist/', import.meta.url), { recursive: true, encoding: 'utf8' })
    .map((file) => `dist/${file.replaceAll('\\', '/')}`)
    .filter((file) => file.endsWith('.js') || file.endsWith('.d.ts'));
}

describe('files of the published package', () => {
  const packed = packedFiles();

  it('publishes every compiled .js and .d.ts file of dist', () => {
    const compiled = compiledFiles();

    assert.ok(compiled.length > 0, 'dist is empty: run npm run build first.');
    assert.deepStrictEqual(
      compiled.filter((file) => !packed.has(file)),
      [],
    );
  });

  it('publishes the license, the readmes, the changelog and the guides', () => {
    const required = [
      'LICENSE',
      'README.md',
      'README.pt-BR.md',
      'CHANGELOG.md',
      'package.json',
      ...guides(),
    ];

    assert.deepStrictEqual(
      required.filter((file) => !packed.has(file)),
      [],
    );
  });
});
