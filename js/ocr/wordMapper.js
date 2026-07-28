// Normaliza a saída bruta de qualquer OcrProvider pro formato comum que o resto do pipeline
// (layout/, interpret/, ui/) consome: uma lista achatada de PALAVRAS com texto, posição, confiança
// e a linha de origem — nunca só um texto gigante solto (isso é o que permite reconstruir layout,
// tabela, seleção por bloco, etc depois). Cada provider tem um formato bruto diferente (Tesseract:
// `lines[].words[]`; ML Kit: `blocks[].lines[].elements[]`) — detecta qual veio pela forma do
// objeto, sem o resto do pipeline precisar saber a diferença.
export function normalizarResultado(dadosBrutos) {
  if (Array.isArray(dadosBrutos.blocks)) return normalizarMlKit(dadosBrutos);
  return normalizarTesseract(dadosBrutos);
}

function normalizarTesseract(dadosBrutos) {
  const palavras = [];
  (dadosBrutos.lines || []).forEach((linha, indiceLinha) => {
    (linha.words || []).forEach((w) => {
      palavras.push({
        texto: w.text,
        bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
        confianca: typeof w.confidence === "number" ? Math.max(0, Math.min(1, w.confidence / 100)) : null,
        linha: indiceLinha,
      });
    });
  });
  return { palavras, textoBruto: dadosBrutos.text || "" };
}

// O ML Kit não expõe confiança por palavra (ao contrário do Tesseract) — fica null, e o resto do
// pipeline já trata confiança ausente como "não sabemos" (não é tratado como zero/ruim).
function normalizarMlKit(dadosBrutos) {
  const palavras = [];
  let indiceLinha = 0;
  (dadosBrutos.blocks || []).forEach((bloco) => {
    (bloco.lines || []).forEach((linha) => {
      (linha.elements || []).forEach((el) => {
        palavras.push({
          texto: el.text,
          bbox: { x0: el.boundingBox.left, y0: el.boundingBox.top, x1: el.boundingBox.right, y1: el.boundingBox.bottom },
          confianca: null,
          linha: indiceLinha,
        });
      });
      indiceLinha++;
    });
  });
  return { palavras, textoBruto: dadosBrutos.text || "" };
}
