# Piloto de confiabilidade do robô — 31/10/2026

## Escopo

Consultas de leitura por EAN, sem pedidos, faturamento ou atualização do catálogo. A implementação local de auditoria e outras mudanças anteriores ainda estão na árvore de trabalho; este registro não afirma que esse conjunto inteiro foi publicado.

## Evidência real

O piloto usou os mesmos 20 produtos em ANB, Profarma e DM Paraná. Terminou as 60 consultas em 270,18 segundos, sem falhas técnicas ou tarefas pendentes.

| Fonte | Produtos com oferta | Busca vazia | EAN observado nas ofertas | Disponibilidade positiva na coleta |
| --- | ---: | ---: | ---: | ---: |
| ANB | 13 | 7 | 0 | 12 candidatas |
| Profarma | 10 | 10 | 10 | 8 |
| DM Paraná | 4 | 16 | 4 | 0 |

As 13 ofertas ANB continuam candidatas. A leitura controlada de uma linha real confirmou código interno, descrição, preço e indicação de disponibilidade, mas não encontrou EAN nem acionador informativo entre os controles examinados. Isso não prova inexistência de outros canais do fornecedor.

As dez ofertas Profarma foram classificadas `SEM_ST`, mantendo o bloqueio comercial existente. As quatro ofertas DM tinham disponibilidade negativa. Nenhuma oferta do piloto foi elegível para uso automático na coleta. Não foi inventado saldo numérico ou reserva.

A consulta isolada do PediaSure que interrompeu o lote anterior terminou com busca vazia confirmada. A falha não reapareceu no novo lote DM, usando busca ao digitar e `DM_PLAYWRIGHT_SEARCH_TIMEOUT_MS=15000`; isso não comprova a causa da interrupção histórica nem elimina a necessidade de monitoramento.

A GAM não foi executada pelo robô: não há acesso cadastrado no banco local. A sessão do Chrome não é importada. O usuário deve cadastrar o acesso no aplicativo, sem compartilhar a senha em relatório ou chat.

## Correção de sessão da auditoria

O piloto apresentou erros de criação de cache sob o caminho temporário longo do Windows. A auditoria agora usa partições em memória, preservando o identificador do fornecedor e o hash completo da conta. O modo normal conserva exatamente a partição persistente existente. Não foram alterados credenciais, permissões ou contratos comerciais.

Depois da correção, duas consultas sucessivas em ANB e Profarma concluíram quatro tarefas sem falha técnica. Cada fonte retornou uma oferta e uma busca vazia. O stderr dessa execução não apresentou as falhas de criação/movimentação de cache observadas antes; persistiu o aviso de API legada de `console-message` do Electron.

O SHA-256 do SQLite original permaneceu igual antes e depois das consultas. Todos os processos de auditoria desta rodada terminaram.

## Validação

- Regressões de partição verificam modo normal, modo de auditoria, determinismo e isolamento entre fornecedores e contas.
- Após separar os contratos de partição, a suíte de catálogo passou com 115 testes e o arquivo novo passou com cinco testes. O arquivo também é importado pela suíte principal: `npm test` passou com 362 testes.
- Build passou; lint terminou sem erro, mantendo os avisos já presentes.
- A auditoria de dependências de produção encontrou dois alertas altos, em `undici` e `xlsx`, e nenhum crítico. Não houve alteração de dependências nesta correção; os alertas continuam pendentes e este trabalho não publica um instalador ou serviço.
- Revisão independente não encontrou defeito acionável na alteração de partição.

Os relatórios reais e diagnósticos sanitizados permanecem nos artefatos locais, fora do versionamento. Resultados de cotação são datados e não substituem uma consulta nova.

## Próximos bloqueios

Validar a GAM após cadastro; obter vínculo verificável entre código interno e EAN da ANB; conferir tratamento tributário antes de qualquer liberação automática. Concluir uma consulta não significa que a oferta esteja aprovada para publicação ou compra.
