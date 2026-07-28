// Orquestra o pipeline inteiro de leitura de documento:
//
//   foto → detectar documento → corrigir perspectiva → rotacionar (automático + manual)
//        → (opcional) melhorar → OCR → normalizar palavras → reconstruir layout
//        → interpretar campos → preencher UI
//
// Substitui o antigo criarCapturaOcr/renderOcrOverlay que moravam dentro de app.js.
import { detectarDocumento, garantirOpenCvCarregado } from "../image/documentDetector.js?v=15";
import { corrigirPerspectiva } from "../image/perspectiveCorrection.js?v=15";
import { desenharGirado, canvasParaBlob, calcularCorrecaoAutomatica } from "../image/autoRotate.js?v=15";
import { proximaRotacaoManual } from "../image/manualRotate.js?v=15";
import { talvezMelhorar } from "../image/enhancer.js?v=15";
import { getOcrProvider, warmupOcr } from "../ocr/provider.js?v=15";
import { normalizarResultado } from "../ocr/wordMapper.js?v=15";
import { reconstruirLayout } from "../layout/blockDetection.js?v=15";
import { interpretarDocumento, paraCamposDeOs } from "../interpret/documentInterpreter.js?v=15";
import { renderizarOverlay } from "./overlay.js?v=15";
import { criarControleZoom } from "./zoom.js?v=15";
import { comLog } from "../core/logger.js?v=15";

// O usuário prefere usar a qualidade total da foto do celular (letra miúda de formulário real só
// sai legível em resolução alta) e aceita que o OCR demore mais por causa disso.
const MAX_DIM_OCR = 4500;

// Prepara os dois motores pesados (Tesseract + OpenCV.js/jscanify) antes do usuário precisar —
// chamado quando a aba "Por foto" abre, pra esconder a demora de carregar ~10MB de WASM/dicionário.
export function prepararPipeline(onStatus) {
  return Promise.all([warmupOcr(onStatus), garantirOpenCvCarregado(onStatus)]);
}

// Exportado (não só usado internamente) pra poder ser chamado direto do harness de teste
// (test/pipeline.html), que roda o pipeline de verdade contra as fotos reais de fotos-teste/ sem
// precisar duplicar essa lógica.
// OpenCV.js (cv.imread) só aceita canvas/img de verdade, não um ImageBitmap bruto — precisa desse
// passo antes de qualquer chamada ao jscanify que use a imagem original em resolução total.
function bitmapParaCanvas(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas;
}

export async function processarPipeline(file, rotacaoManual, onProgress) {
  onProgress?.("Preparando...");
  const bitmap = await createImageBitmap(file);
  const canvasOriginal = bitmapParaCanvas(bitmap);

  const cantos = await comLog(
    "capture.detectarDocumento",
    () => detectarDocumento(bitmap, onProgress),
    { mensagem: "Não consegui detectar o documento na foto.", sugestao: "Seguindo com a foto inteira." }
  ).catch(() => null);

  onProgress?.("Endireitando o documento...");
  const canvasPerspectiva = cantos ? corrigirPerspectiva(canvasOriginal, cantos, MAX_DIM_OCR) : null;
  // Sem detecção confiável de documento (ou correção degenerada) — segue com a foto inteira mesmo.
  // Melhor não recortar errado do que "corrigir" pra pior.
  const baseImagem = canvasPerspectiva || bitmap;

  onProgress?.("Verificando orientação...");
  const correcaoAutomatica = await calcularCorrecaoAutomatica(baseImagem);
  const correcaoTotal = (correcaoAutomatica + rotacaoManual) % 360;
  const canvasRotacionado = desenharGirado(baseImagem, correcaoTotal, MAX_DIM_OCR);

  const canvasFinal = talvezMelhorar(canvasRotacionado);
  const blob = await canvasParaBlob(canvasFinal, 0.9);

  onProgress?.("Lendo o texto...");
  const dadosBrutos = await getOcrProvider().reconhecer(blob, onProgress);
  const { palavras, textoBruto } = normalizarResultado(dadosBrutos);
  const blocos = reconstruirLayout(palavras);

  return { blob, largura: canvasFinal.width, altura: canvasFinal.height, blocos, textoBruto };
}

