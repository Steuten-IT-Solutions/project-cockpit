<?php

declare(strict_types=1);

namespace Cockpit\Jobs;

use Cockpit\Config;
use Cockpit\Database\Migrator;
use Cockpit\GitHub\Client;
use Cockpit\GitHub\Sync;
use Cockpit\Projects\ProjectRepository;
use Cockpit\Reports\BugReportRepository;
use Cockpit\Reports\BugReportSync;
use Cockpit\Notify\PushSubscriptionRepository;
use Cockpit\Notify\WebPush;
use Cockpit\Status\AlertRepository;
use Cockpit\Status\Alerts;
use Cockpit\Status\InstallationRepository;
use Cockpit\Status\Notifier;
use Cockpit\Status\Receiver;
use Cockpit\Status\StatusRepository;
use Cockpit\Costs\Cost;
use Cockpit\Vercel\BillingRepository;
use Cockpit\Vercel\BillingSync;
use Cockpit\Vercel\Client as VercelClient;
use Cockpit\Vercel\Sync as VercelSync;
use Cockpit\Vercel\VercelRepository;
use PDO;
use RuntimeException;
use Throwable;

/**
 * One run of the background jobs: migrations, then every data source. Started by
 * cron/run.php every 15 minutes and by the refresh button on the dashboard.
 */
final class Runner
{
    private const LOCK = 'cockpit_cron';

    public function __construct(
        private readonly Config $config,
        private readonly PDO $pdo,
        private readonly string $root,
    ) {
    }

    /**
     * Seconds since the last run started, or null if there was none (or no table yet).
     */
    public function secondsSinceLastRun(int $now): ?int
    {
        try {
            $stmt = $this->pdo->prepare('SELECT MAX(started_at) FROM cron_runs');
            $stmt->execute();
            $last = $stmt->fetchColumn();
        } catch (\PDOException) {
            return null;
        }
        $ts = is_string($last) ? strtotime($last . ' UTC') : false;

        return $ts === false ? null : max(0, $now - $ts);
    }

    /**
     * @param string $trigger shown with the run's message, e.g. "Manuell gestartet"
     * @return array{status: string, message: ?string}|null null if another run holds the lock
     */
    public function run(?string $trigger = null): ?array
    {
        if (!$this->lock()) {
            return null;
        }

        try {
            return $this->execute($trigger);
        } finally {
            $this->unlock();
        }
    }

