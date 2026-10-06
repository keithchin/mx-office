// The phone version's service worker (/sw.js, scope /m; client/mobile/push.ts registers it). It keeps an
// app shell so the home-screen app opens even when the office can't be reached (it then says so and
// reconnects), and shows the office's Web Push notifications (server/webpush/): the red Needs-you items.
// Tapping one opens /m on that item. The office's API and its socket are never cached.

const SHELL = 'agent-office-m-v1';
const SHELL_URLS = ['/m', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => Promise.all(SHELL_URLS.map((u) => c.add(new Request(u, { credentials: 'same-origin' })).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('agent-office-m-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  // The page: the network first (always the newest), the shell when the office can't be reached.
  if (req.mode === 'navigate' && url.pathname === '/m') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only a real page, never a sign-in redirect or an error, goes in the shell.
          if (res.ok && res.type === 'basic' && !res.redirected) caches.open(SHELL).then((c) => c.put('/m', res.clone()));
          return res;
        })
        .catch(() => caches.match('/m').then((hit) => hit || Response.error())),
    );
    return;
  }
  // The bundle's files have their hash in their names: once fetched they never change.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === 'basic') caches.open(SHELL).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Agent Office', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Agent Office';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Something needs you in the office',
      tag: data.tag || undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/m' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/m';
  // Only ever somewhere in the phone version, on this office.
  const target = new URL(raw, self.location.origin);
  const url = target.origin === self.location.origin && target.pathname === '/m' ? target.href : new URL('/m', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).pathname === '/m' && 'focus' in w) {
          w.postMessage({ t: 'open', url });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
