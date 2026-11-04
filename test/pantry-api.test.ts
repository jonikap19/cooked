import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { applyToPantry } from "../worker/pantry";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `p${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, method: string, body?: unknown) {
  return app.request(
    "/api/pantry",
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(),
  );
}
const list = async (email: string) => (await (await call(email, "GET")).json()) as any[];
const add = (email: string, name: string, amount: number | null, unit: string) => call(email, "POST", { name, amount, unit });
const patch = (email: string, canonical_name: string, unit: string, set: object) =>
  call(email, "PATCH", { canonical_name, unit, set });
const lowerTotal = async (email: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM pantry_items WHERE user_id = ?").bind(email).first<{ n: number }>())!.n;

describe("pantry api", () => {
  it("stores 1 kg as 1000 g and adds into the same row", async () => {
    const u = user();
    const res = await add(u, "Mehl", 1, "kg");
    expect(await res.json()).toEqual({ canonical_name: "Mehl", unit: "g", amount: 1000, always_at_home: false });
    expect(await (await add(u, "Mehl", 500, "g")).json()).toMatchObject({ amount: 1500 });
    expect(await list(u)).toHaveLength(1);
  });

  it("accepts a null amount on post and keeps an unknown-amount row intact", async () => {
    const u = user();
    expect(await (await add(u, "Salz", null, "g")).json()).toMatchObject({ amount: null });
    expect(await (await add(u, "Salz", null, "g")).json()).toMatchObject({ amount: null });
  });

  it("sorts by name and keeps users apart", async () => {
    const [a, b] = [user(), user()];
    await add(a, "Zucker", 1, "g");
    await add(a, "Äpfel", 2, "");
    expect((await list(a)).map((i) => i.canonical_name)).toEqual(["Äpfel", "Zucker"]);
    expect(await list(b)).toEqual([]);
  });

  it("rejects bad input", async () => {
    const u = user();
    expect((await add(u, "  ", 1, "g")).status).toBe(400);
    expect((await add(u, "Mehl", -1, "g")).status).toBe(400);
    expect((await add(u, "Mehl", 0, "g")).status).toBe(400);
    expect((await add(u, "Mehl", 1, "x".repeat(31))).status).toBe(400);
    expect((await patch(u, "Mehl", "g", { amount: 100001 })).status).toBe(400);
  });

  it("merges a rename onto an existing row, summing amounts and OR-ing Immer da", async () => {
    const u = user();
    await add(u, "Mehl", 100, "g");
    await add(u, "Weizenmehl", 50, "g");
    await patch(u, "Weizenmehl", "g", { always_at_home: true });
    const res = await patch(u, "Weizenmehl", "g", { canonical_name: "  Mehl " });
    expect(await res.json()).toEqual({ canonical_name: "Mehl", unit: "g", amount: 150, always_at_home: true });
    expect(await list(u)).toHaveLength(1);
  });

  it("merges with null rules", async () => {
    const u = user();
    await add(u, "Salz", null, "g");
    await add(u, "Meersalz", 5, "g");
    expect(await (await patch(u, "Meersalz", "g", { canonical_name: "Salz" })).json()).toMatchObject({ amount: 5 });
  });

  it("converts the amount through toBase when the unit changes", async () => {
    const u = user();
    await add(u, "Milch", 2, "Stück");
    expect(await (await patch(u, "Milch", "Stück", { unit: "l" })).json()).toMatchObject({ unit: "ml", amount: 2000 });
    expect(await (await patch(u, "Milch", "ml", { unit: "dl", amount: 3 })).json()).toMatchObject({ unit: "ml", amount: 300 });
  });

  it("deletes at amount 0 unless Immer da", async () => {
    const u = user();
    await add(u, "Mehl", 10, "g");
    expect((await patch(u, "Mehl", "g", { amount: 0 })).status).toBe(204);
    expect(await list(u)).toEqual([]);
    await add(u, "Salz", 10, "g");
    await patch(u, "Salz", "g", { always_at_home: true });
    expect(await (await patch(u, "Salz", "g", { amount: 0 })).json()).toMatchObject({ amount: 0, always_at_home: true });
  });

  it("returns 404 for unknown or foreign rows", async () => {
    const [a, b] = [user(), user()];
    await add(a, "Mehl", 10, "g");
    expect((await patch(b, "Mehl", "g", { amount: 1 })).status).toBe(404);
    expect((await call(b, "DELETE", { canonical_name: "Mehl", unit: "g" })).status).toBe(404);
    expect(await list(a)).toHaveLength(1);
    expect((await call(a, "DELETE", { canonical_name: "Mehl", unit: "g" })).status).toBe(204);
    expect(await list(a)).toEqual([]);
  });
});

describe("applyToPantry", () => {
  it("removes a row when subtracting more than in stock, but keeps Immer da", async () => {
    const u = user();
    await add(u, "Mehl", 100, "g");
    await add(u, "Salz", 100, "g");
    await patch(u, "Salz", "g", { always_at_home: true });
    await applyToPantry(env.DB, u, [
      { canonical_name: "Mehl", unit: "g", delta: 500, op: "subtract" },
      { canonical_name: "Salz", unit: "g", delta: 500, op: "subtract" },
    ]);
    expect(await list(u)).toEqual([{ canonical_name: "Salz", unit: "g", amount: 0, always_at_home: true }]);
  });

  it("never creates a row on subtract, and adds create or sum", async () => {
    const u = user();
    await applyToPantry(env.DB, u, [{ canonical_name: "Mehl", unit: "g", delta: 5, op: "subtract" }]);
    expect(await lowerTotal(u)).toBe(0);
    await applyToPantry(env.DB, u, [
      { canonical_name: "Mehl", unit: "g", delta: 5, op: "add" },
      { canonical_name: "Mehl", unit: "g", delta: 7, op: "add" },
    ]);
    expect(await list(u)).toMatchObject([{ canonical_name: "Mehl", amount: 12 }]);
  });
});
