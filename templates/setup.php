<?php
/**
 * @var callable(mixed): string $e
 * @var string $csrf
 * @var string $token
 */
$error ??= null;
$username ??= '';
?>
<section class="card narrow">
  <h1>Einrichtung</h1>
  <p>Lege dein Konto an. Danach richtest du den zweiten Faktor ein. Diese Seite ist nur erreichbar, solange noch kein Konto existiert.</p>
  <?php if ($error !== null): ?>
    <p class="error" role="alert"><?= $e($error) ?></p>
  <?php endif; ?>
  <form method="post" action="/setup">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <input type="hidden" name="token" value="<?= $e($token) ?>">
    <label for="username">Benutzername</label>
    <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="64" value="<?= $e($username) ?>">
    <label for="password">Passwort (mindestens 12 Zeichen)</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required minlength="12">
    <label for="password_confirm">Passwort wiederholen</label>
    <input id="password_confirm" name="password_confirm" type="password" autocomplete="new-password" required minlength="12">
    <button type="submit">Weiter</button>
  </form>
</section>
