# Pedido pro chat novo: servidor de OCR local no PC

## Contexto
App "Rotas Maquininhas" (`C:\Users\alyss\Desktop\RotasMaquininhas`) lê formulários de OS
fotografados (documento comum de maquininha de cartão — texto pequeno, letra de forma e
manuscrita, papel às vezes torto/amassado/mal enquadrado). Hoje o OCR roda 100% no navegador via
Tesseract.js (grátis, mas fraco em foto ruim). Quero um servidor de OCR rodando LOCAL no meu PC,
que eu já deixo ligado com servidor local quando tô montando rota em casa — melhor qualidade
possível, sem mensalidade, sem API paga.

## O que eu quero que você monte
Um servidor HTTP local simples (Python, FastAPI ou Flask) que:
1. Recebe uma imagem (POST com a foto).
2. Roda OCR nela com o melhor modelo GRATUITO que rodar bem no meu PC.
3. Devolve JSON com: texto reconhecido, e pra cada palavra — texto, posição (bounding box) e
   confiança. Formato sugerido:
   ```json
   { "texto": "...", "palavras": [{"texto":"...", "bbox":{"x0":0,"y0":0,"x1":0,"y1":0}, "confianca":0.9}] }
   ```

## Qual motor de OCR usar (decida com base no meu hardware — pergunte GPU/CPU/RAM antes)
Ordem de preferência (melhor qualidade primeiro):
1. **Modelo de visão via Ollama** (ex: `qwen2.5vl`, `llama3.2-vision`, `minicpm-v`) — é o que mais
   se aproxima do Google Lens, porque lê a imagem inteira e entende contexto, não só letra por
   letra. Precisa de GPU decente (8GB+ VRAM ideal) pra ser rápido; funciona em CPU mas mais lento.
2. Se a GPU não aguentar modelo de visão: **PaddleOCR** (PP-OCRv4/v5) — motor de OCR dedicado,
   muito mais forte que Tesseract, tem suporte a português, roda bem em CPU.
3. Alternativa mais simples de instalar: **docTR** (Mindee) ou **EasyOCR**.

## Importante
- Sem custo nenhum — tudo local, sem API paga, sem mensalidade.
- Precisa ficar acessível na rede local (Wi-Fi de casa) numa porta fixa, ex:
  `http://192.168.x.x:PORTA/ocr`, pra o app (rodando no celular, mesma rede) conseguir chamar.
- NÃO precisa mexer no código do app em `RotasMaquininhas/js/` — isso eu (outro chat) já deixei
  pronto pra plugar: existe uma interface trocável de provedor de OCR em
  `js/ocr/provider.js` (Strategy Pattern). Só me diga o endpoint final e o formato exato da
  resposta que eu conecto.
- Ao final, testa o servidor com uma foto real de formulário e me mostra o resultado.
