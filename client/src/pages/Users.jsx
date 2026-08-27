/*
 * Account management — admin only.
 *
 * Two roles, and what separates them is scope: an admin sees every vertical, a
 * manager only the ones ticked on their account. That makes the vertical list on
 * this form the actual permission control, which is why a manager cannot open this
 * screen — granting yourself a vertical would leave the scoping decorative.
 *
 * Removing someone deactivates them, keeping their history intact and recoverable,
 * rather than deleting it.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useApp } from "../context/AppContext";
import { Loading, Empty, Modal, Field, CheckList } from "../components/ui";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Confirm";
import { IconAdd, IconEdit, IconDelete, IconUndo } from "../icons";
import { vertsOf } from "../api/format";

const ROLE_OPTS = [["manager", "Manager"], ["admin", "Admin"]];

const blank = { name: "", username: "", password: "", role: "manager", vertical: "", verticals: [] };

export default function Users() {
  const { me, verticalOptions, refresh } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);   // null = closed, {} = new
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    const r = await api.get("/api/users").catch(() => []);
    setRows(r || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setErr("");
    setForm(blank);
    setEditing({});
  };

  const openEdit = (u) => {
    setErr("");
    setForm({
      id: u.id, name: u.name, username: u.username, password: "",
      role: u.role, vertical: u.vertical || "", verticals: vertsOf(u),
    });
    setEditing(u);
  };

  const save = async () => {
    setErr("");
    if (!form.name.trim()) { setErr("Display name is required."); return; }
    if (!form.id && !form.username.trim()) { setErr("Username is required."); return; }
    if (!form.id && form.password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (form.role === "manager" && !form.verticals.length) {
      setErr("Pick at least one vertical — a manager with none can see nothing.");
      return;
    }

    const body = {
      name: form.name.trim(),
      role: form.role,
      vertical: form.vertical || form.verticals[0] || "",
      verticals: form.role === "admin" ? [] : form.verticals,
    };

    setBusy(true);
    try {
      if (form.id) {
        await api.put(`/api/users/${form.id}`, body);
        if (form.password) await api.post(`/api/users/${form.id}/password`, { password: form.password });
        toast.success(
          `${body.name} updated`,
          form.password ? "Password changed too — they will have to sign in again." : undefined
        );
      } else {
        const r = await api.post("/api/users", { ...body, username: form.username.trim(), password: form.password });
        toast.success(
          `${body.name} added`,
          r.reactivated
            ? "An earlier account with this username was restored, so their history is back."
            : `Signs in as "${form.username.trim().toLowerCase()}".`
        );
      }
      setEditing(null);
      await load();
      refresh();
    } catch (e) {
      const map = {
        username_taken: "That username is already taken.",
        role_not_allowed: "You cannot assign that role.",
        last_admin: "This is the only admin left — promote someone else before changing this one.",
        invalid_input: "Check the fields: a password needs 8+ characters and a number or symbol.",
      };
      const msg = map[e.code] || "Could not save the account.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = (u) => confirm.ask({
    title: `Remove ${u.name}?`,
    message: "They will be signed out and can no longer log in.",
    detail: "Nothing is deleted — every payout, reconciliation and audit line stays attached to the account, and it can be restored at any time.",
    confirmLabel: "Remove account",
    onConfirm: async () => {
      try {
        await api.del(`/api/users/${u.id}`);
        toast.success(`${u.name} removed`, "Their history is kept and can be restored.");
        await load();
      } catch (e) {
        toast.error(`Could not remove ${u.name}`);
      }
    },
  });

  const reactivate = async (u) => {
    try {
      await api.post(`/api/users/${u.id}/reactivate`);
      toast.success(`${u.name} restored`, "Their old data came back with them.");
      await load();
    } catch (e) {
      toast.error(`Could not restore ${u.name}`);
    }
  };

  if (rows === null) return <Loading />;

  const list = rows.filter((u) => (showInactive ? true : u.active));

  return (
    <>
      <div className="flex-between" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Accounts ({list.length})</div>
        <div className="row" style={{ alignItems: "center" }}>
          <label className="checkline">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show deactivated
          </label>
          <button className="btn primary" onClick={openNew}>
            <IconAdd size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Add account
          </button>
        </div>
      </div>

      {!list.length ? (
        <Empty title="No accounts yet." />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Username</th><th>Role</th><th>Vertical(s)</th>
                <th>Two-factor</th><th className="right">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <b>{u.name}</b>
                    {u.id === me.id && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>(you)</span>}
                    {!u.active && <span className="pill r" style={{ marginLeft: 6 }}>deactivated</span>}
                  </td>
                  <td className="muted">{u.username}</td>
                  <td><span className={"pill " + (u.role === "admin" ? "g" : "n")}>{u.role}</span></td>
                  <td>
                    {u.role === "admin"
                      ? <span className="muted">all verticals</span>
                      : vertsOf(u).length
                        ? vertsOf(u).map((v) => <span key={v} className="pill n" style={{ marginRight: 4 }}>{v}</span>)
                        : <span className="pill r">none — sees nothing</span>}
                  </td>
                  <td>{u.twoFactorEnabled ? <span className="pill g">on</span> : <span className="pill a">off</span>}</td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ico" title="Edit account" data-tip="Edit account" aria-label="Edit account" onClick={() => openEdit(u)}><IconEdit size={14} /></button>{" "}
                    {u.active
                      ? (u.role !== "admin" && (
                        <button className="btn ico danger" title="Remove account" data-tip="Remove account" aria-label="Remove account" onClick={() => deactivate(u)}><IconDelete size={14} /></button>
                      ))
                      : (
                        <button className="btn ico good" title="Restore account" data-tip="Restore account" aria-label="Restore account" onClick={() => reactivate(u)}><IconUndo size={14} /></button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={form.id ? `Edit ${form.name}` : "Add account"}
          onClose={() => setEditing(null)}
          wide
          actions={[
            <button key="c" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>,
            <button key="s" className="btn primary" onClick={save} disabled={busy}>
              {form.id ? "Save changes" : "Create account"}
            </button>,
          ]}
        >
          <div className="err">{err}</div>

          <div className="row">
            <Field label="Display name" style={{ flex: 1 }}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Role" style={{ flex: 1 }}>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>

          <div className="row">
            <Field label="Username (login)" style={{ flex: 1 }}>
              <input value={form.username} disabled={!!form.id} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label={form.id ? "New password (blank = keep)" : "Password"} style={{ flex: 1 }}>
              <input
                type="password"
                placeholder="8+ chars, with a number or symbol"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
          </div>

          {form.role === "admin" ? (
            <div className="hint">An admin sees every vertical, so there is nothing to pick here.</div>
          ) : (
            <Field label="Verticals this manager answers for">
              <CheckList
                options={verticalOptions}
                value={form.verticals}
                onChange={(v) => setForm({ ...form, verticals: v, vertical: v[0] || "" })}
                empty="No verticals defined yet — add one on the Vertical tab."
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                This is the whole of their access: payouts, reports and the calendar are all filtered to these,
                and the server re-checks it on every request.
              </div>
            </Field>
          )}
        </Modal>
      )}

      {confirm.element}
    </>
  );
}
