import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { connectStore, type StoredConsent } from '../examples/consent-store.ts';
import { createMemoryStore } from './support/memory-store.ts';
import { decisionOf, recordOf, serialized } from './support/records.ts';
import { setup, type PurposeId } from './support/setup.ts';

describe('ambiente do servidor', () => {
  it('sem window, como no servidor, o core cria, decide e lê normalmente', () => {
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
   * Conta as leituras do global `name` durante `act`. O global pode nem existir no Node, como
   * `window`; ao final, o descritor original é restaurado.
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

  /** Percorre as operações do core: hidratação, inscrição, decisões, lotes e restauração. */
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
   * Globais que o core nunca lê: APIs de navegador e de Node, timers, logs, geração de
   * identificadores e avaliação de código.
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
    it(`o core nunca lê o global ${name}`, () => {
      const reads = countGlobalReads(name, exerciseCore);

      assert.equal(reads, 0);
    });
  }
});

/** Ação de decisão da receita, chamada pela interface no lugar da ação do gerenciador. */
interface RecipeAction {
  readonly action: string;
  readonly act: (actions: StoredConsent<PurposeId>) => void;
  /** Registro que a ação grava a partir do estado inicial, sem decisões. */
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

/** Duas abas ligadas ao mesmo armazenamento: A concede o que grantAll alcança e B sincroniza. */
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

/** Depois da sincronização, A revoga analytics, e B, sem receber evento, fica desatualizada. */
function staleTabB() {
  const tabs = syncedTabs();
  tabs.actionsA.decide({ analytics: 'denied' });
  tabs.tabB.changes.length = 0; // a sincronização de B já registrou um 'restore'
  return tabs;
}

describe('duas abas ligadas pela receita ao mesmo armazenamento', () => {
  it('B passa a ver as concessões de A ao sincronizar', () => {
    const { tabB } = syncedTabs();

    assert.deepStrictEqual(tabB.consent.getSnapshot().status, {
      analytics: 'granted',
      ads: 'granted',
      health: 'pending',
    });
  });

  it('o registro salvo mantém a revogação de A e recebe a recusa de B', () => {
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

  it('B passa a ver analytics recusada', () => {
    const { tabB, actionsB } = staleTabB();

    actionsB.decide({ ads: 'denied' });

    assert.equal(tabB.consent.getSnapshot().status.analytics, 'denied');
  });

  for (const { action, act } of RECIPE_ACTIONS) {
    it(`${action} da receita em B adota o registro salvo antes de decidir: origens restore e decision`, () => {
      const { tabB, actionsB } = staleTabB();

      act(actionsB);

      assert.deepStrictEqual(
        tabB.changes.map(({ source }) => source),
        ['restore', 'decision'],
      );
    });
  }
});

describe('garantias da receita: leitura e gravação do registro', () => {
  it('conectar adota o registro salvo', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();

    connectStore(consent, store);

    assert.equal(consent.getSnapshot().status.ads, 'granted');
  });

  it('conectar não gera notificação de decisão nem gravação', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent, changes } = setup();

    connectStore(consent, store);

    assert.deepStrictEqual(
      changes.map(({ source }) => source),
      ['restore'],
    );
    assert.equal(store.writes, 0);
  });

  it('restaurações nunca gravam, nem por sync nem por restore direto', () => {
    const store = createMemoryStore();
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.value = serialized({ ads: decisionOf('granted') });

    actions.sync();
    consent.restore(serialized({ ads: decisionOf('denied') }));

    assert.equal(store.writes, 0);
  });

  for (const { action, act, saved } of RECIPE_ACTIONS) {
    it(`${action} da receita grava o registro resultante`, () => {
      const store = createMemoryStore();
      const { consent } = setup();
      const actions = connectStore(consent, store);

      act(actions);

      assert.equal(store.value, saved);
    });
  }

  it('cada decisão grava o registro completo, e não só a finalidade alterada', () => {
    const analytics = decisionOf('granted', { version: '2026-10' });
    const store = createMemoryStore(serialized({ analytics }));
    const { consent } = setup();
    const actions = connectStore(consent, store);

    actions.decide({ ads: 'denied' });

    assert.equal(store.value, serialized({ analytics, ads: decisionOf('denied') }));
  });

  it('sync com o valor salvo inalterado não notifica', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent, changes } = setup();
    const actions = connectStore(consent, store);
    const notified = changes.length;

    actions.sync();

    assert.equal(changes.length, notified);
  });

  it('depois de uma gravação desta página, sync adota a remoção do registro feita por outra aba', () => {
    const store = createMemoryStore();
    const { consent } = setup();
    const actions = connectStore(consent, store);
    actions.decide({ ads: 'granted' });
    store.value = null; // outra aba removeu o registro depois de uma gravação que falhou

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('registro salvo inválido resulta em todas as finalidades pending, sem erro', () => {
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

describe('falhas do armazenamento', () => {
  it('gravação que falha remove o registro salvo e mantém a decisão em memória', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.failWrite = true;

    actions.decide({ ads: 'denied' });

    assert.equal(store.value, null);
    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('a sincronização seguinte a uma gravação que falhou não apaga as decisões da página', () => {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.failWrite = true;
    actions.decide({ ads: 'denied' });
    store.failWrite = false;

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('se a remoção também falha, a decisão vale só nesta página, sem erro', () => {
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

  it('leitura que falha mantém o estado em memória', () => {
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

describe('gravação descartada sem exceção, como a de um cookie recusado', () => {
  /** Conecta ao registro que concede ads e a revoga pela receita, com a gravação descartada. */
  function revokeWithDiscardedWrite({ discardRemove }: { readonly discardRemove: boolean }) {
    const store = createMemoryStore(serialized({ ads: decisionOf('granted') }));
    const { consent } = setup();
    const actions = connectStore(consent, store);
    store.discardWrite = true;
    store.discardRemove = discardRemove;
    actions.decide({ ads: 'denied' });
    return { store, consent, actions };
  }

  it('a gravação não se confirma pela leitura, e o registro salvo, mais permissivo, é removido', () => {
    const { store } = revokeWithDiscardedWrite({ discardRemove: false });

    assert.equal(store.value, null);
  });

  it('a sincronização seguinte não desfaz a revogação', () => {
    const { consent, actions } = revokeWithDiscardedWrite({ discardRemove: false });

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('com a remoção também descartada, a sincronização não readota o registro que restou', () => {
    const { consent, actions } = revokeWithDiscardedWrite({ discardRemove: true });

    actions.sync();

    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });
});

describe('leitura que falha antes de uma decisão em aba desatualizada', () => {
  /** B, desatualizada, recusa ads pela receita, e só a leitura do sync anterior à decisão falha. */
  function decideInStaleTabWithFailedRead() {
    const tabs = staleTabB();
    tabs.store.failNextRead = true;
    tabs.actionsB.decide({ ads: 'denied' });
    return tabs;
  }

  it('B não grava a memória, que pode estar desatualizada: o registro salvo é removido', () => {
    const { store } = decideInStaleTabWithFailedRead();

    assert.equal(store.value, null);
  });

  it('A fica com analytics pending ao sincronizar, sem readotar a concessão que revogou', () => {
    const { tabA, actionsA } = decideInStaleTabWithFailedRead();

    actionsA.sync();

    assert.equal(tabA.consent.getSnapshot().status.analytics, 'pending');
  });

  it('B mantém em memória a decisão registrada', () => {
    const { tabB } = decideInStaleTabWithFailedRead();

    assert.equal(tabB.consent.getSnapshot().status.ads, 'denied');
  });

  it('com a leitura de volta, B adota a remoção antes de decidir e não regrava a memória desatualizada', () => {
    const { store, actionsB } = decideInStaleTabWithFailedRead();

    actionsB.decide({ analytics: 'denied' });

    assert.equal(
      store.value,
      serialized({ analytics: decisionOf('denied', { version: '2026-10' }) }),
    );
  });

  it('com a leitura indisponível também depois da remoção, a sincronização seguinte adota a remoção', () => {
    const { store, tabB, actionsB } = staleTabB();
    store.failRead = true;
    actionsB.decide({ ads: 'denied' });
    store.failRead = false;

    actionsB.sync();

    assert.equal(tabB.consent.getSnapshot().status.ads, 'pending');
  });
});

describe('registro externo adotado pela aplicação com adopt', () => {
  /** Registro carregado do backend da aplicação, que revoga analytics. */
  const BACKEND_RECORD = serialized({ analytics: decisionOf('denied', { version: '2026-10' }) });

  it('adopt substitui as decisões em memória pelas do registro externo', () => {
    const { tabA, actionsA } = syncedTabs();

    actionsA.adopt(BACKEND_RECORD);

    assert.deepStrictEqual(tabA.consent.getSnapshot().status, {
      analytics: 'denied',
      ads: 'pending',
      health: 'pending',
    });
  });

  it('adopt grava o registro adotado no armazenamento', () => {
    const { store, actionsA } = syncedTabs();

    actionsA.adopt(BACKEND_RECORD);

    assert.equal(store.value, BACKEND_RECORD);
  });

  it('a outra aba recebe o registro adotado ao sincronizar', () => {
    const { tabB, actionsA, actionsB } = syncedTabs();

    actionsA.adopt(BACKEND_RECORD);
    actionsB.sync();

    assert.equal(tabB.consent.getSnapshot().status.analytics, 'denied');
  });
});

describe('docs/persistencia.md reproduz a receita literalmente', () => {
  /** Conteúdo do primeiro bloco de código TypeScript depois do título `heading` no guia. */
  function guideBlockAfter(heading: string): string | undefined {
    const guide = readFileSync(new URL('../docs/persistencia.md', import.meta.url), 'utf8');
    const start = guide.indexOf(heading);
    if (start === -1) return undefined;
    return /```ts\r?\n([\s\S]*?)```/.exec(guide.slice(start))?.[1];
  }

  it('o bloco da seção "Receita (consent-store.ts)" é idêntico a examples/consent-store.ts', () => {
    const recipe = readFileSync(new URL('../examples/consent-store.ts', import.meta.url), 'utf8');

    assert.equal(guideBlockAfter('## Receita (`consent-store.ts`)'), recipe);
  });
});
