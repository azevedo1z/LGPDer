# Persistência e sincronização entre abas

O núcleo não lê nem grava armazenamento. A entrada é `options.record` (hidratação, na criação) e `restore()`; a saída é `snapshot.record` e as notificações. Assim ele funciona com qualquer armazenamento, é seguro em SSR e não grava por padrão em um mecanismo enviado automaticamente ao servidor, como o cookie, sem escolha explícita da aplicação. As funções do gerenciador estão na [referência da API](api.md).

A receita oficial de persistência, `examples/consent-store.ts`, é código da aplicação: é testada no repositório do LGPDer, reproduzida abaixo e não faz parte do código do pacote publicado.

## Receita (`consent-store.ts`)

```ts
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

Variante da ligação com `localStorage`: `cookieStore` substitui `localStore`, e as duas últimas declarações substituem `consent` e `actions`. Com cookie, o registro vai ao servidor em toda requisição, e um instante em milissegundos, valor persistente de alta entropia, poderia singularizar o navegador e funcionar como pseudoidentificador; por isso o gerenciador usa relógio arredondado ao dia. Os ouvintes de `pageshow` e `visibilitychange` continuam úteis; o evento `storage` não dispara para cookies.

```ts
// __Host-: o navegador só aceita o cookie com Secure, Path=/ e sem Domain, o que impede que outro
// host do mesmo domínio ou um caminho mais específico grave um cookie de mesmo nome.
const COOKIE = '__Host-lgpder';
const MAX_AGE = 60 * 60 * 24 * 180; // prazo definido pela aplicação
const DAY = 24 * 60 * 60 * 1000; // um dia em milissegundos

// Atenção: com cookie, o registro é enviado ao servidor em toda requisição ao domínio.
export const cookieStore: RecordStore = {
  read: () => {
    const prefix = `${COOKIE}=`;
    const entry = document.cookie.split('; ').find((item) => item.startsWith(prefix));
    return entry === undefined ? null : decodeURIComponent(entry.slice(prefix.length));
  },
  write: (value) => {
    document.cookie = `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${String(MAX_AGE)}; SameSite=Lax; Secure`;
  },
  remove: () => {
    document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  },
};

// Instante arredondado ao dia: em milissegundos, enviado em toda requisição, ele poderia
// singularizar o navegador.
export const consent = createConsentManager({
  purposes: PURPOSES,
  now: () => Math.floor(Date.now() / DAY) * DAY,
});
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
- Prazo: no armazenamento, o registro dura conforme a política da aplicação, por exemplo o `Max-Age` do cookie. O `localStorage` não tem validade própria, mas o navegador pode apagá-lo: o Safari apaga o armazenamento gravado por script após 7 dias de uso sem interação com o site e limita a 7 dias a validade de cookies gravados por script. Nesses casos, as finalidades voltam a `'pending'`.
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
