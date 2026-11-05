import { Pencil, Undo2 } from "lucide-react";
import { formatQuantity } from "../../shared/format";
import type { Merged } from "../../shared/merge";
import type { Ingredient, Step } from "../../shared/schema";

interface Props {
  item: Merged<Ingredient> | Merged<Step>;
  note?: string; // ingredient or step note, shown muted: a note is not an adjustment
  kind: "ingredient" | "step";
  number?: number;
  scale: (n: number | null) => number | null;
  showOriginal: boolean;
  onEdit?(): void; // without it the row is read-only (shared preview)
  onRestore?(): void;
  busy?: boolean;
  sharedBy?: string; // group recipes only ("" = author unknown): initials of whoever wrote the adjustment or note
  by?: string; // who made the adjustments; "dir" on your own recipes
}

export default function ItemRow({ item, note, kind, number, scale, showOriginal, onEdit, onRestore, busy = false, by = "dir", sharedBy }: Props) {
  const status = showOriginal ? "original" : item.status;
  const changed = status === "modified" || status === "added";
  const ingredient = kind === "ingredient" ? (item as Merged<Ingredient>) : null;
  const step = kind === "step" ? (item as Merged<Step>) : null;
  const original = ingredient?.original ?? null;
  const stepOriginal = step?.original ?? null;

  let subline = "";
  // On group recipes the "Geteilt von" line carries the attribution.
  if (status === "added") subline = sharedBy !== undefined ? "" : `Von ${by} hinzugefügt`;
  else if (status === "removed") subline = sharedBy !== undefined ? "" : `Von ${by} entfernt`;
  else if (status === "modified") {
    if (ingredient && original) {
      // Name the part that changed: a name-only edit would otherwise repeat the current quantity.
      const quantityChanged = ingredient.amount !== original.amount || ingredient.unit !== original.unit;
      subline = `Geändert · Original ${quantityChanged ? formatQuantity(scale(original.amount), original.unit) || "ohne Menge" : original.name}`;
    } else if (step && stepOriginal) {
      const minutes = stepOriginal.duration_minutes;
      subline =
        step.duration_minutes !== minutes
          ? `Geändert · Original ${minutes === null ? "ohne Dauer" : `${minutes} Min`}`
          : "Geändert · Originaltext";
    }
  }

  return (
    <li className={`item item-${status}`}>
      {step && (
        <span className="step-number" aria-hidden="true">
          {status === "removed" || number === undefined ? "–" : number}
        </span>
      )}
      {ingredient && <strong className="item-amount">{formatQuantity(scale(ingredient.amount), ingredient.unit)}</strong>}
      <div className="item-body">
        <span className="item-main">{ingredient ? ingredient.name : step?.text}</span>
        {step?.duration_minutes != null && <span className={changed ? "item-duration adj" : "item-duration"}>{step.duration_minutes} Min</span>}
        {note && <span className="item-note">{note}</span>}
        {sharedBy && <span className="meta small">Geteilt von {sharedBy}</span>}
        {subline && <span className="item-sub">{subline}</span>}
      </div>
      {!onEdit ? null : status === "removed" ? (
        <button className="restore" disabled={busy} onClick={onRestore}>
          <Undo2 size={18} aria-hidden="true" />
          Wiederherstellen
        </button>
      ) : (
        !showOriginal && (
          <button className="icon-button" onClick={onEdit} aria-label="Bearbeiten">
            <Pencil size={18} aria-hidden="true" />
          </button>
        )
      )}
    </li>
  );
}
