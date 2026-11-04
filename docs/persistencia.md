# Persistência e sincronização entre abas

O núcleo não lê nem grava armazenamento. A entrada é `options.record` (hidratação, na criação) e `restore()`; a saída é `snapshot.record` e as notificações. Assim ele funciona com qualquer armazenamento, é seguro em SSR e não grava por padrão em um mecanismo enviado automaticamente ao servidor, como o cookie, sem escolha explícita da aplicação. As funções do gerenciador estão na [referência da API](api.md).

A receita abaixo foi promovida a código do pacote: use `connectStorage` de `lgpder/storage`, que mantém as garantias dela e acrescenta a sincronização entre abas, os adaptadores de `localStorage` e de cookie e a remoção do registro salvo sem decisões. A receita fica aqui só como referência até a reescrita deste guia e deixou de ser testada no repositório.

## Receita (`consent-store.ts`)

```ts
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
```

### Garantias da receita

- A página adota o registro salvo antes de cada decisão (a memória adota o que foi lido durante a mutação). Assim, uma aba desatualizada nunca regrava como concedida uma finalidade revogada em outra.
- Somente decisões locais e registros adotados com `adopt` são gravados, sempre com o registro completo.
- As restaurações do `sync` nunca gravam, e o evento `storage` só dispara em outros documentos quando o valor muda: não há laço entre abas.
- Cada gravação é confirmada pela leitura, e a gravação que falha ou não se confirma remove o registro salvo, para que ele nunca fique mais permissivo que a página. Se a remoção também não acontecer, o que restou não é readotado pela página.
- Falha de leitura mantém a memória, e a decisão seguinte a uma leitura que falhou remove o registro salvo em vez de gravar a memória, que pode estar desatualizada; na próxima leitura bem-sucedida, a página adota o registro salvo, e a decisão que não pôde ser confirmada volta a `'pending'` (falha fechada).
- Pré-condição: passe a `actions.decide` somente as finalidades que o titular alterou nesta interação, e não o estado completo de um formulário montado antes. Mantenha a interface ligada ao snapshot, que muda nas notificações de origem `'restore'`.
- `adopt` substitui o registro salvo, e as outras abas o adotam ao sincronizar: adote somente um registro externo que já reflita as últimas decisões deste navegador (por exemplo, um backend que registra cada decisão antes de responder); um registro antigo desfaz revogações salvas depois dele.

## Ligação com `localStorage`

Salve a receita como `consent-store.ts`. O import relativo usa a extensão `.js`, que o TypeScript resolve para `consent-store.ts` tanto com `moduleResolution` `node16` ou `nodenext`, que exigem extensão em imports relativos de ESM, quanto com `bundler`.

```ts
import { createConsentManager, type PurposeConfig } from 'lgpder';
import { connectStore, type RecordStore } from './consent-store.js';

type Category = 'statistics' | 'marketing' | 'health';
const TERMS = '2026-10';

export const PURPOSES = {
  analytics: { version: TERMS, category: 'statistics' },
  personalizedAds: { version: TERMS, category: 'marketing' },
  newsletter: { version: '2025-03', category: 'marketing' },
  healthReminders: { version: TERMS, category: 'health', individualGrant: true },
} as const satisfies Record<string, PurposeConfig<Category>>;

export type PurposeId = keyof typeof PURPOSES;

const KEY = 'minha-loja:consentimento';

// window.localStorage é resolvido a cada chamada: no servidor ou com armazenamento bloqueado,
// o acesso lança e a receita mantém o estado em memória.
const localStore: RecordStore = {
  read: () => window.localStorage.getItem(KEY),
  write: (value) => {
    window.localStorage.setItem(KEY, value);
  },
  remove: () => {
    window.localStorage.removeItem(KEY);
  },
};

export const consent = createConsentManager({ purposes: PURPOSES });
export const actions = connectStore(consent, localStore); // a interface usa actions.decide etc.

if (typeof window !== 'undefined') {
  // Revogação feita em outra aba chega a esta pelo evento storage.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) actions.sync();
  });
  // Página restaurada do bfcache não recebeu eventos storage enquanto estava suspensa.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) actions.sync();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') actions.sync();
  });
}
```

