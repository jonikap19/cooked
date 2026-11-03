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
3. Image storage (once): `npx wrangler r2 bucket create cooked-images`, then expire unsaved link-import images after a day: `npx wrangler r2 bucket lifecycle add cooked-images delete-tmp tmp/ --expire-days 1` (or Dashboard -> R2 -> cooked-images -> Settings -> Object lifecycle rules -> prefix `tmp/`, delete after 1 day).
4. `npm run deploy`
5. Dashboard -> Workers -> cooked -> Settings -> Domains & Routes -> enable Cloudflare Access on the `workers.dev` hostname. Do the same for any custom domain: the Worker rejects API calls without a valid Access JWT, but the static pages are public unless Access covers every hostname.
6. The enable dialog only offers "Cloudflare account" or "Email domain": pick "Cloudflare account". Then in Zero Trust -> Access controls -> Policies, edit `cooked - Production`: add an Include rule with selector **Emails** listing every allowed address, and remove the "Cloudflare account" rule. Login method One-time PIN (Zero Trust -> Settings -> Authentication), session duration 1 month on the application.
7. Copy the application's AUD tag and your team domain (`https://<team>.cloudflareaccess.com`; it's also the host an unauthenticated visit redirects to) into `POLICY_AUD` and `TEAM_DOMAIN` under `vars` in `wrangler.jsonc` (replace the placeholders), then `npm run deploy` again.

## Adding a friend

Add their email to the `cooked - Production` Access policy (Emails selector). No code change, no redeploy.

## Install on a phone

Open the site, then "Add to Home Screen" (iOS Safari) or "Install app" (Android Chrome).
