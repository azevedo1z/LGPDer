/**
 * Dependency direction between the core and the layers (spec section 5, principle 7). Each block
 * repeats the whole list of patterns, because a later block replaces the options of the rule
 * instead of adding to them. Every restriction has a fixture that must fail, checked by
 * `test/tooling/boundaries.test.ts`.
 */

/** Importing the package by name from its own source would load a second copy of the core. */
const SELF_IMPORT = {
  group: ['lgpder', 'lgpder/*'],
  message: 'Import the core and the layers by relative path.',
};

/**
 * The patterns below assume normalized specifiers: `./` only at the start, `../` only as a run at
 * the start. A `./` or `../` segment after any other segment (`./../manager.ts`,
 * `../storage/../manager.ts`) reaches the same file by a path the patterns do not see.
 */
const NON_NORMALIZED = {
  regex: String.raw`(?:^|/)(?!\.\./)[^/]+/\.\.?/`,
  message: 'Write relative paths in normalized form, with ../ segments only at the start.',
};

/** Outside its folder, a layer imports only the core entry and the barrels of other layers. */
const ONLY_BARRELS = {
  regex: String.raw`^\.\./(?!index\.ts$|[a-z]+/index\.ts$)`,
  message: 'Outside its folder, a layer imports only ../index.ts and ../<layer>/index.ts.',
};

/**
 * @param {readonly object[]} patterns
 * @returns {import('eslint').Linter.RulesRecord}
 */
function restrictImports(patterns) {
  return {
    'no-restricted-imports': ['error', { patterns: [SELF_IMPORT, NON_NORMALIZED, ...patterns] }],
  };
}

/** @type {import('eslint').Linter.Config[]} */
const boundaries = [
  {
    // `no-restricted-imports` sees only static imports and re-exports: a dynamic `import()` or an
    // `import('...')` type would cross any boundary unchecked.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Use a static import, which the dependency rules check.',
        },
        {
          selector: 'TSImportType',
          message: 'Use an import type declaration, which the dependency rules check.',
        },
      ],
    },
  },
  {
    files: ['src/*.ts'],
    rules: restrictImports([
      {
        regex: String.raw`^(?:\.\./|\./[^/]+/)`,
        message: 'The core imports only its own files, never a layer.',
      },
    ]),
  },
  {
    // Generic rule, in effect for init, which may import every barrel.
    files: ['src/*/**/*.ts'],
    rules: restrictImports([ONLY_BARRELS]),
  },
  {
    files: ['src/{storage,scripts,google,evidence}/**/*.ts'],
    rules: restrictImports([
      ONLY_BARRELS,
      { regex: String.raw`^\.\./[a-z]+/`, message: 'This layer imports only the core.' },
    ]),
  },
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      ...restrictImports([
        ONLY_BARRELS,
        {
          regex: String.raw`^\.\./(storage|google|evidence|init)/`,
          message: 'The ui imports only the core and types of scripts.',
        },
      ]),
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: String.raw`^\.\./scripts/`,
              allowTypeImports: true,
              message: 'The ui imports only types of scripts; the functions are injected.',
            },
          ],
        },
      ],
    },
  },
];

export default boundaries;
