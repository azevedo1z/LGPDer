/**
 * Acceptance criterion of the specification (section 3): with the example below, whose options are
 * copied literally from the specification, and the Google tag marked with `data-consent`, the page
 * has the banner, the preferences center, the persistence and the blocking of Google Analytics
 * working.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

import { init } from '../../src/init/index.ts';
import { testDom } from '../support/dom.ts';
import { consentWith, lastUpdate, updates } from '../support/google.ts';
import {
  activeScripts,
  blockedScripts,
  closeApps,
  GTAG_SCRIPT,
  GTAG_SRC,
  keepApp,
  readAtReload,
  savedStatus,
  setCookie,
  updatesAtScriptInsertion,
} from '../support/init.ts';
import { cookieNames, flushMicrotasks } from '../support/page.ts';
import { buttonNamed, buttonsOf, clickButton, isShown, switchOf } from '../support/ui.ts';

afterEach(() => {
  closeApps();
  testDom.reset();
});

/** The example of section 3 of the specification. */
function example() {
  return init({
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
}

/** Opens a page with the Google tag of the example in the body, then runs the example. */
function openPage(): void {
  document.body.innerHTML = GTAG_SCRIPT;
  keepApp(example());
}

/** The Consent Mode with every type of the two integrations of the example granted. */
const BOTH_GRANTED = consentWith(
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'analytics_storage',
);

describe('the example of section 3', () => {
  it('has at most 15 lines of configuration: the options given to init', () => {
    const lines = readFileSync(import.meta.filename, 'utf8').split(/\r?\n/);
    const start = lines.indexOf('  return init({');
    const end = lines.indexOf('  });', start);

    assert.ok(start !== -1 && end > start, 'the example is in this file');
    assert.ok(end - start - 1 <= 15, `${String(end - start - 1)} lines of configuration`);
  });

  it('shows the banner with its three buttons and keeps the Google tag blocked', () => {
    openPage();

    assert.equal(isShown('lgpder-banner'), true);
    assert.deepStrictEqual(
      buttonsOf('lgpder-banner').map((button) => button.textContent),
      ['Aceitar todas', 'Rejeitar todas', 'Personalizar'],
    );
    assert.equal(blockedScripts().length, 1);
    assert.deepStrictEqual(activeScripts(), []);
  });
});

describe('"Aceitar todas" in the example', () => {
  it('saves the grants in localStorage', () => {
    openPage();

    clickButton('lgpder-banner', 'Aceitar todas');

    assert.deepStrictEqual([savedStatus('analytics'), savedStatus('ads')], ['granted', 'granted']);
  });

  it('updates the Consent Mode to granted before the Google tag is inserted', (t) => {
    openPage();
    const updatesAtInsertion = updatesAtScriptInsertion(t);

    clickButton('lgpder-banner', 'Aceitar todas');

    assert.deepStrictEqual(updatesAtInsertion, [BOTH_GRANTED]);
    assert.deepStrictEqual(lastUpdate(), BOTH_GRANTED);
  });

  it('activates the Google tag, with its src and async false', () => {
    openPage();

    clickButton('lgpder-banner', 'Aceitar todas');

    assert.deepStrictEqual(
      activeScripts().map(({ src, async }) => ({ src, async })),
      [{ src: GTAG_SRC, async: false }],
    );
    assert.deepStrictEqual(blockedScripts(), []);
  });

  it('hides the banner and shows the floating button', () => {
    openPage();

    clickButton('lgpder-banner', 'Aceitar todas');

    assert.equal(isShown('lgpder-banner'), false);
    assert.equal(isShown('lgpder-button'), true);
  });
});

describe('the next page, on the same localStorage', () => {
  /** Accepts everything on a first page, then opens a new page, as after a navigation. */
  function openNextPage(): void {
    openPage();
    clickButton('lgpder-banner', 'Aceitar todas');
    closeApps();
    openPage();
  }

  it('starts with the Google tag active and without the banner', () => {
    openNextPage();

    assert.equal(activeScripts()[0]?.src, GTAG_SRC);
    assert.equal(isShown('lgpder-banner'), false);
    assert.equal(isShown('lgpder-button'), true);
  });

  it('turning Estatísticas off in the center offers "Salvar e recarregar"', () => {
    openNextPage();

    clickButton('lgpder-button', 'Preferências de privacidade');
    switchOf('Estatísticas').click();

    assert.equal(buttonNamed('lgpder-preferences', 'Salvar e recarregar').isConnected, true);
  });

  it('saving saves the refusal before reloading once, removes _ga and updates to denied', async (t) => {
    openNextPage();
    setCookie('_ga');
    setCookie('_ga_XXXX');
    const savedAtReload = readAtReload(t, () => savedStatus('analytics'));

    clickButton('lgpder-button', 'Preferências de privacidade');
    switchOf('Estatísticas').click();
    clickButton('lgpder-preferences', 'Salvar e recarregar');
    await flushMicrotasks();

    assert.deepStrictEqual(savedAtReload, ['denied']);
    assert.equal(testDom.reloads(), 1);
    assert.deepStrictEqual(cookieNames(), []);
    assert.deepStrictEqual(
      lastUpdate(),
      consentWith('ad_storage', 'ad_user_data', 'ad_personalization'),
    );
  });
});

describe('"Rejeitar todas" in the example', () => {
  it('keeps the Google tag blocked', () => {
    openPage();

    clickButton('lgpder-banner', 'Rejeitar todas');

    assert.equal(blockedScripts().length, 1);
    assert.deepStrictEqual(activeScripts(), []);
  });

  it('sends one update with every consent type denied', () => {
    openPage();
    const before = updates().length;

    clickButton('lgpder-banner', 'Rejeitar todas');

    assert.deepStrictEqual(updates().slice(before), [consentWith()]);
  });

  it('leaves no _ga cookie, even one set before the page loaded', () => {
    setCookie('_ga');
    openPage();

    clickButton('lgpder-banner', 'Rejeitar todas');

    assert.deepStrictEqual(cookieNames(), []);
    assert.deepStrictEqual([savedStatus('analytics'), savedStatus('ads')], ['denied', 'denied']);
  });
});
