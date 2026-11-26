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
#   bin/server-setup.sh mail-import <address>
#                                copy the mail of the same address from the old IMAP server
#                                (IMPORT_HOST, default imap.ionos.de; IMPORT_USER, default the
#                                same address; IMPORT_SEPARATOR, its folder separator, default /);
#                                asks for its password
#
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

case "${1:-}" in
    base) base ;;
    certs) certs ;;
    mail) mailserver ;;
    mail-password) mail_password "${2:-}" ;;
    mail-import) mail_import "${2:-}" ;;
    backup) backup "${2:-}" ;;
    *) die "usage: $0 base|certs|mail|mail-password <address>|mail-import <address>|backup <storage box>" ;;
esac
