import { Plus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, api, SessionExpiredError } from "../api";
import TabBar from "../components/TabBar";
import { parseNumber } from "../lib/edit";
import type { PantryItem } from "../../shared/schema";

const GENERIC_ERROR = "Etwas ist schiefgelaufen. Bitte versuche es erneut.";

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  // Session expiry is shown by the global banner.
  return err instanceof SessionExpiredError ? "" : GENERIC_ERROR;
}

const amountLabel = (item: PantryItem) => (item.amount === null ? "etwas" : `${String(item.amount).replace(".", ",")} ${item.unit}`.trim());

interface SheetProps {
  item: PantryItem | null; // null = new item
  onSave(name: string, amount: number | null, unit: string): void;
  onDelete(): void;
  onClose(): void;
  error: string;
  busy: boolean;
}

function PantrySheet({ item, onSave, onDelete, onClose, error: serverError, busy }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = [useId(), useId(), useId()];
  const [amount, setAmount] = useState(String(item?.amount ?? "").replace(".", ","));
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [name, setName] = useState(item?.canonical_name ?? "");
  const [error, setError] = useState("");

  useEffect(() => dialog.current?.showModal(), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseNumber(amount);
    if (!name.trim()) return setError("Bitte einen Namen eingeben.");
    // Empty amount means "etwas"; anything else must be a positive number.
    if (amount.trim() !== "" && (parsed === null || parsed <= 0)) return setError("Bitte eine Menge größer als 0 eingeben.");
    onSave(name.trim(), parsed, unit.trim());
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
        {item && (
          <button type="button" className="text-button" disabled={busy} onClick={onDelete}>Löschen</button>
        )}
      </form>
    </dialog>
  );
}

export default function Pantry() {
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [sheet, setSheet] = useState<{ item: PantryItem | null } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.listPantry());
      setLoadError("");
    } catch (err) {
      setLoadError(messageOf(err));
    }
  }, []);

  useEffect(() => void load(), [load]);

  // Runs a mutation, then reloads: edits can delete or merge rows, so the list is the truth.
  const mutate = async (action: () => Promise<unknown>, closeSheet: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      if (closeSheet) setSheet(null);
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const save = (name: string, amount: number | null, unit: string) => {
    const current = sheet?.item;
    void mutate(
      () =>
        current
          ? api.editPantry({ canonical_name: current.canonical_name, unit: current.unit }, { canonical_name: name, amount, unit })
          : api.addPantry(name, amount, unit),
      true,
    );
  };

  return (
    <main className="page with-tabs">
      <h1>Vorrat</h1>
      {loadError && (
        <>
          <p className="error" role="alert">{loadError}</p>
          <button className="text-button" onClick={load}>Erneut versuchen</button>
        </>
      )}
      {!sheet && error && <p className="error" role="alert">{error}</p>}
      {items && items.length === 0 && <p className="empty">Noch keine Artikel</p>}
      <ul className="list" style={{ listStyle: "none", padding: 0 }}>
        {items?.map((item) => (
          <li key={`${item.canonical_name}|${item.unit}`} className="pantry-row">
            <button className="pantry-edit" onClick={() => { setError(""); setSheet({ item }); }}>
              {item.canonical_name}
              <span className="meta">{amountLabel(item)}</span>
            </button>
            <label className="pantry-toggle">
              <input
                type="checkbox"
                checked={item.always_at_home}
                disabled={busy}
                onChange={(event) =>
                  void mutate(() => api.editPantry({ canonical_name: item.canonical_name, unit: item.unit }, { always_at_home: event.target.checked }), false)
                }
              />
              Immer da
            </label>
          </li>
        ))}
      </ul>

      <div className="sticky-bottom above-tabs">
        <button className="primary-button" onClick={() => { setError(""); setSheet({ item: null }); }}>
          <Plus size={22} aria-hidden /> Artikel hinzufügen
        </button>
      </div>
      <TabBar />

      {sheet && (
        <PantrySheet
          item={sheet.item}
          onSave={save}
          onDelete={() => sheet.item && void mutate(() => api.deletePantry({ canonical_name: sheet.item!.canonical_name, unit: sheet.item!.unit }), true)}
          onClose={() => setSheet(null)}
          error={error}
          busy={busy}
        />
      )}
    </main>
  );
}
