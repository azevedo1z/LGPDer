# Histórico de mudanças

Mudanças relevantes do pacote `lgpder`, por versão, com a data de publicação e a lista de mudanças. A política de versões está na seção "Versionamento do pacote" do README.

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
