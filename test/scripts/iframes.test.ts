/** Iframes and images blocked by data-consent: placeholder, load(), revocation and destroy. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { captureMicrotasks } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import { closePages, find, findAll, openPage, recordingRenderer, render } from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

const VIDEO = 'https://www.youtube-nocookie.com/embed/abc';
const PIXEL = 'https://tracker.example/pixel.gif';
const IFRAME = `<iframe data-consent="ads" data-src="${VIDEO}" width="560"></iframe>`;

/** The only placeholders in the document. */
function placeholders(): Element[] {
  return findAll('.placeholder');
}

describe('a blocked iframe', () => {
  it('has no src while its purpose is not granted', () => {
    render(IFRAME);

    openPage();

    assert.equal(find('iframe').hasAttribute('src'), false);
  });

  it('shows the placeholder of the renderer right before it, and is hidden meanwhile', () => {
    render(IFRAME);
    const renderer = recordingRenderer();

    openPage({ renderPlaceholder: renderer.render });

    const iframe = find('iframe');
    assert.equal(iframe.previousElementSibling, placeholders()[0]);
    assert.equal(iframe.hasAttribute('hidden'), true);
  });

  it('gives the renderer a frozen context with the iframe and its purposes in attribute order', () => {
    render(`<iframe data-consent="health ads" data-src="${VIDEO}"></iframe>`);
    const renderer = recordingRenderer();

    openPage({ renderPlaceholder: renderer.render });

    const [context] = renderer.contexts;
    assert.ok(context);
    assert.ok(Object.isFrozen(context));
    assert.ok(Object.isFrozen(context.purposes));
    assert.equal(context.element, find('iframe'));
    assert.deepStrictEqual(context.purposes, ['health', 'ads']);
  });

  it('calls the renderer once per block, even when it throws, across notifications and scans', (t) => {
    captureMicrotasks(t);
    render(IFRAME);
    let calls = 0;
    const { consent, scripts } = openPage({
      renderPlaceholder: () => {
        calls += 1;
        throw new Error('faulty renderer');
      },
    });

    consent.decide({ analytics: 'granted' });
    consent.decide({ health: 'denied' });
    scripts.scan();
    scripts.onGranted('analytics', () => undefined);

    assert.equal(calls, 1);
  });

  it('without a renderer, inserts nothing and is left as written', () => {
    render(IFRAME);

    openPage();

    assert.equal(document.body.innerHTML, IFRAME);
  });

  it('a renderer that throws leaves it as written, and the error is rethrown in a microtask', (t) => {
    const scheduled = captureMicrotasks(t);
    render(IFRAME);
    const failure = new Error('faulty renderer');

    openPage({
      renderPlaceholder: () => {
        throw failure;
      },
    });

    assert.equal(document.body.innerHTML, IFRAME);
    const [rethrow] = scheduled;
    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === failure);
  });

  const NOT_ELEMENTS: readonly { readonly case: string; readonly make: () => unknown }[] = [
    { case: 'null', make: () => null },
    { case: 'a string', make: () => '<div></div>' },
    { case: 'a text node', make: () => document.createTextNode('placeholder') },
  ];

  for (const { case: label, make } of NOT_ELEMENTS) {
    it(`a renderer that returns ${label} inserts nothing, and the page goes on`, (t) => {
      const scheduled = captureMicrotasks(t);
      render(`${IFRAME}<img data-consent="ads" data-src="${PIXEL}" alt="">`);
      const { consent, scripts } = openPage({ renderPlaceholder: make as () => Element });
      const [rethrow] = scheduled;

      assert.equal(find('iframe').previousSibling, null);
      assert.equal(find('iframe').hasAttribute('hidden'), false);
      assert.ok(rethrow);
      assert.throws(rethrow, {
        name: 'TypeError',
        message: '[lgpder] "renderPlaceholder" must return an element.',
      });
      consent.decide({ ads: 'granted' });
      assert.equal(find('iframe').getAttribute('src'), VIDEO);
      assert.equal(find('img').getAttribute('src'), PIXEL);
      assert.doesNotThrow(scripts.destroy);
    });
  }
});

