const CACHE_NAME = 'delfin-v17';
self.skipWaiting();
const urlsToCache = [
    '/',
    '/index.html',
    '/logo.webp',
    '/references.json',
    '/embeddings.json'
]

// Install event - cache resources
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force the waiting service worker to become the active service worker.
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache')
                return cache.addAll(urlsToCache)
            })
    )
})

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
    // ONLY cache http/https requests to avoid errors with extensions (chrome-extension:// etc)
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - return response
                if (response) {
                    return response
                }

                return fetch(event.request).then(
                    (response) => {
                        // Check if valid response and scheme
                        if (!response || response.status !== 200 || response.type !== 'basic' || !event.request.url.startsWith('http')) {
                            return response
                        }

                        // Clone the response
                        const responseToCache = response.clone()

                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache)
                            })

                        return response
                    }
                )
            })
    )
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim()); // Take control of all open clients immediately.
    const cacheWhitelist = [CACHE_NAME]

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName)
                    }
                })
            )
        })
    )
})
