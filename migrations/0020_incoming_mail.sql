-- Incoming invoices by e-mail: the cockpit fetches the mailbox for incoming invoices
-- (e.g. eingangsrechnung@) and keeps each attachment here. E-invoices are entered at once;
-- other files wait here until they are entered by hand or ignored. The original message
-- stays in the mailbox (moved to the folder "Verarbeitet") and in the mail archive.

-- The mailbox; the password is encrypted with the app key (like the TOTP secrets).
ALTER TABLE company_settings
    ADD COLUMN imap_host VARCHAR(190) NULL AFTER mail_text,
    ADD COLUMN imap_user VARCHAR(190) NULL AFTER imap_host,
    ADD COLUMN imap_secret TEXT NULL AFTER imap_user;

-- status: new (waits), booked (incoming invoice entered), ignored (not an invoice or a
-- duplicate; problem says why).
CREATE TABLE incoming_mail_files (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(255) NULL,
    sender VARCHAR(255) NULL,
    subject VARCHAR(255) NULL,
    received_at DATETIME NULL,
    file_name VARCHAR(190) NOT NULL,
    file_type VARCHAR(60) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    content LONGBLOB NOT NULL,
    status VARCHAR(10) NOT NULL,
    incoming_invoice_id INT UNSIGNED NULL,
    problem VARCHAR(500) NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY incoming_mail_files_sha (sha256),
    KEY incoming_mail_files_status (status, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
