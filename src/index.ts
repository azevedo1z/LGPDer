/**
 * LGPDer: núcleo de gerenciamento de consentimento e de preferências de privacidade para
 * aplicações web.
 *
 * Mantém, por finalidade, as decisões de consentimento que a aplicação registra em resposta a
 * ações do titular, informa a situação de cada finalidade e notifica alterações. Não acessa rede,
 * armazenamento nem APIs de navegador, não coleta dados por iniciativa própria e não realiza
 * rastreamento nem telemetria.
 *
 * Usar o LGPDer não garante conformidade com a LGPD (Lei nº 13.709/2018). A conformidade depende
 * do contexto do tratamento e da forma como a aplicação utiliza a biblioteca.
 *
 * @packageDocumentation
 */

import { createManager } from './manager.ts';

/* eslint-disable @typescript-eslint/consistent-indexed-object-style -- os tipos mapeados
 * (`{ readonly [K in P]: T }`) são a forma da API publicada, verificada quanto à inferência de
 * `P` e `C`; a forma `Record` mudaria o `.d.ts`. */

/**
 * Situação efetiva de uma finalidade.
 *
 * - `'pending'`: não há decisão vigente. Nunca houve decisão, ou a última foi registrada sob outra
 *   versão da finalidade (veja {@link ConsentSnapshot.outdated}).
 * - `'granted'`: consentimento concedido sob a versão atual.
 * - `'denied'`: consentimento recusado ou revogado sob a versão atual.
 *
 * Somente `'granted'` autoriza o tratamento baseado em consentimento.
 */
export type ConsentStatus = 'pending' | 'granted' | 'denied';

/**
 * Resultado que uma decisão registra: concessão (`'granted'`) ou recusa (`'denied'`).
 * Revogar o consentimento é registrar `'denied'`.
 */
export type DecidedStatus = Exclude<ConsentStatus, 'pending'>;

/**
 * Configuração de uma finalidade de tratamento baseada em consentimento.
 *
 * @typeParam C - União dos identificadores de categoria.
 */
export interface PurposeConfig<C extends string = string> {
  /**
   * Versão das informações apresentadas ao titular sobre esta finalidade: texto opaco e não
   * vazio, comparado por igualdade estrita, sem ordenação. Uma decisão registrada sob outra versão
   * deixa de ser vigente: a finalidade volta a `'pending'` e é sinalizada em `outdated`.
   * Ausente: a finalidade não é versionada.
   */
  readonly version?: string | undefined;
  /**
   * Categoria usada apenas para agrupar finalidades (por exemplo, na interface). Não tem estado de
   * consentimento próprio e não altera nenhuma regra do núcleo. Segue o formato dos
   * identificadores de finalidade.
   */
  readonly category?: C | undefined;
  /**
   * Se `true`, {@link ConsentManager.grantAll} não alcança esta finalidade: ela só é concedida
   * quando nomeada em {@link ConsentManager.decide}. {@link ConsentManager.denyAll} a inclui
   * normalmente. Indicado para finalidades que exigem decisão específica, como as que envolvem
   * dados pessoais sensíveis ou dados de crianças. Padrão: `false`.
   */
  readonly individualGrant?: boolean | undefined;
}

/**
 * Opções de {@link createConsentManager}.
 *
 * @typeParam P - União dos identificadores de finalidade.
 * @typeParam C - União dos identificadores de categoria.
 */
export interface ConsentOptions<P extends string = string, C extends string = string> {
  /**
   * Finalidades baseadas em consentimento, indexadas pelo identificador; ao menos uma. O
   * identificador começa com letra ASCII e contém apenas letras ASCII, dígitos, `_`, `-` e `.`;
   * nomes de propriedades de `Object.prototype` (como `toString`) são recusados. A ordem das
   * chaves define a ordem usada em snapshots, registros e notificações.
   */
  readonly purposes: { readonly [K in P]: PurposeConfig<C> };
  /**
   * Registro salvo anteriormente, como objeto ou como texto JSON. É tratado como dado não
   * confiável: conteúdo ausente ou inválido é descartado sem erro e a finalidade afetada fica
   * `'pending'`.
   */
  readonly record?: unknown;
  /**
   * Relógio usado em `decidedAt`. Deve devolver milissegundos desde 1970-01-01T00:00:00Z como
   * inteiro não negativo. É chamado sem `this`. Padrão: `Date.now`, lido na criação do
   * gerenciador. A precisão fica a critério da aplicação: um relógio arredondado (por exemplo, ao
   * dia) reduz a capacidade de `decidedAt` singularizar o dispositivo.
   */
  readonly now?: (() => number) | undefined;
}

