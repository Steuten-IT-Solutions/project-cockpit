<?php
/**
 * @var callable(mixed): string $e
 * @var string $csrf
 * @var string $timezone
 * @var list<array{id: int, installation_id: ?string, kompanie: string, variant: ?string, alert_key: string, detail: string, opened_at: string, last_seen_at: string, notified_at: ?string, resolved_at: ?string, resolved_notified_at: ?string}> $alerts
 * @var bool $ready
 * @var ?string $emailTo
 * @var ?string $pushKey
 * @var bool $pushConfigured
 * @var list<array{endpoint: string, created_at: string, last_error: ?string}> $subscriptions
 * @var bool $statusReceiver
 */

use Cockpit\Status\StatusView;
use Cockpit\View;

$open = array_values(array_filter($alerts, static fn (array $a): bool => $a['resolved_at'] === null));
$closed = array_values(array_filter($alerts, static fn (array $a): bool => $a['resolved_at'] !== null));
?>
<h1>Warnungen</h1>
<?php if (!$statusReceiver): ?>
  <p class="notice">Der Empfang der Statusmeldungen ist nicht eingeschaltet (Abschnitt <code>status_reports</code> in <code>config.php</code>).</p>
<?php elseif (!$ready): ?>
  <p class="muted">Die Tabellen entstehen beim nächsten Cron-Lauf.</p>
<?php endif; ?>

<section class="card">
  <h2>Offen</h2>
  <?php if ($open === []): ?>
    <p class="muted">Keine offenen Warnungen.</p>
  <?php else: ?>
    <ul class="events">
      <?php foreach ($open as $a): ?>
        <li>
          <span>
            <span class="badge fail"><?= $e(StatusView::alertLabel($a['alert_key'])) ?></span>
            <?php if ($a['installation_id'] !== null): ?><a href="/installation?id=<?= $e($a['installation_id']) ?>"><?= $e(StatusView::name($a['kompanie'])) ?></a><?php else: ?>Alle Kompanien<?php endif; ?>
            <?php if ($a['variant'] !== null): ?> · <?= $e(StatusView::variant($a['variant'])) ?><?php endif; ?>
            <br><small class="muted"><?= $e($a['detail']) ?></small>
          </span>
          <time>seit <?= $e(View::localTime($a['opened_at'], $timezone)) ?></time>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>

<div class="grid">
<section class="card">
  <h2>Behoben (30 Tage)</h2>
  <?php if ($closed === []): ?>
    <p class="muted">Keine.</p>
  <?php else: ?>
    <ul class="events">
      <?php foreach ($closed as $a): ?>
        <li>
          <span><?= $e(StatusView::alertLabel($a['alert_key'])) ?> · <?= $e($a['kompanie'] === '*' ? 'Alle Kompanien' : StatusView::name($a['kompanie'])) ?></span>
          <time><?= $e(View::localTime($a['opened_at'], $timezone)) ?> – <?= $e(View::localTime($a['resolved_at'], $timezone)) ?></time>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>

<section class="card">
  <h2>Benachrichtigungen</h2>
  <dl class="status">
    <dt>E-Mail</dt>
    <dd><?php if ($emailTo !== null): ?><?= $e($emailTo) ?><?php else: ?><span class="muted">nicht eingerichtet (Abschnitt <code>alerts</code> in <code>config.php</code>)</span><?php endif; ?></dd>
    <dt>Push</dt>
    <dd>
      <?php if (!$pushConfigured): ?>
        <span class="muted">nicht eingerichtet (Abschnitt <code>push</code> in <code>config.php</code>)</span>
      <?php elseif ($pushKey === null): ?>
        <span class="badge warn">VAPID-Schlüssel fehlt oder ist ungültig</span>
      <?php else: ?>
        <?= $e(count($subscriptions)) ?> Gerät(e) angemeldet
        <div id="push" data-key="<?= $e($pushKey) ?>" data-csrf="<?= $e($csrf) ?>" hidden>
          <p class="links">
            <button type="button" class="secondary compact" data-push="on">Push auf diesem Gerät einschalten</button>
            <button type="button" class="secondary compact" data-push="off" hidden>Push auf diesem Gerät ausschalten</button>
          </p>
          <p class="muted" data-push-status></p>
        </div>
        <noscript><p class="muted">Für Push braucht es JavaScript.</p></noscript>
        <?php foreach ($subscriptions as $s): ?>
          <?php if ($s['last_error'] !== null): ?><br><small class="error">Gerät seit <?= $e(View::localTime($s['created_at'], $timezone)) ?>: <?= $e($s['last_error']) ?></small><?php endif; ?>
        <?php endforeach; ?>
      <?php endif; ?>
    </dd>
  </dl>
  <p class="muted"><small>Eine Nachricht, wenn eine Warnung entsteht, und eine, wenn sie behoben ist; keine Wiederholung, solange sie offen ist. Auf dem iPhone geht Push erst, wenn das Cockpit zum Home-Bildschirm hinzugefügt ist.</small></p>
</section>
</div>
<script src="/assets/push.js" defer></script>
