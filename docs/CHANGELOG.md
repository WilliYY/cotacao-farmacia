# Changelog - Cotador Inteligente ST

Histórico estruturado de todas as alterações de engenharia realizadas no projeto.

## [1.9.0] - 2026-08-23

### Playwright incremental na DM Paraná
- **Motor estruturado:** a DM agora tenta `playwright-core` com o Microsoft Edge instalado, usa seletores com espera real, perfil local persistente, paginação limitada e o mesmo contrato literal `Preço final: R$`.
- **Piloto opt-in e reversão segura:** `electron` permanece o padrão. `playwright` habilita o piloto; `auto` retorna ao BrowserWindow somente quando Playwright/Edge não inicia antes de qualquer interação. Layout, grade antiga, autenticação, CAPTCHA, rede, timeout e cancelamento nunca duplicam a tentativa em outro navegador.
- **Grade fresca obrigatória:** a busca registra a assinatura anterior, confirma o valor do campo e exige troca dos cartões ou uma resposta nova do próprio portal. Vazio precisa estabilizar e falha de rede posterior ao Enter bloqueia a fonte.
- **Rastreio sem senha:** traces começam depois do login e são gravados localmente apenas em falha por padrão. O conteúdo autenticado é tratado como sensível e limitado aos dez arquivos mais recentes. Cada oferta recebe evidência do motor usado e do eventual fallback.
- **Teste real do motor:** o smoke local iniciou o Edge via Playwright, extraiu preço final com ST, rejeitou o valor cru sem `Preço final: R$` e marcou corretamente o botão `Comprar` desabilitado como sem estoque.
- **Frescor correlacionado:** somente a resposta da API de produtos que contém o termo enviado pode confirmar uma grade sem alteração visual; tráfego paralelo de carrinho e sessão é ignorado.
- **Login e paginação resilientes:** campos renderizados com atraso são aguardados, páginas intermediárias vazias não são extraídas e o limite configurável falha de forma auditável em vez de truncar ofertas.
- **Evidência de falha:** timeout e motor usado (`playwright`/`electron`) também permanecem no histórico quando a distribuidora não responde.
- **Validação ao vivo em 23/08/2026:** `losartana 50mg` concluiu `1/1` diagnóstico na DM. Cinco cartões foram capturados; a linha de 100 mg foi bloqueada e quatro apresentações de 50 mg ficaram válidas. O menor `Preço final: R$` elegível foi `R$ 2,75`, EAN `7896112114185`, com estoque e `COM_ST`.
- **Regressão:** 185 testes cobrem seleção de motor, grade fresca, vazio estável, rede posterior ao Enter, fallback estreito, classificação de falhas, persistência do motor e extração real do DOM, além dos contratos anteriores.

## [1.8.10] - 2026-08-08

### EAN puro e auditoria real da Santa Cruz
- **Falso bloqueio corrigido:** uma busca contendo somente EAN agora aceita a identidade exata devolvida pelo fornecedor sem exigir apresentação ausente na consulta. EAN acompanhado de descrição conflitante continua bloqueado pela auditoria final.
- **EAN validado ao vivo:** `7891721201806` retornou `GLIFAGE XR 500MG C/30 COMPRIMIDOS`, `Preço NF: R$ 7,25`, EAN idêntico, estoque disponível, `COM_ST` e auditoria `OK`. `7897595901316` confirmou `PURAN T4 50MCG C/30 COMPRIMIDOS`, `Preço NF: R$ 15,71`.
- **Contexto e fallback validados:** `puran 50`, `hidrocloro 25`, `clenil 250` e `olmesartana hidrocloro 20/12,5mg 30 comp` encontraram opções válidas com dose correta. A associação rejeitou 15 linhas incompatíveis antes de aprovar somente as combinações completas.
- **Grade completa e limpeza:** uma busca ampla por `losartana` validou dinamicamente a coluna `Preço NF`, percorreu `47/47` linhas, confirmou a atualização da grade e terminou com `searchCleared: true`. A Santa Cruz permaneceu aberta e responsiva.
- **Regressão:** testes de recomendação cobrem EAN puro exato e EAN exato acompanhado de descrição conflitante, além das proteções anteriores de preço, estoque, ST, dose, apresentação, associação, timeout e portabilidade.

## [1.8.9] - 2026-08-08

### Lotes reais e fallback seguro de associações
- **Associação com busca ampla controlada:** quando uma associação explícita não retorna linhas pelo nome completo, ANB, Profarma, Santa Cruz e DM Paraná tentam um único princípio ativo na ordem escrita. Os resultados continuam obrigados a conter todos os princípios, todas as doses, apresentação, estoque, ST e o campo oficial de preço; produtos simples permanecem bloqueados.
- **Catálogo canônico auditado:** todos os princípios ativos cadastrados e as 38 marcas de referência são verificados por teste. `amlodipino` permanece aceito como alias de `anlodipino`, sem duplicar o princípio ativo canônico.
- **Prazo visível corrigido:** o andamento agora mostra o limite total recebido do backend. A configuração atual limita portais web a 5 minutos, Santa Cruz a 10 minutos e a cotação completa a 10 minutos; resultados concluídos são preservados quando o limite encerra fontes pendentes.
- **Teste real com vários itens:** a Santa Cruz reutilizou a janela aberta em cinco pesquisas sequenciais, permaneceu aberta e pronta ao final e retornou `Preço NF` válido para losartana 50mg (`R$ 2,82`) e hidroclorotiazida 25mg (`R$ 1,97`). Metformina 500mg e Puran T4 50mcg foram encontrados, mas corretamente excluídos por estoque indisponível.
- **Teste real dos portais:** a ANB confirmou `Unit c/ST` de losartana 50mg (`R$ 2,80`), hidroclorotiazida 25mg (`R$ 1,55`) e metformina 500mg (`R$ 3,92`). No reteste da associação olmesartana + hidroclorotiazida 20/12,5mg, a busca segura passou a encontrar opções válidas na ANB (`R$ 14,76`), Profarma (`R$ 25,53`) e Santa Cruz (`R$ 22,74`); a DM retornou somente olmesartana simples e foi recusada.
- **Cobertura:** a suíte passou a ter 171 testes para nomes canônicos, marcas de referência, fallback de associação e prazo exibido, além das proteções anteriores de EAN, ST, estoque, timeout, cancelamento e recuperação de fornecedores.

## [1.8.8] - 2026-08-08

### EAN exato e integridade da grade da Santa Cruz
- **EAN confirmado na ANB:** uma busca por EAN com exatamente uma linha nomeada pode usar o código pesquisado como evidência explícita somente com `Unit c/ST`, disponibilidade e preço monetário plausível, sem aceitar grades ambíguas ou um EAN conflitante retornado pelo portal.
- **Corroboração entre distribuidoras:** quando uma fonte retorna o EAN exato, o sistema pode completar uma linha sem código de outra fonte somente se nome, associação, dose, apresentação e quantidade/tamanho da embalagem estiverem presentes e conferirem. Uma fonte vazia pode ser repetida pelo nome confirmado, mantendo o EAN original como filtro obrigatório.
- **Santa Cruz protegida contra grade transitória:** linhas que usam qualquer valor com escala de código de barras como `Preço NF` são descartadas e a pesquisa é repetida no máximo uma vez. Persistindo a inconsistência, a fonte fica bloqueada como alteração de tela em vez de produzir uma cotação falsa.
- **Validação real do Puran T4 em 04/08/2026:** os 10 EANs informados foram reconhecidos na ANB com os mesmos valores manuais; o Puran T4 62,5 mcg foi localizado, mas excluído por falta de estoque. O EAN `7897595901316` também foi confirmado na Santa Cruz como `PURAN T4 50MCG C/30 COMPRIMIDOS`, `Preço NF: R$ 15,71`, disponível e com ST.
- **Revalidação em 08/08/2026:** o EAN `7897595901316` retornou na ANB por `Unit c/ST: R$ 15,34`; a Profarma respondeu `Preço Final: R$ 15,10`, mas sem estoque; a DM Paraná confirmou grade vazia. O atualizador da Santa Cruz respondeu `503 Service Unavailable` e depois não expôs o campo de pesquisa, portanto a fonte foi corretamente bloqueada como falha técnica, sem reaproveitar o preço de 04/08/2026.
- **Cobertura:** adicionados testes para busca exata de resultado único, conflito/ambiguidade de EAN, corroboração segura entre fontes, fallback por identidade completa e rejeição de linha corrompida da Santa Cruz.

