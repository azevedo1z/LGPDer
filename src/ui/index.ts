/**
 * LGPDer ui: the banner, the preferences center, the floating button and the placeholder of
 * blocked iframes, as Web Components with an open shadow root.
 *
 * The components decide only on an explicit action of the data subject, one decision per purpose,
 * and render the current state of the manager. They are customized by the `--lgpder-*` custom
 * properties and by `::part()`, and every text can be replaced; the built-in texts are in Brazilian
 * Portuguese. The custom elements are defined on demand, by {@link mountUi} and
 * {@link createPlaceholder}: importing the layer has no side effect and works on the server.
 *
 * @packageDocumentation
 */

export type { ConsentUi } from './mount.ts';
export type { PlaceholderOptions, UiActions, UiOptions, UiPurposeTexts } from './options.ts';
export type { UiTexts, UiTextsOverride } from './texts.ts';
export { mountUi } from './mount.ts';
export { createPlaceholder } from './placeholder.ts';
export { ptBR } from './texts.ts';