/** Decisão registrada para uma finalidade. Objeto congelado. */
export interface ConsentDecision {
  /** `'granted'` para concessão; `'denied'` para recusa ou revogação. */
  readonly status: DecidedStatus;
  /** Versão da finalidade no momento da decisão; ausente se a finalidade não era versionada. */
  readonly version?: string;
  /** Instante da decisão, em milissegundos desde 1970-01-01T00:00:00Z, segundo o relógio configurado. */
  readonly decidedAt: number;
}

/**
 * Registro serializável das decisões. É o que a aplicação persiste, com
 * `JSON.stringify(snapshot.record)`, e devolve em `record` ou em `restore()`. Não contém
 * identificador atribuído pelo LGPDer; o instante de cada decisão, conforme a precisão do relógio
 * (`now`), pode singularizar o dispositivo. Objeto congelado.
 *
 * @typeParam P - União dos identificadores de finalidade.
 */
export interface ConsentRecord<P extends string = string> {
  /** Versão do formato do registro, independente das versões das finalidades e do pacote. */
  readonly format: 1;
  /**
   * Última decisão de cada finalidade configurada que tenha decisão, vigente ou desatualizada,
   * na ordem da configuração.
   */
  readonly decisions: { readonly [K in P]?: ConsentDecision };
}

/**
 * Estado imutável das preferências em um instante. Objeto congelado.
 *
 * @typeParam P - União dos identificadores de finalidade.
 */
export interface ConsentSnapshot<P extends string = string> {
  /** Situação efetiva de cada finalidade configurada, na ordem da configuração. */
  readonly status: { readonly [K in P]: ConsentStatus };
  /**
   * `true` quando a finalidade tem decisão registrada sob versão diferente da atual; nesse caso a
   * situação é `'pending'`. Serve para a aplicação informar o titular sobre a mudança e coletar
   * nova decisão. Não é revogação.
   */
  readonly outdated: { readonly [K in P]: boolean };
  /** Registro serializável correspondente a este estado. */
  readonly record: ConsentRecord<P>;
}

/**
 * Origem de uma alteração.
 *
 * - `'decision'`: decisão registrada nesta instância por `decide`, `grantAll` ou `denyAll`.
 * - `'restore'`: registro externo adotado por `restore`. Não representa nova manifestação do
 *   titular.
 */
export type ChangeSource = 'decision' | 'restore';

/**
 * Notificação entregue aos ouvintes após cada alteração do registro. Objeto congelado.
 *
 * @typeParam P - União dos identificadores de finalidade.
 */
export interface ConsentChange<P extends string = string> {
  /** Origem da alteração. */
  readonly source: ChangeSource;
  /**
   * Finalidades cuja entrada no registro mudou, na ordem da configuração; nunca é vazio. Em
   * alterações de origem `'restore'`, pode incluir finalidades cuja situação efetiva não mudou
   * (por exemplo, quando só `decidedAt` mudou): compare `previous.status` e `snapshot.status`
   * para reagir a mudanças de situação.
   */
  readonly changed: readonly P[];
  /** Estado logo após esta alteração. */
  readonly snapshot: ConsentSnapshot<P>;
  /** Estado logo antes desta alteração. */
  readonly previous: ConsentSnapshot<P>;
}

/**
 * Função chamada após cada alteração do registro. O valor devolvido é ignorado.
 *
 * @typeParam P - União dos identificadores de finalidade.
 */
export type ConsentListener<P extends string = string> = (change: ConsentChange<P>) => void;

/**
 * Decisões a registrar, por finalidade. Finalidades omitidas ou com `undefined` não mudam.
 *
 * @typeParam P - União dos identificadores de finalidade.
 */
export type ConsentChoices<P extends string = string> = {
  readonly [K in P]?: DecidedStatus | undefined;
};

/**
 * Gerenciador de consentimento. Objeto congelado; as funções não dependem de `this` e podem ser
 * desestruturadas ou passadas adiante, por exemplo para `useSyncExternalStore` do React.
 *
 * @typeParam P - União dos identificadores de finalidade.
 * @typeParam C - União dos identificadores de categoria.
 */
export interface ConsentManager<P extends string = string, C extends string = string> {
  /**
   * Cópia congelada da configuração das finalidades, na ordem declarada. Cada configuração
   * contém somente as propriedades informadas com valor diferente de `undefined`.
   */
  readonly purposes: { readonly [K in P]: PurposeConfig<C> };

