import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { connectStore, type StoredConsent } from '../../examples/consent-store.ts';
import { createMemoryStore } from '../support/memory-store.ts';
import { decisionOf, recordOf, serialized } from '../support/records.ts';
import { setup, type PurposeId } from '../support/setup.ts';

describe('server environment', () => {
  it('without window, as on the server, the core creates, decides and reads normally', () => {
    assert.equal('window' in globalThis, false);
    const { consent } = setup({ record: serialized({ ads: decisionOf('granted') }) });

    consent.decide({ analytics: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'granted',
      health: 'pending',
    });
  });

  /**
   * Counts the reads of the global `name` during `act`. The global may not even exist in Node, like
   * `window`; at the end, the original descriptor is restored.
   */
  function countGlobalReads(name: string, act: () => void): number {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    let reads = 0;
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        reads += 1;
        return undefined;
      },
    });
    try {
      act();
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, original);
    }
    return reads;
  }

  /** Goes through the operations of the core: hydration, subscription, decisions, bulk and restore. */
  function exerciseCore(): void {
    const { consent } = setup({ record: serialized({ ads: decisionOf('granted') }) });
    const unsubscribe = consent.subscribe(() => undefined);
    consent.decide({ analytics: 'granted' });
    consent.grantAll();
    consent.denyAll();
    consent.restore(consent.getServerSnapshot().record);
    unsubscribe();
  }

  /**
   * Globals that the core never reads: browser and Node APIs, timers, logs, identifier generation
   * and code evaluation.
   */
  const FORBIDDEN_GLOBALS = [
    'window',
    'document',
    'navigator',
    'localStorage',
    'sessionStorage',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'setTimeout',
    'setInterval',
    'setImmediate',
    'process',
    'console',
    'crypto',
    'eval',
    'Function',
  ] as const;

  for (const name of FORBIDDEN_GLOBALS) {
    it(`the core never reads the global ${name}`, () => {
      const reads = countGlobalReads(name, exerciseCore);

      assert.equal(reads, 0);
    });
  }
});

/** Decision action of the recipe, called by the interface instead of the action of the manager. */
interface RecipeAction {
  readonly action: string;
  readonly act: (actions: StoredConsent<PurposeId>) => void;
  /** Record that the action writes from the initial state, without decisions. */
  readonly saved: string;
}

const RECIPE_ACTIONS = [
  {
    action: 'decide',
    act: (actions) => {
      actions.decide({ ads: 'denied' });
    },
    saved: serialized({ ads: decisionOf('denied') }),
  },
  {
    action: 'grantAll',
    act: (actions) => {
      actions.grantAll();
    },
    saved: serialized({
      analytics: decisionOf('granted', { version: '2026-10' }),
      ads: decisionOf('granted'),
    }),
  },
  {
    action: 'denyAll',
    act: (actions) => {
      actions.denyAll();
    },
    saved: serialized({
      analytics: decisionOf('denied', { version: '2026-10' }),
      ads: decisionOf('denied'),
      health: decisionOf('denied', { version: '1' }),
    }),
  },
] as const satisfies readonly RecipeAction[];

/** Two tabs connected to the same storage: A grants what grantAll reaches and B syncs. */
function syncedTabs() {
  const store = createMemoryStore();
  const tabA = setup();
  const actionsA = connectStore(tabA.consent, store);
  const tabB = setup();
  const actionsB = connectStore(tabB.consent, store);
  actionsA.grantAll();
  actionsB.sync();
  return { store, tabA, actionsA, tabB, actionsB };
}

/** After the sync, A revokes analytics, and B, without receiving an event, becomes outdated. */
function staleTabB() {
  const tabs = syncedTabs();
  tabs.actionsA.decide({ analytics: 'denied' });
  tabs.tabB.changes.length = 0; // the sync of B already recorded a 'restore'
  return tabs;
}

