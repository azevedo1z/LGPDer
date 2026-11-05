# LGPDer

Open-source, lightweight, typed consent manager for web applications, with the Brazilian LGPD (Lei Geral de Proteção de Dados Pessoais) as reference. Leia em português: [README.pt-BR.md](README.pt-BR.md).

With a few lines of configuration, an application gets a consent banner, a preferences center, persistence, sync between tabs, blocking of scripts, iframes and images until there is consent, cleanup on revocation and the Google Consent Mode v2. There is no backend, no telemetry and no runtime dependency. Whoever wants full control uses only the core, headless.

## Notice: LGPDer does not guarantee LGPD compliance

LGPDer is a technical library to record, read, change and revoke consent decisions per purpose, and to apply them on the page. Using LGPDer does not, by itself, make an application compliant with Law No. 13,709/2018 (Lei Geral de Proteção de Dados Pessoais, LGPD) or with any other rule. Compliance depends on the context of the processing and on how the application uses the library.

The controller remains responsible for, among other points:

- choosing the legal basis of each processing, keeping in mind that consent is only one of the bases of art. 7 of the LGPD;
- defining determined purposes and informing the data subject in a clear, adequate and prominent way before asking for consent (art. 8, § 4, and art. 9), including the texts shown by the components;
- offering a free and easy procedure to revoke consent (art. 8, § 5), which the floating button of the components supports;
- actually conditioning the processing on the recorded decisions, also for the code and the cookies the library cannot reach, and stopping it when consent is revoked;
- proving that consent was obtained lawfully (art. 8, § 2);
- following the specific rules for sensitive personal data (art. 11) and for data of children and adolescents (art. 14 of the LGPD and, when applicable, Law No. 15,211/2025);
- deciding, as a legal matter, whether to use the advanced mode of the Google Consent Mode, which sends signals to Google before consent;
- meeting the rights of the data subjects (art. 18) and the other obligations of the LGPD.

The records kept by LGPDer (purpose, decision, date and version) support these tasks, but are not, on their own, proof of consent. They are created and stored in the environment of the application and can be changed in that environment.

The documentation tells apart three kinds of guidance. Legal obligations are given with the provision of the LGPD. Recommendations based on guides of the ANPD (the Brazilian data protection authority), such as the Guia Orientativo: Cookies e Proteção de Dados Pessoais, are good practices, not legal obligations. Behaviors and implementation choices of the library are technical decisions, not requirements of the LGPD.

LGPDer collects no personal data on its own initiative, performs no tracking or telemetry and sends nothing to third parties. The only network request it makes is the optional evidence of each decision, sent to an endpoint of the application itself, and only when configured. Its maintainers receive no data from the applications that use it.

This notice is informative and is not legal advice. Assess the use of the library with the data protection officer or the legal counsel of your organization.

## Installation and requirements

```sh
npm install lgpder
```

- ESM-only package, without runtime dependencies.
- Browsers with ES2022 support (Chrome and Edge 93+, Firefox 92+, Safari 15.4+).
- Node.js 22.12 or later, when used in Node (server rendering, tests). From that version on, ES modules can also be loaded with `require`, without a flag.
- TypeScript ESM projects, with `moduleResolution` set to `node16`, `nodenext` or `bundler`. Until 1.0, the published types are checked only with the TypeScript version of the repository (6.0).
- TypeScript CommonJS projects, where `import` is compiled to `require`: a TypeScript version that accepts `require` of ES modules is needed, with `module` set to `nodenext` or `node20`; this combination is not checked in the repository. Otherwise, load the package with a dynamic `import()`.
- No build for a CDN or for use through a `<script>` tag in this version: install from npm and bundle it.

## Quick start

Configure the purposes once, in the entry point of the application:

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

Mark the Google tag with `data-consent`, so it stays blocked until `analytics` is granted:

<!-- prettier-ignore -->
```html
<script type="text/plain" data-consent="analytics"
        data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
```

