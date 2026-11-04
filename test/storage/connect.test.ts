import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ConsentStorage } from 'lgpder/storage';

import '../support/dom.ts';
import { createMemoryAdapter, type MemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, recordOf, serialized } from '../support/records.ts';
import { callUntyped, type PurposeId } from '../support/setup.ts';
import { closeTabs, openTab, type Tab } from '../support/tabs.ts';

afterEach(closeTabs);

/** Connects a tab to `adapter`, without cross-tab sync: these tests sync explicitly. */
function openOn(adapter: MemoryAdapter): Tab {
  return openTab({ storage: adapter, crossTab: false });
}

/** Decision action of the storage, called by the interface instead of the action of the manager. */
interface StorageAction {
  readonly action: string;
  readonly act: (storage: ConsentStorage<PurposeId>) => void;
  /** Record that the action writes from the initial state, without decisions. */
  readonly saved: string;
}

const STORAGE_ACTIONS = [
  {
    action: 'decide',
    act: (storage) => {
      storage.decide({ ads: 'denied' });
    },
    saved: serialized({ ads: decisionOf('denied') }),
  },
  {
    action: 'grantAll',
    act: (storage) => {
      storage.grantAll();
    },
    saved: serialized({
      analytics: decisionOf('granted', { version: '2026-10' }),
      ads: decisionOf('granted'),
    }),
  },
  {
    action: 'denyAll',
    act: (storage) => {
      storage.denyAll();
    },
    saved: serialized({
      analytics: decisionOf('denied', { version: '2026-10' }),
      ads: decisionOf('denied'),
      health: decisionOf('denied', { version: '1' }),
    }),
  },
] as const satisfies readonly StorageAction[];

/** Two tabs connected to the same adapter: A grants what grantAll reaches and B syncs. */
function syncedTabs() {
  const adapter = createMemoryAdapter();
  const tabA = openOn(adapter);
  const tabB = openOn(adapter);
  tabA.storage.grantAll();
  tabB.storage.sync();
  return { adapter, tabA, tabB };
}

/** After the sync, A revokes analytics, and B, without receiving an event, becomes outdated. */
function staleTabB() {
  const tabs = syncedTabs();
  tabs.tabA.storage.decide({ analytics: 'denied' });
  tabs.tabB.changes.length = 0; // the sync of B already recorded a 'restore'
  return tabs;
}

