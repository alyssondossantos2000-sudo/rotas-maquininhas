import { supabase } from "./supabaseClient.js";
import { geocodeAddress } from "./geocode.js";
import { optimizeTrip } from "./osrm.js";
import { runOcr, parseOsFields, warmupOcr } from "./ocr.js";

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

  const titles = {
    "os-list": "Ordens de Serviço",
    "os-form": editingOsId ? "Editar OS" : "Nova OS",
    "rotas-list": "Rotas",
    "rota-build": "Nova rota",
    "rota-detail": "Rota",
  };
  $("header-title").textContent = titles[name] || "Rotas Maquininhas";

  if (name !== "rota-detail" && detailMap) { detailMap.remove(); detailMap = null; }
  if (name !== "os-form" && osFormMap) { osFormMap.remove(); osFormMap = null; }
  if (name !== "rota-detail") $("floating-widget").classList.add("hidden");
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
    showView("os-list");
    loadOsList();
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
    else { showView("os-list"); loadOsList(); }
  });
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
      <div class="card-sub">${os.banco ? "🏦 " + escapeHtml(os.banco) + " · " : ""}${os.servico ? escapeHtml(os.servico) : ""}</div>
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
function osLabel(os) {
  return os.numero_os ? `OS ${escapeHtml(os.numero_os)} — ${escapeHtml(os.nome_cliente)}` : escapeHtml(os.nome_cliente);
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
  $("foto-preview").classList.add("hidden");
  $("ocr-raw-wrap").classList.add("hidden");
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
      $("os-obs").value = os.observacoes || "";
      if (os.lat != null && os.lng != null) osFormPin = { lat: os.lat, lng: os.lng };
    }
  }
  showView("os-form");
}

$("os-endereco").addEventListener("input", () => { osFormPin = null; });

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
  // Começa a preparar o leitor de texto assim que a aba "Por foto" abre, antes da foto ser
  // tirada — assim o tempo de download/inicialização fica escondido enquanto o usuário fotografa.
  if (tab === "foto") warmupOcr();
}

let ultimaOrigemCadastro = "manual";

$("foto-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  ultimaOrigemCadastro = "foto";

  const preview = $("foto-preview");
  preview.src = URL.createObjectURL(file);
  preview.classList.remove("hidden");

  const statusEl = $("ocr-status");
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Preparando...";

  try {
    const text = await runOcr(file, (msg) => { statusEl.textContent = msg; });
    statusEl.textContent = "Leitura concluída — confira os campos abaixo.";
    const fields = parseOsFields(text);
    if (fields.numero_os) $("os-numero").value = fields.numero_os;
    if (fields.nome_cliente) $("os-cliente").value = fields.nome_cliente;
    if (fields.endereco) $("os-endereco").value = fields.endereco;
    if (fields.contato) $("os-contato").value = fields.contato;
    if (fields.banco) $("os-banco").value = fields.banco;
    if (fields.servico) $("os-servico").value = fields.servico;

    $("ocr-raw-text").textContent = text.trim() || "(nada reconhecido)";
    $("ocr-raw-wrap").classList.remove("hidden");
    switchTab("manual");
  } catch (err) {
    statusEl.textContent = "Não consegui ler a foto. Preencha manualmente.";
    console.error(err);
  }
});

