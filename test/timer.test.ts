import { describe, expect, it } from "vitest";
import { durationDiffLabel, formatClock, remainingSeconds, timerChips } from "../src/lib/timer";

describe("timer", () => {
  const now = 1_000_000;
  it("computes remaining from end timestamp", () => {
    expect(remainingSeconds(now + 8 * 60_000, now)).toBe(480);
    expect(remainingSeconds(now - 5000, now)).toBe(0);
    expect(remainingSeconds(now + 1500, now)).toBe(2);
  });
  it("formats clock", () => {
    expect(formatClock(480)).toBe("8:00");
    expect(formatClock(5)).toBe("0:05");
  });
  it("labels duration diff", () => {
    expect(durationDiffLabel(6, 8)).toBe("+2 Min");
    expect(durationDiffLabel(8, 7)).toBe("−1 Min");
    expect(durationDiffLabel(6, 6)).toBeNull();
    expect(durationDiffLabel(null, 6)).toBeNull();
  });
  it("lists running and finished timers of other steps only", () => {
    const timers = {
      a: { endAt: now + 90_000 },
      b: { endAt: now - 1000 },
      c: { endAt: null },
      d: { endAt: now + 5000 },
    };
    expect(timerChips(["a", "b", "c", "d"], timers, 3, now)).toEqual([
      { index: 0, seconds: 90 },
      { index: 1, seconds: null },
    ]);
  });
});
