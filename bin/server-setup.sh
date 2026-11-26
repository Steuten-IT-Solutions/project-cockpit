#!/usr/bin/env bash
# One-time setup of the cockpit's own VPS (Debian 13 "trixie", run as root).
#
#   bin/server-setup.sh base     packages, firewall, users, Apache, PHP-FPM, MariaDB, cron
#   bin/server-setup.sh certs    Let's Encrypt certificates; only after the DNS records
#                                of both host names point to this server
#   bin/server-setup.sh mail     mail server: Postfix, Dovecot, Rspamd (DKIM, spam filter);
#                                after outbound port 25 and reverse DNS of MAIL_HOST are verified
#   bin/server-setup.sh mail-password <address>
#                                set or change the password of one mailbox (asks twice)
#   bin/server-setup.sh backup <uXXXXX@uXXXXX.your-storagebox.de>
#                                nightly encrypted restic backup to a Hetzner Storage Box
#                                (asks for the Storage Box password once, to install the key)
#   bin/server-setup.sh archive  mail archive (piler): a copy of every message, kept 10 years,
#                                searchable on https://MAIL_HOST/; after "mail" and "backup"
#   bin/server-setup.sh mail-import <address>
#                                copy the mail of the same address from the old IMAP server
#                                (IMPORT_HOST, default imap.ionos.de; IMPORT_USER, default the
#                                same address; IMPORT_SEPARATOR, its folder separator, default /);
#                                asks for its password
#
# On the server, "cockpit-setup <step>" loads the current version from GitHub (main) and runs it.
# The script is idempotent: running it again keeps existing data, passwords and keys.
# See README.md, "Own server" and "Mail server".
#
# Layout:
#   /srv/cockpit/app        deployment target (SFTP_TARGET_DIR), owned by user cockpit
#   /srv/cockpit/app/public    document root of COCKPIT_HOST
#   /srv/cockpit/app/receiver  document root of STATUS_HOST
#   PHP-FPM pool "cockpit" runs as user cockpit, so config/config.php can stay chmod 600.
set -euo pipefail
umask 022

COCKPIT_HOST="${COCKPIT_HOST:-cockpit.steuten-it-solutions.de}"
STATUS_HOST="${STATUS_HOST:-status.steuten-it-solutions.de}"
MAIL_HOST="${MAIL_HOST:-mail.steuten-it-solutions.de}"
MAIL_DOMAIN="${MAIL_DOMAIN:-steuten-it-solutions.de}"
# Mailboxes (local parts) and forwardings (alias:mailbox). A forwarding's target may send as
# the alias; every mailbox sends as itself. Running "mail" again applies changes to these lists.
MAILBOXES="christian.steuten info rechnung eingangsrechnung dmarc"
FORWARDS="invoice:rechnung belege:eingangsrechnung noreply:christian.steuten postmaster:christian.steuten abuse:christian.steuten"
ADMIN_MAILBOX="christian.steuten"
DKIM_SELECTOR="${DKIM_SELECTOR:-s2026}"
# Mail archive (piler). The commit is piler's main branch of 2026-11-10: release 1.4.9 plus the
# fix for SQL injection in the web search (#526) and for MariaDB Connector/C 3.4 (#483).
# MANTICORE_VERSION is the one piler's docker-compose.yaml uses at that commit. MANTICORE_KEY
# is the fingerprint of the signing key that repo.manticoresearch.com served on 2026-11-26; a
# different key is refused instead of trusted.
PILER_COMMIT="147d3d328ba3b0fc125254ed67212aec69caf94d"
MANTICORE_VERSION="29.9.0-26091108-58e88d5ab"
MANTICORE_KEY="1E5171BE1E522F8C900D0FF4B48FF4F279F5BFA6"
ARCHIVE_DOMAIN="piler.internal"
ARCHIVE_ADDRESS="archive@$ARCHIVE_DOMAIN"
# 10 years: invoices and other vouchers must be kept 8 years from the end of the calendar year
# (business letters 6), so a message from January needs almost 9.
ARCHIVE_RETENTION_DAYS=3653
PHP="8.4"
USER_NAME="cockpit"
BASE="/srv/cockpit"
APP="$BASE/app"
SOCKET="/run/php/php$PHP-fpm-cockpit.sock"

