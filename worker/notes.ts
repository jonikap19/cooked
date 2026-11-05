import { Hono } from "hono";
import { NoteText } from "../shared/schema";
import { recipeAccess } from "./access";
import type { AppEnv } from "./auth";
import { invalid, notFound, readJson } from "./recipes";

export const notes = new Hono<AppEnv>();

/** True if targetId is an original ingredient or step of the recipe or one of its added-row adjustments. */
export async function assertNoteTarget(db: D1Database, recipeId: string, targetId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM ingredients WHERE id = ?1 AND recipe_id = ?2
       UNION ALL
       SELECT 1 FROM steps WHERE id = ?1 AND recipe_id = ?2
       UNION ALL
       SELECT 1 FROM adjustments WHERE id = ?1 AND recipe_id = ?2 AND action = 'add'`,
    )
    .bind(targetId, recipeId)
    .first();
  return !!row;
}

notes.put("/api/recipes/:id/ingredient-notes/:targetId", async (c) => {
  const parsed = NoteText.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const rid = c.req.param("id");
  const targetId = c.req.param("targetId");
  if (!(await recipeAccess(c.env.DB, c.var.userId, rid)) || !(await assertNoteTarget(c.env.DB, rid, targetId))) return c.json(notFound, 404);
  const { text } = parsed.data;
  await (text
    ? c.env.DB.prepare(
        `INSERT INTO ingredient_notes (recipe_id, target_id, body, author) VALUES (?, ?, ?, ?)
         ON CONFLICT(recipe_id, target_id) DO UPDATE SET body = excluded.body, author = excluded.author,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ).bind(rid, targetId, text, c.var.userId)
    : c.env.DB.prepare("DELETE FROM ingredient_notes WHERE recipe_id = ? AND target_id = ?").bind(rid, targetId)
  ).run();
  return c.body(null, 204);
});
