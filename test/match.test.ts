import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchName, matchRecipe } from "../worker/match";
import { authHeaders, testApp, testEnv } from "./helpers";

let n = 0;
const user = () => `m${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;
const allow = { limit: async () => ({ success: true }) } as unknown as RateLimit;
const deny = { limit: async () => ({ success: false }) } as unknown as RateLimit;

type Input = { names: { name: string; unit: string }[]; known: string[] };

/** Fake AI: maps every name to "Std <name>" in kg (must come back as g) and records each call's input. */
function fakeAi(respond?: (input: Input) => unknown) {
  const calls: { args: any; input: Input }[] = [];
  const ai = {
    run: async (_model: string, args: any) => {
      const input = JSON.parse(args.messages[1].content) as Input;
      calls.push({ args, input });
      return {
        response: respond
          ? respond(input)
          : { items: input.names.map((x) => ({ name: x.name, canonical_name: `Std ${x.name}`, unit: "kg" })) },
      };
    },
  } as unknown as Ai;
  return { ai, calls };
}

const envWith = (ai: Ai, limit = allow) => testEnv({ AI: ai, PARSE_LIMIT: limit });

async function seed(userId: string, ingredients: [string, string][]) {
  const id = crypto.randomUUID();
  const ids = ingredients.map(() => crypto.randomUUID());
  await env.DB.batch([
    env.DB.prepare("INSERT INTO recipes (id, user_id, title, servings) VALUES (?, ?, 'R', 2)").bind(id, userId),
    ...ingredients.map(([name, unit], i) =>
      env.DB.prepare("INSERT INTO ingredients (id, recipe_id, position, name, amount, unit) VALUES (?, ?, ?, ?, 1, ?)").bind(ids[i], id, i, name, unit),
    ),
  ]);
  return { id, ids };
}

const rows = async (recipeId: string) =>
  (
    await env.DB.prepare("SELECT target_id, source_name, canonical_name, unit, fallback FROM ingredient_matches WHERE recipe_id = ?")
      .bind(recipeId)
      .all()
  ).results;

afterEach(() => vi.restoreAllMocks());

describe("matchRecipe", () => {
  it("first call makes one AI call and stores the results; second call makes none", async () => {
    const u = user();
    const r = await seed(u, [["Zwiebel", ""], ["Mehl", "kg"]]);
    const { ai, calls } = fakeAi();
    const first = await matchRecipe(envWith(ai), u, r.id);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.max_tokens).toBe(1024);
    expect(first).toEqual([
      { target_id: r.ids[0], canonical_name: "Std Zwiebel", unit: "g" },
      { target_id: r.ids[1], canonical_name: "Std Mehl", unit: "g" },
    ]);
    expect(await rows(r.id)).toHaveLength(2);
    expect(await matchRecipe(envWith(ai), u, r.id)).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("re-matches only an ingredient renamed by a modify adjustment", async () => {
    const u = user();
    const r = await seed(u, [["Zwiebel", ""], ["Mehl", "g"]]);
    const { ai, calls } = fakeAi();
    await matchRecipe(envWith(ai), u, r.id);
    await env.DB.prepare(
      "INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, new_values) VALUES (?, ?, 'ingredient', ?, 'modify', ?)",
    )
      .bind(crypto.randomUUID(), r.id, r.ids[1], JSON.stringify({ name: "Dinkelmehl" }))
      .run();
    const out = await matchRecipe(envWith(ai), u, r.id);
    expect(calls).toHaveLength(2);
    expect(calls[1].input.names).toEqual([{ name: "Dinkelmehl", unit: "g" }]);
    expect(out[1]).toMatchObject({ target_id: r.ids[1], canonical_name: "Std Dinkelmehl" });
  });

  it("matches added ingredients by adjustment id and skips removed ones", async () => {
    const u = user();
    const r = await seed(u, [["Zwiebel", ""], ["Mehl", "g"]]);
    const addId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, new_values) VALUES (?, ?, 'ingredient', NULL, 'add', ?)",
      ).bind(addId, r.id, JSON.stringify({ name: "Salz", amount: null, unit: "" })),
      env.DB.prepare("INSERT INTO adjustments (id, recipe_id, target_type, target_id, action) VALUES (?, ?, 'ingredient', ?, 'remove')").bind(
        crypto.randomUUID(), r.id, r.ids[0],
      ),
    ]);
    const { ai } = fakeAi();
    expect((await matchRecipe(envWith(ai), u, r.id)).map((m) => m.target_id)).toEqual([r.ids[1], addId]);
  });

  it("falls back when the rate limiter binding throws", async () => {
    const throwing = { limit: async () => { throw new Error("binding down"); } } as unknown as RateLimit;
    expect(await matchName(envWith(fakeAi().ai, throwing), user(), "Mehl", "kg")).toEqual({ canonical_name: "Mehl", unit: "g" });
  });

  it("uses an alias without calling the AI, but never another user's alias", async () => {
    const u = user();
    const other = user();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO name_aliases (user_id, source_key, canonical_name, unit) VALUES (?, 'zwiebeln, rot', 'Rote Zwiebel', 'Stück')").bind(u),
      env.DB.prepare("INSERT INTO name_aliases (user_id, source_key, canonical_name, unit) VALUES (?, 'mehl', 'Fremd', 'g')").bind(other),
    ]);
    const r = await seed(u, [["Zwiebeln, rot", ""]]);
    const { ai, calls } = fakeAi();
    expect(await matchRecipe(envWith(ai), u, r.id)).toEqual([{ target_id: r.ids[0], canonical_name: "Rote Zwiebel", unit: "Stück" }]);
    expect(calls).toHaveLength(0);
    expect((await rows(r.id))[0]).toMatchObject({ fallback: 0 });

    const r2 = await seed(u, [["Mehl", "g"]]);
    expect((await matchRecipe(envWith(ai), u, r2.id))[0].canonical_name).toBe("Std Mehl");
  });

  it("falls back when the AI throws, logs only the error name, and retries after 24 h", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const u = user();
    const r = await seed(u, [["  Zwiebeln, rot ", "kg"]]);
    let calls = 0;
    const throwing = {
      run: async () => {
        calls++;
        throw new TypeError("boom Zwiebeln");
      },
    } as unknown as Ai;
    expect(await matchRecipe(envWith(throwing), u, r.id)).toEqual([{ target_id: r.ids[0], canonical_name: "Zwiebeln, rot", unit: "g" }]);
    expect((await rows(r.id))[0]).toMatchObject({ fallback: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Zwiebel");
    expect(warn.mock.calls.flat()).toContain("TypeError");

    await matchRecipe(envWith(throwing), u, r.id);
    expect(calls).toBe(1);

    await env.DB.prepare("UPDATE ingredient_matches SET matched_at = ? WHERE recipe_id = ?")
      .bind(new Date(Date.now() - 25 * 3600_000).toISOString(), r.id)
      .run();
    const { ai, calls: aiCalls } = fakeAi();
    expect((await matchRecipe(envWith(ai), u, r.id))[0].canonical_name).toBe("Std   Zwiebeln, rot");
    expect(aiCalls).toHaveLength(1);
    expect((await rows(r.id))[0]).toMatchObject({ fallback: 0 });
  });

  it("falls back without an AI call when rate limited", async () => {
    const u = user();
    const r = await seed(u, [["Milch", "l"]]);
    const { ai, calls } = fakeAi();
    expect(await matchRecipe(envWith(ai, deny), u, r.id)).toEqual([{ target_id: r.ids[0], canonical_name: "Milch", unit: "ml" }]);
    expect(calls).toHaveLength(0);
  });

  it("falls back per name for invalid, unknown or missing AI items", async () => {
    const u = user();
    const r = await seed(u, [["A", "g"], ["B", "g"], ["C", "g"]]);
    const { ai } = fakeAi(() => ({
      items: [
        { name: "A", canonical_name: "Std A", unit: "g" },
        { name: "B", canonical_name: "   ", unit: "g" },
        { name: "X", canonical_name: "Std X", unit: "g" },
      ],
    }));
    expect((await matchRecipe(envWith(ai), u, r.id)).map((m) => m.canonical_name)).toEqual(["Std A", "B", "C"]);
    expect((await rows(r.id)).map((x: any) => x.fallback).sort()).toEqual([0, 1, 1]);
  });

  it("sends pantry names first as known names and keeps ingredient names out of the system prompt", async () => {
    const u = user();
    await env.DB.prepare("INSERT INTO pantry_items (user_id, canonical_name, unit, amount) VALUES (?, 'Basmatireis', 'g', 500)").bind(u).run();
    const earlier = await seed(u, [["Paprika", "Stück"]]);
    await matchRecipe(envWith(fakeAi().ai), u, earlier.id);
    const r = await seed(u, [["GEHEIM-ZUTAT", "g"]]);
    const { ai, calls } = fakeAi();
    await matchRecipe(envWith(ai), u, r.id);
    expect(calls[0].input.known).toEqual(["Basmatireis", "Std Paprika"]);
    const [sys, usr] = calls[0].args.messages;
    expect([sys.role, usr.role]).toEqual(["system", "user"]);
    expect(sys.content).not.toContain("GEHEIM-ZUTAT");
    expect(usr.content).toContain("GEHEIM-ZUTAT");
  });

  it("offers only non-fallback match names back to the AI", async () => {
    const u = user();
    const ok = await seed(u, [["Paprika", "Stück"]]);
    await matchRecipe(envWith(fakeAi().ai), u, ok.id);
    const bad = await seed(u, [["Rohe Schreibweise", "g"]]);
    await matchRecipe(envWith(fakeAi(() => ({ items: [] })).ai), u, bad.id);
    const r = await seed(u, [["Salz", "g"]]);
    const { ai, calls } = fakeAi();
    await matchRecipe(envWith(ai), u, r.id);
    expect(calls[0].input.known).toContain("Std Paprika");
    expect(calls[0].input.known).not.toContain("Rohe Schreibweise");
  });

  it("caps the fallback name at 100 characters", async () => {
    const u = user();
    const r = await seed(u, [[`  ${"x".repeat(150)}`, "g"]]);
    const [m] = await matchRecipe(envWith(fakeAi(() => ({ items: [] })).ai), u, r.id);
    expect(m.canonical_name).toBe("x".repeat(100));
  });

  it("returns [] for another user's recipe and stores nothing", async () => {
    const r = await seed(user(), [["Zwiebel", ""]]);
    const { ai, calls } = fakeAi();
    expect(await matchRecipe(envWith(ai), user(), r.id)).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await rows(r.id)).toEqual([]);
  });
});

describe("matchName", () => {
  it("uses alias, then AI, then fallback, and stores no matches", async () => {
    const u = user();
    await env.DB.prepare("INSERT INTO name_aliases (user_id, source_key, canonical_name, unit) VALUES (?, 'zwiebeln, rot', 'Rote Zwiebel', 'Stück')").bind(u).run();
    const { ai, calls } = fakeAi();
    expect(await matchName(envWith(ai), u, "Zwiebeln, rot", "")).toEqual({ canonical_name: "Rote Zwiebel", unit: "Stück" });
    expect(calls).toHaveLength(0);
    expect(await matchName(envWith(ai), u, "Reis", "kg")).toEqual({ canonical_name: "Std Reis", unit: "g" });
    expect(calls).toHaveLength(1);
    expect(await matchName(envWith(ai, deny), u, " Reis ", "kg")).toEqual({ canonical_name: "Reis", unit: "g" });
    expect(calls).toHaveLength(1);
    const stored = await env.DB.prepare("SELECT COUNT(*) AS n FROM ingredient_matches WHERE user_id = ?").bind(u).first<{ n: number }>();
    expect(stored!.n).toBe(0);
  });
});

describe("PUT /api/aliases", () => {
  const app = testApp();
  const put = async (u: string, body: unknown) =>
    app.request("/api/aliases", { method: "PUT", headers: await authHeaders(u), body: JSON.stringify(body) }, envWith(fakeAi().ai));

  it("rewrites this user's matches with the same spelling in every recipe", async () => {
    const u = user();
    const other = user();
    const a = await seed(u, [["Zwiebeln, rot", ""]]);
    const b = await seed(u, [[" zwiebeln,  ROT", ""]]);
    const c = await seed(other, [["Zwiebeln, rot", ""]]);
    for (const [who, r] of [[u, a], [u, b], [other, c]] as const) await matchRecipe(envWith(fakeAi().ai, deny), who, r.id);

    const res = await put(u, { source_name: "Zwiebeln, rot", canonical_name: " Rote Zwiebel ", unit: "kg" });
    expect(res.status).toBe(204);
    for (const r of [a, b]) expect((await rows(r.id))[0]).toMatchObject({ canonical_name: "Rote Zwiebel", unit: "g", fallback: 0 });
    expect((await rows(c.id))[0]).toMatchObject({ canonical_name: "Zwiebeln, rot", fallback: 1 });

    const { ai, calls } = fakeAi();
    const later = await seed(u, [["ZWIEBELN, ROT", ""]]);
    expect((await matchRecipe(envWith(ai), u, later.id))[0]).toMatchObject({ canonical_name: "Rote Zwiebel", unit: "g" });
    expect(calls).toHaveLength(0);
  });

  it("400 on invalid bodies", async () => {
    const u = user();
    for (const body of [
      {},
      { source_name: "", canonical_name: "X", unit: "" },
      { source_name: "a".repeat(201), canonical_name: "X", unit: "" },
      { source_name: "x", canonical_name: "  ", unit: "" },
      { source_name: "x", canonical_name: "a".repeat(101), unit: "" },
      { source_name: "x", canonical_name: "X", unit: "a".repeat(31) },
    ]) {
      expect((await put(u, body)).status).toBe(400);
    }
  });
});

describe("POST /api/recipes", () => {
  it("matches the new recipe in the background", async () => {
    const u = user();
    const { ai, calls } = fakeAi();
    const res = await testApp().request(
      "/api/recipes",
      {
        method: "POST",
        headers: await authHeaders(u),
        body: JSON.stringify({ title: "P", servings: 2, total_minutes: null, ingredients: [{ name: "Nudeln", amount: 200, unit: "g" }], steps: [{ text: "Kochen", duration_minutes: null }], source_url: null, source_platform: null }),
      },
      envWith(ai),
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(calls).toHaveLength(1);
    expect((await rows(id))[0]).toMatchObject({ canonical_name: "Std Nudeln", unit: "g", fallback: 0 });
  });
});
