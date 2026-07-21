# Cotador Inteligente ST

Sistema local de cotação de medicamentos em fornecedores com filtragem por Substituição Tributária (ST).

---

## 🛠️ Requisitos de Instalação

O sistema roda localmente no computador da farmácia. Certifique-se de possuir o Node.js instalado (Versão LTS sugerida).

1. Clone o repositório com Git ou copie a pasta completa, incluindo a pasta oculta `.git`. Uma pasta baixada apenas como ZIP funciona localmente, mas não consegue receber atualizações automáticas.
2. Copie o arquivo `.env.example` para `.env`:
   ```bash
   copy .env.example .env
   ```
3. Abra `wimi cotacao.bat`. O inicializador roda oculto, verifica uma versão remota segura, instala ou atualiza as dependências necessárias, garante o runtime do Electron e então abre somente o aplicativo.

### Configuração em outro computador

1. Instale Git e Node.js LTS, clone o projeto e abra `wimi cotacao.bat`; o bootstrap instala as dependências compatíveis antes de iniciar.
2. Abra **Configurar Logins das Distribuidoras** no aplicativo.
3. Cadastre ANB, Profarma, Santa Cruz e **DM Paraná**. A URL da DM é `https://portal.dmparana.com.br/login`.
4. Faça uma cotação curta e confira se cada fonte aparece como consultada ao vivo.

Se o Node.js estiver ausente, o inicializador oculto mostra uma mensagem em vez de falhar silenciosamente. Se o Git estiver ausente ou a pasta `.git` não tiver sido copiada, o aplicativo abre a versão local e exibe por que a atualização automática não está disponível.

As senhas não ficam no Git. Com `CREDENTIAL_STORAGE_MODE=plain`, configuração operacional padrão, elas ficam codificadas no SQLite local e podem acompanhar uma cópia autorizada do banco para outro computador. Esse modo não é criptografia: limite o acesso à pasta e nunca envie `.env` ou `data/cotador-st.db` ao repositório. O histórico pode permanecer local, mas nunca é usado como fonte de preço para uma nova cotação.

---

## 🚀 Como Rodar o Sistema

### 1. Ambiente de Desenvolvimento
Para preparar o projeto e executar React (Vite) e Electron concorrentemente:
```bash
npm run dev
```

Na abertura, `scripts/bootstrap.mjs`:
- aplica atualizações Git somente quando a pasta está limpa e a branch rastreia um remoto ou corresponde à branch padrão de `origin`, sempre com `fast-forward`;
- preserva a versão local quando existem alterações rastreadas, não há referência remota segura ou o remoto está indisponível;
- executa `npm install` para reconciliar `package-lock.json` e dependências antes de abrir o Electron.
- registra o resultado em `logs/update-status.json`; o aplicativo avisa quando a atualização automática está bloqueada, quando abriu offline ou quando uma versão foi instalada.
- verifica novas versões a cada 15 minutos enquanto permanece aberto. A aplicação segura ocorre na próxima abertura, antes de qualquer cotação.

Use `AUTO_UPDATE_ON_STARTUP=false` para desativar a atualização de código. `AUTO_UPDATE_CHECK_INTERVAL_MS` controla a verificação em segundo plano e `AUTO_UPDATE_BRANCH` pode indicar a branch remota esperada em uma instalação distribuída. O diagnóstico sem alterações é `node scripts/bootstrap.mjs --diagnose`.

### 2. Rodar Testes Unitários
Para rodar a suite de testes unitários local (alimentada pelo runner nativo do Node):
```bash
npm run test
```

Para auditar os conectores reais com captura datada e sem gravar preços no histórico:
```bash
npm run diagnose:live -- "losartana 50mg" "amitriptilina 25mg" "clonazepam 2mg"
```
O relatório sanitizado fica em `logs/live-diagnostic-latest.json`. Use `--suppliers=ANB,Profarma` para limitar fornecedores e `--output=logs/arquivo.json` para preservar uma rodada específica.

### 3. Gerar o Build Desktop (Instalador para Windows)
Para gerar o executável instalável (.exe) para distribuição interna no Windows:
```bash
npm run build
npm run package
```
O instalador gerado será salvo no diretório `dist-electron/`.

