// Geocodificação via LocationIQ — mesmos dados do OpenStreetMap que o Nominatim público, mas com
// limite de taxa bem mais folgado no plano grátis (2 req/seg vs 1 req/seg, sem risco de bloqueio
// por uso "pesado demais" — problema real que já aconteceu testando esse app). Resposta no mesmo
// formato do Nominatim (é literalmente Nominatim por baixo), só muda a URL e a chave.
import { LOCATIONIQ_KEY } from "./config.js?v=28";

const cache = new Map();
const MIN_INTERVAL_MS = 550; // plano grátis do LocationIQ: 2 req/seg — 550ms dá uma margem pequena de segurança

// Duas filas SEPARADAS de limite de taxa: uma pro fallback progressivo do geocodeAddress (só roda
// no envio do formulário, pode esperar) e outra só pras sugestões ao vivo do autocomplete (o
// usuário está olhando pra tela esperando resposta — não pode ficar preso atrás de tentativas de
// outra busca que não tem nada a ver). Cada fila ainda respeita sozinha o limite de taxa, só não
// competem uma com a outra.
function criarFila() {
  let fila = Promise.resolve();
  let ultimaChamada = 0;
  return function throttledFetch(url) {
    fila = fila.then(async () => {
      const espera = Math.max(0, MIN_INTERVAL_MS - (Date.now() - ultimaChamada));
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      ultimaChamada = Date.now();
      return fetch(url, { headers: { Accept: "application/json" } });
    });
    return fila;
  };
}
const filaEndereco = criarFila();
const filaSugestoes = criarFila();

// Centro de Ponta Porã — usado como centro padrão de busca/distância enquanto o usuário não
// configurar nada na tela "Perfil".
const PONTA_PORA_CENTRO = { lat: -22.5286917, lng: -55.723426 };

const CHAVE_PERFIL = "rm_perfil_busca";

// { cidade, lat, lng, raioMinKm, raioMaxKm } com o centro e os dois raios escolhidos pelo usuário,
// ou null se nunca configurou (nesse caso usa o centro de Ponta Porã com os raios padrão abaixo).
export function lerPerfilBusca() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PERFIL) || "null");
    if (!salvo || salvo.lat == null || salvo.lng == null || !salvo.raioMinKm || !salvo.raioMaxKm) return null;
    return salvo;
  } catch {
    return null;
  }
}

export function salvarPerfilBusca(perfil) {
  localStorage.setItem(CHAVE_PERFIL, JSON.stringify(perfil));
}

function centroAtual() {
  const perfil = lerPerfilBusca();
  return perfil ? { lat: perfil.lat, lng: perfil.lng } : PONTA_PORA_CENTRO;
}

// Raio mínimo (busca local, tentada PRIMEIRO) e máximo (arredores, só tentado se o mínimo não
// achar nada) padrão — cobre Ponta Porã + Itamarati + Sanga Puitã como raio mínimo. O usuário pode
// configurar os dois na tela "Perfil" (ex: mínimo 70km / máximo 300km, pra cobrir bem mais além).
export const RAIO_MIN_PADRAO_KM = 70;
export const RAIO_MAX_PADRAO_KM = 70;

// BUG REAL relatado com dados de teste: só reordenar por distância não bastava quando o raio
// configurado era grande — o LocationIQ ordena por "importância" geral e já corta o limite de
// resultados ANTES de mandar a resposta, então uma rua pequena de Ponta Porã podia nem aparecer
// entre os primeiros resultados se existissem ruas de nome parecido "mais importantes" (de uma
// cidade maior) dentro do mesmo raio de 250km. Corrigido fazendo duas buscas em SEQUÊNCIA: local
// (raio MÍNIMO, onde a rua de Ponta Porã não compete com nada de fora) primeiro; só expande pro
// raio MÁXIMO se a busca local não achar nada — em vez de uma busca só, grande, disputada.