die() { echo "server-setup: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
. /etc/os-release
[ "${ID:-}" = "debian" ] && [ "${VERSION_ID:-}" = "13" ] || die "expects Debian 13, found ${PRETTY_NAME:-unknown}"

# "cockpit-setup <step> ..." on the server loads the current version of this script from main
# and runs it, so it never has to be copied by hand. Installed by every run of this script.
install_wrapper() {
    cat > /usr/local/sbin/cockpit-setup <<'EOF'
#!/bin/bash
# Written by server-setup.sh. Loads bin/server-setup.sh from the main branch and runs it.
set -euo pipefail
url="https://raw.githubusercontent.com/Steuten-IT-Solutions/project-cockpit/main/bin/server-setup.sh"
tmp="$(mktemp /root/server-setup.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL --proto '=https' "$url" -o "$tmp"
bash -n "$tmp"
install -m 700 "$tmp" /root/server-setup.sh
rm -f "$tmp"
exec bash /root/server-setup.sh "$@"
EOF
    chmod 755 /usr/local/sbin/cockpit-setup
}
install_wrapper

base() {
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q
    apt-get install -y -q \
        apache2 "php$PHP-fpm" "php$PHP-cli" "php$PHP-curl" "php$PHP-mbstring" "php$PHP-mysql" \
        "php$PHP-xml" "php$PHP-zip" mariadb-server ufw unattended-upgrades certbot python3-certbot-apache \
        fail2ban python3-systemd rsync cron

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

    # Cron every 15 minutes as the deploy user. Minimal Debian images ship without a cron daemon.
    systemctl enable --now cron
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

# Mail server for MAIL_DOMAIN. Postfix receives (25) and accepts submissions from mail clients
# and the cockpit (587 STARTTLS, 465 TLS, login required); Dovecot stores the mailboxes as
# virtual users under /var/vmail and serves IMAP on 993 only; Rspamd filters spam (marked
# mail goes to Junk) and DKIM-signs outgoing mail. Local mail (PHP mail(), cron) is signed too.
mailserver() {
    export DEBIAN_FRONTEND=noninteractive
    local tls="/etc/letsencrypt/live/$MAIL_HOST"
    local dkim_key="/var/lib/rspamd/dkim/$MAIL_DOMAIN.$DKIM_SELECTOR.key"

    # Postfix replaces exim4, which the cron package pulled in.
    debconf-set-selections <<EOF
postfix postfix/main_mailer_type select Internet Site
postfix postfix/mailname string $MAIL_HOST
EOF
    apt-get update -q
    apt-get install -y -q postfix dovecot-imapd dovecot-lmtpd dovecot-sieve rspamd redis-server
    local exim
    exim="$(dpkg-query -W -f='${Package} ${db:Status-Status}\n' 'exim4*' 2> /dev/null | awk '$2 != "not-installed" {print $1}')" || true
    if [ -n "$exim" ]; then
        # shellcheck disable=SC2086
        apt-get purge -y -q $exim
    fi

    # Certificate for MAIL_HOST: a plain HTTP host for the ACME challenge, then certbot.
    install -d -m 755 /var/www/mail
    cat > /etc/apache2/sites-available/cockpit-mail.conf <<EOF
<VirtualHost *:80>
    ServerName $MAIL_HOST
    DocumentRoot /var/www/mail
    <Directory /var/www/mail>
        AllowOverride None
        Require all granted
    </Directory>
    ErrorLog \${APACHE_LOG_DIR}/$MAIL_HOST-error.log
    CustomLog \${APACHE_LOG_DIR}/$MAIL_HOST-access.log combined
</VirtualHost>
EOF
    a2ensite -q cockpit-mail > /dev/null
    # Rspamd pulls in javascript-common, whose Apache config serves /javascript/ on every host.
    a2disconf -q javascript-common > /dev/null 2>&1 || true
    apache2ctl configtest
    systemctl reload apache2
    if [ ! -f "$tls/fullchain.pem" ]; then
        certbot certonly --apache --non-interactive --agree-tos --register-unsafely-without-email \
            --cert-name "$MAIL_HOST" -d "$MAIL_HOST"
    fi
    install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
    cat > /etc/letsencrypt/renewal-hooks/deploy/cockpit-mail.sh <<'EOF'
#!/bin/sh
# Postfix and Dovecot read their certificate at start; pick up a renewed one.
systemctl reload postfix dovecot
EOF
    chmod 755 /etc/letsencrypt/renewal-hooks/deploy/cockpit-mail.sh

    # Virtual mail user and the address lists.
    if ! id vmail > /dev/null 2>&1; then
        useradd --system --home-dir /var/vmail --shell /usr/sbin/nologin vmail
    fi
    install -d -o vmail -g vmail -m 750 /var/vmail
    local vmail_uid
    vmail_uid="$(id -u vmail)"

    local box alias target
    {
        echo "# Written by server-setup.sh mail; edit MAILBOXES there."
        for box in $MAILBOXES; do echo "$box@$MAIL_DOMAIN OK"; done
    } > /etc/postfix/vmailbox
    {
        echo "# Written by server-setup.sh mail; edit FORWARDS there."
        for alias in $FORWARDS; do echo "${alias%%:*}@$MAIL_DOMAIN ${alias#*:}@$MAIL_DOMAIN"; done
    } > /etc/postfix/virtual
    {
        echo "# Written by server-setup.sh mail: which login may send as which address."
        for box in $MAILBOXES; do echo "$box@$MAIL_DOMAIN $box@$MAIL_DOMAIN"; done
        for alias in $FORWARDS; do echo "${alias%%:*}@$MAIL_DOMAIN ${alias#*:}@$MAIL_DOMAIN"; done
    } > /etc/postfix/sender_login
    {
        echo "# Written by server-setup.sh mail: mailboxes known to Dovecot (passwords: /etc/dovecot/passwd)."
        for box in $MAILBOXES; do echo "$box@$MAIL_DOMAIN::::::"; done
    } > /etc/dovecot/mailboxes
    touch /etc/dovecot/passwd
    chown root:dovecot /etc/dovecot/passwd
    chmod 640 /etc/dovecot/passwd

    # Mail for root (cron, unattended-upgrades) goes to the admin mailbox.
    if grep -q '^root:' /etc/aliases; then
        sed -i "s/^root:.*/root: $ADMIN_MAILBOX@$MAIL_DOMAIN/" /etc/aliases
    else
        echo "root: $ADMIN_MAILBOX@$MAIL_DOMAIN" >> /etc/aliases
    fi
    newaliases

    # Postfix.
    postconf -e \
        "myhostname = $MAIL_HOST" \
        "mydomain = $MAIL_DOMAIN" \
        'myorigin = $myhostname' \
        'mydestination = $myhostname, localhost.$mydomain, localhost' \
        'inet_interfaces = all' \
        'inet_protocols = all' \
        'smtp_address_preference = ipv4' \
        "virtual_mailbox_domains = $MAIL_DOMAIN" \
        'virtual_mailbox_maps = texthash:/etc/postfix/vmailbox' \
        'virtual_alias_maps = texthash:/etc/postfix/virtual' \
        'virtual_transport = lmtp:unix:private/dovecot-lmtp' \
        'smtpd_sender_login_maps = texthash:/etc/postfix/sender_login' \
        'smtpd_sasl_type = dovecot' \
        'smtpd_sasl_path = private/auth' \
        'smtpd_sasl_auth_enable = no' \
        "smtpd_tls_chain_files = $tls/privkey.pem, $tls/fullchain.pem" \
        'smtpd_tls_security_level = may' \
        'smtpd_tls_auth_only = yes' \
        'smtpd_tls_mandatory_protocols = >=TLSv1.2' \
        'smtpd_tls_loglevel = 1' \
        'smtp_tls_security_level = may' \
        'smtp_tls_loglevel = 1' \
        'smtpd_helo_required = yes' \
        'disable_vrfy_command = yes' \
        'smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination' \
        'smtpd_recipient_restrictions = reject_non_fqdn_recipient, reject_unknown_recipient_domain' \
        'smtpd_milters = inet:127.0.0.1:11332' \
        'non_smtpd_milters = $smtpd_milters' \
        'milter_default_action = tempfail' \
        'milter_protocol = 6' \
        'message_size_limit = 52428800' \
        'authorized_submit_users = root, cockpit'
    postconf -X smtpd_tls_cert_file smtpd_tls_key_file
    local port
    for port in submission submissions; do
        postconf -M "$port/inet=$port inet n - y - - smtpd"
        postconf -P \
            "$port/inet/syslog_name=postfix/$port" \
            "$port/inet/smtpd_sasl_auth_enable=yes" \
            "$port/inet/smtpd_client_restrictions=permit_sasl_authenticated,reject" \
            "$port/inet/smtpd_sender_restrictions=reject_sender_login_mismatch" \
            "$port/inet/smtpd_relay_restrictions=permit_sasl_authenticated,reject" \
            "$port/inet/milter_macro_daemon_name=ORIGINATING"
    done
    postconf -P 'submission/inet/smtpd_tls_security_level=encrypt' 'submissions/inet/smtpd_tls_wrappermode=yes'
    # The archive step changes smtpd_recipient_restrictions above; keep its settings.
    [ ! -f /etc/piler/piler.conf ] || postfix_archive
    postfix check

    # Dovecot. Debian's 10-auth.conf enables system users (PAM): divert it so that only the
    # virtual mailboxes can log in; package updates then go to 10-auth.conf.dist.
    if ! dpkg-divert --list /etc/dovecot/conf.d/10-auth.conf | grep -q .; then
        dpkg-divert --local --rename --divert /etc/dovecot/conf.d/10-auth.conf.dist \
            --add /etc/dovecot/conf.d/10-auth.conf
    fi
    echo "# Authentication is configured in /etc/dovecot/local.conf (server-setup.sh mail)." \
        > /etc/dovecot/conf.d/10-auth.conf
    cat > /etc/dovecot/local.conf <<EOF
# Written by server-setup.sh mail; running it again overwrites this file.
hostname = $MAIL_HOST
mail_driver = maildir
mail_home = /var/vmail/%{user | domain}/%{user | username}
mail_path = ~/Maildir
mail_inbox_path = .
mail_uid = vmail
mail_gid = vmail
mail_privileged_group =
first_valid_uid = $vmail_uid
last_valid_uid = $vmail_uid

namespace inbox {
  mailbox Drafts {
    auto = subscribe
  }
  mailbox Junk {
    auto = subscribe
  }
  mailbox Trash {
    auto = subscribe
  }
  mailbox Sent {
    auto = subscribe
  }
}

ssl = required
ssl_server_cert_file = $tls/fullchain.pem
ssl_server_key_file = $tls/privkey.pem
ssl_min_protocol = TLSv1.2

auth_mechanisms = plain login
passdb passwd-file {
  passwd_file_path = /etc/dovecot/passwd
  use_worker = yes
}
userdb passwd-file {
  passwd_file_path = /etc/dovecot/mailboxes
  fields {
    uid:default = vmail
    gid:default = vmail
    home:default = /var/vmail/%{user | domain}/%{user | username}
  }
}

# IMAP only with TLS (993); 143 stays closed.
service imap-login {
  inet_listener imap {
    port = 0
  }
}
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}
service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}
protocol lmtp {
  auth_username_format = %{user | lower}
  mail_plugins {
    sieve = yes
  }
}

# Mail that Rspamd marks as spam goes to Junk.
sieve_script spam-to-junk {
  type = before
  driver = file
  path = /etc/dovecot/sieve/spam-to-junk.sieve
}
EOF
    install -d -m 755 /etc/dovecot/sieve
    cat > /etc/dovecot/sieve/spam-to-junk.sieve <<'EOF'
require ["fileinto"];
if header :is "X-Spam" "Yes" {
  fileinto "Junk";
  stop;
}
EOF
    sievec /etc/dovecot/sieve/spam-to-junk.sieve
    doveconf -n > /dev/null

    # Rspamd: Redis for its statistics, DKIM signing with a key generated once.
    cat > /etc/rspamd/local.d/redis.conf <<'EOF'
servers = "127.0.0.1";
EOF
    cat > /etc/rspamd/local.d/dkim_signing.conf <<EOF
selector = "$DKIM_SELECTOR";
path = "/var/lib/rspamd/dkim/\$domain.\$selector.key";
EOF
    cat > /etc/rspamd/local.d/milter_headers.conf <<'EOF'
use = ["authentication-results"];
EOF
    install -d -o _rspamd -g _rspamd -m 750 /var/lib/rspamd/dkim
    if [ ! -f "$dkim_key" ]; then
        rspamadm dkim_keygen -s "$DKIM_SELECTOR" -d "$MAIL_DOMAIN" -b 2048 -k "$dkim_key" \
            > "/var/lib/rspamd/dkim/$MAIL_DOMAIN.$DKIM_SELECTOR.txt"
        chown _rspamd:_rspamd "$dkim_key" "/var/lib/rspamd/dkim/$MAIL_DOMAIN.$DKIM_SELECTOR.txt"
        chmod 600 "$dkim_key"
    fi
    rspamadm configtest > /dev/null

    # Firewall and fail2ban for the mail ports.
    ufw allow 25/tcp
    ufw allow 465/tcp
    ufw allow 587/tcp
    ufw allow 993/tcp
    cat > /etc/fail2ban/jail.d/cockpit-mail.local <<'EOF'
[postfix]
enabled = true
backend = systemd

[postfix-sasl]
enabled = true
backend = systemd

[dovecot]
enabled = true
backend = systemd
EOF

    systemctl enable --now redis-server rspamd postfix dovecot
    systemctl restart redis-server rspamd dovecot postfix
    systemctl restart fail2ban

    local dkim
    dkim="$(grep -o '"[^"]*"' "/var/lib/rspamd/dkim/$MAIL_DOMAIN.$DKIM_SELECTOR.txt" | tr -d '"\n')"
    local without
    without=""
    for box in $MAILBOXES; do
        grep -q "^$box@$MAIL_DOMAIN:" /etc/dovecot/passwd || without="$without $box@$MAIL_DOMAIN"
    done
    cat <<EOF

Mail server is running. Next steps (README.md, "Mail server"):
  1. Passwords for the mailboxes still without one:${without:- none}
     bash server-setup.sh mail-password <address>
  2. DNS records for $MAIL_DOMAIN (keep the MX records unchanged until the tests pass):
     TXT  $DKIM_SELECTOR._domainkey   $dkim
     TXT  _dmarc            v=DMARC1; p=none; rua=mailto:dmarc@$MAIL_DOMAIN
     SPF (TXT @): add  ip4:$(ip_of 4) ip6:$(ip_of 6)  to the existing record
  3. Test sending and receiving, then point the MX record to $MAIL_HOST.
EOF
}

# First global address of this server (ip_of 4|6).
ip_of() {
    ip "-$1" -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -n 1
}

# Set or change the password of one mailbox. doveadm asks for it twice; it never appears
# on the command line or in the shell history.
mail_password() {
    local address="${1:-}" box found=""
    for box in $MAILBOXES; do
        [ "$address" = "$box@$MAIL_DOMAIN" ] && found=1
    done
    [ -n "$found" ] || die "unknown mailbox '$address'; mailboxes: $(for box in $MAILBOXES; do printf '%s@%s ' "$box" "$MAIL_DOMAIN"; done)"
    [ -f /etc/dovecot/passwd ] || die "run '$0 mail' first"
    local hash
    hash="$(doveadm pw -s ARGON2ID)"
    local tmp
    tmp="$(mktemp /etc/dovecot/passwd.XXXXXX)"
    { grep -v "^$address:" /etc/dovecot/passwd || true; echo "$address:$hash"; } > "$tmp"
    chown root:dovecot "$tmp"
    chmod 640 "$tmp"
    mv "$tmp" /etc/dovecot/passwd
    echo "server-setup: password of $address set."
}

# Nightly off-site backup with restic to a Hetzner Storage Box (SFTP on port 23). The data is
# encrypted on this server; the repository password is generated once in
# /root/restic-password and must also be kept outside the server (password manager), or the
# backup cannot be restored after losing the server. Cron mails a failure to root.
backup() {
    local target="${1:-}"
    [[ "$target" =~ ^(u[0-9]+)@(u[0-9]+(-sub[0-9]+)?\.your-storagebox\.de)$ ]] \
        || die "usage: $0 backup uXXXXX@uXXXXX.your-storagebox.de"
    local user="${BASH_REMATCH[1]}" host="${BASH_REMATCH[2]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -q restic

    install -d -m 700 /root/.ssh
    [ -f /root/.ssh/storagebox ] || ssh-keygen -q -t ed25519 -N '' -C "backup@$(hostname)" -f /root/.ssh/storagebox
    cat > /root/.ssh/config.d-storagebox <<EOF
Host storagebox
    HostName $host
    User $user
    Port 23
    IdentityFile /root/.ssh/storagebox
    IdentitiesOnly yes
    ServerAliveInterval 60
EOF
    touch /root/.ssh/config
    if ! grep -q '^Include /root/.ssh/config.d-storagebox' /root/.ssh/config; then
        # Include must come before any Host block, so it goes first.
        { echo 'Include /root/.ssh/config.d-storagebox'; cat /root/.ssh/config; } > /root/.ssh/config.new
        mv /root/.ssh/config.new /root/.ssh/config
    fi
    chmod 600 /root/.ssh/config /root/.ssh/config.d-storagebox
    if ! ssh-keygen -F "[$host]:23" > /dev/null 2>&1; then
        ssh-keyscan -p 23 -t ed25519 "$host" >> /root/.ssh/known_hosts 2> /dev/null
    fi
    if ! ssh -o BatchMode=yes storagebox pwd > /dev/null 2>&1; then
        echo "server-setup: installing the backup key; enter the Storage Box password:"
        ssh -o IdentitiesOnly=yes -o PubkeyAuthentication=no -p 23 "$user@$host" install-ssh-key \
            < /root/.ssh/storagebox.pub
    fi
    ssh -o BatchMode=yes storagebox pwd > /dev/null || die "key login to the Storage Box failed"

    if [ ! -f /root/restic-password ]; then
        (umask 077 && head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > /root/restic-password)
    fi
    cat > /root/restic.env <<'EOF'
RESTIC_REPOSITORY=sftp:storagebox:cockpit-restic
RESTIC_PASSWORD_FILE=/root/restic-password
RESTIC_CACHE_DIR=/var/cache/restic
EOF
    chmod 600 /root/restic.env
    set -a
    . /root/restic.env
    set +a
    restic cat config > /dev/null 2>&1 || restic init

    cat > /usr/local/sbin/cockpit-backup <<'EOF'
#!/bin/bash
# Written by server-setup.sh backup. Quiet on success; cron mails any output to root.
set -euo pipefail
set -a
. /root/restic.env
set +a
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
# Chained with &&: inside "if !" a failing command would not stop a plain list (set -e is off).
if ! {
    restic backup --quiet --exclude-caches --exclude /root/.cache \
        /var/vmail /srv/cockpit/app/config /var/backups/cockpit /etc /root /var/lib/rspamd/dkim \
    && restic forget --quiet --prune --keep-daily 7 --keep-weekly 5 --keep-monthly 12 \
    && { [ "$(date +%u)" != 7 ] || restic check --quiet; }
} > "$log" 2>&1; then
    echo "Backup FAILED on $(hostname) at $(date -u +%FT%TZ):"
    cat "$log"
    exit 1
fi
EOF
    chmod 700 /usr/local/sbin/cockpit-backup
    # After the database dump at 02:30.
    cat > /etc/cron.d/cockpit-backup <<'EOF'
15 3 * * * root /usr/local/sbin/cockpit-backup
EOF

    echo "server-setup: first backup run (can take a while) ..."
    /usr/local/sbin/cockpit-backup
    restic snapshots --compact
    cat <<EOF

Backup is set up: every night at 03:15 to $host (restic, encrypted).
  1. Store the repository password in your password manager (never in chat or Git):
     cat /root/restic-password
     Without it the backup cannot be restored.
  2. Storage Box console: enable automatic snapshots (e.g. daily, keep 10).
  Restore example: set -a; . /root/restic.env; set +a; restic restore latest --target /tmp/restore --include /var/vmail
EOF
}

# Copy all folders of <address> from the old provider into the local mailbox of the same name.
# One-way and repeatable: mail that is only here stays, mail already copied is not copied twice.
# A full comparison (-f) on every run, because a quick check can miss new mail on both sides.
# The password goes into a root-only file read by the config parser, never onto a command line.
mail_import() {
    local address="${1:-}" box found=""
    for box in $MAILBOXES; do
        [ "$address" = "$box@$MAIL_DOMAIN" ] && found=1
    done
    [ -n "$found" ] || die "unknown mailbox '$address'"
    local host="${IMPORT_HOST:-imap.ionos.de}" user="${IMPORT_USER:-$address}" password dir
    read -r -s -p "Password of $user at $host: " password
    echo
    [ -n "$password" ] || die "no password given"
    dir="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$dir'" EXIT
    printf '%s' "$password" > "$dir/password"
    cat > "$dir/import.conf" <<EOF
dovecot_config_version = 2.4.0
dovecot_storage_version = 2.4.0
!include /etc/dovecot/dovecot.conf
imapc_host = $host
imapc_port = 993
imapc_ssl = imaps
imapc_user = $user
imapc_password = <$dir/password
# dsync needs the same folder separator on both sides; IONOS uses "/", this server ".".
# Only the name in IMAP differs: the Maildir++ folders on disk are the same either way.
namespace inbox {
  separator = ${IMPORT_SEPARATOR:-/}
}
EOF
    doveadm -c "$dir/import.conf" sync -1 -f -R -u "$address" imapc:
    echo "server-setup: copied. Folders of $address now:"
    doveadm mailbox status -u "$address" messages '*'
}

# GoBD mail archive with piler (https://www.mailpiler.org). Postfix hands a copy of every
# message it accepts (incoming, outgoing, local) to piler on 127.0.0.1:2525 (always_bcc),
# before any client can delete it. piler stores each message compressed, encrypted
# (/etc/piler/piler.key) and with its digest, keeps it ARCHIVE_RETENTION_DAYS, and offers a
# full-text search on https://MAIL_HOST/ (HTTP basic auth in front of piler's own login).
# There is no Debian 13 package: piler is built from a pinned commit, Manticore (its search
# index) comes from Manticore's own repository at the version piler's compose file uses.
archive() {
    export DEBIAN_FRONTEND=noninteractive
    [ -f /etc/dovecot/local.conf ] || die "run '$0 mail' first"
    local tls="/etc/letsencrypt/live/$MAIL_HOST"
    local pkg

    # Manticore: signing key checked against its known fingerprint before apt trusts it.
    # Manticore publishes no trixie suite yet; its own installer uses bookworm on Debian 13.
    apt-get install -y -q curl gnupg
    if [ ! -f /usr/share/keyrings/manticore.gpg ]; then
        local keydir fpr
        keydir="$(mktemp -d)"
        curl -fsSL https://repo.manticoresearch.com/GPG-KEY-SHA256-manticore -o "$keydir/key.asc"
        fpr="$(gpg --show-keys --with-colons "$keydir/key.asc" | awk -F: '$1 == "fpr" {print $10; exit}')"
        [ "$fpr" = "$MANTICORE_KEY" ] || die "Manticore signing key has fingerprint '$fpr', expected $MANTICORE_KEY"
        gpg --batch --yes --dearmor -o /usr/share/keyrings/manticore.gpg "$keydir/key.asc"
        rm -rf "$keydir"
    fi
    cat > /etc/apt/sources.list.d/manticore.sources <<'EOF'
Types: deb
URIs: https://repo.manticoresearch.com/repository/manticoresearch_bookworm
Suites: bookworm
Components: main
Signed-By: /usr/share/keyrings/manticore.gpg
EOF
    apt-get update -q
    local manticore=""
    for pkg in manticore-server manticore-server-core manticore-common manticore-tools; do
        manticore="$manticore $pkg=$MANTICORE_VERSION"
    done
    apt-mark unhold manticore-server manticore-server-core manticore-common manticore-tools > /dev/null 2>&1 || true
    # shellcheck disable=SC2086
    apt-get install -y -q --no-install-recommends --allow-downgrades $manticore
    apt-mark hold manticore-server manticore-server-core manticore-common manticore-tools > /dev/null
    # piler runs its own searchd (pilersearch.service) with its own configuration.
    systemctl disable --now manticore > /dev/null 2>&1 || true

    # Build tools, libraries, attachment text extractors, PHP modules of the web interface;
    # sysstat provides mpstat for the CPU load on piler's status page.
    apt-get install -y -q gcc make libc6-dev git libssl-dev libtre-dev libzip-dev libmariadb-dev \
        libcurl4-openssl-dev zlib1g-dev catdoc unrtf poppler-utils tnef python3 python3-mysqldb sysstat \
        "php$PHP-cli" "php$PHP-fpm" "php$PHP-mysql" "php$PHP-gd" "php$PHP-ldap" "php$PHP-zip" \
        "php$PHP-curl" "php$PHP-xml" "php$PHP-mbstring" apache2-utils

    if ! id piler > /dev/null 2>&1; then
        useradd --system --user-group --home-dir /var/piler --shell /usr/sbin/nologin piler
    fi

    # Build and install piler when the pinned commit is not installed yet. An update of
    # PILER_COMMIT may need database changes: read piler's upgrade notes first.
    if [ "$(cat /usr/share/piler/COMMIT 2> /dev/null)" != "$PILER_COMMIT" ]; then
        local src="/usr/local/src/piler"
        rm -rf "$src"
        git init -q "$src"
        git -C "$src" fetch -q --depth 1 https://github.com/jsuto/piler.git "$PILER_COMMIT"
        git -C "$src" checkout -q FETCH_HEAD
        [ "$(git -C "$src" rev-parse HEAD)" = "$PILER_COMMIT" ] || die "piler checkout is not $PILER_COMMIT"
        (cd "$src" && ./configure --prefix=/usr --sysconfdir=/etc --localstatedir=/var > /dev/null \
            && make -j"$(nproc)" > /dev/null && make install > /dev/null)
        echo "$PILER_COMMIT" > /usr/share/piler/COMMIT
    fi

    # Directories and keys, as piler's own package does after installing.
    chmod 755 /var/piler
    chown piler:piler /var/piler/error /var/piler/imap /var/piler/stat /var/piler/store \
        /var/piler/tmp /var/piler/run /var/piler/manticore
    chgrp www-data /var/piler/export
    chown piler:www-data /var/piler/www/tmp /var/piler/www/images
    chmod 775 /var/piler/www/tmp /var/piler/www/images
    if [ ! -f /etc/piler/piler.key ]; then
        # The key encrypts every stored message: without it the archive cannot be read.
        (umask 077 && head -c 56 /dev/urandom > /etc/piler/piler.key)
    fi
    chown root:piler /etc/piler/piler.key
    chmod 640 /etc/piler/piler.key
    if [ ! -f /etc/piler/piler.pem ]; then
        openssl req -new -newkey rsa:4096 -days 3650 -nodes -x509 -subj "/CN=$ARCHIVE_DOMAIN" \
            -keyout /etc/piler/piler.pem -out /etc/piler/piler.crt 2> /dev/null
        cat /etc/piler/piler.crt >> /etc/piler/piler.pem
        rm -f /etc/piler/piler.crt
    fi
    chown root:piler /etc/piler/piler.pem
    chmod 640 /etc/piler/piler.pem

    # Database, with a password generated once.
    local secret="/root/piler-database.txt" dbpass
    if [ ! -f "$secret" ]; then
        (umask 077 && head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32 > "$secret")
    fi
    dbpass="$(cat "$secret")"
    mariadb <<EOF
CREATE DATABASE IF NOT EXISTS piler CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'piler'@'localhost' IDENTIFIED BY '$dbpass';
ALTER USER 'piler'@'localhost' IDENTIFIED BY '$dbpass';
GRANT ALL PRIVILEGES ON piler.* TO 'piler'@'localhost';
EOF
    local access="/root/piler-access.txt"
    if ! mariadb piler -e 'SELECT 1 FROM metadata LIMIT 1' > /dev/null 2>&1; then
        mariadb piler < /usr/share/piler/db-mysql.sql
        # Replace the well-known default passwords of piler's built-in accounts.
        local admin auditor web
        admin="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
        auditor="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
        web="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
        mariadb piler <<EOF
UPDATE user SET password = '$(php_crypt "$admin")' WHERE uid = 0;
UPDATE user SET password = '$(php_crypt "$auditor")' WHERE uid = 1;
EOF
        printf '%s\n' "$web" | htpasswd -i -B -c /etc/apache2/piler.htpasswd archiv 2> /dev/null
        (umask 077 && cat > "$access" <<EOF
Mail archive https://$MAIL_HOST/
1. Browser login (HTTP basic auth):  archiv / $web
2. piler login, search all mail:      auditor@local / $auditor
   piler login, administration:       admin@local / $admin
EOF
        )
    fi
    [ -f /etc/apache2/piler.htpasswd ] || die "piler database exists, but /etc/apache2/piler.htpasswd is missing"
    chown root:www-data /etc/apache2/piler.htpasswd
    chmod 640 /etc/apache2/piler.htpasswd

    # piler.conf: the distributed defaults plus this server's values.
    sed -e "s/^hostid=.*/hostid=$ARCHIVE_DOMAIN/" \
        -e "s/^archive_address=.*/archive_address=$ARCHIVE_ADDRESS/" \
        -e 's/^listen_addr=.*/listen_addr=127.0.0.1/' \
        -e 's/^listen_port=.*/listen_port=2525/' \
        -e "s/^default_retention_days=.*/default_retention_days=$ARCHIVE_RETENTION_DAYS/" \
        -e 's/^spam_header_line=.*/spam_header_line=X-Spam: Yes/' \
        -e 's/^mysqlhost=.*/mysqlhost=/' \
        -e "s/^mysqlpwd=.*/mysqlpwd=$dbpass/" \
        /etc/piler/piler.conf.dist > /etc/piler/piler.conf
    chown root:piler /etc/piler/piler.conf
    chmod 640 /etc/piler/piler.conf
    install -m 755 /etc/piler/manticore.conf.dist /etc/piler/manticore.conf
    [ -f /etc/piler/MANTICORE ] || touch /etc/piler/MANTICORE
    cat > /etc/piler/config-site.php <<EOF
<?php
// Written by server-setup.sh archive; running it again overwrites this file.
define('SITE_NAME_CONST', 'SITE_NAME');
\$config[SITE_NAME_CONST] = '$MAIL_HOST';
\$config['PATH_PREFIX'] = '/';
\$config['SITE_URL'] = 'https://$MAIL_HOST/';
\$config['SMTP_DOMAIN'] = '$MAIL_HOST';
\$config['SMTP_FROMADDR'] = 'noreply@$MAIL_DOMAIN';
\$config['ADMIN_EMAIL'] = 'postmaster@$MAIL_DOMAIN';
\$config['DEFAULT_LANG'] = 'de';
\$config['TIMEZONE'] = 'Europe/Berlin';
\$config['DB_PASSWORD'] = '$dbpass';
\$config['ENABLE_DELETE'] = 0;
\$config['ENABLE_AUDIT'] = 1;
\$config['CAPTCHA_FAILED_LOGIN_COUNT'] = 3;
\$config['HEADER_LINE_TO_HIDE'] = 'X-Envelope-To:';
EOF
    chown root:www-data /etc/piler/config-site.php
    chmod 640 /etc/piler/config-site.php
    install -d -o piler -g piler -m 755 /etc/piler/sites
    [ -f /etc/piler/sites/customer-sites.php ] || printf '<?php\n' > /etc/piler/sites/customer-sites.php
    chown piler:piler /etc/piler/sites/customer-sites.php

    # Services and piler's cron jobs (indexing, purge after the retention period).
    local unit
    for unit in pilersearch piler piler-smtp; do
        ln -sf "/usr/libexec/piler/$unit.service" "/etc/systemd/system/$unit.service"
    done
    systemctl daemon-reload
    systemctl enable pilersearch piler piler-smtp > /dev/null 2>&1
    systemctl restart pilersearch
    systemctl restart piler piler-smtp
    crontab -u piler /usr/share/piler/piler.cron

    # Web interface: its own PHP-FPM pool, HTTPS only, basic auth in front of piler's login.
    cat > "/etc/php/$PHP/fpm/pool.d/piler.conf" <<EOF
[piler]
user = www-data
group = www-data
listen = /run/php/php$PHP-fpm-piler.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660
pm = ondemand
pm.max_children = 4
pm.process_idle_timeout = 30s
php_admin_value[expose_php] = Off
EOF
    systemctl restart "php$PHP-fpm"
    cat > /etc/apache2/sites-available/cockpit-archive.conf <<EOF
<VirtualHost *:443>
    ServerName $MAIL_HOST
    DocumentRoot /var/piler/www
    SSLEngine on
    SSLCertificateFile $tls/fullchain.pem
    SSLCertificateKeyFile $tls/privkey.pem
    Header always set Strict-Transport-Security "max-age=31536000"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "same-origin"
    <Directory /var/piler/www>
        AllowOverride All
        AuthType Basic
        AuthName "Mail-Archiv"
        AuthUserFile /etc/apache2/piler.htpasswd
        Require valid-user
    </Directory>
    <FilesMatch "\.php$">
        SetHandler "proxy:unix:/run/php/php$PHP-fpm-piler.sock|fcgi://localhost"
    </FilesMatch>
    ErrorLog \${APACHE_LOG_DIR}/$MAIL_HOST-archive-error.log
    CustomLog \${APACHE_LOG_DIR}/$MAIL_HOST-archive-access.log combined
</VirtualHost>
EOF
    a2enmod -q ssl headers rewrite proxy_fcgi > /dev/null
    a2ensite -q cockpit-archive > /dev/null
    apache2ctl configtest
    systemctl reload apache2

    postfix_archive
    systemctl reload postfix

    # Mail that arrived before the archive existed: every mailbox once (Maildir cur/ and new/).
    # pilerimport runs as piler (setuid), which may not read /var/vmail: import from a copy, and
    # from inside /var/piler/tmp, because it writes its temporary files into the current directory.
    if [ ! -f /var/piler/stat/vmail-imported ]; then
        local box copy
        for box in $MAILBOXES; do
            [ -d "/var/vmail/$MAIL_DOMAIN/$box" ] || continue
            copy="$(mktemp -d -p /var/piler/tmp import.XXXXXX)"
            find "/var/vmail/$MAIL_DOMAIN/$box" -type f \( -path '*/cur/*' -o -path '*/new/*' \) \
                -exec cp -t "$copy" {} +
            chown -R piler:piler "$copy"
            (cd /var/piler/tmp && pilerimport -q -d "$copy" -a "$box@$MAIL_DOMAIN") || true
            rm -rf "$copy"
        done
        date -u +%FT%TZ > /var/piler/stat/vmail-imported
    fi

    archive_backup_setup

    local sync
    sync="$(timedatectl show -p NTPSynchronized --value 2> /dev/null || echo unknown)"
    cat <<EOF

Mail archive is running: every message from now on, plus the mail already in the mailboxes.
  Clock synchronised (NTP): $sync
  1. Store the logins in your password manager (never in chat or Git), then delete the file:
     cat $access && rm $access
  2. Open https://$MAIL_HOST/ and log in as auditor@local; set up two-factor authentication
     under Settings for both piler accounts.
  3. Keep /etc/piler/piler.key safe: it is in the backup; without it the archive cannot be read.
EOF
}

# Postfix part of the archive. Called by "archive" and again by "mail", which rewrites the
# restrictions. Every recipient that smtpd accepts is noted in an X-Envelope-To header, so that
# piler also knows Bcc recipients; the header goes to piler only and is removed before any
# other delivery (smtp to other servers, lmtp to the own mailboxes). The PREPEND comes last, so
# that a recipient rejected by an earlier check is not noted.
postfix_archive() {
    echo "/^(.+)\$/ PREPEND X-Envelope-To: \$1" > /etc/postfix/archive_envelope_to
    echo '/^X-Envelope-To:/ IGNORE' > /etc/postfix/archive_strip
    echo "$ARCHIVE_DOMAIN piler:[127.0.0.1]:2525" > /etc/postfix/transport
    postconf -e \
        "always_bcc = $ARCHIVE_ADDRESS" \
        'transport_maps = texthash:/etc/postfix/transport' \
        'smtpd_recipient_restrictions = reject_non_fqdn_recipient, reject_unknown_recipient_domain, reject_unlisted_recipient, check_recipient_access regexp:/etc/postfix/archive_envelope_to' \
        'smtp_header_checks = regexp:/etc/postfix/archive_strip' \
        'lmtp_header_checks = regexp:/etc/postfix/archive_strip'
    postconf -M 'piler/unix=piler unix - - y - - smtp'
    postconf -P 'piler/unix/smtp_header_checks=' 'piler/unix/smtp_tls_security_level=none' \
        'piler/unix/syslog_name=postfix/piler'
    postfix check
}

# Nightly off-site copy of the archive into its own restic repository on the Storage Box.
# Unlike the server backup it is never thinned out, so a message stays recoverable for the
# whole retention period even if it disappears from this server. Saved: the encrypted messages,
# /etc/piler (with the key), a database dump and piler's access log (audit1, kept in its search
# index); the search index itself can be rebuilt from the messages (piler's reindex).
archive_backup_setup() {
    if [ ! -f /root/restic.env ]; then
        echo "server-setup: no backup configured yet; run '$0 backup ...', then '$0 archive' again." >&2
        return 0
    fi
    install -d -m 700 /var/backups/piler
    cat > /usr/local/sbin/cockpit-archive-backup <<'EOF'
#!/bin/bash
# Written by server-setup.sh archive. Quiet on success; cron mails any output to root.
set -euo pipefail
set -a
. /root/restic.env
RESTIC_REPOSITORY=sftp:storagebox:cockpit-archive
set +a
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
# Chained with &&: inside "if !" a failing command would not stop a plain list (set -e is off).
if ! {
    mariadb-dump --single-transaction piler | gzip > /var/backups/piler/piler.sql.gz \
    && mariadb --skip-ssl -h 127.0.0.1 -P 9306 -e \
        'SELECT * FROM audit1 ORDER BY id ASC LIMIT 100000000 OPTION max_matches=100000000' \
        | gzip > /var/backups/piler/audit.tsv.gz \
    && restic backup --quiet /var/piler/store /etc/piler /var/backups/piler \
    && { [ "$(date +%u)" != 7 ] || restic check --quiet; }
} > "$log" 2>&1; then
    echo "Archive backup FAILED on $(hostname) at $(date -u +%FT%TZ):"
    cat "$log"
    exit 1
fi
EOF
    chmod 700 /usr/local/sbin/cockpit-archive-backup
    (
        set -a
        . /root/restic.env
        RESTIC_REPOSITORY=sftp:storagebox:cockpit-archive
        set +a
        restic cat config > /dev/null 2>&1 || restic init > /dev/null
    )
    # After the server backup at 03:15 and piler's purge at 03:40.
    echo '15 4 * * * root /usr/local/sbin/cockpit-archive-backup' > /etc/cron.d/cockpit-archive-backup
    /usr/local/sbin/cockpit-archive-backup
}

# crypt() hash for piler's user table (SHA-512, as piler itself writes).
php_crypt() {
    php -r 'echo crypt($argv[1], "\$6\$rounds=5000\$" . bin2hex(random_bytes(8)) . "\$");' "$1"
}

case "${1:-}" in
    base) base ;;
    certs) certs ;;
    mail) mailserver ;;
    mail-password) mail_password "${2:-}" ;;
    mail-import) mail_import "${2:-}" ;;
    backup) backup "${2:-}" ;;
    archive) archive ;;
    *) die "usage: $0 base|certs|mail|mail-password <address>|mail-import <address>|backup <storage box>|archive" ;;
esac
