/**
 * init: how it splits the options among the layers, the order in which it connects them, what it
 * connects only when needed, the rollback of a failed init, the single live instance, what it
 * returns and destroy.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';

import type { InitOptions } from 'lgpder/init';
import type { RevokeEvent } from 'lgpder/scripts';

import { init } from '../../src/init/index.ts';
import { captureWarnings } from '../support/capture.ts';
import { finishLoading, startLoading, testDom, writeFromAnotherTab } from '../support/dom.ts';
import { ENDPOINT, installNetwork } from '../support/evidence.ts';
import { consentWith, dataLayer, lastUpdate, updates } from '../support/google.ts';
import {
  activeScripts,
  afterScriptInsertion,
  blockedScripts,
  closeApps,
  components,
  decidedToday,
  GTAG_SCRIPT,
  GTAG_SRC,
  PURPOSES,
  readAtReload,
  savedRecord,
  savedStatus,
  setCookie,
  startApp,
  startExample,
  TODAY,
  trackListeners,
  type PurposeId,
} from '../support/init.ts';
import { createMemoryAdapter } from '../support/memory-adapter.ts';
import { cookieNames, flushMicrotasks } from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, DEFAULT_MAX_AGE, withObjectPollution } from '../support/setup.ts';
import {
  buttonNamed,
  buttonsOf,
  clickButton,
  isShown,
  purposeTitles,
  switchOf,
  textsOf,
} from '../support/ui.ts';

afterEach(() => {
  closeApps();
  document.documentElement.removeAttribute('style');
  testDom.reset();
});

const DESTROYED = { name: 'Error', message: '[lgpder] This instance was destroyed.' };
const ALREADY_ALIVE = {
  name: 'Error',
  message: '[lgpder] init() was already called; call destroy() first.',
};

/** `init` called from JavaScript, with any value as options. */
function initUntyped(options: unknown): unknown {
  return callUntyped(init, options);
}

/** Saves `analytics` granted, as a previous page would have. */
function saveAnalyticsGranted(): void {
  localStorage.setItem('lgpder', serialized({ analytics: decidedToday('granted') }));
}

/** Opens the example with the Google tag in the body and `analytics` already granted. */
function openGrantedPage(options: Omit<InitOptions<PurposeId>, 'purposes'> = {}) {
  document.body.innerHTML = GTAG_SCRIPT;
  saveAnalyticsGranted();
  return startExample(options);
}

