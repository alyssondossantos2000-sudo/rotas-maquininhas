// Desenha o texto reconhecido em cima da própria foto (estilo Google Lens): cada palavra vira uma
// etiqueta posicionada exatamente onde apareceu na imagem. Arrastar o dedo por cima de várias
// palavras seleciona a linha/bloco inteiro via seleção nativa do navegador — por isso os blocos
// (layout/blockDetection.js) são separados por uma linha em branco na hora de desenhar.
//
// Tamanho de letra é ÚNICO e legível pra foto inteira (não varia por palavra) — usar a altura da
// caixa que o OCR detectou pra cada palavra parecia mais "preciso", mas numa foto ruim essa caixa
// às vezes vem errada (bem alta ou bem baixa) e a fonte proporcional a isso saía gigante cobrindo
// outro texto. Testado e confirmado com o usuário.
export function renderizarOverlay(overlay, blocos, imgWidth, imgHeight, previewImgEl) {
  overlay.innerHTML = "";
  const dispH = previewImgEl.clientHeight || imgHeight;
  const fontSize = Math.max(11, dispH * 0.018);

  blocos.forEach((bloco) => {
    bloco.linhas.forEach((linha) => {
      linha.palavras.forEach((palavra) => {
        const { x0, y0, x1, y1 } = palavra.bbox;
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