// 1° de latitude ≈ 111km sempre; 1° de longitude encolhe conforme se afasta do equador
// (≈111km × cos(latitude)) — sem isso o raio ficaria "esticado" de leste a oeste.
function viewboxDoRaio(centro, raioKm) {
  const dLat = raioKm / 111;
  const dLon = raioKm / (111 * Math.cos((centro.lat * Math.PI) / 180));
  return `${centro.lng - dLon},${centro.lat + dLat},${centro.lng + dLon},${centro.lat - dLat}`;
}

// Distância em linha reta (fórmula de Haversine) — não precisa de precisão de rota, só de ordenar
// "mais perto primeiro". Raio da Terra em km.
function distanciaKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const rLat1 = (a.lat * Math.PI) / 180;
  const rLat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function urlBusca(query, centro, raioKm, limite) {
  const viewbox = viewboxDoRaio(centro, raioKm);
  return `https://us1.locationiq.com/v1/search?key=${LOCATIONIQ_KEY}&format=json&countrycodes=br&viewbox=${viewbox}&bounded=1&limit=${limite}&q=${encodeURIComponent(query)}`;
}

function raioMinAtual() {
  const perfil = lerPerfilBusca();
  return perfil ? perfil.raioMinKm : RAIO_MIN_PADRAO_KM;
}

// Raio máximo (arredores) só entra como 2ª etapa se for realmente maior que o mínimo — senão seria
// repetir a mesma busca de novo à toa.
function raioMaxAmplo() {
  const perfil = lerPerfilBusca();
  const min = raioMinAtual();
  const max = perfil ? perfil.raioMaxKm : RAIO_MAX_PADRAO_KM;
  return max > min ? max : null;
}

async function buscarNominatim(query) {
  const centro = centroAtual();

  const tentar = async (raioKm) => {
    const url = urlBusca(query, centro, raioKm, 1);
    const res = await filaEndereco(url);
    const data = await res.json();
    return data && data.length ? data[0] : null;
  };

  let d = await tentar(raioMinAtual());
  const raioAmplo = raioMaxAmplo();
  if (!d && raioAmplo) d = await tentar(raioAmplo);
  if (!d) return null;

  return {
    lat: parseFloat(d.lat),
    lng: parseFloat(d.lon),
    display: d.display_name,
    // addresstype/class dizem QUE TIPO de coisa foi encontrada (rua, casa, bairro...) vs só o
    // contorno de uma cidade/estado inteiro — usado logo abaixo pra saber se vale a pena continuar
    // tentando algo mais específico antes de aceitar esse resultado. O Nominatim público manda
    // `addresstype`; testando contra o LocationIQ esse campo não vem (só `type`, que carrega a
    // mesma informação) — checa os dois pra funcionar com qualquer um dos dois.
    addresstype: d.addresstype || d.type,
    class: d.class,
  };
}

// Testado com endereço real: "Rua X 502 casa verde, Ponta Porã / MS, 79906-842" NÃO encontrava
// nada (o número da casa e a anotação "casa verde" atrapalham o parser do Nominatim mais do que
// ajudam), e a tentativa seguinte pulava direto pra achar só o CONTORNO DA CIDADE INTEIRA — um pino
// bem impreciso, mas que "conta como sucesso" e faz o código parar de tentar algo melhor. A versão
// só com o nome da rua (sem número/anotação) ACHA a rua certa. Por isso: 1) geramos também uma
// tentativa "rua sem número", tentada antes das tentativas mais genéricas; 2) só aceitamos um
// resultado genérico (cidade/bairro/contorno administrativo) como ÚLTIMO recurso, guardando ele
// de reserva mas continuando a tentar algo mais específico primeiro.
function gerarTentativas(address) {
  const partes = address.split(",").map((p) => p.trim()).filter(Boolean);
  const tentativas = [address];

  if (partes.length) {
    const m = partes[0].match(/^(.*?)\s+\d+/);
    const ruaSemNumero = m ? m[1].trim() : "";
    if (ruaSemNumero && ruaSemNumero.length >= 4 && ruaSemNumero !== partes[0]) {
      tentativas.push([ruaSemNumero, ...partes.slice(1)].join(", "));
    }
  }

  for (let i = 1; i < partes.length; i++) {
    tentativas.push(partes.slice(i).join(", "));
  }
  return tentativas;
}

