# O LGPDer e a LGPD

O LGPDer não garante conformidade com a LGPD: leia antes o [aviso no README](../README.pt-BR.md#aviso-o-lgpder-não-garante-conformidade-com-a-lgpd). Este documento relaciona o LGPDer com a LGPD, separando obrigação legal (com o dispositivo), boa prática (com a fonte) e decisão técnica da biblioteca. Nenhuma escolha de implementação do LGPDer é exigida pela LGPD em si; o comportamento de cada uma está nos guias, em inglês: o [núcleo](api.md), o [armazenamento](storage.md), os [scripts e a revogação](scripts.md), o [Google Consent Mode](google.md), a [prova do consentimento](evidence.md), os [componentes](ui.md) e a [entrada única](init.md).

As decisões técnicas abaixo valem para o pacote inteiro. Quando dependem de uma camada, a camada é indicada: `lgpder/ui` (banner, central de preferências, botão flutuante e placeholder), `lgpder/scripts` (bloqueio, revogação e limpeza de cookies), `lgpder/storage` (persistência e sincronização entre abas), `lgpder/google` (Google Consent Mode v2) e `lgpder/evidence` (envio das decisões ao backend da aplicação). Quem usa só o núcleo (modo headless) assume na própria interface o que a `ui` e a `scripts` fariam.

Dispositivos sem indicação de norma são da LGPD; os de outra lei indicam a lei (como a Lei nº 15.211/2025), e o Enunciado CD/ANPD nº 1/2023 é identificado como interpretação da ANPD, e não como texto legal. "Guia de Cookies" é o Guia Orientativo: Cookies e Proteção de Dados Pessoais da ANPD, versão 1.0, de outubro de 2022, que se declara um guia de boas práticas.

## Obrigações legais, boas práticas e decisões técnicas por tema

### Definição e forma do consentimento

- **Obrigação legal:** Manifestação livre, informada e inequívoca, para finalidade determinada (art. 5º, XII), por escrito ou outro meio que demonstre a vontade (art. 8º, caput).
- **Boa prática:** Manifestação clara e positiva, sem inferência e sem forma tácita; não presumir consentimento pela navegação (Guia de Cookies, p. 18-19).
- **Decisão técnica do LGPDer:** Situação `'pending'` até chamada explícita; sem inferência; sem valor inicial concedido. A `ui` decide só por clique do titular ("Aceitar todas", "Rejeitar todas", "Salvar", "Permitir sempre"); fechar a central, restaurar, sincronizar entre abas e hidratar nunca registram decisão, e "Carregar", no placeholder, carrega o conteúdo só naquela página, sem registrar decisão.

### Finalidades determinadas

- **Obrigação legal:** Consentimento para finalidades determinadas; autorizações genéricas são nulas (art. 8º, § 4º; art. 6º, I).
- **Boa prática:** Não pedir aceite genérico de termos sem indicar finalidades (Guia de Cookies, p. 14-15).
- **Decisão técnica do LGPDer:** Finalidade como unidade; ids validados; nenhum identificador com significado especial; sem consentimento global. A `ui` mostra o título e a descrição configurados para cada finalidade, e o banner lista as finalidades alcançadas por "Aceitar todas". O LGPDer não avalia se a finalidade está bem descrita: isso cabe ao controlador.

### Granularidade

- **Obrigação legal:** Não usa o termo; fundamento nas finalidades determinadas (art. 8º, § 4º; art. 11, I; art. 7º, § 5º).
- **Boa prática:** Decisão por finalidade agrupada por categorias; evitar listas excessivamente granulares (Guia de Cookies, p. 31 e 33).
- **Decisão técnica do LGPDer:** Categoria só agrupa; lotes gravam uma decisão por finalidade. A central de preferências agrupa as finalidades por categoria, com um toggle por finalidade e nenhum toggle de categoria.

### Compartilhamento com outros controladores

- **Obrigação legal:** Consentimento específico para comunicar ou compartilhar dados, ressalvadas as dispensas legais (art. 7º, § 5º).
- **Boa prática:** Informar o compartilhamento com terceiros (Guia de Cookies, p. 15 e 28).
- **Decisão técnica do LGPDer:** Modelar o compartilhamento como finalidade própria. Com `lgpder/google`, cada finalidade declara os tipos do Google Consent Mode que controla, e um tipo só é concedido quando todas as finalidades que o controlam estão concedidas.

### Consentimento livre e recusa

- **Obrigação legal:** Consentimento livre (art. 5º, XII); vedado o vício de consentimento (art. 8º, § 3º); direito de saber que pode não consentir e as consequências (art. 18, VIII); destaque quando o tratamento for condição do serviço (art. 9º, § 3º).
- **Boa prática:** Botão de rejeitar com a mesma facilidade e destaque; não condicionar ao aceite integral (Guia de Cookies, p. 17-18, 22, 30-31 e 33).
- **Decisão técnica do LGPDer:** `'denied'` é decisão estável; `denyAll`; nenhuma operação exige concessão. O banner da `ui` tem "Aceitar todas", "Rejeitar todas" e "Personalizar" com o mesmo destaque visual, e nada na biblioteca condiciona o uso do site ao aceite.

### Revogação

- **Obrigação legal:** A qualquer momento, por procedimento gratuito e facilitado, ratificados os tratamentos anteriores enquanto não houver requerimento de eliminação (art. 8º, § 5º; art. 18, IX); término do tratamento (art. 15, III), com eliminação dos dados após o término, autorizada a conservação nas hipóteses do art. 16; eliminação a requerimento, ressalvado o art. 16 (art. 18, VI).
- **Boa prática:** Revogar de forma similar a obter; mecanismo direto e acessível (Guia de Cookies, p. 16, 19, 31 e 33).
- **Decisão técnica do LGPDer:** `decide` com `'denied'` ou `denyAll`, mesmo custo de conceder; nova decisão datada; notificação; sem retroatividade; sem eliminar dados. O botão flutuante da `ui` reabre a central a qualquer momento (pode ser ocultado só se a aplicação oferecer outro acesso, por `openPreferences`). Na revogação, a `scripts` encerra o tratamento na página: bloqueia de novo iframes e imagens da finalidade, chama as funções de limpeza da aplicação, apaga os cookies da finalidade que a página alcança e, se sobrou código em execução, recarrega a página depois de confirmada a gravação; a `google` envia `denied` ao Consent Mode; a revogação feita numa aba chega às demais. A limpeza não alcança cookies `HttpOnly`, de outro `Path`, de outros domínios nem particionados, nem dados já enviados a terceiros.

### Alteração de informações ou de finalidade (versionamento e reconsentimento)

- **Obrigação legal:** Quando mudam as informações dos incisos I, II, III ou V do art. 9º, o controlador deve informar o titular, com destaque, sobre o teor das alterações, e o titular pode revogar o consentimento se discordar (art. 8º, § 6º). Mudança de finalidade incompatível com o consentimento original deve ser informada previamente ao titular, que pode revogá-lo (art. 9º, § 2º).
- **Boa prática:** Obter novo consentimento quando mudam as premissas (Guia de Cookies, p. 18).
- **Decisão técnica do LGPDer:** Versão opcional por finalidade; decisão registrada sob outra versão vale `'pending'` e é sinalizada em `outdated`, sem ser revogação. Na mudança de versão, o banner da `ui` reabre completo. A biblioteca não julga se uma mudança é compatível: tratar a decisão anterior como pendente é a opção conservadora, e a aplicação decide quando mudar a versão.

Mudar a versão não substitui o dever de informar. A lei não determina que o consentimento anterior caduque: se a aplicação apenas informar o titular, sem mudar a versão, o LGPDer continua tratando as decisões como concedidas. Mude a versão somente quando a alteração exigir nova manifestação do titular, para evitar pedidos repetidos.

### Prova do consentimento

- **Obrigação legal:** Ônus do controlador (art. 8º, § 2º); responsabilização e prestação de contas (art. 6º, X).
- **Boa prática:** Registrar e documentar os requisitos do consentimento (Guia de Cookies, p. 19).
- **Decisão técnica do LGPDer:** Registro estruturado e notificações com origem; não constitui prova sozinho. A `evidence` entrega ao backend da aplicação cada decisão do titular (só as de origem `'decision'`), com o registro, as finalidades alteradas e a versão de cada finalidade, sem identificador gerado no navegador; o horário preciso é o de recebimento no backend. Veja a [prova do consentimento](evidence.md).

### Dados sensíveis

- **Obrigação legal:** Consentimento específico e destacado, para finalidades específicas (art. 11, I).
- **Boa prática:** Autorização separada ou evidenciada, indicando dados e finalidade (Guia de Cookies, p. 19).
- **Decisão técnica do LGPDer:** `individualGrant: true` exclui a finalidade de `grantAll`; finalidade própria. Na `ui`, a finalidade fica fora do banner e de "Aceitar todas", aparece em destaque na central, com selo e toggle próprio, e pode ser pedida no contexto da funcionalidade por `openPreferences([...])`. `individualGrant` apoia a obrigação e a boa prática, mas não substitui a forma específica e destacada, que continua sendo dever da aplicação (textos, contexto e momento do pedido).

### Crianças e adolescentes

- **Obrigação legal:**
  - LGPD: melhor interesse (art. 14, caput). Para dados de crianças: consentimento específico e em destaque de ao menos um dos pais ou do responsável legal (art. 14, § 1º), com esforços razoáveis de verificação (§ 5º); informação pública sobre os tipos de dados coletados, a forma de sua utilização e os procedimentos para o exercício de direitos (§ 2º); vedação de condicionar a participação em jogos, aplicações de internet ou outras atividades ao fornecimento de informações pessoais além das estritamente necessárias (§ 4º); e informações simples, claras e acessíveis, adequadas ao entendimento da criança (§ 6º).
  - Interpretação da ANPD (Enunciado CD/ANPD nº 1/2023): o tratamento de dados de crianças e adolescentes pode se basear nas hipóteses dos arts. 7º e 11, desde que observado e prevalecente o melhor interesse; nessa leitura, o consentimento do § 1º é exigido quando a hipótese escolhida for o consentimento.
  - Lei nº 15.211/2025, art. 7º: configuração mais protetiva por padrão em produtos direcionados a crianças e adolescentes ou de acesso provável por eles.
- **Boa prática:** Sem recomendação específica no Guia de Cookies.
- **Decisão técnica do LGPDer:** Estado inicial sem concessão e `individualGrant`; não verifica idade nem identidade de responsáveis; o cumprimento cabe à aplicação.

### Outras hipóteses legais

- **Obrigação legal:** Dez hipóteses (art. 7º, I a X); hipóteses para dados sensíveis (art. 11, II); dispensa do consentimento não afasta princípios e direitos (art. 7º, § 6º).
- **Boa prática:** Sem hierarquia entre hipóteses; legítimo interesse possível para medição de audiência em certos contextos (Guia de Cookies, p. 20 e 24).
- **Decisão técnica do LGPDer:** Só finalidades baseadas em consentimento; sem bases presumidas; sem itens "sempre ativos".

### Itens estritamente necessários

- **Obrigação legal:** Sem dispositivo específico.
- **Boa prática:** Não usar consentimento para itens estritamente necessários (Guia de Cookies, p. 10, 20, 24, 32 e 35-36).
- **Decisão técnica do LGPDer:** Fora do estado de consentimento: não há finalidade "sempre ativa". A central da `ui` traz uma seção informativa "Necessários (sempre ativos)", sem toggle e sem estado, com textos configuráveis.

### Opções pré-marcadas

- **Obrigação legal:** Fundamento na manifestação inequívoca (art. 5º, XII).
- **Boa prática:** Não usar opções pré-selecionadas nem consentimento tácito; itens desativados por padrão (Guia de Cookies, p. 18-19, 22, 31, 33 e 36).
- **Decisão técnica do LGPDer:** Não existe valor inicial concedido. A central da `ui` mostra as finalidades pendentes desligadas. Salvar sem tocar nelas registra como recusadas as que não têm `individualGrant`; as com `individualGrant` não tocadas continuam pendentes até uma decisão explícita.

### Expiração

- **Obrigação legal:** A LGPD não estabelece prazo de validade nem renovação periódica do consentimento; nenhum dispositivo nesse sentido foi encontrado no texto compilado.
- **Boa prática:** O Guia de Cookies não fixa prazo de validade do consentimento; trata da duração de cookies e da retenção de dados (p. 11-12 e 16-17).
- **Decisão técnica do LGPDer:** As decisões, concessões e recusas, expiram depois de `maxAge` (padrão: 365 dias, configurável). A expiração é avaliada na hidratação e em `restore`, e a decisão expirada é descartada: a finalidade volta a `'pending'`, sem que isso seja revogação, e o banner da `ui` pergunta de novo. Numa aba aberta por muito tempo, a expiração só é percebida na próxima restauração com registro novo ou na próxima carga. A aplicação pode ainda renovar antes do prazo mudando a versão.

### Minimização

- **Obrigação legal:** Princípio da necessidade (art. 6º, III).
- **Boa prática:** Limitar a duração de cookies persistentes e o período de retenção; evitar o tratamento quando houver meio menos gravoso (Guia de Cookies, p. 12, 15 e 17).
- **Decisão técnica do LGPDer:** Registro mínimo; relógio arredondado ao início do dia UTC; sem identificadores; o registro salvo sem nenhuma decisão vigente é removido. O único envio de rede é o da `evidence`, para um endpoint da própria aplicação, e só quando configurado.

### Segurança

- **Obrigação legal:** Medidas de segurança (art. 6º, VII; art. 46), desde a concepção (art. 46, § 2º); sistemas aderentes a requisitos de segurança (art. 49).
- **Boa prática:** Sem recomendação específica no Guia de Cookies.
- **Decisão técnica do LGPDer:** Validação de dados salvos, falha fechada, objetos congelados, opções das camadas lidas só como propriedades próprias, textos da interface inseridos sempre como texto, sem `eval`, sem dependências de runtime e endpoint da prova só por HTTPS (ou HTTP em `localhost`).

### Transparência

- **Obrigação legal:** Informações claras e acessíveis (art. 6º, IV e VI); informações do art. 9º; consentimento nulo com informação enganosa ou não apresentada previamente (art. 9º, § 1º); linguagem acessível para crianças (art. 14, § 6º).
- **Boa prática:** Política de Cookies ou documento equivalente; categorias e finalidades descritas de forma simples, clara e precisa; não usar apenas idioma estrangeiro; indicar como gerenciar cookies no navegador (Guia de Cookies, p. 15, 28-29, 31, 33 e 36).
- **Decisão técnica do LGPDer:** Consulta da situação a qualquer momento; a versão vincula a decisão ao conteúdo que a aplicação exibiu. Os textos da `ui` são configuráveis por finalidade e por componente; a biblioteca traz só o pt-BR.

### Privacidade por padrão

- **Obrigação legal:** LGPD: não usa a expressão; dispositivos relacionados: art. 46, § 2º (medidas de segurança desde a concepção do produto ou do serviço) e art. 6º, III (necessidade). Lei nº 15.211/2025, art. 7º: configuração mais protetiva por padrão, apenas para produtos direcionados a crianças e adolescentes ou de acesso provável por eles.
- **Boa prática:** Itens baseados em consentimento desativados por padrão (Guia de Cookies, p. 31 e 33).
- **Decisão técnica do LGPDer:** Princípio de design: nada é concedido sem decisão explícita; toda falha resulta em ausência de consentimento. Scripts, iframes e imagens marcados com `data-consent` ficam bloqueados até a concessão; o Google Consent Mode começa com todos os tipos recusados, e a documentação recomenda o modo básico, em que a tag do Google só carrega depois da concessão. O modo avançado, que carrega a tag antes do consentimento e envia sinais sem cookies, é decisão jurídica do controlador e fica fora do padrão.

### Notificação de alterações

- **Obrigação legal:** Sem dispositivo específico; apoia o término do tratamento (art. 15, III).
- **Boa prática:** Sem recomendação específica no Guia de Cookies.
- **Decisão técnica do LGPDer:** Notificação síncrona aos assinantes da instância, sem eventos globais e sem rede. As camadas reagem a cada notificação a partir do estado atual do gerenciador.

## Responsabilidades da aplicação

O LGPDer ajuda a aplicação a registrar, consultar, alterar e revogar decisões de consentimento. Continuam com a aplicação e com o controlador:

1. Definir a hipótese legal de cada tratamento (arts. 7º e 11) e quais finalidades dependem de consentimento. Tratamentos com outras hipóteses ficam fora do LGPDer e continuam sujeitos aos princípios e aos direitos do titular (art. 7º, § 6º).
2. Definir finalidades determinadas, legítimas, específicas e explícitas (art. 6º, I; art. 8º, § 4º), com granularidade compreensível, incluindo finalidade própria para compartilhamento com outros controladores (art. 7º, § 5º).
3. Informar o titular antes da coleta, de forma clara, adequada e ostensiva, sobre os itens do art. 9º, sem conteúdo enganoso ou abusivo (art. 9º, § 1º), inclusive com a menção explícita aos direitos do art. 18 (art. 9º, VII), entre eles o de obter, mediante requisição, informação sobre a possibilidade de não consentir e sobre as consequências da negativa (art. 18, VIII). Se o tratamento for condição para o fornecimento de produto ou de serviço ou para o exercício de direito, informar com destaque esse fato e os meios de exercer os direitos do art. 18 (art. 9º, § 3º). Apresentar já na coleta a possibilidade de recusar e as consequências da recusa é boa prática (Guia de Cookies, p. 18).
4. Construir ou configurar a interface (aviso, banner, central de preferências). A `ui` oferece banner, central e botão flutuante, mas os textos, a adequação deles ao público e o acesso às preferências quando o botão flutuante é ocultado continuam com a aplicação. (a) Obrigações legais: procedimento gratuito e facilitado para revogar o consentimento a qualquer momento (art. 8º, § 5º) e apresentação prévia das informações do art. 9º (item 3). (b) Boas práticas do Guia de Cookies, e não exigências literais da LGPD: botão de recusa de fácil visualização, sem destaque maior apenas para o aceite (p. 22, 30 e 33); opções baseadas em consentimento desativadas por padrão (p. 19, 22, 31 e 33); link de fácil acesso e mecanismo direto e simplificado para rever as preferências e revogar o consentimento, de forma similar à obtenção (p. 19, 31 e 33).
5. Quando o consentimento for obtido por escrito, apresentá-lo em cláusula destacada das demais (art. 8º, § 1º).
6. Chamar `decide`, `grantAll` e `denyAll` (do gerenciador, do `storage` ou do `init`) somente em resposta a uma ação explícita do titular, sem inferir consentimento de navegação, rolagem, fechamento de aviso ou inatividade.
7. Condicionar de fato cada tratamento à situação da finalidade: não carregar scripts, SDKs, cookies ou integrações de terceiros antes do consentimento; encerrar o tratamento ao receber a revogação (art. 15, III) e eliminar os dados após o término do tratamento, ressalvadas as hipóteses de conservação do art. 16; remover, quando cabível, artefatos já gravados no dispositivo. A `scripts` faz isso para os elementos marcados com `data-consent` e para o código registrado com `onGranted`, mas não alcança scripts sem a marcação, cookies `HttpOnly`, de outro `Path`, de outros domínios ou particionados, nem dados guardados pelas integrações em outros armazenamentos.
8. Decidir quando mudar a versão de uma finalidade, informar o titular com destaque sobre as alterações (art. 8º, § 6º; art. 9º, § 2º) e coletar nova decisão quando necessário (veja [Alteração de informações ou de finalidade](#alteração-de-informações-ou-de-finalidade-versionamento-e-reconsentimento)).
9. Produzir e guardar a prova do consentimento (art. 8º, § 2º), com os registros persistidos em local seguro e as evidências recebidas pelo backend, como descrito na [prova do consentimento](evidence.md#on-the-backend).
10. Para dados sensíveis tratados com base no consentimento, obtê-lo de forma específica e destacada (art. 11, I). Para dados de crianças e adolescentes, observar o melhor interesse (art. 14, caput). Para dados de crianças, o art. 14 prevê ainda o consentimento específico e em destaque de ao menos um dos pais ou do responsável legal (§ 1º) e outros requisitos, detalhados com a interpretação da ANPD em [Crianças e adolescentes](#crianças-e-adolescentes). Para adolescentes, verificar também as regras da Lei nº 15.211/2025 (item 11).
11. Avaliar e cumprir a Lei nº 15.211/2025 quando o produto for direcionado a crianças e adolescentes ou de acesso provável por eles, inclusive a configuração mais protetiva por padrão (art. 7º).
12. Atender aos direitos dos titulares (art. 18), inclusive a eliminação dos dados tratados com consentimento (art. 18, VI, observado o art. 16) e a oposição (art. 18, § 2º).
13. Garantir a segurança do ambiente em que a biblioteca roda e dos registros persistidos ou transmitidos (arts. 46 e 49), inclusive contra XSS e contra scripts de terceiros que possam ler ou alterar o armazenamento local, com uma política de segurança de conteúdo (CSP) adequada.
14. Decidir, como questão jurídica, se usa o modo avançado do Google Consent Mode, que envia sinais ao Google antes do consentimento; o padrão do LGPDer é o modo básico.
15. Definir o prazo de validade das decisões, se o padrão de 365 dias não servir (veja [Expiração](#expiração)), além do prazo de retenção dos dados coletados com base no consentimento.
16. Cumprir as demais obrigações da LGPD fora do escopo do LGPDer: aviso de privacidade e política de cookies, encarregado (art. 41), registro das operações (art. 37), relatório de impacto quando determinado pela ANPD (art. 38) e comunicação de incidentes de segurança (art. 48).
17. Avaliar outras normas aplicáveis ao seu contexto, como o Marco Civil da Internet (Lei nº 12.965/2014, art. 7º, VII e IX) e normas setoriais.

## Fontes

Consultadas em 31/10/2026:

- Lei nº 13.709/2018 (LGPD), texto compilado: <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm>
- ANPD, Guia Orientativo: Cookies e Proteção de Dados Pessoais, versão 1.0, outubro de 2022: <https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf>
- Enunciado CD/ANPD nº 1, de 22 de maio de 2023: <https://bibliotecadigital.mj.gov.br/bitstream/1/10215/2/Enunciado_ANPD_2023_1.html>
- Lei nº 15.211/2025: <https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm>
- Lei nº 12.965/2014 (Marco Civil da Internet): <https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm>
- ANPD, Balanço da Agenda Regulatória 2025-2026, primeiro semestre de 2026, com a situação das iniciativas depois da Resolução CD/ANPD nº 31/2025: <https://www.gov.br/anpd/pt-br/assuntos/regulacao/agenda-regulatoria-1/agenda-regulatoria-2025-2026/balanco-agenda-regulatoria-2025-2026-01-2026.pdf/@@display-file/file>

Normas e guias podem mudar depois da data de consulta. A Agenda Regulatória 2025-2026 da ANPD (Resolução CD/ANPD nº 23/2024, alterada pela Resolução CD/ANPD nº 31/2025) prevê iniciativa sobre a hipótese legal do consentimento (item 18, fase 4) e iniciativas de regulamentação da Lei nº 15.211/2025, como a de mecanismos de aferição de idade. Na revisão da agenda, a iniciativa específica sobre tratamento de dados de crianças e adolescentes foi excluída, e a ANPD indicou que o tema pode ser tratado no desdobramento da regulamentação dessa lei.
