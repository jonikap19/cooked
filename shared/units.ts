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
  return CONVERTIBLE[trimmed.toLowerCase()] ?? { unit: trimmed, factor: 1 };
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
