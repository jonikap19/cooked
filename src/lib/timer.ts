export const remainingSeconds = (endAt: number, now: number) => Math.max(0, Math.ceil((endAt - now) / 1000));

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function durationDiffLabel(original: number | null, current: number | null): string | null {
  if (original === null || current === null || original === current) return null;
  const d = current - original;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} Min`;
}
