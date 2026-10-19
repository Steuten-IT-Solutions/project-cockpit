<?php
/**
 * @var callable(mixed): string $e
 * @var string $title
 * @var string $content
 * @var string $csrf
 * @var ?string $flash
 * @var bool $loggedIn
 */
?><!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title><?= $e($title) ?> · Cockpit</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="manifest" href="/manifest.webmanifest">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">Cockpit</a>
  <?php if ($loggedIn): ?>
    <nav class="topnav" aria-label="Hauptnavigation">
      <a href="/">Projekte</a>
      <a href="/alerts">Warnungen</a>
      <a href="/costs">Kosten</a>
      <form method="post" action="/logout">
        <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
        <button type="submit" class="link">Abmelden</button>
      </form>
    </nav>
  <?php endif; ?>
</header>
<main>
  <?php if ($flash !== null): ?>
    <p class="notice" role="status"><?= $e($flash) ?></p>
  <?php endif; ?>
  <?= $content ?>
</main>
</body>
</html>
