import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { cookieAdapter, localStorageAdapter } from '../../src/storage/index.ts';
import { DEFAULT_URL, testDom } from '../support/dom.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, DAY, withObjectPollution } from '../support/setup.ts';
import { closeTabs, openTab } from '../support/tabs.ts';

afterEach(() => {
  closeTabs();
  testDom.reset();
});

/** A record with characters that a cookie value cannot hold as they are. */
const RECORD_TEXT = serialized({ ads: decisionOf('granted', { version: 'v1; a=b, ç' }) });

/** Cookie of the jar as seen by the page at `url`, with the attributes the adapter sets. */
interface SavedCookie {
  readonly value: string;
  readonly path: string | null;
  readonly secure: boolean;
  readonly sameSite: string | undefined;
  readonly maxAge: unknown;
  readonly hostOnly: boolean | null;
}

/** Cookies named `name` that the page at `url` sees, read from the cookie jar of jsdom. */
function savedCookies(name = 'lgpder', url = DEFAULT_URL): SavedCookie[] {
  return testDom.jsdom.cookieJar
    .getCookiesSync(url)
    .filter(({ key }) => key === name)
    .map(({ value, path, secure, sameSite, maxAge, hostOnly }) => ({
      value,
      path,
      secure,
      sameSite,
      maxAge,
      hostOnly,
    }));
}

/** Records every text assigned to `document.cookie` during `act`, without changing the effect. */
function cookieWrites(act: () => void): string[] {
  const { document, Document } = testDom.window;
  const written: string[] = [];
  // The own property shadows the accessor of the prototype, which still does the real work.
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: (): unknown => Reflect.get(Document.prototype, 'cookie', document),
    set: (value: string) => {
      written.push(value);
      Reflect.set(Document.prototype, 'cookie', value, document);
    },
  });
  try {
    act();
  } finally {
    Reflect.deleteProperty(document, 'cookie');
  }
  return written;
}

describe('localStorageAdapter', () => {
  it('writes, reads and removes the text under the key "lgpder" by default', () => {
    const adapter = localStorageAdapter();

    adapter.write(RECORD_TEXT);
    const saved = localStorage.getItem('lgpder');
    const read = adapter.read();
    adapter.remove();

    assert.equal(saved, RECORD_TEXT);
    assert.equal(read, RECORD_TEXT);
    assert.equal(localStorage.getItem('lgpder'), null);
  });

  it('uses the given key and returns null when nothing is saved', () => {
    const adapter = localStorageAdapter({ key: 'consent' });

    const before = adapter.read();
    adapter.write('text');

    assert.equal(before, null);
    assert.equal(localStorage.getItem('consent'), 'text');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(localStorageAdapter()));
  });

  it('a localStorage that throws makes the adapter throw on use, not on creation', () => {
    const blocked = (): never => {
      throw new Error('SecurityError');
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: blocked });
    try {
      const adapter = localStorageAdapter();

      assert.throws(() => adapter.read(), { message: 'SecurityError' });
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get: () => testDom.window.localStorage,
      });
    }
  });
});