## [1.8.7] - 2026-08-03

### Recuperação do atualizador e retenção de diagnósticos
- **Erro de repositório separado:** falha de permissão, diretório inseguro ou leitura corrompida do Git agora aparece como `repository-error`; não é mais confundida com alterações locais no projeto.
- **Git realmente oculto:** as verificações em segundo plano e o `fetch` de abertura usam `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=Never`, impedindo uma janela invisível de aguardar login indefinidamente.
- **Reserva VBS isolada:** o launcher de compatibilidade ganhou log único por abertura e valida `cotacao.bat` antes de executar, evitando disputa pelo antigo `logs/startup.log` e erro silencioso em cópia incompleta.
- **Logs de abertura limitados:** o PowerShell preserva somente os 30 diagnósticos `startup-*.log` mais recentes sem impedir a inicialização quando a limpeza falha.
- **Banco com retenção:** `SystemLog` mantém no máximo 5.000 registros, é podado na abertura e a cada 100 novas mensagens; o histórico de cotações e os preços capturados não são afetados.
- **Regressão automatizada:** a suíte cobre ambiente Git não interativo, distinção de erro do repositório, launchers portáteis e retenção ordenada dos logs do banco.

## [1.8.6] - 2026-08-03

### Atualização multi-PC auditada e atalhos protegidos
- **Atualização Git simulada de ponta a ponta:** a suíte cria repositório remoto e clone temporários, aplica um `fast-forward` real e comprova que histórico divergente ou servidor indisponível preservam a instalação.
- **Canal exato:** `AUTO_UPDATE_BRANCH` agora bloqueia uma máquina que esteja em outra branch, em vez de atualizar silenciosamente pelo upstream incorreto.
- **Internet instável:** o `fetch` passou de 5 para 30 segundos por padrão, com faixa configurável de 5 segundos a 2 minutos e limpeza de referências remotas removidas por `--prune`.
- **Divergência protegida:** commits locais, histórico divergente, upstream removido e falha de comparação possuem estados próprios e nunca disparam `merge`.
- **Configuração coerente:** opções de atualização carregadas do `.env` são repassadas ao Electron; desativar a atualização também desativa a consulta periódica.
- **Atalho verificado:** depois de criar o `.lnk`, o sistema relê destino, argumentos e diretório de trabalho. O gerador de ícones antigo passou a usar o criador portátil canônico e não gera mais atalho local ou destino VBS.
- **Validação automática no GitHub:** workflow Windows executa `npm ci`, testes, lint, build e validação sintática dos scripts PowerShell em cada push e pull request; a documentação deixa explícito que proteção de branch ainda é necessária para transformar essa validação em bloqueio de publicação.
- **Validação local limpa:** `npm ci` reinstalou 396 pacotes; o bootstrap detectou o runtime Electron ausente, baixou-o novamente e concluiu `--prepare-only` com código `0`. Também passaram 160 testes, lint com 0 erros e 22 avisos preexistentes, build Vite, parser PowerShell e validação real do atalho desta instalação.

## [1.8.5] - 2026-07-30

### Inicialização portátil sem dependência do VBScript
- **Causa confirmada no segundo computador:** o atalho copiado apontava para `C:\Users\Pichau\Desktop\wimi cotacao.vbs`, caminho absoluto que não existia na nova máquina. A atualização do projeto não havia corrompido o VBS.
- **PowerShell como rota principal:** `wimi cotacao.bat` agora inicia pelo PowerShell nativo do Windows sem janela visível; o VBS permanece apenas como compatibilidade quando o PowerShell não estiver disponível.
- **Atalho por computador:** a primeira abertura pela pasta recria somente o atalho da Área de Trabalho, apontando para o caminho real daquela cópia. O projeto não gera mais um `.lnk` local que poderia ser levado para outra máquina com destino antigo.
- **Pasta gravável obrigatória:** antes de iniciar, o launcher testa a escrita em `logs` e orienta a copiar a pasta do pendrive para a Área de Trabalho quando o local estiver protegido.
- **Logs concorrentes:** cada abertura usa `logs/startup-*.log`; uma instância já aberta não bloqueia o diagnóstico ou a próxima inicialização.
- **Falha sem processo preso:** o lote técnico não executa `pause` quando foi iniciado oculto, evitando um CMD invisível esperando indefinidamente.
- **Validação real:** `wimi cotacao.bat --launcher-wait --diagnose` retornou `exit 0`, registrou o diagnóstico completo e gerou um atalho cujo destino é o PowerShell do Windows e cujo argumento referencia a pasta atual.

## [1.8.4] - 2026-07-29

### Distribuidoras selecionadas por cotação
- **Padrão seguro:** ANB, Profarma, Santa Cruz e DM Paraná agora começam desmarcadas na abertura da tela.
- **Nova cotação limpa:** ao clicar em `Nova Cotação`, a seleção anterior não é reaproveitada; o operador escolhe novamente somente as fontes desejadas.
- **Pesquisa protegida:** o botão `Pesquisar preços` permanece desabilitado e o manipulador interrompe a execução enquanto nenhuma distribuidora estiver selecionada.
- **Interface clara:** o cabeçalho mostra `0 de 4 distribuidoras` e orienta a selecionar ao menos uma fonte antes da pesquisa.
- **Regressão automatizada:** o teste cobre o estado inicial vazio, a lista de escolhas explícitas, o reset e a trava da interface.
- **Validação geral:** 156 testes aprovados, lint com 0 erros e 22 avisos preexistentes, build de produção concluído e inspeção visual em `1427x900` e `390x844` sem erros no console ou rolagem horizontal.

## [1.8.3] - 2026-07-29

### Busca resiliente e dose exata na Santa Cruz
- **Três variantes ordenadas:** buscas com dose agora tentam o texto completo, repetem sem `mg`, `mcg`, `g`, `ml` ou `ui` e, após vazio confirmado, pesquisam somente nome ou princípio ativo.
- **Dose original obrigatória:** a busca ampla continua filtrada pela dose solicitada; a comparação usa limites numéricos e de unidade, impedindo que `25mcg` aceite `125mcg`.
- **Marca Puran corrigida:** `Puran`, `Puran T4` e o atalho `T4` passam a resolver para levotiroxina sem substituir o texto digitado no portal; números sem unidade nesses nomes são interpretados em `mcg`.
- **Preço preservado:** a Santa Cruz continua aceitando exclusivamente a coluna literal `Preço NF`; preço parcial, coluna ambígua, grade antiga e aplicativo sem resposta permanecem bloqueados.
- **Aplicativo preservado:** cada tentativa limpa o campo e reutiliza a mesma janela. Timeout ou travamento interrompe o auxiliar sem fechar a Santa Cruz e sem reutilizar preço histórico.
- **Teste real:** `puran 25` percorreu `puran 25mcg`, `puran 25` e `puran`, varreu 13 linhas e retornou somente `PURAN T4 25MCG C/30 COMPRIMIDOS`, EAN `7897595901309`, com `Preço NF` de `R$ 13,48`, estoque disponível e ST válido.
- **Teste real de losartana:** após reabrir a Santa Cruz, `losartana 50` percorreu as três variantes, varreu 47 linhas e retornou 10 produtos de 50mg. Nove ofertas ficaram bloqueadas por `SEM_ST`; a única com ST era `LOTAR 5/50MG`, associação incompatível, e também foi rejeitada. Nenhum preço incorreto entrou na recomendação.
- **Recuperação confirmada:** a Santa Cruz ficou sem resposta após várias automações consecutivas, foi interrompida sem preço parcial e sem fechamento forçado; depois de reaberta pelo operador, concluiu a busca seguinte, limpou o campo e permaneceu no estado `ready`.
- **Autoteste portátil:** o PowerShell valida sem abrir o fornecedor a ordem dos fallbacks, o token curto `T4` e os limites exatos que aceitam 25mcg e rejeitam 125mcg.
- **Validação geral:** 155 testes aprovados, lint com 0 erros e 22 avisos preexistentes, build de produção concluído e dois diagnósticos ao vivo sem reutilização de preços antigos.

