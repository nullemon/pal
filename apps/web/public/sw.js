/* PALScans service worker — web push only (docs/17 §D).
 *
 * Deliberately minimal: it caches nothing and intercepts no fetch, so it cannot serve a stale
 * page or interfere with the reader. It exists to receive a push while the tab is closed and
 * to focus (or open) the right page when the notification is clicked. Offline downloads
 * (docs/17 §G) will extend this file rather than replace it.
 */

const FALLBACK = {
  title: 'PALScans',
  body: 'Something new is waiting for you.',
  url: '/me/notifications',
}

/** Take over immediately so a reader who just subscribed gets the next push. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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
  const target = (event.notification.data && event.notification.data.url) || FALLBACK.url
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
  const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint
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
