# Project Cockpit

Private management cockpit for all Steuten IT Solutions projects, served at
`https://cockpit.steuten-it-solutions.de`. It is moving from the IONOS webspace to an own VPS
(Strato, Debian 13); see "Own server" below. Until the move is finished, both setups are documented.

The user interface is German; code, comments, commits and documentation are English.

- **Phase 1:** login with password and TOTP second factor, recovery codes, throttling,
  security log, cron heartbeat and SFTP deployment.
- **Phase 2:** project cards from a read-only GitHub App (CI status of the default branch,
  latest release, open issues and pull requests, last push), a page per project with links
  and a note that keeps every saved version, hiding projects, a refresh button.
- **Phase 3 (in progress):** latest Vercel production deployment on each card; running and last early and
  stable releases of the company app (webhook, live on the dashboard); status
  reports of the company apps (Kompanie-Apps) with history, traffic lights and alerts by
  e-mail and push; bug reports of the company apps as issues in a private repository;
  costs (entered by hand, plus Vercel's charges of the current month).

## Stack

- PHP 8.4 (the webspace runs 8.4; the code requires ≥ 8.3), no framework
- MariaDB via PDO
- Composer packages: `paragonie/constant_time_encoding` (Base32), `chillerlan/php-qrcode` (QR code for TOTP enrolment)
- CI: lint, PHPStan level 8, PHPUnit — see `.github/workflows/ci.yml`

## Layout

```
public/       document root of the cockpit subdomain (index.php, assets, .htaccess)
receiver/     document root of the status subdomain (accepts status and bug reports only)
src/          application code (namespace Cockpit\)
templates/    PHP templates; every dynamic value is escaped with $e()
migrations/   NNNN_name.sql, applied in order by cron/run.php and the setup page
cron/run.php  cron entry point (CLI only)
config/       config.example.php in Git; config.php only on the server
var/          sessions (server only, never deployed)
```

Only `public/` and `receiver/` may be reachable from the web. A root `.htaccess` denies everything
in case the document root is ever pointed at the project root by mistake.

## Server setup on the IONOS webspace (one-time, legacy)

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

## Own server (Debian 13 VPS)

`bin/server-setup.sh` sets up a fresh Debian 13 server as root: Apache with the build's
`.htaccess` files (`AllowOverride All`), PHP 8.4 FPM in a pool running as user `cockpit`,
MariaDB, firewall (22, 80, 443), key-only SSH (only if a key is installed), automatic security
updates, fail2ban, a cron job every 15 minutes in `/etc/cron.d/cockpit` and a nightly database
dump to `/var/backups/cockpit/` (one file per weekday), so a file backup of the server holds a
consistent copy of the database. It is safe to run again.

Every run also installs `/usr/local/sbin/cockpit-setup`: `cockpit-setup <step> …` loads the
current `bin/server-setup.sh` from `main` on GitHub and runs it, so it never has to be copied by
hand (e.g. `ssh -t root@<server> "cockpit-setup archive"`). For a first run without it:
`curl -fsSL https://raw.githubusercontent.com/Steuten-IT-Solutions/project-cockpit/main/bin/server-setup.sh -o /root/server-setup.sh && bash /root/server-setup.sh <step>`.

The steps `node`, `rehearsal`, `rehearsal-stop`, `cutover` and `rollback` prepare and switch to
the new Nuxt cockpit; see `app/README.md`, "Deployment" and "Cutover checklist".

1. **Server:** order the VPS with the Debian 13 image, log in as root with an SSH key, copy
   `bin/server-setup.sh` to the server and run `bash server-setup.sh base`.
2. **Deploy key:** create one locally (`ssh-keygen -t ed25519 -f cockpit-deploy -N ''`), put
   `cockpit-deploy.pub` into `/srv/cockpit/.ssh/authorized_keys` on the server.
3. **GitHub secrets:** `SFTP_HOST` (server name or IP), `SFTP_USER` = `cockpit`,
   `SFTP_PRIVATE_KEY` (content of `cockpit-deploy`), `SFTP_KNOWN_HOSTS` (`ssh-keyscan <host>`;
   compare the fingerprint with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the
   server), `SFTP_TARGET_DIR` = `/srv/cockpit/app`. Remove `SFTP_PASSWORD`. Then run *Deploy*.
4. **Data from the webspace:** download `config/config.php`, `config/*.pem` and `var/` over
   SFTP, export the database in phpMyAdmin. On the server put the files into
   `/srv/cockpit/app/config/`, set the `database` values from `/root/cockpit-database.txt`,
   `chown cockpit: /srv/cockpit/app/config/* && chmod 600 /srv/cockpit/app/config/*`, and import
   the dump with `mariadb cockpit < dump.sql`. Keep `app_key` and `vapid.pem` unchanged: a new
   `app_key` invalidates every TOTP enrolment and recovery code, a new VAPID key every push
   subscription.
5. **Switch:** switch off the IONOS cron job, import a fresh dump, point the A/AAAA records of
   `cockpit.` and `status.` to the server, then run `bash server-setup.sh certs`. The MX records
   stay unchanged until the mail server is verified.
6. **Mail:** alert e-mails use PHP `mail()`, which needs a local `sendmail`; see *Mail server*.
7. **Fast deployments:** with `SFTP_PRIVATE_KEY`, *Deploy* sends the build as one archive over
   SSH to `bin/receive-deploy.sh` of the previous deployment. It unpacks it next to the
   application, swaps each folder in with a rename, keeps the replaced version in
   `/srv/cockpit/app/.previous/` and logs each deployment in `.deploy-log`. The first deployment
   with this script uploads file by file over SFTP once and brings the script along. Nothing to
   install.

## Mail server

`bash server-setup.sh mail` turns the VPS into the mail server of `steuten-it-solutions.de`:
Postfix replaces exim4, receives on port 25 and accepts mail from clients on 587 (STARTTLS) and
465 (TLS) with login only; Dovecot keeps the mailboxes under `/var/vmail` and serves IMAP on 993
only; Rspamd rejects obvious spam, moves likely spam to *Junk* and DKIM-signs every outgoing
mail, including the cockpit's `mail()`. The certificate for `mail.steuten-it-solutions.de` comes
from Let's Encrypt; a renewal hook reloads Postfix and Dovecot. Only root and `cockpit` may use
the local `sendmail`; mail for root goes to the admin mailbox.

The addresses are the `MAILBOXES` and `FORWARDS` lists at the top of the script; run `mail`
again after changing them. Each mailbox may send as itself, each forwarding's target as the
forwarding too (`rechnung@` sends as `invoice@`):

| Address | Kind |
|---|---|
| `christian.steuten@` | mailbox |
| `info@` | mailbox |
| `rechnung@` | mailbox; the cockpit sends invoices from here |
| `eingangsrechnung@` | mailbox for supplier invoices; the cockpit will read it over IMAP |
| `dmarc@` | mailbox for DMARC reports |
| `invoice@` | → `rechnung@` |
| `belege@` | → `eingangsrechnung@` |
| `noreply@` | → `christian.steuten@` (sender of cockpit alerts; bounces arrive there) |
| `postmaster@`, `abuse@` | → `christian.steuten@` |

1. **Preconditions:** outbound port 25 open, A/AAAA of `mail.` point to the server, reverse DNS of
   the IPv4 (and IPv6) address is `mail.steuten-it-solutions.de`.
2. **Install:** `bash server-setup.sh mail`. It prints the DNS records of step 4.
3. **Passwords:** `bash server-setup.sh mail-password <address>` for every mailbox. It asks
   twice; the password is stored as an Argon2id hash in `/etc/dovecot/passwd` and never
   appears on the command line.
4. **DNS** (keep the MX records unchanged for now):
   - `TXT s2026._domainkey` = the DKIM value printed by the script,
   - `TXT _dmarc` = `v=DMARC1; p=none; rua=mailto:dmarc@steuten-it-solutions.de`,
   - SPF (`TXT @`): add `ip4:<IPv4> ip6:<IPv6>` of the server to the existing record, keep the
     IONOS part until the move is finished.
5. **Test:** set up a mail client (IMAP `mail.steuten-it-solutions.de` 993 SSL/TLS, SMTP 465
   SSL/TLS or 587 STARTTLS, user name = full address) and send to an external mailbox (Gmail:
   *Show original* must say SPF, DKIM and DMARC *PASS*) and to a mail tester. Check the server's
   IP addresses on public blocklists.
6. **Move:** copy the mails of the old IONOS mailbox with `bash server-setup.sh mail-import
   info@steuten-it-solutions.de` (asks for the IONOS password; all folders, read/unread flags
   kept). Then point the MX record of the domain to `mail.steuten-it-solutions.de`, wait a day
   and run `mail-import` once more for mail that still reached IONOS. Mail already on the new
   server stays; nothing is copied twice. Afterwards remove the IONOS part of SPF and
   raise DMARC to `p=quarantine` once the reports look clean.
7. **Cockpit alerts:** in `config.php`, set `alerts.from` to `Cockpit <noreply@steuten-it-solutions.de>`
   (an address that does not exist here gets its bounces rejected).

`/var/vmail` holds the mail; include it in the server backup.

## Backup

`bash server-setup.sh backup uXXXXX@uXXXXX.your-storagebox.de` sets up a nightly off-site backup
(03:15, after the database dump) with restic to a Hetzner Storage Box over SFTP (port 23). It asks
for the Storage Box password once to install a dedicated SSH key, creates the encrypted repository
and runs the first backup. Saved: `/var/vmail`, `/srv/cockpit/app/config`, `/var/backups/cockpit`,
`/etc`, `/root`, `/var/lib/rspamd/dkim`. Kept: 7 daily, 5 weekly, 12 monthly snapshots; on Sundays
the repository is checked. A failed run prints its log, which cron mails to root (the admin
mailbox).

- Store `/root/restic-password` in a password manager. Without it nothing can be restored.
- Enable automatic snapshots of the Storage Box in the Hetzner console, so a compromised server
  cannot delete the history.
- Restore: `set -a; . /root/restic.env; set +a; restic restore latest --target /tmp/restore`.

## Mail archive

`bash server-setup.sh archive` (after `mail` and `backup`) sets up a GoBD mail archive with
[piler](https://www.mailpiler.org). Postfix hands a copy of every message it accepts (incoming,
outgoing, local mail of the cockpit) to piler on `127.0.0.1:2525` (`always_bcc`), before any
mail client can delete it. Each recipient accepted by smtpd is noted in an `X-Envelope-To`
header, so Bcc recipients are archived too; the header goes to piler only and is stripped
before any other delivery. Mail already in the mailboxes is imported once.

- piler stores each message compressed, encrypted with `/etc/piler/piler.key` and with its
  digest, and keeps it 3653 days (10 years: vouchers 8 years from the end of the calendar year,
  business letters 6). Deleting in the web interface is off; `pilerpurge` removes messages only
  after their retention period. Searches, logins and views are logged (*Administration → Audit*).
- There is no Debian 13 package: piler is built from the pinned commit `PILER_COMMIT`, Manticore
  (piler's search index) comes from Manticore's repository at `MANTICORE_VERSION` (held), with
  its signing key checked against `MANTICORE_KEY`. To update, change these values after reading
  piler's upgrade notes and run `archive` again.
- Web interface: `https://mail.steuten-it-solutions.de/`, HTTP basic auth (`archiv`) in front of
  piler's own login. `auditor@local` searches all mail, `admin@local` administers. The step writes
  the generated passwords to `/root/piler-access.txt` once: store them, then delete the file.
  Enable two-factor authentication for both accounts under *Settings*. For a tax audit, create
  another auditor account or export with `pilerexport` (EML or ZIP).
- Backup: nightly at 04:15 into its own restic repository `cockpit-archive` on the Storage Box,
  never thinned out: the encrypted messages, `/etc/piler` (with the key), a database dump and
  the access log. The search index can be rebuilt from the messages. Test a restore once a year.
- Running `mail` again keeps the archive's Postfix settings.

## GitHub App (phase 2)

The cron job reads the repositories through a GitHub App and stores them in MariaDB;
pages only read the database.

1. Organisation *Steuten-IT-Solutions* → Settings → Developer settings → GitHub Apps →
   *New GitHub App*. Webhook *Active*: off. Repository permissions, all **read-only**:
   *Actions*, *Contents*, *Metadata*, *Pull requests* (bug reports need more, see *Bug reports*). Installable **only on this account**:
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

## Releases of the company app (phase 3)

The dashboard shows in a box at the top whether an **early** or **stable** release of
`Steuten-IT-Solutions/Kompanie-App-Template` is running right now, and per channel the last successful release
with its core version and time. Release flow: `docs/RELEASE.md` in the template.

- **Early:** a run of *Kompanien abgleichen* (`kompanien-abgleichen.yml`) on `develop` that publishes, i.e. has a
  job besides `finden` (the `veroeffentlichen (…)` matrix jobs). Runs that find nothing to publish are not shown.
- **Stable:** a run of *Kernversion freigeben* (`kern-freigeben.yml`) on `main`, or a publishing run of
  *Kompanien abgleichen* on `main` (changes of a company repository, companies without a version of the released
  core). In rare cases such a run on `main` publishes to `early` (core not yet in `STABLE_CORE`); the cockpit cannot
  tell from the run and shows it as stable.
- **Version** is the file `VERSION` at the run's commit (the core version, e.g. `0.1.1`), not the version of each
  company (`0.1.1.N`). **Time** is the end of the workflow run. The template stores no time of a promotion, so this
  is the closest exact value; a manual *Versionen steuern* run (promote, withdraw) is not shown.
- A run that failed or was cancelled after the last successful one is shown in red below it.

How it stays current:

- **Webhook** (within seconds): GitHub sends `workflow_run` and `workflow_job` events to
  `https://status.steuten-it-solutions.de/github`; the receiver checks `X-Hub-Signature-256` and stores the run. Right
  after answering it reads, with the app, whether the run publishes and its `VERSION`.
- **The open dashboard** reloads the box every 5 seconds while it is visible (`assets/releases.js`, reads only the
  database). These requests do not count as activity, so the idle timeout still logs you out.
- **Cron** (every 15 minutes and *Jetzt aktualisieren*): reads the latest runs of both workflows and completes them,
  in case a webhook delivery got lost. Runs that publish nothing are kept 30 days, releases 400 days.

Setup:

1. Deploy the cockpit (migration `0010`).
2. GitHub App → *Permissions & events*: *Actions* and *Contents* at least **read** (already needed above). Under
   *Subscribe to events* tick **Workflow run** and **Workflow job**. Under *Webhook* set *Active*, URL
   `https://status.steuten-it-solutions.de/github`, a random **secret** of at least 32 characters, SSL verification on.
   The template repository must be one of the installation's selected repositories.
3. Add the `releases` section to `config.php` with `repo` and the same `webhook_secret` (see `config.example.php`).
   The status subdomain must exist; the `status_reports` section is not needed for this.
4. Check in the app's *Advanced* tab that the `ping` delivery got `200`. A wrong secret gets `401`, a missing
   `releases` section `404`.

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
status reports only after an admin agreed under *Einstellungen → Updates*. The protocol is
defined in `docs/STATUSMELDUNGEN.md` there.

- **Format 2** (current): an hourly heartbeat with the traffic light of each area (level
  only), error codes of the last 24 hours, how background tasks run (`cron.kind`), enabled
  areas and the result of the last update; severe errors (`UPDATE_FAILED`, `PHP_FATAL`, …)
  at once as events. No names, contents or error texts.
- **Causes** (format 2, since Kompanie-App-Template#82): `details` holds the causes per error
  code of the last 24 hours with their counts, e.g.
  `{"CALENDAR_FETCH": {"ics_http_404": 2, "ics_timeout": 1}}`; an event carries the cause of
  its code in `detail` (e.g. `download_http_503`) when the app knows one. A cause matches
  `^[a-z][a-z0-9_]{0,63}$` and is built from fixed parts only, never from an error text (those
  stay in the installation's own error log). Older app versions send no `details`: the report
  is accepted with no causes. Invalid `details`, `detail` in a heartbeat, more than 30 codes or
  more than 60 causes per code refuse the whole report (400), like invalid `errors`. The
  cockpit shows the causes next to the error codes, in the history and in event alerts; the
  alert rules themselves do not use them. The authoritative description of all fields is
  `docs/STATUSMELDUNGEN.md` in the template (branch `develop`).
- **Format 3** (since project-cockpit#20, Kompanie-App-Template#175): format 2 plus the usage
  figures `usage` in a heartbeat, sums only:
  `{"users": 42, "active": {"d1": 12, "d7": 30, "d30": 38}, "areas": {"events": 35, "login": 31}}`
  (accounts, accounts active in the last 1, 7 and 30 days, people per area in the last 30 days).
  Whole numbers `0 … 100000` with `d1 ≤ d7 ≤ d30 ≤ users`, area keys `^[a-z]{1,20}$` (unknown
  areas are shown by their key), at most 32 areas; unknown keys inside `usage` are dropped so a
  later app version does not break the reports. Invalid figures or `usage` in an event refuse the
  report (400). A heartbeat without `usage` (format 2) means "no figures", not zero. The cockpit
  keeps the latest figures per installation and one row per installation and UTC day (the day's
  last heartbeat wins) for 400 days, and shows them on the installation page; values from 1 to 4
  are shown as "< 5", since in a small company they could point to a single person. Format 2
  stays accepted until every installation is updated.
- **Format 1** (old, daily, unsigned) is still accepted until every installation is updated
  and shown separately as a hint.

1. **Subdomain:** `status.steuten-it-solutions.de` → folder `cockpit/receiver`, SSL on.
2. Add the `status_reports` section to `config.php` (see `config.example.php`). Without it
   the subdomain answers 404 to everything.
3. In `Kompanie-App-Template` set the repository variable `KOMPANIE_STATUS_URL` to
   `https://status.steuten-it-solutions.de/`. Every company gets a new version with that
   address at the next sync.
4. Optional: `alerts` (e-mail via PHP `mail()`, sender from the cockpit's own domain) and
   `push` (web push to the cockpit on your phone; VAPID key created locally with
   `openssl ecparam -name prime256v1 -genkey -noout -out vapid.pem`, uploaded next to
   `config.php`). Then switch push on per device on the page *Warnungen*. On iPhones push
   works only after adding the cockpit to the home screen.

Signature and limits (format 2):

- Each installation has a random id and a secret. The first report of an unknown
  installation carries the secret (trust on first use); the cockpit stores it encrypted with
  the app key. Every later report must be signed with it (HMAC-SHA256 over the body, header
  `X-Kompanie-Signature`); a secret sent again never replaces the stored one. `sent` must be
  within 10 minutes of the cockpit's clock and `nonce` must be new (replay protection).
- Only repositories of the configured organisation, at most 16 KiB per report, 2000 reports
  per hour in total (both formats) and 2000 installations.
- History: heartbeats, events and resolved alerts are kept 90 days, daily usage figures 400
  days; an installation that has not reported for 90 days is removed with its usage figures.
- The receiver stores no IP addresses, but the web server's access log does. Check the
  log settings of the hosting package and mention the reports in the companies' privacy
  policy (`docs/OFFENE-PUNKTE.md`, section 3, in the template).

Evaluation (cron, every 15 minutes) and alerts:

- **Red** (alert): a traffic light is `error`; an event in the last 24 hours; no heartbeat
  for 2 hours (`real` cron or WP-Cron) or 24 hours (`pseudo`: tasks run only on page views,
  so a quiet night is no outage); several installations on the same version red at once
  ("Fehlerhäufung nach Release", the hint to withdraw that version).
- **Yellow** (shown, no alert): a traffic light is `warn`, or error codes in the last 24 hours.
- One e-mail and one push when alerts open and when they resolve; no repeats while they stay
  open. Pushes carry no payload: the phone shows "Neue Warnung oder Entwarnung", the details
  are behind the login.
- Pages: overview with a traffic light per installation, *Warnungen* (open and resolved,
  push per device), and a page per installation with its history.

## Bug reports (phase 3)

Company apps let anyone (also guests) report a bug via *? → Fehler melden* (Kompanie-App-Template#64; wire format
in `docs/FEHLERMELDUNGEN.md` there). The app sends each report signed to `POST /reports` of the status subdomain;
the cockpit stores it and creates an **issue in one private repository** for all companies, labelled
`kompanie:<repository name>`. The installations have no GitHub access.

1. Create a **private** repository, e.g. `Steuten-IT-Solutions/kompanie-meldungen`, with an initial commit (a
   README), so that it has a default branch.
2. GitHub App permissions (Settings → Developer settings → GitHub Apps → the app → *Permissions & events*):
   add **Issues: Read and write** and change **Contents** to **Read and write** (screenshots are committed to the
   repository, see below). GitHub asks the organisation to accept the new permissions on the installation; then add
   the reports repository to the installation's selected repositories. GitHub App permissions apply to every selected
   repository, so the cockpit asks for installation tokens **limited to the reports repository** and to
   `issues`/`contents` write whenever it creates issues; the project sync keeps using read-only requests. If you
   prefer the app itself to stay read-only, register a second app with only *Issues* and *Contents* (read and write)
   and *Metadata* (read), install it on the reports repository only, and set its `client_id` and `private_key_file`
   in the `bug_reports` section.
3. Add the `bug_reports` section to `config.php` (see `config.example.php`): `repo` (owner/name), optional
   `label_prefix` (default `kompanie:`). The `status_reports` section must be present (it provides the
   organisation and switches the receiver on); without `bug_reports` the receiver answers 404 at `/reports`.
4. In `Kompanie-App-Template` set the repository variable `KOMPANIE_REPORT_URL` to
   `https://status.steuten-it-solutions.de/reports`. Every company gets a new version with that address at the next
   sync; until then the app shows no "Fehler melden" button. Deploy the cockpit (migration `0008`) first.

How it works:

- **Signature:** like format 2 status reports (`X-Kompanie-Signature`, HMAC-SHA256 with the installation's secret).
  The secret stored from the installation's status reports is used; installations that send no status reports teach
  the cockpit their secret with their first bug report (field `key`, trust on first use, stored encrypted with the app
  key in `report_installations`). A `key` never replaces a stored secret. `sent` within 10 minutes, new `nonce`.
- **Limits:** body at most 3 MB (screenshot at most 2 MB decoded, PNG/JPEG/WebP, checked to be a real image with at
  most 10000 px per edge); 30 reports per hour per IP (keyed hash, never stored in clear), 10 per installation, 200 in
  total. Only companies with a project card (or none synced yet) may register a new installation.
- **Answer:** `201` once the report is stored (`200` with `duplicate` for a report id seen before); the app deletes
  it then. The issue is created right after the response when PHP-FPM allows it (`fastcgi_finish_request`), else by
  the cron job (every 15 minutes). If GitHub fails, the report stays and the cron job tries again (status *warn* with
  the reason); reports without an issue are given up after 30 days.
- **Issue:** title = first line of the description; body = a table of the attached details (company, page, app
  version, device/browser, role, name if sent, time, last error message, installation, report id), the description,
  the expectation and the screenshot. All free text sits in code blocks or code spans, so it cannot mention people,
  reference issues or inject markup. Label `kompanie:<repository name>` (created if missing).
- **Screenshots:** GitHub's REST API cannot attach files to issues, so the cockpit commits the image to
  `screenshots/YYYY/MM/<report id>.<ext>` in the reports repository and embeds/links it in the issue. It is visible
  only to people with access to that private repository.
- **Retention:** after the issue exists, the cockpit clears the report's content and screenshot and keeps only the
  ids and the issue link for 30 days (to recognise a report sent twice). The reports repository holds the reports
  from then on; delete issues and screenshots there when they are no longer needed.
- The reports repository also shows up as a project card once the app can see it; hide it on the dashboard if you
  like.

## Invoicing (phase 4, in progress)

Outgoing invoices as ZUGFeRD/Factur-X hybrid PDFs (PDF/A-3 with the EN 16931 XML embedded), built with
`horstoeko/zugferd`. The plan, the legal basis and the open steps are in the project's planning document.

- `src/Invoicing/`: `Invoice`, `InvoiceLine` and `Party` (amounts in cents, quantities in thousandths),
  `ZugferdXml` (CII XML, profile EN 16931), `InvoicePdf` (visual PDF with FPDF, fonts embedded) and
  `HybridInvoice` (merges both). The PDF is drawn from the same object as the XML, because the XML is the
  leading part of a hybrid invoice.
- Small businesses (§ 19 UStG) get VAT category `E` with the exemption note and no VAT; standard rates 19 % and
  7 % and exempt lines are supported for later.
- `resources/fonts/`: DejaVu Sans converted for FPDF (license in `LICENSE-DejaVu.txt`); PDF/A needs embedded fonts.
- CI (`.github/workflows/einvoice.yml`) writes sample invoices with `bin/einvoice-samples.php` and validates them
  with [Mustang](https://www.mustangproject.org/) (schema, EN 16931 schematron, PDF/A-3 via veraPDF). The IONOS webspace
  had no Java, so this check runs before every deployment; on the VPS it could also run server-side later.
- Nothing is reachable from the web yet: no routes, no database tables.

## MCP server (in preparation)

The cockpit will offer an MCP server at `https://cockpit.steuten-it-solutions.de/mcp` (plan: read-only tools first,
OAuth with the cockpit's own login and TOTP). The first step is a **probe** that checks whether the host can serve it:
whether `/.well-known/` reaches the front controller and whether the `Authorization` header reaches PHP. Under
CGI/FastCGI Apache hides that header; `public/.htaccess` copies it into the environment.

- `GET /.well-known/oauth-protected-resource/mcp` (and without `/mcp`): Protected Resource Metadata (RFC 9728).
- `POST /mcp` without a token: `401` with `WWW-Authenticate: Bearer resource_metadata="…"`.
- `POST /mcp` with `Authorization: Bearer <probe_token>`: `200` and the server variable the header arrived in.
  The token is never echoed. A `401` with `"error": "unauthorized"` although a token was sent means the header
  does not reach PHP.
- `/mcp` needs no session and no CSRF token; without an `mcp` section in `config.php` every path answers `404`.

Test after the deployment, with an `mcp` section holding a random `probe_token`:

```bash
curl -i https://cockpit.steuten-it-solutions.de/.well-known/oauth-protected-resource/mcp
curl -i -X POST https://cockpit.steuten-it-solutions.de/mcp
read -rs TOKEN   # paste the probe_token, so it stays out of the shell history
curl -i -X POST -H "Authorization: Bearer $TOKEN" https://cockpit.steuten-it-solutions.de/mcp
```

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
