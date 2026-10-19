-- Status reports of the company apps (Kompanie-Apps), received at the status subdomain.
-- One row per company and variant: a new report replaces the previous one. No IP addresses.
-- The collation is case-insensitive like GitHub repository names.
CREATE TABLE status_reports (
    kompanie VARCHAR(150) NOT NULL,
    variant VARCHAR(20) NOT NULL,
    version VARCHAR(30) NOT NULL,
    php VARCHAR(5) NOT NULL,
    db_driver VARCHAR(10) NOT NULL,
    update_ok TINYINT(1) NULL,
    update_at DATETIME NULL,
    update_to VARCHAR(30) NULL,
    update_check_ok TINYINT(1) NOT NULL,
    gallery_ok TINYINT(1) NULL,
    gallery_at DATETIME NULL,
    sent_at DATETIME NULL,
    received_at DATETIME NOT NULL,
    PRIMARY KEY (kompanie, variant),
    KEY status_reports_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reports received per UTC hour (YYYYMMDDHH), a coarse brake against flooding.
CREATE TABLE status_report_hours (
    hour CHAR(10) NOT NULL PRIMARY KEY,
    received INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;
