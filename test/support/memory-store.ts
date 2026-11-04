/** Armazenamento em memória para testar a receita de persistência. */
import type { RecordStore } from '../../examples/consent-store.ts';

/** `RecordStore` em memória, com falha simulável em cada método. */
export interface MemoryStore extends RecordStore {
  /** Texto salvo; `null` quando não há registro. */
  value: string | null;
  /** Faz `read` lançar, como um `SecurityError` do navegador. */
  failRead: boolean;
  /** Faz somente a próxima chamada de `read` lançar, como uma falha passageira. */
  failNextRead: boolean;
  /** Faz `write` lançar, como uma cota excedida. */
  failWrite: boolean;
  /** Faz `remove` lançar. */
  failRemove: boolean;
  /** Faz `write` descartar a gravação sem lançar, como o navegador faz com um cookie recusado. */
  discardWrite: boolean;
  /** Faz `remove` descartar a remoção sem lançar. */
  discardRemove: boolean;
  /** Quantidade de gravações concluídas por `write`. */
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
        throw new Error('leitura indisponível');
      }
      if (store.failRead) throw new Error('leitura indisponível');
      return store.value;
    },
    write: (value) => {
      if (store.failWrite) throw new Error('cota excedida');
      if (store.discardWrite) return;
      store.value = value;
      store.writes += 1;
    },
    remove: () => {
      if (store.failRemove) throw new Error('remoção indisponível');
      if (store.discardRemove) return;
      store.value = null;
    },
  };
  return store;
}
