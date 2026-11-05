/**
 * A later instance on the same page, as after React StrictMode, hot reload or destroy followed by
 * a new connection: it learns from the document what the earlier one activated.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { testDom } from '../support/dom.ts';
import { closePages, find, flushMicrotasks, openPage, render } from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

const ADS_GRANTED = serialized({ ads: decisionOf('granted') });
const VIDEO = 'https://video.example/embed';

/** Opens a page with ads granted on `html`, then destroys its layer, leaving the document as is. */
function leaveEarlierInstance(html: string): void {
  render(html);
  openPage(undefined, { record: ADS_GRANTED }).scripts.destroy();
}

describe('a later instance', () => {
  it('sees the scripts activated by the earlier one, and reloads on their revocation', async () => {
    leaveEarlierInstance('<script type="text/plain" data-consent="ads">ads();</script>');
    const { consent, scripts } = openPage(undefined, { record: ADS_GRANTED });

    assert.equal(scripts.wouldReload({ ads: 'denied' }), true);
    consent.decide({ ads: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 1);
  });

  it('never runs those scripts again', () => {
    leaveEarlierInstance('<script type="text/plain" data-consent="ads">ads();</script>');

    openPage(undefined, { record: ADS_GRANTED });

    assert.equal(document.querySelectorAll('script').length, 1);
  });

  it('adopts an iframe loaded by the earlier one while its purpose is granted', () => {
    leaveEarlierInstance(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`);
    const loaded = find('iframe');

    openPage(undefined, { record: ADS_GRANTED });

    assert.equal(find('iframe'), loaded);
    assert.equal(loaded.getAttribute('src'), VIDEO);
  });

  it('blocks an iframe loaded by the earlier one when its purpose is no longer granted', () => {
    leaveEarlierInstance(`<iframe data-consent="ads" data-src="${VIDEO}"></iframe>`);

    openPage();

    assert.equal(find('iframe').hasAttribute('src'), false);
  });
});
