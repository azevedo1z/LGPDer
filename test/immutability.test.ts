import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConsentChange, ConsentDecision, ConsentManager, ConsentSnapshot } from 'lgpder';

import { decisionOf, recordOf } from './support/records.ts';
import { START, assignUntyped, setup, type PurposeId } from './support/setup.ts';

interface PublicObjects {
  readonly consent: ConsentManager<PurposeId>;
  readonly snapshot: ConsentSnapshot<PurposeId>;
  readonly server: ConsentSnapshot<PurposeId>;
  readonly change: ConsentChange<PurposeId>;
  /** Decisão criada por `decide`. */
  readonly decided: ConsentDecision;
  /** Decisão lida do registro hidratado. */
  readonly hydrated: ConsentDecision;
}

/** Estado que alcança todos os objetos públicos: decisão hidratada, decisão nova e notificação. */
function publicObjects(): PublicObjects {
  const { consent, changes } = setup({
    record: recordOf({ health: decisionOf('denied', { version: '1' }) }),
  });
  consent.decide({ analytics: 'granted', ads: 'denied' });
  const snapshot = consent.getSnapshot();
  const [change] = changes;
  const { analytics: decided, health: hydrated } = snapshot.record.decisions;
  assert.ok(change && decided && hydrated);
  return { consent, snapshot, server: consent.getServerSnapshot(), change, decided, hydrated };
}

interface PublicObject {
  readonly name: string;
  readonly pick: (objects: PublicObjects) => unknown;
}

const PUBLIC_OBJECTS = [
  { name: 'o gerenciador', pick: ({ consent }) => consent },
  { name: 'o objeto purposes', pick: ({ consent }) => consent.purposes },
  { name: 'a configuração de analytics', pick: ({ consent }) => consent.purposes.analytics },
  { name: 'a configuração de ads', pick: ({ consent }) => consent.purposes.ads },
  { name: 'a configuração de health', pick: ({ consent }) => consent.purposes.health },
  { name: 'o snapshot', pick: ({ snapshot }) => snapshot },
  { name: 'o status do snapshot', pick: ({ snapshot }) => snapshot.status },
  { name: 'o outdated do snapshot', pick: ({ snapshot }) => snapshot.outdated },
  { name: 'o record do snapshot', pick: ({ snapshot }) => snapshot.record },
  { name: 'o record.decisions do snapshot', pick: ({ snapshot }) => snapshot.record.decisions },
  { name: 'a decisão gravada por decide', pick: ({ decided }) => decided },
  { name: 'a decisão lida do registro', pick: ({ hydrated }) => hydrated },
  { name: 'o snapshot de servidor', pick: ({ server }) => server },
  { name: 'o status do snapshot de servidor', pick: ({ server }) => server.status },
  { name: 'o outdated do snapshot de servidor', pick: ({ server }) => server.outdated },
  { name: 'o record do snapshot de servidor', pick: ({ server }) => server.record },
  {
    name: 'o record.decisions do snapshot de servidor',
    pick: ({ server }) => server.record.decisions,
  },
  { name: 'a notificação', pick: ({ change }) => change },
  { name: 'o snapshot hidratado, entregue em previous', pick: ({ change }) => change.previous },
] as const satisfies readonly PublicObject[];

describe('objetos públicos congelados', () => {
  for (const { name, pick } of PUBLIC_OBJECTS) {
    it(`Object.isFrozen é verdadeiro para ${name}`, () => {
      const value = pick(publicObjects());

      assert.equal(typeof value, 'object');
      assert.ok(Object.isFrozen(value));
    });
  }

  it('Object.isFrozen é verdadeiro para o changed da notificação', () => {
    const { change } = publicObjects();

    assert.ok(Object.isFrozen(change.changed));
  });
});

