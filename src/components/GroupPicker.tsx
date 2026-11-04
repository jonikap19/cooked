import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, messageOf, type GroupSummary } from "../api";

interface Props {
  groups: GroupSummary[];
  recipeId: string;
  onClose(): void;
}

export default function GroupPicker({ groups, recipeId, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => dialog.current?.showModal(), []);

  const pick = async (groupId: string) => {
    setBusy(true);
    setError("");
    try {
      navigate(`/rezept/${(await api.shareToGroup(recipeId, groupId)).id}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <div className="sheet-body">
        <h2>In Gruppe teilen</h2>
        {groups.map((group) => (
          <button key={group.id} className="primary-button inline" disabled={busy} onClick={() => void pick(group.id)}>{group.name}</button>
        ))}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </dialog>
  );
}
