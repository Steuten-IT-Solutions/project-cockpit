<?php
/**
 * @var callable(mixed): string $e
 * @var string $title
 * @var string $message
 */
?>
<section class="card narrow">
  <h1><?= $e($title) ?></h1>
  <p><?= $e($message) ?></p>
  <p><a href="/">Zur Startseite</a></p>
</section>
