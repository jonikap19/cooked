import { Hono } from "hono";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

export type Env = {
  DB: D1Database;
  AI: Ai;
  PARSE_LIMIT: RateLimit;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  DEV_USER_EMAIL?: string;
};

export function buildApp(getJwks: (env: Env) => JWTVerifyGetKey) {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

  app.get("/api/health", (c) => c.json({ ok: true }));

  return app;
}

// Cached per isolate: the remote JWKS fetches and caches Access' signing keys itself.
let jwks: JWTVerifyGetKey | undefined;
const getRemoteJwks = (env: Env) =>
  (jwks ??= createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)));

export default { fetch: buildApp(getRemoteJwks).fetch };