## [1.8.2] - 2026-07-29

### DM Paraná visível nos testes do frontend
- **Causa identificada:** o teste visual fora do Electron gerava ofertas apenas para algumas fontes fixas e ignorava a lista de distribuidoras selecionadas, fazendo a DM parecer indisponível mesmo com o conector real funcionando.
- **Simulação fiel às fontes:** o modo visual agora inclui somente as distribuidoras selecionadas, garante cobertura das quatro fontes e preserva os rótulos oficiais `Unit c/ST`, `Preço Final`, `Preço NF` e `Preço final: R$`.
- **Separação segura:** valores simulados continuam restritos ao opt-in `VITE_ENABLE_UI_MOCKS=true`; a cotação real, o ranking e os conectores de produção não foram alterados.
- **Teste ao vivo da DM:** em 29/07/2026, a consulta isolada retornou opções válidas para losartana 50 mg, hidroclorotiazida 25 mg e metformina 500 mg. Os menores `Preço final: R$` capturados foram `R$ 2,66`, `R$ 1,50` e `R$ 3,88`, respectivamente.
- **Regressão automatizada:** novos testes exigem a presença da DM e o rótulo oficial de preço no simulador, além de confirmar que fontes desmarcadas não aparecem.
- **Portabilidade preservada:** os testes do bootstrap continuam aprovando atualização automática em clone Git limpo e rastreado; a entrega permanece pelo `wimi cotacao.bat`.
- **Validação geral:** 154 testes aprovados, lint com 0 erros e 22 avisos preexistentes, build de produção concluído e inspeção visual com 13 ofertas nas quatro fontes sem erros no console.

## [1.8.1] - 2026-07-28

### Resultado da cotação modernizado
- **Leitura operacional mais rápida:** cabeçalho, cobertura, indicadores e estados da cotação ganharam hierarquia visual clara sem alterar os cálculos ou a origem dos preços.
- **Recomendações mais verificáveis:** melhor opção e segunda opção mantêm visíveis a distribuidora, o campo oficial de preço, custo por unidade, embalagem, EAN e estoque.
- **Comparação de embalagens reorganizada:** as opções de 30, 60 e 90 unidades usam o custo unitário como referência e distinguem com clareza o preço final da embalagem.
- **Detalhamento responsivo:** filtros e ofertas capturadas foram agrupados em uma seção própria; no celular, cada linha continua legível sem rolagem horizontal.
- **Acabamento textual:** contagens de ofertas e fontes respeitam singular e plural.
- **Validação:** cotação simulada com três medicamentos foi conferida em `1648x956` e `390x844`, incluindo comparação expandida e tabela responsiva, sem overflow ou erros no console. A suíte completa passou com 150 testes; lint terminou com 0 erros e 23 avisos preexistentes; build de produção concluído.

## [1.8.0] - 2026-07-28

### Barra lateral operacional renovada
- **Histórico mais útil:** cada cotação exibe data, hora e um resumo dos medicamentos pesquisados, com contador de resultados e destaque claro para o item ativo.
- **Navegação acessível:** itens do histórico agora são botões navegáveis por teclado, o selecionado usa `aria-current` e o filtro possui ação dedicada para limpeza.
- **Mais buscados organizados:** pesquisas recorrentes aparecem em ordem numerada, com contagem e alvo de clique mais previsível.
- **Ações sempre visíveis:** `Nova Cotação` e `Configurar Logins` ficam separadas do conteúdo rolável e usam o mesmo acabamento escuro da barra.
- **Responsividade corrigida:** em telas estreitas o histórico mantém uma área rolável de `128px` em vez de encolher até desaparecer.
- **Validação visual:** estados expandido, recolhido, filtrado e selecionado foram conferidos em `1427x900` e `390x844`, sem erros no console; lint e build de produção concluíram sem erros.

## [1.7.9] - 2026-07-28

### Revisão da recuperação transitória
- **Falhas realmente consecutivas:** indisponibilidade de estoque ou outra rejeição específica do produto não aumenta mais o contador de oscilações de rede.
- **Resposta vazia válida:** quando o portal confirma que não encontrou o medicamento, a conexão é considerada recuperada e deixa de repetir a pausa `half-open` nos itens seguintes.
- **Evidência por distribuidora:** `processQuoteQuery` registra se cada fonte concluiu, respondeu vazia, falhou ou foi bloqueada, sem transformar ausência de oferta em queda do portal.
- **Dependência corrigida:** `tar` foi fixado em `7.5.22`, removendo o alerta moderado presente na árvore de produção sem alterar as APIs do aplicativo.
- **Risco conhecido:** `xlsx@0.18.5` permanece sinalizado pelo `npm audit` sem correção disponível no npm. O aplicativo só gera planilhas com dados internos e não abre arquivos XLSX externos; a troca da biblioteca exige migração separada.
- **Risco de desenvolvimento:** versões antigas de `brace-expansion` ainda são trazidas pelas ferramentas de empacotamento. A correção automática exigiria uma alteração principal sugerida pelo npm e foi recusada nesta revisão para não arriscar a geração do aplicativo.
- **Validação:** dois testes de regressão reproduzem os estados incorretos anteriores e a suíte completa passa com 150 testes.

---

## [1.7.8] - 2026-07-28

### Recuperação automática das distribuidoras
- **Circuito half-open:** três falhas transitórias consecutivas não removem mais a distribuidora do restante da cotação. A fonte aguarda uma pausa curta, recebe uma tentativa única no item seguinte e volta automaticamente após uma captura ao vivo válida.
- **Bloqueio seletivo:** rede, DNS, timeout, HTTP `429/502/503/504` e oscilação da Santa Cruz são recuperáveis; login, credenciais, CAPTCHA, aplicativo ausente e layout incompatível continuam bloqueados até intervenção.
- **Santa Cruz preservada:** `not-responding`, falha de digitação/envio, grade antiga e timeout de varredura podem se recuperar sem fechar o aplicativo. Dúvida de estoque bloqueia somente o item; ausência de `Preço NF` ou da grade exige revisão da rota.
- **Diagnóstico alinhado:** `diagnose:live` usa o mesmo estado de incidentes da aplicação e deixa de abandonar uma distribuidora por uma única queda.
- **Visibilidade:** o painel exibe `Recuperando` durante a reentrada e confirma quando a fonte voltou a fornecer preços atuais.
- **Portabilidade:** limiar e pausa são configuráveis por `SUPPLIER_FAILURE_THRESHOLD` e `SUPPLIER_RECOVERY_COOLDOWN_MS`, com limites defensivos iguais em todos os computadores.
- **Preço ao vivo:** recuperação nunca consulta histórico ou cache; falhas continuam com preço zero e fora do ranking.
- **Validação automatizada:** transição para half-open, classificação de falhas, reentrada, recuperação dentro de `processQuoteQuery` e estados visuais possuem cobertura dedicada.
- **Validação real:** a cotação `#17` consultou ANB, Profarma, Santa Cruz e DM Paraná para losartana 50 mg, hidroclorotiazida 25 mg e metformina 500 mg; terminou com 25 ofertas válidas, nenhuma falha e nenhuma revisão. A Santa Cruz permaneceu aberta, retornou `Preço NF` e deixou a busca vazia.

