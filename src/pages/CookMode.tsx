import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError, api, SessionExpiredError } from "../api";
import CookedSheet from "../components/CookedSheet";
import { playAlarm, unlockAudio } from "../lib/alarm";
import { durationDiffLabel, formatClock, remainingSeconds, timerChips } from "../lib/timer";
import { useWakeLock } from "../lib/wakeLock";
import { detectDuration } from "../../shared/duration";
import { mergeRecipe, type Merged } from "../../shared/merge";
import type { RecipeFull, Step } from "../../shared/schema";

const R = 52;
const C = 2 * Math.PI * R;

type TimerState = { endAt: number | null; remainingWhenPaused: number | null };

// State lives in CookMode, so a running timer survives Zurück/Weiter.
function StepTimer({ step, minutes, fromText, state, now, onChange }: {
  step: Merged<Step>;
  minutes: number;
  fromText: boolean;
  state: TimerState;
  now: number;
  onChange: (state: TimerState) => void;
}) {
  const total = minutes * 60;
  const running = state.endAt !== null;
  const remaining = state.endAt !== null ? remainingSeconds(state.endAt, now) : (state.remainingWhenPaused ?? total);
  const done = running && remaining === 0;

  const start = (seconds: number) => {
    unlockAudio();
    onChange({ endAt: Date.now() + seconds * 1000, remainingWhenPaused: null });
  };
  const click = () => {
    if (done) start(total);
    else if (running) onChange({ endAt: null, remainingWhenPaused: remaining });
    else start(remaining);
  };
  const original = step.original?.duration_minutes ?? null;
  const label = fromText ? `${minutes} Min · aus dem Text erkannt`
    : step.status === "modified" && original !== null && original !== minutes
    ? `Original ${original} Min · bei dir ${minutes} Min`
    : `${minutes} Min`;
  const Icon = done ? RotateCcw : running ? Pause : Play;
  const text = done ? "Neu starten" : running ? "Pausieren" : state.remainingWhenPaused !== null ? "Fortsetzen" : "Timer starten";

  return (
    <section className="cook-timer">
      <div className="cook-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={R} className="cook-ring-track" />
          <circle cx="60" cy="60" r={R} className="cook-ring-arc" strokeDasharray={C} strokeDashoffset={C * (1 - remaining / total)} />
        </svg>
        <span className="cook-clock">{done ? "Fertig" : formatClock(remaining)}</span>
      </div>
      <div className="cook-timer-side">
        <p>{label}</p>
        <button className="cook-timer-btn" onClick={click}><Icon size={18} aria-hidden="true" />{text}</button>
      </div>
    </section>
  );
}

