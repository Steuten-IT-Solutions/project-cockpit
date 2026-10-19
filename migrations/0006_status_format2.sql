-- Status reports format 2 (Kompanie-App-Template#20, project-cockpit#12): one row per installation,
-- history of heartbeats and events, replay protection, alerts and push subscriptions. No IP addresses.

-- One row per installation (random id chosen by the app). The secret for the HMAC signature is stored
-- encrypted with the app key; it is learned from the first report (trust on first use).
CREATE TABLE installations (
    id CHAR(32) NOT NULL PRIMARY KEY,
    kompanie VARCHAR(150) NOT NULL,
    variant VARCHAR(20) NOT NULL,
    secret_enc VARCHAR(255) NOT NULL,
    version VARCHAR(30) NOT NULL,
    php VARCHAR(5) NOT NULL,
    db_driver VARCHAR(10) NOT NULL,
    cron_kind VARCHAR(10) NOT NULL,
    cron_last DATETIME NULL,
    checks TEXT NOT NULL,
    errors TEXT NOT NULL,
    features VARCHAR(255) NOT NULL,
    update_ok TINYINT(1) NULL,
    update_at DATETIME NULL,
    update_to VARCHAR(30) NULL,
    update_check_ok TINYINT(1) NOT NULL,
    gallery_ok TINYINT(1) NULL,
    gallery_at DATETIME NULL,
    first_seen DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    last_heartbeat DATETIME NULL,
    KEY installations_kompanie (kompanie),
    KEY installations_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every accepted heartbeat, kept 90 days.
CREATE TABLE status_heartbeats (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    installation_id CHAR(32) NOT NULL,
    received_at DATETIME NOT NULL,
    version VARCHAR(30) NOT NULL,
    checks TEXT NOT NULL,
    errors TEXT NOT NULL,
    cron_kind VARCHAR(10) NOT NULL,
    KEY status_heartbeats_installation (installation_id, received_at),
    KEY status_heartbeats_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every accepted event (severe error reported at once), kept 90 days.
CREATE TABLE status_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    installation_id CHAR(32) NOT NULL,
    code VARCHAR(40) NOT NULL,
    version VARCHAR(30) NOT NULL,
    received_at DATETIME NOT NULL,
    KEY status_events_installation (installation_id, received_at),
    KEY status_events_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;

-- Nonces of accepted reports within the replay window; a report with a known nonce is refused.
CREATE TABLE status_nonces (
    installation_id CHAR(32) NOT NULL,
    nonce CHAR(16) NOT NULL,
    received_at DATETIME NOT NULL,
    PRIMARY KEY (installation_id, nonce),
    KEY status_nonces_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;

-- Alerts: open while resolved_at is NULL. alert_key identifies what is wrong, e.g.
-- "silent", "check:gallery", "event:UPDATE_FAILED" or "release:1.4.0.3".
CREATE TABLE alerts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    installation_id CHAR(32) NULL,
    kompanie VARCHAR(150) NOT NULL,
    variant VARCHAR(20) NULL,
    alert_key VARCHAR(60) NOT NULL,
    detail VARCHAR(255) NOT NULL,
    opened_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    notified_at DATETIME NULL,
    resolved_at DATETIME NULL,
    resolved_notified_at DATETIME NULL,
    KEY alerts_open (resolved_at),
    KEY alerts_installation (installation_id, alert_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Web push subscriptions of the logged-in user (push without payload: only the endpoint is needed).
CREATE TABLE push_subscriptions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    created_at DATETIME NOT NULL,
    last_error VARCHAR(255) NULL,
    UNIQUE KEY push_subscriptions_endpoint (endpoint(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
