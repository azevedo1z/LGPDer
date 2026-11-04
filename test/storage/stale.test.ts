import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import '../support/dom.ts';
import { createMemoryAdapter, type MemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, recordOf, serialized } from '../support/records.ts';
import { setup } from '../support/setup.ts';
import { closeTabs, connectTab, openTab, type Tab } from '../support/tabs.ts';

afterEach(closeTabs);

/**
 * A grants what grantAll reaches and B syncs; then A revokes analytics, and B, without receiving an
 * event, keeps the grant in memory.
 */
function staleTabB() {
  const adapter = createMemoryAdapter();
  const tabA = openTab({ storage: adapter, crossTab: false });
  const tabB = openTab({ storage: adapter, crossTab: false });
  tabA.storage.grantAll();
  tabB.storage.sync();
  tabA.storage.decide({ analytics: 'denied' });
  return { adapter, tabA, tabB };
}

describe('a decision made directly on the manager of an outdated tab', () => {
  it('does not write back the grant revoked in another tab: the saved record is removed', () => {
    const { adapter, tabB } = staleTabB();

    tabB.consent.decide({ ads: 'denied' });

    assert.equal(adapter.value, null);
  });

  it('A, when syncing, does not adopt again the grant it revoked', () => {
    const { tabA, tabB } = staleTabB();
    tabB.consent.decide({ ads: 'denied' });

    tabA.storage.sync();

    assert.equal(tabA.consent.getSnapshot().status.analytics, 'pending');
  });

  it('B keeps the decision in memory', () => {
    const { tabB } = staleTabB();

    tabB.consent.decide({ ads: 'denied' });

    assert.equal(tabB.consent.getSnapshot().status.ads, 'denied');
  });

  it('the next action of B adopts the removal and writes only what was decided after it', () => {
    const { adapter, tabB } = staleTabB();
    tabB.consent.decide({ ads: 'denied' });

    tabB.storage.decide({ health: 'denied' });

    assert.equal(adapter.value, serialized({ health: decisionOf('denied', { version: '1' }) }));
  });

  it('another direct decision, before any sync, removes again instead of writing', () => {
    const { adapter, tabB } = staleTabB();
    tabB.consent.decide({ ads: 'denied' });
    adapter.value = serialized({ ads: decisionOf('denied') }); // written by A meanwhile

    tabB.consent.decide({ health: 'denied' });

    assert.equal(adapter.value, null);
  });

  it('a second direct decision, with nothing saved meanwhile, does not write the outdated memory', () => {
    const { adapter, tabA, tabB } = staleTabB();
    tabB.consent.decide({ ads: 'denied' });

    tabB.consent.decide({ health: 'denied' });

    assert.equal(adapter.value, null);
    tabA.storage.sync();
    assert.equal(tabA.consent.getSnapshot().status.analytics, 'pending');
  });

  it('a direct decision after adopt is written: the adopted record is the verified memory', () => {
    const { adapter, tabB } = staleTabB();
    tabB.consent.decide({ ads: 'denied' });
    tabB.storage.adopt(recordOf({ ads: decisionOf('denied') }));

    tabB.consent.decide({ health: 'denied' });

    assert.equal(
      adapter.value,
      serialized({ ads: decisionOf('denied'), health: decisionOf('denied', { version: '1' }) }),
    );
  });

  it('with the read failing, does not write either: the saved record is removed', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const { consent } = openTab({ storage: adapter, crossTab: false });
    adapter.failNextRead = true;

    consent.decide({ analytics: 'granted' });

    assert.equal(adapter.value, null);
  });

  it('with the saved record unchanged, writes the decision', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const { consent } = openTab({ storage: adapter, crossTab: false });

    consent.decide({ health: 'denied' });

    assert.equal(
      adapter.value,
      serialized({ ads: decisionOf('granted'), health: decisionOf('denied', { version: '1' }) }),
    );
  });
});

describe('a decision made by a listener while a sync restores the saved record', () => {
  it('is written over the adopted record', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openTab({ storage: adapter, crossTab: false });
    consent.subscribe(({ source }) => {
      if (source === 'restore') consent.decide({ health: 'denied' });
    });
    adapter.value = serialized({ ads: decisionOf('granted') });

    storage.sync();

    assert.equal(
      adapter.value,
      serialized({ ads: decisionOf('granted'), health: decisionOf('denied', { version: '1' }) }),
    );
  });
});

/** Record that denies analytics and ads, as the backend or another tab saves it. */
const BOTH_DENIED = recordOf({
  analytics: decisionOf('denied', { version: '2026-10' }),
  ads: decisionOf('denied'),
});

/**
 * Connects a tab whose listener, subscribed before the storage, calls `react` while the first
 * decision is delivered, so that the storage receives that decision after what `react` commits.
 */
function tabReactingBeforeStorage(adapter: MemoryAdapter, react: (tab: Tab) => void): Tab {
  const base = setup();
  let tab: Tab | undefined;
  base.consent.subscribe(({ source }) => {
    if (source !== 'decision' || tab === undefined) return;
    const reacting = tab;
    tab = undefined; // reacts only once
    react(reacting);
  });
  tab = connectTab(base, { storage: adapter, crossTab: false });
  return tab;
}

describe('a decision whose delivery is outrun by a restore committed by an earlier listener', () => {
  const REACTIONS: readonly {
    readonly reaction: string;
    readonly react: (tab: Tab, adapter: MemoryAdapter) => void;
  }[] = [
    {
      reaction: 'adopt',
      react: ({ storage }) => {
        storage.adopt(BOTH_DENIED);
      },
    },
    {
      reaction: 'sync of a record saved by another tab',
      react: ({ storage }, adapter) => {
        adapter.value = JSON.stringify(BOTH_DENIED);
        storage.sync();
      },
    },
  ];

  for (const { reaction, react } of REACTIONS) {
    it(`is not written over the record restored by ${reaction}`, () => {
      const adapter = createMemoryAdapter();
      const { consent, storage } = tabReactingBeforeStorage(adapter, (tab) => {
        react(tab, adapter);
      });

      storage.grantAll();

      assert.equal(consent.getSnapshot().status.analytics, 'denied');
      assert.equal(adapter.value, JSON.stringify(BOTH_DENIED));
      assert.equal(storage.isPersisted(), true);
    });
  }

  it('only the decision committed by the earlier listener is written, once', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = tabReactingBeforeStorage(adapter, (tab) => {
      tab.consent.decide({ ads: 'denied' });
    });

    storage.grantAll();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
    assert.equal(adapter.value, JSON.stringify(consent.getSnapshot().record));
    assert.equal(adapter.writes, 1);
  });
});
