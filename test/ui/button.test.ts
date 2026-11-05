/** The floating button: when it is shown (D53), what it opens and its accessible name. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { testDom } from '../support/dom.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { setup } from '../support/setup.ts';
import {
  buttonsOf,
  clickButton,
  closeUis,
  isShown,
  mountOn,
  openUi,
  parts,
} from '../support/ui.ts';

afterEach(() => {
  closeUis();
  testDom.reset();
});

const LABEL = 'Preferências de privacidade';

const DECIDED = serialized({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('denied'),
});

describe('the floating button is shown', () => {
  it('after the first decision, once the banner is gone', () => {
    const { consent } = openUi();
    assert.equal(isShown('lgpder-button'), false);

    consent.grantAll();

    assert.equal(isShown('lgpder-button'), true);
  });

  it('on a later visit, when the decisions are saved', () => {
    openUi(undefined, { record: DECIDED });

    assert.equal(isShown('lgpder-button'), true);
  });

  it('from the start when every purpose has individualGrant: it is the way to the center', () => {
    mountOn(setup({ purposes: { health: { individualGrant: true } } }));

    assert.equal(isShown('lgpder-banner'), false);
    assert.equal(isShown('lgpder-button'), true);
  });
});

describe('the floating button is hidden', () => {
  it('while the banner is shown', () => {
    openUi();

    assert.equal(isShown('lgpder-banner'), true);
    assert.equal(isShown('lgpder-button'), false);
  });

  it('while the center is open, and shown again when it closes', () => {
    openUi(undefined, { record: DECIDED });

    clickButton('lgpder-button', LABEL);
    assert.equal(isShown('lgpder-button'), false);

    clickButton('lgpder-preferences', 'Fechar');
    assert.equal(isShown('lgpder-button'), true);
  });

  it('always with floatingButton: false, while openPreferences still opens the center', () => {
    const { ui } = openUi({ floatingButton: false }, { record: DECIDED });

    assert.equal(isShown('lgpder-button'), false);
    ui.openPreferences();
    assert.equal(isShown('lgpder-preferences'), true);
  });
});

describe('the floating button', () => {
  it('opens the full center, with the necessary section', () => {
    openUi(undefined, { record: DECIDED });

    clickButton('lgpder-button', LABEL);

    assert.equal(isShown('lgpder-preferences'), true);
    assert.equal(parts('lgpder-preferences', 'necessary').length, 1);
  });

  it('is named by texts.button.label, with an icon hidden from assistive technology', () => {
    openUi({ texts: { button: { label: 'Privacidade' } } }, { record: DECIDED });

    const [button] = buttonsOf('lgpder-button');
    assert.ok(button);
    assert.equal(button.getAttribute('aria-label'), 'Privacidade');
    assert.equal(button.getAttribute('part'), 'button');
    assert.equal(button.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  });
});
