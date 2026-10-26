/* Jacky's Service Portal -- background chat alerts (modification #144).
   Registered from the Chat screen only when the person turns background alerts on.
   It does nothing but show a notification for a push message and focus or open the
   portal when it is clicked; it caches nothing and never touches the network. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { title: 'New message', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'New message', {
      body: data.body || '',
      tag: data.tag || 'chat',
      renotify: true,
      icon: '/portal/icon.svg',
      badge: '/portal/icon.svg',
      data: { conversationId: data.conversationId || null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data && event.notification.data.conversationId;
  const target = '/portal/' + (conversationId ? '?chat=' + encodeURIComponent(conversationId) : '');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.includes('/portal/') && 'focus' in client) {
          client.postMessage({ type: 'open-chat', conversationId });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
