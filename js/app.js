import { supabase } from "./supabaseClient.js?v=24";
import { geocodeAddress, lerPerfilBusca, salvarPerfilBusca, buscarSugestoesCidade } from "./geocode.js?v=24";
import { optimizeTrip, routeInOrder } from "./osrm.js?v=24";
import { criarCapturaDocumento, prepararPipeline, recuperarFotoInterrompida } from "./ui/capture.js?v=24";
import { lerConfigServidorLocal, salvarConfigServidorLocal, criarLocalServerProvider } from "./ocr/localServerProvider.js?v=24";
import { criarAutocompleteEndereco } from "./ui/addressAutocomplete.js?v=24";

// ---------------------------------------------------------------- state
let currentUser = null;
let editingOsId = null;
let osCache = [];
let rotasCache = [];

let buildSelected = new Map(); // id -> os object (para montar rota)
let buildOrder = [];           // array de os objects na ordem otimizada/manual
let buildOrigin = null;        // {lat,lng,label} ou null
let buildResult = null;        // {distanceKm, durationMin, geometry}

let detailRota = null;
let detailStops = [];
let detailMap = null;

let osFormPin = null; // {lat,lng} quando o usuário ajusta manualmente no mapa
let osFormMap = null;

const STATUS_LABEL = {
  pendente: "Pendente",
  roteirizada: "Roteirizada",
  adiada: "Adiada",
  concluida: "Concluída",
  cancelada: "Cancelada",
  planejada: "Planejada",
  em_andamento: "Em andamento",
};

// ---------------------------------------------------------------- helpers
const $ = (id) => document.getElementById(id);

function toast(msg, ms = 2600) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(`view-${name}`).classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  localStorage.setItem("rm_last_view", name);

  const titles = {
    "os-list": "Ordens de Serviço",
    "os-form": editingOsId ? "Editar OS" : "Nova OS",
    "rotas-list": "Rotas",
    "rota-build": "Nova rota",
    "rota-detail": "Rota",
    "perfil": "Perfil",
  };
  $("header-title").textContent = titles[name] || "Rotas Maquininhas";

  if (name !== "rota-detail" && detailMap) { detailMap.remove(); detailMap = null; }
  if (name !== "os-form" && osFormMap) { osFormMap.remove(); osFormMap = null; }
  if (name !== "rota-detail") {
    $("floating-widget").classList.add("hidden");
    window.Capacitor?.Plugins?.BubbleOverlay?.hide().catch(() => {});
  }
}

// Restaura a última tela aberta ao entrar — importante porque o Android às vezes destrói e recria
// a Activity/WebView do zero enquanto o app de Câmera fica em primeiro plano (visto no log do
// Capacitor: "App restarted"), o que reseta toda a navegação em memória. Sem isso, "Tirar foto"
// jogava o usuário de volta pra lista de OS sem motivo aparente.
// O supabase-js dispara onAuthStateChange uma vez IMEDIATAMENTE ao assinar (com a sessão que já
// existia), então init() acaba chamando afterAuthChange()/restaurarUltimaTela() duas vezes seguidas
// no boot. Isso sempre foi inofensivo (showView/openOsForm são idempotentes) até a recuperação de
// foto interrompida entrar em cena: a 2ª chamada roda openOsForm(null) — que esconde
// foto-preview-wrap como parte do reset padrão — bem depois da 1ª chamada já ter mostrado a foto
// recuperada, escondendo ela nn de novo mesmo com tudo certo no DOM (achado inspecionando o DOM ao
// vivo: imagem carregada, overlay montado, só o wrapper com "hidden"). Só a 1ª chamada de verdade
// importa, então trava pra rodar uma vez só por carregamento de página.
let restauracaoFeita = false;
function restaurarUltimaTela() {
  if (restauracaoFeita) return;
  restauracaoFeita = true;
  const ultimaView = localStorage.getItem("rm_last_view");
  if (ultimaView === "os-form") {
    // Captura ANTES de abrir o form: openOsForm() já chama switchTab("manual") por dentro (reset
    // padrão do form), o que sobrescreveria esse valor salvo antes de conseguirmos ler.
    const ultimaTab = localStorage.getItem("rm_last_phototab");
    openOsForm(null);
    if (ultimaTab === "foto") {
      switchTab("foto");
      // Se a recriação aconteceu bem no meio de "Tirar foto", a foto já tá salva no celular —
      // recupera sozinho em vez de deixar o usuário achando que sumiu (ver capture.js).
      recuperarFotoInterrompida().then((blob) => {
        if (blob) capturaOsForm.processarFotoRecuperada(blob);
      });
    }
  } else if (ultimaView === "rotas-list") {
    showView("rotas-list");
    loadRotas();
  } else if (ultimaView === "rota-detail") {
    const ultimaRotaId = localStorage.getItem("rm_last_rota_id");
    if (ultimaRotaId) openRotaDetail(ultimaRotaId);
    else { showView("rotas-list"); loadRotas(); }
  } else {
    showView("os-list");
    loadOsList();
  }
}

function fmtKm(km) { return km == null ? "-" : `${km.toFixed(1)} km`; }
function fmtMin(min) { return min == null ? "-" : `${Math.round(min)} min`; }

// ---------------------------------------------------------------- auth
async function init() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session ? data.session.user : null;
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session ? session.user : null;
    afterAuthChange();
  });
  afterAuthChange();
}

function afterAuthChange() {
  if (currentUser) {
    $("view-login").classList.add("hidden");
    $("app-header").classList.remove("hidden");
    $("bottom-nav").classList.remove("hidden");
    restaurarUltimaTela();
  } else {
    $("app-header").classList.add("hidden");
    $("bottom-nav").classList.add("hidden");
    $("floating-widget").classList.add("hidden");
    $("floating-panel").classList.add("hidden");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $("view-login").classList.remove("hidden");
  }
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) $("login-error").textContent = traduzErro(error.message);
});

$("btn-signup").addEventListener("click", async () => {
  $("login-error").textContent = "";
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    $("login-error").textContent = "Preencha e-mail e senha para criar a conta.";
    return;
  }
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) $("login-error").textContent = traduzErro(error.message);
  else toast("Conta criada! Verifique seu e-mail se for pedido, ou já entre normalmente.");
});

$("btn-logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
});

function traduzErro(msg) {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/already registered/i.test(msg)) return "Este e-mail já tem conta. Faça login.";
  if (/password.*at least/i.test(msg)) return "Senha muito curta (mínimo 6 caracteres).";
  return msg;
}

// ---------------------------------------------------------------- bottom nav
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    if (view === "os-form") openOsForm(null);
    else if (view === "rotas-list") { showView("rotas-list"); loadRotas(); }
    else if (view === "perfil") abrirPerfil();
    else { showView("os-list"); loadOsList(); }
  });
});

// ---------------------------------------------------------------- perfil (região/raio de busca)
const CIDADE_BASE_PADRAO = "Ponta Porã, MS";
const RAIO_PADRAO_KM = 60; // cobre o município inteiro (Ponta Porã + Itamarati + Sanga Puitã), igual ao limite fixo de antes