describe('a grant', () => {
  it('loads the iframe from data-src, removes the placeholder and shows the iframe', () => {
    render(IFRAME);
    const { consent } = openPage({ renderPlaceholder: recordingRenderer().render });

    consent.decide({ ads: 'granted' });

    const iframe = find('iframe');
    assert.equal(iframe.getAttribute('src'), VIDEO);
    assert.ok(iframe.hasAttribute('data-consent-active'));
    assert.equal(iframe.hasAttribute('hidden'), false);
    assert.deepStrictEqual(placeholders(), []);
  });

  it('gives back the hidden attribute written by the author', () => {
    render(`<iframe hidden="until-found" data-consent="ads" data-src="${VIDEO}"></iframe>`);
    const { consent } = openPage({ renderPlaceholder: recordingRenderer().render });

    consent.decide({ ads: 'granted' });

    assert.equal(find('iframe').getAttribute('hidden'), 'until-found');
  });

  it('loads an image from data-src, and never renders a placeholder for it', () => {
    render(`<img data-consent="ads" data-src="${PIXEL}" alt="">`);
    const renderer = recordingRenderer();
    const { consent } = openPage({ renderPlaceholder: renderer.render });

    assert.deepStrictEqual(renderer.contexts, []);
    consent.decide({ ads: 'granted' });

    assert.equal(find('img').getAttribute('src'), PIXEL);
  });
});

describe('load() of the placeholder', () => {
  it('loads only this iframe, without recording a decision', () => {
    render(`${IFRAME}${IFRAME.replace('560', '320')}`);
    const renderer = recordingRenderer();
    const { consent, changes } = openPage({ renderPlaceholder: renderer.render });
    const [first] = renderer.contexts;
    assert.ok(first);

    first.load();

    const [loaded, blocked] = findAll('iframe');
    assert.equal(loaded?.getAttribute('src'), VIDEO);
    assert.equal(blocked?.hasAttribute('src'), false);
    assert.equal(placeholders().length, 1);
    assert.deepStrictEqual(changes, []);
    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('keeps the content while the purpose stays pending', () => {
    render(IFRAME);
    const renderer = recordingRenderer();
    const { consent } = openPage({ renderPlaceholder: renderer.render });
    renderer.contexts[0]?.load();

    consent.decide({ analytics: 'granted' });

    assert.equal(find('iframe').getAttribute('src'), VIDEO);
  });

  it('followed by a refusal, unloads it and shows the placeholder again', () => {
    render(IFRAME);
    const renderer = recordingRenderer();
    const { consent } = openPage({ renderPlaceholder: renderer.render });
    const loaded = find('iframe');
    renderer.contexts[0]?.load();

    consent.denyAll();

    const iframe = find('iframe');
    assert.notEqual(iframe, loaded);
    assert.equal(iframe.hasAttribute('src'), false);
    assert.equal(loaded.isConnected, false);
    assert.equal(placeholders().length, 1);
  });

  it('on content already refused, keeps it until a new refusal', () => {
    render(IFRAME);
    const renderer = recordingRenderer();
    const { consent } = openPage({ renderPlaceholder: renderer.render });
    consent.decide({ ads: 'denied' });
    renderer.contexts.at(-1)?.load();

    consent.decide({ analytics: 'granted' });

    assert.equal(find('iframe').getAttribute('src'), VIDEO);
  });

  it('is covered by consent once the purpose is granted: a later revocation blocks it', () => {
    render(IFRAME);
    const renderer = recordingRenderer();
    const { consent } = openPage({ renderPlaceholder: renderer.render });
    renderer.contexts[0]?.load();
    consent.decide({ ads: 'granted' });

    consent.restore(null);

    assert.equal(find('iframe').hasAttribute('src'), false);
  });

  it('does nothing once the iframe was loaded, blocked again or the layer destroyed', () => {
    render(IFRAME);
    const renderer = recordingRenderer();
    const { consent, scripts } = openPage({ renderPlaceholder: renderer.render });
    const [stale] = renderer.contexts;
    assert.ok(stale);
    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });

    stale.load();
    assert.equal(find('iframe').hasAttribute('src'), false);

    scripts.destroy();
    renderer.contexts.at(-1)?.load();
    assert.equal(find('iframe').hasAttribute('src'), false);
  });
});

