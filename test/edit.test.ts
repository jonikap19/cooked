import { describe, expect, it } from "vitest";
import { amountFromField, amountOptions, changedKeys, pantryAmount, parseNumber } from "../src/lib/edit";

describe("edit helpers", () => {
  it("keeps the stored amount when the rounded prefill is untouched", () => {
    expect(amountFromField("0,33", 0.3333)).toBe(0.3333);
    expect(amountFromField("0,5", 0.3333)).toBe(0.5);
    expect(amountFromField("", null)).toBeNull();
  });

  it("parses comma and dot decimals, empty as null", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber(" ")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
  it("decides the Vorrat amount: empty is null, zero only when allowed", () => {
    expect(pantryAmount("")).toEqual({ amount: null });
    expect(pantryAmount("1,5")).toEqual({ amount: 1.5 });
    expect(pantryAmount("0")).toHaveProperty("error");
    expect(pantryAmount("abc")).toHaveProperty("error");
    expect(pantryAmount("-1", true)).toHaveProperty("error");
    expect(pantryAmount("0", true)).toEqual({ amount: 0 });
  });
  it("keeps only differing keys", () => {
    expect(changedKeys({ name: "Mehl", amount: 120, unit: "g" }, { name: "Mehl", amount: 150, unit: "g" })).toEqual({ amount: 150 });
    expect(changedKeys({ text: "a", duration_minutes: 3 }, { text: "a", duration_minutes: null })).toEqual({ duration_minutes: null });
    expect(changedKeys({ a: 1 }, { a: 1 })).toEqual({});
  });
  it("lists the wheel amounts per unit and keeps a current amount outside the list", () => {
    const g = amountOptions("g", null);
    expect(g.slice(0, 6)).toEqual([25, 50, 75, 100, 150, 200]);
    expect(g.at(-1)).toBe(1000);
    expect(amountOptions("kg", null)).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    const piece = amountOptions("Stück", null);
    expect([piece[0], piece[1], piece.at(-1)]).toEqual([0.5, 1, 20]);
    expect(amountOptions("g", 130)).toContain(130);
    expect(amountOptions("g", 130)).toEqual([...amountOptions("g", 130)].sort((a, b) => a - b));
    expect(amountOptions("g", 50)).toEqual(g);
  });
});
