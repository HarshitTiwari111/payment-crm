/*
 * Verticals and their sub-verticals.
 *
 * A case-insensitive duplicate is refused by the server — letting "igaming" sit
 * beside "iGaming" is how a vertical's data quietly splits in two.
 *
 * Both "add" forms live in modals rather than in a panel above the table: adding a
 * vertical is something you do once in a while, and a permanent form pushed the list
 * — the thing you actually came to read — most of the way down the page.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useApp } from "../context/AppContext";
import { Loading, Empty, Modal, Field } from "../components/ui";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Confirm";
import { useRegisterPageActions } from "../components/PageAction";
import { IconDelete } from "../icons";

export default function Verticals() {
  const { me, verticalOptions, setVerticalOptions, subcats, setSubcats, refresh } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = ["admin", "manager"].includes(me.role);

  const [adding, setAdding] = useState(null);        // null | "vertical" | "sub"
  const [vertName, setVertName] = useState("");
  const [sub, setSub] = useState({ name: "", vertical: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [v, s] = await Promise.all([
      api.get("/api/verticals").catch(() => []),
      api.get("/api/subcategories").catch(() => []),
    ]);
    setVerticalOptions(v || []);
    setSubcats(s || []);
  }, [setVerticalOptions, setSubcats]);

  useEffect(() => { reload(); }, [reload]);

  const openVertical = useCallback(() => { setErr(""); setVertName(""); setAdding("vertical"); }, []);
  const openSub = useCallback(() => { setErr(""); setSub({ name: "", vertical: "" }); setAdding("sub"); }, []);

  useRegisterPageActions(useMemo(
    () => (canEdit
      ? [
        { label: "Add vertical", onClick: openVertical },
        { label: "Add sub-vertical", onClick: openSub, variant: "ghost" },
      ]
      : null),
    [canEdit, openVertical, openSub]
  ));

  // the sub-vertical modal defaults to the first vertical, once the list has loaded
  useEffect(() => {
    if (adding === "sub") setSub((s) => ({ ...s, vertical: s.vertical || verticalOptions[0] || "" }));
  }, [adding, verticalOptions]);

  const close = () => { setAdding(null); setErr(""); };

  const addVertical = async () => {
    setErr("");
    const name = vertName.trim();
    if (!name) { setErr("Give the vertical a name."); return; }
    setBusy(true);
    try {
      await api.post("/api/verticals", { name });
      close();
      await reload();
      refresh();
      toast.success(`Vertical "${name}" added`);
    } catch (e) {
      const msg = e.code === "exists"
        ? "That vertical already exists (names are matched ignoring case)."
        : "Could not add it.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const addSub = async () => {
    setErr("");
    const name = sub.name.trim();
    if (!name) { setErr("Give the sub-vertical a name."); return; }
    if (!sub.vertical) { setErr("Pick the vertical it belongs to."); return; }
    setBusy(true);
    try {
      await api.post("/api/subcategories", { name, vertical: sub.vertical });
      close();
      await reload();
      refresh();
      toast.success(`Sub-vertical "${name}" added`, `Inside ${sub.vertical}.`);
    } catch (e) {
      const msg = e.code === "exists" ? "That sub-vertical already exists here." : "Could not add it.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const delVert = (name) => confirm.ask({
    title: `Remove "${name}"?`,
    message: "It disappears from every dropdown, and its sub-verticals go with it.",
    detail: "Payouts already filed under this vertical keep the name they were saved with, so no numbers are lost — but nobody can pick it again.",
    confirmLabel: "Remove vertical",
    onConfirm: async () => {
      try {
        await api.del(`/api/verticals/${encodeURIComponent(name)}`);
        toast.success(`Vertical "${name}" removed`);
        await reload();
        refresh();
      } catch (e) {
        toast.error(`Could not remove "${name}"`);
      }
    },
  });

  const delSub = (s) => confirm.ask({
    title: `Remove "${s.name}"?`,
    message: `This sub-vertical will be removed from ${s.vertical}.`,
    detail: "Payouts already filed under this sub-vertical stay where they are — it simply stops being offered in the picker.",
    confirmLabel: "Remove sub-vertical",
    onConfirm: async () => {
      try {
        await api.del(`/api/subcategories/${s.id}`);
        toast.success(`Sub-vertical "${s.name}" removed`);
        await reload();
        refresh();
      } catch (e) {
        toast.error("Could not remove it");
      }
    },
  });

  if (!verticalOptions) return <Loading />;

  return (
    <>
      <div className="hint">
        A vertical is what every payout is filed under, and what a manager’s access is drawn around. A
        <b> sub-vertical</b> splits one further, so the same network can be reported on per traffic source.
      </div>

      {!verticalOptions.length ? (
        <Empty title="No verticals yet.">
          {canEdit ? <p>Add the first one — every payout has to be filed under one.</p> : null}
        </Empty>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Vertical</th><th>Sub-verticals</th><th className="right">Action</th></tr></thead>
            <tbody>
              {verticalOptions.map((v) => {
                const subs = subcats.filter((s) => s.vertical === v);
                return (
                  <tr key={v}>
                    <td><b>{v}</b></td>
                    <td>
                      {subs.length ? subs.map((s) => (
                        <span key={s.id} className="pill n" style={{ marginRight: 6 }}>
                          {s.name}
                          {canEdit && (
                            <a
                              href="#"
                              style={{ marginLeft: 6, color: "var(--red)", textDecoration: "none" }}
                              onClick={(e) => { e.preventDefault(); delSub(s); }}
                            >
                              <IconDelete size={11} style={{ verticalAlign: -2 }} />
                            </a>
                          )}
                        </span>
                      )) : <span className="muted">—</span>}
                    </td>
                    <td className="right">
                      {me.role === "admin" && (
                        <button
                          className="btn ico danger"
                          title="Remove vertical" data-tip="Remove vertical" aria-label="Remove vertical"
                          onClick={() => delVert(v)}
                        >
                          <IconDelete size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding === "vertical" && (
        <Modal
          title="Add vertical"
          onClose={close}
          actions={[
            <button key="c" className="btn ghost" onClick={close}>Cancel</button>,
            <button key="s" className="btn primary" onClick={addVertical} disabled={busy}>Add vertical</button>,
          ]}
        >
          <div className="err">{err}</div>
          <Field label="Name">
            <input
              autoFocus
              value={vertName}
              placeholder="e.g. Sweepstakes"
              onChange={(e) => setVertName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addVertical(); }}
            />
          </Field>
          <div className="muted" style={{ fontSize: 11.5 }}>
            Names are matched ignoring case, so "igaming" will be refused if "iGaming" already exists.
          </div>
        </Modal>
      )}

      {adding === "sub" && (
        <Modal
          title="Add sub-vertical"
          onClose={close}
          actions={[
            <button key="c" className="btn ghost" onClick={close}>Cancel</button>,
            <button key="s" className="btn primary" onClick={addSub} disabled={busy || !verticalOptions.length}>
              Add sub-vertical
            </button>,
          ]}
        >
          <div className="err">{err}</div>
          {!verticalOptions.length ? (
            <div className="hint">Add a vertical first — a sub-vertical has to live inside one.</div>
          ) : (
            <div className="row">
              <Field label="Name" style={{ flex: 1 }}>
                <input
                  autoFocus
                  value={sub.name}
                  placeholder="e.g. Facebook"
                  onChange={(e) => setSub({ ...sub, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") addSub(); }}
                />
              </Field>
              <Field label="Inside vertical" style={{ flex: 1 }}>
                <select value={sub.vertical} onChange={(e) => setSub({ ...sub, vertical: e.target.value })}>
                  {verticalOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
            </div>
          )}
        </Modal>
      )}

      {confirm.element}
    </>
  );
}
