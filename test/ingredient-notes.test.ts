import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `user${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown) {
  return app.request(
    path,
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(),
  );
}

async function setup(email: string) {
  const res = await call(email, "/api/recipes", "POST", {
    title: "Pasta",
    servings: 2,
    total_minutes: 25,
    ingredients: [{ name: "Nudeln", amount: 200, unit: "g" }],
    steps: [{ text: "Kochen", duration_minutes: 10 }],
    source_url: null,
    source_platform: "web",
  });
  const { id } = (await res.json()) as { id: string };
  const full = (await (await call(email, `/api/recipes/${id}`)).json()) as any;
  return { id, ingredientId: full.ingredients[0].id as string, stepId: full.steps[0].id as string };
}

const put = (email: string, rid: string, target: string, text: string) =>
  call(email, `/api/recipes/${rid}/ingredient-notes/${target}`, "PUT", { text });
const notes = async (email: string, rid: string) =>
  ((await (await call(email, `/api/recipes/${rid}`)).json()) as any).ingredient_notes;
const count = async (rid: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM ingredient_notes WHERE recipe_id = ?").bind(rid).first<{ n: number }>())!.n;

async function addIngredient(email: string, rid: string) {
  const res = await call(email, `/api/recipes/${rid}/adjustments`, "POST", {
    target_type: "ingredient", action: "add", target_id: null, new_values: { name: "Käse", amount: 50, unit: "g" },
  });
  return ((await res.json()) as { id: string }).id;
}

async function addStep(email: string, rid: string) {
  const res = await call(email, `/api/recipes/${rid}/adjustments`, "POST", {
    target_type: "step", action: "add", target_id: null, new_values: { text: "Servieren", duration_minutes: null },
  });
  return ((await res.json()) as { id: string }).id;
}

describe("ingredient notes", () => {
  it("stores a note on an original ingredient with the author, trimmed", async () => {
    const a = user();
    const { id, ingredientId } = await setup(a);
    expect((await put(a, id, ingredientId, "  mehr Salz  ")).status).toBe(204);
    expect(await notes(a, id)).toMatchObject([{ target_id: ingredientId, body: "mehr Salz", author: a }]);
  });

  it("accepts an added-ingredient adjustment id", async () => {
    const a = user();
    const { id } = await setup(a);
    const adj = await addIngredient(a, id);
    expect((await put(a, id, adj, "gerieben")).status).toBe(204);
    expect(await count(id)).toBe(1);
  });

  it("stores a note on an original step and on an added step", async () => {
    const a = user();
    const { id, stepId } = await setup(a);
    const added = await addStep(a, id);
    expect((await put(a, id, stepId, "kurz")).status).toBe(204);
    expect((await put(a, id, added, "lang")).status).toBe(204);
    expect(await notes(a, id)).toMatchObject([{ target_id: stepId, body: "kurz" }, { target_id: added, body: "lang" }]);
  });

  it("drops the note when its added step is deleted", async () => {
    const a = user();
    const { id, stepId } = await setup(a);
    const added = await addStep(a, id);
    await put(a, id, added, "x");
    await put(a, id, stepId, "y");
    expect((await call(a, `/api/recipes/${id}/adjustments/${added}`, "DELETE")).status).toBe(204);
    expect((await notes(a, id)).map((x: any) => x.target_id)).toEqual([stepId]);
  });

  it("rejects a foreign recipe's ingredient or step and an unknown id with 404", async () => {
    const a = user();
    const one = await setup(a);
    const two = await setup(a);
    expect((await put(a, one.id, two.stepId, "x")).status).toBe(404);
    expect((await put(a, one.id, two.ingredientId, "x")).status).toBe(404);
    expect((await put(a, one.id, "nope", "x")).status).toBe(404);
    expect(await count(one.id)).toBe(0);
  });

  it("404s on another user's recipe", async () => {
    const { id, ingredientId } = await setup(user());
    expect((await put(user(), id, ingredientId, "x")).status).toBe(404);
    expect(await count(id)).toBe(0);
  });

  it("rejects 501 characters with 400", async () => {
    const a = user();
    const { id, ingredientId } = await setup(a);
    expect((await put(a, id, ingredientId, "x".repeat(501))).status).toBe(400);
    expect((await put(a, id, ingredientId, "x".repeat(500))).status).toBe(204);
  });

  it("removes the note on empty text", async () => {
    const a = user();
    const { id, ingredientId } = await setup(a);
    await put(a, id, ingredientId, "x");
    expect((await put(a, id, ingredientId, "  ")).status).toBe(204);
    expect(await notes(a, id)).toEqual([]);
  });

  it("deletes notes with the recipe", async () => {
    const a = user();
    const { id, ingredientId } = await setup(a);
    await put(a, id, ingredientId, "x");
    await call(a, `/api/recipes/${id}`, "DELETE");
    expect(await count(id)).toBe(0);
  });

  it("keeps the note when an original ingredient's adjustment is reset", async () => {
    const a = user();
    const { id, ingredientId } = await setup(a);
    await put(a, id, ingredientId, "x");
    const adj = (await (await call(a, `/api/recipes/${id}/adjustments`, "POST", {
      target_type: "ingredient", action: "modify", target_id: ingredientId, new_values: { amount: 300 },
    })).json()) as { id: string };
    expect((await call(a, `/api/recipes/${id}/adjustments/${adj.id}`, "DELETE")).status).toBe(204);
    expect(await count(id)).toBe(1);
  });

  it("drops the note when its added ingredient is deleted", async () => {
    const a = user();
    const { id, ingredientId } = await setup(a);
    const adj = await addIngredient(a, id);
    await put(a, id, adj, "x");
    await put(a, id, ingredientId, "y");
    expect((await call(a, `/api/recipes/${id}/adjustments/${adj}`, "DELETE")).status).toBe(204);
    expect((await notes(a, id)).map((x: any) => x.target_id)).toEqual([ingredientId]);
  });

  it("keeps an original ingredient's note when its id is sent to the adjustment delete", async () => {
    const a = user();
    const { id, ingredientId } = await setup(a);
    await put(a, id, ingredientId, "x");
    expect((await call(a, `/api/recipes/${id}/adjustments/${ingredientId}`, "DELETE")).status).toBe(404);
    expect(await notes(a, id)).toMatchObject([{ target_id: ingredientId, body: "x" }]);
  });
});
