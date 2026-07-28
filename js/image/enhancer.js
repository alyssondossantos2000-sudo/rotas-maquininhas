// CLAHE (Contrast Limited Adaptive Histogram Equalization) via OpenCV.js — melhora contraste local
// de forma adaptativa, mais sofisticado que o contraste manual que a sessão anterior já testou e
// PIOROU a leitura do Tesseract (270/425 palavras boas vs 305/444 sem nenhum pré-processamento).
//
// Por isso fica DESATIVADO por padrão (ATIVO = false). Só habilite depois de rodar o harness de
// teste (scripts/testar-ocr.mjs) nas fotos reais de fotos-teste/ e confirmar ganho de verdade —
// não assuma que "ferramenta mais profissional" = resultado melhor sem medir.
export const ATIVO = false;

// Aplica CLAHE em tons de cinza e devolve um novo canvas (RGB, pra continuar compatível com o
// resto do pipeline). Não mexe no canvas de entrada.
export function aplicarClahe(canvas) {
  const cv = window.cv;
  const src = cv.imread(canvas);
  const cinza = new cv.Mat();
  const saida = new cv.Mat();
  try {
    cv.cvtColor(src, cinza, cv.COLOR_RGBA2GRAY);
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(cinza, saida);
    clahe.delete();

    const resultado = document.createElement("canvas");
    resultado.width = canvas.width;
    resultado.height = canvas.height;
    cv.imshow(resultado, saida);
    return resultado;
  } finally {
    src.delete();
    cinza.delete();
    saida.delete();
  }
}

// Ponto único que o pipeline chama — se ATIVO for false, devolve o canvas sem tocar nele.
export function talvezMelhorar(canvas) {
  if (!ATIVO) return canvas;
  try {
    return aplicarClahe(canvas);
  } catch (err) {
    console.error("enhancer.talvezMelhorar: falha ao aplicar CLAHE, seguindo sem melhorar", err);
    return canvas;
  }
}