describe('referência do snapshot', () => {
  it('getSnapshot devolve a mesma referência enquanto não há alteração confirmada', () => {
    const { consent } = setup();
    consent.decide({ ads: 'granted' });
    const snapshot = consent.getSnapshot();

    consent.decide({ ads: 'granted' });
    consent.restore(snapshot.record);

    assert.equal(consent.getSnapshot(), snapshot);
  });

  it('voltar a um estado anterior produz snapshot novo, e não o anterior', () => {
    const { consent } = setup();
    consent.decide({ ads: 'granted' });
    const granted = consent.getSnapshot();

    consent.decide({ ads: 'denied' });
    consent.decide({ ads: 'granted' });

    assert.notEqual(consent.getSnapshot(), granted);
  });

  it('voltar ao estado sem decisões produz snapshot novo, e não o de servidor', () => {
    const { consent } = setup();
    consent.decide({ ads: 'granted' });

    consent.restore(null);

    assert.notEqual(consent.getSnapshot(), consent.getServerSnapshot());
  });
});

describe('snapshot de servidor', () => {
  it('getServerSnapshot devolve sempre o mesmo objeto, mesmo depois de alterações', () => {
    const { consent } = setup();
    const server = consent.getServerSnapshot();

    consent.grantAll();
    consent.restore(null);

    assert.equal(consent.getServerSnapshot(), server);
  });

  it('tem tudo pending, nada desatualizado e registro vazio, mesmo com registro hidratado', () => {
    const { consent } = setup({ record: recordOf({ ads: decisionOf('granted') }) });

    assert.deepStrictEqual(consent.getServerSnapshot(), {
      status: { analytics: 'pending', ads: 'pending', health: 'pending' },
      outdated: { analytics: false, ads: false, health: false },
      record: { format: 1, decisions: {} },
    });
  });
});

describe('compartilhamento estrutural entre snapshots consecutivos', () => {
  it('decisão inalterada mantém a referência', () => {
    const { consent } = setup({
      record: recordOf({ analytics: decisionOf('granted', { version: '2026-10' }) }),
    });
    const { analytics } = consent.getSnapshot().record.decisions;

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().record.decisions.analytics, analytics);
  });

  /** Snapshots antes e depois de remover a decisão desatualizada: só o sinal de analytics muda. */
  function clearStaleAnalytics() {
    const { consent } = setup({
      record: recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) }),
    });
    const before = consent.getSnapshot();
    consent.restore(null);
    return { before, after: consent.getSnapshot() };
  }

  it('status mantém a referência quando nenhuma situação muda, mesmo que outdated mude', () => {
    const { before, after } = clearStaleAnalytics();

    assert.equal(after.status, before.status);
  });

  it('outdated é um objeto novo, com o sinal atualizado, quando algum sinal muda', () => {
    const { before, after } = clearStaleAnalytics();

    assert.notEqual(after.outdated, before.outdated);
    assert.equal(after.outdated.analytics, false);
  });

  it('outdated mantém a referência quando nenhum sinal muda', () => {
    const { consent } = setup();
    const { outdated } = consent.getSnapshot();

    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().outdated, outdated);
  });

  it('record e record.decisions são objetos novos a cada alteração', () => {
    const { consent } = setup({ record: recordOf({ ads: decisionOf('granted') }) });
    const { record } = consent.getSnapshot();

    consent.restore(recordOf({ ads: decisionOf('granted', { decidedAt: START + 1 }) }));

    const next = consent.getSnapshot().record;
    assert.notEqual(next, record);
    assert.notEqual(next.decisions, record.decisions);
  });
});

