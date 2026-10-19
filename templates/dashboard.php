<?php
/**
 * @var callable(mixed): string $e
 * @var string $timezone
 * @var array{id: int, username: string} $user
 * @var string $phpVersion
 * @var ?string $schemaVersion
 * @var array<string, mixed>|null $lastCron
 * @var string $cronCommand
 * @var int $recoveryLeft
 * @var list<array{event: string, created_at: string}> $events
 * @var list<array<string, mixed>>|null $projects
 * @var int $hiddenCount
 * @var bool $showHidden
 * @var ?string $lastSync
 * @var bool $githubConfigured
 * @var string $csrf
 * @var array<int, list<array<string, mixed>>> $vercelByRepo
 * @var list<array<string, mixed>> $vercelUnmatched
 */

use Cockpit\Projects\ProjectView;
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
<div class="page-head">
  <h1>Projekte</h1>
  <form method="post" action="/refresh">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <button type="submit" class="secondary compact">Jetzt aktualisieren</button>
  </form>
</div>
<?php if (!$githubConfigured): ?>
  <p class="notice">Die GitHub App ist noch nicht in <code>config.php</code> eingetragen. Projekte erscheinen nach dem Eintragen beim nächsten Cron-Lauf.</p>
<?php elseif ($projects === null || ($projects === [] && $hiddenCount === 0)): ?>
  <p class="muted">Noch keine Projektdaten. Sie erscheinen nach dem nächsten Cron-Lauf (alle 15 Minuten).</p>
<?php else: ?>
  <p class="muted">Stand: <?= $e(View::localTime($lastSync, $timezone)) ?> ·
    <?php if ($showHidden): ?><a href="/">Ausgeblendete verbergen</a><?php elseif ($hiddenCount > 0): ?><a href="/?all=1"><?= $e($hiddenCount) ?> ausgeblendete anzeigen</a><?php else: ?>alle angezeigt<?php endif; ?></p>
  <div class="projects">
    <?php foreach ($projects as $p): ?>
      <?php [$ciLabel, $ciClass] = ProjectView::ci($p['ci_status'], $p['ci_conclusion']); ?>
      <article class="card project<?= $p['hidden'] ? ' is-hidden' : '' ?>">
        <h2><a href="/project?id=<?= $e($p['id']) ?>"><?= $e($p['name']) ?></a></h2>
        <p class="owner"><?= $e($p['owner']) ?><?php if ($p['is_private']): ?> · privat<?php endif; ?><?php if ($p['is_archived']): ?> · archiviert<?php endif; ?><?php if ($p['is_fork']): ?> · Fork<?php endif; ?><?php if ($p['hidden']): ?> · ausgeblendet<?php endif; ?></p>
        <p class="badges">
          <?php if ($p['ci_url'] !== null): ?><a class="badge <?= $e($ciClass) ?>" href="<?= $e($p['ci_url']) ?>" rel="noopener noreferrer" target="_blank"><?= $e($ciLabel) ?></a><?php else: ?><span class="badge <?= $e($ciClass) ?>"><?= $e($ciLabel) ?></span><?php endif; ?>
          <?php foreach ($vercelByRepo[$p['id']] ?? [] as $v): ?>
            <?php [$vLabel, $vClass] = ProjectView::vercel($v['deploy_state']); ?>
            <?php if ($v['deploy_inspector_url'] !== null): ?><a class="badge <?= $e($vClass) ?>" href="<?= $e($v['deploy_inspector_url']) ?>" rel="noopener noreferrer" target="_blank"><?= $e($vLabel) ?></a><?php else: ?><span class="badge <?= $e($vClass) ?>"><?= $e($vLabel) ?></span><?php endif; ?>
          <?php endforeach; ?>
          <?php if ($p['release_tag'] !== null): ?><span class="badge neutral"><?= $e($p['release_tag']) ?></span><?php endif; ?>
          <?php if ($p['has_note']): ?><span class="badge neutral">Notiz</span><?php endif; ?>
        </p>
        <p class="stats"><?= $e($p['open_issues']) ?> Issues · <?= $e($p['open_prs']) ?> PRs · Push <?= $e(ProjectView::age($p['pushed_at'], time())) ?></p>
        <?php if ($p['sync_error'] !== null): ?><p class="error"><small>Abruf fehlgeschlagen: <?= $e($p['sync_error']) ?></small></p><?php endif; ?>
      </article>
    <?php endforeach; ?>
  </div>
<?php endif; ?>

<?php if ($vercelUnmatched !== []): ?>
  <h2 class="section">Vercel ohne GitHub-Karte</h2>
  <div class="projects">
    <?php foreach ($vercelUnmatched as $v): ?>
      <?php [$vLabel, $vClass] = ProjectView::vercel($v['deploy_state']); ?>
      <article class="card project">
        <h2><?= $e($v['name']) ?></h2>
        <p class="owner"><?= $v['repo_full_name'] !== null ? $e($v['repo_full_name']) . ' · für die GitHub App nicht freigegeben' : 'ohne Git-Verbindung' ?></p>
        <p class="badges">
          <?php if ($v['deploy_inspector_url'] !== null): ?><a class="badge <?= $e($vClass) ?>" href="<?= $e($v['deploy_inspector_url']) ?>" rel="noopener noreferrer" target="_blank"><?= $e($vLabel) ?></a><?php else: ?><span class="badge <?= $e($vClass) ?>"><?= $e($vLabel) ?></span><?php endif; ?>
        </p>
        <p class="stats">Deployment <?= $e(ProjectView::age($v['deploy_created_at'], time())) ?><?php if ($v['production_domain'] !== null): ?> · <a href="https://<?= $e($v['production_domain']) ?>" rel="noopener noreferrer" target="_blank"><?= $e($v['production_domain']) ?></a><?php endif; ?></p>
      </article>
    <?php endforeach; ?>
  </div>
<?php endif; ?>

<h2 class="section">System</h2>

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
    <dt>Cron-Befehl</dt>
    <dd>
      <code class="path"><?= $e($cronCommand) ?></code>
      <?php if (!preg_match('#^[A-Za-z0-9_./-]+$#', $cronCommand)): ?>
        <br><small class="error">Der Pfad enthält Zeichen, die der IONOS Cron-Manager nicht annimmt.</small>
      <?php endif; ?>
      <br><small class="muted">Im IONOS Cron-Manager als UnixCron eintragen, Minuten <code>*/15</code>, alle anderen Felder <code>*</code>.</small>
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
