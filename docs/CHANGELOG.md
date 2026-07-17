# Changelog - Cotador Inteligente ST

Histórico estruturado de todas as alterações de engenharia realizadas no projeto.

---

## [1.4.0] - 2026-07-17

### Adicionado
- **Contexto farmaceutico compartilhado:** novo modulo `pharmaceutical-context.js` centraliza nomes canonicos, principios ativos, associacoes e equivalencias de apresentacao usados pelo parser, recomendador e auditor.
- **Abreviacoes seguras:** `hidrocloro`/`hctz` e prefixos unicos com pelo menos seis letras sao expandidos antes da pesquisa ao vivo, permitindo que os portais recebam o nome completo.
- **Associacoes sem formato rigido:** dois principios ativos sao reconhecidos em qualquer ordem, com ou sem `+`, e comparados como conjunto.
- **Sinonimos de apresentacao:** `xarope` confere com `suspensao oral`; `soro fisiologico` e `solucao fisiologica` convergem para `cloreto de sodio`.

### Seguranca
- Uma consulta de principio ativo unico continua bloqueando resultados combinados, inclusive quando o fornecedor omite o sinal `+`.
- Prefixos curtos ou ambiguos nao sao expandidos automaticamente.
- A equivalencia de liquidos nao aceita solucoes oftalmicas, injetaveis, nasais ou otologicas como xarope.

### Validacao
- `npm test`: 57/57 testes aprovados, incluindo fluxo completo de `hidrocloro`, associacao invertida sem `+`, bloqueio de terceiro principio ativo, xarope/suspensao, soro/solucao e controles negativos.
- `npm run build` e `npm run lint` concluidos sem erro bloqueante.

## [1.3.0] - 2026-07-17

### Adicionado
- **Quarta distribuidora DM Paraná:** cadastro, seleção, filtro, credenciais locais, conector real/mock e URL restrita a `portal.dmparana.com.br`.
- **Preço final auditável:** a DM aceita exclusivamente o campo `Preço final: R$`; o preço cru em negrito é ignorado e a origem do valor aparece na tela.
- **Paginação e estoque:** o coletor percorre até dez páginas, deduplica EANs e descarta itens sem botão `Comprar` ativo ou marcados sem estoque.
- **Portabilidade documentada:** novo computador reinstala dependências pelo bootstrap e exige recadastro das senhas protegidas por DPAPI.

### Corrigido
- **Busca compatível com a DM:** o portal recebe apenas o nome do medicamento; dosagem e apresentação permanecem na auditoria para não gerar falso resultado vazio.
- **Medicamentos combinados:** resultados com `+` são bloqueados quando a consulta pede um único princípio ativo.
- **Ranking por EAN:** produtos de mesmo nome e fornecedor permanecem distintos, permitindo marcar somente o EAN realmente mais barato como `Melhor preço com ST`.
- **Teste real:** `hidroclorotiazida 25mg 30 comprimidos` retornou 14 cartões ao vivo. Teuto, EAN `7896112165651`, venceu com `Preço final: R$ 1,56`; EMS, EAN `7896004716176`, ficou em segundo com `Preço final: R$ 1,73`.

### Validação
- `npm test`: 46/46 testes aprovados.
- Coleta Electron real da DM concluída com saída limpa e `capturedAt` atual.

## [1.2.2] - 2026-07-15

### Adicionado
- **Auditoria inteligente de cotação:** Nova camada `quote-auditor.js` valida preço, estoque, ST, EAN, nome do produto, dosagem, apresentação, embalagem e preço fora da curva antes do ranqueamento.
- **Parecer persistente por resultado:** `QuoteResult` agora salva `auditStatus` e `auditSummary`, permitindo reabrir cotações com o motivo da auditoria preservado.
- **Auditoria visível no app e no Excel:** A tela de resultados mostra a coluna `Auditoria`, e a exportação XLSX inclui `Auditoria`/`Alertas Auditoria` nas abas principais, com linhas suspeitas encaminhadas para `Precisa Revisar`.
- **Testes de integridade da cotação:** A suíte passou a cobrir auditoria de preço zerado, divergência de EAN, embalagem diferente, bloqueio de `SEM_ST` com `auditStatus` e exportação XLSX com alertas.

