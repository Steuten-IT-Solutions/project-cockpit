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
 * @var list<array<string, mixed>> $reports
 * @var array<int, list<array<string, mixed>>> $reportsByRepo
 * @var array<string, string> $releaseByRepo
 * @var string $releasesHtml rendered templates/releases.php
 * @var bool $statusReceiver
 * @var list<array<string, mixed>> $installations format 2
 * @var list<array<string, mixed>> $openAlerts
 */

use Cockpit\Projects\ProjectView;
use Cockpit\Status\StatusView;
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
$now = time();
// Project card of each reporting company, to link the installation to it.
$reportProject = [];
foreach ($reportsByRepo as $repoId => $list) {
    foreach ($list as $r) {
        $reportProject[$r['kompanie'] . '|' . $r['variant']] = $repoId;
    }
}
// Format 2: open alerts per installation, project card per company.
$alertsByInstallation = [];
foreach ($openAlerts as $a) {
    if ($a['installation_id'] !== null) {
        $alertsByInstallation[$a['installation_id']][] = $a;
    }
}
$releaseAlerts = array_values(array_filter($openAlerts, static fn (array $a): bool => $a['installation_id'] === null));
$repoByName = [];
foreach ($projects ?? [] as $p) {
    $repoByName[strtolower((string)$p['full_name'])] = (int)$p['id'];
}
// Format 1 rows of companies that already send format 2 are outdated.
$format2 = [];
foreach ($installations as $i) {
    $format2[strtolower($i['kompanie']) . '|' . $i['variant']] = true;
}
$reports = array_values(array_filter($reports, static fn (array $r): bool => !isset($format2[strtolower($r['kompanie']) . '|' . $r['variant']])));
$installationsByRepo = [];
foreach ($installations as $i) {
    $repoId = $repoByName[strtolower($i['kompanie'])] ?? null;
    if ($repoId !== null) {
        $installationsByRepo[$repoId][] = $i;
    }
}
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
<section class="card releases" id="releases" data-poll="/releases" aria-live="polite">
<?= $releasesHtml ?>
</section>
<script src="/assets/releases.js" defer></script>

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
          <?php if (($installationsByRepo[$p['id']] ?? []) !== []): ?>
            <?php $red = array_filter($installationsByRepo[$p['id']], static fn (array $i): bool => isset($alertsByInstallation[$i['id']])); ?>
            <a class="badge <?= $red === [] ? 'ok' : 'fail' ?>" href="#installationen"><?= $red === [] ? 'Installation ok' : 'Installation: Warnung' ?></a>
          <?php elseif (($reportsByRepo[$p['id']] ?? []) !== []): ?>
            <?php $failing = array_filter($reportsByRepo[$p['id']], static fn (array $r): bool => StatusView::problems($r, $now) !== []); ?>
            <a class="badge <?= $failing === [] ? 'ok' : 'warn' ?>" href="#installationen"><?= $failing === [] ? 'Installation ok' : 'Installation: Problem' ?></a>
          <?php endif; ?>
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

<?php if ($statusReceiver || $reports !== [] || $installations !== []): ?>
  <h2 class="section" id="installationen">Kompanie-Installationen</h2>
  <?php foreach ($releaseAlerts as $a): ?>
    <p class="error"><a href="/alerts"><?= $e($a['detail']) ?></a></p>
  <?php endforeach; ?>
  <?php if ($installations === [] && $reports === []): ?>
    <p class="muted">Noch keine Meldungen. Installationen melden sich stündlich, sobald ein Admin unter <em>Einstellungen → Updates</em> zugestimmt hat.</p>
  <?php endif; ?>
  <?php if ($installations !== []): ?>
    <div class="projects">
      <?php foreach ($installations as $i): ?>
        <?php
        $alerts = $alertsByInstallation[$i['id']] ?? [];
        $light = StatusView::light($i, $alerts !== []);
        $newer = StatusView::newerRelease($i['version'], $releaseByRepo[strtolower($i['kompanie'])] ?? null);
        ?>
        <article class="card project">
          <h2><a href="/installation?id=<?= $e($i['id']) ?>"><?= $e(StatusView::name($i['kompanie'])) ?></a></h2>
          <p class="owner"><?= $e(StatusView::variant($i['variant'])) ?> · Version <?= $e($i['version']) ?> · PHP <?= $e($i['php']) ?> / <?= $e($i['db_driver']) ?></p>
          <p class="badges">
            <?php if ($light === 'ok'): ?><span class="badge ok">in Ordnung</span><?php elseif ($light === 'warn'): ?><span class="badge warn">Hinweise</span><?php elseif ($light === 'maintenance'): ?><span class="badge neutral">in Wartung</span><?php endif; ?>
            <?php foreach ($alerts as $a): ?><span class="badge fail"><?= $e(StatusView::alertLabel($a['alert_key'])) ?></span><?php endforeach; ?>
            <?php if ($newer !== null): ?><span class="badge neutral"><?= $e($newer) ?> veröffentlicht</span><?php endif; ?>
          </p>
          <p class="stats">Lebenszeichen <?= $e(ProjectView::age($i['last_heartbeat'] ?? $i['last_seen'], $now)) ?> · <?= $e(StatusView::cronLabel($i['cron_kind'])) ?></p>
        </article>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>
  <?php if ($reports !== []): ?>
    <p class="muted">Ältere Installationen (Format 1, täglich, nicht signiert – nur ein Hinweis):</p>
    <div class="projects">
      <?php foreach ($reports as $r): ?>
        <?php
        $problems = StatusView::problems($r, $now);
        $newer = StatusView::newerRelease($r['version'], $releaseByRepo[strtolower($r['kompanie'])] ?? null);
        $repoId = $reportProject[$r['kompanie'] . '|' . $r['variant']] ?? null;
        ?>
        <article class="card project">
          <h2><?php if ($repoId !== null): ?><a href="/project?id=<?= $e($repoId) ?>"><?= $e(StatusView::name($r['kompanie'])) ?></a><?php else: ?><?= $e(StatusView::name($r['kompanie'])) ?><?php endif; ?></h2>
          <p class="owner"><?= $e(StatusView::variant($r['variant'])) ?> · Version <?= $e($r['version']) ?> · PHP <?= $e($r['php']) ?> / <?= $e($r['db_driver']) ?></p>
          <p class="badges">
            <?php if ($problems === []): ?><span class="badge ok">in Ordnung</span><?php endif; ?>
            <?php foreach ($problems as $problem): ?><span class="badge warn"><?= $e($problem) ?></span><?php endforeach; ?>
            <?php if ($newer !== null): ?><span class="badge neutral"><?= $e($newer) ?> veröffentlicht</span><?php endif; ?>
          </p>
          <p class="stats">Meldung <?= $e(ProjectView::age($r['received_at'], $now)) ?><?php if ($r['update_at'] !== null): ?> · Update <?= $e(ProjectView::age($r['update_at'], $now)) ?><?php endif; ?></p>
        </article>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>
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
