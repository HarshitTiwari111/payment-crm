/*
 * Add or edit an expected receivable (spec §5.2).
 *
 * The due date is derived from the net terms — the network's own, unless one is
 * chosen here — but stays editable, because networks move dates around.
 */
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useApp } from "../../context/AppContext";
import { Modal, Field } from "../../components/ui";
import { curMonthStr, daysInMonthOf, monthLabel, dateLabel } from "../../api/format";
import { NET_TERMS } from "./shared";

/*
 * How the money is going to arrive. Exactly one, or none at all.
 *
 * Drawn as checkboxes because that is what was asked for, but they behave as one
 * choice: ticking one unticks the others, and ticking the current one clears it
 * back to "not decided". The server stores a single `payMethod`, so there is no
 * shape in which two of these can both be true.
 */
const PAY_METHODS = [
  ["bank",   "Bank account", "Bank name",  "e.g. HDFC Bank"],
  ["paypal", "PayPal",       "PayPal id",  "e.g. finance@company.com"],
  ["crypto", "Crypto",       "Crypto id",  "e.g. wallet address or tag"],
];

/** Same rule as the server: end of the earning month plus the terms. */
function deriveDate(earnedMonth, netTerms) {
  const days = Number(netTerms);
  if (!earnedMonth || !Number.isFinite(days)) return "";
  const [y, m] = earnedMonth.split("-").map(Number);
  if (!y || !m) return "";
  const d = new Date(y, m - 1, daysInMonthOf(earnedMonth));
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export default function PayoutModal({ payout, networks, onClose, onSaved }) {
  const { pickableVerts, subsOf } = useApp();
  const allowed = pickableVerts();

  const [form, setForm] = useState(() => ({
    campaign: payout?.campaign || "",
    network: payout?.network || "",
    vertical: payout?.vertical || allowed[0] || "",
    subcategory: payout?.subcategory || "",
    earnedMonth: payout?.earnedMonth || curMonthStr(),
    amountExpected: payout?.amountExpected || "",
    netTerms: payout?.netTerms == null ? "" : String(payout.netTerms),
    expectedDate: payout?.expectedDate || "",
    currency: payout?.currency || "USD",
    note: payout?.note || "",
  }));
  const [payMethod, setPayMethod] = useState(payout?.payMethod || "");

  /*
   * One box per method rather than a single shared input: switch from PayPal to
   * bank and back, and what you typed is still there. Only the selected method's
   * value is ever sent.
   */
  const [payAccounts, setPayAccounts] = useState(() => ({
    bank: "", paypal: "", crypto: "",
    ...(payout?.payMethod ? { [payout.payMethod]: payout.payAccount || "" } : {}),
  }));

  const chooseMethod = (key) => setPayMethod((cur) => (cur === key ? "" : key));

  const [touchedDate, setTouchedDate] = useState(!!payout?.expectedDate);
  const [campaigns, setCampaigns] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/campaigns").then((c) => setCampaigns(c || [])).catch(() => setCampaigns([]));
  }, []);

  /** The terms actually in play: the ones picked here, else the network's default. */
  const effectiveTerms = useMemo(() => {
    if (form.netTerms !== "") return Number(form.netTerms);
    const n = networks.find((x) => x.name.toLowerCase() === form.network.trim().toLowerCase());
    return n ? n.netTerms : 30;
  }, [form.netTerms, form.network, networks]);

  // keep the date in step with the terms until someone edits it by hand
  useEffect(() => {
    if (touchedDate) return;
    setForm((f) => ({ ...f, expectedDate: deriveDate(f.earnedMonth, effectiveTerms) }));
  }, [form.earnedMonth, effectiveTerms, touchedDate]);

  const save = async () => {
    setErr("");
    if (!form.network.trim()) { setErr("Which network owes this?"); return; }
    if (!/^\d{4}-\d{2}$/.test(form.earnedMonth)) { setErr("Pick the month the earnings came from."); return; }
    if (!Number(form.amountExpected)) { setErr("Enter the amount they owe."); return; }

    if (payMethod && !payAccounts[payMethod].trim()) {
      const [, , inputLabel] = PAY_METHODS.find(([k]) => k === payMethod);
      setErr(`Enter the ${inputLabel.toLowerCase()}, or untick the box.`);
      return;
    }

    const body = {
      ...form,
      amountExpected: Number(form.amountExpected),
      netTerms: form.netTerms === "" ? null : Number(form.netTerms),
      // only the chosen method travels; the other two boxes were just scratch space
      payMethod,
      payAccount: payMethod ? payAccounts[payMethod].trim() : "",
    };
    setBusy(true);
    try {
      const saved = payout
        ? await api.put(`/api/payouts/${payout.id}`, body)
        : await api.post("/api/payouts", body);
      onSaved(saved, !!payout);
    } catch (e) {
      setErr(e.code === "forbidden_vertical" ? "That vertical is outside your scope." : "Could not save the payout.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={payout ? `Edit payout #${payout.id}` : "Add payout"}
      onClose={onClose}
      wide
      actions={[
        <button key="c" className="btn ghost" onClick={onClose}>Cancel</button>,
        <button key="s" className="btn primary" onClick={save} disabled={busy}>
          {payout ? "Save changes" : "Add payout"}
        </button>,
      ]}
    >
      <div className="hint">
        One payout per <b>campaign × network</b>. The same campaign running on three networks is three payouts,
        each with its own amount and its own due date — that is the whole point of tracking them separately.
      </div>
      <div className="err">{err}</div>

      <div className="formgrid">
        <Field label="Network (who owes)">
          <input
            list="networkList"
            value={form.network}
            onChange={(e) => setForm({ ...form, network: e.target.value })}
            placeholder="e.g. Network X"
          />
          <datalist id="networkList">
            {networks.map((n) => <option key={n._id} value={n.name} />)}
          </datalist>
        </Field>
        <Field label="Vertical">
          {/* changing the vertical drops the sub-vertical: it belonged to the old one */}
          <select value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value, subcategory: "" })}>
            <option value="">—</option>
            {allowed.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>

        {/*
          Only where the chosen vertical is actually split into sub-verticals. Drawing
          an empty dropdown on the others would suggest something is missing.
        */}
        {subsOf(form.vertical).length > 0 && (
          <Field label="Sub-vertical (optional)">
            <select value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })}>
              <option value="">—</option>
              {subsOf(form.vertical).map((sc) => <option key={sc.id ?? sc.name} value={sc.name}>{sc.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Campaign (optional)">
          <input
            list="campaignList"
            value={form.campaign}
            onChange={(e) => setForm({ ...form, campaign: e.target.value })}
            placeholder="campaign name or id"
          />
          <datalist id="campaignList">
            {campaigns.map((c) => <option key={c._id} value={c.name} />)}
          </datalist>
        </Field>
        <Field label="Earned month">
          <input type="month" value={form.earnedMonth} onChange={(e) => setForm({ ...form, earnedMonth: e.target.value })} />
        </Field>

        <Field label="Amount expected (revenue owed)">
          <input type="number" step="any" value={form.amountExpected} onChange={(e) => setForm({ ...form, amountExpected: e.target.value })} />
        </Field>
        <Field label="Currency">
          <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={4} />
        </Field>

        <Field label="Net terms">
          <select value={form.netTerms} onChange={(e) => { setForm({ ...form, netTerms: e.target.value }); setTouchedDate(false); }}>
            {NET_TERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Expected date">
          <input
            type="date"
            value={form.expectedDate}
            onChange={(e) => { setForm({ ...form, expectedDate: e.target.value }); setTouchedDate(true); }}
          />
        </Field>
        {/*
          Note sits here rather than at the foot of the form: the row Expected date is
          on had an empty right-hand cell, because the sentence below it spans the
          full width and starts a new row. Filling it costs nothing and saves the form
          a line.
        */}
        <Field label="Note">
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>

        {form.earnedMonth && form.expectedDate && (
          <div className="muted full" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
            Earned in {monthLabel(form.earnedMonth)}, net-{effectiveTerms} → money expected around <b>{dateLabel(form.expectedDate)}</b>.
            {touchedDate ? " (date set by hand)" : ""}
          </div>
        )}

        <Field label="How will it be paid?">
          <div className="checkwrap" style={{ paddingTop: 2 }}>
            {PAY_METHODS.map(([key, label]) => (
              <label key={key} className="checkline" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={payMethod === key}
                  onChange={() => chooseMethod(key)}
                />
                {label}
              </label>
            ))}
          </div>
        </Field>
        {/*
          Nothing follows this row now that Note has moved up, so an unticked method
          simply leaves the cell beside it empty — there is no field below for the
          grid to pull up into it.
        */}
        {payMethod ? (
          PAY_METHODS.filter(([key]) => key === payMethod).map(([key, , inputLabel, placeholder]) => (
            <Field key={key} label={inputLabel}>
              <input
                value={payAccounts[key]}
                onChange={(e) => setPayAccounts({ ...payAccounts, [key]: e.target.value })}
                placeholder={placeholder}
                maxLength={200}
              />
            </Field>
          ))
        ) : null}
      </div>

      {payout && (
        <div className="hint">
          Received, cut and carried are not editable here — they are rebuilt from this payout's reconciliations,
          so the totals can never quietly disagree with its own ledger. To correct a mistake, post an adjustment
          from the payout's detail view.
        </div>
      )}
    </Modal>
  );
}
