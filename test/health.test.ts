import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("GET /api/health returns ok", async () => {
  const response = await SELF.fetch("https://example.com/api/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
