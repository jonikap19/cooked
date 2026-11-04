import { useEffect, useId, useRef, useState } from "react";
import { pantryAmount } from "../lib/edit";
import type { PantryItem } from "../../shared/schema";

// No thousands separator, so parseNumber reads the edit prefill back.
export const formatAmount = (amount: number) => amount.toLocaleString("de-DE", { maximumFractionDigits: 3, useGrouping: false });

interface SheetProps {
  item: PantryItem | null; // null = new item
  onSave(name: string, amount: number | null, unit: string): void;
  onDelete?(): void; // only offered for an existing item
  onClose(): void;
  error: string;
  busy: boolean;
}

export default function PantrySheet({ item, onSave, onDelete, onClose, error: serverError, busy }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = [useId(), useId(), useId()];
  const [amount, setAmount] = useState(item?.amount == null ? "" : formatAmount(item.amount));
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [name, setName] = useState(item?.canonical_name ?? "");
  const [error, setError] = useState("");

  useEffect(() => dialog.current?.showModal(), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Bitte einen Namen eingeben.");
    const parsed = pantryAmount(amount, item?.always_at_home);
    if ("error" in parsed) return setError(parsed.error);
    onSave(name.trim(), parsed.amount, unit.trim());
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <form className="sheet-body" onSubmit={submit}>
        <h2>{item ? "Artikel bearbeiten" : "Artikel hinzufügen"}</h2>
        <label className="field-label" htmlFor={ids[0]}>Menge</label>
        <input id={ids[0]} className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <label className="field-label" htmlFor={ids[1]}>Einheit</label>
        <input id={ids[1]} className="field" maxLength={30} value={unit} onChange={(e) => setUnit(e.target.value)} />
        <label className="field-label" htmlFor={ids[2]}>Name</label>
        <input id={ids[2]} className="field" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        {(error || serverError) && <p className="error" role="alert">{error || serverError}</p>}
        <button type="submit" className="primary-button inline" disabled={busy}>Speichern</button>
        {item && onDelete && (
          <button type="button" className="text-button" disabled={busy} onClick={onDelete}>Löschen</button>
        )}
      </form>
    </dialog>
  );
}
