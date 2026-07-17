# Cotador Inteligente ST

Sistema local de cotação de medicamentos em fornecedores com filtragem por Substituição Tributária (ST).

---

## 🛠️ Requisitos de Instalação

O sistema roda localmente no computador da farmácia. Certifique-se de possuir o Node.js instalado (Versão LTS sugerida).

1. Clone o repositório ou baixe os arquivos da aplicação.
2. Copie o arquivo `.env.example` para `.env`:
   ```bash
   copy .env.example .env
   ```
3. Abra `cotacao.bat`. O inicializador verifica uma versão remota segura, instala ou atualiza as dependências necessárias e então abre o aplicativo.

### Configuração em outro computador

1. Clone o projeto e abra `cotacao.bat`; o bootstrap instala as dependências compatíveis antes de iniciar.
2. Abra **Configurar Logins das Distribuidoras** no aplicativo.
3. Cadastre ANB, Profarma, Santa Cruz e **DM Paraná**. A URL da DM é `https://portal.dmparana.com.br/login`.
4. Faça uma cotação curta e confira se cada fonte aparece como consultada ao vivo.

As senhas não ficam no Git. O Windows protege os acessos com DPAPI, portanto uma senha protegida em uma máquina não deve ser copiada como arquivo para outra: cadastre novamente pela tela de configurações em cada computador. O banco e o histórico podem permanecer locais, mas nunca são usados como fonte de preço para uma nova cotação.

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

Use `AUTO_UPDATE_ON_STARTUP=false` para desativar a atualização de código. `AUTO_UPDATE_BRANCH` pode indicar a branch remota esperada em uma instalação distribuída. O diagnóstico sem alterações é `node scripts/bootstrap.mjs --diagnose`.

### 2. Rodar Testes Unitários
Para rodar a suite de testes unitários local (alimentada pelo runner nativo do Node):
```bash
npm run test
```

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
- **Histórico não é fonte:** O SQLite serve para reabrir/exportar cotações anteriores e guardar credenciais protegidas; uma nova cotação nunca consulta preços desse banco.
- **Janelas visíveis:** `SHOW_SCRAPER_WINDOW=true` mantém o navegador do robô visível para login/captcha e conferência visual.
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
- A pesquisa mostra quantos itens serão cotados e quais distribuidoras estão selecionadas antes de iniciar o robô.
- Cada resultado exibe a origem exata do valor utilizado: ANB `Unit c/ST`, Santa Cruz `Preço NF`, Profarma `Preço Final` e DM Paraná `Preço final: R$`.
- Os indicadores de ST, auditoria, estoque e recomendação permanecem visíveis tanto no painel quanto na tabela detalhada.
- Em telas menores, a tabela vira uma sequência de cartões com os rótulos de cada coluna, sem esconder o preço final ou a origem.