describe('the options of each purpose, split among the layers', () => {
  it('the core receives only version, category and individualGrant', () => {
    const app = startApp({
      purposes: {
        analytics: { ...PURPOSES.analytics, version: '2026-10' },
        chat: { title: 'Chat', individualGrant: true, cookies: ['chat_*'] },
      },
    });

    assert.deepStrictEqual(app.manager.purposes, {
      analytics: { version: '2026-10', category: 'statistics' },
      chat: { individualGrant: true },
    });
  });

  it('the components receive title and description', () => {
    const app = startExample();

    app.openPreferences();

    assert.deepStrictEqual(purposeTitles(), ['Estatísticas', 'Publicidade']);
    assert.deepStrictEqual(textsOf('lgpder-preferences', 'purpose-description'), [
      PURPOSES.analytics.description,
      PURPOSES.ads.description,
    ]);
  });

  it('the scripts layer receives integrations and cookies, removed while not granted', () => {
    for (const name of ['_ga', '_ga_XXXX', 'chat_session', 'theme']) setCookie(name);

    startApp({
      purposes: {
        analytics: { integrations: ['google-analytics'] },
        chat: { cookies: ['chat_*'] },
      },
    });

    assert.deepStrictEqual(cookieNames(), ['theme']);
  });

  it('the google layer receives integrations and consentMode', () => {
    const app = startApp({
      purposes: {
        ads: { integrations: ['google-ads'], consentMode: ['personalization_storage'] },
        chat: { consentMode: ['functionality_storage'] },
      },
    });

    app.decide({ ads: 'granted' });

    assert.deepStrictEqual(
      lastUpdate(),
      consentWith('ad_storage', 'ad_user_data', 'ad_personalization', 'personalization_storage'),
    );
  });

  it('an unknown key of a purpose goes to the core, which refuses it', () => {
    assert.throws(() => initUntyped({ purposes: { analytics: { titel: 'Estatísticas' } } }), {
      name: 'TypeError',
      message: '[lgpder] Purpose "analytics" has the unknown property "titel".',
    });
  });

  const unknownOptions = ['key', 'crossTab', 'actions', 'wouldReload', 'canReload', 'theme'];
  for (const option of unknownOptions) {
    it(`the option "${option}" goes to the core, which refuses it`, () => {
      assert.throws(() => initUntyped({ purposes: PURPOSES, [option]: true }), {
        name: 'TypeError',
        message: `[lgpder] Unknown option: "${option}".`,
      });
    });
  }

  it('refuses record, even undefined: an external record is adopted with adopt', () => {
    for (const record of [serialized({ analytics: decidedToday('granted') }), undefined]) {
      assert.throws(() => initUntyped({ purposes: PURPOSES, record }), {
        name: 'TypeError',
        message: '[lgpder] Unknown option: "record".',
      });
    }
  });

  const shapes: readonly {
    readonly name: string;
    readonly options: unknown;
    readonly message: string;
  }[] = [
    { name: 'options that are not an object', options: 'x', message: 'Options must be an object.' },
    {
      name: 'purposes that are not an object',
      options: { purposes: 'analytics' },
      message: '"purposes" must be an object.',
    },
    {
      name: 'a purpose that is not an object',
      options: { purposes: { analytics: true } },
      message: 'The configuration of purpose "analytics" must be an object.',
    },
  ];
  for (const { name, options, message } of shapes) {
    it(`refuses ${name}`, () => {
      assert.throws(() => initUntyped(options), {
        name: 'TypeError',
        message: `[lgpder] ${message}`,
      });
    });
  }

  it('reads the options and each purpose only as own properties', async (t) => {
    const network = installNetwork(t);
    document.body.innerHTML = GTAG_SCRIPT;

    const app = withObjectPollution(
      {
        revocation: 'manual',
        endpoint: ENDPOINT,
        onDecision: () => undefined,
        floatingButton: false,
        record: serialized({ ads: decidedToday('granted') }),
        cookies: ['lgpder'],
        consentMode: ['security_storage'],
      },
      () => startApp({ purposes: { analytics: PURPOSES.analytics, ads: {} }, storage: 'cookie' }),
    );
    const { ads } = app.manager.getSnapshot().status;
    app.decide({ analytics: 'granted' });
    app.denyAll();
    await flushMicrotasks();

    assert.equal(ads, 'pending');
    assert.equal(testDom.reloads(), 1, 'the revocation reloads');
    assert.deepStrictEqual(network.beacons, []);
    assert.equal(isShown('lgpder-button'), true);
    assert.deepStrictEqual(lastUpdate(), consentWith());
  });
});

describe('with storage: "cookie", the record is saved in the cookie lgpder', () => {
  it('saves the decisions in the cookie', () => {
    const app = startExample({ storage: 'cookie' });

    app.grantAll();

    assert.deepStrictEqual(cookieNames(), ['lgpder']);
  });

  for (const pattern of ['lgpder', 'lgpder*', 'lgp*', 'l*']) {
    it(`refuses the cookie pattern "${pattern}", which would remove the record`, () => {
      assert.throws(() => init({ purposes: { chat: { cookies: [pattern] } }, storage: 'cookie' }), {
        name: 'TypeError',
        message: `[lgpder] The cookie pattern "${pattern}" of "chat" matches the cookie of the consent record.`,
      });
    });
  }

  it('accepts the patterns that do not match lgpder', () => {
    const app = startApp({
      purposes: { chat: { cookies: ['lgpder_chat', 'lgpderx*', 'chat_*'] } },
      storage: 'cookie',
    });

    app.grantAll();

    assert.deepStrictEqual(cookieNames(), ['lgpder']);
  });

  it('with localStorage, the cookie lgpder is an ordinary cookie of the purpose', () => {
    setCookie('lgpder');

    startApp({ purposes: { chat: { cookies: ['lgpder'] } } });

    assert.deepStrictEqual(cookieNames(), []);
  });
});

