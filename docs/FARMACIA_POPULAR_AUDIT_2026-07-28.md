# Auditoria Farmacia Popular e cotacoes reais - 2026-07-28

## Fonte oficial e escopo

O sistema usa o elenco nacional do Programa Farmacia Popular do Brasil atualizado
em 14/07/2026. Por ser nacional, o mesmo elenco se aplica as cotacoes realizadas no
Parana.

- Pagina oficial: https://www.gov.br/saude/pt-br/composicao/sectics/farmacia-popular/arquivos/elenco-de-medicamentos-e-insumos-pfpb.pdf/view
- PDF oficial: https://www.gov.br/saude/pt-br/composicao/sectics/farmacia-popular/arquivos/elenco-de-medicamentos-e-insumos-pfpb.pdf/%40%40download/file
- Codigos de barras oficiais: https://www.gov.br/saude/pt-br/composicao/sectics/farmacia-popular/codigos-de-barras/2026

O catalogo local possui 41 apresentacoes exatas. A classificacao nao transforma uma
concentracao, liberacao ou associacao diferente em item elegivel.

## Elenco pesquisavel

### Asma

- ipratropio 0.02mg
- ipratropio 0.25mg
- beclometasona 200mcg
- beclometasona 250mcg
- beclometasona 50mcg
- salbutamol 100mcg
- salbutamol 5mg

### Diabetes

- metformina 500mg
- metformina 500mg acao prolongada
- metformina 850mg
- glibenclamida 5mg
- insulina humana regular 100ui/ml
- insulina humana 100ui/ml

### Hipertensao

- atenolol 25mg
- anlodipino 5mg
- captopril 25mg
- propranolol 40mg
- hidroclorotiazida 25mg
- losartana 50mg
- enalapril 10mg
- espironolactona 25mg
- furosemida 40mg
- metoprolol 25mg

### Anticoncepcao

- medroxiprogesterona 150mg
- etinilestradiol 0.03mg + levonorgestrel 0.15mg
- noretisterona 0.35mg
- estradiol 5mg + noretisterona 50mg

### Outros grupos

- alendronato 70mg
- sinvastatina 10mg
- sinvastatina 20mg
- sinvastatina 40mg
- carbidopa 25mg + levodopa 250mg
- benserazida 25mg + levodopa 100mg
- timolol 2.5mg
- timolol 5mg
- budesonida 32mcg
- budesonida 50mcg
- beclometasona 50mcg/dose
- dapagliflozina 10mg
- absorvente higienico
- fralda geriatrica

## Contrato dos precos

| Distribuidora | Campo aceito | Condicao adicional |
| --- | --- | --- |
| ANB | `Unit c/ST` | Nunca usar `Preco`, desconto ou calculo local |
| Profarma | `Preco Final` | Medicamento com `ST R$ -` fica bloqueado |
| Santa Cruz | `Preco NF` | Exige estoque visual, grade nova e limpeza da busca |
| DM Parana | `Preco final: R$` | Exige botao de compra ativo e estoque |

Preco, estoque, EAN e ST nunca sao reaproveitados do historico para uma nova cotacao.
O historico guarda apenas a evidencia da rodada que ja terminou.

## Evidencia real de 28/07/2026

Pesquisa `losartana 50mg`, executada nos portais web:

| Distribuidora | Menor oferta compativel | Evidencia |
| --- | ---: | --- |
| ANB | R$ 2,98 | `Unit c/ST`, 30 comprimidos, estoque disponivel |
| Profarma | R$ 2,70 | `Preco Final`, EAN `7896181915638`, com ST e estoque |
| DM Parana | R$ 2,66 | `Preco final: R$`, EAN `7896112114185`, com ST e estoque |
| Santa Cruz | sem preco confirmado | atualizador respondeu `503 Service Unavailable` |

A falha da Santa Cruz foi encerrada em 3min35s como indisponibilidade tecnica. Nenhum
preco anterior ou valor zero foi apresentado como oferta.