And set the default of the Google Consent Mode, every type denied, in the `<head>`, before any Google tag. It is the text of `consentDefaultSnippet`, exported by `lgpder/google` for frameworks that render the `<head>` (see the [google guide](docs/google.md#the-default-before-the-google-tag)):

<!-- prettier-ignore -->
```html
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'denied',wait_for_update:500});</script>
```

That is all. The page now has:

- a banner, while some purpose is undecided, with "Aceitar todas", "Rejeitar todas" and "Personalizar" with the same emphasis;
- a preferences center, with one switch per purpose grouped by category, pending purposes off, and a floating button that reopens it after the first decision;
- persistence in `localStorage` and sync between tabs: a revocation in one tab reaches the others;
- the Google tag blocked until `analytics` is granted, and the Consent Mode updated on each decision: the [basic mode](docs/google.md#basic-mode-recommended-and-advanced-mode), the recommended one;
- on a revocation: the cookies of Google Analytics removed, the Consent Mode updated to `denied` and, since the Google tag cannot be stopped, the page reloaded once the revocation is saved;
- decisions that expire after 365 days, after which the banner asks again.

The texts of the components are in Brazilian Portuguese and can all be replaced. This example is the acceptance test of the project (`test/init/acceptance.test.ts`); [`init`](docs/init.md) has every option.

## Principles

These hold in every layer and win over any convenience:

1. **Fail closed.** No error, invalid data, storage failure or undetermined state grants consent. When in doubt, the purpose is treated as not granted.
2. **Consent per purpose.** Every decision records one decision per purpose. There is no category, global or wildcard consent; a category is only a grouping label.
3. **Decisions only by explicit action of the data subject.** Restoring, syncing between tabs and hydrating never count as an expression of the data subject.
4. **Privacy by default.** The default is always the most private: options off, the clock rounded to the day, no identifier generated.
5. **No telemetry.** The library sends nothing to third parties.
6. **No runtime dependencies.**
7. **Layers use only the public API of the core.** No layer reaches into another.
8. **Revoking has the same practical effect as granting.** A revocation stops the processing on the page, not only a state.

## Subpaths

One npm package with subpaths. Each one is optional, and whoever imports only the core does not load the rest. No module has a side effect on import, and every subpath can be imported on the server.

| Subpath           | What it does                                                                        | Guide                           |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| `lgpder`          | core: state of the consent per purpose, decisions, expiry, record, notifications    | [api.md](docs/api.md)           |
| `lgpder/storage`  | persistence in `localStorage`, a cookie or an adapter, and sync between tabs        | [storage.md](docs/storage.md)   |
| `lgpder/scripts`  | blocking of scripts, iframes and images; revocation; cookie cleanup                 | [scripts.md](docs/scripts.md)   |
| `lgpder/google`   | Google Consent Mode v2                                                              | [google.md](docs/google.md)     |
| `lgpder/evidence` | evidence of each decision, sent to the backend of the application                   | [evidence.md](docs/evidence.md) |
| `lgpder/ui`       | Web Components: banner, preferences center, floating button, placeholder of iframes | [ui.md](docs/ui.md)             |
| `lgpder/init`     | single entry point that configures and connects everything                          | [init.md](docs/init.md)         |

Every layer depends on the core; `init` depends on all of them; `ui` uses only a type of `scripts`; no layer depends on `init` or on `ui`. Size, minified and gzipped, as measured by `size-limit` in the CI: the core up to 3 kB and all the subpaths together up to 15 kB.

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

`renderPreferences` is a function of the application. Call `decide`, `grantAll` and `denyAll` only in response to an explicit action of the data subject, never by inference. The rules a headless interface should keep are in the [ui guide](docs/ui.md#headless-mode).

## Key concepts

- **Purpose**: a determined purpose of a consent-based processing, declared in `purposes` and identified by an id. It is the unit of decision: there is no global consent, no category consent and no id with special meaning. The configuration holds only the processing the controller decided to base on consent (art. 7, I), without "always active" items or presumed legal bases.
- **Category**: optional label that groups purposes, for example in the preferences center, without a consent state of its own.
- **Effective status**: `'pending'`, `'granted'` or `'denied'`. Only `'granted'` authorizes the consent-based processing. The absence of a decision is `'pending'` and never amounts to consent.
- **Decision**: a grant or a refusal recorded for a purpose, with the current version and the instant (`decidedAt`, rounded to the start of the UTC day by default). Revoking is recording `'denied'`.
- **Version and `outdated`**: optional opaque version per purpose. A decision recorded under another version is `'pending'` and flagged in `outdated`, and the banner asks again.
- **Expiry**: decisions, grants and refusals, expire after `maxAge` (default: 365 days).
- **Record**: serializable object with the last decision of each purpose, saved by the storage and treated as untrusted data whenever it is read.
- **`individualGrant`**: a purpose out of "accept all" (`grantAll`), granted only when named; for purposes that require a specific decision, such as the ones involving sensitive data or data of children.

The full rules are in the [core reference](docs/api.md).

## Privacy and security

- The record holds only, per purpose, the decided status, the version and the instant of the decision. No identifier of the data subject, IP address, user agent, language or displayed text. Depending on the context, for example when tied to an account, it may be personal data (art. 5, I).
- The default clock rounds `decidedAt` to the start of the UTC day, so it does not work as a pseudo-identifier of the browser.
- Saved data is validated strictly and never causes an error; whatever is invalid becomes the absence of a decision. Options of the layers are read only as own properties, so a polluted prototype cannot grant, send or turn off the revocation.
- The storage of the browser can be read or changed by any script of the same origin: protect the application against XSS and assess the third-party scripts it loads.
- With the cookie storage, the record goes to the server on every request to the domain.
- No `eval`, `new Function` or dynamic `import()`; texts of the components are inserted as text, never as HTML. Strict Content Security Policies are supported: see the [CSP notes](docs/init.md#content-security-policy).

## Scope

Out of scope in this version:

- a build for a CDN and use through a `<script>` tag;
- framework bindings (React, Vue, Next.js): the core works with them directly, as the [recipes](docs/ssr-react.md) show;
- automatic interception of dynamically inserted scripts: elements inserted later are processed by an explicit `scan()`, and code can be loaded with `onGranted`;
- integrations other than the Google Consent Mode v2 (Meta Pixel, Clarity, Hotjar): their scripts can be blocked with `data-consent` and their cookies removed with `cookies`;
- interface languages other than Brazilian Portuguese: every text can be replaced, and another language is a complete set of texts;
- a backend, an admin panel, the handling of requests of data subjects and the generation of privacy policies;
- an identifier of the data subject or of the receipt generated in the browser;
- telemetry of any kind, permanently.

## LGPD

The guide [O LGPDer e a LGPD](docs/lgpd.md), in Portuguese because it deals with Brazilian law, relates the library to the law topic by topic, telling apart:

- **legal obligation**: what the LGPD or another law requires, with the provision, such as the free and easy procedure to revoke consent (art. 8, § 5);
- **good practice**: a recommendation of a guide of the ANPD, with the source, such as the reject button with the same emphasis as the accept button, the options off by default and a new consent after changes, which are not literal requirements of the LGPD;
- **technical decision of LGPDer**: an implementation choice the LGPD does not require, such as the statuses `'pending'`, `'granted'` and `'denied'`, the invalidation by version, the expiry, the reload on a revocation and `individualGrant`.

It also lists the responsibilities of the application, versioning and new consent, expiry (the LGPD sets no validity period nor periodic renewal of consent) and the sources consulted.

## Documentation

- [Core API reference](docs/api.md): signatures, errors, typing, notifications.
- [Storage and cross-tab sync](docs/storage.md), [Scripts, iframes and revocation](docs/scripts.md), [Google Consent Mode v2](docs/google.md), [Evidence of consent](docs/evidence.md), [Components](docs/ui.md), [Single entry point](docs/init.md).
- [SSR, Next.js and React](docs/ssr-react.md).
- [O LGPDer e a LGPD](docs/lgpd.md) (in Portuguese).
- [CHANGELOG](CHANGELOG.md).

## Versioning

The package follows Semantic Versioning from version 0.1.0:

- additions are published in a minor version;
- from 1.0.0 on, changes of semantics or of the record format require a major version; before that, they come in a minor version, recorded in the CHANGELOG;
- the error messages are documented, but must not be used for control flow; changes to them are recorded in the CHANGELOG, and so are changes to the CSP hashes of the snippet and of the style sheet.

## License

MIT. See the [LICENSE](LICENSE) file.
