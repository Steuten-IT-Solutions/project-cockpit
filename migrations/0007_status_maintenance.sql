-- Maintenance mode of a company app (Kompanie-App-Template#42): shown as "in Wartung", not as an error.
-- Room for more areas than the ten of format 2 so far (the app keeps adding areas).
ALTER TABLE installations
    ADD COLUMN maintenance TINYINT(1) NOT NULL DEFAULT 0,
    MODIFY features VARCHAR(600) NOT NULL;
