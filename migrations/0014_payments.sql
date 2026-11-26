-- ERP module 2: payments received and reminders (see app/README.md, "ERP").
-- A finalized invoice never changes, so whether it is paid or reminded lives here.

CREATE TABLE invoice_payments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT UNSIGNED NOT NULL,
    paid_on DATE NOT NULL,
    amount_cents BIGINT NOT NULL,
    note VARCHAR(255) NULL,
    created_at DATETIME NOT NULL,
    KEY invoice_payments_invoice (invoice_id),
    KEY invoice_payments_paid (paid_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- level 1 Zahlungserinnerung, 2 erste Mahnung, 3 zweite Mahnung. The text is what was sent.
CREATE TABLE invoice_reminders (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT UNSIGNED NOT NULL,
    level TINYINT UNSIGNED NOT NULL,
    sent_on DATE NOT NULL,
    new_due_date DATE NOT NULL,
    recipient VARCHAR(190) NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    KEY invoice_reminders_invoice (invoice_id, level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
