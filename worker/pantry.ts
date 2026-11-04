import { Hono } from "hono";
import { addAmount, subtractAmount } from "../shared/pantry";
import { PantryAdd, PantryEdit, PantryKey, type PantryItem } from "../shared/schema";
import { toBase } from "../shared/units";
import type { AppEnv } from "./auth";
import { matchName } from "./match";
import { invalid, notFound, readJson } from "./recipes";

type Row = { canonical_name: string; unit: string; amount: number | null; always_at_home: number };
type Change = { canonical_name: string; unit: string; delta: number | null; op: "add" | "subtract" };

const keyOf = (name: string, unit: string) => JSON.stringify([name, unit]);
const toItem = (r: Row): PantryItem => ({ ...r, always_at_home: r.always_at_home === 1 });
// An item that reaches zero disappears unless it is "Immer da".
const isGone = (r: Pick<Row, "amount" | "always_at_home">) => r.amount === 0 && r.always_at_home === 0;

const SELECT = "SELECT canonical_name, unit, amount, always_at_home FROM pantry_items WHERE user_id = ?";
const upsert = (db: D1Database, userId: string, r: Row) =>
  db
    .prepare(
      `INSERT INTO pantry_items (user_id, canonical_name, unit, amount, always_at_home) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, canonical_name, unit) DO UPDATE SET amount = excluded.amount, always_at_home = excluded.always_at_home`,
    )
    .bind(userId, r.canonical_name, r.unit, r.amount, r.always_at_home);
const remove = (db: D1Database, userId: string, name: string, unit: string) =>
  db.prepare("DELETE FROM pantry_items WHERE user_id = ? AND canonical_name = ? AND unit = ?").bind(userId, name, unit);

/** The writes for all changes, applied in order from one read; batch them with other writes to stay atomic. Never creates a row on subtract. */
export async function pantryStatements(db: D1Database, userId: string, changes: Change[]): Promise<D1PreparedStatement[]> {
  if (!changes.length) return [];
  // ponytail: read-then-write, so concurrent edits of the same row can lose an update (fine for a few users); use a conditional UPDATE or single-statement SQL upsert if it matters.
  // ponytail: reads the user's whole Vorrat; fine for a few hundred rows, filter by key if it grows.
  const { results } = await db.prepare(SELECT).bind(userId).all<Row>();
  const rows = new Map(results.map((r) => [keyOf(r.canonical_name, r.unit), r]));
  const touched = new Set<string>();
  for (const c of changes) {
    const key = keyOf(c.canonical_name, c.unit);
    const row = rows.get(key);
    if (!row && c.op === "subtract") continue;
    const amount = c.op === "add" ? addAmount(row?.amount ?? null, c.delta) : subtractAmount(row!.amount, c.delta);
    rows.set(key, { canonical_name: c.canonical_name, unit: c.unit, amount, always_at_home: row?.always_at_home ?? 0 });
    touched.add(key);
  }
  return [...touched].map((key) => {
    const r = rows.get(key)!;
    return isGone(r) ? remove(db, userId, r.canonical_name, r.unit) : upsert(db, userId, r);
  });
}

/** pantryStatements written as one atomic batch. */
export async function applyToPantry(db: D1Database, userId: string, changes: Change[]): Promise<void> {
  const writes = await pantryStatements(db, userId, changes);
  if (writes.length) await db.batch(writes);
}

/** The user's whole Vorrat, sorted by name. */
export async function readPantry(db: D1Database, userId: string): Promise<PantryItem[]> {
  const { results } = await db.prepare(SELECT).bind(userId).all<Row>();
  return results.map(toItem).sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, "de"));
}

export const pantry = new Hono<AppEnv>();

pantry.get("/api/pantry", async (c) => c.json(await readPantry(c.env.DB, c.var.userId)));

pantry.post("/api/pantry", async (c) => {
  const parsed = PantryAdd.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { DB } = c.env;
  const uid = c.var.userId;
  const { name, amount, unit } = parsed.data;
  // The matcher only names the item: the typed amount stays in the typed unit, so it never crosses units.
  const { canonical_name } = await matchName(c.env, uid, name, unit);
  const base = toBase(amount, unit);
  await applyToPantry(DB, uid, [{ canonical_name, unit: base.unit, delta: base.amount, op: "add" }]);
  const row = await DB.prepare(`${SELECT} AND canonical_name = ? AND unit = ?`).bind(uid, canonical_name, base.unit).first<Row>();
  return c.json(toItem(row!));
});

pantry.patch("/api/pantry", async (c) => {
  const parsed = PantryEdit.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const { DB } = c.env;
  const uid = c.var.userId;
  const { set } = parsed.data;
  // ponytail: same read-then-write race as applyToPantry; conditional UPDATE / single-statement SQL upsert if it matters.
  const amountOf = (set.amount !== undefined);
  // One read for both the edited row and a possible collision target; the target key is only known after computing.
  const target0 = { name: set.canonical_name ?? parsed.data.canonical_name, unit: set.unit === undefined ? parsed.data.unit : toBase(null, set.unit).unit };
  const { results } = await DB.prepare(`${SELECT} AND ((canonical_name = ? AND unit = ?) OR (canonical_name = ? AND unit = ?))`)
    .bind(uid, parsed.data.canonical_name, parsed.data.unit, target0.name, target0.unit)
    .all<Row>();
  const pick = (name: string, unit: string) => results.find((r) => r.canonical_name === name && r.unit === unit);
  const current = pick(parsed.data.canonical_name, parsed.data.unit);
  if (!current) return c.json(notFound, 404);

  const amount = amountOf ? set.amount! : current.amount;
  const edited: Row = {
    canonical_name: target0.name,
    ...(set.unit === undefined ? { unit: current.unit, amount } : toBase(amount, set.unit)),
    always_at_home: set.always_at_home === undefined ? current.always_at_home : set.always_at_home ? 1 : 0,
  };
  const target = keyOf(edited.canonical_name, edited.unit) === keyOf(current.canonical_name, current.unit) ? undefined : pick(edited.canonical_name, edited.unit);
  const final: Row = target
    ? { ...edited, amount: addAmount(target.amount, edited.amount), always_at_home: target.always_at_home | edited.always_at_home }
    : edited;

  await DB.batch([
    remove(DB, uid, current.canonical_name, current.unit),
    isGone(final) ? remove(DB, uid, final.canonical_name, final.unit) : upsert(DB, uid, final),
  ]);
  return isGone(final) ? c.body(null, 204) : c.json(toItem(final));
});

pantry.delete("/api/pantry", async (c) => {
  const parsed = PantryKey.safeParse(await readJson(c));
  if (!parsed.success) return c.json(invalid, 400);
  const res = await remove(c.env.DB, c.var.userId, parsed.data.canonical_name, parsed.data.unit).run();
  return res.meta.changes ? c.body(null, 204) : c.json(notFound, 404);
});
