/**
 * LGPDer storage: persists the consent record of a manager and keeps the tabs in sync.
 *
 * Connects a manager of the core to `localStorage` (default), to a first-party cookie or to an
 * adapter of the application. The connection adopts the saved record, writes each decision of the
 * data subject and, before each new decision, adopts the most recent record, so that an outdated
 * page never writes back as granted a purpose revoked in another tab. Every storage failure keeps
 * the consent in memory and never grants anything.
 *
 * @packageDocumentation
 */

import type { ConsentChange, ConsentChoices, ConsentManager, ConsentRecord } from '../index.ts';
import {
  cookieAdapter,
  localStorageAdapter,
  ownOptions,
  parseCookieName,
  parseKey,
} from './adapters.ts';

export { cookieAdapter, localStorageAdapter } from './adapters.ts';

/**
 * Synchronous storage of the serialized record. Any method may throw: a failure keeps the consent
 * in memory and never grants anything. Each write is confirmed by reading it back, because some
 * storages, such as the cookie, discard a write without throwing.
 */
export interface StorageAdapter {
  /** Saved text, exactly as written, or `null` when there is none. */
  read(): string | null;
  /** Replaces the saved text. */
  write(value: string): void;
  /** Removes the saved text. */
  remove(): void;
}

/** Options of {@link connectStorage}. Read only as own properties; unknown keys are rejected. */
export interface StorageOptions {
  /**
   * Where the record is saved. Default: `'localStorage'`.
   *
   * - `'localStorage'`: {@link localStorageAdapter}; other tabs are followed through the `storage`
   *   event.
   * - `'cookie'`: {@link cookieAdapter}, with the `maxAge` of the manager; other tabs are followed
   *   through a `BroadcastChannel`. Use it when the server needs to read the consent.
   * - A {@link StorageAdapter} of the application; other tabs are followed through a
   *   `BroadcastChannel`.
   */
  readonly storage?: 'localStorage' | 'cookie' | StorageAdapter | undefined;
  /**
   * `localStorage` key or cookie name, also used to name the `BroadcastChannel`
   * (`lgpder:<key>`). A non-empty string; for the cookie, an HTTP token (ASCII letters, digits and
   * `` !#$%&'*+-.^_`|~ ``). On sites served only over HTTPS, the cookie name `'__Host-lgpder'`
   * keeps other hosts of the site from setting a cookie with the same name. Default: `'lgpder'`.
   */
  readonly key?: string | undefined;
  /**
   * Whether this tab adopts, right away, the record saved by another tab, including revocations,
   * and also when it becomes visible or is restored from the back/forward cache. With `false`,
   * the saved record is still adopted before each decision. Default: `true`.
   */
  readonly crossTab?: boolean | undefined;
}

/**
 * Decision actions that replace the ones of the manager for applications that persist the consent.
 * Frozen object; the functions do not depend on `this`. After {@link ConsentStorage.destroy}, every
 * other function throws `Error('[lgpder] This instance was destroyed.')`.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface ConsentStorage<P extends string = string> {
  /**
   * Adopts the saved record, then calls `decide` of the manager. Call it only in response to an
   * explicit action of the data subject.
   *
   * @throws Same errors as `decide` of the manager.
   */
  readonly decide: (choices: ConsentChoices<P>) => void;
  /**
   * Adopts the saved record, then calls `grantAll` of the manager.
   *
   * @throws Same errors as `grantAll` of the manager.
   */
  readonly grantAll: () => void;
  /**
   * Adopts the saved record, then calls `denyAll` of the manager.
   *
   * @throws Same errors as `denyAll` of the manager.
   */
  readonly denyAll: () => void;
  /**
   * Adopts an external record, such as the one of the application backend, with `restore`, and
   * writes the result. The adopted record replaces the saved one in every tab.
   *
   * @param record - Record to adopt (object or JSON text), treated as untrusted data.
   */
  readonly adopt: (record: unknown) => void;
  /**
   * Adopts the saved record with `restore` if it changed since the last read or write of this
   * page. Never throws because of the storage: when the read fails, the memory holds.
   */
  readonly sync: () => void;
  /**
   * Whether the saved record is known to be no more permissive than the memory: nothing is saved,
   * or the saved text is the record in memory. `false` while unknown, such as after a write and a
   * removal that were not confirmed, or outside the browser. A reload is only safe when it is
   * `true`.
   */
  readonly isPersisted: () => boolean;
  /** Stops reading, writing and following other tabs, and releases every listener. Idempotent. */
  readonly destroy: () => void;
}

const DESTROYED = '[lgpder] This instance was destroyed.';

/** Whether the record has no decision at all, current or outdated. */
function isEmpty(record: ConsentRecord): boolean {
  return Object.keys(record.decisions).length === 0;
}

