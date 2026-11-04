import { ChevronLeft, LoaderCircle, Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, api, SessionExpiredError } from "../api";
import { blankForm, blankIngredient, blankStep, formToRecipe, type OwnRecipeForm } from "../lib/ownRecipe";

const without = <T,>(rows: T[], index: number) => rows.filter((_, position) => position !== index);
const withRow = <T,>(rows: T[], index: number, change: Partial<T>) => rows.map((row, position) => (position === index ? { ...row, ...change } : row));

export default function OwnRecipe() {
  const navigate = useNavigate();
  const [form, setForm] = useState<OwnRecipeForm>(blankForm);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const servings = Number(form.servings) || 1;

  const save = async () => {
    const result = formToRecipe(form);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPending(true);
    setError("");
    try {
      const { id } = await api.createRecipe(result.recipe);
      navigate(`/rezept/${id}`);
    } catch (err) {
      // Session expiry shows the global banner.
      if (err instanceof ApiError) setError(err.message);
      else if (!(err instanceof SessionExpiredError)) setError("Etwas ist schiefgelaufen. Bitte versuche es erneut.");
      setPending(false);
    }
  };

  return (
    <main className="page">
      <header className="add-header">
        <button className="icon-button" onClick={() => navigate("/neu")} aria-label="Zurück">
          <ChevronLeft />
        </button>
        <h1>Eigenes Rezept</h1>
      </header>

      <label className="field-label" htmlFor="own-title">
        Titel
      </label>
      <input id="own-title" className="field" maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />

      <div className="servings">
        <strong>Portionen</strong>
        <div className="stepper">
          <button className="step-soft" aria-label="Weniger Portionen" disabled={servings <= 1} onClick={() => setForm({ ...form, servings: String(servings - 1) })}>
            <Minus aria-hidden="true" />
          </button>
          <strong>{servings}</strong>
          <button className="step-solid" aria-label="Mehr Portionen" disabled={servings >= 100} onClick={() => setForm({ ...form, servings: String(servings + 1) })}>
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>

      <label className="field-label" htmlFor="own-minutes">
        Minuten (optional)
      </label>
      <input id="own-minutes" className="field" inputMode="numeric" value={form.totalMinutes} onChange={(event) => setForm({ ...form, totalMinutes: event.target.value })} />

      <h2 className="field-label">Zutaten</h2>
      {form.ingredients.map((ingredient, index) => (
        <div className="own-row" key={index}>
          <input className="field own-amount" aria-label="Menge" inputMode="decimal" placeholder="Menge" value={ingredient.amount} onChange={(event) => setForm({ ...form, ingredients: withRow(form.ingredients, index, { amount: event.target.value }) })} />
          <input className="field own-unit" aria-label="Einheit" placeholder="Einheit" maxLength={30} value={ingredient.unit} onChange={(event) => setForm({ ...form, ingredients: withRow(form.ingredients, index, { unit: event.target.value }) })} />
          <input className="field own-grow" aria-label="Zutat" placeholder="Zutat" maxLength={200} value={ingredient.name} onChange={(event) => setForm({ ...form, ingredients: withRow(form.ingredients, index, { name: event.target.value }) })} />
          <button className="icon-button" aria-label="Zutat entfernen" onClick={() => setForm({ ...form, ingredients: without(form.ingredients, index) })}>
            <X aria-hidden="true" />
          </button>
        </div>
      ))}
      <button className="own-add" onClick={() => setForm({ ...form, ingredients: [...form.ingredients, blankIngredient()] })}>
        Zutat hinzufügen
      </button>

      <h2 className="field-label">Schritte</h2>
      {form.steps.map((step, index) => (
        <div className="own-row" key={index}>
          <textarea className="field own-grow" aria-label={`Schritt ${index + 1}`} placeholder={`Schritt ${index + 1}`} rows={2} maxLength={2000} value={step.text} onChange={(event) => setForm({ ...form, steps: withRow(form.steps, index, { text: event.target.value }) })} />
          <input className="field own-unit" aria-label="Minuten" placeholder="Min." inputMode="numeric" value={step.minutes} onChange={(event) => setForm({ ...form, steps: withRow(form.steps, index, { minutes: event.target.value }) })} />
          <button className="icon-button" aria-label="Schritt entfernen" onClick={() => setForm({ ...form, steps: without(form.steps, index) })}>
            <X aria-hidden="true" />
          </button>
        </div>
      ))}
      <button className="own-add" onClick={() => setForm({ ...form, steps: [...form.steps, blankStep()] })}>
        Schritt hinzufügen
      </button>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="sticky-bottom">
        <button className="primary-button" disabled={pending} onClick={save}>
          {pending && <LoaderCircle className="spin" />}
          {pending ? "Wird gespeichert …" : "Rezept speichern"}
        </button>
      </div>
    </main>
  );
}
