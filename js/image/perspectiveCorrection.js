// Aplica a correção de perspectiva usando os 4 cantos já achados por documentDetector.js — devolve
// um canvas com o documento "escaneado": reto, recortado, sem a mesa/mão/fundo em volta. Isso
// resolve de verdade o caso que travou a sessão anterior (papel torto, mal enquadrado, fundo
// bagunçado) porque a detecção de contorno isola o documento do fundo ANTES de qualquer correção —
// diferente do hack de "inclinação fina" antigo, que se confundia com o fundo.
import { getJscanify } from "./documentDetector.js?v=28";

function distancia(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Calcula um tamanho de saída proporcional ao que foi detectado (documento "deitado" vira retrato
// com a proporção certa, não um quadrado arbitrário), limitado por maxDim.
export function calcularTamanhoSaida(cantos, maxDim) {
  const larguraTopo = distancia(cantos.topLeftCorner, cantos.topRightCorner);
  const larguraBase = distancia(cantos.bottomLeftCorner, cantos.bottomRightCorner);
  const alturaEsq = distancia(cantos.topLeftCorner, cantos.bottomLeftCorner);
  const alturaDir = distancia(cantos.topRightCorner, cantos.bottomRightCorner);
  const larguraMedia = Math.max(1, (larguraTopo + larguraBase) / 2);
  const alturaMedia = Math.max(1, (alturaEsq + alturaDir) / 2);
  const escala = Math.min(1, maxDim / Math.max(larguraMedia, alturaMedia));
  return {
    largura: Math.round(larguraMedia * escala),
    altura: Math.round(alturaMedia * escala),
  };
}

// `imagemOrigem` deve ser um canvas ou <img> na resolução ORIGINAL (não a cópia reduzida usada
// pra detectar os cantos) — os `cantos` já vêm escalados pra essa resolução por documentDetector.js.
// Retorna null se `cantos` for null (documentDetector não achou o papel com confiança); quem
// chamar deve cair de volta pra imagem original nesse caso, sem quebrar o resto do pipeline.
export function corrigirPerspectiva(imagemOrigem, cantos, maxDim) {
  if (!cantos) return null;
  const { largura, altura } = calcularTamanhoSaida(cantos, maxDim);
  if (largura < 20 || altura < 20) return null; // detecção degenerada, não vale a pena usar
  return getJscanify().extractPaper(imagemOrigem, largura, altura, cantos);
}
