import { createMiddleware } from "hono/factory";
import { jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "./index";

type AppEnv = { Bindings: Env; Variables: { userId: string } };

const unauthenticated = { error: "Nicht angemeldet" };

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
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
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token || !c.env.TEAM_DOMAIN || !c.env.POLICY_AUD) return c.json(unauthenticated, 401);
    try {
      const { payload } = await jwtVerify(token, getJwks(c.env), {
        issuer: c.env.TEAM_DOMAIN,
        audience: c.env.POLICY_AUD,
        algorithms: ["RS256"],
      });
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!email) return c.json(unauthenticated, 401);
      c.set("userId", email);
    } catch {
      return c.json(unauthenticated, 401);
    }
    await next();
  });
