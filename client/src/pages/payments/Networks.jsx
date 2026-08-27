/*
 * Networks — who the money comes from, and on what terms.
 *
 * These are a real list rather than free text on each payout for one reason: the
 * verticals in this CRM had to be repaired once because "igaming" and "iGaming"
 * both existed and every report split in two. Networks would go exactly the same
 * way, so names are unique here and a case-insensitive duplicate is refused.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { useApp } from "../../context/AppContext";
import { Loading, Empty, Modal, Field } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Confirm";
import { IconAdd, IconEdit, IconDelete } from "../../icons";
import { NET_TERMS } from "./shared";

const blank = { name: "", netTerms: 30, defaultCurrency: "USD", contact: "", note: "", active: true };

export default function Networks() {
  const { me, refresh, reloadKey } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setRows(null);
    const r = await api.get("/api/networks?all=1").catch(() => []);
    setRows(r || []);
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  const openNew = () => { setForm(blank); setErr(""); setEditing({}); };
  const openEdit = (n) => {
    setForm({
      _id: n._id, name: n.name, netTerms: n.netTerms ?? 30,
      defaultCurrency: n.defaultCurrency || "USD", contact: n.contact || "",
      note: n.note || "", active: n.active !== false,
    });
    setErr("");
    setEditing(n);
  };

  const save = async () => {
    setErr("");
    if (!form.name.trim()) { setErr("A name is required."); return; }
    try {
      if (form._id) {
        await api.put(`/api/networks/${form._id}`, form);
        toast.success(`${form.name} updated`, `Net-${form.netTerms} · ${form.defaultCurrency}`);
      } else {
        await api.post("/api/networks", form);
        toast.success(`${form.name} added`, `New payouts will default to net-${form.netTerms}.`);
      }
      setEditing(null);
      await load();
      refresh();
    } catch (e) {
      const msg = e.code === "exists"
        ? "A network with that name already exists (names are matched ignoring case)."
        : "Could not save it.";
      setErr(msg);
      toast.error(msg);
    }
  };

  const remove = (n) => confirm.ask({
    title: `Remove ${n.name}?`,
    message: "It disappears from the network picker.",
    detail: "A network with payouts against it cannot be removed — mark it inactive instead, which hides it from new payouts while keeping the history readable.",
    confirmLabel: "Remove network",
    onConfirm: async () => {
      try {
        await api.del(`/api/networks/${n._id}`);
        toast.success(`${n.name} removed`);
        await load();
      } catch (e) {
        toast.error(
          e.code === "in_use" ? `${n.name} still has payouts against it` : "Could not remove it",
          e.code === "in_use" ? `${e.body?.payouts} payout(s) reference it. Mark it inactive instead.` : undefined
        );
      }
    },
  });

  if (rows === null) return <Loading />;

  return (
    <>
      <div className="flex-between" style={{ marginBottom: 14 }}>
        <div className="muted">
          Net terms set here decide when a new payout is expected — net-60 on August earnings lands in late October.
        </div>
        {<button className="btn primary" onClick={openNew}>{<IconAdd size={14} style={{ verticalAlign: -2, marginRight: 6 }} />}Add network</button>}
      </div>

      {!rows.length ? (
        <Empty title="No networks yet.">
          <p>Add the networks that pay you, or just type a new name when creating a payout — it gets registered automatically.</p>
        </Empty>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Network</th><th>Net terms</th><th>Currency</th><th>Contact</th><th>Note</th><th className="actioncol">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n._id} style={n.active === false ? { opacity: 0.55 } : undefined}>
                  <td>
                    <b>{n.name}</b>
                    {n.active === false && <span className="pill n" style={{ marginLeft: 6 }}>inactive</span>}
                  </td>
                  <td>{n.netTerms === 0 ? "Immediate" : `Net-${n.netTerms}`}</td>
                  <td>{n.defaultCurrency}</td>
                  <td className="muted">{n.contact || "—"}</td>
                  <td className="muted">{n.note || "—"}</td>
                  <td className="actioncol" style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ico" title="Edit network" data-tip="Edit network" aria-label="Edit network" onClick={() => openEdit(n)}><IconEdit size={14} /></button>{" "}
                    {/* deleting is admin-only: a network name is the join key on every
                        payout filed against it, so removing one is not a local edit */}
                    {me.role === "admin" && <button className="btn ico danger" title="Remove network" data-tip="Remove network" aria-label="Remove network" onClick={() => remove(n)}><IconDelete size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={form._id ? `Edit ${form.name}` : "Add network"}
          onClose={() => setEditing(null)}
          actions={[
            <button key="c" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>,
            <button key="s" className="btn primary" onClick={save}>{form._id ? "Save" : "Add network"}</button>,
          ]}
        >
          <div className="err">{err}</div>
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Network X" />
          </Field>
          <div className="row">
            <Field label="Default net terms" style={{ flex: 1 }}>
              <select value={String(form.netTerms)} onChange={(e) => setForm({ ...form, netTerms: Number(e.target.value) })}>
                {NET_TERMS.filter(([v]) => v !== "").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Currency" style={{ width: 120 }}>
              <input value={form.defaultCurrency} maxLength={4}
                onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <Field label="Contact (optional)">
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="affiliate manager, email, Skype" />
          </Field>
          <Field label="Note">
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          {form._id && (
            <label className="checkline">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active — show this network when creating payouts
            </label>
          )}
        </Modal>
      )}

      {confirm.element}
    </>
  );
}
