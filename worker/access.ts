/** The only recipe access check: a personal recipe is its creator's, a group recipe is every current member's. */
export async function recipeAccess(db: D1Database, userId: string, recipeId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM recipes r WHERE r.id = ?1 AND (
         (r.group_id IS NULL AND r.user_id = ?2)
         OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = r.group_id AND m.user_id = ?2))`,
    )
    .bind(recipeId, userId)
    .first();
  return !!row;
}
