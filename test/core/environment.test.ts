import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decisionOf, serialized } from '../support/records.ts';
import { setup } from '../support/setup.ts';

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
