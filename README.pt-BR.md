# LGPDer

Gerenciador de consentimento leve, tipado e open source para aplicações web, tendo a LGPD (Lei Geral de Proteção de Dados Pessoais) como referência. Read in English: [README.md](README.md).

Com poucas linhas de configuração, a aplicação ganha banner de consentimento, central de preferências, persistência, sincronização entre abas, bloqueio de scripts, iframes e imagens até haver consentimento, limpeza na revogação e o Google Consent Mode v2. Não há backend, telemetria nem dependências de runtime. Quem quiser controle total usa só o núcleo (modo headless).

A documentação técnica dos guias em `docs/` está em inglês; o guia [O LGPDer e a LGPD](docs/lgpd.md) está em português.

## Aviso: o LGPDer não garante conformidade com a LGPD

O LGPDer é uma biblioteca técnica para registrar, consultar, alterar e revogar decisões de consentimento por finalidade e para aplicá-las na página. Usar o LGPDer não coloca, por si só, uma aplicação em conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais, LGPD) nem com qualquer outra norma. A conformidade depende do contexto do tratamento e da forma como a aplicação utiliza a biblioteca.

Continuam sob responsabilidade do controlador, entre outros pontos:

- escolher a hipótese legal de cada tratamento, lembrando que o consentimento é apenas uma das hipóteses previstas no art. 7º da LGPD;
- definir finalidades determinadas e informar o titular de forma clara, adequada e ostensiva antes de pedir o consentimento (art. 8º, § 4º, e art. 9º), inclusive nos textos exibidos pelos componentes;
- oferecer procedimento gratuito e facilitado para revogar o consentimento (art. 8º, § 5º), que o botão flutuante dos componentes apoia;
- condicionar de fato o tratamento às decisões registradas, também para o código e os cookies que a biblioteca não alcança, e encerrá-lo quando o consentimento for revogado;
- comprovar que o consentimento foi obtido em conformidade com a lei (art. 8º, § 2º);
- observar as regras específicas para dados pessoais sensíveis (art. 11) e para dados de crianças e adolescentes (art. 14 da LGPD e, quando aplicável, Lei nº 15.211/2025);
- decidir, como questão jurídica, se usa o modo avançado do Google Consent Mode, que envia sinais ao Google antes do consentimento;
- atender aos direitos dos titulares (art. 18) e às demais obrigações da LGPD.

Os registros mantidos pelo LGPDer (finalidade, decisão, data e versão) apoiam essas tarefas, mas não constituem, sozinhos, prova do consentimento. Eles são gerados e armazenados no ambiente da aplicação e podem ser alterados nesse ambiente.

A documentação distingue três tipos de orientação. Obrigações legais são indicadas com o dispositivo correspondente da LGPD. Recomendações baseadas em guias da ANPD, como o Guia Orientativo: Cookies e Proteção de Dados Pessoais, são boas práticas, e não obrigações legais. Comportamentos e escolhas de implementação da biblioteca são decisões técnicas, e não exigências da LGPD.

O LGPDer não coleta dados pessoais por iniciativa própria, não realiza rastreamento nem telemetria e não envia informações a terceiros. O único envio de rede que faz é a prova opcional de cada decisão, para um endpoint da própria aplicação, e só quando configurado. Seus mantenedores não recebem dados das aplicações que o utilizam.

Este aviso tem caráter informativo e não constitui orientação jurídica. Avalie o uso da biblioteca com o encarregado ou com a assessoria jurídica da sua organização.

## Instalação e requisitos

```sh
npm install lgpder
```

