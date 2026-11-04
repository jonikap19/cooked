import { useCallback, useEffect, useState } from "react";
import { ApiError, api, messageOf, type Invite } from "../api";

interface Props {
  onAccepted?(): void;
}

// Pending group invites; renders nothing when there are none (or the lookup fails).
export default function Invites({ onAccepted }: Props) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.listInvites().then(setInvites, () => {}), []);
  useEffect(() => void load(), [load]);

  const answer = async (groupId: string, accept: boolean) => {
    setBusy(true);
    setError("");
    try {
      await (accept ? api.acceptInvite(groupId) : api.declineInvite(groupId));
      await load();
      if (accept) onAccepted?.();
    } catch (err) {
      setError(accept && err instanceof ApiError && err.status === 400 ? "Beitritt nicht möglich" : messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (invites.length === 0) return null;
  return (
    <section className="invites">
      {invites.map((invite) => (
        <div key={invite.group_id} className="invite">
          <strong>{invite.group_name}</strong>
          <div className="invite-actions">
            <button className="invite-accept" disabled={busy} onClick={() => void answer(invite.group_id, true)}>Einladung annehmen</button>
            <button className="invite-decline" disabled={busy} onClick={() => void answer(invite.group_id, false)}>Ablehnen</button>
          </div>
        </div>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
