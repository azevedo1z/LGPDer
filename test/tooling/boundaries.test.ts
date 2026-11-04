import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

import boundaries from '../../eslint.boundaries.js';

/** Root of the repository, where the `files` globs of the blocks are anchored. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Linter with only the dependency-direction rules. */
const linter = new ESLint({
  cwd: ROOT,
  overrideConfigFile: true,
  overrideConfig: [tseslint.configs.base, ...boundaries],
});

/** One file of each block of `eslint.boundaries.js`. */
const CORE = 'src/manager.ts';
const INIT = 'src/init/index.ts';
const LAYER = 'src/storage/index.ts';
const UI = 'src/ui/mount.ts';

/** Reports of `code` written in `file`, as `<rule id>: <message>`, in report order. */
async function reports(file: string, code: string): Promise<string[]> {
  const [result] = await linter.lintText(code, { filePath: file });
  assert.ok(result, `ESLint returned no result for ${file}.`);
  return result.messages.map(({ ruleId, message }) => `${String(ruleId)}: ${message}`);
}

interface Rejection {
  readonly scenario: string;
  readonly file: string;
  readonly code: string;
  /** Part of the message of the restriction that must catch the import. */
  readonly reason: string;
  /** Default: `no-restricted-imports`. */
  readonly rule?: string;
}

