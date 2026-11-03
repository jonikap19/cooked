import { Hono } from "hono";
import { z } from "zod";
import { detectPlatform } from "../shared/format";
import { NewRecipe, type Adjustment, type Recipe, type RecipeFull, type RecipeSummary } from "../shared/schema";
import type { AppEnv } from "./auth";

export const recipes = new Hono<AppEnv>();

const invalid = { error: "Ungültige Eingabe" };
const notFound = { error: "Nicht gefunden" };

const Tags = z.object({ tags: z.array(z.string()).max(10) });

function normalizeTags(raw: string[]): string[] | null {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of raw.map((s) => s.trim()).filter(Boolean)) {
    if (t.length > 30) return null;
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      tags.push(t);
    }
  }
  return tags;
}

const readJson = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => undefined);

type RecipeRow = Omit<Recipe, "tags"> & { tags: string };
const toRecipe = (r: RecipeRow): Recipe => ({ ...r, tags: JSON.parse(r.tags) });

recipes.get("/api/recipes", async (c) => {
  const { DB } = c.env;
  const uid = c.var.userId;
  const [rows, names, adds, counts] = await DB.batch([
    DB.prepare("SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC").bind(uid),
    DB.prepare(
      "SELECT i.recipe_id, i.name FROM ingredients i JOIN recipes r ON r.id = i.recipe_id WHERE r.user_id = ? ORDER BY i.position",
    ).bind(uid),
    DB.prepare(
      `SELECT a.recipe_id, json_extract(a.new_values, '$.name') AS name FROM adjustments a
       JOIN recipes r ON r.id = a.recipe_id
       WHERE r.user_id = ? AND a.target_type = 'ingredient' AND a.action = 'add' ORDER BY a.created_at`,
    ).bind(uid),
    DB.prepare(
      "SELECT a.recipe_id, COUNT(*) AS n FROM adjustments a JOIN recipes r ON r.id = a.recipe_id WHERE r.user_id = ? GROUP BY a.recipe_id",
    ).bind(uid),
  ]);
  const namesBy = new Map<string, string[]>();
  for (const { recipe_id, name } of [...names.results, ...adds.results] as { recipe_id: string; name: string | null }[]) {
    if (name) namesBy.set(recipe_id, [...(namesBy.get(recipe_id) ?? []), name]);
  }
  const countBy = new Map((counts.results as { recipe_id: string; n: number }[]).map((r) => [r.recipe_id, r.n]));
  const out: RecipeSummary[] = (rows.results as RecipeRow[]).map((r) => ({
    ...toRecipe(r),
    adjustment_count: countBy.get(r.id) ?? 0,
    ingredient_names: namesBy.get(r.id) ?? [],
  }));
  return c.json(out);
});

recipes.post("/api/recipes", async (c) => {
  const parsed = NewRecipe.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const r = parsed.data;
  const { DB } = c.env;
  const id = crypto.randomUUID();
  await DB.batch([
    DB.prepare(
      "INSERT INTO recipes (id, user_id, title, source_url, source_platform, servings, total_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, c.var.userId, r.title, r.source_url, r.source_platform ?? detectPlatform(r.source_url), r.servings, r.total_minutes),
    ...r.ingredients.map((i, pos) =>
      DB.prepare("INSERT INTO ingredients (id, recipe_id, position, name, amount, unit) VALUES (?, ?, ?, ?, ?, ?)").bind(
        crypto.randomUUID(), id, pos, i.name, i.amount, i.unit,
      ),
    ),
    ...r.steps.map((s, pos) =>
      DB.prepare("INSERT INTO steps (id, recipe_id, position, text, duration_minutes) VALUES (?, ?, ?, ?, ?)").bind(
        crypto.randomUUID(), id, pos, s.text, s.duration_minutes,
      ),
    ),
  ]);
  return c.json({ id }, 201);
});

recipes.get("/api/recipes/:id", async (c) => {
  const { DB } = c.env;
  const id = c.req.param("id");
  const row = await DB.prepare("SELECT * FROM recipes WHERE id = ? AND user_id = ?").bind(id, c.var.userId).first<RecipeRow>();
  if (!row) return c.json(notFound, 404);
  // recipe ownership was checked above, so child rows are safe to read by recipe_id
  const [ing, steps, adj, note] = await DB.batch([
    DB.prepare("SELECT id, position, name, amount, unit FROM ingredients WHERE recipe_id = ? ORDER BY position").bind(id),
    DB.prepare("SELECT id, position, text, duration_minutes FROM steps WHERE recipe_id = ? ORDER BY position").bind(id),
    DB.prepare(
      "SELECT id, target_type, target_id, action, new_values, created_at, updated_at FROM adjustments WHERE recipe_id = ? ORDER BY created_at, id",
    ).bind(id),
    DB.prepare("SELECT body FROM notes WHERE recipe_id = ?").bind(id),
  ]);
  const out: RecipeFull = {
    recipe: toRecipe(row),
    ingredients: ing.results as RecipeFull["ingredients"],
    steps: steps.results as RecipeFull["steps"],
    adjustments: (adj.results as (Omit<Adjustment, "new_values"> & { new_values: string | null })[]).map((a) => ({
      ...a,
      new_values: a.new_values ? JSON.parse(a.new_values) : null,
    })),
    note: (note.results[0] as { body: string } | undefined)?.body ?? "",
  };
  return c.json(out);
});

recipes.patch("/api/recipes/:id", async (c) => {
  const parsed = Tags.safeParse(await readJson(c));
  const tags = parsed.success ? normalizeTags(parsed.data.tags) : null;
  if (!tags || tags.length > 10) return c.json(invalid, 400);
  const res = await c.env.DB.prepare("UPDATE recipes SET tags = ? WHERE id = ? AND user_id = ?")
    .bind(JSON.stringify(tags), c.req.param("id"), c.var.userId)
    .run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

recipes.delete("/api/recipes/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM recipes WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.var.userId)
    .run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});
