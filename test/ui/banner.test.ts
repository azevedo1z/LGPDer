/** The banner: when it is shown (P3), its buttons, its place on the page and the scroll padding. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { connectStorage, type ConsentStorage } from '../../src/storage/index.ts';
import { testDom } from '../support/dom.ts';
import { createMemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { DAY, setup, START, type FixtureSetupOptions } from '../support/setup.ts';
import {
  buttonsOf,
  clickButton,
  closeUis,
  host,
  isShown,
  mountOn,
  openUi,
  recordingActions,
  textsOf,
} from '../support/ui.ts';

const storages: ConsentStorage[] = [];

afterEach(() => {
  closeUis();
  for (const storage of storages.splice(0)) storage.destroy();
  document.documentElement.removeAttribute('style');
  testDom.reset();
});

/** Record with every purpose without individualGrant decided, and `health` left pending. */
const DECIDED = serialized({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('denied'),
});

/** Inline `scroll-padding-bottom` of the root element. */
function scrollPadding(): string {
  return document.documentElement.style.getPropertyValue('scroll-padding-bottom');
}

/** Makes the banner report `height` pixels of layout, which jsdom does not compute. */
function stubBannerHeight(height: number): void {
  Object.defineProperty(host('lgpder-banner'), 'offsetHeight', {
    configurable: true,
    get: () => height,
  });
}

describe('the banner is shown while a purpose without individualGrant is pending (P3)', () => {
  const cases: { readonly name: string; readonly fixture: FixtureSetupOptions }[] = [
    { name: 'on the first visit, without a record', fixture: {} },
    {
      name: 'when a decision was recorded under another version (outdated)',
      fixture: {
        record: serialized({
          analytics: decisionOf('granted', { version: '2025-01' }),
          ads: decisionOf('denied'),
        }),
      },
    },
    {
      name: 'when the decisions expired',
      fixture: {
        record: serialized({
          analytics: decisionOf('granted', { version: '2026-10', decidedAt: START - 2 * DAY }),
          ads: decisionOf('denied', { decidedAt: START - 2 * DAY }),
        }),
        maxAge: DAY,
      },
    },
    {
      name: 'when only one of them is still pending',
      fixture: { record: serialized({ analytics: decisionOf('granted', { version: '2026-10' }) }) },
    },
  ];
  for (const { name, fixture } of cases) {
    it(name, () => {
      openUi(undefined, fixture);

      assert.equal(isShown('lgpder-banner'), true);
    });
  }

  it('when the storage fails to read a saved record', () => {
    const adapter = createMemoryAdapter(DECIDED);
    adapter.failRead = true;
    const tab = setup();
    const storage = connectStorage(tab.consent, { storage: adapter, crossTab: false });
    storages.push(storage);

    mountOn(tab, { actions: storage });

    assert.equal(isShown('lgpder-banner'), true);
  });

  it('but not when the same saved record is read', () => {
    const tab = setup();
    const storage = connectStorage(tab.consent, {
      storage: createMemoryAdapter(DECIDED),
      crossTab: false,
    });
    storages.push(storage);

    mountOn(tab, { actions: storage });

    assert.equal(isShown('lgpder-banner'), false);
  });
});

describe('the banner is hidden', () => {
  it('when every purpose without individualGrant is decided, even with one with it pending', () => {
    const { consent } = openUi(undefined, { record: DECIDED });

    assert.equal(consent.getSnapshot().status.health, 'pending');
    assert.equal(isShown('lgpder-banner'), false);
  });

  it('as soon as a decision settles the last pending purpose', () => {
    const { consent } = openUi();

    consent.decide({ analytics: 'denied', ads: 'granted' });

    assert.equal(isShown('lgpder-banner'), false);
  });

  it('while the preferences center is open, and shown again when it closes without saving', () => {
    openUi();

    clickButton('lgpder-banner', 'Personalizar');
    assert.equal(isShown('lgpder-banner'), false);

    clickButton('lgpder-preferences', 'Fechar');
    assert.equal(isShown('lgpder-banner'), true);
  });

  it('when another tab restores a record that decides every purpose without individualGrant', () => {
    const { consent } = openUi();

    consent.restore(DECIDED);

    assert.equal(isShown('lgpder-banner'), false);
  });
});

describe('the content of the banner', () => {
  it('has a title, the description and the purposes reached by "Aceitar todas"', () => {
    openUi({ purposes: { analytics: { title: 'Estatísticas' }, health: { title: 'Saúde' } } });

    assert.deepStrictEqual(textsOf('lgpder-banner', 'title'), ['Sua privacidade']);
    assert.match(textsOf('lgpder-banner', 'description')[0] ?? '', /^Usamos cookies/);
    assert.deepStrictEqual(textsOf('lgpder-banner', 'purpose'), ['Estatísticas', 'ads']);
  });

  it('has the three buttons in this order', () => {
    openUi();

    assert.deepStrictEqual(
      buttonsOf('lgpder-banner').map((button) => button.textContent),
      ['Aceitar todas', 'Rejeitar todas', 'Personalizar'],
    );
  });

  it('gives the three buttons the same emphasis: same part, same attributes, no inline style', () => {
    openUi();

    const shapes = buttonsOf('lgpder-banner').map((button) =>
      button
        .getAttributeNames()
        .map((name) => `${name}=${button.getAttribute(name) ?? ''}`)
        .join(' '),
    );
    assert.deepStrictEqual(shapes, [
      'type=button part=button',
      'type=button part=button',
      'type=button part=button',
    ]);
  });

  it('keeps the list role of the purposes, which Safari drops from a list without markers', () => {
    openUi();

    const purposes = host('lgpder-banner').shadowRoot?.querySelector('[part~="purposes"]');
    assert.equal(purposes?.getAttribute('role'), 'list');
  });

  it('is a region labelled by its title', () => {
    openUi();

    const region = host('lgpder-banner').shadowRoot?.querySelector('[role="region"]');
    const labelId = region?.getAttribute('aria-labelledby') ?? '';
    assert.equal(
      host('lgpder-banner').shadowRoot?.getElementById(labelId)?.textContent,
      'Sua privacidade',
    );
  });
});