// Monta um "capturador de documento" completo (botão de foto, prévia + overlay selecionável,
// zoom, girar, opacidade, botões de atribuir texto pra campo) — reutilizado nas 3 telas de foto do
// app (cadastro completo de OS e as duas "paradas rápidas"). `resolveField` decide onde cada botão
// de atribuir manda o texto, `autoFill` decide o que fazer com os campos reconhecidos
// automaticamente, `avisar` mostra um aviso curto pro usuário (ex: toast) quando precisa.
export function criarCapturaDocumento({
  fileInputs, previewWrap, previewImg, overlay, statusEl, rawWrap, rawText,
  opacitySlider, zoomSlider, girarBtn, tipoSelect, resolveField, autoFill, avisar,
}) {
  let arquivoAtual = null;
  let rotacaoManual = 0;
  let ultimoResultado = null; // {blocos, largura, altura} — pra redesenhar overlay quando o zoom muda

  const zoom = criarControleZoom({
    zoomSlider,
    previewImg,
    onZoomChange: () => {
      if (ultimoResultado) {
        renderizarOverlay(overlay, ultimoResultado.blocos, ultimoResultado.largura, ultimoResultado.altura, previewImg);
      }
    },
  });

  const processarArquivo = async (file) => {
    previewWrap.classList.remove("hidden");
    overlay.innerHTML = "";
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Preparando...";
    ultimoResultado = null;

    try {
      const resultado = await processarPipeline(file, rotacaoManual, (msg) => { statusEl.textContent = msg; });

      previewImg.src = URL.createObjectURL(resultado.blob);
      await new Promise((resolve) => { previewImg.onload = resolve; previewImg.onerror = resolve; });

      const interpretado = interpretarDocumento(resultado.blocos, tipoSelect?.value);
      autoFill(paraCamposDeOs(interpretado));

      rawWrap.classList.remove("hidden");
      if (resultado.blocos.length) {
        statusEl.textContent = "Leitura concluída — selecione o texto na foto ou confira os campos.";
        ultimoResultado = { blocos: resultado.blocos, largura: resultado.largura, altura: resultado.altura };
        renderizarOverlay(overlay, resultado.blocos, resultado.largura, resultado.altura, previewImg);
        overlay.style.setProperty("--ocr-overlay-opacity", (opacitySlider?.value ?? 85) / 100);
        rawText.classList.add("hidden");
      } else {
        statusEl.textContent = "Não consegui reconhecer texto nessa foto. Preencha manualmente.";
        rawText.textContent = resultado.textoBruto.trim() || "(nada reconhecido)";
        rawText.classList.remove("hidden");
      }
    } catch (err) {
      statusEl.textContent = "Não consegui ler a foto. Preencha manualmente.";
      console.error(err);
    }
  };

  const onFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    arquivoAtual = file;
    rotacaoManual = 0;
    zoom.resetar();
    processarArquivo(file);
  };
  // Câmera e galeria são dois <input type=file> separados (um com capture="environment", outro
  // sem) — depender de um único input pra oferecer as duas opções não é confiável em todo Android
  // (às vezes só abre a galeria direto, sem opção de câmera).
  fileInputs.forEach((input) => input.addEventListener("change", onFileChange));

  // Gira 90° por clique e reprocessa a MESMA foto — o detector automático de orientação pode ter
  // confiança baixa numa foto ruim e não corrigir nada mesmo com a foto de cabeça pra baixo.
  girarBtn?.addEventListener("click", () => {
    if (!arquivoAtual) return;
    rotacaoManual = proximaRotacaoManual(rotacaoManual);
    zoom.resetar();
    processarArquivo(arquivoAtual);
  });

  opacitySlider?.addEventListener("input", () => {
    overlay.style.setProperty("--ocr-overlay-opacity", opacitySlider.value / 100);
  });

  // Fluxo manual: seleciona um trecho do texto reconhecido (na foto ou no texto puro) e toca no
  // campo. No celular, tocar num botão pode fazer o navegador limpar a seleção de texto antes do
  // clique "oficial" disparar — por isso capturamos o texto já no toque inicial (pointerdown).
  rawWrap.querySelectorAll(".ocr-assign-btn").forEach((btn) => {
    let textoCapturado = "";
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      textoCapturado = window.getSelection().toString().trim();
    });
    btn.addEventListener("click", () => {
      if (!textoCapturado) { avisar?.("Selecione um trecho do texto reconhecido primeiro."); return; }
      const campo = resolveField(btn.dataset.field);
      if (!campo) return;
      campo.value = textoCapturado;
      campo.classList.add("ocr-assigned-flash");
      setTimeout(() => campo.classList.remove("ocr-assigned-flash"), 500);
    });
  });
}
