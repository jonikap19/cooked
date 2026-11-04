import { describe, expect, it } from "vitest";
import { Adjustment, AdjustmentInput, NewRecipe } from "../shared/schema";

const ok = (input: unknown) => AdjustmentInput.safeParse(input).success;
const recipe = {
  title: "T", servings: 2, total_minutes: null, ingredients: [],
  steps: [{ text: "x", duration_minutes: null }], source_platform: null,
};

describe("AdjustmentInput", () => {
  it("accepts valid add, modify, remove", () => {
    expect(ok({ target_type: "ingredient", action: "add", target_id: null, new_values: { name: "A", amount: null, unit: "" } })).toBe(true);
    expect(ok({ target_type: "step", action: "modify", target_id: "s1", new_values: { duration_minutes: 8 } })).toBe(true);
    expect(ok({ target_type: "step", action: "remove", target_id: "s1" })).toBe(true);
  });
  it("rejects invalid combinations", () => {
    expect(ok({ target_type: "ingredient", action: "add", target_id: "i1", new_values: { name: "A", amount: 1, unit: "" } })).toBe(false);
    expect(ok({ target_type: "ingredient", action: "add", target_id: null, new_values: { name: "A" } })).toBe(false);
    expect(ok({ target_type: "ingredient", action: "modify", target_id: "i1", new_values: {} })).toBe(false);
    expect(ok({ target_type: "ingredient", action: "modify", target_id: null, new_values: { amount: 1 } })).toBe(false);
    expect(ok({ target_type: "step", action: "modify", target_id: "s1", new_values: { amount: 1 } })).toBe(false);
    expect(ok({ target_type: "step", action: "remove", target_id: null })).toBe(false);
    expect(ok({ target_type: "ingredient", action: "modify", target_id: "i1", new_values: { amount: 100_001 } })).toBe(false);
  });
});

describe("NewRecipe source_url", () => {
  it("allows https and null only", () => {
    expect(NewRecipe.safeParse({ ...recipe, source_url: "https://example.com/r" }).success).toBe(true);
    expect(NewRecipe.safeParse({ ...recipe, source_url: null }).success).toBe(true);
    expect(NewRecipe.safeParse({ ...recipe, source_url: "http://example.com" }).success).toBe(false);
    expect(NewRecipe.safeParse({ ...recipe, source_url: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("Adjustment round trip", () => {
  const base = { id: "a1", target_id: "x", insert_after: null, author: null, created_at: "t", updated_at: "t" };
  it.each([
    { target_type: "step", action: "modify", new_values: { duration_minutes: 8 } },
    { target_type: "ingredient", action: "modify", new_values: { amount: 150 } },
    { target_type: "ingredient", action: "add", new_values: { name: "A", amount: null, unit: "g" } },
    { target_type: "step", action: "add", new_values: { text: "Rühren", duration_minutes: null } },
  ])("keeps new_values of $target_type $action", (variant) => {
    const adjustment = { ...base, ...variant };
    expect(Adjustment.parse(adjustment)).toEqual(adjustment);
  });
});

describe("trimming", () => {
  it("trims ingredient names and step texts, and still exports JSON schema", async () => {
    const { IngredientValues, StepValues, ParsedRecipe } = await import("../shared/schema");
    expect(IngredientValues.parse({ name: " Salz ", amount: null, unit: "" }).name).toBe("Salz");
    expect(StepValues.parse({ text: " x ", duration_minutes: null }).text).toBe("x");
    expect(IngredientValues.safeParse({ name: "  ", amount: null, unit: "" }).success).toBe(false);
    const { z } = await import("zod");
    expect(() => z.toJSONSchema(ParsedRecipe)).not.toThrow();
  });
});
