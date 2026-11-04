# cooked

Self-hosted web app for the owner and a few friends.

Follow @rules.md for every change.

## Working notes

Claude's log of important learnings and decisions. Newest first. Keep entries short: date, what, why.

### Decisions

- 2026-11-04 — Spec deviation: renaming a Vorrat item is a plain edit and does not teach the matcher (no alias). Why: a Vorrat row has no source spelling; aliasing its old name would rewrite every recipe ingredient spelled that way. Corrections from the shopping list will teach it.
- 2026-11-04 — Spec deviation: a typed Vorrat item keeps the unit it was typed in (after kg→g etc.); the matcher supplies only the name. Why: amounts never cross units.
- 2026-11-04 — Spec deviation: ingredient notes are not shown in cooking mode. Why: CookMode has no ingredient list; add them with one later.
- 2026-11-03 — Spec deviation: `recipes` has extra `total_minutes` and `tags` (JSON text). Why: cards/preview/"Unter 30 Min" and tag chips need them.
- 2026-11-03 — Spec deviation: `adjustments.updated_at`. Why: "Zuletzt geändert am …" after a modify upsert.
- 2026-11-03 — Spec deviation: `source_platform` is picked by the user (chips), preselected via `detectPlatform`. Why: matches design.
- 2026-11-03 — Spec deviation: `user_id` = lower-cased email from the Access JWT, no users table. Why: simplest for a few friends.
- 2026-11-03 — Spec deviation: no service worker; manifest alone makes it installable, offline is out of scope. Why: YAGNI.
- 2026-11-03 — Spec deviation: `image_url` is a `/api/images/<id>` handle (R2) set by link import, null otherwise; null shows the "Rezeptbild" placeholder. Why: link import brings an image, text import has none.
- 2026-11-03 — Spec deviation: remove/reset of a single item lives in the edit sheet. Why: designs show only the pencil per row.
- 2026-11-03 — Spec deviation: added "delete recipe" at the bottom of the detail screen. Why: needed to clean up bad imports.

- 2026-11-03 — Git identity set repo-locally to `jonikap19 <180111101+jonikap19@users.noreply.github.com>`. Why: owner wants only the noreply mail in commits.
- 2026-11-03 — This file (CLAUDE.md) is the working doc because it auto-loads each session; rules live in `rules.md`.

### Learnings

- 2026-11-03 — `adjustments.insert_after` places added items after an original, ordered by `created_at, rowid` (ids are random UUIDs). Why: UUIDs give no stable order.
- 2026-11-03 — The `cooked-images` R2 bucket must exist before deploy; `wrangler deploy` fails otherwise. Why: the Worker binds it.
- 2026-11-03 — Tmp import images live in R2 `tmp/<uuid>` with `customMetadata.owner`, moved to `<recipeId>` on save. Why: the recipe id does not exist yet at import time.
- 2026-11-03 — YouTube description is read from the page HTML `shortDescription`, no API key (upgrade path: Data API v3). Why: simplest, no secret.
- 2026-11-03 — Instagram link import is unsupported, falls back to the text tab. Why: the Worker gets a JS shell with no caption.
- 2026-11-03 — Access email login: new Zero Trust accounts default to the Cloudflare IdP; One-time PIN must be added under Integrations → Identity providers and enabled on the app. The Worker quick-enable dialog has no per-email option — edit the `cooked - Production` policy (Emails selector). PINs are only sent to addresses the policy allows. Why: first login failed without OTP.
- 2026-11-03 — Deploys are manual (owner runs `npm run deploy` from `main`, migrations first); the auto-deploy pipeline is deferred by the owner. Why: owner wants to read up first.

- 2026-11-03 — `@cloudflare/vitest-pool-workers` was renamed `@cloudflare/vitest-plugin`. Why: old package is stale.
- 2026-11-03 — Static Assets Workers don't get `ctx.access`; verify the Access JWT ourselves with jose. Why: `ctx.access` is not provided there.
- 2026-11-03 — D1 timestamps are stored as ISO UTC via `strftime`. Why: `CURRENT_TIMESTAMP` has no timezone marker.
- 2026-11-03 — zod schemas use strict partial unions for adjustment values. Why: plain partials stripped step values.
- 2026-11-03 — `public/_headers` only applies to static asset responses, not Worker-served `/api/*`; the API sets its own headers. Why: Static Assets behaviour.
