// Service worker: caches the app and the bundled protocols so it works offline.
// vendor/pdfjs (PDF import) is cached the first time it is used.
const CACHE = 'fieldrec-v0.3.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/guide.js', 'js/editor.js', 'js/pptx.js', 'js/pdf-import.js', 'js/audio.js', 'js/recorder-worklet.js', 'js/wav-worker.js', 'js/dsp.js',
  'js/protocol.js', 'js/db.js', 'js/zip.js', 'js/unzip.js', 'js/textgrid.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'protocols/index.json',
  'protocols/example-es/protocol.md', 'protocols/example-es/words.csv', 'protocols/example-es/consent.md',
  ...['sol', 'casa', 'arbol', 'luna', 'pez', 'llave', 'historia1', 'historia2', 'historia3'].map((n) => `protocols/example-es/img/${n}.svg`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (revalidating with the server) so a new version shows up as soon as it is published;
// the cache is only used offline or when the network takes longer than 4 s.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch (_) { /* offline */ }
    const cached = await cache.match(req, { ignoreSearch: true });
    return cached || network;
  })());
});
