# GAM — cadastro e validação do leitor

## Configuração local

O lojista autorizou cadastrar a conta GAM existente no aplicativo e forneceu o acesso diretamente. Foi criada uma cópia consistente do SQLite em armazenamento privado antes da alteração. O cadastro foi salvo pelo helper normal de credenciais e relido para confirmar o retorno, sem escrever senhas em código, relatórios ou Git.

Rota configurada e validada: `https://egam.com.br/egam/login`.

O cadastro é local; outra instalação precisa de seu próprio acesso. A sessão do Chrome não é importada. As credenciais das demais fontes e os registros de produtos pesquisados, cotações, itens e resultados permaneceram iguais ao backup. A integridade SQLite retornou `ok`.

## Correção do formato real

A célula Mercadoria do portal contém uma indicação de imagem e uma descrição curta antes da linha `EAN13: descrição`. O leitor anterior esperava o EAN no primeiro caractere e acabava em timeout, mesmo após login válido.

O leitor agora exige uma única linha de identidade explicitamente rotulada na mesma célula. EAN ausente, divergente ou ambíguo não é promovido a correspondência, e o EAN pesquisado não substitui uma identidade observada. A mensagem “Avise-me quando chegar” em qualquer linha prevalece sobre preço e controle de quantidade.

A guarda de rede também bloqueia caminhos mutantes, inclusive `/egam/item/add`, para qualquer tipo de recurso e em GET/HEAD. Recursos estáticos legítimos como `additional-methods.min.js` continuam permitidos. Não houve ampliação de origens ou de permissões.

## Piloto real de leitura

Foram consultados os mesmos 20 EANs do piloto anterior, em execução exclusiva da GAM. O lote terminou em 52,908 segundos:

- 20 consultas concluídas, sem erro ou pendência;
- 15 ofertas com EAN observado e confirmado;
- cinco buscas vazias;
- 13 ofertas com indicação de disponibilidade e duas indisponíveis;
- custo capturado da coluna `Líquido + Imposto`;
- nenhum saldo numérico comprovado e nenhuma reserva.

As 15 ofertas continuam `ST_DESCONHECIDO` e nenhuma foi elegível para uso comercial automático. Essa revisão tributária permanece separada do funcionamento da consulta. Não houve pedido, faturamento nem alteração de preços ou estoque do site.

Os resultados comerciais, a captura da tela autenticada e o diagnóstico sanitizado ficam nos artefatos locais, fora do versionamento. Credenciais não integram as evidências compartilháveis.

## Verificação e limites de publicação

As regressões usam estrutura equivalente à observada com descrições e preços sintéticos. Cobrem prefixos, EAN divergente/ausente/ambíguo, aviso de indisponibilidade, isolamento da sessão, encerramento e bloqueios de rede. O arquivo `tests/gam-search-only.test.js` também é carregado por `tests/all.test.js`, integrando a suíte habitual sem alterar flags globais.

Arquivos publicados neste recorte: `src/lib/gam-browser-engine.js`, `tests/gam-search-only.test.js`, o import específico em `tests/all.test.js` e este documento.

Verificações realizadas na árvore local: `npm.cmd test` passou com 375 testes; a rodada direcionada de `gam-search-only` e `gam-integration` passou com 17 testes; `npm.cmd run build` passou; `npm.cmd run lint` terminou com zero erros e 21 avisos já existentes. A revisão independente confirmou compatibilidade das dependências do leitor com o HEAD e não encontrou bloqueador novo no módulo. Esses conjuntos de testes se sobrepõem.

Esta alteração publica a camada de leitura e seus testes. O runner de catálogo e outras integrações do aplicativo já presentes na árvore local não estão incluídos automaticamente no mesmo commit. O registro não afirma publicação de todo esse conjunto nem de um instalador.
