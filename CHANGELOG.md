# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html), as described in the [Project status](README.md#project-status) section of the README.

## [Unreleased]

## [0.1.1] - 2026-11-05

Documentation only: no change to the code or to the API.

### Changed

- **Documentation.** New logo in the READMEs.

### Fixed

- **Documentation.** Corrected statements that went beyond the code: the accessibility checks (the contrast and the target sizes are checked on the style sheet, not by axe-core), the reload on revocation (also for `onGranted` code without a cleanup), the time stored in the record (rounded to the day only by default), the cleanup of `Partitioned` cookies (a limit of the library, not of the page), the cookie pattern syntax and the scope of the `debug` warning about Google tags. Added a note that LGPDer is not affiliated with Google, and stated in `docs/lgpd.md` that it is not legal advice.

## [0.1.0] - 2026-11-05

Initial release: a consent manager for the Brazilian LGPD, published as one ESM package with optional subpaths. See the [README](README.md) for the quick start and the guides in `docs/` for the full reference.

### Added

- **Core (`lgpder`).** `createConsentManager` with consent per purpose (`'pending'`, `'granted'`, `'denied'`), atomic `decide`, `grantAll` and `denyAll`, `individualGrant`, optional version per purpose with `outdated`, expiry after `maxAge` (default: 365 days), a clock rounded to the start of the UTC day by default, a serializable record read as untrusted data, synchronous notifications and a server snapshot compatible with `useSyncExternalStore`. See [api.md](docs/api.md).
- **Storage (`lgpder/storage`).** `connectStorage` with `localStorage` (default), a first-party cookie or a custom adapter; each write is confirmed by reading it back, a stale page never rewrites a grant revoked in another tab, and tabs sync through the `storage` event or a `BroadcastChannel`. See [storage.md](docs/storage.md).
- **Scripts (`lgpder/scripts`).** `connectScripts` blocks `<script type="text/plain" data-consent>`, `<iframe data-consent>` and `<img data-consent>` until every listed purpose is granted, with `scan()` for elements inserted later and `onGranted` for application code. A revocation blocks iframes and images again, runs the cleanups, deletes the cookies of the purpose on the host and every parent domain (built-in lists for `google-analytics` and `google-ads`, plus own patterns) and reloads the page when code was left running and the revocation is saved, or calls `onRevoke` in `'manual'` mode. See [scripts.md](docs/scripts.md).
- **Google Consent Mode v2 (`lgpder/google`).** `connectGoogle` maps purposes to Consent Mode types, directly or through the built-in integrations; a type is granted only when every purpose that controls it is granted. `consentDefaultSnippet` exports the default for the `<head>`. See [google.md](docs/google.md).
- **Evidence (`lgpder/evidence`).** `connectEvidence` calls `onDecision` on each decision of the data subject and, with `endpoint`, sends the record to the backend of the application with `sendBeacon` or `fetch`, without any identifier. See [evidence.md](docs/evidence.md).
- **Components (`lgpder/ui`).** `mountUi` mounts a banner, a preferences center and a floating button as Web Components with Shadow DOM, themed through CSS custom properties and `::part`, with texts in Brazilian Portuguese that can all be replaced; `createPlaceholder` renders the placeholder of blocked iframes. WCAG 2.2 AA, checked with axe-core in the tests. See [ui.md](docs/ui.md).
- **Single entry point (`lgpder/init`).** `init` configures and connects every layer from one options object, in an order that saves each decision before the other layers react to it, and undoes everything if a layer refuses its options. See [init.md](docs/init.md).
- **Documentation.** README in English and Brazilian Portuguese, one guide per subpath, recipes for SSR, Next.js and React, and the guide [O LGPDer e a LGPD](docs/lgpd.md), in Portuguese.

### Security

- Strict Content Security Policies are supported. The CSP hash of `consentDefaultSnippet` is `'sha256-bwiEGrWus2Rs6F3b0yuALxS0J1DFbgWl4lLMtYRMl7E='`, and the hash of the style sheet of the components is `'sha256-4ydU48/z3O6bG7Uy7CrY8iBC4yxZjQd3PBxuXb7XpV4='`. Both change only in a release that says so in this file.

[Unreleased]: https://github.com/azevedo1z/LGPDer/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/azevedo1z/LGPDer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/azevedo1z/LGPDer/releases/tag/v0.1.0
