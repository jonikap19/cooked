# Pantry, Shopping, Sharing and Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Own recipes, ingredient notes, a Vorrat with AI-matched ingredient names, a combined shopping list with "bought" and "cooked" flows, 24 h share links, and groups with independent recipe copies.

**Architecture:** Same single Worker (Hono API + Static Assets SPA, D1, Workers AI, R2, Access). Pure logic lives in `shared/` (units, pantry arithmetic, shopping-list maths) and is unit-tested. The Worker owns persistence, matching and access. Copies (share links, groups) go through one snapshot/insert pair. Recipe access goes through one check that also understands group membership.

**Tech Stack:** as in the MVP and next-features plans. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-03-pantry-shopping-design.md` and `docs/superpowers/specs/2026-11-03-groups-sharing-design.md`. Both are binding; read the section a task names. Repo rules: `rules.md`, `CLAUDE.md`.

## Global Constraints

- Everything in the MVP plan's and the next-features plan's Global Constraints still applies:
  - German UI
  - design tokens, and orange only for adjustments
  - touch targets ≥ 44 px, no emojis
  - user scoping → 404
  - originals insert-only
  - https-only URLs and input limits
  - Workers AI calls always pass `max_tokens` and validate with zod
  - never log pasted text, ingredient text, page content, or URLs with query strings
- **Phases and branches.** Each phase is one branch and one PR **against `main`**, opened only after the previous phase's PR is merged. Phases ship in this order, with these branch names: `feat/own-recipe`, `feat/ingredient-notes`, `feat/vorrat`, `feat/shopping-list`, `feat/share-links`, `feat/groups`. Do not stack PRs (memory: stacked PRs merged into their bases).
- **Migrations.** Additive only. Never edit an applied migration. Numbers in phase order: `0003_ingredient_notes`, `0004_vorrat`, `0005_shopping_list`, `0006_share_links`, `0007_groups`. Each PR description says whether it has a migration, and the owner runs `npm run db:migrate:remote` before `npm run deploy`.
- **Ingredient keys.** An "ingredient in a recipe" is identified by `(recipe_id, target_id)`. `target_id` is either an original `ingredients.id` of that recipe or the id of an `add` adjustment with `target_type = 'ingredient'` of that recipe. Anything else → 404.
- **Shopping and cooked amounts** use `mergeRecipe(full).ingredients` (removed items skipped), scaled with `scaleAmount(amount, recipe.servings, servings)` from `shared/format.ts`.
- **Units.** `kg → g ×1000`, `mg → g ×0.001`, `l → ml ×1000`, `cl → ml ×10`, `dl → ml ×100`. An empty unit is `Stück`. Every other unit is kept as written, trimmed. Amounts never cross units.
- **Rate limits.**
  - The AI matching calls reuse `PARSE_LIMIT`.
  - A new rate-limit binding `SOCIAL_LIMIT` allows 20 requests per 60 s. It is keyed `share:<userId>` for share-link creation and `invite:<userId>` for invites.
- **Limits.** 20 groups per user, 20 members per group, 20 pending invites per group. Ingredient note ≤ 500 chars. Group name 1–60 chars.
- **New German strings, verbatim:** "Eigenes Rezept", "Rezept speichern", "Notiz", "Kochbuch", "Einkaufsliste", "Vorrat", "Immer da", "Artikel hinzufügen", "Auf die Einkaufsliste", "Auf der Einkaufsliste", "Für: {Rezepte}", "im Vorrat: {Menge}", "Einkauf abschließen", "In den Vorrat übernehmen", "Fertig gekocht", "Vom Vorrat abziehen", "Teilen", "ohne Kommentare", "mit Kommentaren", "Link kopieren", "Gültig für 24 Stunden", "Ins Kochbuch übernehmen", "Link abgelaufen", "Gruppen", "Gruppe erstellen", "Einladen", "Einladung annehmen", "Ablehnen", "Gruppe verlassen", "In Gruppe teilen", "Geteilt von {Initialen}".
- **Security review.** Run `/security-review` before merging the `feat/share-links` and `feat/groups` PRs (rules.md §2).

## Review Focus

1. **Guessing ids across the group boundary.** A non-member, or a member who just left, gets 404 from every recipe-scoped route for a group recipe. The routes are: detail, patch, delete, adjustments, note, ingredient notes, image, split, list add, cooked, share and share-to-group. A member gets the same answers as an owner. → table-driven test in Task 15.
2. **The Vorrat drifts silently.** Checkout and cooked apply exactly the amounts the user confirmed in the sheet, never the computed ones. Unknown amounts follow the null rules, and nothing goes below zero. → tests in Tasks 6, 9 and 11.
3. **One ingredient, two lines.** After the user corrects "Zwiebeln, rot" to "Rote Zwiebel" once, a second recipe spelling it "Zwiebeln, rot" lands on the same shopping-list line without calling the AI. → test in Task 5 (alias wins) and Task 9 (one line).
4. **An expired share link still works.** Preview and import after `expires_at` return 410 "Link abgelaufen". Import before expiry works any number of times, each time as an independent recipe with its own image. → tests in Task 13.
5. **A copy behaves differently from its source.**
   - In a "mit Kommentaren" copy, "Original zeigen", the reset of a modified ingredient, and split pieces (`insert_after`) behave exactly as in the source.
   - A "ohne Kommentare" copy equals the source's merged view and has 0 adjustments.
   → tests in Task 12.

## File Structure (new or changed)

```
src/pages/OwnRecipe.tsx              blank recipe form (Task 1)
src/lib/ownRecipe.ts                 formToRecipe(form) (Task 1)
migrations/0003_ingredient_notes.sql (Task 2)
worker/notes.ts                      ingredient-note routes (Task 2)
shared/units.ts                      normalizeUnit, nameKey (Task 4)
worker/match.ts                      matching: aliases, AI, fallback (Task 5)
migrations/0004_vorrat.sql           ingredient_matches, name_aliases, pantry_items (Task 5)
shared/pantry.ts                     addAmount, subtractAmount (Task 6)
worker/pantry.ts                     /api/pantry routes (Task 6)
src/components/TabBar.tsx            bottom bar (Task 7)
src/pages/Pantry.tsx                 Vorrat tab (Task 7)
shared/shopping.ts                   scaledNeeds, computeShoppingList (Task 8)
migrations/0005_shopping_list.sql    planned_recipes, list_items, list_ticks (Task 9)
worker/list.ts                       /api/list routes, /api/recipes/:id/cooked (Tasks 9, 11)
src/pages/ShoppingList.tsx, src/components/CheckoutSheet.tsx, src/components/CookedSheet.tsx (Tasks 10, 11)
worker/copy.ts                       snapshotRecipe, insertSnapshot (Task 12)
migrations/0006_share_links.sql, worker/share.ts, src/pages/SharedRecipe.tsx, src/components/ShareSheet.tsx (Tasks 13, 14)
worker/access.ts                     recipeAccess (Task 15)
migrations/0007_groups.sql, worker/groups.ts, src/pages/Groups.tsx, src/pages/Group.tsx (Tasks 15–17)
test/*.test.ts
```

---

## Phase E — Eigenes Rezept (`feat/own-recipe`)

### Task 1: Blank recipe form

**Files:**
- Create: `src/pages/OwnRecipe.tsx`, `src/lib/ownRecipe.ts`, `test/own-recipe.test.ts`
- Modify: `src/App.tsx` (route `/neu/eigenes`), `src/pages/AddRecipe.tsx` (third tab), `src/styles.css`

**Interfaces:**
- Consumes: `api.createRecipe(recipe: NewRecipe)`, `NewRecipe` from `shared/schema.ts`, and `parseNumber` from `src/lib/edit.ts`.
- Produces:
  - `type OwnRecipeForm = { title: string; servings: string; totalMinutes: string; ingredients: { amount: string; unit: string; name: string }[]; steps: { text: string; minutes: string }[] }`
  - `blankForm(): OwnRecipeForm`, which returns one empty ingredient row, one empty step row and servings `"2"`
  - `formToRecipe(form: OwnRecipeForm): { recipe: NewRecipe } | { error: string }`

- [ ] **Step 1: Failing tests** (`test/own-recipe.test.ts`)
  - A full form → `NewRecipe` with:
    - `source_url: null`, `source_platform: null`, `image_url: null`
    - amounts parsed with a decimal comma (`"1,5"` → 1.5)
    - an empty amount → `null`
  - Rows whose name (ingredient) or text (step) is blank are dropped.
  - No title → `{ error: "Bitte gib einen Titel ein." }`.
  - No non-blank step → `{ error: "Mindestens ein Schritt" }`.
  - The output passes `NewRecipe.safeParse`.
- [ ] **Step 2:** Run `npx vitest run test/own-recipe.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `formToRecipe` and `blankForm`.** Then build the page:
  - fields: title, servings (+/−), "Minuten" (optional), ingredient rows (Menge, Einheit, Zutat) with "Zutat hinzufügen", step rows (text + optional minutes) with "Schritt hinzufügen", and a remove button per row
  - a sticky "Rezept speichern" button at the bottom. While saving it is disabled and shows "Wird gespeichert …". On success, navigate to `/rezept/<id>`. Errors show in the existing error style.
  - "Rezept hinzufügen" gets a third tab "Eigenes Rezept" that links to `/neu/eigenes`.
  - no photo field
- [ ] **Step 4:** Run `npm test` and `npm run build`. Both clean.
- [ ] **Step 5: Commit** `feat: create an own recipe from a blank form`.

---

## Phase F1 — Ingredient notes (`feat/ingredient-notes`)

### Task 2: Ingredient notes API

**Files:**
- Create: `migrations/0003_ingredient_notes.sql`, `worker/notes.ts`, `test/ingredient-notes.test.ts`
- Modify: `shared/schema.ts`, `worker/recipes.ts` (GET detail includes notes), `worker/index.ts`

**Interfaces:**
- Migration:
  ```sql
  CREATE TABLE ingredient_notes (
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (recipe_id, target_id)
  );
  ```
- Schema: `IngredientNote = { target_id: string; body: string; author: string; updated_at: string }`, and `RecipeFull` gains `ingredient_notes: IngredientNote[]`.
- Route: `PUT /api/recipes/:id/ingredient-notes/:targetId` with body `{ text: string }` (trimmed, ≤ 500). A non-empty text upserts and sets `author = userId`. An empty text deletes the note. It returns 204.
- Produces: `assertIngredientTarget(db, recipeId, targetId): Promise<boolean>` (exported from `worker/notes.ts`), which implements the Global Constraints "Ingredient keys" rule. Later tasks reuse it.

- [ ] **Step 1: Failing tests:**
  - Put a note on an original ingredient, then GET detail → `ingredient_notes` contains it with `author` equal to the user's email.
  - Put a note on an added-ingredient adjustment id → OK.
  - A step id, or another recipe's ingredient id → 404.
  - Another user's recipe → 404.
  - 501 chars → 400.
  - Empty text removes the note.
  - Deleting the recipe removes its notes (`SELECT COUNT(*)` = 0).
  - Resetting (deleting) an ingredient's adjustments leaves its note in place.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: personal notes on recipe ingredients`.

### Task 3: Notes in the UI

**Files:** Modify `src/api.ts`, `src/components/EditSheet.tsx`, `src/components/ItemRow.tsx`, `src/pages/RecipeDetail.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: Task 2's route.
- Produces: `api.saveIngredientNote(recipeId: string, targetId: string, text: string): Promise<void>`.
- Behaviour:
  - The ingredient EditSheet gets a "Notiz" textarea (≤ 500). It saves together with "Speichern", sending only a changed note.
  - The note shows muted, not orange, under the ingredient row in the detail view. Cooking mode has no ingredient list, so nothing changes there.
  - Notes don't count toward the "X Anpassungen" badge or banner.
- [ ] **Step 1:** Implement. **Step 2:** Run `npm test` and `npm run build`. Both clean.
- [ ] **Step 3: Commit** `feat: show and edit ingredient notes`.

---

## Phase F2 — Matching and Vorrat (`feat/vorrat`)

### Task 4: Units and name keys

**Files:** Create `shared/units.ts`, `test/units.test.ts`

**Interfaces:**
- Produces:
  - `normalizeUnit(unit: string): { unit: string; factor: number }`, per the Global Constraints "Units" rule. Matching is case-insensitive (`"KG"` → `g`, ×1000; `""` → `Stück`, ×1; `" EL "` → `EL`, ×1).
  - `toBase(amount: number | null, unit: string): { amount: number | null; unit: string }`
  - `nameKey(name: string): string`, which trims, lower-cases, collapses whitespace and strips a trailing comma. It is used for alias lookups and comparison only, never for display.
- [ ] **Step 1: Failing tests:**
  - `toBase(1.5, "kg")` → `{ amount: 1500, unit: "g" }`
  - `toBase(2, "dl")` → `{ amount: 200, unit: "ml" }`
  - `toBase(null, "l")` → `{ amount: null, unit: "ml" }`
  - `toBase(1, "")` → `{ amount: 1, unit: "Stück" }`
  - `toBase(2, "Bund")` → `{ amount: 2, unit: "Bund" }`
  - `nameKey("  Zwiebeln,  rot ")` → `"zwiebeln, rot"`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: unit normalisation for ingredients`.

### Task 5: Ingredient matching

**Files:**
- Create: `migrations/0004_vorrat.sql`, `worker/match.ts`, `test/match.test.ts`
- Modify: `worker/recipes.ts` (after a successful `POST /api/recipes`, call `c.executionCtx.waitUntil(matchRecipe(...))`; any error is logged by name only), `worker/index.ts`, `shared/schema.ts`

**Interfaces:**
- Migration tables:
  - `ingredient_matches(recipe_id FK ON DELETE CASCADE, target_id, user_id, source_name, canonical_name, unit, fallback INTEGER NOT NULL DEFAULT 0, matched_at TEXT, PRIMARY KEY (recipe_id, target_id, user_id))`
  - `name_aliases(user_id, source_key, canonical_name, unit, PRIMARY KEY (user_id, source_key))`
  - `pantry_items(user_id, canonical_name, unit, amount REAL, always_at_home INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, canonical_name, unit))`
- Produces:
  - `type Match = { target_id: string; canonical_name: string; unit: string }`, defined in `shared/schema.ts`, because `shared/shopping.ts` uses it too
  - `matchRecipe(env: Env, userId: string, recipeId: string): Promise<Match[]>`. For every merged, non-removed ingredient it returns the stored match, re-matching only where needed:
    1. a match exists and its `source_name` equals the current name → use it, unless it is `fallback` and `matched_at` is older than 24 h
    2. else, an alias for `nameKey(name)` → store it (not fallback) and use it
    3. else, collect the name for **one** AI call per recipe
    4. if the AI fails or is rate-limited → fallback: the name trimmed as written, with `normalizeUnit(unit).unit`, stored with `fallback = 1`
  - `matchName(env: Env, userId: string, name: string, unit: string): Promise<{ canonical_name: string; unit: string }>`, the same order for a single typed name
  - `PUT /api/aliases` with body `{ source_name, canonical_name (1–100), unit (≤ 30) }`. It upserts the alias for `nameKey(source_name)` and rewrites every one of this user's `ingredient_matches` whose `nameKey(source_name)` matches, setting `fallback = 0`. It returns 204.
- AI call:
  - The model is `MODEL` from `worker/parse.ts`, with `max_tokens: 1024`.
  - System prompt (German): map each input name to a short singular standard name, reuse a known name when it means the same food, and pick one unit for each from `g`, `ml`, `Stück` or the given unit.
  - The input lists the names and up to 200 known standard names: the user's `pantry_items` names plus distinct `ingredient_matches.canonical_name`, most recent first.
  - The output is zod `{ items: { name: string; canonical_name: string; unit: string }[] }`. Unknown or extra items are ignored, and a missing item falls back.
  - The call consumes `PARSE_LIMIT` keyed by `userId`.

- [ ] **Step 1: Failing tests** (fake AI and fake rate limit):
  - First call → one AI call; the results are stored.
  - Second call → zero AI calls.
  - After a `modify` that renames an ingredient → re-match for that ingredient only.
  - An alias exists for "Zwiebeln, rot" → zero AI calls, and the alias value is used.
  - The AI throws → fallback stored with `fallback = 1`. An immediate re-call makes no AI call, and a re-call with `matched_at` moved 25 h back retries.
  - The known names sent to the AI include a pantry item's name.
  - `PUT /api/aliases` rewrites the matches of another recipe with the same spelling.
  - Another user's aliases are never used.
  - The prompt contains ingredient names only in the user message.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: match ingredient names to standard names`.

### Task 6: Vorrat API

**Files:** Create `shared/pantry.ts`, `worker/pantry.ts`, `test/pantry.test.ts`, `test/pantry-api.test.ts`. Modify `worker/index.ts`, `shared/schema.ts`.

**Interfaces:**
- Produces (pure):
  - `addAmount(a: number | null, b: number | null): number | null`. Null + n = n, n + null = n, null + null = null.
  - `subtractAmount(a: number | null, b: number | null): number | null`. A null stock stays null, null subtracts nothing, and the result is never below 0.
- `PantryItem = { canonical_name: string; unit: string; amount: number | null; always_at_home: boolean }`.
- Routes:
  - `GET /api/pantry` → `PantryItem[]` sorted by name.
  - `POST /api/pantry {name, amount, unit}`: `matchName`, then `toBase`, then `addAmount` into the existing row or insert one → 200 with the item.
  - `PATCH /api/pantry` with body `{ canonical_name, unit, set: { canonical_name?, unit?, amount?, always_at_home? } }` edits one item. If the new (name, unit) collides with another row, the two merge: amounts go through `addAmount`, and `always_at_home` is the OR of both. An amount of 0 on a non-"Immer da" item deletes it.
  - `DELETE /api/pantry` with body `{ canonical_name, unit }`.
  - All routes are scoped to `userId`.
- Produces (for Tasks 9, 11): `applyToPantry(db, userId, changes: { canonical_name: string; unit: string; delta: number | null; op: "add" | "subtract" }[]): Promise<void>`. It runs as one batch, removes rows that reach 0 unless they are "Immer da", and never creates a row on subtract.

- [ ] **Step 1: Failing tests.**
  - Pure: `addAmount(null, 3)` = 3, `subtractAmount(2, 5)` = 0, `subtractAmount(null, 5)` = null.
  - API:
    - Post "1 kg Mehl" → stored as 1000 g. Post 500 g again → 1500 g.
    - A PATCH rename onto an existing row merges the amounts.
    - Amount set to 0 → row deleted. On an "Immer da" row it is kept.
    - Bob's GET doesn't see Alice's items.
    - `applyToPantry` subtracting more than in stock → row removed. Subtracting an item that isn't in stock → no row is created.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: vorrat api`.

### Task 7: Bottom bar and Vorrat tab

**Files:** Create `src/components/TabBar.tsx`, `src/pages/Pantry.tsx`. Modify `src/App.tsx` (route `/vorrat`), `src/pages/Home.tsx`, `src/api.ts`, `src/styles.css`.

**Interfaces:**
- Consumes: the Task 6 routes and Task 5's `PUT /api/aliases`.
- Behaviour:
  - `TabBar` is a fixed bottom bar with "Kochbuch" (`/`), "Einkaufsliste" (`/einkaufsliste`, which renders a placeholder until Task 10) and "Vorrat" (`/vorrat`), each ≥ 44 px with the active tab marked. It shows on Home, Einkaufsliste, Vorrat and, later, Gruppen. It doesn't show on the detail page, cooking mode or the add screens. Home's sticky "Rezept hinzufügen" sits above the bar.
  - Vorrat lists the items with their amount (or "etwas" when null) and an "Immer da" toggle. "Artikel hinzufügen" opens a small sheet (Menge, Einheit, Name). Tapping an item opens an edit sheet: amount, unit, name, delete. Renaming calls `PATCH`.
- [ ] **Step 1:** Implement. **Step 2:** Run `npm test` and `npm run build`. Both clean.
- [ ] **Step 3: Commit** `feat: vorrat tab and bottom navigation`.

---

## Phase F3 — Shopping list and cooked (`feat/shopping-list`)

### Task 8: Shopping-list maths

**Files:** Create `shared/shopping.ts`, `test/shopping.test.ts`

**Interfaces:**
- Produces:
  - `type Need = { canonical_name: string; unit: string; amount: number | null; recipe_title: string }`
  - `scaledNeeds(merged: Merged<Ingredient>[], matches: Match[], baseServings: number, servings: number, title: string): Need[]`. It skips removed items, converts with `toBase` after `scaleAmount`, and uses the match for each `target_id` (`id` of the merged item).
  - `type ShoppingLine = { key: string; canonical_name: string; unit: string; amount: number | null; recipes: string[]; pantryHint: string | null; typedItemId: string | null }`
  - `computeShoppingList(needs: Need[], pantry: PantryItem[], typed: { id: string; canonical_name: string; unit: string; amount: number | null }[]): ShoppingLine[]`. It groups needs by `canonical_name|unit` and sums them with `addAmount`. A null need inside a group with numbers is ignored for the sum but still marks the line. It drops groups whose name is "Immer da" in any unit, subtracts the pantry row with the same name and unit, and drops lines ≤ 0. A null need is covered by any pantry row with that name and unit. `pantryHint` = "im Vorrat: {amount} {unit}" when only other units of that name are in stock. Typed items are appended as their own lines with key `item:<id>`. Sort by name.
- [ ] **Step 1: Failing tests:**
  - Two recipes each needing Butter 50 g and 30 g, pantry 20 g → one line 60 g with both recipe titles.
  - Pantry 100 g → no line.
  - Salz marked "Immer da" → no line.
  - Zwiebel 300 g needed, pantry 2 Stück → line 300 g with `pantryHint` "im Vorrat: 2 Stück".
  - "etwas Pfeffer" (null) with no stock → a line with a null amount; with a null-amount stock row → no line.
  - A typed "Klopapier" → its own line `item:<id>`.
  - `scaledNeeds` at double servings → doubled amounts, with removed ingredients skipped.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: shopping list maths`.

### Task 9: Shopping-list API and checkout

**Files:** Create `migrations/0005_shopping_list.sql`, `worker/list.ts`, `test/list.test.ts`. Modify `worker/index.ts`, `shared/schema.ts`.

**Interfaces:**
- Migration tables:
  - `planned_recipes(user_id, recipe_id FK ON DELETE CASCADE, servings INTEGER NOT NULL, PRIMARY KEY (user_id, recipe_id))`
  - `list_items(id PK, user_id, name, canonical_name, unit, amount REAL)`
  - `list_ticks(user_id, line_key, PRIMARY KEY (user_id, line_key))`
- Routes, all scoped to `userId`:
  - `GET /api/list` → `{ lines: ShoppingLine[]; ticked: string[]; planned: { recipe_id, title, servings }[] }`. It runs `matchRecipe` for each planned recipe and drops ticks whose key no longer exists.
  - `POST /api/list/recipes {recipe_id, servings (1–100)}`: a recipe the user can't access → 404. A second add sums the servings.
  - `DELETE /api/list/recipes/:recipeId`
  - `POST /api/list/items {name, amount, unit}`: uses `matchName` and `toBase`.
  - `DELETE /api/list/items/:id`
  - `PUT /api/list/ticks {key, ticked: boolean}`
  - `POST /api/list/checkout {lines: {key, canonical_name, unit, amount: number | null}[]}` (1–200 lines). It calls `applyToPantry` with op `add` and the **given** amounts. A typed item (`item:<id>`) whose given amount is less than its own amount is reduced by that amount; otherwise it is deleted. It clears the ticks of the checked-out keys and returns the new `GET /api/list` body.
- [ ] **Step 1: Failing tests:**
  - Plan two recipes sharing Butter → one line.
  - Checkout with an edited amount of 30 g instead of 60 g → pantry +30 g, and the line now shows 30 g.
  - A typed "Milch 2 l" checked out as 1 l → item reduced to 1000 ml and kept. Checked out in full → deleted.
  - The same recipe added twice → servings summed.
  - Another user's recipe → 404.
  - A deleted recipe → its planned entry and lines are gone.
  - Two recipes spelling "Zwiebeln, rot" and "rote Zwiebel" after one `PUT /api/aliases` → one line (Review Focus 3).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: shopping list api with checkout`.

### Task 10: Einkaufsliste UI

**Files:** Create `src/pages/ShoppingList.tsx`, `src/components/CheckoutSheet.tsx`. Modify `src/App.tsx`, `src/api.ts`, `src/pages/RecipeDetail.tsx`, `src/styles.css`.

**Interfaces:**
- Consumes: the Task 9 routes.
- Behaviour:
  - Detail page: a button "Auf die Einkaufsliste" sends the current servings. Once the recipe is planned it reads "Auf der Einkaufsliste", and tapping it removes the recipe from the list.
  - Einkaufsliste shows:
    - the planned recipes as removable chips
    - the lines with a checkbox each, the amount ("etwas" when null), "Für: {Rezepte}", and the muted `pantryHint`
    - "Artikel hinzufügen"
    - a sticky "Einkauf abschließen" button, enabled when ≥ 1 line is ticked
  - `CheckoutSheet` lists the ticked lines with an editable amount each and a remove button. "In den Vorrat übernehmen" sends the checkout.
  - Tapping a line's name opens the correction sheet. It offers known standard names (from the Vorrat and the list) or a typed one, and calls `PUT /api/aliases` with the line's source names.
- [ ] **Step 1:** Implement. **Step 2:** Run `npm test` and `npm run build`. Both clean.
- [ ] **Step 3: Commit** `feat: shopping list screen`.

### Task 11: Fertig gekocht

**Files:** Create `src/components/CookedSheet.tsx`. Modify `worker/list.ts`, `test/list.test.ts`, `src/pages/RecipeDetail.tsx` (pass servings), `src/pages/CookMode.tsx`, `src/api.ts`.

**Interfaces:**
- Route: `POST /api/recipes/:id/cooked {items: {canonical_name, unit, amount: number | null}[]}`. An inaccessible recipe → 404. It calls `applyToPantry` with op `subtract` and the **given** amounts. If the recipe is planned, the entry is removed. It returns 204.
- Servings: "Kochen starten" links to `/rezept/:id/kochen?portionen=<n>`. CookMode reads it with a fallback chain: query → the planned servings (from `GET /api/list` `planned`) → `recipe.servings`.
- Behaviour:
  - On the last step, a primary "Fertig gekocht" button opens `CookedSheet`. It shows an editable servings stepper and the list from `scaledNeeds` for those servings (matched via a new `GET /api/recipes/:id/matches` → `Match[]`, which runs `matchRecipe`).
  - Each item has an editable amount and a toggle. "Immer da" and null-amount items are shown greyed out and are not sent.
  - "Vom Vorrat abziehen" submits, then navigates back to the detail page.
- [ ] **Step 1: Failing tests:**
  - Cooked with an edited amount → exactly that amount is subtracted.
  - An item not in the Vorrat → ignored.
  - The planned entry is removed.
  - Another user's recipe → 404.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm test` and `npm run build`. Both clean.
- [ ] **Step 5: Commit** `feat: subtract a cooked recipe from the vorrat`.

---

## Phase G — Share links (`feat/share-links`)

### Task 12: Recipe snapshot and copy

**Files:** Create `worker/copy.ts`, `test/copy.test.ts`

**Interfaces:**
- Produces:
  - `type Snapshot = { recipe: Omit<Recipe, "id" | "created_at" | "image_url">; image_key: string | null; ingredients: Ingredient[]; steps: Step[]; adjustments: Adjustment[]; note: string; ingredient_notes: IngredientNote[] }`
  - `snapshotRecipe(db: D1Database, recipeId: string, mode: "with_comments" | "baked"): Promise<Snapshot>`. `baked` = `mergeRecipe` output with removed items skipped, written as originals with positions 0..n. It has no adjustments, an empty note and no ingredient notes. The caller has already checked access.
  - `insertSnapshot(env: Env, snapshot: Snapshot, owner: { userId: string; groupId: string | null }): Promise<string>`. It creates new ids for the recipe, every ingredient, step and adjustment, remaps `target_id`, `insert_after` and the ingredient-note `target_id` (including notes keyed to added-ingredient adjustment ids), and inserts in one `DB.batch`. If `image_key` exists in R2, it copies the object to `<newRecipeId>` and sets `image_url = /api/images/<newRecipeId>`; a missing object → `image_url` null. It returns the new id. The `groupId` column exists only from Task 15, so in this phase `insertSnapshot` writes `user_id` only, and Task 15 adds the `group_id` write.
- [ ] **Step 1: Failing tests** (Review Focus 5):
  - `with_comments` copy of a recipe that has a modified ingredient, a removed step, a split piece with `insert_after`, an ingredient note on an added ingredient, a note and an image:
    - `mergeRecipe` of the copy equals the source's, apart from ids.
    - Originals equal the source's originals.
    - The note on the added ingredient points at the copy's adjustment id.
    - The image is a separate R2 object, and deleting the source leaves it.
  - `baked` copy: 0 adjustments, ingredients equal the source's merged non-removed values.
  - Tags and `total_minutes` are copied.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: snapshot and copy recipes`.

### Task 13: Share-link API

**Files:** Create `migrations/0006_share_links.sql`, `worker/share.ts`, `test/share.test.ts`. Modify `worker/index.ts` (`SOCIAL_LIMIT` in `Env`), `wrangler.jsonc` (rate-limit binding `SOCIAL_LIMIT`, `simple: { limit: 20, period: 60 }`, with its own `namespace_id`), `worker-configuration.d.ts` (`npm run types`).

**Interfaces:**
- Migration: `share_links(token TEXT PRIMARY KEY, created_by TEXT NOT NULL, payload TEXT NOT NULL, expires_at TEXT NOT NULL)`.
- Routes:
  - `POST /api/recipes/:id/share {mode: "with_comments" | "baked"}` → `{ url: "/teilen/<token>", expires_at }`.
    - An inaccessible recipe → 404.
    - `SOCIAL_LIMIT` keyed `share:<userId>` → 429.
    - The token is 32 random bytes, base64url.
    - `expires_at` = now + 24 h, as an ISO UTC string.
    - The payload is the JSON `Snapshot`.
  - `GET /api/share/:token` → `{ recipe: Snapshot; expires_at; shared_by_initials }`. Unknown → 404; expired → 410 `{ error: "Link abgelaufen" }`.
  - `POST /api/share/:token/import` → `{ id }` via `insertSnapshot` with the caller as owner. Same 404/410 rules. Multi-use.
  - Expired rows are deleted lazily on any share read.
- [ ] **Step 1: Failing tests** (Review Focus 4):
  - Create, then preview as Bob → 200.
  - Import as Bob twice → two distinct recipes, each with its own image.
  - `expires_at` moved into the past → preview and import 410 "Link abgelaufen".
  - Unknown token → 404.
  - Alice sharing Bob's recipe → 404.
  - The 21st share in a minute → 429.
  - `mode: "baked"` preview has 0 adjustments.
  - The token is not guessable: its length is ≥ 43 chars.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: 24 hour share links`.

### Task 14: Share UI

**Files:** Create `src/components/ShareSheet.tsx`, `src/pages/SharedRecipe.tsx`. Modify `src/App.tsx` (route `/teilen/:token`), `src/pages/RecipeDetail.tsx`, `src/api.ts`, `src/styles.css`.

**Interfaces:**
- Consumes: the Task 13 routes. `ApiError.data` carries the 410 body.
- Behaviour:
  - The detail page gets a "Teilen" button. `ShareSheet` offers two choices, "ohne Kommentare" and "mit Kommentaren", then shows the full link with "Link kopieren" (`navigator.clipboard.writeText`, falling back to selecting the text), plus "Gültig für 24 Stunden".
  - If `navigator.share` exists, it is offered as well.
  - `SharedRecipe` shows a read-only preview using the existing card and row styles: the merged view, orange markers in "mit Kommentaren", and "Geteilt von {Initialen}". It has a sticky "Ins Kochbuch übernehmen" button that navigates to the new recipe.
  - On 410 it shows "Link abgelaufen", with no button.
- [ ] **Step 1:** Implement. **Step 2:** Run `npm test` and `npm run build`. Both clean.
- [ ] **Step 3: Commit** `feat: share and import recipes by link`.

---

## Phase H — Groups (`feat/groups`)

### Task 15: Group schema and one access check

**Files:** Create `migrations/0007_groups.sql`, `worker/access.ts`, `test/access.test.ts`. Modify `worker/recipes.ts`, `worker/import.ts` (image route), `worker/split.ts` (if recipe-scoped), `worker/notes.ts`, `worker/list.ts`, `worker/share.ts`, `worker/copy.ts`.

**Interfaces:**
- Migration:
  - `groups(id PK, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at)`
  - `group_members(group_id FK ON DELETE CASCADE, user_id, PRIMARY KEY (group_id, user_id))`
  - `group_invites(group_id FK ON DELETE CASCADE, email, invited_by, created_at, PRIMARY KEY (group_id, email))`
  - `ALTER TABLE recipes ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE CASCADE`
  - `ALTER TABLE adjustments ADD COLUMN author TEXT`
- Produces:
  - `recipeAccess(db: D1Database, userId: string, recipeId: string): Promise<boolean>`. It is true when (`group_id IS NULL AND user_id = userId`) OR (`group_id` IS NOT NULL AND userId is a member). This is the **only** recipe ownership check. Every existing `WHERE id = ? AND user_id = ?` ownership query on recipes is replaced by it, including the image route.
  - `GET /api/recipes` (Home) stays personal: `user_id = ? AND group_id IS NULL`.
  - Writes to adjustments set `author = userId`.
  - `insertSnapshot` writes `group_id`. Group recipes keep `user_id` = the sharer as creator.
- [ ] **Step 1: Failing tests** (Review Focus 1), as a table-driven `test/access.test.ts` over every recipe-scoped route listed in Review Focus 1:
  - a member gets the owner's status codes
  - a non-member gets 404
  - a member who left gets 404
  - a personal recipe is unaffected
  - the full existing suite still passes
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: one recipe access check with group membership`.

### Task 16: Groups API

**Files:** Create `worker/groups.ts`, `test/groups.test.ts`. Modify `worker/index.ts`, `shared/schema.ts`.

**Interfaces:**
- Routes:
  - `POST /api/groups {name}` → `{ id }`. The creator becomes a member. The 21st group → 400.
  - `GET /api/groups` → `{ id, name, member_count, recipe_count }[]` for my groups.
  - `GET /api/groups/:id` → `{ id, name, members: string[], invites: string[], recipes: RecipeSummary[] }`. A non-member → 404.
  - `POST /api/groups/:id/invites {email}`:
    - the email is lower-cased and trimmed, and validated with `z.email()`
    - self → 400
    - already a member or already invited → 204 (idempotent)
    - limits → 400
    - `SOCIAL_LIMIT` keyed `invite:<userId>` → 429
  - `GET /api/invites` → `{ group_id, group_name, invited_by }[]` for my email.
  - `POST /api/invites/:groupId/accept`
  - `DELETE /api/invites/:groupId`, which declines and deletes the invite
  - `DELETE /api/groups/:id/members/me`, which leaves the group:
    - It removes my `planned_recipes` and `ingredient_matches` for that group's recipes.
    - If I was the last member, the group is deleted (cascade) and its recipes' R2 objects are deleted too.
  - `POST /api/recipes/:id/share-to-group {group_id}` → `{ id }`, via `snapshotRecipe(…, "with_comments")` and `insertSnapshot(…, { userId, groupId })`. I must have access to the source recipe and be a member of the target group → else 404.
  - Copied adjustments and notes get `author = userId`.
- [ ] **Step 1: Failing tests:**
  - Create, invite Bob, Bob accepts → Bob sees the group and its recipes.
  - Bob declines → the invite is gone.
  - Carol can't accept Bob's invite (404).
  - Share to the group → a group recipe exists.
  - Editing it changes nothing in the personal recipe, and the reverse.
  - Bob's adjustment carries `author` = Bob.
  - Leaving removes Bob's planned entry for a group recipe.
  - The last member leaving deletes the group, its recipes and their R2 objects.
  - The 21st invite → 400.
  - Self-invite → 400.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: groups, invites and sharing into a group`.

### Task 17: Groups UI

**Files:** Create `src/pages/Groups.tsx`, `src/pages/Group.tsx`. Modify `src/App.tsx` (`/gruppen`, `/gruppen/:id`), `src/components/TabBar.tsx` (fourth tab "Gruppen"), `src/pages/Home.tsx` (invite banner), `src/pages/RecipeDetail.tsx` ("In Gruppe teilen", initials), `src/components/ItemRow.tsx`, `src/api.ts`, `src/styles.css`.

**Interfaces:**
- Consumes: the Task 16 routes. `initials()` comes from `shared/format.ts`, and `author` on adjustments and notes.
- Behaviour:
  - Gruppen lists the groups and has "Gruppe erstellen" (a name sheet).
  - Group page:
    - members' initials, with "Einladen" opening an email sheet
    - recipe cards, as on Home, that open the normal detail page
    - "Gruppe verlassen", with a confirm
  - Pending invites show as a banner on Home and Gruppen, with "Einladung annehmen" and "Ablehnen".
  - The detail page of a personal recipe gets "In Gruppe teilen", which picks a group and navigates to the new copy. On a group recipe, adjusted and added rows and notes show "Geteilt von {Initialen}" of their author, muted.
- [ ] **Step 1:** Implement. **Step 2:** Run `npm test` and `npm run build`. Both clean.
- [ ] **Step 3: Manual check:** with two Access emails (or `DEV_USER_EMAIL` switching in `wrangler dev`), go through invite → accept → share → each member edits → personal recipe unchanged.
- [ ] **Step 4: Commit** `feat: groups screens`.

---

## Out of scope (ask before adding)

Shared households and group Vorrat or lists, a meal-plan calendar, prices or shops, barcode scanning, expiry dates, AI cross-unit estimates, notes on steps, public pages, live sync, group roles, moving a group recipe back to personal, photo upload, notifications or emails for invites, TikTok.
