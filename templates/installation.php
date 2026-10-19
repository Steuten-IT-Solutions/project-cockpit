<?php
/**
 * @var callable(mixed): string $e
 * @var string $timezone
 * @var array{id: string, kompanie: string, variant: string, version: string, php: string, db_driver: string, cron_kind: string, cron_last: ?string, checks: array<string, string>, errors: array<string, int>, features: list<string>, update_ok: ?bool, update_at: ?string, update_to: ?string, update_check_ok: bool, gallery_ok: ?bool, gallery_at: ?string, first_seen: string, last_seen: string, last_heartbeat: ?string} $installation
 * @var list<array{type: string, received_at: string, version: string, code: ?string, checks: array<string, string>, errors: array<string, int>}> $history
 * @var list<array{id: int, alert_key: string, detail: string, opened_at: string, resolved_at: ?string}> $alerts
 */

use Cockpit\Status\StatusView;
use Cockpit\View;

$i = $installation;
$levelClass = static fn (string $level): string => match ($level) {
    'ok' => 'ok',
    'warn' => 'warn',
    'error' => 'fail',
    default => 'neutral',
};
?>
<p class="muted"><a href="/#installationen">← Alle Installationen</a></p>
<h1><?= $e(StatusView::name($i['kompanie'])) ?></h1>
<p class="owner"><?= $e(StatusView::variant($i['variant'])) ?> · Version <?= $e($i['version']) ?> · PHP <?= $e($i['php']) ?> / <?= $e($i['db_driver']) ?> · Installation <code><?= $e(substr($i['id'], 0, 8)) ?></code></p>

<div class="grid">
<section class="card">
  <h2>Zustand</h2>
  <p class="badges">
    <?php foreach ($i['checks'] as $key => $level): ?>
      <span class="badge <?= $e($levelClass($level)) ?>"><?= $e(StatusView::checkLabel($key)) ?></span>
    <?php endforeach; ?>
  </p>
  <dl class="status">
    <dt>Letztes Lebenszeichen</dt>
    <dd><?= $e(View::localTime($i['last_heartbeat'], $timezone)) ?></dd>
    <dt>Hintergrundaufgaben</dt>
    <dd><?= $e(StatusView::cronLabel($i['cron_kind'])) ?>, zuletzt <?= $e(View::localTime($i['cron_last'], $timezone)) ?></dd>
    <dt>Fehler (24 Stunden)</dt>
    <dd>
      <?php if ($i['errors'] === []): ?>keine<?php endif; ?>
      <?php foreach ($i['errors'] as $code => $count): ?>
        <?= $e(StatusView::codeLabel($code)) ?>: <?= $e($count) ?><br>
      <?php endforeach; ?>
    </dd>
    <dt>Bereiche</dt>
    <dd><?= $e($i['features'] === [] ? '–' : implode(', ', $i['features'])) ?></dd>
    <dt>Letztes Update</dt>
    <dd><?php if ($i['update_at'] !== null): ?><?= $e($i['update_ok'] ? 'ok' : 'gescheitert') ?><?= $e($i['update_to'] !== null ? ' (' . $i['update_to'] . ')' : '') ?>, <?= $e(View::localTime($i['update_at'], $timezone)) ?><?php else: ?>–<?php endif; ?></dd>
    <dt>Erste Meldung</dt>
    <dd><?= $e(View::localTime($i['first_seen'], $timezone)) ?></dd>
  </dl>
</section>

<section class="card">
  <h2>Warnungen</h2>
  <?php if ($alerts === []): ?>
    <p class="muted">Keine.</p>
  <?php else: ?>
    <ul class="events">
      <?php foreach ($alerts as $a): ?>
        <li>
          <span><span class="badge <?= $a['resolved_at'] === null ? 'fail' : 'neutral' ?>"><?= $e(StatusView::alertLabel($a['alert_key'])) ?></span></span>
          <time><?= $e(View::localTime($a['opened_at'], $timezone)) ?><?php if ($a['resolved_at'] !== null): ?> – <?= $e(View::localTime($a['resolved_at'], $timezone)) ?><?php endif; ?></time>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>
</div>

<section class="card">
  <h2>Verlauf</h2>
  <?php if ($history === []): ?>
    <p class="muted">Noch keine Meldungen.</p>
  <?php else: ?>
    <ul class="events">
      <?php foreach ($history as $h): ?>
        <li>
          <span>
            <?php if ($h['type'] === 'event'): ?>
              <span class="badge fail"><?= $e(StatusView::codeLabel((string)$h['code'])) ?></span>
            <?php else: ?>
              Lebenszeichen
              <?php $red = array_keys(array_filter($h['checks'], static fn (string $l): bool => $l === 'error')); ?>
              <?php foreach ($red as $key): ?><span class="badge fail"><?= $e(StatusView::checkLabel($key)) ?></span><?php endforeach; ?>
              <?php if ($h['errors'] !== []): ?><small class="muted"><?= $e(array_sum($h['errors'])) ?> Fehler in 24 h</small><?php endif; ?>
            <?php endif; ?>
            <small class="muted">· <?= $e($h['version']) ?></small>
          </span>
          <time><?= $e(View::localTime($h['received_at'], $timezone)) ?></time>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>
