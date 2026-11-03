import { useEffect, useRef, useState } from "react";
import { ApiError, SessionExpiredError, api } from "../api";
import type { StepValues } from "../../shared/schema";

interface Props {
  text: string;
  onAccept(pieces: StepValues[]): void;
  onClose(): void;
  serverError: string;
  busy: boolean;
}

export default function SplitSheet({ text, onAccept, onClose, serverError, busy }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pieces, setPieces] = useState<StepValues[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => dialog.current?.showModal(), []);
  useEffect(() => {
    let current = true;
    api
      .splitStep(text)
      .then((result) => current && setPieces(result.steps))
      .catch((err) => {
        if (!current || err instanceof SessionExpiredError) return;
        setError(err instanceof ApiError ? err.message : "Etwas ist schiefgelaufen. Bitte versuche es erneut.");
      });
    return () => {
      current = false;
    };
  }, [text]);

  const pending = busy || (!pieces && !error);

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose}>
      <div className="sheet-body">
        <h2>Schritt aufteilen</h2>
        {pending && <p className="hint">Wird aufgeteilt …</p>}
        {pieces && (
          <ol className="split-pieces">
            {pieces.map((piece, index) => (
              <li key={index}>
                {piece.text}
                {piece.duration_minutes && <span className="meta small"> · {piece.duration_minutes} Min</span>}
              </li>
            ))}
          </ol>
        )}
        {(error || serverError) && <p className="error" role="alert">{error || serverError}</p>}
        {pieces && (
          <button type="button" className="primary-button inline" disabled={busy} onClick={() => onAccept(pieces)}>
            Vorschlag übernehmen
          </button>
        )}
        <button type="button" className="text-button" disabled={busy} onClick={onClose}>Abbrechen</button>
      </div>
    </dialog>
  );
}
