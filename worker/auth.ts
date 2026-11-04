import { createMiddleware } from "hono/factory";
import { jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "./index";

export type AppEnv = { Bindings: Env; Variables: { userId: string } };

const unauthenticated = { error: "Nicht angemeldet" };

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  // Image routes set their own private caching; everything else is never cached.
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
});

// CSRF: writes must come from the app's own origin.
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("Origin") !== new URL(c.req.url).origin) {
      return c.json({ error: "Ungültige Herkunft" }, 403);
    }
  }
  await next();
});

export const accessAuth = (getJwks: (env: Env) => JWTVerifyGetKey) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const { hostname } = new URL(c.req.url);
    const devEmail = c.env.DEV_USER_EMAIL?.trim();
    if (devEmail && (hostname === "localhost" || hostname === "127.0.0.1")) {
      c.set("userId", devEmail.toLowerCase());
      return next();
    }
    // Reasons only: never the token or the email.
    const reject = (reason: string) => {
      console.warn("auth: rejected:", reason);
      return c.json(unauthenticated, 401);
    };
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!c.env.TEAM_DOMAIN || !c.env.POLICY_AUD) return reject("config missing");
    if (!token) return reject("no token");
    try {
      const { payload } = await jwtVerify(token, getJwks(c.env), {
        issuer: c.env.TEAM_DOMAIN,
        audience: c.env.POLICY_AUD,
        algorithms: ["RS256"],
      });
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!email) return reject("no email claim");
      c.set("userId", email);
    } catch (e) {
      return reject(e instanceof Error ? ((e as { code?: string }).code ?? e.name) : "unknown");
    }
    await next();
  });
