// OcrProvider que usa o Google ML Kit (reconhecimento de texto) — só existe dentro do app nativo
// (APK via Capacitor). Roda 100% offline no celular (o modelo de script latino já vem embutido no
// APK, sem download) e, por ser o motor de OCR de produção do próprio Google, costuma reconhecer
// bem mais texto de foto de câmera do que o Tesseract.js.
//
// As bibliotecas do Capacitor (Filesystem, TextRecognition) chegam aqui via window.NativePlugins
// — não dá pra `import` direto (especificador nu tipo "@capacitor/filesystem" só resolve com
// bundler, e o projeto é zero-build-step). O único arquivo que passa por bundler é
// native/entry.js, empacotado por scripts/build-www.mjs em www/vendor/native-plugins.js.
import { comLog } from "../core/logger.js?v=20";

function blobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

class MlKitProvider {
  // O modelo de script latino do ML Kit já vem embutido no APK — não precisa baixar nada antes
  // de usar, ao contrário do Tesseract (que baixa ~2-3MB de dicionário na primeira vez).
  async warmup() {}

  async reconhecer(imagemBlob, onStatus) {
    return comLog(
      "MlKitProvider.reconhecer",
      async () => {
        onStatus?.("Lendo o texto...");
        const { Filesystem, Directory, TextRecognition } = window.NativePlugins;

        const base64 = await blobParaBase64(imagemBlob);
        const caminho = `ocr-${Date.now()}.jpg`;
        const { uri } = await Filesystem.writeFile({ path: caminho, data: base64, directory: Directory.Cache });

        try {
          return await TextRecognition.processImage({ path: uri });
        } finally {
          Filesystem.deleteFile({ path: caminho, directory: Directory.Cache }).catch(() => {});
        }
      },
      { mensagem: "Não consegui ler o texto da foto.", sugestao: "Tente tirar a foto de novo ou preencha manualmente." }
    );
  }
}

export function criarMlKitProvider() {
  return new MlKitProvider();
}
