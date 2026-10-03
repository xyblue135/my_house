const CACHE = 'itemnest-online-v2'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('itemnest-') && key !== CACHE).map(key => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  // Cache only our public app shell. API, attachments and credential-bearing URLs are never stored.
  if (url.search || !(SHELL.includes(url.pathname) || url.pathname.startsWith('/assets/'))) return
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)))
      }
      return response
    }).catch(() => caches.match(event.request))
  )
})
