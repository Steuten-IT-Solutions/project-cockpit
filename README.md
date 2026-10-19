# Project Cockpit

Private management cockpit for all Steuten IT Solutions projects, served at
`https://cockpit.steuten-it-solutions.de` from the IONOS webspace.

The user interface is German; code, comments, commits and documentation are English.

- **Phase 1:** login with password and TOTP second factor, recovery codes, throttling,
  security log, cron heartbeat and SFTP deployment.
- **Phase 2:** project cards from a read-only GitHub App (CI status of the default branch,
  latest release, open issues and pull requests, last push), a page per project with links
  and a note that keeps every saved version, hiding projects, a refresh button.
- **Phase 3 (in progress):** latest Vercel production deployment on each card; status
  reports of the company apps (Kompanie-Apps); costs (entered by hand, plus Vercel's
  charges of the current month).

## Stack

- PHP 8.4 (the webspace runs 8.4; the code requires ≥ 8.3), no framework
- MariaDB via PDO
- Composer packages: `paragonie/constant_time_encoding` (Base32), `chillerlan/php-qrcode` (QR code for TOTP enrolment)
- CI: lint, PHPStan level 8, PHPUnit — see `.github/workflows/ci.yml`

## Layout

```
public/       document root of the cockpit subdomain (index.php, assets, .htaccess)
receiver/     document root of the status subdomain (accepts status reports only)
src/          application code (namespace Cockpit\)
templates/    PHP templates; every dynamic value is escaped with $e()
migrations/   NNNN_name.sql, applied in order by cron/run.php and the setup page
cron/run.php  cron entry point (CLI only)
config/       config.example.php in Git; config.php only on the server
var/          sessions (server only, never deployed)
```

Only `public/` and `receiver/` may be reachable from the web. A root `.htaccess` denies everything
in case the document root is ever pointed at the project root by mistake.

## Server setup (one-time)

1. **Subdomain:** `cockpit.steuten-it-solutions.de` → folder `cockpit/public`, SSL on.
   Keep `cockpit/` outside any other domain's document root (e.g. at the webspace root next to
   the main site's folder), so the code is never inside a web-served directory.
2. **Database:** create a MariaDB database in the IONOS panel.
3. **Deployment secrets** in GitHub (Settings → Secrets and variables → Actions):
   `SFTP_HOST`, `SFTP_USER`, `SFTP_PASSWORD`, `SFTP_KNOWN_HOSTS`, `SFTP_TARGET_DIR`.
   See the header of `.github/workflows/deploy.yml`. Verify the host key fingerprint
   before storing `SFTP_KNOWN_HOSTS`.
   `SFTP_TARGET_DIR` is the `cockpit` folder as the SFTP user sees it. `bin/deploy-sftp.sh`
   refuses to deploy into a folder that holds anything but an earlier deployment, because the
   upload deletes whatever is not part of the build.
4. **Deploy:** merge to `main` (or run the *Deploy* workflow manually).
5. **Configuration:** on the server, copy `cockpit/config/config.example.php` to
   `cockpit/config/config.php`, fill in the values and `chmod 600` it. `app_key` (≥ 40
   characters) and `setup_token` (≥ 32 characters, letters and digits only, because it is
   part of the setup URL) can be random passwords from a password manager. Never commit or paste these values anywhere.
6. **Cron:** in the IONOS cron manager create a *UnixCron* job. Its command field takes one
   absolute path without spaces, so enter the path of `cron/run.sh` exactly as the dashboard
   shows it under *Cron-Befehl*; the wrapper runs `cron/run.php` with the newest PHP 8.3/8.4
   CLI (`/usr/bin/php` is PHP 4.4 on IONOS). Schedule: minutes `*/15`, all other fields `*`.
   The dashboard shows the last run and the PHP version it used.
7. **First user:** open `https://cockpit.steuten-it-solutions.de/setup?token=<setup_token>`,
   create the account, enrol the authenticator app and store the recovery codes.
   Then remove `setup_token` from `config.php`. The page answers 404 as soon as a user exists.

## GitHub App (phase 2)

