import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import '../support/dom.ts';
import { createMemoryAdapter } from '../support/memory-adapter.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { DEFAULT_MAX_AGE, START } from '../support/setup.ts';
import { closeTabs, openTab } from '../support/tabs.ts';

afterEach(closeTabs);

/** Decision of the test clock whose age is exactly the default maxAge: expired. */
const EXPIRED = { decidedAt: START - DEFAULT_MAX_AGE } as const;

interface SavedText {
  readonly saved: string;
  readonly text: string;
}

/** Saved texts that, once adopted, leave no decision in the record. */
const WITHOUT_DECISIONS: readonly SavedText[] = [
  {
    saved: 'a record whose every decision expired',
    text: serialized({
      analytics: decisionOf('granted', { version: '2026-10', ...EXPIRED }),
      ads: decisionOf('denied', EXPIRED),
    }),
  },
  { saved: 'an invalid text', text: '{"format":1,"decisions":' },
  { saved: 'a record of other purposes', text: serialized({ chat: decisionOf('granted') }) },
  { saved: 'a record without decisions', text: serialized({}) },
];

/** Saved texts that keep at least one decision, current or outdated. */
const WITH_DECISIONS: readonly SavedText[] = [
  { saved: 'a record with a current decision', text: serialized({ ads: decisionOf('granted') }) },
  {
    saved: 'a record with only an outdated decision',
    text: serialized({ analytics: decisionOf('granted', { version: '2025-01' }) }),
  },
];

describe('a saved record without any decision is removed', () => {
  for (const { saved, text } of WITHOUT_DECISIONS) {
    it(`connecting to ${saved} removes it and leaves every purpose pending`, () => {
      const adapter = createMemoryAdapter(text);

      const { consent } = openTab({ storage: adapter, crossTab: false });

      assert.equal(adapter.value, null);
      assert.deepStrictEqual(consent.getSnapshot().status, {
        analytics: 'pending',
        ads: 'pending',
        health: 'pending',
      });
    });
  }

  for (const { saved, text } of WITH_DECISIONS) {
    it(`connecting to ${saved} keeps it`, () => {
      const adapter = createMemoryAdapter(text);

      openTab({ storage: adapter, crossTab: false });

      assert.equal(adapter.value, text);
    });
  }

  it('connecting with nothing saved removes nothing', () => {
    const adapter = createMemoryAdapter();

    openTab({ storage: adapter, crossTab: false });

    assert.equal(adapter.removals, 0);
  });

  it('a sync that adopts a record without decisions, written by another tab, removes it', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted') }));
    const { consent, storage } = openTab({ storage: adapter, crossTab: false });
    adapter.value = serialized({ ads: decisionOf('granted', EXPIRED) });

    storage.sync();

    assert.equal(adapter.value, null);
    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('after the removal, a sync notifies nothing and the storage is persisted', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted', EXPIRED) }));
    const { changes, storage } = openTab({ storage: adapter, crossTab: false });

    storage.sync();

    assert.deepStrictEqual(changes, []);
    assert.equal(storage.isPersisted(), true);
  });

  it('a removal that fails keeps every purpose pending, without error', () => {
    const adapter = createMemoryAdapter(serialized({ ads: decisionOf('granted', EXPIRED) }));
    adapter.failRemove = true;

    const { consent } = openTab({ storage: adapter, crossTab: false });

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });
});
