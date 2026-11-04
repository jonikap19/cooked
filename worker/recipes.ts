import { Hono } from "hono";
import { z } from "zod";
import { detectPlatform } from "../shared/format";
import { AdjustmentInput, IngredientValues, NewRecipe, NoteBody, StepValues, type Adjustment, type Recipe, type RecipeFull, type RecipeSummary } from "../shared/schema";
import type { AppEnv } from "./auth";

export const recipes = new Hono<AppEnv>();

export const invalid = { error: "Ungültige Eingabe" };
export const notFound = { error: "Nicht gefunden" };

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

/** Moves the caller's tmp upload to the recipe's key; null if it is missing or not theirs. */
async function claimTmpImage(images: R2Bucket, handle: string, recipeId: string, userId: string): Promise<string | null> {
  const tmpKey = handle.slice("/api/images/".length);
  const tmp = await images.get(tmpKey);
  if (!tmp || tmp.customMetadata?.owner !== userId) {
    await tmp?.body.cancel();
    return null;
  }
  // Buffered (max 5 MB) because R2 only accepts streams of known length.
  await images.put(recipeId, await tmp.arrayBuffer(), { httpMetadata: tmp.httpMetadata });
  await images.delete(tmpKey);
  return `/api/images/${recipeId}`;
}

export const readJson = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => undefined);

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
  // ponytail: the claim runs before the DB batch, so a failed insert can orphan a <recipeId> object outside tmp/.
  const imageUrl = r.image_url ? await claimTmpImage(c.env.IMAGES, r.image_url, id, c.var.userId).catch((e) => {
    console.warn("save: image claim failed:", e instanceof Error ? e.name : "unknown"); // images are optional
    return null;
  }) : null;
  await DB.batch([
    DB.prepare(
      "INSERT INTO recipes (id, user_id, title, source_url, source_platform, image_url, servings, total_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, c.var.userId, r.title, r.source_url, r.source_platform ?? detectPlatform(r.source_url), imageUrl, r.servings, r.total_minutes),
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
  const [ing, steps, adj, note, ingredientNotes] = await DB.batch([
    DB.prepare("SELECT id, position, name, amount, unit FROM ingredients WHERE recipe_id = ? ORDER BY position").bind(id),
    DB.prepare("SELECT id, position, text, duration_minutes FROM steps WHERE recipe_id = ? ORDER BY position").bind(id),
    DB.prepare(
      "SELECT id, target_type, target_id, action, insert_after, new_values, created_at, updated_at FROM adjustments WHERE recipe_id = ? ORDER BY created_at, rowid",
    ).bind(id),
    DB.prepare("SELECT body FROM notes WHERE recipe_id = ?").bind(id),
    DB.prepare("SELECT target_id, body, author, updated_at FROM ingredient_notes WHERE recipe_id = ? ORDER BY updated_at").bind(id),
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
    ingredient_notes: ingredientNotes.results as RecipeFull["ingredient_notes"],
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
  const id = c.req.param("id");
  const res = await c.env.DB.prepare("DELETE FROM recipes WHERE id = ? AND user_id = ?").bind(id, c.var.userId).run();
  if (!res.meta.changes) return c.json(notFound, 404);
  await c.env.IMAGES.delete(id);
  return c.body(null, 204);
});

const ISO_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const ADJ_COLS = "id, target_type, target_id, action, insert_after, new_values, created_at, updated_at";
type AdjRow = Omit<Adjustment, "new_values"> & { new_values: string | null };
const toAdjustment = (a: AdjRow): Adjustment => ({ ...a, new_values: a.new_values ? JSON.parse(a.new_values) : null });

export const ownsRecipe = async (c: { env: AppEnv["Bindings"]; var: AppEnv["Variables"] }, id: string) =>
  !!(await c.env.DB.prepare("SELECT 1 AS x FROM recipes WHERE id = ? AND user_id = ?").bind(id, c.var.userId).first());

recipes.post("/api/recipes/:id/adjustments", async (c) => {
  const parsed = AdjustmentInput.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const input = parsed.data;
  const { DB } = c.env;
  const rid = c.req.param("id");
  if (!(await ownsRecipe(c, rid))) return c.json(notFound, 404);

  const aid = crypto.randomUUID();
  const newValues = "new_values" in input ? JSON.stringify(input.new_values) : null;
  // table name comes from the validated enum, never from input
  const table = input.target_type === "ingredient" ? "ingredients" : "steps";
  if (input.action === "add") {
    const anchor = input.insert_after ?? null;
    if (anchor && !(await DB.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ? AND recipe_id = ?`).bind(anchor, rid).first())) {
      return c.json(notFound, 404);
    }
    await DB.prepare("INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, insert_after, new_values) VALUES (?, ?, ?, NULL, 'add', ?, ?)")
      .bind(aid, rid, input.target_type, anchor, newValues)
      .run();
    return c.json(await readAdjustment(c, rid, aid), 201);
  }

  // target must belong to this recipe
  const original = await DB.prepare(`SELECT * FROM ${table} WHERE id = ? AND recipe_id = ?`)
    .bind(input.target_id, rid)
    .first<Record<string, unknown>>();
  if (!original) return c.json(notFound, 404);

  const existing = await DB.prepare(
    `SELECT ${ADJ_COLS} FROM adjustments WHERE recipe_id = ? AND target_type = ? AND target_id = ? AND action = ?`,
  )
    .bind(rid, input.target_type, input.target_id, input.action)
    .first<AdjRow>();

  if (input.action === "remove") {
    if (existing) return c.json(toAdjustment(existing), 201);
    await DB.prepare("INSERT INTO adjustments (id, recipe_id, target_type, target_id, action) VALUES (?, ?, ?, ?, 'remove')")
      .bind(aid, rid, input.target_type, input.target_id)
      .run();
    return c.json(await readAdjustment(c, rid, aid), 201);
  }

  const merged: Record<string, unknown> = { ...(existing?.new_values ? JSON.parse(existing.new_values) : {}), ...input.new_values };
  // back at the original on every key -> the adjustment is gone
  if (Object.entries(merged).every(([k, v]) => v === original[k])) {
    if (existing) await DB.prepare("DELETE FROM adjustments WHERE id = ? AND recipe_id = ?").bind(existing.id, rid).run();
    return c.body(null, 204);
  }
  if (existing) {
    await DB.prepare(`UPDATE adjustments SET new_values = ?, updated_at = ${ISO_NOW} WHERE id = ? AND recipe_id = ?`)
      .bind(JSON.stringify(merged), existing.id, rid)
      .run();
    return c.json(await readAdjustment(c, rid, existing.id), 201);
  }
  await DB.prepare("INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, new_values) VALUES (?, ?, ?, ?, 'modify', ?)")
    .bind(aid, rid, input.target_type, input.target_id, JSON.stringify(merged))
    .run();
  return c.json(await readAdjustment(c, rid, aid), 201);
});

async function readAdjustment(c: { env: AppEnv["Bindings"] }, rid: string, aid: string) {
  const row = await c.env.DB.prepare(`SELECT ${ADJ_COLS} FROM adjustments WHERE id = ? AND recipe_id = ?`).bind(aid, rid).first<AdjRow>();
  return toAdjustment(row!);
}

recipes.patch("/api/recipes/:id/adjustments/:adjId", async (c) => {
  const rid = c.req.param("id");
  if (!(await ownsRecipe(c, rid))) return c.json(notFound, 404);
  const row = await c.env.DB.prepare(`SELECT ${ADJ_COLS} FROM adjustments WHERE id = ? AND recipe_id = ?`)
    .bind(c.req.param("adjId"), rid)
    .first<AdjRow>();
  if (!row) return c.json(notFound, 404);
  if (row.action !== "add") return c.json(invalid, 400);
  const schema = z.object({ new_values: row.target_type === "ingredient" ? IngredientValues : StepValues });
  const parsed = schema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  await c.env.DB.prepare(`UPDATE adjustments SET new_values = ?, updated_at = ${ISO_NOW} WHERE id = ? AND recipe_id = ?`)
    .bind(JSON.stringify(parsed.data.new_values), row.id, rid)
    .run();
  return c.json(await readAdjustment(c, rid, row.id), 200);
});

recipes.delete("/api/recipes/:id/adjustments/:adjId", async (c) => {
  const rid = c.req.param("id");
  if (!(await ownsRecipe(c, rid))) return c.json(notFound, 404);
  const adjId = c.req.param("adjId");
  // An added ingredient's note would be orphaned, so it goes first (while the subquery still sees the adjustment).
  // Scoped to a real add adjustment: a 404 here must not delete the note of an original ingredient whose id was passed.
  const [, res] = await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM ingredient_notes WHERE recipe_id = ?1 AND target_id IN
       (SELECT id FROM adjustments WHERE id = ?2 AND recipe_id = ?1 AND action = 'add' AND target_type = 'ingredient')`,
    ).bind(rid, adjId),
    c.env.DB.prepare("DELETE FROM adjustments WHERE id = ? AND recipe_id = ?").bind(adjId, rid),
  ]);
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

recipes.put("/api/recipes/:id/note", async (c) => {
  const parsed = NoteBody.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const rid = c.req.param("id");
  if (!(await ownsRecipe(c, rid))) return c.json(notFound, 404);
  const text = parsed.data.text.trim();
  await (text
    ? c.env.DB.prepare("INSERT INTO notes (recipe_id, body) VALUES (?, ?) ON CONFLICT(recipe_id) DO UPDATE SET body = excluded.body").bind(rid, text)
    : c.env.DB.prepare("DELETE FROM notes WHERE recipe_id = ?").bind(rid)
  ).run();
  return c.body(null, 204);
});
