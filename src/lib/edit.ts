import { formatAmount } from "../../shared/format";

// "1,5" and "1.5" both work; empty or unparsable -> null.
export function parseNumber(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  return raw.trim() === "" || Number.isNaN(value) ? null : value;
}

// The sheet prefills a rounded amount; an untouched field must keep the exact stored value.
export function amountFromField(raw: string, stored: number | null): number | null {
  return raw === formatAmount(stored) ? stored : parseNumber(raw);
}

// Amount field of a Vorrat sheet: empty = "etwas" (null); otherwise a positive number.
// A zero is only valid when editing an "Immer da" row, which stays at 0 instead of being deleted.
export function pantryAmount(raw: string, allowZero = false): { amount: number | null } | { error: string } {
  if (raw.trim() === "") return { amount: null };
  const amount = parseNumber(raw);
  if (amount === null || amount < 0 || (amount === 0 && !allowZero)) return { error: "Bitte eine Menge größer als 0 eingeben." };
  return { amount };
}

// Only the keys whose value differs from `current`.
export function changedKeys<T extends object>(current: T, next: T): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== current[key]) changed[key] = next[key];
  }
  return changed;
}

const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

// Values of the amount wheel for a unit; an amount outside the list (an existing item) stays selectable.
// An "Immer da" item (allowZero) may rest at 0.
export function amountOptions(unit: string, current: number | null, allowZero = false): number[] {
  const options =
    unit === "g" || unit === "ml"
      ? [25, 50, 75, 100, ...range(150, 1000, 50)]
      : unit === "kg" || unit === "l"
        ? [0.25, 0.5, 0.75, ...range(1, 5, 0.5)]
        : [0.5, ...range(1, 20, 1)];
  const extra = [...(allowZero ? [0] : []), ...(current === null ? [] : [current])].filter((n) => !options.includes(n));
  return [...new Set([...options, ...extra])].sort((a, b) => a - b);
}