/** Whether `value` has the three methods of {@link StorageAdapter}. */
function isAdapter(value: unknown): value is StorageAdapter {
  if (typeof value !== 'object' || value === null) return false;
  const { read, write, remove } = value as Partial<Record<keyof StorageAdapter, unknown>>;
  return typeof read === 'function' && typeof write === 'function' && typeof remove === 'function';
}

/** Link of a page with the other tabs that share its storage. */
interface TabLink {
  /** Tells the other tabs that this page changed the record, when the storage does not. */
  readonly notify: () => void;
  /** Stops following the other tabs and releases every listener. */
  readonly stop: () => void;
}

/** Follows the changes that other tabs make to the record saved under `key`. */
type FollowTabs = (key: string, onChange: () => void) => TabLink;

/** Does nothing: there is nothing to notify or release. */
function ignore(): void {
  // nothing to do
}

/**
 * Follows the `storage` event of `localStorage` for `key`. Nothing to notify: the browser fires the
 * event in the other tabs.
 */
const followStorageEvent: FollowTabs = (key, onChange) => {
  const onStorage = (event: StorageEvent): void => {
    if (event.storageArea === localStorage && (event.key === null || event.key === key)) {
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return {
    notify: ignore,
    stop: (): void => {
      window.removeEventListener('storage', onStorage);
    },
  };
};

/**
 * Follows the messages of the `BroadcastChannel` named `lgpder:<key>`, when the browser has one. The
 * message carries no data: the record never travels outside the storage.
 */
const followChannel: FollowTabs = (key, onChange) => {
  if (typeof BroadcastChannel !== 'function') return { notify: ignore, stop: ignore };
  const channel = new BroadcastChannel(`lgpder:${key}`);
  channel.onmessage = onChange;
  return {
    notify: (): void => {
      channel.postMessage(null);
    },
    stop: (): void => {
      channel.close();
    },
  };
};

/**
 * Calls `onChange` when another tab may have changed the saved record, as `follow` detects it, and
 * when the page is restored from the back/forward cache or becomes visible, since a suspended page
 * misses the changes in between.
 */
function linkTabs(follow: FollowTabs, key: string, onChange: () => void): TabLink {
  const link = follow(key, onChange);
  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) onChange();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') onChange();
  };
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return {
    notify: link.notify,
    stop: (): void => {
      link.stop();
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

/** Storage chosen by the options: its adapter, its key and how other tabs are followed. */
interface ResolvedStorage {
  readonly adapter: StorageAdapter;
  readonly key: string;
  readonly follow: FollowTabs;
}

/**
 * Validates `storage` and then `key`, and resolves the storage they choose.
 *
 * @param maxAge - Lifetime of the cookie, the `maxAge` of the manager.
 * @throws {TypeError} Invalid `storage` or `key`.
 */
function resolveStorage(storage: unknown, key: unknown, maxAge: number): ResolvedStorage {
  if (storage === 'localStorage') {
    const name = parseKey(key);
    return { adapter: localStorageAdapter({ key: name }), key: name, follow: followStorageEvent };
  }
  if (storage === 'cookie') {
    const name = parseCookieName(key);
    return { adapter: cookieAdapter({ key: name, maxAge }), key: name, follow: followChannel };
  }
  if (!isAdapter(storage)) {
    throw new TypeError(
      '[lgpder] "storage" must be "localStorage", "cookie" or an object with read, write and remove functions.',
    );
  }
  return { adapter: storage, key: parseKey(key), follow: followChannel };
}

/**
 * Connects a manager to a storage and returns the actions the application uses instead of the
 * ones of the manager.
 *
 * On connection, the saved record is adopted with `restore`. Only changes with source `'decision'`
 * and the records adopted by {@link ConsentStorage.adopt} are written, always as the complete
 * record, and each write is confirmed by reading it back. Before writing a decision, the storage is
 * read again: if the read fails or the saved text changed since this page last read or wrote it,
 * the memory may be outdated, so the saved record is removed instead of overwritten. The saved
 * record is also removed when a write is not confirmed and when it no longer holds any decision.
 * The saved record is therefore never more permissive than the page.
 *
 * Outside the browser (no `document`), the storage is never touched: the actions only act on the
 * manager, in memory.
 *
 * Connect the storage before the other subscribers of the manager, so that a decision is saved
 * before they react to it.
 *
 * @typeParam P - Union of the purpose ids.
 * @param consent - Manager to persist.
 * @param options - Storage, key and cross-tab sync.
 * @returns Frozen actions.
 * @throws {TypeError} Invalid options.
 *
 * @example
 * ```ts
 * const consent = createConsentManager({ purposes: { analytics: {}, ads: {} } });
 * const storage = connectStorage(consent); // localStorage, key 'lgpder'
 * storage.decide({ analytics: 'granted' }); // the interface calls the actions of the storage
 * ```
 */
export function connectStorage<P extends string>(
  consent: ConsentManager<P>,
  options?: StorageOptions,
): ConsentStorage<P> {
  const {
    storage = 'localStorage',
    key,
    crossTab = true,
  } = ownOptions(options, ['storage', 'key', 'crossTab']);
  const { adapter, key: name, follow } = resolveStorage(storage, key, consent.maxAge);
  if (typeof crossTab !== 'boolean') throw new TypeError('[lgpder] "crossTab" must be a boolean.');
  const inBrowser = typeof document !== 'undefined';

  // Last text read or written by this page; `undefined` until the first successful read.
  let lastSeen: string | null | undefined;
  // Whether the memory may be outdated in relation to the saved record, which must then be adopted
  // even if its text did not change.
  let unverified = false;
  // Whether a removal failed, so the saved text may differ from lastSeen, until the next successful
  // read or confirmed write. lastSeen is kept, so that what is left is not adopted again.
  let unknown = false;
  let tabs: TabLink | undefined;
  let unsubscribe: (() => void) | undefined;
  let destroyed = false;

  const assertAlive = (): void => {
    if (destroyed) throw new Error(DESTROYED);
  };

  /** Without a confirmed write, what is saved could be more permissive than the page: remove it. */
  const removeSaved = (): void => {
    try {
      adapter.remove();
      tabs?.notify();
      // If the removal was discarded, what is left is not adopted again.
      lastSeen = adapter.read();
      unknown = false;
    } catch {
      // Storage unreachable: what is left is unknown, but it is not adopted again.
      unknown = true;
    }
  };

  const adoptSaved = (): void => {
    let saved: string | null;
    try {
      saved = adapter.read();
    } catch {
      return; // read unavailable: the memory holds
    }
    unknown = false;
    if (saved === lastSeen && !unverified) return; // nothing new since the last read or write
    lastSeen = saved;
    unverified = false;
    consent.restore(saved);
    // Expired, invalid or foreign content: keep nothing that no longer records a decision.
    if (saved !== null && isEmpty(consent.getSnapshot().record)) removeSaved();
  };

  const save = (serialized: string): void => {
    try {
      adapter.write(serialized);
      // Some storages, such as the cookie, discard a write without throwing: confirm by reading.
      if (adapter.read() === serialized) {
        lastSeen = serialized;
        unverified = false;
        unknown = false;
        tabs?.notify();
        return;
      }
    } catch {
      // write or read unavailable: go on to the removal
    }
    removeSaved();
  };

  /** Whether the memory is verified and the saved text is still the one this page last saw. */
  const isCurrent = (): boolean => {
    try {
      return !unverified && adapter.read() === lastSeen;
    } catch {
      return false;
    }
  };

  const onChange = ({ source, snapshot }: ConsentChange<P>): void => {
    // Restores are not written: the ones of sync came from the storage, and adopt writes its own.
    // A change that is no longer the memory, because a listener committed another one during its
    // delivery, is not written either: the later change, already queued, carries the memory.
    if (source !== 'decision' || snapshot !== consent.getSnapshot()) return;
    // A decision made on the manager itself skips the sync of the actions: with the saved record
    // changed or unreadable, writing the memory could write back a grant revoked in another tab.
    // The memory is marked as unverified, so that the next successful read adopts the saved record.
    if (isCurrent()) save(JSON.stringify(snapshot.record));
    else {
      removeSaved();
      unverified = true;
    }
  };

  if (inBrowser) {
    unsubscribe = consent.subscribe(onChange);
    if (crossTab) {
      tabs = linkTabs(follow, name, adoptSaved);
    }
    adoptSaved();
  }

  const sync = (): void => {
    assertAlive();
    if (inBrowser) adoptSaved();
  };

  return Object.freeze({
    decide: (choices: ConsentChoices<P>): void => {
      sync();
      consent.decide(choices);
    },
    grantAll: (): void => {
      sync();
      consent.grantAll();
    },
    denyAll: (): void => {
      sync();
      consent.denyAll();
    },
    adopt: (record: unknown): void => {
      assertAlive();
      consent.restore(record);
      if (inBrowser) save(JSON.stringify(consent.getSnapshot().record));
    },
    sync,
    isPersisted: (): boolean => {
      assertAlive();
      return (
        !unknown && (lastSeen === null || lastSeen === JSON.stringify(consent.getSnapshot().record))
      );
    },
    destroy: (): void => {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      tabs?.stop();
    },
  });
}