describe('two tabs connected to the same storage', () => {
  it('B sees the grants of A when syncing', () => {
    const { tabB } = syncedTabs();

    assert.deepStrictEqual(tabB.consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('the saved record keeps the revocation of A and receives the refusal of B', () => {
    const { adapter, tabB } = staleTabB();

    tabB.storage.decide({ ads: 'denied' });

    const saved: unknown = JSON.parse(adapter.value ?? 'null');
    assert.deepStrictEqual(
      saved,
      recordOf({
        analytics: decisionOf('denied', { version: '2026-10' }),
        ads: decisionOf('denied'),
      }),
    );
  });

  it('B sees analytics denied', () => {
    const { tabB } = staleTabB();

    tabB.storage.decide({ ads: 'denied' });

    assert.equal(tabB.consent.getSnapshot().status.analytics, 'denied');
  });

  for (const { action, act } of STORAGE_ACTIONS) {
    it(`${action} of the storage in B adopts the saved record before deciding: sources restore and decision`, () => {
      const { tabB } = staleTabB();

      act(tabB.storage);

      assert.deepStrictEqual(
        tabB.changes.map(({ source }) => source),
        ['restore', 'decision'],
      );
    });
  }
});

describe('reading and writing the record', () => {
  it('connecting adopts the saved record', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));

    const { consent } = openOn(adapter);

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('connecting produces neither a decision notification nor a write', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));

    const { changes } = openOn(adapter);

    assert.deepStrictEqual(
      changes.map(({ source }) => source),
      ['restore'],
    );
    assert.equal(adapter.writes, 0);
  });

  it('restores never write, neither by sync nor by a direct restore', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openOn(adapter);
    adapter.value = serialized({ ads: decisionOf('granted') });

    storage.sync();
    consent.restore(serialized({ ads: decisionOf('denied') }));

    assert.equal(adapter.writes, 0);
  });

  for (const { action, act, saved } of STORAGE_ACTIONS) {
    it(`${action} of the storage writes the resulting record`, () => {
      const adapter = createMemoryAdapter();
      const { storage } = openOn(adapter);

      act(storage);

      assert.equal(adapter.value, saved);
    });
  }

  it('a decision made directly on the manager is also written', () => {
    const adapter = createMemoryAdapter();
    const { consent } = openOn(adapter);

    consent.decide({ ads: 'denied' });

    assert.equal(adapter.value, serialized({ ads: decisionOf('denied') }));
  });

  it('each decision writes the complete record, not only the changed purpose', () => {
    const analytics = decisionOf('granted', { version: '2026-10' });
    const adapter = createMemoryAdapter(serialized({ analytics }));
    const { storage } = openOn(adapter);

    storage.decide({ ads: 'denied' });

    assert.equal(adapter.value, serialized({ analytics, ads: decisionOf('denied') }));
  });

  it('sync with the saved value unchanged does not notify', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const { changes, storage } = openOn(adapter);
    const notified = changes.length;

    storage.sync();

    assert.equal(changes.length, notified);
  });

  it('after a write of this page, sync adopts the removal of the record made by another tab', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openOn(adapter);
    storage.decide({ ads: 'granted' });
    adapter.value = null; // another tab removed the record after a write that failed

    storage.sync();

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('an invalid saved record results in every purpose pending, without error', () => {
    const adapter = createMemoryAdapter('{"format":1,"decisions":');

    const { consent } = openOn(adapter);

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'pending',
      ads: 'pending',
      health: 'pending',
    });
  });

  it('the actions keep the errors of the manager, and an invalid decision writes nothing', () => {
    const adapter = createMemoryAdapter();
    const { storage } = openOn(adapter);

    assert.throws(
      () => {
        callUntyped(storage.decide, { typo: 'granted' });
      },
      { name: 'RangeError', message: '[lgpder] Unknown purpose: "typo".' },
    );
    assert.equal(adapter.value, null);
  });
});

