# Preenchimento automático da cotação no site

O cotador agora integra `https://wimifarma.com/cotacao/` pelo aplicativo local, usando autenticação, leitura e edição já existentes. Nenhuma modificação ou implantação no servidor foi realizada. A evidência atual está em `outputs/TESTE_PLANILHA_SITE_2026-10-09.md`; os resultados reais devem ser conferidos nesse relatório.

## Reconhecimento dos fornecedores

O cotador deve ler os cabeçalhos atuais e vincular cada conector à chave estável da coluna. A posição visual serve apenas para apresentação: colocar Santa Cruz antes de ANB não deve alterar o destino dos preços.

O vínculo usa `columnKey`, com nomes conhecidos para a configuração inicial: ANB/Anb, Santa/Santa Cruz e Profarma. O usuário confirmou que DM, DM Aline e outros nomes começando pelo termo DM correspondem à DM Paraná neste projeto. Duas colunas para o mesmo fornecedor exigem escolha explícita. Campos protegidos e vínculos colidindo são bloqueados.

## Fluxo implementado

1. Autenticar a sessão do cotador com o usuário do site; os cookies de um navegador externo não ficam automaticamente disponíveis no Electron.
2. Ler `/cotacao/api/bootstrap`, recebendo colunas com `key`, `label`, `position` e linhas com `id`, `values`, `version`.
3. Selecionar linhas da cotação por seus IDs. Buscar prioritariamente por EAN; quando só houver descrição, conferir princípio ativo, dose, apresentação e quantidade antes de associar a oferta.
4. Capturar e auditar o preço final de cada fornecedor. Usar um critério explícito para escolher a apresentação a gravar; uma descrição incompleta como “Buscopam similar” não autoriza preencher com qualquer produto semelhante.
5. Enviar somente preços válidos para suas colunas vinculadas, preservando quantidade, categoria e demais fornecedores. Falha de consulta não deve apagar valores existentes nem criar um preço fictício.
6. Registrar a operação e atualizar a planilha conforme cada consulta termina, com progresso e cancelamento no cotador.

## API existente e limite de concorrência

- Login: formulário normal da Home e ponte SSO para a cotação; sessão revalidada pela autenticação existente. O usuário entra na janela própria do cotador.
- Gravação: `PATCH /cotacao/api/cells/batch`, com `x-csrf-token` e `{changes:[{rowId,columnKey,value,expectedValue}],clientId}`; limite de 1.000 células por chamada.
- Histórico: `GET /cotacao/api/cells/:rowId/:columnKey/history`. O site registra usuário, valor anterior e novo e transmite alterações às demais telas.

O `expectedValue` atual detecta sobrescrita, mas **não impede** salvar sobre uma alteração concorrente. Conforme o pedido de manter toda a integração local, o servidor permanece intacto. O cotador faz preflight de versão/identidade/célula vazia, valida a resposta e relê o valor gravado. Conflito ou entrega incerta interrompem novas gravações sem repetição ou rollback automático. A janela entre preflight e escrita continua sem bloqueio atômico; mantenha as linhas selecionadas sem edição simultânea.

## Evidência local

Código inspecionado em `C:/Users/Williany/Desktop/wimifarma-com/apps/cotacao/src/server.js`:

- autenticação/CSRF: linhas 310, 384 e 3048;
- snapshot de linhas/colunas: linha 1373; bootstrap: 4104;
- renomeação de coluna: 4366;
- atualização e conflito: 4781 e 4818; auditoria: 4881;
- histórico: 4137.

Contrato em `apps/cotacao/src/contracts/domain.ts:34`; comportamento de concorrência documentado em `docs/20-cotacao-v2.md:379`. O conector local identifica DM como `DM Paraná` em `C:/Users/Williany/Desktop/cotação/src/connectors/real/dm-parana-real.js:30`.

O preenchimento automático foi implementado no cotador com o endpoint existente. Sessão do Chrome não é importada: o operador entra na janela do cotador uma vez em cada computador. As colunas seguem suas chaves e nomes, independentemente da ordem visual. A validação real e suas limitações estão registradas no relatório de teste.
