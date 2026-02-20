var CACHE_NAME = 'booktracker-v6';
var COVERS_CACHE = 'booktracker-covers-v1';
var MAX_COVERS = 200;

var STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/firebase.js',
  './js/api.js',
  './js/ui.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: pre-cache static assets
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key !== CACHE_NAME && key !== COVERS_CACHE;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch strategy
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Firebase & Google services: always network (auth, Firestore, APIs)
  if (url.hostname === 'www.googleapis.com' ||
      url.hostname === 'firestore.googleapis.com' ||
      url.hostname === 'identitytoolkit.googleapis.com' ||
      url.hostname === 'securetoken.googleapis.com' ||
      url.hostname === 'accounts.google.com' ||
      url.hostname.endsWith('.firebaseio.com') ||
      url.hostname.endsWith('.firebaseapp.com') ||
      url.hostname === 'www.gstatic.com' ||
      url.hostname === 'apis.google.com' ||
      url.hostname === 'openlibrary.org') {
    return;
  }

  // Cover images: network first, cache fallback
  if (url.hostname === 'books.google.com' || url.hostname === 'covers.openlibrary.org') {
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response.ok) {
          var responseClone = response.clone();
          caches.open(COVERS_CACHE).then(function (cache) {
            cache.put(event.request, responseClone);
            // Trim cache if too large
            cache.keys().then(function (keys) {
              if (keys.length > MAX_COVERS) {
                cache.delete(keys[0]);
              }
            });
          });
        }
        return response;
      }).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Static assets: cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});