# Plan: unit dropdown, Gewürze, step comments, add-item sheet, allergies

Owner's list (2026-11-05): "Gewürze vs Ingredienzen", "Kommentare für Koch Schritte", "Artikel hinzufügen -> erst Name dann Einheit dann Rad mit Menge", "Artikel in Lager hinzufügen Vorschläge / Sync mit ingredients", "Allergie Dings", "Einheiten alle normieren". Group sync is already implemented (group recipe = copy at share time, members share edits); a reported "friend doesn't see my change" bug is parked by the owner and is NOT part of this plan.

Owner decisions:
- Units: **no conversion**. Offer a dropdown of the usual units wherever a unit is entered.
- Gewürze: a separate "Gewürze" section in the recipe ingredient list. Gewürze go on the shopping list by default unless already in the Vorrat (= existing behaviour for every ingredient, so the shopping list does not change).
- Allergies: each user keeps a list of allergies/no-gos; recipes warn and mark the matching ingredients. In a group, the warning covers every current member's allergies.

No separate spec; this plan is the authority. Build order matters: Task 1's unit list is used by Tasks 2 and 4.

## Global Constraints

- German UI text, no emojis. Touch targets ≥ 44 px. Orange is reserved for adjustments.
- Originals (`ingredients`, `steps` rows) are insert-only; changes go through `adjustments`.
- Migrations are additive (new file `migrations/000N_*.sql`, never edit old ones).
- Validate every request body with zod in `shared/schema.ts`, with length/count limits. Parameterized SQL only.
- Every recipe read/write goes through `recipeAccess` (worker/access.ts). Foreign ids return 404.
- Share-link payloads created before this deploy (they live 24 h + 7 d) must still import: `insertSnapshot` defaults any new field. The share preview strips `author` from notes; any new author field gets the same treatment with a no-'@' test.
- Rules in `rules.md` apply: simplest thing that works, reuse before writing, no dead code, `ponytail:` comment on deliberate shortcuts, tests for real logic.
- Before each commit: `npm test` and `npx tsc --noEmit` pass. Commits are small, imperative, and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019MtQv3TKFbbzstfLeKaSRD
  ```
- Add a CLAUDE.md "Decisions" entry (date 2026-11-05, what, why) for every spec deviation or non-obvious call you make.

## Task 1: Unit dropdown

Goal: every place a unit is typed becomes a `<select>` of usual units. No conversion.

- `shared/units.ts`: export `UNITS = ["", "g", "kg", "ml", "l", "EL", "TL", "Prise", "Msp", "Stück", "Bund", "Dose", "Packung", "Zehe", "Scheibe", "Becher", "Tasse"] as const`. `""` is shown as "–" (no unit). Do not change `normalizeUnit`/`toBase`.
- New `src/components/UnitSelect.tsx`: a `<select className="field">` over `UNITS`. If the current value is not in `UNITS` (e.g. an imported "Stk"), it is added as the first extra option so editing never loses it. Props: `id?`, `value`, `onChange(unit)`, `aria-label?`.
- Replace the unit `<input>` in `src/components/EditSheet.tsx`, `src/pages/OwnRecipe.tsx`, `src/components/PantrySheet.tsx` with `UnitSelect`.
- `worker/parse.ts` prompt: replace the "Einheiten (unit) kurz…" line with one that lists exactly the `UNITS` values (build the line from `UNITS`, not a copy) and says: use the closest one; if none fits, use the unit from the text; without a unit an empty string. "Stk" in the old rule becomes "Stück".
- Tests: one test that the parse system prompt contains every non-empty unit (export the prompt or a builder if needed). No component tests.

## Task 2: Gewürze section

Goal: each ingredient has a `spice` flag; the recipe page shows "Zutaten" and "Gewürze" sections.

- Migration `0008_spice.sql`: `ALTER TABLE ingredients ADD COLUMN spice INTEGER NOT NULL DEFAULT 0;`
- `IngredientValues` gains `spice: z.boolean()`. Keep `ParsedRecipe` a plain object schema (it is exported with `z.toJSONSchema` for the AI). Requests from old clients and old share snapshots without `spice` must still work: default to `false` at the trust boundaries that need it (NewRecipe input, adjustment add, `insertSnapshot`), without breaking the AI JSON schema. Modify adjustments may set only `spice` (toggling the flag is a normal orange adjustment). The strict adjustment-value union must still tell ingredient values from step values.
- Read path (`worker/recipes.ts` load) returns `spice` as boolean; create path stores it; `worker/copy.ts` snapshot/insert carries it (both modes); `mergeRecipe` passes it through.
- Parse prompt: set `spice` true for Gewürze, getrocknete Kräuter, Salz, Pfeffer, Gewürzmischungen; false otherwise (fresh herbs in Bund: false).
- `EditSheet` (ingredient): a checkbox "Gewürz". `OwnRecipe`: a "Gewürz" checkbox per ingredient row.
- `RecipeDetail` ingredient tab: render non-spice ingredients first, then a "Gewürze" subheading and the spice ingredients; hide the heading when there are none. Numbering/ordering inside each section keeps merged order. Cook mode and shopping list unchanged.
- Tests: create + load round-trips `spice`; a modify adjustment with only `{ spice: true }` is accepted and merged; an old-format snapshot (ingredients without `spice`) imports with `spice = false`; an add adjustment without `spice` is accepted as false.

## Task 3: Comments on cooking steps

Goal: the per-ingredient comment ("ingredient note") also works on steps, and cook mode shows a step's comment.

- Keep the table `ingredient_notes` and route `PUT /api/recipes/:id/ingredient-notes/:targetId` (no rename; no migration). Generalise `assertIngredientTarget` in `worker/notes.ts` to accept an original step id or a step 'add' adjustment id too (rename it to `assertNoteTarget`, update callers).
- Deleting a step 'add' adjustment deletes its note, like ingredients today (`worker/recipes.ts` ~line 266).
- Snapshot/copy already remaps all row ids; add a test that a step note survives a group copy and a share import with comments.
- UI: the step edit sheet gets the same note field the ingredient sheet has; step rows show the note like ingredient rows (ItemRow `note`). Group recipes show the author's initials as ingredient notes do.
- `src/pages/CookMode.tsx`: show the current step's note under the step text, muted. Update the CLAUDE.md decision "ingredient notes are not shown in cooking mode" to say step notes are shown, ingredient notes still are not.
- Tests: PUT a note on an original step and on an added step → 204 and it loads; a step id from another recipe → 404; deleting the added step removes its note; share preview of a step note has no author.

## Task 4: Add-item sheet: name → unit → amount wheel, with suggestions

Goal: `PantrySheet` (used for Vorrat add/edit and shopping-list "Artikel hinzufügen") asks name first, then unit, then amount via a wheel, and suggests names the user already knows.

- New `GET /api/pantry/suggestions` (worker/pantry.ts): the user's known item names with their most recent unit: Vorrat items, then non-fallback `ingredient_matches` (most recent first), deduped by `nameKey`, max 200. Reuse/extend `knownNames` in `worker/match.ts` instead of a second query set. Response `{ name: string; unit: string }[]`.
- `PantrySheet` field order: Name, Einheit, Menge.
  - Name: `<input list=…>` with a `<datalist>` of suggestion names (native autocomplete). Choosing/typing a name that matches a suggestion (by `nameKey`) sets the unit to the suggestion's unit if the user has not picked a unit yet.
  - Einheit: `UnitSelect` from Task 1.
  - Menge: a `<select>` (renders as a wheel on iOS) with values depending on the unit: g/ml: 25, 50, 75, 100, then 50-steps to 1000; kg/l: 0.25, 0.5, 0.75, 1–5 in 0.5 steps; everything else: 0.5, 1–20. Plus the current amount when editing and it is not in the list, plus an "etwas" option (null amount) where null amounts are allowed today (keep `pantryAmount` rules for always-at-home items). Put the value lists in `src/lib/edit.ts` as a pure function `amountOptions(unit, current)` with a test.
- Fetch suggestions once when the sheet opens; a failed fetch just shows no suggestions.
- Tests: suggestions endpoint returns Vorrat + matched names deduped, scoped to the caller (another user's names never appear); `amountOptions` for g, kg, Stück and a current value outside the list.

## Task 5: Allergies

Goal: each user maintains allergies; recipes warn and mark matching ingredients; group recipes warn for all current members.

- Migration `0009_allergies.sql`: `CREATE TABLE user_allergies (user_id TEXT NOT NULL, allergen TEXT NOT NULL, PRIMARY KEY (user_id, allergen));`
- `shared/allergens.ts`:
  - `PRESETS`: the common ones with German keyword lists matched against `nameKey(ingredient name)` as substrings, e.g. Gluten (weizen, mehl, dinkel, roggen, gerste, nudel, pasta, spaghetti, brot, couscous, bulgur, paniermehl, semmel), Laktose (milch, sahne, butter, käse, joghurt, quark, schmand, mascarpone, mozzarella, parmesan, frischkäse, crème fraîche), Nüsse (nuss, mandel, cashew, pistazie, pekan, macadamia), Erdnüsse (erdnuss), Ei (ei, eier, eigelb, eiweiß — match "ei" only as a whole word), Fisch (fisch, lachs, thunfisch, sardelle, kabeljau), Krebstiere (garnele, shrimp, krabbe, hummer), Soja (soja, tofu, edamame), Sellerie (sellerie), Senf (senf), Sesam (sesam, tahin).
  - A custom allergen (not a preset) matches by its own `nameKey` as a substring.
  - `allergenHits(ingredientNames: string[], allergens: string[]): { allergen: string; names: string[] }[]` — pure, with tests (incl. "Eier" hits Ei, "Weißwein" does not hit Ei, custom "Koriander" hits "frischer Koriander").
  - `// ponytail:` keyword matching misses unlisted foods; upgrade path: AI tagging at import.
