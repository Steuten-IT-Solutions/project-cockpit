-- Bug reports of the company apps (Kompanie-App-Template#64), received at POST /reports of the status subdomain.
-- Each report becomes an issue in the private reports repository (cron, or right after the response).

-- Secrets learned from bug reports of installations that send no status reports (trust on first use, like
-- installations.secret_enc). An installation in the installations table uses the secret stored there.
CREATE TABLE report_installations (
    id CHAR(32) NOT NULL PRIMARY KEY,
    kompanie VARCHAR(150) NOT NULL,
    secret_enc VARCHAR(255) NOT NULL,
    first_seen DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    KEY report_installations_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per report. payload: the validated fields as JSON; screenshot: the image bytes until it is committed.
-- After the issue exists, payload and screenshot are cleared; the row stays 30 days so a resent report
-- (same report_id) is recognised and does not open a second issue.
CREATE TABLE bug_reports (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    installation_id CHAR(32) NOT NULL,
    report_id CHAR(32) NOT NULL,
    kompanie VARCHAR(150) NOT NULL,
    payload MEDIUMTEXT NOT NULL,
    screenshot MEDIUMBLOB NULL,
    screenshot_type VARCHAR(20) NULL,
    screenshot_url VARCHAR(500) NULL,
    issue_number INT UNSIGNED NULL,
    issue_url VARCHAR(500) NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    last_error VARCHAR(255) NULL,
    received_at DATETIME NOT NULL,
    done_at DATETIME NULL,
    UNIQUE KEY bug_reports_report (installation_id, report_id),
    KEY bug_reports_pending (done_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reports per bucket (keyed hash of the IP, installation id, or "all") and UTC hour (YYYYMMDDHH): rate limits.
CREATE TABLE bug_report_counts (
    bucket VARCHAR(80) NOT NULL,
    hour CHAR(10) NOT NULL,
    received INT UNSIGNED NOT NULL,
    PRIMARY KEY (bucket, hour)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;
