/** Scripts blocked by data-consent: activation, attributes, order, tokens, scan and loading. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { finishLoading, startLoading, testDom } from '../support/dom.ts';
import { closePages, find, findAll, openPage, render } from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { withObjectPollution } from '../support/setup.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

const GTAG = 'https://www.googletagmanager.com/gtag/js?id=G-XXXX';

/** Whether `script` was activated: a real script, no longer `text/plain`. */
function isActive(script: Element): boolean {
  return !script.hasAttribute('type') && script.hasAttribute('data-consent-active');
}

describe('an inline script', () => {
  it('stays text/plain while its purpose is pending', () => {
    render('<script type="text/plain" data-consent="analytics">track();</script>');

    openPage();

    assert.equal(find('script').getAttribute('type'), 'text/plain');
  });

  it('becomes a real script with the same content on a grant', () => {
    render('<script type="text/plain" data-consent="analytics">track();</script>');
    const { consent } = openPage();

    consent.decide({ analytics: 'granted' });

    const script = find('script');
    assert.ok(isActive(script));
    assert.equal(script.textContent, 'track();');
    assert.equal(script.hasAttribute('src'), false);
  });

  it('is activated on connection when its purpose is already granted', () => {
    render('<script type="text/plain" data-consent="ads">ads();</script>');

    openPage(undefined, { record: serialized({ ads: decisionOf('granted') }) });

    assert.ok(isActive(find('script')));
  });

  it('stays text/plain after a refusal', () => {
    render('<script type="text/plain" data-consent="analytics">track();</script>');
    const { consent } = openPage();

    consent.decide({ analytics: 'denied' });

    assert.equal(find('script').getAttribute('type'), 'text/plain');
  });
});

describe('an external script', () => {
  it('gets src from data-src on a grant, without data-src', () => {
    render(`<script type="text/plain" data-consent="analytics" data-src="${GTAG}"></script>`);
    const { consent } = openPage();

    consent.decide({ analytics: 'granted' });

    const script = find('script');
    assert.ok(isActive(script));
    assert.equal(script.getAttribute('src'), GTAG);
    assert.equal(script.hasAttribute('data-src'), false);
  });
});

describe('the activated script', () => {
  it('keeps every other attribute, data-consent included, and drops type and data-src', () => {
    render(
      `<script type="text/plain" id="tag" class="tracking" crossorigin="anonymous" referrerpolicy="no-referrer" data-extra="1" data-consent="analytics" data-src="${GTAG}"></script>`,
    );
    const { consent } = openPage();

    consent.decide({ analytics: 'granted' });

    const script = find('script');
    assert.deepStrictEqual(
      script.getAttributeNames().sort(),
      [
        'class',
        'crossorigin',
        'data-consent',
        'data-consent-active',
        'data-extra',
        'id',
        'referrerpolicy',
        'src',
      ].sort(),
    );
    assert.equal(script.getAttribute('data-consent'), 'analytics');
    assert.equal(script.getAttribute('crossorigin'), 'anonymous');
  });

  it('copies the nonce property, which the browser hides from the attribute', () => {
    render('<script type="text/plain" nonce="r4nd0m" data-consent="analytics">track();</script>');
    const original = find('script');
    // As a browser does after parsing: the attribute reads empty, only the property keeps it.
    original.setAttribute('nonce', '');
    Object.defineProperty(original, 'nonce', { value: 'r4nd0m' });
    const { consent } = openPage();

    consent.decide({ analytics: 'granted' });

    assert.equal((find('script') as HTMLScriptElement).nonce, 'r4nd0m');
  });

  it('has async set to false, even when the blocked script had the async attribute', () => {
    render(`<script type="text/plain" async data-consent="analytics" data-src="${GTAG}"></script>`);
    const { consent } = openPage();

    consent.decide({ analytics: 'granted' });

    const script = find('script') as HTMLScriptElement;
    assert.equal(script.async, false);
    assert.equal(script.hasAttribute('async'), false);
  });

  it('replaces the blocked one at the same position', () => {
    render(
      '<p id="before"></p><script type="text/plain" data-consent="analytics">a();</script><p id="after"></p>',
    );
    const { consent } = openPage();

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(
      [...document.body.children].map((element) => element.id || element.localName),
      ['before', 'script', 'after'],
    );
  });
});

describe('order', () => {
  it('activates the scripts of one grant in document order', () => {
    render(
      [
        '<script type="text/plain" data-consent="analytics" id="first">1</script>',
        '<script type="text/plain" data-consent="ads" id="second">2</script>',
        '<script type="text/plain" data-consent="analytics" id="third">3</script>',
      ].join(''),
    );
    const { consent } = openPage();
    const observer = new testDom.window.MutationObserver(() => undefined);
    observer.observe(document.body, { childList: true });

    consent.decide({ analytics: 'granted', ads: 'granted' });

    const inserted = observer
      .takeRecords()
      .flatMap((record) => [...record.addedNodes])
      .map((node) => (node as Element).id);
    observer.disconnect();
    assert.deepStrictEqual(inserted, ['first', 'second', 'third']);
  });
});

