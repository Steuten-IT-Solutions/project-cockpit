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

  function same(buffer, bytes) {
    var a = new Uint8Array(buffer);
    if (a.length !== bytes.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== bytes[i]) {
        return false;
      }
    }
    return true;
  }

  function post(path, endpoint) {
    var body = new URLSearchParams();
    body.set('_csrf', box.dataset.csrf);
    body.set('endpoint', endpoint);
    return fetch(path, { method: 'POST', body: body, credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status);
        err.rejected = res.status >= 400 && res.status < 500;
        throw err;
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
      // Made with an older VAPID key: no longer deliverable, switch it off so it can be renewed.
      if (sub && sub.options && sub.options.applicationServerKey && !same(sub.options.applicationServerKey, key(box.dataset.key))) {
        return sub.unsubscribe().then(function () {
          show(false, 'Der Schlüssel des Cockpits hat sich geändert. Bitte Push neu einschalten.');
        });
      }
      show(!!sub);
      // Tell the server again: it may have dropped the subscription (e.g. gone at the push service).
      if (sub) {
        post('/push/subscribe', sub.endpoint).catch(function (err) {
          // The cockpit does not accept this subscription (e.g. unknown push service): switch it off here too.
          if (err.rejected) {
            sub.unsubscribe().then(function () {
              show(false, 'Dieses Gerät kann keine Push-Nachrichten des Cockpits bekommen.');
            });
          }
        });
      }
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
        return post('/push/subscribe', sub.endpoint).catch(function (err) {
          // Not stored on the server: do not leave a subscription behind that never gets anything.
          return sub.unsubscribe().then(function () {
            throw err;
          });
        });
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
