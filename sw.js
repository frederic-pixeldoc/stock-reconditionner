/* Service worker PixelDoc : l'appli s'ouvre aussi sans connexion.
   Ne met en cache que les fichiers de l'appli ; les données restent dans le navigateur. */
const V = 'pd-stock-reconditionner-v2';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(['./', 'manifest.webmanifest', 'icon-192.png', 'stock-core.js'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const libs = /(^|\.)(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname);
  if (u.origin !== location.origin && !libs) return;
  if (r.mode === 'navigate') {
    // pages : réseau d'abord (nouvelle version dès qu'elle est publiée), cache en secours hors connexion
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match('./'))));
    return;
  }
  // scripts, polices, icônes : cache d'abord, mis à jour en arrière-plan
  e.respondWith(caches.match(r).then(m => {
    const n = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); } return res; }).catch(() => m);
    return m || n;
  }));
});
