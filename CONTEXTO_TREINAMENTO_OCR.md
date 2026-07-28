# Pedido pro chat novo: "treinar" a extração de campos por tipo de banco/formulário

## Contexto
App "Rotas Maquininhas" (`C:\Users\alyss\Desktop\RotasMaquininhas`) lê formulário de OS de
maquininha fotografado e tenta preencher os campos sozinho (Nº OS, Cliente, Endereço, Banco,
Serviço, Contato). Hoje isso é feito em `js/interpret/documentInterpreter.js`, com regras
genéricas (regex + geometria dos blocos de texto) que tentam servir pra qualquer formulário, mais
um seletor manual "Tipo de máquina/formulário" na tela de foto (`js/app.js` + `index.html`, 15
marcas: C6 Bank, Cielo, Stone, GetNet, PagBank, Sicredi, SafraPay, Mercado Pago, Azulzinha, Vero,
Fiserv, InfinitePay, C-Trends, Rede, Ton) que já ajuda em dois pontos específicos: fixa o campo
Banco direto (sem adivinhar) e prioriza "Razão Social" em vez de "Cliente" pra formulário Sicredi
(porque o layout real da Sicredi é assim).

**Isso ainda é só o começo.** Cada banco/adquirente tem um layout BEM diferente de verdade (testei
isso com 28 fotos reais — Sicredi é tabela larga, C-Trends é "Rótulo: valor" simples, outros são
formulário de duas colunas, etc). O objetivo agora é ter um "molde" de extração certeiro PRA CADA
tipo, não um regex genérico tentando adivinhar todos ao mesmo tempo.

## Importante: isso NÃO é treinar um modelo de IA
Não tem GPU/infraestrutura de ML pra fine-tuning de verdade aqui, e não faz sentido pra um app de
um técnico só. "Treinar" nesse contexto significa:

1. **Coletar exemplos reais rotulados por tipo** — pra cada uma das ~15 marcas, ter várias fotos
   reais (já tem uma base em `fotos-teste/`, NÃO comitar essa pasta — tem foto real de cliente) e
   anotar manualmente qual é o valor CORRETO de cada campo naquela foto (ground truth). Isso é o
   investimento de maior retorno — sem exemplo rotulado de verdade, não dá pra saber se uma regra
   nova melhorou ou piorou.

2. **Criar um "molde" (template) de extração por tipo**, não regex genérico. Sugestão de estrutura
   nova, `js/interpret/templates/<marca>.js`, cada um exportando os padrões específicos daquele
   layout (rótulos exatos, ordem dos campos, se é tabela ou lista, etc) — o
   `documentInterpreter.js` já tem o gancho pra isso: recebe `tipoSelecionado` e já ramifica regra
   por marca pro caso da Sicredi; é questão de estender esse mesmo padrão pras outras 14.

3. **Se o servidor de OCR local no PC estiver pronto** (ver `CONTEXTO_OCR_LOCAL.md`, modelo de
   visão tipo Qwen2.5-VL via Ollama) — "treinar" nesse caso vira **few-shot prompting**: incluir no
   prompt 1-2 exemplos reais (foto + JSON correto esperado) de cada tipo de formulário, pra IA
   aprender o padrão na hora (in-context), sem precisar de fine-tuning de verdade. Bem mais barato
   e realista.

## O que eu quero que você monte
1. Um jeito de eu (ou você) marcar rapidamente, foto por foto em `fotos-teste/`, qual é o valor
   correto de cada campo — pode ser um arquivo JSON simples ao lado de cada foto, ou uma
   plainilha, o que for mais rápido de preencher na mão.
2. Pra cada tipo de banco com exemplo suficiente (3+ fotos), criar o template de extração
   específico em `js/interpret/templates/`.
3. Estender `test/pipeline.html` (harness de teste que já existe) pra comparar o resultado
   extraído contra o valor correto anotado, e mostrar um placar de acerto POR TIPO de banco — não
   só a métrica genérica de "% de palavras reconhecidas" que já existe.
4. Rodar o teste, ajustar os templates até o placar ficar bom, documentar o resultado.

## Arquivos relevantes
- `js/interpret/documentInterpreter.js` — extração de campos hoje, ponto de partida.
- `js/layout/blockDetection.js`, `js/layout/tableDetection.js` — estrutura geométrica que os
  templates podem usar (bloco, linha, coluna).
- `js/app.js` (seletor "foto-tipo"/"qp-foto-tipo"/"qpd-foto-tipo") — de onde vem `tipoSelecionado`.
- `test/pipeline.html` / `test/pipeline.js` — harness de teste já existente, rodar contra fotos
  reais de `fotos-teste/`.
