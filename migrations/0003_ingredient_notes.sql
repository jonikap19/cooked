CREATE TABLE ingredient_notes (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (recipe_id, target_id)
);
