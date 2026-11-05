import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import '../support/dom.ts';
import { createMemoryAdapter, type MemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { DEFAULT_MAX_AGE, START } from '../support/setup.ts';
import { closeTabs, openTab, type Tab } from '../support/tabs.ts';

afterEach(closeTabs);

/** Record with ads granted, as written by a decision of the test clock. */
const ADS_GRANTED = serialized({ ads: decisionOf('granted') });

/** Record with analytics granted under its current version. */
const ANALYTICS_GRANTED = serialized({ analytics: decisionOf('granted', { version: '2026-10' }) });

/** Record with analytics granted and an expired grant of ads, which the memory discards. */
const WITH_EXPIRED = serialized({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('granted', { decidedAt: START - DEFAULT_MAX_AGE }),
});

function openOn(adapter: MemoryAdapter): Tab {
  return openTab({ storage: adapter, crossTab: false });
}

/** Connects to the record that grants ads and revokes it with the adapter as set by `fail`. */
function revokeWith(fail: (adapter: MemoryAdapter) => void): Tab {
  const adapter = createMemoryAdapter(ADS_GRANTED);
  const tab = openOn(adapter);
  fail(adapter);
  tab.storage.decide({ ads: 'denied' });
  return tab;
}

describe('isPersisted: the saved record is no more permissive than the memory', () => {
  it('true when nothing is saved', () => {
    const { storage } = openOn(createMemoryAdapter());

    assert.equal(storage.isPersisted(), true);
  });

  it('true when the saved record is the one in memory', () => {
    const { storage } = openOn(createMemoryAdapter(ADS_GRANTED));

    assert.equal(storage.isPersisted(), true);
  });

  it('true after a confirmed write', () => {
    const { storage } = openOn(createMemoryAdapter());

    storage.decide({ ads: 'granted' });

    assert.equal(storage.isPersisted(), true);
  });

  it('true after a write not confirmed whose removal was confirmed: nothing is saved', () => {
    const { storage } = revokeWith((adapter) => {
      adapter.discardWrite = true;
    });

    assert.equal(storage.isPersisted(), true);
  });

  it('false when the write and the removal were discarded: the saved grant is left', () => {
    const { storage } = revokeWith((adapter) => {
      adapter.discardWrite = true;
      adapter.discardRemove = true;
    });

    assert.equal(storage.isPersisted(), false);
  });

  it('false when the write and the removal throw', () => {
    const { storage } = revokeWith((adapter) => {
      adapter.failWrite = true;
      adapter.failRemove = true;
    });

    assert.equal(storage.isPersisted(), false);
  });

  it('false when the storage could never be read', () => {
    const adapter = createMemoryAdapter();
    adapter.failRead = true;

    const { storage } = openOn(adapter);

    assert.equal(storage.isPersisted(), false);
  });

  it('true while the memory is what the saved text hydrated, as with a decision expired on load', () => {
    const { storage } = openOn(createMemoryAdapter(WITH_EXPIRED));

    assert.equal(storage.isPersisted(), true);
  });

  it('true while the memory is what the saved text hydrated, with a purpose of another configuration', () => {
    const { storage } = openOn(
      createMemoryAdapter(serialized({ ads: decisionOf('granted'), chat: decisionOf('granted') })),
    );

    assert.equal(storage.isPersisted(), true);
  });

  it('false once the memory changes after that restore and the write is not confirmed', () => {
    const adapter = createMemoryAdapter(WITH_EXPIRED);
    const { storage } = openOn(adapter);
    adapter.failWrite = true;
    adapter.discardRemove = true;

    storage.decide({ analytics: 'denied' });

    assert.equal(adapter.value, WITH_EXPIRED);
    assert.equal(storage.isPersisted(), false);
  });

  it('false when a listener changed the memory during the delivery of the restore', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openOn(adapter);
    consent.subscribe(({ source }) => {
      if (source === 'restore') consent.decide({ analytics: 'denied' });
    });
    adapter.value = ANALYTICS_GRANTED; // written by another tab, without an event
    adapter.failWrite = true;
    adapter.discardRemove = true;

    storage.sync();

    assert.equal(consent.getSnapshot().status.analytics, 'denied');
    assert.equal(adapter.value, ANALYTICS_GRANTED);
    assert.equal(storage.isPersisted(), false);
  });

  it('true after a confirmed write that follows that restore', () => {
    const { storage } = openOn(createMemoryAdapter(WITH_EXPIRED));

    storage.decide({ health: 'denied' });

    assert.equal(storage.isPersisted(), true);
  });

  it('true after a decision on the manager of an outdated tab: the saved record was removed', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openOn(adapter);
    adapter.value = ADS_GRANTED; // written by another tab, without an event

    consent.decide({ analytics: 'granted' });

    assert.equal(adapter.value, null);
    assert.equal(storage.isPersisted(), true);
  });

  it('false after a decision on the manager of an outdated tab whose removal failed', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openOn(adapter);
    adapter.value = ADS_GRANTED; // written by another tab, without an event
    adapter.failRemove = true;

    consent.decide({ ads: 'denied' });

    assert.equal(adapter.value, ADS_GRANTED);
    assert.equal(storage.isPersisted(), false);
  });

  it('true again once a sync reads the saved record', () => {
    const adapter = createMemoryAdapter();
    const { consent, storage } = openOn(adapter);
    adapter.value = ADS_GRANTED; // written by another tab, without an event
    adapter.failRemove = true;
    consent.decide({ ads: 'denied' });

    storage.sync();

    assert.equal(storage.isPersisted(), true);
  });

  it('does not read the storage', () => {
    const adapter = createMemoryAdapter();
    const { storage } = openOn(adapter);
    const { reads } = adapter;

    storage.isPersisted();

    assert.equal(adapter.reads, reads);
  });
});
