/** The placeholder of blocked iframes, rendered by the real scripts layer. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { PlaceholderOptions } from 'lgpder/ui';

import { connectScripts, type ConsentScripts } from '../../src/scripts/index.ts';
import { createPlaceholder } from '../../src/ui/index.ts';
import { captureMicrotasks } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import { setup, type PurposeId, type Setup } from '../support/setup.ts';
import {
  buttonNamed,
  failingActions,
  recordingActions,
  styleSheetOf,
  textsOf,
} from '../support/ui.ts';

const connected: ConsentScripts<PurposeId>[] = [];

afterEach(() => {
  for (const scripts of connected.splice(0)) scripts.destroy();
  testDom.reset();
});

const VIDEO = 'https://video.example/embed/1';

const TITLES = {
  ads: { title: 'Publicidade' },
  health: { title: 'Saúde' },
} as const;

/** Renders `html`, then connects the scripts layer with the placeholder of `options`. */
function openPage(html: string, options?: PlaceholderOptions<PurposeId>): Setup<PurposeId> {
  document.body.innerHTML = html;
  const tab = setup();
  connected.push(
    connectScripts(tab.consent, { renderPlaceholder: createPlaceholder(tab.consent, options) }),
  );
  return tab;
}

/** The only iframe of the page. */
function iframe(): HTMLIFrameElement {
  const element = document.querySelector('iframe');
  if (element === null) throw new Error('No iframe on the page.');
  return element;
}

describe('the placeholder of a blocked iframe', () => {
  it('stands right before the iframe, which is hidden', () => {
    openPage(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`);

    assert.equal(iframe().previousElementSibling?.localName, 'lgpder-placeholder');
    assert.equal(iframe().hidden, true);
  });

  it('names the purposes of the iframe by their titles, in attribute order', () => {
    openPage(`<iframe data-consent="health ads" data-src="${VIDEO}"></iframe>`, {
      purposes: TITLES,
    });

    assert.deepStrictEqual(textsOf('lgpder-placeholder', 'description'), [
      'Este conteúdo depende do seu consentimento para: Saúde, Publicidade.',
    ]);
  });

  it('has the buttons "Carregar" and "Permitir sempre", both described by the text', () => {
    openPage(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`);

    const buttons = ['Carregar', 'Permitir sempre'].map((name) =>
      buttonNamed('lgpder-placeholder', name),
    );
    assert.deepStrictEqual(
      buttons.map((button) => [
        button.getAttribute('part'),
        button.getAttribute('aria-describedby'),
      ]),
      [
        ['button', 'description'],
        ['button', 'description'],
      ],
    );
  });

  it('takes the width and the height of the iframe, a bare number in pixels', () => {
    openPage(`<iframe data-consent="ads" data-src="${VIDEO}" width="560" height="50%"></iframe>`);

    const { style } = iframe().previousElementSibling as HTMLElement;
    assert.deepStrictEqual([style.width, style.height], ['560px', '50%']);
  });

  it('has no size of its own when the iframe has none', () => {
    openPage(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`);

    assert.equal((iframe().previousElementSibling as HTMLElement).getAttribute('style'), null);
  });

  it('has the lang and the texts of the options', () => {
    openPage(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`, {
      purposes: { ads: { title: 'Ads $& $1' } },
      texts: { lang: 'en', placeholder: { description: '{purposes} needed ({purposes}).' } },
    });

    assert.equal(iframe().previousElementSibling?.getAttribute('lang'), 'en');
    assert.deepStrictEqual(textsOf('lgpder-placeholder', 'description'), [
      'Ads $& $1 needed (Ads $& $1).',
    ]);
  });

  it('has the style sheet of the components', () => {
    openPage(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`);

    assert.match(styleSheetOf('lgpder-placeholder'), /\[part~=placeholder\]/);
  });
});

describe('"Carregar" (P4)', () => {
  it('loads only this iframe, on this page, without recording a decision', () => {
    const { consent, changes } = openPage(
      `<iframe data-consent="ads" data-src="${VIDEO}"></iframe>` +
        `<iframe data-consent="ads" data-src="${VIDEO}?2"></iframe>`,
    );

    buttonNamed('lgpder-placeholder', 'Carregar').click();

    const [first, second] = document.querySelectorAll('iframe');
    assert.equal(first?.getAttribute('src'), VIDEO);
    assert.equal(second?.hasAttribute('src'), false);
    assert.deepStrictEqual(changes, []);
    assert.equal(consent.getSnapshot().status.ads, 'pending');
    assert.equal(document.querySelectorAll('lgpder-placeholder').length, 1);
  });
});

describe('"Permitir sempre"', () => {
  it('grants every purpose of the iframe through the actions, which loads it', () => {
    document.body.innerHTML = `<iframe data-consent="health ads" data-src="${VIDEO}"></iframe>`;
    const tab = setup();
    const recording = recordingActions(tab.consent);
    connected.push(
      connectScripts(tab.consent, {
        renderPlaceholder: createPlaceholder(tab.consent, { actions: recording.actions }),
      }),
    );

    buttonNamed('lgpder-placeholder', 'Permitir sempre').click();

    assert.deepStrictEqual(recording.calls, [['decide', { health: 'granted', ads: 'granted' }]]);
    assert.equal(iframe().getAttribute('src'), VIDEO);
    assert.equal(document.querySelector('lgpder-placeholder'), null);
  });

  it('uses the manager when no actions are given', () => {
    const { consent } = openPage(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`);

    buttonNamed('lgpder-placeholder', 'Permitir sempre').click();

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('when the action throws, leaves the iframe blocked and rethrows in a microtask', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('faulty clock');
    openPage(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`, {
      actions: failingActions(failure),
    });

    buttonNamed('lgpder-placeholder', 'Permitir sempre').click();

    assert.equal(iframe().hasAttribute('src'), false);
    assert.throws(() => {
      scheduled[0]?.();
    }, failure);
  });
});