describe('the order of the layers', () => {
  it('the storage is connected first: the other layers start from the saved record', () => {
    document.body.innerHTML = GTAG_SCRIPT;
    saveAnalyticsGranted();
    setCookie('_ga');

    startExample();

    assert.deepStrictEqual(cookieNames(), ['_ga']);
    assert.equal(activeScripts()[0]?.src, GTAG_SRC);
    assert.deepStrictEqual(updates(), [consentWith('analytics_storage')]);
  });

  it('a revocation is saved before the page reloads', async (t) => {
    const app = openGrantedPage();
    const savedAtReload = readAtReload(t, () => savedStatus('analytics'));

    app.decide({ analytics: 'denied' });
    await flushMicrotasks();

    assert.deepStrictEqual(savedAtReload, ['denied']);
    assert.equal(testDom.reloads(), 1);
  });

  it('the reload waits for the record to be saved: none when the storage cannot confirm it', async () => {
    document.body.innerHTML = GTAG_SCRIPT;
    const adapter = createMemoryAdapter(serialized({ analytics: decidedToday('granted') }));
    const app = startExample({ storage: adapter });
    adapter.failWrite = true;
    adapter.failRemove = true;

    app.decide({ analytics: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 0);
  });

  it('a center opened by a script that init activates asks the scripts layer once it is connected', (t) => {
    afterScriptInsertion(t, () => {
      clickButton('lgpder-banner', 'Personalizar');
    });
    const app = openGrantedPage();
    const labelDuringInit = buttonsOf('lgpder-preferences').at(-1)?.textContent;

    switchOf('Estatísticas').click();

    assert.equal(app.manager.getSnapshot().status.analytics, 'granted');
    assert.equal(labelDuringInit, 'Salvar');
    assert.equal(buttonNamed('lgpder-preferences', 'Salvar e recarregar').isConnected, true);
  });

  it('on a revocation, google updates to denied before the scripts layer removes the cookies', () => {
    const cookiesAtUpdate: string[][] = [];
    Reflect.set(testDom.window, 'gtag', () => {
      cookiesAtUpdate.push(cookieNames());
    });
    const app = openGrantedPage({ revocation: 'manual' });
    setCookie('_ga');
    cookiesAtUpdate.length = 0;

    app.decide({ analytics: 'denied' });

    assert.deepStrictEqual(cookiesAtUpdate, [['_ga']]);
    assert.deepStrictEqual(cookieNames(), []);
  });
});

describe('a revocation saved by another tab', () => {
  const revocations: readonly { readonly name: string; readonly text: string }[] = [
    {
      name: 'with the same configuration',
      text: serialized({ analytics: decidedToday('denied') }),
    },
    {
      name: 'with a purpose of another configuration',
      text: serialized({ analytics: decidedToday('denied'), chat: decidedToday('granted') }),
    },
    {
      name: 'with an expired decision',
      text: serialized({
        analytics: decidedToday('denied'),
        ads: decisionOf('granted', { decidedAt: TODAY - DEFAULT_MAX_AGE }),
      }),
    },
  ];
  for (const { name, text } of revocations) {
    it(`${name}, reloads the page once`, async () => {
      const app = openGrantedPage();

      writeFromAnotherTab(text);
      await flushMicrotasks();

      assert.equal(app.manager.getSnapshot().status.analytics, 'denied');
      assert.equal(testDom.reloads(), 1);
    });
  }
});

describe('google and evidence are connected only when needed', () => {
  const unmapped: readonly { readonly name: string; readonly purposes: InitOptions['purposes'] }[] =
    [
      { name: 'without integrations nor consentMode', purposes: { chat: { title: 'Chat' } } },
      {
        name: 'with empty lists',
        purposes: { chat: { integrations: [], consentMode: [], cookies: ['chat_*'] } },
      },
    ];
  for (const { name, purposes } of unmapped) {
    it(`${name}, nothing touches the dataLayer`, () => {
      const app = startApp({ purposes });

      app.grantAll();

      assert.equal(dataLayer(), undefined);
    });
  }

  it('consentMode alone connects google', () => {
    const app = startApp({ purposes: { chat: { consentMode: ['functionality_storage'] } } });

    app.grantAll();

    assert.deepStrictEqual(lastUpdate(), consentWith('functionality_storage'));
  });

  it('without endpoint nor onDecision, nothing is sent', (t) => {
    const network = installNetwork(t);
    const app = startExample();

    app.grantAll();

    assert.deepStrictEqual(network, { beacons: [], fetches: [] });
  });

  it('with endpoint, the evidence of each decision is sent there', (t) => {
    const network = installNetwork(t);
    const app = startExample({ endpoint: ENDPOINT });

    app.grantAll();
    app.denyAll();

    assert.deepStrictEqual(
      network.beacons.map(({ url }) => url),
      [ENDPOINT, ENDPOINT],
    );
  });

  it('onDecision receives each decision of the data subject, and no restore', () => {
    const sources: string[] = [];
    const app = startExample({ onDecision: ({ source }) => sources.push(source) });

    app.grantAll();
    app.adopt(serialized({ ads: decidedToday('denied') }));

    assert.deepStrictEqual(sources, ['decision']);
  });

  it('onError without endpoint nor onDecision is refused by the evidence layer', () => {
    assert.throws(() => init({ purposes: PURPOSES, onError: () => undefined }), {
      name: 'TypeError',
      message: '[lgpder] "endpoint" or "onDecision" is required.',
    });
  });
});

describe('the options of the scripts layer', () => {
  it('revocation "manual" reports the revocation to onRevoke and does not reload', async () => {
    const events: RevokeEvent<PurposeId>[] = [];
    const app = openGrantedPage({ revocation: 'manual', onRevoke: (event) => events.push(event) });

    app.decide({ analytics: 'denied' });
    await flushMicrotasks();

    assert.deepStrictEqual(events, [{ purposes: ['analytics'], requiresReload: true }]);
    assert.equal(testDom.reloads(), 0);
  });

  it('revocation "manual" makes the center offer "Salvar", without reload', () => {
    const app = openGrantedPage({ revocation: 'manual' });

    app.openPreferences();
    switchOf('Estatísticas').click();

    assert.equal(buttonNamed('lgpder-preferences', 'Salvar').isConnected, true);
  });

  it('debug warns about the scripts and the tags that are not blocked', (t) => {
    const warnings = captureWarnings(t);
    document.body.innerHTML = `<script src="${GTAG_SRC}"></script>`;

    startExample({ debug: true });

    assert.deepStrictEqual(warnings, [
      '[lgpder] No consent default was found in the dataLayer; it was pushed now. Run consentDefaultSnippet in the <head>, before the Google tag.',
      `[lgpder] Script of the "google-analytics" integration has no data-consent: ${GTAG_SRC}.`,
    ]);
  });

  it('a blocked iframe shows the placeholder of the components, whose button decides', () => {
    document.body.innerHTML =
      '<iframe data-consent="ads" data-src="https://video.example/embed"></iframe>';
    const app = startExample();

    clickButton('lgpder-placeholder', 'Permitir sempre');

    assert.equal(app.manager.getSnapshot().status.ads, 'granted');
    assert.equal(savedStatus('ads'), 'granted');
    assert.equal(document.querySelector('iframe')?.src, 'https://video.example/embed');
  });
});

describe('the options of the components', () => {
  it('texts replaces the built-in texts', () => {
    startExample({ texts: { banner: { title: 'Cookies' } } });

    assert.deepStrictEqual(textsOf('lgpder-banner', 'title'), ['Cookies']);
  });

  it('necessary replaces the texts of the section of the necessary cookies', () => {
    const app = startExample({ necessary: { title: 'Essenciais' } });

    app.openPreferences();

    assert.deepStrictEqual(textsOf('lgpder-preferences', 'necessary-title'), ['Essenciais']);
  });

  it('necessary is merged with the other texts', () => {
    const app = startExample({
      texts: { banner: { title: 'Cookies' } },
      necessary: { title: 'Essenciais' },
    });

    app.openPreferences();

    assert.deepStrictEqual(textsOf('lgpder-preferences', 'necessary-title'), ['Essenciais']);
    assert.deepStrictEqual(textsOf('lgpder-banner', 'title'), ['Cookies']);
  });

  it('refuses necessary together with texts.necessary', () => {
    assert.throws(
      () =>
        init({
          purposes: PURPOSES,
          necessary: { title: 'Essenciais' },
          texts: { necessary: { description: 'Sempre ativos.' } },
        }),
      { name: 'TypeError', message: '[lgpder] Use "necessary" or "texts.necessary", not both.' },
    );
  });

  it('refuses necessary with texts that are not an object', () => {
    assert.throws(() => initUntyped({ purposes: PURPOSES, texts: 'pt', necessary: {} }), {
      name: 'TypeError',
      message: '[lgpder] "texts" must be an object.',
    });
  });

  it('floatingButton false hides the floating button after a decision', () => {
    const app = startExample({ floatingButton: false });

    app.grantAll();

    assert.equal(isShown('lgpder-banner'), false);
    assert.equal(isShown('lgpder-button'), false);
  });
});

describe('a layer that refuses its options leaves nothing behind', () => {
  const cases: readonly {
    readonly layer: string;
    readonly options: Readonly<Record<string, unknown>>;
    readonly error: ErrorConstructor | TypeErrorConstructor | RangeErrorConstructor;
  }[] = [
    { layer: 'the core', options: { maxAge: 0 }, error: TypeError },
    { layer: 'the storage', options: { storage: 'sessionStorage' }, error: TypeError },
    {
      layer: 'google',
      options: { purposes: { ...PURPOSES, ads: { consentMode: ['ads_storage'] } } },
      error: TypeError,
    },
    { layer: 'the evidence', options: { endpoint: 'http://evil.example/' }, error: TypeError },
    { layer: 'the placeholder', options: { texts: { banner: { title: '' } } }, error: TypeError },
    { layer: 'the components', options: { floatingButton: 'no' }, error: TypeError },
    { layer: 'the scripts layer', options: { revocation: 'never' }, error: TypeError },
    {
      layer: 'the scripts layer, on a purpose',
      options: { purposes: { ...PURPOSES, ads: { cookies: ['*'] } } },
      error: TypeError,
    },
  ];
  for (const { layer, options, error } of cases) {
    it(`when ${layer} throws: no component, listener or activated script`, (t) => {
      const listeners = trackListeners(t);
      document.body.innerHTML = GTAG_SCRIPT;
      saveAnalyticsGranted();

      assert.throws(() => initUntyped({ purposes: PURPOSES, ...options }), error);

      assert.deepStrictEqual(components(), []);
      assert.deepStrictEqual(listeners(), []);
      assert.equal(blockedScripts().length, 1);
      assert.doesNotThrow(() => startExample(), 'the page is free for another init');
    });
  }

  it('while the document is loading, nothing is left to run on DOMContentLoaded', (t) => {
    const listeners = trackListeners(t);
    startLoading();
    t.after(finishLoading);

    assert.throws(() => initUntyped({ purposes: PURPOSES, revocation: 'never' }), TypeError);

    assert.deepStrictEqual(listeners(), []);
  });
});

describe('one instance alive per page', () => {
  it('a second init while the first is alive throws, and leaves the first as it was', () => {
    startExample();

    assert.throws(() => startExample(), ALREADY_ALIVE);
    assert.deepStrictEqual(components(), ['lgpder-banner', 'lgpder-preferences', 'lgpder-button']);
  });

  it('after destroy, init can be called again', () => {
    startExample().destroy();

    assert.doesNotThrow(() => startExample());
  });

  it('destroying an old app again does not free the page of the new one', () => {
    const old = startExample();
    old.destroy();
    startExample();

    old.destroy();

    assert.throws(() => startExample(), ALREADY_ALIVE);
  });
});

describe('the returned app', () => {
  it('is frozen, and its functions do not depend on this', () => {
    const app = startExample();
    const { decide } = app;

    decide({ analytics: 'granted' });

    assert.equal(Object.isFrozen(app), true);
    assert.equal(savedStatus('analytics'), 'granted');
  });

  it('decides through the storage, which adopts the record saved by another tab first', () => {
    const app = startExample();
    localStorage.setItem('lgpder', serialized({ ads: decidedToday('denied') }));

    app.decide({ analytics: 'granted' });

    assert.deepStrictEqual(app.manager.getSnapshot().status, {
      analytics: 'granted',
      ads: 'denied',
    });
  });

  it('grantAll and denyAll save every purpose', () => {
    const app = startExample();

    app.grantAll();
    const granted = [savedStatus('analytics'), savedStatus('ads')];
    app.denyAll();

    assert.deepStrictEqual(granted, ['granted', 'granted']);
    assert.deepStrictEqual([savedStatus('analytics'), savedStatus('ads')], ['denied', 'denied']);
  });

  it('adopt saves an external record, and sync adopts the saved one', () => {
    const app = startExample();

    app.adopt(serialized({ ads: decidedToday('granted') }));
    const adopted = savedStatus('ads');
    localStorage.setItem('lgpder', serialized({ ads: decidedToday('denied') }));
    app.sync();

    assert.equal(adopted, 'granted');
    assert.equal(app.manager.getSnapshot().status.ads, 'denied');
  });

  it('openPreferences opens the center with the purposes listed', () => {
    const app = startExample();

    app.openPreferences(['ads']);

    assert.deepStrictEqual(purposeTitles(), ['Publicidade']);
  });

  it('onGranted runs code of the application while the purpose is granted', () => {
    const log: string[] = [];
    const app = startExample();

    app.onGranted('ads', () => {
      log.push('started');
      return () => log.push('stopped');
    });
    app.grantAll();
    app.denyAll();

    assert.deepStrictEqual(log, ['started', 'stopped']);
  });

  it('scan processes the elements inserted after init', () => {
    const app = startExample();
    app.grantAll();
    document.body.insertAdjacentHTML('beforeend', GTAG_SCRIPT);

    app.scan();

    assert.equal(activeScripts()[0]?.src, GTAG_SRC);
  });
});

describe('destroy', () => {
  it('removes the components and every listener of the layers', (t) => {
    const listeners = trackListeners(t);
    const app = startExample({ endpoint: ENDPOINT });

    app.destroy();

    assert.deepStrictEqual(components(), []);
    assert.deepStrictEqual(listeners(), []);
  });

  it('then every function of the app throws, and destroy itself does nothing', () => {
    const app = startExample();
    app.destroy();

    const calls: readonly (readonly [string, () => unknown])[] = [
      [
        'decide',
        () => {
          app.decide({ ads: 'granted' });
        },
      ],
      ['grantAll', app.grantAll],
      ['denyAll', app.denyAll],
      [
        'adopt',
        () => {
          app.adopt(null);
        },
      ],
      ['sync', app.sync],
      [
        'openPreferences',
        () => {
          app.openPreferences();
        },
      ],
      ['onGranted', () => app.onGranted('ads', () => undefined)],
      [
        'scan',
        () => {
          app.scan();
        },
      ],
    ];
    for (const [name, call] of calls) assert.throws(call, DESTROYED, name);
    assert.doesNotThrow(app.destroy);
  });

  it('leaves the manager usable, in memory only', () => {
    const app = startExample();
    app.destroy();

    app.manager.grantAll();

    assert.equal(app.manager.getSnapshot().status.ads, 'granted');
    assert.equal(savedRecord(), null);
  });

  it('before DOMContentLoaded, nothing is inserted afterwards', (t) => {
    startLoading();
    t.after(finishLoading);
    document.body.innerHTML = GTAG_SCRIPT;
    saveAnalyticsGranted();
    const app = startExample();

    app.destroy();
    finishLoading();

    assert.deepStrictEqual(components(), []);
    assert.deepStrictEqual(activeScripts(), []);
  });
});

describe('init without document, as on the server', () => {
  it('works in memory, with every layer inert and no guard of instance', () => {
    // In a new process, without the DOM of the tests.
    const probe = [
      `const { init } = await import(${JSON.stringify(import.meta.resolve('../../src/init/index.ts'))});`,
      `const purposes = ${JSON.stringify(PURPOSES)};`,
      'const decisions = [];',
      'const app = init({ purposes, endpoint: "https://www.example.com.br/api/consent",',
      '  onDecision: ({ source }) => decisions.push(source) });',
      'const other = init({ purposes });',
      'app.grantAll();',
      'app.openPreferences(["ads"]);',
      'app.onGranted("ads", () => decisions.push("ran"));',
      'app.scan();',
      'let refused = "";',
      'try { init({ purposes, record: null }); } catch (error) { refused = error.message; }',
      'app.destroy();',
      'other.destroy();',
      'process.stdout.write(JSON.stringify({ status: app.manager.getSnapshot().status,',
      '  decisions, refused, dataLayer: typeof globalThis.dataLayer }));',
    ].join('\n');

    const { stdout, stderr } = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe],
      { encoding: 'utf8' },
    );

    assert.equal(
      stdout,
      JSON.stringify({
        status: { analytics: 'granted', ads: 'granted' },
        decisions: [],
        refused: '[lgpder] Unknown option: "record".',
        dataLayer: 'undefined',
      }),
      stderr,
    );
  });
});