### Corrigido
- **Leitura correta do banco local:** `DATABASE_PATH=local` agora aponta para `data/cotador-st.db`, evitando que o Electron use um banco vazio em `AppData` enquanto as credenciais reais estão no banco portátil do projeto.
- **Modo real de pesquisa:** O ambiente local foi ajustado para `ENABLE_REAL_CONNECTORS=true` e `SHOW_SCRAPER_WINDOW=true`, permitindo abertura visível dos portais em vez de retorno instantâneo por mock.
- **Diagnóstico de conectores:** O registro de conectores agora expõe o modo ativo (`real` ou `mock`) para conferência técnica.
- **Credenciais Santa Cruz sem hardcode:** O conector real da Santa Cruz passou a ler usuário, senha e código do cliente do SQLite local, em vez de manter login fixo no script PowerShell.
- **Compatibilidade de senhas salvas:** O cofre local agora reconhece credenciais salvas por DPAPI e também entradas legadas/fallback em Base64 usadas fora do Electron.
- **Busca curta com nome + dosagem:** Pesquisas como `losartana 50mg` agora podem recomendar produtos compatíveis mesmo sem apresentação explícita, mantendo alertas de auditoria quando faltar evidência como EAN.
- **ANB pela coluna Unit c/St.:** O scraper da ANB passou a usar a coluna `Unit c/St.` como preço oficial de cotação, sem somar, multiplicar ou usar o valor base da caixa.
- **Profarma pela rota funcional:** O conector agora normaliza `https://portal.profarma.com.br/portal/` para `https://portal.profarma.com.br/portal/default.aspx?painel=3`, evitando tela vazia/bloqueio na URL curta.
- **Santa Cruz pelo atalho correto:** O robô agora tenta abrir `Pe - SantaCruz.lnk` na área de trabalho pública e também reconhece `digitador-sd.exe`, usando a pasta de trabalho correta.
- **Cache Santa Cruz fora do caminho com acento:** A cópia temporária do banco H2 passou para `%TEMP%\\cotacao-santacruz-cache`, evitando falha por caminho com acento no workspace.

### Complemento 2026-07-17
- **ANB com promocao obrigatoria:** O scraper agora prioriza a selecao de promocao/condicao comercial antes de pesquisar e fecha overlays que bloqueiam a grade, evitando timeout e cotacao vazia.
- **Login ProfarmaOn:** A Profarma agora aponta para `https://pedido.profarma.com.br/`, preenche campos controlados por React/MUI com setter nativo e bloqueia a cotacao quando o portal rejeita as credenciais.
- **Santa Cruz portatil e autonoma:** O robô localiza a instalação por configuração, cache de caminho validado, processos, atalhos, registro, pastas padrão ou varredura limitada dos discos; depois abre, autentica, digita o medicamento e aguarda a grade ao vivo.
- **Precos somente ao vivo:** Removidos o leitor H2 da Santa Cruz e o cache de indisponibilidade de dez minutos. Nenhum preço, estoque ou ST armazenado participa de uma nova cotação.
- **Bloqueio de dados antigos:** Capturas reais sem `capturedAt` válido ou com mais de cinco minutos ficam bloqueadas antes do ranqueamento.
- **Mocks sem fallback silencioso:** O modo real, os mocks de conector e os mocks da interface agora exigem flags explícitas separadas; configuração ausente interrompe a cotação.
- **Falhas visíveis por fornecedor:** Credenciais ausentes, login rejeitado, falha de página, timeout e aplicativo em atualização geram linha bloqueada de fornecedor não consultado, sem fingir que o produto está indisponível.
- **Timeouts configuraveis:** `SCRAPER_TIMEOUT_MS`, `SANTACRUZ_STARTUP_WAIT_SECONDS`, `SANTACRUZ_UPDATE_WAIT_SECONDS` e `SANTACRUZ_RESULT_WAIT_SECONDS` permitem ajustar testes reais sem alterar código.
- **Encerramento do diagnóstico:** O utilitário de cotação ao vivo agora fecha o SQLite e solicita saída normal do Electron, evitando erro nativo depois de uma captura já concluída.
- **Instância Santa Cruz sem janela:** O localizador detecta `javaw` da Santa Cruz ativo sem janela e não abre processos duplicados; a cotação informa o bloqueio específico para correção do aplicativo fornecedor.
- **Atualização antes da abertura:** `npm run dev` e todos os atalhos `.bat` agora passam por `scripts/bootstrap.mjs`, que verifica código remoto, reconcilia dependências e só então inicia Vite/Electron.
- **Git conservador:** Atualizações de código exigem worktree limpa e upstream válido ou branch idêntica ao padrão de `origin`, sendo aplicadas exclusivamente com `fast-forward`; alterações locais, falta de rede ou branch sem referência segura mantêm a versão instalada intacta.
- **Dados locais preservados:** A trava Git considera alterações em arquivos rastreados; artefatos locais não rastreados não impedem a consulta de versão e continuam protegidos pelo abortamento automático do merge em caso de conflito. `log/` e `scratch/` passaram a ser ignorados pelo Git.
- **Dependências automáticas:** O bootstrap executa `npm install --no-audit --no-fund` em cada preparação, atendendo mudanças de `package-lock.json` sem etapa manual.
- **Atualizador Electron removido:** Eliminado o IPC que executava `git pull && npm install` com o aplicativo aberto; o aviso visual agora informa que a atualização será instalada na próxima abertura.
- **Teste do inicializador:** A suíte cobre atualização desativada, worktree alterada, ausência de upstream e repositório limpo apto a atualizar; `--diagnose` e `--prepare-only` permitem validação operacional sem abrir janelas.
- **Validação final:** Preparação real pelo mesmo comando dos atalhos concluída com dependências atualizadas, `npm test` 35/35, build aprovado, lint sem erros bloqueantes e `git diff --check` limpo.
- **Fluxo padrão de entrega:** As instruções do projeto agora exigem documentação, validação, commit e push ao final de cada alteração, sempre com revisão do staged diff e exclusão de segredos, bancos, logs, caches e binários locais de fornecedores.

