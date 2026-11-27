-- Own sender address per kind of document (e.g. Angebote from info@, Rechnungen from
-- rechnung@). NULL means the general sender in mail_from.
ALTER TABLE company_settings
    ADD COLUMN mail_from_invoice VARCHAR(190) NULL AFTER mail_from,
    ADD COLUMN mail_from_cancellation VARCHAR(190) NULL AFTER mail_from_invoice,
    ADD COLUMN mail_from_reminder VARCHAR(190) NULL AFTER mail_from_cancellation,
    ADD COLUMN mail_from_quote VARCHAR(190) NULL AFTER mail_from_reminder,
    ADD COLUMN mail_from_order VARCHAR(190) NULL AFTER mail_from_quote;
