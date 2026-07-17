# Customizações de Resposta do Agente (Wimifarma Cotação)

## Regras de Resposta Padrão de Cotações:
Por padrão, ao finalizar uma cotação e listar os resultados ao usuário no chat, responda **EXCLUSIVAMENTE** no seguinte formato de tabela de texto, ordenado **sempre do menor preço (ganhador) para o maior preço (perdedor)**:

```text
[EAN] | [Nome do Produto] | [Quantidade (Caixa/Comp/ML)] | [Valor Final] | [Distribuidora]
```

Se o produto estiver indisponível em todas as distribuidoras, retorne:
```text
Não Disponível nas distribuidoras pesquisadas.
```

---

## Regra Obrigatória de Auto-Documentação de Alterações:
Sempre que uma alteração, correção ou melhoria for realizada em qualquer parte do código (conectores, banco de dados, regras fiscais, parser, layout frontend, etc.), o agente de IA **DEVE OBRIGATORIAMENTE** atualizar e manter sincronizados os seguintes arquivos de documentação do projeto:
1. **[AI_SYSTEM_GUIDE.md](file:///c:/Users/Williany/Desktop/cotação/docs/AI_SYSTEM_GUIDE.md):** Contendo a arquitetura de dados híbrida, diagramas de tabelas, normalizações e lógica dos motores fiscais de ST.
2. **[CHANGELOG.md](file:///c:/Users/Williany/Desktop/cotação/docs/CHANGELOG.md):** Adicionando e detalhando a lista de novos recursos, mudanças e correções nesta versão.
3. **[walkthrough.md](file:///C:/Users/Williany/.gemini/antigravity/brain/68842be0-3307-446a-ae3e-dae51b7da941/walkthrough.md):** Resumo técnico e visual detalhado das modificações para validação humana.

Esta regra aplica-se a todos os agentes e assistentes de IA que operarem neste workspace futuramente.

---

## Regra Obrigatória de Entrega Git
Ao concluir qualquer alteração no projeto, o agente deve tratar validação, documentação, commit e push da branch atual como parte padrão da entrega.

Antes do commit, deve revisar o diff e impedir a inclusão de credenciais, arquivos `.env`, bancos, logs, caches, capturas, dependências binárias de fornecedores ou outros artefatos exclusivos da máquina local. Se o push não puder ser concluído por autenticação, rede ou rejeição do remoto, o agente deve manter o commit local e informar claramente o bloqueio.


