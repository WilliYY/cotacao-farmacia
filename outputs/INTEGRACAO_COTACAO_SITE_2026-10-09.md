# Preenchimento automático da cotação no site

É possível integrar o cotador a `https://wimifarma.com/cotacao/`. O código local do site já oferece autenticação, leitura da planilha e gravação de células. Esta análise não executou login nem gravou dados no site.

## Reconhecimento dos fornecedores

O cotador deve ler os cabeçalhos atuais e vincular cada conector à chave estável da coluna. A posição visual serve apenas para apresentação: colocar Santa Cruz antes de ANB não deve alterar o destino dos preços.

O vínculo deve ser salvo por `columnKey`, com nomes conhecidos para a configuração inicial: ANB/Anb, Santa/Santa Cruz e Profarma. Cabeçalhos duplicados ou desconhecidos exigem ajuste do vínculo. O conector atual da DM é `DM Paraná`; a coluna `dm aline` mostrada na imagem precisa de associação explícita ao fornecedor correspondente. A palavra DM, isolada, não identifica qual distribuidora é.

## Fluxo proposto

1. Autenticar a sessão do cotador com o usuário do site; os cookies de um navegador externo não ficam automaticamente disponíveis no Electron.
2. Ler `/cotacao/api/bootstrap`, recebendo colunas com `key`, `label`, `position` e linhas com `id`, `values`, `version`.
3. Selecionar linhas da cotação por seus IDs. Buscar prioritariamente por EAN; quando só houver descrição, conferir princípio ativo, dose, apresentação e quantidade antes de associar a oferta.
4. Capturar e auditar o preço final de cada fornecedor. Usar um critério explícito para escolher a apresentação a gravar; uma descrição incompleta como “Buscopam similar” não autoriza preencher com qualquer produto semelhante.
5. Enviar somente preços válidos para suas colunas vinculadas, preservando quantidade, categoria e demais fornecedores. Falha de consulta não deve apagar valores existentes nem criar um preço fictício.
6. Registrar a operação e atualizar a planilha conforme cada consulta termina, com progresso e cancelamento no cotador.

## API existente e ajuste necessário

- Login: `POST /cotacao/login.php`; sessão revalidada por `requireApiAuth`.
- Gravação: `PATCH /cotacao/api/cells/batch`, com `x-csrf-token` e `{changes:[{rowId,columnKey,value,expectedValue}],clientId}`; limite de 1.000 células por chamada.
- Histórico: `GET /cotacao/api/cells/:rowId/:columnKey/history`. O site registra usuário, valor anterior e novo e transmite alterações às demais telas.

O `expectedValue` atual detecta sobrescrita, mas **não impede** salvar sobre uma alteração concorrente. Antes de ativar a gravação automática, a API precisa de uma precondição atômica que rejeite a célula quando o valor esperado ou a versão mudou. O cotador deve reler o conflito e mostrar a pendência, preservando a edição humana.

## Evidência local

Código inspecionado em `C:/Users/Williany/Desktop/wimifarma-com/apps/cotacao/src/server.js`:

- autenticação/CSRF: linhas 310, 384 e 3048;
- snapshot de linhas/colunas: linha 1373; bootstrap: 4104;
- renomeação de coluna: 4366;
- atualização e conflito: 4781 e 4818; auditoria: 4881;
- histórico: 4137.

Contrato em `apps/cotacao/src/contracts/domain.ts:34`; comportamento de concorrência documentado em `docs/20-cotacao-v2.md:379`. O conector local identifica DM como `DM Paraná` em `C:/Users/Williany/Desktop/cotação/src/connectors/real/dm-parana-real.js:30`.

Não há preenchimento automático do site implementado nesta entrega. A integração exige mudanças delimitadas no cotador e na precondição de gravação do site; a posição das colunas já pode ser tratada sem depender de coordenadas.
