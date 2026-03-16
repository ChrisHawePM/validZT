// Service Worker — makes validZT available offline.
//
// A service worker is a small background script the browser installs once.
// It intercepts network requests and serves files from a local cache,
// so the app works even with no internet connection. All text you type
// stays on your device — nothing is ever sent to any server.

'use strict';

// Bump this string whenever the app files change so old cached versions
// are replaced with the new ones on the user's next online visit.
const CACHE_VERSION = 'validzt-v5';

// The complete list of files to cache on first install.
// Every file the app needs to run offline must be listed here.
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sw-register.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192.png?v=2',
  './icons/icon-512.png?v=2'
];

// On install: download and cache all app files.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// On activate: delete any old caches from previous versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// On fetch: serve from cache first; fall back to network only if not cached.
// Because all assets are precached, network is almost never needed after install.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
