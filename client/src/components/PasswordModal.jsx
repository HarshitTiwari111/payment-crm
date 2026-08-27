import React, { useState } from "react";
import { api } from "../api/client";
import { Modal, Field } from "./ui";
import { useToast } from "./Toast";

export default function PasswordModal({ onClose }) {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setErr("");
    if (!next || next.length < 6) { setErr("New password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      await api.post("/api/me/password", { current: cur, next });
      onClose();
      toast.success("Password updated", "Use the new one next time you sign in.");
    } catch (e) {
      const msg = e.code === "wrong_current" ? "Current password is wrong." : "Could not update the password.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Change my password"
      onClose={onClose}
      actions={[
        <button key="c" className="btn ghost" onClick={onClose}>Cancel</button>,
        <button key="s" className="btn primary" onClick={save} disabled={busy}>Update</button>,
      ]}
    >
      <div className="err">{err}</div>
      <Field label="Current password">
        <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
      </Field>
      <Field label="New password (min 6)">
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
    </Modal>
  );
}
