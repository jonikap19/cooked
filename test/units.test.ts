import { describe, expect, it } from "vitest";
import { nameKey, normalizeUnit, toBase } from "../shared/units";

describe("units", () => {
  it("converts to base units", () => {
    expect(toBase(1.5, "kg")).toEqual({ amount: 1500, unit: "g" });
    expect(toBase(2, "dl")).toEqual({ amount: 200, unit: "ml" });
    expect(toBase(3, "cl")).toEqual({ amount: 30, unit: "ml" });
    expect(toBase(null, "l")).toEqual({ amount: null, unit: "ml" });
    expect(toBase(300, "mg")).toEqual({ amount: 0.3, unit: "g" });
    expect(toBase(7, "mg")).toEqual({ amount: 0.007, unit: "g" });
  });
  it("keeps base and other units", () => {
    expect(toBase(1, "")).toEqual({ amount: 1, unit: "Stück" });
    expect(toBase(2, "Bund")).toEqual({ amount: 2, unit: "Bund" });
    expect(toBase(5, "g")).toEqual({ amount: 5, unit: "g" });
    expect(toBase(5, "ml")).toEqual({ amount: 5, unit: "ml" });
  });
  it("normalizes unit case and whitespace", () => {
    expect(normalizeUnit("KG")).toEqual({ unit: "g", factor: 1000 });
    expect(normalizeUnit(" EL ")).toEqual({ unit: "EL", factor: 1 });
    expect(normalizeUnit("  ")).toEqual({ unit: "Stück", factor: 1 });
  });
  it("builds name keys", () => {
    expect(nameKey("  Zwiebeln,  rot ")).toBe("zwiebeln, rot");
    expect(nameKey("Zwiebeln,")).toBe("zwiebeln");
  });
});
