<?php

declare(strict_types=1);

namespace Cockpit;

use Cockpit\Auth\AuthLog;
use Cockpit\Auth\RecoveryCodes;
use Cockpit\Auth\Throttle;
use Cockpit\Auth\Totp;
use Cockpit\Auth\UserRepository;
use Cockpit\Database\Connection;
use Cockpit\Database\Migrator;
use Cockpit\Http\Request;
use Cockpit\Http\Response;
use Cockpit\Http\Router;
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

        return $this->page('dashboard', [
            'title' => 'Übersicht',
            'user' => $user,
            'phpVersion' => PHP_VERSION,
            'schemaVersion' => (new Migrator($this->pdo, $this->root . '/migrations'))->currentVersion(),
            'lastCron' => $lastCron,
            'recoveryLeft' => $this->users->remainingRecoveryCodes($user['id']),
            'events' => $this->log->recent($user['id'], 8),
        ]);
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
