<?php

declare(strict_types=1);

namespace Cockpit;

use Cockpit\Auth\AuthLog;
use Cockpit\Auth\RecoveryCodes;
use Cockpit\Auth\Throttle;
use Cockpit\Auth\Totp;
use Cockpit\Auth\UserRepository;
use Cockpit\Costs\Cost;
use Cockpit\Costs\CostRepository;
use Cockpit\Database\Connection;
use Cockpit\Database\Migrator;
use Cockpit\Http\Request;
use Cockpit\Http\Response;
use Cockpit\Http\Router;
use Cockpit\Jobs\Runner;
use Cockpit\Notify\PushSubscriptionRepository;
use Cockpit\Notify\WebPush;
use Cockpit\Projects\NoteRepository;
use Cockpit\Projects\ProjectRepository;
use Cockpit\Status\AlertRepository;
use Cockpit\Status\Alerts;
use Cockpit\Status\InstallationRepository;
use Cockpit\Status\StatusRepository;
use Cockpit\Vercel\BillingRepository;
use Cockpit\Vercel\VercelRepository;
use Cockpit\Security\Crypto;
use Cockpit\Security\Csrf;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use PDO;

final class App
{
    private const ISSUER = 'Steuten IT Cockpit';
    /** Seconds between the password step and the second factor. */
    private const PENDING_TTL = 300;
    /** Minimum seconds between two runs started with the refresh button. */
    private const REFRESH_INTERVAL = 60;

    private readonly Crypto $crypto;
    private readonly UserRepository $users;
    private readonly Throttle $throttle;
    private readonly AuthLog $log;
    private readonly View $view;

    public function __construct(
        private readonly Config $config,
        private readonly PDO $pdo,
        private readonly Session $session,
        private readonly string $root,
        public readonly bool $secure,
    ) {
        $this->crypto = new Crypto($config->appKey);
        $this->users = new UserRepository($pdo);
        $this->throttle = new Throttle($pdo, $this->crypto);
        $this->log = new AuthLog($pdo, $this->crypto);
        $this->view = new View($root . '/templates');
    }

    public static function boot(string $root, Request $request): self
    {
        $config = Config::load($root . '/config/config.php');
        date_default_timezone_set('UTC');

        // The configured origin is authoritative: behind a TLS-terminating proxy
        // $_SERVER['HTTPS'] can be unset although the browser talks HTTPS, and the
        // session cookie must still be Secure and HSTS still be sent.
        $secure = $request->secure || str_starts_with($config->baseUrl, 'https://');

        $session = new Session($root . '/var/sessions', $secure, $config->idleTimeout, $config->absoluteTimeout);
        $session->start();

        return new self($config, Connection::create($config->database), $session, $root, $secure);
    }

    public function handle(Request $request): Response
    {
        $router = new Router();
        $router->add('GET', '/', $this->dashboard(...));
        $router->add('GET', '/project', $this->project(...));
        $router->add('POST', '/project/note', $this->saveNote(...));
        $router->add('POST', '/project/visibility', $this->setVisibility(...));
        $router->add('POST', '/refresh', $this->refresh(...));
        $router->add('GET', '/alerts', $this->alerts(...));
        $router->add('GET', '/installation', $this->installation(...));
        $router->add('POST', '/push/subscribe', $this->pushSubscribe(...));
        $router->add('POST', '/push/unsubscribe', $this->pushUnsubscribe(...));
        $router->add('GET', '/costs', $this->costs(...));
        $router->add('POST', '/costs', $this->addCost(...));
        $router->add('POST', '/costs/delete', $this->deleteCost(...));
        $router->add('GET', '/login', $this->loginForm(...));
        $router->add('POST', '/login', $this->login(...));
        $router->add('GET', '/login/code', $this->codeForm(...));
        $router->add('POST', '/login/code', $this->code(...));
        $router->add('POST', '/logout', $this->logout(...));
        $router->add('GET', '/setup', $this->setupForm(...));
        $router->add('POST', '/setup', $this->setupStart(...));
        $router->add('POST', '/setup/confirm', $this->setupConfirm(...));

        if ($request->method === 'POST' && !Csrf::isValid($this->session->data(), $request->input('_csrf'))) {
            return $this->page('error', ['title' => 'Sitzung abgelaufen', 'message' => 'Bitte lade die Seite neu und versuche es noch einmal.'], 400);
        }

        $response = $router->dispatch($request);
        if ($response->status === 404 && $response->body === '') {
            return $this->page('error', ['title' => 'Nicht gefunden', 'message' => 'Diese Seite gibt es nicht.'], 404);
        }

        return $response;
    }