---

## [1.7.7] - 2026-07-28

### Prontidão visível e concorrência da Santa Cruz
- **Estado antes da cotação:** a tela inicial mostra se a Santa Cruz está pronta, verificando, preparando, atualizando, ocupada, sem responder ou bloqueada, incluindo o motivo técnico e as ações `Verificar` e `Preparar Santa Cruz`.
- **Proteção contra concorrência:** a cotação não inicia enquanto o preparo controla a Santa Cruz; respostas antigas de verificações em andamento são descartadas para não sobrescrever o estado mais recente.
- **Acessibilidade:** o painel anuncia atividade com `aria-busy`, usa rótulos explícitos para os estados finais do auxiliar e mantém contraste textual compatível com leitura operacional.
- **Layout compacto:** o cartão da cotação não é mais comprimido abaixo de seu conteúdo. Em telas baixas ou estreitas, a área principal passa a rolar sem a barra de ações cobrir o estado da Santa Cruz.
- **Validação:** 140 testes automatizados, build de produção, lint sem erros e inspeção visual em 1440x900, 1024x768, 768x900 e 320x900.

---

## [1.7.6] - 2026-07-28

### Farmácia Popular, identidade e portabilidade
- **Elenco oficial completo:** catálogo nacional atualizado em 14/07/2026 com 41 apresentações exatas, comando `npm run diagnose:farmacia-popular` e auditoria operacional documentada.
- **EAN ANB fail-closed:** o código pesquisado não é mais copiado para uma linha sem barcode. Sem evidência explícita, a oferta permanece bloqueada ou segue para fallback nominal quando existe descrição.
- **Estoque Profarma fail-closed:** linhas sem `input` ou botão semântico de incremento habilitado deixam de ser tratadas como disponíveis.
- **Associações por princípio e dose:** doses explícitas ficam vinculadas ao ingrediente correspondente; associações com concentrações trocadas ou evidência incompleta são bloqueadas.
- **Contexto de lote:** `met 850` pode herdar metformina, mas `met 25` volta como abreviação ambígua em vez de assumir o medicamento anterior.
- **Insumos e insulinas:** absorvente higiênico e fralda geriátrica preservam identidade no parser; análogos como glargina e lispro não são classificados como insulina humana do programa.
- **Histórico completo:** classificação Farmácia Popular persiste em SQLite/PostgreSQL; `unitPrice` é sempre recalculado de `price / quantity` para impedir ordenação por valor divergente enviado pelo conector.
- **Falha técnica distinta:** timeout, rede e atualizador indisponível não aparecem como sem estoque ou produto inexistente.
- **Portabilidade Santa Cruz:** o auxiliar PowerShell é empacotado como recurso, descobre a instalação local e recebe credenciais por ambiente, sem expô-las na linha de comando.
- **Trava global Santa Cruz:** busca, preparo e limpeza usam mutex nomeado do Windows; duas instâncias ou um diagnóstico concorrente recebem `busy` em vez de controlar a mesma janela.
- **Pacote validado estruturalmente:** a pasta Windows descompactada foi gerada com `app.asar`, executável e `resources/santacruz-search.ps1`; o SHA-256 do recurso empacotado confere com a fonte atual e o `app.asar` passou nos modos diagnóstico e gráfico.
- **Inicialização portátil verificável:** `scripts/live-diagnostic.mjs` agora integra o `app.asar`; o banco tem limite padrão de 2 minutos e falhas de inicialização são registradas, fecham recursos e encerram o Electron em vez de manter um processo indefinido.
- **Assinatura necessária para `.exe` avulso:** o Smart App Control desta máquina bloqueou o hash novo sem Authenticode nos eventos `3033`/`3077`; a implantação suportada entre computadores continua pelo clone Git com `wimi cotacao.bat` até existir certificado confiável.
- **Validação real:** ANB, Profarma e DM Paraná cotaram `losartana 50mg` pelos campos oficiais; a Santa Cruz respondeu `503 Service Unavailable` no atualizador e foi bloqueada sem reutilizar preço.

---

## [1.7.5] - 2026-07-25

### Identidade do produto, Clenil e interface de pesquisa
- **EAN fail-closed:** codigos EAN-13 invalidos deixam de ser enviados como nome; a ANB somente associa a evidencia da busca exata quando existe uma unica linha, e consultas com EAN + descricao continuam obrigadas a conferir o nome informado.
- **Dose com unidade e associacoes:** a auditoria diferencia `mcg`, `mg`, `g`, `ml` e `ui`, converte unidades de massa equivalentes e exige todas as doses de associacoes compactas como `20/12,5mg`.
- **Clenil por marca ou principio ativo:** `clenil 250`, `clenil 250 mcg` e `clenil 250 inalador` sao interpretados como beclometasona 250mcg em spray, mantendo a marca como texto pesquisado nos portais.
- **Santa Cruz com `mcg`:** uma busca vazia por `clenil 250mcg` pode repetir uma unica vez por `clenil`, mantendo 250mcg como filtro obrigatorio e extraindo somente `Preco NF`.
- **DM Parana e falha de rede:** uma grade silenciosamente vazia so vira `not_found` depois de uma repeticao estavel; falha de rede detectada durante a busca interrompe antes dessa classificacao.
- **Interface mais legivel:** a tela inicial ocupa melhor janelas grandes, reduz espacos vazios, separa exemplos, fontes e acoes em faixas funcionais e identifica as quatro distribuidoras por cores distintas.
- **Validacao real de `clenil 250`:** ANB retornou `Unit c/ST` de R$ 37,21 (uma linha disponivel e outra bloqueada sem estoque), Profarma retornou `Preco Final` de R$ 36,73, Santa Cruz retornou `Preco NF` de R$ 37,21 e bloqueou a linha sem estoque; DM Parana confirmou ausencia sem fabricar preco.
- **Validacao automatizada:** `npm test` 132/132, `npm run build` aprovado, `npm run lint` com 0 erros e 69 avisos nao bloqueantes restantes; a verificacao visual anterior continua coberta pelos mesmos componentes.

