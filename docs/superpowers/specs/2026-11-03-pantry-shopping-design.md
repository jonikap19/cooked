# Design: ingredient notes, shopping list, Vorrat

Owner request (2026-11-03), verbatim: *"commentary to the ingredients (not the ingredient description but user specific comments) & shopping list for recipes when added & new tab for what i already have at home, calculate shopping list based on what i already have & subtract ingredients from storage when recipe is finished & add ingredients to storage when "shopping list" is marked as "bought" (needs to be editable if user didnt get everything). for the ingredient storage we will need some kind of matching (using llm?) to make the ingredients uniform"*

Decisions below marked **(owner)** were chosen by the owner in the 2026-11-03 Q&A. Ones marked **(Claude's call)** are defaults the owner hasn't explicitly confirmed. They passed playback with "seems good", but can be overridden.

## Intent

Plan meals from the recipes already in the cookbook, see what to buy, and know what's at home, with as little typing as possible. Today the app ends at "Kochen starten". This closes the loop: plan → shop → cook → stock goes down.

Success: the owner adds two recipes to the list, the list shows only what's missing from the Vorrat. They tick what they bought, fix the one amount they didn't get, and the Vorrat updates. After cooking, the Vorrat goes down without retyping anything.

## Goals

1. **Ingredient notes.** A personal note on one ingredient in one recipe **(owner)**, e.g. "braune Butter, nicht zu dunkel". It is separate from the ingredient's own text and from adjustments. It shows on that row in the detail view and in cooking mode.
2. **Shopping list.** One combined list per user **(owner)**.
   - "Auf die Einkaufsliste" on a recipe adds it. Same ingredients from different recipes merge, minus what's in the Vorrat. Each line shows which recipes it's for.
   - Users can also type their own items **(owner)**.
3. **Vorrat tab.** What's at home, with amounts **(owner)**.
   - Items can be marked "Immer da" (salt, oil, spices). Those never appear on the shopping list and are never subtracted **(owner)**.
   - Users add and edit items by hand **(owner)**.
4. **Bought.** Users tick items on the list, then "Einkauf abschließen" opens a sheet with the ticked items and their amounts, all editable **(owner)**. Confirming adds them to the Vorrat. Unticked items stay on the list.
5. **Cooked.** At the last step of cooking mode, "Fertig gekocht" opens a sheet with the amounts that will be subtracted, scaled and editable **(owner)**. Confirming subtracts them from the Vorrat.
6. **Matching.** Ingredient names and units become uniform, so "Zwiebeln, rot" in one recipe and "rote Zwiebel" in the Vorrat are the same item.
   - Done once when a recipe is saved, by the AI, reusing names already known for this user **(owner)**.
   - Users can correct a match, and corrections stick **(owner)**.

## Non-goals

- Shared households: Vorrat and list are per user, like recipes **(owner)**.
- Meal planning calendar, prices, shops/aisles, barcode scanning, expiry dates, nutrition.
- Offline use: still out of scope (CLAUDE.md decision).
- AI estimates across units ("1 Zwiebel ≈ 120 g"), which the owner rejected.

## Anti-goals (failure even if it "works")

- The Vorrat silently drifts from reality because a flow subtracted or added without the user seeing it. Every change to the Vorrat from bought or cooked goes through a confirm sheet.
- Matching overwrites something the user corrected by hand.
- The shopping list shows things marked "Immer da", or doubles an item because the same ingredient is spelled two ways.
- Recipe originals get rewritten. Originals stay insert-only (MVP Global Constraint), so matching and notes live beside them, never in `ingredients`.

## Constraints (from the existing app)

- Cloudflare Worker + Hono, D1, Workers AI, Access auth; React SPA. German UI, design tokens from the spec. Orange is only for adjustments. Touch targets ≥ 44 px, no emojis.
- User scoping: every new table is reachable only through the caller's `user_id`. Foreign ids → 404.
- Originals are insert-only. Ingredients the user added are `add` adjustments, so their id is the adjustment id. Anything keyed to "an ingredient in a recipe" must accept either an original ingredient id or an `add` adjustment id (as `insert_after` validation already does for originals).
- The merged view (`mergeRecipe`) is what the user sees and cooks. Shopping and cooked amounts use the merged ingredients (with the user's adjustments), not the originals **(Claude's call)**.
- Workers AI: always `max_tokens`, zod-validated output, and never log ingredient text. AI endpoints share `PARSE_LIMIT`.
- Migrations are additive only, next number `0003_…`. Each PR says whether it has one. Deploys stay manual.
- Repo rules (`rules.md`): simplest thing that works, tests for real logic. Merging and unit maths are real logic and get tests.

## How it works (decided)

### Units **(owner: convert where safe, else keep apart)**

- Exact conversions only: `kg → g`, `mg → g`, `l → ml`, `cl → ml`, `dl → ml`. Everything is stored and summed in the base unit (`g`, `ml`).
- Count-like units keep their own name: `Stück`, `EL`, `TL`, `Prise`, `Bund`, `Dose`, `Packung` and others.
  - The AI picks one standard unit per ingredient (Zwiebel → `Stück`). An empty unit counts as `Stück`.
- Two amounts of the same ingredient in units that can't convert stay as **separate lines**. They are never guessed together.
- An amount of null ("etwas Salz") counts as "needed, amount unknown". On the list it shows the name without an amount, and it's subtracted as nothing.

### Matching **(owner: once on save, corrections stick)**

- A per-user mapping stores, for each recipe ingredient (original id or added-ingredient adjustment id):
  - its standard name
  - its standard unit
  - the ingredient name it was matched from
  - whether the user confirmed it by hand
- The AI is called once per recipe save, with all ingredient names in one call. It also gets the list of standard names this user already has (from the Vorrat and earlier mappings, capped) and is told to reuse them.
- Re-match an ingredient only when its current merged name differs from the name it was matched from, e.g. after a `modify` that changes the name or a new `add`. Never re-match a confirmed mapping.
- Existing recipes have no mappings. They get matched the first time they're used on the list or in a cooked sheet **(Claude's call)**, behind the same rate limit.
- When the AI fails or is rate-limited, the ingredient falls back to its own name and unit, normalised: trimmed, case-folded for comparison, units converted as above. The flows still work, just with less merging.
- Correcting a match: from the shopping list or Vorrat line, the user picks another existing standard name or types a new one. That sets `confirmed`.
- **Corrections apply to that spelling everywhere (owner).** A per-user lookup stores "source name as written (normalised) → standard name + unit". The matcher checks it before calling the AI, so every recipe with that spelling, now and later, maps the same way.
- **Save never waits on the AI (Claude's call).** Saving a recipe stays as fast as today. Matching is triggered right after the save (`waitUntil`) and also runs lazily at first use (list or cooked sheet) for anything still unmatched.
- **Fallback mappings are stored, marked as fallback (Claude's call).** They are retried at most once per 24 h, so a failing AI can't drain the rate limit on every list read.

### Vorrat

- One row per user per (standard name, unit): amount (may be null = "some"), `always_at_home` flag.
- Hand edits: add an item, edit its amount or unit, toggle "Immer da", delete it. Typed names go through matching (one AI call per add, or the fallback).
- Amounts never go below zero. An item that reaches zero and isn't "Immer da" is removed **(Claude's call)**.
- **Unknown amounts (Claude's call).** A null amount means "etwas da".
  - Adding a number to a null row makes it that number.
  - Adding null to an existing row leaves its amount unchanged.
  - Subtracting from a null row leaves it null.
  - On the list, a null-amount Vorrat row covers a null-amount need, but not a numeric one.
- **Name/unit collisions merge (Claude's call).** If a correction or a hand edit makes a Vorrat row's (standard name, unit) equal to an existing row, the two rows merge and their amounts are summed with the null rules above. "Immer da" wins if either row had it.

### Shopping list

- The list stores:
  - **planned recipes**: recipe id plus the servings at the time it was added, taken from the portion slider
  - **typed items**: name, amount, unit, matched like everything else
  - **ticked state** per line
- Lines are **computed on read**. For each (standard name, unit), sum the scaled needs of all planned recipes, subtract the Vorrat amount, drop lines ≤ 0 and "Immer da" items, then add the typed items. Each line lists the recipe titles it comes from.
- Adding the same recipe twice adds its servings to the planned entry. Users can remove a planned recipe or a typed item from the list.
- **Einkauf abschließen**: a sheet lists the ticked lines with their computed amounts, all editable (and removable). Confirming adds the confirmed amounts to the Vorrat and deletes the bought typed items.
  - Planned recipes stay on the list. Their lines disappear because the Vorrat now covers them.
  - A partial amount leaves the rest on the list.
- A partly bought **typed item** is reduced by the bought amount and stays on the list. A typed item bought in full is deleted **(Claude's call)**.
- **Unit mismatch hint (Claude's call).** When the Vorrat has the same standard name only in another unit (2 Stück Zwiebel, recipe needs 300 g), the line still shows the full 300 g (no cross-unit guessing, owner), with a muted hint "im Vorrat: 2 Stück".
- A planned recipe leaves the list when it's cooked ("Fertig gekocht") or removed by hand **(Claude's call)**.

### Cooked

- "Fertig gekocht" on the last step of cooking mode opens a sheet with the recipe's merged ingredients, scaled to the servings used.
  - **Which servings (Claude's call):** today cooking mode doesn't receive the slider value. "Kochen starten" passes the detail screen's current servings to cooking mode. If the recipe was opened another way, the sheet uses the planned servings from the list, else the recipe's own. The servings number is editable in the sheet.
  - "Immer da" and null-amount items are listed but not counted.
  - Every amount is editable, and an ingredient can be untoggled.
- Confirming subtracts the amounts from the Vorrat and removes that recipe from the planned list (one entry).
- Ingredients not in the Vorrat are simply ignored. No negative stock.

### Ingredient notes **(owner: per recipe ingredient)**

- One note per (recipe, ingredient id or added-ingredient id), plain text up to 500 chars. Edited from the existing per-row edit sheet.
- Shown muted under the row in the detail view and on the cooking-mode step list.
- A note is **not** an adjustment. It doesn't count toward "X Anpassungen", isn't orange, and survives resetting the ingredient's adjustments **(Claude's call)**.
- Deleting the recipe deletes its notes.

### Navigation **(Claude's call)**

A bottom bar on the main screens with three tabs: **Kochbuch** (today's home), **Einkaufsliste**, **Vorrat**. Cooking mode stays full-screen without the bar. New routes: `/einkaufsliste`, `/vorrat`.

### New German strings

"Einkaufsliste", "Vorrat", "Kochbuch", "Auf die Einkaufsliste", "Auf der Einkaufsliste", "Einkauf abschließen", "Fertig gekocht", "Immer da", "Notiz", "Für: {Rezepte}", "Artikel hinzufügen", "Vom Vorrat abziehen", "In den Vorrat übernehmen".

## Left to the builder

- Table layout, as long as originals stay untouched and every row is user-scoped. One mapping table, one Vorrat table, list tables, one notes table is the expected shape.
- The exact AI prompt and output schema for matching.
- The cap on known standard names sent to the AI.
- How the ticked state is keyed on computed lines. It must survive a re-read that doesn't change the line.
- Phase/PR split for the plan. Suggested order: notes → matching → Vorrat → shopping list + bought → cooked. Each phase is one PR against `main`, opened after the previous one merges.
- Visual layout of the new screens within the existing design language.

## Out of scope (ask before adding)

Shared households, a meal-plan calendar, prices or shops, barcode scanning, expiry dates, AI cross-unit estimates, notes on steps, sharing lists with other users.
