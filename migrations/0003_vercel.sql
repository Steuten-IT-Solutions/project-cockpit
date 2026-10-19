-- Vercel projects of the team with their latest production deployment, refreshed by the cron job.
-- repo_id is the GitHub repository id from the project's Git link and matches projects.id.
CREATE TABLE vercel_projects (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    repo_id BIGINT UNSIGNED NULL,
    repo_full_name VARCHAR(200) NULL,
    production_domain VARCHAR(255) NULL,
    deploy_state VARCHAR(20) NULL,
    deploy_created_at DATETIME NULL,
    deploy_inspector_url VARCHAR(300) NULL,
    deploy_commit VARCHAR(255) NULL,
    deploy_error VARCHAR(255) NULL,
    synced_at DATETIME NOT NULL,
    available TINYINT(1) NOT NULL DEFAULT 1,
    KEY vercel_projects_repo (repo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
