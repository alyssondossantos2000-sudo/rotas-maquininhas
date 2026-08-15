// Sugestões de endereço ao vivo (tipo Google Maps) num campo de texto/textarea: espera o usuário
// parar de digitar, busca no Nominatim, mostra uma lista clicável embaixo do campo. Ao escolher uma
// opção, `onSelect({label, lat, lng})` recebe a coordenada EXATA daquela sugestão — quem chamou
// não precisa geocodificar de novo no envio do formulário.
//
// O campo recebe só a RUA (`s.label`), sem o bairro junto — o bairro aparece na lista só como
// contexto pra ajudar a reconhecer a opção certa, mas não é escrito no campo. Assim, completar com
// o número da casa é só continuar digitando no final ("Rua Felipe de Brum" + " 310"), sem precisar
// inserir nada no meio do texto. Bug real reportado: com rua+bairro juntos no campo ("Rua Felipe de
// Brum, Granja"), o número tinha que entrar ENTRE os dois, não no final.
//
// Depois de escolher, o usuário ainda pode COMPLETAR o texto sem perder a coordenada escolhida — a
// rua já é uma base boa o bastante (endereço de casa exato raramente tá mapeado em cidade pequena,
// mas a rua certa sim). A escolha só é invalidada (`onSelect(null)`) se o texto deixar de começar
// com o rótulo escolhido — ou seja, se a parte escolhida for apagada/alterada, não só complementada.
import { buscarSugestoesEndereco } from "../geocode.js?v=28";

// `buscarFn` é injetável (ao invés de sempre importar direto) pra esse mesmo componente também
// servir o campo de "cidade base" da tela Perfil, que usa uma busca sem restrição de área
// (buscarSugestoesCidade) em vez da busca de endereço de parada (restrita à região configurada).

// O mais curto que dá sem virar barulho: o gargalo real de velocidade é o limite de taxa do
// LocationIQ (ver filaSugestoes em geocode.js), não esse debounce — baixar mais isso só manda mais
// requisição descartada enquanto a pessoa ainda tá digitando.
const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// `botaoBuscar` (opcional): botão de lupa já presente no HTML ao lado do campo — só pra buscar e
// mostrar no mapa na hora, sem precisar escolher da lista (ex: usuário quer conferir um endereço
// que já digitou por completo). Movido pra dentro do wrap pra ficar visualmente colado no campo.
export function criarAutocompleteEndereco(input, onSelect, buscarFn = buscarSugestoesEndereco, botaoBuscar = null) {
  if (!input) return;

  const wrap = document.createElement("div");
  wrap.className = "address-input-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  if (botaoBuscar) wrap.appendChild(botaoBuscar);

  const lista = document.createElement("div");
  lista.className = "address-suggestions hidden";
  wrap.appendChild(lista);

  let timer = null;
  let sequencia = 0;
  let sugestoesAtuais = [];
  let indiceAtivo = -1;
  let labelEscolhido = null; // texto exato da última sugestão escolhida, pra saber se ainda é só complemento

  function esconder() {
    lista.classList.add("hidden");
    lista.innerHTML = "";
    sugestoesAtuais = [];
    indiceAtivo = -1;
  }

  function mostrarCarregando() {
    lista.innerHTML = `<div class="address-suggestion-loading">Buscando...</div>`;
    lista.classList.remove("hidden");
  }

  function marcarAtivo() {
    lista.querySelectorAll(".address-suggestion-item").forEach((el, i) => el.classList.toggle("active", i === indiceAtivo));
  }

  function escolher(idx) {
    const s = sugestoesAtuais[idx];
    if (!s) return;
    input.value = s.label;
    labelEscolhido = s.label;
    esconder();
    onSelect(s);
  }

  function renderizar(sugestoes) {
    sugestoesAtuais = sugestoes;
    indiceAtivo = -1;
    if (!sugestoes.length) { esconder(); return; }
    lista.innerHTML = sugestoes.map((s, i) => {
      // Resultados já vêm ordenados por distância (mais perto primeiro, ver geocode.js) — mostrar
      // a distância só quando notavelmente longe (>15km) ajuda a entender que aquilo é "arredor",
      // não a cidade base, sem poluir a lista quando tudo já é bem pertinho.
      const longe = s.distanciaKm != null && s.distanciaKm > 15;
      const extra = [s.contexto, longe ? `${Math.round(s.distanciaKm)}km` : null].filter(Boolean).join(" — ");
      return `
      <div class="address-suggestion-item" data-idx="${i}">
        ${escapeHtml(s.label)}${extra ? `<span class="address-suggestion-contexto"> — ${escapeHtml(extra)}</span>` : ""}
      </div>`;
    }).join("");
    lista.classList.remove("hidden");
    // pointerdown (não click) + preventDefault: mantém o foco no campo, então nem dispara o blur
    // que ia esconder a lista antes do clique "colar" — mesmo truque já usado no fluxo de OCR.
    lista.querySelectorAll(".address-suggestion-item").forEach((el) => {
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); escolher(Number(el.dataset.idx)); });
    });
  }

  input.addEventListener("input", () => {
    const valor = input.value.trim();
    const aindaComplementando = labelEscolhido && valor.startsWith(labelEscolhido);
    if (!aindaComplementando) {
      labelEscolhido = null;
      onSelect(null); // deixou de ser só complemento — a coordenada escolhida antes não vale mais
    }
    clearTimeout(timer);
    if (valor.length < MIN_CHARS) { esconder(); return; }
    if (!aindaComplementando) mostrarCarregando(); // feedback imediato — a busca em si ainda leva um instante (ver geocode.js)
    const minhaVez = ++sequencia;
    timer = setTimeout(async () => {
      const sugestoes = await buscarFn(valor);
      if (minhaVez !== sequencia) return; // resposta de uma busca já ultrapassada por digitação nova
      // Complementando um endereço já escolhido (ex: acrescentando o número da casa): se a busca
      // não achar nada mais específico, mantém a lista fechada em vez de forçar um dropdown vazio
      // por cima da coordenada que já está boa.
      if (aindaComplementando && !sugestoes.length) { esconder(); return; }
      renderizar(sugestoes);
    }, DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (lista.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); indiceAtivo = (indiceAtivo + 1) % sugestoesAtuais.length; marcarAtivo(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); indiceAtivo = (indiceAtivo - 1 + sugestoesAtuais.length) % sugestoesAtuais.length; marcarAtivo(); }
    else if (e.key === "Enter" && indiceAtivo >= 0) { e.preventDefault(); escolher(indiceAtivo); }
    else if (e.key === "Escape") { esconder(); }
  });

  input.addEventListener("blur", () => esconder());
}
