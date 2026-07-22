# 🚀 Roteiro de Melhorias para o Backend (Wimifarma Cotação)

Esta documentação serve como especificação técnica de melhorias recomendadas para evoluir a arquitetura, robustez e performance do backend do sistema de cotação.

---

## ⚡ 1. Arquitetura Multithreading Concorrente
* **Problema Atual:** A pesquisa é realizada de forma sequencial (Distribuidora A -> Distribuidora B -> Distribuidora C). Se uma delas demora (ex: resolvendo Captcha na Profarma), a cotação inteira fica travada esperando.
* **Solução Proposta:** 
  * Dividir a orquestração de conexões em **`Worker Threads`** do Node.js ou através do módulo `Promise.allSettled`.
  * Cada robô de distribuidora roda de forma concorrente em seu próprio processo ou thread isolada.
* **Resultados:** 
  * O tempo total da cotação cai para o tempo da distribuidora mais lenta.
  * O frontend recebe e exibe os resultados da Santa Cruz (que demoram menos de 2s) de forma instantânea na tela, enquanto a Profarma termina a sua pesquisa em background.

---

## 🖥️ 2. Integração GUI Nativa (Nut.js / Windows API)
* **Problema Atual:** O backend invoca um script externo do PowerShell (`santacruz-search.ps1`) que inicia um subprocesso, carrega DLLs .NET e varre o aplicativo Santa Cruz.
* **Solução Proposta:** 
  * Migrar a automação do Windows de script PowerShell para comandos nativos em Node.js usando pacotes como **`nut.js`** ou através de chamadas de API nativas de DLL do Windows via Node `ffi-napi`.
* **Resultados:** 
  * Eliminação de chamadas de subprocesso do PowerShell (reduz consumo de CPU e RAM no PC do operador).
  * Aceleração na varredura e mapeamento de células da tabela JavaFX (de ~1.5s para menos de 300ms).

---

## 🧠 3. Expansão de Busca Semântica e Refinamento
* **Problema Atual:** Falhas em consultas com pequenos erros de digitação ou termos abreviados em portais de distribuidoras que não possuem motores de busca inteligentes.
* **Solução Proposta:** 
  * Criar um pipeline de normalização de termos com buscas alternativas.
  * Se a busca inicial por `"gotas"` retornar zero resultados, o backend tenta buscar pelo mesmo princípio ativo utilizando palavras compatíveis como `"solução"`, `"líquido"` ou `"suspensão"`.
* **Resultados:**
  * Redução drástica de buscas em branco nos portais devido a termos de apresentação ligeiramente diferentes.

---

## 🗄️ 4. Banco de Dados e Cache Offline Inteligente
* **Problema Atual:** O banco de dados cache do sistema Santa Cruz (`dados.mv.db`) contém apenas os preços de tabela e as promoções podem expirar ou oscilar dependendo do momento.
* **Solução Proposta:** 
  * Implementar uma tarefa cron (background job) agendada para rodar de madrugada ou nos períodos ociosos do computador.
  * Essa tarefa abre os portais das distribuidoras, executa uma varredura geral e salva os preços e STs das locais de compras mais comuns em um banco de dados local SQLite otimizado.
* **Resultados:** 
  * Cotações instantâneas mesmo se a internet oscilar ou os portais das distribuidoras estiverem instáveis ou em manutenção.
