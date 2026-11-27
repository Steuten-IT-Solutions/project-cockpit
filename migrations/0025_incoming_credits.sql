-- Credit notes and refunds from suppliers (Gutschrift, Erstattung). They are stored like
-- incoming invoices with positive amounts and kind = 'credit'; evaluations subtract them.
-- "paid_on" of a credit is the day the money came back. related_incoming_id optionally
-- names the incoming invoice the credit refers to.
ALTER TABLE incoming_invoices
    ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'invoice' AFTER status,
    ADD COLUMN related_incoming_id INT UNSIGNED NULL AFTER kind;
