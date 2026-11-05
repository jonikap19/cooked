import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import UnitSelect from "./UnitSelect";
import { amountOptions, pantryAmount } from "../lib/edit";
import { nameKey } from "../../shared/units";
import type { PantryItem } from "../../shared/schema";

// No thousands separator, so parseNumber reads the edit prefill back.
export const formatAmount = (amount: number) => amount.toLocaleString("de-DE", { maximumFractionDigits: 3, useGrouping: false });

interface SheetProps {
  item: PantryItem | null; // null = new item
  onSave(name: string, amount: number | null, unit: string, spice: boolean): void;
  spiceOption?: boolean; // only the Vorrat sets the flag
  onDelete?(): void; // only offered for an existing item
  onClose(): void;
  error: string;
  busy: boolean;
}

export default function PantrySheet({ item, onSave, spiceOption = false, onDelete, onClose, error: serverError, busy }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = [useId(), useId(), useId(), useId()];
  const [amount, setAmount] = useState(item?.amount == null ? "" : String(item.amount));
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [name, setName] = useState(item?.canonical_name ?? "");
  const [spice, setSpice] = useState(item?.spice ?? false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<{ name: string; unit: string }[]>([]);
  // The suggested unit only fills in until the user picks one themselves.
  const unitPicked = useRef(item !== null);

  useEffect(() => dialog.current?.showModal(), []);
  // A failed fetch just means no suggestions.
  useEffect(() => void api.pantrySuggestions().then(setSuggestions, () => undefined), []);

  const options = amountOptions(unit, item?.amount ?? null, item?.always_at_home);

  const changeName = (value: string) => {
    setName(value);
    const suggestion = suggestions.find((s) => nameKey(s.name) === nameKey(value));
    if (suggestion && !unitPicked.current) changeUnit(suggestion.unit);
  };
  const changeUnit = (value: string) => {
    setUnit(value);
    // A wheel value that does not exist for the new unit would show as another one.
    if (!amountOptions(value, item?.amount ?? null, item?.always_at_home).includes(Number(amount))) setAmount("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Bitte einen Namen eingeben.");
    const parsed = pantryAmount(amount, item?.always_at_home);
    if ("error" in parsed) return setError(parsed.error);
    onSave(name.trim(), parsed.amount, unit.trim(), spiceOption && spice);
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <form className="sheet-body" onSubmit={submit}>
        <h2>{item ? "Artikel bearbeiten" : "Artikel hinzufügen"}</h2>
        <label className="field-label" htmlFor={ids[0]}>Name</label>
        <input id={ids[0]} className="field" maxLength={100} list={ids[3]} value={name} onChange={(e) => changeName(e.target.value)} />
        <datalist id={ids[3]}>
          {suggestions.map((s) => <option key={s.name} value={s.name} />)}
        </datalist>
        <label className="field-label" htmlFor={ids[1]}>Einheit</label>
        <UnitSelect id={ids[1]} value={unit} onChange={(value) => { unitPicked.current = true; changeUnit(value); }} />
        <label className="field-label" htmlFor={ids[2]}>Menge</label>
        <select id={ids[2]} className="field" value={amount} onChange={(e) => setAmount(e.target.value)}>
          <option value="">etwas</option>
          {options.map((n) => <option key={n} value={String(n)}>{formatAmount(n)}</option>)}
        </select>
        {spiceOption && (
          <label className="spice-check">
            <input type="checkbox" checked={spice} onChange={(e) => setSpice(e.target.checked)} /> Gewürz
          </label>
        )}
        {(error || serverError) && <p className="error" role="alert">{error || serverError}</p>}
        <button type="submit" className="primary-button inline" disabled={busy}>Speichern</button>
        {item && onDelete && (
          <button type="button" className="text-button" disabled={busy} onClick={onDelete}>Löschen</button>
        )}
        <button type="button" className="text-button" disabled={busy} onClick={onClose}>Abbrechen</button>
      </form>
    </dialog>
  );
}
