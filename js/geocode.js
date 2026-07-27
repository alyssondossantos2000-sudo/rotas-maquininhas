// Geocodificação via Nominatim (OpenStreetMap) - gratuito, limite de 1 req/seg.
const cache = new Map();
let queue = Promise.resolve();
const MIN_INTERVAL_MS = 1100;
let lastCall = 0;

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
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`;
  const res = await throttledFetch(url);
  const data = await res.json();
  if (!data || !data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
}

// Cidades menores têm menos ruas mapeadas no OpenStreetMap. Se o endereço completo não for
// encontrado, tenta de novo com versões progressivamente mais simples (tirando o trecho mais
// específico primeiro), até no mínimo achar a cidade/CEP — melhor um pino aproximado do que
// nenhum, e o usuário sempre pode ajustar manualmente depois.
export async function geocodeAddress(address) {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  const partes = address.split(",").map((p) => p.trim()).filter(Boolean);
  const tentativas = [address];
  for (let i = 1; i < partes.length; i++) {
    tentativas.push(partes.slice(i).join(", "));
  }

  let result = null;
  try {
    for (const tentativa of tentativas) {
      result = await buscarNominatim(tentativa);
      if (result) { result.aproximado = tentativa !== address; break; }
    }
  } catch (err) {
    console.error("Erro ao geocodificar:", err);
  }

  cache.set(key, result);
  return result;
}
