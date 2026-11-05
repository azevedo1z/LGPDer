/** Texts of the components: the built-in pt-BR, the merge of overrides and text-only insertion. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { UiOptions, UiTexts } from 'lgpder/ui';

import { mountUi, ptBR } from '../../src/ui/index.ts';
import { testDom } from '../support/dom.ts';
import { callUntyped, setup, type PurposeId } from '../support/setup.ts';
import {
  buttonsOf,
  clickButton,
  closeUis,
  openUi,
  purposeTitles,
  shadow,
  textsOf,
} from '../support/ui.ts';

afterEach(() => {
  closeUis();
  testDom.reset();
});

/** A complete set of texts in another language. */
const ENGLISH: UiTexts = {
  lang: 'en',
  banner: {
    title: 'Your privacy',
    description: 'We use cookies only with your consent.',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    customize: 'Customize',
  },
  preferences: {
    title: 'Privacy preferences',
    description: 'Choose for each purpose.',
    save: 'Save',
    saveAndReload: 'Save and reload',
    close: 'Close',
    individualGrant: 'Needs your specific authorization',
    otherPurposes: 'Other purposes',
  },
  necessary: { title: 'Necessary (always on)', description: 'Needed by the site.' },
  button: { label: 'Privacy preferences' },
  placeholder: {
    description: 'Needs consent for: {purposes}.',
    load: 'Load',
    allowAlways: 'Always allow',
  },
  categories: { statistics: 'Statistics', marketing: 'Marketing', health: 'Health' },
};

/** Whether `value` and every object inside it are frozen. */
function isDeepFrozen(value: object): boolean {
  return (
    Object.isFrozen(value) &&
    Object.values(value).every((item) => typeof item !== 'object' || isDeepFrozen(item as object))
  );
}

describe('ptBR', () => {
  it('has the built-in texts in Brazilian Portuguese', () => {
    assert.deepStrictEqual(ptBR, {
      lang: 'pt-BR',
      banner: {
        title: 'Sua privacidade',
        description:
          'Usamos cookies e tecnologias semelhantes para as finalidades abaixo somente com o seu consentimento. Você pode aceitar todas, rejeitar todas ou escolher por finalidade, e mudar de ideia quando quiser.',
        acceptAll: 'Aceitar todas',
        rejectAll: 'Rejeitar todas',
        customize: 'Personalizar',
      },
      preferences: {
        title: 'Preferências de privacidade',
        description:
          'Escolha, para cada finalidade, se você consente. Você pode alterar suas escolhas a qualquer momento.',
        save: 'Salvar',
        saveAndReload: 'Salvar e recarregar',
        close: 'Fechar',
        individualGrant: 'Exige sua autorização específica',
        otherPurposes: 'Outras finalidades',
      },
      necessary: {
        title: 'Necessários (sempre ativos)',
        description:
          'Essenciais para o funcionamento do site, como segurança e o registro das suas escolhas. Não dependem de consentimento.',
      },
      button: { label: 'Preferências de privacidade' },
      placeholder: {
        description: 'Este conteúdo depende do seu consentimento para: {purposes}.',
        load: 'Carregar',
        allowAlways: 'Permitir sempre',
      },
      categories: {
        statistics: 'Estatísticas',
        marketing: 'Marketing',
        functional: 'Funcionalidade',
        personalization: 'Personalização',
      },
    });
  });

  it('is deeply frozen', () => {
    assert.equal(isDeepFrozen(ptBR), true);
  });
});

