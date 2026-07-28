// Detecta colunas dentro de um conjunto de linhas — usado em formulários tabulares (ex: os
// formulários Sicredi, que têm cabeçalho "TIPO DE SERVIÇO | NÚMERO DA OS | DATA | SLA | ...").
// Olha onde as palavras começam em X ao longo de várias linhas e agrupa em "colunas" quando várias
// linhas têm palavras começando perto do mesmo X — sem isso, o texto de colunas diferentes vira
// uma sopa de palavras fora de ordem quando lido linha a linha.
export function detectarColunas(linhas, imgWidth) {
  const inicios = [];
  linhas.forEach((l) => l.palavras.forEach((p) => inicios.push(p.bbox.x0)));
  if (inicios.length < 4) return [];

  inicios.sort((a, b) => a - b);
  const limiar = imgWidth * 0.02; // início de palavra a menos de 2% da largura = mesma coluna
  const grupos = [];
  let atual = [inicios[0]];
  for (let i = 1; i < inicios.length; i++) {
    if (inicios[i] - atual[atual.length - 1] <= limiar) {
      atual.push(inicios[i]);
    } else {
      grupos.push(atual);
      atual = [inicios[i]];
    }
  }
  grupos.push(atual);

  // Só conta como "coluna" de verdade um grupo que se repete em várias linhas — um grupo de uma
  // linha só é ruído (não é estrutura de tabela, é só onde aquela linha específica começou).
  return grupos
    .filter((g) => g.length >= Math.max(2, linhas.length * 0.3))
    .map((g) => g.reduce((a, b) => a + b, 0) / g.length)
    .sort((a, b) => a - b);
}

// Dada as colunas detectadas, separa as palavras de uma linha em "células" por coluna — útil pra
// reconstruir uma tabela como grade em vez de uma sequência de palavras solta.
export function separarEmCelulas(linha, colunas) {
  if (!colunas.length) return [linha.texto];
  const celulas = colunas.map(() => []);
  linha.palavras.forEach((p) => {
    let indiceCelula = 0;
    for (let i = 1; i < colunas.length; i++) {
      if (p.bbox.x0 >= colunas[i] - (colunas[i] - colunas[i - 1]) / 2) indiceCelula = i;
    }
    celulas[indiceCelula].push(p.texto);
  });
  return celulas.map((c) => c.join(" "));
}
