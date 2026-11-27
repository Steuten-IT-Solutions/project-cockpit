-- Discount per position in hundredths of a percent (1000 = 10 %), printed and written
-- into the e-invoice as a line allowance (EN 16931 BG-27). 0 means no discount, so
-- existing documents stay exactly as they were.
ALTER TABLE invoice_lines ADD COLUMN discount_bp SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER vat_rate;
ALTER TABLE sales_lines ADD COLUMN discount_bp SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER vat_rate;
ALTER TABLE subscription_lines ADD COLUMN discount_bp SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER vat_rate;