### Robustez de execução e inteligência supervisionada
- **Timeout com encerramento observável:** a interface exibe `Encerrando` depois do limite, aguarda por um período curto a limpeza do conector e impede uma nova cotação de controlar a Santa Cruz antes da anterior terminar.
- **Santa Cruz serializada e preservada:** comandos GUI entram em uma fila única, o auxiliar PowerShell roda oculto, processos existentes sem janela reconhecida não são mais encerrados à força e uma linha só entra na cobertura depois da leitura de EAN, nome, disponibilidade, ST e `Preço NF`.
- **Limpeza fail-closed:** a ausência de `searchCleared: true` deixa de ser interpretada como limpeza confirmada.
- **Formulações distintas:** o parser e a auditoria diferenciam ampola de comprimido, concentração em `%`, liberação prolongada `XR`/`LP`/`retard`, equivalências `mg/ml`, volume da dose e tamanho real da embalagem, além de exigir os dois princípios ativos de marcas associadas como Selopress.
- **Identidade comprovada pelo fornecedor:** ANB, Profarma, Santa Cruz e DM Paraná derivam dose, apresentação, quantidade e embalagem do nome real retornado na grade/cartão; os dados digitados não são copiados para fazer uma oferta incompatível parecer correta.
- **EAN inválido com descrição:** um código de 13 dígitos com dígito verificador incorreto bloqueia a consulta mesmo quando a mesma linha também contém o nome do medicamento.
- **Aprendizado com aprovação humana:** resultados ao vivo não promovem aliases automaticamente. A memória linguística só aceita correções oficiais ou uma associação confirmada pelo operador com `APROVADO`; conflito posterior volta a bloquear o alias.
- **Atualização portátil protegida:** somente um bootstrap identificado por token atualiza, instala e compila por vez; um processo não remove o lock de outro, atualização Git força novo build e uma preparação que falhou é refeita na próxima abertura antes de registrar sucesso.
- **Diagnóstico contratual:** `diagnose:live` falha quando a captura não é recente ou quando a fonte não usa exatamente `Unit c/ST`, `Preço Final`, `Preço NF` ou `Preço final: R$`.
- **Teste real de indisponibilidade:** o preparo encontrou `503 Service Unavailable` no atualizador da Santa Cruz, preservou o `javaw.exe`, não inventou cotação e retornou falha verificável em 24,4 segundos com orientação para repetir quando o fornecedor voltar.
- **Teste real de grade completa:** com a janela recuperada, `losartana 50mg` exigiu 45 segundos de leitura, cobriu 47/47 linhas e limpou o campo. O menor `Preço NF` disponível com ST foi R$ 3,02; ofertas de R$ 2,82 e R$ 2,94 foram bloqueadas por falta de estoque.
- **Teste real dos portais web:** para `losartana 50mg`, ANB confirmou `Unit c/ST` de R$ 2,80, Profarma confirmou `Preço Final` de R$ 2,70 e DM Paraná confirmou `Preço final: R$` de R$ 2,66. As três fontes retornaram dose, apresentação, estoque e ST compatíveis.
- **Execução dentro do navegador:** o extrator de identidade agora é autônomo e injetado junto com os parsers dos portais; a regressão `parseSearchQuery is not defined` foi reproduzida ao vivo, corrigida e coberta por teste de serialização isolada.

---

## [1.7.4] - 2026-07-24

### Auditoria real das quatro distribuidoras
- **Diagnostico com credenciais locais:** os modos `--live-diagnostic` e `--prepare-santacruz` agora inicializam o SQLite antes de ler as configuracoes, evitando o falso aviso de credencial ausente.
- **Falha de portal nao vira produto inexistente:** mensagens como `CLIENT_FETCH_ERROR`, `Failed to fetch`, `NetworkError` e erros de conexao ocorridos depois do envio da pesquisa bloqueiam uma grade vazia como falha tecnica. O sistema nao grava nem reutiliza preco nesse caso.
- **Grade vazia fail-closed:** ANB e Profarma somente confirmam lista vazia quando a pagina mostra uma mensagem explicita de zero resultados. A passagem de tres segundos, sozinha, nao confirma mais `not_found`.
- **Fallback Profarma sem sufixo:** uma busca vazia com dose em `mg` e repetida uma unica vez sem o sufixo, por exemplo `metformina 500mg` para `metformina 500`; a dose original continua obrigatoria na auditoria dos resultados.
- **Erros transitorios ampliados:** `net::ERR_NAME_NOT_RESOLVED`, `ERR_TIMED_OUT`, `ERR_FAILED`, `CLIENT_FETCH_ERROR` e `Failed to fetch` sao falhas tecnicas elegiveis para a repeticao limitada do conector.
- **Cancelamento terminal:** cancelar interrompe novos itens, preserva ofertas ja capturadas e conclui a cotacao como `cancelled`. Timeout total usa `completed_with_timeout` e excecoes inesperadas deixam de ficar presas em `processing`, terminando como `failed`.
- **Santa Cruz aberta e autonoma:** a sessao existente foi detectada como pronta, reutilizada sem reiniciar ou fechar o aplicativo, percorreu todas as linhas e limpou o campo depois de cada item.
- **Validacao Santa Cruz:** `losartana 50` retornou `Preco NF: R$ 2,94`; `hidroclorotiazida 25`, `Preco NF: R$ 1,70`; `metformina 500`, `Preco NF: R$ 4,28`. Somente itens disponiveis e compativeis com a dose foram considerados.
- **Validacao web:** ANB confirmou `Unit c/ST` de R$ 2,80, R$ 1,55 e R$ 3,92 para os tres itens. DM Parana confirmou `Preco final: R$` de R$ 2,66, R$ 1,50 e R$ 3,88. Profarma confirmou losartana a R$ 2,70 e bloqueou hidroclorotiazida sem ST. Para metformina, `500mg` e `500` retornaram vazio confirmado; a busca ampla ficou sem resposta e foi interrompida pelo timeout tecnico, sem inventar preco.

---

## [1.7.3] - 2026-07-24

### Pesquisa Santa Cruz portátil e protegida
- **Preço NF validado pelo cabeçalho:** a automação resolve `Código EAN`, `Descrição`, `Disp.`, `ST` e `Preço NF` pelos cabeçalhos literais da grade. Cabeçalho ausente ou duplicado bloqueia a cotação, sem usar outra coluna monetária.
- **Pesquisa reutilizável:** o robô reutiliza a janela aberta, acessa `Lista de Produtos [F3]` somente quando a grade não está disponível, confirma o texto exato e limpa o campo ao terminar.
- **Fallback pelo princípio ativo:** quando nome + dose confirma zero resultados, a mesma sessão tenta uma vez apenas o princípio ativo com `Enter`, mantendo a dose original como filtro obrigatório em todas as linhas.
- **Estoque visual real:** o ponto verde/vermelho de `Disp.` é lido no centro da célula visível com coordenadas calculadas pela grade. Verde libera, vermelho bloqueia e evidência ambígua continua bloqueada.
- **Grade nova e estável:** preços somente são aceitos quando a assinatura final da grade é diferente da anterior e permanece igual em leituras consecutivas; uma grade vazia precisa ser confirmada em leituras estáveis antes do fallback.
- **Rolagem proporcional:** páginas são percorridas em incrementos calculados pelo tamanho visível da grade, cobrindo listas longas sem atalhos globais.
- **Cobertura completa:** somente linhas não ocultas pelo JavaFX contam como observadas; prazo excedido, cobertura parcial ou `Disp.` ilegível em qualquer apresentação compatível bloqueiam a fonte inteira, sem escolher um falso menor preço.
- **Travamento fail-closed:** `not-responding` interrompe a fonte sem fechar a Santa Cruz e sem transformar falha técnica em produto inexistente ou preço zero. Timeout ou cancelamento dispara uma tentativa limitada de limpar o campo e restaurar a rolagem.
- **Portabilidade entre computadores:** removidos caminho absoluto do Framework do Windows, unidade `C:` presumida e deslocamento fixo da lupa. Assemblies, `LocalApplicationData`, unidade do sistema, instalação da Santa Cruz, DPI, limites dos controles e rolagem são descobertos na máquina atual. Processos Java de outros programas não bloqueiam mais a abertura.
- **Diagnósticos novos:** `npm run diagnose:santacruz:discover` localiza a instalação sem abrir o aplicativo e `npm run diagnose:santacruz:status` verifica a sessão atual sem pesquisar.
- **Validação real:** `losartana 50mg` retornou vazio, o fallback `losartana` percorreu 47 linhas e reteve 9 apresentações de 50mg. O menor valor bruto de R$ 2,82 estava sem estoque; o menor elegível foi `Preço NF: R$ 3,02`, EAN `7896181915638`, com o campo limpo ao final.
- **Falha externa validada:** em uma tentativa posterior, o atualizador da Santa Cruz respondeu `503 Service Unavailable`. O preflight marcou `running-without-window`, bloqueou a distribuidora e preservou a evidência técnica, sem reutilizar a cotação anterior.

---

## [1.7.2] - 2026-07-22

