# Pedido pro chat novo: servidor de OCR local no PC (modelo forte)

## STATUS: SERVIDOR PRONTO E TESTADO (2026-07-28)
O servidor pedido abaixo já foi construído, roda na GPU (RTX 3060) e foi validado com fotos reais
de `fotos-teste/` (formulários Stone/FedEx e Sicredi — nomes, endereço, CPF, tudo extraído certo).
Se você é o chat que vai plugar `LocalServerProvider` em `js/ocr/provider.js`, é só ler esta seção.

- **Código:** `C:\Users\alyss\Desktop\ocr-server-local\` (FORA do repo do app, de propósito — não
  precisa nem deve ser commitado no GitHub Pages). Python 3.12 num venv próprio
  (`.venv`), instalado à parte porque o Python padrão da máquina (3.13/3.14) não roda PaddleOCR.
- **Iniciar:** rodar `iniciar.bat` (ou `.venv\Scripts\python.exe -m uvicorn app:app --host 0.0.0.0
  --port 8877` de dentro da pasta). Fica escutando em `http://<ip-do-pc>:8877`.
- **Checagem de disponibilidade:** `GET /health` → `{"status":"ok"}`. Use isso pro timeout curto
  (2-3s) de detectar se o PC está acessível antes de mandar a foto de verdade.
- **Endpoint principal:** `POST /ocr`, multipart/form-data com campos:
  - `imagem` (arquivo, obrigatório) — a foto.
  - `ia` (`"true"`/`"false"`, opcional, default `true`) — liga/desliga a segunda passada de IA
    (ver abaixo). Pensado pro usuário poder escolher "modo rápido" vs "modo capricho" na hora.
  - `modelo_ia` (string, opcional) — força um modelo específico do Ollama em vez da ordem padrão.
- **Resposta JSON** (bate com o formato pedido originalmente, só com 3 campos a mais no final):
  ```json
  {
    "texto": "texto completo, uma linha do formulário por linha",
    "palavras": [
      {"texto": "...", "confianca": 0.98, "bbox": {"x0":0,"y0":0,"x1":0,"y1":0}}
    ],
    "ia_usada": true,
    "modelo_ia": "qwen2.5vl:7b",
    "texto_ia": "texto corrigido pela IA (só existe se ia_usada=true)",
    "tempo_ms": 2043
  }
  ```
  `bbox` é em PIXELS da foto original (não normalizado), `x0,y0` = canto superior esquerdo. Os
  `palavras` vêm SEMPRE do PaddleOCR (bbox real por palavra, não por linha inteira). Se
  `ia_usada=true`, use `texto_ia` como o texto pra interpretar/extrair campos (é o corrigido); senão
  use `texto`. `palavras`/overlay sempre vêm do PaddleOCR nos dois casos.
- **Motor escolhido:** **PaddleOCR (PP-OCRv6) rodando na GPU**, não o modelo de visão puro que era
  a 1ª opção sugerida abaixo — motivo: modelo de visão (LLM) não dá bbox por palavra confiável, e o
  overlay do app precisa disso. Fica como passada OPCIONAL de correção (ver `ia`), não como motor
  principal.
  - **Pegadinha real encontrada:** `paddlepaddle` (CPU) 3.3.1 no Windows quebra com MKLDNN ligado
    (erro `ConvertPirAttribute2RuntimeAttribute not support`) — CPU sem MKLDNN ficava em ~2min por
    foto. Resolvido trocando pra `paddlepaddle-gpu` (CUDA 12.6, compatível com o driver da RTX
    3060) — contorna o bug E acelera.
  - PaddleOCR 3.x mudou a API (não é mais `.ocr()`, é `.predict()`) e com
    `return_word_box=True` já devolve bbox de palavra de verdade (`text_word`/`text_word_boxes`),
    não precisou aproximar dividindo a linha.
- **IA opcional (`ia=true`):** manda a MESMA foto (reduzida pra até 1400px no lado maior, só nessa
  chamada — o PaddleOCR usa a foto em resolução cheia) pro Ollama local (`qwen2.5vl:7b`, com
  fallback pra `llama3.2-vision` se o primeiro não estiver puxado) pedindo pra corrigir o texto lido
  pelo OCR olhando a imagem de verdade. Corrigiu erros reais no teste (`FInal`→`Final`,
  `Inlclal`→`Inicial`, removeu duplicação `Rua Rua Campo Grande`→`Rua Campo Grande`).
- **Tempos reais medidos** (foto 4000x3000, RTX 3060, modelo já carregado/quente):
  - Sem IA (só PaddleOCR): **~2 segundos**.
  - Com IA (Qwen2.5-VL): **~21 segundos** (chamada fria do Ollama pode passar de 40s).
  - Primeira chamada depois de religar o servidor é mais lenta (~13s) porque carrega os modelos do
    PaddleOCR na GPU; chamadas seguintes ficam nesses números acima.

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
