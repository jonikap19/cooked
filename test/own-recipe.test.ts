import { describe, expect, it } from "vitest";
import { blankForm, formToRecipe } from "../src/lib/ownRecipe";

const filled = () => ({
  ...blankForm(),
  title: "Pfannkuchen",
  totalMinutes: "20",
  ingredients: [
    { amount: "1,5", unit: "EL", name: "Zucker" },
    { amount: "", unit: "", name: "Salz" },
    { amount: "3", unit: "g", name: "  " },
  ],
  steps: [
    { text: "Teig rühren", minutes: "5" },
    { text: " ", minutes: "9" },
    { text: "Backen", minutes: "" },
  ],
});

describe("formToRecipe", () => {
  it("builds a valid NewRecipe, parsing commas and dropping blank rows", () => {
    const result = formToRecipe(filled());
    expect(result).toEqual({
      recipe: {
        title: "Pfannkuchen",
        servings: 2,
        total_minutes: 20,
        ingredients: [
          { amount: 1.5, unit: "EL", name: "Zucker" },
          { amount: null, unit: "", name: "Salz" },
        ],
        steps: [
          { text: "Teig rühren", duration_minutes: 5 },
          { text: "Backen", duration_minutes: null },
        ],
        source_url: null,
        source_platform: null,
        image_url: null,
      },
    });
  });

  it("blank total minutes become null", () => {
    const result = formToRecipe({ ...filled(), totalMinutes: "" });
    expect("recipe" in result && result.recipe.total_minutes).toBeNull();
  });

  it("requires a title and a step", () => {
    expect(formToRecipe({ ...filled(), title: " " })).toEqual({ error: "Bitte gib einen Titel ein." });
    expect(formToRecipe({ ...filled(), steps: [{ text: "", minutes: "" }] })).toEqual({ error: "Mindestens ein Schritt" });
  });

  it("rejects values the schema refuses", () => {
    const error = { error: "Bitte prüfe die Eingaben." };
    expect(formToRecipe({ ...filled(), servings: "0" })).toEqual(error);
    expect(formToRecipe({ ...filled(), totalMinutes: "9999" })).toEqual(error);
    expect(formToRecipe({ ...filled(), steps: [{ text: "x", minutes: "1,5" }] })).toEqual(error);
  });

  it("rejects non-blank numbers it cannot read instead of dropping them", () => {
    const error = { error: "Bitte prüfe die Eingaben." };
    expect(formToRecipe({ ...filled(), ingredients: [{ amount: "1/2", unit: "", name: "Mehl" }] })).toEqual(error);
    expect(formToRecipe({ ...filled(), steps: [{ text: "x", minutes: "ca. 30" }] })).toEqual(error);
    expect(formToRecipe({ ...filled(), totalMinutes: "1.2.3" })).toEqual(error);
  });
});