describe('two tabs connected by the recipe to the same storage', () => {
  it('B sees the grants of A when syncing', () => {
    const { tabB } = syncedTabs();

    assert.deepStrictEqual(tabB.consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('the saved record keeps the revocation of A and receives the refusal of B', () => {
    const { store, actionsB } = staleTabB();

    actionsB.decide({ ads: 'denied' });

    const saved: unknown = JSON.parse(store.value ?? 'null');
    assert.deepStrictEqual(
      saved,
      recordOf({
        analytics: decisionOf('denied', { version: '2026-10' }),
        ads: decisionOf('denied'),
      }),
    );
  });

  it('B sees analytics denied', () => {
    const { tabB, actionsB } = staleTabB();

    actionsB.decide({ ads: 'denied' });

    assert.equal(tabB.consent.getSnapshot().status.analytics, 'denied');
  });

  for (const { action, act } of RECIPE_ACTIONS) {
    it(`${action} of the recipe in B adopts the saved record before deciding: sources restore and decision`, () => {
      const { tabB, actionsB } = staleTabB();

      act(actionsB);

      assert.deepStrictEqual(
        tabB.changes.map(({ source }) => source),
        ['restore', 'decision'],
      );
    });
  }
});

describe('guarantees of the recipe: reading and writing the record', () => {
  it('connecting adopts the saved record', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();

    connectStore(consent, store);

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('connecting produces neither a decision notification nor a write', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent, changes } = setup();

    connectStore(consent, store);

    assert.deepStrictEqual(
      changes.map(({ source }) => source),
      ['restore'],
    );
    assert.equal(store.writes, 0);
  });

  it('restores never write, neither by sync nor by a direct restore', () => {
    const store = createMemoryStore();
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.value = serialized({ ads: decisionOf('granted') });

    actions.sync();
    consent.restore(serialized({ ads: decisionOf('denied') }));

    assert.equal(store.writes, 0);
  });

  for (const { action, act, saved } of RECIPE_ACTIONS) {
    it(`${action} of the recipe writes the resulting record`, () => {
      const store = createMemoryStore();
      const { consent } = setup();
      const actions = connectStore(consent, store);

      act(actions);

      assert.equal(store.value, saved);
    });
  }

  it('each decision writes the complete record, not only the changed purpose', () => {
    const analytics = decisionOf('granted', { version: '2026-10' });
    const store = createMemoryStore(serialized({ analytics }));
    const { consent } = setup();
    const actions = connectStore(consent, store);

    actions.decide({ ads: 'denied' });

    assert.equal(store.value, serialized({ analytics, ads: decisionOf('denied') }));
  });

  it('sync with the saved value unchanged does not notify', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent, changes } = setup();
    const actions = connectStore(consent, store);
    const notified = changes.length;

    actions.sync();

    assert.equal(changes.length, notified);
  });

  it('after a write of this page, sync adopts the removal of the record made by another tab', () => {
    const store = createMemoryStore();
    const { consent } = setup();
    const actions = connectStore(consent, store);
    actions.decide({ ads: 'granted' });
    store.value = null; // another tab removed the record after a write that failed

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('an invalid saved record results in every purpose pending, without error', () => {
    const store = createMemoryStore('{"format":1,"decisions":');
    const { consent } = setup();

    assert.doesNotThrow(() => connectStore(consent, store));

    assert.deepStrictEqual(consent.getSnapshot().status, {
      analytics: 'pending',
      ads: 'pending',
      health: 'pending',
    });
  });
});

describe('storage failures', () => {
  it('a write that fails removes the saved record and keeps the decision in memory', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.failWrite = true;

    actions.decide({ ads: 'denied' });

    assert.equal(store.value, null);
    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('the sync after a write that failed does not erase the decisions of the page', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.failWrite = true;
    actions.decide({ ads: 'denied' });
    store.failWrite = false;

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('if the removal also fails, the decision holds only in this page, without error', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.failWrite = true;
    store.failRemove = true;

    assert.doesNotThrow(() => {
      actions.decide({ ads: 'denied' });
    });

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('a read that fails keeps the state in memory', () => {
    const store = createMemoryStore();
    const { consent } = setup();
    const actions = connectStore(consent, store);
    actions.decide({ ads: 'granted' });
    store.value = serialized({ ads: decisionOf('denied') });
    store.failRead = true;

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });
});

describe('a write discarded without exception, like the one of a rejected cookie', () => {
  /** Connects to the record that grants ads and revokes it through the recipe, with the write discarded. */
  function revokeWithDiscardedWrite({ discardRemove }: { readonly discardRemove: boolean }) {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.discardWrite = true;
    store.discardRemove = discardRemove;
    actions.decide({ ads: 'denied' });
    return { store, consent, actions };
  }

  it('the write is not confirmed by the read, and the saved record, more permissive, is removed', () => {
    const { store } = revokeWithDiscardedWrite({ discardRemove: false });

    assert.equal(store.value, null);
  });

  it('the next sync does not undo the revocation', () => {
    const { consent, actions } = revokeWithDiscardedWrite({ discardRemove: false });

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('with the removal also discarded, the sync does not adopt again the record that is left', () => {
    const { consent, actions } = revokeWithDiscardedWrite({ discardRemove: true });

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });
});

describe('a read that fails before a decision in an outdated tab', () => {
  /** B, outdated, refuses ads through the recipe, and only the read of the sync before the decision fails. */
  function decideInStaleTabWithFailedRead() {
    const tabs = staleTabB();
    tabs.store.failNextRead = true;
    tabs.actionsB.decide({ ads: 'denied' });
    return tabs;
  }

  it('B does not write the memory, which may be outdated: the saved record is removed', () => {
    const { store } = decideInStaleTabWithFailedRead();

    assert.equal(store.value, null);
  });

  it('A has analytics pending when syncing, without adopting again the grant it revoked', () => {
    const { tabA, actionsA } = decideInStaleTabWithFailedRead();

    actionsA.sync();

    assert.equal(tabA.consent.getSnapshot().status.analytics, 'pending');
  });

  it('B keeps in memory the recorded decision', () => {
    const { tabB } = decideInStaleTabWithFailedRead();

    assert.equal(tabB.consent.getSnapshot().status.ads, 'denied');
  });

  it('with the read back, B adopts the removal before deciding and does not write back the outdated memory', () => {
    const { store, actionsB } = decideInStaleTabWithFailedRead();

    actionsB.decide({ analytics: 'denied' });

    assert.equal(
      store.value,
      serialized({ analytics: decisionOf('denied', { version: '2026-10' }) }),
    );
  });

  it('with the read also unavailable after the removal, the next sync adopts the removal', () => {
    const { store, tabB, actionsB } = staleTabB();
    store.failRead = true;
    actionsB.decide({ ads: 'denied' });
    store.failRead = false;

    actionsB.sync();

    assert.equal(tabB.consent.getSnapshot().status.ads, 'pending');
  });
});

describe('an external record adopted by the application with adopt', () => {
  /** Record loaded from the application backend, which revokes analytics. */
  const BACKEND_RECORD = serialized({ analytics: decisionOf('denied', { version: '2026-10' }) });

  it('adopt replaces the decisions in memory with the ones of the external record', () => {
    const { tabA, actionsA } = syncedTabs();

    actionsA.adopt(BACKEND_RECORD);

    assert.deepStrictEqual(tabA.consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'pending',
      health: 'pending',
    });
  });

  it('adopt writes the adopted record to the storage', () => {
    const { store, actionsA } = syncedTabs();

    actionsA.adopt(BACKEND_RECORD);

    assert.equal(store.value, BACKEND_RECORD);
  });

  it('the other tab receives the adopted record when syncing', () => {
    const { tabB, actionsA, actionsB } = syncedTabs();

    actionsA.adopt(BACKEND_RECORD);
    actionsB.sync();

    assert.equal(tabB.consent.getSnapshot().status.analytics, 'denied');
  });
});

describe('docs/persistencia.md reproduces the recipe verbatim', () => {
  /** Content of the first TypeScript code block after the heading `heading` in the guide. */
  function guideBlockAfter(heading: string): string | undefined {
    const guide = readFileSync(new URL('../../docs/persistencia.md', import.meta.url), 'utf8');
    const start = guide.indexOf(heading);
    if (start === -1) return undefined;
    return /```ts\r?\n([\s\S]*?)```/.exec(guide.slice(start))?.[1];
  }

  it('the block of the section "Receita (consent-store.ts)" is identical to examples/consent-store.ts', () => {
    const recipe = readFileSync(
      new URL('../../examples/consent-store.ts', import.meta.url),
      'utf8',
    );

    assert.equal(guideBlockAfter('## Receita (`consent-store.ts`)'), recipe);
  });
});
