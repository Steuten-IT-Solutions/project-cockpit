#!/usr/bin/env bash
# Uploads build/ to the target directory with lftp mirror --delete.
#
# Because --delete removes everything in the target that is not part of the build,
# a wrong target path could wipe unrelated folders. The upload therefore only runs if
# the target directory is empty, contains the marker file .cockpit-deploy from an
# earlier deployment, or contains nothing but names this project creates.
#
# Environment: SFTP_USER, SFTP_TARGET_DIR, LFTP_PASSWORD (read by --env-password),
# and either SFTP_HOST or LFTP_URL (the latter lets tests use file:// URLs).
set -euo pipefail

: "${SFTP_TARGET_DIR:?}"
url="${LFTP_URL:-sftp://${SFTP_HOST:?}}"
target="${SFTP_TARGET_DIR%/}"
[ -n "$target" ] || target="/"

settings="set net:max-retries 3; set net:timeout 30"
if [[ "$url" == sftp://* ]]; then
  settings="set sftp:connect-program \"ssh -a -x -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts\"; $settings"
fi

run_lftp() {
  if [[ "$url" == sftp://* ]]; then
    lftp --env-password -u "${SFTP_USER:?}" -e "$settings; $1; bye" "$url"
  else
    lftp -e "$settings; $1; bye" "$url"
  fi
}

# mirror --delete removes a whole directory that is missing from the build, including
# excluded files in it. Without build/config/ the server's config.php would be deleted.
if [ ! -f build/config/config.example.php ] || [ ! -f build/.cockpit-deploy ]; then
  echo "::error::build/ is incomplete; refusing to deploy."
  exit 1
fi

# Names a deployment of this project may leave in the target directory.
allowed=(.htaccess .cockpit-deploy composer.json config cron migrations public src templates vendor var)

listing="$(run_lftp "mkdir -p -f \"$target\"; cls -1 -a --basename \"$target/\"")"
entries="$(printf '%s\n' "$listing" | sed 's#/$##' | grep -vx -e '' -e '\.' -e '\.\.' || true)"

if ! printf '%s\n' "$entries" | grep -qxF '.cockpit-deploy'; then
  unexpected="$(printf '%s\n' "$entries" | grep -vxF "${allowed[@]/#/-e}" || true)"
  if [ -n "$unexpected" ]; then
    echo "::error::Refusing to deploy: $target is not an earlier deployment of this project and contains:"
    printf '  %s\n' $unexpected
    echo "Check SFTP_TARGET_DIR. Nothing was changed."
    exit 1
  fi
fi

# Excluded paths are neither uploaded nor deleted by --delete.
run_lftp "mirror --reverse --delete --verbose=1 --exclude-glob config/config.php --exclude-glob var/ build/ \"$target\""
