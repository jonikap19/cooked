import { mergeRecipe } from "../shared/merge";
import type { Adjustment, Ingredient, IngredientNote, Recipe, Step } from "../shared/schema";
import type { Env } from "./index";
import { loadRecipeUnchecked } from "./recipes";

export type Snapshot = {
  recipe: Omit<Recipe, "id" | "created_at" | "image_url" | "group_id">;
  image_key: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  adjustments: Adjustment[];
  note: string;
  ingredient_notes: IngredientNote[];
};

const IMAGE_PREFIX = "/api/images/";

/** A frozen copy of a recipe. The caller has already checked access. */
export async function snapshotRecipe(db: D1Database, recipeId: string, mode: "with_comments" | "baked"): Promise<Snapshot> {
  const full = await loadRecipeUnchecked(db, recipeId);
  if (!full) throw new Error("snapshot: recipe not found");
  const { title, servings, total_minutes, tags, source_url, source_platform, image_url } = full.recipe;
  const base = {
    recipe: { title, servings, total_minutes, tags, source_url, source_platform },
    image_key: image_url?.startsWith(IMAGE_PREFIX) ? image_url.slice(IMAGE_PREFIX.length) : null,
  };
  if (mode === "with_comments") {
    const { ingredients, steps, adjustments, note, ingredient_notes } = full;
    return { ...base, ingredients, steps, adjustments, note, ingredient_notes };
  }
  const merged = mergeRecipe(full);
  return {
    ...base,
    ingredients: merged.ingredients
      .filter((i) => i.status !== "removed")
      .map(({ id, name, amount, unit, spice }, position) => ({ id, position, name, amount, unit, spice })),
    steps: merged.steps
      .filter((s) => s.status !== "removed")
      .map(({ id, text, duration_minutes }, position) => ({ id, position, text, duration_minutes })),
    adjustments: [],
    note: "",
    ingredient_notes: [],
  };
}

/** Inserts the snapshot as a new recipe with new ids and its own image object; returns the new recipe id. */
export async function insertSnapshot(env: Env, snapshot: Snapshot, owner: { userId: string; groupId: string | null }): Promise<string> {
  const { DB, IMAGES } = env;
  const id = crypto.randomUUID();
  const newIds = new Map<string, string>();
  for (const row of [...snapshot.ingredients, ...snapshot.steps, ...snapshot.adjustments]) newIds.set(row.id, crypto.randomUUID());
  const remap = (old: string | null) => (old && newIds.get(old)) || null;

  const image = snapshot.image_key ? await IMAGES.get(snapshot.image_key) : null;
  // Buffered because R2 only accepts streams of known length.
  if (image) await IMAGES.put(id, await image.arrayBuffer(), { httpMetadata: image.httpMetadata });

  const r = snapshot.recipe;
  try {
    await DB.batch([
      // In a group, user_id stays the copier as creator; access then goes by group_id.
      DB.prepare(
        "INSERT INTO recipes (id, user_id, group_id, title, source_url, source_platform, image_url, servings, total_minutes, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, owner.userId, owner.groupId, r.title, r.source_url, r.source_platform, image ? `${IMAGE_PREFIX}${id}` : null, r.servings, r.total_minutes, JSON.stringify(r.tags)),
      ...snapshot.ingredients.map((i) =>
        DB.prepare("INSERT INTO ingredients (id, recipe_id, position, name, amount, unit, spice) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
          // Payloads from before Gewürze have no spice.
          remap(i.id), id, i.position, i.name, i.amount, i.unit, i.spice ? 1 : 0,
        ),
      ),
      ...snapshot.steps.map((s) =>
        DB.prepare("INSERT INTO steps (id, recipe_id, position, text, duration_minutes) VALUES (?, ?, ?, ?, ?)").bind(
          remap(s.id), id, s.position, s.text, s.duration_minutes,
        ),
      ),
      // In source order with verbatim timestamps, so insert_after placement by (created_at, rowid) is unchanged.
      // Like notes, copied adjustments belong to the copier; any payload author (or none, before 0007) is ignored.
      ...snapshot.adjustments.map((a) =>
        DB.prepare(
          "INSERT INTO adjustments (id, recipe_id, target_type, target_id, action, insert_after, new_values, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          remap(a.id), id, a.target_type, remap(a.target_id), a.action, remap(a.insert_after),
          a.new_values ? JSON.stringify(a.new_values) : null, owner.userId, a.created_at, a.updated_at,
        ),
      ),
      ...(snapshot.note ? [DB.prepare("INSERT INTO notes (recipe_id, body) VALUES (?, ?)").bind(id, snapshot.note)] : []),
      // An orphan note (target gone) has nothing to attach to, so it is dropped.
      // Copied notes belong to whoever makes the copy, so no source author's email travels with it.
      ...snapshot.ingredient_notes
        .filter((n) => newIds.has(n.target_id))
        .map((n) =>
          DB.prepare("INSERT INTO ingredient_notes (recipe_id, target_id, body, author, updated_at) VALUES (?, ?, ?, ?, ?)").bind(
            id, remap(n.target_id), n.body, owner.userId, n.updated_at,
          ),
        ),
    ]);
  } catch (e) {
    if (image) await IMAGES.delete(id).catch((e) => console.warn("copy: image rollback failed:", e instanceof Error ? e.name : "unknown"));
    throw e;
  }
  return id;
}
