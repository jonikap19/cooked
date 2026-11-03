# Next Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four follow-ups to the Kochbuch MVP: automatic deploys, better cooking-mode timers, finer-grained recipe steps, and import from Instagram/YouTube/web links.

**Architecture:** Same single Worker (Hono API + Static Assets SPA, D1, Workers AI, Access). Deploys move from the owner's laptop to a GitHub Actions job that runs after CI on `main`. Timers gain a text-based duration detector. Steps get split at import time (prompt) and on demand (new AI endpoint + positioned "add" adjustments). Link import adds a server-side fetch-and-extract layer in front of the existing `parseRecipeText`, plus R2 for recipe images.

**Tech Stack:** as in the MVP plan, plus `cloudflare/wrangler-action`, Cloudflare R2, Web Audio API.

**Spec:** `docs/spec.md` (MVP brief; "Link einfügen … bauen wir später") plus the owner's request of 2026-11-03, verbatim: *"1. timer in cooking mode for steps that take a certain amount of time 2. link import 3. splitting recipe steps into smaller pieces if possible 4. add deployment pipeline"*. Repo rules: `rules.md`. Designs: `screenshots/*.pdf` (local; summary in the MVP plan's Design Reference).

## Global Constraints

- Everything from the MVP plan's Global Constraints still applies (German UI strings, tokens, orange only for adjustments, ≥ 44 px, no emojis, user scoping → 404, originals insert-only, https-only URLs, input limits).
- Each phase is its own branch (`chore/deploy-pipeline`, `feat/step-timers`, `feat/step-splitting`, `feat/link-import`) and its own PR. Phases ship in the order below. A phase may start only after the previous PR is merged.
- Migrations are additive only (new tables/columns with defaults); never edit an applied migration. Next number: `0002_…`.
- Deploys happen only from `main` through the pipeline (Phase A). After Phase A, nobody runs `npm run deploy` by hand except in an emergency (README says so).
- Workers AI calls always pass `max_tokens` and validate output with zod; never log pasted text, fetched page content or URLs with query strings.
- Server-side fetches of user-supplied URLs (Phase D) go through one guarded function (see Task D2); nothing else in the Worker calls `fetch` with user input.
- New German strings, verbatim: "aus dem Text erkannt", "Schritt aufteilen", "Vorschlag übernehmen", "Abbrechen", "Wird aufgeteilt …", "Rezept laden", "Wird geladen …", "Link konnte nicht gelesen werden. Füge den Text der Beschreibung ein.", "Nicht unterstützter Link".

## Review Focus

1. **A deploy that runs migrations against the wrong database or deploys untested code.** Deploy must depend on the `test` job of the same commit and run `d1 migrations apply --remote` before `wrangler deploy`. Verified in Task A1 by the job graph and the first real run.
2. **Durations in German free text** ("ca. 10–12 Minuten", "1 Std.", "eine halbe Stunde", "30 Sek.", "über Nacht"): the detector must find the common forms, ignore temperatures ("180 Grad") and quantities, and return nothing for "über Nacht". Tests in Task B1.
3. **Split pieces land in the wrong place or survive a reset badly.** Added steps with `insert_after` must render directly after their anchor, in creation order, and deleting the anchor's remove adjustment must restore the original while keeping the pieces visibly "added". Tests in Task C2.
4. **SSRF / hostile pages in link import**: non-https, IP-literal hosts, `localhost`, redirects to any of those, huge or non-HTML responses, and slow servers must all be rejected with a German error, never a 500 or a hang. Tests in Task D2.
5. **Instagram/YouTube give us nothing usable** (login wall, consent page, missing caption): the user must land on the text tab with whatever caption we did get pre-filled and the message "Link konnte nicht gelesen werden. Füge den Text der Beschreibung ein." Test in Task D4.

## File Structure (new or changed)

