/*
 * One payout and its full ledger.
 *
 * Transactions are immutable, so this shows the history exactly as it happened.
 * A correction is posted as an adjusting entry that points back at the one it
 * fixes — the original stays visible, which is the point of an audit trail.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { Modal, Loading, Field } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { IconWarn, IconArrowLeft } from "../../icons";
import { money, monthLabel, dateLabel } from "../../api/format";
import { StatusPill, Cut, DEDUCTION_REASONS } from "./shared";

const PAY_METHOD_LABELS = { bank: "bank account", paypal: "PayPal", crypto: "crypto" };

export default function PayoutDetail({ id, onClose, onChanged, onReconcile }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [adj, setAdj] = useState({ amountReceived: "", deduction: "", note: "" });
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setD(null);
    const r = await api.get(`/api/payouts/${id}`).catch(() => null);
    setD(r);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const postAdjustment = async () => {
    setErr("");
    const rec = Number(adj.amountReceived) || 0;
    const ded = Number(adj.deduction) || 0;
    if (!rec && !ded) { setErr("Enter what should change — amounts can be negative to reverse."); return; }
    try {
      await api.post(`/api/payouts/${id}/adjust`, {
        txnId: adjusting.id,
        amountReceived: rec,
        deduction: ded,
        deductionReason: ded ? "other" : "",
        note: adj.note || `Adjustment to txn #${adjusting.id}`,
      });
      const wasId = adjusting.id;
      setAdjusting(null);
      setAdj({ amountReceived: "", deduction: "", note: "" });
      await load();
      onChanged();
      toast.success(`Adjustment posted against #${wasId}`, "The original entry stays on the ledger — this corrects it.");
    } catch (e) {
      setErr("Could not post the adjustment.");
      toast.error("Could not post the adjustment");
    }
  };

  if (!d) {
    return <Modal title="Payout" onClose={onClose}><Loading /></Modal>;
  }

  const p = d.payout;
  const cur = p.currency || "USD";

  return (
    <Modal
      title={`Payout #${p.id} · ${p.network}`}
      onClose={onClose}
      wide
      actions={[
        <button key="c" className="btn ghost" onClick={onClose}>Close</button>,
        p.status !== "received" && p.status !== "written_off" && (
          <button key="r" className="btn primary" onClick={() => onReconcile(p)}>Reconcile</button>
        ),
      ].filter(Boolean)}
    >
      <div className="flex-between" style={{ marginBottom: 10 }}>
        <div>
          <b>{p.campaign || "—"}</b>
          {p.vertical ? <span className="pill n" style={{ marginLeft: 6 }}>{p.vertical}</span> : null}
          <div className="muted" style={{ fontSize: 12 }}>
            Earned {monthLabel(p.earnedMonth)} · {p.netTerms != null ? `net-${p.netTerms} · ` : ""}
            due {p.expectedDate ? dateLabel(p.expectedDate) : "—"}
          </div>
          {p.payMethod && (
            <div className="muted" style={{ fontSize: 12 }}>
              Paid by {PAY_METHOD_LABELS[p.payMethod] || p.payMethod}
              {p.payAccount ? <> · <b>{p.payAccount}</b></> : null}
            </div>
          )}
        </div>
        <StatusPill status={p.status} isOverdue={p.isOverdue} />
      </div>

      <div className="chiprow" style={{ marginBottom: 14 }}>
        <span className="pill n">Expected {money(p.amountExpected, cur)}</span>
        <span className="pill g">Received {money(p.amountReceived, cur)}</span>
        <span className="pill r">Cut {money(p.amountCut, cur)}</span>
        <span className="pill b">Carried {money(p.amountCarried, cur)}</span>
        {/* One or the other, never both: a payout is either still owed something or
            it came in over. Showing an empty "Pending $0" beside an overpayment was
            the version that read as if the surplus had gone missing. */}
        {p.overpaid > 0
          ? <span className="pill g">Over-paid {money(p.overpaid, cur)}</span>
          : <span className="pill a">Pending {money(p.pending, cur)}</span>}
      </div>

      {p.note && <div className="hint">{p.note}</div>}
      {p.writeOffReason && <div className="hint warn"><IconWarn size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Written off — {p.writeOffReason}</div>}

      {d.parent && (
        <div className="hint">
          <IconArrowLeft size={15} style={{ verticalAlign: -2, marginRight: 6 }} />This payout exists because <b>{money(p.amountExpected, cur)}</b> was carried forward from
          payout <b>#{d.parent.id}</b> ({monthLabel(d.parent.earnedMonth)} earnings, {d.parent.network}).
        </div>
      )}

      <h2 className="sec" style={{ marginTop: 8 }}>Reconciliations ({d.txns.length})</h2>
      {!d.txns.length ? (
        <div className="muted">Nothing received yet.</div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th className="right">Received</th><th className="right">Cut</th>
                <th>Reason</th><th className="right">Carried</th><th>To</th><th>By</th><th />
              </tr>
            </thead>
            <tbody>
              {d.txns.map((t) => (
                <tr key={t.id} style={t.reversalOf ? { background: "var(--panel2)" } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {t.date ? dateLabel(t.date) : "—"}
                    {t.reversalOf && <div className="muted" style={{ fontSize: 10 }}>adjusts #{t.reversalOf}</div>}
                  </td>
                  <td className="num" style={{ color: t.amountReceived >= 0 ? "var(--green)" : "var(--red)" }}>
                    {t.amountReceived ? money(t.amountReceived, cur) : <span className="muted">—</span>}
                  </td>
                  <td className="num"><Cut n={t.deduction} cur={cur} /></td>
                  <td className="muted">{t.deductionReason || "—"}</td>
                  <td className="num">{t.carriedForward ? money(t.carriedForward, cur) : <span className="muted">—</span>}</td>
                  <td className="muted">
                    {t.carriedToMonth ? monthLabel(t.carriedToMonth) : "—"}
                    {t.spawnedPayoutId ? <div style={{ fontSize: 10 }}>→ #{t.spawnedPayoutId}</div> : null}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{t.createdByName}</td>
                  <td className="right">
                    {!t.reversalOf && (
                      <button className="btn sm" onClick={() => setAdjusting(t)}>Adjust</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.children.length > 0 && (
        <>
          <h2 className="sec">Carried forward into</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Payout</th><th>Expected</th><th className="right">Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {d.children.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.id} · {c.network}</td>
                    <td className="muted">{c.expectedDate ? dateLabel(c.expectedDate) : "—"}</td>
                    <td className="num">{money(c.amountExpected, c.currency)}</td>
                    <td><StatusPill status={c.status} isOverdue={c.isOverdue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {adjusting && (
        <div className="card" style={{ marginTop: 14, borderColor: "var(--accent)" }}>
          <div className="k">Adjust reconciliation #{adjusting.id}</div>
          <div className="hint">
            Entries are never edited — this posts a new one that corrects the old. Use a negative amount to reverse
            something that was recorded wrongly (for example −500 received).
          </div>
          <div className="err">{err}</div>
          <div className="row">
            <Field label="Received adjustment" style={{ flex: 1 }}>
              <input type="number" step="any" value={adj.amountReceived}
                onChange={(e) => setAdj({ ...adj, amountReceived: e.target.value })} placeholder="e.g. -500" />
            </Field>
            <Field label="Cut adjustment" style={{ flex: 1 }}>
              <input type="number" step="any" value={adj.deduction}
                onChange={(e) => setAdj({ ...adj, deduction: e.target.value })} />
            </Field>
          </div>
          <Field label="Why">
            <input value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
          </Field>
          <div className="row">
            <button className="btn primary" onClick={postAdjustment}>Post adjustment</button>
            <button className="btn ghost" onClick={() => setAdjusting(null)}>Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