---

## 📚 Como Funciona o Sistema

### 1. Normalizador de Buscas
O usuário insere linhas de texto simples (ex: `dipirona comprimido 500mg`). O parser quebra o texto em:
- **Nome do produto**
- **Dosagem** (mg, ml, g, etc.)
- **Apresentação** (comprimido, capsula, gotas, suspensao, xarope)
- **Nível de confiança:** Caso dosagem ou apresentação estejam ausentes, o sistema sinaliza como `PRODUTO_PARECIDO_REVISAR`.

### 1.1 Contexto Farmaceutico
Antes de abrir cada fornecedor, a descricao recebe uma normalizacao compartilhada:
- Abreviacoes seguras e prefixos unicos com pelo menos seis letras sao expandidos. Exemplo: `hidrocloro` e `hctz` viram `hidroclorotiazida`.
- Associacoes sao comparadas por conjunto de principios ativos, em qualquer ordem e com ou sem `+`. Exemplo: `hidrocloro olmesartana` confere com `olmesartana + hidroclorotiazida`.
- Uma busca com apenas um principio ativo continua bloqueando medicamentos associados, evitando compra automatica de outra composicao.
- `xarope` e `suspensao oral` sao equivalentes no contexto oral. Solucoes oftalmicas, injetaveis, nasais e otologicas nao entram nessa equivalencia.
- `soro fisiologico` e `solucao fisiologica` sao normalizados para `cloreto de sodio`, permitindo localizar a mesma descricao comercial.
- Prefixos curtos ou ambiguos, como `hidro`, nao sao expandidos automaticamente.
- O lote mantem contexto entre linhas. Depois de `metformina 500`, por exemplo, `met 850` e entendido como `metformina 850mg`.
- Dosagens compactadas conhecidas sao separadas: `sinvastatina 20 40` gera pesquisas independentes para 20 mg e 40 mg.
- Erros inequivocos e prefixos unicos, como `dapaglifozina` ou `dapagli`, sao corrigidos para `dapagliflozina` antes de abrir os portais, e a alteracao fica visivel na tela.
- Termos ambiguos ou sem informacao suficiente ficam vermelhos e nao abrem os fornecedores ate receberem complemento.
- Quando a linha contem EAN e nome, o sistema tenta o EAN primeiro. Somente um retorno realmente vazio permite nova busca pelo nome; falha de portal nunca e mascarada pelo fallback.
- O aprendizado local guarda apenas correcoes de escrita confirmadas por resultado real. Precos, estoque e ST antigos nunca alimentam uma nova cotacao.

### 2. Regra de ST (Fase 2)
O sistema trabalha apenas com produtos que possuem Substituição Tributária. Os retornos são divididos em:
- **COM_ST** / **ST_INCLUSO**: Opções válidas. Podem ser recomendadas diretamente.
- **ST_SEPARADO**: Opção válida, mas sinalizada com o alerta: *"ST separado — conferir custo final"*.
- **SEM_ST**: Opções sem ST são ignoradas e ocultadas por padrão.
- **ST_DESCONHECIDO**: Bloqueia a recomendação automática e exibe o alerta: *"Precisa revisar ST"*.

A recomendação automática prioriza:
1. Produto com ST válido (`COM_ST` ou `ST_INCLUSO`).
2. Produto disponível no fornecedor.
3. Menor preço.
4. Menor risco de revisão (desempate para `ST_SEPARADO`).

### 3. Revisão Manual (Fase 2)
Qualquer item exibido na tabela pode ser revisado manualmente clicando em **✏️ Revisar**:
- O usuário pode aprovar ou rejeitar o produto.
- É possível editar o preço, classificação de ST e disponibilidade.
- Adicionar observações/notas personalizadas.
- O sistema recalcula automaticamente as recomendações logo após salvar as alterações.

