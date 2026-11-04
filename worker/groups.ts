import { Hono } from "hono";
import { GroupInvite, GroupName, ShareToGroup } from "../shared/schema";
import { recipeAccess } from "./access";
import type { AppEnv } from "./auth";
import { insertSnapshot, snapshotRecipe } from "./copy";
import { tooManyRequests } from "./parse";
import { invalid, notFound, readJson, recipeSummaries } from "./recipes";

export const groups = new Hono<AppEnv>();

// Caps per group (members, pending invites) and per user (groups joined).
const MAX = 20;

const isMember = async (DB: D1Database, groupId: string, userId: string) =>
  !!(await DB.prepare("SELECT 1 AS x FROM group_members WHERE group_id = ? AND user_id = ?").bind(groupId, userId).first());

const count = async (DB: D1Database, sql: string, value: string) => (await DB.prepare(sql).bind(value).first<{ n: number }>())!.n;
const groupsOf = (DB: D1Database, userId: string) => count(DB, "SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?", userId);
const membersOf = (DB: D1Database, groupId: string) => count(DB, "SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?", groupId);

groups.post("/api/groups", async (c) => {
  const parsed = GroupName.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { DB } = c.env;
  const uid = c.var.userId;
  if ((await groupsOf(DB, uid)) >= MAX) return c.json(invalid, 400);
  const id = crypto.randomUUID();
  await DB.batch([
    DB.prepare("INSERT INTO groups (id, name, created_by) VALUES (?, ?, ?)").bind(id, parsed.data.name, uid),
    DB.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").bind(id, uid),
  ]);
  return c.json({ id }, 201);
});

groups.get("/api/groups", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.name,
       (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
       (SELECT COUNT(*) FROM recipes WHERE group_id = g.id) AS recipe_count
     FROM groups g JOIN group_members m ON m.group_id = g.id AND m.user_id = ? ORDER BY g.created_at`,
  )
    .bind(c.var.userId)
    .all();
  return c.json(results);
});

groups.get("/api/groups/:id", async (c) => {
  const { DB } = c.env;
  const id = c.req.param("id");
  if (!(await isMember(DB, id, c.var.userId))) return c.json(notFound, 404);
  const [group, members, invites] = await DB.batch([
    DB.prepare("SELECT id, name FROM groups WHERE id = ?").bind(id),
    DB.prepare("SELECT user_id FROM group_members WHERE group_id = ? ORDER BY user_id").bind(id),
    DB.prepare("SELECT email FROM group_invites WHERE group_id = ? ORDER BY created_at").bind(id),
  ]);
  return c.json({
    ...(group.results[0] as { id: string; name: string }),
    members: (members.results as { user_id: string }[]).map((m) => m.user_id),
    invites: (invites.results as { email: string }[]).map((i) => i.email),
    recipes: await recipeSummaries(DB, { groupId: id }),
  });
});

groups.post("/api/groups/:id/invites", async (c) => {
  const parsed = GroupInvite.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const uid = c.var.userId;
  const { success } = await c.env.SOCIAL_LIMIT.limit({ key: `invite:${uid}` });
  if (!success) return c.json(tooManyRequests, 429);
  const { DB } = c.env;
  const id = c.req.param("id");
  const { email } = parsed.data;
  if (!(await isMember(DB, id, uid))) return c.json(notFound, 404);
  if (email === uid) return c.json(invalid, 400);
  const known = await DB.prepare(
    "SELECT 1 AS x FROM group_members WHERE group_id = ?1 AND user_id = ?2 UNION ALL SELECT 1 FROM group_invites WHERE group_id = ?1 AND email = ?2",
  )
    .bind(id, email)
    .first();
  if (known) return c.body(null, 204);
  const pending = await count(DB, "SELECT COUNT(*) AS n FROM group_invites WHERE group_id = ?", id);
  if (pending >= MAX || (await membersOf(DB, id)) >= MAX) return c.json(invalid, 400);
  await DB.prepare("INSERT OR IGNORE INTO group_invites (group_id, email, invited_by) VALUES (?, ?, ?)").bind(id, email, uid).run();
  return c.body(null, 204);
});

groups.get("/api/invites", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.group_id, g.name AS group_name, i.invited_by FROM group_invites i JOIN groups g ON g.id = i.group_id
     WHERE i.email = ? ORDER BY i.created_at`,
  )
    .bind(c.var.userId)
    .all();
  return c.json(results);
});

