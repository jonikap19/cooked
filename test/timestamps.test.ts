import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { formatShortDate } from "../shared/format";

it("default timestamps are ISO UTC that Date and formatShortDate handle", async () => {
  await env.DB.prepare("INSERT INTO recipes (id, user_id, title, servings) VALUES ('t1', 'u', 'T', 2)").run();
  const row = await env.DB.prepare("SELECT created_at FROM recipes WHERE id = 't1'").first<{ created_at: string }>();
  expect(row!.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(Math.abs(new Date(row!.created_at).getTime() - Date.now())).toBeLessThan(60_000);
  expect(formatShortDate(row!.created_at)).not.toContain("Invalid");
});
