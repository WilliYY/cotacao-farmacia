# ROADMAP - Cotador Inteligente ST

Cronograma de desenvolvimento técnico planejado para o **Cotador Inteligente ST**.

---

## 📌 Fase 1 — MVP (Concluído)
- [x] Tela de busca inicial por caixa de texto.
- [x] Busca estruturada por linha com quebra automática.
- [x] Conectores de dados simulados (ANB, Profarma, Santa Cruz e DM Paraná).
- [x] Regra de filtragem básica de Substituição Tributária (ST).
- [x] Indicação da melhor e segunda melhor opção de compra.
- [x] Exportação de cotação para planilha XLSX simples.

## 📌 Fase 2 — Segurança e Arquitetura (Concluído)
- [x] Estruturação modular da arquitetura do projeto (`src/lib`, `src/connectors/mock`).
- [x] Configurações de chaves locais protegidas por `.env`.
- [x] Logs organizados e livres de credenciais em `logs/app.log`.
- [x] Lógica expandida de ST (`ST_INCLUSO`, `ST_SEPARADO`).
- [x] Fluxo de revisão manual e edição direta de itens na tabela com recálculo automático.
- [x] Histórico detalhado no SQLite local com filtros de data e status.
- [x] Parser aprimorado com métrica de confiança (`PRODUTO_PARECIDO_REVISAR`).
- [x] Exportação para XLSX multi-abas (Resumo, Melhores ST, Todos, Ignorados, Revisar).
- [x] Suíte de testes unitários local usando runner nativo.

## 📌 Fase 3 — Importação de Listas
- [ ] Importação de arquivos CSV/XLSX de produtos copiados de planilhas.
- [ ] Leitura automática de ofertas e encartes digitados de fornecedores.
- [ ] Padronização inteligente de terminologia farmacêutica.
- [ ] Cruzamento rápido de listas importadas com histórico de compras.

## 📌 Fase 4 — Conector Assistido ANB
- [ ] Abertura assistida de navegador integrado (Playwright).
- [ ] Autenticação/login manual realizada diretamente pelo usuário (sem salvar senha).
- [ ] Pesquisa robotizada de termos na tela de busca do portal.
- [ ] Captura de informações visíveis (preço, laboratório, disponibilidade e ST).
- [ ] Salvamento automático na tela de revisão da cotação.

## 📌 Fase 5 — Conector Assistido Profarma
- [ ] Desenvolvimento de conector para o portal da Profarma sob as mesmas premissas de segurança.
- [ ] Login manual no portal assistido por automação.
- [ ] Captura de preços e ST da Profarma.

## 📌 Fase 6 — Conector Assistido Santa Cruz
- [ ] Desenvolvimento de conector para o portal da Santa Cruz.
- [ ] Login manual assistido e extração automática na tela de resultados do portal.

## Fase 6.1 - Conector DM Paraná (Concluído)
- [x] Login autônomo pelo portal oficial.
- [x] Busca por nome com auditoria de dosagem, apresentação e princípio ativo.
- [x] Extração exclusiva de `Preço final: R$`, paginação e bloqueio de itens sem estoque.

## 📌 Fase 7 — Estoque e Giro
- [ ] Banco de dados local para cadastro simples de quantidades em estoque da farmácia.
- [ ] Cálculo de giro mensal médio dos medicamentos.
- [ ] Geração automática de quantidade sugerida para compra.
- [ ] Alerta visual para estoque parado ou medicamentos próximos do vencimento.

## 📌 Fase 8 — Compra Inteligente
- [ ] Gestão de valor mínimo de pedido por fornecedor.
- [ ] Consolidação do custo final (somando impostos sobre ST separado).
- [ ] Sugestão inteligente de fornecedor otimizada para o pedido completo (analisando fretes e condições comerciais globais, não apenas preços unitários por produto).
