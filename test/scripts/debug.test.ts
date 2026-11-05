/** Development warnings of `debug: true`: written to the console, never blocking anything. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { testDom } from '../support/dom.ts';
import {
  captureWarnings,
  closePages,
  find,
  flushMicrotasks,
  openPage,
  render,
} from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

const GA = 'https://www.googletagmanager.com/gtag/js?id=G-XXXX';
const ADS = 'https://www.googletagmanager.com/gtag/js?id=AW-123';
const ANALYTICS_GRANTED = serialized({ analytics: decisionOf('granted', { version: '2026-10' }) });

describe('scripts of known integrations without data-consent', () => {
  const SCRIPTS = [
    { integration: 'google-analytics', src: GA },
    { integration: 'google-analytics', src: 'https://www.google-analytics.com/analytics.js' },
    { integration: 'google-ads', src: ADS },
    { integration: 'google-ads', src: 'https://www.googleadservices.com/pagead/conversion.js' },
    {
      integration: 'google-ads',
      src: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    },
    { integration: 'google-ads', src: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js' },
  ] as const;

  for (const { integration, src } of SCRIPTS) {
    it(`warns about ${src}, without blocking it`, (t) => {
      const warnings = captureWarnings(t);
      render(`<script src="${src}"></script>`);

      openPage({ debug: true });

      assert.deepStrictEqual(warnings, [
        `[lgpder] Script of the "${integration}" integration has no data-consent: ${src}.`,
      ]);
      assert.equal(find('script').getAttribute('src'), src);
    });
  }

  it('says nothing about other scripts or about blocked ones', (t) => {
    const warnings = captureWarnings(t);
    render(
      `<script src="https://cdn.example/app.js"></script><script type="text/plain" data-consent="analytics" data-src="${GA}"></script>`,
    );

    openPage({ debug: true });

    assert.deepStrictEqual(warnings, []);
  });

  it('warns once per script, across scans', (t) => {
    const warnings = captureWarnings(t);
    render(`<script src="${GA}"></script>`);
    const { scripts } = openPage({ debug: true });

    scripts.scan();

    assert.equal(warnings.length, 1);
  });

  it('looks only under the scanned root', (t) => {
    const warnings = captureWarnings(t);
    render('<div id="route"></div>');
    const { scripts } = openPage({ debug: true });
    document.body.insertAdjacentHTML('beforeend', `<script src="${GA}"></script>`);

    scripts.scan(find('#route'));

    assert.deepStrictEqual(warnings, []);
  });
});

describe('scripts with data-consent but without type="text/plain"', () => {
  for (const script of [
    `<script data-consent="analytics" src="${GA}"></script>`,
    '<script type="module" data-consent="analytics">track();</script>',
  ]) {
    it(`warns that ${script} runs without consent, once, without blocking it`, (t) => {
      const warnings = captureWarnings(t);
      render(script);
      const { scripts } = openPage({ debug: true });

      scripts.scan();

      assert.deepStrictEqual(warnings, [
        '[lgpder] data-consent="analytics" is on a script without type="text/plain"; it runs without consent.',
      ]);
      assert.equal(find('script').hasAttribute('data-consent-active'), false);
    });
  }

  it('says nothing about the scripts the layer activated', (t) => {
    const warnings = captureWarnings(t);
    render('<script type="text/plain" data-consent="analytics">track();</script>');
    const { scripts } = openPage({ debug: true }, { record: ANALYTICS_GRANTED });

    scripts.scan();

    assert.equal(find('script').getAttribute('type'), null);
    assert.deepStrictEqual(warnings, []);
  });
});

describe('elements that stay blocked or are blocked again', () => {
  for (const value of ['', 'unknown']) {
    it(`warns about data-consent="${value}"`, (t) => {
      const warnings = captureWarnings(t);
      render(`<script type="text/plain" data-consent="${value}">x();</script>`);

      openPage({ debug: true });

      assert.deepStrictEqual(warnings, [
        `[lgpder] data-consent="${value}" names an unknown purpose or none; it stays blocked.`,
      ]);
    });
  }

  it('warns about an element loaded before consent', (t) => {
    const warnings = captureWarnings(t);
    render('<img data-consent="ads" src="https://tracker.example/pixel.gif" alt="">');

    openPage({ debug: true });

    assert.deepStrictEqual(warnings, [
      '[lgpder] data-consent="ads" was loaded before consent; it is blocked again.',
    ]);
  });

  it('says nothing about an element loaded with every purpose granted', (t) => {
    const warnings = captureWarnings(t);
    render('<img data-consent="ads" src="https://tracker.example/pixel.gif" alt="">');

    openPage({ debug: true }, { record: serialized({ ads: decisionOf('granted') }) });

    assert.deepStrictEqual(warnings, []);
  });
});

describe('a revocation that leaves code running without a reload', () => {
  it("warns in the 'manual' mode", (t) => {
    const warnings = captureWarnings(t);
    render('<script type="text/plain" data-consent="analytics">track();</script>');
    const { consent } = openPage(
      { debug: true, revocation: 'manual' },
      { record: ANALYTICS_GRANTED },
    );

    consent.decide({ analytics: 'denied' });

    assert.deepStrictEqual(warnings, [
      '[lgpder] Revoked purposes left code running until a reload: analytics.',
    ]);
  });

  it('warns when canReload refuses the reload', async (t) => {
    const warnings = captureWarnings(t);
    render('<script type="text/plain" data-consent="analytics">track();</script>');
    const { consent } = openPage(
      { debug: true, canReload: () => false },
      { record: ANALYTICS_GRANTED },
    );

    consent.decide({ analytics: 'denied' });
    await flushMicrotasks();

    assert.deepStrictEqual(warnings, [
      '[lgpder] Reload skipped: the revocation is not known to be saved.',
    ]);
  });
});

describe('without debug', () => {
  it('never writes to the console', async (t) => {
    const warnings = captureWarnings(t);
    render(
      `<script src="${GA}"></script><script type="text/plain" data-consent="">x();</script><script type="text/plain" data-consent="analytics">track();</script>`,
    );
    const { consent } = openPage({ canReload: () => false }, { record: ANALYTICS_GRANTED });

    consent.decide({ analytics: 'denied' });
    await flushMicrotasks();

    assert.deepStrictEqual(warnings, []);
  });
});
