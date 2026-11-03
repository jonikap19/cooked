import { useEffect, useId, useRef, useState } from "react";
import { changedKeys, parseNumber } from "../lib/edit";
import type { Merged } from "../../shared/merge";
import type { Ingredient, IngredientValues, Step, StepValues } from "../../shared/schema";

type Values = IngredientValues | StepValues;

interface Props {
  kind: "ingredient" | "step";
  item: Merged<Ingredient> | Merged<Step> | null; // null = new item
  servingsHint: number | null; // set when the stepper differs from the base servings
  onSave(values: Values): void; // add: full values; added: full values; else only changed keys
  onReset(): void;
  onRemove(): void;
  onDelete(): void;
  onClose(): void;
  serverError: string;
  busy: boolean;
}

export default function EditSheet({ kind, item, servingsHint, onSave, onReset, onRemove, onDelete, onClose, serverError, busy }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = [useId(), useId(), useId()];
  const ingredient = kind === "ingredient" ? (item as Merged<Ingredient> | null) : null;
  const step = kind === "step" ? (item as Merged<Step> | null) : null;
  const [amount, setAmount] = useState(String(ingredient?.amount ?? "").replace(".", ","));
  const [unit, setUnit] = useState(ingredient?.unit ?? "");
  const [name, setName] = useState(ingredient?.name ?? "");
  const [text, setText] = useState(step?.text ?? "");
  const [duration, setDuration] = useState(step?.duration_minutes?.toString() ?? "");
  const [error, setError] = useState("");

  useEffect(() => dialog.current?.showModal(), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (kind === "ingredient" ? !name.trim() : !text.trim()) {
      setError(kind === "ingredient" ? "Bitte einen Namen eingeben." : "Bitte einen Text eingeben.");
      return;
    }
    const next: Values =
      kind === "ingredient"
        ? { name: name.trim(), amount: parseNumber(amount), unit: unit.trim() }
        : { text: text.trim(), duration_minutes: parseNumber(duration) };
    if (!item || item.status === "added") return onSave(next);
    const changed = changedKeys(item as unknown as Values, next);
    if (Object.keys(changed).length === 0) return onClose();
    onSave(changed as Values);
  };

  const title = `${kind === "ingredient" ? "Zutat" : "Schritt"} ${item ? "bearbeiten" : "hinzufügen"}`;

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <form className="sheet-body" onSubmit={submit}>
        <h2>{title}</h2>
        {kind === "ingredient" ? (
          <>
            {servingsHint && <p className="hint">Mengen für {servingsHint} Portionen</p>}
            <label className="field-label" htmlFor={ids[0]}>Menge</label>
            <input id={ids[0]} className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <label className="field-label" htmlFor={ids[1]}>Einheit</label>
            <input id={ids[1]} className="field" maxLength={30} value={unit} onChange={(e) => setUnit(e.target.value)} />
            <label className="field-label" htmlFor={ids[2]}>Name</label>
            <input id={ids[2]} className="field" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </>
        ) : (
          <>
            <label className="field-label" htmlFor={ids[0]}>Text</label>
            <textarea id={ids[0]} className="field" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
            <label className="field-label" htmlFor={ids[1]}>Dauer in Min</label>
            <input id={ids[1]} className="field" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </>
        )}
        {(error || serverError) && <p className="error" role="alert">{error || serverError}</p>}
        <button type="submit" className="primary-button inline" disabled={busy}>Speichern</button>
        {item?.status === "modified" && (
          <button type="button" className="text-button adj" disabled={busy} onClick={onReset}>Auf Original zurücksetzen</button>
        )}
        {item && item.status !== "added" && (
          <button type="button" className="text-button adj" disabled={busy} onClick={onRemove}>Entfernen</button>
        )}
        {item?.status === "added" && (
          <button type="button" className="text-button adj" disabled={busy} onClick={onDelete}>Löschen</button>
        )}
      </form>
    </dialog>
  );
}
