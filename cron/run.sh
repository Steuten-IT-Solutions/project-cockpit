#!/bin/sh
# Cron entry point for the IONOS cron manager.
#
# The manager's UnixCron command field takes a single absolute path without
# spaces or arguments, so it cannot call "/usr/bin/php8.4 -f …" itself. This
# wrapper picks the newest available PHP CLI (plain /usr/bin/php is PHP 4.4 on
# IONOS) and runs cron/run.php with it. The dashboard shows the exact path to enter.

for php in /usr/bin/php8.4-cli /usr/bin/php8.4 /usr/bin/php8.3-cli /usr/bin/php8.3; do
    if [ -x "$php" ]; then
        exec "$php" -f "$(dirname "$0")/run.php"
    fi
done

echo "cockpit cron: no PHP 8.3 or 8.4 CLI found in /usr/bin" >&2
exit 1
