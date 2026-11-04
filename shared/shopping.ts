import { formatAmount, scaleAmount } from "./format";
import type { Merged } from "./merge";
import { addAmount, subtractAmount } from "./pantry";
import type { Ingredient, Match, PantryItem } from "./schema";
import { nameKey, toBase } from "./units";

export type Need = { canonical_name: string; unit: string; amount: number | null; recipe_title: string; source_name: string };

export type ShoppingLine = {
  key: string;
  canonical_name: string;
  unit: string;
  amount: number | null;
  recipes: string[];
  source_names: string[];
  pantryHint: string | null;
  typedItemId: string | null;
};

type TypedItem = { id: string; canonical_name: string; unit: string; amount: number | null };

export function scaledNeeds(merged: Merged<Ingredient>[], matches: Match[], baseServings: number, servings: number, title: string): Need[] {
  // Only the match's name is used: Match.unit is the AI's unit, the amount stays in the ingredient's own unit.
  const matchedName = new Map(matches.map((match) => [match.target_id, match.canonical_name]));
  return merged
    .filter((item) => item.status !== "removed")
    .map((item) => {
      const { amount, unit } = toBase(scaleAmount(item.amount, baseServings, servings), item.unit);
      return {
        canonical_name: matchedName.get(item.id) ?? item.name.trim().slice(0, 100),
        unit,
        amount,
        recipe_title: title,
        source_name: item.name,
      };
    });
}

const distinct = (values: string[]) => [...new Set(values)];

export function computeShoppingList(needs: Need[], pantry: PantryItem[], typed: TypedItem[]): ShoppingLine[] {
  const groups = new Map<string, Need[]>();
  for (const need of needs) {
    const key = `${nameKey(need.canonical_name)}|${need.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), need]);
  }

  const lines: ShoppingLine[] = [];
  for (const [key, group] of groups) {
    const name = nameKey(group[0].canonical_name);
    const unit = group[0].unit;
    const sameName = pantry.filter((row) => nameKey(row.canonical_name) === name);
    if (sameName.some((row) => row.always_at_home)) continue;

    const inStock = sameName.filter((row) => row.unit === unit);
    const needed = group.reduce<number | null>((sum, need) => addAmount(sum, need.amount), null);
    // A null need is covered by any stock row; a number is reduced by the summed stock (null stock takes nothing away).
    const amount = needed === null ? null : subtractAmount(needed, inStock.reduce<number | null>((sum, row) => addAmount(sum, row.amount), null));
    if (needed === null ? inStock.length > 0 : amount === null || amount <= 0) continue;

    const others = sameName.filter((row) => row.unit !== unit);
    lines.push({
      key,
      canonical_name: sameName[0]?.canonical_name ?? group[0].canonical_name,
      unit,
      amount,
      recipes: distinct(group.map((need) => need.recipe_title)),
      source_names: distinct(group.map((need) => need.source_name)),
      pantryHint: others.length
        ? "im Vorrat: " + others.map((row) => (row.amount === null ? `etwas ${row.unit}` : `${formatAmount(row.amount)} ${row.unit}`)).join(", ")
        : null,
      typedItemId: null,
    });
  }

  for (const item of typed) {
    lines.push({ key: `item:${item.id}`, canonical_name: item.canonical_name, unit: item.unit, amount: item.amount, recipes: [], source_names: [], pantryHint: null, typedItemId: item.id });
  }
  return lines.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, "de"));
}
