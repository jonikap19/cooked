import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { matchRecipe } from "../worker/match";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `l${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

type Input = { names: { name: string; unit: string }[] };

/** Fake AI that answers from a fixed name map and counts its calls. */
function fakeAi(names: Record<string, string>) {
  const calls: Input[] = [];
  const ai = {
    run: async (_model: string, args: any) => {
      const input = JSON.parse(args.messages[1].content) as Input;
      calls.push(input);
      return {
        response: { items: input.names.filter((x) => names[x.name]).map((x) => ({ name: x.name, canonical_name: names[x.name], unit: x.unit })) },
      };
    },
  } as unknown as Ai;
  return { ai, calls };
}

async function call(email: string, method: string, path: string, body?: unknown, e = testEnv()) {
  return app.request(path, { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) }, e);
}
const getList = async (email: string, e = testEnv()) => (await (await call(email, "GET", "/api/list", undefined, e)).json()) as any;
const plan = (email: string, recipe_id: string, servings: number, e = testEnv()) =>
  call(email, "POST", "/api/list/recipes", { recipe_id, servings }, e);
const addItem = async (email: string, name: string, amount: number | null, unit: string) =>
  (await (await call(email, "POST", "/api/list/items", { name, amount, unit })).json()) as { id: string };
const checkoutBody = (email: string, lines: unknown[]) => call(email, "POST", "/api/list/checkout", { lines });
/** Ticks every line first, like the UI; checkout only applies lines that are still ticked. */
async function checkout(email: string, lines: ({ key: string } & Record<string, unknown>)[]) {
  for (const key of new Set(lines.map((l) => l.key))) await call(email, "PUT", "/api/list/ticks", { key, ticked: true });
  return checkoutBody(email, lines);
}
const pantryOf = async (email: string) => (await (await call(email, "GET", "/api/pantry")).json()) as any[];

async function seed(userId: string, title: string, servings: number, ingredients: [string, number | null, string][]) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO recipes (id, user_id, title, servings) VALUES (?, ?, ?, ?)").bind(id, userId, title, servings),
    ...ingredients.map(([name, amount, unit], i) =>
      env.DB.prepare("INSERT INTO ingredients (id, recipe_id, position, name, amount, unit) VALUES (?, ?, ?, ?, ?, ?)").bind(
        crypto.randomUUID(),
        id,
        i,
        name,
        amount,
        unit,
      ),
    ),
  ]);
  return id;
}

describe("shopping list api", () => {
  it("merges two planned recipes sharing Butter into one scaled line", async () => {
    const u = user();
    const a = await seed(u, "Kuchen", 2, [["Butter", 50, "g"]]);
    const b = await seed(u, "Kekse", 4, [["Butter", 100, "g"]]);
    expect((await plan(u, a, 4)).status).toBe(204);
    expect((await plan(u, b, 2)).status).toBe(204);
    const body = await getList(u);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ canonical_name: "Butter", unit: "g", amount: 150 });
    expect(body.lines[0].recipes.sort()).toEqual(["Kekse", "Kuchen"]);
    expect(body.planned).toEqual(
      expect.arrayContaining([
        { recipe_id: a, title: "Kuchen", servings: 4 },
        { recipe_id: b, title: "Kekse", servings: 2 },
      ]),
    );
  });

  it("checks out the confirmed amount, not the computed one", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    await plan(u, r, 2);
    const [line] = (await getList(u)).lines;
    await call(u, "PUT", "/api/list/ticks", { key: line.key, ticked: true });
    expect((await getList(u)).ticked).toEqual([line.key]);
    const res = await checkout(u, [{ key: line.key, canonical_name: line.canonical_name, unit: line.unit, amount: 30 }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(await pantryOf(u)).toEqual([{ canonical_name: "Butter", unit: "g", amount: 30, always_at_home: false }]);
    expect(body.lines).toEqual([expect.objectContaining({ key: line.key, amount: 30 })]);
    expect(body.ticked).toEqual([]);
  });

  it("reduces a partly bought typed item and deletes one bought in full", async () => {
    const u = user();
    const { id } = await addItem(u, "Milch", 2, "l");
    const key = `item:${id}`;
    expect((await getList(u)).lines).toEqual([expect.objectContaining({ key, canonical_name: "Milch", unit: "ml", amount: 2000, typedItemId: id })]);

    let body = (await (await checkout(u, [{ key, canonical_name: "Milch", unit: "l", amount: 1 }])).json()) as any;
    expect(body.lines).toEqual([expect.objectContaining({ key, amount: 1000 })]);
    expect(await pantryOf(u)).toEqual([expect.objectContaining({ canonical_name: "Milch", unit: "ml", amount: 1000 })]);

    body = (await (await checkout(u, [{ key, canonical_name: "Milch", unit: "ml", amount: 1000 }])).json()) as any;
    expect(body.lines).toEqual([]);
    expect(await pantryOf(u)).toEqual([expect.objectContaining({ amount: 2000 })]);
  });

  it("deletes a typed item checked out with an unknown amount, and one whose own amount is unknown", async () => {
    const u = user();
    const milk = await addItem(u, "Milch", 2, "l");
    const salt = await addItem(u, "Salz", null, "g");
    const body = (await (
      await checkout(u, [
        { key: `item:${milk.id}`, canonical_name: "Milch", unit: "ml", amount: null },
        { key: `item:${salt.id}`, canonical_name: "Salz", unit: "g", amount: 5 },
      ])
    ).json()) as any;
    expect(body.lines).toEqual([]);
    expect(await pantryOf(u)).toEqual([
      { canonical_name: "Milch", unit: "ml", amount: null, always_at_home: false },
      { canonical_name: "Salz", unit: "g", amount: 5, always_at_home: false },
    ]);
  });

  it("leaves another user's typed item alone but still adds to the caller's Vorrat", async () => {
    const [a, b] = [user(), user()];
    const { id } = await addItem(a, "Milch", 2, "l");
    expect((await checkout(b, [{ key: `item:${id}`, canonical_name: "Milch", unit: "ml", amount: 2000 }])).status).toBe(200);
    expect((await getList(a)).lines).toEqual([expect.objectContaining({ key: `item:${id}`, amount: 2000 })]);
    expect(await pantryOf(a)).toEqual([]);
    expect(await pantryOf(b)).toEqual([expect.objectContaining({ canonical_name: "Milch", amount: 2000 })]);
    expect((await call(b, "DELETE", `/api/list/items/${id}`)).status).toBe(404);
    expect((await call(a, "DELETE", `/api/list/items/${id}`)).status).toBe(204);
    expect((await getList(a)).lines).toEqual([]);
  });

  it("writes Vorrat, typed items and ticks in one batch, so a failed checkout changes nothing", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    await plan(u, r, 2);
    const { id } = await addItem(u, "Milch", 2, "l");
    const [butter] = (await getList(u)).lines.filter((l: any) => l.canonical_name === "Butter");
    await call(u, "PUT", "/api/list/ticks", { key: butter.key, ticked: true });
    await call(u, "PUT", "/api/list/ticks", { key: `item:${id}`, ticked: true });

    // Every batch gets a failing last statement; D1 rolls the whole batch back.
    const batches: number[] = [];
    const DB = new Proxy(env.DB, {
      get: (target, prop) =>
        prop === "batch"
          ? (statements: D1PreparedStatement[]) => {
              batches.push(statements.length);
              return target.batch([...statements, target.prepare("INSERT INTO no_such_table VALUES (1)")]);
            }
          : (target as any)[prop].bind(target),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lines = [
      { key: butter.key, canonical_name: "Butter", unit: "g", amount: 60 },
      { key: `item:${id}`, canonical_name: "Milch", unit: "ml", amount: 2000 },
    ];
    const res = await app.request("/api/list/checkout", { method: "POST", headers: await authHeaders(u), body: JSON.stringify({ lines }) }, testEnv({ DB }));
    vi.restoreAllMocks();

    expect(res.status).toBe(500);
    expect(batches).toEqual([4]); // butter upsert, milk upsert, item delete, tick clear
    expect(await pantryOf(u)).toEqual([]);
    const body = await getList(u);
    expect(body.ticked.sort()).toEqual([butter.key, `item:${id}`].sort());
    expect(body.lines).toEqual(expect.arrayContaining([expect.objectContaining({ key: `item:${id}`, amount: 2000 })]));
  });

  it("a retried checkout credits the Vorrat only once", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    await plan(u, r, 2);
    const [line] = (await getList(u)).lines;
    const lines = [{ key: line.key, canonical_name: "Butter", unit: "g", amount: 30 }];
    expect((await checkout(u, lines)).status).toBe(200);
    const retry = await checkoutBody(u, lines);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as any).lines).toEqual([expect.objectContaining({ key: line.key, amount: 30 })]);
    expect(await pantryOf(u)).toEqual([expect.objectContaining({ canonical_name: "Butter", amount: 30 })]);
  });

  it("adds a differently spelled checkout line to the existing Vorrat row", async () => {
    const u = user();
    await call(u, "POST", "/api/pantry", { name: "Butter", amount: 100, unit: "g" });
    await checkout(u, [{ key: "butter|g", canonical_name: "butter", unit: "g", amount: 50 }]);
    expect(await pantryOf(u)).toEqual([{ canonical_name: "Butter", unit: "g", amount: 150, always_at_home: false }]);
  });

  it("rejects out-of-range checkout amounts and bad bodies", async () => {
    const u = user();
    const line = { key: "butter|g", canonical_name: "Butter", unit: "g" };
    expect((await checkout(u, [{ ...line, amount: -1 }])).status).toBe(400);
    expect((await checkout(u, [{ ...line, amount: 100001 }])).status).toBe(400);
    expect((await checkout(u, [{ ...line, canonical_name: "x".repeat(101), amount: 1 }])).status).toBe(400);
    expect((await checkout(u, [{ ...line, unit: "x".repeat(31), amount: 1 }])).status).toBe(400);
    expect((await checkout(u, [])).status).toBe(400);
    expect((await checkout(u, Array.from({ length: 201 }, () => ({ ...line, amount: 1 })))).status).toBe(400);
    expect((await call(u, "POST", "/api/list/items", { name: "Milch", amount: 0, unit: "l" })).status).toBe(400);
    expect(await pantryOf(u)).toEqual([]);
  });

  it("sums servings when the same recipe is added twice and removes it on delete", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 50, "g"]]);
    await plan(u, r, 2);
    await plan(u, r, 3);
    expect((await getList(u)).planned).toEqual([{ recipe_id: r, title: "Kuchen", servings: 5 }]);
    expect((await plan(u, r, 0)).status).toBe(400);
    expect((await plan(u, r, 101)).status).toBe(400);
    expect((await call(u, "DELETE", `/api/list/recipes/${r}`)).status).toBe(204);
    expect(await getList(u)).toEqual({ lines: [], ticked: [], planned: [] });
    expect((await call(u, "DELETE", `/api/list/recipes/${r}`)).status).toBe(404);
  });

  it("returns 404 for another user's recipe", async () => {
    const [a, b] = [user(), user()];
    const r = await seed(a, "Kuchen", 2, [["Butter", 50, "g"]]);
    expect((await plan(b, r, 2)).status).toBe(404);
    expect((await plan(b, crypto.randomUUID(), 2)).status).toBe(404);
    expect(await getList(b)).toEqual({ lines: [], ticked: [], planned: [] });
  });

  it("drops a deleted recipe's planned entry and lines, and its stale ticks", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 50, "g"]]);
    await plan(u, r, 2);
    const [line] = (await getList(u)).lines;
    await call(u, "PUT", "/api/list/ticks", { key: line.key, ticked: true });
    expect((await call(u, "DELETE", `/api/recipes/${r}`)).status).toBe(204);
    expect(await getList(u)).toEqual({ lines: [], ticked: [], planned: [] });
    const ticks = await env.DB.prepare("SELECT COUNT(*) AS n FROM list_ticks WHERE user_id = ?").bind(u).first<{ n: number }>();
    expect(ticks!.n).toBe(0);
  });

  it("puts two spellings on one line after one alias correction, without calling the AI again", async () => {
    const u = user();
    const { ai, calls } = fakeAi({ "rote Zwiebel": "Rote Zwiebel" });
    const e = testEnv({ AI: ai });
    const a = await seed(u, "Salat", 2, [["Zwiebeln, rot", 1, ""]]);
    const b = await seed(u, "Suppe", 2, [["rote Zwiebel", 2, ""]]);
    await plan(u, a, 2, e);
    await plan(u, b, 2, e);
    expect((await getList(u, e)).lines).toHaveLength(2);

    const put = await call(u, "PUT", "/api/aliases", { source_name: "Zwiebeln, rot", canonical_name: "Rote Zwiebel", unit: "Stück" }, e);
    expect(put.status).toBe(204);
    expect((await getList(u, e)).lines).toEqual([expect.objectContaining({ canonical_name: "Rote Zwiebel", unit: "Stück", amount: 3 })]);

    const before = calls.length;
    const c = await seed(u, "Pfanne", 2, [["Zwiebeln, rot", 4, ""]]);
    await plan(u, c, 2, e);
    expect((await getList(u, e)).lines).toEqual([expect.objectContaining({ canonical_name: "Rote Zwiebel", amount: 7 })]);
    expect(calls.length).toBe(before);
  });

  it("an in-flight match does not overwrite an alias correction for the same spelling", async () => {
    const u = user();
    const r = await seed(u, "Salat", 2, [["Zwiebeln, rot", 1, ""]]);
    await matchRecipe(testEnv(), u, r); // no AI answer: stored as a fallback
    // Old enough that the fallback is retried.
    await env.DB.prepare("UPDATE ingredient_matches SET matched_at = '2000-01-01T00:00:00.000Z' WHERE recipe_id = ?").bind(r).run();
    const ai = {
      run: async () => {
        // The user corrects the spelling while the model is still answering.
        await call(u, "PUT", "/api/aliases", { source_name: "Zwiebeln, rot", canonical_name: "Rote Zwiebel", unit: "Stück" });
        return { response: { items: [{ name: "Zwiebeln, rot", canonical_name: "Zwiebel", unit: "g" }] } };
      },
    } as unknown as Ai;
    await matchRecipe(testEnv({ AI: ai }), u, r);
    const row = await env.DB.prepare("SELECT canonical_name, unit, fallback FROM ingredient_matches WHERE recipe_id = ?").bind(r).first();
    expect(row).toEqual({ canonical_name: "Rote Zwiebel", unit: "Stück", fallback: 0 });
  });

  it("unticks a line and validates tick bodies", async () => {
    const u = user();
    expect((await call(u, "PUT", "/api/list/ticks", { key: "", ticked: true })).status).toBe(400);
    const { id } = await addItem(u, "Milch", 1, "l");
    const key = `item:${id}`;
    expect((await call(u, "PUT", "/api/list/ticks", { key, ticked: true })).status).toBe(204);
    expect((await call(u, "PUT", "/api/list/ticks", { key, ticked: true })).status).toBe(204);
    expect((await getList(u)).ticked).toEqual([key]);
    await call(u, "PUT", "/api/list/ticks", { key, ticked: false });
    expect((await getList(u)).ticked).toEqual([]);
  });
});

describe("cooked api", () => {
  const cooked = (email: string, recipe: string, items: unknown[], e = testEnv()) => call(email, "POST", `/api/recipes/${recipe}/cooked`, { items }, e);
  const stock = (email: string, name: string, amount: number, unit: string) => call(email, "POST", "/api/pantry", { name, amount, unit });

  it("subtracts exactly the confirmed amount and ignores items not in the Vorrat", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    await stock(u, "Butter", 200, "g");
    const res = await cooked(u, r, [
      { canonical_name: "Butter", unit: "g", amount: 45 },
      { canonical_name: "Salz", unit: "g", amount: 5 },
      { canonical_name: "Butter", unit: "g", amount: null },
    ]);
    expect(res.status).toBe(204);
    expect(await pantryOf(u)).toEqual([expect.objectContaining({ canonical_name: "Butter", amount: 155 })]);
  });

  it("never goes below zero and removes a row that reaches zero", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    await stock(u, "Butter", 20, "g");
    await cooked(u, r, [{ canonical_name: "Butter", unit: "g", amount: 50 }]);
    expect(await pantryOf(u)).toEqual([]);
  });

  it("removes the planned entry, also with no items", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    await plan(u, r, 2);
    expect((await cooked(u, r, [])).status).toBe(204);
    expect((await getList(u)).planned).toEqual([]);
  });

  it("is 404 for another user's or an unknown recipe, and changes nothing", async () => {
    const a = user();
    const b = user();
    const r = await seed(a, "Kuchen", 2, [["Butter", 60, "g"]]);
    await stock(b, "Butter", 100, "g");
    expect((await cooked(b, r, [{ canonical_name: "Butter", unit: "g", amount: 50 }])).status).toBe(404);
    expect((await cooked(b, "nope", [])).status).toBe(404);
    expect((await call(b, "GET", `/api/recipes/${r}/matches`)).status).toBe(404);
    expect((await call(b, "GET", "/api/recipes/nope/matches")).status).toBe(404);
    expect(await pantryOf(b)).toEqual([expect.objectContaining({ amount: 100 })]);
    expect((await call(a, "GET", `/api/recipes/${r}/matches`)).status).toBe(200);
  });

  it("subtracts from a differently spelled Vorrat row, cumulatively", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    await stock(u, "Butter", 200, "g");
    await cooked(u, r, [
      { canonical_name: "butter", unit: "g", amount: 50 },
      { canonical_name: " BUTTER ", unit: "g", amount: 30 },
    ]);
    expect(await pantryOf(u)).toEqual([{ canonical_name: "Butter", unit: "g", amount: 120, always_at_home: false }]);
  });

  it("never subtracts from an Immer da row", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Salz", 5, "g"]]);
    await stock(u, "Salz", 100, "g");
    await call(u, "PATCH", "/api/pantry", { canonical_name: "Salz", unit: "g", set: { always_at_home: true } });
    await cooked(u, r, [{ canonical_name: "Salz", unit: "g", amount: 5 }]);
    expect(await pantryOf(u)).toEqual([{ canonical_name: "Salz", unit: "g", amount: 100, always_at_home: true }]);
  });

  it("rejects negative or too large amounts and too many items", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    const item = { canonical_name: "Butter", unit: "g" };
    expect((await cooked(u, r, [{ ...item, amount: -1 }])).status).toBe(400);
    expect((await cooked(u, r, [{ ...item, amount: 100001 }])).status).toBe(400);
    expect((await cooked(u, r, Array.from({ length: 101 }, () => ({ ...item, amount: 1 })))).status).toBe(400);
  });

  it("writes the Vorrat and the planned entry in one batch", async () => {
    const u = user();
    const r = await seed(u, "Kuchen", 2, [["Butter", 60, "g"]]);
    await plan(u, r, 2);
    await stock(u, "Butter", 200, "g");
    const DB = new Proxy(env.DB, {
      get: (target, prop) =>
        prop === "batch"
          ? (statements: D1PreparedStatement[]) => target.batch([...statements, target.prepare("INSERT INTO no_such_table VALUES (1)")])
          : (target as any)[prop].bind(target),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await cooked(u, r, [{ canonical_name: "Butter", unit: "g", amount: 50 }], testEnv({ DB }));
    vi.restoreAllMocks();
    expect(res.status).toBe(500);
    expect(await pantryOf(u)).toEqual([expect.objectContaining({ amount: 200 })]);
    expect((await getList(u)).planned).toHaveLength(1);
  });
});
