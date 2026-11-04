import { Hono } from "hono";
import { recipes } from "./recipes";
import { parse } from "./parse";
import { notes } from "./notes";
import { split } from "./split";
import { importLink } from "./import";
import { match } from "./match";
import { pantry } from "./pantry";
import { list } from "./list";
import { accessAuth, sameOrigin, securityHeaders, type AppEnv } from "./auth";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

export type Env = {
  DB: D1Database;
  AI: Ai;
  IMAGES: R2Bucket;
  PARSE_LIMIT: RateLimit;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  DEV_USER_EMAIL?: string;
};

export function buildApp(getJwks: (env: Env) => JWTVerifyGetKey) {
  const app = new Hono<AppEnv>();

  app.use("/api/*", securityHeaders);
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Etwas ist schiefgelaufen. Bitte versuche es erneut." }, 500);
  });
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.use("/api/*", sameOrigin);
  app.use("/api/*", accessAuth(getJwks));
  // all routes below are authenticated
  app.get("/api/me", (c) => c.json({ userId: c.var.userId }));
  app.route("/", recipes);
  app.route("/", parse);
  app.route("/", split);
  app.route("/", notes);
  app.route("/", importLink);
  app.route("/", match);
  app.route("/", pantry);
  app.route("/", list);

  return app;
}

// Cached per isolate: the remote JWKS fetches and caches Access' signing keys itself.
let jwks: JWTVerifyGetKey | undefined;
const getRemoteJwks = (env: Env) =>
  (jwks ??= createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)));

export default { fetch: buildApp(getRemoteJwks).fetch };
