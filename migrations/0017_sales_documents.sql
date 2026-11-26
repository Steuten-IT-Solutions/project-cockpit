-- ERP module 5: quotes (A-2026-0001) and order confirmations (AB-2026-0001), see
-- app/README.md, "ERP". kind quote or order. A draft has no number; issuing it assigns
-- the number and stores the PDF as sent (a sent quote is a business letter, § 257 HGB).
-- Quote status: draft, sent, accepted, rejected. Order status: draft, sent, invoiced.

CREATE TABLE sales_documents (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    kind VARCHAR(5) NOT NULL,
    status VARCHAR(10) NOT NULL,
    number VARCHAR(30) NULL,
    customer_id INT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    issue_date DATE NULL,
    valid_until DATE NULL,
    delivery_date DATE NULL,
    note TEXT NULL,
    quote_id INT UNSIGNED NULL,
    invoice_id INT UNSIGNED NULL,
    net_cents BIGINT NOT NULL,
    tax_cents BIGINT NOT NULL,
    gross_cents BIGINT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    issued_at DATETIME NULL,
    UNIQUE KEY sales_documents_number (number),
    KEY sales_documents_kind (kind, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_lines (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    document_id INT UNSIGNED NOT NULL,
    position SMALLINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    quantity_milli INT UNSIGNED NOT NULL,
    unit VARCHAR(3) NOT NULL,
    unit_price_cents INT UNSIGNED NOT NULL,
    vat_rate TINYINT UNSIGNED NOT NULL,
    KEY sales_lines_document (document_id, position),
    CONSTRAINT sales_lines_document FOREIGN KEY (document_id) REFERENCES sales_documents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_files (
    document_id INT UNSIGNED NOT NULL PRIMARY KEY,
    content LONGBLOB NOT NULL,
    sha256 CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER sales_lines_keep_insert BEFORE INSERT ON sales_lines FOR EACH ROW BEGIN IF (SELECT status FROM sales_documents WHERE id = NEW.document_id) <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An issued document cannot be changed.'; END IF; END;
CREATE TRIGGER sales_lines_keep_update BEFORE UPDATE ON sales_lines FOR EACH ROW BEGIN IF (SELECT status FROM sales_documents WHERE id = OLD.document_id) <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An issued document cannot be changed.'; END IF; END;
CREATE TRIGGER sales_lines_keep_delete BEFORE DELETE ON sales_lines FOR EACH ROW BEGIN IF (SELECT status FROM sales_documents WHERE id = OLD.document_id) <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An issued document cannot be changed.'; END IF; END;
CREATE TRIGGER sales_documents_keep_delete BEFORE DELETE ON sales_documents FOR EACH ROW BEGIN IF OLD.status <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An issued document cannot be deleted.'; END IF; END;
CREATE TRIGGER sales_files_keep_update BEFORE UPDATE ON sales_files FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Issued documents cannot be changed.'; END;
CREATE TRIGGER sales_files_keep_delete BEFORE DELETE ON sales_files FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Issued documents cannot be deleted.'; END;
