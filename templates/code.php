<?php
/**
 * @var callable(mixed): string $e
 * @var string $csrf
 */
$error ??= null;
?>
<section class="card narrow">
  <h1>Bestätigungscode</h1>
  <p>Gib den 6-stelligen Code aus deiner Authenticator-App ein – oder einen deiner Wiederherstellungscodes.</p>
  <?php if ($error !== null): ?>
    <p class="error" role="alert"><?= $e($error) ?></p>
  <?php endif; ?>
  <form method="post" action="/login/code">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <label for="code">Code</label>
    <input id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required autofocus>
    <button type="submit">Anmelden</button>
  </form>
  <p class="muted"><a href="/login">Zurück</a></p>
</section>
