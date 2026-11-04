import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, messageOf } from "../api";
import PantrySheet, { formatAmount } from "../components/PantrySheet";
import TabBar from "../components/TabBar";
import type { PantryItem } from "../../shared/schema";

const amountLabel = (item: PantryItem) => (item.amount === null ? "etwas" : `${formatAmount(item.amount)} ${item.unit}`.trim());

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

  // Already gone (404) is the state the user wanted; the reload shows it.
  const deleteItem = (item: PantryItem) =>
    api.deletePantry({ canonical_name: item.canonical_name, unit: item.unit }).catch((err) => {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    });

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
                aria-label={`Immer da: ${item.canonical_name}`}
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
          onDelete={() => sheet.item && void mutate(() => deleteItem(sheet.item!), true)}
          onClose={() => setSheet(null)}
          error={error}
          busy={busy}
        />
      )}
    </main>
  );
}
