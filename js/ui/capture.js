// Orquestra o pipeline inteiro de leitura de documento:
//
//   foto → detectar documento → corrigir perspectiva → rotacionar (automático + manual)
//        → (opcional) melhorar → OCR → normalizar palavras → reconstruir layout
//        → interpretar campos → preencher UI
//
// Substitui o antigo criarCapturaOcr/renderOcrOverlay que moravam dentro de app.js.
import { detectarDocumento } from "../image/documentDetector.js?v=24";
import { corrigirPerspectiva } from "../image/perspectiveCorrection.js?v=24";
import { desenharGirado, canvasParaBlob, calcularCorrecaoAutomatica } from "../image/autoRotate.js?v=24";
import { proximaRotacaoManual } from "../image/manualRotate.js?v=24";
import { talvezMelhorar } from "../image/enhancer.js?v=24";
import { getOcrProvider, warmupOcr } from "../ocr/provider.js?v=24";
import { normalizarResultado } from "../ocr/wordMapper.js?v=24";
import { reconstruirLayout } from "../layout/blockDetection.js?v=24";
import { interpretarDocumento, paraCamposDeOs } from "../interpret/documentInterpreter.js?v=24";
import { renderizarOverlay } from "./overlay.js?v=24";
import { criarControleZoom } from "./zoom.js?v=24";
import { comLog } from "../core/logger.js?v=24";

const CHAVE_CAPTURA_PENDENTE = "rm_captura_pendente_em";
// Depois disso desiste de recuperar (foto velha demais / usuário já foi fazer outra coisa).
const JANELA_RECUPERACAO_MS = 3 * 60 * 1000;

function base64ParaBlob(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Se o Android matou e recriou a página inteira enquanto o app de Câmera nativo estava em
// primeiro plano (RAM curta — acontece com bastante frequência em celular com muito app aberto), a
// foto tirada já ficou salva no armazenamento do celular pelo plugin @capacitor/camera, mas a
// Promise de `tirarFotoNativa()` que ia processá-la morreu junto com a página antiga — por isso a
// foto "sumia" e o usuário tinha que tirar de novo. Aqui a gente procura essa foto pelo carimbo de
// tempo salvo ANTES de abrir a câmera (ver `tirarFotoNativa`) e recupera ela sozinho, sem o usuário
// precisar fazer nada. Só é chamada pra restaurar a tela principal "Nova OS" — ver app.js.
export async function recuperarFotoInterrompida() {
  const marcaBruta = localStorage.getItem(CHAVE_CAPTURA_PENDENTE);
  localStorage.removeItem(CHAVE_CAPTURA_PENDENTE);
  if (!marcaBruta) return null;
  const marca = Number(marcaBruta);
  if (!marca || Date.now() - marca > JANELA_RECUPERACAO_MS) return null;

  try {
    const { Filesystem, Directory } = window.NativePlugins;
    const { files } = await Filesystem.readdir({ path: "Pictures", directory: Directory.External });
    // Margem de 5s pra trás: o relógio do arquivo (mtime) pode ser gravado um instante antes do
    // carimbo JS ter sido lido, dependendo de quando o SO termina de escrever o arquivo no disco.
    const candidatos = files
      .filter((f) => f.name.toLowerCase().endsWith(".jpg") && f.mtime >= marca - 5000)
      .sort((a, b) => b.mtime - a.mtime);
    if (!candidatos.length) return null;

    const { data } = await Filesystem.readFile({ path: `Pictures/${candidatos[0].name}`, directory: Directory.External });
    return base64ParaBlob(data, "image/jpeg");
  } catch (err) {
    console.error("[recuperarFoto] ERRO:", err);
    return null;
  }
}

// O usuário prefere usar a qualidade total da foto do celular (letra miúda de formulário real só
// sai legível em resolução alta) e aceita que o OCR demore mais por causa disso.
const MAX_DIM_OCR = 4500;

// Prepara o motor de OCR (Tesseract/ML Kit) antes do usuário precisar — chamado quando a aba "Por
// foto" abre, pra esconder a demora de carregar ~2-3MB de dicionário.
//
// NÃO chama mais garantirOpenCvCarregado aqui: a detecção de documento (OpenCV.js/jscanify) está
// DESLIGADA desde 2026-07-29 (ver ATIVO=false em documentDetector.js — cortava conteúdo real de
// fotos reais). Baixar os ~8MB de WASM do OpenCV toda vez que a aba "Por foto" abre, pra uma
// função que nunca roda, só gastava tempo/dados à toa — pior ainda em rota, com sinal de celular
// ruim. Se a detecção for reativada de novo no futuro, volta a chamar aqui.
export function prepararPipeline(onStatus) {
  return warmupOcr(onStatus);
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
  fileInputs, cameraInput, previewWrap, previewImg, overlay, statusEl, rawWrap, rawText,
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
        overlay.style.setProperty("--ocr-overlay-opacity", (opacitySlider?.value ?? 15) / 100);
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

  const iniciarNovoArquivo = (file) => {
    arquivoAtual = file;
    rotacaoManual = 0;
    zoom.resetar();
    processarArquivo(file);
  };

  const onFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    iniciarNovoArquivo(file);
  };
  // Câmera e galeria são dois <input type=file> separados (um com capture="environment", outro
  // sem) — depender de um único input pra oferecer as duas opções não é confiável em todo Android
  // (às vezes só abre a galeria direto, sem opção de câmera).
  fileInputs.forEach((input) => input.addEventListener("change", onFileChange));

  // Dentro do app nativo, "Tirar foto" usa o plugin @capacitor/camera em vez do <input
  // capture="environment"> puro. Motivo real encontrado testando no celular: com o input puro, o
  // Android as vezes mata o processo do app enquanto o app de Câmera tá em primeiro plano (RAM
  // curta) — quando volta, o WebView recarrega do zero (perde a aba "Por foto" e a foto nunca
  // chega a aparecer). O plugin da Capacitor sobrevive a essa recriação porque salva a chamada
  // pendente e entrega o resultado certinho mesmo se a Activity for recriada no meio do caminho.
  if (cameraInput && window.Capacitor?.isNativePlatform?.() === true) {
    cameraInput.addEventListener("click", (e) => {
      e.preventDefault();
      tirarFotoNativa();
    });
  }

  async function tirarFotoNativa() {
    // Carimbo salvo ANTES de abrir a câmera: se o Android matar a página logo em seguida (ver
    // `recuperarFotoInterrompida` acima), é isso que permite achar a foto certa depois de recriada.
    localStorage.setItem(CHAVE_CAPTURA_PENDENTE, String(Date.now()));
    try {
      const { Camera, CameraResultType, CameraSource } = window.NativePlugins;
      const foto = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        quality: 90,
        saveToGallery: false,
      });
      const resp = await fetch(foto.webPath);
      const blob = await resp.blob();
      localStorage.removeItem(CHAVE_CAPTURA_PENDENTE);
      iniciarNovoArquivo(blob);
    } catch (err) {
      localStorage.removeItem(CHAVE_CAPTURA_PENDENTE);
      // Usuário cancelando a câmera também cai aqui (rejeita a Promise) — fluxo normal, sem aviso.
      if (String(err?.message || err).toLowerCase().includes("cancel")) return;
      avisar?.("Não consegui abrir a câmera.");
      console.error(err);
    }
  }

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

  return {
    // Exposto pra app.js poder empurrar uma foto recuperada (ver `recuperarFotoInterrompida`) pro
    // mesmo pipeline que uma foto escolhida na hora usaria — sem duplicar a lógica de processamento.
    processarFotoRecuperada: iniciarNovoArquivo,
  };
}
