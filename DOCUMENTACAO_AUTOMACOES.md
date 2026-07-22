# 📖 Documentação Completa das Automações (Wimifarma Cotação)

Esta documentação detalha o funcionamento técnico das automações de Captcha, paginação completa e fluxos de login no sistema.

---

## 🤖 1. Automação e Resolução de Captcha (Profarma e ANB Farma)

O robô de raspagem de portais web (`src/lib/electron-scraper.js`) foi projetado com suporte nativo a Captcha de duas formas (Automática + Assistida):

### A. Auto-Clique no reCAPTCHA (Totalmente Automático)
1. Durante a navegação no portal da Profarma ou ANB, o script monitora todos os sub-quadros (`iframes`) da página.
2. Ao localizar a URL oficial do Google reCAPTCHA, ele injeta um script JavaScript interno diretamente no frame seguro do reCAPTCHA:
   ```javascript
   const cb = document.querySelector('.recaptcha-checkbox-border');
   if (cb && !cb.classList.contains('recaptcha-checkbox-checked')) {
     cb.click();
   }
   ```
3. O robô clica programaticamente na caixinha **"Não sou um robô"**. Se o Google validar o acesso diretamente sem desafio de imagens, o login é efetuado de imediato.

### B. Modo Cabeçalho Assistido (Segurança contra Bloqueios)
* **Como o Google bloqueia cliques robóticos repetidos**, o navegador Electron é aberto em modo **visível** (`show: true`).
* Caso o reCAPTCHA exiba um desafio visual (ex: selecione faixas de pedestre, semáforos, etc.), a janela estará aberta na sua tela. O operador pode clicar rapidamente nas imagens corretas e, assim que o Captcha for resolvido, a automação assume o controle novamente de onde parou e realiza toda a pesquisa de forma autônoma!

---

## 📄 2. Paginação em Todos os Portais (Profarma, ANB Farma e Santa Cruz)

Para garantir que todos os produtos sejam cotados sem deixar nada para trás, implementamos paginação e rolagem em tempo real em todas as 3 distribuidoras:

### A. Paginação por Próxima Página (Profarma e ANB Farma)
Nos portais web da Profarma e ANB, o robô faz uma varredura multi-páginas de forma contínua:
1. Após submeter a busca, o robô extrai todos os dados da primeira página de resultados.
2. Ele varre o código do portal procurando pelos seletores de botão "Próxima Página" (ex: `button.mat-paginator-navigation-next`, `button[aria-label="Next page"]`, `a.next`).
3. O script verifica se o botão existe e **não está desabilitado** (para saber se ainda existem mais páginas).
4. Se houver página seguinte:
   * Ele clica no botão.
   * Aguarda que a tabela seja atualizada detectando a mudança dos nomes dos produtos.
   * Extrai os novos itens e repete o processo recursivamente (limite de segurança de até 10 páginas para evitar loops).
5. Se o botão de próxima página estiver desabilitado ou não existir, ele finaliza a consolidação e retorna todos os registros.

### B. Rolagem Completa em Tabelas Virtuais (Santa Cruz)
O aplicativo do **Pedido Eletrônico Santa Cruz** utiliza tabelas do tipo *JavaFX TableView*, que carregam na memória apenas as linhas visíveis na tela. 
Para ler a lista completa:
1. O robô captura as primeiras linhas da tabela.
2. Ele obtém o controle de paginação nativo do Windows (`ScrollPattern`) associado à tabela.
3. Executa um comando de rolagem por página (`ScrollAmount::LargeIncrement`).
4. Aguarda **600ms** para que o aplicativo carregue a nova página na memória.
5. Captura os novos itens e adiciona a um dicionário unificado usando o código **EAN** como chave única (prevenindo duplicados).
6. O ciclo se repete até que a porcentagem de rolagem chegue a 100% ou não existam mais itens novos a serem carregados.

---

## 🛠️ 3. Inicialização e Busca Inteligente

* **Abertura Automática Portátil:** Se o aplicativo Santa Cruz estiver fechado, o script descobre a instalação por configuração, caminho validado, processo, atalhos, registro, pastas padrão ou varredura limitada dos discos. As credenciais vêm do cofre local protegido e nunca ficam gravadas nesta documentação ou no script.
* **Busca Real:** Depois do login e de eventuais atualizações, o robô identifica o campo de produto, digita o medicamento, confirma a pesquisa e só aceita dados extraídos da grade ao vivo. O banco H2 local não é usado para cotação.
* **Bypass de Termos Vagos:** Consultas muito curtas (ex: `"shampoo"` ou `"xarope"`) são puladas nas distribuidoras para economizar tempo, exibindo um alerta amarelo com dicas de refinamento de marca no painel.
