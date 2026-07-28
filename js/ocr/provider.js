// Strategy Pattern pro OCR: o resto do app não sabe (nem precisa saber) que motor tá rodando por
// baixo. Hoje só existe TesseractProvider (grátis, roda no navegador) — trocar por um serviço
// pago no futuro (Google Vision, Azure, etc.) significa escrever uma nova classe com os mesmos
// dois métodos e trocar a instância em getOcrProvider(), sem tocar em layout/, interpret/ ou ui/.
import { comLog } from "../core/logger.js?v=14";

function traduzirStatus(m) {
  if (m.status === "recognizing text") return `Lendo a foto... ${Math.round(m.progress * 100)}%`;
  if (m.status === "loading language traineddata") return `Baixando dicionário de português... ${Math.round(m.progress * 100)}%`;
  if (m.status) return "Preparando leitor de texto...";
  return null;
}

// Toda implementação de OcrProvider deve expor:
//   warmup(onStatus) => Promise<void>   — prepara o motor antes de precisar (esconde a demora)
//   reconhecer(imagemBlob, onStatus) => Promise<DadosBrutosDoMotor> — lê o texto da imagem
class TesseractProvider {
  constructor() {
    this._workerPromise = null;
    // O logger é fixado na criação do worker (a API do Tesseract.js não permite trocar depois),
    // então usamos um callback "atual" mutável — cada chamada de reconhecer() aponta o dela.
    this._logCallback = null;
  }

  warmup(onStatus) {
    if (this._workerPromise) return this._workerPromise;
    onStatus?.("Preparando leitor de texto...");
    this._workerPromise = Tesseract.createWorker("por", 1, {
      logger: (m) => this._logCallback?.(m),
    }).catch((err) => {
      this._workerPromise = null; // permite tentar de novo se falhar
      throw err;
    });
    return this._workerPromise;
  }

  async reconhecer(imagemBlob, onStatus) {
    return comLog(
      "TesseractProvider.reconhecer",
      async () => {
        this._logCallback = (m) => {
          const texto = traduzirStatus(m);
          if (texto) onStatus?.(texto);
        };
        onStatus?.("Preparando leitor de texto...");
        try {
          const worker = await this.warmup(onStatus);
          const { data } = await worker.recognize(imagemBlob);
          return data;
        } finally {
          this._logCallback = null;
        }
      },
      { mensagem: "Não consegui ler o texto da foto.", sugestao: "Tente tirar a foto de novo ou preencha manualmente." }
    );
  }
}

let instanciaPadrao = null;
export function getOcrProvider() {
  if (!instanciaPadrao) instanciaPadrao = new TesseractProvider();
  return instanciaPadrao;
}

export function warmupOcr(onStatus) {
  return getOcrProvider().warmup(onStatus);
}
