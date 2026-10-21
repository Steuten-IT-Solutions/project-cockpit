<?php
/**
 * Content of the release box on the dashboard; also served alone at GET /releases for assets/releases.js.
 *
 * @var callable(mixed): string $e
 * @var string $timezone
 * @var ?string $repo
 * @var bool $webhook
 * @var array<string, array{running: list<array<string, mixed>>, last: ?array<string, mixed>, failed: ?array<string, mixed>}>|null $summary
 */

use Cockpit\Projects\ProjectView;
use Cockpit\Releases\ReleaseView;
use Cockpit\View;

$now = time();
?>
<h2>Releases der Kompanie-App</h2>
<?php if ($repo === null): ?>
  <p class="muted">Für diese Anzeige den Abschnitt <code>releases</code> in <code>config.php</code> eintragen (siehe README).</p>
<?php elseif ($summary === null): ?>
  <p class="muted">Noch keine Daten. Sie erscheinen nach dem nächsten Cron-Lauf.</p>
<?php else: ?>
  <dl class="status">
    <?php foreach (ReleaseView::CHANNELS as $channel => $label): ?>
      <?php $c = $summary[$channel]; ?>
      <dt><?= $e($label) ?></dt>
      <dd>
        <?php foreach ($c['running'] as $r): ?>
          <p class="release"><a class="badge live" href="<?= $e($r['html_url']) ?>" rel="noopener noreferrer" target="_blank"><?= $e($label) ?>-Release läuft</a>
            <?php if ($r['core_version'] !== null): ?>Kern <?= $e($r['core_version']) ?> · <?php endif; ?>gestartet <?= $e(ProjectView::age($r['started_at'], $now)) ?><?php if ($r['title'] !== null): ?> · <?= $e($r['title']) ?><?php endif; ?></p>
        <?php endforeach; ?>
        <?php if ($c['last'] !== null): ?>
          <p class="release">Zuletzt: Kern <strong><?= $e($c['last']['core_version'] ?? 'unbekannt') ?></strong>
            am <?= $e(View::localTime($c['last']['updated_at'], $timezone)) ?> (<?= $e(ProjectView::age($c['last']['updated_at'], $now)) ?>)
            · <a href="<?= $e($c['last']['html_url']) ?>" rel="noopener noreferrer" target="_blank"><?= $e($c['last']['title'] ?? 'Lauf') ?></a></p>
        <?php else: ?>
          <p class="release muted">Noch kein erfolgreiches Release erfasst.</p>
        <?php endif; ?>
        <?php if ($c['failed'] !== null): ?>
          <p class="release"><a class="badge fail" href="<?= $e($c['failed']['html_url']) ?>" rel="noopener noreferrer" target="_blank">Letzter Lauf <?= $e(ReleaseView::conclusion($c['failed']['conclusion'])) ?></a>
            <?= $e(View::localTime($c['failed']['updated_at'], $timezone)) ?><?php if ($c['failed']['title'] !== null): ?> · <?= $e($c['failed']['title']) ?><?php endif; ?></p>
        <?php endif; ?>
      </dd>
    <?php endforeach; ?>
  </dl>
  <p class="muted"><small><?= $e($repo) ?> · Zeit = Ende des Workflow-Laufs<?php if (!$webhook): ?> · ohne Webhook erst nach dem nächsten Cron-Lauf aktuell<?php endif; ?></small></p>
<?php endif; ?>
