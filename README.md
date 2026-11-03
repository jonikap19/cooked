# cooked

Mobile-first cookbook PWA ("Mein Kochbuch"). One Cloudflare Worker serves the Vite/React SPA (Static Assets) and the Hono API under `/api/*`; data in D1, recipe parsing with Workers AI, login via Cloudflare Access.

## Prerequisites

- Node.js 20+, a Cloudflare account, and `npx wrangler login`.

## Local development

1. `npm install`
2. `cp .dev.vars.example .dev.vars` -- sets `DEV_USER_EMAIL`, the login bypass (works on localhost only).
3. `npm run db:migrate:local`
4. `npm run dev` -- needs `wrangler login` because the AI binding is remote (`ai.remote: true`).
5. `npm test`

After changing bindings in `wrangler.jsonc`, run `npm run types`.

## Deploy

1. `npx wrangler d1 create cooked`, then put the returned id into `database_id` in `wrangler.jsonc`.
2. `npm run db:migrate:remote`
3. `npm run deploy`
4. Dashboard -> Workers -> cooked -> Settings -> Domains & Routes -> enable Cloudflare Access on the `workers.dev` hostname. Do the same for any custom domain: the Worker rejects API calls without a valid Access JWT, but the static pages are public unless Access covers every hostname.
5. Access policy: Allow, include the listed emails; login method One-time PIN; session duration 1 month.
6. Copy the application's AUD tag and your team domain (`https://<team>.cloudflareaccess.com`) into `POLICY_AUD` and `TEAM_DOMAIN` under `vars` in `wrangler.jsonc` (replace the placeholders), then `npm run deploy` again.

## Adding a friend

Add their email to the Access policy. No code change, no redeploy.

## Install on a phone

Open the site, then "Add to Home Screen" (iOS Safari) or "Install app" (Android Chrome).
