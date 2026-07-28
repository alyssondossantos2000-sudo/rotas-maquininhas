// Fotos tiradas direto da câmera do celular costumam vir enormes (3000-4000px, vários MB).
// Processar isso cru no Tesseract.js pode estourar a memória do navegador no celular e derrubar
// a aba (o app "reinicia" sozinho). Por isso sempre reduzimos a imagem antes de rodar o OCR.
const MAX_DIM_OCR = 2000;

// Converte pra tons de cinza e "estica" o contraste (o pixel mais escuro vira preto, o mais claro
// vira branco) — isso ajuda MUITO o Tesseract a ler foto de papel com sombra/pouca luz, sem o
// risco de um threshold fixo (preto/branco bruto) que pode arruinar partes com iluminação desigual.
function aplicarCinzaEContraste(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;
  const cinzas = new Uint8ClampedArray(w * h);

  let min = 255, max = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const cinza = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    cinzas[j] = cinza;
    if (cinza < min) min = cinza;
    if (cinza > max) max = cinza;
  }

  const range = Math.max(1, max - min);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = ((cinzas[j] - min) / range) * 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
}

// Desenha o bitmap num canvas girado pelos graus indicados (sentido horário), com o maior lado
// limitado a maxDim. Usado tanto pra pré-visualização rápida (detecção de rotação) quanto pra
// gerar a imagem final já endireitada.
function desenharGirado(bitmap, anguloGraus, maxDim) {
  const inverte = anguloGraus === 90 || anguloGraus === 270;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const drawW = Math.round(bitmap.width * scale);
  const drawH = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = inverte ? drawH : drawW;
  canvas.height = inverte ? drawW : drawH;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((anguloGraus * Math.PI) / 180);
  ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  return canvas;
}

function canvasParaBlob(canvas, qualidade = 0.9) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", qualidade));
}

// Fotos tiradas "de lado" ou "de cabeça pra baixo" (comum quando se fotografa um papel deitado,
// sem girar o celular) deixam o Tesseract praticamente cego. Detectamos o ângulo com um worker
// leve e específico pra isso (OSD) antes de rodar a leitura de verdade, e corrigimos a imagem.
let osdWorkerPromise = null;
function getOsdWorker() {
  if (!osdWorkerPromise) {
    osdWorkerPromise = Tesseract.createWorker("osd", 0, {}).catch((err) => {
      osdWorkerPromise = null;
      throw err;
    });
  }
  return osdWorkerPromise;
}

async function detectarAngulo(bitmap) {
  try {
    const worker = await getOsdWorker();
    const canvasTeste = desenharGirado(bitmap, 0, 1200);
    const blobTeste = await canvasParaBlob(canvasTeste, 0.8);
    const { data } = await worker.detect(blobTeste);
    if (data.orientation_confidence >= 1 && [0, 90, 180, 270].includes(data.orientation_degrees)) {
      return data.orientation_degrees;
    }
  } catch (err) {
    console.error("Não foi possível detectar a rotação da foto:", err);
  }
  return 0;
}

// Converte pra tons de cinza e "estica" o contraste (o pixel mais escuro vira preto, o mais claro
// vira branco) — isso ajuda MUITO o Tesseract a ler foto de papel com sombra/pouca luz, sem o
// risco de um threshold fixo (preto/branco bruto) que pode arruinar partes com iluminação desigual.
function aplicarCinzaEContraste(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;
  const cinzas = new Uint8ClampedArray(w * h);

  let min = 255, max = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const cinza = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    cinzas[j] = cinza;
    if (cinza < min) min = cinza;
    if (cinza > max) max = cinza;
  }

  const range = Math.max(1, max - min);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = ((cinzas[j] - min) / range) * 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
}

async function processarImagem(file, maxDim = MAX_DIM_OCR, onProgress) {
  const bitmap = await createImageBitmap(file);

  onProgress?.("Verificando orientação da foto...");
  const anguloDetectado = await detectarAngulo(bitmap);
  const correcao = anguloDetectado ? (360 - anguloDetectado) % 360 : 0;

  const canvas = desenharGirado(bitmap, correcao, maxDim);
  bitmap.close?.();
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");

  try {
    aplicarCinzaEContraste(ctx, w, h);
  } catch (err) {
    console.error("Não foi possível melhorar o contraste da imagem:", err);
  }

  const blob = await canvasParaBlob(canvas, 0.9);
  return { blob: blob || file, width: w, height: h, anguloCorrigido: correcao };
}