describe('tentativa de alteração de objeto público', () => {
  interface Mutation {
    readonly attempt: string;
    readonly act: (objects: PublicObjects) => void;
  }

  const MUTATIONS = [
    {
      attempt: 'trocar uma função do gerenciador',
      act: ({ consent }) => {
        assignUntyped(consent, 'decide', () => undefined);
      },
    },
    {
      attempt: 'tornar health elegível para grantAll',
      act: ({ consent }) => {
        assignUntyped(consent.purposes.health, 'individualGrant', false);
      },
    },
    {
      attempt: 'acrescentar uma finalidade a purposes',
      act: ({ consent }) => {
        assignUntyped(consent.purposes, 'extra', {});
      },
    },
    {
      attempt: 'conceder ads pela situação do snapshot',
      act: ({ snapshot }) => {
        assignUntyped(snapshot.status, 'ads', 'granted');
      },
    },
    {
      attempt: 'marcar health como desatualizada',
      act: ({ snapshot }) => {
        assignUntyped(snapshot.outdated, 'health', true);
      },
    },
    {
      attempt: 'trocar o registro do snapshot',
      act: ({ snapshot }) => {
        assignUntyped(snapshot, 'record', { format: 1, decisions: {} });
      },
    },
    {
      attempt: 'trocar uma decisão do registro',
      act: ({ snapshot }) => {
        assignUntyped(snapshot.record.decisions, 'ads', decisionOf('granted'));
      },
    },
    {
      attempt: 'trocar o status de uma decisão',
      act: ({ decided }) => {
        assignUntyped(decided, 'status', 'denied');
      },
    },
    {
      attempt: 'conceder ads pelo snapshot de servidor',
      act: ({ server }) => {
        assignUntyped(server.status, 'ads', 'granted');
      },
    },
    {
      attempt: 'trocar a origem da notificação',
      act: ({ change }) => {
        assignUntyped(change, 'source', 'restore');
      },
    },
    {
      attempt: 'trocar um item de changed',
      act: ({ change }) => {
        assignUntyped(change.changed, '0', 'health');
      },
    },
  ] as const satisfies readonly Mutation[];

  for (const { attempt, act } of MUTATIONS) {
    it(`${attempt} lança TypeError e não altera o estado`, () => {
      const objects = publicObjects();

      assert.throws(() => {
        act(objects);
      }, TypeError);

      assert.deepStrictEqual(objects.consent.getSnapshot(), publicObjects().snapshot);
    });
  }
});

describe('objetos recebidos não são retidos', () => {
  it('alterar o registro passado em record depois da criação não muda o estado', () => {
    const entry = { status: 'granted', decidedAt: START };
    const { consent } = setup({ record: { format: 1, decisions: { ads: entry } } });

    entry.status = 'denied';

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });

  it('alterar o registro passado a restore depois da chamada não muda o estado', () => {
    const entry = { status: 'granted', decidedAt: START };
    const { consent } = setup();
    consent.restore({ format: 1, decisions: { ads: entry } });

    entry.status = 'denied';

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, { ads: decisionOf('granted') });
  });
});

describe('protótipos e ordem das chaves', () => {
  for (const { name, pick } of PUBLIC_OBJECTS) {
    it(`${name} tem protótipo Object.prototype`, () => {
      const value = pick(publicObjects());

      assert.equal(Object.getPrototypeOf(value), Object.prototype);
    });
  }

  it('changed é um array comum, com protótipo Array.prototype', () => {
    const { change } = publicObjects();

    assert.equal(Object.getPrototypeOf(change.changed), Array.prototype);
  });

  it('as chaves do snapshot e do snapshot de servidor vêm na ordem status, outdated, record', () => {
    const { snapshot, server } = publicObjects();

    assert.deepStrictEqual(
      [Object.keys(snapshot), Object.keys(server)],
      [
        ['status', 'outdated', 'record'],
        ['status', 'outdated', 'record'],
      ],
    );
  });

  it('assert.deepStrictEqual aceita literais como valor esperado de um snapshot', () => {
    const { snapshot } = publicObjects();

    assert.deepStrictEqual(snapshot, {
      status: { analytics: 'granted', ads: 'denied', health: 'denied' },
      outdated: { analytics: false, ads: false, health: false },
      record: {
        format: 1,
        decisions: {
          analytics: { status: 'granted', version: '2026-10', decidedAt: START },
          ads: { status: 'denied', decidedAt: START },
          health: { status: 'denied', version: '1', decidedAt: START },
        },
      },
    });
  });
});
