/**
 * Texts of the components: the shape every language follows, and the built-in Brazilian
 * Portuguese. Overrides are merged over {@link ptBR} by the option parser.
 */

/* eslint-disable @typescript-eslint/consistent-indexed-object-style -- the mapped types are the
 * shape of the published API, as in the core. */

/**
 * Every text of the components, grouped by component. Another language is a complete object of
 * this shape, passed as `texts`. Texts are always inserted as text, never as HTML.
 */
export interface UiTexts {
  /** Value of the lang attribute of the components. */
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
    /** Label of the save button when saving reloads the page. */
    readonly saveAndReload: string;
    readonly close: string;
    /** Badge of the purposes with `individualGrant`. */
    readonly individualGrant: string;
    /** Title of the group of the purposes without category, when others have one. */
    readonly otherPurposes: string;
  };
  /** Informative section of the cookies needed by the site, which have no consent state. */
  readonly necessary: { readonly title: string; readonly description: string };
  /** Accessible name of the floating button. */
  readonly button: { readonly label: string };
  /** `description` contains `{purposes}`, replaced by the titles of the purposes of the iframe. */
  readonly placeholder: {
    readonly description: string;
    readonly load: string;
    readonly allowAlways: string;
  };
  /** Title of each category; a category without one is shown by its id. */
  readonly categories: { readonly [category: string]: string };
}

/**
 * Partial texts merged over {@link ptBR}: `lang` replaced, each group merged field by field and
 * `categories` merged key by key.
 */
export type UiTextsOverride = {
  readonly [K in keyof UiTexts]?: UiTexts[K] extends string ? UiTexts[K] : Partial<UiTexts[K]>;
};

/* eslint-enable @typescript-eslint/consistent-indexed-object-style */

/** Built-in texts, in Brazilian Portuguese. Deeply frozen. */
export const ptBR: UiTexts = Object.freeze({
  lang: 'pt-BR',
  banner: Object.freeze({
    title: 'Sua privacidade',
    description:
      'Usamos cookies e tecnologias semelhantes para as finalidades abaixo somente com o seu consentimento. Você pode aceitar todas, rejeitar todas ou escolher por finalidade, e mudar de ideia quando quiser.',
    acceptAll: 'Aceitar todas',
    rejectAll: 'Rejeitar todas',
    customize: 'Personalizar',
  }),
  preferences: Object.freeze({
    title: 'Preferências de privacidade',
    description:
      'Escolha, para cada finalidade, se você consente. Você pode alterar suas escolhas a qualquer momento.',
    save: 'Salvar',
    saveAndReload: 'Salvar e recarregar',
    close: 'Fechar',
    individualGrant: 'Exige sua autorização específica',
    otherPurposes: 'Outras finalidades',
  }),
  necessary: Object.freeze({
    title: 'Necessários (sempre ativos)',
    description:
      'Essenciais para o funcionamento do site, como segurança e o registro das suas escolhas. Não dependem de consentimento.',
  }),
  button: Object.freeze({ label: 'Preferências de privacidade' }),
  placeholder: Object.freeze({
    description: 'Este conteúdo depende do seu consentimento para: {purposes}.',
    load: 'Carregar',
    allowAlways: 'Permitir sempre',
  }),
  categories: Object.freeze({
    statistics: 'Estatísticas',
    marketing: 'Marketing',
    functional: 'Funcionalidade',
    personalization: 'Personalização',
  }),
});
