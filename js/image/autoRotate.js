// Detecção automática de rotação (0/90/180/270) via OSD (Orientation and Script Detection) do
// Tesseract — fotos tiradas "de lado" ou "de cabeça pra baixo" deixam qualquer OCR praticamente
// cego. Roda ANTES do OCR de verdade, numa cópia pequena da foto (rápido).
import { comLog } from "../core/logger.js?v=19";

// Desenha o bitmap num canvas girado pelos graus indicados (sentido horário), com o maior lado
// limitado a maxDim. Usado tanto pra pré-visualização rápida quanto pra gerar a imagem final.
export function desenharGirado(bitmap, anguloGraus, maxDim) {
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

export function canvasParaBlob(canvas, qualidade = 0.9) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", qualidade));
}

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

async function detectarAnguloOsd(bitmap) {
  const worker = await getOsdWorker();
  const canvasTeste = desenharGirado(bitmap, 0, 1200);
  const blobTeste = await canvasParaBlob(canvasTeste, 0.8);
  const { data } = await worker.detect(blobTeste);
  if (data.orientation_confidence >= 1 && [0, 90, 180, 270].includes(data.orientation_degrees)) {
    return data.orientation_degrees;
  }
  return 0;
}

// Retorna quantos graus GIRAR a foto pra corrigir a orientação (0 se já estiver reta, ou se o
// detector não tiver confiança suficiente — nesse caso o botão "Girar" manual fica como reserva).
export async function calcularCorrecaoAutomatica(bitmap) {
  try {
    const anguloDetectado = await comLog(
      "autoRotate.detectarAnguloOsd",
      () => detectarAnguloOsd(bitmap),
      { mensagem: "Não foi possível detectar a rotação da foto.", sugestao: "Use o botão Girar se a foto sair torta." }
    );
    return anguloDetectado ? (360 - anguloDetectado) % 360 : 0;
  } catch {
    return 0; // já logado por comLog — segue o pipeline sem correção automática
  }
}