## [1.2.1] - 2026-07-14

### Corrigido
- **Bloqueio de recomendação sem ST:** O motor de recomendação agora descarta `SEM_ST` antes do ranqueamento, impedindo que um item sem Substituição Tributária seja marcado como `Melhor preço com ST`.

### Adicionado
- **Cobertura de testes de segurança de cotação:** A suíte passou a validar bloqueio de `SEM_ST`, divergência numérica de dosagem, item indisponível estruturado, busca vaga, recálculo manual no SQLite e estrutura da exportação XLSX.

## [1.2.0] - 2026-07-14

### Adicionado
- **Criptografia Local de Credenciais (safeStorage):** Integração com DPAPI do Windows via safeStorage do Electron para criptografar as senhas de distribuidoras de forma segura.
- **Validador EAN-13:** Validador matemático do dígito verificador EAN-13 para evitar pesquisas falsas baseadas em CNPJs ou números aleatórios.
- **Validação Numérica de Dosagem:** Comparador estrito de dosagens baseado no valor numérico exato (ex: 5mg vira 5.0, 50mg vira 50.0), eliminando o risco de pareamento de dosagens incorretas (como 5mg com 50mg).
- **Lookahead Negativo no Parser:** Regra avançada no leitor de dosagem para ignorar números avulsos que representem quantidades de embalagem (como 30 ou 60 cp).
- **Autolimpeza de Arquivos Temporários:** Rotina automática de inicialização no `main.js` que limpa capturas de tela e arquivos HTML do diretório `scratch/` que tenham mais de 24 horas de criação.

### Modificado
- **Fechamento Automático do Terminal:** Configurada a flag `-k` no `concurrently` do `package.json` para matar os servidores de segundo plano e fechar o terminal CMD automaticamente ao fechar o app Electron.
- **Filtro de Preço Unitário Visual:** Removida a exibição de preço unitário das planilhas Excel e das tabelas de exibição do painel frontend para foco total no preço final de caixa.
- **Suporte a Espaços de Dosagem Web:** Atualizado o robô do scraper para aceitar dosagens com espaços (ex: "25 mg").

## [1.1.0] - 2026-07-14

### Adicionado
- **Suporte a Banco de Dados Híbrido:** Conexão nativa com PostgreSQL e SQLite selecionada dinamicamente via arquivo `.env`.
- **Tradução Automática de SQL:** Conversor em tempo real de placeholders `?` para `$1` e comandos `INSERT OR IGNORE` para `ON CONFLICT DO NOTHING`.
- **Auditoria de Logs em Banco:** Armazenamento persistente de avisos e erros na tabela `SystemLog` para análise.
- **Painel de Logs Visual:** Nova aba no React Frontend para visualização direta dos logs em tempo de execução.
- **Destaque "Melhor Condição Geral":** Dashboard em destaque no topo exibindo o fornecedor com o menor custo por comprimido e estimativa de economia real.
- **Guia do Sistema para IAs:** Criação do guia técnico `docs/AI_SYSTEM_GUIDE.md` para onboarding de agentes de IA.

### Modificado
- Refatorado `database.js` para abstrair os drivers de banco e suportar transações dinâmicas.
- Refatorado `logger.js` com auto-rotação física de arquivos de log limitados a 2MB.
- Atualizado o visualizador principal `App.jsx` com paleta escura premium, tabs de navegação e novas tabelas.
- Atualizado `preload.js` e `main.js` para expor o barramento IPC de logs.
