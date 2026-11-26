-- Sessions of the new Nuxt cockpit (app/). The cookie carries a random token; only
-- its SHA-256 is stored, so a copy of this table cannot be used to log in.
-- The PHP cockpit does not use this table.
CREATE TABLE web_sessions (
    id CHAR(64) NOT NULL PRIMARY KEY,
    user_id INT UNSIGNED NULL,
    data TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    seen_at DATETIME NOT NULL,
    KEY web_sessions_seen (seen_at),
    CONSTRAINT web_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
