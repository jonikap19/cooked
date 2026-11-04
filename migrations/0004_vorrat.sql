-- target_id is an original ingredients.id or the id of an ingredient 'add' adjustment.
CREATE TABLE ingredient_matches (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  fallback INTEGER NOT NULL DEFAULT 0,
  matched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (recipe_id, target_id, user_id)
);
CREATE INDEX idx_ingredient_matches_user ON ingredient_matches(user_id);

-- source_key is nameKey(source name as written).
CREATE TABLE name_aliases (
  user_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  PRIMARY KEY (user_id, source_key)
);

CREATE TABLE pantry_items (
  user_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  amount REAL,
  always_at_home INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, canonical_name, unit)
);
