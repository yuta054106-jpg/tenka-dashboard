// ホーム画面アプリとして動かすための最小限のサービスワーカー。
// 画面のファイルだけを保存し、案件データ（GitHub API）は保存しない。
const CACHE = 'tenka-v7';
const FILES = ['./', 'index.html', 'sprites.js', 'parse.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // GitHub API などは素通し
  // 画面ファイルはネット優先（更新をすぐ反映）、つながらないときだけ保存分を使う
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
