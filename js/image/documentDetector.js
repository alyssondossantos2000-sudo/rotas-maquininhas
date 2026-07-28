// Detecção de documento: acha os 4 cantos do papel na foto, usando OpenCV.js + jscanify.
// As duas bibliotecas rodam 100% no navegador via WASM — sem servidor, sem custo, mesmo princípio
// do Tesseract.js já usado no resto do app. Carregadas SOB DEMANDA (só quando a aba "Por foto"
// abre ou uma foto é processada), pra não pesar o carregamento inicial do app com ~8MB de WASM.
import { comLog } from "../core/logger.js?v=15";

const OPENCV_URL = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";
const JSCANIFY_URL = "https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/jscanify.min.js";
const DIM_DETECCAO = 1000; // achar os 4 cantos numa cópia pequena é rápido — não precisa de resolução alta só pra isso

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-doc-reader="${src}"]`)) { resolve(); return; }
    const script = document.createElement("script");
    script.src = src;
    script.dataset.docReader = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

let prontoPromise = null;
// Idempotente — pode ser chamado de vários lugares (warmup ao abrir a aba + cada captura) que só
// carrega e inicializa uma vez.
export function garantirOpenCvCarregado(onStatus) {
  if (prontoPromise) return prontoPromise;
  prontoPromise = comLog(
    "documentDetector.garantirOpenCvCarregado",
    async () => {
      onStatus?.("Preparando leitor de documento...");
      await carregarScript(OPENCV_URL);
      // O evento "load" do script só garante que o JS rodou, não que o WASM (que faz o trabalho
      // de verdade) terminou de inicializar — isso só acontece um pouco depois, via callback.
      await new Promise((resolve, reject) => {
        const cv = window.cv;
        if (cv && cv.Mat) { resolve(); return; }
        if (!cv) { reject(new Error("window.cv não existe depois do script carregar")); return; }
        cv.onRuntimeInitialized = resolve;
      });
      await carregarScript(JSCANIFY_URL);
    },
    { mensagem: "Não consegui carregar o leitor de documento.", sugestao: "Verifique sua internet e tente de novo." }
  ).catch((err) => {
    prontoPromise = null; // permite tentar de novo numa próxima foto
    throw err;
  });
  return prontoPromise;
}

let scannerInstancia = null;
export function getJscanify() {
  if (!scannerInstancia) scannerInstancia = new window.jscanify();
  return scannerInstancia;
}

function canvasReduzido(bitmap, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

// Área do quadrilátero (fórmula do polígono/shoelace) — usada só pra sanity-check da detecção.
function areaQuadrilatero(c) {
  const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % 4];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area) / 2;
}

// Acha os 4 cantos do papel na foto. Detecta numa cópia reduzida (rápido) e devolve os cantos já
// escalados pras coordenadas da imagem ORIGINAL, prontos pra recortar em resolução total.
//
// Retorna null quando a detecção não é confiável — contorno não encontrado, ou a área encontrada
// é pequena/grande demais pra ser um documento de verdade (ex: achou uma sombra, ou "detectou" a
// foto inteira). Nesse caso o pipeline segue sem correção de perspectiva, usando a imagem original
// — melhor não recortar errado do que "corrigir" pra pior (mesma lição da sessão anterior: pré-
// processamento automático que erra pode piorar mais do que ajudar).
export async function detectarDocumento(bitmap, onStatus) {
  await garantirOpenCvCarregado(onStatus);
  onStatus?.("Procurando o documento na foto...");

  const pequeno = canvasReduzido(bitmap, DIM_DETECCAO);
  const escala = Math.max(bitmap.width, bitmap.height) / Math.max(pequeno.width, pequeno.height);
  const cv = window.cv;
  const mat = cv.imread(pequeno);

  try {
    const contorno = getJscanify().findPaperContour(mat);
    if (!contorno) return null;
    const cantos = getJscanify().getCornerPoints(contorno);
    contorno.delete?.();
    if (!cantos) return null;

    const areaRel = areaQuadrilatero(cantos) / (pequeno.width * pequeno.height);
    if (areaRel < 0.15 || areaRel > 0.98) return null;

    const escalar = (p) => ({ x: p.x * escala, y: p.y * escala });
    return {
      topLeftCorner: escalar(cantos.topLeftCorner),
      topRightCorner: escalar(cantos.topRightCorner),
      bottomLeftCorner: escalar(cantos.bottomLeftCorner),
      bottomRightCorner: escalar(cantos.bottomRightCorner),
    };
  } finally {
    mat.delete?.();
  }
}
