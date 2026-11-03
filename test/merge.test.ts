import { describe, expect, it } from "vitest";
import { mergeRecipe } from "../shared/merge";
import type { Adjustment, RecipeFull } from "../shared/schema";

const recipe = {
  id: "r1", title: "T", source_url: null, source_platform: null, image_url: null,
  servings: 2, total_minutes: null, tags: [], created_at: "2026-01-01",
};
const flour = { id: "i1", position: 0, name: "Mehl", amount: 120, unit: "g" };
const salt = { id: "i2", position: 1, name: "Salz", amount: null, unit: "" };
const stepOne = { id: "s1", position: 0, text: "Kochen", duration_minutes: 6 };

const adjustment = (over: Partial<Adjustment>): Adjustment => ({
  id: "a1", target_type: "ingredient", target_id: "i1", action: "modify",
  new_values: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...over,
});
const full = (adjustments: Adjustment[]): RecipeFull => ({
  recipe, ingredients: [flour, salt], steps: [stepOne], adjustments, note: "",
});

describe("mergeRecipe", () => {
  it("keeps originals without adjustments", () => {
    const merged = mergeRecipe(full([]));
    expect(merged.adjustmentCount).toBe(0);
    expect(merged.ingredients.map((i) => i.status)).toEqual(["original", "original"]);
    expect(merged.ingredients[1].amount).toBeNull();
    expect(merged.steps[0].status).toBe("original");
  });

  it("applies a modify and keeps the original", () => {
    const merged = mergeRecipe(full([adjustment({ new_values: { amount: 150 } })]));
    const item = merged.ingredients[0];
    expect(item.status).toBe("modified");
    expect(item.amount).toBe(150);
    expect(item.name).toBe("Mehl");
    expect(item.original?.amount).toBe(120);
    expect(item.adjustmentIds).toEqual(["a1"]);
    expect(merged.adjustmentCount).toBe(1);
  });

  it("marks a modified step", () => {
    const merged = mergeRecipe(full([
      adjustment({ target_type: "step", target_id: "s1", new_values: { duration_minutes: 8 } }),
    ]));
    expect(merged.steps[0]).toMatchObject({ status: "modified", duration_minutes: 8, text: "Kochen" });
    expect(merged.steps[0].original?.duration_minutes).toBe(6);
  });

  it("marks a removal", () => {
    const merged = mergeRecipe(full([adjustment({ action: "remove" })]));
    expect(merged.ingredients[0].status).toBe("removed");
    expect(merged.ingredients[0].name).toBe("Mehl");
  });

  it("appends additions with the adjustment id, sorted by created_at", () => {
    const later = adjustment({
      id: "a2", action: "add", target_id: null, created_at: "2026-01-03T00:00:00Z",
      new_values: { name: "Zucker", amount: 1, unit: "EL" },
    });
    const earlier = adjustment({
      id: "a3", action: "add", target_id: null, created_at: "2026-01-02T00:00:00Z",
      new_values: { name: "Butter", amount: null, unit: "" },
    });
    const merged = mergeRecipe(full([later, earlier]));
    expect(merged.ingredients.map((i) => i.id)).toEqual(["i1", "i2", "a3", "a2"]);
    expect(merged.ingredients[2]).toMatchObject({ status: "added", original: null, adjustmentIds: ["a3"] });
    expect(merged.adjustmentCount).toBe(2);
  });

  it("shows modified values for a modified and removed item", () => {
    const merged = mergeRecipe(full([
      adjustment({ new_values: { amount: 150 } }),
      adjustment({ id: "a2", action: "remove" }),
    ]));
    expect(merged.ingredients[0]).toMatchObject({ status: "removed", amount: 150, adjustmentIds: ["a1", "a2"] });
    expect(merged.adjustmentCount).toBe(2);
  });
});
