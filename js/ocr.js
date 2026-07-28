// O usuário prefere usar a qualidade total da foto do celular (letra miúda de formulário real só
// sai legível em resolução alta) e aceita que o OCR demore mais por causa disso — por isso o teto
// aqui é bem alto, só como proteção contra um caso extremo (uma foto absurdamente grande vinda da
// galeria, tipo um scan em altíssima resolução), não pra "comprimir" foto normal de câmera.
const MAX_DIM_OCR = 4500;

// Testado (2026-07-28) contraste manual + correção de sombra + nitidez artificial contra a foto
// crua (só rotação corrigida) na mesma foto real: a versão SEM esse pré-processamento reconheceu
// mais palavras com conteúdo de verdade (305 de 444) do que a versão COM ele (270 de 425). O motor
// LSTM do Tesseract já faz sua própria normalização internamente e piora quando "ajudamos" demais
// com contraste/nitidez artificial — por isso passamos a foto praticamente crua (só rotação
// corrigida) pro Tesseract, sem tentar re-inventar o pré-processamento dele.

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

// Gira um canvas (não um bitmap) ao redor do centro, mantendo o mesmo tamanho de saída (o que
// sobra é cortado) — usado só pra testar ângulos candidatos numa cópia pequena, não pra gerar a
// imagem final (por isso não se preocupa em redimensionar o canvas de saída).
function girarCanvasFixo(origem, anguloGraus) {
  const canvas = document.createElement("canvas");
  canvas.width = origem.width;
  canvas.height = origem.height;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((anguloGraus * Math.PI) / 180);
  ctx.drawImage(origem, -origem.width / 2, -origem.height / 2);
  return canvas;
}

// "Projeção horizontal": soma quanto de escuridão (tinta) tem em cada linha de pixels. Quando o
// texto está alinhado direitinho na horizontal, cada linha de texto vira um pico de escuridão e
// cada espaço entre linhas vira um vale — a variância dessa soma linha a linha fica alta. Em
// qualquer outro ângulo as linhas de texto "vazam" umas nas outras e tudo se borra num cinza
// parecido — variância baixa. Isso dá pra usar como métrica pra achar o ângulo certo sem OCR.
function projecaoHorizontalVariancia(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  const somaLinhas = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let soma = 0;
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = rowBase + x * 4;
      soma += 255 - (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }
    somaLinhas[y] = soma;
  }
  let media = 0;
  for (let y = 0; y < h; y++) media += somaLinhas[y];
  media /= h;
  let variancia = 0;
  for (let y = 0; y < h; y++) { const d = somaLinhas[y] - media; variancia += d * d; }
  return variancia / h;
}

