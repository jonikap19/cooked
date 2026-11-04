import { useEffect, useRef, useState } from "react";
import { ApiError, api, messageOf } from "../api";

interface Props {
  recipeId: string;
  onClose(): void;
}

export default function ShareSheet({ recipeId, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => dialog.current?.showModal(), []);

  const create = async (mode: "baked" | "with_comments") => {
    setBusy(true);
    setError("");
    try {
      setLink(location.origin + (await api.shareRecipe(recipeId, mode)).url);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Zu viele Links. Bitte warte kurz." : messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard is unavailable on plain http or when denied; selecting lets the user copy by hand.
      linkField.current?.select();
    }
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <div className="sheet-body">
        <h2>Rezept teilen</h2>
        {!link ? (
          <>
            <p className="meta">Wie soll das Rezept geteilt werden?</p>
            <button className="primary-button inline" disabled={busy} onClick={() => void create("baked")}>ohne Kommentare</button>
            <button className="primary-button inline" disabled={busy} onClick={() => void create("with_comments")}>mit Kommentaren</button>
          </>
        ) : (
          <>
            <input ref={linkField} className="field" readOnly aria-label="Link" value={link} onFocus={(e) => e.target.select()} />
            <p className="meta small">Gültig für 24 Stunden</p>
            <button className="primary-button inline" onClick={() => void copy()}>{copied ? "Kopiert" : "Link kopieren"}</button>
            {"share" in navigator && (
              <button className="primary-button inline" onClick={() => void navigator.share({ url: link }).catch(() => {})}>Teilen …</button>
            )}
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </dialog>
  );
}
