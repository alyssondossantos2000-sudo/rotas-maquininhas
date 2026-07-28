// Reconstrói a estrutura visual do documento a partir das palavras normalizadas (ocr/wordMapper.js):
// agrupa palavra→linha (já vem do Tesseract) e linha→bloco/parágrafo por proximidade vertical.
// Isso é o que permite mostrar "Cliente:\nLAVAGEM QUERUBIM LTDA" como duas linhas de um mesmo
// bloco, em vez de um texto gigante achatado — e permite selecionar um bloco inteiro na UI.
function medianaOuPadrao(valores, padrao) {
  if (!valores.length) return padrao;
  const ordenado = [...valores].sort((a, b) => a - b);
  return ordenado[Math.floor(ordenado.length / 2)];
}

function montarLinhas(palavras) {
  const porLinha = new Map();
  palavras.forEach((p) => {
    if (!porLinha.has(p.linha)) porLinha.set(p.linha, []);
    porLinha.get(p.linha).push(p);
  });

  return [...porLinha.values()]
    .map((palavrasDaLinha) => {
      const ordenadas = [...palavrasDaLinha].sort((a, b) => a.bbox.x0 - b.bbox.x0);
      return {
        palavras: ordenadas,
        y0: Math.min(...ordenadas.map((p) => p.bbox.y0)),
        y1: Math.max(...ordenadas.map((p) => p.bbox.y1)),
        x0: Math.min(...ordenadas.map((p) => p.bbox.x0)),
        x1: Math.max(...ordenadas.map((p) => p.bbox.x1)),
        texto: ordenadas.map((p) => p.texto).join(" "),
      };
    })
    .sort((a, b) => a.y0 - b.y0);
}

// Agrupa linhas em blocos: linhas próximas verticalmente (gap pequeno comparado à altura típica
// de uma linha) formam o mesmo bloco/parágrafo; um espaço bem maior que o normal indica um novo
// bloco (pulou de seção — ex: saiu de um campo pra outro, ou pra uma tabela).
export function reconstruirLayout(palavras) {
  const linhas = montarLinhas(palavras);
  const alturaMediana = medianaOuPadrao(linhas.map((l) => l.y1 - l.y0), 20);
  const limiarGap = alturaMediana * 1.2;

  const blocos = [];
  let atual = null;
  linhas.forEach((linha) => {
    if (atual && linha.y0 - atual.y1 <= limiarGap) {
      atual.linhas.push(linha);
      atual.y1 = Math.max(atual.y1, linha.y1);
      atual.x0 = Math.min(atual.x0, linha.x0);
      atual.x1 = Math.max(atual.x1, linha.x1);
    } else {
      atual = { linhas: [linha], y0: linha.y0, y1: linha.y1, x0: linha.x0, x1: linha.x1 };
      blocos.push(atual);
    }
  });

  return blocos.map((b) => ({ ...b, texto: b.linhas.map((l) => l.texto).join("\n") }));
}