  /**
   * Devolve o estado atual. Entre duas notificações, devolve sempre o mesmo objeto.
   */
  readonly getSnapshot: () => ConsentSnapshot<P>;

  /**
   * Devolve um estado sem nenhuma decisão (todas as finalidades `'pending'`), criado na
   * construção e sempre o mesmo objeto. Destinado à renderização no servidor e à hidratação
   * quando o registro só existe no navegador.
   */
  readonly getServerSnapshot: () => ConsentSnapshot<P>;

  /**
   * Registra, altera ou revoga decisões em uma única operação atômica. Revogar é registrar
   * `'denied'` para uma finalidade concedida. Finalidades omitidas ou com `undefined` não mudam,
   * e repetir a situação vigente não altera nada (nem `decidedAt`). A aplicação deve chamá-la
   * somente em resposta a uma ação explícita do titular.
   *
   * @param choices - Decisão por finalidade.
   * @throws {TypeError} `choices` não é objeto simples, um valor não é `'granted'`, `'denied'`
   * nem `undefined`, ou o relógio não devolveu inteiro não negativo.
   * @throws {RangeError} `choices` contém chave que não é finalidade configurada, mesmo com valor
   * `undefined`.
   * Em qualquer erro, nada é alterado e nada é notificado.
   */
  readonly decide: (choices: ConsentChoices<P>) => void;

  /**
   * Concede, em uma única operação atômica, as finalidades configuradas que não têm
   * `individualGrant: true`. Grava uma decisão por finalidade: não cria autorização genérica e
   * não alcança finalidades declaradas depois.
   *
   * @throws {TypeError} O relógio não devolveu inteiro não negativo. Nesse caso, nada é alterado.
   */
  readonly grantAll: () => void;

  /**
   * Recusa ou revoga, em uma única operação atômica, todas as finalidades configuradas, inclusive
   * as marcadas com `individualGrant: true`.
   *
   * @throws {TypeError} O relógio não devolveu inteiro não negativo. Nesse caso, nada é alterado.
   */
  readonly denyAll: () => void;

  /**
   * Substitui todas as decisões pelo conteúdo válido de um registro externo (objeto ou texto
   * JSON), tratado como dado não confiável; conteúdo ausente ou inválido equivale a registro
   * vazio. Notifica com `source: 'restore'` se alguma entrada mudar. Use para adotar o registro
   * gravado por outra aba ou carregado do backend da aplicação, antes de coletar novas decisões:
   * a restauração não representa manifestação do titular, não é revogação e substitui decisões
   * locais mais recentes. Nunca lança erro.
   *
   * @param record - Registro a adotar.
   */
  readonly restore: (record: unknown) => void;

  /**
   * Inscreve um ouvinte, chamado de forma síncrona após cada alteração do registro, na ordem de
   * inscrição. Exceções do ouvinte não interrompem os demais nem a operação: são relançadas em
   * microtarefa. Compatível com `useSyncExternalStore` do React.
   *
   * @param listener - Função que recebe cada notificação.
   * @returns Função idempotente que cancela esta inscrição.
   * @throws {TypeError} `listener` não é função.
   */
  readonly subscribe: (listener: ConsentListener<P>) => () => void;
}

/* eslint-enable @typescript-eslint/consistent-indexed-object-style */

/**
 * Cria um gerenciador de consentimento.
 *
 * Os identificadores das finalidades e das categorias são inferidos como uniões literais a partir
 * de `options.purposes`. Somente propriedades próprias enumeráveis das opções e das configurações
 * são consideradas. A configuração é validada e copiada; `options.record`, se informado, é lido
 * como dado não confiável. A criação não notifica e não chama o relógio.
 *
 * @typeParam P - União dos identificadores de finalidade.
 * @typeParam C - União dos identificadores de categoria (`never` quando nenhuma finalidade
 * declara categoria).
 * @param options - Finalidades, registro salvo e relógio.
 * @returns Gerenciador congelado.
 * @throws {TypeError} Configuração inválida.
 *
 * @example
 * ```ts
 * const consent = createConsentManager({
 *   purposes: {
 *     analytics: { version: '2026-10', category: 'statistics' },
 *     ads: { version: '2026-10', category: 'marketing' },
 *   },
 * });
 * consent.decide({ analytics: 'granted', ads: 'denied' });
 * consent.getSnapshot().status.analytics; // 'granted'
 * ```
 */
export function createConsentManager<P extends string, C extends string = never>(
  options: ConsentOptions<P, C>,
): ConsentManager<P, C>;
export function createConsentManager(options: unknown): ConsentManager {
  return createManager(options);
}