### Expansão do Cérebro Farmacêutico e Inteligência de Cotações
- **Correção da Conclusão de Pesquisa da Profarma (`electron-scraper.js`):** Corrigido o fluxo de navegação pós-login que deixava o robô preso quando o portal redirecionava para rotas diferentes de `/inicio`. O robô agora garante o redirecionamento imediato para a rota oficial de catálogo `/novo-pedido`.
- **Parsing Flexível de Colunas Profarma (`parseProfarmaTableRow`):** Reduzido o limite mínimo de colunas de 14 para 5, permitindo capturar produtos na Profarma independente de variações de layout no portal.
- **Detecção Rápida de Produtos Sem Estoque / Não Encontrados (`explicitlyEmpty`):** Expandidos os padrões de verificação visual de retorno nulo (`nenhum registro`, `0 resultados`, `sem registros`), resolvendo buscas vazias em 3 segundos sem travar o tempo limite.
- **Inteligência Oficial do Programa Farmácia Popular do Brasil (`getFarmaciaPopularInfo`):** Mapeamento completo dos grupos farmacológicos cobertos pelo programa federal (Hipertensão, Diabetes, Asma, Osteoporose, Dislipidemia, Parkinson, Saúde da Mulher/Contracepção e Incontinência). O sistema agora identifica e anota automaticamente se o item cotado pertence ao programa com cobertura 100% Gratuita ou Copagamento Subsidiado.
- **Mapeamento de Medicamentos de Referência x Genéricos (`resolveReferenceBrandName`):** Adicionada tabela inteligente de conversão entre nomes comerciais consagrados de referência (`Glifage` -> `Metformina`, `Aradois` -> `Losartana`, `Selozok` -> `Metoprolol`, `Pura T4` -> `Levotiroxina`, `Crestor` -> `Rosuvastatina`, `Lipitor` -> `Atorvastatina`, `Jardiance` -> `Empagliflozina`, `Forxiga` -> `Dapagliflozina`, `Xarelto` -> `Rivaroxabana`, `Lexapro` -> `Escitalopram`, `Zoloft` -> `Sertralina`, `Lyrica` -> `Pregabalina`, `Seroquel` -> `Quetiapina`, `Novalgina` -> `Dipirona`, etc.).
- **Dicionário Farmacêutico Expandido (`ACTIVE_INGREDIENTS`):** Adicionados mais de 35 novos compostos ativos da curva A farmacêutica brasileira (empagliflozina, semaglutida, rosuvastatina, atorvastatina, rivaroxabana, apixabana, tadalafila, escitalopram, sertralina, pregabalina, quetiapina, etc.).
- **Mapas de Abreviaturas de Balcão (`EXACT_INGREDIENT_ALIASES`):** Adicionados reconhecimentos automáticos para termos curtos de balcão de farmácia (`pot` -> `potássica`, `sod` -> `sódica`, `clor` / `hcl` -> `cloridrato`, `metf` -> `metformina`, `losar` -> `losartana`, `sinvas` -> `sinvastatina`, `rosu` -> `rosuvastatina`, `atorva` -> `atorvastatina`, `esci` -> `escitalopram`, `sertra` -> `sertralina`, `tada` -> `tadalafila`).
- **Desambiguação de Dosagens Múltiplas (`COMMON_STRENGTHS_MG`):** Expandidas dosagens comuns para desambiguação automática de lotes e buscas sem perda de precisão fiscal.
- **Remoção do Banner Visual de Checagem (`santacruz-readiness`):** Removido da interface do usuário o bloco visual em azul (*"Verificando Santa Cruz - Verificando se a Santa Cruz está aberta e pronta"*). O sistema agora identifica a Santa Cruz instantânea e silenciosamente no momento da cotação ao vivo, eliminando qualquer atraso visual ou caixa de aguardo na tela inicial.
- **Remoção de Bloqueio em Segundo Plano no Node (`windowsHide: false`):** Alterado o parâmetro de execução do processo PowerShell em `santacruz-real.js` de `windowsHide: true` para `windowsHide: false`. No Windows, a execução do PowerShell em modo oculta (hidden) travava o loop de mensagens da ponte COM UIAutomation, impedindo o retorno dos resultados para a interface do Electron.
- **Validação de Teste Real E2E ("metformina 500mg"):** Validado o fluxo completo de ponta a ponta chamando o conector oficial `SantaCruzRealConnector.searchProduct`. A automação desminimizou a Santa Cruz, focou o campo de pesquisa, digitou `metformina 500mg`, acionou a busca e retornou com sucesso o item cotado (`Preço NF: R$ 16,14`), mantendo o software da Santa Cruz 100% aberto na tela.
- **Correção da Rota Nativa da Santa Cruz (`Find-SearchControl` & `santacruz-search.ps1`):** Resolvido o problema em que o robô tentava clicar em botões aleatórios do menu superior ou em dropdowns quando a caixa de pesquisa nativa não era reconhecida como `Edit` no JavaFX. O robô agora sintetiza as coordenadas exatas da caixa `Busca inteligente` (`Top - 28px` da tabela de produtos) com 100% de precisão, focando direto no campo de texto, digitando o item e disparando a tecla `{ENTER}` sem dar nenhum clique aleatório no software.
- **Seleção Rigorosa da Grade de Busca de 18 Colunas (`Find-TableControl`):** Atualizado o selecionador de tabelas no `santacruz-search.ps1` para buscar prioritariamente a tabela de 18 colunas do JavaFX (Grade de Busca de Produtos). Isso impede que o robô leia acidentalmente a tabela de histórico de 15 colunas ou a tabela do carrinho de 17 colunas.
- **Digitação com ENTER em Tempo Real (`Ensure-SantaCruzSearchInput`):** Adicionado o envio do evento `{ENTER}` ao final da digitação no campo `Busca Inteligente`, forçando o disparo imediato da consulta JavaFX no aplicativo da Santa Cruz.
- **Restauração de Janela Minimizada (`SW_RESTORE`):** Adicionada chamada explícita de desminimização via `ShowWindow(handle, 9)` (SW_RESTORE) antes de calcular coordenadas físicas de cliques de mouse.
- **Otimização Crítica do Escaneamento de Tabela (`Find-TableControl`):** Removida a chamada recursiva `$table.FindAll(Descendants)` que varria os mais de 400.000 elementos da tabela JavaFX.
- **Digitação Única e Direta (`Ensure-SantaCruzSearchInput`):** Reformulada a inserção de texto para executar uma única passagem de foco por clique físico de mouse + `Ctrl+A` + `Backspace` + digitação.
- **Remoção Completa de Teclas Globais na Leitura de Tabela (`Read-AllSantaCruzRowsWithScroll`):** Eliminados os envios de atalhos globais de teclado (`Ctrl+Home` e `PageDown`) durante a leitura da grade de resultados.
- **Proteção Tripla contra Reabertura e Fechamento do Software:** Adicionada checagem tripla de segurança antes de qualquer chamada a `Start-Process`.

### Detecção Universal da Santa Cruz para Qualquer Computador
- **Scan Direto de Janelas do Desktop (`Find-SantaCruzWindow`):** Novo algoritmo (Strategy 1) que varre **todas as janelas do sistema operacional** por título (`Pedido Eletrônico`, `SantaCruz`, `Digitador`, `Vitrine de Ofertas`, `Pedidos`) antes de tentar localizar o processo. Funciona independentemente de como a Santa Cruz foi instalada no PC.
- **Detecção Multi-Camada de Processos (`Find-SantaCruzProcess`):** Reescrita completa com 3 camadas de prioridade:
  1. **Processos com nome exato** (`digitador-sd`, `Pe - SantaCruz`, `pedido-eletronico`).
  2. **Processos Java (`javaw`/`java`)** validados pelo *path*, *MainWindowTitle*, *CommandLine (WMI)* e *modules carregados* para confirmar que é a Santa Cruz e não outro programa Java.
  3. **Nome de processo genérico** (`SantaCruz`) como fallback final.
