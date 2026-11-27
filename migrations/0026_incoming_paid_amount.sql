-- The amount actually debited for an incoming invoice, when it differs from the invoice
-- (bank fees for card payments abroad, exchange differences). NULL: as on the invoice.
-- The invoice amounts stay untouched; the difference is shown separately.
ALTER TABLE incoming_invoices
    ADD COLUMN paid_cents INT NULL AFTER paid_on;
