#!/usr/bin/env bash
# Receives a deployment on the VPS: the build as one gzipped tar archive on stdin.
#
# Installed by "bin/server-setup.sh deploy" as /usr/local/bin/cockpit-receive-deploy and
# bound to the deploy key in ~cockpit/.ssh/authorized_keys (command="...",restrict), so that
# key can run nothing else: no shell, no SFTP. .github/workflows/deploy.yml calls
#
#   ssh cockpit@host cockpit-receive-deploy probe          answers "ready"
#   ssh cockpit@host cockpit-receive-deploy < build.tgz    unpacks and switches over
#
# One archive instead of thousands of single SFTP transfers takes seconds instead of
# about 40 minutes. The archive is unpacked next to the application (same file system),
# then each top-level folder is swapped in with a rename, so a folder is either the old
# or the new version, never half of each. The replaced version stays in .previous/ until
# the next deployment. Rewriting .node-deployed last restarts the Node services
# (cockpit-app-deploy.path).
#
# Kept on the server, never replaced: config/ (config.php and the keys; only the example
# file is updated), var/ (runtime data). The archive must contain the marker files of a
# complete build, or nothing is changed.
#
# Runs as the deploy user. APP can be set for tests; on the server it is /srv/cockpit/app.
set -euo pipefail
umask 022

APP="${APP:-/srv/cockpit/app}"
# The archive is about 20 MB; anything far larger is not a build of this project.
MAX_BYTES=$((500 * 1024 * 1024))

# With command="..." in authorized_keys, the requested command arrives in SSH_ORIGINAL_COMMAND.
command_line="${SSH_ORIGINAL_COMMAND:-}"
request="${1:-${command_line##* }}"
if [ "$request" = "probe" ]; then
  echo "ready"
  exit 0
fi

[ -d "$APP" ] || { echo "receive-deploy: $APP does not exist." >&2; exit 1; }
started=$(date +%s)
staging="$(mktemp -d "$APP/../.deploy.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

# head stops at the limit; tar then fails on the cut archive and nothing is switched.
# GNU tar refuses member names with "..", strips leading "/" and creates symlinks last.
head -c "$MAX_BYTES" | tar -xzf - -C "$staging" --no-same-owner
for marker in .cockpit-deploy .node-deployed node/server/index.mjs config/config.example.php public/index.php; do
  [ -e "$staging/$marker" ] || { echo "receive-deploy: the archive has no $marker; nothing changed." >&2; exit 1; }
done

previous="$APP/.previous"
rm -rf "$previous"
mkdir "$previous"
# Never replaced or moved away (see above). .previous and .deploy-log are this script's own.
keep() { case "$1" in config|var|.previous|.deploy-log|.node-deployed) return 0 ;; *) return 1 ;; esac; }

# Like the old "mirror --delete": what is not part of the new build moves into .previous too.
for path in "$APP"/* "$APP"/.[!.]*; do
  [ -e "$path" ] || continue
  name="$(basename -- "$path")"
  keep "$name" || [ -e "$staging/$name" ] || mv -- "$path" "$previous/$name"
done
for path in "$staging"/* "$staging"/.[!.]*; do
  [ -e "$path" ] || continue
  name="$(basename -- "$path")"
  keep "$name" && continue
  if [ -e "$APP/$name" ]; then mv -- "$APP/$name" "$previous/$name"; fi
  mv -- "$path" "$APP/$name"
done
mkdir -p "$APP/config" "$APP/var"
cp -- "$staging/config/config.example.php" "$APP/config/config.example.php"
# Last: the marker restarts the Node services.
cp -- "$staging/.node-deployed" "$APP/.node-deployed"

echo "$(date -u +%FT%TZ) $(cat "$APP/.node-deployed") in $(( $(date +%s) - started )) s" >> "$APP/.deploy-log"
echo "receive-deploy: switched to $(cut -d' ' -f1 "$APP/.node-deployed") in $(( $(date +%s) - started )) s."
