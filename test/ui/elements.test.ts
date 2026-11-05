/**
 * Registration of the custom elements on demand (D17): nothing on import, once by mountUi or
 * createPlaceholder, and an error when another copy of the library took a tag. The first test needs
 * a registry that no test touched: node:test runs each file in its own process.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, type TestContext } from 'node:test';

import { JSDOM } from 'jsdom';

import { createPlaceholder, mountUi } from '../../src/ui/index.ts';
import { testDom } from '../support/dom.ts';
import { setup } from '../support/setup.ts';
import { closeUis, mountOn } from '../support/ui.ts';

afterEach(() => {
  closeUis();
  testDom.reset();
});

const TAGS = ['lgpder-banner', 'lgpder-preferences', 'lgpder-button', 'lgpder-placeholder'];

/** The class registered for each tag in `registry`. */
function definitions(registry: CustomElementRegistry): (CustomElementConstructor | undefined)[] {
  return TAGS.map((tag) => registry.get(tag));
}

/**
 * Replaces the global registry, until the end of the test, with the one of a new window where
 * `taken` is defined by a class of its own, as another copy of the library would. Returns that
 * registry.
 */
function registryWithForeign(t: TestContext, taken: string): CustomElementRegistry {
  const { window } = new JSDOM('<!doctype html>');
  window.customElements.define(taken, class extends window.HTMLElement {});
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    get: () => window.customElements,
  });
  t.after(() => {
    Object.defineProperty(globalThis, 'customElements', {
      configurable: true,
      get: () => testDom.window.customElements,
    });
  });
  return window.customElements;
}

describe('the custom elements', () => {
  it('are not defined by importing the layer', () => {
    assert.deepStrictEqual(definitions(customElements), [
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('are all defined by createPlaceholder', () => {
    createPlaceholder(setup().consent);

    assert.ok(definitions(customElements).every((definition) => definition !== undefined));
  });

  it('are defined once: mounting again keeps the same classes, without error', () => {
    const before = definitions(customElements);

    mountOn(setup());
    mountOn(setup());

    assert.deepStrictEqual(definitions(customElements), before);
  });

  it('have an open shadow root with the style sheet', () => {
    mountOn(setup());

    for (const tag of TAGS.slice(0, 3)) {
      const style = document.querySelector(tag)?.shadowRoot?.firstElementChild;
      assert.equal(style?.localName, 'style', tag);
    }
  });
});

describe('a tag defined by another copy of the library', () => {
  it('makes mountUi throw before defining or mounting anything', (t) => {
    const registry = registryWithForeign(t, 'lgpder-button');

    assert.throws(() => mountUi(setup().consent), {
      name: 'Error',
      message:
        '[lgpder] The custom element "lgpder-button" is already defined by another copy of lgpder.',
    });
    assert.equal(registry.get('lgpder-banner'), undefined);
    assert.equal(document.body.childElementCount, 0);
  });

  it('makes createPlaceholder throw', (t) => {
    registryWithForeign(t, 'lgpder-placeholder');

    assert.throws(() => createPlaceholder(setup().consent), {
      message:
        '[lgpder] The custom element "lgpder-placeholder" is already defined by another copy of lgpder.',
    });
  });
});