- Pacote somente ESM, sem dependências de runtime.
- Navegadores com suporte a ES2022 (Chrome e Edge 93+, Firefox 92+, Safari 15.4+).
- Node.js 22.12 ou superior, quando usado em Node (renderização no servidor, testes). A partir dessa versão, módulos ESM também podem ser carregados por `require`, sem flag.
- Projetos ESM em TypeScript, com `moduleResolution` igual a `node16`, `nodenext` ou `bundler`. Até a 1.0, os tipos publicados são verificados somente com a versão do TypeScript usada no repositório (6.0).
- Projetos CommonJS em TypeScript, em que o `import` é compilado para `require`: é preciso uma versão do TypeScript que aceite `require` de módulos ESM, com `module` igual a `nodenext` ou `node20`; essa combinação não é verificada no repositório. Caso contrário, carregue o pacote com `import()` dinâmico.
- Não há build para CDN nem uso por tag `<script>` nesta versão: instale pelo npm e empacote com a aplicação.

## Início rápido

Configure as finalidades uma vez, no ponto de entrada da aplicação:

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

Marque a tag do Google com `data-consent`, para que ela fique bloqueada até `analytics` ser concedida:

<!-- prettier-ignore -->
```html
<script type="text/plain" data-consent="analytics"
        data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
```

