import { describe, expect, it } from "vitest";
import type { RecipeFull } from "../shared/schema";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `allergy${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown) {
  return app.request(path, { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) }, testEnv());
}
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
const put = (email: string, allergens: unknown) => call(email, "/api/allergies", "PUT", { allergens });
const allergiesOn = async (email: string, recipeId: string) => (await json<RecipeFull>(call(email, `/api/recipes/${recipeId}`))).allergies;

async function recipeOf(email: string) {
  const res = await call(email, "/api/recipes", "POST", {
    title: "Pesto",
    servings: 2,
    total_minutes: null,
    ingredients: [{ name: "Pinienkerne", amount: 30, unit: "g" }],
    steps: [{ text: "Mixen", duration_minutes: null }],
    source_url: null,
    source_platform: null,
  });
  return (await res.json<{ id: string }>()).id;
}

/** A group of alice and bob with one group recipe. */
async function sharedGroup(alice: string, bob: string) {
  const { id: gid } = await json<{ id: string }>(call(alice, "/api/groups", "POST", { name: "WG" }));
  expect((await call(alice, `/api/groups/${gid}/invites`, "POST", { email: bob })).status).toBe(204);
  expect((await call(bob, `/api/invites/${gid}/accept`, "POST")).status).toBe(204);
  const res = await call(alice, `/api/recipes/${await recipeOf(alice)}/share-to-group`, "POST", { group_id: gid });
  return { gid, recipeId: (await res.json<{ id: string }>()).id };
}

describe("allergies", () => {
  it("PUT replaces my list, trimmed and deduped; GET returns it", async () => {
    const me = user();
    expect(await json(call(me, "/api/allergies"))).toEqual([]);
    expect((await put(me, ["Nüsse", " Koriander ", "nüsse", "Laktose"])).status).toBe(204);
    expect(await json(call(me, "/api/allergies"))).toEqual(["Nüsse", "Koriander", "Laktose"]);
    expect((await put(me, ["Sesam"])).status).toBe(204);
    expect(await json(call(me, "/api/allergies"))).toEqual(["Sesam"]);
    expect((await put(me, [])).status).toBe(204);
    expect(await json(call(me, "/api/allergies"))).toEqual([]);
  });

  it("PUT rejects too many, empty or too long items", async () => {
    const me = user();
    await put(me, ["Senf"]);
    for (const bad of [Array.from({ length: 31 }, (_, i) => `A${i}`), [""], ["   "], ["x".repeat(41)], "Senf", [1]]) {
      expect((await put(me, bad)).status).toBe(400);
    }
    expect(await json(call(me, "/api/allergies"))).toEqual(["Senf"]);
  });

  it("another user's GET never returns my list", async () => {
    const [me, other] = [user(), user()];
    await put(me, ["Nüsse"]);
    expect(await json(call(other, "/api/allergies"))).toEqual([]);
  });

  it("a personal recipe returns only the caller's list, even with a co-member", async () => {
    const [alice, bob] = [user(), user()];
    await sharedGroup(alice, bob);
    await put(alice, ["Nüsse"]);
    await put(bob, ["Laktose"]);
    expect(await allergiesOn(alice, await recipeOf(alice))).toEqual([{ user_id: alice, allergens: ["Nüsse"] }]);
    expect(await allergiesOn(bob, await recipeOf(bob))).toEqual([{ user_id: bob, allergens: ["Laktose"] }]);
  });

  it("a group recipe and the group page return every current member's list; not after Bob leaves", async () => {
    const [alice, bob, outsider] = [user(), user(), user()];
    const { gid, recipeId } = await sharedGroup(alice, bob);
    await put(alice, ["Nüsse"]);
    await put(bob, ["Laktose", "Ei"]);
    await put(outsider, ["Senf"]);
    const both = [
      { user_id: alice, allergens: ["Nüsse"] },
      { user_id: bob, allergens: ["Laktose", "Ei"] },
    ].sort((a, b) => a.user_id.localeCompare(b.user_id));
    expect(await allergiesOn(alice, recipeId)).toEqual(both);
    expect(await allergiesOn(bob, recipeId)).toEqual(both);
    expect((await json<{ allergies: unknown }>(call(alice, `/api/groups/${gid}`))).allergies).toEqual(both);
    expect((await call(outsider, `/api/recipes/${recipeId}`)).status).toBe(404);
    expect((await call(outsider, `/api/groups/${gid}`)).status).toBe(404);

    expect((await call(bob, `/api/groups/${gid}/members/me`, "DELETE")).status).toBe(204);
    expect(await allergiesOn(alice, recipeId)).toEqual([{ user_id: alice, allergens: ["Nüsse"] }]);
    expect((await json<{ allergies: unknown }>(call(alice, `/api/groups/${gid}`))).allergies).toEqual([{ user_id: alice, allergens: ["Nüsse"] }]);
    expect((await call(bob, `/api/recipes/${recipeId}`)).status).toBe(404);
  });

  it("share links carry no allergies", async () => {
    const me = user();
    await put(me, ["Nüsse"]);
    const recipeId = await recipeOf(me);
    const { url } = await json<{ url: string }>(call(me, `/api/recipes/${recipeId}/share`, "POST", { mode: "with_comments" }));
    const preview = await (await call(user(), `/api/share/${url.split("/").pop()}`)).text();
    expect(preview).not.toContain("allergies");
    expect(preview).not.toContain("Nüsse");
  });
});
