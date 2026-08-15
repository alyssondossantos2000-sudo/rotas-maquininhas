// Strategy Pattern pro OCR: o resto do app não sabe (nem precisa saber) que motor tá rodando por
// baixo. Trocar por um serviço pago no futuro (Google Vision, Azure, etc.) significa escrever uma
// nova classe com os mesmos dois métodos e trocar a instância em getOcrProvider(), sem tocar em
// layout/, interpret/ ou ui/.
import { comLog } from "../core/logger.js?v=27";
import { criarMlKitProvider } from "./mlkitProvider.js?v=27";
import { criarLocalServerProvider, lerConfigServidorLocal } from "./localServerProvider.js?v=27";

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

// Dentro do app nativo, tenta primeiro o servidor OCR do PC (mais forte, mesma rede Wi-Fi de
// casa) e só cai pro ML Kit se o PC não responder no /health em até ~2.5s ou se a chamada de
// verdade falhar no meio (ver localServerProvider.js) — nunca trava esperando o PC.
class CompositeNativeProvider {
  constructor(local, mlkit) {
    this._local = local;
    this._mlkit = mlkit;
  }

  warmup(onStatus) {
    return this._mlkit.warmup(onStatus);
  }

  async reconhecer(imagemBlob, onStatus) {
    const config = lerConfigServidorLocal();
    if (config.ip && (await this._local.disponivel(config))) {
      try {
        return await this._local.reconhecer(imagemBlob, onStatus);
      } catch (err) {
        console.error("Servidor local do PC falhou, caindo pro ML Kit:", err);
      }
    }
    return this._mlkit.reconhecer(imagemBlob, onStatus);
  }
}

let instanciaPadrao = null;
// Dentro do app nativo (APK) usa o Google ML Kit — offline, embutido no APK, e melhor que
// Tesseract em foto de câmera real. No site (navegador comum, sem Capacitor) o ML Kit não existe,
// então continua no Tesseract.js. `window.Capacitor?.isNativePlatform?.()` só existe/retorna true
// dentro do WebView nativo.
export function getOcrProvider() {
  if (!instanciaPadrao) {
    const nativo = window.Capacitor?.isNativePlatform?.() === true;
    instanciaPadrao = nativo
      ? new CompositeNativeProvider(criarLocalServerProvider(), criarMlKitProvider())
      : new TesseractProvider();
  }
  return instanciaPadrao;
}

export function warmupOcr(onStatus) {
  return getOcrProvider().warmup(onStatus);
}
