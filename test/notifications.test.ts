import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import type { ConsentChange, ConsentManager, ConsentStatus } from 'lgpder';

import { decisionOf, recordOf } from './support/records.ts';
import { callUntyped, setup, type PurposeId } from './support/setup.ts';

/** `analytics` e `ads` concedidas: tudo o que `grantAll` alcança na fixture. */
const ELIGIBLE_GRANTED = recordOf({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('granted'),
});

/** Todas as finalidades da fixture recusadas. */
const ALL_DENIED = recordOf({
  analytics: decisionOf('denied', { version: '2026-10' }),
  ads: decisionOf('denied'),
  health: decisionOf('denied', { version: '1' }),
});

describe('inscrição e cancelamento', () => {
  it('subscribe devolve a função que cancela a inscrição', () => {
    const { consent } = setup();
    const received: ConsentChange<PurposeId>[] = [];
    const unsubscribe = consent.subscribe((change) => {
      received.push(change);
    });

    unsubscribe();
    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(received, []);
  });

  it('subscribe com valor que não é função lança TypeError', () => {
    const { consent } = setup();

    assert.throws(() => callUntyped(consent.subscribe, 'x'), TypeError);
  });

  it('a mesma função inscrita duas vezes é chamada duas vezes por notificação', () => {
    const { consent } = setup();
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    consent.subscribe(listener);
    consent.subscribe(listener);

    consent.decide({ ads: 'granted' });

    assert.equal(calls, 2);
  });

  it('cancelar duas vezes a mesma inscrição remove só ela', () => {
    const { consent } = setup();
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    const cancelFirst = consent.subscribe(listener);
    consent.subscribe(listener);

    cancelFirst();
    cancelFirst();
    consent.decide({ ads: 'granted' });

    assert.equal(calls, 1);
  });
});

describe('há notificação se e somente se o registro muda', () => {
  it('criação e hidratação não notificam, nem depois de uma volta do laço de eventos', async () => {
    const { changes } = setup({ record: ELIGIBLE_GRANTED });

    await setImmediate();

    assert.deepStrictEqual(changes, []);
  });

  interface SilentOperation {
    readonly operation: string;
    readonly record: unknown;
    readonly act: (consent: ConsentManager<PurposeId>) => void;
  }

  const SILENT_OPERATIONS = [
    {
      operation: 'decide({})',
      record: undefined,
      act: (consent) => {
        consent.decide({});
      },
    },
    {
      operation: 'decide que reconfirma a situação vigente',
      record: ELIGIBLE_GRANTED,
      act: (consent) => {
        consent.decide({ ads: 'granted' });
      },
    },
    {
      operation: 'grantAll sem finalidade elegível a mudar',
      record: ELIGIBLE_GRANTED,
      act: (consent) => {
        consent.grantAll();
      },
    },
    {
      operation: 'denyAll sem finalidade a mudar',
      record: ALL_DENIED,
      act: (consent) => {
        consent.denyAll();
      },
    },
    {
      operation: 'restore do registro atual',
      record: ELIGIBLE_GRANTED,
      act: (consent) => {
        consent.restore(consent.getSnapshot().record);
      },
    },
  ] as const satisfies readonly SilentOperation[];

  for (const { operation, record, act } of SILENT_OPERATIONS) {
    it(`${operation} não notifica`, () => {
      const { consent, changes } = setup({ record });

      act(consent);

      assert.deepStrictEqual(changes, []);
    });
  }
});

describe('formato da notificação', () => {
  it('tem as chaves source, changed, snapshot e previous, nessa ordem', () => {
    const { consent, changes } = setup();

    consent.decide({ ads: 'granted' });

    const [change] = changes;
    assert.ok(change);
    assert.deepStrictEqual(Object.keys(change), ['source', 'changed', 'snapshot', 'previous']);
  });

  it('snapshot é o estado confirmado pela alteração', () => {
    const { consent, changes } = setup();

    consent.decide({ ads: 'granted' });

    const [change] = changes;
    assert.ok(change);
    assert.equal(change.snapshot, consent.getSnapshot());
  });

  it('previous é o snapshot imediatamente anterior à alteração', () => {
    const { consent, changes } = setup();
    consent.decide({ analytics: 'granted' });
    const before = consent.getSnapshot();

    consent.decide({ ads: 'granted' });

    const [, change] = changes;
    assert.ok(change);
    assert.equal(change.previous, before);
  });
});

