/*
 * The "are you sure?" dialog.
 *
 * One component for every destructive or irreversible action, so a delete always
 * looks and behaves the same wherever it is triggered. Enter confirms and Escape
 * cancels; the cancel button holds focus, so a stray Enter never deletes anything.
 */
import React, { useEffect, useRef, useState } from "react";

export default function Confirm({
  open = true,
  title = "Are you sure?",
  message,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",          // danger | primary
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && !busy) run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  if (!open) return null;

  async function run() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal confirm" role="alertdialog" aria-modal="true">
        <h3>{title}</h3>
        {message ? <div className="confirm-msg">{message}</div> : null}
        {detail ? <div className="confirm-detail">{detail}</div> : null}
        <div className="actions">
          <button className="btn" ref={cancelRef} onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button className={"btn " + (tone === "primary" ? "primary" : "danger solid")} onClick={run} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Same dialog, but it asks for a line of text first — a rejection remark, a reason
 * for writing something off. Replaces window.prompt so it matches everything else
 * and can require the reason when the reason is the point.
 */
export function PromptModal({
  title,
  message,
  label,
  placeholder,
  initial = "",
  required = false,
  multiline = false,
  confirmLabel = "Submit",
  tone = "primary",
  onSubmit,
  onClose,
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = async () => {
    if (required && !value.trim()) { setErr("This is required."); return; }
    setBusy(true);
    try {
      await onSubmit(value.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440 }} role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {message ? <div className="confirm-msg" style={{ textAlign: "left", marginBottom: 14 }}>{message}</div> : null}
        <div className="field">
          {label ? <label>{label}</label> : null}
          {multiline ? (
            <textarea ref={inputRef} rows={3} value={value} placeholder={placeholder}
              onChange={(e) => { setValue(e.target.value); setErr(""); }} />
          ) : (
            <input ref={inputRef} value={value} placeholder={placeholder}
              onChange={(e) => { setValue(e.target.value); setErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) run(); }} />
          )}
        </div>
        <div className="err">{err}</div>
        <div className="actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={"btn " + (tone === "danger" ? "danger solid" : "primary")} onClick={run} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook form, for pages with several confirmable actions.
 *
 *   const confirm = useConfirm();
 *   confirm.ask({ title, message, confirmLabel, onConfirm });
 *   ...
 *   {confirm.element}
 */
export function useConfirm() {
  const [state, setState] = useState(null);
  const ask = (opts) => setState(opts);
  const close = () => setState(null);
  const element = state ? (
    <Confirm
      {...state}
      onClose={close}
      onConfirm={async () => {
        await state.onConfirm();
        close();
      }}
    />
  ) : null;
  return { ask, close, element };
}
