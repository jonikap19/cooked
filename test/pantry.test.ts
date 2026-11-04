import { describe, expect, it } from "vitest";
import { addAmount, subtractAmount } from "../shared/pantry";

describe("pantry amounts", () => {
  it("adds with null meaning unknown", () => {
    expect(addAmount(null, 3)).toBe(3);
    expect(addAmount(3, null)).toBe(3);
    expect(addAmount(null, null)).toBeNull();
    expect(addAmount(2, 3)).toBe(5);
  });
  it("subtracts without going below zero or touching unknown stock", () => {
    expect(subtractAmount(2, 5)).toBe(0);
    expect(subtractAmount(5, 2)).toBe(3);
    expect(subtractAmount(null, 5)).toBeNull();
    expect(subtractAmount(5, null)).toBe(5);
  });
});