export default function CookMode() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [full, setFull] = useState<RecipeFull | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [cookedOpen, setCookedOpen] = useState(false);
  const [params] = useSearchParams();
  const fromQuery = Number(params.get("portionen"));
  const queryServings = Number.isInteger(fromQuery) && fromQuery >= 1 && fromQuery <= 100 ? fromQuery : null;
  const [plannedServings, setPlannedServings] = useState<number | null>(null);
  const [awake, setAwake] = useState(true);
  const held = useWakeLock(awake);
  const [timers, setTimers] = useState<Record<string, TimerState>>({});
  const [now, setNow] = useState(() => Date.now());
  const buzzed = useRef(new Set<string>());
  const anyRunning = Object.values(timers).some((t) => t.endAt !== null && remainingSeconds(t.endAt, now) > 0);

  useEffect(() => {
    if (!anyRunning) return;
    setNow(Date.now()); // the tick is off while idle, so `now` is stale when a timer starts
    const tick = setInterval(() => setNow(Date.now()), 1000); // only re-renders; time comes from endAt
    return () => clearInterval(tick);
  }, [anyRunning]);

  // Vibrate and beep once per finished timer, whether or not its step is displayed.
  useEffect(() => {
    for (const [stepId, t] of Object.entries(timers)) {
      const key = `${stepId}:${t.endAt}`;
      if (t.endAt !== null && remainingSeconds(t.endAt, now) === 0 && !buzzed.current.has(key)) {
        buzzed.current.add(key);
        navigator.vibrate?.(500);
        playAlarm();
      }
    }
  }, [timers, now]);

  const load = async () => {
    try {
      setFull(await api.getRecipe(id));
      setLoadError("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else if (err instanceof ApiError) setLoadError(err.message);
      else if (!(err instanceof SessionExpiredError)) setLoadError("Etwas ist schiefgelaufen. Bitte versuche es erneut.");
    }
  };
  useEffect(() => void load(), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only asked when the link carried no valid servings; a failure just falls back to the recipe's own.
  useEffect(() => {
    if (queryServings !== null) return;
    api.getList().then((body) => setPlannedServings(body.planned.find((p) => p.recipe_id === id)?.servings ?? null)).catch(() => {});
  }, [id, queryServings]);

  if (notFound) {
    return (
      <main className="page">
        <p>Rezept nicht gefunden</p>
        <Link to="/" className="text-button">Zurück</Link>
      </main>
    );
  }
  if (loadError && !full) {
    return (
      <main className="page">
        <p className="error" role="alert">{loadError}</p>
        <button className="text-button" onClick={() => void load()}>Erneut versuchen</button>
      </main>
    );
  }
  if (!full) return <main className="page"><p className="empty">Lädt …</p></main>;

  const steps = mergeRecipe(full).steps.filter((s) => s.status !== "removed");
  const step = steps[index];
  const last = index === steps.length - 1;
  const back = () => navigate(`/rezept/${id}`);
  const diff = step && durationDiffLabel(step.original?.duration_minutes ?? null, step.duration_minutes);
  const chips = timerChips(steps.map((s) => s.id), timers, index, now);
  const minutes = step ? step.duration_minutes ?? detectDuration(step.text) : null;
  const hint = step?.status === "added" ? "Von dir hinzugefügt"
    : step?.status === "modified" ? `Deine Anpassung: ${diff ?? "Text"}` : null;

  return (
    <main className="cook">
      <header className="cook-top">
        <button className="cook-icon" aria-label="Schließen" onClick={back}><X size={22} /></button>
        <span className="cook-title">{full.recipe.title}</span>
        <button className="cook-wake" aria-pressed={held} onClick={() => setAwake((a) => !a)}>
          <Sun size={18} aria-hidden="true" />{held ? "An" : "Aus"}
        </button>
      </header>
      {step ? (
        <>
          <p className="cook-count">Schritt {index + 1} von {steps.length}</p>
          <div className="cook-progress" aria-hidden="true">
            {steps.map((s, i) => <span key={s.id} className={i <= index ? "on" : ""} />)}
          </div>
          {hint && <span className="cook-hint">{hint}</span>}
          <p className="cook-text">{step.text}</p>
          {minutes !== null && (
            <StepTimer
              step={step}
              minutes={minutes}
              fromText={step.duration_minutes === null}
              state={timers[step.id] ?? { endAt: null, remainingWhenPaused: null }}
              now={now}
              onChange={(next) => {
                setNow(Date.now());
                setTimers((all) => ({ ...all, [step.id]: next }));
              }}
            />
          )}
        </>
      ) : <p className="cook-text">Keine Schritte vorhanden.</p>}
      {chips.length > 0 && (
        <div className="cook-chips">
          {chips.map(({ index: i, seconds }) => (
            <button key={steps[i].id} className="cook-chip" onClick={() => setIndex(i)}>
              Schritt {i + 1} · {seconds === null ? "Fertig" : formatClock(seconds)}
            </button>
          ))}
        </div>
      )}
      <nav className="cook-nav">
        <button className="cook-back" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={20} aria-hidden="true" />Zurück</button>
        {last || !step ? (
          <button className="cook-next" onClick={() => setCookedOpen(true)}>Fertig gekocht</button>
        ) : (
          <button className="cook-next" onClick={() => setIndex(index + 1)}>Weiter<ChevronRight size={20} aria-hidden="true" /></button>
        )}
      </nav>
      {cookedOpen && (
        <CookedSheet
          full={full}
          initialServings={queryServings ?? plannedServings ?? full.recipe.servings}
          onClose={() => setCookedOpen(false)}
        />
      )}
    </main>
  );
}
