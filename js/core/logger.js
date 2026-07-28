// Logger estruturado — usado no lugar de console.error solto em toda a árvore de módulos de
// leitura de documento. Nunca deixa uma exceção "vazar" sem contexto: toda falha aqui carrega uma
// mensagem em português pro usuário, a causa técnica, o stack (pra debug) e uma sugestão do que
// fazer a seguir (tentar de novo, girar a foto, preencher manualmente, etc).

export class DocReaderError extends Error {
  constructor({ mensagem, causa, sugestao, origem }) {
    super(mensagem);
    this.name = "DocReaderError";
    this.mensagem = mensagem;
    this.causa = causa || null;
    this.sugestao = sugestao || null;
    this.origem = origem || null;
  }
}

// Envolve uma função async: qualquer erro que ela lançar vira um DocReaderError com contexto,
// já logado (console.error estruturado), pronto pra ser mostrado na UI sem mais tratamento.
export async function comLog(origem, fn, { mensagem, sugestao } = {}) {
  try {
    return await fn();
  } catch (err) {
    const erro = new DocReaderError({
      mensagem: mensagem || `Falha em ${origem}`,
      causa: err?.message || String(err),
      sugestao: sugestao || "Tente novamente ou preencha manualmente.",
      origem,
    });
    logErro(erro, err);
    throw erro;
  }
}

export function logErro(erro, original) {
  console.error(
    `[${erro.origem || "?"}] ${erro.mensagem}\n` +
      `  causa: ${erro.causa}\n` +
      `  sugestão: ${erro.sugestao}\n` +
      `  stack: ${(original?.stack || erro.stack || "").split("\n").slice(0, 4).join("\n")}`
  );
}
