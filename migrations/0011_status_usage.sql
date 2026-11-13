-- Usage figures of the company apps (project-cockpit#20, Kompanie-App-Template#175, format 3 field "usage" in a
-- heartbeat): sums only, no user ids or names. The current figures per installation, NULL = none reported (older app
-- version), and one row per installation and UTC day, the day's last heartbeat wins.
-- IF NOT EXISTS (MariaDB): DDL is not transactional, so a migration stopped halfway can simply run again.
ALTER TABLE installations
    ADD COLUMN IF NOT EXISTS usage_counts TEXT NULL;

CREATE TABLE IF NOT EXISTS status_usage (
    installation_id CHAR(32) NOT NULL,
    day DATE NOT NULL,
    users INT UNSIGNED NOT NULL,
    d1 INT UNSIGNED NOT NULL,
    d7 INT UNSIGNED NOT NULL,
    d30 INT UNSIGNED NOT NULL,
    areas TEXT NOT NULL,
    PRIMARY KEY (installation_id, day),
    KEY status_usage_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;