    // ------------------------------------------------------------------ pages

    private function dashboard(Request $request): Response
    {
        $user = $this->currentUser();
        if ($user === null) {
            return Response::redirect('/login');
        }

        $stmt = $this->pdo->prepare(
            'SELECT started_at, finished_at, php_version, php_sapi, status, message FROM cron_runs ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute();
        $lastCron = $stmt->fetch() ?: null;

        $projects = null;
        $lastSync = null;
        $vercelByRepo = [];
        $vercelUnmatched = [];
        $reports = [];
        $reportsByRepo = [];
        $installations = [];
        $openAlerts = [];
        try {
            $repository = new ProjectRepository($this->pdo);
            $projects = $repository->all();
            $lastSync = $repository->lastSync();
            [$vercelByRepo, $vercelUnmatched] = $this->vercelProjects($projects);
            $reports = (new StatusRepository($this->pdo))->all();
            $reportsByRepo = StatusRepository::byRepository($reports, self::repoRefs($projects));
            $installations = (new InstallationRepository($this->pdo))->all();
            $openAlerts = (new AlertRepository($this->pdo))->open();
        } catch (\PDOException) {
            // New tables appear with the next cron run after a deployment.
        }
        $releaseByRepo = self::releaseByRepo($projects ?? []);
        $showHidden = $request->query('all') === '1';
        $hiddenCount = $projects === null ? 0 : count(array_filter($projects, static fn (array $p): bool => $p['hidden']));
        if ($projects !== null && !$showHidden) {
            $projects = array_values(array_filter($projects, static fn (array $p): bool => !$p['hidden']));
        }

        return $this->page('dashboard', [
            'title' => 'Übersicht',
            'user' => $user,
            'projects' => $projects,
            'hiddenCount' => $hiddenCount,
            'showHidden' => $showHidden,
            'lastSync' => $lastSync,
            'githubConfigured' => $this->config->github !== null,
            'vercelByRepo' => $vercelByRepo,
            'vercelUnmatched' => $vercelUnmatched,
            'reports' => $reports,
            'reportsByRepo' => $reportsByRepo,
            'installations' => $installations,
            'openAlerts' => $openAlerts,
            'releaseByRepo' => $releaseByRepo,
            'statusReceiver' => $this->config->statusReports !== null,
            'phpVersion' => PHP_VERSION,
            'schemaVersion' => (new Migrator($this->pdo, $this->root . '/migrations'))->currentVersion(),
            // Absolute path for the IONOS cron manager, which only accepts a bare path.
            'cronCommand' => (realpath($this->root) ?: $this->root) . '/cron/run.sh',
            'lastCron' => $lastCron,
            'recoveryLeft' => $this->users->remainingRecoveryCodes($user['id']),
            'events' => $this->log->recent($user['id'], 8),
        ]);
    }

    private function project(Request $request): Response
    {
        $user = $this->currentUser();
        if ($user === null) {
            return Response::redirect('/login');
        }
        $project = ctype_digit($request->query('id')) ? (new ProjectRepository($this->pdo))->find((int)$request->query('id')) : null;
        if ($project === null) {
            return new Response(404);
        }
        $notes = new NoteRepository($this->pdo);
        try {
            [$vercelByRepo] = $this->vercelProjects([$project]);
        } catch (\PDOException) {
            $vercelByRepo = [];
        }
        try {
            $reportsByRepo = StatusRepository::byRepository((new StatusRepository($this->pdo))->all(), self::repoRefs([$project]));
        } catch (\PDOException) {
            $reportsByRepo = [];
        }
        try {
            $costs = (new CostRepository($this->pdo))->all($project['id']);
        } catch (\PDOException) {
            $costs = [];
        }

        return $this->page('project', [
            'title' => $project['name'],
            'project' => $project,
            'vercel' => $vercelByRepo[$project['id']] ?? [],
            'reports' => $reportsByRepo[$project['id']] ?? [],
            'costs' => $costs,
            'history' => $notes->history($project['id'], 20),
        ]);
    }

    private function alerts(Request $request): Response
    {
        $user = $this->currentUser();
        if ($user === null) {
            return Response::redirect('/login');
        }
        try {
            $alerts = (new AlertRepository($this->pdo))->recent(gmdate('Y-m-d H:i:s', time() - 30 * 86400), 200);
            $subscriptions = $this->config->push !== null ? (new PushSubscriptionRepository($this->pdo))->all() : [];
            $ready = true;
        } catch (\PDOException) {
            $alerts = [];
            $subscriptions = [];
            $ready = false;
        }

        return $this->page('alerts', [
            'title' => 'Warnungen',
            'alerts' => $alerts,
            'ready' => $ready,
            'emailTo' => $this->config->alerts['email'] ?? null,
            'pushKey' => $this->webPush()?->publicKey(),
            'pushConfigured' => $this->config->push !== null,
            'subscriptions' => $subscriptions,
            'statusReceiver' => $this->config->statusReports !== null,
        ]);
    }

    private function installation(Request $request): Response
    {
        if ($this->currentUser() === null) {
            return Response::redirect('/login');
        }
        $id = $request->query('id');
        $repository = new InstallationRepository($this->pdo);
        try {
            $installation = preg_match('/^[0-9a-f]{32}$/D', $id) ? $repository->get($id) : null;
            if ($installation === null) {
                return new Response(404);
            }
            $history = $repository->history($id, gmdate('Y-m-d H:i:s', time() - Alerts::KEEP_DAYS * 86400), 200);
            $alerts = (new AlertRepository($this->pdo))->forInstallation($id, 50);
        } catch (\PDOException) {
            // New tables appear with the next cron run after a deployment.
            return new Response(404);
        }

        return $this->page('installation', [
            'title' => $installation['kompanie'],
            'installation' => $installation,
            'history' => $history,
            'alerts' => $alerts,
        ]);
    }

    /**
     * Stores the push subscription of this device (sent by assets/push.js).
     */
    private function pushSubscribe(Request $request): Response
    {
        $user = $this->currentUser();
        if ($user === null) {
            return new Response(401);
        }
        $endpoint = $request->input('endpoint');
        if ($this->config->push === null || !WebPush::validEndpoint($endpoint)) {
            return new Response(400, 'invalid', ['Content-Type' => 'text/plain; charset=utf-8']);
        }
        (new PushSubscriptionRepository($this->pdo))->add($user['id'], $endpoint, gmdate('Y-m-d H:i:s'));

        return new Response(204);
    }

    private function pushUnsubscribe(Request $request): Response
    {
        if ($this->currentUser() === null) {
            return new Response(401);
        }
        $endpoint = $request->input('endpoint');
        if ($endpoint !== '') {
            (new PushSubscriptionRepository($this->pdo))->remove($endpoint);
        }

        return new Response(204);
    }

    private function saveNote(Request $request): Response
    {
        $user = $this->currentUser();
        if ($user === null) {
            return Response::redirect('/login');
        }
        $project = ctype_digit($request->input('id')) ? (new ProjectRepository($this->pdo))->find((int)$request->input('id')) : null;
        if ($project === null) {
            return new Response(404);
        }
        $body = $request->input('body');
        if (mb_strlen($body) > NoteRepository::MAX_LENGTH) {
            $this->session->flash('Die Notiz ist zu lang und wurde nicht gespeichert.');
        } else {
            $saved = (new NoteRepository($this->pdo))->save($project['id'], $body, $user['id']);
            $this->session->flash($saved ? 'Notiz gespeichert.' : 'Keine Änderung – nichts gespeichert.');
        }

        return Response::redirect('/project?id=' . $project['id']);
    }

    private function setVisibility(Request $request): Response
    {
        if ($this->currentUser() === null) {
            return Response::redirect('/login');
        }
        $repository = new ProjectRepository($this->pdo);
        $project = ctype_digit($request->input('id')) ? $repository->find((int)$request->input('id')) : null;
        if ($project === null) {
            return new Response(404);
        }
        $hidden = $request->input('hidden') === '1';
        $repository->setHidden($project['id'], $hidden);
        $this->session->flash($hidden ? $project['name'] . ' ausgeblendet.' : $project['name'] . ' wird wieder angezeigt.');

        return Response::redirect('/project?id=' . $project['id']);
    }

    /**
     * Runs the background jobs now instead of waiting for the next cron run.
     */
    private function refresh(Request $request): Response
    {
        if ($this->currentUser() === null) {
            return Response::redirect('/login');
        }

        $runner = new Runner($this->config, $this->pdo, $this->root);
        $since = $runner->secondsSinceLastRun(time());
        if ($since !== null && $since < self::REFRESH_INTERVAL) {
            $this->session->flash(sprintf('Gerade erst aktualisiert. Bitte in %d Sekunden erneut versuchen.', self::REFRESH_INTERVAL - $since));

            return Response::redirect('/');
        }

        $result = $runner->run('Manuell gestartet');
        $this->session->flash(match (true) {
            $result === null => 'Es läuft gerade schon eine Aktualisierung. Bitte gleich neu laden.',
            $result['status'] === 'ok' => 'Aktualisiert.',
            default => 'Aktualisiert, aber mit Warnung – Details unter „Letzter Cron-Lauf“.',
        });

        return Response::redirect('/');
    }

    private function costs(Request $request): Response
    {
        if ($this->currentUser() === null) {
            return Response::redirect('/login');
        }

        return $this->costsPage([], null);
    }

    private function addCost(Request $request): Response
    {
        if ($this->currentUser() === null) {
            return Response::redirect('/login');
        }
        $fields = [];
        foreach (['name', 'provider', 'amount', 'currency', 'interval', 'project', 'note'] as $key) {
            $fields[$key] = $request->input($key);
        }
        $projectIds = array_map(static fn (array $p): int => (int)$p['id'], (new ProjectRepository($this->pdo))->all());
        $cost = Cost::fromForm($fields, $projectIds);
        if (is_string($cost)) {
            // Show the form again with what was entered.
            return $this->costsPage($fields, $cost, 422);
        }
        (new CostRepository($this->pdo))->add($cost, gmdate('Y-m-d H:i:s'));
        $this->session->flash($cost['name'] . ' hinzugefügt.');

        return Response::redirect('/costs');
    }

    private function deleteCost(Request $request): Response
    {
        if ($this->currentUser() === null) {
            return Response::redirect('/login');
        }
        $deleted = ctype_digit($request->input('id')) && (new CostRepository($this->pdo))->delete((int)$request->input('id'));
        $this->session->flash($deleted ? 'Kosten gelöscht.' : 'Der Eintrag existiert nicht mehr.');

        return Response::redirect('/costs');
    }

    /**
     * @param array<string, string> $form values to show in the form again
     */
    private function costsPage(array $form, ?string $error, int $status = 200): Response
    {
        $billing = new BillingRepository($this->pdo);
        try {
            $data = [
                'costs' => (new CostRepository($this->pdo))->all(),
                'projects' => (new ProjectRepository($this->pdo))->all(),
                'billing' => $billing->state(),
                'charges' => $billing->charges(),
                'ready' => true,
            ];
        } catch (\PDOException) {
            // New tables appear with the next cron run after a deployment.
            $data = ['costs' => [], 'projects' => [], 'billing' => null, 'charges' => [], 'ready' => false];
        }

        return $this->page('costs', $data + [
            'title' => 'Kosten',
            'vercelConfigured' => $this->config->vercel !== null && $this->config->vercel['billing'],
            'form' => $form,
            'error' => $error,
        ], $status);
    }

    private function loginForm(Request $request): Response
    {
        if ($this->currentUser() !== null) {
            return Response::redirect('/');
        }

        return $this->page('login', ['title' => 'Anmelden']);
    }

    private function login(Request $request): Response
    {
        $username = trim($request->input('username'));
        $password = $request->input('password');

        if ($this->throttle->isBlocked($username, $request->clientIp)) {
            $this->log->record('login_throttled', null, $request->clientIp);

            return $this->page('login', ['title' => 'Anmelden', 'error' => 'Zu viele Fehlversuche. Bitte warte 15 Minuten.', 'username' => $username], 429);
        }

        $user = $username === '' ? null : $this->users->findByUsername($username);
        // Verify against a dummy hash for unknown users so the timing does not reveal them.
        $hash = $user['password_hash'] ?? password_hash('dummy-password', self::passwordAlgo());
        $valid = password_verify($password, $hash) && $user !== null;

        if (!$valid) {
            $this->throttle->recordFailure($username, $request->clientIp);
            $this->log->record('login_failed', $user['id'] ?? null, $request->clientIp);

            return $this->page('login', ['title' => 'Anmelden', 'error' => 'Benutzername oder Passwort ist falsch.', 'username' => $username], 401);
        }

        if (password_needs_rehash($hash, self::passwordAlgo())) {
            $this->users->updatePasswordHash($user['id'], password_hash($password, self::passwordAlgo()));
        }

        $this->session->regenerate();
        $this->session->set('pending_user', $user['id']);
        $this->session->set('pending_at', time());

        return Response::redirect('/login/code');
    }

    private function codeForm(Request $request): Response
    {
        if ($this->pendingUser() === null) {
            return Response::redirect('/login');
        }

        return $this->page('code', ['title' => 'Bestätigungscode']);
    }

    private function code(Request $request): Response
    {
        $user = $this->pendingUser();
        if ($user === null) {
            $this->session->flash('Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.');

            return Response::redirect('/login');
        }

        if ($this->throttle->isBlocked($user['username'], $request->clientIp)) {
            $this->log->record('login_throttled', $user['id'], $request->clientIp);

            return $this->page('code', ['title' => 'Bestätigungscode', 'error' => 'Zu viele Fehlversuche. Bitte warte 15 Minuten.'], 429);
        }

        $input = trim($request->input('code'));
        $usedRecovery = false;
        $ok = false;

        if (preg_match('/^\d{3}\s?\d{3}$/', $input)) {
            $secret = $this->crypto->decrypt($user['totp_secret_enc']);
            $step = Totp::verify($secret, $input, time(), $user['totp_last_step']);
            $ok = $step !== null && $this->users->claimTotpStep($user['id'], $step);
        } elseif ($input !== '') {
            $hash = $this->crypto->hash('recovery', RecoveryCodes::normalise($input));
            $ok = $usedRecovery = $this->users->useRecoveryCode($user['id'], $hash);
        }

        if (!$ok) {
            $this->throttle->recordFailure($user['username'], $request->clientIp);
            $this->log->record('code_failed', $user['id'], $request->clientIp);

            return $this->page('code', ['title' => 'Bestätigungscode', 'error' => 'Der Code ist ungültig oder wurde schon verwendet.'], 401);
        }

        $this->throttle->clearAccount($user['username']);
        $this->session->remove('pending_user');
        $this->session->remove('pending_at');
        $this->session->regenerate();
        $this->session->set('user_id', $user['id']);
        $this->users->touchLogin($user['id']);
        $this->log->record($usedRecovery ? 'login_recovery' : 'login', $user['id'], $request->clientIp);

        if ($usedRecovery) {
            $this->session->flash(sprintf(
                'Du hast einen Wiederherstellungscode verwendet. Es sind noch %d übrig.',
                $this->users->remainingRecoveryCodes($user['id']),
            ));
        }

        return Response::redirect('/');
    }

    private function logout(Request $request): Response
    {
        $user = $this->currentUser();
        if ($user !== null) {
            $this->log->record('logout', $user['id'], $request->clientIp);
        }
        $this->session->destroy();

        return Response::redirect('/login');
    }

    // ------------------------------------------------------------------ setup

    private function setupForm(Request $request): Response
    {
        $guard = $this->setupGuard($request->query('token'));
        if ($guard !== null) {
            return $guard;
        }

        return $this->page('setup', ['title' => 'Einrichtung', 'token' => $request->query('token')]);
    }

    private function setupStart(Request $request): Response
    {
        $token = $request->input('token');
        $guard = $this->setupGuard($token);
        if ($guard !== null) {
            return $guard;
        }

        $username = trim($request->input('username'));
        $password = $request->input('password');
        $error = match (true) {
            !preg_match('/^[A-Za-z0-9._-]{3,64}$/', $username) => 'Der Benutzername muss 3–64 Zeichen lang sein (Buchstaben, Ziffern, . _ -).',
            mb_strlen($password) < 12 => 'Das Passwort muss mindestens 12 Zeichen lang sein.',
            $password !== $request->input('password_confirm') => 'Die Passwörter stimmen nicht überein.',
            default => null,
        };
        if ($error !== null) {
            return $this->page('setup', ['title' => 'Einrichtung', 'token' => $token, 'error' => $error, 'username' => $username], 422);
        }

        $secret = Totp::generateSecret();
        $this->session->set('setup', [
            'username' => $username,
            'password_hash' => password_hash($password, self::passwordAlgo()),
            'secret' => $secret,
        ]);

        return $this->totpEnrolment($token, $username, $secret);
    }

    private function setupConfirm(Request $request): Response
    {
        $token = $request->input('token');
        $guard = $this->setupGuard($token);
        if ($guard !== null) {
            return $guard;
        }

        $pending = $this->session->get('setup');
        if (!is_array($pending) || !is_string($pending['username'] ?? null)
            || !is_string($pending['password_hash'] ?? null) || !is_string($pending['secret'] ?? null)) {
            return Response::redirect('/setup?token=' . rawurlencode($token));
        }

        $step = Totp::verify($pending['secret'], $request->input('code'), time(), null);
        if ($step === null) {
            return $this->totpEnrolment($token, $pending['username'], $pending['secret'], 'Der Code passt nicht. Prüfe die Uhrzeit des Handys und versuche den nächsten Code.');
        }

        $codes = RecoveryCodes::generate();
        $hashes = array_map(fn (string $c): string => $this->crypto->hash('recovery', RecoveryCodes::normalise($c)), $codes);
        $userId = $this->users->create(
            $pending['username'],
            $pending['password_hash'],
            $this->crypto->encrypt($pending['secret']),
            $step,
            $hashes,
        );
        $this->session->remove('setup');
        $this->log->record('setup', $userId, $request->clientIp);

        return $this->page('setup_done', ['title' => 'Einrichtung abgeschlossen', 'codes' => $codes]);
    }

    /**
     * The setup page exists only while a setup token is configured and no user exists.
     * In every other case it answers exactly like an unknown URL.
     */
    private function setupGuard(string $token): ?Response
    {
        if ($this->config->setupToken === '' || !hash_equals($this->config->setupToken, $token)) {
            return new Response(404);
        }

        (new Migrator($this->pdo, $this->root . '/migrations'))->migrate();

        return $this->users->count() === 0 ? null : new Response(404);
    }

    private function totpEnrolment(string $token, string $username, string $secret, ?string $error = null): Response
    {
        $uri = Totp::provisioningUri($secret, $username, self::ISSUER);
        $qr = (new QRCode(new QROptions(['outputBase64' => true, 'svgAddXmlHeader' => false])))->render($uri);

        return $this->page('setup_totp', [
            'title' => 'Zwei-Faktor einrichten',
            'token' => $token,
            'qr' => $qr,
            'secret' => trim(chunk_split($secret, 4, ' ')),
            'error' => $error,
        ], $error === null ? 200 : 422);
    }

    // ------------------------------------------------------------------ helpers

    /**
     * @param list<array<string, mixed>> $projects
     * @return list<array{id: int, full_name: string}>
     */
    private static function repoRefs(array $projects): array
    {
        return array_map(static fn (array $p): array => ['id' => (int)$p['id'], 'full_name' => (string)$p['full_name']], $projects);
    }

    /**
     * Latest release tag by lower-cased repository name, to compare installed versions with.
     *
     * @param list<array<string, mixed>> $projects
     * @return array<string, string>
     */
    private static function releaseByRepo(array $projects): array
    {
        $tags = [];
        foreach ($projects as $p) {
            if (is_string($p['release_tag'] ?? null)) {
                $tags[strtolower((string)$p['full_name'])] = $p['release_tag'];
            }
        }

        return $tags;
    }

    /**
     * Vercel projects grouped by the GitHub project they deploy, plus those that match no card.
     *
     * @param list<array<string, mixed>> $projects
     * @return array{array<int, list<array<string, mixed>>>, list<array<string, mixed>>}
     */
    private function vercelProjects(array $projects): array
    {
        $vercel = (new VercelRepository($this->pdo))->all();
        $byRepo = VercelRepository::byRepository($vercel, self::repoRefs($projects));
        $matched = [];
        foreach ($byRepo as $list) {
            foreach ($list as $v) {
                $matched[$v['id']] = true;
            }
        }
        $unmatched = array_values(array_filter($vercel, static fn (array $v): bool => !isset($matched[$v['id']])));

        return [$byRepo, $unmatched];
    }

    /** The VAPID key for the browser, or null if push is not configured or the key is unusable. */
    private function webPush(): ?WebPush
    {
        if ($this->config->push === null) {
            return null;
        }
        $pem = @file_get_contents($this->config->push['private_key_file']);
        try {
            return $pem === false ? null : new WebPush($pem, $this->config->push['subject']);
        } catch (\RuntimeException) {
            return null;
        }
    }

    /**
     * @return array{id: int, username: string, password_hash: string, totp_secret_enc: string, totp_last_step: ?int}|null
     */
    private function currentUser(): ?array
    {
        $id = $this->session->get('user_id');

        return is_int($id) ? $this->users->findById($id) : null;
    }

    /**
     * @return array{id: int, username: string, password_hash: string, totp_secret_enc: string, totp_last_step: ?int}|null
     */
    private function pendingUser(): ?array
    {
        $id = $this->session->get('pending_user');
        $at = $this->session->get('pending_at');
        if (!is_int($id) || !is_int($at) || time() - $at > self::PENDING_TTL) {
            return null;
        }

        return $this->users->findById($id);
    }

    /**
     * @param array<string, mixed> $data
     */
    private function page(string $template, array $data, int $status = 200): Response
    {
        $data += [
            'csrf' => Csrf::token($this->session->data()),
            'flash' => $this->session->flash(),
            'loggedIn' => is_int($this->session->get('user_id')),
            'timezone' => $this->config->timezone,
        ];

        return new Response($status, $this->view->render($template, $data), ['Content-Type' => 'text/html; charset=utf-8']);
    }

    private static function passwordAlgo(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    }
}
