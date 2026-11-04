import { describe, expect, it } from "vitest";
import type { Merged } from "../shared/merge";
import type { Ingredient, Match, PantryItem } from "../shared/schema";
import { computeShoppingList, scaledNeeds, type Need } from "../shared/shopping";

const need = (canonical_name: string, unit: string, amount: number | null, recipe_title: string, source_name = canonical_name): Need => ({
  canonical_name, unit, amount, recipe_title, source_name,
});
const stock = (canonical_name: string, unit: string, amount: number | null, always_at_home = false): PantryItem => ({
  canonical_name, unit, amount, always_at_home,
});
const ingredient = (id: string, name: string, amount: number | null, unit: string, status: Merged<Ingredient>["status"] = "original"): Merged<Ingredient> =>
  ({ id, position: 0, name, amount, unit, status, original: null, adjustmentIds: [] });

describe("scaledNeeds", () => {
  it("doubles amounts, skips removed, converts to base units", () => {
    const merged = [ingredient("a", "Mehl", 0.5, "kg"), ingredient("b", "Salz", 1, "TL", "removed")];
    const matches: Match[] = [{ target_id: "a", canonical_name: "Mehl", unit: "g" }];
    expect(scaledNeeds(merged, matches, 2, 4, "Brot")).toEqual([
      { canonical_name: "Mehl", unit: "g", amount: 1000, recipe_title: "Brot", source_name: "Mehl" },
    ]);
  });
  it("uses only the match name and ignores Match.unit", () => {
    const [result] = scaledNeeds([ingredient("a", "Zwiebeln", 2, "")], [{ target_id: "a", canonical_name: "Zwiebel", unit: "g" }], 1, 1, "T");
    expect(result).toMatchObject({ canonical_name: "Zwiebel", unit: "Stück", amount: 2, source_name: "Zwiebeln" });
  });
  it("falls back to the trimmed, capped ingredient name without a match", () => {
    const [result] = scaledNeeds([ingredient("a", `  ${"x".repeat(150)}  `, null, "")], [], 1, 1, "T");
    expect(result.canonical_name).toBe("x".repeat(100));
    expect(result.amount).toBeNull();
  });
});

describe("computeShoppingList", () => {
  it("rounds float residue so a covered need leaves no near-zero line", () => {
    const needs = [need("Hefe", "g", 0.1, "A"), need("Hefe", "g", 0.2, "B")];
    expect(computeShoppingList(needs, [stock("Hefe", "g", 0.3)], [])).toEqual([]);
    expect(computeShoppingList(needs, [stock("Hefe", "g", 0.1)], [])[0].amount).toBe(0.2);
  });
  it("sums needs of two recipes and subtracts stock", () => {
    const lines = computeShoppingList([need("Butter", "g", 50, "A"), need("Butter", "g", 30, "B")], [stock("Butter", "g", 20)], []);
    expect(lines).toEqual([
      { key: "butter|g", canonical_name: "Butter", unit: "g", amount: 60, recipes: ["A", "B"], source_names: ["Butter"], pantryHint: null, typedItemId: null },
    ]);
  });
  it("drops a line fully covered by stock", () => {
    expect(computeShoppingList([need("Butter", "g", 80, "A")], [stock("Butter", "g", 100)], [])).toEqual([]);
  });
  it("never lists Immer da items, in any unit", () => {
    expect(computeShoppingList([need("Salz", "g", 5, "A")], [stock("Salz", "TL", null, true)], [])).toEqual([]);
  });
  it("hints stock in another unit", () => {
    const [line] = computeShoppingList([need("Zwiebel", "g", 300, "A")], [stock("Zwiebel", "Stück", 2)], []);
    expect(line.amount).toBe(300);
    expect(line.pantryHint).toBe("im Vorrat: 2 Stück");
  });
  it("hints several other units, with etwas for unknown amounts", () => {
    const [line] = computeShoppingList([need("Zwiebel", "g", 300, "A")], [stock("Zwiebel", "Stück", 2.5), stock("Zwiebel", "kg", null)], []);
    expect(line.pantryHint).toBe("im Vorrat: 2,5 Stück, etwas kg");
  });
  it("keeps a null need as a null line, unless stock exists in that unit", () => {
    const [line] = computeShoppingList([need("Pfeffer", "", null, "A")], [], []);
    expect(line).toMatchObject({ amount: null, canonical_name: "Pfeffer" });
    expect(computeShoppingList([need("Pfeffer", "Stück", null, "A")], [stock("Pfeffer", "Stück", null)], [])).toEqual([]);
  });
  it("ignores a null need when summing numbers", () => {
    const [line] = computeShoppingList([need("Öl", "ml", null, "A"), need("Öl", "ml", 20, "B")], [], []);
    expect(line.amount).toBe(20);
  });
  it("appends typed items as their own lines", () => {
    const lines = computeShoppingList([], [], [{ id: "x1", canonical_name: "Klopapier", unit: "Stück", amount: 1 }]);
    expect(lines).toEqual([
      { key: "item:x1", canonical_name: "Klopapier", unit: "Stück", amount: 1, recipes: [], source_names: [], pantryHint: null, typedItemId: "x1" },
    ]);
  });
  it("merges spelling differences using the pantry spelling", () => {
    const [line, ...rest] = computeShoppingList([need("butter", "g", 50, "A"), need("Butter ", "g", 30, "B")], [stock("BUTTER", "g", 10)], []);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ key: "butter|g", canonical_name: "BUTTER", amount: 70 });
  });
  it("lists distinct source names", () => {
    const [line] = computeShoppingList([need("Zwiebel", "Stück", 1, "A", "Zwiebeln"), need("Zwiebel", "Stück", 1, "B", "Zwiebeln"), need("Zwiebel", "Stück", 1, "C", "rote Zwiebel")], [], []);
    expect(line.source_names).toEqual(["Zwiebeln", "rote Zwiebel"]);
  });
  it("sorts by displayed name", () => {
    const lines = computeShoppingList([need("Zucker", "g", 1, "A")], [], [{ id: "1", canonical_name: "Apfel", unit: "Stück", amount: 1 }]);
    expect(lines.map((l) => l.canonical_name)).toEqual(["Apfel", "Zucker"]);
  });
});