let cidadeSelecionada = null; // {label, lat, lng} escolhido no autocomplete — null se só digitou sem escolher

criarAutocompleteEndereco($("perfil-cidade"), (s) => { cidadeSelecionada = s; }, buscarSugestoesCidade);

function abrirPerfil() {
  const perfil = lerPerfilBusca();
  $("perfil-cidade").value = perfil ? perfil.cidade : CIDADE_BASE_PADRAO;
  $("perfil-raio").value = perfil ? perfil.raioKm : RAIO_PADRAO_KM;
  $("perfil-status").textContent = perfil
    ? ""
    : `Ainda sem configuração própria — usando a região padrão (${CIDADE_BASE_PADRAO}, ${RAIO_PADRAO_KM}km).`;
  cidadeSelecionada = null;
  showView("perfil");
}

$("btn-perfil-salvar").addEventListener("click", async () => {
  const cidadeTexto = $("perfil-cidade").value.trim();
  const raioKm = Number($("perfil-raio").value);
  if (!cidadeTexto) { $("perfil-status").textContent = "Preencha a cidade/região."; return; }
  if (!raioKm || raioKm <= 0) { $("perfil-status").textContent = "Preencha um raio válido."; return; }

  const btn = $("btn-perfil-salvar");
  btn.disabled = true;

  // Se o usuário escolheu uma sugestão da lista já tem lat/lng exata — só faz uma busca extra se
  // ele digitou o nome da cidade e apertou Salvar direto, sem escolher nada na lista.
  let alvo = cidadeSelecionada;
  if (!alvo || alvo.label !== cidadeTexto) {
    $("perfil-status").textContent = "Localizando cidade...";
    const [primeira] = await buscarSugestoesCidade(cidadeTexto);
    alvo = primeira || null;
  }

  btn.disabled = false;
  if (!alvo) {
    $("perfil-status").textContent = "Não localizei essa cidade — tente escolher uma opção da lista de sugestões.";
    return;
  }

  salvarPerfilBusca({ cidade: cidadeTexto, lat: alvo.lat, lng: alvo.lng, raioKm });
  $("perfil-status").textContent = `Região salva: ${cidadeTexto}, raio de ${raioKm}km.`;
});

// ---------------------------------------------------------------- OS list
$("os-filter-status").addEventListener("change", loadOsList);
$("os-search").addEventListener("input", debounce(loadOsList, 250));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function loadOsList() {
  const status = $("os-filter-status").value;
  let query = supabase.from("ordens_servico").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) { toast("Erro ao carregar OS: " + error.message); return; }
  osCache = data || [];

  const search = $("os-search").value.trim().toLowerCase();
  const filtered = search
    ? osCache.filter((os) =>
        [os.numero_os, os.nome_cliente, os.endereco, os.banco].join(" ").toLowerCase().includes(search))
    : osCache;

  renderOsList(filtered);
}

