<h1 align="center">
  <img src="docs/logo.svg" width="30%" alt="LGPDer">
</h1>

<p align="center">
  Gerenciador de consentimento open source para a LGPD: banner, central de preferências, bloqueio de scripts e Google Consent Mode v2 com poucas linhas de configuração.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lgpder"><img src="https://img.shields.io/npm/v/lgpder" alt="Versão no npm"/></a>
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="Licença: MIT"/>
  <img src="https://img.shields.io/badge/status-early%20development-orange" alt="Status: em desenvolvimento inicial"/>
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6.0"/>
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen" alt="Nenhuma dependência de runtime"/>
  <img src="https://img.shields.io/badge/ESM-only-F7DF1E?logo=javascript&logoColor=black" alt="Somente ESM"/>
  <img src="https://img.shields.io/badge/gzip-core%202.3%20kB%20%7C%20all%2014.1%20kB-blue" alt="Tamanho: núcleo 2,3 kB, todos os subpaths 14,1 kB gzip"/>
  <img src="https://img.shields.io/badge/coverage-100%25-brightgreen" alt="Cobertura: 100% das linhas"/>
</p>

<p align="center">
  <a href="README.md">Read in English</a>
</p>

---

> [!IMPORTANT]
> O LGPDer é uma biblioteca técnica. Usá-lo não torna, por si só, uma aplicação conforme à LGPD. Veja o [aviso legal](#aviso-legal).

## Sumário

- [O problema](#o-problema)
- [O que o LGPDer oferece](#o-que-o-lgpder-oferece)
- [Como funciona](#como-funciona)
- [Casos de uso](#casos-de-uso)
- [Primeiros passos](#primeiros-passos)
- [Referência de configuração](#referência-de-configuração)
- [Arquitetura](#arquitetura)
- [Modo headless](#modo-headless)
- [Princípios](#princípios)
- [Privacidade e segurança](#privacidade-e-segurança)
- [Testes e qualidade de código](#testes-e-qualidade-de-código)
- [Limitações conhecidas](#limitações-conhecidas)
- [Status do projeto](#status-do-projeto)
- [Aviso legal](#aviso-legal)
- [Documentação](#documentação)
- [Como contribuir](#como-contribuir)
- [Licença](#licença)

## O problema

Sites brasileiros que usam analytics ou publicidade precisam do consentimento do titular antes de gravar cookies ou carregar rastreadores. Na prática, muitos banners de cookies são só decorativos: a tag do Google carrega antes de qualquer clique, o "rejeitar" fica escondido numa segunda tela, não há como revogar depois, e a revogação muda uma flag enquanto o rastreador continua rodando na página.

Fazer isso direito à mão significa resolver os mesmos problemas toda vez: gravar uma decisão por finalidade, persisti-la, manter as abas sincronizadas, bloquear scripts e iframes até haver consentimento, avisar o Google Consent Mode, apagar cookies na revogação e construir uma interface acessível. Plataformas comerciais de consentimento resolvem isso, mas acrescentam um script de terceiro, um painel e dados enviados a outra empresa.

O LGPDer resolve dentro da própria aplicação, como um pacote npm, sem backend e sem telemetria.

## O que o LGPDer oferece

- **Banner e central de preferências.** Web Components com Shadow DOM: "Aceitar todas", "Rejeitar todas" e "Personalizar" com o mesmo destaque, um toggle por finalidade agrupado por categoria, finalidades pendentes desligadas e um botão flutuante para revogar a qualquer momento. Textos em português, todos substituíveis.
- **Bloqueio até o consentimento.** `<script type="text/plain" data-consent="...">`, `<iframe data-consent>` e `<img data-consent>` ficam inertes até todas as finalidades listadas estarem concedidas. Iframes bloqueados mostram um placeholder com "Carregar" (só este conteúdo, só nesta página) e "Permitir sempre".
- **Revogação com efeito real.** Revogar remove iframes e pixels, executa a limpeza do código da aplicação, apaga os cookies da finalidade no host e em cada domínio pai, envia `'denied'` ao Consent Mode e, quando ainda há código rodando, recarrega a página depois de gravar a revogação.
- **Google Consent Mode v2.** Cada finalidade mapeia tipos do Consent Mode diretamente ou por integrações prontas (`google-analytics`, `google-ads`). O padrão de consentimento para o `<head>` é exportado como texto.
- **Persistência e sincronização entre abas.** `localStorage` por padrão, cookie primário para renderização no servidor, ou um adaptador próprio. A revogação numa aba chega às outras.
- **Expiração e novo consentimento.** As decisões expiram em 365 dias por padrão, e uma nova versão da finalidade pergunta de novo.
- **Prova do consentimento.** Um hook opcional e um endpoint da própria aplicação que recebe cada decisão; o horário preciso vem do backend, e nenhum identificador é gerado no navegador.
- **Núcleo headless.** Um núcleo de 2,3 kB com estado tipado, decisões atômicas e notificações, compatível com o `useSyncExternalStore` do React, para quem constrói a própria interface.
- **Acessibilidade.** WCAG 2.2 AA: navegação por teclado, foco preso no diálogo aberto, `Esc` fecha, papéis e rótulos ARIA, contraste do tema padrão, verificado com axe-core nos testes.

## Como funciona

```
init()  →  banner  →  decisão explícita  →  gravada  →  Consent Mode atualizado  →  tags bloqueadas ativadas
                                                    ↘  outras abas a adotam
revogação  →  gravada  →  iframes removidos, limpezas executadas, cookies apagados, Consent Mode negado  →  reload se sobrou código rodando
```

1. O `init` cria o núcleo, conecta o storage e adota o registro salvo. Restaurar nunca é decisão do titular.
2. Enquanto alguma finalidade está sem decisão, expirada ou com versão nova, o banner aparece.
3. Cada clique grava uma decisão por finalidade. O storage salva, a camada do Google envia o update do Consent Mode, e a camada de scripts ativa os elementos bloqueados cujas finalidades estão todas concedidas.
4. Na revogação, nesta aba ou em outra, a camada de scripts desfaz o que pode, apaga os cookies da finalidade e recarrega a página quando um script que ela ativou continua rodando.

## Casos de uso

- Sites e SPAs no Brasil que usam Google Analytics, Google Ads ou Google Tag Manager e precisam de consentimento antes de carregá-los.
- Aplicações com SSR (Next.js e similares) que precisam ler o consentimento no servidor, pelo storage em cookie.
- Aplicações com finalidades que exigem decisão específica, como dados sensíveis, por `individualGrant` e `openPreferences([...])`.
- Times com design system próprio que querem só o núcleo, o storage e o bloqueio, no modo headless.
- Quem procura uma implementação de referência de biblioteca de navegador tipada, sem dependências e com falha fechada.

## Primeiros passos

### Requisitos

- Navegadores com suporte a ES2022 (Chrome e Edge 93+, Firefox 92+, Safari 15.4+).
- Um bundler (Vite, webpack, Next.js etc.). O pacote é somente ESM, sem build para CDN nesta versão.
- Node.js 22.12 ou superior quando o pacote roda no Node (renderização no servidor, testes).
- Projetos TypeScript com `moduleResolution` em `node16`, `nodenext` ou `bundler`.

### 1. Instale

```sh
npm install lgpder
```

### 2. Configure as finalidades

No ponto de entrada da aplicação:

```ts
import { init } from 'lgpder/init';

init({
  purposes: {
    analytics: {
      category: 'statistics',
      title: 'Estatísticas',
      description: 'Usamos o Google Analytics para entender como o site é usado.',
      integrations: ['google-analytics'],
    },
    ads: {
      category: 'marketing',
      title: 'Publicidade',
      description: 'Anúncios personalizados do Google Ads.',
      integrations: ['google-ads'],
    },
  },
});
```

### 3. Bloqueie a tag do Google

Marque-a com `data-consent`, para que fique inerte até `analytics` ser concedida:

<!-- prettier-ignore -->
```html
<script type="text/plain" data-consent="analytics"
        data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
```

### 4. Defina o padrão do Consent Mode

No `<head>`, antes de qualquer tag do Google. É o texto de `consentDefaultSnippet`, exportado por `lgpder/google` para frameworks que renderizam o `<head>` (veja o [guia do google](docs/google.md#the-default-before-the-google-tag)):

<!-- prettier-ignore -->
```html
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'denied',wait_for_update:500});</script>
```

### 5. Experimente

Abra a página: o banner aparece, e a tag do Google continua `type="text/plain"`. Clique em "Aceitar todas": a decisão é gravada no `localStorage`, o Consent Mode é atualizado e a tag carrega. Reabra as preferências pelo botão flutuante e desligue "Estatísticas": o botão vira "Salvar e recarregar", os cookies `_ga` são apagados e a página recarrega com a tag bloqueada.

Esse exemplo é o teste de aceite do projeto (`test/init/acceptance.test.ts`). A tag do Google fica bloqueada até o consentimento, que é o [modo básico](docs/google.md#basic-mode-recommended-and-advanced-mode) do Consent Mode, o recomendado.

## Referência de configuração

O `init(options)` recebe tudo num objeto só e entrega cada parte à sua camada. A referência completa está no [guia do init](docs/init.md), em inglês.

### Opções

| Opção            | Padrão            | Descrição                                                                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `purposes`       |                   | As finalidades, na ordem de exibição; ao menos uma. Veja [por finalidade](#por-finalidade).                   |
| `storage`        | `'localStorage'`  | `'localStorage'`, `'cookie'` (legível no servidor) ou um [adaptador próprio](docs/storage.md#storageadapter). |
| `maxAge`         | 365 dias          | Idade máxima de uma decisão, em milissegundos. Concessões e recusas expiram.                                  |
| `now`            | início do dia UTC | Relógio das decisões. Arredondado por padrão, para que a data não identifique o navegador.                    |
| `revocation`     | `'reload'`        | `'reload'` ou `'manual'` (veja [revogação](docs/scripts.md#revocation)).                                      |
| `onRevoke`       |                   | Chamado a cada revogação, com as finalidades e se é preciso recarregar.                                       |
| `endpoint`       |                   | Endpoint da aplicação que recebe a prova de cada decisão. Sem ele, nada é enviado.                            |
| `onDecision`     |                   | Chamado a cada decisão do titular.                                                                            |
| `onError`        |                   | Chamado quando o envio da prova falha.                                                                        |
| `texts`          | pt-BR             | Textos mesclados sobre os textos prontos em português.                                                        |
| `necessary`      |                   | Textos da seção informativa "sempre ativos", sem toggle.                                                      |
| `floatingButton` | `true`            | Se o botão flutuante aparece. Oculte só se houver outro acesso às preferências.                               |
| `debug`          | `false`           | Avisos no console sobre rastreadores conhecidos sem `data-consent` e padrão do Consent Mode ausente.          |

### Por finalidade

| Chave             | Descrição                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `title`           | Título da finalidade e nome do seu toggle.                                                   |
| `description`     | Descrição mostrada ao titular.                                                               |
| `category`        | Grupo na central de preferências. Só um rótulo: não existe consentimento de categoria.       |
| `version`         | Versão das informações apresentadas. Uma versão nova pergunta ao titular de novo.            |
| `individualGrant` | Fica fora do "Aceitar todas"; pedida na central ou com `openPreferences(['id'])`.            |
| `integrations`    | `'google-analytics'`, `'google-ads'`: cookies apagados na revogação e tipos do Consent Mode. |
| `cookies`         | Nomes de cookies próprios apagados na revogação; um `*` no fim casa com qualquer sufixo.     |
| `consentMode`     | Tipos do Consent Mode controlados pela finalidade, além dos das suas integrações.            |

### Objeto devolvido

O `init` devolve o gerenciador (`getSnapshot`, `subscribe`), as ações `decide`, `grantAll`, `denyAll`, `adopt` e `sync`, além de `openPreferences(purposes?)`, `onGranted(purpose, fn)`, `scan(root?)` para elementos inseridos depois, e `destroy()`.

## Arquitetura

Um único pacote npm com subpaths. Cada um é opcional, e quem importa só o núcleo não carrega o resto. Nenhum módulo tem efeito colateral na importação, e todos os subpaths podem ser importados no servidor.

| Subpath           | O que faz                                                                                   | Guia                            |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| `lgpder`          | núcleo: estado do consentimento por finalidade, decisões, expiração, registro, notificações | [api.md](docs/api.md)           |
| `lgpder/storage`  | persistência em `localStorage`, cookie ou adaptador, e sincronização entre abas             | [storage.md](docs/storage.md)   |
| `lgpder/scripts`  | bloqueio de scripts, iframes e imagens; revogação; limpeza de cookies                       | [scripts.md](docs/scripts.md)   |
| `lgpder/google`   | Google Consent Mode v2                                                                      | [google.md](docs/google.md)     |
| `lgpder/evidence` | prova de cada decisão, enviada ao backend da aplicação                                      | [evidence.md](docs/evidence.md) |
| `lgpder/ui`       | Web Components: banner, central de preferências, botão flutuante, placeholder               | [ui.md](docs/ui.md)             |
| `lgpder/init`     | entrada única que configura e conecta tudo                                                  | [init.md](docs/init.md)         |

```
                 ┌────────────── lgpder/init ──────────────┐
                 ▼            ▼           ▼          ▼      ▼
          lgpder/storage  lgpder/google  lgpder/evidence  lgpder/ui ──(tipo)──▶ lgpder/scripts
                 │            │           │          │                              │
                 └────────────┴───────────┴────┬─────┴──────────────────────────────┘
                                               ▼
                                        lgpder (núcleo)
```

Toda camada depende só da API pública do núcleo; o `init` depende de todas; nenhuma camada depende do `init` nem da `ui`. A direção é imposta por regras de ESLint com fixtures que precisam falhar.

```
lgpder/
├── src/
│   ├── *.ts         núcleo: gerenciador, configuração, registro, snapshot, validação
│   ├── storage/     adaptadores e sincronização entre abas
│   ├── scripts/     bloqueio, revogação, limpeza de cookies, catálogo de integrações
│   ├── google/      Consent Mode v2
│   ├── evidence/    envio da prova
│   ├── ui/          Web Components, estilos e textos pt-BR
│   └── init/        entrada única
├── test/            uma pasta por subpath, mais testes de ferramental e de consumidor
└── docs/            um guia por subpath
```

Receitas para React, renderização no servidor e Next.js estão em [SSR, Next.js e React](docs/ssr-react.md), em inglês.

## Modo headless

Os componentes são opcionais. Para controle total da interface, use o núcleo e o storage e construa o banner e a central da aplicação sobre eles; `lgpder/scripts` e `lgpder/google` funcionam igual com qualquer interface.

```ts
import { createConsentManager } from 'lgpder';
import { connectStorage } from 'lgpder/storage';

const consent = createConsentManager({
  purposes: {
    analytics: { version: '2026-10', category: 'statistics' },
    ads: { category: 'marketing' },
    healthReminders: { version: '1', category: 'health', individualGrant: true },
  },
});
const actions = connectStorage(consent); // a interface decide por estas ações

// O titular clicou em "aceitar todas": healthReminders fica de fora (individualGrant).
actions.grantAll();
consent.getSnapshot().status;
// { analytics: 'granted', ads: 'granted', healthReminders: 'pending' }

// O titular desligou os anúncios: revogar tem a mesma forma de chamada que conceder.
actions.decide({ ads: 'denied' });

// A interface acompanha o estado, inclusive as revogações vindas de outras abas.
consent.subscribe(({ snapshot }) => {
  renderPreferences(snapshot.status);
});
```

`renderPreferences` é uma função da aplicação. Chame `decide`, `grantAll` e `denyAll` só em resposta a uma ação explícita do titular. As regras que uma interface headless deve manter estão no [guia da ui](docs/ui.md#headless-mode).

## Princípios

Valem em todas as camadas e prevalecem sobre qualquer conveniência:

1. **Falha fechada.** Nenhum erro, dado inválido, falha de armazenamento ou estado indeterminado concede consentimento.
2. **Consentimento por finalidade.** Toda decisão grava uma decisão por finalidade. Não existe consentimento de categoria, global ou curinga.
3. **Decisão só por ação explícita do titular.** Restauração, sincronização entre abas e hidratação nunca contam como decisão.
4. **Privacidade por padrão.** Opções desligadas, relógio arredondado ao dia, nenhum identificador gerado.
5. **Sem telemetria.** A biblioteca não envia nada a terceiros.
6. **Sem dependências de runtime.**
7. **Camadas só usam a API pública do núcleo.**
8. **Revogar tem o mesmo efeito prático que conceder.** A revogação encerra o tratamento na página, e não só muda um estado.

## Privacidade e segurança

- O registro guarda só, por finalidade, a decisão, a versão e o dia da decisão. Nenhum identificador, endereço IP, user agent ou texto exibido.
- Dados salvos são não confiáveis: são validados com rigor, nunca lançam erro, e o que for inválido vira ausência de decisão. As opções são lidas só como propriedades próprias, então um protótipo poluído não concede consentimento.
- Sem `eval`, `new Function` nem `import()` dinâmico; os textos são inseridos como texto, nunca como HTML. Políticas de CSP estritas são suportadas (veja as [notas de CSP](docs/init.md#content-security-policy)).
- O armazenamento do navegador pode ser lido ou alterado por qualquer script da mesma origem: proteja a aplicação contra XSS.
- Cookies `HttpOnly` e de outros domínios não podem ser apagados pela página; o [guia de scripts](docs/scripts.md) lista os limites da limpeza.

Para reportar uma vulnerabilidade, siga a [política de segurança](SECURITY.md).

## Testes e qualidade de código

```sh
npm ci
npm run check      # formatação, lint, typecheck, testes com cobertura, checagens do pacote e tamanho
```

| Script                 | O que roda                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `npm test`             | `node --test` direto no TypeScript, jsdom para o DOM, axe-core para acessibilidade |
| `npm run lint`         | ESLint, inclusive as regras de direção de dependência entre camadas                |
| `npm run typecheck`    | o projeto, mais uma checagem do núcleo sem DOM                                     |
| `npm run test:package` | build, `publint --strict`, `attw` e checagem de tipos do pacote publicado          |
| `npm run size`         | `size-limit`: núcleo até 3 kB e todos os subpaths juntos até 15 kB, gzip           |

A suíte tem mais de 1.400 testes, com portão de cobertura de 90% (hoje 100% das linhas e funções). O teste de aceite roda o início rápido acima no jsdom.

## Limitações conhecidas

Refletem a versão atual e são bons pontos de partida para contribuições:

- **Sem suíte em navegador real.** Tudo é testado no jsdom; layout, `sendBeacon` e a matriz de navegadores não são exercitados em navegadores reais.
- **Só o Google Consent Mode v2 como integração pronta.** Outros rastreadores (Meta Pixel, Clarity, Hotjar) podem ser bloqueados com `data-consent` e ter os cookies listados em `cookies`, mas não têm entrada no catálogo.
- **Sem interceptação automática de scripts inseridos dinamicamente.** Elementos inseridos depois são processados por `scan()`, e código da aplicação pode rodar por `onGranted`. A escolha é deliberada: a interceptação é frágil e falha em silêncio.
- **Interface só em português.** Todos os textos podem ser substituídos, mas nenhum outro idioma vem pronto.
- **Sem build para CDN nem uso por tag `<script>`.** Instale pelo npm e empacote.
- **Sem bindings de framework.** React, Vue e Next.js usam o núcleo diretamente, como mostram as [receitas](docs/ssr-react.md).
- **Limites da limpeza de cookies.** Cookies `HttpOnly`, `Partitioned`, de outro path ou de outro domínio não podem ser apagados pela página.

## Status do projeto

O LGPDer está em desenvolvimento inicial (versões `0.x` no npm). O fluxo de banner, preferências, persistência, bloqueio, revogação e Consent Mode está implementado e testado, e a API ainda pode mudar antes da 1.0.

O pacote segue o Versionamento Semântico: acréscimos saem numa versão minor; até a 1.0, mudanças de semântica ou do formato do registro também saem numa minor, registradas no [CHANGELOG](CHANGELOG.md).

## Aviso legal

O LGPDer é uma biblioteca técnica para registrar, ler, alterar e revogar decisões de consentimento por finalidade, e aplicá-las na página. Usá-lo não torna, por si só, uma aplicação conforme à Lei nº 13.709/2018 (LGPD) ou a qualquer outra norma. O controlador continua responsável, entre outros pontos, por:

- escolher a base legal de cada tratamento (o consentimento é só uma das bases do art. 7º);
- informar o titular com clareza antes de pedir o consentimento (art. 8º, § 4º, e art. 9º), inclusive nos textos mostrados pelos componentes;
- condicionar o tratamento às decisões registradas, também no código e nos cookies que a biblioteca não alcança;
- comprovar que o consentimento foi obtido regularmente (art. 8º, § 2º), para o que os registros do LGPDer são apoio, e não prova;
- seguir as regras de dados sensíveis (art. 11) e de dados de crianças e adolescentes (art. 14);
- decidir, como questão jurídica, se usa o modo avançado do Google Consent Mode.

Este aviso é informativo e não é parecer jurídico. O guia [O LGPDer e a LGPD](docs/lgpd.md) relaciona a biblioteca com a lei tema a tema, separando obrigações legais, boas práticas da ANPD e decisões técnicas da biblioteca.

## Documentação

Os guias estão em inglês, exceto o da LGPD.

- [Referência da API do núcleo](docs/api.md)
- [Storage e sincronização entre abas](docs/storage.md)
- [Scripts, iframes e revogação](docs/scripts.md)
- [Google Consent Mode v2](docs/google.md)
- [Prova do consentimento](docs/evidence.md)
- [Componentes](docs/ui.md)
- [Entrada única](docs/init.md)
- [SSR, Next.js e React](docs/ssr-react.md)
- [O LGPDer e a LGPD](docs/lgpd.md)
- [CHANGELOG](CHANGELOG.md)

## Como contribuir

Contribuições de qualquer tamanho são bem-vindas: relatos de bug, correções na documentação, testes e novas integrações. O [guia de contribuição](CONTRIBUTING.md), em inglês, cobre o ambiente de desenvolvimento, as convenções do projeto e o checklist de pull request.

- **Achou um bug?** Abra um [bug report](https://github.com/azevedo1z/LGPDer/issues/new?template=bug_report.yml).
- **Tem uma ideia?** Abra um [feature request](https://github.com/azevedo1z/LGPDer/issues/new?template=feature_request.yml). As [limitações conhecidas](#limitações-conhecidas) são um bom ponto de partida.
- **Achou um problema de segurança?** Não abra issue pública; siga a [política de segurança](SECURITY.md).

## Licença

O LGPDer é distribuído sob a [Licença MIT](LICENSE).
