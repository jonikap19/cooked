-- A frozen recipe snapshot behind a random token; expires_at is an ISO UTC string.
CREATE TABLE share_links (
  token TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_share_links_expires ON share_links(expires_at);
