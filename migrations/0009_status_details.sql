-- Causes of error codes (Kompanie-App-Template#82, format 2 fields "details" and "detail"): per code the
-- causes of the last 24 hours with their counts, e.g. {"CALENDAR_FETCH": {"ics_http_404": 2}}, and the
-- cause of an event. Never error texts. NULL (rows from before this migration) means no causes.
-- IF NOT EXISTS (MariaDB): DDL is not transactional, so a migration stopped halfway can simply run again.
ALTER TABLE installations
    ADD COLUMN IF NOT EXISTS details TEXT NULL;

ALTER TABLE status_heartbeats
    ADD COLUMN IF NOT EXISTS details TEXT NULL;

ALTER TABLE status_events
    ADD COLUMN IF NOT EXISTS detail VARCHAR(64) NULL;