A interface usa `actions.decide`, `actions.grantAll` e `actions.denyAll` no lugar das funções do gerenciador, e a aplicação adota registros externos com `actions.adopt` (veja [Armazenamento assíncrono e backend](#armazenamento-assíncrono-e-backend)); `consent` continua servindo para ler o estado e inscrever ouvintes.

## Ligação com cookie

Variante da ligação com `localStorage`: `cookieStore` substitui `localStore`, e as duas últimas declarações substituem `consent` e `actions`. Com cookie, o registro vai ao servidor em toda requisição, e um instante em milissegundos, valor persistente de alta entropia, poderia singularizar o navegador e funcionar como pseudoidentificador; o relógio padrão do gerenciador já devolve o início do dia UTC, por isso a ligação não passa `now`. O `Max-Age` do cookie é o `maxAge` do gerenciador, contado a partir da última gravação. Como cada gravação reescreve o registro inteiro e cada decisão expira em `decidedAt + maxAge`, o cookie pode durar mais que as decisões mais antigas que guarda, e o descarte de uma decisão expirada na hidratação ou em `restore` não regrava o cookie. Por isso, quem lê o cookie, inclusive o servidor, deve passar o conteúdo pelo núcleo (opção `record` ou `restore`), que descarta as decisões expiradas, em vez de confiar no que está armazenado. Os ouvintes de `pageshow` e `visibilitychange` continuam úteis; o evento `storage` não dispara para cookies.

```ts
// __Host-: o navegador só aceita o cookie com Secure, Path=/ e sem Domain, o que impede que outro
// host do mesmo domínio ou um caminho mais específico grave um cookie de mesmo nome.
const COOKIE = '__Host-lgpder';

// Atenção: com cookie, o registro é enviado ao servidor em toda requisição ao domínio.
export const cookieStore: RecordStore = {
  read: () => {
    const prefix = `${COOKIE}=`;
    const entry = document.cookie.split('; ').find((item) => item.startsWith(prefix));
    return entry === undefined ? null : decodeURIComponent(entry.slice(prefix.length));
  },
  write: (value) => {
    // Max-Age em segundos, contado a partir desta gravação: decisões mais antigas expiram antes.
    const maxAge = Math.ceil(consent.maxAge / 1000);
    document.cookie = `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${String(maxAge)}; SameSite=Lax; Secure`;
  },
  remove: () => {
    document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  },
};

// O relógio padrão já arredonda o instante ao início do dia UTC.
export const consent = createConsentManager({ purposes: PURPOSES });
export const actions = connectStore(consent, cookieStore); // a interface usa actions.decide etc.
```

### Cuidados com o cookie

- O prefixo `__Host-` faz o navegador recusar o cookie sem `Secure`, com `Domain` ou com `Path` diferente de `/`, atributos que a ligação já respeita. Sem o prefixo, um cookie de mesmo nome gravado por outro host do mesmo domínio registrável (um subdomínio irmão) ou com `Path` mais específico passaria a ser o lido, e a receita o adotaria. No servidor, leia o cookie por esse mesmo nome.
- O navegador descarta, sem lançar erro, o cookie cujo nome e valor somam mais de 4096 bytes. Com `encodeURIComponent`, cada finalidade ocupa cerca de 120 bytes (id de 12 caracteres e versão `2026-10`), e mais com ids ou versões longos: o limite chega com cerca de 30 finalidades, ou cerca de 20 com versões de 64 caracteres, como um hash do conteúdo. Para configurações desse tamanho, use `localStorage`. Como a receita confirma cada gravação pela leitura, um cookie descartado não passa por salvo: a receita remove o registro anterior, e a decisão vale só na página.
- Sem o evento `storage`, a revogação feita em uma aba só chega a outra quando esta volta a ficar visível, é restaurada do bfcache ou registra uma decisão. Abas visíveis ao mesmo tempo, como janelas lado a lado, mantêm a concessão em memória e seguem com o tratamento até lá. Para avisá-las, a aplicação pode publicar uma mensagem em um `BroadcastChannel` a cada notificação de origem `'decision'` e chamar `actions.sync()` ao recebê-la, no modelo da extensão de sincronização entre abas por `BroadcastChannel` (veja [Extensões futuras](../README.md#extensões-futuras)).

## Como uma revogação chega às outras abas

- Evento `storage`, somente com Web Storage, como o `localStorage`: disparado nos outros documentos da mesma origem quando o valor salvo muda. A ligação chama `sync()`, que relê o valor atual em vez de usar `event.newValue`: o efeito é o mesmo, com um só caminho de leitura e o valor mais recente.
- Evento `pageshow` com `persisted`: uma página restaurada do bfcache não recebeu eventos `storage` enquanto estava suspensa.
- Evento `visibilitychange`: a aba volta a ficar visível.
- `sync` antes de cada decisão: `actions.decide`, `actions.grantAll` e `actions.denyAll` adotam o registro salvo antes de decidir, conforme as [garantias da receita](#garantias-da-receita).

Limites residuais: duas abas que gravam no mesmo instante podem se sobrepor, porque o Web Storage não oferece transações; a janela é de microssegundos e exige ações simultâneas do titular em duas abas. Com cookie, uma aba que continua visível só recebe a revogação mais tarde (veja os [cuidados com o cookie](#cuidados-com-o-cookie)).

## Armazenamento assíncrono e backend

A receita usa armazenamento síncrono. Com armazenamento assíncrono (IndexedDB ou o backend da aplicação), crie o gerenciador, chame `restore` quando a leitura terminar e só então habilite a interface de decisão, porque `restore` substitui decisões locais mais recentes. O mesmo vale para o registro de um usuário autenticado vindo do backend: carregue-o antes de coletar decisões. `restore` não é revogação nem nova manifestação do titular (veja [`restore(record)`](api.md#restorerecord)).

Junto com a receita, adote o registro externo com `actions.adopt(record)`, e não com `consent.restore`: a receita não grava restaurações, e `adopt` chama `restore` e grava o resultado no armazenamento, com a mesma confirmação pela leitura, para que as outras abas e as próximas cargas recebam o registro adotado.

## Ciclo de vida do registro

- Gravar: `JSON.stringify(snapshot.record)` em notificações de origem `'decision'`, como faz a receita.
- Carregar: `options.record` na criação ou `restore()` depois dela.
- Prazo: cada decisão vale por `maxAge` (padrão: 365 dias); na hidratação e em `restore`, a decisão expirada é descartada e a finalidade volta a `'pending'`. No armazenamento, o registro dura conforme a política da aplicação, por exemplo o `Max-Age` do cookie, alinhado a `consent.maxAge` na ligação com cookie. O `localStorage` não tem validade própria, mas o navegador pode apagá-lo: o Safari apaga o armazenamento gravado por script após 7 dias de uso sem interação com o site e limita a 7 dias a validade de cookies gravados por script. Nesses casos, as finalidades voltam a `'pending'`.
- Finalidades removidas da configuração somem do armazenamento na próxima gravação; finalidades novas nascem `'pending'`.
- Registro com `format` diferente de `1` (por exemplo, gravado por versão futura do pacote) é ignorado e substituído na próxima gravação.
- Um formato incompatível futuro usará `format: 2`, com leitura do formato `1`, em versão major do pacote.

## Lote por categoria e pendências

A categoria não tem operação própria: a aplicação monta o lote com `decide`, que grava uma decisão por finalidade. O exemplo usa `consent`, `actions`, `PurposeId` e `Category` da [ligação com `localStorage`](#ligação-com-localstorage) e, na concessão, deixa de fora as finalidades com `individualGrant: true`, como faz `grantAll`. As funções `pendingPurposes` e `outdatedPurposes` recebem o snapshot vigente, por exemplo `pendingPurposes(consent.getSnapshot())`, e indicam o que perguntar ao titular e quais finalidades mudaram de versão.

```ts
import type { ConsentChoices, ConsentSnapshot, DecidedStatus } from 'lgpder';

// Seguro: purposes é uma cópia congelada que contém somente as finalidades configuradas.
const purposeIds = Object.keys(consent.purposes) as PurposeId[];

export function decideCategory(category: Category, status: DecidedStatus): void {
  const choices: ConsentChoices<PurposeId> = Object.fromEntries(
    purposeIds
      .filter((id) => consent.purposes[id].category === category)
      .filter((id) => status === 'denied' || consent.purposes[id].individualGrant !== true)
      .map((id) => [id, status]),
  );
  actions.decide(choices);
}

// Recebem o snapshot vigente (de getSnapshot, do hook do React ou de uma notificação): uma lista
// calculada uma vez ficaria desatualizada depois da próxima decisão ou restauração.
export function pendingPurposes({ status }: ConsentSnapshot<PurposeId>): PurposeId[] {
  return purposeIds.filter((id) => status[id] === 'pending');
}

export function outdatedPurposes({ outdated }: ConsentSnapshot<PurposeId>): PurposeId[] {
  return purposeIds.filter((id) => outdated[id]);
}
```

## Prova do consentimento e evidências

O ônus de provar que o consentimento foi obtido conforme a LGPD é do controlador (art. 8º, § 2º), e os registros do LGPDer não constituem prova sozinhos (veja o [aviso](../README.md#aviso-o-lgpder-não-garante-conformidade-com-a-lgpd)): um registro com estrutura válida, mesmo editado pelo titular ou por um script da página, é aceito.

Para registrar evidências, envie ao backend da própria aplicação somente as decisões tomadas pelo titular nesta página, filtrando a origem `'decision'`:

```ts
consent.subscribe(({ source, changed, snapshot }) => {
  if (source !== 'decision') return; // restaurações não são nova manifestação do titular
  sendConsentEvidence(
    changed.map((purpose) => ({ purpose, ...snapshot.record.decisions[purpose] })),
  );
});
```

`sendConsentEvidence` é função da aplicação. No backend:

- registre o horário do servidor quando precisar de valor probatório, porque `decidedAt` vem do relógio do cliente, que pode estar errado ou ser alterado;
- associe o registro ao titular, quando aplicável;
- guarde o conteúdo exibido em cada versão de cada finalidade;
- defina por quanto tempo os registros são mantidos.
