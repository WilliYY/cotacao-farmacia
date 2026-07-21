# Changelog - Cotador Inteligente ST

Histórico estruturado de todas as alterações de engenharia realizadas no projeto.

---

## [1.7.0] - 2026-07-21

### Atualização automática em vários computadores
- **Atualização em toda abertura:** cada instalação Git faz `fetch` e `merge --ff-only` antes do Electron, depois reconcilia dependências e runtime.
- **Verificação contínua:** o aplicativo consulta o upstream de forma oculta a cada 15 minutos e avisa sobre uma versão que será aplicada na próxima abertura.
- **Estado visível e portátil:** `logs/update-status.json` registra versão, branch, horário e resultado sem credenciais; falta de internet, `.git`, upstream ou segurança da árvore aparece na própria interface.
- **Pré-requisitos sem falha silenciosa:** o launcher avisa se Node.js não estiver instalado e a interface diferencia Git ausente de pasta sem metadados Git.
- **Dados locais preservados:** `.env`, banco SQLite, histórico, logins e logs permanecem fora do Git e nunca são substituídos pela atualização.
- **Dependências futuras:** política `allowScripts` aprova apenas `sqlite3@6.0.1` e `electron-winstaller@5.4.0`, ambas necessárias e fixadas no lockfile.

### Inicialização sem console
- **Uma única interface visível:** `wimi cotacao.bat`, `cotação.bat` e `start-app.bat` iniciam o bootstrap por `wimi cotacao.vbs`, mantendo o CMD oculto enquanto o Electron permanece aberto.
- **Erros preservados:** toda a saída do inicializador oculto fica em `logs/startup.log`, sem perder diagnóstico de atualização, dependências ou abertura do aplicativo.

### Resultado operacional e janela ampliada
- **Abertura maximizada:** o Electron aguarda `ready-to-show`, maximiza a janela e só então a exibe, com dimensões mínimas para preservar os controles.
- **Uma decisão por medicamento:** cada item recebe um cartão próprio com melhor opção, preço final, custo por unidade, distribuidora, embalagem, EAN, estoque e segunda opção comparável.
- **Hierarquia visual:** cabeçalho consolidado, métricas e linhas usam gradientes funcionais distintos para cobertura, sucesso, informação, revisão e bloqueio, sempre acompanhados de texto e ícone.
- **Tabela adaptativa:** a faixa intermediária de 901 a 1280 px ganhou cartões rotulados; desktop, notebook e celular permanecem sem estouro horizontal.
- **Resumo confiável:** `quote-summary.js` separa opções válidas, não encontrados, falhas e timeouts. Economia só é calculada entre ofertas de mesma prioridade ST, apresentação e quantidade.
- **Evidência persistente:** origem do preço, motivo/código de falha, timeout e fallback de busca sobrevivem ao ciclo SQLite/PostgreSQL e continuam visíveis ao reabrir o histórico.
- **Compatibilidade PostgreSQL:** linhas retornadas pelo driver recuperam os nomes camelCase esperados pela aplicação, preservando cobertura, falhas e origem do preço também no modo servidor.

### Limite de duração da cotação
- **Sem espera infinita:** portais web são interrompidos após 5 minutos; Santa Cruz e a cotação completa são encerradas após 10 minutos por padrão.
- **Cancelamento real:** BrowserWindow, espera de nova tentativa e automação PowerShell recebem sinal de cancelamento, evitando que o trabalho continue escondido depois da resposta.
- **Resposta parcial segura:** preços ao vivo concluídos permanecem salvos; fontes que excederam o limite ficam em vermelho como `supplier_timeout` ou `completed_with_timeout`, sem consulta a preço histórico.

### Inteligência de pesquisa
- **Contexto entre linhas:** `metformina 500` seguido de `met 850` gera `metformina 850mg`; termos curtos sem contexto seguro ficam vermelhos e não chegam aos fornecedores.
- **Várias dosagens:** `sinvastatina 20 40` é expandida em duas pesquisas independentes, sem confundir 40 com quantidade.
- **Correção rastreável:** erros e prefixos únicos, como `dapaglifozina` e `dapagli`, são pesquisados como `dapagliflozina`, mantendo visível a transformação aplicada.
- **Fallback EAN seguro:** EAN é tentado primeiro; somente resultado vazio permite busca pelo nome informado. Falha de rede ou portal permanece bloqueada.
- **Aprendizado sem preço antigo:** `QueryCorrection` guarda apenas associações linguísticas confirmadas por captura real; preço, estoque, ST e recomendação nunca são reutilizados.