- **Correção Crítica no Fluxo `--status-only`:** Anteriormente, se o `Find-SantaCruzInstallation` não encontrasse o caminho de instalação (comum em PCs com instalação não-padrão), o script imediatamente retornava `not-installed` sem sequer verificar se o processo ou janela estavam ativos. Agora, o script **sempre verifica processo e janela ANTES** de concluir que o software não está instalado.
- **Proteção contra Erro de Acesso a `$installation`:** Todos os acessos a `$installation.InstallRoot`, `$installation.LaunchPath` e `$installation.Source` agora usam ternário `$(if ($installation) {...})` evitando erros em PCs onde a instalação não foi localizada mas o software está aberto.

### Correção e Estabilização de Pesquisa na Profarma
- **Submissão Nativa de Enter via Electron (`electron-scraper.js`):** Adicionada a emissão de eventos nativos de teclado do SO (`sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' })`) para a Profarma (`supplierId === 2`). Anteriormente, o campo de busca `#inputPP` recebia o texto mas os formulários reativos do Angular Material não disparavam a pesquisa sem o Enter nativo do sistema operacional, causando estouro de tempo limite.
- **Ampliação das Páginas Válidas de Busca:** Adicionados os caminhos `/home`, `/inicio` e `/vitrine` como páginas válidas de consulta na ProfarmaOn, evitando travamento caso a distribuidora redirecione a navegação inicial.
- **Limpeza do Campo entre Consultas:** O robô agora zera o valor do campo `#inputPP` antes de digitar o próximo item da cotação.

### Tolerância a Falhas e Re-Tentativa Automática por Item
- **Regra de 3 Falhas Consecutivas (`main.js`):** Reformulada a lógica do circuit breaker durante cotações em lote. Se uma distribuidora (ANB, Profarma, Santa Cruz, DM Paraná) falhar ou der timeout no item 1, ela **não é mais desativada imediatamente**; o sistema tenta novamente no item 2 e item 3. A distribuidora só é ignorada nos itens restantes da cotação caso acumule **3 falhas consecutivas**. Se responder com sucesso em qualquer item intermediário, o contador de falhas é zerado.

### Proteção Estrita contra Fechamento da Santa Cruz
- **Bloqueio de Duplo Lançamento (`santacruz-search.ps1`):** Adicionada verificação rígida `if (-not $window -and -not $existingProcess -and $installation)`. Se o processo da Santa Cruz já estiver rodando, o robô **nunca** dispara um segundo `Start-Process`, pois o inicializador nativo da Santa Cruz encerrava a instância aberta ao detectar uma segunda chamada. A janela aberta permanece 100% ativa no computador do operador.

### Limpeza Automática, Auto-Correção de Foco e Rolagem na Santa Cruz
- **Limpeza Automática do Texto Anterior (`Ensure-SantaCruzSearchInput`):** Criada função no `santacruz-search.ps1` que foca o campo *Busca inteligente* e executa seleção total (`Ctrl+A`) e apaga (`Backspace`) qualquer pesquisa anterior (como *losartana 50*) antes de digitar o novo item em cotações de múltiplos medicamentos.
- **Auto-Correção e Verificação de Digitação:** O robô valida em um ciclo de até 3 tentativas se o texto no campo corresponde ao medicamento alvo. Se o usuário clicar fora ou a janela perder o foco durante a escrita, o robô automaticamente refoca o campo, limpa e reescreve a busca inteira antes de enviar.
- **Varredura Completa da Tabela por Rolagem (`Read-AllSantaCruzRowsWithScroll`):** O robô agora navega e faz rolagem vertical na grade da Santa Cruz (`PageDown` / `Ctrl+Home`), capturando todos os produtos e apresentações retornados sem limitar a leitura aos itens visíveis na tela.

### Detecção Automática da Santa Cruz em Qualquer Computador
- **Sonda Multiprocesso e Multi-Janela Resiliente (`santacruz-search.ps1`):** Aprimorada a busca por processos (`javaw`, `java`, `Pe - SantaCruz`, `digitador-sd`) e títulos de janelas (`Pedido Eletrônico`, `SantaCruz`, `Pedidos`, `Vitrine de Ofertas`, `Digitador SD`). O sistema detecta se a Santa Cruz está aberta ou fechada em qualquer computador (Windows 10/11, 32 ou 64-bit) de forma universal.
- **Detecção em Tempo Real (5s + Foco da Janela):** Reduzido o intervalo de sondagem em `App.jsx` de 30s para **5 segundos**, acionando também a verificação imediata sempre que o usuário alternar para o aplicativo.

### Redesign Executivo da Barra Lateral (Sidebar)
- **Visual Dark Moderno e Elegante (`index.css`):** Atualizada a barra lateral para estilo escuro executivo (`#0f172a`), com campo de busca com bordas finas (`#334155`), cartões de histórico com destaque suave ao passar o mouse (`#1e293b`) e borda indicadora esmeralda iluminada (`#10b981`) no item ativo.
- **Botões de Ação na Sidebar:** Botão *"+ Nova Cotação"* em gradiente esmeralda vibrante e botão *"Configurar Logins"* em tom ardósia moderno.

### Tabela de Resultados em Alto Contraste
- **Cabeçalho Escuro e Nítido (`#0f172a`):** A tabela de resultados ganhou cabeçalho fixo escuro em alto contraste com letras brancas em caixa alta, tipografia robusta e linhas com realce suave ao passar o cursor (`#f0fdf4`).

### Botão de Cancelamento de Cotação em Tempo Real
- **Botão *"Cancelar Cotação"* (`cancel-quote`):** Adicionado botão vermelho destacado no painel de andamento da cotação (`QuoteProgressOverlay`). Permite interromper instantaneamente a consulta aos portais a qualquer momento, cancelando os robôs sem travar o aplicativo.

### Layout Flexível sem Cortes de Conteúdo
- **Visibilidade Total dos Alertas (`overflow: visible`):** Ajustados os contêineres `.search-card` e `.main-content` no `index.css`. Ao digitar múltiplos medicamentos, a página faz rolagem vertical suave sem cortar nenhum aviso, caixa de alerta da Santa Cruz ou botão de ação.

### Suporte Nativo à Santa Cruz v12.0.118 Aberta
- **Manutenção Rígida da Janela Aberta:** Confirmado e documentado em `santacruz-search.ps1` e `AI_SYSTEM_GUIDE.md` que o aplicativo gráfico da Santa Cruz **permanece 100% aberto no computador** após cada pesquisa. O robô escreve o medicamento, extrai os preços da grade e conclui a leitura sem jamais fechar, minimizar ou encerrar a janela do programa.
- **Extração Dinâmica da Tabela de 15 Colunas (`santacruz-search.ps1`):** Atualizadas as funções `Find-TableControl` e `Read-SantaCruzRows` para reconhecer tabelas da Santa Cruz com 12 a 15 colunas (`v12.0.118`). O robô pesquisa e lê os preços da janela aberta sem rejeitar a grade por contagem rígida de colunas.

### Limite Rígido de 2 Minutos por Item
- **Timeout Proporcional ao Número de Itens:** Ajustado o cálculo do tempo limite total da cotação no `main.js` para `quantidade_de_itens * 2 minutos`, garantindo que cada item pesquisado tenha até 2 minutos no máximo.

### Design e Alto Contraste no Front-End
- **Visibilidade de Cartões e Títulos (`index.css`):** Elevado o contraste dos títulos (`#0f172a`), rótulos de campos, subtextos (`#334155`), badges de estatísticas (`#1e293b`) e caixas de prévia de inteligência para leitura nítida e profissional em qualquer iluminação de tela.
- **Toggles de Distribuidoras Elegantes:** Reformulados os seletores de distribuidoras (`.supplier-label`). Quando selecionados, exibem um gradiente esmeralda moderno (`linear-gradient(135deg, #059669 0%, #0d9488 100%)`) com texto branco em negrito e checkmark brilhante.
- **Banners de Status de Distribuidoras (Santa Cruz):** Redesenvolvidos os alertas de prontidão (`.santacruz-readiness`) com fundos luminosos (âmbar/esmeralda), bordas destacadas e tipografia em alto contraste.
- **Botões de Ação com Efeito Fluido:** O botão principal *"Pesquisar preços"* ganhou tom gradiente vibrante, sombra com profundidade (`box-shadow`) e efeito de elevação suave ao passar o ponteiro do mouse (`hover`).

