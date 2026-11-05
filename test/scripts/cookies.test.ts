/** Cookie cleanup: built-in lists, own patterns, parent domains, Secure and the sweep on connection. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { RevokeEvent, ScriptsOptions } from 'lgpder/scripts';

import { connectScripts } from '../../src/scripts/index.ts';
import { captureMicrotasks } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import {
  closePages,
  cookieNames,
  cookieWrites,
  find,
  openPage,
  refuseCookies,
  render,
} from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, setup, type PurposeId } from '../support/setup.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

const BOTH_GRANTED = serialized({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('granted'),
});

/** Sets each cookie on the current page, host-only, with `Path=/`. */
function setCookies(...names: string[]): void {
  for (const name of names) document.cookie = `${name}=1; Path=/`;
}

/** Opens a page with both purposes granted, then revokes analytics. */
function revokeAnalytics(options: ScriptsOptions<PurposeId>): void {
  const { consent } = openPage({ revocation: 'manual', ...options }, { record: BOTH_GRANTED });
  consent.decide({ analytics: 'denied' });
}

describe('the built-in lists', () => {
  it('google-analytics removes _ga, _ga_*, _gid, _gat, _gat_* and _gac_*', () => {
    setCookies('_ga', '_ga_ABC123', '_gid', '_gat', '_gat_UA1', '_gac_UA1', '_gads', 'session');

    revokeAnalytics({ purposes: { analytics: { integrations: ['google-analytics'] } } });

    assert.deepStrictEqual(cookieNames(), ['_gads', 'session']);
  });

  it('google-ads removes _gcl_*', () => {
    setCookies('_gcl_au', '_gcl_aw', '_ga', 'session');
    const { consent } = openPage(
      { purposes: { ads: { integrations: ['google-ads'] } } },
      {
        record: BOTH_GRANTED,
      },
    );

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(cookieNames(), ['_ga', 'session']);
  });
});

describe('own patterns', () => {
  it('an exact name removes only that name', () => {
    setCookies('tracker', 'tracker_id', 'session');

    revokeAnalytics({ purposes: { analytics: { cookies: ['tracker'] } } });

    assert.deepStrictEqual(cookieNames(), ['tracker_id', 'session']);
  });

  it('a trailing * removes every name with the prefix', () => {
    setCookies('my_tracker', 'my_tracker_1', 'my_tracker_abc', 'session');

    revokeAnalytics({ purposes: { analytics: { cookies: ['my_tracker_*'] } } });

    assert.deepStrictEqual(cookieNames(), ['my_tracker', 'session']);
  });

  it('are added to the ones of the integrations', () => {
    setCookies('_ga', 'mine', 'session');

    revokeAnalytics({
      purposes: { analytics: { integrations: ['google-analytics'], cookies: ['mine'] } },
    });

    assert.deepStrictEqual(cookieNames(), ['session']);
  });

  const INVALID = [
    { case: 'a lone *', pattern: '*' },
    { case: 'an empty name', pattern: '' },
    { case: 'a * in the middle', pattern: 'a*b' },
    { case: 'two trailing *', pattern: 'a**' },
    { case: 'a separator', pattern: 'a;b' },
    { case: 'a space', pattern: 'a b' },
    { case: 'not a string', pattern: 1 },
  ] as const;

  for (const { case: label, pattern } of INVALID) {
    it(`refuses ${label} with a TypeError`, () => {
      const { consent } = setup();

      assert.throws(
        () =>
          callUntyped(connectScripts, consent, { purposes: { analytics: { cookies: [pattern] } } }),
        {
          name: 'TypeError',
          message: `[lgpder] Invalid cookie pattern: ${JSON.stringify(String(pattern))}; use a cookie name, optionally ending in "*".`,
        },
      );
    });
  }
});

