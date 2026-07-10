# Cotador Inteligente ST

Sistema local de cotação de medicamentos em fornecedores com filtragem por Substituição Tributária (ST).

---

## 🛠️ Requisitos de Instalação

O sistema roda localmente no computador da farmácia. Certifique-se de possuir o Node.js instalado (Versão LTS sugerida).

1. Clone o repositório ou baixe os arquivos da aplicação.
2. Na pasta do projeto, instale as dependências executando:
   ```bash
   npm install
   ```
3. Copie o arquivo `.env.example` para `.env`:
   ```bash
   copy .env.example .env
   ```

---

## 🚀 Como Rodar o Sistema

### 1. Ambiente de Desenvolvimento
Para executar a interface do React (Vite) e o Electron concorrentemente com hot reload:
```bash
npm run dev
```

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
- **Mocks ativados:** Na Fase 2, os conectores de ANB, Profarma e Santa Cruz são simulados localmente para validação segura de regras de negócio.
- **Toggles de Segurança:** O arquivo `.env` possui chaves de segurança `ENABLE_REAL_CONNECTORS=false` para impedir a execução acidental de scrapers em produção.
- **Privacidade Local:** O sistema grava histórico local em banco SQLite (`cotador-st.db`) na pasta de dados do usuário e gera logs limpos em `logs/app.log` sem armazenar dados de cookies, senhas, tokens ou contas de acesso.
