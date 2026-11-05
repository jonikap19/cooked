import { describe, expect, it } from "vitest";
import {
  countLabel, detectPlatform, formatAmount, formatQuantity, formatShortDate,
  commentLabel, initials, placeholderColor, scaleAmount,
} from "../shared/format";

describe("format", () => {
  it("scales amounts and keeps null", () => {
    expect(scaleAmount(200, 2, 4)).toBe(400);
    expect(scaleAmount(null, 2, 4)).toBeNull();
  });
  it("formats amounts with German comma", () => {
    expect(formatAmount(1.5)).toBe("1,5");
    expect(formatAmount(1 / 3)).toBe("0,33");
    expect(formatAmount(2)).toBe("2");
    expect(formatAmount(null)).toBe("");
    expect(formatAmount(0.004)).toBe("0,004");
    expect(formatAmount(0)).toBe("0");
  });
  it("detects platform", () => {
    expect(detectPlatform("https://www.instagram.com/p/x")).toBe("instagram");
    expect(detectPlatform("https://youtu.be/x")).toBe("youtube");
    expect(detectPlatform("https://m.youtube.com/watch?v=x")).toBe("youtube");
    expect(detectPlatform("https://example.com/r")).toBe("web");
    expect(detectPlatform(null)).toBeNull();
  });
  it("labels counts", () => {
    expect(countLabel(1, "Anpassung", "Anpassungen")).toBe("1 Anpassung");
    expect(countLabel(3, "Anpassung", "Anpassungen")).toBe("3 Anpassungen");
  });
  it("formats quantity", () => {
    expect(formatQuantity(500, "g")).toBe("500 g");
    expect(formatQuantity(2, "Zehen")).toBe("2 Zehen");
    expect(formatQuantity(10, "")).toBe("10");
    expect(formatQuantity(null, "Prise")).toBe("Prise");
    expect(formatQuantity(null, "")).toBe("");
  });
  it("formats short date", () => {
    expect(formatShortDate("2026-10-28T10:00:00Z")).toBe("28. Okt.");
    expect(formatShortDate("not a date")).toBe("");
  });
  it("labels a comment with its author on group recipes only", () => {
    const me = "jonathan.kapfenstein@outlook.de";
    expect(commentLabel("anna.berg@example.com", me, true)).toBe("Kommentar · AB");
    expect(commentLabel(me, me, true)).toBe("Kommentar · Du");
    expect(commentLabel("anna.berg@example.com", me, false)).toBe("Kommentar");
    expect(commentLabel(undefined, me, true)).toBe("Kommentar");
  });

  it("builds initials", () => {
    expect(initials("jonathan.kapfenstein@outlook.de")).toBe("JK");
    expect(initials("anna@x.de")).toBe("AN");
  });
  it("picks a stable placeholder color", () => {
    expect(placeholderColor("abc")).toBe(placeholderColor("abc"));
    expect(placeholderColor("abc")).toMatch(/^#[0-9A-F]{6}$/);
  });
});
