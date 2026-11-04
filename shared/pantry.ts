// Null means "etwas da": it adds nothing to a number and takes nothing away.
export const addAmount = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b;

export const subtractAmount = (a: number | null, b: number | null): number | null =>
  a === null ? null : Math.max(0, a - (b ?? 0));
