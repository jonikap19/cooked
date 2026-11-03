import { describe, expect, it } from "vitest";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `adj${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown) {
  return app.request(
    path,
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(),
  );
}

async function create(email: string) {
  const res = await call(email, "/api/recipes", "POST", {
    title: "Pasta",
    servings: 2,
    total_minutes: 25,
    ingredients: [
      { name: "Nudeln", amount: 120, unit: "g" },
      { name: "Salz", amount: null, unit: "" },
    ],
    steps: [{ text: "Kochen", duration_minutes: 6 }],
    source_url: null,
    source_platform: null,
  });
  return ((await res.json()) as { id: string }).id;
}
const get = async (email: string, id: string) => (await (await call(email, `/api/recipes/${id}`)).json()) as any;
const adj = (id: string, body: unknown, email: string) => call(email, `/api/recipes/${id}/adjustments`, "POST", body);
const modIng = (target_id: string, new_values: object) => ({ target_type: "ingredient", action: "modify", target_id, new_values });

describe("adjustments api", () => {
  it("modify upserts, merges keys, and returns 204 when back at original", async () => {
    const a = user();
    const id = await create(a);
    const before = await get(a, id);
    const nudeln = before.ingredients[0].id;
    const r1 = await adj(id, modIng(nudeln, { amount: 150 }), a);
    expect(r1.status).toBe(201);
    expect(((await r1.json()) as any).new_values).toEqual({ amount: 150 });
    expect((await get(a, id)).adjustments).toHaveLength(1);
    const r2 = await adj(id, modIng(nudeln, { unit: "ml" }), a);
    expect(r2.status).toBe(201);
    const list = (await get(a, id)).adjustments;
    expect(list).toHaveLength(1);
    expect(list[0].new_values).toEqual({ amount: 150, unit: "ml" });
    expect((await adj(id, modIng(nudeln, { amount: 120 }), a)).status).toBe(201); // unit still differs
    expect((await adj(id, modIng(nudeln, { unit: "g" }), a)).status).toBe(204);
    expect((await get(a, id)).adjustments).toEqual([]);
    // null amount equals null original
    const salz = (await get(a, id)).ingredients[1].id;
    expect((await adj(id, modIng(salz, { amount: null }), a)).status).toBe(204);
    const after = await get(a, id);
    expect(after.ingredients).toEqual(before.ingredients);
    expect(after.steps).toEqual(before.steps);
  });

  it("rejects foreign, cross-recipe and wrong-type targets with 404", async () => {
    const a = user();
    const b = user();
    const id = await create(a);
    const other = await create(a);
    const full = await get(a, id);
    const foreign = (await get(a, other)).ingredients[0].id;
    expect((await adj(id, modIng(foreign, { amount: 1 }), a)).status).toBe(404);
    expect((await adj(id, { target_type: "ingredient", action: "remove", target_id: foreign }, a)).status).toBe(404);
    expect((await adj(id, modIng(full.ingredients[0].id, { amount: 1 }), b)).status).toBe(404);
    const stepWithIng = { target_type: "step", action: "modify", target_id: full.ingredients[0].id, new_values: { text: "x" } };
    expect((await adj(id, stepWithIng, a)).status).toBe(404);
    expect((await get(a, id)).adjustments).toEqual([]);
    expect((await get(a, other)).adjustments).toEqual([]);
  });

  it("remove is idempotent; delete restores; PATCH only on add rows", async () => {
    const a = user();
    const id = await create(a);
    const before = await get(a, id);
    const rm = { target_type: "ingredient", action: "remove", target_id: before.ingredients[0].id };
    const modId = ((await (await adj(id, modIng(before.ingredients[1].id, { unit: "EL" }), a)).json()) as any).id;
    expect((await call(a, `/api/recipes/${id}/adjustments/${modId}`, "PATCH", { new_values: { name: "x", amount: 1, unit: "" } })).status).toBe(400);
    await call(a, `/api/recipes/${id}/adjustments/${modId}`, "DELETE");
    const r1 = (await (await adj(id, rm, a)).json()) as any;
    const r2 = await adj(id, rm, a);
    expect(r2.status).toBe(201);
    expect(((await r2.json()) as any).id).toBe(r1.id);
    expect((await get(a, id)).adjustments).toHaveLength(1);
    expect((await call(a, `/api/recipes/${id}/adjustments/${r1.id}`, "PATCH", { new_values: { name: "x", amount: 1, unit: "" } })).status).toBe(400);
    expect((await call(user(), `/api/recipes/${id}/adjustments/${r1.id}`, "DELETE")).status).toBe(404);
    expect((await call(a, `/api/recipes/${id}/adjustments/${r1.id}`, "DELETE")).status).toBe(204);

    const add = await adj(id, { target_type: "ingredient", action: "add", target_id: null, new_values: { name: "Pfeffer", amount: 1, unit: "TL" } }, a);
    expect(add.status).toBe(201);
    const addId = ((await add.json()) as any).id;
    const p = await call(a, `/api/recipes/${id}/adjustments/${addId}`, "PATCH", { new_values: { name: "Pfeffer", amount: 2, unit: "TL" } });
    expect(p.status).toBe(200);
    expect(((await p.json()) as any).new_values.amount).toBe(2);
    expect((await call(a, `/api/recipes/${id}/adjustments/${addId}`, "PATCH", { new_values: { text: "x", duration_minutes: null } })).status).toBe(400);
    expect((await call(a, `/api/recipes/${id}/adjustments/${addId}`, "PATCH", { new_values: { amount: 3 } })).status).toBe(400);
    await call(a, `/api/recipes/${id}/adjustments/${addId}`, "DELETE");
    const after = await get(a, id);
    expect(after.adjustments).toEqual([]);
    expect(after.ingredients).toEqual(before.ingredients);
    expect(after.steps).toEqual(before.steps);
  });

  it("note upserts and empty clears", async () => {
    const a = user();
    const id = await create(a);
    expect((await call(a, `/api/recipes/${id}/note`, "PUT", { text: "mehr Salz" })).status).toBe(204);
    expect((await call(a, `/api/recipes/${id}/note`, "PUT", { text: "weniger Salz" })).status).toBe(204);
    expect((await get(a, id)).note).toBe("weniger Salz");
    expect((await call(user(), `/api/recipes/${id}/note`, "PUT", { text: "x" })).status).toBe(404);
    expect((await call(a, `/api/recipes/${id}/note`, "PUT", { text: "x".repeat(5001) })).status).toBe(400);
    expect((await call(a, `/api/recipes/${id}/note`, "PUT", { text: "  " })).status).toBe(204);
    expect((await get(a, id)).note).toBe("");
  });

  it("add with insert_after: stored, ordered, 404 for foreign/wrong-type anchors, 400 on modify/remove", async () => {
    const a = user();
    const id = await create(a);
    const other = await create(a);
    const full = await get(a, id);
    const stepId = full.steps[0].id;
    const addStep = (insert_after?: string | null) => ({
      target_type: "step", action: "add", target_id: null, new_values: { text: "Neu", duration_minutes: null },
      ...(insert_after === undefined ? {} : { insert_after }),
    });
    const plain = await adj(id, addStep(), a);
    expect(plain.status).toBe(201);
    expect(((await plain.json()) as any).insert_after).toBeNull();
    const anchored = await adj(id, addStep(stepId), a);
    expect(anchored.status).toBe(201);
    expect(((await anchored.json()) as any).insert_after).toBe(stepId);
    expect((await adj(id, addStep((await get(a, other)).steps[0].id), a)).status).toBe(404);
    expect((await adj(id, addStep(full.ingredients[0].id), a)).status).toBe(404);
    expect((await adj(id, addStep("nope"), a)).status).toBe(404);
    expect((await adj(id, { target_type: "step", action: "remove", target_id: stepId, insert_after: stepId }, a)).status).toBe(400);
    expect((await adj(id, { target_type: "step", action: "modify", target_id: stepId, new_values: { text: "x" }, insert_after: stepId }, a)).status).toBe(400);
    expect((await get(a, id)).adjustments).toHaveLength(2);
  });

  it("split flow: remove works on a modified step; pieces keep send order", async () => {
    const a = user();
    const id = await create(a);
    const stepId = (await get(a, id)).steps[0].id;
    expect((await adj(id, { target_type: "step", action: "modify", target_id: stepId, new_values: { text: "Anders" } }, a)).status).toBe(201);
    expect((await adj(id, { target_type: "step", action: "remove", target_id: stepId }, a)).status).toBe(201);
    for (const text of ["Eins", "Zwei", "Drei"]) {
      const res = await adj(id, { target_type: "step", action: "add", target_id: null, insert_after: stepId, new_values: { text, duration_minutes: null } }, a);
      expect(res.status).toBe(201);
    }
    const added = (await get(a, id)).adjustments.filter((x: any) => x.action === "add");
    expect(added.map((x: any) => x.new_values.text)).toEqual(["Eins", "Zwei", "Drei"]);
  });
});