groups.post("/api/invites/:groupId/accept", async (c) => {
  const { DB } = c.env;
  const uid = c.var.userId;
  const groupId = c.req.param("groupId");
  const invite = await DB.prepare("SELECT 1 AS x FROM group_invites WHERE group_id = ? AND email = ?").bind(groupId, uid).first();
  if (!invite) return c.json(notFound, 404);
  // ponytail: count-then-insert is not atomic, two parallel accepts can pass 20 by one; fine for a few friends.
  if ((await membersOf(DB, groupId)) >= MAX || (await groupsOf(DB, uid)) >= MAX) return c.json(invalid, 400);
  await DB.batch([
    DB.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)").bind(groupId, uid),
    DB.prepare("DELETE FROM group_invites WHERE group_id = ? AND email = ?").bind(groupId, uid),
  ]);
  return c.body(null, 204);
});

groups.delete("/api/invites/:groupId", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM group_invites WHERE group_id = ? AND email = ?")
    .bind(c.req.param("groupId"), c.var.userId)
    .run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});

groups.delete("/api/groups/:id/members/me", async (c) => {
  const { DB, IMAGES } = c.env;
  const uid = c.var.userId;
  const id = c.req.param("id");
  if (!(await isMember(DB, id, uid))) return c.json(notFound, 404);
  const groupRecipes = "SELECT id FROM recipes WHERE group_id = ?";
  await DB.batch([
    DB.prepare(`DELETE FROM planned_recipes WHERE user_id = ? AND recipe_id IN (${groupRecipes})`).bind(uid, id),
    DB.prepare(`DELETE FROM ingredient_matches WHERE user_id = ? AND recipe_id IN (${groupRecipes})`).bind(uid, id),
    DB.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").bind(id, uid),
  ]);
  if ((await membersOf(DB, id)) > 0) return c.body(null, 204);

  // Ids first: the cascade below removes the recipes (and their rows, invites too), but not their images.
  const ids = ((await DB.prepare(groupRecipes).bind(id).all<{ id: string }>()).results).map((r) => r.id);
  // Re-checked in SQL, so an accept that landed since the count keeps the group alive.
  const gone = await DB.prepare("DELETE FROM groups WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = ?1)")
    .bind(id)
    .run();
  if (gone.meta.changes && ids.length) {
    // ponytail: R2 bulk delete takes ≤1000 keys; chunk if a group ever holds more.
    await IMAGES.delete(ids).catch((e) => console.warn("leave: image cleanup failed:", e instanceof Error ? e.name : "unknown"));
  }
  return c.body(null, 204);
});

groups.post("/api/recipes/:id/share-to-group", async (c) => {
  const parsed = ShareToGroup.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { DB } = c.env;
  const uid = c.var.userId;
  const recipeId = c.req.param("id");
  const groupId = parsed.data.group_id;
  if (!(await recipeAccess(DB, uid, recipeId)) || !(await isMember(DB, groupId, uid))) return c.json(notFound, 404);
  // Only personal recipes can be shared into a group.
  if (await DB.prepare("SELECT 1 FROM recipes WHERE id = ? AND group_id IS NOT NULL").bind(recipeId).first()) return c.json(notFound, 404);
  const snapshot = await snapshotRecipe(DB, recipeId, "with_comments");
  return c.json({ id: await insertSnapshot(c.env, snapshot, { userId: uid, groupId }) }, 201);
});
