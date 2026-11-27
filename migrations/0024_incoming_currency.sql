-- Incoming invoices in another currency (e.g. US dollars). net/tax/gross_cents stay the
-- amounts in euros, which the books and evaluations use; the invoice's own amounts and
-- the exchange rate used (units of the currency per 1 euro, as the ECB quotes it) are
-- kept beside them. For euro invoices the extra columns stay NULL.
ALTER TABLE incoming_invoices
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'EUR' AFTER gross_cents,
    ADD COLUMN original_net_cents BIGINT NULL AFTER currency,
    ADD COLUMN original_tax_cents BIGINT NULL AFTER original_net_cents,
    ADD COLUMN exchange_rate DECIMAL(12, 6) NULL AFTER original_tax_cents;
