import { Check, ChevronLeft, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, api, SessionExpiredError } from "../api";
import { detectPlatform, formatQuantity, platformLabel } from "../../shared/format";
import type { NewRecipe, ParsedRecipe } from "../../shared/schema";

type Platform = NewRecipe["source_platform"];

const PLATFORMS = ["instagram", "youtube", "web"] as const;

// Empty -> null; a missing scheme gets https:// (http:// is sent as-is so the server's 400 explains it).
function normalizeLink(raw: string): string | null {
  const link = raw.trim();
  if (!link) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `https://${link}`;
}

export default function AddRecipe() {
  const navigate = useNavigate();
  const textId = useId();
  const linkId = useId();
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [platform, setPlatform] = useState<Platform>(null);
  const [platformTouched, setPlatformTouched] = useState(false);
  const [parsed, setParsed] = useState<ParsedRecipe | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await action();
    } catch (err) {
      // Session expiry shows the global banner.
      if (err instanceof ApiError) setError(err.message);
      else if (!(err instanceof SessionExpiredError)) setError("Etwas ist schiefgelaufen. Bitte versuche es erneut.");
    } finally {
      setPending(false);
    }
  };

  const parse = () => run(async () => setParsed(await api.parse(text)));
  const save = () =>
    run(async () => {
      if (!parsed) return;
      const { id } = await api.createRecipe({ ...parsed, source_url: normalizeLink(link), source_platform: platform });
      navigate(`/rezept/${id}`);
    });

  const changeLink = (value: string) => {
    setLink(value);
    if (!platformTouched) setPlatform(detectPlatform(normalizeLink(value)));
  };
  const pickPlatform = (value: (typeof PLATFORMS)[number]) => {
    setPlatformTouched(true);
    setPlatform(platform === value ? null : value);
  };

  const canParse = text.trim() !== "" && !pending;
  const extra = parsed ? parsed.ingredients.length - 3 : 0;

  return (
    <main className="page">
      <header className="add-header">
        <button className="icon-button" onClick={() => navigate("/")} aria-label="Zurück">
          <ChevronLeft />
        </button>
        <h1>Rezept hinzufügen</h1>
      </header>

      <div className="segmented">
        <button disabled>
          Link einfügen <span className="pill">Bald</span>
        </button>
        <button className="active" aria-pressed="true">
          Text einfügen
        </button>
      </div>

      <label className="field-label" htmlFor={textId}>
        Caption oder Rezepttext
      </label>
      <textarea
        id={textId}
        className="field"
        rows={6}
        maxLength={10000}
        readOnly={pending}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setParsed(null);
        }}
      />

      <p className="field-label" id="platform-label">
        Quelle
      </p>
      <div className="chips add-chips" role="group" aria-labelledby="platform-label">
        {PLATFORMS.map((value) => (
          <button
            key={value}
            className={`chip${platform === value ? " active" : ""}`}
            aria-pressed={platform === value}
            onClick={() => pickPlatform(value)}
          >
            {platformLabel(value)}
          </button>
        ))}
      </div>

      <label className="field-label meta" htmlFor={linkId}>
        Link zum Original (optional)
      </label>
      <input
        id={linkId}
        className="field"
        type="text"
        inputMode="url"
        autoCapitalize="none"
        value={link}
        onChange={(event) => changeLink(event.target.value)}
      />

      {!parsed && (
        <button className="primary-button inline" disabled={!canParse} onClick={parse}>
          {pending && <LoaderCircle className="spin" />}
          {pending ? "Wird erkannt …" : "Rezept erkennen"}
        </button>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {parsed && (
        <section className="card preview">
          <div className="preview-head">
            <span className="check">
              <Check size={20} />
            </span>
            <strong>Rezept erkannt</strong>
          </div>
          <h2>{parsed.title}</h2>
          <div className="stats">
            <Stat value={parsed.ingredients.length} label="Zutaten" />
            <Stat value={parsed.steps.length} label="Schritte" />
            <Stat value={parsed.total_minutes ?? "–"} label="Minuten" />
            <Stat value={parsed.servings} label="Portionen" />
          </div>
          <ul className="preview-ingredients">
            {parsed.ingredients.slice(0, 3).map((ingredient, index) => (
              <li key={index}>
                <strong>{formatQuantity(ingredient.amount, ingredient.unit)}</strong>
                <span>{ingredient.name}</span>
              </li>
            ))}
          </ul>
          {extra > 0 && <p className="meta">+ {extra} weitere Zutaten</p>}
          {platform && <p className="meta small">Quelle: {platformLabel(platform)}</p>}
          <p className="hint">Bitte kurz prüfen, Mengen aus dem Video können fehlen.</p>
        </section>
      )}

      {parsed && (
        <div className="sticky-bottom">
          <button className="primary-button" disabled={pending} onClick={save}>
            {pending && <LoaderCircle className="spin" />}
            {pending ? "Wird gespeichert …" : "Ins Kochbuch speichern"}
          </button>
        </div>
      )}
    </main>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