E defina o estado padrão do Google Consent Mode, com todos os tipos recusados, no `<head>`, antes de qualquer tag do Google. É o texto de `consentDefaultSnippet`, exportado por `lgpder/google` para frameworks que renderizam o `<head>` (veja o [guia do google](docs/google.md#the-default-before-the-google-tag)):

<!-- prettier-ignore -->
```html
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'denied',wait_for_update:500});</script>
```

Pronto. A página passa a ter:

- banner, enquanto alguma finalidade não foi decidida, com "Aceitar todas", "Rejeitar todas" e "Personalizar" com o mesmo destaque;
- central de preferências, com um toggle por finalidade agrupado por categoria, finalidades pendentes desligadas, e um botão flutuante que a reabre depois da primeira decisão;
- persistência no `localStorage` e sincronização entre abas: a revogação feita numa aba chega às demais;
- a tag do Google bloqueada até `analytics` ser concedida, e o Consent Mode atualizado a cada decisão: o [modo básico](docs/google.md#basic-mode-recommended-and-advanced-mode), o recomendado;
- na revogação: os cookies do Google Analytics apagados, o Consent Mode atualizado para `denied` e, como a tag do Google não pode ser parada, a página recarregada depois de gravada a revogação;
- decisões que expiram depois de 365 dias, quando o banner pergunta de novo.

Os textos dos componentes estão em português do Brasil, e todos podem ser substituídos. Este exemplo é o teste de aceite do projeto (`test/init/acceptance.test.ts`); o guia do [`init`](docs/init.md) traz todas as opções.

## Princípios

Valem para todas as camadas e prevalecem sobre qualquer conveniência:

1. **Falha fechada.** Nenhum erro, dado inválido, falha de armazenamento ou estado indeterminado concede consentimento. Na dúvida, a finalidade é tratada como não concedida.
2. **Consentimento por finalidade.** Toda decisão grava uma decisão por finalidade. Não existe consentimento de categoria, global ou curinga; categoria é só rótulo de agrupamento.
3. **Decisão só por ação explícita do titular.** Restauração, sincronização entre abas e hidratação nunca representam manifestação do titular.
4. **Privacidade por padrão.** O padrão é sempre o mais privado: opções desligadas, relógio arredondado ao dia, nenhum identificador gerado.
5. **Sem telemetria.** A biblioteca não envia nada a terceiros.
6. **Sem dependências de runtime.**
7. **Camadas só usam a API pública do núcleo.** Nenhuma camada acessa o interior de outra.
8. **Revogação tem o mesmo efeito prático que a concessão.** Revogar encerra o tratamento na página, e não só muda um estado.

## Subpaths

Um único pacote npm com subpaths. Cada subpath é opcional, e quem importa só o núcleo não carrega o resto. Nenhum módulo tem efeito colateral na importação, e todo subpath pode ser importado no servidor.

| Subpath           | O que faz                                                                                   | Guia                            |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| `lgpder`          | núcleo: estado do consentimento por finalidade, decisões, expiração, registro, notificações | [api.md](docs/api.md)           |
| `lgpder/storage`  | persistência em `localStorage`, cookie ou adaptador, e sincronização entre abas             | [storage.md](docs/storage.md)   |
| `lgpder/scripts`  | bloqueio de scripts, iframes e imagens; revogação; limpeza de cookies                       | [scripts.md](docs/scripts.md)   |
| `lgpder/google`   | Google Consent Mode v2                                                                      | [google.md](docs/google.md)     |
| `lgpder/evidence` | prova de cada decisão, enviada ao backend da aplicação                                      | [evidence.md](docs/evidence.md) |
| `lgpder/ui`       | Web Components: banner, central de preferências, botão flutuante, placeholder de iframes    | [ui.md](docs/ui.md)             |
| `lgpder/init`     | entrada única que configura e conecta tudo                                                  | [init.md](docs/init.md)         |

Todas as camadas dependem do núcleo; o `init` depende de todas; a `ui` usa só um tipo da `scripts`; nenhuma camada depende do `init` nem da `ui`. Tamanho minificado e com gzip, medido pelo `size-limit` no CI: núcleo até 3 kB e todos os subpaths juntos até 15 kB.

As receitas para React, renderização no servidor e Next.js estão em [SSR, Next.js and React](docs/ssr-react.md).

## Modo headless

Os componentes são opcionais. Para controle total da interface, use o núcleo e o storage, e construa sobre eles o banner e a central de preferências da aplicação; `lgpder/scripts` e `lgpder/google` funcionam igual com qualquer interface.

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

// O titular desligou a publicidade: revogar tem a mesma forma de chamada de conceder.
actions.decide({ ads: 'denied' });

// A interface acompanha o estado, inclusive as revogações que chegam de outras abas.
consent.subscribe(({ snapshot }) => {
  renderPreferences(snapshot.status);
});
```

`renderPreferences` é função da aplicação. Chame `decide`, `grantAll` e `denyAll` somente em resposta a uma ação explícita do titular, nunca por inferência. As regras que uma interface headless deve manter estão no [guia da ui](docs/ui.md#headless-mode).

## Conceitos essenciais

- **Finalidade**: propósito determinado de um tratamento baseado em consentimento, declarado em `purposes` e identificado por um id. É a unidade de decisão: não existe consentimento global, consentimento de categoria nem id com significado especial. A configuração contém apenas os tratamentos que o controlador decidiu basear em consentimento (art. 7º, I), sem itens "sempre ativos" nem base legal presumida.
- **Categoria**: rótulo opcional que agrupa finalidades, por exemplo na central de preferências, sem estado de consentimento próprio.
- **Situação efetiva**: `'pending'`, `'granted'` ou `'denied'`. Somente `'granted'` autoriza o tratamento baseado em consentimento. A ausência de decisão é `'pending'` e nunca equivale a consentimento.
- **Decisão**: concessão ou recusa registrada para uma finalidade, com a versão vigente e o instante (`decidedAt`, arredondado ao início do dia UTC por padrão). Revogar é registrar `'denied'`.
- **Versão e `outdated`**: versão opcional e opaca por finalidade. Decisão registrada sob outra versão vale `'pending'` e é sinalizada em `outdated`, e o banner pergunta de novo.
- **Expiração**: as decisões, concessões e recusas, expiram depois de `maxAge` (padrão: 365 dias).
- **Registro**: objeto serializável com a última decisão de cada finalidade, gravado pelo storage e tratado como dado não confiável sempre que é lido.
- **`individualGrant`**: finalidade fora de "aceitar todas" (`grantAll`), concedida só quando nomeada; para finalidades que exigem decisão específica, como as que envolvem dados sensíveis ou dados de crianças.

As regras completas estão na [referência do núcleo](docs/api.md).

## Privacidade e segurança

- O registro guarda somente, por finalidade, a situação decidida, a versão e o instante da decisão. Nenhum identificador do titular, IP, user agent, idioma ou texto exibido. Conforme o contexto, por exemplo quando associado a uma conta, o registro pode ser dado pessoal (art. 5º, I).
- O relógio padrão arredonda `decidedAt` ao início do dia UTC, para que ele não funcione como pseudoidentificador do navegador.
- Dados salvos são validados de forma estrita e nunca causam erro; o que for inválido vira ausência de decisão. As opções das camadas são lidas só como propriedades próprias, para que um protótipo poluído não conceda, não envie e não desligue a revogação.
- O armazenamento do navegador pode ser lido ou alterado por qualquer script da mesma origem: proteja a aplicação contra XSS e avalie os scripts de terceiros que ela carrega.
- Com o armazenamento em cookie, o registro é enviado ao servidor em toda requisição ao domínio.
- Sem `eval`, `new Function` ou `import()` dinâmico; os textos dos componentes são inseridos como texto, nunca como HTML. Políticas de segurança de conteúdo (CSP) estritas são suportadas: veja as [notas de CSP](docs/init.md#content-security-policy).

## Escopo

Fora do escopo desta versão:

- build para CDN e uso por tag `<script>`;
- bindings de framework (React, Vue, Next.js): o núcleo funciona diretamente com eles, como mostram as [receitas](docs/ssr-react.md);
- interceptação automática de scripts inseridos dinamicamente: elementos inseridos depois são processados por `scan()` explícito, e código pode ser carregado com `onGranted`;
- integrações além do Google Consent Mode v2 (Meta Pixel, Clarity, Hotjar): os scripts delas podem ser bloqueados com `data-consent`, e os cookies, apagados com `cookies`;
- idiomas da interface além do português do Brasil: todos os textos podem ser substituídos, e outro idioma é um conjunto completo de textos;
- backend, painel administrativo, gestão de solicitações de titulares e geração de políticas;
- identificador de titular ou de recibo gerado no navegador;
- telemetria de qualquer tipo, permanentemente.

## LGPD

O guia [O LGPDer e a LGPD](docs/lgpd.md) relaciona a biblioteca com a lei, tema a tema, separando:

- **obrigação legal**: o que a LGPD ou outra lei exige, com o dispositivo, como o procedimento gratuito e facilitado para revogar o consentimento (art. 8º, § 5º);
- **boa prática**: recomendação de guia da ANPD, com a fonte, como o botão de rejeitar com o mesmo destaque do aceite, as opções desativadas por padrão e o novo consentimento após mudanças, que não são exigências literais da LGPD;
- **decisão técnica do LGPDer**: escolha de implementação, que a LGPD não exige, como os estados `'pending'`, `'granted'` e `'denied'`, a invalidação por versão, a expiração, o reload na revogação e o `individualGrant`.

O guia traz também as responsabilidades da aplicação, o versionamento e reconsentimento, a expiração (a LGPD não estabelece prazo de validade nem renovação periódica do consentimento) e as fontes consultadas.

## Documentação

- [Referência da API do núcleo](docs/api.md): assinaturas, erros, tipagem, notificações.
- [Armazenamento e sincronização entre abas](docs/storage.md), [scripts, iframes e revogação](docs/scripts.md), [Google Consent Mode v2](docs/google.md), [prova do consentimento](docs/evidence.md), [componentes](docs/ui.md), [entrada única](docs/init.md).
- [SSR, Next.js e React](docs/ssr-react.md).
- [O LGPDer e a LGPD](docs/lgpd.md).
- [CHANGELOG](CHANGELOG.md).

Os guias de `docs/` estão em inglês, exceto `docs/lgpd.md`.

## Versionamento

O pacote segue o Versionamento Semântico (SemVer) a partir da versão 0.1.0:

- adições são publicadas em versão minor;
- a partir da 1.0.0, mudanças de semântica ou do formato do registro exigem versão major; antes disso, entram em versão minor, com registro no CHANGELOG;
- as mensagens de erro são documentadas, mas não devem ser usadas para controle de fluxo; mudanças nelas são registradas no CHANGELOG, assim como mudanças nos hashes de CSP do snippet e da folha de estilo.

## Licença

MIT. Veja o arquivo [LICENSE](LICENSE).
