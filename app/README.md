# Cockpit (Nuxt)

The new cockpit, built with [Nuxt](https://nuxt.com) (Vue 3, TypeScript). It replaces the
PHP cockpit in the repository root on one cutover day; until then the PHP cockpit stays in
production unchanged and this folder is not deployed. The plan is in the project's planning
document "Cockpit-Neuentwicklung in Nuxt".

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

| Part | State |
| --- | --- |
| Login, logout, sessions, security headers | done |
| Setup page for the first account | open |
| Dashboard, projects, Vercel, releases | open |
| Costs, status reports, alerts, push, bug reports | open |
| Jobs (today `cron/run.php`) | open |
| Receivers on the status subdomain | open |
| Server setup (systemd, Apache) and cutover | open |