describe('texts given to the components', () => {
  it('replace only the fields given, group by group', () => {
    openUi({ texts: { banner: { title: 'Cookies' } } });

    assert.deepStrictEqual(textsOf('lgpder-banner', 'title'), ['Cookies']);
    assert.deepStrictEqual(
      buttonsOf('lgpder-banner').map((button) => button.textContent),
      ['Aceitar todas', 'Rejeitar todas', 'Personalizar'],
    );
  });

  it('merge categories key by key', () => {
    openUi({ texts: { categories: { health: 'Saúde', marketing: 'Publicidade' } } });
    clickButton('lgpder-banner', 'Personalizar');

    assert.deepStrictEqual(textsOf('lgpder-preferences', 'category-title'), [
      'Estatísticas',
      'Publicidade',
      'Saúde',
    ]);
  });

  it('a field given as undefined keeps the built-in text', () => {
    // Untyped JavaScript may pass undefined, which the type of the option leaves out.
    const options: unknown = { texts: { banner: { title: undefined } } };

    openUi(options as UiOptions<PurposeId>);

    assert.deepStrictEqual(textsOf('lgpder-banner', 'title'), ['Sua privacidade']);
  });

  it('a complete set in another language replaces every text', () => {
    openUi({ texts: ENGLISH });
    clickButton('lgpder-banner', 'Customize');

    assert.equal(document.querySelector('lgpder-banner')?.getAttribute('lang'), 'en');
    assert.deepStrictEqual(textsOf('lgpder-preferences', 'category-title'), [
      'Statistics',
      'Marketing',
      'Health',
    ]);
    assert.deepStrictEqual(
      buttonsOf('lgpder-preferences')
        .filter((button) => button.getAttribute('role') !== 'switch')
        .map((button) => button.textContent),
      ['Close', 'Save'],
    );
  });

  it('leave ptBR unchanged', () => {
    openUi({ texts: { banner: { title: 'Cookies' }, categories: { health: 'Saúde' } } });

    assert.equal(ptBR.banner.title, 'Sua privacidade');
    assert.equal(Object.hasOwn(ptBR.categories, 'health'), false);
  });
});

describe('texts are inserted as text, never as HTML', () => {
  it('in the banner, the center and the titles of the purposes', () => {
    const markup = '<img src="x" onerror="window.injected = true">';
    openUi({
      texts: { banner: { title: markup }, preferences: { title: markup } },
      purposes: { analytics: { title: markup, description: markup } },
    });
    clickButton('lgpder-banner', 'Personalizar');

    assert.deepStrictEqual(textsOf('lgpder-banner', 'title'), [markup]);
    assert.deepStrictEqual(purposeTitles()[0], markup);
    assert.equal(shadow('lgpder-banner').querySelector('img'), null);
    assert.equal(shadow('lgpder-preferences').querySelector('img'), null);
  });
});

describe('invalid texts are rejected before anything is mounted', () => {
  const cases: { readonly name: string; readonly texts: unknown; readonly message: string }[] = [
    {
      name: 'texts that are not an object',
      texts: 'pt-BR',
      message: '[lgpder] "texts" must be an object.',
    },
    {
      name: 'an unknown group',
      texts: { footer: {} },
      message: '[lgpder] Unknown option: "footer".',
    },
    {
      name: 'an unknown field of a group',
      texts: { banner: { accept: 'Ok' } },
      message: '[lgpder] Unknown option: "accept".',
    },
    {
      name: 'a group that is not an object',
      texts: { banner: 'Cookies' },
      message: '[lgpder] "texts.banner" must be an object.',
    },
    {
      name: 'a text that is not a string',
      texts: { preferences: { save: 1 } },
      message: '[lgpder] "texts.preferences.save" must be a non-empty string.',
    },
    {
      name: 'an empty text, which would leave a control without a name',
      texts: { button: { label: '' } },
      message: '[lgpder] "texts.button.label" must be a non-empty string.',
    },
    {
      name: 'an empty lang',
      texts: { lang: '' },
      message: '[lgpder] "texts.lang" must be a non-empty string.',
    },
    {
      name: 'a category title that is not a string',
      texts: { categories: { health: null } },
      message: '[lgpder] "texts.categories.health" must be a non-empty string.',
    },
  ];
  for (const { name, texts, message } of cases) {
    it(name, () => {
      const { consent } = setup();

      assert.throws(() => callUntyped(mountUi, consent, { texts }), { name: 'TypeError', message });
      assert.equal(document.body.childElementCount, 0);
    });
  }
});
