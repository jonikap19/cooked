import { useEffect, useState } from "react";

// Holds a screen wake lock while `active`; returns whether it is currently held.
export function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) return void next.release();
        lock = next;
        setHeld(true);
        next.addEventListener("release", () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    const onVisible = () => document.visibilityState === "visible" && void request();
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
      setHeld(false);
    };
  }, [active]);
  return held;
}
