<?php

declare(strict_types=1);

namespace Cockpit\Status;

/**
 * Which alerts should be open right now (pure: no database, no clock).
 *
 * - silent: no heartbeat for 2 h (real cron, WP-Cron) or 24 h (pseudo-cron, tasks only on page views)
 * - check:<key>: a traffic light of the installation is red (not in maintenance mode: tasks are paused on purpose)
 * - event:<code>: a severe error was reported in the last 24 h (not CHECK_ERROR: the red light has its own alert)
 * - release:<version>: several installations on the same version reported severe errors in the last 24 h
 *   (update failed, PHP fatal, database error): the hint to withdraw it. Only installations known for a
 *   day count, so freshly registered ones cannot raise it.
 *
 * Yellow (warn, error counts) is shown in the cockpit but raises no alert.
 *
 * @phpstan-import-type Installation from InstallationRepository
 * @phpstan-type Wanted array{installation_id: ?string, kompanie: string, variant: ?string, alert_key: string, detail: string}
 */
final class AlertRules
{
    public const SILENT_REAL = 2 * 3600;
    public const SILENT_PSEUDO = 24 * 3600;
    /** An event keeps its alert open this long after it was last reported. */
    public const EVENT_HOLD = 24 * 3600;
    /** Installations on one version that must report severe errors for a release alert. */
    public const RELEASE_MIN = 2;
    /** Events that point to a broken release. */
    public const RELEASE_CODES = ['UPDATE_FAILED', 'PHP_FATAL', 'DB_ERROR'];
    /** Installations younger than this do not count for a release alert. */
    public const RELEASE_MIN_AGE = 86400;

    /**
     * @param list<Installation> $installations
     * @param list<array{installation_id: string, code: string, version: string, received_at: string}> $events
     * @return array<string, Wanted> by identity (installation id or kompanie, plus alert key)
     */
    public static function wanted(array $installations, array $events, int $now): array
    {
        $byId = [];
        foreach ($installations as $i) {
            $byId[$i['id']] = $i;
        }
        $wanted = [];
        $red = [];
        foreach ($installations as $i) {
            $last = self::ts($i['last_heartbeat'] ?? null) ?? self::ts($i['first_seen']);
            $limit = $i['cron_kind'] === 'pseudo' ? self::SILENT_PSEUDO : self::SILENT_REAL;
            if ($last !== null && $now - $last > $limit) {
                self::add($wanted, $i, 'silent', sprintf('kein Lebenszeichen seit über %d Stunden', intdiv($limit, 3600)));
            }
            foreach ($i['maintenance'] ? [] : $i['checks'] as $key => $level) {
                if ($level === 'error') {
                    self::add($wanted, $i, 'check:' . $key, StatusView::checkLabel($key) . ': rot');
                }
            }
        }
        foreach ($events as $event) {
            $i = $byId[$event['installation_id']] ?? null;
            $at = self::ts($event['received_at']);
            if ($i === null || $at === null || $now - $at > self::EVENT_HOLD || $event['code'] === 'CHECK_ERROR') {
                continue;
            }
            self::add($wanted, $i, 'event:' . $event['code'], StatusView::codeLabel($event['code']));
            $since = self::ts($i['first_seen']);
            if (in_array($event['code'], self::RELEASE_CODES, true) && $since !== null && $now - $since >= self::RELEASE_MIN_AGE) {
                $red[$event['version']][$i['id']] = true;
            }
        }
        foreach ($red as $version => $ids) {
            if (count($ids) >= self::RELEASE_MIN) {
                $kompanien = [];
                foreach (array_keys($ids) as $id) {
                    $kompanien[StatusView::name($byId[$id]['kompanie'])] = true;
                }
                $key = 'release:' . $version;
                $wanted['*|' . $key] = [
                    'installation_id' => null,
                    'kompanie' => '*',
                    'variant' => null,
                    'alert_key' => $key,
                    'detail' => mb_substr(sprintf('Schwere Fehler nach Release %s (%d Installationen: %s) – zurückziehen?', (string)$version, count($ids),
                        implode(', ', array_keys($kompanien))), 0, 255),
                ];
            }
        }

        return $wanted;
    }

    /**
     * Compares the wanted alerts with the open ones.
     *
     * @param array<string, Wanted> $wanted
     * @param list<array{id: int, installation_id: ?string, kompanie: string, alert_key: string, detail: string}> $open
     * @return array{open: list<Wanted>, touch: list<array{id: int, detail: string}>, resolve: list<int>}
     */
    public static function diff(array $wanted, array $open): array
    {
        $out = ['open' => [], 'touch' => [], 'resolve' => []];
        $seen = [];
        foreach ($open as $alert) {
            $identity = self::identity($alert);
            if (isset($wanted[$identity]) && !isset($seen[$identity])) {
                $seen[$identity] = true;
                $out['touch'][] = ['id' => $alert['id'], 'detail' => $wanted[$identity]['detail']];
            } else {
                $out['resolve'][] = $alert['id'];
            }
        }
        foreach ($wanted as $identity => $alert) {
            if (!isset($seen[$identity])) {
                $out['open'][] = $alert;
            }
        }

        return $out;
    }

    /**
     * Identity of an alert row, matching the keys of wanted().
     *
     * @param array{installation_id: ?string, kompanie: string, alert_key: string} $alert
     */
    public static function identity(array $alert): string
    {
        return ($alert['installation_id'] ?? $alert['kompanie']) . '|' . $alert['alert_key'];
    }

    /**
     * @param array<string, Wanted> $wanted
     * @param Installation $i
     */
    private static function add(array &$wanted, array $i, string $key, string $detail): void
    {
        $wanted[$i['id'] . '|' . $key] = [
            'installation_id' => $i['id'],
            'kompanie' => $i['kompanie'],
            'variant' => $i['variant'],
            'alert_key' => $key,
            'detail' => mb_substr($detail, 0, 255),
        ];
    }

    private static function ts(?string $utc): ?int
    {
        if ($utc === null) {
            return null;
        }
        $ts = strtotime($utc . ' UTC');

        return $ts === false ? null : $ts;
    }
}