```
.github/workflows/ci.yml        + deploy job (Phase A); guards removed
shared/duration.ts              detectDuration(text) (Phase B)
src/lib/alarm.ts                playAlarm() via Web Audio (Phase B)
src/pages/CookMode.tsx          detected-duration timers, alarm, running-timer chips (Phase B)
worker/parse.ts                 prompt rule for atomic steps; splitStepText() (Phase C)
worker/split.ts                 POST /api/split-step (Phase C)
migrations/0002_insert_after.sql  adjustments.insert_after (Phase C)
shared/schema.ts, shared/merge.ts  insert_after support (Phase C)
src/components/SplitSheet.tsx   preview + confirm split (Phase C)
worker/fetch-guard.ts           safeFetch(url) — the only user-URL fetch (Phase D)
worker/extract.ts               extractFromHtml(platform, html) → { text, imageUrl } (Phase D)
worker/import.ts                POST /api/import-link, GET /api/images/:id (Phase D)
migrations/0003_…               only if Phase D needs a column (image stays in recipes.image_url)
src/pages/AddRecipe.tsx         "Link einfügen" tab enabled (Phase D)
test/*.test.ts, test/fixtures/*.html
```

---

## Phase A — Deployment pipeline (`chore/deploy-pipeline`)

### Task A1: Deploy job after CI on `main`

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Produces: job `deploy` in `ci.yml`: `needs: test`, `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`, `environment: production`, `concurrency: { group: deploy-production, cancel-in-progress: false }`, `permissions: contents: read`. Steps: checkout, setup-node `lts/*` with npm cache, `npm ci`, `npx wrangler d1 migrations apply cooked --remote`, `npm run deploy`, smoke check. Env: `CLOUDFLARE_API_TOKEN` (repo secret), `CLOUDFLARE_ACCOUNT_ID` (repo variable).
- Smoke check (bash in the job): `curl -fsS https://cooked.test-joni.workers.dev/api/health` returns 200, and `curl -s -o /dev/null -w '%{http_code}' …/api/me` is `302` or `401` (Access or Worker rejects anonymous). Any other code fails the job.

- [ ] **Step 1:** Remove the `ponytail:` guards from the `test` job (main has `package-lock.json` now) and use plain `cache: npm`.
- [ ] **Step 2:** Add the `deploy` job as above. Pin `actions/checkout` and `actions/setup-node` to the same major versions as `test`.
- [ ] **Step 3:** README "Deploy" section: owner creates a Cloudflare API token (custom: Account → Workers Scripts: Edit, D1: Edit, Account Settings: Read; Zone: none), stores it as repo secret `CLOUDFLARE_API_TOKEN`, sets repo variable `CLOUDFLARE_ACCOUNT_ID`, creates GitHub environment `production` (optional required reviewer = owner). Manual `npm run deploy` only for emergencies.
- [ ] **Step 4:** CLAUDE.md working notes: the deploy rule (main → pipeline only; migrations additive) and the Access one-time PIN learning (new Zero Trust accounts default to the Cloudflare IdP; OTP must be added under Integrations → Identity providers; PINs are only sent to addresses the policy allows).
- [ ] **Step 5:** Verify: PR CI green (deploy job skipped on `pull_request`). After merge, the `main` run shows `test` → `deploy` and the smoke check passes. If the token is missing, the job must fail loudly at the wrangler step, not silently skip.
- [ ] **Step 6: Commit** `chore: deploy to cloudflare after ci on main`.

---

## Phase B — Cooking-mode timers (`feat/step-timers`)

### Task B1: German duration detector

**Files:**
- Create: `shared/duration.ts`, `test/duration.test.ts`

**Interfaces:**
- Produces: `detectDuration(text: string): number | null` → minutes (integer, ≥ 1), or null. Ranges take the lower bound (same rule as the AI prompt). Units: `Min`, `Min.`, `Minute(n)`, `Std`, `Std.`, `Stunde(n)`, `Sek`, `Sek.`, `Sekunde(n)` (seconds round up to whole minutes, minimum 1). Words: "eine halbe Stunde" → 30, "eine Stunde" → 60, "anderthalb Stunden"/"eineinhalb Stunden" → 90. Decimal comma ("1,5 Std.") supported. If several durations appear, return the first.

