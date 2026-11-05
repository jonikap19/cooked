-- Each user's allergies and no-gos: preset names ("Nüsse") or their own words ("Koriander").
CREATE TABLE user_allergies (user_id TEXT NOT NULL, allergen TEXT NOT NULL, PRIMARY KEY (user_id, allergen));
