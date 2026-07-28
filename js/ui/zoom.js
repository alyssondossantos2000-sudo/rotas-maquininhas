// Zoom dedicado na prévia da foto (a página inteira tem pinça desabilitada de propósito, como um
// app instalado) — a imagem cresce além do container, que rola nativamente (scroll do dedo) pra
// mirar num texto pequeno antes de selecionar.
export function criarControleZoom({ zoomSlider, previewImg, onZoomChange }) {
  const resetar = () => {
    if (!zoomSlider) return;
    zoomSlider.value = 100;
    const inner = previewImg.closest(".foto-zoom-inner");
    if (inner) inner.style.width = "100%";
  };

  zoomSlider?.addEventListener("input", () => {
    const inner = previewImg.closest(".foto-zoom-inner");
    if (inner) inner.style.width = zoomSlider.value + "%";
    onZoomChange?.();
  });

  return { resetar };
}
