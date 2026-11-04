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

  it('false while the saved text differs from the memory, as with a decision expired on load', () => {
    const expired = decisionOf('granted', { decidedAt: START - DEFAULT_MAX_AGE });
    const adapter = createMemoryAdapter(
      serialized({ analytics: decisionOf('granted', { version: '2026-10' }), ads: expired }),
    );

    const { storage } = openOn(adapter);

    assert.equal(storage.isPersisted(), false);
  });

  it('true again after the next confirmed write', () => {
    const expired = decisionOf('granted', { decidedAt: START - DEFAULT_MAX_AGE });
    const adapter = createMemoryAdapter(
      serialized({ analytics: decisionOf('granted', { version: '2026-10' }), ads: expired }),
    );
    const { storage } = openOn(adapter);

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
