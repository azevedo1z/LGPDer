/**
 * Keyboard and focus: the first control focused on opening, Tab and Shift+Tab kept inside the
 * center, even with the focus on the body, Esc, and the focus given back on closing. jsdom does not move the focus on Tab, so the
 * tests press it on the edges, where the center moves the focus itself.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { finishLoading, startLoading, testDom } from '../support/dom.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { setup } from '../support/setup.ts';
import {
  buttonNamed,
  buttonsOf,
  clickButton,
  closeUis,
  focused,
  host,
  isShown,
  mountOn,
  openUi,
  press,
  recordingActions,
  shadow,
  switchOf,
} from '../support/ui.ts';

afterEach(() => {
  closeUis();
  testDom.reset();
});

const DECIDED = serialized({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('denied'),
});

/** The controls of the center, in tab order. */
function controls(): HTMLButtonElement[] {
  return buttonsOf('lgpder-preferences');
}

/** Opens the center from "Personalizar" of the banner, focused first as a keyboard user would. */
function customize(): void {
  buttonNamed('lgpder-banner', 'Personalizar').focus();
  clickButton('lgpder-banner', 'Personalizar');
}

describe('opening the center', () => {
  it('focuses its first control, inside the shadow root of the host', () => {
    openUi();

    customize();

    assert.equal(document.activeElement, host('lgpder-preferences'));
    assert.equal(shadow('lgpder-preferences').activeElement, switchOf('analytics'));
  });
});

describe('the focus inside the open center', () => {
  it('Tab on the last control goes to the first', () => {
    openUi();
    customize();
    controls().at(-1)?.focus();

    const event = press('Tab');

    assert.equal(event.defaultPrevented, true);
    assert.equal(focused(), controls()[0]);
  });

  it('Shift+Tab on the first control goes to the last', () => {
    openUi();
    customize();

    const event = press('Tab', { shiftKey: true });

    assert.equal(event.defaultPrevented, true);
    assert.equal(focused(), controls().at(-1));
  });

  it('Tab between two controls is left to the browser', () => {
    openUi();
    customize();

    const event = press('Tab');

    assert.equal(event.defaultPrevented, false);
    assert.equal(focused(), controls()[0]);
  });

  // A click on the text of the dialog or on the backdrop, which take no focus, moves it to the body.
  it('Tab with the focus on the body, after a click outside the controls, goes to the first', () => {
    openUi();
    customize();
    controls()[0]?.blur();

    const event = press('Tab');

    assert.equal(event.defaultPrevented, true);
    assert.equal(focused(), controls()[0]);
  });

  it('Shift+Tab with the focus on the body goes to the last', () => {
    openUi();
    customize();
    controls()[0]?.blur();

    const event = press('Tab', { shiftKey: true });

    assert.equal(event.defaultPrevented, true);
    assert.equal(focused(), controls().at(-1));
  });

  it('a script of the page that focuses an element behind brings the focus back to the first', () => {
    document.body.innerHTML = '<input id="search">';
    openUi();
    customize();
    controls().at(-1)?.focus();

    document.getElementById('search')?.focus();

    assert.equal(focused(), controls()[0]);
  });

  it('other keys are left alone', () => {
    openUi();
    customize();

    const event = press('Enter');

    assert.equal(event.defaultPrevented, false);
    assert.equal(isShown('lgpder-preferences'), true);
  });
});

describe('Esc', () => {
  it('closes the center with the focus on the body, after a click outside the controls', () => {
    openUi();
    customize();
    controls()[0]?.blur();

    const event = press('Escape');

    assert.equal(event.defaultPrevented, true);
    assert.equal(isShown('lgpder-preferences'), false);
  });

  it('closes the center without saving', () => {
    const tab = setup();
    const recording = recordingActions(tab.consent);
    mountOn(tab, { actions: recording.actions });
    customize();
    switchOf('analytics').click();

    const event = press('Escape');

    assert.equal(event.defaultPrevented, true);
    assert.equal(isShown('lgpder-preferences'), false);
    assert.deepStrictEqual(recording.calls, []);
  });
});