// O motor do Tesseract.js baixa ~2-3MB de "dicionário" de português e inicializa o mecanismo
// de leitura na primeira vez que é usado — isso é o que demora mais, não a leitura da foto em si.
// Por isso deixamos um único worker pronto e reaproveitado entre fotos, e começamos a prepará-lo
// assim que o usuário abre a aba "Por foto" (antes mesmo de tirar a foto), pra esconder essa espera.
let workerPromise = null;
// O logger é fixado na criação do worker (a API do Tesseract.js não permite trocar depois),
// então usamos um callback "atual" mutável — cada chamada de runOcr aponta pra sua própria função.
let currentLogCallback = null;

function traduzirStatus(m) {
  if (m.status === "recognizing text") return `Lendo a foto... ${Math.round(m.progress * 100)}%`;
  if (m.status === "loading language traineddata") return `Baixando dicionário de português... ${Math.round(m.progress * 100)}%`;
  if (m.status) return "Preparando leitor de texto...";
  return null;
}

export function warmupOcr(onStatus) {
  if (workerPromise) return workerPromise;
  onStatus?.("Preparando leitor de texto...");
  workerPromise = Tesseract.createWorker("por", 1, {
    logger: (m) => currentLogCallback?.(m),
  }).catch((err) => {
    workerPromise = null; // permite tentar de novo se falhar
    throw err;
  });
  return workerPromise;
}

// OCR no navegador via Tesseract.js (gratuito, sem chave de API). Detecta e corrige automaticamente
// foto tirada de lado/de cabeça pra baixo, e retorna a posição de cada linha/palavra reconhecida
// (em pixels da imagem já corrigida), pra dar pra sobrepor o texto exatamente em cima da foto
// (estilo Google Lens) e permitir selecionar/conferir o texto direto ali.
export async function runOcr(file, onProgress) {
  let imagem = file, imgWidth = null, imgHeight = null, imagemCorrigidaBlob = null;
  try {
    const processada = await processarImagem(file, MAX_DIM_OCR, onProgress);
    imagem = processada.blob;
    imagemCorrigidaBlob = processada.blob;
    imgWidth = processada.width;
    imgHeight = processada.height;
  } catch (err) {
    console.error("Não foi possível processar a imagem, usando original:", err);
  }

  currentLogCallback = (m) => {
    const texto = traduzirStatus(m);
    if (texto) onProgress?.(texto);
  };
  onProgress?.("Preparando leitor de texto...");

  try {
    const worker = await warmupOcr(onProgress);
    const { data } = await worker.recognize(imagem);
    const linhas = (data.lines || []).map((linha) => ({
      bbox: linha.bbox,
      palavras: (linha.words || []).map((w) => ({ text: w.text, bbox: w.bbox })),
    }));
    return { text: data.text || "", linhas, imgWidth, imgHeight, imagemCorrigidaBlob };
  } finally {
    currentLogCallback = null;
  }
}

// Marcas/adquirentes comuns nos formulários de OS de maquininha — usadas para descobrir o
// "banco" quando o documento não tem um rótulo "Banco:" explícito (o mais comum na prática).
const BRAND_PATTERNS = [
  [/c6\s*pay|c6\s*bank/i, "C6 Bank"],
  [/\bcielo\b/i, "Cielo"],
  [/\bstone\b/i, "Stone"],
  [/\bgetnet\b/i, "GetNet"],
  [/pagbank|pagseguro/i, "PagBank"],
  [/\bsicredi\b/i, "Sicredi"],
  [/safrapay/i, "SafraPay"],
  [/mercado\s*pago|mercadopago/i, "Mercado Pago"],
  [/azulzinha/i, "Azulzinha"],
  [/\bvero\b/i, "Vero"],
  [/fiserv/i, "Fiserv"],
  [/infinitepay/i, "InfinitePay"],
  [/c-?trends/i, "C-Trends"],
  [/\brede\b/i, "Rede"],
  [/\bton\b/i, "Ton"],
];

// Tenta cada regex da lista, em ordem, e retorna o primeiro grupo capturado não vazio.
function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return "";
}

function onlyDigits(s) { return (s || "").replace(/\D/g, ""); }

