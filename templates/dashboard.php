<?php
/**
 * @var callable(mixed): string $e
 * @var string $timezone
 * @var array{id: int, username: string} $user
 * @var string $phpVersion
 * @var ?string $schemaVersion
 * @var array<string, mixed>|null $lastCron
 * @var int $recoveryLeft
 * @var list<array{event: string, created_at: string}> $events
 */

use Cockpit\View;

$eventLabels = [
    'login' => 'Anmeldung',
    'login_recovery' => 'Anmeldung mit Wiederherstellungscode',
    'login_failed' => 'Falsches Passwort',
    'code_failed' => 'Falscher Code',
    'login_throttled' => 'Gesperrt wegen Fehlversuchen',
    'logout' => 'Abmeldung',
    'setup' => 'Konto eingerichtet',
];
$cronAge = null;
if ($lastCron !== null && is_string($lastCron['started_at'] ?? null)) {
    $cronAge = time() - (int)strtotime($lastCron['started_at'] . ' UTC');
}
?>
<h1>Hallo, <?= $e($user['username']) ?></h1>
<p class="muted">Phase 1: Grundgerüst. Projektdaten folgen in Phase 2.</p>

<div class="grid">
<section class="card">
  <h2>Systemstatus</h2>
  <dl class="status">
    <dt>PHP (Web)</dt>
    <dd><?= $e($phpVersion) ?></dd>
    <dt>Datenbank-Schema</dt>
    <dd><?= $e($schemaVersion ?? 'nicht migriert') ?></dd>
    <dt>Letzter Cron-Lauf</dt>
    <dd>
      <?php if ($lastCron === null): ?>
        <span class="badge warn">noch keiner</span>
      <?php else: ?>
        <span class="badge <?= ($lastCron['status'] ?? '') === 'ok' && $cronAge !== null && $cronAge < 3600 ? 'ok' : 'warn' ?>">
          <?= $e($lastCron['status'] ?? '') ?></span>
        <?= $e(View::localTime($lastCron['started_at'] ?? null, $timezone)) ?>
        · PHP <?= $e($lastCron['php_version'] ?? '') ?> (<?= $e($lastCron['php_sapi'] ?? '') ?>)
        <?php if (!empty($lastCron['message'])): ?><br><small><?= $e($lastCron['message']) ?></small><?php endif; ?>
      <?php endif; ?>
    </dd>
    <dt>Wiederherstellungscodes</dt>
    <dd><span class="badge <?= $recoveryLeft >= 3 ? 'ok' : 'warn' ?>"><?= $e($recoveryLeft) ?> übrig</span></dd>
  </dl>
</section>

<section class="card">
  <h2>Letzte Anmeldeereignisse</h2>
  <?php if ($events === []): ?>
    <p class="muted">Keine Einträge.</p>
  <?php else: ?>
    <ul class="events">
      <?php foreach ($events as $event): ?>
        <li><span><?= $e($eventLabels[$event['event']] ?? $event['event']) ?></span>
          <time><?= $e(View::localTime($event['created_at'], $timezone)) ?></time></li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>
</div>
