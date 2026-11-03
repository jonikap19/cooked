import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api, SessionExpiredError } from "../api";
import { durationDiffLabel, formatClock, remainingSeconds } from "../lib/timer";
import { useWakeLock } from "../lib/wakeLock";
import { mergeRecipe, type Merged } from "../../shared/merge";
import type { RecipeFull, Step } from "../../shared/schema";

const R = 52;
const C = 2 * Math.PI * R;

type TimerState = { endAt: number | null; remainingWhenPaused: number | null };

// Keyed by step in the parent, so changing step resets it.
function StepTimer({ step, minutes }: { step: Merged<Step>; minutes: number }) {
  const total = minutes * 60;
  const [state, setState] = useState<TimerState>({ endAt: null, remainingWhenPaused: null });
  const [now, setNow] = useState(() => Date.now());
  const running = state.endAt !== null;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000); // only re-renders; time comes from endAt
    return () => clearInterval(timer);
  }, [running]);

  const remaining = state.endAt !== null ? remainingSeconds(state.endAt, now) : (state.remainingWhenPaused ?? total);
  const done = running && remaining === 0;

  useEffect(() => {
    if (done) navigator.vibrate?.(500);
  }, [done]);

  const start = (seconds: number) => {
    const t = Date.now();
    setNow(t);
    setState({ endAt: t + seconds * 1000, remainingWhenPaused: null });
  };
  const click = () => {
    if (done) start(total);
    else if (running) setState({ endAt: null, remainingWhenPaused: remaining });
    else start(remaining);
  };
  const original = step.original?.duration_minutes ?? null;
  const label = step.status === "modified" && original !== null && original !== minutes
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
  const [awake, setAwake] = useState(true);
  const held = useWakeLock(awake);

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
          {step.duration_minutes !== null && <StepTimer key={step.id} step={step} minutes={step.duration_minutes} />}
        </>
      ) : <p className="cook-text">Keine Schritte vorhanden.</p>}
      <nav className="cook-nav">
        <button className="cook-back" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={20} aria-hidden="true" />Zurück</button>
        <button className="cook-next" onClick={() => (last || !step ? back() : setIndex(index + 1))}>
          {last || !step ? "Fertig" : <>Weiter<ChevronRight size={20} aria-hidden="true" /></>}
        </button>
      </nav>
    </main>
  );
}