- [ ] **Step 1: Failing tests:** `"10 Minuten köcheln"` → 10; `"ca. 10–12 Min. backen"` → 10; `"10-12 Minuten"` → 10; `"1 Std. ruhen lassen"` → 60; `"1,5 Stunden schmoren"` → 90; `"eine halbe Stunde ziehen lassen"` → 30; `"30 Sek. anbraten"` → 1; `"bei 180 Grad backen"` → null; `"200 g Mehl"` → null; `"über Nacht marinieren"` → null; `"2 EL Öl erhitzen, dann 5 Minuten braten"` → 5; `""` → null.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with one regex for number+unit (ranges via `–|-|bis`) and a small word table. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: detect durations in german step text`.

### Task B2: Timers for detected durations, alarm, running-timer chips

**Files:**
- Create: `src/lib/alarm.ts`
- Modify: `src/pages/CookMode.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `detectDuration`, existing timer map in CookMode (`stepId → { endAt, remainingWhenPaused }`), `formatClock`, `remainingSeconds`.
- Produces: `playAlarm(): void` — three short beeps (Web Audio oscillator, ~880 Hz, 200 ms on / 150 ms off), lazily creating one `AudioContext` on the first user tap (iOS needs a gesture), no-op if unsupported.
- Behaviour:
  - Timer duration = `step.duration_minutes ?? detectDuration(step.text)`. When it came from the text, the label under the ring reads "{n} Min · aus dem Text erkannt" (muted), and the "Original … · bei dir …" comparison is not shown.
  - On reaching 0: existing vibrate + `playAlarm()` once per run (same de-dupe key as vibrate).
  - Replace the single "Timer Schritt n" line with a chip row of all timers running or finished on other steps: "Schritt {n} · {formatClock}" or "Schritt {n} · Fertig"; tap jumps to the step. Finished chips disappear when that timer is reset or restarted. (Fixes the deferred "finished timer vanishes" minor.)
  - The shared 1 s tick stops when no timer is running.
- [ ] **Step 1:** Implement. **Step 2:** `npm test`, `npm run build` clean. **Step 3:** Manual on a phone: a step "5 Minuten braten" without `duration_minutes` shows a 5:00 timer with the hint; starting two timers on different steps shows both chips; at 0 the phone vibrates and beeps once.
- [ ] **Step 4: Commit** `feat: timers from step text, alarm sound and timer chips`.

---

## Phase C — Smaller recipe steps (`feat/step-splitting`)

### Task C1: Atomic steps at import

**Files:**
- Modify: `worker/parse.ts`, `test/parse.test.ts`

