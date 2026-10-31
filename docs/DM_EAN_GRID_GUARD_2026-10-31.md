# DM: identidade da grade em consultas por EAN

## Correção

O teste de escala encontrou interrupções conservadoras na DM. Uma revisão separada reproduziu uma falha lógica: uma resposta atrasada do campo limpo podia renovar a assinatura da grade com produtos alheios ao EAN e liberar a paginação. Essa reprodução não comprova a causa de cada interrupção real anterior.

`evaluateDmGridEvidence` agora exige um resultado com EAN observado exatamente igual à consulta de 13 dígitos antes de liberar a coleta. Um marcador vazio sobre uma grade com produtos brutos permanece pendente. Consultas por nome, vazio terminal sem produtos e falhas de rede conservam seu comportamento.

Não há alteração em credenciais, estoque, preços, envio de pedidos ou permissões de rede. Evidência ambígua continua sem uso comercial automático.

## Verificação

A regressão integrada local reproduziu três falhas antes da correção, incluindo clique indevido em próxima página. Depois da correção: 384/384 testes da árvore local, 26/26 testes DM direcionados, sintaxe, lint focal e build aprovados. Revisão independente do incremento aprovou seis cenários sem encontrar bloqueadores.

O EAN que havia interrompido a segunda fila retornou uma oferta na repetição isolada. A continuação com 193 itens foi iniciada em novo contexto e checkpoint, mantendo as evidências históricas. Isso comprova a recuperação daquele item, não a conclusão integral do lote.

Este recorte adiciona testes autossuficientes de evidência da grade em `tests/dm-ean-grid-evidence.test.js`. As regressões integradas mais amplas estavam em arquivo local anterior não rastreado e não são incluídas neste commit para evitar publicar trabalho fora do escopo. Os números da suíte local incluem alterações anteriores não publicadas; não representam uma execução isolada do commit.
