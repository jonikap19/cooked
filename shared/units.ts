export const UNITS = ["", "g", "kg", "ml", "l", "EL", "TL", "Prise", "Msp", "Stück", "Bund", "Dose", "Packung", "Zehe", "Scheibe", "Becher", "Tasse"] as const;

const CONVERTIBLE: Record<string, { unit: string; factor: number }> = {
  g: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  mg: { unit: "g", factor: 0.001 },
  ml: { unit: "ml", factor: 1 },
  l: { unit: "ml", factor: 1000 },
  cl: { unit: "ml", factor: 10 },
  dl: { unit: "ml", factor: 100 },
};

export function normalizeUnit(unit: string): { unit: string; factor: number } {
  const trimmed = unit.trim();
  if (trimmed === "") return { unit: "Stück", factor: 1 };
  const key = trimmed.toLowerCase();
  // hasOwn: user-typed units like "constructor" must not hit Object.prototype.
  return (Object.hasOwn(CONVERTIBLE, key) ? CONVERTIBLE[key] : undefined) ?? { unit: trimmed, factor: 1 };
}

export function toBase(amount: number | null, unit: string): { amount: number | null; unit: string } {
  const { unit: baseUnit, factor } = normalizeUnit(unit);
  // Rounded because factors like 0.001 produce float noise (300 * 0.001 = 0.30000000000000004).
  return { amount: amount === null ? null : Math.round(amount * factor * 1e6) / 1e6, unit: baseUnit };
}

// Lookup and comparison only, never for display.
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ").replace(/,$/, "");
}
