import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface Props {
  tags: string[];
  busy: boolean; // while a change saves, `tags` is stale and a second change would be dropped
  onChange(tags: string[]): void;
  onClose(): void;
}

export default function TagDialog({ tags, busy, onChange, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  const [draft, setDraft] = useState("");
  useEffect(() => dialog.current?.showModal(), []);

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const tag = draft.trim();
    if (busy || !tag || tags.includes(tag) || tags.length >= 10) return;
    onChange([...tags, tag]);
    setDraft("");
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <div className="sheet-body">
      <h2>Tags</h2>
      <div className="tag-list">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            <button className="icon-button" aria-label={`${tag} entfernen`} disabled={busy} onClick={() => onChange(tags.filter((t) => t !== tag))}>
              <X size={16} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={add}>
        <label className="field-label" htmlFor={inputId}>Neuer Tag</label>
        <input id={inputId} className="field" maxLength={30} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="primary-button inline" disabled={busy}>Hinzufügen</button>
      </form>
      </div>
    </dialog>
  );
}
