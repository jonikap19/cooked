import { Hono } from "hono";
import { nameKey } from "../shared/units";
import { AllergyList, type RecipeFull } from "../shared/schema";
import type { AppEnv } from "./auth";
import { invalid, readJson } from "./recipes";

export const allergies = new Hono<AppEnv>();

/**
 * One user's allergies, or every current member's of a group, for users that have any.
 * No access check here: the caller must be that user, or a member of that group.
 */
export async function allergiesOf(DB: D1Database, scope: { userId: string } | { groupId: string }): Promise<RecipeFull["allergies"]> {
  const stmt =
    "groupId" in scope
      ? DB.prepare(
          "SELECT user_id, allergen FROM user_allergies WHERE user_id IN (SELECT user_id FROM group_members WHERE group_id = ?) ORDER BY user_id, rowid",
        ).bind(scope.groupId)
      : DB.prepare("SELECT user_id, allergen FROM user_allergies WHERE user_id = ? ORDER BY rowid").bind(scope.userId);
  const byUser = new Map<string, string[]>();
  for (const { user_id, allergen } of (await stmt.all<{ user_id: string; allergen: string }>()).results) {
    byUser.set(user_id, [...(byUser.get(user_id) ?? []), allergen]);
  }
  return [...byUser].map(([user_id, allergens]) => ({ user_id, allergens }));
}

allergies.get("/api/allergies", async (c) => {
  const [mine] = await allergiesOf(c.env.DB, { userId: c.var.userId });
  return c.json(mine?.allergens ?? []);
});

allergies.put("/api/allergies", async (c) => {
  const parsed = AllergyList.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const seen = new Set<string>();
  const list = parsed.data.allergens.filter((a) => !seen.has(nameKey(a)) && seen.add(nameKey(a)));
  const { DB } = c.env;
  const uid = c.var.userId;
  await DB.batch([
    DB.prepare("DELETE FROM user_allergies WHERE user_id = ?").bind(uid),
    ...list.map((a) => DB.prepare("INSERT INTO user_allergies (user_id, allergen) VALUES (?, ?)").bind(uid, a)),
  ]);
  return c.body(null, 204);
});