describe('the removal', () => {
  it('expires the host-only cookie and the one of each parent domain, with Secure on HTTPS', () => {
    setCookies('_ga');
    const { consent } = openPage(
      { purposes: { analytics: { integrations: ['google-analytics'] } } },
      { record: BOTH_GRANTED },
    );

    const written = cookieWrites(() => {
      consent.decide({ analytics: 'denied' });
    });

    assert.deepStrictEqual(written, [
      '_ga=; Path=/; Max-Age=0; Secure',
      '_ga=; Path=/; Max-Age=0; Secure; Domain=www.example.com.br',
      '_ga=; Path=/; Max-Age=0; Secure; Domain=example.com.br',
      '_ga=; Path=/; Max-Age=0; Secure; Domain=com.br',
    ]);
  });

  it('removes a cookie set with Domain on the registrable domain', () => {
    document.cookie = '_ga=1; Path=/; Domain=example.com.br';
    setCookies('_ga');

    revokeAnalytics({ purposes: { analytics: { integrations: ['google-analytics'] } } });

    assert.deepStrictEqual(cookieNames(), []);
  });

  for (const url of ['http://localhost/', 'http://192.168.0.10/', 'http://[::1]/']) {
    it(`on ${url}, expires only the host-only cookie, without Secure`, () => {
      testDom.navigate(url);
      setCookies('_ga');
      const { consent } = openPage(
        { purposes: { analytics: { integrations: ['google-analytics'] } } },
        { record: BOTH_GRANTED },
      );

      const written = cookieWrites(() => {
        consent.decide({ analytics: 'denied' });
      });

      assert.deepStrictEqual(written, ['_ga=; Path=/; Max-Age=0']);
    });
  }

  it('on HTTP, writes no Secure on the parent domains either', () => {
    testDom.navigate('http://app.example.com/');
    setCookies('_ga');
    const { consent } = openPage(
      { purposes: { analytics: { integrations: ['google-analytics'] } } },
      { record: BOTH_GRANTED },
    );

    const written = cookieWrites(() => {
      consent.decide({ analytics: 'denied' });
    });

    assert.deepStrictEqual(written, [
      '_ga=; Path=/; Max-Age=0',
      '_ga=; Path=/; Max-Age=0; Domain=app.example.com',
      '_ga=; Path=/; Max-Age=0; Domain=example.com',
    ]);
  });

  it('touches only the cookies of the revoked purposes', () => {
    setCookies('_ga', '_gcl_au');

    revokeAnalytics({
      purposes: {
        analytics: { integrations: ['google-analytics'] },
        ads: { integrations: ['google-ads'] },
      },
    });

    assert.deepStrictEqual(cookieNames(), ['_gcl_au']);
  });

  it('writes nothing when no cookie matches, and ignores cookies without a name', () => {
    setCookies('session');
    document.cookie = 'nameless; Path=/';

    const written = cookieWrites(() => {
      revokeAnalytics({ purposes: { analytics: { integrations: ['google-analytics'] } } });
    });

    assert.deepStrictEqual(written, []);
  });
});

describe('the sweep on connection', () => {
  it('removes the cookies of every purpose that is not granted', () => {
    setCookies('_ga', '_gcl_au', 'session');

    openPage({
      purposes: {
        analytics: { integrations: ['google-analytics'] },
        ads: { integrations: ['google-ads'] },
      },
    });

    assert.deepStrictEqual(cookieNames(), ['session']);
  });

  it('keeps the cookies of the granted purposes', () => {
    setCookies('_ga', '_gcl_au');

    openPage(
      {
        purposes: {
          analytics: { integrations: ['google-analytics'] },
          ads: { integrations: ['google-ads'] },
        },
      },
      { record: serialized({ ads: decisionOf('granted') }) },
    );

    assert.deepStrictEqual(cookieNames(), ['_gcl_au']);
  });

  it('happens once: a refusal of a pending purpose does not sweep again', () => {
    const { consent } = openPage({
      purposes: { analytics: { integrations: ['google-analytics'] } },
    });
    setCookies('_ga');

    consent.decide({ analytics: 'denied' });

    assert.deepStrictEqual(cookieNames(), ['_ga']);
  });
});

describe('a page that refuses cookies', () => {
  const ANALYTICS_COOKIES: ScriptsOptions<PurposeId> = {
    purposes: { analytics: { integrations: ['google-analytics'] } },
  };

  it('still revokes: onRevoke is called, the page reloads and the error is rethrown', (t) => {
    render('<script type="text/plain" data-consent="analytics">track();</script>');
    const events: RevokeEvent<PurposeId>[] = [];
    const { consent } = openPage(
      { ...ANALYTICS_COOKIES, onRevoke: (event) => events.push(event) },
      { record: BOTH_GRANTED },
    );
    const scheduled = captureMicrotasks(t);
    const refusal = refuseCookies(t);

    consent.decide({ analytics: 'denied' });
    const [rethrow, reload] = scheduled;
    reload?.();

    assert.deepStrictEqual(events, [{ purposes: ['analytics'], requiresReload: true }]);
    assert.equal(testDom.reloads(), 1);
    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === refusal);
  });

  it('still connects, and the layer follows the manager', (t) => {
    const scheduled = captureMicrotasks(t);
    const refusal = refuseCookies(t);
    render('<img data-consent="analytics" data-src="https://tracker.example/pixel.gif" alt="">');

    const { consent } = openPage(ANALYTICS_COOKIES);
    consent.decide({ analytics: 'granted' });

    assert.equal(find('img').getAttribute('src'), 'https://tracker.example/pixel.gif');
    const [rethrow] = scheduled;
    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === refusal);
  });
});
