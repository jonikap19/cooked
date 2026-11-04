export const remainingSeconds = (endAt: number, now: number) => Math.max(0, Math.ceil((endAt - now) / 1000));

/** State after pausing; a timer that expired since the last tick stays running, so it finishes and alarms like on a tick. */
export function pauseTimer(endAt: number, now: number) {
  const remaining = remainingSeconds(endAt, now);
  return remaining > 0 ? { endAt: null, remainingWhenPaused: remaining } : { endAt, remainingWhenPaused: null };
}

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function durationDiffLabel(original: number | null, current: number | null): string | null {
  if (original === null || current === null || original === current) return null;
  const d = current - original;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} Min`;
}

export type TimerChip = { index: number; seconds: number | null };

/** Timers running or finished on steps other than the current one; seconds is null once finished. */
export function timerChips(
  stepIds: string[],
  timers: Record<string, { endAt: number | null }>,
  currentIndex: number,
  now: number,
): TimerChip[] {
  const chips: TimerChip[] = [];
  stepIds.forEach((stepId, index) => {
    const endAt = timers[stepId]?.endAt;
    if (index === currentIndex || endAt == null) return;
    const seconds = remainingSeconds(endAt, now);
    chips.push({ index, seconds: seconds > 0 ? seconds : null });
  });
  return chips;
}