describe('cookieAdapter: the written cookie', () => {
  it('has Path=/, SameSite=Lax, Secure on HTTPS, no Domain and the encoded text', () => {
    cookieAdapter({ maxAge: 10 * DAY }).write(RECORD_TEXT);

    assert.deepStrictEqual(savedCookies(), [
      {
        value: encodeURIComponent(RECORD_TEXT),
        path: '/',
        secure: true,
        sameSite: 'lax',
        maxAge: 864_000,
        hostOnly: true,
      },
    ]);
  });

  it('has no Secure on an HTTP page', () => {
    testDom.navigate('http://www.example.com.br/');

    cookieAdapter({ maxAge: DAY }).write('text');

    assert.equal(savedCookies('lgpder', 'http://www.example.com.br/')[0]?.secure, false);
  });

  it('evaluates the scheme on each write, not on creation', () => {
    testDom.navigate('http://www.example.com.br/');
    const adapter = cookieAdapter({ maxAge: DAY });
    testDom.navigate(DEFAULT_URL);

    adapter.write('text');

    assert.equal(savedCookies()[0]?.secure, true);
  });

  it('rounds Max-Age down to whole seconds', () => {
    cookieAdapter({ maxAge: 1_999 }).write('text');

    assert.equal(savedCookies()[0]?.maxAge, 1);
  });

  it('is named by the key', () => {
    cookieAdapter({ key: '__Host-lgpder', maxAge: DAY }).write('text');

    assert.equal(savedCookies('__Host-lgpder')[0]?.value, 'text');
  });

  it('connectStorage with storage "cookie" uses the maxAge of the manager', () => {
    const { storage } = openTab({ storage: 'cookie' }, { maxAge: 30 * DAY });

    storage.decide({ ads: 'granted' });

    assert.equal(savedCookies()[0]?.maxAge, 2_592_000);
  });

  it('connectStorage with storage "cookie" uses the key as the cookie name', () => {
    const { storage } = openTab({ storage: 'cookie', key: 'consent' });

    storage.decide({ ads: 'granted' });

    assert.equal(
      decodeURIComponent(savedCookies('consent')[0]?.value ?? ''),
      serialized({ ads: decisionOf('granted') }),
    );
  });
});

