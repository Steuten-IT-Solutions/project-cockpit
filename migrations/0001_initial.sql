-- Users of the cockpit. Phase 1 has exactly one; the schema does not assume that.
CREATE TABLE users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    -- TOTP secret, encrypted with the app key (Crypto::encrypt).
    totp_secret_enc VARCHAR(255) NOT NULL,
    -- Last accepted TOTP time step; codes at or below it are rejected (no replay).
    totp_last_step BIGINT NULL,
    created_at DATETIME NOT NULL,
    last_login_at DATETIME NULL,
    UNIQUE KEY users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Single-use recovery codes, stored as keyed hashes.
CREATE TABLE recovery_codes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    code_hash CHAR(64) NOT NULL,
    used_at DATETIME NULL,
    UNIQUE KEY recovery_codes_hash (code_hash),
    KEY recovery_codes_user (user_id),
    CONSTRAINT recovery_codes_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Failed authentication attempts, for throttling. key_hash is a keyed hash of
-- the username or the client IP; raw IPs are never stored.
CREATE TABLE auth_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    scope VARCHAR(16) NOT NULL,
    key_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    KEY auth_attempts_lookup (scope, key_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Security log: logins, failures, logouts, setup.
CREATE TABLE auth_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NULL,
    event VARCHAR(32) NOT NULL,
    ip_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    KEY auth_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per cron run, so the dashboard can show that the scheduler works
-- and which PHP version it uses.
CREATE TABLE cron_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NULL,
    php_version VARCHAR(32) NOT NULL,
    php_sapi VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    message VARCHAR(255) NULL,
    KEY cron_runs_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
