/**
 * Elements removed from the document are forgotten on the next scan or reconciliation, as in a
 * single-page application that scans each route, and a connection that fails leaves nothing behind.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { connectScripts } from '../../src/scripts/index.ts';
import { testDom } from '../support/dom.ts';
import {
  closePages,
  cookieNames,
  find,
  findAll,
  openPage,
  recordingRenderer,
  render,
} from '../support/page.ts';
import { setup } from '../support/setup.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

const IFRAME = '<iframe data-consent="ads" data-src="https://video.example/embed"></iframe>';

describe('a removed element', () => {
  it('is not activated by a later grant', () => {
    render(IFRAME);
    const { consent } = openPage();
    const removed = find('iframe');
    removed.remove();

    consent.decide({ ads: 'granted' });

    assert.equal(removed.hasAttribute('src'), false);
  });

  it('takes its placeholder with it on the next reconciliation', () => {
    render(IFRAME);
    const { consent } = openPage({ renderPlaceholder: recordingRenderer().render });
    find('iframe').remove();

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(findAll('.placeholder'), []);
  });

  it('is processed as new when inserted again and scanned', () => {
    render(IFRAME);
    const { consent, scripts } = openPage();
    const iframe = find('iframe');
    iframe.remove();
    consent.decide({ analytics: 'granted' });
    document.body.append(iframe);

    consent.decide({ ads: 'granted' });
    assert.equal(iframe.hasAttribute('src'), false);
    scripts.scan();

    assert.equal(iframe.getAttribute('src'), 'https://video.example/embed');
  });

  it('a removed blocked script is not activated by a later grant', () => {
    render('<script type="text/plain" data-consent="ads">ads();</script>');
    const { consent } = openPage();
    const removed = find('script');
    removed.remove();

    consent.decide({ ads: 'granted' });

    assert.equal(removed.getAttribute('type'), 'text/plain');
    assert.deepStrictEqual(findAll('script'), []);
  });
});

describe('a connection that fails', () => {
  it('leaves no subscription to the manager behind', (t) => {
    const failure = new Error('broken document');
    document.cookie = '_ga=1; Path=/';
    const { consent } = setup();
    t.mock.method(document, 'querySelectorAll', () => {
      throw failure;
    });

    assert.throws(
      () =>
        connectScripts(consent, {
          purposes: { analytics: { integrations: ['google-analytics'] } },
        }),
      (error) => error === failure,
    );
    t.mock.restoreAll();
    consent.decide({ ads: 'granted' });

    // A subscription left behind would reconcile here, and its first pass would sweep _ga.
    assert.deepStrictEqual(cookieNames(), ['_ga']);
  });
});
