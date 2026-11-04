-- servings is what the user planned to cook, summed over repeated adds.
CREATE TABLE planned_recipes (
  user_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  servings INTEGER NOT NULL,
  PRIMARY KEY (user_id, recipe_id)
);

-- Typed items: name as typed, canonical_name/unit/amount matched and in base units.
CREATE TABLE list_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  amount REAL
);
CREATE INDEX idx_list_items_user ON list_items(user_id);

-- line_key is a ShoppingLine key: "<nameKey>|<unit>" or "item:<id>".
CREATE TABLE list_ticks (
  user_id TEXT NOT NULL,
  line_key TEXT NOT NULL,
  PRIMARY KEY (user_id, line_key)
);
