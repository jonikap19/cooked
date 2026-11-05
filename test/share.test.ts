import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { initials } from "../shared/format";
import type { RecipeFull } from "../shared/schema";
import type { Snapshot } from "../worker/copy";
import type { Env } from "../worker/index";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `share${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown, overrides: Partial<Env> = {}) {
  return app.request(
    path,
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(overrides),
  );
}
const get = async (email: string, id: string) => (await (await call(email, `/api/recipes/${id}`)).json()) as RecipeFull;

/** A recipe with an adjustment, an ingredient note, a step note and an image. */
async function source(email: string) {
  const res = await call(email, "/api/recipes", "POST", {
    title: "Pasta",
    servings: 2,
    total_minutes: 25,
    ingredients: [{ name: "Nudeln", amount: 200, unit: "g" }],
    steps: [{ text: "Kochen", duration_minutes: 10 }],
    source_url: null,
    source_platform: null,
  });
  const { id } = (await res.json()) as { id: string };
  const [nudeln] = (await get(email, id)).ingredients;
  await call(email, `/api/recipes/${id}/adjustments`, "POST", {
    target_type: "ingredient", action: "modify", target_id: nudeln.id, new_values: { amount: 300 },
  });
  await call(email, `/api/recipes/${id}/ingredient-notes/${nudeln.id}`, "PUT", { text: "al dente" });
  const [kochen] = (await get(email, id)).steps;
  await call(email, `/api/recipes/${id}/ingredient-notes/${kochen.id}`, "PUT", { text: "nicht zu weich" });
  await env.IMAGES.put(id, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare("UPDATE recipes SET image_url = ? WHERE id = ?").bind(`/api/images/${id}`, id).run();
  return id;
}

async function share(email: string, id: string, mode = "with_comments") {
  const res = await call(email, `/api/recipes/${id}/share`, "POST", { mode });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { url: string; expires_at: string };
  return { ...body, token: body.url.slice("/teilen/".length) };
}

const expire = (token: string) =>
  env.DB.prepare("UPDATE share_links SET expires_at = ? WHERE token = ?").bind(new Date(Date.now() - 1000).toISOString(), token).run();

type Preview = { recipe: Snapshot; expires_at: string; shared_by_initials: string };

describe("share links", () => {
  it("creates an unguessable 24 h link that another user can preview without emails", async () => {
    const alice = user();
    const id = await source(alice);
    const before = Date.now();
    const { url, token, expires_at } = await share(alice, id);
    expect(url).toMatch(/^\/teilen\/[A-Za-z0-9_-]{43}$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
    const ttl = Date.parse(expires_at) - before;
    expect(ttl).toBeGreaterThan(864e5 - 60_000);
    expect(ttl).toBeLessThanOrEqual(864e5 + 60_000);

    const res = await call(user(), `/api/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain("@"); // no adjustment or note author, no sharer email
    const preview = JSON.parse(text) as Preview;
    expect(preview.recipe.recipe.title).toBe("Pasta");
    expect(preview.recipe.adjustments).toHaveLength(1);
    expect(preview.recipe.ingredient_notes.map((n) => n.body).sort()).toEqual(["al dente", "nicht zu weich"]);
    for (const note of preview.recipe.ingredient_notes) expect(note).not.toHaveProperty("author");
    expect(preview.recipe.adjustments[0]).not.toHaveProperty("author");
    expect(preview.expires_at).toBe(expires_at);
    expect(preview.shared_by_initials).toBe(initials(alice));
  });

  it("baked preview has no adjustments", async () => {
    const alice = user();
    const { token } = await share(alice, await source(alice), "baked");
    const preview = (await (await call(user(), `/api/share/${token}`)).json()) as Preview;
    expect(preview.recipe.adjustments).toHaveLength(0);
    expect(preview.recipe.ingredients[0].amount).toBe(300);
  });

  it("imports any number of times, each as an independent recipe with its own image", async () => {
    const alice = user();
    const bob = user();
    const id = await source(alice);
    const { token } = await share(alice, id);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await call(bob, `/api/share/${token}/import`, "POST");
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as { id: string }).id);
    }
    expect(new Set([...ids, id]).size).toBe(3);
    for (const copyId of ids) {
      const text = await (await call(bob, `/api/recipes/${copyId}`)).text();
      expect(text).not.toContain(alice); // the sharer's email never reaches the importer
      const copy = JSON.parse(text) as RecipeFull;
      expect(copy.recipe.title).toBe("Pasta");
      expect(copy.recipe.image_url).toBe(`/api/images/${copyId}`);
      expect(copy.ingredient_notes).toHaveLength(2);
      expect(copy.ingredient_notes).toEqual(expect.arrayContaining([expect.objectContaining({ target_id: copy.steps[0].id, body: "nicht zu weich", author: bob })]));
      expect(copy.ingredient_notes.every((n) => n.author === bob)).toBe(true);
      expect(await (await env.IMAGES.get(copyId))?.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    }
  });

  it("import without the source image has no image", async () => {
    const alice = user();
    const id = await source(alice);
    const { token } = await share(alice, id);
    await env.IMAGES.delete(id);
    const bob = user();
    const { id: copyId } = (await (await call(bob, `/api/share/${token}/import`, "POST")).json()) as { id: string };
    expect((await get(bob, copyId)).recipe.image_url).toBeNull();
  });

  it("an expired link gives 410 on preview and import, also after another read swept", async () => {
    const alice = user();
    const id = await source(alice);
    const { token } = await share(alice, id);
    const { token: other } = await share(alice, id);
    await expire(token);
    await call(user(), `/api/share/${other}`); // sweeps
    for (const [path, method] of [[`/api/share/${token}`, "GET"], [`/api/share/${token}/import`, "POST"]]) {
      const res = await call(user(), path, method);
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: "Link abgelaufen" });
    }
  });

  it("sweeps expired rows lazily on a share read", async () => {
    const alice = user();
    const id = await source(alice);
    const { token } = await share(alice, id);
    const { token: other } = await share(alice, id);
    await env.DB.prepare("UPDATE share_links SET expires_at = ? WHERE token = ?").bind(new Date(Date.now() - 8 * 864e5).toISOString(), token).run();
    await call(user(), `/api/share/${other}`);
    expect(await env.DB.prepare("SELECT 1 FROM share_links WHERE token = ?").bind(token).first()).toBeNull();
  });

  it("unknown or malformed token → 404", async () => {
    const bob = user();
    const unknown = "A".repeat(43);
    for (const token of [unknown, "short", "A".repeat(44), `${"A".repeat(42)}%2F`]) {
      expect((await call(bob, `/api/share/${token}`)).status).toBe(404);
      expect((await call(bob, `/api/share/${token}/import`, "POST")).status).toBe(404);
    }
  });

  it("sharing someone else's recipe → 404, a bad mode → 400", async () => {
    const alice = user();
    const id = await source(alice);
    expect((await call(user(), `/api/recipes/${id}/share`, "POST", { mode: "with_comments" })).status).toBe(404);
    expect((await call(alice, `/api/recipes/${id}/share`, "POST", { mode: "all" })).status).toBe(400);
    expect((await call(alice, `/api/recipes/${id}/share`, "POST")).status).toBe(400);
  });

  it("the 21st share in a minute → 429, keyed per user", async () => {
    const alice = user();
    const id = await source(alice);
    const counts = new Map<string, number>();
    const SOCIAL_LIMIT = {
      limit: async ({ key }: { key: string }) => {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return { success: counts.get(key)! <= 20 };
      },
    } as unknown as RateLimit;
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await call(alice, `/api/recipes/${id}/share`, "POST", { mode: "baked" }, { SOCIAL_LIMIT })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect([...counts.keys()]).toEqual([`share:${alice}`]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM share_links WHERE created_by = ?").bind(alice).first("n")).toBe(20);
  });
});
