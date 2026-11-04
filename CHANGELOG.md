# Histórico de mudanças

Mudanças relevantes do pacote `lgpder`, por versão, com a data de publicação e a lista de mudanças. A política de versões está na seção "Versionamento do pacote" do README.

## Unreleased

- Licença MIT (arquivo `LICENSE`); o pacote deixa de ser `private`.
- Nova opção `maxAge`, em milissegundos (padrão: 365 dias), e nova propriedade `ConsentManager.maxAge` com o valor efetivo. Concessões e recusas expiram: a expiração é avaliada, com o relógio configurado, na hidratação e em `restore`, e a decisão expirada, ou datada depois do relógio, é descartada e a finalidade volta a `'pending'`. Se o relógio lançar ou devolver valor inválido nessa avaliação, as decisões avaliadas são descartadas, sem erro. A criação passa a chamar o relógio no máximo uma vez, e só quando o registro hidratado tem decisões válidas; `restore` também.
- O relógio padrão passa a devolver o início do dia UTC do `Date.now()`, para que `decidedAt` não funcione como pseudoidentificador. A opção `now` continua permitindo maior precisão.
- A validação da configuração e de `decide` fica direta, por tipo e formato, sem a blindagem contra protótipo poluído: propriedades não enumeráveis de `purposes`, `now` e `maxAge` e um `purposes` herdado passam a ser lidos, e a exceção de um getter de `options.record` passa a se propagar. Continuam a recusa de chaves desconhecidas, a lista de ids reservados e a blindagem completa na leitura do registro, que inclui ler `options.record`, `now` e `maxAge` só como propriedades próprias: um valor herdado é ignorado e não concede nem revive decisões.
- Mensagens de erro, comentários e JSDoc em inglês, mantendo o prefixo `[lgpder]`.
- A receita de persistência e a ligação com cookie deixam de passar um relógio próprio, e o `Max-Age` do cookie passa a seguir `consent.maxAge`.
- Ferramental: removida a verificação dos tipos com TypeScript 5.6 e 7 (`test:types-compat`); `publint` e `attw` continuam; cobertura mínima de 90%; tamanho do núcleo verificado com `size-limit` (até 3 kB gzip); direção das dependências entre núcleo e camadas imposta pelo ESLint; CI no GitHub Actions com `npm run check`.
- O pacote publicado passa a incluir todos os `.d.ts` de `dist` e o `CHANGELOG.md`.
- Novo subpath `lgpder/storage`, que substitui a receita `examples/consent-store.ts` (removida): `connectStorage(consent, { storage, key, crossTab })` adota o registro salvo na conexão e antes de cada decisão, grava só decisões e adoções, confirma cada gravação lendo de volta e remove o registro salvo quando a gravação não se confirma. Acrescenta: leitura antes de gravar uma decisão feita direto no gerenciador (com o registro salvo alterado ou ilegível, remove em vez de regravar), nenhuma gravação de uma decisão já superada por outra mudança feita durante a sua entrega, remoção do registro salvo que não tem nenhuma decisão, `isPersisted()`, sincronização entre abas ativa por padrão (evento `storage` com `localStorage`; `BroadcastChannel` com cookie e adaptador próprio; `pageshow` e `visibilitychange`) e handles que lançam depois de `destroy()`. Sem `document`, como no servidor, o armazenamento nunca é acessado.
- Adaptadores `localStorageAdapter({ key })` e `cookieAdapter({ key, maxAge })`. O cookie usa `Path=/`, `SameSite=Lax`, `Secure` em HTTPS e `Max-Age` igual a `maxAge` arredondado para baixo em segundos; um nome de cookie repetido é falha de leitura, e a remoção alcança também os domínios pais.

## 0.1.0 (não publicada)

Primeira versão do núcleo.

- Função `createConsentManager`, única exportação de runtime, e os tipos `ConsentManager`, `ConsentOptions`, `PurposeConfig`, `ConsentStatus`, `DecidedStatus`, `ConsentChoices`, `ConsentDecision`, `ConsentRecord`, `ConsentSnapshot`, `ChangeSource`, `ConsentChange` e `ConsentListener`.
- Decisões por finalidade, com situação efetiva `'pending'`, `'granted'` ou `'denied'`. Somente `'granted'` autoriza, e a ausência de decisão é `'pending'`.
- Operações atômicas `decide`, `grantAll`, que não alcança finalidades com `individualGrant: true`, e `denyAll`, que alcança todas.
- Versão opcional e opaca por finalidade: decisão registrada sob outra versão vale `'pending'` e é sinalizada em `outdated`, sem ser revogação.
- Categoria opcional, tipada e sem estado próprio.
- Registro serializável no formato `1`, hidratação por `options.record` e adoção de registros externos por `restore`, com validação estrita que nunca lança erro e descarta o que for inválido.
- Notificações síncronas com origem (`'decision'` ou `'restore'`), somente quando o registro muda, com fila FIFO para reentrância e erros de ouvintes relançados em microtarefa.
- Objetos públicos congelados, referências estáveis e snapshot de servidor para SSR e `useSyncExternalStore`.
- Erros de programação como `TypeError` e `RangeError` nativos, com mensagens fixas em português.
- Pacote somente ESM, sem dependências de runtime, sem acesso a rede ou armazenamento e sem efeito colateral na importação.
- Receita de persistência e sincronização entre abas em `examples/consent-store.ts`, testada no repositório e reproduzida em `docs/persistencia.md`; o arquivo da receita não faz parte do pacote publicado.
- Documentação organizada em um README enxuto e nos guias `docs/api.md` (referência da API, tipagem, erros, notificações, SSR e React), `docs/persistencia.md` (receita, ligações com `localStorage` e cookie, sincronização entre abas e evidências do consentimento) e `docs/lgpd.md` (obrigações legais, boas práticas e decisões técnicas por tema, responsabilidades da aplicação e fontes), incluídos no pacote publicado.