// Papel fotografado a mão raramente fica perfeitamente reto — e mesmo poucos graus de inclinação
// já atrapalham MUITO o reconhecimento (o Tesseract lê ao longo da linha assumindo que ela é
// horizontal). A correção de 90/180/270 acima não resolve isso: uma folha torta uns 15-25° continua
// sendo classificada como "mais perto de 0°" pelo detector de orientação. Aqui procuramos, numa
// cópia pequena (rápido), o ângulo fino que deixa as linhas de texto mais horizontais possível.
function detectarInclinacaoFina(bitmap, correcaoGrosseira) {
  const base = desenharGirado(bitmap, correcaoGrosseira, 500);
  let melhorAngulo = 0, melhorVariancia = -1;
  for (let a = -20; a <= 20; a += 1) {
    const variancia = projecaoHorizontalVariancia(girarCanvasFixo(base, a));
    if (variancia > melhorVariancia) { melhorVariancia = variancia; melhorAngulo = a; }
  }
  return melhorAngulo;
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

// `rotacaoManual` (0/90/180/270, opcional): o detector automático (OSD do Tesseract) às vezes erra
// — em foto com fundo bagunçado ou pouco contraste ele pode "ter certeza" da orientação errada, ou
// não achar confiança nenhuma e não corrigir nada. Um botão "Girar" na tela deixa o usuário corrigir
// na mão quando isso acontece, sem depender do algoritmo acertar.
async function processarImagem(file, maxDim = MAX_DIM_OCR, onProgress, rotacaoManual = 0) {
  const bitmap = await createImageBitmap(file);

  onProgress?.("Verificando orientação da foto...");
  const anguloDetectado = await detectarAngulo(bitmap);
  const correcaoGrosseira = anguloDetectado ? (360 - anguloDetectado) % 360 : 0;

  onProgress?.("Corrigindo inclinação da foto...");
  const anguloFino = detectarInclinacaoFina(bitmap, correcaoGrosseira);
  const correcao = correcaoGrosseira + anguloFino + rotacaoManual;

  const canvas = desenharGirado(bitmap, correcao, maxDim);
  bitmap.close?.();
  const w = canvas.width, h = canvas.height;

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
export async function runOcr(file, onProgress, rotacaoManual = 0) {
  let imagem = file, imgWidth = null, imgHeight = null, imagemCorrigidaBlob = null;
  try {
    const processada = await processarImagem(file, MAX_DIM_OCR, onProgress, rotacaoManual);
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

// Igual a firstMatch, mas pula capturas "vazias de conteúdo" (só pontuação/ruído do OCR, tipo um
// "=" ou ":" solto) e continua procurando a próxima ocorrência do mesmo rótulo no texto. Formulário
// com um cabeçalho de seção repetindo o nome do campo (ex: "DADOS DO CLIENTE:" antes do "Cliente:"
// de verdade) faz a busca simples parar cedo demais na ocorrência errada.
function firstMatchFiltrado(text, patterns, valorValido) {
  for (const re of patterns) {
    const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
    const global = new RegExp(re.source, flags);
    let m;
    while ((m = global.exec(text))) {
      const valor = (m[1] || "").trim();
      if (valorValido(valor)) return valor;
      if (m.index === global.lastIndex) global.lastIndex++; // evita loop infinito em match vazio
    }
  }
  return "";
}
const firstMatchComConteudo = (text, patterns) => firstMatchFiltrado(text, patterns, (v) => /[a-zà-ÿ]{2,}/i.test(v));
// Muitos formulários têm "Número da OS" como CABEÇALHO DE COLUNA de uma tabela (ex: "TIPO DE
// SERVIÇO | NÚMERO DA OS | DATA | SLA | ..."), sem dois-pontos e sem número embaixo na mesma
// linha reconhecida — a busca simples capturava a palavra seguinte ("DATA") como se fosse o
// número da OS. Só aceita a captura se tiver pelo menos 2 dígitos de verdade.
const firstMatchComDigito = (text, patterns) => firstMatchFiltrado(text, patterns, (v) => /\d{2,}/.test(v));

function onlyDigits(s) { return (s || "").replace(/\D/g, ""); }

// Nos formulários muitas vezes vários campos ficam na mesma linha (colunas lado a lado, ou o
// OCR gruda um pedaço do campo vizinho na mesma "linha" detectada) — então a captura de um campo
// de texto livre para no próximo rótulo conhecido, não só na quebra de linha ou no fim do texto.
const LABEL_WORDS = "N[UÚ]MERO|N[°ºO]\\.?\\s*OS|DATA|CEP|CIDADE|BAIRRO|CONTATO|CELULAR|RAZ[AÃ]O|NOME|CLIENTE|ENDERE[CÇ]O|REFER[EÊ]NCIA|TIPO|RAMO|PRAZO|VALOR|C[OÓ]D|DOC|MERCHANT|TOKEN";
const NEXT_LABEL = `(?=\\s{2,}|\\s+(?:${LABEL_WORDS})\\b|$)`;

// Tenta extrair campos de OS a partir do texto reconhecido, cobrindo os padrões mais comuns
// de formulários reais (C6/FedEx, Cielo, Azulzinha X, Sicredi, C-Trends, etc).
// `tipoSelecionado` (opcional): quando o usuário sabe de antemão qual é o tipo de máquina/
// formulário (menu na tela de foto), usamos isso pra acertar o banco direto (sem adivinhar) e
// pra priorizar o rótulo certo de cada layout (ex: Sicredi usa "Razão Social", não "Cliente").
// Não é perfeito: o usuário sempre confere/edita antes de salvar.
export function parseOsFields(rawText, tipoSelecionado) {
  const text = rawText.replace(/\r/g, "");
  const result = { numero_os: "", nome_cliente: "", endereco: "", banco: "", servico: "", contato: "" };

  result.numero_os = firstMatchComDigito(text, [
    /n[uú]mero\s*(?:da\s*)?os\s*[:\-]?\s*([\w\-\/.]+)/i,
    /n[°ºo]\.?\s*os\s*[:\-]?\s*([\w\-\/.]+)/i,
    /refer[eê]ncia\s*[:\-]\s*([\w\-\/.]+)/i,
    /n[uú]mero\s*l[oó]gico\s*[:\-]\s*([\w\-\/.]+)/i,
    /merchant\s*id\s*(?:\/\s*pv)?\s*[:\-]\s*([\w\-\/.]+)/i,
  ]);
  if (!result.numero_os) {
    const m = text.match(/\b\d{5,15}\b/);
    if (m) result.numero_os = m[0];
  }

  // Formulário tipo Sicredi identifica o cliente por "Razão Social", não por "Cliente:" — sem
  // saber isso, a busca genérica às vezes acerta um "cliente" solto (ex: cabeçalho de seção)
  // antes de chegar no rótulo certo. Sabendo o tipo, tentamos o rótulo certo primeiro.
  const padroesCliente = /sicredi/i.test(tipoSelecionado || "")
    ? [
        new RegExp("raz[aã]o\\s*social\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
        new RegExp("\\bcliente\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
        /nome\s*fantasia\s*[:\-]\s*(.+)/i,
      ]
    : [
        new RegExp("\\bcliente\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
        /nome\s*fantasia\s*[:\-]\s*(.+)/i,
        new RegExp("raz[aã]o\\s*social\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
      ];
  // Sem ^ ancorando início de linha: às vezes o OCR pega um resíduo de ruído antes do rótulo
  // ("ao Cliente: ...") e isso fazia a extração falhar por completo mesmo com o rótulo certinho.
  result.nome_cliente = firstMatchComConteudo(text, padroesCliente);

  const enderecoBase = firstMatch(text, [/endere[cç]o\s*[:\-]\s*(.+)/i]);
  const bairro = firstMatch(text, [/bairro\s*[:\-]\s*(.+)/i]);
  const cidade = firstMatch(text, [/cidade\s*(?:\s*\/\s*uf)?\s*[:\-]\s*(.+)/i]);
  const cep = firstMatch(text, [/\bcep\s*[:\-]?\s*(\d{5}[\-.]?\d{3})\b/i]);
  result.endereco = [enderecoBase, bairro, cidade, cep].filter(Boolean).join(", ");

  result.servico = firstMatch(text, [
    new RegExp("tipo\\s*(?:de\\s*)?servi[cç]o\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
    new RegExp("\\bservi[cç]o\\s*[:\\-]\\s*(.+?)" + NEXT_LABEL, "im"),
  ]);

  // Sabendo o tipo de antemão (menu na tela de foto), não precisa adivinhar o banco — evita
  // pegar uma marca errada que só aparece de passagem no texto (ex: lista de bandeiras aceitas).
  if (tipoSelecionado) {
    result.banco = tipoSelecionado;
  } else {
    result.banco = firstMatch(text, [/\bbanco\s*[:\-]\s*(.+)/i]);
    if (!result.banco) {
      for (const [re, label] of BRAND_PATTERNS) {
        if (re.test(text)) { result.banco = label; break; }
      }
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