// Tipos "genéricos demais" pra servir de pino de OS — são contorno de cidade/bairro/estado (ou só
// a área de um CEP inteiro, que em cidade pequena pode cobrir vários bairros), não um endereço de
// verdade. Um resultado assim só é aceito como reserva (aproximado), nunca como o resultado final
// aceito de cara — só se nenhuma tentativa mais específica achar nada melhor.
//
// BUG REAL encontrado com dados de produção: "postcode" não estava nessa lista, então uma tentativa
// que só achava o CEP (ex: endereço com rua não mapeada ainda no OpenStreetMap) passava como
// "específico" e era aceita direto — 7 OS de clientes DIFERENTES acabaram com a MESMA coordenada
// (centro da área do CEP), incluindo pelo menos um caso real onde o pino ficou a ~4km do endereço
// verdadeiro.
const TIPO_GENERICO_DEMAIS = new Set([
  "country", "state", "region", "county", "municipality", "city", "town", "village", "administrative",
  "postcode", "postal_code", "suburb", "neighbourhood",
]);
function ehEspecifico(r) {
  return !!r && !TIPO_GENERICO_DEMAIS.has(r.addresstype) && r.class !== "boundary";
}

// Cidades menores têm menos ruas mapeadas no OpenStreetMap. Se o endereço completo não for
// encontrado, tenta de novo com versões progressivamente mais simples, até no mínimo achar a
// cidade/CEP — melhor um pino aproximado do que nenhum, e o usuário sempre pode ajustar manualmente
// depois. Prioriza a primeira tentativa que ache algo ESPECÍFICO (rua/endereço), não só a primeira
// que ache alguma coisa.
export async function geocodeAddress(address) {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  const tentativas = gerarTentativas(address);

  let reserva = null; // melhor resultado genérico encontrado até agora, usado só se nada específico aparecer
  let resultado = null;
  let algumaTentativaRespondeu = false; // pelo menos uma chamada chegou a completar (não caiu por erro de rede)
  for (const tentativa of tentativas) {
    let r;
    try {
      r = await buscarNominatim(tentativa);
      algumaTentativaRespondeu = true;
    } catch (err) {
      // Erro de rede/CORS/limite de taxa numa tentativa NÃO pode derrubar as tentativas seguintes
      // (mais simples, mais chance de achar algo) — só essa tentativa específica falhou, não a busca
      // inteira. Antes disso aqui era um try/catch em volta do laço inteiro: uma falha de rede na
      // 1ª tentativa (endereço completo) impedia até a 2ª tentativa (rua sem número) de rodar, que
      // muitas vezes é a que realmente acha o endereço.
      console.error(`Erro ao geocodificar tentativa "${tentativa}":`, err);
      continue;
    }
    if (!r) continue;
    const aproximado = tentativa !== address;
    if (ehEspecifico(r)) {
      resultado = { ...r, aproximado };
      break;
    }
    if (!reserva) reserva = { ...r, aproximado: true };
  }

  const final = resultado || reserva;
  // Só guarda em cache se pelo menos uma tentativa de verdade respondeu (achando algo ou não). Se
  // TODAS falharam por erro de rede (ex: sem sinal no meio do trajeto), não vale a pena travar esse
  // endereço como "sem resultado" pro resto da sessão — o usuário pode tentar de novo com internet
  // melhor e merece uma nova chance de busca, não o mesmo null guardado.
  if (algumaTentativaRespondeu) cache.set(key, final);
  return final;
}

