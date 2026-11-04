/**
 * Server environment: this file does not install the DOM, so `document` does not exist, as in
 * Node. Node exposes other browser globals, and some versions a process-wide `localStorage`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';

import { connectStorage, cookieAdapter, localStorageAdapter } from '../../src/storage/index.ts';
import { createMemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { DAY, setup } from '../support/setup.ts';
import { closeTabs, openTab } from '../support/tabs.ts';

const ADS_GRANTED = serialized({ ads: decisionOf('granted') });

/** Connects the default fixture to a memory adapter that already holds a grant. */
function connectOnServer() {
  const adapter = createMemoryAdapter(ADS_GRANTED);
  return { adapter, ...openTab({ storage: adapter }) };
}

describe('connectStorage without document', () => {
  afterEach(closeTabs);

  it('runs without document', () => {
    assert.equal(typeof document, 'undefined');
  });

  it('never calls the adapter: no read, write or removal', () => {
    const { adapter, storage } = connectOnServer();

    storage.decide({ ads: 'denied' });
    storage.grantAll();
    storage.denyAll();
    storage.adopt(ADS_GRANTED);
    storage.sync();
    storage.isPersisted();
    storage.destroy();

    assert.deepStrictEqual(
      { reads: adapter.reads, writes: adapter.writes, removals: adapter.removals },
      { reads: 0, writes: 0, removals: 0 },
    );
  });

  it('adopts nothing on connection: every purpose stays pending', () => {
    const { consent } = connectOnServer();

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('the decision actions act on the manager, in memory', () => {
    const { consent, storage } = connectOnServer();

    storage.decide({ analytics: 'granted' });

    assert.equal(consent.getSnapshot().status.analytics, 'granted');
  });

  it('adopt restores the record in memory', () => {
    const { consent, storage } = connectOnServer();

    storage.adopt(ADS_GRANTED);

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('isPersisted is false', () => {
    const { storage } = connectOnServer();

    assert.equal(storage.isPersisted(), false);
  });

  it('a destroyed handle throws as in the browser', () => {
    const { storage } = connectOnServer();
    storage.destroy();

    assert.throws(
      () => {
        storage.sync();
      },
      { message: '[lgpder] This instance was destroyed.' },
    );
  });

  it('the options are still validated', () => {
    const { consent } = setup();

    assert.throws(() => connectStorage(consent, { key: '' }), TypeError);
  });
});

describe('the built-in adapters without document', () => {
  const ADAPTERS = [
    { adapter: 'localStorageAdapter', create: () => localStorageAdapter() },
    { adapter: 'cookieAdapter', create: () => cookieAdapter({ maxAge: DAY }) },
  ] as const;

  for (const { adapter, create } of ADAPTERS) {
    it(`${adapter} is created without error, and each method throws`, () => {
      const created = create();

      const uses = {
        read: () => created.read(),
        write: () => {
          created.write('text');
        },
        remove: () => {
          created.remove();
        },
      };

      for (const use of Object.values(uses)) {
        assert.throws(use, {
          name: 'Error',
          message: '[lgpder] Storage adapters work only in the browser.',
        });
      }
    });
  }
});

describe('a process-wide localStorage on the server', () => {
  it('is never touched, so the record of one request never reaches another', () => {
    // A new process with a global localStorage, as in newer versions of Node, that holds a grant
    // saved during another request and counts every access.
    const probe = [
      'let accesses = 0;',
      `const saved = ${JSON.stringify(ADS_GRANTED)};`,
      'globalThis.localStorage = new Proxy({ getItem: () => saved, setItem() {}, removeItem() {} }, {',
      '  get: (target, key) => { accesses += 1; return target[key]; },',
      '});',
      `const { createConsentManager } = await import(${JSON.stringify(import.meta.resolve('../../src/index.ts'))});`,
      `const { connectStorage } = await import(${JSON.stringify(import.meta.resolve('../../src/storage/index.ts'))});`,
      'const consent = createConsentManager({ purposes: { ads: {} } });',
      'const storage = connectStorage(consent);',
      'const status = consent.getSnapshot().status.ads;',
      "storage.decide({ ads: 'denied' });",
      'storage.destroy();',
      'process.stdout.write(JSON.stringify({ status, accesses }));',
    ].join('\n');

    const { stdout, stderr } = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe],
      { encoding: 'utf8' },
    );

    assert.equal(stdout, JSON.stringify({ status: 'pending', accesses: 0 }), stderr);
  });
});
