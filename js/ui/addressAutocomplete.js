// Sugestões de endereço ao vivo (tipo Google Maps) num campo de texto/textarea: espera o usuário
// parar de digitar, busca no Nominatim, mostra uma lista clicável embaixo do campo. Ao escolher uma
// opção, `onSelect({label, lat, lng})` recebe a coordenada EXATA daquela sugestão — quem chamou
// não precisa geocodificar de novo no envio do formulário. Se o usuário editar o texto depois de
// escolher, `onSelect(null)` avisa que a escolha não vale mais.
import { buscarSugestoesEndereco } from "../geocode.js?v=20";

const DEBOUNCE_MS = 450;
const MIN_CHARS = 3;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function criarAutocompleteEndereco(input, onSelect) {
  if (!input) return;

  const wrap = document.createElement("div");
  wrap.className = "address-input-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const lista = document.createElement("div");
  lista.className = "address-suggestions hidden";
  wrap.appendChild(lista);

  let timer = null;
  let sequencia = 0;
  let sugestoesAtuais = [];
  let indiceAtivo = -1;

  function esconder() {
    lista.classList.add("hidden");
    lista.innerHTML = "";
    sugestoesAtuais = [];
    indiceAtivo = -1;
  }

  function marcarAtivo() {
    lista.querySelectorAll(".address-suggestion-item").forEach((el, i) => el.classList.toggle("active", i === indiceAtivo));
  }

  function escolher(idx) {
    const s = sugestoesAtuais[idx];
    if (!s) return;
    input.value = s.label;
    esconder();
    onSelect(s);
  }

  function renderizar(sugestoes) {
    sugestoesAtuais = sugestoes;
    indiceAtivo = -1;
    if (!sugestoes.length) { esconder(); return; }
    lista.innerHTML = sugestoes.map((s, i) => `<div class="address-suggestion-item" data-idx="${i}">${escapeHtml(s.label)}</div>`).join("");
    lista.classList.remove("hidden");
    // pointerdown (não click) + preventDefault: mantém o foco no campo, então nem dispara o blur
    // que ia esconder a lista antes do clique "colar" — mesmo truque já usado no fluxo de OCR.
    lista.querySelectorAll(".address-suggestion-item").forEach((el) => {
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); escolher(Number(el.dataset.idx)); });
    });
  }

  input.addEventListener("input", () => {
    onSelect(null); // qualquer edição manual invalida a escolha anterior
    clearTimeout(timer);
    const valor = input.value.trim();
    if (valor.length < MIN_CHARS) { esconder(); return; }
    const minhaVez = ++sequencia;
    timer = setTimeout(async () => {
      const sugestoes = await buscarSugestoesEndereco(valor);
      if (minhaVez !== sequencia) return; // resposta de uma busca já ultrapassada por digitação nova
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
