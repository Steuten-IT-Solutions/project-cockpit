<?php
/**
 * @var callable(mixed): string $e
 * @var string $csrf
 * @var string $timezone
 * @var list<array<string, mixed>> $costs
 * @var list<array<string, mixed>> $projects
 * @var bool $vercelConfigured
 * @var array<string, ?string>|null $billing
 * @var list<array{service: string, category: string, project: ?string, billed_cost: float, effective_cost: float, currency: string}> $charges
 * @var array<string, string> $form
 * @var ?string $error
 * @var bool $ready
 */

use Cockpit\Costs\Cost;
use Cockpit\View;

$totals = Cost::totals($costs);
$f = static fn (string $key, string $default = ''): string => $form[$key] ?? $default;

// Vercel charges: totals per currency, per category and per service (amounts in currency units).
$sum = static function (array $charges, string $field): array {
    $out = [];
    foreach ($charges as $c) {
        $key = $c[$field] ?? '–';
        $out[$key][$c['currency']] = ($out[$key][$c['currency']] ?? 0.0) + $c['billed_cost'];
    }
    uasort($out, static fn (array $a, array $b): int => array_sum($b) <=> array_sum($a));

    return $out;
};
$money = static fn (array $byCurrency): string => implode(', ', array_map(
    static fn (string $cur, float $v): string => Cost::money($v * 100, $cur),
    array_keys($byCurrency),
    array_values($byCurrency),
));
$categoryLabels = ['Usage' => 'Nutzung', 'Purchase' => 'Käufe', 'Credit' => 'Gutschriften', 'Tax' => 'Steuern', 'Adjustment' => 'Korrekturen', 'Other' => 'Sonstiges'];
$total = $sum(array_map(static fn (array $c): array => ['all' => 'all'] + $c, $charges), 'all')['all'] ?? [];
$byCategory = $sum($charges, 'category');
$byService = array_filter($sum($charges, 'service'), static fn (array $v): bool => abs(array_sum($v)) >= 0.005);
$byProject = array_filter($sum(array_values(array_filter($charges, static fn (array $c): bool => $c['project'] !== null)), 'project'), static fn (array $v): bool => abs(array_sum($v)) >= 0.005);
?>
<h1>Kosten</h1>
<?php if (!$ready): ?>
  <p class="notice">Die Tabellen für Kosten entstehen beim nächsten Cron-Lauf. Auf der Übersicht „Jetzt aktualisieren“ wählen.</p>
<?php endif; ?>

<div class="grid">
<section class="card">
  <h2>Feste Kosten</h2>
  <?php if ($totals === []): ?>
    <p class="muted">Noch keine Einträge.</p>
  <?php else: ?>
    <dl class="status">
      <?php foreach ($totals as $currency => $t): ?>
        <dt>Summe <?= $e($currency) ?></dt>
        <dd><strong><?= $e(Cost::money($t['month'], $currency)) ?></strong> pro Monat · <?= $e(Cost::money($t['year'], $currency)) ?> pro Jahr</dd>
      <?php endforeach; ?>
    </dl>
    <?php if (count($totals) > 1): ?><p class="muted"><small>Währungen werden nicht umgerechnet.</small></p><?php endif; ?>
    <ul class="costs">
      <?php foreach ($costs as $c): ?>
        <li>
          <div>
            <strong><?= $e($c['name']) ?></strong>
            <span class="muted"><?= $e(Cost::money((float)$c['amount_cents'], (string)$c['currency'])) ?> <?= $e(Cost::INTERVALS[$c['billing_interval']] ?? $c['billing_interval']) ?></span>
            <br><small class="muted"><?= $e(implode(' · ', array_filter([
                $c['provider'],
                $c['project_name'] !== null ? 'Projekt ' . $c['project_name'] : null,
                $c['note'],
            ], static fn ($v): bool => $v !== null))) ?></small>
          </div>
          <form method="post" action="/costs/delete">
            <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
            <input type="hidden" name="id" value="<?= $e($c['id']) ?>">
            <button type="submit" class="secondary compact" aria-label="<?= $e($c['name']) ?> löschen">Löschen</button>
          </form>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>

