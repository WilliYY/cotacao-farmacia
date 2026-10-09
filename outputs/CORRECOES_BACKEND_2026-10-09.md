# Correções do backend — 09/10/2026

As falhas reproduzidas na auditoria foram corrigidas. As credenciais continuam na pasta local do projeto em modo portátil; banco, `.env` e sessões não são incluídos no Git.

## Correções realizadas

| Área | Comportamento corrigido |
| --- | --- |
| Correspondência farmacêutica | Conflitos explícitos de via, como nasal versus injetável, impedem a recomendação mesmo com dose e apresentação semelhantes. |
| Profarma | A captura exige a coluna `Preço Final`; desconto percentual, preço vazio e zero não viram preço recomendado. |
| Paginação | Grade repetida, transição não confirmada ou páginas restantes no limite falham com diagnóstico; resultados parciais não viram cotação concluída. |
| Santa Cruz | Estoque indefinido retorna falha estruturada. A configuração mantém o caminho absoluto do executável local. |
| Revisão manual | Campos permitidos, preço positivo e quantidade inteira positiva; auditoria/ranking recalculados. Notas/rejeição podem manter números históricos inválidos, sem habilitá-los. Aprovação de outlier válido preserva o diagnóstico. |
| Banco | Migração SQLite transacional com verificação do schema; data histórica preservada. PostgreSQL não troca silenciosamente para SQLite quando falha. |
| Interrupções | Na próxima abertura normal, cotações deixadas em processamento passam a `interrupted`, preservando ofertas e itens concluídos. |
| IPC e inicialização | Pedidos aguardam o banco e validam a janela, frame, URL, IDs, fornecedores e campos. A lista de configurações não devolve senhas. |
| Sessões e diagnóstico | Mudança de URL/login/senha/cliente cria identidade de sessão diferente. HTML de diagnóstico remove valores de formulários e credenciais fornecidas. |
| Interface | Cancelar/fechar aguarda a limpeza dos conectores; listener de atualização é removido corretamente. CSP no HTML de produção e navegação externa bloqueada. |
| Dependências | `shell-quote` atualizado para 1.11.0; Electron fixado em 43.5.0, na mesma série major; `tar` preservado em 7.5.22. |

## Validação

- Suíte completa final: **218/218 testes aprovados**, incluindo regressões de dados, conectores e IPC.
- Build de produção: aprovado e atualizado em `dist` local.
- Lint: **0 erros e 22 avisos preexistentes**.
- Script Santa Cruz: parser PowerShell sem erros.
- Revisão independente: achados corrigidos e sem bloqueio remanescente.
- Electron 43.5.0 com SQLite isolado: interface compilada, preload/IPC, espera pela inicialização, histórico interrompido, leitura/salvamento de credenciais e exportação Excel aprovados. `quick_check=ok`, schema versão 1, zero erros no console; arquivo Excel com 23.980 bytes.
- Startup do `main.js` real com SQLite isolado: recuperação normal, rejeição de entrada inválida e cotação simulada completa aprovadas, com zero erros no console.
- Consultas aos fornecedores usando cópia do SQLite e perfis isolados: ANB e Profarma retornaram preços com seus contratos corretos; DM retornou preços válidos pelo Electron. O banco principal permanece intacto.

| Fornecedor | Consulta real de `losartana 50mg` | Ofertas / válidas | Duração |
| --- | --- | --- | --- |
| ANB | Aprovada, `Unit c/ST` | 11 / 8 | 10,2 s |
| Profarma | Aprovada, `Preço Final` | 6 / 2 | 15,2 s |
| DM Paraná, Electron | Aprovada, `Preço final: R$` | 4 / 3 | 8,2 s |
| Santa Cruz | Aprovada, `Preço NF`, cobertura integral de 47 linhas | 10 / 6 | 52,2 s |

Na DM Playwright, o trace confirmou navegação de `/home` para `/cupons` após Enter e desaparecimento do campo. Foram corrigidos dois timeouts de locator absorvidos como grade antiga; o conector agora falha com diagnóstico de layout e respeita o prazo restante. A causa da navegação do portal não foi estabelecida. O Electron funcionou ao vivo, por isso a configuração local `DM_BROWSER_ENGINE` foi alterada para `electron`, sem mudar credenciais e sem fallback automático por erro de layout.

A Santa Cruz inicialmente excedeu o prazo da primeira consulta e, já pronta, teve uma captura incompleta bloqueada. Uma nova consulta confirmou todas as 47 linhas e os preços atuais. A margem da varredura foi ampliada de 45 para 90 segundos por padrão (limite máximo de 120), mantendo o prazo global e a exigência de cobertura integral. A primeira abertura/atualização do digitador pode exigir espera maior; a configuração operacional de timeout permanece em dez minutos.

## Portabilidade e operação

O ambiente local permanece com `DATABASE_PATH=local` e `CREDENTIAL_STORAGE_MODE=plain`, com `DM_BROWSER_ENGINE=electron`. Feche o aplicativo antes de mover `.env` e a pasta `data` junto do projeto. `plain:` usa Base64, que é codificação e não criptografia. O modo `dpapi` continua opcional e vinculado ao usuário/máquina Windows.

A recuperação de cotações interrompidas é feita apenas na abertura normal, com a trava de instância única. Os 14 registros em processamento observados na auditoria não foram alterados diretamente durante esta entrega. Para consultar preços atuais, abra o aplicativo e inicie uma nova cotação.

## Limitações verificadas

`npm audit` passou de 23 para **20 pacotes sinalizados**: **0 críticos, 12 altos e 8 moderados**. Os alertas de Electron e `shell-quote` foram removidos. Permanecem alertas de `xlsx` e da cadeia de empacotamento `electron-builder`; não foi aplicada uma atualização forçada com downgrade ou troca de biblioteca.

O uso atual de `xlsx` exporta arquivos; não importa planilhas fornecidas por terceiros. A [orientação oficial da SheetJS sobre prototype pollution](https://cdn.sheetjs.com/advisories/CVE-2023-30533) distingue o fluxo de exportação. Isso não equivale a uma auditoria sem vulnerabilidades. A [outra orientação da SheetJS](https://cdn.sheetjs.com/advisories/CVE-2024-22363) registra a correção de ReDoS em versões posteriores, fora da versão publicada no npm usada aqui.

A atualização do Electron segue a [versão oficial 43.5.0](https://releases.electronjs.org/release/v43.5.0) e o [aviso de segurança do cache de preload](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq). A atualização de `shell-quote` segue o [aviso do mantenedor](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv).

PostgreSQL remoto não foi testado, pois esta instalação usa SQLite. Passar nos testes locais não garante disponibilidade futura, credenciais válidas, ausência de CAPTCHA ou estabilidade dos portais externos.

## Entrega Git

Código e documentação desta entrega estão na branch `feature/cotador-st-fase-2-melhorias-seguranca`, com o commit `fix: stabilize portable quotation backend`. O resumo da entrega informa o hash e a confirmação do push. Credenciais, banco, sessões, dependências binárias e arquivos locais preexistentes ficam fora da entrega.
