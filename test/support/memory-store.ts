/** In-memory storage to test the persistence recipe. */
import type { RecordStore } from '../../examples/consent-store.ts';

/** In-memory `RecordStore`, with a failure that can be simulated in each method. */
export interface MemoryStore extends RecordStore {
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
  /** Number of writes completed by `write`. */
  writes: number;
}

export function createMemoryStore(initial: string | null = null): MemoryStore {
  const store: MemoryStore = {
    value: initial,
    failRead: false,
    failNextRead: false,
    failWrite: false,
    failRemove: false,
    discardWrite: false,
    discardRemove: false,
    writes: 0,
    read: () => {
      if (store.failNextRead) {
        store.failNextRead = false;
        throw new Error('read unavailable');
      }
      if (store.failRead) throw new Error('read unavailable');
      return store.value;
    },
    write: (value) => {
      if (store.failWrite) throw new Error('quota exceeded');
      if (store.discardWrite) return;
      store.value = value;
      store.writes += 1;
    },
    remove: () => {
      if (store.failRemove) throw new Error('removal unavailable');
      if (store.discardRemove) return;
      store.value = null;
    },
  };
  return store;
}
