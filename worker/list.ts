import { Hono } from "hono";
import { mergeRecipe } from "../shared/merge";
import { ListCheckout, ListRecipeAdd, ListTick, PantryAdd, type ListBody } from "../shared/schema";
import { computeShoppingList, scaledNeeds } from "../shared/shopping";
import { toBase } from "../shared/units";
import type { AppEnv } from "./auth";
import type { Env } from "./index";
import { matchName, matchRecipe } from "./match";
import { applyToPantry, readPantry } from "./pantry";
import { invalid, loadRecipe, notFound, ownsRecipe, readJson } from "./recipes";

type Item = { id: string; canonical_name: string; unit: string; amount: number | null };

/** Lines are computed on read from the planned recipes, the Vorrat and the typed items. */
async function listBody(env: Env, userId: string): Promise<ListBody> {
  const { DB } = env;
  const [plannedRows, items, ticks] = await DB.batch([
    DB.prepare("SELECT recipe_id, servings FROM planned_recipes WHERE user_id = ?").bind(userId),
    DB.prepare("SELECT id, canonical_name, unit, amount FROM list_items WHERE user_id = ?").bind(userId),
    DB.prepare("SELECT line_key FROM list_ticks WHERE user_id = ?").bind(userId),
  ]);
  // ponytail: one load + match per planned recipe on every read; fine for a handful of recipes, cache needs if lists grow.
  const recipes = await Promise.all(
    (plannedRows.results as { recipe_id: string; servings: number }[]).map(async ({ recipe_id, servings }) => {
      const full = await loadRecipe(DB, recipe_id, userId);
      if (!full) return null;
      const matches = await matchRecipe(env, userId, recipe_id);
      const needs = scaledNeeds(mergeRecipe(full).ingredients, matches, full.recipe.servings, servings, full.recipe.title);
      return { planned: { recipe_id, title: full.recipe.title, servings }, needs };
    }),
  );
  const loaded = recipes.filter((r) => r !== null);
  const lines = computeShoppingList(
    loaded.flatMap((r) => r.needs),
    await readPantry(DB, userId),
    items.results as Item[],
  );

  // A tick whose line is gone (bought, covered by the Vorrat, recipe removed) is deleted, so it can't reappear ticked later.
  const keys = new Set(lines.map((l) => l.key));
  const tickKeys = (ticks.results as { line_key: string }[]).map((t) => t.line_key);
  const stale = tickKeys.filter((k) => !keys.has(k));
  if (stale.length) await deleteTicks(DB, userId, stale).run();

  return {
    lines,
    ticked: tickKeys.filter((k) => keys.has(k)),
    planned: loaded.map((r) => r.planned).sort((a, b) => a.title.localeCompare(b.title, "de")),
  };
}

const deleteTicks = (DB: D1Database, userId: string, keys: string[]) =>
  DB.prepare("DELETE FROM list_ticks WHERE user_id = ? AND line_key IN (SELECT value FROM json_each(?))").bind(userId, JSON.stringify(keys));

export const list = new Hono<AppEnv>();

list.get("/api/list", async (c) => c.json(await listBody(c.env, c.var.userId)));

list.post("/api/list/recipes", async (c) => {
  const parsed = ListRecipeAdd.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { recipe_id, servings } = parsed.data;
  if (!(await ownsRecipe(c, recipe_id))) return c.json(notFound, 404);
  await c.env.DB.prepare(
    `INSERT INTO planned_recipes (user_id, recipe_id, servings) VALUES (?, ?, ?)
     ON CONFLICT (user_id, recipe_id) DO UPDATE SET servings = planned_recipes.servings + excluded.servings`,
  )
    .bind(c.var.userId, recipe_id, servings)
    .run();
  return c.body(null, 204);
});

list.delete("/api/list/recipes/:recipeId", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM planned_recipes WHERE user_id = ? AND recipe_id = ?")
    .bind(c.var.userId, c.req.param("recipeId"))
    .run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

list.post("/api/list/items", async (c) => {
  const parsed = PantryAdd.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { name, amount, unit } = parsed.data;
  // Same rule as the Vorrat POST: the matcher only names the item, the amount stays in the typed unit.
  const { canonical_name } = await matchName(c.env, c.var.userId, name, unit);
  const base = toBase(amount, unit);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO list_items (id, user_id, name, canonical_name, unit, amount) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, c.var.userId, name, canonical_name, base.unit, base.amount)
    .run();
  return c.json({ id }, 201);
});

list.delete("/api/list/items/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM list_items WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.var.userId).run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

list.put("/api/list/ticks", async (c) => {
  const parsed = ListTick.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { DB } = c.env;
  const { key, ticked } = parsed.data;
  await (ticked
    ? DB.prepare("INSERT OR IGNORE INTO list_ticks (user_id, line_key) VALUES (?, ?)").bind(c.var.userId, key)
    : deleteTicks(DB, c.var.userId, [key])
  ).run();
  return c.body(null, 204);
});

list.post("/api/list/checkout", async (c) => {
  const parsed = ListCheckout.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { DB } = c.env;
  const uid = c.var.userId;
  // Normalised so "1 l" and "1000 ml" mean the same for the Vorrat and for a typed item.
  const lines = parsed.data.lines.map((l) => ({ key: l.key, canonical_name: l.canonical_name, ...toBase(l.amount, l.unit) }));
  const { results } = await DB.prepare("SELECT id, amount FROM list_items WHERE user_id = ?").bind(uid).all<Pick<Item, "id" | "amount">>();
  const items = new Map(results.map((i) => [`item:${i.id}`, i]));

  // Exactly the confirmed amounts go into the Vorrat; a foreign or unknown item key only skips the item update below.
  await applyToPantry(
    DB,
    uid,
    lines.map((l) => ({ canonical_name: l.canonical_name, unit: l.unit, delta: l.amount, op: "add" })),
  );
  const itemWrites = lines.flatMap((l) => {
    const item = items.get(l.key);
    if (!item) return [];
    // ponytail: two lines for the same item each reduce from the amount read above, so the last one wins; the UI sends one line per key.
    return l.amount === null || item.amount === null || l.amount >= item.amount
      ? [DB.prepare("DELETE FROM list_items WHERE id = ? AND user_id = ?").bind(item.id, uid)]
      : [DB.prepare("UPDATE list_items SET amount = ? WHERE id = ? AND user_id = ?").bind(item.amount - l.amount, item.id, uid)];
  });
  await DB.batch([...itemWrites, deleteTicks(DB, uid, lines.map((l) => l.key))]);
  return c.json(await listBody(c.env, uid));
});
