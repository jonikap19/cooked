import { Hono, type Context } from "hono";
import { z } from "zod";
import { detectPlatform } from "../shared/format";
import { AdjustmentInput, IngredientValues, NewRecipe, NoteBody, StepValues, type Adjustment, type Recipe, type RecipeFull, type RecipeSummary } from "../shared/schema";
import { recipeAccess } from "./access";
import type { AppEnv } from "./auth";
import { matchRecipe } from "./match";

export const recipes = new Hono<AppEnv>();

export const invalid = { error: "Ungültige Eingabe" };
export const notFound = { error: "Nicht gefunden" };

// The cap is on the raw array; normalising only drops entries, so it can never grow past 10.
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

/** Recipe cards for the Home list (a user's personal recipes) or a group's recipes, newest first. */
export async function recipeSummaries(DB: D1Database, scope: { userId: string } | { groupId: string }): Promise<RecipeSummary[]> {
  const [where, value] = "groupId" in scope ? ["r.group_id = ?", scope.groupId] : ["r.user_id = ? AND r.group_id IS NULL", scope.userId];
  const [rows, names, adds, counts] = await DB.batch([
    DB.prepare(`SELECT r.* FROM recipes r WHERE ${where} ORDER BY r.created_at DESC`).bind(value),
    DB.prepare(`SELECT i.recipe_id, i.name FROM ingredients i JOIN recipes r ON r.id = i.recipe_id WHERE ${where} ORDER BY i.position`).bind(value),
    DB.prepare(
      `SELECT a.recipe_id, json_extract(a.new_values, '$.name') AS name FROM adjustments a
       JOIN recipes r ON r.id = a.recipe_id
       WHERE ${where} AND a.target_type = 'ingredient' AND a.action = 'add' ORDER BY a.created_at`,
    ).bind(value),
    DB.prepare(`SELECT a.recipe_id, COUNT(*) AS n FROM adjustments a JOIN recipes r ON r.id = a.recipe_id WHERE ${where} GROUP BY a.recipe_id`).bind(value),
  ]);
  const namesBy = new Map<string, string[]>();
  for (const { recipe_id, name } of [...names.results, ...adds.results] as { recipe_id: string; name: string | null }[]) {
    if (name) namesBy.set(recipe_id, [...(namesBy.get(recipe_id) ?? []), name]);
  }
  const countBy = new Map((counts.results as { recipe_id: string; n: number }[]).map((r) => [r.recipe_id, r.n]));
  return (rows.results as RecipeRow[]).map((r) => ({
    ...toRecipe(r),
    adjustment_count: countBy.get(r.id) ?? 0,
    ingredient_names: namesBy.get(r.id) ?? [],
  }));
}

recipes.get("/api/recipes", async (c) => c.json(await recipeSummaries(c.env.DB, { userId: c.var.userId })));

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
  c.executionCtx.waitUntil(
    matchRecipe(c.env, c.var.userId, id).catch((e) => console.warn("match: background match failed:", e instanceof Error ? e.name : "unknown")),
  );
  return c.json({ id }, 201);
});

/** The recipe with all its child rows, or null if it does not exist or this user has no access. */
export async function loadRecipe(DB: D1Database, id: string, userId: string): Promise<RecipeFull | null> {
  return (await recipeAccess(DB, userId, id)) ? loadRecipeUnchecked(DB, id) : null;
}

/** Any recipe by id, without an access check: the caller must have checked access. */
export async function loadRecipeUnchecked(DB: D1Database, id: string): Promise<RecipeFull | null> {
  const row = await DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first<RecipeRow>();
  return row && loadChildren(DB, row);
}

async function loadChildren(DB: D1Database, row: RecipeRow): Promise<RecipeFull> {
  const id = row.id;
  const [ing, steps, adj, note, ingredientNotes] = await DB.batch([
    DB.prepare("SELECT id, position, name, amount, unit FROM ingredients WHERE recipe_id = ? ORDER BY position").bind(id),
    DB.prepare("SELECT id, position, text, duration_minutes FROM steps WHERE recipe_id = ? ORDER BY position").bind(id),
    DB.prepare(
      `SELECT ${ADJ_COLS} FROM adjustments WHERE recipe_id = ? ORDER BY created_at, rowid`,
    ).bind(id),
    DB.prepare("SELECT body FROM notes WHERE recipe_id = ?").bind(id),
    DB.prepare("SELECT target_id, body, author, updated_at FROM ingredient_notes WHERE recipe_id = ? ORDER BY updated_at").bind(id),
  ]);
  return {
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
}

recipes.get("/api/recipes/:id", async (c) => {
  const full = await loadRecipe(c.env.DB, c.req.param("id"), c.var.userId);
  return full ? c.json(full) : c.json(notFound, 404);
});

recipes.patch("/api/recipes/:id", async (c) => {
  const parsed = Tags.safeParse(await readJson(c));
  const tags = parsed.success ? normalizeTags(parsed.data.tags) : null;
  if (!tags) return c.json(invalid, 400);
  const id = c.req.param("id");
  if (!(await recipeAccess(c.env.DB, c.var.userId, id))) return c.json(notFound, 404);
  // ponytail: access checked then written in two statements; fold into one WHERE if it matters.
  await c.env.DB.prepare("UPDATE recipes SET tags = ? WHERE id = ?").bind(JSON.stringify(tags), id).run();
  return c.body(null, 204);
});

recipes.delete("/api/recipes/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await recipeAccess(c.env.DB, c.var.userId, id))) return c.json(notFound, 404);
  // ponytail: access checked then written in two statements; fold into one WHERE if it matters.
  await c.env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(id).run();
  // The recipe is already gone, so a failed image delete must not turn this into a 500.
  await c.env.IMAGES.delete(id).catch((e) => console.warn("delete: image cleanup failed:", e instanceof Error ? e.name : "unknown"));
  return c.body(null, 204);
});

