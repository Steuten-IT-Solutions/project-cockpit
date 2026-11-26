-- ERP module 6: time and services to bill later (see app/README.md, "ERP"). Billing
-- turns selected entries into lines of a draft invoice and sets invoice_id; deleting
-- that draft frees them again.

CREATE TABLE time_entries (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    work_date DATE NOT NULL,
    customer_id INT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    order_id INT UNSIGNED NULL,
    description VARCHAR(500) NOT NULL,
    quantity_milli INT UNSIGNED NOT NULL,
    unit VARCHAR(3) NOT NULL,
    unit_price_cents INT UNSIGNED NOT NULL,
    vat_rate TINYINT UNSIGNED NOT NULL,
    invoice_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY time_entries_open (customer_id, invoice_id, work_date),
    KEY time_entries_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