### 4. Conectores e Segurança dos Portais
- **Pesquisa operacional somente ao vivo:** Com `ENABLE_REAL_CONNECTORS=true`, toda nova cotação abre os portais/aplicativo, executa uma nova busca e captura preço, estoque e ST naquele momento. Não existe fallback de preço por histórico, H2 ou cache de indisponibilidade.
- **Mocks somente em testes:** Dados simulados exigem `ENABLE_MOCK_CONNECTORS=true`. Sem uma das duas configurações explícitas, o sistema interrompe a cotação para não apresentar valores fictícios.
- **Frescor obrigatório:** Resultados reais sem horário de captura ou com mais de cinco minutos são bloqueados e não participam do melhor preço.
- **Banco local portátil:** Com `DATABASE_PATH=local`, o SQLite fica em `data/cotador-st.db`, junto do projeto, permitindo reaproveitar credenciais e histórico locais.
- **IDs portáteis:** Credenciais são reconciliadas pelo nome canônico do fornecedor; a DM Paraná continua funcionando mesmo se o ID interno do SQLite não for `4`.
- **Histórico não é fonte:** O SQLite serve para reabrir/exportar cotações anteriores e guardar credenciais locais; uma nova cotação nunca consulta preços desse banco.
- **Falha de internet:** Erros transitórios de portal recebem uma única nova tentativa. Credencial ausente, aplicativo sem janela e falha persistente ficam bloqueados; não há fallback para preço antigo.
- **Automação discreta:** `SHOW_SCRAPER_WINDOW=false` mantém ANB, Profarma e DM ocultas e fora da barra de tarefas. A Santa Cruz tenta escrever pelo controle de acessibilidade e restaura o foco anterior; por ser um aplicativo Java local, uma sessão Windows/VM dedicada é a única garantia de interferência visual zero.
- **Privacidade Local:** O sistema grava histórico local em banco SQLite (`cotador-st.db`) na pasta de dados do usuário e gera logs limpos em `logs/app.log` sem armazenar dados de cookies, senhas, tokens ou contas de acesso.

### 5. Regra de preço da DM Paraná

- O robô pesquisa pelo nome do medicamento e usa dosagem/apresentação para auditar os cartões retornados.
- O único valor aceito é o texto literal **`Preço final: R$`**, que já representa o custo final exibido pelo portal.
- O preço grande em negrito (`R$ .../cada`) é preço cru e nunca participa do ranking.
- Itens sem botão **Comprar** ativo, com `Sem estoque`, `Indisponível` ou `Avise-me`, são ignorados.
- A paginação avança pelo botão **Próximo** enquanto estiver habilitado, com limite defensivo de dez páginas.
- Medicamentos combinados são bloqueados quando a busca pede apenas um princípio ativo.

### 6. Interface e conferência do preço

- No uso diário, abra **`wimi cotacao.bat`**. Esse atalho chama `cotacao.bat`, que valida o Node.js e executa o bootstrap seguro de atualização e dependências antes de iniciar o Electron.
- O processo técnico permanece oculto e grava sua saída em `logs/startup.log`; a janela preta do CMD não fica aberta junto do aplicativo.
- Uma cotação nunca permanece carregando indefinidamente: por padrão, portais web têm limite de 5 minutos, enquanto Santa Cruz e a cotação completa têm limite de 10 minutos. Ao atingir o limite, processos pendentes são cancelados, resultados reais já obtidos são preservados e as fontes incompletas ficam sinalizadas.
- A pesquisa mostra quantos itens serão cotados e quais distribuidoras estão selecionadas antes de iniciar o robô.
- A prévia explica cada correção ou herança de contexto antes da cotação. Linhas incompletas permanecem vermelhas e visíveis para ajuste.
- Cada resultado exibe a origem exata do valor utilizado: ANB `Unit c/ST`, Santa Cruz `Preço NF`, Profarma `Preço Final` e DM Paraná `Preço final: R$`.
- Os indicadores de ST, auditoria, estoque e recomendação permanecem visíveis tanto no painel quanto na tabela detalhada.
- O histórico completo fica recolhido por padrão, pode ser aberto por um único botão e aceita busca pelos medicamentos cotados.
- Em telas menores, a tabela vira uma sequência de cartões com os rótulos de cada coluna, sem esconder o preço final ou a origem.
