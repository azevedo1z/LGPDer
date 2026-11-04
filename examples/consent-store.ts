/**
 * LGPDer persistence recipe: connects a manager to a synchronous browser storage, such as
 * `window.localStorage` or a cookie.
 *
 * This file is application code and is not part of the published package. It is tested in the
 * repository and reproduced verbatim in `docs/persistencia.md`.
 */
import type { ConsentChoices, ConsentManager } from 'lgpder';

/**
 * Synchronous storage of the serialized record. The three methods may throw. `read` returns the
 * written text without transforming it: the recipe confirms each write by reading it back, because
 * some storages, such as the cookie, discard the write without throwing.
 */
export interface RecordStore {
  /** Returns the saved text, exactly as it was written, or `null` when there is no record. */
  read(): string | null;
  /** Replaces the saved text. */
  write(value: string): void;
  /** Removes the saved text. */
  remove(): void;
}

/** Actions that the application uses instead of `restore`, `decide`, `grantAll` and `denyAll`. */
export interface StoredConsent<P extends string> {
  /** Adopts the saved record, if it changed since the last read or write of this page. */
  readonly sync: () => void;
  /** Adopts an external record, such as the one of the application backend, and writes it. */
  readonly adopt: (record: unknown) => void;
  /** Adopts the saved record and then calls `decide`. */
  readonly decide: (choices: ConsentChoices<P>) => void;
  /** Adopts the saved record and then calls `grantAll`. */
  readonly grantAll: () => void;
  /** Adopts the saved record and then calls `denyAll`. */
  readonly denyAll: () => void;
}

/**
 * Adopts the saved record, writes each decision recorded in this page and, before each new
 * decision, adopts the most recent record. This way, an outdated page never writes back as granted
 * a purpose revoked in another tab. Each write is confirmed by reading it back; if it is not
 * confirmed, or if the read before the decision failed, the saved record is removed, so that it is
 * never more permissive than the page.
 */
export function connectStore<P extends string>(
  consent: ConsentManager<P>,
  store: RecordStore,
): StoredConsent<P> {
  // Last text read or written by this page.
  let lastSeen: string | null | undefined;
  // If the last read failed, the memory may be outdated in relation to the saved record.
  let readFailed = false;

  const sync = (): void => {
    let saved: string | null;
    try {
      saved = store.read();
    } catch {
      readFailed = true;
      return; // read unavailable: the state in memory still holds
    }
    readFailed = false;
    if (saved === lastSeen) return; // nothing new since the last read or write
    lastSeen = saved;
    consent.restore(saved);
  };

  // Without the write, the saved record could become more permissive than this page (for example,
  // keeping a grant already revoked): that is why it is removed.
  const removeSaved = (): void => {
    try {
      store.remove();
      lastSeen = store.read(); // if the removal was discarded, what is left is not adopted again
    } catch {
      // Storage unreachable: lastSeen does not change, so what is left is not adopted again.
    }
  };

  const save = (serialized: string): void => {
    try {
      store.write(serialized);
      // Some storages, such as the cookie, discard the write without throwing: confirm by reading.
      if (store.read() === serialized) {
        lastSeen = serialized;
        return;
      }
    } catch {
      // write or read unavailable: go on to the removal
    }
    removeSaved();
  };

  consent.subscribe(({ source, snapshot }) => {
    // Restores are not written here: the ones of sync came from the storage, and adopt writes the
    // ones made by the application.
    if (source !== 'decision') return;
    // With the previous read failed, the memory may be outdated: writing it could write back a
    // grant revoked in another tab. After the removal, the memory is marked as unchecked, so that
    // the next successful read adopts the saved record.
    if (readFailed) {
      removeSaved();
      lastSeen = undefined;
    } else save(JSON.stringify(snapshot.record));
  });

  sync();

  return Object.freeze({
    sync,
    adopt: (record: unknown): void => {
      consent.restore(record);
      save(JSON.stringify(consent.getSnapshot().record));
    },
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
  });
}
