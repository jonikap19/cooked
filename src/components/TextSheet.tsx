import { useEffect, useId, useRef, useState } from "react";
import { messageOf } from "../api";

interface Props {
  title: string;
  label: string;
  submitLabel: string;
  type?: "text" | "email";
  maxLength?: number;
  onSubmit(value: string): Promise<void>; // throw to show an error and keep the sheet open
  errorFor?(err: unknown): string | undefined; // override messageOf for known statuses
  onClose(): void;
}

export default function TextSheet({ title, label, submitLabel, type = "text", maxLength, onSubmit, errorFor, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => dialog.current?.showModal(), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(errorFor?.(err) ?? messageOf(err));
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <form className="sheet-body" onSubmit={(event) => void submit(event)}>
        <h2>{title}</h2>
        <label className="field-label" htmlFor={inputId}>{label}</label>
        <input id={inputId} className="field" type={type} maxLength={maxLength} value={value} onChange={(e) => setValue(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary-button inline" disabled={busy}>{submitLabel}</button>
        <button type="button" className="text-button" disabled={busy} onClick={onClose}>Abbrechen</button>
      </form>
    </dialog>
  );
}
