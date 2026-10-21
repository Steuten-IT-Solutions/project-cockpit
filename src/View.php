<?php

declare(strict_types=1);

namespace Cockpit;

use RuntimeException;

/**
 * Renders plain PHP templates from templates/ inside templates/layout.php.
 * Templates must escape every dynamic value with $e().
 */
final class View
{
    public function __construct(private readonly string $directory)
    {
    }

    /**
     * @param array<string, mixed> $data
     */
    public function render(string $template, array $data = []): string
    {
        $content = $this->renderFile($template, $data);

        return $this->renderFile('layout', $data + ['content' => $content]);
    }

    /**
     * A template without the layout, e.g. a part of a page that a script reloads.
     *
     * @param array<string, mixed> $data
     */
    public function fragment(string $template, array $data = []): string
    {
        return $this->renderFile($template, $data);
    }

    public static function escape(mixed $value): string
    {
        return htmlspecialchars(is_scalar($value) ? (string)$value : '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /**
     * Formats a UTC timestamp from the database in the configured time zone.
     */
    public static function localTime(mixed $utc, string $timezone): string
    {
        if (!is_string($utc) || $utc === '') {
            return '–';
        }
        $date = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $utc, new \DateTimeZone('UTC'));
        if ($date === false) {
            return '–';
        }

        return $date->setTimezone(new \DateTimeZone($timezone))->format('d.m.Y H:i');
    }

    /**
     * @param array<string, mixed> $data
     */
    private function renderFile(string $template, array $data): string
    {
        if (!preg_match('/^[a-z0-9_\/-]+$/', $template)) {
            throw new RuntimeException('Invalid template name.');
        }
        $file = $this->directory . '/' . $template . '.php';
        if (!is_file($file)) {
            throw new RuntimeException(sprintf('Template %s is missing.', $template));
        }

        $e = self::escape(...);
        extract($data, EXTR_SKIP);
        ob_start();
        try {
            require $file;
        } finally {
            $output = (string)ob_get_clean();
        }

        return $output;
    }
}