The cron job reads the repositories through a GitHub App and stores them in MariaDB;
pages only read the database.

1. Organisation *Steuten-IT-Solutions* → Settings → Developer settings → GitHub Apps →
   *New GitHub App*. Webhook *Active*: off. Repository permissions, all **read-only**:
   *Actions*, *Contents*, *Metadata*, *Pull requests*. Installable **only on this account**:
   the projects live in the organisation. A private app can only be installed on the
   account that owns it; to also cover a personal account, make the app public (Advanced →
   Make public) or register a second app there — the code reads every installation on the
   configured `accounts`.
2. Install the app on the organisation and select the repositories to show; the selection
   is the project list.
3. Generate a private key, upload it over SFTP to `cockpit/config/github-app.pem`,
   `chmod 600`. Deployments never upload or delete `config/*.pem`.
4. Add the `github` section to `config.php` (see `config.example.php`). Only installations
   on the listed `accounts` are read, so a public app installed by someone else is ignored.
   The client ID is shown on the app's *General* page; a wrong character there makes
   GitHub answer 401 on `/app/installations`.

Repositories that are no longer granted keep their row and notes but disappear from the
dashboard. *Hidden* is a dashboard setting and survives every sync.

## Vercel (phase 3)

The cron job lists the team's Vercel projects and reads each one's latest production
deployment. A project is shown on the card of the GitHub repository it is linked to
(matched by GitHub repository id, else by owner/name); projects whose repository has no
card are listed under *Vercel ohne GitHub-Karte*.

1. Vercel → Account Settings → Tokens → create a token with scope = the team and an
   expiry. Vercel documents no read-only tokens, so it stays in `config.php` only.
2. Add the `vercel` section to `config.php` (see `config.example.php`) with the token and
   the team id (`team_…`, shown under Team Settings → General).

## Costs (phase 3)

*Kosten* lists costs entered by hand (domains, webspace, subscriptions) with an amount,
currency (EUR or USD) and interval, optionally linked to a project, and sums them per month
and per year. Currencies are never converted: a rate would be a guess that goes stale.

With a `vercel` section the cron job also reads `GET /v1/billing/charges` (FOCUS 1.3, JSON
Lines) for the current calendar month (UTC) and shows the charges summed per category,
service and project. Vercel documents the endpoint for Pro and Enterprise teams. A failure
is shown on the page and in the cron status, and the last successful result stays;
`'billing' => false` in the `vercel` section switches the call off. The figures are what the
API reports, not the invoice.

## Status reports (phase 3)

Company apps (Kompanie-Apps, built from `Steuten-IT-Solutions/Kompanie-App-Template`) send
a short report once a day, and only after an admin agreed under *Einstellungen → Updates*:
company, version, variant, PHP version, database type, result of the last update, whether
the update check and the gallery sync work. The format is defined by
`packages/core/src/Update/StatusReporter.php` there. This replaces `tools/status-empfang`
from that repository; the overview is in the cockpit behind its login instead of HTTP Basic
authentication.

1. **Subdomain:** `status.steuten-it-solutions.de` → folder `cockpit/receiver`, SSL on.
2. Add the `status_reports` section to `config.php` (see `config.example.php`). Without it
   the subdomain answers 404 to everything.
3. In `Kompanie-App-Template` set the repository variable `KOMPANIE_STATUS_URL` to
   `https://status.steuten-it-solutions.de/`. Every company gets a new version with that
   address at the next sync.

Limits, as in the template's receiver:

- Reports are **not signed**; anyone can send one. The overview is a hint, not proof.
- Only reports for repositories of the configured organisation are accepted, at most 4 KiB
  each, 2000 per hour in total and 2000 stored rows; rows without a new report for 60 days
  are removed. Someone flooding the table with invented companies can keep new ones out
  for up to 60 days (then empty `status_reports`).
- One row per company and variant: several installations of the same company and variant
  overwrite each other.
- The receiver stores no IP addresses, but the web server's access log does. Check the
  log settings of the hosting package and mention the reports in the companies' privacy
  policy (`docs/OFFENE-PUNKTE.md`, section 3, in the template).

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
