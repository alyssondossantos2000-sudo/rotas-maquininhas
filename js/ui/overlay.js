// Desenha o texto reconhecido em cima da própria foto (estilo Google Lens): cada palavra vira uma
// etiqueta posicionada exatamente onde apareceu na imagem. Arrastar o dedo por cima de várias
// palavras seleciona a linha/bloco inteiro via seleção nativa do navegador — por isso os blocos
// (layout/blockDetection.js) são separados por uma linha em branco na hora de desenhar.
//
// Tamanho de letra é POR PALAVRA (usa a altura real da caixa que o OCR detectou pra CADA uma,
// escalada pro zoom/tamanho de tela atual) — pra imitar de verdade o Lens, onde a etiqueta some
// dentro do espaço real da palavra na foto, palavra maior fica maior, menor fica menor. Já tentamos
// um tamanho ÚNICO fixo pra foto inteira antes (mediana de todas as palavras): resolvia foto densa
// só "na média", mas continuava colidindo nas partes MAIS densas que a média (ex: uma tabela
// apertada dentro de um recibo com o resto do texto maior) — só sizing por palavra resolve isso de
// verdade.
//
// O risco de sizing por palavra é o que já vimos antes: UMA caixa detectada errada (bem maior ou
// bem menor que deveria) vira uma etiqueta gigante ou minúscula isolada. Por isso o clamp aqui NÃO
// é em pixel fixo — é RELATIVO à mediana da própria foto (entre 55% e 170% dela), o que deixa cada
// palavra proporcional ao seu tamanho real sem deixar uma caixa ruim isolada estourar o layout.
function medianaOuPadrao(valores, padrao) {
  if (!valores.length) return padrao;
  const ordenado = [...valores].sort((a, b) => a - b);
  return ordenado[Math.floor(ordenado.length / 2)];
}

export function renderizarOverlay(overlay, blocos, imgWidth, imgHeight, previewImgEl) {
  overlay.innerHTML = "";
  const dispH = previewImgEl.clientHeight || imgHeight;
  const escala = dispH / imgHeight;

  const alturasPalavras = [];
  blocos.forEach((bloco) => bloco.linhas.forEach((linha) => linha.palavras.forEach((p) => {
    alturasPalavras.push(p.bbox.y1 - p.bbox.y0);
  })));
  const alturaMediana = medianaOuPadrao(alturasPalavras, 20);
  const alturaMin = alturaMediana * 0.55;
  // Testado com foto real: um logo/título bem maior que o texto normal do documento (ex: "Cielo"
  // no topo) com clamp de 1.7x ainda ficava grande o suficiente pra invadir a linha vizinha. 1.15x
  // deixa esse tipo de destaque só um pouco maior que o resto, sem estourar sobre o texto ao lado.
  const alturaMax = alturaMediana * 1.15;

  blocos.forEach((bloco) => {
    bloco.linhas.forEach((linha) => {
      linha.palavras.forEach((palavra) => {
        const { x0, y0, x1, y1 } = palavra.bbox;
        const alturaPalavra = Math.min(alturaMax, Math.max(alturaMin, y1 - y0));
        // Mínimo absoluto de 6px só pra não desaparecer de vez em zoom bem baixo — o slider de
        // zoom (100-300%) é o jeito de verdade de ler de perto, não a etiqueta crescendo sozinha.
        const fontSize = Math.max(6, alturaPalavra * escala * 0.85);
        const span = document.createElement("span");
        span.className = "ocr-word";
        span.textContent = palavra.texto;
        span.style.left = (x0 / imgWidth) * 100 + "%";
        span.style.top = (y0 / imgHeight) * 100 + "%";
        // Largura NÃO é travada no bbox do OCR — a fonte renderizada quase sempre é mais larga que
        // a caixinha detectada (apertada no glifo original); travar cortava palavra comprida.
        span.style.minWidth = ((x1 - x0) / imgWidth) * 100 + "%";
        span.style.fontSize = fontSize + "px";
        overlay.appendChild(span);
        overlay.appendChild(document.createTextNode(" "));
      });
      overlay.appendChild(document.createTextNode("\n"));
    });
    overlay.appendChild(document.createTextNode("\n")); // separa blocos visualmente
  });
}