describe('the keyboard and the focus of the page, outside the open center', () => {
  it('are left alone once the center closed', () => {
    document.body.innerHTML = '<input id="search">';
    openUi(undefined, { record: DECIDED });
    const search = document.getElementById('search');
    search?.focus();
    clickButton('lgpder-button', 'Preferências de privacidade');
    clickButton('lgpder-preferences', 'Fechar');
    search?.focus();

    const events = [press('Tab'), press('Tab', { shiftKey: true }), press('Escape')];

    assert.deepStrictEqual(
      events.map((event) => event.defaultPrevented),
      [false, false, false],
    );
    assert.equal(focused(), search);
  });

  it('are left alone while the document loads, before the center is on the page', () => {
    document.body.innerHTML = '<input id="search">';
    startLoading();
    const { ui } = openUi();
    ui.openPreferences();
    const search = document.getElementById('search');
    search?.focus();

    const event = press('Escape');
    finishLoading();

    assert.equal(event.defaultPrevented, false);
    assert.equal(isShown('lgpder-preferences'), true);
    assert.equal(focused(), switchOf('analytics'));
  });

  it('are left alone once the ui is destroyed with the center open', () => {
    document.body.innerHTML = '<input id="search">';
    const { ui } = openUi();
    customize();
    ui.destroy();
    const search = document.getElementById('search');
    search?.focus();

    const event = press('Escape');

    assert.equal(event.defaultPrevented, false);
    assert.equal(focused(), search);
  });
});

describe('closing the center gives the focus back', () => {
  it('to "Personalizar", when closed without saving', () => {
    openUi();
    customize();

    press('Escape');

    assert.equal(focused(), buttonNamed('lgpder-banner', 'Personalizar'));
  });

  it('to the floating button, when saving hid the banner', () => {
    openUi();
    customize();

    clickButton('lgpder-preferences', 'Salvar');

    assert.equal(focused(), buttonNamed('lgpder-button', 'Preferências de privacidade'));
  });

  it('to the floating button, when it opened the center', () => {
    openUi(undefined, { record: DECIDED });
    buttonNamed('lgpder-button', 'Preferências de privacidade').focus();
    clickButton('lgpder-button', 'Preferências de privacidade');

    clickButton('lgpder-preferences', 'Fechar');

    assert.equal(focused(), buttonNamed('lgpder-button', 'Preferências de privacidade'));
  });

  it('to the element of the page that opened it', () => {
    document.body.innerHTML = '<button type="button" id="manage">Cookies</button>';
    const { ui } = openUi(undefined, { record: DECIDED });
    const manage = document.getElementById('manage');
    manage?.focus();

    ui.openPreferences();
    press('Escape');

    assert.equal(focused(), manage);
  });

  it('to nowhere new without a floating button, when the opener is hidden', () => {
    openUi({ floatingButton: false });
    customize();

    clickButton('lgpder-preferences', 'Salvar');

    // jsdom reports no active element once the focused control left the document.
    const active = focused();
    assert.ok(active === null || active === document.body);
  });

  it('to the floating button, when the center was opened with nothing focused', () => {
    const { ui } = openUi(undefined, { record: DECIDED });

    ui.openPreferences();
    press('Escape');

    assert.equal(focused(), buttonNamed('lgpder-button', 'Preferências de privacidade'));
  });
});

describe('the banner buttons, used from the keyboard', () => {
  it('move the focus to the floating button once the banner is gone', () => {
    openUi();
    buttonNamed('lgpder-banner', 'Aceitar todas').focus();

    clickButton('lgpder-banner', 'Aceitar todas');

    assert.equal(focused(), buttonNamed('lgpder-button', 'Preferências de privacidade'));
  });

  it('leave the focus alone when the banner was not focused', () => {
    document.body.innerHTML = '<input id="search">';
    const search = document.getElementById('search');
    openUi();
    search?.focus();

    clickButton('lgpder-banner', 'Rejeitar todas');

    assert.equal(focused(), search);
  });
});
