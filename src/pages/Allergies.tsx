import { ChevronLeft, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { api, messageOf } from "../api";
import { PRESETS } from "../../shared/allergens";
import { nameKey } from "../../shared/units";

const isPreset = (allergen: string) => PRESETS.some((p) => p.name === allergen);

export default function Allergies() {
  const inputId = useId();
  const [allergens, setAllergens] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.getAllergies().then(setAllergens, (err) => setError(messageOf(err)));
  }, []);

  if (!allergens) {
    return <main className="page">{error ? <p className="error" role="alert">{error}</p> : <p className="empty">Lädt …</p>}</main>;
  }

  const change = (next: string[]) => {
    setAllergens(next);
    setStatus("");
  };
  const toggle = (name: string) => change(allergens.includes(name) ? allergens.filter((a) => a !== name) : [...allergens, name]);
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const allergen = draft.trim();
    if (!allergen || allergens.length >= 30 || allergens.some((a) => nameKey(a) === nameKey(allergen))) return;
    change([...allergens, allergen]);
    setDraft("");
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api.saveAllergies(allergens);
      setStatus("Gespeichert");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <header className="home-header">
        <Link to="/" className="round-button inline-round" aria-label="Zurück"><ChevronLeft aria-hidden="true" /></Link>
        <h1>Allergien & No-Gos</h1>
      </header>
      <p className="meta">Rezepte warnen, wenn eine Zutat passt. In Gruppen sehen die anderen Mitglieder deine Liste.</p>

      {PRESETS.map(({ name }) => (
        <label key={name} className="spice-check">
          <input type="checkbox" checked={allergens.includes(name)} onChange={() => toggle(name)} />
          {name}
        </label>
      ))}

      <div className="tag-list">
        {allergens.filter((a) => !isPreset(a)).map((allergen) => (
          <span key={allergen} className="tag-chip">
            {allergen}
            <button className="icon-button" aria-label={`${allergen} entfernen`} onClick={() => toggle(allergen)}>
              <X size={16} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={add}>
        <label className="field-label" htmlFor={inputId}>Eigenes No-Go</label>
        <input id={inputId} className="field" maxLength={40} placeholder="z. B. Koriander" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="add-item">Hinzufügen</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="meta" role="status">{status}</p>}
      <div className="sticky-bottom">
        <button className="primary-button" disabled={busy} onClick={() => void save()}>Speichern</button>
      </div>
    </main>
  );
}
