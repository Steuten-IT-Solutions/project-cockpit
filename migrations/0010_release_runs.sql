-- Workflow runs of the company app template that publish releases (releases section of config.php):
-- "Kernversion freigeben" (stable) and "Kompanien abgleichen" (develop = early, main = stable).
-- Filled by the GitHub App webhook (status subdomain, POST /github) and corrected by the cron job.
-- id is GitHub's workflow run id.
CREATE TABLE release_runs (
    id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    -- promote = kern-freigeben.yml, sync = kompanien-abgleichen.yml
    workflow VARCHAR(10) NOT NULL,
    channel VARCHAR(10) NOT NULL,
    branch VARCHAR(100) NOT NULL,
    event VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL,
    conclusion VARCHAR(20) NULL,
    -- sync runs publish only when they find companies with a new state: NULL = not known yet,
    -- 1 = a publishing job exists, 0 = completed without one. Always 1 for promote runs.
    publishing TINYINT(1) NULL,
    title VARCHAR(200) NULL,
    head_sha CHAR(40) NOT NULL,
    -- Content of the file VERSION at head_sha, e.g. 0.1.1.
    core_version VARCHAR(20) NULL,
    html_url VARCHAR(300) NOT NULL,
    started_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY release_runs_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
