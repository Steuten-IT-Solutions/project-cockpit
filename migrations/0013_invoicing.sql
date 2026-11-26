-- ERP module 1: outgoing invoices with ZUGFeRD (see app/README.md, "ERP").
-- Amounts are whole cents (EUR), quantities thousandths (1,5 Std. = 1500), dates DATE,
-- timestamps UTC. A finalized invoice is a frozen copy of everything printed on it.

-- Own company data, one row (id = 1). Copied into every invoice when it is finalized.
CREATE TABLE company_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    contact_name VARCHAR(100) NULL,
    street VARCHAR(100) NOT NULL,
    postcode VARCHAR(10) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country CHAR(2) NOT NULL,
    email VARCHAR(190) NULL,
    phone VARCHAR(50) NULL,
    website VARCHAR(190) NULL,
    tax_number VARCHAR(30) NULL,
    vat_id VARCHAR(20) NULL,
    iban VARCHAR(34) NOT NULL,
    bic VARCHAR(11) NULL,
    bank_name VARCHAR(100) NULL,
    small_business TINYINT(1) NOT NULL,
    payment_days SMALLINT UNSIGNED NOT NULL,
    exemption_reason VARCHAR(255) NULL,
    logo MEDIUMBLOB NULL,
    logo_type VARCHAR(20) NULL,
    mail_from VARCHAR(190) NULL,
    mail_text TEXT NULL,
    updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kind VARCHAR(10) NOT NULL,
    name VARCHAR(100) NOT NULL,
    contact_name VARCHAR(100) NULL,
    street VARCHAR(100) NOT NULL,
    postcode VARCHAR(10) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country CHAR(2) NOT NULL,
    email VARCHAR(190) NULL,
    vat_id VARCHAR(20) NULL,
    project_id BIGINT UNSIGNED NULL,
    note VARCHAR(255) NULL,
    created_at DATETIME NOT NULL,
    archived_at DATETIME NULL,
    KEY customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Products and services offered again and again, copied into lines (never referenced by price).
CREATE TABLE catalog_items (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    unit VARCHAR(3) NOT NULL,
    unit_price_cents INT UNSIGNED NOT NULL,
    vat_rate TINYINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    archived_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Number ranges per kind and year: R-2026-0001 (invoices and cancellations), A- (quotes), AB- (orders).
CREATE TABLE number_sequences (
    kind VARCHAR(10) NOT NULL,
    year SMALLINT UNSIGNED NOT NULL,
    next_value INT UNSIGNED NOT NULL,
    PRIMARY KEY (kind, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- type 380 invoice, 381 cancellation (Stornorechnung). status draft or final. A draft has
-- no number, no frozen parties and no documents; finalizing sets them in one transaction.
-- hash = SHA-256 over prev_hash, number and the hashes of XML and PDF: a chain over all
-- finalized invoices in the order of chain_no (1, 2, 3, ...), so a later change of any
-- of them is detectable.
CREATE TABLE invoices (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    type CHAR(3) NOT NULL,
    status VARCHAR(10) NOT NULL,
    number VARCHAR(30) NULL,
    customer_id INT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    issue_date DATE NULL,
    delivery_date DATE NOT NULL,
    due_date DATE NULL,
    payment_days SMALLINT UNSIGNED NOT NULL,
    note TEXT NULL,
    preceding_invoice_id INT UNSIGNED NULL,
    source_type VARCHAR(20) NULL,
    source_id INT UNSIGNED NULL,
    seller TEXT NULL,
    buyer TEXT NULL,
    small_business TINYINT(1) NULL,
    exemption_reason VARCHAR(255) NULL,
    net_cents BIGINT NOT NULL,
    tax_cents BIGINT NOT NULL,
    gross_cents BIGINT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    finalized_at DATETIME NULL,
    chain_no INT UNSIGNED NULL,
    prev_hash CHAR(64) NULL,
    hash CHAR(64) NULL,
    UNIQUE KEY invoices_number (number),
    UNIQUE KEY invoices_chain (chain_no),
    KEY invoices_customer (customer_id),
    KEY invoices_status (status, issue_date),
    KEY invoices_preceding (preceding_invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invoice_lines (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT UNSIGNED NOT NULL,
    position SMALLINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    quantity_milli INT UNSIGNED NOT NULL,
    unit VARCHAR(3) NOT NULL,
    unit_price_cents INT UNSIGNED NOT NULL,
    vat_rate TINYINT UNSIGNED NOT NULL,
    source_type VARCHAR(20) NULL,
    source_id INT UNSIGNED NULL,
    KEY invoice_lines_invoice (invoice_id, position),
    CONSTRAINT invoice_lines_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The finalized e-invoice as issued: ZUGFeRD PDF (with the XML inside) and the XML alone.
CREATE TABLE invoice_documents (
    invoice_id INT UNSIGNED NOT NULL,
    kind VARCHAR(5) NOT NULL,
    content LONGBLOB NOT NULL,
    sha256 CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (invoice_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What happened to an invoice: created, finalized, sent, paid, reminded, cancelled.
CREATE TABLE invoice_events (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT UNSIGNED NOT NULL,
    event VARCHAR(20) NOT NULL,
    detail VARCHAR(500) NULL,
    created_at DATETIME NOT NULL,
    KEY invoice_events_invoice (invoice_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The database itself refuses to change what was issued (§ 146 Abs. 4 AO), whatever the code does.
CREATE TRIGGER invoices_keep_final BEFORE UPDATE ON invoices FOR EACH ROW BEGIN IF OLD.status = 'final' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A finalized invoice cannot be changed.'; END IF; END;
CREATE TRIGGER invoices_keep_final_rows BEFORE DELETE ON invoices FOR EACH ROW BEGIN IF OLD.status = 'final' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A finalized invoice cannot be deleted.'; END IF; END;
CREATE TRIGGER invoice_lines_keep_final_insert BEFORE INSERT ON invoice_lines FOR EACH ROW BEGIN IF (SELECT status FROM invoices WHERE id = NEW.invoice_id) = 'final' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A finalized invoice cannot be changed.'; END IF; END;
CREATE TRIGGER invoice_lines_keep_final_update BEFORE UPDATE ON invoice_lines FOR EACH ROW BEGIN IF (SELECT status FROM invoices WHERE id = OLD.invoice_id) = 'final' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A finalized invoice cannot be changed.'; END IF; END;
CREATE TRIGGER invoice_lines_keep_final_delete BEFORE DELETE ON invoice_lines FOR EACH ROW BEGIN IF (SELECT status FROM invoices WHERE id = OLD.invoice_id) = 'final' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A finalized invoice cannot be changed.'; END IF; END;
CREATE TRIGGER invoice_documents_keep_update BEFORE UPDATE ON invoice_documents FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Issued documents cannot be changed.'; END;
CREATE TRIGGER invoice_documents_keep_delete BEFORE DELETE ON invoice_documents FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Issued documents cannot be deleted.'; END;
