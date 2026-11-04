# LGPDer

Núcleo leve e tipado de gerenciamento de consentimento por finalidade para aplicações web, tendo a LGPD como referência normativa.

## Aviso: o LGPDer não garante conformidade com a LGPD

O LGPDer é uma biblioteca técnica para registrar, consultar, alterar e revogar decisões de consentimento por finalidade. Usar o LGPDer não coloca, por si só, uma aplicação em conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais, LGPD) nem com qualquer outra norma. A conformidade depende do contexto do tratamento e da forma como a aplicação utiliza a biblioteca.

Continuam sob responsabilidade do controlador, entre outros pontos:

- escolher a hipótese legal de cada tratamento, lembrando que o consentimento é apenas uma das hipóteses previstas no art. 7º da LGPD;
- definir finalidades determinadas e informar o titular de forma clara, adequada e ostensiva antes de pedir o consentimento (art. 8º, § 4º, e art. 9º);
- construir a interface de coleta, recusa e revogação, com procedimento gratuito e facilitado para revogar (art. 8º, § 5º);
- condicionar de fato o tratamento às decisões registradas e encerrá-lo quando o consentimento for revogado;
- comprovar que o consentimento foi obtido em conformidade com a lei (art. 8º, § 2º);
- observar as regras específicas para dados pessoais sensíveis (art. 11) e para dados de crianças e adolescentes (art. 14 da LGPD e, quando aplicável, Lei nº 15.211/2025);
- atender aos direitos dos titulares (art. 18) e às demais obrigações da LGPD.

Os registros mantidos pelo LGPDer (finalidade, decisão, data e versão) apoiam essas tarefas, mas não constituem, sozinhos, prova do consentimento. Eles são gerados e armazenados no ambiente da aplicação e podem ser alterados nesse ambiente.

Esta documentação distingue três tipos de orientação. Obrigações legais são indicadas com o dispositivo correspondente da LGPD. Recomendações baseadas em guias da ANPD, como o Guia Orientativo: Cookies e Proteção de Dados Pessoais, são boas práticas, e não obrigações legais. Comportamentos e escolhas de implementação da biblioteca são decisões técnicas, e não exigências da LGPD.

O LGPDer não coleta dados pessoais por iniciativa própria, não realiza rastreamento nem telemetria e não envia informações a serviços externos. A biblioteca é executada inteiramente no ambiente da aplicação, e seus mantenedores não recebem dados das aplicações que a utilizam.

Este aviso tem caráter informativo e não constitui orientação jurídica. Avalie o uso da biblioteca com o encarregado ou com a assessoria jurídica da sua organização.

## O que é e o que não é

O LGPDer é um núcleo de gerenciamento de consentimento, e não uma plataforma de privacidade: uma base pequena, independente e reutilizável. O núcleo:

- recebe as finalidades que o controlador decidiu basear em consentimento;
- mantém em memória a última decisão do titular para cada finalidade;
- informa a situação efetiva de cada finalidade;
- registra, altera e revoga decisões, uma a uma ou em lote;
- produz um registro serializável e aceita registros salvos;
- notifica os assinantes, de forma síncrona, quando o registro muda.

É leve (sem dependências de runtime), fortemente tipado, independente de framework e de interface gráfica, sem rastreamento nem telemetria e sem serviços externos.

Ficam fora do núcleo:

- banners, modais ou qualquer interface, e componentes para React, Vue, Angular ou outros frameworks;
- geração de Política de Privacidade ou de Política de Cookies, dashboard ou painel administrativo;
- backend, banco de dados, autenticação e gestão de solicitações de titulares;
- integrações automáticas com terceiros, carregamento automático de scripts e analytics, tracking ou telemetria;
- leitura ou gravação de armazenamento (Web Storage, cookies, IndexedDB) dentro do pacote;
- expiração automática de decisões, histórico ou trilha de auditoria de decisões e qualquer operação de "esquecer decisões" apresentada como recurso.