### Automação e interface
- **ANB endurecida:** domínio permitido, contrato literal de cabeçalhos, preço exclusivo `Unit c/ST`, bloqueio de grade anterior, paginação sem duplicação e condição comercial configurável.
- **Falhas controladas:** rede/timeout recebem uma nova tentativa; erro determinístico de tela não entra em repetição e nenhum fornecedor cai para preço histórico.
- **Menos interferência:** portais web ficam ocultos por padrão. A Santa Cruz tenta preencher por UI Automation, reutiliza a tela de pesquisa e restaura a janela anteriormente ativa.
- **Conferência rápida:** histórico completo recolhido por padrão, busca por medicamento e painel de interpretação com correções e itens não encontrados em vermelho.
- **Progresso visível:** a espera agora exibe medicamento atual, percentual, cronômetro e o estado real de ANB, Profarma, Santa Cruz e DM Paraná. Nova tentativa, fallback de EAN, resultado vazio, falha e tempo limite aparecem sem interromper as demais fontes.

### Teste real ANB de 2026-07-21
- `losartana 50` `R$ 2,80`; `hidrocloro 25` `R$ 1,55`; `metformina 500` `R$ 3,92`; `met 850` `R$ 5,21`; `sinvastatina 20` `R$ 3,52`, todos exatamente iguais à conferência informada.
- `sinvastatina 40` retornou `R$ 6,49`. A opção de `R$ 5,97` estava sem estoque e nenhum item de `R$ 6,06` apareceu na grade ao vivo, portanto o sistema não forçou o valor antigo.
- `dapaglifozina 10` e `dapagli 10` foram corrigidos para `dapagliflozina 10`; ambos retornaram opção válida a partir de `R$ 55,25`.
- Repetição final de `losartana 50`: 12 resultados, 7 válidos e menor `Unit c/ST` de `R$ 2,80`.

### Auditoria das quatro rotas em 2026-07-21
- **Losartana 50 mg:** ANB `R$ 2,80` (`Unit c/ST`), Profarma `R$ 2,70` (`Preço Final`) e DM Paraná `R$ 2,66` (`Preço final: R$`).
- **Amitriptilina 25 mg:** ANB `R$ 7,44`, Profarma `R$ 7,93` e DM Paraná `R$ 5,58`, cada qual pela sua fonte final obrigatória.
- **Clonazepam 2 mg:** ANB `R$ 5,32`, Profarma `R$ 6,61` e DM Paraná `R$ 6,72`, cada qual pela sua fonte final obrigatória.
- **Santa Cruz:** instalação confirmada em `C:\Program Files (x86)\Pe - SantaCruz\digitador-sd.exe`, mas o processo `javaw.exe` permaneceu sem janela de pesquisa. As três consultas ficaram bloqueadas, sem preço antigo; o circuito evitou repetir a espera nas linhas seguintes.
- **Diagnóstico resiliente:** o fechamento de uma janela web oculta não encerra mais a auditoria enquanto um conector local ainda está trabalhando.

### Validação
- `npm test`: 89/89 testes aprovados, incluindo resumo comparável, normalização PostgreSQL, persistência de evidências, redução do progresso entre itens e eventos reais de início/conclusão dos conectores.
- Build, lint, sintaxe PowerShell, inspeção visual em 1600x900, 1200x800 e 390x844, e diagnóstico real ANB executados antes da publicação.

### Teste real de hidroclorotiazida 25 mg - 2026-07-21
- **DM Paraná:** `R$ 1,50`, Teuto, com estoque e ST, capturado exclusivamente de `Preço final: R$`.
- **ANB:** `R$ 1,55`, Medquímica, com estoque e ST, capturado exclusivamente de `Unit c/ST`. A linha de `R$ 1,48` foi rejeitada por falta de estoque.
- **Profarma:** encontrou EMS `R$ 1,97`, Germed `R$ 1,98` e Medley `R$ 2,15` em `Preço Final`, mas todas vieram sem ST e foram corretamente excluídas.
- **Santa Cruz:** o executável foi localizado, porém o processo Java permaneceu sem janela pesquisável; nenhum `Preço NF` foi aceito.
- **Diagnóstico mais claro:** respostas comerciais sem opção elegível agora usam `no_valid_option`; `blocked` fica reservado para falha de rota/infraestrutura.
- **DM contra catálogo antigo:** uma repetição expôs 200 cartões do catálogo geral após o portal ignorar o filtro. O robô agora exige correspondência direta, usa Enter real, limpa e tenta uma vez; a validação final retornou somente Teuto `R$ 1,50` e EMS `R$ 1,73`.

