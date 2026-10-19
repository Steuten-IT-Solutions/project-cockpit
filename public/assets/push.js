// Web push on the page "Warnungen": subscribe or unsubscribe this device. Pushes carry no
// payload; the service worker (/sw.js) shows a fixed notification and opens /alerts.
(function () {
  'use strict';
  var box = document.getElementById('push');
  if (!box || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return;
  }
  var on = box.querySelector('[data-push="on"]');
  var off = box.querySelector('[data-push="off"]');
  var status = box.querySelector('[data-push-status]');
  box.hidden = false;

  function key(base64url) {
    var padded = (base64url + '===='.slice(base64url.length % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(padded);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) {
      out[i] = raw.charCodeAt(i);
    }
    return out;
  }

  function post(path, endpoint) {
    var body = new URLSearchParams();
    body.set('_csrf', box.dataset.csrf);
    body.set('endpoint', endpoint);
    return fetch(path, { method: 'POST', body: body, credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
    });
  }

  function show(subscribed, text) {
    on.hidden = subscribed;
    off.hidden = !subscribed;
    status.textContent = text || (subscribed ? 'Dieses Gerät bekommt Push-Nachrichten.' : '');
  }

  var ready = navigator.serviceWorker.register('/sw.js').then(function () {
    return navigator.serviceWorker.ready;
  });

  ready
    .then(function (reg) {
      return reg.pushManager.getSubscription();
    })
    .then(function (sub) {
      show(!!sub);
    })
    .catch(function () {
      show(false, 'Push ist in diesem Browser nicht verfügbar.');
    });

  on.addEventListener('click', function () {
    Notification.requestPermission()
      .then(function (permission) {
        if (permission !== 'granted') {
          throw new Error('Benachrichtigungen sind für diese Seite nicht erlaubt.');
        }
        return ready;
      })
      .then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(box.dataset.key) });
      })
      .then(function (sub) {
        return post('/push/subscribe', sub.endpoint);
      })
      .then(function () {
        show(true);
      })
      .catch(function (err) {
        show(false, 'Nicht eingeschaltet: ' + err.message);
      });
  });

  off.addEventListener('click', function () {
    ready
      .then(function (reg) {
        return reg.pushManager.getSubscription();
      })
      .then(function (sub) {
        if (!sub) {
          return null;
        }
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          return post('/push/unsubscribe', endpoint);
        });
      })
      .then(function () {
        show(false, 'Push auf diesem Gerät ausgeschaltet.');
      })
      .catch(function (err) {
        status.textContent = 'Fehler: ' + err.message;
      });
  });
})();
