let context: AudioContext | undefined;

// iOS only allows audio after a user gesture, so call this from the "Timer starten" tap.
export function unlockAudio() {
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {
    // no Web Audio: the visible "Fertig" state still shows
  }
}

/** Three short beeps. Never throws. */
export function playAlarm() {
  try {
    if (!context) return;
    const start = context.currentTime;
    for (let i = 0; i < 3; i++) {
      const beep = context.createOscillator();
      beep.frequency.value = 880;
      beep.connect(context.destination);
      beep.start(start + i * 0.35);
      beep.stop(start + i * 0.35 + 0.2);
    }
  } catch {
    // ignore
  }
}
