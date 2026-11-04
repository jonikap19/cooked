-- Groups share recipes: a recipe with a group_id belongs to the group, user_id stays its creator.
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE group_invites (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (group_id, email)
);

ALTER TABLE recipes ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE CASCADE;
-- Who last wrote the adjustment; null for rows from before this migration.
ALTER TABLE adjustments ADD COLUMN author TEXT;

CREATE INDEX idx_recipes_group ON recipes(group_id);