- API (new `worker/allergies.ts`, mounted like the others): `GET /api/allergies` → my list; `PUT /api/allergies` body `{ allergens: string[] }` (max 30 items, each trimmed 1–40 chars, deduped) replaces my list.
- `GET /api/recipes/:id` adds `allergies: { user_id: string; allergens: string[] }[]`: for a personal recipe only the caller; for a group recipe every current member (members only, after `recipeAccess`). Add it to `RecipeFull` in `shared/schema.ts`. Do not add it to share snapshots/previews.
- `GET /api/groups/:id` adds the same `allergies` list for members, so the group page can warn on cards.
- UI:
  - New page `/allergien` ("Allergien & No-Gos"): checkboxes for `PRESETS`, a text field + "Hinzufügen" for custom ones, removable chips, "Speichern". Link to it from the Home header (small text button).
  - `RecipeDetail`: if any hit, a warning box above the ingredients: "Enthält Nüsse (Haselnuss)" and, for group recipes, prefixed with the member's initials ("JK: Laktose (Sahne)"; "Du" for the caller). Matching ingredient rows get a small "Allergen" marker. Use the merged ingredient names (adjustments applied, removed ones skipped).
  - Recipe cards on Home (own allergies, `ingredient_names`) and on the group page (members' allergies) show a small warning line when there's a hit.
- Security: allergies are personal data. A member sees co-members' allergies only through a group they share; non-members never. Tests: personal recipe returns only the caller's list; group recipe returns all members' lists; after Bob leaves the group, his allergies no longer appear; PUT validation (31 items → 400, empty string → 400); another user's GET never returns my list.
