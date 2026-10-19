<?php
/**
 * @var callable(mixed): string $e
 * @var list<string> $codes
 */
?>
<section class="card narrow">
  <h1>Einrichtung abgeschlossen</h1>
  <p><strong>Speichere diese Wiederherstellungscodes jetzt</strong> – zum Beispiel im Passwort-Manager.
    Jeder Code funktioniert genau einmal, falls du keinen Zugriff auf die Authenticator-App hast.
    Sie werden nur dieses eine Mal angezeigt.</p>
  <ul class="codes">
    <?php foreach ($codes as $code): ?>
      <li><code><?= $e($code) ?></code></li>
    <?php endforeach; ?>
  </ul>
  <p>Entferne danach den Wert <code>setup_token</code> aus <code>config/config.php</code>.</p>
  <p><a class="button" href="/login">Zur Anmeldung</a></p>
</section>
