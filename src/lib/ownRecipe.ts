import { NewRecipe } from "../../shared/schema";
import { parseNumber } from "./edit";

// ponytail: one generic message, it does not name the field; upgrade path is one message per field.
const INVALID = "Bitte prüfe die Eingaben.";

export type OwnRecipeForm = {
  title: string;
  servings: string;
  totalMinutes: string;
  ingredients: { amount: string; unit: string; name: string }[];
  steps: { text: string; minutes: string }[];
};

export const blankIngredient = () => ({ amount: "", unit: "", name: "" });
export const blankStep = () => ({ text: "", minutes: "" });

export function blankForm(): OwnRecipeForm {
  return { title: "", servings: "2", totalMinutes: "", ingredients: [blankIngredient()], steps: [blankStep()] };
}

// Non-blank text that does not parse ("1/2", "ca. 30") must not silently become null.
const unreadable = (raw: string) => raw.trim() !== "" && parseNumber(raw) === null;

export function formToRecipe(form: OwnRecipeForm): { recipe: NewRecipe } | { error: string } {
  const title = form.title.trim();
  if (!title) return { error: "Bitte gib einen Titel ein." };
  const steps = form.steps.filter((step) => step.text.trim() !== "");
  if (steps.length === 0) return { error: "Mindestens ein Schritt" };

  const numbers = [form.totalMinutes, ...form.ingredients.map((ingredient) => ingredient.amount), ...steps.map((step) => step.minutes)];
  if (numbers.some(unreadable)) return { error: INVALID };

  const parsed = NewRecipe.safeParse({
    title,
    servings: parseNumber(form.servings),
    total_minutes: parseNumber(form.totalMinutes),
    ingredients: form.ingredients
      .filter((ingredient) => ingredient.name.trim() !== "")
      .map((ingredient) => ({ name: ingredient.name, amount: parseNumber(ingredient.amount), unit: ingredient.unit.trim() })),
    steps: steps.map((step) => ({ text: step.text, duration_minutes: parseNumber(step.minutes) })),
    source_url: null,
    source_platform: null,
    image_url: null,
  });
  return parsed.success ? { recipe: parsed.data } : { error: INVALID };
}