$("form-os").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("os-form-error").textContent = "";

  const payload = {
    numero_os: $("os-numero").value.trim(),
    nome_cliente: $("os-cliente").value.trim(),
    endereco: $("os-endereco").value.trim(),
    contato: $("os-contato").value.trim(),
    banco: $("os-banco").value.trim(),
    servico: $("os-servico").value.trim(),
    observacoes: $("os-obs").value.trim(),
  };
  if (!payload.numero_os || !payload.nome_cliente || !payload.endereco) {
    $("os-form-error").textContent = "Preencha número da OS, cliente e endereço.";
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
    payload.geocode_status = geo ? "ok" : "falhou";
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
// salva. `onAdded(osInserida)` decide o que fazer com a parada criada em cada tela.
function wireQuickAddForm(form, onAdded) {
  const statusEl = form.querySelector(".qp-status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome_cliente = form.elements.cliente.value.trim();
    const endereco = form.elements.endereco.value.trim();
    if (!nome_cliente || !endereco) {
      statusEl.textContent = "Preencha cliente e endereço.";
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    statusEl.textContent = "Localizando endereço...";

    const geo = await geocodeAddress(endereco);
    const payload = {
      nome_cliente,
      endereco,
      servico: form.elements.servico.value.trim(),
      banco: form.elements.maquina.value.trim(),
      contato: form.elements.contato.value.trim(),
      observacoes: form.elements.obs.value.trim(),
      status: "pendente",
      origem_cadastro: "manual",
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      geocode_status: geo ? "ok" : "falhou",
    };

    const { data: inserted, error } = await supabase.from("ordens_servico").insert(payload).select().single();
    btn.disabled = false;
    if (error) { statusEl.textContent = "Erro ao adicionar: " + error.message; return; }

    form.reset();
    statusEl.textContent = geo ? "Parada adicionada!" : "Parada adicionada, mas não localizei o endereço — ajuste depois em \"OS\" > Editar.";
    await onAdded(inserted);
  });
}

wireQuickAddForm($("form-parada-rapida"), async (inserted) => {
  addOsSelectRow(inserted, { checked: true });
});

$("btn-toggle-parada-rapida").addEventListener("click", () => {
  $("parada-rapida-detalhe-wrap").classList.toggle("hidden");
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
      await supabase.from("ordens_servico").update({ lat: geo.lat, lng: geo.lng, geocode_status: "ok" }).eq("id", os.id);
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
    const result = await optimizeTrip(comCoordenadas, origin);
    buildOrder = result.order.map((i) => comCoordenadas[i]);
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
        <span>${os.banco ? "🏦 " + escapeHtml(os.banco) + " " : ""}${os.servico ? "· " + escapeHtml(os.servico) : ""}</span>
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

// ---------------------------------------------------------------- Rota detail
async function openRotaDetail(id) {
  const { data: rota, error } = await supabase.from("rotas").select("*").eq("id", id).single();
  if (error) { toast("Erro ao abrir rota: " + error.message); return; }
  const { data: stops, error: err2 } = await supabase.from("ordens_servico").select("*").eq("rota_id", id).order("ordem_na_rota", { ascending: true });
  if (err2) { toast("Erro ao carregar paradas: " + err2.message); return; }

  detailRota = rota;
  detailStops = stops || [];
  $("parada-rapida-detalhe-wrap").classList.add("hidden");
  $("form-parada-rapida-detalhe").reset();
  renderRotaDetail();
  showView("rota-detail");
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
    onToggleDone: async (os) => {
      const novoStatus = os.status === "concluida" ? "roteirizada" : "concluida";
      await supabase.from("ordens_servico").update({ status: novoStatus }).eq("id", os.id);
      os.status = novoStatus;
      renderRotaDetail();
    },
    onPostpone: async (os) => {
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
    },
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
      L.marker([os.lat, os.lng], { icon: numberedIcon(i + 1, "#3d8bfd") }).addTo(detailMap).bindPopup(`OS ${os.numero_os} — ${os.nome_cliente}`);
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

  if (!proxima) { widget.classList.add("hidden"); return; }
  widget.classList.remove("hidden");

  const idx = detailStops.indexOf(proxima);
  $("floating-bubble-num").textContent = idx + 1;

  $("floating-panel-body").innerHTML = `
    <b>${osLabel(proxima)}</b>
    <div class="fp-line">📍 ${escapeHtml(proxima.endereco)}</div>
    ${proxima.banco || proxima.servico ? `<div class="fp-line">${proxima.banco ? "🏦 " + escapeHtml(proxima.banco) + " " : ""}${proxima.servico ? "· " + escapeHtml(proxima.servico) : ""}</div>` : ""}
    ${proxima.observacoes ? `<div class="fp-line">📝 ${escapeHtml(proxima.observacoes)}</div>` : ""}
    <div class="stop-actions">
      <a class="btn btn-secondary" href="${mapsUrl(proxima)}" target="_blank" rel="noopener">🧭 Maps</a>
      <a class="btn btn-secondary" href="${wazeUrl(proxima)}" target="_blank" rel="noopener">🚗 Waze</a>
      ${whatsUrl(proxima) ? `<a class="btn btn-secondary" href="${whatsUrl(proxima)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
      <button class="btn btn-primary" id="floating-btn-concluir">Concluir</button>
    </div>`;

  $("floating-btn-concluir").addEventListener("click", async () => {
    await supabase.from("ordens_servico").update({ status: "concluida" }).eq("id", proxima.id);
    proxima.status = "concluida";
    $("floating-panel").classList.add("hidden");
    renderRotaDetail();
  });
}

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
    const result = await optimizeTrip(comCoordenadas, origin);
    detailStops = result.order.map((i) => comCoordenadas[i]);
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