describe('cookieAdapter: reading', () => {
  it('returns exactly the written text', () => {
    const adapter = cookieAdapter({ maxAge: DAY });

    adapter.write(RECORD_TEXT);

    assert.equal(adapter.read(), RECORD_TEXT);
  });

  it('returns null without the cookie, ignoring other names that start or end with the key', () => {
    document.cookie = 'lgpder2=a; Path=/';
    document.cookie = 'xlgpder=b; Path=/';

    assert.equal(cookieAdapter({ maxAge: DAY }).read(), null);
  });

  it('throws when the name appears twice, as with a cookie set with Domain by the server', () => {
    document.cookie = 'lgpder=a; Path=/';
    document.cookie = 'lgpder=b; Path=/; Domain=example.com.br';

    assert.throws(() => cookieAdapter({ maxAge: DAY }).read(), {
      name: 'Error',
      message: '[lgpder] More than one cookie named "lgpder".',
    });
  });

  it('a duplicate cookie is a read failure: connectStorage adopts neither of them', () => {
    document.cookie = `lgpder=${encodeURIComponent(serialized({ ads: decisionOf('granted') }))}; Path=/`;
    document.cookie = 'lgpder=b; Path=/; Domain=example.com.br';

    const { consent } = openTab({ storage: 'cookie' });

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('throws on a value that is not valid percent-encoding', () => {
    document.cookie = 'lgpder=%E0%A4%A; Path=/';

    assert.throws(() => cookieAdapter({ maxAge: DAY }).read(), URIError);
  });
});

describe('cookieAdapter: removal', () => {
  it('expires the host-only cookie and the cookie of every parent domain, with Secure on HTTPS', () => {
    const adapter = cookieAdapter({ maxAge: DAY });

    const written = cookieWrites(() => {
      adapter.remove();
    });

    assert.deepStrictEqual(written, [
      'lgpder=; Path=/; Max-Age=0; Secure',
      'lgpder=; Path=/; Max-Age=0; Secure; Domain=www.example.com.br',
      'lgpder=; Path=/; Max-Age=0; Secure; Domain=example.com.br',
      'lgpder=; Path=/; Max-Age=0; Secure; Domain=com.br',
    ]);
  });

  it('removes both the host-only cookie and the one set with Domain', () => {
    document.cookie = 'lgpder=a; Path=/';
    document.cookie = 'lgpder=b; Path=/; Domain=example.com.br';

    cookieAdapter({ maxAge: DAY }).remove();

    assert.deepStrictEqual(savedCookies(), []);
  });

  const HOSTS_WITHOUT_PARENT = [
    { host: 'localhost', url: 'http://localhost/' },
    { host: 'an IPv4 address', url: 'http://192.168.0.1/' },
    { host: 'an IPv6 address', url: 'http://[::1]/' },
  ] as const;

  for (const { host, url } of HOSTS_WITHOUT_PARENT) {
    it(`on ${host}, expires only the host-only cookie, without Secure on HTTP`, () => {
      testDom.navigate(url);
      const adapter = cookieAdapter({ maxAge: DAY });

      const written = cookieWrites(() => {
        adapter.remove();
      });

      assert.deepStrictEqual(written, ['lgpder=; Path=/; Max-Age=0']);
    });
  }
});

describe('validation of the adapter options', () => {
  const INVALID_COOKIE_NAMES = ['', 'a b', 'a;b', 'a=b', 'consentimento-ç', 1, null] as const;

  for (const key of INVALID_COOKIE_NAMES) {
    it(`cookieAdapter rejects the key ${JSON.stringify(key)}`, () => {
      assert.throws(() => callUntyped(cookieAdapter, { key, maxAge: DAY }), {
        name: 'TypeError',
        message: '[lgpder] "key" must be a valid cookie name.',
      });
    });
  }

  const INVALID_KEYS = ['', 1, null, ['lgpder']] as const;

  for (const key of INVALID_KEYS) {
    it(`localStorageAdapter rejects the key ${JSON.stringify(key)}`, () => {
      assert.throws(() => callUntyped(localStorageAdapter, { key }), {
        name: 'TypeError',
        message: '[lgpder] "key" must be a non-empty string.',
      });
    });
  }

  const INVALID_MAX_AGES = [
    undefined,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '1000',
  ] as const;

  for (const maxAge of INVALID_MAX_AGES) {
    it(`cookieAdapter rejects the maxAge ${String(maxAge)}`, () => {
      assert.throws(() => callUntyped(cookieAdapter, { maxAge }), {
        name: 'TypeError',
        message: '[lgpder] "maxAge" must be a positive safe integer (milliseconds).',
      });
    });
  }

  it('cookieAdapter accepts the maxAge limits 1 and Number.MAX_SAFE_INTEGER', () => {
    assert.doesNotThrow(() => cookieAdapter({ maxAge: 1 }));
    assert.doesNotThrow(() => cookieAdapter({ maxAge: Number.MAX_SAFE_INTEGER }));
  });

  const ADAPTERS = [
    { adapter: 'localStorageAdapter', create: localStorageAdapter, valid: {} },
    { adapter: 'cookieAdapter', create: cookieAdapter, valid: { maxAge: DAY } },
  ] as const;

  for (const { adapter, create, valid } of ADAPTERS) {
    it(`${adapter} rejects an unknown option`, () => {
      assert.throws(() => callUntyped(create, { ...valid, keys: 'lgpder' }), {
        name: 'TypeError',
        message: '[lgpder] Unknown option: "keys".',
      });
    });

    for (const options of [null, 'lgpder', 1]) {
      it(`${adapter} rejects the options ${JSON.stringify(options)}`, () => {
        assert.throws(() => callUntyped(create, options), {
          name: 'TypeError',
          message: '[lgpder] Options must be an object.',
        });
      });
    }
  }

  it('an inherited maxAge, from a polluted prototype, is ignored', () => {
    assert.throws(
      () => withObjectPollution({ maxAge: DAY }, () => callUntyped(cookieAdapter, {})),
      { message: '[lgpder] "maxAge" must be a positive safe integer (milliseconds).' },
    );
  });

  it('an inherited key, from a polluted prototype, is ignored', () => {
    withObjectPollution({ key: 'polluted' }, () => {
      localStorageAdapter({}).write('text');
    });

    assert.equal(localStorage.getItem('lgpder'), 'text');
  });
});

describe('connectStorage with the built-in adapters', () => {
  it('uses localStorage under the key "lgpder" by default', () => {
    const { storage } = openTab();

    storage.decide({ ads: 'granted' });

    assert.equal(localStorage.getItem('lgpder'), serialized({ ads: decisionOf('granted') }));
  });

  it('adopts the record saved in localStorage under the given key', () => {
    localStorage.setItem('consent', serialized({ ads: decisionOf('granted') }));

    const { consent } = openTab({ storage: 'localStorage', key: 'consent' });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });
});