function renderOsList(list) {
  const el = $("os-list");
  el.innerHTML = "";
  $("os-empty").classList.toggle("hidden", list.length > 0);
  for (const os of list) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-title">
        <span>${osLabel(os)}</span>
        <span class="badge badge-${os.status}">${STATUS_LABEL[os.status]}</span>
      </div>
      <div class="card-sub">📍 ${escapeHtml(os.endereco)}</div>
      ${os.geocode_status === "aproximado" ? `<div class="card-sub prazo-destaque">⚠️ Localização aproximada — confira o pino em "Editar" antes de ir</div>` : ""}
      ${os.geocode_status === "falhou" ? `<div class="card-sub prazo-destaque">⚠️ Endereço não localizado — ajuste em "Editar"</div>` : ""}
      <div class="card-sub">${os.banco ? "🏦 " + escapeHtml(os.banco) + " · " : ""}${os.servico ? escapeHtml(os.servico) : ""}</div>
      ${os.prazo_entrega ? `<div class="card-sub prazo-destaque">${prazoLabel(os)}</div>` : ""}
      <div class="card-actions">
        <button class="btn btn-secondary btn-edit">Editar</button>
        <button class="btn btn-ghost btn-del">Excluir</button>
      </div>`;
    card.querySelector(".btn-edit").addEventListener("click", () => openOsForm(os.id));
    card.querySelector(".btn-del").addEventListener("click", () => deleteOs(os.id));
    el.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Paradas cadastradas rápido (direto na aba Rotas) podem não ter número de OS.
// Cliente e número da OS agora são opcionais (só endereço é obrigatório) — sempre sobra pelo menos
// o endereço como identificação da parada.
function osLabel(os) {
  const cliente = os.nome_cliente || os.endereco;
  return os.numero_os ? `OS ${escapeHtml(os.numero_os)} — ${escapeHtml(cliente)}` : escapeHtml(cliente);
}

// "10:00:00" (formato time do Postgres) -> "10:00" pra mostrar. Campo opcional — null/vazio na
// maioria das OS.
function prazoLabel(os) {
  return os.prazo_entrega ? `⏰ até ${os.prazo_entrega.slice(0, 5)}` : "";
}

async function deleteOs(id) {
  if (!confirm("Excluir esta OS?")) return;
  const { error } = await supabase.from("ordens_servico").delete().eq("id", id);
  if (error) { toast("Erro ao excluir: " + error.message); return; }
  toast("OS excluída.");
  loadOsList();
}

// ---------------------------------------------------------------- OS form
function openOsForm(id) {
  editingOsId = id;
  $("form-os").reset();
  $("os-id").value = "";
  $("ocr-status").classList.add("hidden");
  $("foto-preview-wrap").classList.add("hidden");
  $("ocr-overlay").innerHTML = "";
  $("ocr-raw-wrap").classList.add("hidden");
  $("ocr-raw-text").classList.add("hidden");
  $("os-map-wrap").classList.add("hidden");
  $("os-map-status").textContent = "Arraste o marcador para ajustar o ponto certo.";
  if (osFormMap) { osFormMap.remove(); osFormMap = null; }
  osFormPin = null;
  switchTab("manual");

  if (id) {
    const os = osCache.find((o) => o.id === id);
    if (os) {
      $("os-id").value = os.id;
      $("os-numero").value = os.numero_os || "";
      $("os-cliente").value = os.nome_cliente || "";
      $("os-endereco").value = os.endereco || "";
      $("os-contato").value = os.contato || "";
      $("os-banco").value = os.banco || "";
      $("os-servico").value = os.servico || "";
      $("os-prazo").value = os.prazo_entrega ? os.prazo_entrega.slice(0, 5) : "";
      $("os-obs").value = os.observacoes || "";
      if (os.lat != null && os.lng != null) osFormPin = { lat: os.lat, lng: os.lng };
    }
  }
  showView("os-form");
}

// Sugestão escolhida na lista de autocomplete já vem com lat/lng exata da própria escolha do
// usuário — nada de chute ou fallback progressivo depois disso (ver geocode.js). Qualquer edição
// manual do texto invalida a escolha (onSelect(null)) e volta a exigir geocodificação no envio.
criarAutocompleteEndereco($("os-endereco"), (sugestao) => {
  osFormPin = sugestao ? { lat: sugestao.lat, lng: sugestao.lng } : null;
});

$("btn-ajustar-mapa").addEventListener("click", async () => {
  const wrap = $("os-map-wrap");
  const statusEl = $("os-map-status");
  const wasHidden = wrap.classList.contains("hidden");
  wrap.classList.remove("hidden");
  if (!wasHidden && osFormMap) { setTimeout(() => osFormMap.invalidateSize(), 50); return; }

  let start = osFormPin;
  let zoom = 15;
  if (!start) {
    const endereco = $("os-endereco").value.trim();
    if (endereco) {
      statusEl.textContent = "Localizando endereço...";
      const geo = await geocodeAddress(endereco);
      if (geo) {
        start = { lat: geo.lat, lng: geo.lng };
        statusEl.textContent = geo.aproximado
          ? "Localização aproximada — arraste o marcador para o ponto certo."
          : "Arraste o marcador se precisar ajustar.";
      }
    }
  }
  if (!start) {
    start = { lat: -14.235, lng: -51.9253 };
    zoom = 4;
    statusEl.textContent = "Não localizei o endereço — arraste o marcador até o ponto certo.";
  }

  if (osFormMap) { osFormMap.remove(); osFormMap = null; }
  osFormMap = L.map("os-map").setView([start.lat, start.lng], zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(osFormMap);
  const marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(osFormMap);
  marker.on("dragend", () => {
    const pos = marker.getLatLng();
    osFormPin = { lat: pos.lat, lng: pos.lng };
    statusEl.textContent = "Localização ajustada manualmente.";
  });
  setTimeout(() => osFormMap.invalidateSize(), 100);
});

$("btn-os-cancel").addEventListener("click", () => { showView("os-list"); loadOsList(); });

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("tab-foto").classList.toggle("hidden", tab !== "foto");
  localStorage.setItem("rm_last_phototab", tab);
  // Começa a preparar o pipeline de leitura (OCR + detecção de documento) assim que a aba "Por
  // foto" abre, antes da foto ser tirada — assim o tempo de download/inicialização fica escondido
  // enquanto o usuário fotografa.
  if (tab === "foto") prepararPipeline();
}

// Configuração do servidor OCR local do PC — só faz sentido dentro do app nativo (a checagem de
// disponibilidade em provider.js já ignora isso no site). Escondido no navegador comum pra não
// confundir com uma opção que ali não tem efeito nenhum.
const ocrLocalNativo = window.Capacitor?.isNativePlatform?.() === true;
const ocrLocalConfigEl = document.querySelector(".ocr-local-config");
if (ocrLocalConfigEl) ocrLocalConfigEl.classList.toggle("hidden", !ocrLocalNativo);

if (ocrLocalNativo) {
  const ipInput = $("ocr-local-ip");
  const portaInput = $("ocr-local-porta");
  const iaInput = $("ocr-local-ia");
  const statusEl = $("ocr-local-status");
  const retestarBtn = $("ocr-local-retestar");
  const configInicial = lerConfigServidorLocal();
  ipInput.value = configInicial.ip;
  portaInput.value = configInicial.porta;
  iaInput.checked = configInicial.ia;

  const localProviderTeste = criarLocalServerProvider();
  const testarDisponibilidade = async () => {
    const config = { ip: ipInput.value.trim(), porta: Number(portaInput.value) || 8877, ia: iaInput.checked };
    if (!config.ip) { statusEl.textContent = ""; return; }
    statusEl.textContent = "Verificando...";
    const ok = await localProviderTeste.disponivel(config);
    statusEl.textContent = ok ? "🟢 PC conectado" : "🔴 PC não encontrado nessa rede";
  };

  const salvarESet = () => {
    salvarConfigServidorLocal({ ip: ipInput.value.trim(), porta: Number(portaInput.value) || 8877, ia: iaInput.checked });
    testarDisponibilidade();
  };
  ipInput.addEventListener("change", salvarESet);
  portaInput.addEventListener("change", salvarESet);
  iaInput.addEventListener("change", salvarESet);
  // Botão manual: pro caso comum de ligar o servidor no PC DEPOIS de já ter aberto o app no
  // celular — sem isso só reconectava editando o IP de novo ou reabrindo o app inteiro.
  retestarBtn.addEventListener("click", testarDisponibilidade);
  if (configInicial.ip) testarDisponibilidade();
}

let ultimaOrigemCadastro = "manual";

const capturaOsForm = criarCapturaDocumento({
  fileInputs: [$("foto-input-camera"), $("foto-input-galeria")],
  cameraInput: $("foto-input-camera"),
  previewWrap: $("foto-preview-wrap"),
  previewImg: $("foto-preview"),
  overlay: $("ocr-overlay"),
  statusEl: $("ocr-status"),
  rawWrap: $("ocr-raw-wrap"),
  rawText: $("ocr-raw-text"),
  opacitySlider: $("ocr-opacity"),
  zoomSlider: $("foto-zoom"),
  girarBtn: $("foto-girar"),
  tipoSelect: $("foto-tipo"),
  resolveField: (name) => $(name),
  avisar: toast,
  autoFill: (fields) => {
    ultimaOrigemCadastro = "foto";
    if (fields.numero_os) $("os-numero").value = fields.numero_os;
    if (fields.nome_cliente) $("os-cliente").value = fields.nome_cliente;
    if (fields.endereco) $("os-endereco").value = fields.endereco;
    if (fields.contato) $("os-contato").value = fields.contato;
    if (fields.banco) $("os-banco").value = fields.banco;
    if (fields.servico) $("os-servico").value = fields.servico;
    // Horário limite fica de fora do preenchimento automático de propósito — usuário prefere
    // digitar esse sempre na mão.
    if (fields.observacoes) $("os-obs").value = fields.observacoes;
  },
});

function autoFillParadaRapida(form, fields) {
  origemPorFormulario.set(form, "foto");
  if (fields.nome_cliente) form.elements.cliente.value = fields.nome_cliente;
  if (fields.endereco) form.elements.endereco.value = fields.endereco;
  if (fields.contato) form.elements.contato.value = fields.contato;
  if (fields.banco) form.elements.maquina.value = fields.banco;
  if (fields.servico) form.elements.servico.value = fields.servico;
  if (fields.observacoes) form.elements.obs.value = fields.observacoes;
}

criarCapturaDocumento({
  fileInputs: [$("qp-foto-input-camera"), $("qp-foto-input-galeria")],
  cameraInput: $("qp-foto-input-camera"),
  previewWrap: $("qp-foto-preview-wrap"),
  previewImg: $("qp-foto-preview"),
  overlay: $("qp-ocr-overlay"),
  statusEl: $("qp-ocr-status"),
  rawWrap: $("qp-ocr-raw-wrap"),
  rawText: $("qp-ocr-raw-text"),
  opacitySlider: $("qp-ocr-opacity"),
  zoomSlider: $("qp-foto-zoom"),
  girarBtn: $("qp-foto-girar"),
  tipoSelect: $("qp-foto-tipo"),
  resolveField: (name) => $("form-parada-rapida").elements[name],
  avisar: toast,
  autoFill: (fields) => autoFillParadaRapida($("form-parada-rapida"), fields),
});

criarCapturaDocumento({
  fileInputs: [$("qpd-foto-input-camera"), $("qpd-foto-input-galeria")],
  cameraInput: $("qpd-foto-input-camera"),
  previewWrap: $("qpd-foto-preview-wrap"),
  previewImg: $("qpd-foto-preview"),
  overlay: $("qpd-ocr-overlay"),
  statusEl: $("qpd-ocr-status"),
  rawWrap: $("qpd-ocr-raw-wrap"),
  rawText: $("qpd-ocr-raw-text"),
  opacitySlider: $("qpd-ocr-opacity"),
  zoomSlider: $("qpd-foto-zoom"),
  girarBtn: $("qpd-foto-girar"),
  tipoSelect: $("qpd-foto-tipo"),
  resolveField: (name) => $("form-parada-rapida-detalhe").elements[name],
  avisar: toast,
  autoFill: (fields) => autoFillParadaRapida($("form-parada-rapida-detalhe"), fields),
});

$("form-os").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("os-form-error").textContent = "";

  const payload = {
    numero_os: $("os-numero").value.trim() || null,
    nome_cliente: $("os-cliente").value.trim() || null,
    endereco: $("os-endereco").value.trim(),
    contato: $("os-contato").value.trim(),
    banco: $("os-banco").value.trim(),
    servico: $("os-servico").value.trim(),
    prazo_entrega: $("os-prazo").value || null,
    observacoes: $("os-obs").value.trim(),
  };
  if (!payload.endereco) {
    $("os-form-error").textContent = "Preencha o endereço.";
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  if (osFormPin) {
    payload.lat = osFormPin.lat;
    payload.lng = osFormPin.lng;
    payload.geocode_status = "ok";
  } else {
    submitBtn.textContent = "Localizando endereço...";
    const geo = await geocodeAddress(payload.endereco);
    payload.lat = geo ? geo.lat : null;
    payload.lng = geo ? geo.lng : null;
    payload.geocode_status = geo ? (geo.aproximado ? "aproximado" : "ok") : "falhou";
  }

  submitBtn.textContent = "Salvando...";

  let error;
  if (editingOsId) {
    ({ error } = await supabase.from("ordens_servico").update(payload).eq("id", editingOsId));
  } else {
    payload.origem_cadastro = ultimaOrigemCadastro;
    ({ error } = await supabase.from("ordens_servico").insert(payload));
  }

  submitBtn.disabled = false;
  submitBtn.textContent = "Salvar OS";

  if (error) { $("os-form-error").textContent = "Erro ao salvar: " + error.message; return; }

  ultimaOrigemCadastro = "manual";
  toast(payload.lat != null ? "OS salva e localizada no mapa." : "OS salva, mas não localizei o endereço no mapa — toque em \"Ver/ajustar no mapa\" para marcar manualmente.");
  showView("os-list");
  loadOsList();
});

// ---------------------------------------------------------------- Rotas list
$("btn-nova-rota").addEventListener("click", () => openRotaBuild());

async function loadRotas() {
  const { data, error } = await supabase.from("rotas").select("*").order("data", { ascending: false }).order("created_at", { ascending: false });
  if (error) { toast("Erro ao carregar rotas: " + error.message); return; }
  rotasCache = data || [];
  renderRotasList();
}

function renderRotasList() {
  const el = $("rotas-list");
  el.innerHTML = "";
  $("rotas-empty").classList.toggle("hidden", rotasCache.length > 0);
  for (const r of rotasCache) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-title">
        <span>${escapeHtml(r.nome)}</span>
        <span class="badge badge-${r.status}">${STATUS_LABEL[r.status]}</span>
      </div>
      <div class="card-sub">📅 ${formatDate(r.data)} · 🛣️ ${fmtKm(r.distancia_km)} · ⏱️ ${fmtMin(r.duracao_min)}</div>
      <div class="card-actions"><button class="btn btn-secondary btn-abrir">Abrir</button></div>`;
    card.querySelector(".btn-abrir").addEventListener("click", () => openRotaDetail(r.id));
    el.appendChild(card);
  }
}

