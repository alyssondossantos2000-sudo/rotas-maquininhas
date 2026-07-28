// Harness de teste do pipeline de leitura de documento — roda contra as 28 fotos reais em
// fotos-teste/. É uma página HTML (não Node) de propósito: o pipeline depende de APIs só de
// navegador (Canvas, OpenCV.js/WASM, Tesseract no navegador) que não existem em Node sem shims
// pesados que fugiriam do ambiente real onde o app roda de verdade.
import { processarPipeline } from "../js/ui/capture.js?v=14";
import { interpretarDocumento, paraCamposDeOs } from "../js/interpret/documentInterpreter.js?v=14";

const FOTOS = [
  "20260727_215244.jpg", "20260727_215323.jpg", "20260727_215356.jpg", "20260727_215431.jpg",
  "20260727_215545.jpg", "20260727_215631.jpg", "20260727_215942.jpg", "20260727_221045.jpg",
  "20260727_221246.jpg", "20260727_221318.jpg", "20260727_221415.jpg", "20260727_221532.jpg",
  "20260727_222008.jpg", "20260727_222310.jpg", "20260727_222447.jpg", "20260727_223012.jpg",
  "20260727_223137.jpg", "20260727_223342.jpg", "20260727_223529.jpg", "20260727_223645.jpg",
  "20260727_224841.jpg", "20260727_235704.jpg", "20260727_235714.jpg", "20260727_235721.jpg",
  "20260727_235730.jpg", "20260727_235736.jpg", "20260727_235742.jpg", "20260727_235759.jpg",
];

// Piso mínimo pra considerar o teste "aprovado" (mesma métrica informal usada a sessão inteira:
// % de palavras reconhecidas que têm conteúdo real de letra, não ruído/garbage do OCR).
const PISO_PCT_MINIMO = 45;

function contarPalavrasBoas(blocos) {
  let total = 0, comLetras = 0;
  blocos.forEach((b) => b.linhas.forEach((l) => l.palavras.forEach((p) => {
    total++;
    if (/[a-zà-ÿ]{2,}/i.test(p.texto)) comLetras++;
  })));
  return { total, comLetras, pct: total ? Math.round((comLetras / total) * 100) : 0 };
}

async function testarFoto(nome) {
  const t0 = performance.now();
  const resp = await fetch("../fotos-teste/" + encodeURIComponent(nome));
  const blob = await resp.blob();
  const file = new File([blob], nome, { type: "image/jpeg" });

  const resultado = await processarPipeline(file, 0, () => {});
  const tempoS = +((performance.now() - t0) / 1000).toFixed(1);
  const { total, comLetras, pct } = contarPalavrasBoas(resultado.blocos);
  const interpretado = interpretarDocumento(resultado.blocos, "");
  const campos = paraCamposDeOs(interpretado);

  return {
    nome, ok: true, tempoS, total, comLetras, pct,
    usouPerspectiva: resultado.largura !== undefined,
    campos,
  };
}

function linhaTabela(r) {
  if (!r.ok) {
    return `<tr><td>${r.nome}</td><td class="fail">FALHOU</td><td colspan="8">${r.erro}</td></tr>`;
  }
  const classe = r.pct >= PISO_PCT_MINIMO ? "ok" : "fail";
  return `<tr>
    <td>${r.nome}</td><td class="${classe}">${r.pct >= PISO_PCT_MINIMO ? "OK" : "ABAIXO DO PISO"}</td>
    <td>${r.tempoS}</td><td>${r.total}</td><td class="${classe}">${r.pct}%</td>
    <td>${r.usouPerspectiva ? "sim" : "não"}</td>
    <td>${escapeHtml(r.campos.numero_os)}</td><td>${escapeHtml(r.campos.nome_cliente)}</td>
    <td>${escapeHtml(r.campos.banco)}</td><td>${escapeHtml(r.campos.contato)}</td>
  </tr>`;
}
function escapeHtml(s) { return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

document.getElementById("rodar").addEventListener("click", async () => {
  const tbody = document.querySelector("#tabela tbody");
  const resumo = document.getElementById("resumo");
  tbody.innerHTML = "";
  resumo.textContent = `Rodando 0/${FOTOS.length}...`;

  const resultados = [];
  for (let i = 0; i < FOTOS.length; i++) {
    resumo.textContent = `Rodando ${i + 1}/${FOTOS.length}...`;
    let r;
    try {
      r = await testarFoto(FOTOS[i]);
    } catch (err) {
      r = { nome: FOTOS[i], ok: false, erro: String(err?.message || err) };
    }
    resultados.push(r);
    tbody.insertAdjacentHTML("beforeend", linhaTabela(r));
  }

  const validos = resultados.filter((r) => r.ok);
  const falhas = resultados.filter((r) => !r.ok);
  const abaixoDoPiso = validos.filter((r) => r.pct < PISO_PCT_MINIMO);
  const mediaPct = validos.length ? Math.round(validos.reduce((s, r) => s + r.pct, 0) / validos.length) : 0;
  const mediaTempo = validos.length ? (validos.reduce((s, r) => s + r.tempoS, 0) / validos.length).toFixed(1) : 0;

  resumo.innerHTML = `
    ${FOTOS.length} fotos — ${validos.length} processadas sem erro, ${falhas.length} com exceção.<br>
    Média de qualidade: ${mediaPct}% · tempo médio: ${mediaTempo}s.<br>
    ${abaixoDoPiso.length === 0 && falhas.length === 0
      ? '<span class="ok">TODOS OS TESTES PASSARAM (piso mínimo ' + PISO_PCT_MINIMO + '%)</span>'
      : '<span class="fail">' + (falhas.length + abaixoDoPiso.length) + ' foto(s) abaixo do esperado</span>'}
  `;
  window.__resultadosTeste = resultados; // acessível via javascript_tool pra inspeção automatizada
});