A busca por EAN `7891721201806` foi validada em 25/07/2026: ANB e Santa Cruz
retornaram o EAN exato; a Profarma encontrou o mesmo produto sem estoque; a DM
retornou outros EANs, todos bloqueados. Em 28/07/2026 a repeticao na ANB terminou no
limite de 5 minutos e permaneceu bloqueada como falha tecnica.

### Elenco completo - precos confirmados na DM Parana

A rodada completa executou 164 verificacoes (`41 itens x 4 fornecedores`). ANB,
Profarma e Santa Cruz abriram o disjuntor depois de falha tecnica; as linhas
seguintes foram registradas como bloqueadas, nao como produto inexistente. A DM
concluiu os 41 itens, encontrou 19 apresentacoes elegiveis e 40 ofertas validas.

| Apresentacao | Menor `Preco final: R$` |
| --- | ---: |
| salbutamol 100mcg | R$ 20,35 |
| metformina 500mg | R$ 3,88 |
| metformina 850mg | R$ 4,95 |
| glibenclamida 5mg | R$ 2,28 |
| atenolol 25mg | R$ 1,65 |
| anlodipino 5mg | R$ 2,56 |
| captopril 25mg | R$ 2,35 |
| propranolol 40mg | R$ 2,47 |
| hidroclorotiazida 25mg | R$ 1,50 |
| losartana 50mg | R$ 2,66 |
| enalapril 10mg | R$ 3,39 |
| espironolactona 25mg | R$ 6,97 |
| furosemida 40mg | R$ 3,14 |
| alendronato 70mg | R$ 2,70 |
| sinvastatina 10mg | R$ 5,39 |
| sinvastatina 20mg | R$ 3,36 |
| sinvastatina 40mg | R$ 7,98 |
| budesonida 32mcg | R$ 18,68 |
| dapagliflozina 10mg | R$ 63,19 |

Os demais itens ficaram sem oferta elegivel ou sem resultado confirmado na DM.
Isso nao prova indisponibilidade nas outras distribuidoras, porque elas estavam
bloqueadas por infraestrutura nessa rodada.

## Repeticao do elenco completo

```powershell
npm run diagnose:farmacia-popular
```

O comando consulta os 41 itens nas quatro distribuidoras, aplica o disjuntor por
fornecedor depois de falha de infraestrutura e grava o relatorio sanitizado em
`logs/farmacia-popular-live-latest.json`. O arquivo e operacional, muda a cada
rodada e nao deve ser versionado.

## Portabilidade e atualizacao

- A instalacao recomendada em outro computador e um clone Git iniciado por
  `wimi cotacao.bat`. O bootstrap faz `fast-forward`, reconcilia dependencias,
  compila quando necessario e abre o Electron sem CMD visivel.
- O auxiliar da Santa Cruz e empacotado em `resources/santacruz-search.ps1` e
  descobre atalhos, registro, processos e instalacoes locais em cada computador.
- Um executavel portatil isolado nao possui metadados Git e ainda nao e um
  autoatualizador completo. Atualizacao binaria assinada exige uma origem de
  releases e assinatura de codigo; ate isso existir, use o clone com bootstrap.
- Credenciais e banco permanecem locais. Logs, banco, `.env`, relatorios e
  executaveis locais nao entram em commit.

## Melhorias inspiradas no mercado

SmartPed e CotaFacil foram usados apenas como referencia publica de fluxo. Proximas
melhorias de maior valor:

1. Otimizar o pedido total considerando minimo, frete, prazo e condicao comercial,
   nao apenas o menor item isolado.
2. Manter trilha de auditoria por campo: fornecedor, horario, EAN, estoque, ST,
   rotulo de preco e motivo de bloqueio.
3. Criar manifesto de saude por distribuidora com login, rota, seletores e ultima
   validacao real.
4. Exibir painel de disponibilidade e desempenho sem misturar falha tecnica com
   produto inexistente.

Referencias: https://smartped.net.br/ e https://www.cotafacil.net/
