import { ChevronLeft, ExternalLink, Minus, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api, SessionExpiredError } from "../api";
import EditSheet from "../components/EditSheet";
import SplitSheet from "../components/SplitSheet";
import ItemRow from "../components/ItemRow";
import TagDialog from "../components/TagDialog";
import RecipeImage from "../components/RecipeImage";
import { countLabel, formatShortDate, placeholderColor, platformLabel, scaleAmount } from "../../shared/format";
import { mergeRecipe, type Merged } from "../../shared/merge";
import type { Ingredient, RecipeFull, Step, StepValues } from "../../shared/schema";

type Sheet = { kind: "ingredient" | "step"; item: Merged<Ingredient> | Merged<Step> | null };

export default function RecipeDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const noteId = useId();
  const [full, setFull] = useState<RecipeFull | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<"ingredient" | "step">("ingredient");
  const [servings, setServings] = useState<number | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const noteSeeded = useRef(false);

  const load = useCallback(async () => {
    try {
      const loaded = await api.getRecipe(id);
      setFull(loaded);
      setLoadError("");
      if (!noteSeeded.current) {
        noteSeeded.current = true;
        setNote(loaded.note);
      }
      setServings((current) => current ?? loaded.recipe.servings);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else if (err instanceof ApiError) setLoadError(err.message);
      else if (!(err instanceof SessionExpiredError)) setLoadError("Etwas ist schiefgelaufen. Bitte versuche es erneut.");
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  // Runs a mutation, refetches, and surfaces the server's message; returns true on success.
  const mutate = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else if (!(err instanceof SessionExpiredError)) setError("Etwas ist schiefgelaufen. Bitte versuche es erneut.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <main className="page">
        <p>Rezept nicht gefunden</p>
        <Link to="/" className="text-button">Zurück</Link>
      </main>
    );
  }
  if (loadError && !full) {
    return (
      <main className="page">
        <p className="error" role="alert">{loadError}</p>
        <button className="text-button" onClick={() => void load()}>Erneut versuchen</button>
      </main>
    );
  }
  if (!full || servings === null) return <main className="page"><p className="empty">Lädt …</p></main>;

  const { recipe } = full;
  const merged = mergeRecipe(full);
  const scale = (n: number | null) => scaleAmount(n, recipe.servings, servings);
  const lastChange = full.adjustments.map((a) => a.updated_at).sort().at(-1);
  const meta = [
    recipe.source_platform && platformLabel(recipe.source_platform),
    recipe.total_minutes && `${recipe.total_minutes} Min gesamt`,
  ].filter(Boolean).join(" · ");

  const adjustmentFor = (itemId: string, action: "modify" | "remove") =>
    full.adjustments.find((a) => a.target_id === itemId && a.action === action);
  const removeAdjustment = (itemId: string, action: "modify" | "remove") => {
    const adjustment = adjustmentFor(itemId, action);
    return adjustment ? mutate(() => api.deleteAdjustment(id, adjustment.id)) : Promise.resolve(false);
  };
  const closeAfter = async (done: Promise<boolean>) => (await done) && setSheet(null);

  const noteFor = (itemId: string) => full.ingredient_notes.find((n) => n.target_id === itemId)?.body ?? "";

  const saveValues = (values: object) => {
    const { kind, item } = sheet!;
    if (!item) return api.addAdjustment(id, { target_type: kind, action: "add", target_id: null, new_values: values } as never);
    if (item.status === "added") return api.updateAdjustment(id, item.id, values as never);
    return api.addAdjustment(id, { target_type: kind, action: "modify", target_id: item.id, new_values: values } as never);
  };
  // A note target is the merged row id: the ingredient id, or the add adjustment's id for added rows.
  const save = (values: object | null, noteText: string | null) => {
    if (!sheet) return;
    return closeAfter(
      mutate(async () => {
        if (values) await saveValues(values);
        if (noteText !== null) await api.saveIngredientNote(id, sheet.item!.id, noteText);
      }),
    );
  };

  // Sequential, so the pieces keep their creation order. A failure stops the sequence; the refetch shows what was saved.
  const acceptSplit = (pieces: StepValues[]) => {
    const step = sheet?.item;
    if (!step) return;
    return mutate(async () => {
      try {
        await api.addAdjustment(id, { target_type: "step", action: "remove", target_id: step.id });
        for (const values of pieces) {
          await api.addAdjustment(id, { target_type: "step", action: "add", target_id: null, insert_after: step.id, new_values: values } as never);
        }
      } catch (err) {
        await load();
        throw err;
      }
    }).then(() => {
      // Also after a failure: part of the split may be saved, so retrying from a stale sheet would duplicate pieces.
      setSplitting(false);
      setSheet(null);
    });
  };

  const rows = tab === "ingredient" ? (showOriginal ? full.ingredients : merged.ingredients) : showOriginal ? full.steps : merged.steps;
  let stepNumber = 0;
  const openSheet = (kind: Sheet["kind"], item: Sheet["item"]) => {
    setError("");
    setSheet({ kind, item });
  };

  return (
    <main className="detail">
      <div className="hero" style={{ background: placeholderColor(recipe.id) }}>
        <RecipeImage src={recipe.image_url}>
          <span className="hero-label">Rezeptbild</span>
        </RecipeImage>
        <Link to="/" className="round-button" aria-label="Zurück"><ChevronLeft aria-hidden="true" /></Link>
        {recipe.source_url && (
          <a className="source-pill" href={recipe.source_url} target="_blank" rel="noopener noreferrer">
            Original <ExternalLink size={16} aria-hidden="true" />
          </a>
        )}
      </div>

      <div className="detail-sheet">
        <h1>{recipe.title}</h1>
        <p className="meta detail-meta">
          {meta}
          {meta && " · "}
          <button className="text-button inline-button" onClick={() => setTagsOpen(true)}>
            {recipe.tags.length ? recipe.tags.join(", ") : "Tags hinzufügen"}
          </button>
        </p>

        {merged.adjustmentCount > 0 && (
          <div className="adj-banner">
            <div>
              <strong>{countLabel(merged.adjustmentCount, "eigene Anpassung", "eigene Anpassungen")}</strong>
              {lastChange && <p className="small">Zuletzt geändert am {formatShortDate(lastChange)}</p>}
            </div>
            <button onClick={() => setShowOriginal(!showOriginal)}>{showOriginal ? "Anpassungen zeigen" : "Original zeigen"}</button>
          </div>
        )}

        <div className="card servings">
          <div>
            <strong>Portionen</strong>
            <p className="meta small">Mengen werden umgerechnet</p>
          </div>
          <div className="stepper">
            <button className="step-soft" aria-label="Weniger Portionen" disabled={servings <= 1} onClick={() => setServings(servings - 1)}><Minus aria-hidden="true" /></button>
            <strong>{servings}</strong>
            <button className="step-solid" aria-label="Mehr Portionen" disabled={servings >= 100} onClick={() => setServings(servings + 1)}><Plus aria-hidden="true" /></button>
          </div>
        </div>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "ingredient"} onClick={() => setTab("ingredient")}>Zutaten · {merged.ingredients.length}</button>
          <button role="tab" aria-selected={tab === "step"} onClick={() => setTab("step")}>Schritte · {merged.steps.length}</button>
        </div>

        <ul className="items">
          {rows.map((row) => {
            const item = row as Merged<Ingredient> | Merged<Step>;
            // Raw originals have no status; ItemRow treats showOriginal as "original".
            if (tab === "step" && !(showOriginal ? false : item.status === "removed")) stepNumber += 1;
            return (
              <ItemRow
                key={item.id}
                item={item}
                note={tab === "ingredient" ? noteFor(item.id) : undefined}
                kind={tab}
                number={stepNumber}
                scale={scale}
                showOriginal={showOriginal}
                onEdit={() => openSheet(tab, item)}
                onRestore={() => void removeAdjustment(item.id, "remove")}
                busy={busy}
              />
            );
          })}
        </ul>
        {!showOriginal && (
          <button className="add-item" onClick={() => openSheet(tab, null)}>
            <Plus size={18} aria-hidden="true" /> {tab === "ingredient" ? "Zutat hinzufügen" : "Schritt hinzufügen"}
          </button>
        )}
        {!sheet && error && <p className="error" role="alert">{error}</p>}

        <h2 className="note-heading"><label htmlFor={noteId}>Notiz für mich</label></h2>
        <textarea
          id={noteId}
          className="field"
          rows={4}
          maxLength={5000}
          placeholder="Was möchtest du dir merken?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note.trim() !== full.note && void mutate(() => api.saveNote(id, note.trim()))}
        />
        <button
          className="text-button muted-button"
          onClick={async () => confirm("Rezept wirklich löschen?") && (await mutate(() => api.deleteRecipe(id))) && navigate("/")}
        >
          Rezept löschen
        </button>
      </div>

      <div className="sticky-bottom">
        <Link to={`/rezept/${id}/kochen`} className="primary-button"><Play size={18} aria-hidden="true" /> Kochen starten</Link>
      </div>

      {sheet && (
        <EditSheet
          kind={sheet.kind}
          item={sheet.item}
          note={sheet.kind === "ingredient" && sheet.item ? noteFor(sheet.item.id) : ""}
          servingsHint={servings !== recipe.servings ? recipe.servings : null}
          busy={busy}
          serverError={error}
          onSave={save}
          onReset={() => sheet.item && closeAfter(removeAdjustment(sheet.item.id, "modify"))}
          onRemove={() => sheet.item && closeAfter(mutate(() => api.addAdjustment(id, { target_type: sheet.kind, action: "remove", target_id: sheet.item!.id })))}
          onSplit={() => {
            setError("");
            setSplitting(true);
          }}
          onDelete={() => sheet.item && closeAfter(mutate(() => api.deleteAdjustment(id, sheet.item!.id)))}
          onClose={() => setSheet(null)}
        />
      )}
      {splitting && sheet?.item && (
        <SplitSheet
          text={(sheet.item as Merged<Step>).text}
          busy={busy}
          serverError={error}
          onAccept={acceptSplit}
          onClose={() => setSplitting(false)}
        />
      )}
      {tagsOpen && (
        <TagDialog
          tags={recipe.tags}
          onChange={(tags) => void mutate(() => api.updateTags(id, tags))}
          onClose={() => setTagsOpen(false)}
        />
      )}
    </main>
  );
}
