import { Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, api, SessionExpiredError } from "../api";
import Invites from "../components/Invites";
import RecipeCard from "../components/RecipeCard";
import TabBar from "../components/TabBar";
import { allergyWarnings } from "../../shared/allergens";
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
  const [allergens, setAllergens] = useState<string[]>([]);

  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => {
    setLoadError("");
    api.listRecipes().then(setRecipes).catch((err) => {
      // Session expiry is shown by the global banner.
      if (err instanceof ApiError) setLoadError(err.message);
      else if (!(err instanceof SessionExpiredError)) setLoadError("Etwas ist schiefgelaufen. Bitte versuche es erneut.");
    });
  }, []);

  useEffect(() => {
    load();
    api.me().then((me) => setUserId(me.userId)).catch(() => {});
    // A failed lookup just shows no warnings.
    api.getAllergies().then(setAllergens, () => {});
  }, [load]);

  const all = recipes ?? [];
  const tags = [...new Set(all.flatMap((recipe) => recipe.tags))];
  const matchesChip = Object.hasOwn(FILTERS, chip) ? FILTERS[chip] : (recipe: RecipeSummary) => recipe.tags.includes(chip);
  const needle = query.trim().toLowerCase();
  const shown = all.filter(
    (recipe) =>
      matchesChip(recipe) &&
      [recipe.title, ...recipe.ingredient_names].some((text) => text.toLowerCase().includes(needle)),
  );
  const adjusted = all.filter(FILTERS.Angepasst).length;

  return (
    <main className="page with-tabs">
      <header className="home-header">
        <div>
          <h1>Mein Kochbuch</h1>
          <p className="meta">{[countLabel(all.length, "Rezept", "Rezepte"), adjusted > 0 && `${adjusted} angepasst`].filter(Boolean).join(" · ")}</p>
        </div>
        <Link to="/allergien" className="avatar" aria-label="Allergien & No-Gos" title="Allergien & No-Gos">{initials(userId)}</Link>
      </header>

      <Invites />

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

      {loadError && (
        <>
          <p className="error" role="alert">{loadError}</p>
          <button className="text-button" onClick={load}>Erneut versuchen</button>
        </>
      )}
      {recipes && shown.length === 0 && <p className="empty">{all.length === 0 ? "Noch keine Rezepte" : "Keine Treffer"}</p>}
      <div className="list">
        {shown.map((recipe) => (
          <RecipeCard key={recipe.id} recipe={recipe} warnings={allergyWarnings(recipe.ingredient_names, [{ user_id: userId, allergens }], userId, false)} />
        ))}
      </div>

      <div className="sticky-bottom above-tabs">
        <Link to="/neu" className="primary-button">
          <Plus size={22} aria-hidden /> Rezept hinzufügen
        </Link>
      </div>
      <TabBar />
    </main>
  );
}
