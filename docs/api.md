# Referência da API

Referência completa do LGPDer: assinaturas, parâmetros, retorno, erros e exemplos de cada exportação, tipagem, mensagens de erro, notificações, SSR e React. O aviso de não conformidade e a visão geral estão no [README](../README.md).

A única exportação de runtime é `createConsentManager`; as demais são tipos. As assinaturas abaixo reproduzem o `dist/index.d.ts` publicado, que traz também a documentação em TSDoc.

| Exportação                                      | Natureza  | Papel                          |
| ----------------------------------------------- | --------- | ------------------------------ |
| [`createConsentManager`](#createconsentmanager) | função    | cria o gerenciador             |
| [`ConsentManager<P, C>`](#consentmanager)       | interface | gerenciador                    |
| [`ConsentOptions<P, C>`](#consentoptions)       | interface | opções de criação              |
| [`PurposeConfig<C>`](#purposeconfig)            | interface | configuração de uma finalidade |
| [`ConsentStatus`](#consentstatus)               | tipo      | situação efetiva               |
| [`DecidedStatus`](#decidedstatus)               | tipo      | resultado de uma decisão       |
| [`ConsentChoices<P>`](#consentchoices)          | tipo      | entrada de `decide`            |
| [`ConsentDecision`](#consentdecision)           | interface | decisão registrada             |
| [`ConsentRecord<P>`](#consentrecord)            | interface | registro serializável          |
| [`ConsentSnapshot<P>`](#consentsnapshot)        | interface | estado imutável                |
| [`ChangeSource`](#changesource)                 | tipo      | origem de uma alteração        |
| [`ConsentChange<P>`](#consentchange)            | interface | notificação                    |
| [`ConsentListener<P>`](#consentlistener)        | tipo      | ouvinte                        |

`P` é a união dos ids de finalidade, e `C`, a união dos ids de categoria.

## `createConsentManager`

```ts
export declare function createConsentManager<P extends string, C extends string = never>(
  options: ConsentOptions<P, C>,
): ConsentManager<P, C>;
```

Cria um gerenciador de consentimento. Os ids das finalidades e das categorias são inferidos como uniões literais a partir de `options.purposes` (`C` é `never` quando nenhuma finalidade declara categoria). A configuração é validada e copiada; `options.record`, se informado, é lido como dado não confiável. A criação não notifica e não chama o relógio.

- Parâmetro `options` (`ConsentOptions<P, C>`): finalidades, registro salvo e relógio.
- Retorno: gerenciador congelado (`ConsentManager<P, C>`).
- Erros: `TypeError` para configuração inválida. A validação é síncrona e lança no primeiro problema, nesta ordem: `options` é objeto simples; cada chave de `options` é `purposes`, `record` ou `now`; `purposes` é objeto simples com ao menos uma finalidade; para cada finalidade, na ordem das chaves, o id é válido, a configuração é objeto simples, cada chave dela é `version`, `category` ou `individualGrant`, `version` é `undefined` ou texto não vazio, `category` é `undefined` ou id válido e `individualGrant` é `undefined` ou booleano; `now` é `undefined` ou função. `options.record` nunca causa erro. As mensagens estão em [Erros](#erros).

Somente propriedades próprias enumeráveis com chave texto (as devolvidas por `Object.keys`) são consideradas em `options`, em `purposes` e em cada configuração: chaves símbolo, propriedades não enumeráveis e propriedades herdadas, inclusive de um `Object.prototype` poluído, são ignoradas. Cada propriedade é lida uma única vez. Exceções lançadas por getters ou proxies durante a validação se propagam sem efeito; na leitura de `options.record`, resultam em registro vazio. O objeto recebido não é alterado nem congelado, e alterá-lo depois da criação não tem efeito.

```ts
import { createConsentManager } from 'lgpder';

export const consent = createConsentManager({
  purposes: {
    analytics: { version: '2026-10', category: 'statistics' },
    ads: { category: 'marketing' },
    healthReminders: { version: '1', category: 'health', individualGrant: true },
  },
});
```

Os demais exemplos deste documento usam este `consent`, cada um a partir do estado inicial, sem decisões. A exceção são os de [SSR e React](#ssr-e-react), que usam a ligação com `localStorage`.

## `ConsentManager`

```ts
export interface ConsentManager<P extends string = string, C extends string = string> {
  readonly purposes: { readonly [K in P]: PurposeConfig<C> };
  readonly getSnapshot: () => ConsentSnapshot<P>;
  readonly getServerSnapshot: () => ConsentSnapshot<P>;
  readonly decide: (choices: ConsentChoices<P>) => void;
  readonly grantAll: () => void;
  readonly denyAll: () => void;
  readonly restore: (record: unknown) => void;
  readonly subscribe: (listener: ConsentListener<P>) => () => void;
}
```

Gerenciador de consentimento: objeto congelado com exatamente estas propriedades, nesta ordem. As funções são propriedades (`readonly decide: (...) => void`), e não métodos: não dependem de `this` e podem ser desestruturadas ou passadas adiante, por exemplo para `useSyncExternalStore` do React.

```ts
const { decide, getSnapshot } = consent;
decide({ analytics: 'granted' });
getSnapshot().status.analytics; // 'granted'
```

### `purposes`

Cópia congelada da configuração das finalidades, na ordem declarada. Cada configuração é um objeto novo e congelado que contém somente as propriedades informadas com valor diferente de `undefined`, na ordem `version`, `category` e `individualGrant`; `individualGrant: false` informado explicitamente é mantido.

```ts
consent.purposes.ads; // { category: 'marketing' }
consent.purposes.healthReminders; // { version: '1', category: 'health', individualGrant: true }
```

### `getSnapshot()`

Devolve o estado atual (`ConsentSnapshot<P>`). Entre duas notificações, devolve sempre o mesmo objeto; a cada alteração confirmada, passa a devolver um objeto novo. Tem custo constante e não aloca memória.

```ts
const before = consent.getSnapshot();
before.status.analytics; // 'pending'
consent.decide({ analytics: 'granted' });
consent.getSnapshot() === before; // false: houve alteração
consent.getSnapshot().status.analytics; // 'granted'
```

### `getServerSnapshot()`

Devolve um estado sem nenhuma decisão: todas as finalidades `'pending'`, `outdated` com todas `false` e `record` igual a `{ format: 1, decisions: {} }`. É criado na construção e é sempre o mesmo objeto. Destina-se à renderização no servidor e à hidratação quando o registro só existe no navegador (veja [SSR e React](#ssr-e-react)). Quando a hidratação não produz nenhuma decisão válida, o snapshot inicial é o próprio snapshot de servidor.

```ts
consent.getServerSnapshot().record; // { format: 1, decisions: {} }
consent.getSnapshot() === consent.getServerSnapshot(); // true: não havia registro salvo
```

### `decide(choices)`

Registra, altera ou revoga decisões em uma única operação atômica. Revogar é registrar `'denied'` para uma finalidade concedida (veja [`DecidedStatus`](#decidedstatus)). Finalidades omitidas ou com `undefined` não mudam, e repetir a situação vigente não altera nada (nem `decidedAt`). Chame `decide` somente em resposta a uma ação explícita do titular.

- Parâmetro `choices` (`ConsentChoices<P>`): decisão por finalidade.
- Retorno: nenhum.
- Erros: `TypeError` se `choices` não é objeto simples, se um valor não é `'granted'`, `'denied'` nem `undefined` ou se o relógio não devolveu inteiro não negativo; `RangeError` se `choices` contém chave que não é finalidade configurada, mesmo com valor `undefined`. Em qualquer erro, nada é alterado e nada é notificado.

A entrada inteira é validada antes de qualquer efeito. Para cada chave, na ordem de `Object.keys(choices)`, primeiro a chave precisa ser finalidade configurada e depois o valor precisa ser `undefined`, `'granted'` ou `'denied'`; a primeira violação nessa ordem determina o erro. Uma finalidade é gravada somente se o valor pedido difere da situação efetiva atual, o que abrange finalidade sem decisão, finalidade com decisão desatualizada (mesmo com o mesmo valor) e finalidade com valor oposto. Se nenhuma finalidade muda, a chamada não tem efeito: não chama o relógio, não cria snapshot e não notifica. Assim, chamadas repetidas não fabricam datas recentes; a renovação se faz com nova versão.

Em uma chamada efetiva, o relógio é chamado exatamente uma vez, depois da validação, e todas as decisões gravadas compartilham o mesmo `decidedAt`. O valor do relógio precisa ser inteiro seguro não negativo; `NaN`, `1.5`, `-1`, `'1'` ou um objeto `Date` causam `TypeError`, e um relógio que lança tem a exceção propagada intacta, sem alterar nada. A chamada produz um novo snapshot e uma notificação de origem `'decision'`, cujo `changed` lista as finalidades gravadas na ordem da configuração, e não na ordem das chaves de `choices`. `individualGrant` não afeta `decide`.

```ts
consent.decide({ analytics: 'granted', ads: 'denied' }); // uma operação, um decidedAt
consent.decide({ ads: 'denied' }); // sem efeito: ads já está 'denied'
consent.decide({ analytics: 'denied' }); // revoga analytics
consent.decide({ healthReminders: 'granted' }); // concede: individualGrant não afeta decide
```

### `grantAll()`

Concede, em uma única operação atômica, as finalidades configuradas que não têm `individualGrant: true`. Grava uma decisão por finalidade: não cria autorização genérica e não alcança finalidades declaradas depois. Finalidades já concedidas sob a versão vigente não mudam, e se nenhuma finalidade for elegível ou nenhuma mudar, a chamada não tem efeito. Argumentos passados em JavaScript são ignorados; em TypeScript, são erro de compilação. Chame `grantAll` somente em resposta a uma ação explícita do titular.

- Retorno: nenhum.
- Erros: `TypeError` se o relógio não devolveu inteiro não negativo. Nesse caso, nada é alterado.

```ts
consent.grantAll();
consent.getSnapshot().status;
// { analytics: 'granted', ads: 'granted', healthReminders: 'pending' }
```

### `denyAll()`

Recusa ou revoga, em uma única operação atômica, todas as finalidades configuradas, inclusive as marcadas com `individualGrant: true`. Finalidades `'pending'` passam a `'denied'`, uma recusa registrada. Valem as mesmas regras de `grantAll` para relógio, notificação, chamadas sem efeito e argumentos.

- Retorno: nenhum.
- Erros: `TypeError` se o relógio não devolveu inteiro não negativo. Nesse caso, nada é alterado.

```ts
consent.denyAll();
consent.getSnapshot().status;
// { analytics: 'denied', ads: 'denied', healthReminders: 'denied' }
```

### `restore(record)`

Substitui todas as decisões pelo conteúdo válido de um registro externo (objeto ou texto JSON), tratado como dado não confiável; conteúdo ausente ou inválido, inclusive `null`, `undefined` e `''`, equivale a registro vazio. Não mescla: finalidades sem decisão válida no registro adotado ficam `'pending'`. Use `restore` para adotar o registro gravado por outra aba ou carregado do backend da aplicação, antes de coletar novas decisões: a restauração não representa manifestação do titular, não é revogação e substitui decisões locais mais recentes. Por isso, adotar um registro antigo depois de uma revogação local substitui essa revogação.

- Parâmetro `record` (`unknown`): registro a adotar.
- Retorno: nenhum.
- Erros: nunca lança.

Notifica com origem `'restore'` se alguma entrada mudar. Duas entradas são iguais quando ambas estão ausentes ou quando têm o mesmo `status`, a mesma `version` e o mesmo `decidedAt`. Entradas iguais mantêm a referência atual, e se nenhuma entrada difere a chamada não tem efeito: `restore(consent.getSnapshot().record)`, em objeto ou em texto JSON, não muda nada. Adotar um registro vazio deixa as finalidades `'pending'`, mas não é revogação e não elimina dados. `restore` não chama o relógio e não grava nada.

```ts
// Registro gravado por outra aba, em texto JSON.
consent.restore(
  '{"format":1,"decisions":{"analytics":{"status":"granted","version":"2026-10","decidedAt":1793448000000}}}',
);
consent.getSnapshot().status.analytics; // 'granted'
```

### `subscribe(listener)`

Inscreve um ouvinte, chamado de forma síncrona após cada alteração do registro, na ordem de inscrição. Exceções do ouvinte não interrompem os demais nem a operação: são relançadas em microtarefa (veja [Erros de ouvintes](#erros-de-ouvintes)). Cada chamada cria uma inscrição independente (veja [Inscrições](#inscrições)). Compatível com `useSyncExternalStore` do React.

- Parâmetro `listener` (`ConsentListener<P>`): função que recebe cada notificação.
- Retorno: função idempotente que cancela esta inscrição.
- Erros: `TypeError` se `listener` não é função.

```ts
const unsubscribe = consent.subscribe((change) => {
  console.log(change.source, change.changed); // 'decision' ['ads']
});
consent.decide({ ads: 'denied' });
unsubscribe(); // chamar de novo não tem efeito
```

## `ConsentOptions`

```ts
export interface ConsentOptions<P extends string = string, C extends string = string> {
  readonly purposes: { readonly [K in P]: PurposeConfig<C> };
  readonly record?: unknown;
  readonly now?: (() => number) | undefined;
}
```

Opções de `createConsentManager`. Opções desconhecidas causam `TypeError` em tempo de execução e erro de compilação, e chave presente com valor `undefined` equivale a chave ausente.

- `purposes`: finalidades baseadas em consentimento, indexadas pelo id; ao menos uma. O id segue o [formato dos identificadores](#formato-dos-identificadores). A ordem das chaves define a ordem usada em snapshots, registros e notificações.
- `record`: registro salvo anteriormente, como objeto ou como texto JSON. É tratado como dado não confiável: conteúdo ausente ou inválido é descartado sem erro, e a finalidade afetada fica `'pending'`. A hidratação não notifica e não chama o relógio.
- `now`: relógio usado em `decidedAt`. Deve devolver milissegundos desde 1970-01-01T00:00:00Z como inteiro não negativo e é chamado sem `this`. Padrão: `Date.now`, lido na criação do gerenciador; trocar `Date.now` depois da criação não afeta a instância. A precisão fica a critério da aplicação: um relógio arredondado (por exemplo, ao dia) reduz a capacidade de `decidedAt` singularizar o dispositivo. O relógio não deve chamar funções do gerenciador; nesse caso, o comportamento não é especificado.

```ts
import { createConsentManager } from 'lgpder';

const DAY = 24 * 60 * 60 * 1000; // um dia em milissegundos

export const consent = createConsentManager({
  purposes: { analytics: { version: '2026-10' } },
  record: savedRecord, // texto JSON salvo pela aplicação, ou null
  now: () => Math.floor(Date.now() / DAY) * DAY, // instante arredondado ao dia
});
```

`savedRecord` é o texto que a aplicação leu do seu armazenamento.

### Formato dos identificadores

Os ids de finalidade e de categoria começam com letra ASCII e contêm apenas letras ASCII, dígitos, `_`, `-` e `.` (padrão `/^[A-Za-z][A-Za-z0-9_.-]*$/`, sem limite de tamanho). Os nomes de propriedades de `Object.prototype` que casam com o padrão (`constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString` e `valueOf`) são recusados, e nomes iniciados por `_`, como `__proto__`, não casam com o padrão. Assim, `'*'`, `''`, `'1abc'`, `'a b'` e `'estatística'` são inválidos, e `'all'` é aceito como uma finalidade comum, sem significado especial.

## `PurposeConfig`

```ts
export interface PurposeConfig<C extends string = string> {
  readonly version?: string | undefined;
  readonly category?: C | undefined;
  readonly individualGrant?: boolean | undefined;
}
```

Configuração de uma finalidade de tratamento baseada em consentimento. Propriedades desconhecidas causam `TypeError` em tempo de execução e erro de compilação.

- `version`: versão das informações apresentadas ao titular sobre esta finalidade: texto opaco e não vazio, comparado por igualdade estrita, sem ordenação. Uma decisão registrada sob outra versão deixa de ser vigente: a finalidade volta a `'pending'` e é sinalizada em `outdated` (veja [Versão e `outdated`](#versão-e-outdated)). Ausente: a finalidade não é versionada.
- `category`: categoria usada apenas para agrupar finalidades (por exemplo, na interface). Não tem estado de consentimento nem operação própria e não altera nenhuma regra do núcleo: lotes por categoria são montados pela aplicação com `decide` e gravam uma decisão por finalidade (veja [Lote por categoria e pendências](persistencia.md#lote-por-categoria-e-pendências)). Segue o [formato dos identificadores](#formato-dos-identificadores). Uma categoria com erro de digitação, como `'marketng'`, é aceita e forma outro grupo; a prevenção fica com a tipagem da aplicação (veja [Tipagem](#tipagem)).
- `individualGrant`: se `true`, `grantAll` não alcança esta finalidade, que só é concedida quando nomeada em `decide`; `denyAll` a inclui normalmente. Como a marcação fica na configuração, qualquer botão de "aceitar todas" construído sobre `grantAll` deixa essa finalidade de fora por construção. Indicado para finalidades que exigem decisão específica, como as que envolvem dados pessoais sensíveis ou dados de crianças; a relação com a LGPD está nos temas [Dados sensíveis](lgpd.md#dados-sensíveis) e [Crianças e adolescentes](lgpd.md#crianças-e-adolescentes). Padrão: `false`.

```ts
import type { PurposeConfig } from 'lgpder';

export const healthReminders: PurposeConfig<'health'> = {
  version: '2026-10', // mude somente quando a alteração exigir nova manifestação do titular
  category: 'health',
  individualGrant: true, // fora de grantAll: concedida somente quando nomeada em decide
};
```

### Versão e `outdated`

`version` é opcional, definida por finalidade e opaca: texto não vazio comparado por igualdade estrita, sem ordenação (`'10'` e `'9'` são apenas diferentes). Cada decisão grava a versão vigente da finalidade. Decisão registrada sob outra versão vale `'pending'`, é sinalizada com `outdated: true` e permanece no registro até ser substituída. Ela não é alterada nem convertida em `'denied'`: `outdated` não é revogação. O sinal serve para a aplicação informar o titular sobre a mudança e coletar nova decisão.

- Na comparação, ausente e ausente são iguais, e ausente e texto são diferentes: se a finalidade não tem versão configurada e a decisão salva tem versão, ou o contrário, a decisão está desatualizada.
- Nova decisão sobre finalidade desatualizada grava a versão atual, mesmo que o valor seja igual ao anterior, e notifica.
- Voltar a uma versão anterior torna vigentes, de novo, as decisões registradas sob ela.
- Finalidade nova nasce `'pending'`, com `outdated: false`. A decisão salva de uma finalidade removida da configuração é ignorada na leitura e não aparece no registro.
- Não existe versão global: uma constante compartilhada entre finalidades cobre mudanças gerais (como `TERMS` na [ligação com `localStorage`](persistencia.md#ligação-com-localstorage)).
- A configuração é imutável durante a vida da instância: mudar finalidades ou versões exige criar nova instância (por exemplo, em um novo deploy).

Quando mudar a versão e o que a LGPD exige nesse caso estão em [versionamento e reconsentimento](lgpd.md#alteração-de-informações-ou-de-finalidade-versionamento-e-reconsentimento).

## `ConsentStatus`

```ts
export type ConsentStatus = 'pending' | 'granted' | 'denied';
```

Situação efetiva de uma finalidade, calculada a partir da decisão registrada e da versão vigente da finalidade:

- `'pending'`: não há decisão vigente. Nunca houve decisão, ou a última foi registrada sob outra versão da finalidade.
- `'granted'`: consentimento concedido sob a versão atual.
- `'denied'`: consentimento recusado ou revogado sob a versão atual.

| Condição                                           | `status[id]`        | `outdated[id]` |
| -------------------------------------------------- | ------------------- | -------------- |
| sem decisão                                        | `'pending'`         | `false`        |
| decisão registrada sob versão diferente da vigente | `'pending'`         | `true`         |
| decisão registrada sob a versão vigente            | `status` da decisão | `false`        |

Somente `'granted'` autoriza o tratamento baseado em consentimento; `'pending'` e `'denied'` não autorizam. A ausência de decisão é `'pending'` e nunca equivale a consentimento. Toda finalidade começa em `'pending'`, e somente `decide` e `grantAll` produzem `'granted'`: não há opção de valor inicial, inferência a partir de navegação ou de outra finalidade, nem conversão automática de `'pending'`. Uma finalidade só volta a `'pending'` por criação de nova instância com versão diferente ou por `restore` de registro sem decisão válida para ela ou com decisão registrada sob outra versão (nesse caso, com `outdated: true`).

```ts
import type { ConsentStatus } from 'lgpder';

// 'pending' e 'denied' não autorizam o tratamento.
export const authorizes = (status: ConsentStatus): boolean => status === 'granted';
```

## `DecidedStatus`

```ts
export type DecidedStatus = Exclude<ConsentStatus, 'pending'>;
```

Resultado que uma decisão registra: concessão (`'granted'`) ou recusa (`'denied'`).

- A recusa é uma decisão gravada e estável, distinta de `'pending'`, o que permite à aplicação não perguntar de novo a cada visita. Nenhuma operação exige que alguma finalidade esteja concedida.
- Revogar o consentimento é registrar `'denied'` (`decide` ou `denyAll`), com a mesma forma de chamada de conceder, sem confirmação, pré-condição ou limite. A revogação gera nova decisão datada e notificação, não tem efeito retroativo e não apaga dados tratados pela aplicação.

```ts
import type { DecidedStatus } from 'lgpder';

// Interruptor da central de preferências: ligar concede; desligar recusa ou revoga.
export function toggleAnalytics(checked: boolean): void {
  const status: DecidedStatus = checked ? 'granted' : 'denied';
  consent.decide({ analytics: status });
}
```

## `ConsentChoices`

```ts
export type ConsentChoices<P extends string = string> = {
  readonly [K in P]?: DecidedStatus | undefined;
};
```

Decisões a registrar, por finalidade: a entrada de `decide`. Finalidades omitidas ou com `undefined` não mudam.

```ts
import type { ConsentChoices } from 'lgpder';

const choices: ConsentChoices<keyof typeof consent.purposes> = {
  analytics: 'granted',
  ads: undefined, // sem alteração
};
consent.decide(choices);
```

## `ConsentDecision`

```ts
export interface ConsentDecision {
  readonly status: DecidedStatus;
  readonly version?: string;
  readonly decidedAt: number;
}
```

Decisão registrada para uma finalidade. Objeto congelado.

- `status`: `'granted'` para concessão; `'denied'` para recusa ou revogação.
- `version`: versão da finalidade no momento da decisão; ausente se a finalidade não era versionada.
- `decidedAt`: instante da decisão, em milissegundos desde 1970-01-01T00:00:00Z, segundo o relógio configurado. O núcleo nunca compara instantes: a decisão vigente é a última gravada, qualquer que seja o seu `decidedAt`, e um relógio adiantado, atrasado ou que volta no tempo é aceito.

No exemplo, a decisão ocorre em 2026-10-31T12:00:00.000Z (`1793448000000`):

```ts
consent.decide({ analytics: 'granted', ads: 'denied' });
consent.getSnapshot().record.decisions.analytics;
// { status: 'granted', version: '2026-10', decidedAt: 1793448000000 }
consent.getSnapshot().record.decisions.ads; // { status: 'denied', decidedAt: 1793448000000 }
```

## `ConsentRecord`

```ts
export interface ConsentRecord<P extends string = string> {
  readonly format: 1;
  readonly decisions: { readonly [K in P]?: ConsentDecision };
}
```

Registro serializável das decisões. É o que a aplicação persiste, com `JSON.stringify(snapshot.record)`, e devolve em `record` ou em `restore()`. Não contém identificador atribuído pelo LGPDer; o instante de cada decisão, conforme a precisão do relógio (`now`), pode singularizar o dispositivo. Objeto congelado.

- `format`: versão do formato do registro, independente das versões das finalidades e do pacote.
- `decisions`: última decisão de cada finalidade configurada que tenha decisão, vigente ou desatualizada, na ordem da configuração.

`JSON.stringify(snapshot.record)` é determinístico para o mesmo estado: chaves `format` e `decisions`, nessa ordem; decisões na ordem da configuração; campos de cada decisão na ordem `status`, `version`, `decidedAt`. Cada finalidade ocupa, em geral, de 50 a 90 bytes, conforme o tamanho do id e da versão.

No exemplo, a decisão ocorre em 2026-10-31T12:00:00.000Z:

```ts
consent.decide({ analytics: 'granted', ads: 'denied' });
JSON.stringify(consent.getSnapshot().record); // texto abaixo, formatado para leitura
```

```json
{
  "format": 1,
  "decisions": {
    "analytics": { "status": "granted", "version": "2026-10", "decidedAt": 1793448000000 },
    "ads": { "status": "denied", "decidedAt": 1793448000000 }
  }
}
```

Todo registro recebido, na hidratação ou em `restore`, é tratado como dado não confiável: é validado de forma estrita, sem lançar erro, e o que for inválido vira ausência de decisão. Nenhuma falha de leitura concede consentimento. Texto é lido com `JSON.parse`, e texto inválido, inclusive `''`, vale registro vazio. Formato aceito:

| Caminho                    | Tipo                      | Obrigatório | Regra                                                              |
| -------------------------- | ------------------------- | ----------- | ------------------------------------------------------------------ |
| raiz                       | objeto simples            | sim         | outro tipo invalida o registro inteiro                             |
| `format`                   | número `1`                | sim         | qualquer outro valor (inclusive `"1"`) invalida o registro inteiro |
| `decisions`                | objeto simples            | sim         | só as chaves iguais a ids configurados são lidas                   |
| `decisions.<id>`           | objeto simples            | não         | entrada inválida é descartada sozinha                              |
| `decisions.<id>.status`    | `"granted"` ou `"denied"` | sim         |                                                                    |
| `decisions.<id>.version`   | texto não vazio           | não         | ausente: a finalidade não era versionada na decisão                |
| `decisions.<id>.decidedAt` | inteiro seguro >= 0       | sim         | milissegundos desde a época Unix                                   |

Somente propriedades próprias são consideradas, e as chaves do registro nunca são iteradas: o núcleo procura apenas os ids configurados. Campos extras são ignorados e não copiados, e qualquer exceção durante a leitura (getter que lança, proxy) resulta em registro vazio. A chave `__proto__` presente em texto JSON nunca é lida, porque não é id válido. Objetos criados em outro realm (por exemplo, em um iframe) não são objetos simples e resultam em registro vazio; nesse caso, passe o texto JSON. Não há limite de tamanho: o custo é proporcional ao número de finalidades configuradas, e a origem do dado é controlada pela aplicação.

## `ConsentSnapshot`

```ts
export interface ConsentSnapshot<P extends string = string> {
  readonly status: { readonly [K in P]: ConsentStatus };
  readonly outdated: { readonly [K in P]: boolean };
  readonly record: ConsentRecord<P>;
}
```

Estado imutável das preferências em um instante. Objeto congelado, assim como `status`, `outdated`, `record`, `record.decisions` e cada decisão.

- `status`: situação efetiva de cada finalidade configurada, na ordem da configuração.
- `outdated`: `true` quando a finalidade tem decisão registrada sob versão diferente da atual; nesse caso a situação é `'pending'` (veja [Versão e `outdated`](#versão-e-outdated)).
- `record`: registro serializável correspondente a este estado.

Snapshots consecutivos compartilham as partes inalteradas: cada decisão inalterada mantém a referência, `status` mantém a referência se nenhuma situação mudou e `outdated` mantém a referência se nenhum sinal mudou; `record` e `record.decisions` são objetos novos a cada alteração. Tentar alterar um snapshot lança `TypeError` em modo estrito e não afeta o estado. Os objetos públicos têm protótipo `Object.prototype` (e `changed` é um array comum), por isso `assert.deepStrictEqual` aceita literais como valor esperado.

```ts
consent.getSnapshot();
// {
//   status: { analytics: 'pending', ads: 'pending', healthReminders: 'pending' },
//   outdated: { analytics: false, ads: false, healthReminders: false },
//   record: { format: 1, decisions: {} },
// }
```

## `ChangeSource`

```ts
export type ChangeSource = 'decision' | 'restore';
```

Origem de uma alteração:

- `'decision'`: decisão registrada nesta instância por `decide`, `grantAll` ou `denyAll`.
- `'restore'`: registro externo adotado por `restore`. Não representa nova manifestação do titular.

A hidratação não notifica. Restauração e hidratação nunca representam manifestação do titular; por isso, evidências de decisões do titular são registradas somente a partir de notificações de origem `'decision'` (veja [Prova do consentimento e evidências](persistencia.md#prova-do-consentimento-e-evidências)).

```ts
import type { ChangeSource } from 'lgpder';

// Somente decisões registradas nesta página representam nova manifestação do titular.
export const isLocalDecision = (source: ChangeSource): boolean => source === 'decision';
```

## `ConsentChange`

```ts
export interface ConsentChange<P extends string = string> {
  readonly source: ChangeSource;
  readonly changed: readonly P[];
  readonly snapshot: ConsentSnapshot<P>;
  readonly previous: ConsentSnapshot<P>;
}
```

Notificação entregue aos ouvintes após cada alteração do registro. Objeto congelado.

- `source`: origem da alteração.
- `changed`: finalidades cuja entrada no registro mudou, na ordem da configuração; array congelado, nunca vazio. Em alterações de origem `'restore'`, pode incluir finalidades cuja situação efetiva não mudou (veja [`changed` em restaurações](#changed-em-restaurações)).
- `snapshot`: estado logo após esta alteração.
- `previous`: estado logo antes desta alteração.

```ts
import type { ConsentChange } from 'lgpder';

type PurposeId = keyof typeof consent.purposes;

// Finalidades cuja situação efetiva mudou nesta alteração.
export const statusChanges = ({ changed, previous, snapshot }: ConsentChange<PurposeId>) =>
  changed.filter((id) => previous.status[id] !== snapshot.status[id]);
```

## `ConsentListener`

```ts
export type ConsentListener<P extends string = string> = (change: ConsentChange<P>) => void;
```

Função chamada após cada alteração do registro, com a notificação como único argumento. O valor devolvido é ignorado, e ouvintes sem parâmetros, como o callback do `useSyncExternalStore`, funcionam.

```ts
import type { ConsentListener } from 'lgpder';

const logChange: ConsentListener<keyof typeof consent.purposes> = ({ source, changed }) => {
  console.info(`consentimento (${source}): ${changed.join(', ')}`);
};
consent.subscribe(logChange);
```

## Tipagem

- `P` é inferido das chaves de `options.purposes` como união literal, inclusive quando a configuração está em variável sem `as const`.
- `C` é inferido da união dos valores de `category`: literal quando escrito no objeto da chamada ou com `as const`; `string` quando vem de variável sem `as const`; `never` quando nenhuma finalidade declara categoria.
- A proteção contra erro de digitação na categoria fica com a aplicação, com `satisfies`:

```ts
import type { PurposeConfig } from 'lgpder';

type Category = 'statistics' | 'marketing';

export const PURPOSES = {
  analytics: { version: '2026-10', category: 'statistics' },
  // @ts-expect-error erro de compilação: 'marketng' está fora da união Category
  ads: { category: 'marketng' },
} as const satisfies Record<string, PurposeConfig<Category>>;
```

- Configuração anotada como `Record<string, PurposeConfig>`, por exemplo vinda do servidor, produz `ConsentManager<string, string>`; a validação em tempo de execução cobre ids e valores.
- `ConsentManager<P, C>` é atribuível a `ConsentManager` (padrões `string`), para extensões que aceitam qualquer gerenciador.
- São erros de compilação: propriedade desconhecida em finalidade, opção desconhecida, id desconhecido em `decide`, valor diferente de `'granted'`, `'denied'` ou `undefined` em `decide`, argumentos em `grantAll` e `denyAll` e atribuição a qualquer campo de snapshot.
- Entradas aceitam `undefined` explícito em `version`, `category`, `individualGrant`, `record`, `now` e nos valores de `decide`, o que é compatível com `exactOptionalPropertyTypes`.
- `keyof typeof consent.purposes` devolve `P`; não há aliases de tipo para os ids.

## Erros

Erros de programação lançam instâncias nativas de `TypeError` ou `RangeError`, de forma síncrona e sem efeito parcial: em qualquer erro, nada é alterado e nada é notificado. São erros que se corrigem no código, e não condições a tratar em tempo de execução. Os objetos de erro não são congelados e não têm `cause`. Dados salvos nunca causam erro: `restore` e a hidratação nunca lançam.

As mensagens são fixas, em português do Brasil, com o prefixo `[lgpder] ` e terminadas em ponto, e nunca reproduzem valores lidos de registros. Na tabela, `{json(x)}` é `JSON.stringify(x)` aplicado a um texto (o texto entre aspas duplas, com escapes), e `{tipo(x)}` é `null` para `null`, `array` para arrays e, nos demais casos, o resultado de `typeof x`.

| Função                           | Classe       | Quando                                          | Mensagem                                                                                                |
| -------------------------------- | ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `createConsentManager`           | `TypeError`  | `options` não é objeto simples                  | `[lgpder] As opções devem ser um objeto simples; recebido: {tipo(options)}.`                            |
| `createConsentManager`           | `TypeError`  | chave desconhecida em `options`                 | `[lgpder] Opção desconhecida: {json(chave)}.`                                                           |
| `createConsentManager`           | `TypeError`  | `purposes` não é objeto simples                 | `[lgpder] "purposes" deve ser um objeto simples; recebido: {tipo(purposes)}.`                           |
| `createConsentManager`           | `TypeError`  | `purposes` sem finalidades                      | `[lgpder] "purposes" deve declarar ao menos uma finalidade.`                                            |
| `createConsentManager`           | `TypeError`  | id de finalidade inválido                       | `[lgpder] Identificador de finalidade inválido: {json(id)}.`                                            |
| `createConsentManager`           | `TypeError`  | configuração da finalidade não é objeto simples | `[lgpder] A configuração da finalidade {json(id)} deve ser um objeto simples; recebido: {tipo(valor)}.` |
| `createConsentManager`           | `TypeError`  | chave desconhecida na finalidade                | `[lgpder] A finalidade {json(id)} tem a propriedade desconhecida {json(chave)}.`                        |
| `createConsentManager`           | `TypeError`  | `version` inválida                              | `[lgpder] A versão da finalidade {json(id)} deve ser um texto não vazio.`                               |
| `createConsentManager`           | `TypeError`  | `category` inválida                             | `[lgpder] A categoria da finalidade {json(id)} deve ser um identificador válido.`                       |
| `createConsentManager`           | `TypeError`  | `individualGrant` inválido                      | `[lgpder] "individualGrant" da finalidade {json(id)} deve ser booleano.`                                |
| `createConsentManager`           | `TypeError`  | `now` não é função                              | `[lgpder] "now" deve ser uma função; recebido: {tipo(now)}.`                                            |
| `decide`                         | `TypeError`  | `choices` não é objeto simples                  | `[lgpder] As decisões devem ser um objeto simples; recebido: {tipo(choices)}.`                          |
| `decide`                         | `RangeError` | finalidade não configurada em `decide`          | `[lgpder] Finalidade desconhecida: {json(chave)}.`                                                      |
| `decide`                         | `TypeError`  | valor inválido em `decide`                      | `[lgpder] A decisão para {json(id)} deve ser "granted" ou "denied"; recebido: {tipo(valor)}.`           |
| `decide`, `grantAll` e `denyAll` | `TypeError`  | relógio devolveu valor inválido                 | `[lgpder] "now" deve retornar um inteiro não negativo (milissegundos desde a época Unix).`              |
| `subscribe`                      | `TypeError`  | `listener` não é função                         | `[lgpder] O ouvinte deve ser uma função; recebido: {tipo(listener)}.`                                   |

Exemplos:

| Chamada                                                         | Mensagem                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `createConsentManager({ purposes: [] })`                        | `[lgpder] "purposes" deve ser um objeto simples; recebido: array.`                 |
| `createConsentManager({ purposes: { '*': {} } })`               | `[lgpder] Identificador de finalidade inválido: "*".`                              |
| `createConsentManager({ purposes: { ads: { verison: '1' } } })` | `[lgpder] A finalidade "ads" tem a propriedade desconhecida "verison".`            |
| `consent.decide({ analytic: 'granted' })`                       | `[lgpder] Finalidade desconhecida: "analytic".` (`RangeError`)                     |
| `consent.decide({ ads: true })`                                 | `[lgpder] A decisão para "ads" deve ser "granted" ou "denied"; recebido: boolean.` |
| `consent.subscribe('x')`                                        | `[lgpder] O ouvinte deve ser uma função; recebido: string.`                        |

Objeto simples é um valor com `typeof` igual a `'object'`, diferente de `null`, cujo protótipo é `Object.prototype` ou `null`. Arrays, instâncias de `Map` e objetos criados em outro realm não são objetos simples.

As mensagens não devem ser usadas para controle de fluxo; mudanças nelas seguem o [versionamento do pacote](../README.md#versionamento-do-pacote).

### Erros de ouvintes

A exceção lançada por um ouvinte é capturada: os ouvintes seguintes são chamados, e a operação que originou a notificação retorna normalmente. O valor lançado é relançado intacto por `queueMicrotask`, uma vez por erro, para que o defeito continue visível. No navegador, ele aparece como exceção não tratada; no Node.js, gera `uncaughtException`, que encerra o processo por padrão. Trate os erros dentro do próprio ouvinte, com `try/catch`:

```ts
consent.subscribe(({ snapshot }) => {
  try {
    applyConsent(snapshot.status);
  } catch (error) {
    reportIntegrationError(error);
  }
});
```

`applyConsent` e `reportIntegrationError` são funções da aplicação.

### Ouvintes em laço

Não há limite de cascata. Ouvintes que alteram o estado indefinidamente, como dois ouvintes que alternam a mesma finalidade entre `'granted'` e `'denied'`, criam um laço infinito, que é defeito da aplicação.

## Notificações

Há notificação se e somente se o registro muda: uma chamada efetiva de `decide`, `grantAll` ou `denyAll` gera uma notificação de origem `'decision'`, e um `restore` que altera alguma entrada gera uma notificação de origem `'restore'`. Criação, hidratação, chamadas sem efeito e chamadas que lançam erro não notificam. A notificação é entregue somente aos assinantes da instância, sem eventos globais e sem rede. Cada notificação é um objeto [`ConsentChange`](#consentchange) congelado.

### Ordem

Uma operação efetiva segue esta ordem:

1. valida a entrada;
2. calcula as mudanças;
3. lê o relógio (somente `decide`, `grantAll` e `denyAll`);
4. confirma a alteração: a partir daqui, `getSnapshot()` devolve o novo estado;
5. notifica os ouvintes de forma síncrona, na ordem de inscrição.

Quando a chamada não ocorre dentro de um ouvinte, todas as notificações, inclusive as enfileiradas por ouvintes, são entregues antes de ela retornar.

### Reentrância

`decide`, `grantAll`, `denyAll` e `restore` chamados dentro de um ouvinte são validados e confirmados imediatamente (`getSnapshot()` reflete a mudança na hora) e retornam antes de sua notificação ser entregue. A notificação entra no fim de uma fila FIFO e só é entregue depois que a notificação atual chegar a todos os ouvintes. Todos os ouvintes recebem as notificações na ordem de confirmação, e o `previous` de cada notificação é o `snapshot` da anterior.

### Inscrições

- Cada `subscribe` cria uma inscrição independente: a mesma função inscrita duas vezes é chamada duas vezes por notificação. A função de cancelamento é idempotente e remove somente a sua inscrição.
- Cancelar uma inscrição durante a entrega tem efeito imediato: a inscrição cancelada não é chamada para nenhuma notificação que ainda não recebeu, inclusive a atual.
- Uma inscrição recebe somente notificações de alterações confirmadas depois dela. Inscrição criada durante uma entrega não recebe a notificação em curso nem as já enfileiradas.

### Estado inicial das integrações

A hidratação não notifica, e as alterações confirmadas antes de uma inscrição nunca chegam a ela. A receita de persistência, por exemplo, adota o registro salvo com `restore` já ao ser conectada, em geral antes de as integrações se inscreverem. Por isso uma integração aplica primeiro o estado de `getSnapshot()` e depois compara cada notificação com a situação que já aplicou, como o ouvinte do [início rápido](../README.md#início-rápido). Assim, quem volta ao site com `analytics` concedida tem o tratamento iniciado na carga da página.

### `changed` em restaurações

Em notificações de origem `'restore'`, `changed` lista as finalidades cuja entrada no registro mudou (adicionada, removida ou alterada) e pode incluir finalidades cuja situação efetiva não mudou, por exemplo quando só `decidedAt` mudou. Integrações reagem à situação efetiva (`snapshot.status`, comparada com `previous.status` ou com a situação já aplicada), e não à presença em `changed`.

## SSR e React

Os exemplos desta seção usam `PURPOSES`, `PurposeId` e `consent` da [ligação com `localStorage`](persistencia.md#ligação-com-localstorage).

O núcleo funciona igual no servidor, sem `window`, e nunca acessa armazenamento, nem mesmo um `localStorage` global oferecido pelo Node.js. A receita usa `window.localStorage`, ausente no servidor, e a leitura falha de forma segura, mantendo o estado em memória.

Uma instância criada em escopo de módulo no servidor é compartilhada por todas as requisições e nunca deve receber decisões. Para usar o registro do titular no servidor, crie uma instância por requisição:

```ts
// No servidor: o valor do cookie __Host-lgpder da requisição, já decodificado pelo framework.
export function createRequestConsent(cookieValue: string | undefined) {
  return createConsentManager({ purposes: PURPOSES, record: cookieValue });
}
```

No React, use `useSyncExternalStore` com as funções do gerenciador, que não dependem de `this`. O hook lê o gerenciador de um contexto, para usar a instância da requisição no servidor:

```ts
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ConsentManager } from 'lgpder';

// No navegador, a instância de módulo. No servidor, o provedor deste contexto entrega a instância
// da requisição, criada por createRequestConsent.
export const ConsentContext = createContext<ConsentManager<PurposeId>>(consent);

export function useConsent() {
  const manager = useContext(ConsentContext);
  // Registro só no navegador (localStorage): o servidor e a hidratação usam o snapshot sem
  // decisões. Registro também no servidor (cookie): passe manager.getSnapshot como terceiro
  // argumento.
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getServerSnapshot);
}
```

- Registro só no navegador (`localStorage`): use `getServerSnapshot` como terceiro argumento, para que o servidor e a hidratação partam do estado sem decisões.
- Registro vindo de cookie: use `getSnapshot` nos dois lados. No servidor, envolva a renderização no provedor de `ConsentContext`, com a instância criada por `createRequestConsent` para a requisição. Sem o provedor, o hook leria a instância de módulo, vazia no servidor, e a hidratação divergiria do navegador.

O callback do React é chamado com a notificação e a ignora. Outros frameworks usam `subscribe` e `getSnapshot` diretamente: a referência do snapshot só muda quando há notificação, o que permite comparar por referência e memoizar.