describe('ordem de uma operação efetiva', () => {
  it('os ouvintes são chamados na ordem de inscrição', () => {
    const { consent } = setup();
    const order: string[] = [];
    consent.subscribe(() => {
      order.push('primeiro');
    });
    consent.subscribe(() => {
      order.push('segundo');
    });
    consent.subscribe(() => {
      order.push('terceiro');
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(order, ['primeiro', 'segundo', 'terceiro']);
  });

  it('durante a notificação, getSnapshot já devolve o snapshot confirmado', () => {
    const { consent } = setup();
    let seen: ConsentStatus | undefined;
    consent.subscribe(() => {
      seen = consent.getSnapshot().status.ads;
    });

    consent.decide({ ads: 'granted' });

    assert.equal(seen, 'granted');
  });

  it('a notificação é entregue de forma síncrona, antes de a chamada retornar', () => {
    const { consent, changes } = setup();

    consent.decide({ ads: 'granted' });

    assert.equal(changes.length, 1);
  });

  it('fora de ouvintes, a chamada só retorna depois de entregar também as notificações enfileiradas', () => {
    const { consent, changes } = setup();
    consent.subscribe(({ changed }) => {
      if (changed.includes('analytics')) consent.decide({ ads: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['analytics'], ['ads']],
    );
  });
});

describe('erro de ouvinte', () => {
  /** Troca o queueMicrotask global por um coletor, para que o erro relançado não encerre o teste. */
  function captureMicrotasks(t: TestContext): (() => void)[] {
    const scheduled: (() => void)[] = [];
    t.mock.method(globalThis, 'queueMicrotask', (callback: () => void) => {
      scheduled.push(callback);
    });
    return scheduled;
  }

  it('os ouvintes seguintes são chamados e a operação retorna normalmente', (t) => {
    captureMicrotasks(t);
    const { consent } = setup();
    const calls: string[] = [];
    consent.subscribe(() => {
      throw new Error('ouvinte com defeito');
    });
    consent.subscribe(() => {
      calls.push('seguinte');
    });

    assert.doesNotThrow(() => {
      consent.decide({ ads: 'granted' });
    });

    assert.deepStrictEqual(calls, ['seguinte']);
  });

  it('agenda, pelo queueMicrotask global vigente, trocado depois da importação, uma microtarefa por erro, no momento do erro', (t) => {
    const log: string[] = [];
    t.mock.method(globalThis, 'queueMicrotask', () => {
      log.push('microtarefa agendada');
    });
    const { consent } = setup();
    consent.subscribe(() => {
      log.push('primeiro ouvinte');
      throw new Error('primeiro defeito');
    });
    consent.subscribe(() => {
      log.push('segundo ouvinte');
      throw new Error('segundo defeito');
    });
    consent.subscribe(() => {
      log.push('terceiro ouvinte');
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, [
      'primeiro ouvinte',
      'microtarefa agendada',
      'segundo ouvinte',
      'microtarefa agendada',
      'terceiro ouvinte',
    ]);
  });

  it('a microtarefa agendada relança intacto o valor lançado pelo ouvinte', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('ouvinte com defeito');
    const { consent } = setup();
    consent.subscribe(() => {
      throw failure;
    });

    consent.decide({ ads: 'granted' });

    const [rethrow] = scheduled;
    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === failure);
  });
});

describe('reentrância', () => {
  it('decide chamado dentro de um ouvinte é confirmado na hora', () => {
    const { consent } = setup();
    let statusInsideListener: ConsentStatus | undefined;
    consent.subscribe(({ changed }) => {
      if (!changed.includes('analytics')) return;
      consent.decide({ ads: 'denied' });
      statusInsideListener = consent.getSnapshot().status.ads;
    });

    consent.decide({ analytics: 'granted' });

    assert.equal(statusInsideListener, 'denied');
  });

  it('a chamada reentrante retorna antes de sua notificação, entregue depois da atual a todos, na mesma ordem', () => {
    const { consent } = setup();
    const log: string[] = [];
    consent.subscribe(({ changed }) => {
      log.push(`primeiro ouvinte: ${changed.join()}`);
      if (!changed.includes('analytics')) return;
      consent.decide({ ads: 'denied' });
      log.push('decide reentrante retornou');
    });
    consent.subscribe(({ changed }) => {
      log.push(`segundo ouvinte: ${changed.join()}`);
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(log, [
      'primeiro ouvinte: analytics',
      'decide reentrante retornou',
      'segundo ouvinte: analytics',
      'primeiro ouvinte: ads',
      'segundo ouvinte: ads',
    ]);
  });

  it('o previous de cada notificação é o snapshot da notificação anterior', () => {
    const { consent, changes } = setup();
    consent.subscribe(({ changed }) => {
      if (changed.includes('analytics')) consent.decide({ ads: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    const [first, second] = changes;
    assert.ok(first && second);
    assert.equal(second.previous, first.snapshot);
  });

  it('duas chamadas reentrantes no mesmo ouvinte são entregues na ordem de confirmação (FIFO)', () => {
    const { consent, changes } = setup();
    consent.subscribe(({ changed }) => {
      if (!changed.includes('analytics')) return;
      consent.decide({ ads: 'granted' });
      consent.decide({ health: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(
      changes.map(({ changed }) => changed),
      [['analytics'], ['ads'], ['health']],
    );
  });

  it('restore chamado dentro de um ouvinte é confirmado na hora', () => {
    const { consent } = setup();
    let statusInsideListener: ConsentStatus | undefined;
    consent.subscribe(({ source }) => {
      if (source !== 'decision') return;
      consent.restore(null);
      statusInsideListener = consent.getSnapshot().status.ads;
    });

    consent.decide({ ads: 'granted' });

    assert.equal(statusInsideListener, 'pending');
  });

  it('restore chamado dentro de um ouvinte é notificado depois da notificação atual', () => {
    const { consent } = setup();
    const sources: string[] = [];
    consent.subscribe(({ source }) => {
      if (source === 'decision') consent.restore(null);
    });
    consent.subscribe(({ source }) => {
      sources.push(source);
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(sources, ['decision', 'restore']);
  });
});

describe('cancelamento durante a entrega', () => {
  it('ouvinte cancelado por outro durante a entrega não recebe nem a notificação atual', () => {
    const { consent } = setup();
    const received: string[] = [];
    consent.subscribe(() => {
      cancelSecond();
    });
    const cancelSecond = consent.subscribe(() => {
      received.push('segundo');
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(received, []);
  });

  it('ouvinte que cancela a si mesmo não recebe as notificações já enfileiradas', () => {
    const { consent } = setup();
    const received: string[] = [];
    const unsubscribe = consent.subscribe(({ changed }) => {
      received.push(changed.join());
      unsubscribe();
      consent.decide({ ads: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(received, ['analytics']);
  });
});

describe('inscrição durante a entrega', () => {
  it('recebe só as alterações confirmadas depois dela', () => {
    const { consent } = setup();
    const late: string[] = [];
    consent.subscribe(({ changed }) => {
      if (!changed.includes('analytics')) return;
      consent.decide({ ads: 'granted' });
      consent.subscribe((change) => {
        late.push(change.changed.join());
      });
      consent.decide({ health: 'denied' });
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(late, ['health']);
  });
});

describe('sem limite de cascata', () => {
  it('alterações encadeadas por um ouvinte são todas entregues', () => {
    const { consent, changes } = setup();
    consent.subscribe(({ snapshot }) => {
      if (changes.length >= 1_000) return;
      consent.decide({ ads: snapshot.status.ads === 'granted' ? 'denied' : 'granted' });
    });

    consent.decide({ ads: 'granted' });

    assert.equal(changes.length, 1_000);
  });
});

describe('argumento e retorno do ouvinte', () => {
  it('o ouvinte é chamado sem this', () => {
    const { consent } = setup();
    const receivers: unknown[] = [];
    consent.subscribe(function (this: unknown) {
      receivers.push(this);
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(receivers, [undefined]);
  });

  it('o ouvinte recebe a notificação como único argumento', () => {
    const { consent } = setup();
    const argumentCounts: number[] = [];
    consent.subscribe((...args: unknown[]) => {
      argumentCounts.push(args.length);
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(argumentCounts, [1]);
  });

  it('o valor devolvido é ignorado: devolver false não interrompe os ouvintes seguintes', () => {
    const { consent } = setup();
    const calls: string[] = [];
    consent.subscribe(() => false);
    consent.subscribe(() => {
      calls.push('seguinte');
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(calls, ['seguinte']);
  });

  it('ouvinte sem parâmetros, como o callback do useSyncExternalStore, funciona', () => {
    const { consent } = setup();
    let storeChanges = 0;
    const onStoreChange = (): void => {
      storeChanges += 1;
    };
    const unsubscribe = consent.subscribe(onStoreChange);

    consent.decide({ ads: 'granted' });
    unsubscribe();
    consent.decide({ ads: 'denied' });

    assert.equal(storeChanges, 1);
  });
});
