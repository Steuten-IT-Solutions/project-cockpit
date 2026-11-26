#!/usr/bin/env bash
# One-time setup of the cockpit's own VPS (Debian 13 "trixie", run as root).
#
#   bin/server-setup.sh base     packages, firewall, users, Apache, PHP-FPM, MariaDB, cron
#   bin/server-setup.sh certs    Let's Encrypt certificates; only after the DNS records
#                                of both host names point to this server
#
# The script is idempotent: running it again keeps existing data, passwords and keys.
# The mail server (Postfix, Dovecot, Rspamd) is a separate step that follows once outbound
# port 25 and reverse DNS have been verified; see README.md, "Own server".
#
# Layout:
#   /srv/cockpit/app        deployment target (SFTP_TARGET_DIR), owned by user cockpit
#   /srv/cockpit/app/public    document root of COCKPIT_HOST
#   /srv/cockpit/app/receiver  document root of STATUS_HOST
#   PHP-FPM pool "cockpit" runs as user cockpit, so config/config.php can stay chmod 600.
set -euo pipefail

COCKPIT_HOST="${COCKPIT_HOST:-cockpit.steuten-it-solutions.de}"
STATUS_HOST="${STATUS_HOST:-status.steuten-it-solutions.de}"
PHP="8.4"
USER_NAME="cockpit"
BASE="/srv/cockpit"
APP="$BASE/app"
SOCKET="/run/php/php$PHP-fpm-cockpit.sock"

die() { echo "server-setup: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
. /etc/os-release
[ "${ID:-}" = "debian" ] && [ "${VERSION_ID:-}" = "13" ] || die "expects Debian 13, found ${PRETTY_NAME:-unknown}"

base() {
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q
    apt-get install -y -q \
        apache2 "php$PHP-fpm" "php$PHP-cli" "php$PHP-curl" "php$PHP-mbstring" "php$PHP-mysql" \
        "php$PHP-xml" "php$PHP-zip" mariadb-server ufw unattended-upgrades certbot python3-certbot-apache \
        fail2ban python3-systemd rsync

    # Security updates install themselves (Debian's default origins: security archive).
    dpkg-reconfigure -f noninteractive unattended-upgrades

    # Firewall: SSH, HTTP, HTTPS. Mail ports are opened by the mail server step.
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable

    # SSH: keys only, but never lock out an admin who has no key yet.
    if [ -s /root/.ssh/authorized_keys ] || compgen -G '/home/*/.ssh/authorized_keys' > /dev/null; then
        cat > /etc/ssh/sshd_config.d/10-cockpit.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
        systemctl reload ssh
    else
        echo "server-setup: no authorized_keys found; password login left on. Add a key and run again." >&2
    fi

    # fail2ban reads SSH logins from the journal; Debian 13 has no /var/log/auth.log by default.
    cat > /etc/fail2ban/jail.d/cockpit.local <<'EOF'
[sshd]
enabled = true
backend = systemd
EOF
    systemctl restart fail2ban

    # Deploy user: SFTP with a key, owns the application.
    if ! id "$USER_NAME" > /dev/null 2>&1; then
        useradd --system --home-dir "$BASE" --shell /bin/bash "$USER_NAME"
    fi
    install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$BASE" "$APP"
    install -d -o "$USER_NAME" -g "$USER_NAME" -m 700 "$BASE/.ssh"
    touch "$BASE/.ssh/authorized_keys"
    chown "$USER_NAME:$USER_NAME" "$BASE/.ssh/authorized_keys"
    chmod 600 "$BASE/.ssh/authorized_keys"

    # PHP-FPM pool as the deploy user; Apache talks to it over a socket only it may use.
    cat > "/etc/php/$PHP/fpm/pool.d/cockpit.conf" <<EOF
[cockpit]
user = $USER_NAME
group = $USER_NAME
listen = $SOCKET
listen.owner = www-data
listen.group = www-data
listen.mode = 0660
pm = ondemand
pm.max_children = 8
pm.process_idle_timeout = 30s
php_admin_value[expose_php] = Off
EOF
    systemctl restart "php$PHP-fpm"

    a2enmod -q rewrite headers proxy_fcgi setenvif ssl > /dev/null
    a2dissite -q 000-default > /dev/null || true
    vhost "$COCKPIT_HOST" "$APP/public" > /etc/apache2/sites-available/cockpit.conf
    vhost "$STATUS_HOST" "$APP/receiver" > /etc/apache2/sites-available/cockpit-status.conf
    a2ensite -q cockpit cockpit-status > /dev/null
    apache2ctl configtest
    systemctl reload apache2

    # Database and user; the password is generated once and kept for config.php.
    local secret="/root/cockpit-database.txt"
    if [ ! -f "$secret" ]; then
        local password
        password="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
        mariadb <<EOF
CREATE DATABASE IF NOT EXISTS cockpit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'cockpit'@'localhost' IDENTIFIED BY '$password';
GRANT ALL PRIVILEGES ON cockpit.* TO 'cockpit'@'localhost';
EOF
        (umask 077 && printf "dsn: mysql:host=localhost;port=3306;dbname=cockpit;charset=utf8mb4\nuser: cockpit\npassword: %s\n" "$password" > "$secret")
    fi

    # Cron every 15 minutes as the deploy user.
    cat > /etc/cron.d/cockpit <<EOF
*/15 * * * * $USER_NAME [ -f $APP/cron/run.sh ] && /bin/sh $APP/cron/run.sh > /dev/null
EOF

    # Nightly database dump, one file per weekday (kept 7 days). Any file backup of the server
    # (e.g. STRATO Cyber Protect) then holds a consistent copy of the database.
    install -d -m 700 /var/backups/cockpit
    cat > /etc/cron.d/cockpit-dump <<'EOF'
SHELL=/bin/bash
30 2 * * * root set -o pipefail; mariadb-dump --single-transaction --routines cockpit | gzip > /var/backups/cockpit/cockpit-$(date +\%u).sql.gz
EOF

    cat <<EOF

Done. Next steps (README.md, "Own server"):
  1. Put the deploy key's public half into $BASE/.ssh/authorized_keys.
  2. GitHub secrets: SFTP_HOST, SFTP_USER=$USER_NAME, SFTP_PRIVATE_KEY,
     SFTP_KNOWN_HOSTS (ssh-keyscan of this server), SFTP_TARGET_DIR=$APP. Then deploy.
  3. Copy config.php and the .pem files from the webspace to $APP/config/, set the database
     values from $secret, then: chown $USER_NAME: $APP/config/* && chmod 600 $APP/config/*
  4. After the DNS switch: bin/server-setup.sh certs
EOF
}

# Apache virtual host for one host name; .htaccess files of the build apply (AllowOverride All).
vhost() {
    cat <<EOF
<VirtualHost *:80>
    ServerName $1
    DocumentRoot $2
    <Directory $2>
        AllowOverride All
        Require all granted
    </Directory>
    <FilesMatch "\.php$">
        SetHandler "proxy:unix:$SOCKET|fcgi://localhost"
    </FilesMatch>
    ErrorLog \${APACHE_LOG_DIR}/$1-error.log
    CustomLog \${APACHE_LOG_DIR}/$1-access.log combined
</VirtualHost>
EOF
}

certs() {
    certbot --apache --non-interactive --agree-tos --register-unsafely-without-email \
        --redirect -d "$COCKPIT_HOST" -d "$STATUS_HOST"
}

case "${1:-}" in
    base) base ;;
    certs) certs ;;
    *) die "usage: $0 base|certs" ;;
esac
