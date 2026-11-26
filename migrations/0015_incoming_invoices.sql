-- ERP module 3: incoming invoices (see app/README.md, "ERP"). The received file is kept
-- unchanged (GoBD: received invoices are kept as they arrived); a wrong entry is
-- discarded with a reason, never deleted.

CREATE TABLE suppliers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    vat_id VARCHAR(20) NULL,
    tax_number VARCHAR(30) NULL,
    iban VARCHAR(34) NULL,
    email VARCHAR(190) NULL,
    street VARCHAR(100) NULL,
    postcode VARCHAR(10) NULL,
    city VARCHAR(100) NULL,
    country CHAR(2) NULL,
    note VARCHAR(255) NULL,
    created_at DATETIME NOT NULL,
    archived_at DATETIME NULL,
    KEY suppliers_name (name),
    KEY suppliers_vat (vat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status open, paid or discarded. format: zugferd-pdf, cii-xml or other (PDF or image,
-- entered by hand). iban is the account the invoice asks to pay to.
CREATE TABLE incoming_invoices (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT UNSIGNED NOT NULL,
    status VARCHAR(10) NOT NULL,
    number VARCHAR(60) NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NULL,
    net_cents BIGINT NOT NULL,
    tax_cents BIGINT NOT NULL,
    gross_cents BIGINT NOT NULL,
    category VARCHAR(20) NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    iban VARCHAR(34) NULL,
    note VARCHAR(500) NULL,
    format VARCHAR(12) NOT NULL,
    file_name VARCHAR(190) NOT NULL,
    file_type VARCHAR(60) NOT NULL,
    file_sha256 CHAR(64) NOT NULL,
    paid_on DATE NULL,
    discarded_reason VARCHAR(255) NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY incoming_invoices_file (file_sha256),
    KEY incoming_invoices_supplier (supplier_id, number),
    KEY incoming_invoices_date (issue_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE incoming_invoice_files (
    incoming_invoice_id INT UNSIGNED NOT NULL PRIMARY KEY,
    content LONGBLOB NOT NULL,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER incoming_files_keep_update BEFORE UPDATE ON incoming_invoice_files FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Received files cannot be changed.'; END;
CREATE TRIGGER incoming_files_keep_delete BEFORE DELETE ON incoming_invoice_files FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Received files cannot be deleted.'; END;
CREATE TRIGGER incoming_invoices_keep_delete BEFORE DELETE ON incoming_invoices FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incoming invoices are discarded, not deleted.'; END;
