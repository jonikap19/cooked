import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, messageOf } from "../api";
import { pantryAmount } from "../lib/edit";
import { formatAmount } from "./PantrySheet";
import { mergeRecipe } from "../../shared/merge";
import type { Match, PantryItem, RecipeFull } from "../../shared/schema";
import { scaledNeeds } from "../../shared/shopping";
import { nameKey } from "../../shared/units";

type Row = { canonical_name: string; unit: string; amount: string; include: boolean; locked: boolean };

interface Props {
  full: RecipeFull;
  initialServings: number;
  onClose(): void;
}

export default function CookedSheet({ full, initialServings, onClose }: Props) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [servings, setServings] = useState(initialServings);
  const [data, setData] = useState<{ matches: Match[]; pantry: PantryItem[] } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { id, servings: baseServings, title } = full.recipe;

  useEffect(() => dialog.current?.showModal(), []);
  useEffect(() => {
    Promise.all([api.getMatches(id), api.listPantry()])
      .then(([matches, pantry]) => setData({ matches, pantry }))
      .catch((err) => setError(messageOf(err)));
  }, [id]);

  // ponytail: changing the servings recomputes every row, so hand-edited amounts are reset; keep edits per row if that annoys.
  useEffect(() => {
    if (!data) return;
    const alwaysAtHome = new Set(data.pantry.filter((p) => p.always_at_home).map((p) => nameKey(p.canonical_name)));
    const needs = scaledNeeds(mergeRecipe(full).ingredients, data.matches, baseServings, servings, title);
    setRows(
      needs.map((need) => {
        const locked = need.amount === null || alwaysAtHome.has(nameKey(need.canonical_name));
        return { canonical_name: need.canonical_name, unit: need.unit, amount: need.amount === null ? "" : formatAmount(need.amount), include: !locked, locked };
      }),
    );
  }, [data, servings, full, baseServings, title]);

  const update = (index: number, change: Partial<Row>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const items: { canonical_name: string; unit: string; amount: number }[] = [];
    for (const row of rows) {
      if (!row.include || row.locked) continue;
      const parsed = pantryAmount(row.amount, true);
      if ("error" in parsed) return setError(`${row.canonical_name}: Bitte eine gültige Menge eingeben.`);
      if (parsed.amount !== null) items.push({ canonical_name: row.canonical_name, unit: row.unit, amount: parsed.amount });
    }
    setBusy(true);
    try {
      await api.cooked(id, items);
      navigate(`/rezept/${id}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <form className="sheet-body" onSubmit={submit}>
        <h2>Fertig gekocht</h2>
        <div className="servings">
          <strong>Portionen</strong>
          <div className="stepper">
            <button type="button" className="step-soft" aria-label="Weniger Portionen" disabled={servings <= 1} onClick={() => setServings(servings - 1)}><Minus aria-hidden="true" /></button>
            <strong>{servings}</strong>
            <button type="button" className="step-solid" aria-label="Mehr Portionen" disabled={servings >= 100} onClick={() => setServings(servings + 1)}><Plus aria-hidden="true" /></button>
          </div>
        </div>
        {!data && !error && <p className="empty">Lädt …</p>}
        <ul className="checkout-list">
          {rows.map((row, index) => (
            <li key={index} className={`cooked-row${row.locked ? " is-locked" : ""}`}>
              <input
                type="checkbox"
                aria-label={`${row.canonical_name} abziehen`}
                checked={row.include}
                disabled={row.locked}
                onChange={(e) => update(index, { include: e.target.checked })}
              />
              <label htmlFor={`cooked-${index}`}>{row.canonical_name}{row.unit && ` (${row.unit})`}</label>
              <input
                id={`cooked-${index}`}
                className="field"
                inputMode="decimal"
                disabled={row.locked || !row.include}
                value={row.amount}
                onChange={(e) => update(index, { amount: e.target.value })}
              />
            </li>
          ))}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary-button inline" disabled={busy || !data}>Vom Vorrat abziehen</button>
        <button type="button" className="text-button" onClick={onClose}>Schließen</button>
      </form>
    </dialog>
  );
}