export const ISO_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const ADJ_COLS = "id, target_type, target_id, action, insert_after, new_values, author, created_at, updated_at";
type AdjRow = Omit<Adjustment, "new_values"> & { new_values: string | null };
const toAdjustment = (a: AdjRow): Adjustment => ({ ...a, new_values: a.new_values ? JSON.parse(a.new_values) : null });

recipes.post("/api/recipes/:id/adjustments", async (c) => {
  const parsed = AdjustmentInput.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const input = parsed.data;
  const { DB } = c.env;
  const rid = c.req.param("id");
  if (!(await recipeAccess(c.env.DB, c.var.userId, rid))) return c.json(notFound, 404);

  const aid = crypto.randomUUID();
  const newValues = "new_values" in input ? JSON.stringify(input.new_values) : null;
  // table name comes from the validated enum, never from input
  const table = input.target_type === "ingredient" ? "ingredients" : "steps";
  if (input.action === "add") {
    const anchor = input.insert_after ?? null;
    if (anchor && !(await DB.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ? AND recipe_id = ?`).bind(anchor, rid).first())) {
      return c.json(notFound, 404);
    }
    await DB.prepare("INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, insert_after, new_values, author) VALUES (?, ?, ?, NULL, 'add', ?, ?, ?)")
      .bind(aid, rid, input.target_type, anchor, newValues, c.var.userId)
      .run();
    return readAdjustment(c, rid, aid, 201);
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
    await DB.prepare("INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, author) VALUES (?, ?, ?, ?, 'remove', ?)")
      .bind(aid, rid, input.target_type, input.target_id, c.var.userId)
      .run();
    return readAdjustment(c, rid, aid, 201);
  }

  const merged: Record<string, unknown> = { ...(existing?.new_values ? JSON.parse(existing.new_values) : {}), ...input.new_values };
  // back at the original on every key -> the adjustment is gone
  if (Object.entries(merged).every(([k, v]) => v === original[k])) {
    if (existing) await DB.prepare("DELETE FROM adjustments WHERE id = ? AND recipe_id = ?").bind(existing.id, rid).run();
    return c.body(null, 204);
  }
  if (existing) {
    await DB.prepare(`UPDATE adjustments SET new_values = ?, author = ?, updated_at = ${ISO_NOW} WHERE id = ? AND recipe_id = ?`)
      .bind(JSON.stringify(merged), c.var.userId, existing.id, rid)
      .run();
    return readAdjustment(c, rid, existing.id, 201);
  }
  await DB.prepare("INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, new_values, author) VALUES (?, ?, ?, ?, 'modify', ?, ?)")
    .bind(aid, rid, input.target_type, input.target_id, JSON.stringify(merged), c.var.userId)
    .run();
  return readAdjustment(c, rid, aid, 201);
});

// The row can be gone if the recipe was deleted between the write and this read.
async function readAdjustment(c: Context<AppEnv>, rid: string, aid: string, status: 200 | 201) {
  const row = await c.env.DB.prepare(`SELECT ${ADJ_COLS} FROM adjustments WHERE id = ? AND recipe_id = ?`).bind(aid, rid).first<AdjRow>();
  return row ? c.json(toAdjustment(row), status) : c.json(notFound, 404);
}

recipes.patch("/api/recipes/:id/adjustments/:adjId", async (c) => {
  const rid = c.req.param("id");
  if (!(await recipeAccess(c.env.DB, c.var.userId, rid))) return c.json(notFound, 404);
  const row = await c.env.DB.prepare(`SELECT ${ADJ_COLS} FROM adjustments WHERE id = ? AND recipe_id = ?`)
    .bind(c.req.param("adjId"), rid)
    .first<AdjRow>();
  if (!row) return c.json(notFound, 404);
  if (row.action !== "add") return c.json(invalid, 400);
  const schema = z.object({ new_values: row.target_type === "ingredient" ? IngredientValues : StepValues });
  const parsed = schema.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  await c.env.DB.prepare(`UPDATE adjustments SET new_values = ?, author = ?, updated_at = ${ISO_NOW} WHERE id = ? AND recipe_id = ?`)
    .bind(JSON.stringify(parsed.data.new_values), c.var.userId, row.id, rid)
    .run();
  return readAdjustment(c, rid, row.id, 200);
});

recipes.delete("/api/recipes/:id/adjustments/:adjId", async (c) => {
  const rid = c.req.param("id");
  if (!(await recipeAccess(c.env.DB, c.var.userId, rid))) return c.json(notFound, 404);
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
  if (!(await recipeAccess(c.env.DB, c.var.userId, rid))) return c.json(notFound, 404);
  const text = parsed.data.text.trim();
  await (text
    ? c.env.DB.prepare("INSERT INTO notes (recipe_id, body) VALUES (?, ?) ON CONFLICT(recipe_id) DO UPDATE SET body = excluded.body").bind(rid, text)
    : c.env.DB.prepare("DELETE FROM notes WHERE recipe_id = ?").bind(rid)
  ).run();
  return c.body(null, 204);
});
