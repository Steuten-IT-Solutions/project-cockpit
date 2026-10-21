<?php

declare(strict_types=1);

namespace Cockpit\Reports;

/**
 * Validates one bug report of a company app and renders it as a GitHub issue.
 *
 * The payload is built by packages/core/src/Domain/BugReportService.php in Steuten-IT-Solutions/Kompanie-App-Template
 * (wire format: docs/FEHLERMELDUNGEN.md there). Everything arrives from the internet, so only known fields with the
 * expected shapes are kept. Free text is never interpreted: in the issue it sits in code blocks and code spans, so
 * it can neither mention people, reference issues nor inject markup.
 *
 * @phpstan-type Fields array{
 *     description: string, expected: string, page: string, version: string, variant: string, userAgent: string,
 *     role: string, name: ?string, lastError: ?string, created: int
 * }
 * @phpstan-type Incoming array{
 *     installation: string, kompanie: string, sent: int, nonce: string, key: ?string, report_id: string,
 *     fields: Fields, screenshot: ?string, screenshot_type: ?string
 * }
 */
final class BugReport
{
    public const MAX_TEXT = 2000;
    public const MAX_SCREENSHOT = 2 * 1024 * 1024;
    /** Longest edge and area of a screenshot in pixels, as in the app. */
    public const MAX_EDGE = 10000;
    public const MAX_PIXELS = 40_000_000;
    public const TYPES = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];
    private const MIN_TIMESTAMP = 1577836800;

    /**
     * @return Incoming|null null if the payload is not a valid report of the organisation
     */
    public static function fromPayload(mixed $in, string $org, int $now): ?array
    {
        $r = is_array($in) ? ($in['report'] ?? null) : null;
        if (!is_array($in) || ($in['format'] ?? null) !== 1 || !is_array($r)) {
            return null;
        }
        $installation = $in['installation'] ?? null;
        $kompanie = $in['kompanie'] ?? null;
        $nonce = $in['nonce'] ?? null;
        $sent = $in['sent'] ?? null;
        $key = $in['key'] ?? null;
        $id = $r['id'] ?? null;
        if (!is_string($installation) || !preg_match('/^[0-9a-f]{32}$/D', $installation)
            || !is_string($kompanie) || !preg_match('~^' . preg_quote($org, '~') . '/[A-Za-z0-9_.-]{1,100}$~D', $kompanie)
            || !is_string($nonce) || !preg_match('/^[0-9a-f]{16}$/D', $nonce) || !is_int($sent)
            || ($key !== null && (!is_string($key) || !preg_match('/^[0-9a-f]{64}$/D', $key)))
            || !is_string($id) || !preg_match('/^[0-9a-f]{32}$/D', $id)) {
            return null;
        }

        $description = self::text($r['description'] ?? null, self::MAX_TEXT, true);
        $expected = self::text($r['expected'] ?? '', self::MAX_TEXT, true);
        $page = self::text($r['page'] ?? '', 200, false);
        $userAgent = self::text($r['userAgent'] ?? '', 400, false);
        $role = self::text($r['role'] ?? null, 100, false);
        // Optional texts: null stays null, anything else must be a valid, non-empty text.
        $rawName = $r['name'] ?? null;
        $name = $rawName === null ? null : self::text($rawName, 100, false);
        $rawError = $r['lastError'] ?? null;
        $lastError = $rawError === null ? null : self::text($rawError, 500, false);
        $version = $r['version'] ?? null;
        $variant = $r['variant'] ?? null;
        $created = $r['created'] ?? null;
        if ($description === null || $description === '' || $expected === null || $page === null || $userAgent === null
            || $role === null || $role === ''
            || ($rawName !== null && ($name === null || $name === ''))
            || ($rawError !== null && $lastError === null)
            || !is_string($version) || !preg_match('/^[0-9A-Za-z.+-]{1,30}$/D', $version)
            || ($variant !== 'wordpress' && $variant !== 'standalone')
            || !is_int($created) || $created < self::MIN_TIMESTAMP || $created > $now + 86400) {
            return null;
        }

        $shot = $in['screenshot'] ?? null;
        $bytes = null;
        $type = null;
        if ($shot !== null) {
            $checked = self::screenshot($shot);
            if ($checked === null) {
                return null;
            }
            [$bytes, $type] = $checked;
        }

        return [
            'installation' => $installation,
            'kompanie' => $kompanie,
            'sent' => $sent,
            'nonce' => $nonce,
            'key' => $key,
            'report_id' => $id,
            'fields' => [
                'description' => $description,
                'expected' => $expected,
                'page' => $page,
                'version' => $version,
                'variant' => $variant,
                'userAgent' => $userAgent,
                'role' => $role,
                'name' => $name,
                'lastError' => $lastError,
                'created' => $created,
            ],
            'screenshot' => $bytes,
            'screenshot_type' => $type,
        ];
    }

    /**
     * Issue title: the first line of the description, shortened.
     */
    public static function title(string $description): string
    {
        $line = trim(explode("\n", $description)[0]);
        $line = (string)preg_replace('/\s+/u', ' ', $line);

        return mb_strlen($line) > 120 ? rtrim(mb_substr($line, 0, 119)) . '…' : $line;
    }

    /**
     * Label of a company: prefix and the repository name, lower case, at most 50 characters (GitHub's limit).
     */
    public static function label(string $prefix, string $kompanie): string
    {
        $slug = strtolower((string)substr($kompanie, (int)strrpos($kompanie, '/') + 1));

        return mb_substr($prefix . $slug, 0, 50);
    }

    /**
     * Issue body: a table of the attached details, then description, expectation and screenshot.
     *
     * @param Fields $fields
     */
    public static function body(array $fields, string $kompanie, string $installation, string $reportId, ?string $screenshotUrl, string $timezone): string
    {
        $time = (new \DateTimeImmutable('@' . $fields['created']))->setTimezone(new \DateTimeZone($timezone))->format('d.m.Y H:i');
        $rows = [
            'Kompanie' => $kompanie,
            'Seite in der App' => $fields['page'] === '' ? '–' : $fields['page'],
            'App-Version' => $fields['version'] . ' (' . $fields['variant'] . ')',
            'Gerät/Browser' => $fields['userAgent'] === '' ? '–' : $fields['userAgent'],
            'Rolle' => $fields['role'],
            'Name' => $fields['name'] ?? '– (nicht mitgeschickt)',
            'Zeit' => $time . ' (' . $timezone . ')',
            'Letzte Fehlermeldung' => $fields['lastError'] ?? '–',
            'Installation' => $installation,
            'Meldungs-ID' => $reportId,
        ];
        $out = "| Angabe | Wert |\n|---|---|\n";
        foreach ($rows as $label => $value) {
            $out .= '| ' . $label . ' | ' . self::cell($value) . " |\n";
        }
        $out .= "\n### Beschreibung\n\n" . self::block($fields['description']) . "\n";
        if ($fields['expected'] !== '') {
            $out .= "\n### Erwartet\n\n" . self::block($fields['expected']) . "\n";
        }
        if ($screenshotUrl !== null) {
            $out .= "\n### Bildschirmfoto\n\n![Bildschirmfoto](" . $screenshotUrl . "?raw=true)\n\n[Bildschirmfoto öffnen](" . $screenshotUrl . ")\n";
        }

        return $out . "\n<sub>Gemeldet über „Fehler melden“ in der App, mit Einwilligung der meldenden Person.</sub>\n";
    }

    /**
     * Text in a fenced code block whose fence is longer than any backtick run inside.
     */
    public static function block(string $text): string
    {
        $fence = str_repeat('`', max(3, self::longestRun($text, '`') + 1));

        return $fence . "text\n" . $text . "\n" . $fence;
    }

    /**
     * A table cell as a code span: no mentions, links or markup; pipes escaped for the table.
     */
    public static function cell(string $value): string
    {
        $value = trim((string)preg_replace('/\s+/u', ' ', $value));
        $ticks = str_repeat('`', self::longestRun($value, '`') + 1);
        $value = str_replace('|', '\\|', $value);

        return $ticks . ' ' . $value . ' ' . $ticks;
    }

    private static function longestRun(string $text, string $char): int
    {
        $max = 0;
        if (preg_match_all('/' . preg_quote($char, '/') . '+/', $text, $m)) {
            foreach ($m[0] as $run) {
                $max = max($max, strlen($run));
            }
        }

        return $max;
    }

    /**
     * Valid UTF-8 without control characters (line breaks only when multiline), trimmed; null if not a string or
     * too long.
     */
    private static function text(mixed $value, int $max, bool $multiline): ?string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) {
            return null;
        }
        $value = str_replace(["\r\n", "\r"], "\n", $value);
        $value = (string)preg_replace($multiline ? '/[\x00-\x08\x0B-\x1F\x7F]/u' : '/[\x00-\x1F\x7F]+/u', $multiline ? '' : ' ', $value);
        $value = trim($value);

        return mb_strlen($value) > $max ? null : $value;
    }

    /**
     * Base64 image of a known type that really is one, with sane dimensions.
     *
     * @return array{string, string}|null bytes and MIME type
     */
    private static function screenshot(mixed $shot): ?array
    {
        $type = is_array($shot) ? ($shot['type'] ?? null) : null;
        $data = is_array($shot) ? ($shot['data'] ?? null) : null;
        if (!is_string($type) || !isset(self::TYPES[$type]) || !is_string($data)) {
            return null;
        }
        if (strlen($data) > intdiv(self::MAX_SCREENSHOT * 4, 3) + 8) {
            return null;
        }
        $bytes = base64_decode($data, true);
        if ($bytes === false || $bytes === '' || strlen($bytes) > self::MAX_SCREENSHOT) {
            return null;
        }
        $info = @getimagesizefromstring($bytes);
        if ($info === false || $info['mime'] !== $type || $info[0] < 1 || $info[1] < 1
            || $info[0] > self::MAX_EDGE || $info[1] > self::MAX_EDGE || $info[0] * $info[1] > self::MAX_PIXELS) {
            return null;
        }

        return [$bytes, $type];
    }
}
