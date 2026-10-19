<?php
/**
 * @var callable(mixed): string $e
 * @var string $csrf
 */
$error ??= null;
$username ??= '';
?>
<section class="card narrow">
  <h1>Anmelden</h1>
  <?php if ($error !== null): ?>
    <p class="error" role="alert"><?= $e($error) ?></p>
  <?php endif; ?>
  <form method="post" action="/login">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <label for="username">Benutzername</label>
    <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="<?= $e($username) ?>">
    <label for="password">Passwort</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Weiter</button>
  </form>
</section>
