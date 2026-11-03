import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `user${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown) {
  return app.request(
    path,
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(),
  );
}

const recipe = (over: Record<string, unknown> = {}) => ({
  title: "Pasta",
  servings: 2,
  total_minutes: 25,
  ingredients: [
    { name: "Nudeln", amount: 200, unit: "g" },
    { name: "Salz", amount: null, unit: "" },
  ],
  steps: [
    { text: "Kochen", duration_minutes: 10 },
    { text: "Abgießen", duration_minutes: null },
  ],
  source_url: "https://example.com/r",
  source_platform: "web",
  ...over,
});

async function create(email: string, over: Record<string, unknown> = {}) {
  const res = await call(email, "/api/recipes", "POST", recipe(over));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("recipes api", () => {
  it("round-trips a recipe incl. null amount", async () => {
    const a = user();
    const id = await create(a);
    const full = (await (await call(a, `/api/recipes/${id}`)).json()) as any;
    expect(full.recipe).toMatchObject({ id, title: "Pasta", servings: 2, total_minutes: 25, tags: [], source_platform: "web" });
    expect(full.ingredients.map((i: any) => [i.name, i.amount, i.unit, i.position])).toEqual([
      ["Nudeln", 200, "g", 0],
      ["Salz", null, "", 1],
    ]);
    expect(full.steps.map((s: any) => [s.text, s.duration_minutes, s.position])).toEqual([
      ["Kochen", 10, 0],
      ["Abgießen", null, 1],
    ]);
    expect(full.adjustments).toEqual([]);
    expect(full.note).toBe("");
  });

  it("lists newest first with counts and ingredient names incl. added ones", async () => {
    const a = user();
    const first = await create(a, { title: "Alt" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await create(a);
    await env.DB.prepare(
      "INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, new_values) VALUES (?, ?, 'ingredient', NULL, 'add', ?)",
    )
      .bind(crypto.randomUUID(), second, JSON.stringify({ name: "Chili", amount: 1, unit: "" }))
      .run();
    const list = (await (await call(a, "/api/recipes")).json()) as any[];
    expect(list.map((r) => r.id)).toEqual([second, first]);
    expect(list[0].adjustment_count).toBe(1);
    expect(list[0].ingredient_names.sort()).toEqual(["Chili", "Nudeln", "Salz"]);
    expect(list[1].adjustment_count).toBe(0);
    expect(list[1].ingredient_names.sort()).toEqual(["Nudeln", "Salz"]);
  });

  it("hides recipes from other users (404, unchanged)", async () => {
    const a = user();
    const b = user();
    const id = await create(a);
    expect((await call(b, `/api/recipes/${id}`)).status).toBe(404);
    expect((await call(b, `/api/recipes/${id}`, "PATCH", { tags: ["x"] })).status).toBe(404);
    expect((await call(b, `/api/recipes/${id}`, "DELETE")).status).toBe(404);
    expect(((await (await call(b, "/api/recipes")).json()) as any[]).length).toBe(0);
    const full = (await (await call(a, `/api/recipes/${id}`)).json()) as any;
    expect(full.recipe.tags).toEqual([]);
  });

  it.each([
    ["javascript url", { source_url: "javascript:alert(1)" }],
    ["http url", { source_url: "http://example.com" }],
    ["bad platform", { source_platform: "tiktok" }],
    ["101 ingredients", { ingredients: Array.from({ length: 101 }, () => ({ name: "x", amount: 1, unit: "" })) }],
  ])("rejects %s with 400", async (_n, over) => {
    const res = await call(user(), "/api/recipes", "POST", recipe(over));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Ungültige Eingabe" });
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await app.request(
      "/api/recipes",
      { method: "POST", headers: await authHeaders(user()), body: "{nope" },
      testEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("detects platform when null", async () => {
    const a = user();
    const id = await create(a, { source_platform: null, source_url: "https://www.instagram.com/reel/abc/" });
    const full = (await (await call(a, `/api/recipes/${id}`)).json()) as any;
    expect(full.recipe.source_platform).toBe("instagram");
  });

  it("delete cascades", async () => {
    const a = user();
    const id = await create(a);
    expect((await call(a, `/api/recipes/${id}`, "DELETE")).status).toBe(204);
    for (const t of ["ingredients", "steps"]) {
      const r = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE recipe_id = ?`).bind(id).first<{ c: number }>();
      expect(r!.c).toBe(0);
    }
    expect((await call(a, `/api/recipes/${id}`)).status).toBe(404);
  });

  it("normalizes tags on PATCH", async () => {
    const a = user();
    const id = await create(a);
    expect((await call(a, `/api/recipes/${id}`, "PATCH", { tags: [" Pasta", "pasta", "Schnell", "  "] })).status).toBe(204);
    const full = (await (await call(a, `/api/recipes/${id}`)).json()) as any;
    expect(full.recipe.tags).toEqual(["Pasta", "Schnell"]);
    expect((await call(a, `/api/recipes/${id}`, "PATCH", { tags: ["x".repeat(31)] })).status).toBe(400);
    expect((await call(a, `/api/recipes/${id}`, "PATCH", { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status).toBe(400);
  });
});

describe("unexpected errors", () => {
  it("returns a JSON 500 with security headers", async () => {
    const DB = { prepare: () => { throw new Error("boom"); } } as unknown as D1Database;
    const res = await app.request("/api/recipes", { headers: await authHeaders("a@b.de") }, testEnv({ DB }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Etwas ist schiefgelaufen. Bitte versuche es erneut." });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
