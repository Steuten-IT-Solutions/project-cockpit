-- Repositories the GitHub App can see, refreshed by the cron job.
-- id is GitHub's repository id, so a renamed repository keeps its row and notes.
CREATE TABLE projects (
    id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    full_name VARCHAR(200) NOT NULL,
    owner VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NULL,
    html_url VARCHAR(300) NOT NULL,
    is_private TINYINT(1) NOT NULL,
    is_archived TINYINT(1) NOT NULL,
    is_fork TINYINT(1) NOT NULL,
    default_branch VARCHAR(100) NOT NULL,
    pushed_at DATETIME NULL,
    open_issues INT UNSIGNED NOT NULL DEFAULT 0,
    open_prs INT UNSIGNED NOT NULL DEFAULT 0,
    release_tag VARCHAR(100) NULL,
    release_url VARCHAR(300) NULL,
    release_at DATETIME NULL,
    ci_status VARCHAR(20) NULL,
    ci_conclusion VARCHAR(20) NULL,
    ci_url VARCHAR(300) NULL,
    ci_at DATETIME NULL,
    ci_workflow VARCHAR(200) NULL,
    sync_error VARCHAR(255) NULL,
    synced_at DATETIME NOT NULL,
    -- 0 once the repository is no longer granted to the app; the row and its notes stay.
    available TINYINT(1) NOT NULL DEFAULT 1,
    -- Set by the user on the dashboard; never changed by the sync.
    hidden TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY projects_full_name (full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every save of a note is a new row; the newest row is the current note.
CREATE TABLE project_notes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT UNSIGNED NOT NULL,
    body MEDIUMTEXT NOT NULL,
    user_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL,
    KEY project_notes_project (project_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
