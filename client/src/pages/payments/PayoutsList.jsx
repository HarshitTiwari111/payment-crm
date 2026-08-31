/*
 * The payouts table (spec §5.1) — one row per expected payment, with filters and
 * the row actions that move it along.
 *
 * Paged, because payouts multiply fast: every network × every month, plus a child
 * row for every carry-forward.
 *
 * Layout note: the row actions past "Reconcile" are icon buttons — four word-buttons
 * wrapped onto two lines and pushed the whole table sideways.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, qs } from "../../api/client";
import { useApp } from "../../context/AppContext";
import { Loading, Empty, Field } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useConfirm, PromptModal } from "../../components/Confirm";
import Pager from "../../components/Pager";
import { useRegisterPageActions } from "../../components/PageAction";
import {
  IconEdit, IconDelete, IconWriteOff, IconUndo, IconCarry, IconReconcile,
} from "../../icons";
import { money, monthLabel, dateLabel } from "../../api/format";
import { StatusPill, Cut, Money } from "./shared";
import PayoutModal from "./PayoutModal";
import ReconcileModal from "./ReconcileModal";
import PayoutDetail from "./PayoutDetail";

const STATUSES = [
  ["", "All statuses"], ["pending", "Pending"], ["partial", "Partial"],
  ["received", "Received"], ["overdue", "Overdue"], ["written_off", "Written off"],
];

export default function PayoutsList() {
  const { month, pickableVerts, refresh, reloadKey } = useApp();
  /*
   * Only the verticals the current view can actually return. Offering the full list
   * to someone scoped to two of them hands out filters that always come back empty —
   * the server narrows the query whatever the dropdown says.
   */
  const vertChoices = pickableVerts();
  const toast = useToast();
  const confirm = useConfirm();
  const [writingOff, setWritingOff] = useState(null);
  const [res, setRes] = useState(null);
  const [networks, setNetworks] = useState([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [filters, setFilters] = useState({
    month: "", expectedMonth: "", status: "", network: "", vertical: "", q: "", overdue: "",
  });

  const [editing, setEditing] = useState(null);     // payout or {} for new
  const [reconciling, setReconciling] = useState(null);
  const [detail, setDetail] = useState(null);

  // "Add payout" belongs beside the page title, not buried under the filters
  const openNew = useCallback(() => setEditing({}), []);
  useRegisterPageActions(useMemo(() => [{ label: "Add payout", onClick: openNew }], [openNew]));

  const load = useCallback(async () => {
    setRes(null);
    const r = await api.get(`/api/payouts${qs({ ...filters, page, limit })}`).catch(() => null);
    setRes(r || { items: [], total: 0, pages: 1, totals: {} });
  }, [filters, page, limit]);

  useEffect(() => { load(); }, [load, reloadKey]);

  useEffect(() => {
    api.get("/api/networks").then((n) => setNetworks(n || [])).catch(() => setNetworks([]));
  }, [reloadKey]);

  const setF = (k, v) => { setPage(1); setFilters({ ...filters, [k]: v }); };
  const clearFilters = () => {
    setPage(1);
    setFilters({ month: "", expectedMonth: "", status: "", network: "", vertical: "", q: "", overdue: "" });
  };
  const anyFilter = Object.values(filters).some(Boolean);

  const after = async () => { await load(); refresh(); };

  const unWriteOff = async (p) => {
    try {
      await api.post(`/api/payouts/${p.id}/unwriteoff`);
      toast.success(`Write-off reversed on #${p.id}`, "Its status was re-derived from the ledger.");
      after();
    } catch (e) {
      toast.error("Could not reverse the write-off");
    }
  };

  /*
   * Delete.
   *
   * The ledger is counted before anything is asked, so the dialog can name what
   * would go rather than saying "are you sure?" about an unknown quantity. That
   * read is also what decides whether the request carries `confirm` at all — the
   * server refuses a payout with reconciliations without it, which keeps a stray
   * DELETE from taking entries with it.
   *
   * A carry-forward child is not offered at all: deleting the parent would strand a
   * payout sitting in a later month with its own ledger.
   */
  const remove = async (p) => {
    const d = await api.get(`/api/payouts/${p.id}`).catch(() => null);
    const txns = (d && d.txns) || [];
    const children = (d && d.children) || [];
    const label = `${p.network}${p.campaign ? " · " + p.campaign : ""} · ${money(p.amountExpected, p.currency)} expected`;

    if (children.length) {
      toast.error(
        `#${p.id} carried forward into #${children.map((c) => c.id).join(", #")}`,
        "Delete that one first, or write this one off instead."
      );
      return;
    }

    const n = txns.length;
    confirm.ask({
      title: n ? `Delete #${p.id} and its ${n} reconciliation${n === 1 ? "" : "s"}?` : `Delete payout #${p.id}?`,
      message: n
        ? `${label}, with ${money(p.amountReceived, p.currency)} recorded as received against it.`
        : `${label}.`,
      detail: n
        ? "The reconciliations go with it and this cannot be undone. If the money was genuinely never coming, write the payout off instead — that keeps the record."
        : "Nothing has been reconciled against this one yet.",
      confirmLabel: n ? "Delete it and the ledger" : "Delete payout",
      onConfirm: async () => {
        try {
          const r = await api.del(`/api/payouts/${p.id}${n ? "?confirm=1" : ""}`);
          toast.success(
            `Payout #${p.id} deleted`,
            r && r.txnsDeleted ? `${r.txnsDeleted} reconciliation${r.txnsDeleted === 1 ? "" : "s"} went with it.` : undefined
          );
          after();
        } catch (e) {
          if (e.code === "has_children") {
            toast.error("This payout carried forward into another", "Delete that one first, or write this one off.");
          } else if (e.code === "has_history") {
            // the ledger grew between the count and the click
            toast.error("Its ledger changed just now", "Open it, check what is there, and try again.");
          } else {
            toast.error("Could not delete it");
          }
        }
      },
    });
  };

  if (res === null) return <Loading />;

  const t = res.totals || {};

  return (
    <>
      {/* ---- filters ---- */}
      <div className="card filterbar">
        {/* Search leads: it is the one people reach for first, and it is the only
            filter that finds a row when you don't yet know how to narrow it down. */}
        <div className="fgrid">
          <Field label="Search">
            <input value={filters.q} placeholder="campaign, network, note…" onChange={(e) => setF("q", e.target.value)} />
          </Field>
          <Field label="Earned month">
            <input type="month" value={filters.month} onChange={(e) => setF("month", e.target.value)} />
          </Field>
          <Field label="Expected month">
            <input type="month" value={filters.expectedMonth} onChange={(e) => setF("expectedMonth", e.target.value)} />
          </Field>
          <Field label="Status">
            <select value={filters.status} onChange={(e) => setF("status", e.target.value)}>
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Network">
            <select value={filters.network} onChange={(e) => setF("network", e.target.value)}>
              <option value="">All networks</option>
              {networks.map((n) => <option key={n._id} value={n.name}>{n.name}</option>)}
            </select>
          </Field>
          <Field label="Vertical">
            <select value={filters.vertical} onChange={(e) => setF("vertical", e.target.value)}>
              <option value="">All verticals</option>
              {vertChoices.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
        </div>

        <div className="foot">
          <div className="chiprow">
            <label className="checkline" style={{ marginRight: 4 }}>
              <input type="checkbox" checked={filters.overdue === "1"} onChange={(e) => setF("overdue", e.target.checked ? "1" : "")} />
              Overdue only
            </label>
            <span className="pill n">Expected {money(t.expected)}</span>
            <span className="pill g">Received {money(t.received)}</span>
            <span className="pill r">Cut {money(t.cut)}</span>
            <span className="pill b">Carried {money(t.carried)}</span>
            <span className="pill a">Pending {money(t.pending)}</span>
            {anyFilter && <button className="btn sm ghost" onClick={clearFilters}>Clear filters</button>}
          </div>
        </div>
      </div>

      {!res.items.length ? (
        <Empty title="No payouts match these filters.">
          <p>Add one to start tracking what a network owes you.</p>
        </Empty>
      ) : (
        <>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th><th className="nowrap">Network</th><th>Vertical</th><th className="nowrap">Earned</th>
                  <th className="right">Expected</th><th className="right">Received</th>
                  <th className="right">Cut</th><th className="right">Pending</th>
                  <th className="nowrap">Due</th><th>Status</th><th className="actioncol">Action</th>
                </tr>
              </thead>
              <tbody>
                {res.items.map((p) => (
                  <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setDetail(p.id)}>
                    <td>
                      {p.campaign
                        ? <span className="ellip" title={p.campaign}>{p.campaign}</span>
                        : <span className="muted">—</span>}
                      {p.parentId && (
                        <div className="muted nowrap" style={{ fontSize: 10.5, display: "flex", alignItems: "center", gap: 4 }}>
                          <IconCarry size={11} /> carried from #{p.parentId}
                        </div>
                      )}
                    </td>
                    {/* the network name is an identifier — breaking "Network X" over
                        two lines makes the row much harder to scan */}
                    <td className="nowrap"><b>{p.network}</b></td>
                    <td>{p.vertical ? <span className="pill n">{p.vertical}</span> : <span className="muted">—</span>}</td>
                    <td className="muted nowrap">{monthLabel(p.earnedMonth)}</td>
                    <td className="num"><Money n={p.amountExpected} cur={p.currency} /></td>
                    <td className="num" style={{ color: p.amountReceived ? "var(--green)" : undefined }}>
                      <Money n={p.amountReceived} cur={p.currency} />
                    </td>
                    <td className="num"><Cut n={p.amountCut} cur={p.currency} /></td>
                    <td className="num">
                      <Money n={p.pending} cur={p.currency} bold />
                      {p.overpaid > 0 && (
                        <div className="nowrap" style={{ fontSize: 10.5, color: "var(--green)" }}>
                          +{money(p.overpaid, p.currency)} over
                        </div>
                      )}
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap", color: p.isOverdue ? "var(--red)" : undefined }}>
                      {p.expectedDate ? dateLabel(p.expectedDate) : "—"}
                    </td>
                    <td>
                      <span className="statuscell"><StatusPill status={p.status} isOverdue={p.isOverdue} /></span>
                    </td>
                    <td className="actioncol" onClick={(e) => e.stopPropagation()}>
                      <span className="rowactions">
                        {p.status !== "received" && p.status !== "written_off" && (
                          <button
                            className="btn ico primary"
                            title="Reconcile" data-tip="Reconcile"
                            aria-label="Reconcile"
                            onClick={() => setReconciling(p)}
                          >
                            <IconReconcile size={15} />
                          </button>
                        )}
                        <button className="btn ico" title="Edit payout" data-tip="Edit payout" aria-label="Edit payout" onClick={() => setEditing(p)}>
                          <IconEdit size={14} />
                        </button>
                        {p.status === "written_off" ? (
                          <button className="btn ico good" title="Undo write-off" data-tip="Undo write-off" aria-label="Undo write-off" onClick={() => unWriteOff(p)}>
                            <IconUndo size={14} />
                          </button>
                        ) : p.pending > 0 ? (
                          <button className="btn ico danger" title="Write off" data-tip="Write off" aria-label="Write off" onClick={() => setWritingOff(p)}>
                            <IconWriteOff size={14} />
                          </button>
                        ) : null}
                        {/*
                          Always offered. It used to appear only on a payout with an
                          empty ledger, which hid it exactly when someone needed it —
                          a row entered wrongly has a ledger, and the person looking
                          for the delete button was looking at a row with no button.
                          What it does about the ledger is settled in the dialog.
                        */}
                        <button className="btn ico danger" title="Delete payout" data-tip="Delete payout" aria-label="Delete payout" onClick={() => remove(p)}>
                          <IconDelete size={14} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager
            page={res.page}
            pages={res.pages}
            total={res.total}
            limit={limit}
            noun="payout"
            onPage={setPage}
            onLimit={(n) => { setLimit(n); setPage(1); }}
          />
        </>
      )}

      {editing && (
        <PayoutModal
          payout={editing.id ? editing : null}
          networks={networks}
          onClose={() => setEditing(null)}
          onSaved={(p, wasEdit) => {
            setEditing(null);
            after();
            toast.success(
              wasEdit ? `Payout #${p.id} updated` : `Payout added for ${p.network}`,
              `${money(p.amountExpected, p.currency)} expected${p.expectedDate ? " by " + dateLabel(p.expectedDate) : ""}.`
            );
          }}
        />
      )}
      {reconciling && (
        <ReconcileModal
          payout={reconciling}
          onClose={() => setReconciling(null)}
          onSaved={(result) => {
            setReconciling(null);
            after();
            const p = result.payout;
            const bits = [];
            if (result.txn.amountReceived) bits.push(`${money(result.txn.amountReceived, p.currency)} received`);
            if (result.txn.deduction) bits.push(`${money(result.txn.deduction, p.currency)} cut`);
            if (result.txn.carriedForward) bits.push(`${money(result.txn.carriedForward, p.currency)} carried to ${monthLabel(result.txn.carriedToMonth)}`);
            toast.success(
              p.status === "received" ? `${p.network} fully settled` : `${p.network} reconciled`,
              bits.join(" · ")
            );
            if (result.child) {
              toast.info(`Carry-forward payout #${result.child.id} created`, `${money(result.child.amountExpected, p.currency)} now expected ${dateLabel(result.child.expectedDate)}.`);
            }
          }}
        />
      )}
      {writingOff && (
        <PromptModal
          tone="danger"
          title={`Write off ${money(writingOff.pending, writingOff.currency)}?`}
          message={`${writingOff.network}${writingOff.campaign ? " · " + writingOff.campaign : ""} — this marks the outstanding amount as unrecoverable.`}
          label="Why is it unrecoverable?"
          placeholder="e.g. network stopped responding, account closed"
          required
          multiline
          confirmLabel="Write it off"
          onClose={() => setWritingOff(null)}
          onSubmit={async (reason) => {
            try {
              await api.post(`/api/payouts/${writingOff.id}/writeoff`, { reason });
              toast.warn(
                `${money(writingOff.pending, writingOff.currency)} written off`,
                "It now counts as a permanent loss in realized profit."
              );
              setWritingOff(null);
              after();
            } catch (e) {
              toast.error("Could not write it off");
            }
          }}
        />
      )}
      {confirm.element}
      {detail && (
        <PayoutDetail
          id={detail}
          onClose={() => setDetail(null)}
          onChanged={after}
          onReconcile={(p) => { setDetail(null); setReconciling(p); }}
        />
      )}
    </>
  );
}
