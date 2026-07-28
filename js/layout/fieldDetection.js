// Detectores de padrão reutilizáveis — acham entidades conhecidas dentro de um texto (CPF, CNPJ,
// telefone, data, valor, e-mail, CEP) independente do rótulo que vier antes delas. Usado por
// interpret/documentInterpreter.js.
export const PADRAO_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
export const PADRAO_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
export const PADRAO_TELEFONE = /\(?0?\d{2}\)?[\s.\-]?9?\d{4}[\s.\-]?\d{4}/;
export const PADRAO_DATA = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/;
export const PADRAO_VALOR = /\bR?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}\b/;
export const PADRAO_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
export const PADRAO_CEP = /\b\d{5}[\-.]?\d{3}\b/;
export const PADRAO_URL = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/i;

export function encontrarPrimeiro(texto, padrao) {
  const m = texto.match(padrao);
  return m ? m[0] : "";
}

export function encontrarTodos(texto, padrao) {
  const flags = padrao.flags.includes("g") ? padrao.flags : padrao.flags + "g";
  return [...texto.matchAll(new RegExp(padrao.source, flags))].map((m) => m[0]);
}

export function apenasDigitos(s) {
  return (s || "").replace(/\D/g, "");
}