### Carregamento Confiável da Interface (`dist/index.html`)
- **Fim da Tela Preta ao Abrir:** Ajustado o carregamento do `BrowserWindow` no `main.js` para detectar automaticamente se a compilação local `dist/index.html` existe e carregá-la diretamente quando a URL de desenvolvimento (`localhost:5173`) não estiver ativa.

### Bloqueio de Instância Dupla
- **Instância Única Rigorosa (`requestSingleInstanceLock`):** Implementada trava no `main.js` com `process.exit(0)` imediato se uma segunda instância do aplicativo for iniciada. Ao tentar abrir novamente, o aplicativo existente em execução é imediatamente restaurado e trazido ao foco na tela.

### Layout de Digitação e Botão Fixo
- **Barra de Rolagem no Textarea:** Adicionada barra de rolagem vertical interna (`overflow-y: auto`, `max-height: 240px`) no campo de entrada de texto e na prévia de inteligência, permitindo digitar quantos itens forem necessários sem estourar o layout.
- **Botão Pesquisar Fixo (`position: sticky`):** A barra de ação (`.action-row`) com o botão "Pesquisar preços" foi fixada na parte inferior da tela (`position: sticky; bottom: 0; z-index: 30`), garantindo que o botão fique 100% visível e acessível a qualquer momento.

### Retorno Sequencial Multi-Item Completo
- **Todos os Itens em Sequência (1, 2, 3...):** Ajustada a geração de recomendações para manter e exibir todos os itens digitados em ordem rigorosa.
- **Destaque por Medicamento:** Se um item não tiver opções válidas nas distribuidoras, ele exibe um cartão e uma linha dedicada informando explicitamente *"Não Disponível nas distribuidoras pesquisadas."*, garantindo que nenhum item digitado "desapareça" do relatório final.

### Redução do Tempo Limite de Pesquisa (2 Minutos por Item)
- **Timeout Ajustado para 2 Minutos (`120.000ms`):** Atualizado `CONNECTOR_TIMEOUT_MS`, `SCRAPER_TIMEOUT_MS` e `SANTACRUZ_TIMEOUT_MS` de 5/10 minutos para **2 minutos por item**, garantindo respostas muito mais rápidas sem travamento prolongado em portais lentos.
- **Timeout Global de Cotação (`240.000ms`):** Reajustado `QUOTE_TIMEOUT_MS` para 4 minutos no total.

### Design e Ícone Personalizado do Atalho
- **Ícone de Alta Resolução (`assets/icon.ico` e `assets/icon.png`):** Criado ícone moderno em gradiente azul-turquesa profundo com símbolo de farmácia/cápsula e tipografia 'WF'.
- **Atalho da Área de Trabalho (`wimi cotacao.lnk`):** Gerado e aplicado o novo ícone `.ico` no atalho da Área de Trabalho do Windows e no projeto local, eliminando o ícone genérico de engrenagem cinza (`cmd.exe`).
- **Ícone do App no Electron (`main.js`):** Configurada a propriedade `icon` da janela do Electron para exibir o novo ícone na barra de tarefas e título do Windows.

### Correção da Busca "Clenil 250" (Suporte a `mcg`)
- **Normalização de Dosagem em Microgramas (`MCG_MEDICATIONS`):** Medicamentos que utilizam microgramas (como *Clenil*, *Puran*, *Synthroid*, *Levotiroxina*, *Aerolin*, *Alenia*, *Symbicort*, *Budesonida*) agora convertem números puros (ex: `clenil 250`) para `250mcg` em vez de `250mg`. As buscas nos portais encontram perfeitamente os produtos cadastrados como `CLENIL 250MCG`.

### Automação de Busca na Profarma
- **Seletores de Busca Tolerantes:** Atualizado o seletor do campo de busca do portal Profarma no `electron-scraper.js` para aceitar variações insensíveis a maiúsculas/minúsculas (`Buscar`, `Pesquisar`, `Digite`, `inputPP`, `mat-input-element`, `formcontrolname`), eliminando falsos travamentos no carregamento inicial.

### Reutilização Inteligente da Santa Cruz Aberta
- **Detecção Confiável de Processos sem Reabertura:** Ajustado `santacruz-search.ps1` e `Find-SantaCruzProcess` para ignorar exceções de permissão de caminho de arquivo e detectar com precisão o aplicativo `Pe - SantaCruz.exe` aberto. O robô reutiliza a janela existente sem disparar um segundo executável que feche o aplicativo aberto.

## [1.7.1] - 2026-07-22

### Inicialização e Tela de Carregamento Instantânea
- **Tela de Splash HTML/CSS Animada:** Inserida tela de abertura com animação de pulso no ícone da marca, barra de progresso fluida e status visual ("Carregando módulos e banco de dados...") renderizada instantaneamente pelo Chromium assim que a janela abre, eliminando a tela em branco durante o carregamento do React e dos scripts.
- **Fundo Escuro Nativo no Electron (`#0b0f19`):** Alterada a cor de fundo do `BrowserWindow` de cinza claro para azul escuro profundo (`#0b0f19`), combinando 100% com o tema visual escuro do sistema e evitando flashes ou impressão de travamento do programa ao iniciar.
- **Abertura Antecipada da Janela:** A janela principal do Electron agora é instanciada e exibida imediatamente na inicialização enquanto o banco de dados e os módulos são inicializados em paralelo.

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

### Pré-voo e recuperação da Santa Cruz
- **Estado antes da cotação:** a tela verifica a cada 30 segundos se a Santa Cruz está pronta, fechada, atualizando, em login, em Home/Pedidos, sem janela ou não instalada.
- **Uso da instância aberta:** quando a grade já está pronta, a cotação reutiliza o campo de pesquisa; quando está em login/Home/Pedidos, a mesma automação entra e navega sem exigir Novo Pedido a cada medicamento.
- **Ação explícita:** `Abrir e preparar` inicia e autentica; diante de `javaw` validado sem janela, o botão vira `Reiniciar e preparar`. A cotação normal nunca mata o processo do fornecedor.
- **Portabilidade:** instalação continua sendo descoberta por configuração, cache validado, atalhos, registro, pastas padrão e varredura limitada, sem caminho fixo de usuário.
- **Diagnóstico repetível:** `npm run diagnose:santacruz` inicializa o banco real, usa as credenciais locais, prepara a interface e retorna um estado sanitizado.

### Validação real Santa Cruz de 2026-07-21
- O pré-voo encontrou `C:\Program Files (x86)\Pe - SantaCruz\digitador-sd.exe` pelo cache validado e confirmou um `javaw` sem janela de UI Automation.
- A tentativa real de `hidroclorotiazida 25mg` terminou bloqueada em 39 segundos e não aceitou preço antigo, estimado ou armazenado.
- `Reiniciar e preparar` encerrou somente o processo órfão validado e iniciou uma nova instância; o fornecedor novamente não criou janela.
- O log oficial `inicializador.log.0` registrou `503 Service Unavailable` na autorização da atualização `12.0.119`. O Wimi Cotação agora mostra essa causa no aviso da Santa Cruz.

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
- `npm test`: 92/92 testes aprovados, incluindo pré-voo/preparo Santa Cruz, resumo comparável, normalização PostgreSQL, persistência de evidências, redução do progresso entre itens e eventos reais de início/conclusão dos conectores.
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
