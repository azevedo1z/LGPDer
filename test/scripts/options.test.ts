/** Validation of the options: unknown keys, invalid values, order, own properties only. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ConsentScripts } from 'lgpder/scripts';

import { connectScripts } from '../../src/scripts/index.ts';
import { testDom } from '../support/dom.ts';
import {
  closePages,
  connectPage,
  cookieNames,
  find,
  flushMicrotasks,
  recordingRenderer,
  render,
  type Page,
} from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';
import {
  callUntyped,
  OPAQUE_ITEMS,
  setup,
  withArrayPollution,
  withObjectPollution,
  withPrototype,
} from '../support/setup.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

/** `connectScripts` called from JavaScript, with any value (or none) as options, then destroyed. */
function connectUntyped(...options: unknown[]): void {
  const { consent } = setup();
  callUntyped<ConsentScripts>(connectScripts, consent, ...options).destroy();
}

interface InvalidOptions {
  readonly case: string;
  readonly options: unknown;
  readonly name: 'TypeError' | 'RangeError';
  readonly message: string;
}

const OPTIONS_OBJECT = '[lgpder] Options must be an object.';

/** `items` followed by a hole, as `[...items, ,]` would write it. */
function withHole(...items: string[]): string[] {
  const list = [...items];
  list.length += 1;
  return list;
}

