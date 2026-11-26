# Cockpit (Nuxt)

The new cockpit, built with [Nuxt](https://nuxt.com) (Vue 3, TypeScript). It replaces the
PHP cockpit in the repository root on one cutover day; until then the PHP cockpit stays in
production unchanged. This app's build is deployed alongside, but serves nothing before the
cutover (see "Deployment" below). The plan is in the project's planning document
"Cockpit-Neuentwicklung in Nuxt".

Both cockpits share the same MariaDB database and the same `app_key`, so accounts, TOTP
enrolments, recovery codes and all data carry over without any conversion.

## How Nuxt is organised

Nuxt finds most files by their folder, so there are few imports and no route table.

```
app/                  everything that runs in the browser (and is rendered on the server first)
  app.vue             root component: the Nuxt UI wrapper around every page
  layouts/default.vue frame of every page: header with user and logout
  pages/              one file per URL: pages/index.vue is "/", pages/login/code.vue is "/login/code"
  middleware/         runs before a page opens: auth.global.ts sends logged-out visitors to /login
  composables/        shared functions for pages, e.g. useCockpitSession()
  plugins/            run once when the app starts
server/               runs only on the server (Nitro)
  api/                one file per API endpoint: api/login.post.ts answers POST /api/login
  middleware/         runs before every request: session.ts loads the session and checks CSRF
  utils/              helpers available in every server file without an import
  lib/                plain TypeScript (crypto, TOTP, passwords, sessions), imported explicitly and unit-tested
  database/schema.ts  the tables, described for typed queries (the SQL itself is in ../migrations)
shared/types/         types used by both sides
test/unit/            tests of server/lib, including fixtures written by the PHP cockpit
test/integration/     the built server against a real database
nuxt.config.ts        modules, security headers, runtime settings
```

A page is a Vue single-file component: `<script setup lang="ts">` holds the logic, `<template>`
the HTML. Values in `{{ … }}` and bound attributes are escaped by Vue automatically. The UI
components (`UButton`, `UCard`, `UInput`, …) come from [Nuxt UI](https://ui.nuxt.com); the
styling uses Tailwind classes. Text in the interface is German and addresses the user with "du".

## Local development

Needs Node.js 24 and a MariaDB with the migrations from `../migrations` applied (for example by
running the PHP cockpit's `php cron/run.php` once with a local `config/config.php`).

```bash
cd app
npm ci
cp .env.example .env      # fill in NUXT_APP_KEY, NUXT_DATABASE_URL, NUXT_SECURE_COOKIES=false
npm run dev               # http://localhost:3000
```

Checks, also run by CI (`.github/workflows/app.yml`):

```bash
npm run check             # lint, types, unit tests
npm run build
TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/cockpit_test npm run test:integration
```

The integration tests drop and recreate the database named in `TEST_DATABASE_URL`, apply every
migration and log in through the built server. Never point them at real data.

## Configuration

Only environment variables, never committed (see `.env.example`):

| Variable | Meaning |
| --- | --- |
| `NUXT_APP_KEY` | The `app_key` from the PHP cockpit's `config.php`. Decrypts TOTP secrets, keys the hashes of IPs and recovery codes. |
| `NUXT_DATABASE_URL` | `mysql://user:password@host:3306/database` |
| `NUXT_SECURE_COOKIES` | `true` in production (cookie `__Host-cockpit-session`, Secure); `false` only for local http |
| `NUXT_SESSION_IDLE_TIMEOUT`, `NUXT_SESSION_ABSOLUTE_TIMEOUT` | Optional, seconds; default 2 h and 12 h like the PHP cockpit |

## Security

The same rules as the PHP cockpit, checked by the integration tests:

- **Login:** password (Argon2id; bcrypt hashes from an old host are accepted and replaced), then
  a TOTP code or a single-use recovery code. 5 failures per account or 20 per IP within 15 minutes
  block further attempts. Every login, failure and logout goes to `auth_events` with a keyed hash
  of the IP.
- **Sessions:** stored in `web_sessions`; the cookie holds a random token, the table only its
  SHA-256. New token on every login step, 2 h idle and 12 h absolute timeout, deleted on logout.
  Cookie `HttpOnly`, `SameSite=Strict`, `Secure` with the `__Host-` prefix.
- **CSRF:** every request that changes something needs the session's token in `X-CSRF-Token`,
  and a foreign `Origin` is refused.
- **Headers:** a strict Content Security Policy. Scripts only from the own origin plus Nuxt's
  bootstrap scripts, which carry a per-response nonce. Styles allow `'unsafe-inline'`, because
  the UI components set style attributes at runtime; injected CSS cannot run code. Framing is
  forbidden, no CORS, `no-store`, `noindex`.
- **Client IP:** Node listens on localhost only; behind Apache the last `X-Forwarded-For` entry
  is used, which Apache appends and a client cannot forge.

## Status

Everything the PHP cockpit does is rebuilt and tested; the cutover is prepared and waits for the
owner's go.

| Part | State |
| --- | --- |
| Login, logout, sessions, security headers, setup page for the first account | done |
| Dashboard, projects, Vercel, releases, costs, installations, alerts, push | done |
| Background jobs every 15 minutes (today `cron/run.php`) and the refresh button | done |
| Receivers on the status subdomain (status reports, bug reports, GitHub webhook) | done |
| Deployment, server setup (systemd, Apache), rehearsal, cutover and rollback | done, not yet run on the server |

Known, accepted differences from the PHP cockpit:

- JSON numbers like `5.0` count as whole numbers in JavaScript; PHP treats them as decimals and
  refused them where a whole number is required. The company apps never send `5.0`.
- The cron status shows `node 24.x` instead of the PHP version.
- The MCP probe (`/mcp`, `/.well-known/oauth-protected-resource`) is not carried over: it only
  tested the old webspace. The MCP server itself will be built in this app.

## Deployment

A merge to `main` runs `.github/workflows/deploy.yml`: CI of both cockpits, then the PHP files as
before and this app's build (`.output`, Node server with all dependencies) to
`/srv/cockpit/app/node` on the VPS (`bin/deploy-sftp.sh`). The new build is uploaded next to the
running one and swapped in with two renames, so a running server never sees half of each. Then
the file `.node-deployed` is rewritten, and systemd restarts the Node services
(`cockpit-app-deploy.path`). The previous build stays in `node-old/`.

On the server (all steps as root, `cockpit-setup <step>` loads the current `bin/server-setup.sh`
from `main`):

| Step | What it does |
| --- | --- |
| `cockpit-setup node` | Installs Node.js 24 (official build, checksum pinned), writes `/etc/cockpit/app.env` from `config/config.php` (`bin/config-to-env.php`) and the systemd units. Starts nothing before the cutover. Run it again after every change of `config.php`; a running cockpit then restarts with the new values. |
| `cockpit-setup rehearsal` | Copies the database to `cockpit_rehearsal` and starts the Node cockpit on it at `127.0.0.1:3001`, without background jobs, e-mails, push, issues or receiver. Open it through an SSH tunnel (the step prints the command). |
| `cockpit-setup rehearsal-stop` | Stops the rehearsal and drops the copy. |
| `cockpit-setup cutover` | Switches both host names to the Node cockpit (details below). |
| `cockpit-setup rollback` | Back to the PHP cockpit: its Apache sites and cron job again, Node stopped. |

`config/config.php` stays the only place for settings, also after the cutover: the PHP cockpit
remains deployed as the way back, and both read the same values, database and key files.

### What the cutover does

1. Writes `app.env` from `config.php`, starts `cockpit-app` (Node on `127.0.0.1:3000`) and checks
   that the login page answers. If not, nothing is switched.
2. Notes the enabled Apache sites of `cockpit.` and `status.` (the PHP ones, written by `base` and
   certbot) in `/etc/cockpit/php-sites`, disables them and enables `cockpit-node`:
   - `cockpit.steuten-it-solutions.de` → Node; `/_receiver` is blocked there.
   - `status.steuten-it-solutions.de` → Node under `/_receiver/` (the receiver answers only this
     host name); at most 3.2 MB per request.
   - Port 80 redirects to HTTPS, except Let's Encrypt's challenges. TLS uses the existing
     certificate.
   An invalid configuration switches back at once.
3. Checks through Apache that the cockpit page comes from Nuxt, the status receiver answers and
   `/_receiver` is blocked on the cockpit host. If not, it switches back to PHP.
4. Turns the PHP cron job off (`/etc/cron.d/cockpit`, saved for the rollback) and enables
   `cockpit-app` at boot. The jobs now run inside Node every 15 minutes, with the same database
   lock as before.
5. Tests the certificate renewal (`certbot renew --dry-run`); a failure is only a warning.

### Cutover checklist

Before:

1. Merge the pull request; wait until the deploy workflow is green.
2. `cockpit-setup node`, then `cockpit-setup rehearsal`.
3. On the PC: `ssh -N -L 3001:127.0.0.1:3001 root@<server>` and open `http://localhost:3001`.
   Log in (same password and code), look at the overview, a project, costs, alerts and an
   installation, press "Aktualisieren", save a note. Everything touches only the copy.
4. `cockpit-setup rehearsal-stop`.

Cutover (about 5 minutes, best when no release is running):

5. `cockpit-setup cutover`.
6. Log in at `https://cockpit.steuten-it-solutions.de` (the old session ends; log in again).
7. Within an hour: the overview shows new heartbeats of the company apps, and the cron status a
   run by `node`. `journalctl -u cockpit-app -f` shows the server's log.
8. On the phone: open the cockpit once and check that push still works (page "Warnungen").

If something is wrong: `cockpit-setup rollback`, and the PHP cockpit is back as before.
