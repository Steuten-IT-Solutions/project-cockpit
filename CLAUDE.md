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
- Only `public/` (cockpit) and `receiver/` (status subdomain) are web-reachable. Do not
  add PHP files to either other than their `index.php`; everything else is routed through it.
- Escape every dynamic value in templates with `$e()`. No inline scripts or styles:
  the CSP forbids them.
- Every POST needs the `_csrf` field (except the receiver's report endpoint, which has no
  session). State changes only via POST.
- Store timestamps in UTC (`gmdate`); convert for display with `View::localTime()`.
- Schema changes are new files in `migrations/` (`NNNN_name.sql`), never edits of applied ones.
  There is no SSH on the host: migrations run from `cron/run.php` and the setup page.
- Must work on phones and desktop: mobile-first CSS, cards in `.grid` from 900 px.
- Do not suppress PHPStan errors; fix the cause.
