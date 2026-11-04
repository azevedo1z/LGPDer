import { parseOptions } from './config.ts';
import type {
  ChangeSource,
  ConsentChange,
  ConsentManager,
  ConsentSnapshot,
  DecidedStatus,
} from './index.ts';
import { createDecision, readRecord, sameDecision, type Decisions } from './record.ts';
import { buildServerSnapshot, buildSnapshot } from './snapshot.ts';
import { describe, isDecidedStatus, isFunction, isPlainObject, isTimestamp } from './validation.ts';

// O build não inclui tipos de DOM nem do Node, por isso a declaração. A chamada resolve o global
// vigente no momento do erro, e não o da importação.
declare function queueMicrotask(callback: () => void): void;

/** Pedido de decisão alinhado aos ids configurados; `undefined` significa "sem alteração". */
type Request = readonly (DecidedStatus | undefined)[];

/** Gravação calculada por uma mutação: posição em `ids`, id e situação pedida. */
type Write = readonly [index: number, id: string, status: DecidedStatus];

interface Subscription {
  readonly listener: (change: ConsentChange) => unknown;
  /** Total de alterações confirmadas antes da inscrição: nenhuma delas é entregue. */
  readonly since: number;
}

interface Pending {
  /** Ordem de confirmação da alteração, a partir de 1. */
  readonly seq: number;
  readonly change: ConsentChange;
}

/** Cria o gerenciador: estado, operações, fila de notificações e entrega. */
export function createManager(options: unknown): ConsentManager {
  const { model, record } = parseOptions(options);
  const { ids, positions, versions, grantable, now } = model;
  const serverSnapshot = buildServerSnapshot(ids);
  // Hidratação: não notifica, não chama o relógio e, sem decisão válida, adota o snapshot de
  // servidor.
  let decisions: Decisions = readRecord(record, ids);
  let snapshot = decisions.some((decision) => decision !== undefined)
    ? buildSnapshot(model, decisions, serverSnapshot)
    : serverSnapshot;

  const subscriptions = new Set<Subscription>();
  const queue: Pending[] = [];
  let commits = 0;
  let delivering = false;

  // Pedidos fixos dos lotes: a configuração não muda durante a vida da instância.
  const grantAllRequest: Request = grantable.map((reached) => (reached ? 'granted' : undefined));
  const denyAllRequest: Request = ids.map(() => 'denied');

  /** Entrega a fila em ordem FIFO até esvaziá-la, inclusive o que os ouvintes enfileirarem. */
  const deliver = (): void => {
    delivering = true;
    try {
      for (let pending = queue.shift(); pending !== undefined; pending = queue.shift()) {
        // A iteração do Set é viva: inscrição cancelada durante a entrega não é visitada.
        for (const subscription of subscriptions) {
          if (subscription.since >= pending.seq) continue;
          // Chamada sem `this`, para não expor a inscrição ao ouvinte.
          const { listener } = subscription;
          try {
            listener(pending.change);
          } catch (error) {
            // Os demais ouvintes e a operação seguem; o erro continua visível.
            queueMicrotask(() => {
              throw error;
            });
          }
        }
      }
    } finally {
      delivering = false;
    }
  };

  /** Confirma a alteração e a notifica. */
  const commit = (next: Decisions, changed: string[], source: ChangeSource): void => {
    const previous = snapshot;
    // O snapshot e a notificação são montados antes de o estado mudar: se a montagem lançar,
    // nada muda.
    const current = buildSnapshot(model, next, previous);
    const change: ConsentChange = Object.freeze({
      source,
      changed: Object.freeze(changed),
      snapshot: current,
      previous,
    });
    decisions = next;
    snapshot = current;
    commits += 1;
    queue.push({ seq: commits, change });
    // Reentrância: a entrega em andamento leva esta notificação depois da atual.
    if (!delivering) deliver();
  };

  /** Grava, em uma operação atômica, os pedidos que mudam a situação efetiva. */
  const apply = (requested: Request): void => {
    const { status } = snapshot;
    const writes: Write[] = [];
    for (const [index, id] of ids.entries()) {
      const value = requested[index];
      if (value !== undefined && value !== status[id]) writes.push([index, id, value]);
    }
    if (writes.length === 0) return;
    // Uma leitura do relógio por chamada efetiva, depois da validação e do cálculo: o lote
    // compartilha o instante, e entradas inválidas e no-ops nunca chamam o relógio.
    const decidedAt = now();
    if (!isTimestamp(decidedAt)) {
      throw new TypeError(
        '[lgpder] "now" deve retornar um inteiro não negativo (milissegundos desde a época Unix).',
      );
    }
    const next = decisions.slice();
    const changed: string[] = [];
    for (const [index, id, value] of writes) {
      next[index] = createDecision(value, versions[index], decidedAt);
      changed.push(id);
    }
    commit(next, changed, 'decision');
  };

  const getSnapshot = (): ConsentSnapshot => snapshot;
  const getServerSnapshot = (): ConsentSnapshot => serverSnapshot;

  const decide = (choices: unknown): void => {
    if (!isPlainObject(choices)) {
      throw new TypeError(
        `[lgpder] As decisões devem ser um objeto simples; recebido: ${describe(choices)}.`,
      );
    }
    // A entrada inteira é validada antes de qualquer efeito, cada chave antes do seu valor. O
    // pedido é preenchido, sem buracos: uma posição vazia seria lida de um protótipo poluído.
    const requested = new Array<DecidedStatus | undefined>(ids.length).fill(undefined);
    for (const key of Object.keys(choices)) {
      const index = positions.get(key);
      if (index === undefined) {
        throw new RangeError(`[lgpder] Finalidade desconhecida: ${JSON.stringify(key)}.`);
      }
      const value = choices[key];
      if (value !== undefined && !isDecidedStatus(value)) {
        throw new TypeError(
          `[lgpder] A decisão para ${JSON.stringify(key)} deve ser "granted" ou "denied"; recebido: ${describe(value)}.`,
        );
      }
      requested[index] = value;
    }
    apply(requested);
  };

  const grantAll = (): void => {
    apply(grantAllRequest);
  };

  const denyAll = (): void => {
    apply(denyAllRequest);
  };

  /** Substitui todas as decisões pelo conteúdo válido de `input`, sem mesclar. */
  const restore = (input: unknown): void => {
    const next = readRecord(input, ids);
    const changed: string[] = [];
    for (const [index, id] of ids.entries()) {
      const current = decisions[index];
      // Entrada igual mantém a referência da decisão atual, que fica estável entre snapshots.
      if (sameDecision(current, next[index])) next[index] = current;
      else changed.push(id);
    }
    if (changed.length > 0) commit(next, changed, 'restore');
  };

  const subscribe = (listener: unknown): (() => void) => {
    if (!isFunction(listener)) {
      throw new TypeError(
        `[lgpder] O ouvinte deve ser uma função; recebido: ${describe(listener)}.`,
      );
    }
    const subscription: Subscription = { listener, since: commits };
    subscriptions.add(subscription);
    return () => {
      subscriptions.delete(subscription);
    };
  };

  return Object.freeze({
    purposes: model.purposes,
    getSnapshot,
    getServerSnapshot,
    decide,
    grantAll,
    denyAll,
    restore,
    subscribe,
  });
}
