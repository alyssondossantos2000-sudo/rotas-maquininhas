# Pedido pro chat novo: servidor de OCR local no PC (modelo forte)

## Contexto
App "Rotas Maquininhas" (`C:\Users\alyss\Desktop\RotasMaquininhas`) lê formulários de OS
fotografados (documento comum de maquininha de cartão — texto pequeno, letra de forma e
manuscrita, papel às vezes torto/amassado/mal enquadrado). Já existe um app Android nativo (APK,
via Capacitor, pasta `android/`) e uma versão site (GitHub Pages). O OCR hoje roda 100% no
celular via Tesseract.js (grátis, mas fraco em foto ruim).

Quero um SEGUNDO caminho de OCR, mais forte, rodando no meu PC — que eu já deixo ligado com
servidor local quando tô montando rota em casa.

## Fluxo desejado (round-trip celular ↔ PC)
1. Usuário tira a foto no celular (app já faz isso).
2. Celular manda a foto pro servidor local no PC (mesma rede Wi-Fi de casa),
   `POST http://<ip-do-pc>:PORTA/ocr` com a imagem.
3. PC roda OCR com um modelo forte (ver opções abaixo) e devolve o texto reconhecido.
4. Celular recebe a resposta e preenche os campos, do jeito que já faz hoje com o Tesseract.
5. **Se o PC não estiver acessível** (fora de casa, sem rede, servidor desligado) — o app cai
   sozinho pro OCR local do celular (Google ML Kit, já implementado — ver seção final). Esse
   fallback automático é o ponto mais importante: nunca pode travar o app esperando o PC responder
   (usar timeout curto, tipo 2-3s, na tentativa de conexão).

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
  `http://192.168.x.x:PORTA/ocr`. Também pensar em CORS liberado (o app roda de
  `https://localhost` dentro do Capacitor, ou do domínio do GitHub Pages na versão site) — o
  servidor precisa aceitar requisição vinda de origem diferente.
- NÃO precisa mexer no código do app em `RotasMaquininhas/js/` — isso eu (outro chat) já deixei
  pronto pra plugar: existe uma interface trocável de provedor de OCR em `js/ocr/provider.js`
  (Strategy Pattern), com um `TesseractProvider` já implementado. É só me passar o endpoint final
  e o formato exato da resposta que eu crio um `LocalServerProvider` + a lógica de detectar se o
  PC tá acessível e cair pro OCR do celular se não estiver.
- Ao final, testa o servidor com uma foto real de formulário (tem exemplos em
  `RotasMaquininhas/fotos-teste/`, NÃO comitar essa pasta — tem foto real de cliente) e me mostra
  o resultado.

## Sobre o OCR no celular (só contexto, já está pronto — NÃO é o que você vai montar)
O app já trocou o Tesseract.js pelo **Google ML Kit** dentro do APK nativo (`js/ocr/mlkitProvider.js`
+ pacote `@capacitor-mlkit/text-recognition`) — roda 100% offline no celular, embutido no APK, sem
download nem custo. `js/ocr/provider.js` já escolhe automaticamente: ML Kit dentro do app nativo,
Tesseract.js no site (navegador comum, onde ML Kit não existe). Isso significa que o
`LocalServerProvider` que você vai me ajudar a plugar precisa ser tentado **primeiro** (com timeout
curto), e só cair pro ML Kit/Tesseract se o PC não responder — não o contrário.

## Depois desse servidor pronto: ver também `CONTEXTO_TREINAMENTO_OCR.md`
Documento separado sobre "treinar" a extração de campos por tipo de banco/formulário (não é
treinar modelo de IA — é criar um molde de extração certeiro por layout). Relevante pro modelo de
visão via Ollama sugerido acima: nesse caso "treinar" vira few-shot prompting (exemplos reais no
prompt), não fine-tuning.
