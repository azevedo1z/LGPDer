/** Life cycle of the components: a document still loading (D39), the handle and destroy (D28). */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { finishLoading, startLoading, testDom } from '../support/dom.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { assignUntyped } from '../support/setup.ts';
import {
  clickButton,
  closeUis,
  focused,
  isShown,
  openUi,
  shadow,
  switchOf,
} from '../support/ui.ts';

afterEach(() => {
  closeUis();
  finishLoading();
  testDom.reset();
});

const DECIDED = serialized({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('denied'),
});

/** The components on the page. */
function components(): string[] {
  return [...document.body.children]
    .map((element) => element.localName)
    .filter((name) => name.startsWith('lgpder-'));
}

describe('with the document still loading', () => {
  it('the components are inserted on DOMContentLoaded', () => {
    startLoading();
    openUi();
    assert.deepStrictEqual(components(), []);

    finishLoading();

    assert.deepStrictEqual(components(), ['lgpder-banner', 'lgpder-preferences', 'lgpder-button']);
    assert.equal(isShown('lgpder-banner'), true);
  });

  it('they show the state of that moment, decided meanwhile', () => {
    startLoading();
    const { consent } = openUi();
    consent.grantAll();

    finishLoading();

    assert.equal(isShown('lgpder-banner'), false);
    assert.equal(isShown('lgpder-button'), true);
  });

  it('openPreferences called meanwhile opens the center, focused, once inserted', () => {
    startLoading();
    const { ui } = openUi();
    ui.openPreferences(['ads']);

    finishLoading();

    assert.equal(isShown('lgpder-preferences'), true);
    assert.equal(focused(), switchOf('ads'));
  });

  it('destroy before DOMContentLoaded leaves nothing to insert', () => {
    startLoading();
    const { ui } = openUi();

    ui.destroy();
    finishLoading();

    assert.deepStrictEqual(components(), []);
  });
});

describe('the handle', () => {
  it('is frozen, and its functions do not depend on this', () => {
    const { ui } = openUi(undefined, { record: DECIDED });
    const { openPreferences } = ui;

    assert.ok(Object.isFrozen(ui));
    assert.throws(() => {
      assignUntyped(ui, 'openPreferences', null);
    }, TypeError);
    openPreferences();
    assert.equal(isShown('lgpder-preferences'), true);
  });
});

describe('destroy', () => {
  it('removes the components and stops following the manager', () => {
    const { ui, consent } = openUi();

    ui.destroy();
    consent.grantAll();
    testDom.window.dispatchEvent(new testDom.window.Event('resize'));

    assert.deepStrictEqual(components(), []);
    assert.equal(document.documentElement.style.getPropertyValue('scroll-padding-bottom'), '');
  });

  it('closes the open center and gives the focus back to the page', () => {
    document.body.innerHTML = '<button type="button" id="manage">Cookies</button>';
    const { ui } = openUi(undefined, { record: DECIDED });
    const manage = document.getElementById('manage');
    manage?.focus();
    ui.openPreferences();
    assert.equal(shadow('lgpder-preferences').activeElement, switchOf('analytics'));

    ui.destroy();

    assert.deepStrictEqual(components(), []);
    assert.equal(focused(), manage);
  });

  it('during the delivery of a save leaves the scroll padding of the page as it was', () => {
    const { ui, consent } = openUi();
    consent.subscribe(() => {
      ui.destroy();
    });
    ui.openPreferences(['ads']);
    switchOf('ads').click();

    clickButton('lgpder-preferences', 'Salvar');

    // `analytics` is still pending, so a render after destroy would show the banner again.
    assert.equal(consent.getSnapshot().status.analytics, 'pending');
    assert.deepStrictEqual(components(), []);
    assert.equal(document.documentElement.style.getPropertyValue('scroll-padding-bottom'), '');
  });

  it('is idempotent, and then openPreferences throws', () => {
    const { ui } = openUi();

    ui.destroy();
    ui.destroy();

    assert.throws(
      () => {
        ui.openPreferences();
      },
      { name: 'Error', message: '[lgpder] This instance was destroyed.' },
    );
  });
});
