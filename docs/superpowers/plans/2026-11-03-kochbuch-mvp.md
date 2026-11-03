# Kochbuch MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first, installable PWA cookbook where each user imports recipes from pasted text (parsed by Workers AI) and layers personal adjustments on top of an immutable original.

**Architecture:** One Cloudflare Worker serves a Vite/React SPA as Static Assets and a Hono JSON API under `/api/*` (`assets.run_worker_first: ["/api/*"]`). Data lives in D1; originals are insert-only, adjustments are separate rows, and the client merges them via one shared pure function. Login is Cloudflare Access (email one-time PIN) in front of the whole Worker; the Worker verifies the Access JWT itself (Static Assets Workers don't receive `ctx.access`).

**Tech Stack:** TypeScript, Vite, React 18/19, React Router (library mode), `@cloudflare/vite-plugin`, Wrangler, Hono, D1, Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, JSON mode), `jose` (JWT verify), `zod` v4 (validation + JSON schema for AI), Vitest + `@cloudflare/vitest-pool-workers`, `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/dm-sans`.

**Spec:** `docs/spec.md`. Repo rules: `rules.md` (clean + secure code, git workflow). Work on branch `feat/kochbuch-mvp`.

## Global Constraints

- All UI text German; use these strings verbatim: "Mein Kochbuch", "Alle", "Angepasst", "Unter 30 Min", "X Anpassungen", "Rezept hinzufügen", "Link einfügen", "Text einfügen", "Rezept erkannt", "Bitte kurz prüfen, Mengen aus dem Video können fehlen", "Ins Kochbuch speichern", "Original", "X eigene Anpassungen", "Original zeigen", "Zutaten", "Schritte", "Geändert · Original 120 g" (pattern), "Von dir hinzugefügt", "Zutat hinzufügen", "Schritt hinzufügen", "Notiz für mich", "Kochen starten", "Schritt 3 von 6" (pattern), "Deine Anpassung: +2 Min" (pattern), "Original 6 Min · bei dir 8 Min" (pattern), "Zurück", "Weiter".
- Singular forms: "1 Anpassung", "1 eigene Anpassung".
- Colors (CSS custom properties in `src/styles.css`): `--bg #FAFAF7`, `--text #1A1A17`, `--primary #1F4D3A`, `--adj-text #A33F0C`, `--adj-bg #FDEBDD`. Every adjustment marker uses the two orange tokens, nothing else does.
- Fonts: "Bricolage Grotesque" headings, "DM Sans" body, self-hosted via `@fontsource-variable/*`. No Google Fonts CDN (GDPR, CSP).
- Rounded cards, every interactive element ≥ 44×44 px, no emojis anywhere (UI, AI output is shown as-is but prompt asks for none).
- Mobile-first: design at 375 px width, no horizontal scroll.
- `ingredients` and `steps` rows are never UPDATEd or DELETEd except via cascade when the whole recipe is deleted.
- Every DB query touching recipe data is scoped by `user_id` (directly or via join on `recipes.user_id`). A recipe/adjustment/target not owned by the caller → `404`, never `403` (don't leak existence).
- Only "Text einfügen" is functional; "Link einfügen" tab is visible but shows "Kommt bald" and is disabled.
- Never render user or AI content with `dangerouslySetInnerHTML`. `source_url`/`image_url` must be `https:` URLs (validated server-side).
- Input limits (zod): pasted text ≤ 10 000 chars; title ≤ 200; ingredient name ≤ 200; unit ≤ 30; step text ≤ 2 000; amount 0–100 000 or null; duration 1–1 440 min or null; servings 1–100; total_minutes 1–2 880 or null; ≤ 100 ingredients, ≤ 100 steps; note ≤ 5 000; ≤ 10 tags of ≤ 30 chars.
- Commits: author `180111101+jonikap19@users.noreply.github.com` (repo-local config, already set). Message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing wrangler/vitest-pool-workers config, check current Cloudflare docs (the `cloudflare:wrangler` skill / docs MCP); config keys drift between versions.

## Spec deviations (deliberate, add to CLAUDE.md working notes)

- `recipes` gets two extra columns the spec needs but the data model omits: `total_minutes` (cards, preview, "Unter 30 Min") and `tags` (JSON array text, for the tag chips). Tags are edited on the detail screen.
- `user_id` = the lower-cased email from the Access JWT. No users table.
- No service worker: manifest alone makes it installable on Android/iOS; offline mode is out of scope.
- Images: text import has no image, so the preview has an optional "Bild-URL" field; cards show a green placeholder block when empty.
- Added: delete recipe (needed to clean up bad imports).

## Review Focus

1. **Ingredients without amount** ("Salz nach Geschmack", "1 Prise") — `amount: null` must survive parse → save → merge → scale and render as name only, no "0" or "NaN". Tests in Task 2 (`formatAmount`, `scaleAmount`) and Task 6 (parse output).
2. **Adjustment pointing at another recipe's/user's row** — `target_id` from a different recipe must be rejected with 404, not silently stored. Test in Task 5.
3. **Editing an item back to its original values** — must delete the `modify` adjustment so the count and orange marker disappear. Test in Task 5.
4. **Access session expires while the PWA is open** — fetch gets a redirect to `*.cloudflareaccess.com` (opaque/CORS failure or HTML). The client must show "Sitzung abgelaufen" with a "Neu laden" button instead of crashing. Test in Task 7 (`request()`).
5. **Phone locks / tab backgrounded during a timer** — remaining time must be computed from a stored end timestamp, not decremented per tick. Test in Task 10 (`remainingSeconds`).

## File Structure

```
wrangler.jsonc            Worker config: assets, D1 "DB", AI "AI", rate limit "PARSE_LIMIT", vars
vite.config.ts            react + cloudflare plugins
vitest.config.ts          workers pool, applies D1 migrations
migrations/0001_init.sql  schema
shared/schema.ts          zod schemas + inferred types (single source for API, DB rows, AI)
shared/merge.ts           mergeRecipe(): original + adjustments -> view model
shared/format.ts          scaleAmount, formatAmount, detectPlatform, pluralize helpers
worker/index.ts           Worker entry: buildApp(getJwks) wiring, export default
worker/auth.ts            Access JWT middleware, Origin check, security headers
worker/recipes.ts         recipes, adjustments, notes routes
worker/parse.ts           /api/parse (Workers AI)
src/main.tsx, src/App.tsx routes; src/api.ts fetch wrapper; src/styles.css tokens
src/pages/Home.tsx, AddRecipe.tsx, RecipeDetail.tsx, CookMode.tsx
src/components/RecipeCard.tsx, EditSheet.tsx, ItemRow.tsx
src/lib/timer.ts, src/lib/wakeLock.ts
public/manifest.webmanifest, public/icon.svg, public/icon-192.png, public/icon-512.png, public/_headers
test/*.test.ts            all tests (run in workerd via vitest-pool-workers)
README.md                 setup + deploy steps
```

---

### Task 1: Scaffold Worker + SPA + test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `worker/index.ts`, `test/health.test.ts`, `.dev.vars.example`
- Modify: `.gitignore` (add `dist/`, `.wrangler/`)

**Interfaces:**
- Produces: `type Env = { DB: D1Database; AI: Ai; PARSE_LIMIT: RateLimit; TEAM_DOMAIN: string; POLICY_AUD: string; DEV_USER_EMAIL?: string }` exported from `worker/index.ts`. `buildApp(getJwks: (env: Env) => JWTVerifyGetKey): Hono<{ Bindings: Env; Variables: { userId: string } }>` exported from `worker/index.ts`; default export `{ fetch }` uses `createRemoteJWKSet(new URL(env.TEAM_DOMAIN + "/cdn-cgi/access/certs"))`, cached per isolate. npm scripts `dev`, `build`, `test`, `deploy`, `db:migrate:local`, `db:migrate:remote`.

- [ ] **Step 1:** Scaffold with Vite React-TS template contents (not a nested folder), add deps listed in Tech Stack. `wrangler.jsonc`: `name: "cooked"`, today's `compatibility_date`, `main: "worker/index.ts"`, `assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }`, `d1_databases: [{ binding: "DB", database_name: "cooked", migrations_dir: "migrations" }]`, `ai: { binding: "AI" }`, rate limit binding `PARSE_LIMIT` (10 requests / 60 s), `vars: { TEAM_DOMAIN, POLICY_AUD }` as placeholders. `.dev.vars.example`: `DEV_USER_EMAIL=dev@example.com`.
- [ ] **Step 2: Write failing test** `test/health.test.ts`: `GET /api/health` via `SELF.fetch` returns 200 `{ ok: true }`.
- [ ] **Step 3:** Run `npm test` → FAIL (route missing).
- [ ] **Step 4:** Add `app.get("/api/health", c => c.json({ ok: true }))` in `buildApp`. (This route stays public; Task 3 puts auth on everything else.)
- [ ] **Step 5:** `npm test` → PASS. `npm run build` → succeeds. `npm run dev` → page renders "Mein Kochbuch" in Bricolage Grotesque on `#FAFAF7`.
- [ ] **Step 6: Commit** `chore: scaffold worker, spa and test harness`.

### Task 2: Schema, shared types, merge + format logic

**Files:**
- Create: `migrations/0001_init.sql`, `shared/schema.ts`, `shared/merge.ts`, `shared/format.ts`, `test/merge.test.ts`, `test/format.test.ts`

**Interfaces:**
- Produces (`shared/schema.ts`, zod + `z.infer` types):
  - `IngredientValues = { name: string; amount: number | null; unit: string }`
  - `StepValues = { text: string; duration_minutes: number | null }`
  - `ParsedRecipe = { title: string; servings: number; total_minutes: number | null; ingredients: IngredientValues[]; steps: StepValues[] }` (steps min 1)
  - `NewRecipe = ParsedRecipe & { source_url: string | null; image_url: string | null }` (https-only)
  - `Ingredient = IngredientValues & { id: string; position: number }`, `Step = StepValues & { id: string; position: number }`
  - `Adjustment = { id: string; target_type: "ingredient" | "step"; target_id: string | null; action: "modify" | "add" | "remove"; new_values: Partial<IngredientValues> | Partial<StepValues> | null; created_at: string }`
  - `AdjustmentInput` = discriminated union validating: `add` → full values, `target_id` null; `modify` → partial values (≥1 key), `target_id` set; `remove` → no values, `target_id` set.
  - `Recipe = { id; title; source_url; source_platform: "instagram" | "youtube" | "web" | null; image_url; servings; total_minutes; tags: string[]; created_at }`
  - `RecipeSummary = Recipe & { adjustment_count: number; ingredient_names: string[] }`
  - `RecipeFull = { recipe: Recipe; ingredients: Ingredient[]; steps: Step[]; adjustments: Adjustment[]; note: string }`
- Produces (`shared/merge.ts`): `type Merged<T> = T & { status: "original" | "modified" | "added" | "removed"; original: T | null; adjustmentIds: string[] }`; `mergeRecipe(full: RecipeFull): { ingredients: Merged<Ingredient>[]; steps: Merged<Step>[]; adjustmentCount: number }`. Added items get `id` = adjustment id and come after originals ordered by `created_at`. A removed item that is also modified shows modified values with status `removed`; `adjustmentIds` lists all its adjustments.
- Produces (`shared/format.ts`): `scaleAmount(amount: number | null, base: number, target: number): number | null`; `formatAmount(amount: number | null): string` (German comma, ≤ 2 decimals, trailing zeros trimmed, null → `""`); `detectPlatform(url: string | null): Recipe["source_platform"]`; `countLabel(n: number, singular: string, plural: string): string` → `"1 Anpassung"` / `"3 Anpassungen"`.

- [ ] **Step 1: Write failing tests.**
  - `merge.test.ts`: no adjustments → all `original`, count 0; modify `{amount: 150}` on a 120 g item → status `modified`, amount 150, `original.amount` 120; remove → status `removed`; add → appended with status `added`, `original` null; two adds sorted by `created_at`; count = adjustments.length; modify + remove on same item → `removed` with modified values and 2 ids.
  - `format.test.ts`: `scaleAmount(200, 2, 4) === 400`; `scaleAmount(null, 2, 4) === null`; `formatAmount(1.5) === "1,5"`; `formatAmount(1/3) === "0,33"`; `formatAmount(2) === "2"`; `formatAmount(null) === ""`; `detectPlatform("https://www.instagram.com/p/x") === "instagram"`; `youtu.be` and `m.youtube.com` → `"youtube"`; other → `"web"`; null → null; `countLabel(1, "Anpassung", "Anpassungen") === "1 Anpassung"`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Write `migrations/0001_init.sql`: tables `recipes` (with `user_id TEXT NOT NULL`, `total_minutes INTEGER`, `tags TEXT NOT NULL DEFAULT '[]'`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`), `ingredients`, `steps`, `adjustments` (`new_values TEXT` JSON), `notes` (`recipe_id` PK). All child FKs `REFERENCES recipes(id) ON DELETE CASCADE`. CHECK constraints on `target_type`/`action`. Indexes: `recipes(user_id)`, `ingredients(recipe_id)`, `steps(recipe_id)`, `adjustments(recipe_id)`. Implement the three shared modules.
- [ ] **Step 4:** `npm test` → PASS. `npm run db:migrate:local` → applies cleanly.
- [ ] **Step 5: Commit** `feat: add schema, shared types and merge logic`.

### Task 3: Auth, CSRF and security headers

**Files:**
- Create: `worker/auth.ts`, `test/auth.test.ts`, `test/helpers.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: `buildApp`, `Env` (Task 1).
- Produces: `accessAuth(getJwks)` Hono middleware → sets `c.var.userId` (lower-cased `email` claim) after `jwtVerify(token, jwks, { issuer: env.TEAM_DOMAIN, audience: env.POLICY_AUD })` on header `Cf-Access-Jwt-Assertion`; else `401 { error: "Nicht angemeldet" }`. Dev bypass: if `env.DEV_USER_EMAIL` is set **and** request hostname is `localhost` or `127.0.0.1`, use it. `sameOrigin` middleware: non-GET/HEAD requests require `Origin` header equal to the request URL's origin, else `403`. `securityHeaders` middleware on `/api/*`: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- Produces (`test/helpers.ts`): `testApp()` returns the app built with a local JWKS from a jose-generated RS256 keypair; `authHeaders(email: string): HeadersInit` returns a signed token header plus a same-origin `Origin`; `TEST_ORIGIN`.

- [ ] **Step 1: Write failing tests** (`auth.test.ts`, with a dummy `GET /api/me` → `{ userId }` added in `buildApp`): no token → 401; token signed by a different key → 401; wrong audience → 401; expired → 401; valid token for `Alice@Example.com` → 200 `{ userId: "alice@example.com" }`; `DEV_USER_EMAIL` set but host `cooked.example.workers.dev` → 401; POST with `Origin: https://evil.example` → 403; `/api/health` without token → 200.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `worker/auth.ts`; mount in `buildApp` order: securityHeaders, health, sameOrigin, accessAuth, routes. Keep `GET /api/me` as a real route.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: verify cloudflare access jwt and enforce same-origin writes`.

### Task 4: Recipes API

**Files:**
- Create: `worker/recipes.ts`, `test/recipes.test.ts`
- Modify: `worker/index.ts` (mount routes)

**Interfaces:**
- Consumes: schemas (Task 2), `userId` (Task 3), `detectPlatform`.
- Produces:
  - `GET /api/recipes` → `RecipeSummary[]`, newest first (`ingredient_names` = original names + names from `add` adjustments).
  - `POST /api/recipes` body `NewRecipe` → `201 { id }`; one `env.DB.batch([...])` inserting recipe, ingredients and steps with `position` = array index; `source_platform` from `detectPlatform(source_url)`.
  - `GET /api/recipes/:id` → `RecipeFull` (adjustments with parsed `new_values`, note `""` if none).
  - `PATCH /api/recipes/:id` body `{ tags: string[] }` → `204` (trimmed, deduplicated, case-insensitive).
  - `DELETE /api/recipes/:id` → `204`.
  - Invalid body → `400 { error: string }` (German message, no zod internals).

- [ ] **Step 1: Write failing tests:** create + get round-trips all fields incl. `amount: null`; list shows `adjustment_count: 0` and `ingredient_names`; Bob GET/PATCH/DELETE on Alice's recipe → 404 and Alice's recipe unchanged; `source_url: "javascript:alert(1)"` → 400; `http://` image URL → 400; 101 ingredients → 400; delete cascades (ingredients/steps rows gone); tags `[" Pasta", "pasta", "Schnell"]` → stored `["Pasta", "Schnell"]`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with prepared statements only (`.bind()`), every statement includes `user_id = ?` or joins through it.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: add recipes api`.

### Task 5: Adjustments + notes API

**Files:**
- Modify: `worker/recipes.ts`
- Create: `test/adjustments.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/recipes/:id/adjustments` body `AdjustmentInput` → `201 Adjustment`, or `204` when a modify equals the original (existing modify deleted). `modify` upserts: at most one modify per `target_id` (merge new keys into the existing row's `new_values`). `remove` is idempotent (one per target). `target_id` must exist in `ingredients`/`steps` (per `target_type`) **of this recipe**, else 404.
  - `PATCH /api/recipes/:id/adjustments/:adjId` body `{ new_values }` → `200 Adjustment`; only for `add` rows (others → 400).
  - `DELETE /api/recipes/:id/adjustments/:adjId` → `204` (this is "zurücksetzen" / "wiederherstellen" / deleting an added item).
  - `PUT /api/recipes/:id/note` body `{ text: string }` → `204` (upsert; empty text deletes row).

- [ ] **Step 1: Write failing tests:** modify amount 120→150 then GET shows 1 adjustment; second modify on same target `{unit: "ml"}` → still 1 adjustment containing both keys; modify back to all-original values → 204 and 0 adjustments (Review Focus 3); `target_id` of an ingredient from another recipe of the same user → 404 (Review Focus 2); Bob posting to Alice's recipe → 404; `target_type: "step"` with an ingredient id → 404; remove twice → 1 row; PATCH a modify row → 400; delete adjustment → original shows again; original `ingredients` rows unchanged after all of the above (compare snapshot); note upsert + empty clears.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. "Equals original" = every key of the merged `new_values` equals the original row's value.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: add adjustments and notes api`.

### Task 6: AI parse endpoint

**Files:**
- Create: `worker/parse.ts`, `test/parse.test.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: `ParsedRecipe` schema, `env.AI`, `env.PARSE_LIMIT`.
- Produces: `POST /api/parse` body `{ text: string }` (1–10 000 chars) → `200 ParsedRecipe`. `parseRecipeText(ai: Ai, text: string): Promise<ParsedRecipe>` exported for tests.

- [ ] **Step 1: Write failing tests** (fake `ai.run` returning canned values): valid response object → returns it; response as JSON string → parsed; output failing zod (e.g. servings 0, missing steps) → throws → endpoint `502 { error: "Rezept konnte nicht erkannt werden. Bitte Text prüfen." }`; `ai.run` throws "JSON Mode couldn't be met" → same 502; amount `null` preserved (Review Focus 1); empty text → 400; 10 001 chars → 400; `PARSE_LIMIT.limit` returns `{ success: false }` → 429 `{ error: "Zu viele Anfragen, bitte kurz warten." }`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: `ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages, response_format: { type: "json_schema", json_schema: z.toJSONSchema(ParsedRecipe) } })`. Rate-limit key = `userId`. System prompt (German recipe extractor) must say: output German; amounts as numbers (convert "½" → 0.5, ranges → lower bound); `amount: null` when absent ("nach Geschmack", "etwas"); units short (g, ml, EL, TL, Stk, Prise); split instructions into steps; `duration_minutes` only when stated; `total_minutes` sum if not stated, null if unknown; `servings` default 2 if unknown; never invent ingredients; no emojis. User text goes only in the `user` message.
- [ ] **Step 4:** Run → PASS. Manual check with `npm run dev` (needs `wrangler login`; AI runs remotely) using one real Instagram caption.
- [ ] **Step 5: Commit** `feat: parse pasted recipe text with workers ai`.

### Task 7: App shell, API client, Home screen

**Files:**
- Create: `src/api.ts`, `src/pages/Home.tsx`, `src/components/RecipeCard.tsx`, `test/api.test.ts`
- Modify: `src/App.tsx`, `src/main.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: API from Tasks 4–6, `countLabel`, schema types.
- Produces: `request<T>(path: string, init?: RequestInit): Promise<T>` — JSON in/out, `credentials: "same-origin"`; throws `ApiError { status: number; message: string }` (message from `{ error }` body) or `SessionExpiredError` when fetch rejects (TypeError), status is 401, or the response is not JSON. `api` object with one typed function per endpoint. Routes: `/` Home, `/neu` AddRecipe, `/rezept/:id` Detail, `/rezept/:id/kochen` CookMode. Global `<SessionExpired />` banner: "Sitzung abgelaufen" + button "Neu laden" (`location.reload()`).
- Home: client-side search over `title` + `ingredient_names` (case-insensitive, trimmed); chips "Alle", "Angepasst" (`adjustment_count > 0`), "Unter 30 Min" (`total_minutes !== null && < 30`), then one chip per distinct tag (single-select); card shows image or placeholder, title, "{n} Min", "{n} Portionen", platform label "Instagram"/"YouTube"/"Web", orange badge `countLabel(n, "Anpassung", "Anpassungen")` when n > 0; sticky bottom button "Rezept hinzufügen" → `/neu`. Empty state: "Noch keine Rezepte".

- [ ] **Step 1: Write failing tests** `api.test.ts` (stub `globalThis.fetch`): 200 JSON → data; 400 `{error:"x"}` → `ApiError` with message "x"; fetch rejects → `SessionExpiredError` (Review Focus 4); 200 `text/html` → `SessionExpiredError`; 401 → `SessionExpiredError`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `api.ts`, router, Home, card.
- [ ] **Step 4:** `npm test` → PASS. `npm run dev`, 375 px viewport: search + all chips filter correctly with 3 seeded recipes.
- [ ] **Step 5: Commit** `feat: add home screen with search and filters`.

### Task 8: Add-recipe screen

**Files:**
- Create: `src/pages/AddRecipe.tsx`

**Interfaces:**
- Consumes: `api.parse`, `api.createRecipe`, `formatAmount`, `detectPlatform`.
- Produces: screen with segmented toggle "Link einfügen" (disabled, "Kommt bald") / "Text einfügen"; textarea; optional fields "Quelle (Link)" and "Bild-URL"; button "Rezept erkennen" (spinner, disabled while pending). After parse: preview card "Rezept erkannt" with title, "{n} Zutaten · {n} Schritte · {n} Min", platform label, the ingredient + step lists, hint "Bitte kurz prüfen, Mengen aus dem Video können fehlen", button "Ins Kochbuch speichern" → navigate to `/rezept/:id`. API errors shown inline in German.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify in `npm run dev`: paste caption → preview → save → lands on detail; parse error shows message; invalid URL in "Quelle" shows the 400 message.
- [ ] **Step 3: Commit** `feat: add text import screen`.

### Task 9: Recipe detail with adjustments

**Files:**
- Create: `src/pages/RecipeDetail.tsx`, `src/components/ItemRow.tsx`, `src/components/EditSheet.tsx`

**Interfaces:**
- Consumes: `api.getRecipe`, adjustment/note/tag endpoints, `mergeRecipe`, `scaleAmount`, `formatAmount`, `countLabel`.
- Produces: `ItemRow` props `{ item: Merged<Ingredient> | Merged<Step>; kind: "ingredient" | "step"; scale: (n: number | null) => number | null; showOriginal: boolean; onEdit(); onRemove(); onRestore(); onReset() }`. `EditSheet` = native `<dialog>` with fields per kind (Menge `inputmode="decimal"` accepting comma, Einheit, Name / Text, Dauer in Min).
- Behaviour:
  - Header image (or placeholder), button "Original" → `source_url` in new tab (`rel="noopener noreferrer"`), hidden when null.
  - Servings stepper −/+ (min 1, max 100), local state, base = `recipe.servings`; scales all displayed amounts.
  - Banner when count > 0: `countLabel(n, "eigene Anpassung", "eigene Anpassungen")` + toggle "Original zeigen"/"Anpassungen zeigen"; while showing the original, render raw `ingredients`/`steps`, no orange, editing disabled.
  - Tabs "Zutaten" | "Schritte".
  - Modified: orange bg + "Geändert · Original {formatted original}" (e.g. "Original 120 g", for steps "Original 6 Min" or "Original-Text") + "Zurücksetzen" (deletes all its adjustments). Added: orange + "Von dir hinzugefügt" + delete. Removed: strikethrough + "Wiederherstellen" (deletes the remove adjustment). Original: pencil + remove.
  - Buttons "Zutat hinzufügen", "Schritt hinzufügen" open `EditSheet` empty → `add`.
  - Editing an added item → PATCH; editing original/modified → POST modify with only the changed keys.
  - Tags row: chips + small input to add, × to remove (PATCH).
  - "Notiz für mich" textarea, saves on blur (PUT).
  - Sticky "Kochen starten" → `/rezept/:id/kochen`.
  - After each mutation refetch `getRecipe` (simple; ponytail: no optimistic updates).

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify in `npm run dev`: edit 120 g → 150 g shows orange "Geändert · Original 120 g", banner "1 eigene Anpassung"; servings 2→4 shows 300 g; edit back to 120 g → orange gone; remove + restore; add ingredient; "Original zeigen" shows untouched values; note persists after reload; all targets ≥ 44 px.
- [ ] **Step 3: Commit** `feat: add recipe detail with personal adjustments`.

### Task 10: Cooking mode

**Files:**
- Create: `src/pages/CookMode.tsx`, `src/lib/timer.ts`, `src/lib/wakeLock.ts`, `test/timer.test.ts`

**Interfaces:**
- Consumes: `mergeRecipe` (skip `removed` steps), `api.getRecipe`.
- Produces: `remainingSeconds(endAt: number, now: number): number` (≥ 0, ceil); `formatClock(seconds: number): string` → `"8:00"`, `"0:05"`; `durationDiffLabel(original: number | null, current: number | null): string | null` → `"+2 Min"` / `"−1 Min"` / null when equal or either null. `useWakeLock(active: boolean)` hook: `navigator.wakeLock.request("screen")`, re-request on `visibilitychange` → visible, release on unmount; silently no-op when unsupported.
- Screen: full-viewport `--primary` background, white large text (step ≥ 1.5rem), progress bar + "Schritt {i} von {n}"; when step status `modified` or `added`: hint "Deine Anpassung: {durationDiffLabel}" (or "Deine Anpassung" for text-only changes / added steps); timer when duration set: start/pause/reset, label "Original {o} Min · bei dir {c} Min" when they differ, else "{c} Min"; on reaching 0 → `navigator.vibrate?.(500)` + visible "Fertig". Buttons "Zurück" / "Weiter" (last step: "Fertig" → back to detail). Close button top-left.

- [ ] **Step 1: Write failing tests:** `remainingSeconds(now + 8*60_000, now) === 480`; after end → 0; `remainingSeconds(now + 1500, now) === 2`; `formatClock(480) === "8:00"`; `formatClock(5) === "0:05"`; `durationDiffLabel(6, 8) === "+2 Min"`; `durationDiffLabel(6, 6) === null`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Timer stores `endAt = Date.now() + seconds*1000`; a 1 s interval only re-renders (Review Focus 5).
- [ ] **Step 4:** `npm test` → PASS; manual: start timer, lock phone 30 s, unlock → time still correct; screen stays on.
- [ ] **Step 5: Commit** `feat: add cooking mode with timer and wake lock`.

### Task 11: PWA, headers, deploy docs

**Files:**
- Create: `public/manifest.webmanifest`, `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`, `public/_headers`, `README.md`
- Modify: `index.html`, `CLAUDE.md`

**Interfaces:**
- Manifest: `name "Mein Kochbuch"`, `short_name "Kochbuch"`, `lang "de"`, `start_url "/"`, `display "standalone"`, `background_color "#FAFAF7"`, `theme_color "#1F4D3A"`, icons 192/512 (`purpose "any maskable"`) + svg.
- `index.html`: `<html lang="de">`, `<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">` (Access cookie must be sent), `theme-color`, `apple-touch-icon` → 192 png, `apple-mobile-web-app-capable`, viewport with `viewport-fit=cover`.
- `_headers` for `/*`: `Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

- [ ] **Step 1:** Icon: simple SVG (white pot/spoon line glyph on `#1F4D3A` rounded square, no emoji). Rasterize to 192/512 PNG with any available tool (e.g. `npx --yes sharp-cli`), commit the PNGs.
- [ ] **Step 2:** README: prerequisites; `npx wrangler d1 create cooked` → put id in `wrangler.jsonc`; `npm run db:migrate:remote`; `npm run deploy`; Dashboard → Worker → Settings → Domains & Routes → enable Cloudflare Access on `workers.dev`; Access policy: allow listed emails, login method One-time PIN, session duration 1 month; copy AUD tag + team domain into `vars` and redeploy; adding a friend = add their email to the policy.
- [ ] **Step 3:** Verify: `npm run build && npx wrangler dev` → DevTools Application tab shows valid manifest, no CSP violations in console, fonts load locally.
- [ ] **Step 4:** Update `CLAUDE.md` working notes with the deviations section above and any learnings from execution.
- [ ] **Step 5: Commit** `feat: make app installable and harden headers`.
- [ ] **Step 6:** Run `/security-review` on the branch, fix findings, then finish the branch (superpowers:finishing-a-development-branch).
