# Changelog - Cotador Inteligente ST

Histórico estruturado de todas as alterações de engenharia realizadas no projeto.

---

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
