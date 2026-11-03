import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import RecipeCard from "../components/RecipeCard";
import { countLabel, initials } from "../../shared/format";
import type { RecipeSummary } from "../../shared/schema";

const FILTERS: Record<string, (recipe: RecipeSummary) => boolean> = {
  Alle: () => true,
  Angepasst: (recipe) => recipe.adjustment_count > 0,
  "Unter 30 Min": (recipe) => recipe.total_minutes !== null && recipe.total_minutes < 30,
};

export default function Home() {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("Alle");

  useEffect(() => {
    // Failures surface via the session banner; other errors leave the list empty.
    api.listRecipes().then(setRecipes).catch(() => setRecipes([]));
    api.me().then((me) => setUserId(me.userId)).catch(() => {});
  }, []);

  const all = recipes ?? [];
  const tags = [...new Set(all.flatMap((recipe) => recipe.tags))];
  const matchesChip = FILTERS[chip] ?? ((recipe: RecipeSummary) => recipe.tags.includes(chip));
  const needle = query.trim().toLowerCase();
  const shown = all.filter(
    (recipe) =>
      matchesChip(recipe) &&
      [recipe.title, ...recipe.ingredient_names].some((text) => text.toLowerCase().includes(needle)),
  );
  const adjusted = all.filter(FILTERS.Angepasst).length;

  return (
    <main className="page">
      <header className="home-header">
        <div>
          <h1>Mein Kochbuch</h1>
          <p className="meta">{`${countLabel(all.length, "Rezept", "Rezepte")} · ${adjusted} angepasst`}</p>
        </div>
        <div className="avatar">{initials(userId)}</div>
      </header>

      <label className="search">
        <Search size={20} aria-hidden />
        <input
          type="search"
          placeholder="Rezepte oder Zutaten suchen"
          aria-label="Rezepte oder Zutaten suchen"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="chips">
        {[...Object.keys(FILTERS), ...tags].map((name) => (
          <button
            key={name}
            className={`chip${name === "Angepasst" ? " chip-adj" : ""}${name === chip ? " active" : ""}`}
            aria-pressed={name === chip}
            onClick={() => setChip(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {recipes && shown.length === 0 && <p className="empty">{all.length === 0 ? "Noch keine Rezepte" : "Keine Treffer"}</p>}
      <div className="list">
        {shown.map((recipe) => (
          <RecipeCard key={recipe.id} recipe={recipe} />
        ))}
      </div>

      <div className="sticky-bottom">
        <Link to="/neu" className="primary-button">
          <Plus size={22} aria-hidden /> Rezept hinzufügen
        </Link>
      </div>
    </main>
  );
}
