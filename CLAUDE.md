# cooked

Self-hosted web app for the owner and a few friends.

Follow @rules.md for every change.

## Working notes

Claude's log of important learnings and decisions. Newest first. Keep entries short: date, what, why.

### Decisions

- 2026-11-03 — Spec deviation: `recipes` has extra `total_minutes` and `tags` (JSON text). Why: cards/preview/"Unter 30 Min" and tag chips need them.
- 2026-11-03 — Spec deviation: `adjustments.updated_at`. Why: "Zuletzt geändert am …" after a modify upsert.
- 2026-11-03 — Spec deviation: `source_platform` is picked by the user (chips), preselected via `detectPlatform`. Why: matches design.
- 2026-11-03 — Spec deviation: `user_id` = lower-cased email from the Access JWT, no users table. Why: simplest for a few friends.
- 2026-11-03 — Spec deviation: no service worker; manifest alone makes it installable, offline is out of scope. Why: YAGNI.
- 2026-11-03 — Spec deviation: `image_url` stays null, all images show the "Rezeptbild" placeholder. Why: text import has no image; link import comes later.
- 2026-11-03 — Spec deviation: remove/reset of a single item lives in the edit sheet. Why: designs show only the pencil per row.
- 2026-11-03 — Spec deviation: added "delete recipe" at the bottom of the detail screen. Why: needed to clean up bad imports.

- 2026-11-03 — Git identity set repo-locally to `jonikap19 <180111101+jonikap19@users.noreply.github.com>`. Why: owner wants only the noreply mail in commits.
- 2026-11-03 — This file (CLAUDE.md) is the working doc because it auto-loads each session; rules live in `rules.md`.

### Learnings

- 2026-11-03 — Access email login: new Zero Trust accounts default to the Cloudflare IdP; One-time PIN must be added under Integrations → Identity providers and enabled on the app. The Worker quick-enable dialog has no per-email option — edit the `cooked - Production` policy (Emails selector). PINs are only sent to addresses the policy allows. Why: first login failed without OTP.
- 2026-11-03 — Deploys are manual (owner runs `npm run deploy` from `main`, migrations first); the auto-deploy pipeline is deferred by the owner. Why: owner wants to read up first.

- 2026-11-03 — `@cloudflare/vitest-pool-workers` was renamed `@cloudflare/vitest-plugin`. Why: old package is stale.
- 2026-11-03 — Static Assets Workers don't get `ctx.access`; verify the Access JWT ourselves with jose. Why: `ctx.access` is not provided there.
- 2026-11-03 — D1 timestamps are stored as ISO UTC via `strftime`. Why: `CURRENT_TIMESTAMP` has no timezone marker.
- 2026-11-03 — zod schemas use strict partial unions for adjustment values. Why: plain partials stripped step values.
- 2026-11-03 — `public/_headers` only applies to static asset responses, not Worker-served `/api/*`; the API sets its own headers. Why: Static Assets behaviour.
