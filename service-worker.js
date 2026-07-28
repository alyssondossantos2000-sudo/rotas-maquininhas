const CACHE = "rotas-maquininhas-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/config.js",
  "./js/supabaseClient.js",
  "./js/geocode.js",
  "./js/osrm.js",
  "./js/core/logger.js",
  "./js/image/documentDetector.js",
  "./js/image/perspectiveCorrection.js",
  "./js/image/autoRotate.js",
  "./js/image/manualRotate.js",
  "./js/image/enhancer.js",
  "./js/ocr/provider.js",
  "./js/ocr/wordMapper.js",
  "./js/layout/blockDetection.js",
  "./js/layout/tableDetection.js",
  "./js/layout/fieldDetection.js",
  "./js/interpret/documentInterpreter.js",
  "./js/ui/overlay.js",
  "./js/ui/zoom.js",
  "./js/ui/capture.js",
  "./manifest.json",
  "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first para os arquivos do próprio app (shell): sempre tenta buscar a versão mais
// recente na rede e só usa o cache como reserva quando estiver offline.
// Chamadas a Supabase/OSRM/Nominatim sempre vão direto pra rede (nunca interceptadas aqui).
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
