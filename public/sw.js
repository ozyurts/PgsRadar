// Notification host for the tracker page (takip.html).
//
// It caches nothing on purpose. A service worker that serves the app shell
// would hand visitors a stale build after every deploy, and this page's whole
// value is that its numbers are current — offline it has nothing true to say.
// It is here for one reason: Android refuses `new Notification()` from a page
// and only allows notifications raised by a service worker.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Tapping the landing notification should land on the flight it was about,
// reusing the tab that is already tracking it rather than opening a second one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/takip';

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of open) {
        if (client.url.includes('/takip') && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});
