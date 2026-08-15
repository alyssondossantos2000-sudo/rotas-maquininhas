// Geocodificação via Nominatim (OpenStreetMap) - gratuito, limite de 1 req/seg.
const cache = new Map();
let queue = Promise.resolve();
const MIN_INTERVAL_MS = 1100;
let lastCall = 0;

// App limitado à região de Ponta Porã/MS (inclui os distritos de Itamarati e Sanga Puitã,
// que fazem parte do mesmo município) — evita que um endereço parecido de outra cidade do
// Brasil seja encontrado por engano. Caixa geográfica do município de Ponta Porã inteiro.
const PONTA_PORA_BBOX = { minLat: -22.7642905, maxLat: -21.6339890, minLon: -56.1123178, maxLon: -54.9764267 };
const VIEWBOX = `${PONTA_PORA_BBOX.minLon},${PONTA_PORA_BBOX.maxLat},${PONTA_PORA_BBOX.maxLon},${PONTA_PORA_BBOX.minLat}`;

function throttledFetch(url) {
  queue = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fetch(url, { headers: { Accept: "application/json" } });
  });
  return queue;
}

async function buscarNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(query)}`;
  const res = await throttledFetch(url);
  const data = await res.json();
  if (!data || !data.length) return null;
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    display: data[0].display_name,
    // addresstype/class dizem QUE TIPO de coisa foi encontrada (rua, casa, bairro...) vs só o
    // contorno de uma cidade/estado inteiro — usado logo abaixo pra saber se vale a pena continuar
    // tentando algo mais específico antes de aceitar esse resultado.
    addresstype: data[0].addresstype,
    class: data[0].class,
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

// Sugestões ao vivo (autocomplete) enquanto o usuário digita — mesma restrição geográfica e mesma
// fila com limite de 1 req/seg do geocodeAddress acima (Nominatim é o mesmo serviço, respeitando o
// mesmo limite de uso). Diferente de geocodeAddress, aqui NÃO tem fallback progressivo nem aceita
// resultado genérico: é o usuário que escolhe a opção certa na lista, então cada sugestão já vem
// com sua própria lat/lng exata — sem chute nenhum depois.
export async function buscarSugestoesEndereco(query) {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=br&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
  try {
    const res = await throttledFetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }));
  } catch (err) {
    console.error("Erro ao buscar sugestões de endereço:", err);
    return [];
  }
}