describe('dependency direction between the core and the layers', () => {
  const REJECTED: readonly Rejection[] = [
    // core
    {
      scenario: 'the core imports a layer',
      file: CORE,
      code: "import { connectStorage } from './storage/index.ts';",
      reason: 'never a layer',
    },
    {
      scenario: 'the core imports a file outside its folder',
      file: CORE,
      code: "import { connectStorage } from '../src/storage/index.ts';",
      reason: 'never a layer',
    },
    {
      scenario: 'the core imports the package by name',
      file: 'src/config.ts',
      code: "import type { PurposeConfig } from 'lgpder';",
      reason: 'by relative path',
    },
    {
      scenario: 'the core writes a non-normalized path',
      file: CORE,
      code: "import { parseOptions } from './../src/config.ts';",
      reason: 'normalized form',
    },
    // init (generic block)
    {
      scenario: 'init imports an internal file of a layer',
      file: INIT,
      code: "import { removeCookies } from '../scripts/cookies.ts';",
      reason: 'only ../index.ts',
    },
    {
      scenario: 'init imports a layer by the package name',
      file: INIT,
      code: "import { connectStorage } from 'lgpder/storage';",
      reason: 'by relative path',
    },
    {
      scenario: 'init reaches an internal file of the core by a non-normalized path',
      file: INIT,
      code: "import { createManager } from './../manager.ts';",
      reason: 'normalized form',
    },
    // storage, scripts, google and evidence
    {
      scenario: 'a layer imports an internal file of the core',
      file: LAYER,
      code: "import { createManager } from '../manager.ts';",
      reason: 'only ../index.ts',
    },
    {
      scenario: 'storage imports the barrel of scripts',
      file: LAYER,
      code: "import { connectScripts } from '../scripts/index.ts';",
      reason: 'imports only the core',
    },
    {
      scenario: 'a layer imports the package by name',
      file: 'src/google/index.ts',
      code: "import { createConsentManager } from 'lgpder';",
      reason: 'by relative path',
    },
    {
      scenario: 'a layer reaches an internal file of the core through ./../',
      file: LAYER,
      code: "import { createManager } from './../manager.ts';",
      reason: 'normalized form',
    },
    {
      scenario: 'a layer leaves its folder in the middle of the path',
      file: LAYER,
      code: "import { connectScripts } from './adapters/../../scripts/index.ts';",
      reason: 'normalized form',
    },
    // ui
    {
      scenario: 'ui imports an internal file of the core',
      file: UI,
      code: "import { createManager } from '../manager.ts';",
      reason: 'only ../index.ts',
    },
    {
      scenario: 'ui imports the barrel of storage',
      file: UI,
      code: "import { connectStorage } from '../storage/index.ts';",
      reason: 'only the core and types of scripts',
    },
    {
      scenario: 'ui imports a value from the barrel of scripts',
      file: UI,
      code: "import { connectScripts } from '../scripts/index.ts';",
      reason: 'the functions are injected',
      rule: '@typescript-eslint/no-restricted-imports',
    },
    {
      scenario: 'ui imports a layer by the package name',
      file: UI,
      code: "import { connectScripts } from 'lgpder/scripts';",
      reason: 'by relative path',
    },
    {
      scenario: 'ui reaches the barrel of storage through ./../',
      file: UI,
      code: "import { connectStorage } from './../storage/index.ts';",
      reason: 'normalized form',
    },
    // every file of src
    {
      scenario: 'a layer loads the core with a dynamic import',
      file: LAYER,
      code: "export const manager = await import('../manager.ts');",
      reason: 'static import',
      rule: 'no-restricted-syntax',
    },
    {
      scenario: 'the core names a type of a layer with an import type expression',
      file: 'src/config.ts',
      code: "export type Adapter = import('./storage/index.ts').Adapter;",
      reason: 'import type declaration',
      rule: 'no-restricted-syntax',
    },
  ];

  for (const { scenario, file, code, reason, rule = 'no-restricted-imports' } of REJECTED) {
    it(`rejects: ${scenario}`, async () => {
      const reported = await reports(file, code);

      assert.ok(
        reported.some((report) => report.startsWith(`${rule}: `) && report.includes(reason)),
        `Expected ${rule} with "${reason}"; reported: ${JSON.stringify(reported)}.`,
      );
    });
  }

  const ACCEPTED = [
    {
      scenario: 'ui imports only types from the barrel of scripts',
      file: UI,
      code: "import type { PlaceholderRenderer } from '../scripts/index.ts';",
    },
    {
      scenario: 'init imports every barrel',
      file: INIT,
      code: [
        "import { createConsentManager } from '../index.ts';",
        "import { connectStorage } from '../storage/index.ts';",
        "import { connectScripts } from '../scripts/index.ts';",
        "import { connectGoogle } from '../google/index.ts';",
        "import { connectEvidence } from '../evidence/index.ts';",
        "import { mountUi } from '../ui/index.ts';",
      ].join('\n'),
    },
    {
      scenario: 'a layer imports the core entry',
      file: 'src/evidence/index.ts',
      code: "import { createConsentManager } from '../index.ts';",
    },
    {
      scenario: 'a layer imports its own files',
      file: LAYER,
      code: "import { cookieAdapter } from './adapters/cookie.ts';",
    },
    {
      scenario: 'the core imports its own files',
      file: CORE,
      code: "import { parseOptions } from './config.ts';",
    },
  ] as const;

  for (const { scenario, file, code } of ACCEPTED) {
    it(`accepts: ${scenario}`, async () => {
      assert.deepStrictEqual(await reports(file, code), []);
    });
  }
});

describe('the project lint configuration applies the dependency rules', () => {
  const project = new ESLint({ cwd: ROOT });
  const BOUNDARY_RULES = [
    'no-restricted-imports',
    '@typescript-eslint/no-restricted-imports',
    'no-restricted-syntax',
  ] as const;

  for (const file of [CORE, INIT, LAYER, UI]) {
    it(`eslint.config.js keeps the options of eslint.boundaries.js for ${file}`, async () => {
      const [expected, actual] = await Promise.all([
        linter.calculateConfigForFile(file) as Promise<{ rules?: Record<string, unknown> }>,
        project.calculateConfigForFile(file) as Promise<{ rules?: Record<string, unknown> }>,
      ]);

      for (const rule of BOUNDARY_RULES) {
        assert.deepStrictEqual(actual.rules?.[rule], expected.rules?.[rule], rule);
      }
    });
  }
});