const INVALID_OPTIONS: readonly InvalidOptions[] = [
  { case: 'null options', options: null, name: 'TypeError', message: OPTIONS_OBJECT },
  { case: 'string options', options: 'reload', name: 'TypeError', message: OPTIONS_OBJECT },
  {
    case: 'an unknown option',
    options: { revoke: 'manual' },
    name: 'TypeError',
    message: '[lgpder] Unknown option: "revoke".',
  },
  {
    case: 'purposes as a string',
    options: { purposes: 'ads' },
    name: 'TypeError',
    message: '[lgpder] "purposes" must be an object.',
  },
  {
    case: 'purposes as null',
    options: { purposes: null },
    name: 'TypeError',
    message: '[lgpder] "purposes" must be an object.',
  },
  {
    case: 'a purpose that is not configured',
    options: { purposes: { typo: {} } },
    name: 'RangeError',
    message: '[lgpder] Unknown purpose: "typo".',
  },
  {
    case: 'purpose options that are not an object',
    options: { purposes: { ads: 'google-ads' } },
    name: 'TypeError',
    message: '[lgpder] The options of "ads" must be an object.',
  },
  {
    case: 'an unknown purpose option',
    options: { purposes: { ads: { cookie: ['x'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown option: "cookie".',
  },
  {
    case: 'integrations that are not an array',
    options: { purposes: { ads: { integrations: 'google-ads' } } },
    name: 'TypeError',
    message: '[lgpder] "integrations" must be an array.',
  },
  {
    case: 'an unknown integration',
    options: { purposes: { ads: { integrations: ['meta-pixel'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown integration: "meta-pixel".',
  },
  {
    case: 'an integration named after an Object.prototype property',
    options: { purposes: { ads: { integrations: ['toString'] } } },
    name: 'TypeError',
    message: '[lgpder] Unknown integration: "toString".',
  },
  {
    case: 'an integration list with a hole',
    options: { purposes: { ads: { integrations: withHole('google-ads') } } },
    name: 'TypeError',
    message: '[lgpder] Unknown integration: "undefined".',
  },
  {
    case: 'cookies that are not an array',
    options: { purposes: { ads: { cookies: '_gcl_*' } } },
    name: 'TypeError',
    message: '[lgpder] "cookies" must be an array.',
  },
  {
    case: 'a cookie list with a hole',
    options: { purposes: { ads: { cookies: withHole('_gcl_au') } } },
    name: 'TypeError',
    message:
      '[lgpder] Invalid cookie pattern: "undefined"; use a cookie name, optionally ending in "*".',
  },
  {
    case: 'an unknown revocation mode',
    options: { revocation: 'never' },
    name: 'TypeError',
    message: '[lgpder] "revocation" must be "reload" or "manual".',
  },
  {
    case: 'onRevoke that is not a function',
    options: { onRevoke: true },
    name: 'TypeError',
    message: '[lgpder] "onRevoke" must be a function.',
  },
  {
    case: 'renderPlaceholder that is not a function',
    options: { renderPlaceholder: 'div' },
    name: 'TypeError',
    message: '[lgpder] "renderPlaceholder" must be a function.',
  },
  {
    case: 'canReload that is not a function',
    options: { canReload: false },
    name: 'TypeError',
    message: '[lgpder] "canReload" must be a function.',
  },
  {
    case: 'debug that is not a boolean',
    options: { debug: 'yes' },
    name: 'TypeError',
    message: '[lgpder] "debug" must be a boolean.',
  },
  // Order of the checks: purposes, revocation, onRevoke, renderPlaceholder, canReload, debug.
  {
    case: 'every option invalid',
    options: {
      purposes: { typo: {} },
      revocation: 'never',
      onRevoke: 1,
      renderPlaceholder: 1,
      canReload: 1,
      debug: 1,
    },
    name: 'RangeError',
    message: '[lgpder] Unknown purpose: "typo".',
  },
  {
    case: 'every option but purposes invalid',
    options: { revocation: 'never', onRevoke: 1, renderPlaceholder: 1, canReload: 1, debug: 1 },
    name: 'TypeError',
    message: '[lgpder] "revocation" must be "reload" or "manual".',
  },
  {
    case: 'the callbacks and debug invalid',
    options: { onRevoke: 1, renderPlaceholder: 1, canReload: 1, debug: 1 },
    name: 'TypeError',
    message: '[lgpder] "onRevoke" must be a function.',
  },
  {
    case: 'renderPlaceholder, canReload and debug invalid',
    options: { renderPlaceholder: 1, canReload: 1, debug: 1 },
    name: 'TypeError',
    message: '[lgpder] "renderPlaceholder" must be a function.',
  },
  {
    case: 'canReload and debug invalid',
    options: { canReload: 1, debug: 1 },
    name: 'TypeError',
    message: '[lgpder] "canReload" must be a function.',
  },
];

describe('invalid options', () => {
  for (const { case: label, options, name, message } of INVALID_OPTIONS) {
    it(`${label}: ${name}`, () => {
      assert.throws(
        () => {
          connectUntyped(options);
        },
        { name, message },
      );
    });
  }
});

describe('list items that are not primitives (D112)', () => {
  for (const { case: label, value, quoted } of OPAQUE_ITEMS) {
    it(`${label} as an integration is described by its type`, () => {
      assert.throws(
        () => {
          connectUntyped({ purposes: { ads: { integrations: [value] } } });
        },
        { name: 'TypeError', message: `[lgpder] Unknown integration: ${quoted}.` },
      );
    });

    it(`${label} as a cookie pattern is described by its type`, () => {
      assert.throws(
        () => {
          connectUntyped({ purposes: { ads: { cookies: [value] } } });
        },
        {
          name: 'TypeError',
          message: `[lgpder] Invalid cookie pattern: ${quoted}; use a cookie name, optionally ending in "*".`,
        },
      );
    });
  }
});

describe('valid options', () => {
  it('accepts no options, an empty object and undefined values', () => {
    for (const options of [
      [],
      [undefined],
      [{}],
      [
        {
          purposes: { ads: undefined, analytics: {} },
          revocation: undefined,
          onRevoke: undefined,
          renderPlaceholder: undefined,
          canReload: undefined,
          debug: undefined,
        },
      ],
      [{ purposes: { ads: { integrations: undefined, cookies: undefined } } }],
    ]) {
      assert.doesNotThrow(() => {
        connectUntyped(...options);
      });
    }
  });

  it('accepts null-prototype objects', () => {
    const purpose = withPrototype({ integrations: ['google-ads'] }, null);
    const options = withPrototype({ purposes: withPrototype({ ads: purpose }, null) }, null);

    assert.doesNotThrow(() => {
      connectUntyped(options);
    });
  });
});

describe('the root of scan', () => {
  const ROOT = '[lgpder] "root" must be a document, an element or a fragment.';

  for (const { case: label, root } of [
    { case: 'a number', root: 123 },
    { case: 'a selector', root: 'body' },
    { case: 'a plain object', root: {} },
    { case: 'null', root: null },
  ]) {
    it(`is a TypeError for ${label}`, () => {
      const { scripts } = connectPage(setup());

      assert.throws(
        () => {
          callUntyped(scripts.scan, root);
        },
        { name: 'TypeError', message: ROOT },
      );
    });
  }

  it('may be a document, an element or a fragment', () => {
    const { scripts } = connectPage(setup());

    for (const root of [document, document.body, document.createDocumentFragment()]) {
      assert.doesNotThrow(() => {
        scripts.scan(root);
      });
    }
  });
});

describe('validation before any effect', () => {
  it('an invalid option leaves the page, the cookies and the manager untouched', () => {
    render(
      '<script type="text/plain" data-consent="ads">ads();</script><iframe data-consent="ads" data-src="https://video.example/"></iframe>',
    );
    document.cookie = '_gcl_au=1; Path=/';
    const before = document.body.innerHTML;
    const { consent } = setup({ record: serialized({ ads: decisionOf('granted') }) });
    const renderer = recordingRenderer();

    assert.throws(() =>
      callUntyped(connectScripts, consent, {
        purposes: { ads: { integrations: ['google-ads'] } },
        renderPlaceholder: renderer.render,
        debug: 'yes',
      }),
    );
    consent.decide({ ads: 'denied' });

    assert.equal(document.body.innerHTML, before);
    assert.deepStrictEqual(cookieNames(), ['_gcl_au']);
    assert.deepStrictEqual(renderer.contexts, []);
  });
});

describe('inherited options are never read', () => {
  /** Connects the layer to a manager with ads granted, with `pollution` planted meanwhile. */
  function connectPolluted(pollution: Readonly<Record<string, unknown>>, options: object): Page {
    const tab = setup({ record: serialized({ ads: decisionOf('granted') }) });
    return withObjectPollution(pollution, () => connectPage(tab, options));
  }

  it("an inherited revocation 'manual' does not turn the reload off", async () => {
    render('<script type="text/plain" data-consent="ads">ads();</script>');
    const { consent } = connectPolluted({ revocation: 'manual' }, {});

    consent.decide({ ads: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 1);
  });

  it('an inherited canReload does not suppress the reload', async () => {
    render('<script type="text/plain" data-consent="ads">ads();</script>');
    const { consent } = connectPolluted({ canReload: () => false }, {});

    consent.decide({ ads: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 1);
  });

  it('inherited purposes and purpose options are ignored', () => {
    document.cookie = 'kept=1; Path=/';
    const { consent } = connectPolluted(
      { purposes: { ads: { cookies: ['kept'] } }, cookies: ['kept'] },
      { purposes: { ads: {} } },
    );

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(cookieNames(), ['kept']);
  });

  const HOLES = [
    {
      option: 'integrations',
      planted: 'google-ads',
      message: '[lgpder] Unknown integration: "undefined".',
    },
    {
      option: 'cookies',
      planted: '_gcl_au',
      message:
        '[lgpder] Invalid cookie pattern: "undefined"; use a cookie name, optionally ending in "*".',
    },
  ] as const;

  for (const { option, planted, message } of HOLES) {
    it(`a hole of ${option} is refused, never filled from a polluted Array.prototype`, () => {
      const { consent } = setup();
      const options = { purposes: { ads: { [option]: withHole(planted) } } };

      assert.throws(
        () => {
          withArrayPollution(planted, () => {
            callUntyped(connectScripts, consent, options);
          });
        },
        { name: 'TypeError', message },
      );
    });
  }

  it('an inherited renderPlaceholder is never called', () => {
    render('<iframe data-consent="health" data-src="https://video.example/"></iframe>');
    const renderer = recordingRenderer();

    connectPolluted({ renderPlaceholder: renderer.render }, {});

    assert.deepStrictEqual(renderer.contexts, []);
    assert.equal(find('iframe').hasAttribute('hidden'), false);
  });
});
