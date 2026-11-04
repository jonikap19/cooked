import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { mergeRecipe } from "../shared/merge";
import type { RecipeFull } from "../shared/schema";
import { insertSnapshot, snapshotRecipe } from "../worker/copy";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `copy${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown) {
  return app.request(
    path,
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(),
  );
}
const get = async (email: string, id: string) => (await (await call(email, `/api/recipes/${id}`)).json()) as RecipeFull;
const adjust = async (email: string, id: string, body: unknown) =>
  ((await (await call(email, `/api/recipes/${id}/adjustments`, "POST", body)).json()) as { id: string }).id;

/** A recipe with a modified ingredient, a removed step, split pieces, a note on an added ingredient, a note, tags and an image. */
async function source(email: string) {
  const res = await call(email, "/api/recipes", "POST", {
    title: "Pasta",
    servings: 2,
    total_minutes: 25,
    ingredients: [
      { name: "Nudeln", amount: 200, unit: "g" },
      { name: "Salz", amount: null, unit: "" },
    ],
    steps: [
      { text: "Wasser kochen", duration_minutes: 10 },
      { text: "Würfeln, anbraten", duration_minutes: null },
      { text: "Servieren", duration_minutes: null },
    ],
    source_url: "https://example.com/pasta",
    source_platform: "web",
  });
  const { id } = (await res.json()) as { id: string };
  const full = await get(email, id);
  const [nudeln, salz] = full.ingredients;
  const [kochen, split] = full.steps;
  await adjust(email, id, { target_type: "ingredient", action: "modify", target_id: nudeln.id, new_values: { amount: 300 } });
  await adjust(email, id, { target_type: "step", action: "remove", target_id: kochen.id });
  // a split: the original is removed and its pieces are placed after it
  await adjust(email, id, { target_type: "step", action: "remove", target_id: split.id });
  for (const text of ["Würfeln", "Anbraten"]) {
    await adjust(email, id, { target_type: "step", action: "add", target_id: null, insert_after: split.id, new_values: { text, duration_minutes: null } });
  }
  const kaese = await adjust(email, id, {
    target_type: "ingredient", action: "add", target_id: null, insert_after: salz.id, new_values: { name: "Käse", amount: 50, unit: "g" },
  });
  await call(email, `/api/recipes/${id}/ingredient-notes/${kaese}`, "PUT", { text: "gerieben" });
  await call(email, `/api/recipes/${id}/note`, "PUT", { text: "Lecker" });
  await call(email, `/api/recipes/${id}`, "PATCH", { tags: ["Schnell", "Italienisch"] });
  await env.IMAGES.put(id, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare("UPDATE recipes SET image_url = ? WHERE id = ?").bind(`/api/images/${id}`, id).run();
  return { id, kaese };
}

const withoutIds = (full: RecipeFull) => {
  const strip = <T extends { id: string; original: unknown; adjustmentIds: string[] }>(items: T[]) =>
    items.map(({ id, original, adjustmentIds, ...rest }) => ({ ...rest, original: original && { ...(original as object), id: undefined } }));
  const merged = mergeRecipe(full);
  return { ingredients: strip(merged.ingredients), steps: strip(merged.steps), adjustmentCount: merged.adjustmentCount };
};
const values = (full: RecipeFull) => ({
  ingredients: full.ingredients.map(({ id, ...rest }) => rest),
  steps: full.steps.map(({ id, ...rest }) => rest),
});

describe("recipe copy", () => {
  it("with_comments: same merged view, same originals, remapped note keys and its own image", async () => {
    const a = user();
    const b = user();
    const { id, kaese } = await source(a);
    const copyId = await insertSnapshot(testEnv(), await snapshotRecipe(env.DB, id, "with_comments"), { userId: b, groupId: null });
    const src = await get(a, id);
    const copy = await get(b, copyId);

    expect(withoutIds(copy)).toEqual(withoutIds(src));
    expect(values(copy)).toEqual(values(src));
    expect(copy.note).toBe("Lecker");
    expect(copy.recipe).toMatchObject({ title: "Pasta", servings: 2, total_minutes: 25, tags: ["Schnell", "Italienisch"], source_url: "https://example.com/pasta", source_platform: "web" });
    expect(copy.adjustments.map((x) => [x.created_at, x.updated_at])).toEqual(src.adjustments.map((x) => [x.created_at, x.updated_at]));

    const copyKaese = copy.adjustments.find((x) => x.action === "add" && x.target_type === "ingredient")!;
    expect(copyKaese.id).not.toBe(kaese);
    expect(copy.ingredient_notes).toMatchObject([{ target_id: copyKaese.id, body: "gerieben", author: b }]); // the copy belongs to whoever made it

    expect(copy.recipe.image_url).toBe(`/api/images/${copyId}`);
    await call(a, `/api/recipes/${id}`, "DELETE");
    const img = await env.IMAGES.get(copyId);
    expect(img?.httpMetadata?.contentType).toBe("image/png");
    expect(new Uint8Array(await img!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("baked: merged non-removed values as originals, nothing else", async () => {
    const a = user();
    const { id } = await source(a);
    const src = await get(a, id);
    const copyId = await insertSnapshot(testEnv(), await snapshotRecipe(env.DB, id, "baked"), { userId: a, groupId: null });
    const copy = await get(a, copyId);
    const live = mergeRecipe(src);
    expect(copy.adjustments).toEqual([]);
    expect(copy.note).toBe("");
    expect(copy.ingredient_notes).toEqual([]);
    expect(copy.ingredients.map(({ id, ...rest }) => rest)).toEqual(
      live.ingredients.filter((i) => i.status !== "removed").map(({ name, amount, unit }, position) => ({ position, name, amount, unit })),
    );
    expect(copy.steps.map(({ text }) => text)).toEqual(["Würfeln", "Anbraten", "Servieren"]);
    expect(copy.recipe).toMatchObject({ tags: ["Schnell", "Italienisch"], total_minutes: 25 });
  });

  it("has no image when the source object is gone", async () => {
    const a = user();
    const { id } = await source(a);
    await env.IMAGES.delete(id);
    const copyId = await insertSnapshot(testEnv(), await snapshotRecipe(env.DB, id, "with_comments"), { userId: a, groupId: null });
    expect((await get(a, copyId)).recipe.image_url).toBeNull();
    expect(await env.IMAGES.get(copyId)).toBeNull();
  });
});