## [1.6.0] - 2026-07-17

### Conectores reais
- **ANB sem preço alternativo:** o valor aceito vem exclusivamente de `Unit c/ST`; a soma de emergência `Preço + ST` foi removida e a origem fica persistida em cada linha.
- **Profarma auditável:** resultados carregam `Preço Final` como fonte e medicamentos com ST ausente continuam fora do ranking.
- **Santa Cruz fail-closed:** o robô usa apenas `Preço NF`, aguarda até quatro minutos na inicialização Java e exige evidência de estoque na coluna `Disp.`; estado desconhecido não é recomendado.
- **DM portátil:** credenciais canônicas da DM são reconciliadas com o ID real do fornecedor no SQLite, mesmo quando a sequência interna não usa ID `4`.

### Resiliência e portabilidade
- **Credenciais internas portáteis:** `CREDENTIAL_STORAGE_MODE=plain` mantém as senhas no SQLite local sem vinculação DPAPI à máquina; arquivos locais continuam excluídos do Git.
- **Electron autocorrigível:** o bootstrap verifica se `electron.exe` realmente existe e executa `install-electron` quando o pacote npm está presente sem o runtime.
- **Falha de rede controlada:** portais web recebem uma única nova tentativa em erro transitório; configuração inválida e aplicativo local indisponível falham imediatamente e nunca consultam histórico.
- **Diagnóstico oficial:** `npm run diagnose:live` testa termos/fornecedores em sequência, preserva a origem exata do preço, grava relatório sanitizado e abre circuito após falha de infraestrutura.
- **Depuração portátil:** HTML e screenshots do scraper passam para `logs/scraper-debug`, sem caminho fixo de usuário.

### Teste real de 2026-07-17
- **ANB (`Unit c/ST`):** losartana 50 mg `R$ 2,71`; amitriptilina 25 mg `R$ 7,44`; clonazepam 2 mg `R$ 5,32`.
- **Profarma (`Preço Final`):** losartana 50 mg `R$ 2,70`; amitriptilina 25 mg `R$ 6,19`; clonazepam 2 mg `R$ 6,40`.
- **DM Paraná (`Preço final: R$`):** losartana 50 mg `R$ 2,66`; amitriptilina 25 mg `R$ 5,58`; clonazepam 2 mg `R$ 6,72`.
- **Santa Cruz:** instalação e atalho foram descobertos, mas o fornecedor retornou `503 Service Unavailable` na autorização da atualização e o Java permaneceu sem janela. A rodada ficou bloqueada antes das pesquisas dos três medicamentos, sem preço antigo ou estimado.

### Validação
- `npm test`: 61/61 testes aprovados, incluindo ID variável da DM, runtime Electron, caminho configurado da Santa Cruz, nova tentativa seletiva de rede e circuito por fornecedor.
- Parser PowerShell da Santa Cruz, build, lint, diagnóstico do bootstrap e `git diff --check` executados antes da entrega.

## [1.5.0] - 2026-07-17

### Interface
- **Área de trabalho modernizada:** navegação escura e conteúdo neutro de alto contraste, com hierarquia mais clara para pesquisa, resultados e configurações.
- **Preço auditável na tela:** cartões e tabela exibem `Unit c/ST`, `Preço NF`, `Preço Final` ou `Preço final: R$` conforme a distribuidora.
- **Responsividade operacional:** em telas menores, métricas, ações, filtros e distribuidores reorganizam sem rolagem horizontal; a tabela vira cartões rotulados.
- **Controles consistentes:** comandos usam ícones Lucide, foco visível, estados desabilitados e textos acessíveis sem alterar os fluxos Electron existentes.
- **Comparativo legível:** grupos de embalagens usam superfícies claras e contraste compatível com o restante do painel.

### Inicialização
- **Atalho oficial preservado:** `wimi cotacao.bat` continua encaminhando para `cotacao.bat`, que valida Node.js e executa o bootstrap de atualização/dependências.

### Validação
- Fluxos de pesquisa, configurações e resultados conferidos visualmente em desktop e celular, sem estouro horizontal ou erros no console.
- `npm test`, `npm run build`, `npm run lint`, `git diff --check` e bootstrap em modo de preparação executados antes da entrega.

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
