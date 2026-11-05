<h1 align="center">
  <img src="docs/logo.svg" width="30%" alt="LGPDer">
</h1>

<p align="center">
  Open source consent manager for the Brazilian LGPD: banner, preferences center, script blocking and Google Consent Mode v2 with a few lines of configuration.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lgpder"><img src="https://img.shields.io/npm/v/lgpder" alt="npm version"/></a>
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License: MIT"/>
  <img src="https://img.shields.io/badge/status-early%20development-orange" alt="Status: early development"/>
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6.0"/>
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen" alt="Zero runtime dependencies"/>
  <img src="https://img.shields.io/badge/ESM-only-F7DF1E?logo=javascript&logoColor=black" alt="ESM only"/>
  <img src="https://img.shields.io/badge/gzip-core%202.3%20kB%20%7C%20all%2014.1%20kB-blue" alt="Size: core 2.3 kB, all subpaths 14.1 kB gzip"/>
  <img src="https://img.shields.io/badge/coverage-100%25-brightgreen" alt="Coverage: 100% of lines"/>
</p>

<p align="center">
  <a href="README.pt-BR.md">Leia em português</a>
</p>

---

> [!IMPORTANT]
> LGPDer is a technical library. Using it does not, by itself, make an application compliant with the LGPD. See the [legal notice](#legal-notice).

## Table of contents

- [The problem](#the-problem)
- [What LGPDer provides](#what-lgpder-provides)
- [How it works](#how-it-works)
- [Use cases](#use-cases)
- [Getting started](#getting-started)
- [Configuration reference](#configuration-reference)
- [Architecture](#architecture)
- [Headless mode](#headless-mode)
- [Principles](#principles)
- [Privacy and security](#privacy-and-security)
- [Testing and code quality](#testing-and-code-quality)
- [Known limitations](#known-limitations)
- [Project status](#project-status)
- [Legal notice](#legal-notice)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## The problem

Brazilian websites that use analytics or advertising need the consent of the data subject before setting cookies or loading trackers. In practice, many cookie banners are only decorative: the Google tag loads before any click, "reject" is hidden behind a second screen, there is no way to revoke later, and a revocation changes a flag while the tracker keeps running on the page.

Doing it properly by hand means solving the same problems every time: recording one decision per purpose, persisting it, keeping tabs in sync, blocking scripts and iframes until there is consent, telling the Google Consent Mode, deleting cookies on revocation, and building an accessible interface. Commercial consent platforms solve this, but they add a third-party script, a dashboard and data sent to someone else.

LGPDer solves it inside the application, as an npm package, with no backend and no telemetry.

## What LGPDer provides

- **Banner and preferences center.** Web Components with Shadow DOM: "Aceitar todas", "Rejeitar todas" and "Personalizar" with the same emphasis, one switch per purpose grouped by category, pending purposes shown off, and a floating button to revoke at any time. Texts in Brazilian Portuguese, all replaceable.
- **Blocking until consent.** `<script type="text/plain" data-consent="...">`, `<iframe data-consent>` and `<img data-consent>` stay inert until every listed purpose is granted. Blocked iframes show a placeholder with "Carregar" (this content, this page only) and "Permitir sempre".
- **Revocation with real effect.** Revoking removes iframes and pixels, runs the cleanup of application code, deletes the purpose's cookies on the host and every parent domain, sends `'denied'` to the Consent Mode and, when code is still running, reloads the page once the revocation is saved.
- **Google Consent Mode v2.** Each purpose maps Consent Mode types directly or through built-in integrations (`google-analytics`, `google-ads`). The consent default for the `<head>` is exported as text.
- **Persistence and sync between tabs.** `localStorage` by default, a first-party cookie for server rendering, or a custom adapter. A revocation in one tab reaches the others.
- **Expiry and re-consent.** Decisions expire after 365 days by default, and a new version of a purpose asks again.
- **Evidence of consent.** An optional hook and an endpoint of the application itself that receives each decision; the precise time comes from the backend, and no identifier is generated in the browser.
- **Headless core.** A 2.3 kB core with typed state, atomic decisions and notifications, compatible with React's `useSyncExternalStore`, for teams that build their own interface.
- **Accessibility.** WCAG 2.2 AA: keyboard navigation, focus trapped in the open dialog, `Esc` to close, ARIA roles and labels, contrast of the default theme, checked with axe-core in the tests.

## How it works

```
init()  →  banner  →  explicit decision  →  saved  →  Consent Mode updated  →  blocked tags activated
                                                     ↘  other tabs adopt it
revocation  →  saved  →  iframes removed, cleanups run, cookies deleted, Consent Mode denied  →  reload if code was left running
```

1. `init` creates the core, connects the storage and adopts the saved record. Restoring is never a decision of the data subject.
2. While some purpose is undecided, expired or under a new version, the banner shows.
3. Each click records one decision per purpose. The storage saves it, the Google layer sends the Consent Mode update, and the scripts layer activates the blocked elements whose purposes are all granted.
4. On a revocation, here or in another tab, the scripts layer undoes what it can, deletes the cookies of the purpose and reloads the page when a script it activated is still running.

## Use cases

- Websites and SPAs in Brazil that use Google Analytics, Google Ads or the Google Tag Manager and need consent before loading them.
- SSR applications (Next.js and similar) that need to read the consent on the server, through the cookie storage.
- Applications with purposes that require a specific decision, such as sensitive data, through `individualGrant` and `openPreferences([...])`.
- Teams with their own design system that want only the core, the storage and the blocking, in headless mode.
- Developers looking for a reference implementation of a fail-closed, dependency-free, typed browser library.

## Getting started

### Requirements

- Browsers with ES2022 support (Chrome and Edge 93+, Firefox 92+, Safari 15.4+).
- A bundler (Vite, webpack, Next.js and so on). The package is ESM only, with no CDN build in this version.
- Node.js 22.12 or later when the package runs in Node (server rendering, tests).
- TypeScript projects with `moduleResolution` set to `node16`, `nodenext` or `bundler`.

### 1. Install

```sh
npm install lgpder
```

### 2. Configure the purposes

In the entry point of the application:

```ts
import { init } from 'lgpder/init';

init({
  purposes: {
    analytics: {
      category: 'statistics',
      title: 'Estatísticas',
      description: 'Usamos o Google Analytics para entender como o site é usado.',
      integrations: ['google-analytics'],
    },
    ads: {
      category: 'marketing',
      title: 'Publicidade',
      description: 'Anúncios personalizados do Google Ads.',
      integrations: ['google-ads'],
    },
  },
});
```

### 3. Block the Google tag

Mark it with `data-consent`, so it stays inert until `analytics` is granted:

<!-- prettier-ignore -->
```html
<script type="text/plain" data-consent="analytics"
        data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
```

### 4. Set the Consent Mode default

In the `<head>`, before any Google tag. It is the text of `consentDefaultSnippet`, exported by `lgpder/google` for frameworks that render the `<head>` (see the [google guide](docs/google.md#the-default-before-the-google-tag)):

<!-- prettier-ignore -->
```html
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'denied',wait_for_update:500});</script>
```

### 5. Try it

Open the page: the banner shows, and the Google tag is still `type="text/plain"`. Click "Aceitar todas": the decision is saved in `localStorage`, the Consent Mode is updated and the tag loads. Reopen the preferences through the floating button and turn "Estatísticas" off: the button becomes "Salvar e recarregar", the `_ga` cookies are deleted and the page reloads with the tag blocked.

This example is the acceptance test of the project (`test/init/acceptance.test.ts`). The Google tag stays blocked until consent, which is the [basic mode](docs/google.md#basic-mode-recommended-and-advanced-mode) of the Consent Mode, the recommended one.

## Configuration reference

`init(options)` takes everything in one object and hands each part to its layer. The full reference is in the [init guide](docs/init.md).

### Options

| Option           | Default          | Description                                                                                                  |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `purposes`       |                  | The purposes, in display order; at least one. See [per purpose](#per-purpose).                               |
| `storage`        | `'localStorage'` | `'localStorage'`, `'cookie'` (readable on the server) or a [custom adapter](docs/storage.md#storageadapter). |
| `maxAge`         | 365 days         | Maximum age of a decision, in milliseconds. Grants and refusals expire.                                      |
| `now`            | start of UTC day | Clock of the decisions. Rounded by default, so the date does not identify the browser.                       |
| `revocation`     | `'reload'`       | `'reload'` or `'manual'` (see [revocation](docs/scripts.md#revocation)).                                     |
| `onRevoke`       |                  | Called on every revocation, with the purposes and whether a reload is required.                              |
| `endpoint`       |                  | Endpoint of the application that receives the evidence of each decision. Nothing is sent without it.         |
| `onDecision`     |                  | Called on each decision of the data subject.                                                                 |
| `onError`        |                  | Called when sending the evidence fails.                                                                      |
| `texts`          | pt-BR            | Texts merged over the built-in Brazilian Portuguese.                                                         |
| `necessary`      |                  | Texts of the informative "always active" section, without a switch.                                          |
| `floatingButton` | `true`           | Whether to show the floating button. Hide it only with another access to the preferences.                    |
| `debug`          | `false`          | Console warnings about known trackers without `data-consent` and a missing Consent Mode default.             |

### Per purpose

| Key               | Description                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `title`           | Title of the purpose and name of its switch.                                                |
| `description`     | Description shown to the data subject.                                                      |
| `category`        | Group in the preferences center. A label only: there is no category consent.                |
| `version`         | Version of the information shown. A new version asks the data subject again.                |
| `individualGrant` | Left out of "Aceitar todas"; asked in the center or with `openPreferences(['id'])`.         |
| `integrations`    | `'google-analytics'`, `'google-ads'`: cookies deleted on revocation and Consent Mode types. |
| `cookies`         | Own cookie names deleted on revocation; a trailing `*` matches any suffix.                  |
| `consentMode`     | Consent Mode types controlled by the purpose, besides the ones of its integrations.         |

### Returned object

`init` returns the manager (`getSnapshot`, `subscribe`), the actions `decide`, `grantAll`, `denyAll`, `adopt` and `sync`, plus `openPreferences(purposes?)`, `onGranted(purpose, fn)`, `scan(root?)` for elements inserted later, and `destroy()`.

## Architecture

One npm package with subpaths. Each one is optional, and whoever imports only the core does not load the rest. No module has a side effect on import, and every subpath can be imported on the server.

| Subpath           | What it does                                                                        | Guide                           |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| `lgpder`          | core: consent state per purpose, decisions, expiry, record, notifications           | [api.md](docs/api.md)           |
| `lgpder/storage`  | persistence in `localStorage`, a cookie or an adapter, and sync between tabs        | [storage.md](docs/storage.md)   |
| `lgpder/scripts`  | blocking of scripts, iframes and images; revocation; cookie cleanup                 | [scripts.md](docs/scripts.md)   |
| `lgpder/google`   | Google Consent Mode v2                                                              | [google.md](docs/google.md)     |
| `lgpder/evidence` | evidence of each decision, sent to the backend of the application                   | [evidence.md](docs/evidence.md) |
| `lgpder/ui`       | Web Components: banner, preferences center, floating button, placeholder of iframes | [ui.md](docs/ui.md)             |
| `lgpder/init`     | single entry point that configures and connects everything                          | [init.md](docs/init.md)         |

```
                 ┌────────────── lgpder/init ──────────────┐
                 ▼            ▼           ▼          ▼      ▼
          lgpder/storage  lgpder/google  lgpder/evidence  lgpder/ui ──(type)──▶ lgpder/scripts
                 │            │           │          │                              │
                 └────────────┴───────────┴────┬─────┴──────────────────────────────┘
                                               ▼
                                        lgpder (core)
```

Every layer depends only on the public API of the core; `init` depends on all of them; no layer depends on `init` or `ui`. The direction is enforced by ESLint rules with fixtures that must fail.

```
lgpder/
├── src/
│   ├── *.ts         core: manager, configuration, record, snapshot, validation
│   ├── storage/     adapters and cross-tab sync
│   ├── scripts/     blocking, revocation, cookie cleanup, integration catalog
│   ├── google/      Consent Mode v2
│   ├── evidence/    evidence transport
│   ├── ui/          Web Components, styles and pt-BR texts
│   └── init/        single entry point
├── test/            one folder per subpath, plus tooling and consumer tests
└── docs/            one guide per subpath
```

Recipes for React, server rendering and Next.js are in [SSR, Next.js and React](docs/ssr-react.md).

## Headless mode

The components are optional. For full control over the interface, use the core and the storage, and build the banner and the preferences center of the application on them; `lgpder/scripts` and `lgpder/google` work the same with any interface.

```ts
import { createConsentManager } from 'lgpder';
import { connectStorage } from 'lgpder/storage';

const consent = createConsentManager({
  purposes: {
    analytics: { version: '2026-10', category: 'statistics' },
    ads: { category: 'marketing' },
    healthReminders: { version: '1', category: 'health', individualGrant: true },
  },
});
const actions = connectStorage(consent); // the interface decides through these actions

// The data subject clicked "accept all": healthReminders stays out (individualGrant).
actions.grantAll();
consent.getSnapshot().status;
// { analytics: 'granted', ads: 'granted', healthReminders: 'pending' }

// The data subject turned the ads off: revoking has the same call shape as granting.
actions.decide({ ads: 'denied' });

// The interface follows the state, including the revocations that come from other tabs.
consent.subscribe(({ snapshot }) => {
  renderPreferences(snapshot.status);
});
```

`renderPreferences` is a function of the application. Call `decide`, `grantAll` and `denyAll` only in response to an explicit action of the data subject. The rules a headless interface should keep are in the [ui guide](docs/ui.md#headless-mode).

## Principles

These hold in every layer and win over any convenience:

1. **Fail closed.** No error, invalid data, storage failure or undetermined state grants consent.
2. **Consent per purpose.** Every decision records one decision per purpose. There is no category, global or wildcard consent.
3. **Decisions only by explicit action of the data subject.** Restoring, syncing between tabs and hydrating never count as one.
4. **Privacy by default.** Options off, the clock rounded to the day, no identifier generated.
5. **No telemetry.** The library sends nothing to third parties.
6. **No runtime dependencies.**
7. **Layers use only the public API of the core.**
8. **Revoking has the same practical effect as granting.** A revocation stops the processing on the page, not only a state.

## Privacy and security

- The record holds only, per purpose, the decision, the version and the day of the decision. No identifier, IP address, user agent or displayed text.
- Saved data is untrusted: it is validated strictly, never throws, and whatever is invalid becomes the absence of a decision. Options are read only as own properties, so a polluted prototype cannot grant consent.
- No `eval`, `new Function` or dynamic `import()`; texts are inserted as text, never as HTML. Strict Content Security Policies are supported (see the [CSP notes](docs/init.md#content-security-policy)).
- The browser storage can be read or changed by any script of the same origin: protect the application against XSS.
- `HttpOnly` cookies and cookies of other domains cannot be deleted from the page; the [scripts guide](docs/scripts.md) lists the limits of the cleanup.

To report a vulnerability, follow the [security policy](SECURITY.md).

## Testing and code quality

```sh
npm ci
npm run check      # format, lint, typecheck, tests with coverage, package checks and size
```

| Script                 | What it runs                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `npm test`             | `node --test` on TypeScript sources, jsdom for the DOM, axe-core for accessibility |
| `npm run lint`         | ESLint, including the rules of dependency direction between layers                 |
| `npm run typecheck`    | the project, plus a DOM-free check of the core                                     |
| `npm run test:package` | build, `publint --strict`, `attw` and type checks of the published package         |
| `npm run size`         | `size-limit`: core up to 3 kB and every subpath together up to 15 kB, gzip         |

The suite has over 1,400 tests, with a 90% coverage gate (currently 100% of lines and functions). The acceptance test runs the quick start above in jsdom.

## Known limitations

These reflect the current version and are good candidates for contributions:

- **No real-browser test suite.** Everything is tested in jsdom; layout, `sendBeacon` and the browser matrix are not exercised in real browsers.
- **Only the Google Consent Mode v2 as a built-in integration.** Other trackers (Meta Pixel, Clarity, Hotjar) can be blocked with `data-consent` and their cookies listed in `cookies`, but have no catalog entry.
- **No automatic interception of dynamically inserted scripts.** Elements inserted later are processed by `scan()`, and application code can run through `onGranted`. This is deliberate: interception is fragile and fails silently.
- **Brazilian Portuguese only in the interface.** Every text can be replaced, but no other language is bundled.
- **No CDN build or `<script>` tag usage.** Install from npm and bundle it.
- **No framework bindings.** React, Vue and Next.js use the core directly, as the [recipes](docs/ssr-react.md) show.
- **Cookie cleanup limits.** `HttpOnly`, `Partitioned`, other-path and other-domain cookies cannot be deleted from the page.

## Project status

LGPDer is in early development (`0.x` releases on npm). The workflow of banner, preferences, persistence, blocking, revocation and Consent Mode is implemented and tested, and the API may still change before 1.0.

The package follows Semantic Versioning: additions come in a minor version; until 1.0, changes of semantics or of the record format also come in a minor version, recorded in the [CHANGELOG](CHANGELOG.md).

## Legal notice

LGPDer is a technical library to record, read, change and revoke consent decisions per purpose, and to apply them on the page. Using it does not, by itself, make an application compliant with Law No. 13,709/2018 (LGPD) or any other rule. The controller remains responsible for, among other points:

- choosing the legal basis of each processing (consent is only one of the bases of art. 7);
- informing the data subject clearly before asking for consent (art. 8, § 4, and art. 9), including the texts shown by the components;
- conditioning the processing on the recorded decisions, also for code and cookies the library cannot reach;
- proving that consent was obtained lawfully (art. 8, § 2), for which the records of LGPDer are support, not proof;
- following the rules for sensitive data (art. 11) and data of children and adolescents (art. 14);
- deciding, as a legal matter, whether to use the advanced mode of the Google Consent Mode.

This notice is informative and is not legal advice. The guide [O LGPDer e a LGPD](docs/lgpd.md), in Portuguese, relates the library to the law topic by topic, telling apart legal obligations, good practices of the ANPD and technical decisions of the library.

## Documentation

- [Core API reference](docs/api.md)
- [Storage and cross-tab sync](docs/storage.md)
- [Scripts, iframes and revocation](docs/scripts.md)
- [Google Consent Mode v2](docs/google.md)
- [Evidence of consent](docs/evidence.md)
- [Components](docs/ui.md)
- [Single entry point](docs/init.md)
- [SSR, Next.js and React](docs/ssr-react.md)
- [O LGPDer e a LGPD](docs/lgpd.md) (in Portuguese)
- [CHANGELOG](CHANGELOG.md)

## Contributing

Contributions of all sizes are welcome: bug reports, documentation fixes, tests and new integrations. The [contributing guide](CONTRIBUTING.md) covers the development setup, the project conventions and the pull request checklist.

- **Found a bug?** Open a [bug report](https://github.com/azevedo1z/LGPDer/issues/new?template=bug_report.yml).
- **Have an idea?** Open a [feature request](https://github.com/azevedo1z/LGPDer/issues/new?template=feature_request.yml). The [known limitations](#known-limitations) are a good starting point.
- **Found a security issue?** Do not open a public issue; follow the [security policy](SECURITY.md).

## License

LGPDer is released under the [MIT License](LICENSE).
