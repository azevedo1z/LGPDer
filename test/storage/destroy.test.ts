import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ConsentStorage } from 'lgpder/storage';

import { testDom } from '../support/dom.ts';
import { createMemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, serialized } from '../support/records.ts';
import type { PurposeId } from '../support/setup.ts';
import { closeTabs, nextBroadcast, openTab } from '../support/tabs.ts';

afterEach(() => {
  closeTabs();
  testDom.reset();
});

const ADS_GRANTED = serialized({ ads: decisionOf('granted') });

/** Every function of the handle except destroy, called with valid arguments. */
const CALLS: readonly {
  readonly name: string;
  readonly call: (storage: ConsentStorage<PurposeId>) => void;
}[] = [
  {
    name: 'decide',
    call: (storage) => {
      storage.decide({ ads: 'granted' });
    },
  },
  {
    name: 'grantAll',
    call: (storage) => {
      storage.grantAll();
    },
  },
  {
    name: 'denyAll',
    call: (storage) => {
      storage.denyAll();
    },
  },
  {
    name: 'adopt',
    call: (storage) => {
      storage.adopt(ADS_GRANTED);
    },
  },
  {
    name: 'sync',
    call: (storage) => {
      storage.sync();
    },
  },
  {
    name: 'isPersisted',
    call: (storage) => {
      storage.isPersisted();
    },
  },
];

describe('a destroyed storage handle', () => {
  for (const { name, call } of CALLS) {
    it(`${name} throws, and the manager does not change`, () => {
      const { consent, storage } = openTab();
      storage.destroy();

      assert.throws(
        () => {
          call(storage);
        },
        {
          name: 'Error',
          message: '[lgpder] This instance was destroyed.',
        },
      );
      assert.equal(consent.getSnapshot().status.ads, 'pending');
    });
  }

  it('destroy is idempotent', () => {
    const { storage } = openTab();
    storage.destroy();

    assert.doesNotThrow(() => {
      storage.destroy();
    });
  });

  it('stops writing: a decision on the manager is no longer saved', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openTab({ storage: adapter });
    storage.destroy();

    consent.decide({ ads: 'granted' });

    assert.equal(adapter.writes, 0);
    assert.equal(adapter.value, null);
  });

  it('leaves the manager usable', () => {
    const { consent, storage } = openTab();
    storage.destroy();

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('removes the storage, pageshow and visibilitychange listeners', () => {
    const { consent, storage } = openTab();
    storage.destroy();
    const { window } = testDom;
    localStorage.setItem('lgpder', ADS_GRANTED);

    window.dispatchEvent(
      new window.StorageEvent('storage', { key: 'lgpder', storageArea: localStorage }),
    );
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new window.Event('visibilitychange'));

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('closes the BroadcastChannel: the tab is no longer notified', async () => {
    const tabA = openTab({ storage: 'cookie' });
    const tabB = openTab({ storage: 'cookie' });
    tabB.storage.destroy();
    const delivered = nextBroadcast();

    tabA.storage.decide({ ads: 'granted' });
    await delivered;

    assert.equal(tabB.consent.getSnapshot().status.ads, 'pending');
  });
});