describe('data-consent with several purposes', () => {
  const HTML = '<script type="text/plain" data-consent="analytics  ads">both();</script>';

  it('stays blocked while only one of them is granted', () => {
    render(HTML);
    const { consent } = openPage();

    consent.decide({ analytics: 'granted' });

    assert.equal(isActive(find('script')), false);
  });

  it('is activated when all of them are granted', () => {
    render(HTML);
    const { consent } = openPage();

    consent.decide({ analytics: 'granted' });
    consent.decide({ ads: 'granted' });

    assert.ok(isActive(find('script')));
  });
});

describe('data-consent that names no configured purpose', () => {
  const CASES = [
    { case: 'empty', value: '' },
    { case: 'only spaces', value: ' \t ' },
    { case: 'an unknown purpose', value: 'unknown' },
    { case: 'a configured and an unknown purpose', value: 'analytics unknown' },
    { case: 'a property of Object.prototype', value: 'toString' },
  ] as const;

  for (const { case: name, value } of CASES) {
    it(`never activates with ${name}, and does not throw`, () => {
      render(`<script type="text/plain" data-consent="${value}">never();</script>`);
      const { consent } = openPage();

      consent.decide({ analytics: 'granted', ads: 'granted', health: 'granted' });

      assert.equal(find('script').getAttribute('type'), 'text/plain');
    });
  }

  it('never activates a purpose planted as granted on Object.prototype', () => {
    render('<script type="text/plain" data-consent="planted">never();</script>');

    withObjectPollution({ planted: 'granted' }, () => {
      const { consent } = openPage();
      consent.decide({ analytics: 'granted' });
    });

    assert.equal(find('script').getAttribute('type'), 'text/plain');
  });
});

describe('scan', () => {
  it('a script inserted after the connection waits for scan, even when granted', () => {
    render('');
    const { consent, scripts } = openPage();
    consent.decide({ analytics: 'granted' });
    document.body.innerHTML = '<script type="text/plain" data-consent="analytics">late();</script>';

    assert.equal(isActive(find('script')), false);
    scripts.scan();

    assert.ok(isActive(find('script')));
  });

  it('processes only the elements under root', () => {
    render('<div id="inside"></div><div id="outside"></div>');
    const { consent, scripts } = openPage();
    consent.decide({ analytics: 'granted' });
    for (const id of ['inside', 'outside']) {
      find(`#${id}`).innerHTML =
        `<script type="text/plain" data-consent="analytics">${id}();</script>`;
    }

    scripts.scan(find('#inside'));

    assert.ok(isActive(find('#inside script')));
    assert.equal(isActive(find('#outside script')), false);
  });

  it('never activates the same script twice', () => {
    render('<script type="text/plain" data-consent="analytics">once();</script>');
    const { consent, scripts } = openPage({ revocation: 'manual' });
    consent.decide({ analytics: 'granted' });

    scripts.scan();
    consent.decide({ analytics: 'denied' });
    consent.decide({ analytics: 'granted' });
    scripts.scan();

    assert.equal(findAll('script').length, 1);
  });

  it('throws after destroy', () => {
    const { scripts } = openPage();
    scripts.destroy();

    assert.throws(
      () => {
        scripts.scan();
      },
      { name: 'Error', message: '[lgpder] This instance was destroyed.' },
    );
  });
});

describe('a document still loading', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'readyState');
  });

  it('waits for DOMContentLoaded before the first scan', () => {
    render('<script type="text/plain" data-consent="ads">ads();</script>');
    startLoading();

    openPage(undefined, { record: serialized({ ads: decisionOf('granted') }) });

    assert.equal(isActive(find('script')), false);
    finishLoading();
    assert.ok(isActive(find('script')));
  });

  it('follows the manager before DOMContentLoaded, so the scan applies the latest state', () => {
    render('<script type="text/plain" data-consent="ads">ads();</script>');
    startLoading();
    const { consent } = openPage(undefined, { record: serialized({ ads: decisionOf('granted') }) });

    consent.decide({ ads: 'denied' });
    finishLoading();

    assert.equal(find('script').getAttribute('type'), 'text/plain');
  });

  it('scans nothing when destroyed before DOMContentLoaded', () => {
    render('<script type="text/plain" data-consent="ads">ads();</script>');
    startLoading();
    const { scripts } = openPage(undefined, { record: serialized({ ads: decisionOf('granted') }) });

    scripts.destroy();
    finishLoading();

    assert.equal(find('script').getAttribute('type'), 'text/plain');
  });

  it('destroy removes the DOMContentLoaded listener it added', (t) => {
    const added = t.mock.method(document, 'addEventListener');
    const removed = t.mock.method(document, 'removeEventListener');
    startLoading();
    const { scripts } = openPage();

    scripts.destroy();

    const listenersOf = (calls: typeof added.mock.calls): unknown[] =>
      calls
        .filter(({ arguments: [type] }) => type === 'DOMContentLoaded')
        .map((call) => call.arguments[1]);
    const [listener] = listenersOf(added.mock.calls);
    assert.ok(listener);
    assert.deepStrictEqual(listenersOf(removed.mock.calls), [listener]);
  });
});
