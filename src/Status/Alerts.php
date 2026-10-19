<?php

declare(strict_types=1);

namespace Cockpit\Status;

/**
 * Evaluates the status reports and notifies (cron, every 15 minutes): opens alerts for new problems,
 * resolves those that disappeared, then sends one message per run for everything not yet notified.
 * No repeats while an alert stays open.
 */
final class Alerts
{
    /** Resolved alerts are kept as long as the history. */
    public const KEEP_DAYS = 90;

    public function __construct(
        private readonly InstallationRepository $installations,
        private readonly AlertRepository $alerts,
        private readonly ?Notifier $notifier,
    ) {
    }

    /**
     * @return array{opened: int, resolved: int, notified: bool}
     */
    public function run(int $now): array
    {
        $at = gmdate('Y-m-d H:i:s', $now);
        $wanted = AlertRules::wanted(
            $this->installations->all(),
            $this->installations->eventsSince(gmdate('Y-m-d H:i:s', $now - AlertRules::EVENT_HOLD)),
            $now,
        );
        $diff = AlertRules::diff($wanted, $this->alerts->open());
        foreach ($diff['open'] as $alert) {
            $this->alerts->openAlert($alert, $at);
        }
        foreach ($diff['touch'] as $touch) {
            $this->alerts->touch($touch['id'], $touch['detail'], $at);
        }
        foreach ($diff['resolve'] as $id) {
            $this->alerts->resolve($id, $at);
        }

        $notified = false;
        $pending = $this->alerts->unnotified();
        if ($pending !== [] && $this->notifier !== null) {
            // Marked as notified even if a channel failed: otherwise every run would send again.
            $notified = $this->notifier->send($pending, $now);
            $this->alerts->markNotified(array_map(static fn (array $a): int => $a['id'], $pending), $at);
        }
        $this->alerts->prune(gmdate('Y-m-d H:i:s', $now - self::KEEP_DAYS * 86400));

        return ['opened' => count($diff['open']), 'resolved' => count($diff['resolve']), 'notified' => $notified];
    }
}