describe('revocation and a new grant', () => {
  it('a revocation swaps the iframe for a blocked copy and shows the placeholder again', () => {
    render(IFRAME);
    const renderer = recordingRenderer();
    const { consent } = openPage({ renderPlaceholder: renderer.render });
    consent.decide({ ads: 'granted' });
    const loaded = find('iframe');

    consent.decide({ ads: 'denied' });

    const blocked = find('iframe');
    assert.equal(loaded.isConnected, false);
    assert.equal(blocked.hasAttribute('src'), false);
    assert.equal(blocked.hasAttribute('data-consent-active'), false);
    assert.equal(blocked.getAttribute('width'), '560');
    assert.equal(blocked.previousElementSibling, placeholders()[0]);
    assert.equal(renderer.contexts.at(-1)?.element, blocked);
  });

  it('a new grant loads the content again', () => {
    render(IFRAME);
    const { consent } = openPage({ renderPlaceholder: recordingRenderer().render });
    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });

    consent.decide({ ads: 'granted' });

    assert.equal(find('iframe').getAttribute('src'), VIDEO);
    assert.deepStrictEqual(placeholders(), []);
  });

  it('a revocation blocks an image again', () => {
    render(`<img data-consent="ads" data-src="${PIXEL}" alt="">`);
    const { consent } = openPage();
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: 'denied' });

    assert.equal(find('img').hasAttribute('src'), false);
  });
});

describe('an element with src before the scan', () => {
  it('is blocked when its purpose is not granted: src, srcset and the mark are dropped', () => {
    render(
      `<img data-consent="ads" src="${PIXEL}" srcset="${PIXEL} 2x" data-src="${PIXEL}" data-consent-active alt="">`,
    );
    const written = find('img');

    openPage();

    const img = find('img');
    assert.notEqual(img, written);
    assert.deepStrictEqual(img.getAttributeNames(), ['data-consent', 'data-src', 'alt']);
  });

  it('is kept as it is, and marked active, when every purpose is granted', () => {
    render(`<iframe data-consent="ads" src="${VIDEO}"></iframe>`);
    const written = find('iframe');

    openPage(undefined, { record: serialized({ ads: decisionOf('granted') }) });

    assert.equal(find('iframe'), written);
    assert.equal(written.getAttribute('src'), VIDEO);
    assert.ok(written.hasAttribute('data-consent-active'));
  });
});

describe('destroy', () => {
  it('made by the renderer stops the rendering of the other iframes', () => {
    let calls = 0;
    const { scripts } = openPage({
      renderPlaceholder: () => {
        calls += 1;
        scripts.destroy();
        return document.createElement('div');
      },
    });
    render(`${IFRAME}${IFRAME}`);

    scripts.scan();

    assert.equal(calls, 1);
  });

  it('removes the placeholders and shows the blocked iframes, without loading them', () => {
    render(IFRAME);
    const { scripts } = openPage({ renderPlaceholder: recordingRenderer().render });

    scripts.destroy();

    assert.equal(document.body.innerHTML, IFRAME);
  });

  it('keeps the loaded content', () => {
    render(IFRAME);
    const { consent, scripts } = openPage({ renderPlaceholder: recordingRenderer().render });
    consent.decide({ ads: 'granted' });

    scripts.destroy();
    consent.decide({ ads: 'denied' });

    assert.equal(find('iframe').getAttribute('src'), VIDEO);
  });

  it('is idempotent', () => {
    const { scripts } = openPage();

    scripts.destroy();

    assert.doesNotThrow(() => {
      scripts.destroy();
    });
  });
});