<section class="card">
  <h2>Eintrag hinzufügen</h2>
  <?php if ($error !== null): ?><p class="error" role="alert"><?= $e($error) ?></p><?php endif; ?>
  <form method="post" action="/costs">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <label for="name">Name</label>
    <input id="name" name="name" maxlength="100" required value="<?= $e($f('name')) ?>" placeholder="z. B. Domain steuten-it-solutions.de">
    <label for="provider">Anbieter <span class="muted">(optional)</span></label>
    <input id="provider" name="provider" maxlength="100" value="<?= $e($f('provider')) ?>" placeholder="z. B. IONOS">
    <div class="fields">
      <div>
        <label for="amount">Betrag</label>
        <input id="amount" name="amount" inputmode="decimal" required value="<?= $e($f('amount')) ?>" placeholder="12,99">
      </div>
      <div>
        <label for="currency">Währung</label>
        <select id="currency" name="currency">
          <?php foreach (Cost::CURRENCIES as $code => $symbol): ?>
            <option value="<?= $e($code) ?>"<?= $f('currency', 'EUR') === $code ? ' selected' : '' ?>><?= $e($code) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div>
        <label for="interval">Intervall</label>
        <select id="interval" name="interval">
          <?php foreach (Cost::INTERVALS as $code => $label): ?>
            <option value="<?= $e($code) ?>"<?= $f('interval', 'month') === $code ? ' selected' : '' ?>><?= $e($label) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
    </div>
    <label for="project">Projekt <span class="muted">(optional)</span></label>
    <select id="project" name="project">
      <option value="">– keins –</option>
      <?php foreach ($projects as $p): ?>
        <option value="<?= $e($p['id']) ?>"<?= $f('project') === (string)$p['id'] ? ' selected' : '' ?>><?= $e($p['name']) ?></option>
      <?php endforeach; ?>
    </select>
    <label for="note">Notiz <span class="muted">(optional)</span></label>
    <input id="note" name="note" maxlength="255" value="<?= $e($f('note')) ?>" placeholder="z. B. verlängert sich am 1. März">
    <button type="submit">Hinzufügen</button>
  </form>
</section>
</div>

<?php if ($vercelConfigured): ?>
<h2 class="section">Vercel</h2>
<section class="card">
  <?php if ($billing === null): ?>
    <p class="muted">Noch kein Abruf. Die Kosten erscheinen nach dem nächsten Cron-Lauf.</p>
  <?php else: ?>
    <?php if ($billing['error'] !== null): ?>
      <p class="error">Letzter Abruf fehlgeschlagen (<?= $e(View::localTime($billing['error_at'], $timezone)) ?>): <?= $e($billing['error']) ?></p>
    <?php endif; ?>
    <?php if ($billing['synced_at'] === null): ?>
      <p class="muted">Noch keine Daten von Vercel.</p>
    <?php else: ?>
      <?php $toInclusive = $billing['period_to'] !== null ? gmdate('d.m.Y', (int)strtotime($billing['period_to'] . ' UTC') - 86400) : ''; ?>
      <p class="muted">Zeitraum <?= $e($billing['period_from'] !== null ? gmdate('d.m.Y', (int)strtotime($billing['period_from'] . ' UTC')) : '') ?> – <?= $e($toInclusive) ?> (UTC) · Stand <?= $e(View::localTime($billing['synced_at'], $timezone)) ?></p>
      <dl class="status">
        <dt>Summe</dt>
        <dd><strong><?= $e($total === [] ? 'keine Posten' : $money($total)) ?></strong></dd>
        <?php foreach ($byCategory as $category => $amounts): ?>
          <dt><?= $e($categoryLabels[$category] ?? $category) ?></dt>
          <dd><?= $e($money($amounts)) ?></dd>
        <?php endforeach; ?>
      </dl>
      <p class="muted"><small>Summen der Posten, die Vercel über die Abrechnungs-API meldet (BilledCost). Maßgeblich bleibt die Rechnung im Vercel-Dashboard.</small></p>
      <?php if ($byService !== []): ?>
        <h3>Nach Dienst</h3>
        <ul class="events">
          <?php foreach ($byService as $service => $amounts): ?>
            <li><span><?= $e($service) ?></span><span><?= $e($money($amounts)) ?></span></li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
      <?php if ($byProject !== []): ?>
        <h3>Nach Projekt</h3>
        <ul class="events">
          <?php foreach ($byProject as $project => $amounts): ?>
            <li><span><?= $e($project) ?></span><span><?= $e($money($amounts)) ?></span></li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
    <?php endif; ?>
  <?php endif; ?>
</section>
<?php endif; ?>
