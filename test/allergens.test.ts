import { describe, expect, it } from "vitest";
import { allergenHits, allergyWarnings } from "../shared/allergens";

describe("allergenHits", () => {
  it("matches preset keywords as substrings of the ingredient name", () => {
    expect(allergenHits(["Weizenmehl", "Sahne", "Zucker"], ["Gluten", "Laktose", "Nüsse"])).toEqual([
      { allergen: "Gluten", names: ["Weizenmehl"] },
      { allergen: "Laktose", names: ["Sahne"] },
    ]);
  });

  it('matches "ei" only as a whole word', () => {
    expect(allergenHits(["Eier", "1 Ei", "Weißwein", "Eigelb", "Reis"], ["Ei"])).toEqual([
      { allergen: "Ei", names: ["Eier", "1 Ei", "Eigelb"] },
    ]);
    expect(allergenHits(["Weißwein"], ["Ei"])).toEqual([]);
  });

  it("matches a custom allergen by its own name, case-insensitively", () => {
    expect(allergenHits(["frischer Koriander", "Petersilie"], [" koriander "])).toEqual([
      { allergen: " koriander ", names: ["frischer Koriander"] },
    ]);
  });

  it("finds a preset by name regardless of case", () => {
    expect(allergenHits(["Haselnüsse", "Mandeln"], ["nüsse"])).toEqual([{ allergen: "nüsse", names: ["Haselnüsse", "Mandeln"] }]);
  });
});

describe("allergyWarnings", () => {
  const allergies = [
    { user_id: "jana.kurz@example.com", allergens: ["Laktose"] },
    { user_id: "me@example.com", allergens: ["Nüsse"] },
  ];

  it("prefixes group warnings with initials and Du for the caller", () => {
    expect(allergyWarnings(["Sahne", "Haselnuss"], allergies, "me@example.com", true)).toEqual([
      "JK: Laktose (Sahne)",
      "Du: Nüsse (Haselnuss)",
    ]);
  });

  it('starts personal warnings with "Enthält"', () => {
    expect(allergyWarnings(["Haselnuss"], [allergies[1]], "me@example.com", false)).toEqual(["Enthält Nüsse (Haselnuss)"]);
  });
});
