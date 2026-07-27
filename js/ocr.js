// OCR no navegador via Tesseract.js (gratuito, sem chave de API).
export async function runOcr(file, onProgress) {
  const { data } = await Tesseract.recognize(file, "por", {
    logger: (m) => {
      if (onProgress && m.status === "recognizing text") onProgress(Math.round(m.progress * 100));
    },
  });
  return data.text || "";
}

// Marcas/adquirentes comuns nos formulários de OS de maquininha — usadas para descobrir o
// "banco" quando o documento não tem um rótulo "Banco:" explícito (o mais comum na prática).
const BRAND_PATTERNS = [
  [/c6\s*pay|c6\s*bank/i, "C6 Bank"],
  [/\bcielo\b/i, "Cielo"],
  [/\bstone\b/i, "Stone"],
  [/\bgetnet\b/i, "GetNet"],
  [/pagbank|pagseguro/i, "PagBank"],
  [/\bsicredi\b/i, "Sicredi"],
  [/safrapay/i, "SafraPay"],
  [/mercado\s*pago|mercadopago/i, "Mercado Pago"],
  [/azulzinha/i, "Azulzinha"],
  [/\bvero\b/i, "Vero"],
  [/fiserv/i, "Fiserv"],
  [/infinitepay/i, "InfinitePay"],
  [/c-?trends/i, "C-Trends"],
  [/\brede\b/i, "Rede"],
  [/\bton\b/i, "Ton"],
];

// Tenta cada regex da lista, em ordem, e retorna o primeiro grupo capturado não vazio.
function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return "";
}

function onlyDigits(s) { return (s || "").replace(/\D/g, ""); }

// Tenta extrair campos de OS a partir do texto reconhecido, cobrindo os padrões mais comuns
// de formulários reais (C6/FedEx, Cielo, Azulzinha X, Sicredi, C-Trends, etc).
// Não é perfeito: o usuário sempre confere/edita antes de salvar.
export function parseOsFields(rawText) {
  const text = rawText.replace(/\r/g, "");
  const result = { numero_os: "", nome_cliente: "", endereco: "", banco: "", servico: "", contato: "" };

  result.numero_os = firstMatch(text, [
    /n[uú]mero\s*(?:da\s*)?os\s*[:\-]?\s*([\w\-\/.]+)/i,
    /n[°ºo]\.?\s*os\s*[:\-]?\s*([\w\-\/.]+)/i,
    /refer[eê]ncia\s*[:\-]\s*([\w\-\/.]+)/i,
    /n[uú]mero\s*l[oó]gico\s*[:\-]\s*([\w\-\/.]+)/i,
  ]);
  if (!result.numero_os) {
    const m = text.match(/\b\d{5,15}\b/);
    if (m) result.numero_os = m[0];
  }

  result.nome_cliente = firstMatch(text, [
    /^\s*cliente\s*[:\-]\s*(.+)$/im,
    /nome\s*fantasia\s*[:\-]\s*(.+)/i,
    /raz[aã]o\s*social\s*[:\-]\s*(.+)/i,
  ]);

  const enderecoBase = firstMatch(text, [/endere[cç]o\s*[:\-]\s*(.+)/i]);
  const bairro = firstMatch(text, [/bairro\s*[:\-]\s*(.+)/i]);
  const cidade = firstMatch(text, [/cidade\s*(?:\s*\/\s*uf)?\s*[:\-]\s*(.+)/i]);
  const cep = firstMatch(text, [/\bcep\s*[:\-]?\s*(\d{5}[\-.]?\d{3})\b/i]);
  result.endereco = [enderecoBase, bairro, cidade, cep].filter(Boolean).join(", ");

  // Nos formulários muitas vezes vários campos ficam na mesma linha (colunas lado a lado),
  // então a captura do serviço para no próximo rótulo conhecido, não só na quebra de linha.
  const labelWords = "N[UÚ]MERO|N[°ºO]\\.?\\s*OS|DATA|CEP|CIDADE|BAIRRO|CONTATO|CELULAR|RAZ[AÃ]O|NOME|ENDERE[CÇ]O|REFER[EÊ]NCIA|TIPO|RAMO|PRAZO|VALOR|C[OÓ]D|DOC";
  const nextLabel = `(?=\\s{2,}|\\s+(?:${labelWords})\\b|$)`;
  result.servico = firstMatch(text, [
    new RegExp("tipo\\s*(?:de\\s*)?servi[cç]o\\s*[:\\-]\\s*(.+?)" + nextLabel, "im"),
    new RegExp("\\bservi[cç]o\\s*[:\\-]\\s*(.+?)" + nextLabel, "im"),
  ]);

  result.banco = firstMatch(text, [/\bbanco\s*[:\-]\s*(.+)/i]);
  if (!result.banco) {
    for (const [re, label] of BRAND_PATTERNS) {
      if (re.test(text)) { result.banco = label; break; }
    }
  }

  // Telefone: prioriza campo "Celular:" isolado, depois procura um número dentro da linha
  // "Contato:" (que às vezes traz "Nome - telefone" tudo junto), depois rótulos genéricos.
  // Não tenta adivinhar telefone solto no resto do texto — arriscaria pegar número de
  // série/maquineta por engano; melhor deixar em branco do que errado.
  const phonePattern = /\(?0?\d{2}\)?[\s.\-]?9?\d{4}[\s.\-]?\d{4}/;
  const contatoRaw = firstMatch(text, [
    new RegExp("celular\\s*[:\\-]\\s*(" + phonePattern.source + ")", "i"),
    new RegExp("contato\\s*[:\\-].*?(" + phonePattern.source + ")", "i"),
    new RegExp("(?:telefone|tel\\.?|whats\\s*app|whatsapp|fone)\\s*[:\\-]\\s*(" + phonePattern.source + ")", "i"),
  ]);
  result.contato = onlyDigits(contatoRaw);

  return result;
}
