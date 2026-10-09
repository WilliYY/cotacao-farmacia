# Santa Cruz: correção e teste desde fechado

A cotação real passou com o aplicativo inicialmente fechado, credenciais já salvas e sem intervenção manual durante o teste final.

## Correções

- A Home maximizada da versão 13.0.001 podia ficar oculta na passagem para Digitador. O robô agora restaura a Home, foca a janela e o controle e só então calcula o ponto do clique.
- O clique físico exige a janela correta em primeiro plano, controle disponível e ponto dentro dos limites atuais. F3 também verifica primeiro plano, e a lupa calcula sua geometria após a preparação da janela.
- O diagnóstico anterior mostrava um 503 das 12:45 na abertura das 13:27 porque o arquivo de log tinha sido atualizado. Agora o horário do registro JUL, a inicialização/processo e o limite de 20 minutos definem se o erro é atual.

O botão Digitador foi confirmado visualmente e no recurso `fxml/home.fxml` do aplicativo instalado. O caminho permanece o da instalação atual; não há coordenadas, PID ou perfil de usuário fixados no código operacional.

## Resultado real de 09/10/2026

| Verificação | Resultado |
| --- | --- |
| Estado antes | `closed`, sem processo/janela Santa Cruz |
| Aplicativo | Santa Cruz 13.0.001 |
| Navegação | abertura automática → login salvo → Home restaurada → Digitador → Pedidos → grade de pesquisa |
| Consulta | `losartana 50mg` |
| Período | 16:22:08 a 16:23:37, horário de Brasília |
| Duração da consulta | 88,5 segundos |
| Ofertas capturadas | 10 |
| Ofertas válidas após auditoria | 6 |
| Cobertura da grade | 47/47 linhas, completa |
| Estado depois | `ready`, pesquisa disponível |
| Pedido enviado | nenhum |

A busca reutilizou seus fallbacks existentes, mantendo a dose original na auditoria. Preços continuam limitados a `Preço NF`; evidência de estoque e cobertura completa continuam obrigatórias.

## Verificação técnica

- 220/220 testes passaram, incluindo regressões reais de lógica: controle deslocado após foco, foco negado sem clique, 503 antigo e atual com mtime recente.
- Build aprovado; lint sem erros; parser PowerShell sem erros; `git diff --check` aprovado.
- Revisão independente dos arquivos alterados sem achados bloqueantes.
- Diagnóstico usou uma cópia SQLite criada com a origem aberta em modo somente leitura. Credenciais locais, banco e `.env` não são versionados.
- Conferência somente leitura do banco principal: `quick_check=ok`, 33 cotações; credenciais idênticas às do snapshot usado no diagnóstico.

O resultado comprova o fluxo testado nesta instalação. Alterações posteriores no aplicativo ou disponibilidade do fornecedor podem exigir nova validação.

## Preenchimento do site

É viável preencher automaticamente a cotação do site pelo nome/chave dos fornecedores, independentemente da ordem das colunas, usando sessão autenticada e a API existente. O plano e os ajustes necessários estão em [INTEGRACAO_COTACAO_SITE_2026-10-09.md](INTEGRACAO_COTACAO_SITE_2026-10-09.md). A integração e as gravações no site não foram executadas nesta entrega.
