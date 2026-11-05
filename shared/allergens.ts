import { initials } from "./format";
import type { RecipeFull } from "./schema";
import { nameKey } from "./units";

// ponytail: keyword matching misses unlisted foods (e.g. "Rührei", "Pesto"); upgrade path: AI tagging at import.
// `keywords` match anywhere in the name, `words` only as a whole word ("ei" must not hit "Weißwein").
export const PRESETS: { name: string; keywords: string[]; words?: string[] }[] = [
  { name: "Gluten", keywords: ["weizen", "mehl", "dinkel", "roggen", "gerste", "nudel", "pasta", "spaghetti", "brot", "couscous", "bulgur", "paniermehl", "semmel"] },
  { name: "Laktose", keywords: ["milch", "sahne", "butter", "käse", "joghurt", "quark", "schmand", "mascarpone", "mozzarella", "parmesan", "frischkäse", "crème fraîche"] },
  { name: "Nüsse", keywords: ["nuss", "nüsse", "mandel", "cashew", "pistazie", "pekan", "macadamia"] },
  { name: "Erdnüsse", keywords: ["erdnuss", "erdnüsse"] },
  { name: "Ei", keywords: ["eier", "eigelb", "eiweiß"], words: ["ei"] },
  { name: "Fisch", keywords: ["fisch", "lachs", "thunfisch", "sardelle", "kabeljau"] },
  { name: "Krebstiere", keywords: ["garnele", "shrimp", "krabbe", "hummer"] },
  { name: "Soja", keywords: ["soja", "tofu", "edamame"] },
  { name: "Sellerie", keywords: ["sellerie"] },
  { name: "Senf", keywords: ["senf"] },
  { name: "Sesam", keywords: ["sesam", "tahin"] },
];

function matcher(allergen: string): (name: string) => boolean {
  const key = nameKey(allergen);
  const preset = PRESETS.find((p) => nameKey(p.name) === key);
  if (!preset) return (name) => nameKey(name).includes(key);
  return (name) => {
    const k = nameKey(name);
    const words = k.split(/[^\p{L}]+/u);
    return preset.keywords.some((w) => k.includes(w)) || !!preset.words?.some((w) => words.includes(w));
  };
}

/** Each allergen that at least one ingredient name hits, with those names in their given order. */
export function allergenHits(ingredientNames: string[], allergens: string[]): { allergen: string; names: string[] }[] {
  return allergens
    .map((allergen) => {
      const hits = matcher(allergen);
      return { allergen, names: ingredientNames.filter(hits) };
    })
    .filter((hit) => hit.names.length > 0);
}

/** "Enthält Nüsse (Haselnuss)" on a personal recipe; "JK: Laktose (Sahne)" per member on a group recipe ("Du" for me). */
export function allergyWarnings(ingredientNames: string[], allergies: RecipeFull["allergies"], me: string, inGroup: boolean): string[] {
  return allergies.flatMap(({ user_id, allergens }) =>
    allergenHits(ingredientNames, allergens).map(({ allergen, names }) => {
      const text = `${allergen} (${names.join(", ")})`;
      return inGroup ? `${user_id === me ? "Du" : initials(user_id)}: ${text}` : `Enthält ${text}`;
    }),
  );
}
