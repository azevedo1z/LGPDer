import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { connectStorage } from '../../src/storage/index.ts';
import { testDom } from '../support/dom.ts';
import { createMemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, setup, withObjectPollution, withPrototype } from '../support/setup.ts';
import { closeTabs, openTab } from '../support/tabs.ts';

afterEach(() => {
  closeTabs();
  testDom.reset();
});

/** `connectStorage` called from JavaScript, with any value (or none) as options. */
function connectUntyped(...options: unknown[]): void {
  const { consent } = setup();
  callUntyped(connectStorage, consent, ...options);
}

const STORAGE_MESSAGE =
  '[lgpder] "storage" must be "localStorage", "cookie" or an object with read, write and remove functions.';

interface InvalidOptions {
  readonly options: unknown;
  readonly name: 'TypeError';
  readonly message: string;
}

const INVALID_OPTIONS: readonly InvalidOptions[] = [
  { options: null, name: 'TypeError', message: '[lgpder] Options must be an object.' },
  { options: 'cookie', name: 'TypeError', message: '[lgpder] Options must be an object.' },
  {
    options: { crossTabSync: false },
    name: 'TypeError',
    message: '[lgpder] Unknown option: "crossTabSync".',
  },
  { options: { storage: 'sessionStorage' }, name: 'TypeError', message: STORAGE_MESSAGE },
  { options: { storage: null }, name: 'TypeError', message: STORAGE_MESSAGE },
  { options: { storage: () => null }, name: 'TypeError', message: STORAGE_MESSAGE },
  {
    options: { storage: { read: () => null, write: () => undefined } },
    name: 'TypeError',
    message: STORAGE_MESSAGE,
  },
  {
    options: { key: '' },
    name: 'TypeError',
    message: '[lgpder] "key" must be a non-empty string.',
  },
  {
    options: { storage: createMemoryAdapter(), key: 1 },
    name: 'TypeError',
    message: '[lgpder] "key" must be a non-empty string.',
  },
  {
    options: { storage: 'cookie', key: 'my consent' },
    name: 'TypeError',
    message: '[lgpder] "key" must be a valid cookie name.',
  },
  {
    options: { crossTab: 'yes' },
    name: 'TypeError',
    message: '[lgpder] "crossTab" must be a boolean.',
  },
  {
    options: { crossTab: null },
    name: 'TypeError',
    message: '[lgpder] "crossTab" must be a boolean.',
  },
  // Order of the checks: storage, key, crossTab.
  {
    options: { storage: 'session', key: '', crossTab: 1 },
    name: 'TypeError',
    message: STORAGE_MESSAGE,
  },
  {
    options: { key: '', crossTab: 1 },
    name: 'TypeError',
    message: '[lgpder] "key" must be a non-empty string.',
  },
];

describe('validation of the options of connectStorage', () => {
  for (const { options, name, message } of INVALID_OPTIONS) {
    it(`rejects ${JSON.stringify(options)} with ${name}: ${message}`, () => {
      assert.throws(
        () => {
          connectUntyped(options);
        },
        { name, message },
      );
    });
  }

  it('accepts no options, empty options and options without prototype', () => {
    assert.doesNotThrow(() => {
      openTab();
      openTab({});
      openTab(withPrototype({ crossTab: false }, null) as object);
    });
  });

  it('an invalid option leaves no effect: the storage is never read and decisions are not written', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();

    assert.throws(() => {
      callUntyped(connectStorage, consent, { storage: adapter, crossTab: 'yes' });
    });
    consent.decide({ analytics: 'granted' });

    assert.equal(adapter.reads, 0);
    assert.equal(adapter.writes, 0);
    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('inherited options, from a polluted prototype, are ignored', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));

    const { consent } = withObjectPollution({ storage: adapter, key: '', crossTab: 'yes' }, () =>
      openTab({}),
    );

    assert.equal(adapter.reads, 0);
    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });
});
