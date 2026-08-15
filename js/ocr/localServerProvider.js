// OcrProvider que manda a foto pro servidor OCR local no PC (PaddleOCR na GPU, ver
// CONTEXTO_OCR_LOCAL.md em Downloads) — só faz sentido dentro do app nativo, na mesma rede Wi-Fi
// de casa. Mantém o mesmo contrato dos outros providers (warmup/reconhecer), mas quem decide se
// usa este provider ou cai pro ML Kit é o CompositeNativeProvider em provider.js — aqui só mora a
// lógica de falar com o servidor.
import { comLog } from "../core/logger.js?v=27";

const CHAVE_CONFIG = "rm_ocr_local_server";
// Timeout curto só pra checagem de disponibilidade (bate na porta antes de mandar a foto de
// verdade) — a leitura da foto em si pode legitimamente passar de 20s no modo capricho (IA
// ligada), então esse timeout NUNCA pode ser aplicado na chamada de /ocr, só no /health.
const TIMEOUT_HEALTH_MS = 2500;

export function lerConfigServidorLocal() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_CONFIG) || "{}");
    return { ip: salvo.ip || "", porta: salvo.porta || 8877, ia: salvo.ia === true };
  } catch {
    return { ip: "", porta: 8877, ia: false };
  }
}

export function salvarConfigServidorLocal(config) {
  localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config));
}

function baseUrl(config) {
  return `http://${config.ip}:${config.porta}`;
}

class LocalServerProvider {
  async warmup() {}

  async disponivel(config) {
    if (!config.ip) return false;
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), TIMEOUT_HEALTH_MS);
    try {
      const resp = await fetch(`${baseUrl(config)}/health`, { signal: controlador.signal });
      return resp.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async reconhecer(imagemBlob, onStatus) {
    const config = lerConfigServidorLocal();
    return comLog(
      "LocalServerProvider.reconhecer",
      async () => {
        onStatus?.(config.ia ? "Lendo no PC (modo capricho)..." : "Lendo no PC...");
        const form = new FormData();
        form.append("imagem", imagemBlob, "foto.jpg");
        form.append("ia", config.ia ? "true" : "false");
        const resp = await fetch(`${baseUrl(config)}/ocr`, { method: "POST", body: form });
        if (!resp.ok) throw new Error(`Servidor local respondeu ${resp.status}`);
        return await resp.json();
      },
      { mensagem: "Não consegui ler a foto pelo servidor do PC.", sugestao: "Verifique se o PC está ligado e na mesma rede Wi-Fi." }
    );
  }
}

export function criarLocalServerProvider() {
  return new LocalServerProvider();
}
