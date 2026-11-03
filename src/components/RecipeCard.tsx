import { Link } from "react-router";
import { countLabel, placeholderColor, platformLabel } from "../../shared/format";
import type { RecipeSummary } from "../../shared/schema";

export default function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const meta = [
    recipe.total_minutes !== null && `${recipe.total_minutes} Min`,
    `${recipe.servings} Portionen`,
    recipe.source_platform && platformLabel(recipe.source_platform),
  ].filter(Boolean);

  return (
    <Link to={`/rezept/${recipe.id}`} className="card">
      <div className="thumb" style={{ background: placeholderColor(recipe.id) }}>
        Rezeptbild
      </div>
      <div className="card-body">
        <h2>{recipe.title}</h2>
        <p className="meta">{meta.join(" · ")}</p>
        {recipe.adjustment_count > 0 && (
          <span className="badge">{countLabel(recipe.adjustment_count, "Anpassung", "Anpassungen")}</span>
        )}
      </div>
    </Link>
  );
}
