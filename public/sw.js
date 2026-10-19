// Service worker of the cockpit: only for web push. Pushes carry no payload; the details are
// behind the login on the page "Warnungen".
self.addEventListener('push', function (event) {
  event.waitUntil(
    self.registration.showNotification('Cockpit', {
      body: 'Neue Warnung oder Entwarnung einer Kompanie-App. Zum Öffnen tippen.',
      tag: 'cockpit-alert',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if ('focus' in client && 'navigate' in client) {
          // navigate() fails for tabs this worker does not control: then open a new window.
          return client
            .navigate('/alerts')
            .then(function (c) {
              return (c || client).focus();
            })
            .catch(function () {
              return self.clients.openWindow('/alerts');
            });
        }
      }
      return self.clients.openWindow('/alerts');
    })
  );
});
