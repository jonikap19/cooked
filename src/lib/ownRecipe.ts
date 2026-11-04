import { NewRecipe } from "../../shared/schema";
import { parseNumber } from "./edit";

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

export function formToRecipe(form: OwnRecipeForm): { recipe: NewRecipe } | { error: string } {
  const title = form.title.trim();
  if (!title) return { error: "Bitte gib einen Titel ein." };
  const steps = form.steps.filter((step) => step.text.trim() !== "");
  if (steps.length === 0) return { error: "Mindestens ein Schritt" };

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
  return parsed.success ? { recipe: parsed.data } : { error: "Bitte prüfe die Eingaben." };
}
