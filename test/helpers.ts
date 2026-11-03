import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { buildApp, type Env } from "../worker/index";

export const TEST_ORIGIN = "http://localhost"; // what Hono's app.request() uses
export const TEST_TEAM_DOMAIN = "https://test.cloudflareaccess.com";
export const TEST_AUD = "test-aud";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const publicJwk: JWK = { ...(await exportJWK(publicKey)), alg: "RS256", use: "sig" };

export async function signToken(
  email: string | undefined,
  opts: { audience?: string; expiresIn?: string | number; key?: CryptoKey } = {},
) {
  return new SignJWT(email === undefined ? {} : { email })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_TEAM_DOMAIN)
    .setAudience(opts.audience ?? TEST_AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "1h")
    .sign(opts.key ?? privateKey);
}

export const testApp = () => buildApp(() => createLocalJWKSet({ keys: [publicJwk] }));

// DEV_USER_EMAIL is cleared so the localhost bypass never leaks into normal tests.
export const testEnv = (overrides: Partial<Env> = {}): Env => ({
  ...env,
  TEAM_DOMAIN: TEST_TEAM_DOMAIN,
  POLICY_AUD: TEST_AUD,
  DEV_USER_EMAIL: undefined,
  ...overrides,
});

export async function authHeaders(email: string): Promise<Record<string, string>> {
  return {
    "Cf-Access-Jwt-Assertion": await signToken(email),
    Origin: TEST_ORIGIN,
    "Content-Type": "application/json",
  };
}