// Partes do fim de display_name que são sempre as mesmas nesse app (tudo é Ponta Porã/MS) — cortar
// fora deixa sobrar só rua + bairro.
const PARTES_REDUNDANTES = new Set(["ponta porã", "mato grosso do sul", "região centro-oeste", "brasil"]);
// Separa RUA (o que vai pro campo — completar com o número da casa precisa emendar direto nela,
// sem nada no meio) de CONTEXTO/bairro (só pra ajudar a reconhecer a opção certa na lista, nunca
// escrito no campo). Antes o rótulo juntava os dois com vírgula direto no campo — bug real
// reportado: usuário escolhia "Rua Felipe de Brum, Granja" e, pra acrescentar o número da casa,
// tinha que apagar e digitar de novo NO MEIO ("Rua Felipe de Brum 310, Granja") em vez de só
// completar no final.
function ruaEContexto(displayName) {
  const partes = displayName.split(",").map((p) => p.trim());
  const relevantes = partes.filter((p) => !PARTES_REDUNDANTES.has(p.toLowerCase()) && !/^\d{5}-?\d{3}$/.test(p));
  const base = relevantes.length ? relevantes : partes;
  return { rua: base[0] || displayName, contexto: base[1] || "" };
}

function mapearResultados(data, centro) {
  return data.map((d) => {
    const { rua, contexto } = ruaEContexto(d.display_name);
    const lat = parseFloat(d.lat), lng = parseFloat(d.lon);
    return { label: rua, contexto, lat, lng, distanciaKm: distanciaKm(centro, { lat, lng }) };
  });
}

const LIMITE_BRUTO = 20;
const LIMITE_EXIBIDO = 5;

// Sugestões ao vivo (autocomplete) enquanto o usuário digita. Fila própria (ver filaSugestoes
// acima) — não fica presa atrás de uma busca de endereço não relacionada rodando em outro lugar do
// app. Diferente de geocodeAddress, aqui NÃO tem fallback progressivo nem aceita resultado
// genérico: é o usuário que escolhe a opção certa na lista, então cada sugestão já vem com sua
// própria lat/lng exata — sem chute nenhum depois.
//
// Duas etapas (raio mínimo primeiro, depois o raio máximo — ver raioMinAtual/raioMaxAmplo acima):
// dentro de cada etapa os resultados vêm ordenados por distância até o centro, mais perto primeiro.
export async function buscarSugestoesEndereco(query) {
  const q = query.trim();
  if (q.length < 3) return [];
  const centro = centroAtual();

  const buscar = async (raioKm) => {
    const url = urlBusca(q, centro, raioKm, LIMITE_BRUTO);
    const res = await filaSugestoes(url);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  };

  try {
    let data = await buscar(raioMinAtual());
    const raioAmplo = raioMaxAmplo();
    if (!data.length && raioAmplo) data = await buscar(raioAmplo);
    return mapearResultados(data, centro)
      .sort((a, b) => a.distanciaKm - b.distanciaKm)
      .slice(0, LIMITE_EXIBIDO);
  } catch (err) {
    console.error("Erro ao buscar sugestões de endereço:", err);
    return [];
  }
}

// Busca de cidade/região pra tela "Perfil" (escolher o centro do raio de busca) — SEM viewbox/
// bounded, porque é justamente aqui que o usuário pode escolher um lugar fora da área restrita de
// sempre (ex: mudou pra atender em outra cidade). Reaproveita a fila de sugestões (ação pontual,
// não compete de verdade com a busca de endereço de parada). Mantém rua/número junto do resto do
// nome (sem o corte de PARTES_REDUNDANTES, que é específico de Ponta Porã) pra dar contexto de
// cidade/estado suficiente pra diferenciar lugares de nome parecido em partes diferentes do Brasil.
export async function buscarSugestoesCidade(query) {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `https://us1.locationiq.com/v1/search?key=${LOCATIONIQ_KEY}&format=json&countrycodes=br&limit=5&q=${encodeURIComponent(q)}`;
  try {
    const res = await filaSugestoes(url);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d) => {
      const partes = d.display_name.split(",").map((p) => p.trim());
      return { label: partes[0], contexto: partes.slice(1, 3).join(", "), lat: parseFloat(d.lat), lng: parseFloat(d.lon) };
    });
  } catch (err) {
    console.error("Erro ao buscar sugestões de cidade:", err);
    return [];
  }
}
