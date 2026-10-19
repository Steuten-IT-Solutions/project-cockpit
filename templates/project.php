<?php
/**
 * @var callable(mixed): string $e
 * @var string $csrf
 * @var string $timezone
 * @var array<string, mixed> $project
 * @var list<array{id: int, body: string, created_at: string}> $history
 */

use Cockpit\Projects\ProjectView;
use Cockpit\View;

$p = $project;
[$ciLabel, $ciClass] = ProjectView::ci($p['ci_status'], $p['ci_conclusion']);
$current = $history[0]['body'] ?? '';
$links = [
    'Repository' => $p['html_url'],
    'Issues' => $p['html_url'] . '/issues',
    'Pull Requests' => $p['html_url'] . '/pulls',
    'Actions' => $p['html_url'] . '/actions',
    'Releases' => $p['html_url'] . '/releases',
];
?>
<p class="muted"><a href="/">← Alle Projekte</a></p>
<h1><?= $e($p['name']) ?></h1>
<p class="owner"><?= $e($p['full_name']) ?><?php if ($p['is_private']): ?> · privat<?php endif; ?><?php if ($p['is_archived']): ?> · archiviert<?php endif; ?><?php if (!$p['available']): ?> · für die GitHub App nicht mehr freigegeben<?php endif; ?></p>
<?php if ($p['description'] !== null): ?><p><?= $e($p['description']) ?></p><?php endif; ?>

<div class="grid">
<section class="card">
  <h2>Status</h2>
  <dl class="status">
    <dt>CI (<?= $e($p['default_branch']) ?>)</dt>
    <dd>
      <span class="badge <?= $e($ciClass) ?>"><?= $e($ciLabel) ?></span>
      <?php if ($p['ci_workflow'] !== null): ?><?= $e($p['ci_workflow']) ?>,<?php endif; ?>
      <?= $e(ProjectView::age($p['ci_at'], time())) ?>
      <?php if ($p['ci_url'] !== null): ?> · <a href="<?= $e($p['ci_url']) ?>" rel="noopener noreferrer" target="_blank">Lauf öffnen</a><?php endif; ?>
    </dd>
    <dt>Letztes Release</dt>
    <dd>
      <?php if ($p['release_tag'] === null): ?>–<?php else: ?>
        <?php if ($p['release_url'] !== null): ?><a href="<?= $e($p['release_url']) ?>" rel="noopener noreferrer" target="_blank"><?= $e($p['release_tag']) ?></a><?php else: ?><?= $e($p['release_tag']) ?><?php endif; ?>
        · <?= $e(View::localTime($p['release_at'], $timezone)) ?>
      <?php endif; ?>
    </dd>
    <dt>Offen</dt>
    <dd><?= $e($p['open_issues']) ?> Issues · <?= $e($p['open_prs']) ?> Pull Requests</dd>
    <dt>Letzter Push</dt>
    <dd><?= $e(View::localTime($p['pushed_at'], $timezone)) ?></dd>
    <dt>Abgerufen</dt>
    <dd><?= $e(View::localTime($p['synced_at'], $timezone)) ?><?php if ($p['sync_error'] !== null): ?><br><small class="error"><?= $e($p['sync_error']) ?></small><?php endif; ?></dd>
  </dl>
  <p class="links">
    <?php foreach ($links as $label => $url): ?>
      <a href="<?= $e($url) ?>" rel="noopener noreferrer" target="_blank"><?= $e($label) ?></a>
    <?php endforeach; ?>
  </p>
  <form method="post" action="/project/visibility">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <input type="hidden" name="id" value="<?= $e($p['id']) ?>">
    <input type="hidden" name="hidden" value="<?= $p['hidden'] ? '0' : '1' ?>">
    <button type="submit" class="secondary"><?= $p['hidden'] ? 'Wieder in der Übersicht anzeigen' : 'In der Übersicht ausblenden' ?></button>
  </form>
</section>

<section class="card">
  <h2>Notiz</h2>
  <form method="post" action="/project/note">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <input type="hidden" name="id" value="<?= $e($p['id']) ?>">
    <label for="body" class="visually-hidden">Notiz</label>
    <textarea id="body" name="body" rows="10" maxlength="100000"><?= $e($current) ?></textarea>
    <button type="submit">Speichern</button>
  </form>
  <?php if (count($history) > 1): ?>
    <h3>Frühere Fassungen</h3>
    <?php foreach (array_slice($history, 1) as $version): ?>
      <details class="version">
        <summary><?= $e(View::localTime($version['created_at'], $timezone)) ?></summary>
        <pre><?= $e($version['body']) ?></pre>
      </details>
    <?php endforeach; ?>
  <?php endif; ?>
</section>
</div>
