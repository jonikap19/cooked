import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, api, messageOf, type GroupDetail } from "../api";
import RecipeCard from "../components/RecipeCard";
import TabBar from "../components/TabBar";
import TextSheet from "../components/TextSheet";
import { allergyWarnings } from "../../shared/allergens";
import { initials } from "../../shared/format";

const inviteError = (err: unknown) => {
  if (!(err instanceof ApiError)) return undefined;
  if (err.status === 429) return "Zu viele Einladungen. Bitte warte kurz.";
  if (err.status === 400) return "Einladung nicht möglich";
  return undefined;
};

export default function Group() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [userId, setUserId] = useState("");

  const load = useCallback(() => {
    setError("");
    api.getGroup(id).then(setGroup, (err) => {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(messageOf(err));
    });
  }, [id]);
  useEffect(load, [load]);
  // Only labels the caller's own warnings "Du"; without it they show initials.
  useEffect(() => void api.me().then((me) => setUserId(me.userId), () => {}), []);

  const leave = async () => {
    const last = group?.members.length === 1;
    if (!confirm(last ? "Du bist das letzte Mitglied. Die Gruppe und ihre Rezepte werden gelöscht." : "Gruppe wirklich verlassen?")) return;
    try {
      await api.leaveGroup(id);
      navigate("/gruppen");
    } catch (err) {
      setError(messageOf(err));
    }
  };

  if (notFound) {
    return (
      <main className="page">
        <p>Gruppe nicht gefunden</p>
        <Link to="/gruppen" className="text-button">Zurück</Link>
      </main>
    );
  }
  if (!group) {
    return (
      <main className="page">
        {error ? (
          <>
            <p className="error" role="alert">{error}</p>
            <button className="text-button" onClick={load}>Erneut versuchen</button>
          </>
        ) : (
          <p className="empty">Lädt …</p>
        )}
      </main>
    );
  }

  return (
    <main className="page with-tabs">
      <header className="home-header">
        <Link to="/gruppen" className="round-button inline-round" aria-label="Zurück"><ChevronLeft aria-hidden="true" /></Link>
        <h1>{group.name}</h1>
      </header>

      <div className="members">
        {group.members.map((email) => (
          <span key={email} className="avatar" title={email}>{initials(email)}</span>
        ))}
        {group.invites.map((email) => (
          <span key={email} className="avatar avatar-pending" title={email}>{initials(email)}</span>
        ))}
        <button className="text-button" onClick={() => setInviting(true)}>Einladen</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {group.recipes.length === 0 && <p className="empty">Noch keine Rezepte</p>}
      <div className="list">
        {group.recipes.map((recipe) => (
          <RecipeCard key={recipe.id} recipe={recipe} warnings={allergyWarnings(recipe.ingredient_names, group.allergies, userId, true)} />
        ))}
      </div>
      <button className="text-button muted-button" onClick={() => void leave()}>Gruppe verlassen</button>
      <TabBar />
      {inviting && (
        <TextSheet
          title="Einladen"
          label="E-Mail"
          submitLabel="Einladen"
          type="email"
          maxLength={254}
          onSubmit={async (email) => {
            await api.inviteToGroup(id, email);
            load();
          }}
          errorFor={inviteError}
          onClose={() => setInviting(false)}
        />
      )}
    </main>
  );
}
