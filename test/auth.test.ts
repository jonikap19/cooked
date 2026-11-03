import { generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { authHeaders, signToken, testApp, testEnv, TEST_ORIGIN } from "./helpers";

const app = testApp();
const get = (path: string, headers?: HeadersInit, e = testEnv()) => app.request(path, { headers }, e);
const unauth = async (r: Response) => {
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ error: "Nicht angemeldet" });
};

describe("accessAuth", () => {
  it("rejects missing token", async () => unauth(await get("/api/me")));
  it("rejects token from another key", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const t = await signToken("a@b.de", { key: privateKey });
    await unauth(await get("/api/me", { "Cf-Access-Jwt-Assertion": t }));
  });
  it("rejects wrong audience", async () => {
    const t = await signToken("a@b.de", { audience: "other" });
    await unauth(await get("/api/me", { "Cf-Access-Jwt-Assertion": t }));
  });
  it("rejects expired token", async () => {
    const t = await signToken("a@b.de", { expiresIn: Math.floor(Date.now() / 1000) - 60 });
    await unauth(await get("/api/me", { "Cf-Access-Jwt-Assertion": t }));
  });
  it("rejects token without email", async () => {
    const t = await signToken(undefined);
    await unauth(await get("/api/me", { "Cf-Access-Jwt-Assertion": t }));
  });
  it("rejects when POLICY_AUD or TEAM_DOMAIN is unset", async () => {
    const h = await authHeaders("a@b.de");
    await unauth(await get("/api/me", h, testEnv({ POLICY_AUD: "" })));
    await unauth(await get("/api/me", h, testEnv({ TEAM_DOMAIN: "" })));
  });
  it("accepts valid token and lower-cases email", async () => {
    const r = await get("/api/me", await authHeaders("Alice@Example.com"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ userId: "alice@example.com" });
  });
  it("dev bypass works on localhost only", async () => {
    const e = testEnv({ DEV_USER_EMAIL: "Dev@Example.com" });
    const ok = await get("/api/me", undefined, e);
    expect(await ok.json()).toEqual({ userId: "dev@example.com" });
    await unauth(await app.request("https://cooked.example.workers.dev/api/me", {}, e));
  });
  it("health is public", async () => {
    expect((await get("/api/health")).status).toBe(200);
  });
});

describe("sameOrigin", () => {
  it("blocks foreign and missing Origin on writes", async () => {
    const h = await authHeaders("a@b.de");
    const evil = await app.request("/api/me", { method: "POST", headers: { ...h, Origin: "https://evil.example" } }, testEnv());
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ error: "Ungültige Herkunft" });
    const { Origin: _, ...noOrigin } = h;
    expect((await app.request("/api/me", { method: "POST", headers: noOrigin }, testEnv())).status).toBe(403);
  });
  it("lets same-origin writes through to auth", async () => {
    const r = await app.request("/api/me", { method: "POST", headers: { Origin: TEST_ORIGIN } }, testEnv());
    expect(r.status).toBe(401);
  });
});

describe("securityHeaders", () => {
  it("applies to success, 401 and 403", async () => {
    const rs = [
      await get("/api/health"),
      await get("/api/me"),
      await app.request("/api/me", { method: "POST", headers: { Origin: "https://evil.example" } }, testEnv()),
    ];
    for (const r of rs) {
      expect(r.headers.get("Cache-Control")).toBe("no-store");
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
});