Os itens que podem ser construídos como extensão estão em [Extensões futuras](#extensões-futuras).

## Instalação e requisitos

```sh
npm install lgpder
```

- Pacote somente ESM, sem dependências de runtime.
- Node.js 22.12 ou superior, quando usado em Node. A partir dessa versão, módulos ESM também podem ser carregados por `require`, sem flag.
- Navegadores com suporte a ES2022 (por exemplo, `Object.hasOwn`: Chrome e Edge 93+, Firefox 92+, Safari 15.4+).
- Projetos ESM em TypeScript: TypeScript 5.6 ou superior, com `moduleResolution` igual a `node16`, `nodenext` ou `bundler`.
- Projetos CommonJS em TypeScript, em que o `import` é compilado para `require`: TypeScript 5.8 ou superior com `module` igual a `nodenext`, ou `node20` a partir do 5.9. Com `node16`, `node18` ou versões anteriores do TypeScript, carregue o pacote com `import()` dinâmico.

## Início rápido

```ts
import { createConsentManager } from 'lgpder';

const consent = createConsentManager({
  purposes: {
    analytics: { version: '2026-10', category: 'statistics' },
    ads: { category: 'marketing' },
    healthReminders: { version: '1', category: 'health', individualGrant: true },
  },
});

// Hidratação e restaurações anteriores à inscrição não notificam: comece pelo estado atual.
let analyticsActive = consent.getSnapshot().status.analytics === 'granted';
if (analyticsActive) startAnalytics();

consent.subscribe(({ snapshot }) => {
  const granted = snapshot.status.analytics === 'granted';
  if (granted === analyticsActive) return;
  analyticsActive = granted;
  if (granted) startAnalytics();
  else stopAnalytics(); // revogação ou restauração: encerrar o tratamento
});

// O titular escolheu "Aceitar todas": healthReminders fica de fora (individualGrant).
consent.grantAll();
consent.getSnapshot().status;
// { analytics: 'granted', ads: 'granted', healthReminders: 'pending' }

// O titular desligou a publicidade: revogar tem a mesma forma de chamada de conceder.
consent.decide({ ads: 'denied' });

// O titular escolheu "Recusar todas": alcança todas as finalidades, inclusive healthReminders.
consent.denyAll();
consent.getSnapshot().status;
// { analytics: 'denied', ads: 'denied', healthReminders: 'denied' }
```

`startAnalytics` e `stopAnalytics` são funções da aplicação. A integração aplica primeiro o estado atual e depois reage somente quando a situação de `analytics` muda (veja [Estado inicial das integrações](docs/api.md#estado-inicial-das-integrações)).

Chame `decide`, `grantAll` e `denyAll` somente em resposta a uma ação explícita do titular, nunca por inferência (veja as [responsabilidades da aplicação](docs/lgpd.md#responsabilidades-da-aplicação)). Com a [receita de persistência](docs/persistencia.md), a interface usa as ações da receita no lugar dessas três funções.

## Conceitos essenciais

- **Finalidade**: propósito determinado de um tratamento baseado em consentimento, declarado em `purposes` e identificado por um id. É a unidade de decisão: cada decisão se refere a exatamente uma finalidade declarada, e não existe consentimento global, consentimento de categoria nem id com significado especial (curinga). A configuração contém apenas os tratamentos que o controlador decidiu basear em consentimento (art. 7º, I), sem itens "sempre ativos", categorias predefinidas nem base legal presumida.
- **Categoria**: rótulo opcional que agrupa finalidades, por exemplo na interface, sem estado de consentimento nem operação própria.
- **Situação efetiva** (`ConsentStatus`): `'pending'`, `'granted'` ou `'denied'`. Somente `'granted'` autoriza o tratamento baseado em consentimento. A ausência de decisão é `'pending'` e nunca equivale a consentimento.
- **Decisão**: concessão (`'granted'`) ou recusa (`'denied'`) registrada para uma finalidade, com a versão vigente e o instante (`decidedAt`). A recusa é uma decisão estável, e revogar é registrar `'denied'`, com a mesma forma de chamada de conceder.
- **Versão e `outdated`**: versão opcional e opaca por finalidade. Decisão registrada sob outra versão vale `'pending'` e é sinalizada em `outdated`, sem ser revogação.
- **Registro** (`ConsentRecord`): objeto serializável com a última decisão de cada finalidade, que a aplicação persiste e devolve na criação, em `options.record` (hidratação), ou depois dela, em `restore()` (restauração). Todo registro recebido é tratado como dado não confiável.
- **Origem da alteração** (`ChangeSource`): `'decision'` para decisões registradas na instância e `'restore'` para registros adotados. Restauração e hidratação nunca representam manifestação do titular.
- **`individualGrant`**: finalidade marcada fica fora de `grantAll()` e só é concedida quando nomeada em `decide()`; `denyAll()` a inclui. É uma decisão técnica que apoia os requisitos de consentimento para dados sensíveis e de crianças, sem substituir a forma específica e destacada, que é dever da interface.

As regras completas estão na referência da API: [situação efetiva](docs/api.md#consentstatus), [recusa e revogação](docs/api.md#decidedstatus), [versão e `outdated`](docs/api.md#versão-e-outdated), [registro](docs/api.md#consentrecord), [origem](docs/api.md#changesource) e [`individualGrant`](docs/api.md#purposeconfig).

## API em resumo

A única exportação de runtime é `createConsentManager`; as demais são tipos (`ConsentManager`, `ConsentOptions`, `PurposeConfig`, `ConsentStatus`, `DecidedStatus`, `ConsentChoices`, `ConsentDecision`, `ConsentRecord`, `ConsentSnapshot`, `ChangeSource`, `ConsentChange` e `ConsentListener`). A [referência da API](docs/api.md) traz assinaturas, parâmetros, retorno, erros com as mensagens exatas, exemplos, tipagem, notificações, SSR e React.

| Membro                                                              | O que faz                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`createConsentManager(options)`](docs/api.md#createconsentmanager) | Cria o gerenciador a partir das finalidades e, opcionalmente, de um registro salvo e de um relógio. |
| [`purposes`](docs/api.md#purposes)                                  | Cópia congelada da configuração das finalidades.                                                    |
| [`getSnapshot()`](docs/api.md#getsnapshot)                          | Devolve o estado atual: situação, `outdated` e registro.                                            |
| [`getServerSnapshot()`](docs/api.md#getserversnapshot)              | Devolve um estado sem decisões, para a renderização no servidor e a hidratação.                     |
| [`decide(choices)`](docs/api.md#decidechoices)                      | Registra, altera ou revoga decisões em uma única operação atômica.                                  |
| [`grantAll()`](docs/api.md#grantall)                                | Concede as finalidades sem `individualGrant: true`.                                                 |
| [`denyAll()`](docs/api.md#denyall)                                  | Recusa ou revoga todas as finalidades.                                                              |
| [`restore(record)`](docs/api.md#restorerecord)                      | Substitui todas as decisões pelo conteúdo válido de um registro externo.                            |
| [`subscribe(listener)`](docs/api.md#subscribelistener)              | Inscreve um ouvinte, chamado de forma síncrona após cada alteração do registro.                     |

## Persistência

O núcleo não lê nem grava armazenamento: a aplicação persiste `snapshot.record` e o devolve na criação ou em `restore()`. O guia de [persistência e sincronização entre abas](docs/persistencia.md) traz a receita oficial, que é código da aplicação, as ligações com `localStorage` e com cookie e seus cuidados, a chegada de uma revogação às outras abas, o armazenamento assíncrono e o backend, o ciclo de vida do registro, o lote por categoria e o registro de evidências do consentimento.

## Privacidade e segurança

- O registro guarda somente, por finalidade, a situação decidida, a versão e o instante da decisão, além do campo `format`. Nenhum identificador do titular, IP, user agent, idioma ou texto exibido.
- O estado fica em memória, na instância do gerenciador, durante a vida dela. A persistência é escolha da aplicação, e o prazo no armazenamento segue a política dela e os limites do navegador (veja [Ciclo de vida do registro](docs/persistencia.md#ciclo-de-vida-do-registro)).
- O núcleo usa somente recursos do ECMAScript 2022, `Date.now` (relógio padrão) e `queueMicrotask` (para relançar erros de ouvintes). Não acessa `window`, `document`, `navigator`, armazenamento, cookies, rede, timers nem `process`, não gera identificadores e não registra logs.
- Sem `eval`, `new Function` ou `import()` dinâmico, sem dependências de runtime e sem efeito colateral na importação.
- Dados salvos são validados de forma estrita e nunca causam erro; o que for inválido vira ausência de decisão. Nenhum caminho de erro concede consentimento (falha fechada).
- Todo objeto público é congelado, e nenhum objeto recebido (configuração, escolhas, registro) é retido por referência.
- O instante de cada decisão, na precisão de milissegundos do relógio padrão, pode singularizar o navegador e funcionar como pseudoidentificador. Por isso a ligação com cookie cria o gerenciador com relógio arredondado ao dia; a opção [`now`](docs/api.md#consentoptions) permite escolher a precisão em qualquer caso.
- O armazenamento do navegador pode ser lido ou alterado por qualquer script da mesma origem: proteja a aplicação contra XSS e avalie os scripts de terceiros que ela carrega.
- Com cookie, o registro é enviado ao servidor em toda requisição ao domínio, e outros hosts do mesmo domínio registrável podem gravar cookies visíveis à página. Os cuidados estão na [ligação com cookie](docs/persistencia.md#ligação-com-cookie).

Conforme o contexto, por exemplo quando associado a uma conta, o registro pode ser dado pessoal (art. 5º, I).

## LGPD

O guia [O LGPDer e a LGPD](docs/lgpd.md) relaciona a biblioteca com a lei, tema a tema, separando:

- **obrigação legal**: o que a LGPD ou outra lei exige, com o dispositivo, como o procedimento gratuito e facilitado para revogar o consentimento (art. 8º, § 5º);
- **boa prática**: recomendação de guia da ANPD, com a fonte, como o botão de rejeitar com o mesmo destaque do aceite, as opções desativadas por padrão e o novo consentimento após mudanças, que não são exigências literais da LGPD;
- **decisão técnica do LGPDer**: escolha de implementação, que a LGPD não exige, como os estados `'pending'`, `'granted'` e `'denied'`, a invalidação por versão, o `decidedAt`, as notificações e o `individualGrant`.

O guia traz também as responsabilidades da aplicação, o versionamento e reconsentimento, a expiração (a LGPD não estabelece prazo de validade nem renovação periódica do consentimento) e as fontes consultadas.

## Extensões futuras

Nenhuma das extensões abaixo existe hoje. O núcleo permite cada uma sem reestruturação, porque elas usam somente a API pública, o formato do registro e o tipo `ConsentManager<P, C>`; as que reagem à situação das finalidades leem `getSnapshot()` ao se inscrever, porque a hidratação e as restaurações anteriores à inscrição não notificam.

- Interface (banner, modal, central de preferências): pacote separado que recebe `ConsentManager<P, C>`, com textos indexados por `Record<P, string>`; `outdated` informa o que mudou, e `individualGrant`, o que exige pergunta específica.
- Componentes e bindings (React, Vue, Svelte, Angular): `subscribe` e `getSnapshot` com referência estável; o React usa `useSyncExternalStore` diretamente (veja [SSR e React](docs/api.md#ssr-e-react)).
- Adaptadores de armazenamento (Web Storage, cookie, IndexedDB, backend): a [receita de persistência](docs/persistencia.md) promovida a pacote ou subpath (por exemplo, `lgpder/web-storage`) sobre `restore`, `subscribe` e `snapshot.record`.
- Sincronização entre abas por `BroadcastChannel`: ouvinte que publica `snapshot.record` somente em notificações de origem `'decision'` (para não criar laço) e chama `restore` nas demais instâncias.
- Evidências e auditoria no backend: ouvinte que filtra `source === 'decision'` e envia as decisões de `changed`, como em [Prova do consentimento e evidências](docs/persistencia.md#prova-do-consentimento-e-evidências).
- Integrações com terceiros (por exemplo, modos de consentimento de plataformas de anúncios ou analytics): adaptadores que traduzem a situação em sinais externos, aplicando `getSnapshot()` ao se inscrever e depois cada `snapshot.status` notificado. O núcleo não conhece terceiros.
- Carregamento condicional de scripts: ouvinte que aplica a situação de `getSnapshot()` ao se inscrever e, a cada notificação, compara a situação notificada com a já aplicada, como no [início rápido](#início-rápido).
- Expiração ou renovação e versão global como opções nativas, em versão minor. Hoje, a renovação é política da aplicação a partir de `decidedAt` (veja [Expiração](docs/lgpd.md#expiração)), e uma constante compartilhada entre finalidades faz o papel de versão global (veja [Versão e `outdated`](docs/api.md#versão-e-outdated)).
- Marcações adicionais por finalidade (por exemplo, dado sensível): nova chave de configuração em versão minor do núcleo. Extensões não injetam chaves: como chaves desconhecidas são recusadas, elas envolvem o gerenciador.
- Novo formato do registro, em versão major (veja [Ciclo de vida do registro](docs/persistencia.md#ciclo-de-vida-do-registro)).

Gestão de solicitações de titulares, backend, dashboard, autenticação e verificação de idade ficam fora do núcleo: o registro não identifica o titular, e a associação é feita pela aplicação. Analytics, tracking e telemetria são contrários ao princípio de privacidade por padrão do projeto e não serão adicionados ao núcleo.

## Versionamento do pacote

O pacote segue o Versionamento Semântico (SemVer) a partir da versão 0.1.0:

- adições são publicadas em versão minor;
- a partir da 1.0.0, mudanças de semântica ou do formato do registro exigem versão major; antes disso, entram em versão minor, com registro no CHANGELOG;
- as mensagens de erro são documentadas, mas não devem ser usadas para controle de fluxo; mudanças nelas são registradas no CHANGELOG.

## Licença

A licença do LGPDer ainda não foi definida e será escolhida antes da publicação do pacote.
