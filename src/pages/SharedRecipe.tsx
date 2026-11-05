import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api, messageOf, type SharedPreview } from "../api";
import ItemRow from "../components/ItemRow";
import RecipeImage from "../components/RecipeImage";
import { countLabel, placeholderColor, platformLabel } from "../../shared/format";
import { mergeRecipe } from "../../shared/merge";
import type { RecipeFull } from "../../shared/schema";

// The snapshot has no id, timestamp, servable image or group; mergeRecipe never reads them.
// Note authors are blank for the same reason: a share link carries no author, and the preview never shows one.
const toFull = ({ recipe, ingredients, steps, adjustments, note, ingredient_notes }: SharedPreview): RecipeFull => ({
  recipe: { ...recipe, id: "", created_at: "", image_url: null, group_id: null },
  ingredients,
  steps,
  adjustments,
  note,
  ingredient_notes: ingredient_notes.map((n) => ({ ...n, author: "" })),
});

export default function SharedRecipe() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [shared, setShared] = useState<{ full: RecipeFull; initials: string } | null>(null);
  const [problem, setProblem] = useState<{ status: number; message: string } | null>(null);
  const [tab, setTab] = useState<"ingredient" | "step">("ingredient");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getShared(token).then(
      (body) => setShared({ full: toFull(body.recipe), initials: body.shared_by_initials }),
      (err) => setProblem({ status: err instanceof ApiError ? err.status : 0, message: messageOf(err) }),
    );
  }, [token]);

  if (problem) {
    return (
      <main className="page">
        <p role="alert">{problem.status === 404 ? "Rezept nicht gefunden" : problem.status === 410 ? "Link abgelaufen" : problem.message}</p>
        <Link to="/" className="text-button">Zurück</Link>
      </main>
    );
  }
  if (!shared) return <main className="page"><p className="empty">Lädt …</p></main>;

  const { full, initials } = shared;
  const { recipe } = full;
  const merged = mergeRecipe(full);
  const noteFor = (itemId: string) => full.ingredient_notes.find((n) => n.target_id === itemId)?.body ?? "";
  const meta = [
    recipe.source_platform && platformLabel(recipe.source_platform),
    countLabel(recipe.servings, "Portion", "Portionen"),
    recipe.total_minutes && `${recipe.total_minutes} Min gesamt`,
  ].filter(Boolean).join(" · ");
  const rows = tab === "ingredient" ? merged.ingredients : merged.steps;
  let stepNumber = 0;

  const importRecipe = async () => {
    setBusy(true);
    setError("");
    try {
      navigate(`/rezept/${(await api.importShared(token)).id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) setProblem({ status: 410, message: err.message });
      else setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <main className="detail">
      <div className="hero" style={{ background: placeholderColor(recipe.title) }}>
        <RecipeImage src={null}>
          <span className="hero-label">Rezeptbild</span>
        </RecipeImage>
        <Link to="/" className="round-button" aria-label="Zurück"><ChevronLeft aria-hidden="true" /></Link>
      </div>

      <div className="detail-sheet">
        <h1>{recipe.title}</h1>
        <p className="meta detail-meta">{[meta, `Geteilt von ${initials}`].filter(Boolean).join(" · ")}</p>

        {merged.adjustmentCount > 0 && (
          <div className="adj-banner">
            <strong>{countLabel(merged.adjustmentCount, "Anpassung", "Anpassungen")} von {initials}</strong>
          </div>
        )}

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "ingredient"} onClick={() => setTab("ingredient")}>Zutaten · {merged.ingredients.length}</button>
          <button role="tab" aria-selected={tab === "step"} onClick={() => setTab("step")}>Schritte · {merged.steps.length}</button>
        </div>

        <ul className="items">
          {rows.map((item) => {
            if (tab === "step" && item.status !== "removed") stepNumber += 1;
            return (
              <ItemRow
                key={item.id}
                item={item}
                note={noteFor(item.id)}
                kind={tab}
                number={stepNumber}
                scale={(n) => n}
                showOriginal={false}
                by={initials}
              />
            );
          })}
        </ul>

        {full.note && (
          <>
            <h2 className="note-heading">Notiz</h2>
            <p className="meta">{full.note}</p>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div className="sticky-bottom">
        <button className="primary-button" disabled={busy} onClick={() => void importRecipe()}>Ins Kochbuch übernehmen</button>
      </div>
    </main>
  );
}
