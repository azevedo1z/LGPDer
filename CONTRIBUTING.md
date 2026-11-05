# Contributing to LGPDer

Thank you for your interest in improving LGPDer. Contributions of all sizes are welcome: bug reports, documentation fixes, tests and new features.

## Before you start

- Read the [README](README.md) to understand the workflow, the [principles](README.md#principles) and the [known limitations](README.md#known-limitations).
- Search the [existing issues](https://github.com/azevedo1z/lgpder/issues) to avoid duplicates.
- For security vulnerabilities, do **not** open a public issue. Follow the [security policy](SECURITY.md) instead.

## Reporting bugs

Open a [bug report](https://github.com/azevedo1z/lgpder/issues/new?template=bug_report.yml) with:

- What you expected to happen and what happened instead
- A minimal reproduction: the `init` options (or the layers you connect) and the relevant HTML
- Environment details (browser and version, bundler or framework, LGPDer version)
- Console errors, with personal data removed

## Suggesting improvements

Open a [feature request](https://github.com/azevedo1z/lgpder/issues/new?template=feature_request.yml) describing the problem you want to solve and the proposed solution. For larger changes, such as a new built-in integration or anything listed under known limitations, discuss the approach in an issue before writing code.

Every proposal is weighed against the [principles](README.md#principles). In particular, a change cannot make any failure path grant consent, treat a restore or a sync as a decision of the data subject, add a runtime dependency or send data to third parties.

## Setting up the development environment

Requirements: Node.js `24.14` (see `.nvmrc`) and npm.

```sh
git clone https://github.com/azevedo1z/lgpder.git
cd lgpder
npm ci
npm run check
```

`npm run check` runs everything the CI runs: formatting, lint, typecheck, tests with coverage, package checks and size limits.

The tests run with `node --test` directly on the TypeScript sources (type stripping), with jsdom for the DOM and axe-core for accessibility. Run one file with:

```sh
node --test --test-timeout=30000 test/init/acceptance.test.ts
```

## Project structure

- `src/*.ts`: the core. It must stay free of DOM and Node APIs; `tsconfig.core.json` checks it.
- `src/<layer>/`: one folder per subpath (`storage`, `scripts`, `google`, `evidence`, `ui`, `init`), with `index.ts` as its public entry.
- `test/<layer>/`: tests of each subpath; `test/support/` has the shared builders and the DOM setup.
- `docs/`: one guide per subpath. `docs/lgpd.md` is in Portuguese; every other document is in English.

Layers import the core only through `src/index.ts`, and another layer only through its `index.ts` when the dependency direction allows it. ESLint enforces this, so a forbidden import fails the lint.

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. Identifiers, comments, JSDoc and error messages are in English; errors use the format `[lgpder] Message.`.
3. Add or update tests for the behavior you change. Tests are documentation: prefer clear names, builders and table-driven cases.
4. Run `npm run check` locally.
5. If you change a public API, update the guide in `docs/` and the `Unreleased` section of the [CHANGELOG](CHANGELOG.md). The documentation is tested: its links, the quick start, the Consent Mode snippet, the CSP hashes and every error message must match the code.
6. If you change the consent default snippet or the style sheet of the components, update their CSP hashes in the guides and in the CHANGELOG.
7. Open the pull request against `main`, filling in the pull request template.

## Commit messages

Please write commit messages in the [Conventional Commits](https://www.conventionalcommits.org) style:

```
feat(scripts): add a catalog entry for Microsoft Clarity
fix(storage): remove the record cookie on parent domains
docs: clarify the Next.js recipe
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Use the subpath as the scope when the change belongs to one.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
