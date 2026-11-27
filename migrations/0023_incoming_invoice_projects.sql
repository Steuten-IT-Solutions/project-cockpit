-- An incoming invoice can be split across several projects, each with a share of its net
-- amount in basis points (10000 = 100 %); the shares of one invoice add up to 10000.
-- incoming_invoices.project_id stays and holds the project with the largest share, so
-- that anything reading the single project keeps working.
CREATE TABLE incoming_invoice_projects (
    incoming_invoice_id INT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NOT NULL,
    share_bp SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (incoming_invoice_id, project_id),
    KEY incoming_invoice_projects_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO incoming_invoice_projects (incoming_invoice_id, project_id, share_bp)
    SELECT id, project_id, 10000 FROM incoming_invoices WHERE project_id IS NOT NULL;
