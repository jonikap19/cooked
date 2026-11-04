import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, messageOf } from "../api";
import CheckoutSheet from "../components/CheckoutSheet";
import PantrySheet from "../components/PantrySheet";
import TabBar from "../components/TabBar";
import { formatQuantity } from "../../shared/format";
import type { ListBody } from "../../shared/schema";
import type { ShoppingLine } from "../../shared/shopping";

const lineAmount = (line: ShoppingLine) => (line.amount === null ? "etwas" : formatQuantity(line.amount, line.unit));

interface CorrectionProps {
  line: ShoppingLine;
  names: string[];
  onSave(name: string): void;
  onClose(): void;
  error: string;
  busy: boolean;
}

function CorrectionSheet({ line, names, onSave, onClose, error, busy }: CorrectionProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  const [name, setName] = useState(line.canonical_name);

  useEffect(() => dialog.current?.showModal(), []);

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <form
        className="sheet-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <h2>Name ändern</h2>
        <div className="tag-list">
          {names.map((known) => (
            <button key={known} type="button" className="tag-chip name-chip" aria-pressed={known === name} onClick={() => setName(known)}>
              {known}
            </button>
          ))}
        </div>
        <label className="field-label" htmlFor={inputId}>Neuer Name</label>
        <input id={inputId} className="field" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary-button inline" disabled={busy || !name.trim()}>Zuordnen</button>
      </form>
    </dialog>
  );
}

export default function ShoppingList() {
  const [list, setList] = useState<ListBody | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"add" | "checkout" | null>(null);
  const [correcting, setCorrecting] = useState<{ line: ShoppingLine; names: string[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.getList());
      setLoadError("");
    } catch (err) {
      setLoadError(messageOf(err));
    }
  }, []);

  useEffect(() => void load(), [load]);

  // Runs a mutation, then reloads: the server computes the lines, so it is the truth.
  const mutate = async (action: () => Promise<unknown>, closeSheets = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      if (closeSheets) {
        setSheet(null);
        setCorrecting(null);
      }
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const tick = async (key: string, ticked: boolean) => {
    if (!list) return;
    setList({ ...list, ticked: ticked ? [...list.ticked, key] : list.ticked.filter((k) => k !== key) });
    try {
      await api.setTick(key, ticked);
    } catch (err) {
      setError(messageOf(err));
      await load();
    }
  };

  const checkout = async (lines: Parameters<typeof api.checkout>[0]) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setList(await api.checkout(lines));
      setSheet(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const openCorrection = async (line: ShoppingLine) => {
    setError("");
    try {
      const pantry = await api.listPantry();
      const names = [...new Set([...pantry.map((item) => item.canonical_name), ...list!.lines.map((l) => l.canonical_name)])].sort();
      setCorrecting({ line, names });
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const tickedLines = list?.lines.filter((line) => list.ticked.includes(line.key)) ?? [];

  return (
    <main className="page with-tabs">
      <h1>Einkaufsliste</h1>
      {loadError && (
        <>
          <p className="error" role="alert">{loadError}</p>
          <button className="text-button" onClick={load}>Erneut versuchen</button>
        </>
      )}
      {!sheet && !correcting && error && <p className="error" role="alert">{error}</p>}
      {list && list.planned.length > 0 && (
        <div className="tag-list">
          {list.planned.map((recipe) => (
            <span key={recipe.recipe_id} className="tag-chip">
              {recipe.title}
              <button className="icon-button" aria-label={`${recipe.title} entfernen`} disabled={busy} onClick={() => void mutate(() => api.unplanRecipe(recipe.recipe_id))}>
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      {list && list.lines.length === 0 && <p className="empty">Noch keine Artikel</p>}
      <ul className="list" style={{ listStyle: "none", padding: 0 }}>
        {list?.lines.map((line) => (
          <li key={line.key} className="pantry-row">
            <label className="list-check">
              <input
                type="checkbox"
                aria-label={`${line.canonical_name} abhaken`}
                checked={list.ticked.includes(line.key)}
                onChange={(event) => void tick(line.key, event.target.checked)}
              />
            </label>
            <div className="list-line">
              {line.source_names.length > 0 ? (
                <button className="pantry-edit" onClick={() => void openCorrection(line)}>{line.canonical_name}</button>
              ) : (
                <span className="list-name">{line.canonical_name}</span>
              )}
              <span className="meta">{lineAmount(line)}</span>
              {line.recipes.length > 0 && <span className="meta">Für: {line.recipes.join(", ")}</span>}
              {line.pantryHint && <span className="meta">{line.pantryHint}</span>}
            </div>
            {line.typedItemId && (
              <button className="icon-button" aria-label={`${line.canonical_name} löschen`} disabled={busy} onClick={() => void mutate(() => api.deleteListItem(line.typedItemId!))}>
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <button className="add-item" onClick={() => { setError(""); setSheet("add"); }}>
        <Plus size={18} aria-hidden="true" /> Artikel hinzufügen
      </button>

      <div className="sticky-bottom above-tabs">
        <button className="primary-button" disabled={tickedLines.length === 0} onClick={() => { setError(""); setSheet("checkout"); }}>
          Einkauf abschließen
        </button>
      </div>
      <TabBar />

      {sheet === "add" && (
        <PantrySheet
          item={null}
          onSave={(name, amount, unit) => void mutate(() => api.addListItem(name, amount, unit), true)}
          onClose={() => setSheet(null)}
          error={error}
          busy={busy}
        />
      )}
      {sheet === "checkout" && (
        <CheckoutSheet lines={tickedLines} onConfirm={(lines) => void checkout(lines)} onClose={() => setSheet(null)} error={error} busy={busy} />
      )}
      {correcting && (
        <CorrectionSheet
          line={correcting.line}
          names={correcting.names}
          onSave={(name) =>
            void mutate(async () => {
              for (const source of correcting.line.source_names) await api.putAlias(source, name, correcting.line.unit);
            }, true)
          }
          onClose={() => setCorrecting(null)}
          error={error}
          busy={busy}
        />
      )}
    </main>
  );
}
