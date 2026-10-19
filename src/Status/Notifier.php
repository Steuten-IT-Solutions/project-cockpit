<?php

declare(strict_types=1);

namespace Cockpit\Status;

use Closure;
use Cockpit\Notify\PushSubscriptionRepository;
use Cockpit\Notify\WebPush;
use Throwable;

/**
 * Sends alert messages: one e-mail per run with all new alerts and all-clears, and a web push
 * (without payload) to every subscribed device. Contents: company, variant, what is wrong, link.
 *
 * @phpstan-import-type Alert from AlertRepository
 */
final class Notifier
{
    /**
     * @param (Closure(string, string, string, string): bool)|null $mail to, subject, body, headers (default: mail())
     */
    public function __construct(
        private readonly string $baseUrl,
        private readonly ?string $emailTo,
        private readonly ?string $emailFrom,
        private readonly ?WebPush $push,
        private readonly ?PushSubscriptionRepository $subscriptions,
        private readonly ?Closure $mail = null,
    ) {
    }

    /**
     * @param list<Alert> $alerts not yet notified (new or resolved)
     * @return bool whether at least one channel delivered
     */
    public function send(array $alerts, int $now = 0): bool
    {
        if ($alerts === []) {
            return false;
        }
        [$subject, $body] = self::message($alerts, $this->baseUrl);
        $delivered = false;
        if ($this->emailTo !== null && $this->emailFrom !== null) {
            $headers = implode("\r\n", [
                'From: ' . $this->emailFrom,
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=UTF-8',
                'Content-Transfer-Encoding: 8bit',
            ]);
            $encoded = mb_encode_mimeheader($subject, 'UTF-8', 'Q');
            try {
                $delivered = $this->mail !== null
                    ? ($this->mail)($this->emailTo, $encoded, $body, $headers)
                    : mail($this->emailTo, $encoded, $body, $headers, '-f' . self::address($this->emailFrom));
            } catch (Throwable $e) {
                error_log('[cockpit alerts] mail: ' . $e->getMessage());
            }
        }
        if ($this->push !== null && $this->subscriptions !== null) {
            foreach ($this->subscriptions->all() as $sub) {
                try {
                    $status = $this->push->send($sub['endpoint'], $now > 0 ? $now : time());
                    if ($status === 404 || $status === 410) {
                        $this->subscriptions->remove($sub['endpoint']);
                    } elseif ($status >= 200 && $status < 300) {
                        $delivered = true;
                    } else {
                        $this->subscriptions->markError($sub['endpoint'], 'HTTP ' . $status);
                    }
                } catch (Throwable $e) {
                    $this->subscriptions->markError($sub['endpoint'], $e->getMessage());
                }
            }
        }

        return $delivered;
    }

    /**
     * Subject and plain-text body (German) for the alerts.
     *
     * @param list<Alert> $alerts
     * @return array{string, string}
     */
    public static function message(array $alerts, string $baseUrl): array
    {
        $new = array_values(array_filter($alerts, static fn (array $a): bool => $a['resolved_at'] === null || $a['notified_at'] === null));
        $resolved = array_values(array_filter($alerts, static fn (array $a): bool => $a['resolved_at'] !== null));
        $parts = [];
        if ($new !== []) {
            $parts[] = count($new) === 1 ? '1 Warnung' : count($new) . ' Warnungen';
        }
        if ($resolved !== []) {
            $parts[] = count($resolved) === 1 ? '1 Entwarnung' : count($resolved) . ' Entwarnungen';
        }
        $subject = 'Cockpit: ' . implode(', ', $parts);

        $lines = [];
        foreach ([['Neue Warnungen', $new], ['Entwarnung (Problem behoben)', $resolved]] as [$title, $list]) {
            if ($list === []) {
                continue;
            }
            $lines[] = $title . ':';
            foreach ($list as $a) {
                $who = $a['kompanie'] === '*' ? 'Alle Kompanien' : StatusView::name($a['kompanie']) . ($a['variant'] !== null ? ' (' . StatusView::variant($a['variant']) . ')' : '');
                $lines[] = '- ' . $who . ': ' . $a['detail'];
                if ($a['installation_id'] !== null) {
                    $lines[] = '  ' . $baseUrl . '/installation?id=' . $a['installation_id'];
                }
            }
            $lines[] = '';
        }
        $lines[] = 'Alle Warnungen: ' . $baseUrl . '/alerts';

        return [$subject, implode("\n", $lines) . "\n"];
    }

    /** The bare address of "Name <address>" or "address". */
    private static function address(string $from): string
    {
        return preg_match('/<([^>]+)>/', $from, $m) ? $m[1] : $from;
    }
}
