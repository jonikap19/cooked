import { describe, expect, it } from "vitest";
import { changedKeys, parseNumber } from "../src/lib/edit";

describe("edit helpers", () => {
  it("parses comma and dot decimals, empty as null", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber(" ")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
  it("keeps only differing keys", () => {
    expect(changedKeys({ name: "Mehl", amount: 120, unit: "g" }, { name: "Mehl", amount: 150, unit: "g" })).toEqual({ amount: 150 });
    expect(changedKeys({ text: "a", duration_minutes: 3 }, { text: "a", duration_minutes: null })).toEqual({ duration_minutes: null });
    expect(changedKeys({ a: 1 }, { a: 1 })).toEqual({});
  });
});
