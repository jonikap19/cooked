// "1,5" and "1.5" both work; empty or unparsable -> null.
export function parseNumber(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  return raw.trim() === "" || Number.isNaN(value) ? null : value;
}

// Only the keys whose value differs from `current`.
export function changedKeys<T extends object>(current: T, next: T): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== current[key]) changed[key] = next[key];
  }
  return changed;
}
