-- Costs entered by hand (domains, webspace, subscriptions). Amounts in cents of their own currency.
CREATE TABLE costs (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(100) NULL,
    amount_cents INT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL,
    billing_interval VARCHAR(5) NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    note VARCHAR(255) NULL,
    created_at DATETIME NOT NULL,
    KEY costs_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vercel charges of the current calendar month, summed per service, charge category and
-- project. Replaced completely by every successful sync.
CREATE TABLE vercel_charges (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    service VARCHAR(150) NOT NULL,
    category VARCHAR(20) NOT NULL,
    project VARCHAR(150) NULL,
    billed_cost DECIMAL(14, 6) NOT NULL,
    effective_cost DECIMAL(14, 6) NOT NULL,
    currency CHAR(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- State of the last charges sync: one row, id = 1.
CREATE TABLE vercel_billing (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    period_from DATE NULL,
    period_to DATE NULL,
    synced_at DATETIME NULL,
    error VARCHAR(255) NULL,
    error_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
