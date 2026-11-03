CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT,
  source_platform TEXT CHECK (source_platform IN ('instagram', 'youtube', 'web')),
  image_url TEXT,
  servings INTEGER NOT NULL,
  total_minutes INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ingredients (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount REAL,
  unit TEXT NOT NULL DEFAULT ''
);

CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  duration_minutes INTEGER
);

CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('ingredient', 'step')),
  target_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('modify', 'add', 'remove')),
  new_values TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notes (
  recipe_id TEXT PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_recipes_user ON recipes(user_id);
CREATE INDEX idx_ingredients_recipe ON ingredients(recipe_id);
CREATE INDEX idx_steps_recipe ON steps(recipe_id);
CREATE INDEX idx_adjustments_recipe ON adjustments(recipe_id);
