import { describe, expect, it } from "vitest";
import { detectDuration } from "../shared/duration";

describe("detectDuration", () => {
  it.each([
    ["10 Minuten köcheln", 10],
    ["ca. 10–12 Min. backen", 10],
    ["10-12 Minuten", 10],
    ["10 bis 12 Minuten", 10],
    ["1 Std. ruhen lassen", 60],
    ["1,5 Stunden schmoren", 90],
    ["eine halbe Stunde ziehen lassen", 30],
    ["eine Stunde ruhen", 60],
    ["anderthalb Stunden garen", 90],
    ["eineinhalb Stunden garen", 90],
    ["30 Sek. anbraten", 1],
    ["90 Sekunden rühren", 2],
    ["2 EL Öl erhitzen, dann 5 Minuten braten", 5],
    ["5 MIN braten", 5],
    ["10 Minuten kochen, dann 1 Std. ruhen", 10],
  ])("%s -> %i", (text, minutes) => {
    expect(detectDuration(text)).toBe(minutes);
  });

  it.each([
    "bei 180 Grad backen",
    "200 g Mehl",
    "über Nacht marinieren",
    "5 Minzblätter zugeben",
    "Stunde der Wahrheit",
    "",
  ])("%j -> null", (text) => {
    expect(detectDuration(text)).toBeNull();
  });
});
