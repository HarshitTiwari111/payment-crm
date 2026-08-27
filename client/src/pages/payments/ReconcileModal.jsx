/*
 * Reconcile — the heart of the module (spec §5.3).
 *
 * Money arrives and it rarely matches. Some lands, some is cut in validation, and
 * some slips to a later month. This records all three at once and shows, live,
 * whether the payout ends up fully accounted for.
 *
 * The worked example from the spec, entered here:
 *   received 3,500 | cut 1,000 (validation) | carry 500 → November
 *   3,500 + 1,000 + 500 = 5,000  → settled, and a November payout appears for 500.
 */
import React, { useMemo, useState } from "react";
import { api } from "../../api/client";
import { Modal, Field } from "../../components/ui";
import { money, todayISO, addMonths, monthLabel, dateLabel } from "../../api/format";
import { DEDUCTION_REASONS } from "./shared";
import { IconCarry, IconWarn } from "../../icons";

export default function ReconcileModal({ payout, onClose, onSaved }) {
  const cur = payout.currency || "USD";
  const defaultCarryMonth = addMonths((payout.expectedDate || "").slice(0, 7) || payout.earnedMonth, 1);

  const [form, setForm] = useState({
    date: todayISO(),
    amountReceived: "",
    deduction: "",
    deductionReason: "validation",
    carriedForward: "",
    carriedToMonth: defaultCarryMonth,
    note: "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const received = Number(form.amountReceived) || 0;
  const deduction = Number(form.deduction) || 0;
  const carried = Number(form.carriedForward) || 0;

  const after = useMemo(() => {
    const r = (payout.amountReceived || 0) + received;
    const c = (payout.amountCut || 0) + deduction;
    const f = (payout.amountCarried || 0) + carried;
    const settled = r + c + f;
    const remaining = Math.round((payout.amountExpected - settled) * 100) / 100;
    return { r, c, f, settled, remaining };
  }, [payout, received, deduction, carried]);

  /** Fill the rest as a validation cut — the common "that's all we're getting" case. */
  const cutTheRest = () => {
    const outstanding = Math.max(0, Math.round((payout.pending - received) * 100) / 100);
    setForm({ ...form, deduction: String(outstanding), deductionReason: "validation" });
  };

  /** Push the rest to next month instead. */
  const carryTheRest = () => {
    const outstanding = Math.max(0, Math.round((payout.pending - received - deduction) * 100) / 100);
    setForm({ ...form, carriedForward: String(outstanding) });
  };

  const save = async () => {
    setErr("");
    if (!received && !deduction && !carried) { setErr("Enter at least one of received, cut or carried."); return; }
    if (deduction > 0 && !form.deductionReason) { setErr("A deduction needs a reason."); return; }
    if (carried > 0 && !/^\d{4}-\d{2}$/.test(form.carriedToMonth)) { setErr("Pick the month the carried amount is now expected."); return; }

    setBusy(true);
    try {
      const out = await api.post(`/api/payouts/${payout.id}/reconcile`, {
        date: form.date,
        amountReceived: received,
        deduction,
        deductionReason: deduction ? form.deductionReason : "",
        carriedForward: carried,
        carriedToMonth: carried ? form.carriedToMonth : "",
        note: form.note,
      });
      onSaved(out);
    } catch (e) {
      const map = {
        empty_reconcile: "Enter at least one of received, cut or carried.",
        deduction_needs_reason: "A deduction needs a reason.",
        written_off: "This payout is written off — undo that before reconciling it.",
      };
      setErr(map[e.code] || "Could not save the reconciliation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Reconcile · ${payout.network}`}
      onClose={onClose}
      wide
      actions={[
        <button key="c" className="btn ghost" onClick={onClose}>Cancel</button>,
        <button key="s" className="btn primary" onClick={save} disabled={busy}>Save reconciliation</button>,
      ]}
    >
      <div className="card" style={{ marginBottom: 14, background: "var(--panel2)" }}>
        <div className="flex-between">
          <div>
            <b>{payout.campaign || "—"}</b> · {payout.network}
            {payout.vertical ? <span className="pill n" style={{ marginLeft: 6 }}>{payout.vertical}</span> : null}
          </div>
          <div className="muted">
            Earned {monthLabel(payout.earnedMonth)} · due {payout.expectedDate ? dateLabel(payout.expectedDate) : "—"}
          </div>
        </div>
        <div className="chiprow" style={{ marginTop: 10 }}>
          <span className="pill n">Expected {money(payout.amountExpected, cur)}</span>
          <span className="pill g">Received so far {money(payout.amountReceived, cur)}</span>
          <span className="pill r">Cut {money(payout.amountCut, cur)}</span>
          <span className="pill b">Carried {money(payout.amountCarried, cur)}</span>
          <span className="pill a">Still owed {money(payout.pending, cur)}</span>
        </div>
      </div>

      <div className="err">{err}</div>

      <div className="row">
        <Field label="Date the cash arrived" style={{ flex: 1 }}>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label={`Amount received (${cur})`} style={{ flex: 1 }}>
          <input type="number" step="any" autoFocus value={form.amountReceived}
            onChange={(e) => setForm({ ...form, amountReceived: e.target.value })} />
        </Field>
      </div>

      <div className="row">
        <Field label="Deduction (permanent loss)" style={{ flex: 1 }}>
          <input type="number" step="any" value={form.deduction}
            onChange={(e) => setForm({ ...form, deduction: e.target.value })} />
        </Field>
        <Field label="Reason for the deduction" style={{ flex: 1 }}>
          <select value={form.deductionReason} onChange={(e) => setForm({ ...form, deductionReason: e.target.value })} disabled={!deduction}>
            {DEDUCTION_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>

      <div className="row">
        <Field label="Carry forward (slipping to a later month)" style={{ flex: 1 }}>
          <input type="number" step="any" value={form.carriedForward}
            onChange={(e) => setForm({ ...form, carriedForward: e.target.value })} />
        </Field>
        <Field label="Now expected in" style={{ flex: 1 }}>
          <input type="month" value={form.carriedToMonth} disabled={!carried}
            onChange={(e) => setForm({ ...form, carriedToMonth: e.target.value })} />
        </Field>
      </div>

      <div className="row" style={{ marginTop: -4, marginBottom: 12 }}>
        <button className="btn sm" onClick={cutTheRest}>Cut the rest as validation</button>
        <button className="btn sm" onClick={carryTheRest}>Carry the rest to {monthLabel(form.carriedToMonth)}</button>
      </div>

      <Field label="Note">
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>

      {/* live preview of where this leaves the payout */}
      <div className="card" style={{ background: "var(--panel2)" }}>
        <div className="k">After saving</div>
        <div className="chiprow">
          <span className="pill g">Received {money(after.r, cur)}</span>
          <span className="pill r">Cut {money(after.c, cur)}</span>
          <span className="pill b">Carried {money(after.f, cur)}</span>
          <span className={"pill " + (Math.abs(after.remaining) < 0.005 ? "g" : "a")}>
            {Math.abs(after.remaining) < 0.005
              ? "Fully settled ✓"
              : after.remaining > 0
                ? `${money(after.remaining, cur)} still unaccounted`
                : `${money(-after.remaining, cur)} over — recorded as a true-up`}
          </span>
        </div>
        {carried > 0 && (
          <div className="sub" style={{ marginTop: 8 }}>
            <IconCarry size={14} style={{ verticalAlign: -2, marginRight: 6 }} />A new payout for <b>{money(carried, cur)}</b> will be created for <b>{monthLabel(form.carriedToMonth)}</b>,
            linked back to this one.
          </div>
        )}
        {deduction > 0 && (
          <div className="sub">
            <IconWarn size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{money(deduction, cur)} is a permanent loss — it comes off realized profit and never returns.
          </div>
        )}
      </div>
    </Modal>
  );
}
