// Normaliza a saída bruta de qualquer OcrProvider (hoje só Tesseract) pro formato comum que o
// resto do pipeline (layout/, interpret/, ui/) consome: uma lista achatada de PALAVRAS com texto,
// posição, confiança e a linha de origem — nunca só um texto gigante solto (isso é o que permite
// reconstruir layout, tabela, seleção por bloco, etc depois).
export function normalizarResultado(dadosBrutos) {
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
