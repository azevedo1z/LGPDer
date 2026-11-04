/**
 * Receita de persistência do LGPDer: liga um gerenciador a um armazenamento síncrono do
 * navegador, como `window.localStorage` ou um cookie.
 *
 * Este arquivo é código da aplicação e não faz parte do pacote publicado. Ele é testado no
 * repositório e reproduzido literalmente em `docs/persistencia.md`.
 */
import type { ConsentChoices, ConsentManager } from 'lgpder';

/**
 * Armazenamento síncrono do registro serializado. Os três métodos podem lançar exceções. `read`
 * devolve o texto gravado sem transformá-lo: a receita confirma cada gravação pela leitura, porque
 * alguns armazenamentos, como o cookie, descartam a gravação sem lançar.
 */
export interface RecordStore {
  /** Devolve o texto salvo, exatamente como foi gravado, ou `null` quando não há registro. */
  read(): string | null;
  /** Substitui o texto salvo. */
  write(value: string): void;
  /** Remove o texto salvo. */
  remove(): void;
}

/** Ações que a aplicação usa no lugar de `restore`, `decide`, `grantAll` e `denyAll`. */
export interface StoredConsent<P extends string> {
  /** Adota o registro salvo, se ele mudou desde a última leitura ou gravação desta página. */
  readonly sync: () => void;
  /** Adota um registro externo, como o do backend da aplicação, e o grava no armazenamento. */
  readonly adopt: (record: unknown) => void;
  /** Adota o registro salvo e então chama `decide`. */
  readonly decide: (choices: ConsentChoices<P>) => void;
  /** Adota o registro salvo e então chama `grantAll`. */
  readonly grantAll: () => void;
  /** Adota o registro salvo e então chama `denyAll`. */
  readonly denyAll: () => void;
}

/**
 * Adota o registro salvo, grava cada decisão registrada nesta página e, antes de cada nova
 * decisão, adota o registro mais recente. Assim, uma página desatualizada nunca regrava como
 * concedida uma finalidade revogada em outra aba. Cada gravação é confirmada pela leitura; se ela
 * não se confirma, ou se a leitura anterior à decisão falhou, o registro salvo é removido, para
 * nunca ficar mais permissivo que a página.
 */
export function connectStore<P extends string>(
  consent: ConsentManager<P>,
  store: RecordStore,
): StoredConsent<P> {
  // Último texto lido ou gravado por esta página.
  let lastSeen: string | null | undefined;
  // Se a última leitura falhou, a memória pode estar desatualizada em relação ao registro salvo.
  let readFailed = false;

  const sync = (): void => {
    let saved: string | null;
    try {
      saved = store.read();
    } catch {
      readFailed = true;
      return; // leitura indisponível: o estado em memória continua valendo
    }
    readFailed = false;
    if (saved === lastSeen) return; // nada novo desde a última leitura ou gravação
    lastSeen = saved;
    consent.restore(saved);
  };

  // Sem a gravação, o registro salvo poderia ficar mais permissivo que esta página (por exemplo,
  // mantendo uma concessão já revogada): por isso ele é removido.
  const removeSaved = (): void => {
    try {
      store.remove();
      lastSeen = store.read(); // se a remoção foi descartada, o que restou não é readotado
    } catch {
      // Armazenamento inacessível: lastSeen não muda, então o que restou não é readotado.
    }
  };

  const save = (serialized: string): void => {
    try {
      store.write(serialized);
      // Alguns armazenamentos, como o cookie, descartam a gravação sem lançar: confirme lendo.
      if (store.read() === serialized) {
        lastSeen = serialized;
        return;
      }
    } catch {
      // gravação ou leitura indisponível: segue para a remoção
    }
    removeSaved();
  };

  consent.subscribe(({ source, snapshot }) => {
    // Restaurações não são gravadas aqui: as do sync vieram do armazenamento, e adopt grava as
    // feitas pela aplicação.
    if (source !== 'decision') return;
    // Com a leitura anterior falha, a memória pode estar desatualizada: gravá-la poderia regravar
    // uma concessão revogada em outra aba. Depois da remoção, a memória fica como não conferida,
    // para que a próxima leitura bem-sucedida adote o registro salvo.
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
