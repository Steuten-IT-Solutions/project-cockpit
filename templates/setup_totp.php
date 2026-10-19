<?php
/**
 * @var callable(mixed): string $e
 * @var string $csrf
 * @var string $token
 * @var string $qr
 * @var string $secret
 * @var ?string $error
 */
?>
<section class="card narrow">
  <h1>Zwei-Faktor einrichten</h1>
  <ol>
    <li>Öffne deine Authenticator-App und füge ein neues Konto hinzu.</li>
    <li>Scanne den QR-Code – oder tippe auf dem Handy den Schlüssel unten ab.</li>
    <li>Gib den angezeigten 6-stelligen Code ein.</li>
  </ol>
  <div class="qr"><img src="<?= $e($qr) ?>" alt="QR-Code für die Authenticator-App" width="220" height="220"></div>
  <p class="muted">Schlüssel zum Abtippen:</p>
  <p class="secret"><code><?= $e($secret) ?></code></p>
  <?php if ($error !== null): ?>
    <p class="error" role="alert"><?= $e($error) ?></p>
  <?php endif; ?>
  <form method="post" action="/setup/confirm">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <input type="hidden" name="token" value="<?= $e($token) ?>">
    <label for="code">Code aus der App</label>
    <input id="code" name="code" inputmode="numeric" pattern="\d{3}\s?\d{3}" autocomplete="one-time-code" required>
    <button type="submit">Bestätigen</button>
  </form>
</section>
