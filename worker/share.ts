import { Hono } from "hono";
import { z } from "zod";
import { initials } from "../shared/format";
import type { AppEnv } from "./auth";
import { insertSnapshot, snapshotRecipe, type Snapshot } from "./copy";
import { tooManyRequests } from "./parse";
import { invalid, notFound, ownsRecipe, readJson } from "./recipes";

export const share = new Hono<AppEnv>();

const Mode = z.object({ mode: z.enum(["with_comments", "baked"]) });
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 864e5;
// ponytail: expired rows stay a week so a late click still gets 410 instead of 404; no cron, swept on read.
const SWEEP_AFTER_MS = 7 * DAY_MS;
const expired = { error: "Link abgelaufen" };

/** 32 random bytes as base64url without padding: 43 chars, 256 bits. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

share.post("/api/recipes/:id/share", async (c) => {
  const parsed = Mode.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { success } = await c.env.SOCIAL_LIMIT.limit({ key: `share:${c.var.userId}` });
  if (!success) return c.json(tooManyRequests, 429);
  const id = c.req.param("id");
  if (!(await ownsRecipe(c, id))) return c.json(notFound, 404);
  const snapshot = await snapshotRecipe(c.env.DB, id, parsed.data.mode);
  const token = newToken();
  const expiresAt = new Date(Date.now() + DAY_MS).toISOString();
  await c.env.DB.prepare("INSERT INTO share_links (token, created_by, payload, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, c.var.userId, JSON.stringify(snapshot), expiresAt)
    .run();
  return c.json({ url: `/teilen/${token}`, expires_at: expiresAt }, 201);
});

type ShareRow = { created_by: string; payload: string; expires_at: string };

/** The live share row, or the 404/410 response. Sweeps long-expired rows as a side effect. */
async function readShare(c: { env: AppEnv["Bindings"] }, token: string): Promise<ShareRow | 404 | 410> {
  if (!TOKEN.test(token)) return 404;
  const { DB } = c.env;
  const now = Date.now();
  const row = await DB.prepare("SELECT created_by, payload, expires_at FROM share_links WHERE token = ?").bind(token).first<ShareRow>();
  await DB.prepare("DELETE FROM share_links WHERE expires_at < ?").bind(new Date(now - SWEEP_AFTER_MS).toISOString()).run();
  if (!row) return 404;
  return row.expires_at <= new Date(now).toISOString() ? 410 : row;
}

share.get("/api/share/:token", async (c) => {
  const row = await readShare(c, c.req.param("token"));
  if (row === 404) return c.json(notFound, 404);
  if (row === 410) return c.json(expired, 410);
  const snapshot = JSON.parse(row.payload) as Snapshot;
  // No emails in the preview: note authors are dropped, the sharer shows as initials.
  const recipe = { ...snapshot, ingredient_notes: snapshot.ingredient_notes.map(({ author, ...note }) => note) };
  return c.json({ recipe, expires_at: row.expires_at, shared_by_initials: initials(row.created_by) });
});

share.post("/api/share/:token/import", async (c) => {
  const row = await readShare(c, c.req.param("token"));
  if (row === 404) return c.json(notFound, 404);
  if (row === 410) return c.json(expired, 410);
  // The payload was built and stored by this server at share time, never taken from a request.
  const id = await insertSnapshot(c.env, JSON.parse(row.payload) as Snapshot, { userId: c.var.userId, groupId: null });
  return c.json({ id }, 201);
});
