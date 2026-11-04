/** In-memory storage adapter for the tests of the storage layer. */
import type { StorageAdapter } from 'lgpder/storage';

/** In-memory `StorageAdapter`, with a failure that can be simulated in each method. */
export interface MemoryAdapter extends StorageAdapter {
  /** Saved text; `null` when there is no record. */
  value: string | null;
  /** Makes `read` throw, like a browser `SecurityError`. */
  failRead: boolean;
  /** Makes only the next call to `read` throw, like a transient failure. */
  failNextRead: boolean;
  /** Makes `write` throw, like an exceeded quota. */
  failWrite: boolean;
  /** Makes `remove` throw. */
  failRemove: boolean;
  /** Makes `write` discard the write without throwing, as the browser does with a rejected cookie. */
  discardWrite: boolean;
  /** Makes `remove` discard the removal without throwing. */
  discardRemove: boolean;
  /** Number of calls to `read`. */
  reads: number;
  /** Number of writes completed by `write`. */
  writes: number;
  /** Number of removals completed by `remove`. */
  removals: number;
}

export function createMemoryAdapter(initial: string | null = null): MemoryAdapter {
  const adapter: MemoryAdapter = {
    value: initial,
    failRead: false,
    failNextRead: false,
    failWrite: false,
    failRemove: false,
    discardWrite: false,
    discardRemove: false,
    reads: 0,
    writes: 0,
    removals: 0,
    read: () => {
      adapter.reads += 1;
      if (adapter.failNextRead) {
        adapter.failNextRead = false;
        throw new Error('read unavailable');
      }
      if (adapter.failRead) throw new Error('read unavailable');
      return adapter.value;
    },
    write: (value) => {
      if (adapter.failWrite) throw new Error('quota exceeded');
      if (adapter.discardWrite) return;
      adapter.value = value;
      adapter.writes += 1;
    },
    remove: () => {
      if (adapter.failRemove) throw new Error('removal unavailable');
      if (adapter.discardRemove) return;
      adapter.value = null;
      adapter.removals += 1;
    },
  };
  return adapter;
}