**Interfaces:**
- Produces: the system prompt's step rule becomes: one action per step (at most two short sentences); split compound instructions at "dann", "danach", "anschließend", "inzwischen", ";"; keep a duration with the action it belongs to; never merge steps; keep the original order and wording as far as possible.
- [ ] **Step 1: Failing test:** the prompt sent to `ai.run` contains the phrase "Ein Arbeitsschritt pro Schritt" (fixed wording, so the rule can't silently disappear).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Update the prompt. **Step 4:** Run → PASS.
- [ ] **Step 5:** Manual check after deploy with the Gnocchi caption from the design PDF: "Butter schmelzen, Salbei + Knoblauch ca. 6 Min braten bis es nussig riecht, Gnocchi rein…" must yield ≥ 3 steps, and the "6 Min" step keeps `duration_minutes: 6`.
- [ ] **Step 6: Commit** `feat: ask the model for one action per step`.

### Task C2: Positioned "add" adjustments (`insert_after`)

**Files:**
- Create: `migrations/0002_insert_after.sql`
- Modify: `shared/schema.ts`, `shared/merge.ts`, `worker/recipes.ts`, `test/merge.test.ts`, `test/adjustments.test.ts`

**Interfaces:**
- Migration: `ALTER TABLE adjustments ADD COLUMN insert_after TEXT;` (nullable; null = append at end, as today).
- `AdjustmentInput` add variants gain optional `insert_after: string | null` (id of an **original** row of the same `target_type` in the same recipe). `Adjustment` gains `insert_after: string | null`.
- Server: on add with `insert_after`, verify the anchor exists in the right table for this recipe, else 404 (same rule as `target_id`).
- `mergeItems`: added items with `insert_after` are placed directly after their anchor (whether the anchor is original, modified or removed), multiple pieces on one anchor in `created_at, id` order; added items without `insert_after` stay at the end. Step numbering in the UI already skips removed rows, so a split step reads as consecutive numbers.

- [ ] **Step 1: Failing tests:** merge: anchor A, B; add X after A, add Y after A (later), add Z (no anchor) → order A, X, Y, B, Z; anchor removed → A(removed), X, Y, B. API: `insert_after` of another recipe's step → 404; ingredient id used as `insert_after` for a step → 404; omitted `insert_after` behaves exactly as before.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement migration, schema, server check, merge. **Step 4:** Run → PASS (full suite).
- [ ] **Step 5: Commit** `feat: insert added items after a chosen original`.

### Task C3: "Schritt aufteilen" on existing recipes

**Files:**
- Create: `worker/split.ts`, `src/components/SplitSheet.tsx`, `test/split.test.ts`
- Modify: `worker/index.ts`, `src/api.ts`, `src/components/EditSheet.tsx`, `src/pages/RecipeDetail.tsx`

**Interfaces:**
- `POST /api/split-step` body `{ text: string }` (1–2 000 chars) → `200 { steps: StepValues[] }` (2–6 items), 422 `{ error: "Dieser Schritt lässt sich nicht weiter aufteilen." }` when the model returns fewer than 2, 502/429 like `/api/parse` (reuse `PARSE_LIMIT`, `max_tokens`, zod). `splitStepText(ai, text): Promise<StepValues[]>` exported for tests.
- UI: EditSheet for a step (original or modified, not removed/added) gets a secondary action "Schritt aufteilen" → `SplitSheet` shows the proposed pieces (text + duration), buttons "Vorschlag übernehmen" / "Abbrechen". Accepting sends: one `remove` for the step, then one `add` per piece with `insert_after = step.id`, sequentially (keeps `created_at` order), then refetch. While pending: "Wird aufgeteilt …", buttons disabled.
- [ ] **Step 1: Failing tests** (`split.test.ts`, fake AI): valid 3 pieces → 200 with 3 steps; 1 piece → 422 with the message; invalid output → 502; text > 2 000 → 400; rate limited → 429; prompt sent contains the step text only in the user message.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement endpoint + UI. **Step 4:** `npm test`, `npm run build` clean.
- [ ] **Step 5:** Manual: split a long step on the phone → original struck through ("Von dir entfernt"), pieces orange "Von dir hinzugefügt" right below it, cooking mode walks through the pieces; "Wiederherstellen" on the original brings it back.
- [ ] **Step 6: Commit** `feat: split a step into smaller steps with ai`.

---

## Phase D — Link import (`feat/link-import`)

### Task D1: Spike — what can a Worker actually read?

**Files:**
- Create: `docs/link-import-findings.md`

- [ ] **Step 1:** From a temporary Worker route (behind Access, removed before the PR) or `wrangler dev --remote`, fetch one real public post each from Instagram, YouTube (watch URL and Shorts URL) and two recipe websites (one with schema.org JSON-LD, one without). Record for each: status, whether a login/consent wall appears, where the caption/description lives (`og:description`, `<meta name="description">`, embedded JSON such as `ytInitialPlayerResponse.videoDetails.shortDescription`, JSON-LD `@type: Recipe`), and whether `og:image` is present and how long its URL stays valid.
- [ ] **Step 2:** Decide per platform and write it down: (a) HTML extraction, (b) official API (YouTube Data API v3 `videos.list?part=snippet` with an API key as Worker secret `YOUTUBE_API_KEY`), (c) not supported → text-tab fallback. Instagram is expected to be (c) or partial (truncated `og:description`); that is acceptable.
- [ ] **Step 3:** If an option needs a paid product (e.g. Browser Rendering beyond the free tier) or a new secret, stop and ask the owner before Task D3.
- [ ] **Step 4: Commit** `docs: link import findings`.

### Task D2: Guarded fetch

**Files:**
- Create: `worker/fetch-guard.ts`, `test/fetch-guard.test.ts`

**Interfaces:**
- Produces: `safeFetch(url: string, opts?: { maxBytes?: number; accept?: "html" | "image" }): Promise<{ finalUrl: string; contentType: string; body: ArrayBuffer }>`; throws `FetchRejected { reason: "scheme" | "host" | "redirect" | "size" | "type" | "timeout" | "status" }`.
- Rules: `https:` only; host must be a DNS name (no IPv4/IPv6 literals, no `localhost`, no `.local`/`.internal`, no single-label hosts); `redirect: "manual"` with at most 3 hops, each hop re-validated; 10 s total timeout via `AbortSignal.timeout`; default `maxBytes` 2 MB for HTML, 5 MB for images, enforced while streaming; content type must start with `text/html` (html) or `image/` (image); a generic browser-like `User-Agent` and `Accept-Language: de-DE` (no email or personal data in headers).
- [ ] **Step 1: Failing tests** (stub `globalThis.fetch`): http URL → `scheme`; `https://127.0.0.1/` and `https://[::1]/` → `host`; `https://localhost/` → `host`; 302 to `https://10.0.0.1/` → `host`; 4 redirects → `redirect`; 3 MB HTML → `size`; `application/pdf` → `type`; a fetch that never resolves → `timeout` (use fake timers or a short test timeout option); 404 → `status`; happy path returns body and final URL.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: guarded fetch for user-supplied links`.

### Task D3: Extractors + import endpoint + images

**Files:**
- Create: `worker/extract.ts`, `worker/import.ts`, `test/extract.test.ts`, `test/import.test.ts`, `test/fixtures/*.html` (small hand-trimmed pages, no personal data)
- Modify: `worker/index.ts`, `wrangler.jsonc` (R2 binding `IMAGES`, bucket `cooked-images`), `worker-configuration.d.ts` (`npm run types`), `README.md`

**Interfaces:**
- `extractFromHtml(platform: "instagram" | "youtube" | "web", html: string): { text: string | null; imageUrl: string | null }` — per D1 findings. For `web`, prefer JSON-LD `Recipe` (name, recipeYield, totalTime ISO-8601, recipeIngredient[], recipeInstructions[] incl. `HowToStep`/`HowToSection`) rendered as plain text; else `og:description` / main text fallback (strip tags, collapse whitespace, cap 10 000 chars).
- `POST /api/import-link` body `{ url: string }` → `200 { recipe: ParsedRecipe; source_url: string; source_platform; image_url: string | null; caption: string | null }`, or `422 { error: "Link konnte nicht gelesen werden. Füge den Text der Beschreibung ein.", caption: string | null }` when no usable text, `400 { error: "Nicht unterstützter Link" }` on `FetchRejected` for scheme/host, `502` on AI failure, `429` via `PARSE_LIMIT`. Text goes through the existing `parseRecipeText`.
- Images: the endpoint fetches `imageUrl` via `safeFetch(…, { accept: "image" })` and returns it as a data-free handle: store the bytes in R2 under a random key `tmp/<uuid>` and return `image_url: "/api/images/tmp/<uuid>"`. On `POST /api/recipes` with that `image_url`, the server moves (copy + delete) it to `<recipeId>` and stores `/api/images/<recipeId>` in `recipes.image_url`. `NewRecipe.image_url` accepts only `/api/images/tmp/<uuid>` or null. `GET /api/images/:id` serves the object only if the recipe with that id belongs to the caller (404 otherwise), `Cache-Control: private, max-age=86400`. Deleting a recipe deletes its image. Orphaned `tmp/` objects: R2 lifecycle rule deleting `tmp/` after 1 day (README step).
- [ ] **Step 1: Failing tests:** extractor per fixture (Instagram og:description, YouTube description, JSON-LD recipe with `HowToSection`, plain page); endpoint with stubbed fetch + fake AI: happy path; no text → 422 with caption; IP host → 400; image moved on save and served only to its owner (Bob → 404); recipe delete removes the R2 object.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm run build` clean.
- [ ] **Step 5: Commit** `feat: import recipes from links with images`.

### Task D4: "Link einfügen" tab + images in the UI

**Files:**
- Modify: `src/pages/AddRecipe.tsx`, `src/api.ts`, `src/components/RecipeCard.tsx`, `src/pages/RecipeDetail.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `api.importLink(url)` → the D3 response; `ApiError` for 400/422/502/429 (422 body's `caption` must reach the UI — extend `ApiError` with an optional `data` field).
- Behaviour: remove the "Bald" pill and enable the tab. Link tab: URL field + sticky button "Rezept laden" ("Wird geladen …" while pending) → same preview card as text import, with the image on top when present, and the Quelle chip preselected from the response. On 422: switch to "Text einfügen", prefill the textarea with `caption` (if any), show the message. Saving sends `image_url` through. Home cards and the detail hero show `<img src={image_url} alt="">` (object-fit cover, same size as the placeholder) when present, else the existing placeholder.
- [ ] **Step 1: Failing test** (`test/api.test.ts`): a 422 JSON body with `caption` yields an `ApiError` whose `data.caption` equals it.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test`, `npm run build` clean.
- [ ] **Step 5:** Manual on the phone: one Instagram, one YouTube, one recipe-website link; each either imports with an image or falls back to the text tab with the caption pre-filled (Review Focus 5).
- [ ] **Step 6: Commit** `feat: enable link import in the add screen`.

---

## Out of scope (ask before adding)

Sharing recipes between friends, shopping list, offline mode, image upload from the phone, TikTok, re-importing an already imported link.
