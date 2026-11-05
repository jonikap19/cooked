import type { Adjustment, Ingredient, RecipeFull, Step } from "./schema";

export type Merged<T> = T & {
  status: "original" | "modified" | "added" | "removed";
  original: T | null;
  adjustmentIds: string[];
};

function mergeItems<T extends Ingredient | Step>(
  originals: T[],
  adjustments: Adjustment[],
): Merged<T>[] {
  const merged = originals.map((original): Merged<T> => {
    const own = adjustments.filter((a) => a.target_id === original.id);
    const modified = own.filter((a) => a.action === "modify").reduce((values, a) => ({ ...values, ...a.new_values }), original);
    const status = own.some((a) => a.action === "remove") ? "removed" : own.length ? "modified" : "original";
    return { ...modified, status, original, adjustmentIds: own.map((a) => a.id) };
  });
  // Stable sort: equal timestamps keep the API's list order, which is insertion order.
  const added = adjustments
    .filter((a) => a.action === "add")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const toItem = (a: Adjustment): Merged<T> =>
    ({
      ...(a.new_values as object),
      id: a.id,
      position: originals.length,
      status: "added",
      original: null,
      adjustmentIds: [a.id],
    }) as unknown as Merged<T>; // new_values of an add are validated as full values on write
  const originalIds = new Set(originals.map((o) => o.id));
  // an anchor that is not an original row falls back to the end, like no anchor
  const atEnd = added.filter((a) => !a.insert_after || !originalIds.has(a.insert_after)).map(toItem);
  return [
    ...merged.flatMap((item) => [item, ...added.filter((a) => a.insert_after === item.id).map(toItem)]),
    ...atEnd,
  ];
}

export function mergeRecipe(full: Pick<RecipeFull, "ingredients" | "steps" | "adjustments">) {
  const ofType = (type: Adjustment["target_type"]) => full.adjustments.filter((a) => a.target_type === type);
  return {
    ingredients: mergeItems(full.ingredients, ofType("ingredient")),
    steps: mergeItems(full.steps, ofType("step")),
    adjustmentCount: full.adjustments.length,
  };
}
