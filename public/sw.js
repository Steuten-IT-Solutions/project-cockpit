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
        if ('focus' in list[i]) {
          list[i].navigate('/alerts');
          return list[i].focus();
        }
      }
      return self.clients.openWindow('/alerts');
    })
  );
});
