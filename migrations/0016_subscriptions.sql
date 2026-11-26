-- ERP module 4: recurring invoices (see app/README.md, "ERP"). On next_date the jobs
-- create a draft invoice for the period starting then and move next_date on by
-- interval_months; the drafts are checked and finalized by hand.

CREATE TABLE subscriptions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    customer_id INT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    name VARCHAR(100) NOT NULL,
    interval_months TINYINT UNSIGNED NOT NULL,
    next_date DATE NOT NULL,
    end_date DATE NULL,
    note TEXT NULL,
    active TINYINT(1) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY subscriptions_due (active, next_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subscription_lines (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    subscription_id INT UNSIGNED NOT NULL,
    position SMALLINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    quantity_milli INT UNSIGNED NOT NULL,
    unit VARCHAR(3) NOT NULL,
    unit_price_cents INT UNSIGNED NOT NULL,
    vat_rate TINYINT UNSIGNED NOT NULL,
    KEY subscription_lines_subscription (subscription_id, position),
    CONSTRAINT subscription_lines_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
