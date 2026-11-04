import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { RecipeFull, RecipeSummary } from "../shared/schema";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `access${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown) {
  return app.request(
    path,
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(),
  );
}
const get = async (email: string, id: string) => (await (await call(email, `/api/recipes/${id}`)).json()) as RecipeFull;

type Fixture = { id: string; ingredientId: string; addId: string };

/** A personal recipe of `email` with an ingredient, an added ingredient and an image. */
async function recipeOf(email: string): Promise<Fixture> {
  const res = await call(email, "/api/recipes", "POST", {
    title: "Suppe",
    servings: 2,
    total_minutes: null,
    ingredients: [{ name: "Karotten", amount: 300, unit: "g" }],
    steps: [{ text: "Kochen", duration_minutes: null }],
    source_url: null,
    source_platform: null,
  });
  const { id } = (await res.json()) as { id: string };
  const ingredientId = (await get(email, id)).ingredients[0].id;
  const add = await call(email, `/api/recipes/${id}/adjustments`, "POST", {
    target_type: "ingredient", action: "add", target_id: null, new_values: { name: "Salz", amount: null, unit: "" },
  });
  const addId = ((await add.json()) as { id: string }).id;
  await env.IMAGES.put(id, new Uint8Array([1]), { httpMetadata: { contentType: "image/png" } });
  return { id, ingredientId, addId };
}

/** A group with these members, as plain SQL so access tests do not depend on the groups API. */
async function groupOf(...members: string[]) {
  const gid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO groups (id, name, created_by) VALUES (?, 'WG', ?)").bind(gid, members[0]),
    ...members.map((m) => env.DB.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").bind(gid, m)),
  ]);
  return gid;
}
const moveToGroup = (recipeId: string, gid: string) => env.DB.prepare("UPDATE recipes SET group_id = ? WHERE id = ?").bind(gid, recipeId).run();
const leave = (gid: string, email: string) => env.DB.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").bind(gid, email).run();

type Req = [method: string, path: string, body?: unknown];
// Every recipe-scoped route and the status the owner gets. Add a row per new recipe-scoped route.
// `email` is the caller, for routes that also need something of the caller's own.
const routes: { name: string; status: number; groupStatus?: number; req: (f: Fixture, email: string) => Req | Promise<Req> }[] = [
  { name: "detail", status: 200, req: (f) => ["GET", `/api/recipes/${f.id}`] },
  { name: "tags", status: 204, req: (f) => ["PATCH", `/api/recipes/${f.id}`, { tags: ["Schnell"] }] },
  { name: "delete recipe", status: 204, req: (f) => ["DELETE", `/api/recipes/${f.id}`] },
  {
    name: "create adjustment",
    status: 201,
    req: (f) => ["POST", `/api/recipes/${f.id}/adjustments`, { target_type: "ingredient", action: "modify", target_id: f.ingredientId, new_values: { amount: 400 } }],
  },
  {
    name: "update adjustment",
    status: 200,
    req: (f) => ["PATCH", `/api/recipes/${f.id}/adjustments/${f.addId}`, { new_values: { name: "Pfeffer", amount: null, unit: "" } }],
  },
  { name: "delete adjustment", status: 204, req: (f) => ["DELETE", `/api/recipes/${f.id}/adjustments/${f.addId}`] },
  { name: "recipe note", status: 204, req: (f) => ["PUT", `/api/recipes/${f.id}/note`, { text: "Lecker" }] },
  { name: "ingredient note", status: 204, req: (f) => ["PUT", `/api/recipes/${f.id}/ingredient-notes/${f.ingredientId}`, { text: "Bio" }] },
  { name: "image", status: 200, req: (f) => ["GET", `/api/images/${f.id}`] },
  { name: "matches", status: 200, req: (f) => ["GET", `/api/recipes/${f.id}/matches`] },
  { name: "list add", status: 204, req: (f) => ["POST", "/api/list/recipes", { recipe_id: f.id, servings: 2 }] },
  { name: "cooked", status: 204, req: (f) => ["POST", `/api/recipes/${f.id}/cooked`, { items: [] }] },
  { name: "share", status: 201, req: (f) => ["POST", `/api/recipes/${f.id}/share`, { mode: "baked" }] },
  // The target is a group of the caller's own, so only access to the source decides.
  { name: "share to group", status: 201, groupStatus: 404, req: async (f, email) => ["POST", `/api/recipes/${f.id}/share-to-group`, { group_id: await groupOf(email) }] },
];

const statusFor = async (email: string, f: Fixture, req: (typeof routes)[number]["req"]) => {
  const [method, path, body] = await req(f, email);
  return (await call(email, path, method, body)).status;
};

describe.each(routes)("access: $name", ({ status, groupStatus, req }) => {
  it("personal: the owner gets it, a group-mate of the owner gets 404", async () => {
    const [owner, mate] = [user(), user()];
    await groupOf(owner, mate);
    expect(await statusFor(mate, await recipeOf(owner), req)).toBe(404);
    expect(await statusFor(owner, await recipeOf(owner), req)).toBe(status);
  });

  it("group: a member gets the owner's status", async () => {
    const [creator, member] = [user(), user()];
    const f = await recipeOf(creator);
    await moveToGroup(f.id, await groupOf(creator, member));
    expect(await statusFor(member, f, req)).toBe(groupStatus ?? status);
  });

  it("group: a non-member gets 404", async () => {
    const creator = user();
    const f = await recipeOf(creator);
    await moveToGroup(f.id, await groupOf(creator, user()));
    expect(await statusFor(user(), f, req)).toBe(404);
  });

  it("group: a member who left gets 404, even the creator", async () => {
    const [creator, leaver] = [user(), user()];
    const f = await recipeOf(creator);
    const gid = await groupOf(creator, leaver);
    await moveToGroup(f.id, gid);
    await leave(gid, leaver);
    expect(await statusFor(leaver, f, req)).toBe(404);
    await leave(gid, creator); // user_id still names them, but group recipes go by membership only
    expect(await statusFor(creator, f, req)).toBe(404);
  });
});

describe("group recipes", () => {
  it("stay off the Home list of the creator and of members", async () => {
    const [creator, member] = [user(), user()];
    const personal = await recipeOf(creator);
    const grouped = await recipeOf(creator);
    await moveToGroup(grouped.id, await groupOf(creator, member));
    for (const email of [creator, member]) {
      const ids = ((await (await call(email, "/api/recipes")).json()) as RecipeSummary[]).map((r) => r.id);
      expect(ids).not.toContain(grouped.id);
      if (email === creator) expect(ids).toEqual([personal.id]);
    }
  });

  it("an adjustment's author is whoever wrote it last", async () => {
    const [creator, member] = [user(), user()];
    const f = await recipeOf(creator);
    await moveToGroup(f.id, await groupOf(creator, member));
    const authorOf = async (adjId: string) => (await get(creator, f.id)).adjustments.find((a) => a.id === adjId)?.author;
    expect(await authorOf(f.addId)).toBe(creator);

    const modify = { target_type: "ingredient", action: "modify", target_id: f.ingredientId };
    const created = (await (await call(creator, `/api/recipes/${f.id}/adjustments`, "POST", { ...modify, new_values: { amount: 400 } })).json()) as { id: string; author: string };
    expect(created.author).toBe(creator);
    await call(member, `/api/recipes/${f.id}/adjustments`, "POST", { ...modify, new_values: { amount: 500 } });
    expect(await authorOf(created.id)).toBe(member);

    await call(member, `/api/recipes/${f.id}/adjustments/${f.addId}`, "PATCH", { new_values: { name: "Pfeffer", amount: null, unit: "" } });
    expect(await authorOf(f.addId)).toBe(member);
  });
});
