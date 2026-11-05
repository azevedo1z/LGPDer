import assert from 'node:assert/strict';
import { once } from 'node:events';
import { afterEach, describe, it } from 'node:test';

import type { StorageOptions } from 'lgpder/storage';

import { fireStorageEvent, testDom, writeFromAnotherTab } from '../support/dom.ts';
import { createMemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { closeTabs, nextBroadcast, openTab, type Tab } from '../support/tabs.ts';

afterEach(() => {
  closeTabs();
  testDom.reset();
});

/** Record with ads granted, as another tab writes it. */
const ADS_GRANTED = serialized({ ads: decisionOf('granted') });

/** Lets the pending messages of every `BroadcastChannel` be delivered. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

describe('localStorage: the storage event of another tab', () => {
  it('adopts the record written under the key', () => {
    const { consent } = openTab();

    writeFromAnotherTab(ADS_GRANTED);

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('adopts a revocation as a restore, never as a decision', () => {
    const { consent, changes } = openTab();
    writeFromAnotherTab(ADS_GRANTED);

    writeFromAnotherTab(serialized({ ads: decisionOf('denied') }));

    assert.equal(consent.getSnapshot().status.ads, 'denied');
    assert.deepStrictEqual(
      changes.map(({ source }) => source),
      ['restore', 'restore'],
    );
  });

  it('adopts the clearing of the whole storage (key null)', () => {
    const { consent } = openTab();
    writeFromAnotherTab(ADS_GRANTED);

    localStorage.clear();
    fireStorageEvent({ key: null, storageArea: localStorage });

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('follows the configured key', () => {
    const { consent } = openTab({ key: 'consent' });

    writeFromAnotherTab(ADS_GRANTED, 'consent');

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('ignores the change of another key', () => {
    const { consent } = openTab({ key: 'consent' });
    localStorage.setItem('consent', ADS_GRANTED);

    fireStorageEvent({ key: 'lgpder', storageArea: localStorage });

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('ignores the change of the same key in sessionStorage', () => {
    const { consent } = openTab();
    localStorage.setItem('lgpder', ADS_GRANTED);

    fireStorageEvent({ key: 'lgpder', storageArea: testDom.window.sessionStorage });

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });
});

describe('cookie and custom adapter: the BroadcastChannel', () => {
  /** Two tabs of the same browser connected with `options`. */
  function twoTabs(options: StorageOptions): { readonly tabA: Tab; readonly tabB: Tab } {
    return { tabA: openTab(options), tabB: openTab(options) };
  }

  const SHARED_STORAGES = [
    { storage: 'cookie', options: (): StorageOptions => ({ storage: 'cookie' }) },
    {
      storage: 'a custom adapter',
      options: (): StorageOptions => ({ storage: createMemoryAdapter() }),
    },
  ] as const;

  for (const { storage, options } of SHARED_STORAGES) {
    it(`with ${storage}, a confirmed write makes the other tab adopt the record`, async () => {
      const { tabA, tabB } = twoTabs(options());
      const delivered = nextBroadcast();

      tabA.storage.decide({ ads: 'granted' });
      await delivered;

      assert.equal(tabB.consent.getSnapshot().status.ads, 'granted');
    });
  }

  it('a removal made by the page also notifies, and the other tab adopts it', async () => {
    const adapter = createMemoryAdapter(ADS_GRANTED);
    const { tabA, tabB } = twoTabs({ storage: adapter });
    adapter.discardWrite = true;
    const delivered = nextBroadcast();

    tabA.storage.decide({ ads: 'denied' });
    await delivered;

    assert.equal(adapter.value, null);
    assert.equal(tabB.consent.getSnapshot().status.ads, 'pending');
  });

  it('the message carries no data, so the record never travels outside the storage', async () => {
    const { tabA } = twoTabs({ storage: 'cookie' });
    const probe = new BroadcastChannel('lgpder:lgpder');
    try {
      const message = once(probe, 'message') as Promise<[MessageEvent]>;

      tabA.storage.decide({ ads: 'granted' });
      const [event] = await message;

      assert.equal(event.data, null);
    } finally {
      probe.close();
    }
  });

  it('the channel is named after the key: tabs with another key are not notified', async () => {
    const adapter = createMemoryAdapter();
    const tabA = openTab({ storage: adapter, key: 'a' });
    const tabB = openTab({ storage: adapter, key: 'b' });
    const delivered = nextBroadcast('lgpder:a');

    tabA.storage.decide({ ads: 'granted' });
    await delivered;
    await settle();

    assert.equal(tabB.consent.getSnapshot().status.ads, 'pending');
  });

  it('without BroadcastChannel, connects and writes without following other tabs', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
    Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    try {
      const { storage } = openTab({ storage: 'cookie' });

      storage.decide({ ads: 'granted' });

      assert.match(document.cookie, /^lgpder=/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'BroadcastChannel', original);
    }
  });
});

describe('pages that missed the events: back/forward cache and background', () => {
  it('a page restored from the back/forward cache adopts the saved record', () => {
    const { consent } = openTab();
    localStorage.setItem('lgpder', ADS_GRANTED);
    const { window } = testDom;

    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('a pageshow of a fresh load does not read again', () => {
    const { consent } = openTab();
    localStorage.setItem('lgpder', ADS_GRANTED);
    const { window } = testDom;

    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: false }));

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('a page that becomes visible adopts the saved record', () => {
    const { consent } = openTab({ storage: 'cookie' });
    document.cookie = `lgpder=${encodeURIComponent(ADS_GRANTED)}; Path=/`;

    document.dispatchEvent(new testDom.window.Event('visibilitychange'));

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('a page that becomes hidden does not read again', () => {
    const { consent } = openTab();
    localStorage.setItem('lgpder', ADS_GRANTED);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    try {
      document.dispatchEvent(new testDom.window.Event('visibilitychange'));
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });
});

describe('crossTab: false', () => {
  it('ignores the storage, pageshow and visibilitychange events', () => {
    const { consent } = openTab({ crossTab: false });
    const { window } = testDom;

    writeFromAnotherTab(ADS_GRANTED);
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new window.Event('visibilitychange'));

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('does not open the BroadcastChannel: the tab is not notified', async () => {
    const tabA = openTab({ storage: 'cookie' });
    const tabB = openTab({ storage: 'cookie', crossTab: false });
    const delivered = nextBroadcast();

    tabA.storage.decide({ ads: 'granted' });
    await delivered;
    await settle();

    assert.equal(tabB.consent.getSnapshot().status.ads, 'pending');
  });

  it('still adopts the saved record before each decision', () => {
    const { consent, storage } = openTab({ crossTab: false });
    localStorage.setItem(
      'lgpder',
      serialized({ analytics: decisionOf('denied', { version: '2026-10' }) }),
    );

    storage.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().status.analytics, 'denied');
  });
});