// Tenta extrair campos de OS a partir do texto reconhecido, cobrindo os padrões mais comuns
// de formulários reais (C6/FedEx, Cielo, Azulzinha X, Sicredi, C-Trends, etc).
// Não é perfeito: o usuário sempre confere/edita antes de salvar.
export function parseOsFields(rawText) {
  const text = rawText.replace(/\r/g, "");
  const result = { numero_os: "", nome_cliente: "", endereco: "", banco: "", servico: "", contato: "" };

  result.numero_os = firstMatch(text, [
    /n[uú]mero\s*(?:da\s*)?os\s*[:\-]?\s*([\w\-\/.]+)/i,
    /n[°ºo]\.?\s*os\s*[:\-]?\s*([\w\-\/.]+)/i,
    /refer[eê]ncia\s*[:\-]\s*([\w\-\/.]+)/i,
    /n[uú]mero\s*l[oó]gico\s*[:\-]\s*([\w\-\/.]+)/i,
  ]);
  if (!result.numero_os) {
    const m = text.match(/\b\d{5,15}\b/);
    if (m) result.numero_os = m[0];
  }

  result.nome_cliente = firstMatch(text, [
    /^\s*cliente\s*[:\-]\s*(.+)$/im,
    /nome\s*fantasia\s*[:\-]\s*(.+)/i,
    /raz[aã]o\s*social\s*[:\-]\s*(.+)/i,
  ]);

  const enderecoBase = firstMatch(text, [/endere[cç]o\s*[:\-]\s*(.+)/i]);
  const bairro = firstMatch(text, [/bairro\s*[:\-]\s*(.+)/i]);
  const cidade = firstMatch(text, [/cidade\s*(?:\s*\/\s*uf)?\s*[:\-]\s*(.+)/i]);
  const cep = firstMatch(text, [/\bcep\s*[:\-]?\s*(\d{5}[\-.]?\d{3})\b/i]);
  result.endereco = [enderecoBase, bairro, cidade, cep].filter(Boolean).join(", ");

  // Nos formulários muitas vezes vários campos ficam na mesma linha (colunas lado a lado),
  // então a captura do serviço para no próximo rótulo conhecido, não só na quebra de linha.
  const labelWords = "N[UÚ]MERO|N[°ºO]\\.?\\s*OS|DATA|CEP|CIDADE|BAIRRO|CONTATO|CELULAR|RAZ[AÃ]O|NOME|ENDERE[CÇ]O|REFER[EÊ]NCIA|TIPO|RAMO|PRAZO|VALOR|C[OÓ]D|DOC";
  const nextLabel = `(?=\\s{2,}|\\s+(?:${labelWords})\\b|$)`;
  result.servico = firstMatch(text, [
    new RegExp("tipo\\s*(?:de\\s*)?servi[cç]o\\s*[:\\-]\\s*(.+?)" + nextLabel, "im"),
    new RegExp("\\bservi[cç]o\\s*[:\\-]\\s*(.+?)" + nextLabel, "im"),
  ]);

  result.banco = firstMatch(text, [/\bbanco\s*[:\-]\s*(.+)/i]);
  if (!result.banco) {
    for (const [re, label] of BRAND_PATTERNS) {
      if (re.test(text)) { result.banco = label; break; }
    }
  }

  // Telefone: prioriza campo "Celular:" isolado, depois procura um número dentro da linha
  // "Contato:" (que às vezes traz "Nome - telefone" tudo junto), depois rótulos genéricos.
  // Não tenta adivinhar telefone solto no resto do texto — arriscaria pegar número de
  // série/maquineta por engano; melhor deixar em branco do que errado.
  const phonePattern = /\(?0?\d{2}\)?[\s.\-]?9?\d{4}[\s.\-]?\d{4}/;
  const contatoRaw = firstMatch(text, [
    new RegExp("celular\\s*[:\\-]\\s*(" + phonePattern.source + ")", "i"),
    new RegExp("contato\\s*[:\\-].*?(" + phonePattern.source + ")", "i"),
    new RegExp("(?:telefone|tel\\.?|whats\\s*app|whatsapp|fone)\\s*[:\\-]\\s*(" + phonePattern.source + ")", "i"),
  ]);
  result.contato = onlyDigits(contatoRaw);

  return result;
}
