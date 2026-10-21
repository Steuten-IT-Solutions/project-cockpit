// Release box on the dashboard: reloads its content every few seconds while the page is visible, so a release
// that starts or ends shows up without reloading the page. The server only reads its database; GitHub tells it
// about releases through the webhook.
(function () {
  'use strict';
  var box = document.getElementById('releases');
  if (!box || !window.fetch || !('content' in document.createElement('template'))) {
    return;
  }
  var INTERVAL = 5000;
  var timer = null;

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(poll, INTERVAL);
  }

  function poll() {
    window.clearTimeout(timer);
    if (document.hidden) {
      return;
    }
    fetch(box.dataset.poll, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (response.status === 401) {
          // Logged out or session expired: stop.
          return null;
        }
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        return response.text();
      })
      .then(function (html) {
        if (html === null) {
          return;
        }
        // Same origin, every value escaped by the server; the CSP blocks scripts in it anyway.
        var template = document.createElement('template');
        template.innerHTML = html;
        box.replaceChildren(template.content);
        schedule();
      })
      .catch(schedule);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      poll();
    }
  });
  schedule();
})();
