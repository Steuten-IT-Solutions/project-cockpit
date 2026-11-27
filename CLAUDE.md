# CLAUDE.md

Project instructions for Claude Code in this repository. See README.md for the
architecture, server setup and security model.

## Language

- Everything in Git is English: code, identifiers, comments, commit messages,
  branch names, PR titles and descriptions, documentation.
- The user interface (templates, flash messages, error pages, cron status messages
  shown in the UI) is German, addressing the user informally ("du").

## Workflow

- Never push to `main` directly. Work on `feat/…`, `fix/…`, `chore/…`, `docs/…` branches
  and open a pull request. Merging to `main` deploys to production.
- Conventional Commits: `<type>(<scope>): <imperative summary>`, under 72 characters.
- Run `composer check` (lint, PHPStan level 8, PHPUnit) before pushing.

## Rules

- Never commit secrets. `config/config.php` exists only on the server.
- Only `public/` (cockpit), `receiver/` (status subdomain) and `website/` (static company site on
  www) are web-reachable. Do not add PHP files to the first two other than their `index.php`;
  everything else is routed through it. `website/` holds only HTML, CSS and images; run
  `bin/check-website.sh` after changing it.
- Escape every dynamic value in templates with `$e()`. No inline scripts or styles:
  the CSP forbids them.
- Every POST needs the `_csrf` field (except the receiver's report endpoint, which has no
  session). State changes only via POST.
- Store timestamps in UTC (`gmdate`); convert for display with `View::localTime()`.
- Schema changes are new files in `migrations/` (`NNNN_name.sql`), never edits of applied ones.
  Migrations run from `cron/run.php` and the setup page (the IONOS webspace has no SSH;
  the own VPS has, but keep migrations working without it).
- Must work on phones and desktop: mobile-first CSS, cards in `.grid` from 900 px.
- Do not suppress PHPStan errors; fix the cause.

## New cockpit (app/)

The cockpit is being rebuilt in Nuxt in `app/` (see `app/README.md`). It replaces the PHP
cockpit on one cutover day; until then the PHP cockpit only gets bug fixes.

- Run `npm run check` and `npm run build` in `app/` before pushing; CI also runs the integration
  tests against MariaDB (`.github/workflows/app.yml`).
- Same database and `app_key` as the PHP cockpit: never change how stored data is read or
  written without keeping the PHP cockpit working until the cutover.
- Schema changes stay SQL files in `migrations/`; `server/database/schema.ts` only describes them.
- No `v-html` and no inline scripts; the CSP allows scripts only with Nuxt's nonce.
- State changes only via POST/PUT/DELETE with the `X-CSRF-Token` header (`cockpitPost()`).
- Keep pure logic in `server/lib/` with unit tests; the owner is new to Vue and TypeScript, so
  comment the why and explain changes in plain words in the PR description.