    /**
     * @return array{status: string, message: string|null}
     */
    private function execute(?string $trigger): array
    {
        $applied = (new Migrator($this->pdo, $this->root . '/migrations'))->migrate();

        $this->pdo->prepare('INSERT INTO cron_runs (started_at, php_version, php_sapi, status) VALUES (?, ?, ?, ?)')
            ->execute([gmdate('Y-m-d H:i:s'), PHP_VERSION, PHP_SAPI, 'running']);
        $runId = (int)$this->pdo->lastInsertId();

        $status = 'ok';
        // Shown on the dashboard, so in German.
        $messages = [];
        if ($trigger !== null) {
            $messages[] = $trigger;
        }
        if ($applied !== []) {
            $messages[] = 'Migrationen angewendet: ' . implode(', ', $applied);
        }
        if (version_compare(PHP_VERSION, '8.3.0', '<')) {
            $status = 'warn';
            $messages[] = 'PHP ' . PHP_VERSION . ' ist zu alt; im Cron-Manager PHP 8.4 wählen.';
        }

        // Each source has its own error handling, so one failing source does not stop the others.
        if ($this->config->github !== null) {
            try {
                $github = $this->config->github;
                $key = @file_get_contents($github['private_key_file']);
                if ($key === false) {
                    throw new RuntimeException('Schlüsseldatei der GitHub App nicht lesbar.');
                }
                $client = new Client($github['client_id'], $key, $github['api_base']);
                $result = (new Sync($client, new ProjectRepository($this->pdo), $github['accounts']))->run(time());
                $messages[] = sprintf('GitHub: %d Repos aktualisiert', $result['repos']);
                if ($result['errors'] !== []) {
                    $status = 'warn';
                    $messages[] = sprintf('%d Fehler, z. B. %s', count($result['errors']), $result['errors'][0]);
                }
            } catch (Throwable $e) {
                $status = 'warn';
                $messages[] = 'GitHub: ' . $e->getMessage();
            }
        }

        if ($this->config->vercel !== null) {
            try {
                $vercel = $this->config->vercel;
                $client = new VercelClient($vercel['token'], $vercel['team_id'], $vercel['api_base']);
                $result = (new VercelSync($client, new VercelRepository($this->pdo)))->run(time());
                $messages[] = sprintf('Vercel: %d Projekte', $result['projects']);
                if ($result['errors'] !== []) {
                    $status = 'warn';
                    $messages[] = sprintf('%d Fehler, z. B. %s', count($result['errors']), $result['errors'][0]);
                }
            } catch (Throwable $e) {
                $status = 'warn';
                $messages[] = 'Vercel: ' . $e->getMessage();
            }

            if ($vercel['billing']) {
                $billing = new BillingRepository($this->pdo);
                try {
                    $client = new VercelClient($vercel['token'], $vercel['team_id'], $vercel['api_base']);
                    $totals = (new BillingSync($client, $billing))->run(time());
                    $amounts = [];
                    foreach ($totals as $currency => $amount) {
                        $amounts[] = Cost::money($amount * 100, $currency);
                    }
                    $messages[] = 'Vercel-Kosten seit Monatsbeginn: ' . ($amounts === [] ? 'keine' : implode(', ', $amounts));
                } catch (Throwable $e) {
                    $status = 'warn';
                    $messages[] = 'Vercel-Kosten: ' . $e->getMessage();
                    $billing->fail($e->getMessage(), gmdate('Y-m-d H:i:s'));
                }
            }
        }

        // Status reports format 2: evaluate, alert, prune (history 90 days).
        if ($this->config->statusReports !== null) {
            try {
                $installations = new InstallationRepository($this->pdo);
                $installations->prune(gmdate('Y-m-d H:i:s', time() - Alerts::KEEP_DAYS * 86400), gmdate('Y-m-d H:i:s', time() - 2 * Receiver::REPLAY_WINDOW));
                $pushError = null;
                $result = (new Alerts($installations, new AlertRepository($this->pdo), $this->notifier($pushError)))->run(time());
                if ($pushError !== null) {
                    $status = 'warn';
                    $messages[] = 'Push: ' . $pushError;
                }
                if ($result['opened'] > 0 || $result['resolved'] > 0) {
                    $messages[] = sprintf('Warnungen: %d neu, %d behoben', $result['opened'], $result['resolved']);
                }
            } catch (Throwable $e) {
                $status = 'warn';
                $messages[] = 'Warnungen: Auswertung fehlgeschlagen (Details im Fehlerprotokoll).';
                error_log(sprintf('[cockpit alerts] %s: %s in %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
            }
        }

        // Bug reports of the company apps: issues in the private reports repository (Kompanie-App-Template#64).
        if ($this->config->bugReports !== null && $this->config->statusReports !== null) {
            try {
                $reports = new BugReportRepository($this->pdo);
                $reports->prune(time());
                $result = BugReportSync::fromConfig($this->config, $reports)?->run(time());
                if ($result !== null && $result['created'] > 0) {
                    $messages[] = sprintf('Fehlermeldungen: %d als Issue angelegt', $result['created']);
                }
                if ($result !== null && $result['errors'] !== []) {
                    $status = 'warn';
                    $messages[] = sprintf('Fehlermeldungen: %d nicht angelegt, z. B. %s', $result['failed'], $result['errors'][0]);
                }
            } catch (Throwable $e) {
                $status = 'warn';
                $messages[] = 'Fehlermeldungen: ' . $e->getMessage();
            }
        }

        $message = $messages === [] ? null : mb_substr(implode(' · ', $messages), 0, 255);
        $this->pdo->prepare('UPDATE cron_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?')
            ->execute([gmdate('Y-m-d H:i:s'), $status, $message, $runId]);

        // Keep 30 days of history.
        $this->pdo->prepare('DELETE FROM cron_runs WHERE started_at < ?')
            ->execute([gmdate('Y-m-d H:i:s', time() - 30 * 86400)]);
        // The receiver prunes too, but only when a report arrives.
        (new StatusRepository($this->pdo))->pruneBefore(gmdate('Y-m-d H:i:s', time() - Receiver::KEEP_DAYS * 86400));

        return ['status' => $status, 'message' => $message];
    }

    /**
     * E-mail and push as configured; null if neither is. A broken push key does not stop the e-mails.
     *
     * @param ?string $pushError set to the reason when push is configured but unusable
     */
    private function notifier(?string &$pushError): ?Notifier
    {
        $push = null;
        if ($this->config->push !== null) {
            $pem = @file_get_contents($this->config->push['private_key_file']);
            try {
                $push = $pem === false ? null : new WebPush($pem, $this->config->push['subject']);
                $pushError = $pem === false ? 'VAPID-Schlüssel nicht lesbar.' : null;
            } catch (RuntimeException $e) {
                $pushError = 'VAPID-Schlüssel ungültig (EC P-256 im PEM-Format erwartet).';
            }
        }
        if ($push === null && $this->config->alerts === null) {
            return null;
        }

        return new Notifier(
            $this->config->baseUrl,
            $this->config->alerts['email'] ?? null,
            $this->config->alerts['from'] ?? null,
            $push,
            $push !== null ? new PushSubscriptionRepository($this->pdo) : null,
        );
    }

    private function lock(): bool
    {
        if ($this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql') {
            return true;
        }
        $stmt = $this->pdo->prepare('SELECT GET_LOCK(?, 0)');
        $stmt->execute([self::LOCK]);

        return (int)$stmt->fetchColumn() === 1;
    }

    private function unlock(): void
    {
        if ($this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
            $this->pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([self::LOCK]);
        }
    }
}