function formatDate(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------- Rota build
function addOsSelectRow(os, { checked = false } = {}) {
  $("rota-os-select-empty")?.remove();
  const row = document.createElement("label");
  row.className = "os-select-row";
  row.innerHTML = `
    <input type="checkbox" data-id="${os.id}" ${checked ? "checked" : ""}>
    <div class="info"><b>${osLabel(os)}</b><span>${escapeHtml(os.endereco)}</span></div>`;
  row.querySelector("input").addEventListener("change", (e) => {
    if (e.target.checked) buildSelected.set(os.id, os);
    else buildSelected.delete(os.id);
  });
  $("rota-os-select").appendChild(row);
  if (checked) buildSelected.set(os.id, os);
}

async function openRotaBuild() {
  buildSelected = new Map();
  buildOrder = [];
  buildOrigin = null;
  buildResult = null;
  $("rota-nome").value = "";
  $("rota-data").value = new Date().toISOString().slice(0, 10);
  $("rota-origem").value = "";
  $("rota-build-status").textContent = "";
  $("form-parada-rapida").reset();
  $("form-parada-rapida").querySelector(".qp-status").textContent = "";
  $("parada-rapida-build-wrap").classList.add("hidden");
  $("qp-foto-preview-wrap").classList.add("hidden");
  $("qp-ocr-overlay").innerHTML = "";
  $("qp-ocr-raw-wrap").classList.add("hidden");
  $("qp-ocr-raw-text").classList.add("hidden");
  $("qp-ocr-status").classList.add("hidden");

  const { data, error } = await supabase.from("ordens_servico").select("*").eq("status", "pendente").order("created_at", { ascending: false });
  if (error) { toast("Erro ao carregar OS pendentes: " + error.message); return; }

  const wrap = $("rota-os-select");
  wrap.innerHTML = "";
  if (!data.length) wrap.innerHTML = `<p id="rota-os-select-empty" class="empty">Nenhuma OS pendente para roteirizar.</p>`;
  for (const os of data) addOsSelectRow(os);
  showView("rota-build");
}

// Formulário de "parada rápida": cria uma OS com só cliente + endereço obrigatórios (o resto é
// opcional), usado tanto ao montar uma rota nova quanto para acrescentar parada numa rota já
// salva. `onAdded(osInserida)` decide o que fazer com a parada criada em cada tela. Se os campos
// foram preenchidos por foto (marcado pelo autoFill correspondente), registra a origem certa.
const origemPorFormulario = new WeakMap();

function wireQuickAddForm(form, onAdded) {
  const statusEl = form.querySelector(".qp-status");

  // Sugestão escolhida no autocomplete já traz lat/lng exata — só cai pro geocodeAddress
  // (fallback progressivo, ver geocode.js) se o usuário digitou o endereço sem escolher nenhuma.
  let pinSelecionado = null;
  criarAutocompleteEndereco(form.elements.endereco, (sugestao) => {
    pinSelecionado = sugestao ? { lat: sugestao.lat, lng: sugestao.lng } : null;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome_cliente = form.elements.cliente.value.trim();
    const endereco = form.elements.endereco.value.trim();
    if (!endereco) {
      statusEl.textContent = "Preencha o endereço.";
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;

    let geo;
    if (pinSelecionado) {
      geo = { ...pinSelecionado, aproximado: false };
    } else {
      statusEl.textContent = "Localizando endereço...";
      geo = await geocodeAddress(endereco);
    }
    const payload = {
      nome_cliente: nome_cliente || null,
      endereco,
      servico: form.elements.servico.value.trim(),
      banco: form.elements.maquina.value.trim(),
      contato: form.elements.contato.value.trim(),
      prazo_entrega: form.elements.prazo.value || null,
      observacoes: form.elements.obs.value.trim(),
      status: "pendente",
      origem_cadastro: origemPorFormulario.get(form) || "manual",
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      geocode_status: geo ? (geo.aproximado ? "aproximado" : "ok") : "falhou",
    };

    const { data: inserted, error } = await supabase.from("ordens_servico").insert(payload).select().single();
    btn.disabled = false;
    if (error) { statusEl.textContent = "Erro ao adicionar: " + error.message; return; }

    pinSelecionado = null;
    form.reset();
    origemPorFormulario.set(form, "manual");
    statusEl.textContent = !geo
      ? "Parada adicionada, mas não localizei o endereço — ajuste depois em \"OS\" > Editar."
      : geo.aproximado
      ? "Parada adicionada, mas o endereço é aproximado — confira o pino em \"OS\" > Editar antes de ir."
      : "Parada adicionada!";
    await onAdded(inserted);
  });
}

wireQuickAddForm($("form-parada-rapida"), async (inserted) => {
  addOsSelectRow(inserted, { checked: true });
});

$("btn-toggle-parada-rapida-build").addEventListener("click", () => {
  $("parada-rapida-build-wrap").classList.toggle("hidden");
  prepararPipeline();
});

$("btn-toggle-parada-rapida").addEventListener("click", () => {
  $("parada-rapida-detalhe-wrap").classList.toggle("hidden");
  prepararPipeline();
});

wireQuickAddForm($("form-parada-rapida-detalhe"), async (inserted) => {
  const ordem = detailStops.length + 1;
  await supabase.from("ordens_servico").update({ rota_id: detailRota.id, ordem_na_rota: ordem, status: "roteirizada" }).eq("id", inserted.id);
  inserted.rota_id = detailRota.id;
  inserted.ordem_na_rota = ordem;
  inserted.status = "roteirizada";
  detailStops.push(inserted);
  renderRotaDetail();
  toast("Parada adicionada à rota!");
});

$("rota-origem").addEventListener("input", () => { buildOrigin = null; });

$("btn-usar-gps").addEventListener("click", () => {
  if (!navigator.geolocation) { toast("GPS não disponível neste navegador."); return; }
  $("rota-origem").value = "Obtendo localização...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      buildOrigin = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Localização atual (GPS)" };
      $("rota-origem").value = "📍 Localização atual (GPS)";
    },
    () => { toast("Não consegui obter sua localização."); $("rota-origem").value = ""; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// Paradas com "horário limite" (prazo_entrega) preenchido entram PRIMEIRO na rota, em ordem de
// horário (a mais cedo primeiro) — o resto das paradas (sem prazo) é otimizado livremente por trás
// delas. Se ninguém tiver prazo, se comporta exatamente como antes (só otimização por distância).
// A ordem entre as paradas COM prazo é fixada pelo próprio horário (cumprir o prazo importa mais
// que economizar uns minutos de trajeto entre elas); só o trecho sem prazo é livre pro OSRM
// escolher a sequência mais eficiente.
async function otimizarComPrioridadeDePrazo(stops, origin) {
  const comPrazo = [...stops.filter((s) => s.prazo_entrega)].sort((a, b) => a.prazo_entrega.localeCompare(b.prazo_entrega));
  const semPrazo = stops.filter((s) => !s.prazo_entrega);

  if (!comPrazo.length) {
    const result = await optimizeTrip(stops, origin);
    return { order: result.order.map((i) => stops[i]), distanceKm: result.distanceKm, durationMin: result.durationMin, geometry: result.geometry };
  }

  let restoOrdenado = semPrazo;
  if (semPrazo.length >= 2) {
    const origemResto = { lat: comPrazo[comPrazo.length - 1].lat, lng: comPrazo[comPrazo.length - 1].lng };
    const resultResto = await optimizeTrip(semPrazo, origemResto);
    restoOrdenado = resultResto.order.map((i) => semPrazo[i]);
  }

  const ordemFinal = [...comPrazo, ...restoOrdenado];
  const custo = ordemFinal.length >= 2
    ? await routeInOrder(ordemFinal, origin)
    : { distanceKm: 0, durationMin: 0, geometry: null };
  return { order: ordemFinal, distanceKm: custo.distanceKm, durationMin: custo.durationMin, geometry: custo.geometry };
}

$("btn-otimizar").addEventListener("click", async () => {
  const selected = [...buildSelected.values()];
  if (selected.length < 2) { toast("Selecione pelo menos 2 OS para montar a rota."); return; }

  const statusEl = $("rota-build-status");
  $("btn-otimizar").disabled = true;

  // geocodifica quem ainda não tem coordenadas
  for (const os of selected) {
    if (os.lat != null && os.lng != null) continue;
    statusEl.textContent = `Localizando endereço de OS ${os.numero_os}...`;
    const geo = await geocodeAddress(os.endereco);
    if (geo) {
      os.lat = geo.lat; os.lng = geo.lng;
      const geocode_status = geo.aproximado ? "aproximado" : "ok";
      os.geocode_status = geocode_status;
      await supabase.from("ordens_servico").update({ lat: geo.lat, lng: geo.lng, geocode_status }).eq("id", os.id);
    } else {
      await supabase.from("ordens_servico").update({ geocode_status: "falhou" }).eq("id", os.id);
    }
  }

  const comCoordenadas = selected.filter((os) => os.lat != null && os.lng != null);
  const semCoordenadas = selected.filter((os) => os.lat == null);
  if (semCoordenadas.length) {
    toast(`${semCoordenadas.length} endereço(s) não localizado(s) e ficaram de fora: ` + semCoordenadas.map((o) => o.numero_os).join(", "));
  }
  if (comCoordenadas.length < 2) {
    statusEl.textContent = "Endereços insuficientes para montar rota.";
    $("btn-otimizar").disabled = false;
    return;
  }

  let origin = null;
  const origemTexto = $("rota-origem").value.trim();
  if (buildOrigin) {
    origin = buildOrigin;
  } else if (origemTexto) {
    statusEl.textContent = "Localizando ponto de partida...";
    const geo = await geocodeAddress(origemTexto);
    if (geo) origin = { lat: geo.lat, lng: geo.lng, label: origemTexto };
    else toast("Não localizei o endereço de partida, otimizando sem ponto fixo.");
  }

  statusEl.textContent = "Calculando melhor rota...";
  try {
    const result = await otimizarComPrioridadeDePrazo(comCoordenadas, origin);
    buildOrder = result.order;
    buildResult = { distanceKm: result.distanceKm, durationMin: result.durationMin, geometry: result.geometry };
    buildOrigin = origin;

    // Salva a rota no banco assim que ela é calculada — antes até de mostrar a prévia.
    // Antes, a rota só existia na memória do navegador até o usuário clicar em "Salvar rota" no
    // final; se ele saísse do app antes disso (ex: pra mandar mensagem no WhatsApp de uma parada),
    // perdia tudo. Agora, uma vez otimizada, a rota já está salva e não some mais.
    statusEl.textContent = "Salvando rota...";
    const insertedId = await salvarRotaAtual();
    toast(`Rota otimizada e salva! ${fmtKm(result.distanceKm)} · ${fmtMin(result.durationMin)}`);
    openRotaDetail(insertedId);
  } catch (err) {
    statusEl.textContent = "Erro ao otimizar/salvar: " + err.message;
  }
  $("btn-otimizar").disabled = false;
});

function numberedIcon(label, color) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:white;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function mapsUrl(os) { return `https://www.google.com/maps/dir/?api=1&destination=${os.lat},${os.lng}&travelmode=driving`; }
function wazeUrl(os) { return `https://waze.com/ul?ll=${os.lat}%2C${os.lng}&navigate=yes`; }
function whatsUrl(os) {
  let digits = (os.contato || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length <= 11) digits = "55" + digits;
  return `https://wa.me/${digits}`;
}

function renderStopListEditable(container, order, onReorder, opts = {}) {
  container.innerHTML = "";
  order.forEach((os, idx) => {
    const li = document.createElement("li");
    li.className = "stop-item" + (os.status === "concluida" ? " done" : "") + (os.status === "adiada" ? " adiada" : "");
    li.innerHTML = `
      <div class="stop-num">${idx + 1}</div>
      <div class="stop-body">
        <b>${osLabel(os)} ${os.status === "adiada" ? '<span class="badge badge-adiada">Adiada</span>' : ""}</b>
        <span>📍 ${escapeHtml(os.endereco)}</span>
        ${os.geocode_status === "aproximado" ? `<span class="prazo-destaque">⚠️ Localização aproximada — confira o pino antes de seguir</span>` : ""}
        <span>${os.banco ? "🏦 " + escapeHtml(os.banco) + " " : ""}${os.servico ? "· " + escapeHtml(os.servico) : ""}</span>
        ${os.prazo_entrega ? `<span class="prazo-destaque">${prazoLabel(os)}</span>` : ""}
        <div class="stop-actions">
          <a class="btn btn-secondary" href="${mapsUrl(os)}" target="_blank" rel="noopener">🧭 Maps</a>
          <a class="btn btn-secondary" href="${wazeUrl(os)}" target="_blank" rel="noopener">🚗 Waze</a>
          ${whatsUrl(os) ? `<a class="btn btn-secondary" href="${whatsUrl(os)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
          ${opts.showDone ? `<button class="btn ${os.status === "concluida" ? "btn-secondary" : "btn-primary"} btn-done">${os.status === "concluida" ? "Reabrir" : "Concluir"}</button>` : ""}
          ${opts.showPostpone && os.status !== "concluida" ? `<button class="btn btn-secondary btn-postpone">${os.status === "adiada" ? "Retomar" : "Deixar p/ depois"}</button>` : ""}
          ${opts.showRemove ? `<button class="btn btn-ghost btn-remove">Remover da rota</button>` : ""}
        </div>
        ${opts.showNotes ? `
          <textarea class="stop-note" placeholder="Observação (opcional)...">${escapeHtml(os.observacoes || "")}</textarea>
          <div class="stop-note-saved"></div>` : ""}
      </div>
      <div class="stop-order-btns">
        <button class="btn-up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="btn-down" ${idx === order.length - 1 ? "disabled" : ""}>▼</button>
      </div>`;
    li.querySelector(".btn-up").addEventListener("click", () => {
      const newOrder = [...order];
      [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
      onReorder(newOrder);
    });
    li.querySelector(".btn-down").addEventListener("click", () => {
      const newOrder = [...order];
      [newOrder[idx + 1], newOrder[idx]] = [newOrder[idx], newOrder[idx + 1]];
      onReorder(newOrder);
    });
    if (opts.showDone) li.querySelector(".btn-done").addEventListener("click", () => opts.onToggleDone(os));
    if (opts.showPostpone && os.status !== "concluida") li.querySelector(".btn-postpone").addEventListener("click", () => opts.onPostpone(os));
    if (opts.showRemove) li.querySelector(".btn-remove").addEventListener("click", () => opts.onRemove(os));
    if (opts.showNotes) {
      const noteEl = li.querySelector(".stop-note");
      const savedEl = li.querySelector(".stop-note-saved");
      noteEl.addEventListener("blur", async () => {
        if (noteEl.value === (os.observacoes || "")) return;
        await opts.onSaveNote(os, noteEl.value.trim());
        savedEl.textContent = "Observação salva.";
        setTimeout(() => { savedEl.textContent = ""; }, 2000);
      });
    }
    container.appendChild(li);
  });
}

async function salvarRotaAtual() {
  const nome = $("rota-nome").value.trim() || "Rota sem nome";
  const data = $("rota-data").value || new Date().toISOString().slice(0, 10);

  const payload = {
    nome, data,
    status: "planejada",
    distancia_km: buildResult ? buildResult.distanceKm : null,
    duracao_min: buildResult ? buildResult.durationMin : null,
    geometria: buildResult ? buildResult.geometry : null,
    origem_endereco: buildOrigin ? (buildOrigin.label || null) : null,
    origem_lat: buildOrigin ? buildOrigin.lat : null,
    origem_lng: buildOrigin ? buildOrigin.lng : null,
  };
  const { data: inserted, error } = await supabase.from("rotas").insert(payload).select().single();
  if (error) throw new Error(error.message);

  for (let i = 0; i < buildOrder.length; i++) {
    await supabase.from("ordens_servico").update({ rota_id: inserted.id, ordem_na_rota: i + 1, status: "roteirizada" }).eq("id", buildOrder[i].id);
  }
  return inserted.id;
}

// Compartilhadas entre a lista de paradas editável e o painel do balão flutuante — mesma ação,
// dois lugares que podem disparar ela (usuário pode preferir abrir a rota inteira ou só apertar o
// balão flutuante pra resolver rápido a próxima parada sem rolar a tela toda).
async function alternarConcluido(os) {
  const novoStatus = os.status === "concluida" ? "roteirizada" : "concluida";
  await supabase.from("ordens_servico").update({ status: novoStatus }).eq("id", os.id);
  os.status = novoStatus;
  renderRotaDetail();
}

async function alternarAdiado(os) {
  if (os.status === "adiada") {
    os.status = "roteirizada";
    await supabase.from("ordens_servico").update({ status: "roteirizada" }).eq("id", os.id);
  } else {
    os.status = "adiada";
    detailStops = detailStops.filter((s) => s.id !== os.id);
    detailStops.push(os);
    await supabase.from("ordens_servico").update({ status: "adiada" }).eq("id", os.id);
    for (let i = 0; i < detailStops.length; i++) {
      await supabase.from("ordens_servico").update({ ordem_na_rota: i + 1 }).eq("id", detailStops[i].id);
    }
  }
  renderRotaDetail();
}

// Pede a permissão "Exibir sobre outros apps" (precisa pra bolha flutuante ficar visível por cima
// do Maps/Waze) só na primeira vez que uma rota é aberta na sessão — não repete o toast/prompt toda
// vez que o usuário reabre uma rota, mesmo que ele acabe negando a permissão.
let bolhaPermissaoPedida = false;
async function garantirPermissaoBolha() {
  const bubble = window.Capacitor?.Plugins?.BubbleOverlay;
  if (!bubble || bolhaPermissaoPedida) return;
  bolhaPermissaoPedida = true;
  try {
    const { granted } = await bubble.checkPermission();
    if (!granted) {
      toast('Libere "Exibir sobre outros apps" pra ver a bolha da rota por cima do Maps.');
      await bubble.requestPermission();
    }
  } catch { /* plugin ausente (site/versão antiga do APK) — ignora, segue sem bolha nativa */ }
}

// ---------------------------------------------------------------- Rota detail
async function openRotaDetail(id) {
  const { data: rota, error } = await supabase.from("rotas").select("*").eq("id", id).single();
  if (error) { toast("Erro ao abrir rota: " + error.message); return; }
  const { data: stops, error: err2 } = await supabase.from("ordens_servico").select("*").eq("rota_id", id).order("ordem_na_rota", { ascending: true });
  if (err2) { toast("Erro ao carregar paradas: " + err2.message); return; }

  garantirPermissaoBolha();
  detailRota = rota;
  detailStops = stops || [];
  $("parada-rapida-detalhe-wrap").classList.add("hidden");
  $("form-parada-rapida-detalhe").reset();
  $("qpd-foto-preview-wrap").classList.add("hidden");
  $("qpd-ocr-overlay").innerHTML = "";
  $("qpd-ocr-raw-wrap").classList.add("hidden");
  $("qpd-ocr-raw-text").classList.add("hidden");
  $("qpd-ocr-status").classList.add("hidden");
  renderRotaDetail();
  showView("rota-detail");
  // Guarda qual rota especificamente estava aberta — showView() já salva "rota-detail" como a
  // última tela, mas sozinho isso não basta pra restaurar: precisamos saber QUAL rota reabrir (ver
  // restaurarUltimaTela). Importante pro fluxo de tocar em Maps/Waze/WhatsApp a partir de uma
  // parada: o Android pode matar a página enquanto esses apps ficam em primeiro plano, e sem isso
  // o usuário voltava sempre pra lista de OS em vez de continuar na rota que estava vendo.
  localStorage.setItem("rm_last_rota_id", id);
}

function renderRotaDetail() {
  $("rota-detail-header").innerHTML = `
    <div class="card">
      <div class="card-title"><span>${escapeHtml(detailRota.nome)}</span><span class="badge badge-${detailRota.status}">${STATUS_LABEL[detailRota.status]}</span></div>
      <div class="card-sub">📅 ${formatDate(detailRota.data)} · 🛣️ ${fmtKm(detailRota.distancia_km)} · ⏱️ ${fmtMin(detailRota.duracao_min)}</div>
      <div class="card-actions">
        <button class="btn btn-secondary" id="btn-reotimizar">🔄 Reotimizar</button>
        <button class="btn btn-ghost" id="btn-excluir-rota">Excluir rota</button>
      </div>
    </div>`;
  $("btn-reotimizar").addEventListener("click", reotimizarRotaAtual);
  $("btn-excluir-rota").addEventListener("click", excluirRotaAtual);

  renderStopListEditable($("rota-detail-stops"), detailStops, async (newOrder) => {
    detailStops = newOrder;
    renderRotaDetail();
    for (let i = 0; i < detailStops.length; i++) {
      await supabase.from("ordens_servico").update({ ordem_na_rota: i + 1 }).eq("id", detailStops[i].id);
    }
  }, {
    showDone: true,
    showRemove: true,
    showPostpone: true,
    showNotes: true,
    onToggleDone: alternarConcluido,
    onPostpone: alternarAdiado,
    onRemove: async (os) => {
      if (!confirm("Remover esta OS da rota? Ela volta para pendente.")) return;
      await supabase.from("ordens_servico").update({ rota_id: null, ordem_na_rota: null, status: "pendente" }).eq("id", os.id);
      detailStops = detailStops.filter((s) => s.id !== os.id);
      renderRotaDetail();
    },
    onSaveNote: async (os, texto) => {
      await supabase.from("ordens_servico").update({ observacoes: texto }).eq("id", os.id);
      os.observacoes = texto;
    },
  });

  if (detailMap) { detailMap.remove(); detailMap = null; }
  const points = detailStops.filter((s) => s.lat != null).map((s) => [s.lat, s.lng]);
  if (points.length) {
    detailMap = L.map("rota-detail-map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(detailMap);
    if (detailRota.origem_lat) {
      L.marker([detailRota.origem_lat, detailRota.origem_lng], { icon: numberedIcon("P", "#3ecf8e") }).addTo(detailMap);
      points.unshift([detailRota.origem_lat, detailRota.origem_lng]);
    }
    detailStops.forEach((os, i) => {
      if (os.lat == null) return;
      L.marker([os.lat, os.lng], { icon: numberedIcon(i + 1, "#3d8bfd") }).addTo(detailMap).bindPopup(osLabel(os));
    });
    if (detailRota.geometria) {
      const latlngs = detailRota.geometria.coordinates.map((c) => [c[1], c[0]]);
      L.polyline(latlngs, { color: "#3d8bfd", weight: 4 }).addTo(detailMap);
    }
    detailMap.fitBounds(points, { padding: [30, 30] });
    setTimeout(() => detailMap && detailMap.invalidateSize(), 100);
  }

  updateFloatingWidget();
}

// ---------------------------------------------------------------- Balão flutuante (próxima parada)
function updateFloatingWidget() {
  const widget = $("floating-widget");
  const proxima = detailStops.find((s) => s.status === "roteirizada" || s.status === "adiada");

  if (!proxima) {
    widget.classList.add("hidden");
    window.Capacitor?.Plugins?.BubbleOverlay?.hide().catch(() => {});
    return;
  }
  widget.classList.remove("hidden");

  const idx = detailStops.indexOf(proxima);
  $("floating-bubble-num").textContent = idx + 1;
  sincronizarBolhaNativa(proxima, idx + 1);

  $("floating-panel-body").innerHTML = `
    <b>${osLabel(proxima)}</b>
    <div class="fp-line">📍 ${escapeHtml(proxima.endereco)}</div>
    ${proxima.geocode_status === "aproximado" ? `<div class="fp-line prazo-destaque">⚠️ Localização aproximada — confira o pino antes de seguir</div>` : ""}
    ${proxima.banco || proxima.servico ? `<div class="fp-line">${proxima.banco ? "🏦 " + escapeHtml(proxima.banco) + " " : ""}${proxima.servico ? "· " + escapeHtml(proxima.servico) : ""}</div>` : ""}
    ${proxima.prazo_entrega ? `<div class="fp-line prazo-destaque">${prazoLabel(proxima)}</div>` : ""}
    ${proxima.observacoes ? `<div class="fp-line">📝 ${escapeHtml(proxima.observacoes)}</div>` : ""}
    <div class="stop-actions">
      <a class="btn btn-secondary" href="${mapsUrl(proxima)}" target="_blank" rel="noopener">🧭 Maps</a>
      <a class="btn btn-secondary" href="${wazeUrl(proxima)}" target="_blank" rel="noopener">🚗 Waze</a>
      ${whatsUrl(proxima) ? `<a class="btn btn-secondary" href="${whatsUrl(proxima)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
      <button class="btn btn-secondary" id="floating-btn-postpone">${proxima.status === "adiada" ? "Retomar" : "Deixar p/ depois"}</button>
      <button class="btn btn-primary" id="floating-btn-concluir">✅ Entregue</button>
    </div>`;

  $("floating-btn-concluir").addEventListener("click", async () => {
    $("floating-panel").classList.add("hidden");
    await alternarConcluido(proxima);
    abrirMapsProximaParada();
  });
  $("floating-btn-postpone").addEventListener("click", async () => {
    $("floating-panel").classList.add("hidden");
    await alternarAdiado(proxima);
    abrirMapsProximaParada();
  });
}

// Encadeia direto pro Maps da parada seguinte assim que a atual é resolvida (entregue ou deixada
// pra depois) — pedido explícito pra não precisar tocar em mais nada depois de resolver uma parada,
// nem pela bolha nativa nem pelo painel de dentro do app.
function abrirMapsProximaParada() {
  const novaProxima = detailStops.find((s) => s.status === "roteirizada" || s.status === "adiada");
  if (novaProxima) window.open(mapsUrl(novaProxima), "_blank");
}

// Manda os mesmos dados do painel flutuante de dentro do app pra bolha nativa (fora do app, por
// cima do Maps/Waze/qualquer coisa) — ver BubbleOverlayPlugin/BubbleOverlayService no android/.
// Falha em silêncio se o plugin não existir (site/versão antiga) ou a permissão não foi concedida.
function sincronizarBolhaNativa(proxima, numero) {
  const bubble = window.Capacitor?.Plugins?.BubbleOverlay;
  if (!bubble) return;
  bubble.show({
    rotaId: detailRota.id,
    osId: proxima.id,
    numero,
    label: osLabel(proxima),
    endereco: proxima.endereco,
    bancoServico: [proxima.banco, proxima.servico, prazoLabel(proxima) || null].filter(Boolean).join(" · "),
    mapsUrl: mapsUrl(proxima),
    wazeUrl: wazeUrl(proxima),
    whatsUrl: whatsUrl(proxima) || "",
  }).catch(() => {});
}

// A bolha nativa não mexe no Supabase sozinha (não tem a sessão logada) — ela só traz o app de
// volta pra frente com a ação pendente (ver MainActivity.despacharAcaoDaBolha), e aqui a gente
// aplica de verdade usando a mesma lógica da lista de paradas.
window.addEventListener("bolhaAcao", async (e) => {
  const { acao, osId, rotaId } = e.detail || {};
  if (!acao || !osId) return;
  if (!detailRota || detailRota.id !== rotaId) await openRotaDetail(rotaId);
  const os = detailStops.find((s) => s.id === osId);
  if (!os) return;
  if (acao === "entregue") await alternarConcluido(os);
  else if (acao === "adiar") await alternarAdiado(os);
  abrirMapsProximaParada();
});

$("floating-bubble").addEventListener("click", () => {
  $("floating-panel").classList.toggle("hidden");
});
$("floating-close").addEventListener("click", () => {
  $("floating-panel").classList.add("hidden");
});

async function reotimizarRotaAtual() {
  const comCoordenadas = detailStops.filter((s) => s.lat != null && s.lng != null);
  if (comCoordenadas.length < 2) { toast("Precisa de pelo menos 2 paradas com endereço localizado."); return; }
  toast("Recalculando rota...");
  const origin = detailRota.origem_lat ? { lat: detailRota.origem_lat, lng: detailRota.origem_lng } : null;
  try {
    const result = await otimizarComPrioridadeDePrazo(comCoordenadas, origin);
    detailStops = result.order;
    await supabase.from("rotas").update({
      distancia_km: result.distanceKm, duracao_min: result.durationMin, geometria: result.geometry,
    }).eq("id", detailRota.id);
    detailRota.distancia_km = result.distanceKm;
    detailRota.duracao_min = result.durationMin;
    detailRota.geometria = result.geometry;
    for (let i = 0; i < detailStops.length; i++) {
      await supabase.from("ordens_servico").update({ ordem_na_rota: i + 1 }).eq("id", detailStops[i].id);
    }
    renderRotaDetail();
    toast("Rota atualizada!");
  } catch (err) {
    toast("Erro ao reotimizar: " + err.message);
  }
}

async function excluirRotaAtual() {
  if (!confirm("Excluir esta rota? As OS voltam para pendente (as já concluídas continuam concluídas).")) return;
  for (const os of detailStops) {
    if (os.status !== "concluida") {
      await supabase.from("ordens_servico").update({ rota_id: null, ordem_na_rota: null, status: "pendente" }).eq("id", os.id);
    } else {
      await supabase.from("ordens_servico").update({ rota_id: null, ordem_na_rota: null }).eq("id", os.id);
    }
  }
  await supabase.from("rotas").delete().eq("id", detailRota.id);
  toast("Rota excluída.");
  showView("rotas-list");
  loadRotas();
}

$("btn-rota-voltar").addEventListener("click", () => { showView("rotas-list"); loadRotas(); });

// ---------------------------------------------------------------- go
init();

// Service worker é coisa de PWA instalável no navegador (cache offline, "adicionar à tela
// inicial") — dentro do app nativo (Capacitor/APK) o WebView já serve os arquivos localmente, e
// registrar o service worker ali só arriscaria confundir cache com o jeito que o Capacitor entrega
// os assets. `window.Capacitor?.isNativePlatform?.()` existe só quando rodando dentro do app nativo.
const dentroDoApp = window.Capacitor?.isNativePlatform?.() === true;
if (!dentroDoApp && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
