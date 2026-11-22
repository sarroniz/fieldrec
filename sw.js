// Service worker: guarda la app y los protocolos incluidos para usarla sin conexión.
// Estrategia: responde desde la caché y actualiza en segundo plano (la versión nueva se ve al volver a abrir).
const CACHE = 'fieldrec-v0.1.1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/audio.js', 'js/recorder-worklet.js', 'js/wav-worker.js', 'js/dsp.js',
  'js/protocol.js', 'js/db.js', 'js/zip.js', 'js/unzip.js', 'js/textgrid.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'protocols/index.json',
  'protocols/ejemplo/protocolo.md', 'protocols/ejemplo/palabras.csv', 'protocols/ejemplo/consentimiento.md',
  ...['sol', 'casa', 'arbol', 'luna', 'pez', 'llave', 'historia1', 'historia2', 'historia3'].map((n) => `protocols/ejemplo/img/${n}.svg`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
