import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, api, messageOf, type GroupSummary } from "../api";
import Invites from "../components/Invites";
import TabBar from "../components/TabBar";
import TextSheet from "../components/TextSheet";
import { countLabel } from "../../shared/format";

export default function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoadError("");
    api.listGroups().then(setGroups, (err) => setLoadError(messageOf(err)));
  }, []);
  useEffect(load, [load]);

  return (
    <main className="page with-tabs">
      <header className="home-header">
        <h1>Gruppen</h1>
      </header>
      <Invites onAccepted={load} />
      {loadError && (
        <>
          <p className="error" role="alert">{loadError}</p>
          <button className="text-button" onClick={load}>Erneut versuchen</button>
        </>
      )}
      {groups && groups.length === 0 && <p className="empty">Noch keine Gruppen</p>}
      <div className="list">
        {groups?.map((group) => (
          <Link key={group.id} to={`/gruppen/${group.id}`} className="card">
            <div className="card-body">
              <h2>{group.name}</h2>
              <p className="meta">{`${countLabel(group.member_count, "Mitglied", "Mitglieder")} · ${countLabel(group.recipe_count, "Rezept", "Rezepte")}`}</p>
            </div>
          </Link>
        ))}
      </div>
      <div className="sticky-bottom above-tabs">
        <button className="primary-button" onClick={() => setCreating(true)}>
          <Plus size={22} aria-hidden /> Gruppe erstellen
        </button>
      </div>
      <TabBar />
      {creating && (
        <TextSheet
          title="Gruppe erstellen"
          label="Name"
          submitLabel="Erstellen"
          maxLength={60}
          onSubmit={async (name) => navigate(`/gruppen/${(await api.createGroup(name)).id}`)}
          errorFor={(err) => (err instanceof ApiError && err.status === 400 ? "Gruppe konnte nicht erstellt werden" : undefined)}
          onClose={() => setCreating(false)}
        />
      )}
    </main>
  );
}
