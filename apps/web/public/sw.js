/* PALScans service worker — web push (docs/17 §D) and offline downloads (docs/17 §G).
 *
 * The fetch handler is deliberately narrow, because a service worker that guesses wrong
 * serves a stale reader to everyone. It only ever answers from cache for:
 *   1. a request whose exact URL a download put in `palscans-offline-v1`, and
 *   2. immutable `/_next/static/*` build output, so the offline shell has its JS,
 * and it falls back to the cached `/offline` document only for a navigation that the
 * network has already refused. Everything else goes straight to the network, untouched.
 */
const OFFLINE_CACHE = 'palscans-offline-v1'
const SHELL_CACHE = 'palscans-shell-v1'
const OFFLINE_URL = '/offline'

const FALLBACK = {
  title: 'PALScans',
  body: 'Something new is waiting for you.',
  url: '/me/notifications',
}

/** Take over immediately so a reader who just subscribed gets the next push. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload` so an install never adopts a stale copy from the HTTP cache.
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('palscans-') && k !== OFFLINE_CACHE && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/**
 * Downloaded pages first, then the build output the offline shell needs, then — only when
 * the network has actually failed — the offline document for a navigation.
 */
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // 1. A page a download stored. Cache-only: these URLs may be signed and expired.
  event.respondWith(
    caches.open(OFFLINE_CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        if (hit) return hit

        // 2. Immutable build output, so `/offline` can boot with no network.
        if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
          return caches.open(SHELL_CACHE).then((shell) =>
            shell.match(req).then(
              (cached) =>
                cached ||
                fetch(req).then((res) => {
                  if (res.ok) shell.put(req, res.clone())
                  return res
                }),
            ),
          )
        }

        // 3. A navigation the network refused: hand over the offline library.
        if (req.mode === 'navigate') {
          return fetch(req).catch(() =>
            caches
              .open(SHELL_CACHE)
              .then((shell) => shell.match(OFFLINE_URL))
              .then((shell) => shell || Response.error()),
          )
        }

        return fetch(req)
      }),
    ),
  )
})

/** The downloads screen asks for the shell to be refreshed after it finishes a download. */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-shell') return
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .catch(() => undefined),
  )
})

/** The payload the sender writes is JSON; anything else is treated as plain body text. */
function readPayload(event) {
  if (!event.data) return { ...FALLBACK }
  try {
    const data = event.data.json()
    return {
      title: typeof data.title === 'string' && data.title ? data.title : FALLBACK.title,
      body: typeof data.body === 'string' && data.body ? data.body : FALLBACK.body,
      url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : FALLBACK.url,
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: typeof data.icon === 'string' ? data.icon : undefined,
      badge: typeof data.badge === 'string' ? data.badge : undefined,
    }
  } catch {
    return { ...FALLBACK, body: event.data.text() || FALLBACK.body }
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event)
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: payload.icon,
      badge: payload.badge,
      // Re-notify on a replacement so "chapter 12" does not silently overwrite "chapter 11".
      renotify: Boolean(payload.tag),
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || FALLBACK.url
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const url = new URL(target, self.location.origin).href
      for (const client of windows) {
        // Same origin already open: reuse the tab rather than piling up windows.
        if (client.url === url && 'focus' in client) return client.focus()
      }
      for (const client of windows) {
        if ('navigate' in client && 'focus' in client)
          return client.navigate(url).then((c) => (c ? c.focus() : undefined))
      }
      return self.clients.openWindow(url)
    }),
  )
})

/**
 * Chrome can rotate a subscription on its own. The page cannot help here (it may be closed),
 * so drop the old row and let the next visit to /me/notifications re-subscribe.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  const oldEndpoint = event.oldSubscription?.endpoint
  if (!oldEndpoint) return
  event.waitUntil(
    fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: oldEndpoint }),
      credentials: 'same-origin',
    }).catch(() => undefined),
  )
})