describe('storage failures', () => {
  it('a write that fails removes the saved record and keeps the decision in memory', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const { consent, storage } = openOn(adapter);
    adapter.failWrite = true;

    storage.decide({ ads: 'denied' });

    assert.equal(adapter.value, null);
    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('the sync after a write that failed does not erase the decisions of the page', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const { consent, storage } = openOn(adapter);
    adapter.failWrite = true;
    storage.decide({ ads: 'denied' });
    adapter.failWrite = false;

    storage.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('if the removal also fails, the decision holds only in this page, without error', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const { consent, storage } = openOn(adapter);
    adapter.failWrite = true;
    adapter.failRemove = true;

    assert.doesNotThrow(() => {
      storage.decide({ ads: 'denied' });
    });

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('a read that fails keeps the state in memory', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openOn(adapter);
    storage.decide({ ads: 'granted' });
    adapter.value = serialized({ ads: decisionOf('denied') });
    adapter.failRead = true;

    storage.sync();

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('a read that fails on connection keeps every purpose pending, without error', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    adapter.failRead = true;

    const { consent } = openOn(adapter);

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });
});

describe('a write discarded without exception, like the one of a rejected cookie', () => {
  /** Connects to the record that grants ads and revokes it, with the write discarded. */
  function revokeWithDiscardedWrite({ discardRemove }: { readonly discardRemove: boolean }) {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const tab = openOn(adapter);
    adapter.discardWrite = true;
    adapter.discardRemove = discardRemove;
    tab.storage.decide({ ads: 'denied' });
    return { adapter, ...tab };
  }

  it('the write is not confirmed by the read, and the saved record, more permissive, is removed', () => {
    const { adapter } = revokeWithDiscardedWrite({ discardRemove: false });

    assert.equal(adapter.value, null);
  });

  it('the next sync does not undo the revocation', () => {
    const { consent, storage } = revokeWithDiscardedWrite({ discardRemove: false });

    storage.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('with the removal also discarded, the sync does not adopt again the record that is left', () => {
    const { consent, storage } = revokeWithDiscardedWrite({ discardRemove: true });

    storage.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });
});

describe('a read that fails before a decision in an outdated tab', () => {
  /** B, outdated, refuses ads, and only the read of the sync before the decision fails. */
  function decideInStaleTabWithFailedRead() {
    const tabs = staleTabB();
    tabs.adapter.failNextRead = true;
    tabs.tabB.storage.decide({ ads: 'denied' });
    return tabs;
  }

  it('B does not write the memory, which may be outdated: the saved record is removed', () => {
    const { adapter } = decideInStaleTabWithFailedRead();

    assert.equal(adapter.value, null);
  });

  it('A has analytics pending when syncing, without adopting again the grant it revoked', () => {
    const { tabA } = decideInStaleTabWithFailedRead();

    tabA.storage.sync();

    assert.equal(tabA.consent.getSnapshot().status.analytics, 'pending');
  });

  it('B keeps in memory the recorded decision', () => {
    const { tabB } = decideInStaleTabWithFailedRead();

    assert.equal(tabB.consent.getSnapshot().status.ads, 'denied');
  });

  it('with the read back, B adopts the removal before deciding and does not write back the outdated memory', () => {
    const { adapter, tabB } = decideInStaleTabWithFailedRead();

    tabB.storage.decide({ analytics: 'denied' });

    assert.equal(
      adapter.value,
      serialized({ analytics: decisionOf('denied', { version: '2026-10' }) }),
    );
  });

  it('with the read also unavailable after the removal, the next sync adopts the removal', () => {
    const { adapter, tabB } = staleTabB();
    adapter.failRead = true;
    tabB.storage.decide({ ads: 'denied' });
    adapter.failRead = false;

    tabB.storage.sync();

    assert.equal(tabB.consent.getSnapshot().status.ads, 'pending');
  });
});

describe('an external record adopted by the application with adopt', () => {
  /** Record loaded from the application backend, which revokes analytics. */
  const BACKEND_RECORD = serialized({ analytics: decisionOf('denied', { version: '2026-10' }) });

  it('adopt replaces the decisions in memory with the ones of the external record', () => {
    const { tabA } = syncedTabs();

    tabA.storage.adopt(BACKEND_RECORD);

    assert.deepStrictEqual(tabA.consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'pending',
      health: 'pending',
    });
  });

  it('adopt writes the adopted record to the storage', () => {
    const { adapter, tabA } = syncedTabs();

    tabA.storage.adopt(BACKEND_RECORD);

    assert.equal(adapter.value, BACKEND_RECORD);
  });

  it('the other tab receives the adopted record when syncing', () => {
    const { tabA, tabB } = syncedTabs();

    tabA.storage.adopt(BACKEND_RECORD);
    tabB.storage.sync();

    assert.equal(tabB.consent.getSnapshot().status.analytics, 'denied');
  });

  it('adopt with a write that fails removes the saved record and keeps the adopted one in memory', () => {
    const { adapter, tabA } = syncedTabs();
    adapter.failWrite = true;

    tabA.storage.adopt(BACKEND_RECORD);

    assert.equal(adapter.value, null);
    assert.equal(tabA.consent.getSnapshot().status.analytics, 'denied');
  });
});

describe('the returned handle', () => {
  it('is frozen, with the actions in the documented order', () => {
    const { storage } = openOn(createMemoryAdapter());

    assert.ok(Object.isFrozen(storage));
    assert.deepStrictEqual(Object.keys(storage), [
      'decide',
      'grantAll',
      'denyAll',
      'adopt',
      'sync',
      'isPersisted',
      'destroy',
    ]);
  });

  it('works with the functions detached from the handle', () => {
    const adapter = createMemoryAdapter();
    const { decide, sync } = openOn(adapter).storage;

    sync();
    decide({ ads: 'granted' });

    assert.equal(adapter.value, serialized({ ads: decisionOf('granted') }));
  });

  it('calls the methods of an adapter written as a class, with this', () => {
    class ArrayAdapter {
      readonly #values: (string | null)[] = [null];
      read(): string | null {
        return this.#values.at(-1) ?? null;
      }
      write(value: string): void {
        this.#values.push(value);
      }
      remove(): void {
        this.#values.push(null);
      }
    }
    const adapter = new ArrayAdapter();
    const { storage } = openTab({ storage: adapter, crossTab: false });

    storage.decide({ ads: 'granted' });

    assert.equal(adapter.read(), serialized({ ads: decisionOf('granted') }));
  });
});
