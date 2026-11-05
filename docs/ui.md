# Components (`lgpder/ui`)

`lgpder/ui` has the banner, the preferences center, the floating button and the placeholder of blocked iframes, as Web Components with an open shadow root. They render the current state of the manager and decide only on an explicit action of the data subject, one decision per purpose. They are customized by CSS custom properties and `::part()`, every text can be replaced, and the built-in texts are in Brazilian Portuguese. [`init`](init.md) mounts them for you; applications that want their own interface use the [headless mode](#headless-mode).

```ts
import { createConsentManager } from 'lgpder';
import { connectStorage } from 'lgpder/storage';
import { mountUi } from 'lgpder/ui';

const consent = createConsentManager({
  purposes: { analytics: { category: 'statistics' }, ads: { category: 'marketing' } },
});
const storage = connectStorage(consent);
const ui = mountUi(consent, {
  actions: storage,
  purposes: {
    analytics: { title: 'Estatísticas', description: 'Google Analytics.' },
    ads: { title: 'Publicidade', description: 'Anúncios personalizados do Google Ads.' },
  },
});
```

| Export                                                   | Kind      | Role                                         |
| -------------------------------------------------------- | --------- | -------------------------------------------- |
| [`mountUi`](#mountuiconsent-options)                     | function  | mounts the banner, the center and the button |
| [`createPlaceholder`](#createplaceholderconsent-options) | function  | renderer of the placeholders of iframes      |
| [`ptBR`](#texts-and-languages)                           | constant  | built-in texts, in Brazilian Portuguese      |
| [`UiOptions<P>`](#options)                               | interface | options of `mountUi`                         |
| [`PlaceholderOptions<P>`](#options)                      | interface | options of `createPlaceholder`               |
| [`UiActions<P>`](#options)                               | type      | decision actions the components call         |
| [`UiPurposeTexts`](#options)                             | interface | title and description of a purpose           |
| [`UiTexts`](#texts-and-languages)                        | interface | every text of the components                 |
| [`UiTextsOverride`](#texts-and-languages)                | type      | partial texts merged over `ptBR`             |
| [`ConsentUi<P>`](#mountuiconsent-options)                | interface | handle                                       |

## `mountUi(consent, options?)`

```ts
export declare function mountUi<P extends string>(
  consent: ConsentManager<P>,
  options?: UiOptions<P>,
): ConsentUi<P>;

export interface ConsentUi<P extends string = string> {
  readonly openPreferences: (purposes?: readonly P[]) => void;
  readonly destroy: () => void;
}
```

Mounts the banner (`<lgpder-banner>`), the preferences center (`<lgpder-preferences>`) and the floating button (`<lgpder-button>`), inserted first in the `<body>`, so the banner comes first in the tab order. While the document loads, they are inserted on `DOMContentLoaded`. One controller, subscribed to the manager, renders the three from `getSnapshot()`.

- Parameters: `consent`; `options` ([`UiOptions<P>`](#options)).
- Returns: frozen handle. `openPreferences(purposes?)` opens the center (see [Asking for a purpose in context](#asking-for-a-purpose-in-context)); `destroy()` closes the center, removes the components and restores the page, idempotent. After `destroy`, `openPreferences` throws `Error('[lgpder] This instance was destroyed.')`.
- Errors: `TypeError` for invalid options, `RangeError` for a purpose that is not configured, validated before anything is defined or inserted, in this order: options, unknown keys, `actions`, `purposes`, `texts`, `wouldReload`, `floatingButton`. `Error` when a custom element of the components is defined by another copy of the library. The messages are in [Errors](#errors).

Outside the browser (no `document`), the options are validated and the handle does nothing. The components render only on the client.

### Banner

- Shown while some purpose **without** `individualGrant` is `'pending'` and the center is closed: the first visit, an expired decision, a new version of a purpose (`outdated`) and a storage failure. On a new version, the banner opens again in full, with every purpose; a data subject who clicks "Rejeitar todas" to close it also refuses the purposes that did not change, a risk accepted by the specification.
- A non-modal region labelled by its title, with the description, the list of the purposes "Aceitar todas" reaches (every purpose without `individualGrant`, in configuration order), and three buttons in this order: "Aceitar todas" (`actions.grantAll()`), "Rejeitar todas" (`actions.denyAll()`) and "Personalizar" (opens the center). The three have the **same visual emphasis**, as the ANPD recommends: same part, same style.
- Purposes with `individualGrant` never open the banner: "Aceitar todas" would not reach them, and asking for them on every page after it would be a nuisance. Ask for them in the center or [in context](#asking-for-a-purpose-in-context).
- Never taller than the viewport: past that height (a large zoom, a small screen), its content scrolls inside it, so the title and the description stay reachable (WCAG 1.4.4 and 1.4.10).
- While it is shown, the `scroll-padding-bottom` of the root element is the height of the banner, at most the height of the window, read again on each render and on `resize`, so the focus is never hidden behind it (WCAG 2.4.11); the previous inline value is restored when it hides.

### Preferences center

- A modal dialog over a backdrop, labelled by its title and described by its description.
- The informative section "Necessários (sempre ativos)", without a switch and without state in the core, with configurable texts. Only in the full center.
- One switch per purpose, labelled by its title and described by its description, **no category switch**. Purposes are grouped by category, in the order of first appearance, titled by `texts.categories[category]` or by the category id; purposes without a category, when others have one, go to a last group "Outras finalidades"; when no purpose has a category, the list is flat.
- `'pending'` purposes are shown **off**, never pre-checked. Purposes with `individualGrant` are highlighted, with a badge ("Exige sua autorização específica") and their own switch.
- "Salvar" records the switches the data subject changed since the center opened, and, as refused, the pending purposes without `individualGrant` left off; purposes already decided and left alone are omitted, so an outdated page never writes back a grant revoked in another tab, and so are the pending ones with `individualGrant`, which the data subject did not consider. Switches not touched follow the state of the manager while the center is open. Then the center closes.
- The save button reads "Salvar e recarregar" when `wouldReload(choices)` says the choices would reload the page (in `init`, `wouldReload` of the scripts layer), recomputed on each switch.
- `Esc` and "Fechar" close without saving.

### Floating button

Shown while the banner and the center are hidden, unless `floatingButton: false`; it opens the full center. It is a round button of 48 px at the bottom left, with an icon hidden from assistive technology and the accessible name of `texts.button.label`. Revoking must be as easy as granting (LGPD, art. 8, § 5): hide it only if the application offers another access, such as a "Privacy preferences" link in the footer that calls `openPreferences()`. With every purpose marked `individualGrant`, the banner never shows, and the button is the door to the center.

### Asking for a purpose in context

`openPreferences()` opens the full center. `openPreferences(['healthReminders'])` opens the center with only the listed purposes, in configuration order and without repetition, without the section of the necessary cookies: the way to ask for a decision on a purpose with `individualGrant` where the feature that needs it is used.

```ts
document.querySelector('#enable-reminders')?.addEventListener('click', () => {
  ui.openPreferences(['healthReminders']);
});
```

A call with the center open replaces its content and discards the switches touched. Before `DOMContentLoaded`, the center opens, focused, as soon as the components are inserted.

### Actions that fail

An action that throws (for example, a custom clock that throws in `decide`) leaves the banner or the center open, so the data subject sees that the decision was not recorded, and the error is rethrown in a microtask. A `wouldReload` that throws counts as `false`, and its error is rethrown the same way.

## `createPlaceholder(consent, options?)`

```ts
export declare function createPlaceholder<P extends string>(
  consent: ConsentManager<P>,
  options?: PlaceholderOptions<P>,
): PlaceholderRenderer<P>;
```

Creates the renderer of the placeholders, to pass as `renderPlaceholder` to [`connectScripts`](scripts.md#placeholders). Each placeholder (`<lgpder-placeholder>`) takes the `width` and `height` of its iframe (a bare number in pixels), names the purposes of the iframe in `texts.placeholder.description` (`{purposes}` is replaced by their titles, separated by commas) and has two buttons:

- "Carregar" loads only this content, on this page, **without recording a decision**. The content is blocked again if one of its purposes is later refused.
- "Permitir sempre" grants every purpose of the iframe through `actions.decide`.

```ts
import { connectScripts } from 'lgpder/scripts';
import { createPlaceholder } from 'lgpder/ui';

connectScripts(consent, {
  renderPlaceholder: createPlaceholder(consent, {
    actions: storage,
    purposes: { videos: { title: 'Vídeos do YouTube' } },
  }),
});
```

Outside the browser, the options are validated and the renderer is never called. The errors are the ones of the shared options of `mountUi`.

## Options

```ts
export interface UiPurposeTexts {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

export type UiActions<P extends string = string> = Pick<
  ConsentManager<P>,
  'decide' | 'grantAll' | 'denyAll'
>;

export interface PlaceholderOptions<P extends string = string> {
  readonly actions?: UiActions<P> | undefined;
  readonly purposes?: { readonly [K in P]?: UiPurposeTexts } | undefined;
  readonly texts?: UiTextsOverride | undefined;
}

export interface UiOptions<P extends string = string> extends PlaceholderOptions<P> {
  readonly wouldReload?: ((choices: ConsentChoices<P>) => boolean) | undefined;
  readonly floatingButton?: boolean | undefined;
}
```

Read only as own properties, so a `floatingButton: false` planted on a polluted prototype never hides the access to the revocation; unknown keys are refused.

- `actions`: the decision actions the components call. Pass the actions of [`connectStorage`](storage.md#consentstorage), which adopt the saved record before deciding; default: the manager itself. They are called as methods (`actions.decide(...)`), so an object whose functions depend on `this` works.
- `purposes`: the title and the description of each purpose. The title labels its switch; default: the purpose id.
- `texts`: texts merged over the built-in Brazilian Portuguese (see [Texts and languages](#texts-and-languages)).
- `wouldReload`: whether saving these choices would reload the page. Default: `() => false`.
- `floatingButton`: whether to show the floating button. Default: `true`.

Every text must be a non-empty string: an empty one would leave a button or a switch without an accessible name. A field given as `undefined` keeps the built-in text.

## Texts and languages

Texts are grouped by component in [`UiTexts`](#texts-and-languages); `ptBR` has the built-in Brazilian Portuguese, deeply frozen. `texts` is merged over `ptBR` one level deep: `lang` is replaced, each group is merged field by field and `categories` key by key. Texts are always inserted as text, never as HTML, so a text cannot inject markup.

```ts
export interface UiTexts {
  readonly lang: string;
  readonly banner: {
    readonly title: string;
    readonly description: string;
    readonly acceptAll: string;
    readonly rejectAll: string;
    readonly customize: string;
  };
  readonly preferences: {
    readonly title: string;
    readonly description: string;
    readonly save: string;
    readonly saveAndReload: string;
    readonly close: string;
    readonly individualGrant: string;
    readonly otherPurposes: string;
  };
  readonly necessary: { readonly title: string; readonly description: string };
  readonly button: { readonly label: string };
  readonly placeholder: {
    readonly description: string;
    readonly load: string;
    readonly allowAlways: string;
  };
  readonly categories: { readonly [category: string]: string };
}
```

- `lang`: the `lang` attribute of the components (`'pt-BR'`), so assistive technology reads them in the right language (WCAG 3.1.2).
- `preferences.saveAndReload`: label of the save button when saving reloads the page.
- `preferences.individualGrant`: badge of the purposes with `individualGrant`.
- `preferences.otherPurposes`: title of the group of the purposes without category, when others have one.
- `placeholder.description`: contains `{purposes}`, replaced by the titles of the purposes of the iframe.
- `categories`: title of each category; built-in: `statistics` (Estatísticas), `marketing`, `functional` (Funcionalidade) and `personalization` (Personalização). A category without a title is shown by its id.

Changing a few texts:

```ts
mountUi(consent, {
  actions: storage,
  texts: {
    banner: { title: 'Cookies e privacidade' },
    categories: { health: 'Saúde' },
  },
});
```

Another language is a complete `UiTexts`, passed as `texts`. The library ships only Brazilian Portuguese; for example, in English:

```ts
import type { UiTexts } from 'lgpder/ui';

export const en: UiTexts = {
  lang: 'en',
  banner: {
    title: 'Your privacy',
    description:
      'We use cookies and similar technologies for the purposes below only with your consent. You can accept all, reject all or choose per purpose, and change your mind at any time.',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    customize: 'Customize',
  },
  preferences: {
    title: 'Privacy preferences',
    description:
      'Choose, for each purpose, whether you consent. You can change your choices at any time.',
    save: 'Save',
    saveAndReload: 'Save and reload',
    close: 'Close',
    individualGrant: 'Requires your specific authorization',
    otherPurposes: 'Other purposes',
  },
  necessary: {
    title: 'Necessary (always active)',
    description:
      'Essential for the site to work, such as security and the record of your choices. They do not depend on consent.',
  },
  button: { label: 'Privacy preferences' },
  placeholder: {
    description: 'This content depends on your consent for: {purposes}.',
    load: 'Load',
    allowAlways: 'Always allow',
  },
  categories: {
    statistics: 'Statistics',
    marketing: 'Marketing',
    functional: 'Functionality',
    personalization: 'Personalization',
  },
};
```

## Theming

The components isolate their style in the shadow root (`all: initial` on the host), and the page customizes them in two ways, which take precedence over the defaults.

**CSS custom properties**, set on any ancestor, such as `:root`:

| Property                      | Default                     | Use                                                      |
| ----------------------------- | --------------------------- | -------------------------------------------------------- |
| `--lgpder-font-family`        | `system-ui, sans-serif`     | font of every component                                  |
| `--lgpder-color-background`   | `#ffffff`                   | background of the banner, the dialog and the placeholder |
| `--lgpder-color-text`         | `#1f2328`                   | text                                                     |
| `--lgpder-color-muted`        | `#57606a`                   | descriptions, and the border of a switch that is off     |
| `--lgpder-color-primary`      | `#0b57d0`                   | buttons, a switch that is on, the badge                  |
| `--lgpder-color-primary-text` | `#ffffff`                   | text on the primary color                                |
| `--lgpder-color-border`       | `#d0d7de`                   | decorative borders                                       |
| `--lgpder-color-focus`        | `#0b57d0`                   | focus outline                                            |
| `--lgpder-radius`             | `8px`                       | corner radius                                            |
| `--lgpder-z-index`            | `2147483000`                | stacking of the banner, the center and the button        |
| `--lgpder-shadow`             | `0 4px 24px rgba(0,0,0,.2)` | shadow of the banner, the dialog and the placeholder     |

**`::part()`**, to style an element inside a component:

| Component            | Parts                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lgpder-banner`      | `banner`, `title`, `description`, `purposes`, `purpose`, `actions`, `button`                                                                                                                                                |
| `lgpder-preferences` | `backdrop`, `dialog`, `title`, `description`, `necessary`, `necessary-title`, `category`, `category-title`, `purpose`, `individual`, `purpose-title`, `badge`, `purpose-description`, `switch`, `footer`, `button`, `close` |
| `lgpder-button`      | `button`                                                                                                                                                                                                                    |
| `lgpder-placeholder` | `placeholder`, `description`, `actions`, `button`                                                                                                                                                                           |

```css
:root {
  --lgpder-font-family: 'Inter', sans-serif;
  --lgpder-color-primary: #1a7f37;
  --lgpder-color-focus: #1a7f37;
  --lgpder-radius: 4px;
}

lgpder-banner::part(banner) {
  max-width: 720px;
}

/* Keep the three buttons of the banner alike: the same emphasis is a recommendation of the ANPD. */
lgpder-banner::part(button) {
  text-transform: uppercase;
}
```

A custom theme is the responsibility of the application: keep the text contrast at 4.5:1 or more, the contrast of the focus outline and of the switches at 3:1 or more, and the three buttons of the banner with the same emphasis.

## Accessibility

The components target WCAG 2.2 AA:

- keyboard: every control is a `<button>`; the banner is the first stop of the tab order;
- the center traps the focus while open (`Tab` and `Shift+Tab` wrap around its controls, also after a click on its text or on the backdrop, and a focus moved to the page behind by a script comes back), `Esc` closes it, and the focus goes back where it was when it opened, or to the floating button when that element is gone or hidden; it is never left on a hidden element;
- roles and names: the banner is a labelled region, the center a dialog with `aria-modal`, each switch has `role="switch"`, `aria-checked` and the title of its purpose as its name, the floating button has an accessible name;
- default theme: text contrast from 6.39:1 to 15.8:1, focus outline and switches at 3:1 or more, buttons and switches at least 24 by 24 CSS pixels;
- the banner scrolls inside the viewport instead of growing past it, the focus is never hidden by the banner (`scroll-padding-bottom`), and the components declare their language.

The test suite runs axe-core on each component (banner, full center with categories, the necessary section and `individualGrant`, flat center, floating button, placeholder) with the WCAG 2.0, 2.1 and 2.2 A and AA rules and the best practices, without violations. Two rules are checked by other means, because the test DOM (jsdom) has no layout: the contrast is computed from the default style sheet, and **`target-size` is not checked by axe**: the minimum size of the targets and the height limit of the banner are checked on the CSS. An automated check does not replace a test with assistive technology on the real page.

## Content Security Policy

Each component has a `<style>` element in its shadow root, which a policy without `'unsafe-inline'` in `style-src` blocks unless it allows its hash. The hash of the style sheet of this version is:

```text
'sha256-4ydU48/z3O6bG7Uy7CrY8iBC4yxZjQd3PBxuXb7XpV4='
```

It changes whenever the style sheet changes; the [CHANGELOG](../CHANGELOG.md) says when. The components set no nonce on it. The sizes of the placeholder and the `scroll-padding-bottom` of the root are set through the CSSOM (`style.setProperty`), which CSP does not restrict.

## Headless mode

The components are optional. An application that wants full control builds its own interface on the core and the storage, keeping the same rules: the banner shown while a purpose without `individualGrant` is `'pending'`, "accept all" and "reject all" with the same emphasis, one switch per purpose, pending purposes off, a permanent access to the preferences, and decisions only on an explicit action of the data subject, through the actions of the storage.

```ts
import { createConsentManager } from 'lgpder';
import { connectStorage } from 'lgpder/storage';

const consent = createConsentManager({
  purposes: { analytics: {}, ads: {}, healthReminders: { individualGrant: true } },
});
const actions = connectStorage(consent);

const banner = document.querySelector<HTMLElement>('#consent-banner');

function render(): void {
  const { status } = consent.getSnapshot();
  const asked = Object.entries(consent.purposes)
    .filter(([, config]) => config.individualGrant !== true)
    .some(([id]) => status[id as keyof typeof status] === 'pending');
  if (banner) banner.hidden = !asked;
}

render();
consent.subscribe(render);
document.querySelector('#accept-all')?.addEventListener('click', actions.grantAll);
document.querySelector('#reject-all')?.addEventListener('click', actions.denyAll);
```

The [scripts layer](scripts.md) works the same with a headless interface. For React, see [SSR, Next.js and React](ssr-react.md).

## Errors

All of them are thrown synchronously, before anything is defined or inserted. `{json(x)}` is `JSON.stringify(x)` of a string; `{quoted(x)}` quotes a value given in a list or as an argument: a string as `JSON.stringify(x)`, any other primitive as `JSON.stringify(String(x))` (`1` gives `"1"`, a hole of an array gives `"undefined"`), and an object or a function by its type (`"object"`, `"function"`), without calling its code.

| Function                       | Class        | When                                            | Message                                                                                                                                                                             |
| ------------------------------ | ------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mountUi`, `createPlaceholder` | `TypeError`  | options are not an object                       | `[lgpder] Options must be an object.`                                                                                                                                               |
| `mountUi`, `createPlaceholder` | `TypeError`  | unknown option, at any level but `categories`   | `[lgpder] Unknown option: {json(key)}.`                                                                                                                                             |
| `mountUi`, `createPlaceholder` | `TypeError`  | `actions` without the three functions           | `[lgpder] "actions" must have the functions decide, grantAll and denyAll.`                                                                                                          |
| `mountUi`, `createPlaceholder` | `TypeError`  | `purposes` is not an object                     | `[lgpder] "purposes" must be an object.`                                                                                                                                            |
| `mountUi`, `createPlaceholder` | `RangeError` | `purposes` names a purpose not configured       | `[lgpder] Unknown purpose: {json(id)}.`                                                                                                                                             |
| `mountUi`, `createPlaceholder` | `TypeError`  | texts of a purpose are not an object            | `[lgpder] The texts of {json(id)} must be an object.`                                                                                                                               |
| `mountUi`, `createPlaceholder` | `TypeError`  | a text is not a non-empty string                | `[lgpder] "{path}" must be a non-empty string.`, such as `[lgpder] "texts.banner.title" must be a non-empty string.` or `[lgpder] "purposes.ads.title" must be a non-empty string.` |
| `mountUi`, `createPlaceholder` | `TypeError`  | `texts` is not an object                        | `[lgpder] "texts" must be an object.`                                                                                                                                               |
| `mountUi`, `createPlaceholder` | `TypeError`  | a group of `texts` is not an object             | `[lgpder] "texts.{group}" must be an object.`                                                                                                                                       |
| `mountUi`                      | `TypeError`  | `wouldReload` is not a function                 | `[lgpder] "wouldReload" must be a function.`                                                                                                                                        |
| `mountUi`                      | `TypeError`  | `floatingButton` is not a boolean               | `[lgpder] "floatingButton" must be a boolean.`                                                                                                                                      |
| `mountUi`, `createPlaceholder` | `Error`      | a tag is defined by another copy of the library | `[lgpder] The custom element "{tag}" is already defined by another copy of lgpder.`                                                                                                 |
| `openPreferences`              | `TypeError`  | `purposes` is not a non-empty array             | `[lgpder] "purposes" must be a non-empty array.`                                                                                                                                    |
| `openPreferences`              | `RangeError` | an item is not a configured purpose             | `[lgpder] Unknown purpose: {quoted(item)}.`                                                                                                                                         |
| `openPreferences`              | `Error`      | called after `destroy`                          | `[lgpder] This instance was destroyed.`                                                                                                                                             |
