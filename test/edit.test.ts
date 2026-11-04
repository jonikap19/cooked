import { describe, expect, it } from "vitest";
import { changedKeys, pantryAmount, parseNumber } from "../src/lib/edit";

describe("edit helpers", () => {
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
});
