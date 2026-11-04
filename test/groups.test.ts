import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { RecipeFull, RecipeSummary } from "../shared/schema";
import type { Env } from "../worker/index";
import { authHeaders, testApp, testEnv } from "./helpers";

const app = testApp();
let n = 0;
const user = () => `groups${++n}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function call(email: string, path: string, method = "GET", body?: unknown, overrides: Partial<Env> = {}) {
  return app.request(
    path,
    { method, headers: await authHeaders(email), body: body === undefined ? undefined : JSON.stringify(body) },
    testEnv(overrides),
  );
}
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;
const get = (email: string, id: string) => json<RecipeFull>(call(email, `/api/recipes/${id}`));

type GroupDetail = { id: string; name: string; members: string[]; invites: string[]; recipes: RecipeSummary[] };
type GroupRow = { id: string; name: string; member_count: number; recipe_count: number };
const detail = (email: string, gid: string) => json<GroupDetail>(call(email, `/api/groups/${gid}`));

async function createGroup(email: string, name = "WG") {
  const res = await call(email, "/api/groups", "POST", { name });
  expect(res.status).toBe(201);
  return (await res.json<{ id: string }>()).id;
}
const invite = (from: string, gid: string, email: string) => call(from, `/api/groups/${gid}/invites`, "POST", { email });

/** A group of `owner` that every other member has joined through the invite flow. */
async function groupWith(owner: string, ...others: string[]) {
  const gid = await createGroup(owner);
  for (const o of others) {
    expect((await invite(owner, gid, o)).status).toBe(204);
    expect((await call(o, `/api/invites/${gid}/accept`, "POST")).status).toBe(204);
  }
  return gid;
}

/** A personal recipe with a modify adjustment and an image. */
async function recipeOf(email: string) {
  const { id } = await json<{ id: string }>(
    call(email, "/api/recipes", "POST", {
      title: "Suppe",
      servings: 2,
      total_minutes: null,
      ingredients: [{ name: "Karotten", amount: 300, unit: "g" }],
      steps: [{ text: "Kochen", duration_minutes: null }],
      source_url: null,
      source_platform: null,
    }),
  );
  const ingredientId = (await get(email, id)).ingredients[0].id;
  await call(email, `/api/recipes/${id}/adjustments`, "POST", {
    target_type: "ingredient", action: "modify", target_id: ingredientId, new_values: { amount: 400 },
  });
  await env.IMAGES.put(id, new Uint8Array([1]), { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare("UPDATE recipes SET image_url = ? WHERE id = ?").bind(`/api/images/${id}`, id).run();
  return id;
}

async function shareToGroup(email: string, recipeId: string, gid: string) {
  const res = await call(email, `/api/recipes/${recipeId}/share-to-group`, "POST", { group_id: gid });
  expect(res.status).toBe(201);
  return (await res.json<{ id: string }>()).id;
}

describe("groups", () => {
  it("create, invite Bob, Bob accepts: Bob sees the group and its recipes", async () => {
    const [alice, bob] = [user(), user()];
    const gid = await createGroup(alice, "  Familie  ");
    const shared = await shareToGroup(alice, await recipeOf(alice), gid);

    expect((await invite(alice, gid, ` ${bob.toUpperCase()} `)).status).toBe(204);
    expect(await json(call(bob, "/api/invites"))).toEqual([{ group_id: gid, group_name: "Familie", invited_by: alice }]);
    expect((await detail(alice, gid)).invites).toEqual([bob]);
    expect((await call(bob, `/api/groups/${gid}`)).status).toBe(404);

    expect((await call(bob, `/api/invites/${gid}/accept`, "POST")).status).toBe(204);
    expect(await json(call(bob, "/api/invites"))).toEqual([]);
    expect(await json<GroupRow[]>(call(bob, "/api/groups"))).toEqual([{ id: gid, name: "Familie", member_count: 2, recipe_count: 1 }]);
    const d = await detail(bob, gid);
    expect(d).toMatchObject({ id: gid, name: "Familie", invites: [] });
    expect(d.members.sort()).toEqual([alice, bob].sort());
    expect(d.recipes.map((r) => [r.id, r.group_id, r.adjustment_count, r.ingredient_names])).toEqual([[shared, gid, 1, ["Karotten"]]]);
    expect((await get(bob, shared)).recipe.title).toBe("Suppe");
  });

  it("Bob declines: the invite is gone and he is not a member", async () => {
    const [alice, bob] = [user(), user()];
    const gid = await createGroup(alice);
    await invite(alice, gid, bob);
    expect((await call(bob, `/api/invites/${gid}`, "DELETE")).status).toBe(204);
    expect(await json(call(bob, "/api/invites"))).toEqual([]);
    expect((await detail(alice, gid)).invites).toEqual([]);
    expect((await call(bob, `/api/invites/${gid}/accept`, "POST")).status).toBe(404);
    expect((await call(bob, `/api/invites/${gid}`, "DELETE")).status).toBe(404);
  });

  it("caps the email at 254 characters", async () => {
    const alice = user();
    const gid = await createGroup(alice);
    // Short local part and 63-char labels, so only the overall length can reject it.
    const emailOfLength = (n: number) => `a@${["b".repeat(63), "b".repeat(63), "b".repeat(63), "b".repeat(n - 2 - 63 * 3 - 3)].join(".")}`;
    expect(emailOfLength(254)).toHaveLength(254);
    expect((await invite(alice, gid, emailOfLength(254))).status).toBe(204);
    expect((await invite(alice, gid, emailOfLength(255))).status).toBe(400);
  });

  it("only the invited email can accept or decline", async () => {
    const [alice, bob, carol] = [user(), user(), user()];
    const gid = await createGroup(alice);
    await invite(alice, gid, bob);
    expect((await call(carol, `/api/invites/${gid}/accept`, "POST")).status).toBe(404);
    expect((await call(carol, `/api/invites/${gid}`, "DELETE")).status).toBe(404);
    expect(await json(call(carol, "/api/invites"))).toEqual([]);
    expect((await call(carol, `/api/groups/${gid}`)).status).toBe(404);
    expect((await detail(alice, gid)).invites).toEqual([bob]);
  });

  it("non-members can't invite, and members can't see invites addressed to others", async () => {
    const [alice, bob, mallory] = [user(), user(), user()];
    const gid = await createGroup(alice);
    expect((await invite(mallory, gid, bob)).status).toBe(404);
    expect((await invite(mallory, crypto.randomUUID(), bob)).status).toBe(404);
    expect(await json(call(bob, "/api/invites"))).toEqual([]);
  });

  it("inviting is idempotent for members and pending invites", async () => {
    const [alice, bob, carol] = [user(), user(), user()];
    const gid = await groupWith(alice, bob);
    expect((await invite(alice, gid, bob)).status).toBe(204);
    expect((await invite(alice, gid, carol)).status).toBe(204);
    expect((await invite(bob, gid, carol)).status).toBe(204);
    expect(await detail(alice, gid)).toMatchObject({ invites: [carol] });
    expect(await json(call(carol, "/api/invites"))).toEqual([{ group_id: gid, group_name: "WG", invited_by: alice }]);
  });

  it("self-invite and invalid emails → 400", async () => {
    const alice = user();
    const gid = await createGroup(alice);
    expect((await invite(alice, gid, ` ${alice.toUpperCase()}`)).status).toBe(400);
    expect((await invite(alice, gid, "not-an-email")).status).toBe(400);
    expect((await call(alice, `/api/groups/${gid}/invites`, "POST", {})).status).toBe(400);
    expect((await detail(alice, gid)).invites).toEqual([]);
  });

  it("the 21st pending invite → 400", async () => {
    const alice = user();
    const gid = await createGroup(alice);
    for (let i = 0; i < 20; i++) expect((await invite(alice, gid, user())).status).toBe(204);
    expect((await invite(alice, gid, user())).status).toBe(400);
  });

  it("a full group (20 members) takes no invites and no accepts", async () => {
    const alice = user();
    const gid = await createGroup(alice);
    const [late, waiting] = [user(), user()];
    await invite(alice, gid, waiting);
    await env.DB.batch(
      Array.from({ length: 19 }, () => env.DB.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").bind(gid, user())),
    );
    expect((await invite(alice, gid, late)).status).toBe(400);
    expect((await call(waiting, `/api/invites/${gid}/accept`, "POST")).status).toBe(400);
  });

  it("the 21st group → 400, for creating and for accepting", async () => {
    const [alice, bob] = [user(), user()];
    const pending = await createGroup(bob);
    await invite(bob, pending, alice);
    for (let i = 0; i < 20; i++) await createGroup(alice);
    expect((await call(alice, "/api/groups", "POST", { name: "Zu viel" })).status).toBe(400);
    expect((await call(alice, `/api/invites/${pending}/accept`, "POST")).status).toBe(400);
    expect(await json<GroupRow[]>(call(alice, "/api/groups"))).toHaveLength(20);
  });

  it("group names are trimmed, 1–60 chars", async () => {
    const alice = user();
    for (const name of ["", "   ", "x".repeat(61), 5]) expect((await call(alice, "/api/groups", "POST", { name })).status).toBe(400);
    expect((await call(alice, "/api/groups", "POST", { name: "x".repeat(60) })).status).toBe(201);
  });

  it("SOCIAL_LIMIT is keyed invite:<userId> → 429", async () => {
    const alice = user();
    const gid = await createGroup(alice);
    const keys: string[] = [];
    const deny = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } as unknown as RateLimit;
    expect((await call(alice, `/api/groups/${gid}/invites`, "POST", { email: user() }, { SOCIAL_LIMIT: deny })).status).toBe(429);
    expect(keys).toEqual([`invite:${alice}`]);
    expect((await detail(alice, gid)).invites).toEqual([]);
  });
});

describe("share to group", () => {
  it("copies into the group; the copy and the personal recipe are independent", async () => {
    const [alice, bob] = [user(), user()];
    const gid = await groupWith(alice, bob);
    const personal = await recipeOf(alice);
    const copy = await shareToGroup(alice, personal, gid);

    const before = await get(alice, personal);
    const grouped = await get(bob, copy);
    expect(grouped.recipe.group_id).toBe(gid);
    expect(before.recipe.group_id).toBeNull();
    expect(grouped.adjustments.map((a) => a.author)).toEqual([alice]);
    expect((await env.IMAGES.get(copy))?.body).toBeTruthy();
    // stays off both Home lists
    for (const email of [alice, bob]) expect((await json<RecipeSummary[]>(call(email, "/api/recipes"))).map((r) => r.id)).not.toContain(copy);

    expect((await call(bob, `/api/recipes/${copy}`, "PATCH", { tags: ["Gruppe"] })).status).toBe(204);
    expect((await call(bob, `/api/recipes/${copy}/note`, "PUT", { text: "Bob war hier" })).status).toBe(204);
    expect(await get(alice, personal)).toEqual(before);

    const groupedNow = await get(bob, copy);
    expect((await call(alice, `/api/recipes/${personal}`, "PATCH", { tags: ["Privat"] })).status).toBe(204);
    expect(
      (await call(alice, `/api/recipes/${personal}/adjustments`, "POST", {
        target_type: "step", action: "add", target_id: null, new_values: { text: "Würzen", duration_minutes: null },
      })).status,
    ).toBe(201);
    expect(await get(bob, copy)).toEqual(groupedNow);
  });

  it("Bob's adjustment on a group recipe carries author = Bob", async () => {
    const [alice, bob] = [user(), user()];
    const gid = await groupWith(alice, bob);
    const copy = await shareToGroup(alice, await recipeOf(alice), gid);
    const { id } = await json<{ id: string }>(
      call(bob, `/api/recipes/${copy}/adjustments`, "POST", {
        target_type: "ingredient", action: "add", target_id: null, new_values: { name: "Salz", amount: null, unit: "" },
      }),
    );
    expect((await get(alice, copy)).adjustments.find((a) => a.id === id)?.author).toBe(bob);
  });

  it("404 unless the sharer can see the source and is a member of the target group", async () => {
    const [alice, bob] = [user(), user()];
    const mine = await recipeOf(alice);
    const notMine = await createGroup(bob);
    const ownGroup = await createGroup(alice);
    expect((await call(alice, `/api/recipes/${mine}/share-to-group`, "POST", { group_id: notMine })).status).toBe(404);
    expect((await call(bob, `/api/recipes/${mine}/share-to-group`, "POST", { group_id: notMine })).status).toBe(404);
    expect((await call(alice, `/api/recipes/${mine}/share-to-group`, "POST", {})).status).toBe(400);
    // a group recipe cannot be shared again
    const copy = await shareToGroup(alice, mine, ownGroup);
    expect((await call(alice, `/api/recipes/${copy}/share-to-group`, "POST", { group_id: ownGroup })).status).toBe(404);
    expect((await detail(bob, notMine)).recipes).toEqual([]);
    expect((await detail(alice, ownGroup)).recipes.map((r) => r.id)).toEqual([copy]);
  });
});

describe("leaving", () => {
  // Straight from the table: /api/list already hides recipes the user can no longer see.
  const plannedOf = async (email: string) =>
    (await env.DB.prepare("SELECT recipe_id FROM planned_recipes WHERE user_id = ?").bind(email).all<{ recipe_id: string }>()).results.map((p) => p.recipe_id);
  const matchCount = async (email: string, recipeId: string) =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM ingredient_matches WHERE user_id = ? AND recipe_id = ?").bind(email, recipeId).first<{ n: number }>())!.n;
  const addMatch = (email: string, recipeId: string) =>
    env.DB.prepare("INSERT INTO ingredient_matches (recipe_id, target_id, user_id, source_name, canonical_name, unit) VALUES (?, 't', ?, 'Karotten', 'Karotte', 'g')")
      .bind(recipeId, email)
      .run();

  it("removes my planned entries and matches for the group's recipes, keeps the rest", async () => {
    const [alice, bob] = [user(), user()];
    const gid = await groupWith(alice, bob);
    const copy = await shareToGroup(alice, await recipeOf(alice), gid);
    const bobsOwn = await recipeOf(bob);
    for (const [email, id] of [[bob, copy], [bob, bobsOwn], [alice, copy]]) {
      expect((await call(email, "/api/list/recipes", "POST", { recipe_id: id, servings: 2 })).status).toBe(204);
      await addMatch(email, id);
    }

    expect((await call(bob, `/api/groups/${gid}/members/me`, "DELETE")).status).toBe(204);
    expect(await plannedOf(bob)).toEqual([bobsOwn]);
    expect(await matchCount(bob, copy)).toBe(0);
    expect(await matchCount(bob, bobsOwn)).toBeGreaterThan(0);
    expect(await plannedOf(alice)).toEqual([copy]);
    expect(await matchCount(alice, copy)).toBeGreaterThan(0);
    expect((await call(bob, `/api/recipes/${copy}`)).status).toBe(404);
    expect((await call(bob, `/api/groups/${gid}`)).status).toBe(404);
    expect((await detail(alice, gid)).members).toEqual([alice]);
    expect((await call(bob, `/api/groups/${gid}/members/me`, "DELETE")).status).toBe(404);
  });

  it("the last member leaving deletes the group, its recipes, their rows and R2 objects", async () => {
    const [alice, bob, carol] = [user(), user(), user()];
    const gid = await groupWith(alice, bob);
    const personal = await recipeOf(alice);
    const copies = [await shareToGroup(alice, personal, gid), await shareToGroup(alice, personal, gid)];
    await invite(alice, gid, carol);
    expect(await env.IMAGES.head(copies[0])).not.toBeNull();

    expect((await call(alice, `/api/groups/${gid}/members/me`, "DELETE")).status).toBe(204);
    expect(await env.DB.prepare("SELECT 1 FROM groups WHERE id = ?").bind(gid).first()).not.toBeNull();
    expect((await call(bob, `/api/groups/${gid}/members/me`, "DELETE")).status).toBe(204);

    const count = async (sql: string, ...binds: string[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
    expect(await count("SELECT COUNT(*) AS n FROM groups WHERE id = ?", gid)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM group_invites WHERE group_id = ?", gid)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM recipes WHERE group_id = ?", gid)).toBe(0);
    for (const id of copies) {
      expect(await count("SELECT COUNT(*) AS n FROM recipes WHERE id = ?", id)).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM ingredients WHERE recipe_id = ?", id)).toBe(0);
      expect(await count("SELECT COUNT(*) AS n FROM adjustments WHERE recipe_id = ?", id)).toBe(0);
      expect(await env.IMAGES.head(id)).toBeNull();
    }
    expect(await json(call(carol, "/api/invites"))).toEqual([]);
    // the personal source is untouched
    expect((await get(alice, personal)).recipe.id).toBe(personal);
    expect(await env.IMAGES.head(personal)).not.toBeNull();
  });
});
