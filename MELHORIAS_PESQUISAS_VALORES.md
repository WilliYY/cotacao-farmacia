# 🎯 Melhorias de Backend: Pesquisas e Valores (Wimifarma Cotação)

Esta documentação especifica melhorias técnicas voltadas exclusivamente à inteligência de valores, impostos e alternativas de busca quando itens específicos não são encontrados.

---

## 🧪 1. Tratamento de Itens Ausentes ("Não Disponível")
* **O Conceito:** Quando o usuário pesquisar por um medicamento muito específico (ou um EAN que está em falta geral) e nenhuma das distribuidoras retornar dados, o backend deve gerar um objeto de resultado estruturado com status de **"Não Disponível"** ao invés de apenas retornar uma lista vazia ou erro.
* **Solução Proposta:** 
  * Se o resultado consolidado for vazio, o backend gera um registro simulado:
    ```json
    {
      "supplierProductName": "Item específico não disponível no estoque",
      "price": 0,
      "stStatus": "SEM_ST",
      "availability": "não disponível",
      "recommendationStatus": "Não disponível nas distribuidoras"
    }
    ```
  * O frontend exibirá uma linha com fundo cinza/vermelho indicando de forma explícita que o item está indisponível para compra nas 3 distribuidoras.

---

## 🧮 2. Simulador Dinâmico de Substituição Tributária (ST)
* **O Conceito:** Muitas vezes, a distribuidora não calcula o ST em tempo real na tela (deixando `ST: R$ 0,00` ou `-`), o que pode passar a falsa impressão de que o produto é mais barato do que realmente é.
* **Solução Proposta:** 
  * Criar um banco de dados de alíquotas de ST por **MVA (Margem de Valor Agregado)** associado ao código **NCM (Nomenclatura Comum do Mercosul)** dos medicamentos em cada estado (ex: Paraná).
  * Se o robô capturar um produto com `ST = R$ 0,00`, o backend calcula e simula o imposto final estimado baseado no MVA do produto.
* **Resultado:** O usuário sempre verá o custo real estimado da compra, mesmo se a distribuidora omitir o imposto na tela de consulta rápida.

---

## 🔄 3. Sugestão Automática de Apresentações Alternativas (Fuzzy EAN Linker)
* **O Conceito:** Se o usuário pesquisar por um item específico (ex: "Zolpidem 10mg c/ 20 comprimidos") e ele não estiver disponível, o backend deve sugerir alternativas compatíveis que estão em estoque.
* **Solução Proposta:**
  * Mapear no banco de dados SQLite grupos de equivalência por princípio ativo, miligrama e tipo.
  * Se a busca pelo item de 20 comprimidos falhar, o backend busca e exibe automaticamente: *"Este item de 20cp está indisponível, mas temos o de 30cp por R$ 10,59"*.
* **Resultado:** Reduz o tempo de cotação ao dar alternativas prontas de compra ao operador da farmácia.

---

## 📏 4. Comparador por Custo Unitário Padronizado (Preço por Comprimido/ML)
* **O Conceito:** Medicamentos com caixas de tamanhos diferentes (30, 60 ou 90 comprimidos) dificultam a comparação direta de qual embalagem oferece o melhor custo-benefício.
* **Solução Proposta:**
  * O backend divide o preço final pelo número de unidades (extraído do nome do produto pelo robô).
  * Exibe no topo a medalha de **"Melhor Custo por Comprimido"** de forma destacada.
* **Resultado:** O operador consegue ver que levar a caixa de 90 comprimidos é mais barato unitariamente do que a de 30 comprimidos, mesmo com o desembolso total sendo maior.
