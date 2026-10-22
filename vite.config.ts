import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Offline support: emits /sw.js that precaches the whole built app (HTML, JS, CSS, data, icons).
 * After one visit the app opens from the phone even when the site is unreachable
 * (e.g. *.vercel.app blocked in mainland China) or there is no internet at all.
 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'altiora-offline-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const assets = ['/', '/icon.svg', '/manifest.webmanifest', ...files.filter((f) => f !== 'index.html').map((f) => `/${f}`)];
      const version = hash(files.sort().join('|'));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: SW_SOURCE.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets)) });
    },
  };
}

/** Short stable hash of the asset list (file names carry content hashes, so it changes with every deploy). */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

const SW_SOURCE = `/* ALTIORA offline service worker — generated at build time. */
const CACHE = 'altiora-__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('altiora-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // AMap etc.: straight to the network
  if (req.mode === 'navigate') {
    // The app shell from this version's cache (any ?phase=… query) — works with the site blocked or offline.
    e.respondWith(caches.open(CACHE).then((c) => c.match('/')).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;

export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
  build: { chunkSizeWarningLimit: 1200 },
});
