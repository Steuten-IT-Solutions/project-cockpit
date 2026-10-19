# Project Cockpit

Private management cockpit for all Steuten IT Solutions projects, served at
`https://cockpit.steuten-it-solutions.de` from the IONOS webspace.

The user interface is German; code, comments, commits and documentation are English.

**Phase 1 (this state):** foundation — login with password and TOTP second factor,
recovery codes, throttling, security log, cron heartbeat and SFTP deployment.
Project data (GitHub, Vercel, company-app status reports) follows in later phases.

## Stack

- PHP 8.4 (the webspace runs 8.4; the code requires ≥ 8.3), no framework
- MariaDB via PDO
- Composer packages: `paragonie/constant_time_encoding` (Base32), `chillerlan/php-qrcode` (QR code for TOTP enrolment)
- CI: lint, PHPStan level 8, PHPUnit — see `.github/workflows/ci.yml`

## Layout

```
public/       document root of the subdomain (index.php, assets, .htaccess)
src/          application code (namespace Cockpit\)
templates/    PHP templates; every dynamic value is escaped with $e()
migrations/   NNNN_name.sql, applied in order by cron/run.php and the setup page
cron/run.php  cron entry point (CLI only)
config/       config.example.php in Git; config.php only on the server
var/          sessions (server only, never deployed)
```

Only `public/` may be reachable from the web. A root `.htaccess` denies everything
in case the document root is ever pointed at the project root by mistake.

## Server setup (one-time)

1. **Subdomain:** `cockpit.steuten-it-solutions.de` → folder `cockpit/public`, SSL on.
2. **Database:** create a MariaDB database in the IONOS panel.
3. **Deployment secrets** in GitHub (Settings → Secrets and variables → Actions):
   `SFTP_HOST`, `SFTP_USER`, `SFTP_PASSWORD`, `SFTP_KNOWN_HOSTS`, `SFTP_TARGET_DIR`.
   See the header of `.github/workflows/deploy.yml`. Verify the host key fingerprint
   before storing `SFTP_KNOWN_HOSTS`.
4. **Deploy:** merge to `main` (or run the *Deploy* workflow manually).
5. **Configuration:** on the server, copy `cockpit/config/config.example.php` to
   `cockpit/config/config.php`, fill in the values and `chmod 600` it. Generate the
   keys locally as described in the file. Never commit or paste these values anywhere.
6. **Cron:** in the IONOS cron manager, run `cron/run.php` with PHP 8.4 every 15 minutes.
   The dashboard shows the last run and the PHP version it used.
7. **First user:** open `https://cockpit.steuten-it-solutions.de/setup?token=<setup_token>`,
   create the account, enrol the authenticator app and store the recovery codes.
   Then remove `setup_token` from `config.php`. The page answers 404 as soon as a user exists.

## Security model

- Password (Argon2id) **and** TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step); a code
  is accepted once only (`totp_last_step`).
- 10 single-use recovery codes, stored as HMAC-SHA256 with the app key.
- TOTP secrets encrypted at rest (libsodium secretbox, app key).
- Throttling: 5 failures per account or 20 per IP within 15 minutes block further attempts.
  IPs and usernames are stored only as keyed hashes.
- Sessions: files in `var/sessions`, cookie `__Host-cockpit` (Secure, HttpOnly,
  SameSite=Strict), new ID on every privilege change, 2 h idle / 12 h absolute timeout.
- CSRF token on every POST; strict CSP without inline scripts or styles; HSTS; `noindex`.
- Errors are logged server-side; the browser sees a generic message.

## Development

```bash
composer install
composer check     # lint + PHPStan + PHPUnit
```

For a local run you need MariaDB and a `config/config.php` pointing at it:

```bash
php cron/run.php                                  # applies migrations
php -S 127.0.0.1:8080 -t public public/index.php  # assets are not served this way
```
