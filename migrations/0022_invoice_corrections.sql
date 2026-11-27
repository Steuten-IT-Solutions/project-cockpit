-- Partial corrections of an issued invoice (Rechnungskorrektur, type 381 like a
-- cancellation). partial = 1: it credits only some positions or amounts, so the invoice
-- stays valid and its open amount shrinks. partial = 0: a cancellation of the whole
-- invoice, as before (existing cancellations keep the default 0).
ALTER TABLE invoices ADD COLUMN partial TINYINT(1) NOT NULL DEFAULT 0 AFTER preceding_invoice_id;
