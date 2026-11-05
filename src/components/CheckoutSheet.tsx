import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { pantryAmount } from "../lib/edit";
import { formatAmount } from "./PantrySheet";
import type { ShoppingLine } from "../../shared/shopping";

type Checkout = { key: string; canonical_name: string; unit: string; amount: number | null };

interface Props {
  lines: ShoppingLine[]; // the ticked lines
  onConfirm(lines: Checkout[]): void;
  onClose(): void;
  error: string;
  busy: boolean;
}

export default function CheckoutSheet({ lines, onConfirm, onClose, error: serverError, busy }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState(() => lines.map((line) => ({ line, amount: line.amount === null ? "" : formatAmount(line.amount) })));
  const [error, setError] = useState("");

  useEffect(() => dialog.current?.showModal(), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (rows.length === 0) return onClose();
    const result: Checkout[] = [];
    for (const { line, amount } of rows) {
      // 0 means "bought none"; the server accepts it.
      const parsed = pantryAmount(amount, true);
      if ("error" in parsed) return setError(`${line.canonical_name}: Bitte eine gültige Menge eingeben.`);
      result.push({ key: line.key, canonical_name: line.canonical_name, unit: line.unit, amount: parsed.amount });
    }
    onConfirm(result);
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <form className="sheet-body" onSubmit={submit}>
        <h2>Einkauf abschließen</h2>
        <ul className="checkout-list">
          {rows.map(({ line, amount }) => (
            <li key={line.key} className="checkout-row">
              <label htmlFor={`amount-${line.key}`}>{line.canonical_name}{line.unit && ` (${line.unit})`}</label>
              <input
                id={`amount-${line.key}`}
                className="field"
                inputMode="decimal"
                placeholder="etwas"
                value={amount}
                onChange={(e) => setRows(rows.map((row) => (row.line === line ? { line, amount: e.target.value } : row)))}
              />
              <button type="button" className="icon-button" aria-label={`${line.canonical_name} entfernen`} onClick={() => setRows(rows.filter((row) => row.line !== line))}>
                <X size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {(error || serverError) && <p className="error" role="alert">{error || serverError}</p>}
        <button type="submit" className="primary-button inline" disabled={busy}>In den Vorrat übernehmen</button>
        <button type="button" className="text-button" disabled={busy} onClick={onClose}>Abbrechen</button>
      </form>
    </dialog>
  );
}