describe('the buttons of the banner', () => {
  it('"Aceitar todas" calls grantAll of the actions, which does not reach individualGrant', () => {
    const tab = setup();
    const recording = recordingActions(tab.consent);
    mountOn(tab, { actions: recording.actions });

    clickButton('lgpder-banner', 'Aceitar todas');

    assert.deepStrictEqual(recording.calls, [['grantAll']]);
    assert.deepStrictEqual(tab.consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'granted',
      health: 'pending',
    });
    assert.equal(isShown('lgpder-banner'), false);
  });

  it('"Rejeitar todas" calls denyAll of the actions, which reaches every purpose', () => {
    const tab = setup();
    const recording = recordingActions(tab.consent);
    mountOn(tab, { actions: recording.actions });

    clickButton('lgpder-banner', 'Rejeitar todas');

    assert.deepStrictEqual(recording.calls, [['denyAll']]);
    assert.deepStrictEqual(tab.consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'denied',
      health: 'denied',
    });
  });

  it('"Personalizar" opens the preferences center without deciding', () => {
    const tab = setup();
    const recording = recordingActions(tab.consent);
    mountOn(tab, { actions: recording.actions });

    clickButton('lgpder-banner', 'Personalizar');

    assert.deepStrictEqual(recording.calls, []);
    assert.equal(isShown('lgpder-preferences'), true);
  });

  it('use the manager when no actions are given', () => {
    const { consent, changes } = openUi();

    clickButton('lgpder-banner', 'Rejeitar todas');

    assert.equal(changes.length, 1);
    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });
});

describe('the place of the components on the page', () => {
  it('is the start of the body, with the banner first in the tab order', () => {
    document.body.innerHTML = '<a href="/privacy">Privacy</a><main></main>';

    openUi();

    assert.deepStrictEqual(
      [...document.body.children].map((element) => element.localName),
      ['lgpder-banner', 'lgpder-preferences', 'lgpder-button', 'a', 'main'],
    );
  });

  it('every component has the lang of the texts', () => {
    openUi({ texts: { lang: 'pt-PT' } });

    assert.deepStrictEqual(
      ['lgpder-banner', 'lgpder-preferences', 'lgpder-button'].map((tag) =>
        document.querySelector(tag)?.getAttribute('lang'),
      ),
      ['pt-PT', 'pt-PT', 'pt-PT'],
    );
  });
});

describe('the scroll padding of the root element, so the banner never covers the focus', () => {
  it('is set while the banner is shown', () => {
    openUi();

    assert.equal(scrollPadding(), '0px');
  });

  it('follows the height of the banner on resize', () => {
    openUi();
    stubBannerHeight(120);

    testDom.window.dispatchEvent(new testDom.window.Event('resize'));

    assert.equal(scrollPadding(), '120px');
  });

  it('is capped at the height of the window, when the banner is taller than it', () => {
    openUi();
    stubBannerHeight(testDom.window.innerHeight + 200);

    testDom.window.dispatchEvent(new testDom.window.Event('resize'));

    assert.equal(scrollPadding(), `${String(testDom.window.innerHeight)}px`);
  });

  it('on resize, only the height is read again: nothing else is rendered', () => {
    let previews = 0;
    const { ui } = openUi({
      wouldReload: () => {
        previews += 1;
        return false;
      },
    });
    ui.openPreferences(['health']);
    const before = previews;

    testDom.window.dispatchEvent(new testDom.window.Event('resize'));

    assert.equal(previews, before);
    assert.equal(scrollPadding(), '');
  });

  it('gets back its previous inline value and priority when the banner hides', () => {
    document.documentElement.style.setProperty('scroll-padding-bottom', '7px', 'important');
    const { consent } = openUi();

    consent.denyAll();

    assert.equal(scrollPadding(), '7px');
    assert.equal(
      document.documentElement.style.getPropertyPriority('scroll-padding-bottom'),
      'important',
    );
  });

  it('is left alone when the banner is never shown', () => {
    openUi(undefined, { record: DECIDED });

    assert.equal(document.documentElement.hasAttribute('style'), false);
  });

  it('gets back its previous value when the ui is destroyed', () => {
    const { ui } = openUi();

    ui.destroy();

    assert.equal(scrollPadding(), '');
  });
});
