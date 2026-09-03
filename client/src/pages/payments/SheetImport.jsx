/*
 * Importing payouts from a Google Sheet.
 *
 * Two steps, always. Paste the link, see what is in it, then decide — nothing is
 * written until the second click. A sheet is somebody's working file: a wrong tab,
 * a renamed column or a month typed differently would otherwise land forty rows in
 * the books before anyone could look at them.
 *
 * The preview is not a sample. It is the same read the import performs, reported
 * instead of applied, so what it says will happen is what happens.
 */
import React, { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useApp } from "../../context/AppContext";
import { Modal, Field, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { money, monthLabel } from "../../api/format";

/* The sentence for each way a read can fail, in place of the machine word. */
const FAILURES = {
  sheet_not_public: "This server could not open the sheet — Google answered with a sign-in page.",
  fetch_failed: "The link could not be opened.",
  no_url: "Paste the sheet's link first.",
};

const OUTCOME = {
  import: { label: "will import", cls: "g" },
  already: { label: "already here", cls: "n" },
  outofscope: { label: "not yours", cls: "r" },
  skipped: { label: "skipped", cls: "a" },
};

export default function SheetImport({ onClose, onImported }) {
  const toast = useToast();
  const { pickableVerts } = useApp();
  const verts = pickableVerts();
  const [source, setSource] = useState(null);
  const [url, setUrl] = useState("");
  const [vertical, setVertical] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get("/api/sheet")
      .then((s) => { setSource(s); setUrl(s.url || ""); })
      .catch(() => setSource({}));
  }, []);

  const fail = (e) => {
    const known = FAILURES[e && e.code];
    setErr({
      title: known || "Could not read the sheet.",
      detail: (e && e.body && e.body.detail) || "",
      // the one failure a person can actually do something about
      help: e && e.code === "sheet_not_public",
    });
  };

  const doPreview = async () => {
    setErr(null); setPreview(null); setBusy("preview");
    try {
      setPreview(await api.post("/api/sheet/preview", { url, vertical }));
    } catch (e) { fail(e); }
    setBusy("");
  };

  const doImport = async () => {
    setErr(null); setBusy("import");
    try {
      const r = await api.post("/api/sheet/import", { url, vertical });
      setSource(r.source);
      setPreview(r);
      onImported();
      toast.success(
        `${r.counts.imported} payout${r.counts.imported === 1 ? "" : "s"} imported`,
        r.counts.reconciled ? `${r.counts.reconciled} of them arrived already paid.` : undefined
      );
    } catch (e) { fail(e); }
    setBusy("");
  };

  const counts = preview && preview.counts;

  return (
    <Modal
      title="Import payouts from a sheet"
      onClose={onClose}
      wide
      actions={[
        <button key="c" className="btn ghost" onClick={onClose}>Close</button>,
        <button key="p" className="btn" onClick={doPreview} disabled={!url || !!busy}>
          {busy === "preview" ? "Reading…" : "Read the sheet"}
        </button>,
        counts && counts.imported > 0 && (
          <button key="i" className="btn primary" onClick={doImport} disabled={!!busy}>
            {busy === "import" ? "Importing…" : `Import ${counts.imported}`}
          </button>
        ),
      ].filter(Boolean)}
    >
      {!source ? <Loading /> : (
        <>
          <Field label="Google Sheet link">
            <input
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
            />
          </Field>
          <div className="hint">
            Paste the link from the address bar — the sheet, the tab, or a published
            one all work. This server has no Google account of its own, so it opens
            the link the way a stranger would: the sheet has to be readable by anyone
            who has it.
          </div>

          {/*
            Most of these sheets have no vertical column — a sheet is kept per
            vertical, so the answer is the same for every row and the person importing
            already knows it. Asked once here rather than demanded as a column they
            would have to go and add. A sheet that does name a vertical per row keeps
            its own; this only fills the gaps.
          */}
          <Field label="File rows under">
            <select value={vertical} onChange={(e) => { setVertical(e.target.value); setPreview(null); }}>
              <option value="">— whatever the sheet says —</option>
              {verts.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <div className="hint">
            Used for any row whose own vertical is blank. Leave it as it is if the
            sheet has a vertical column of its own.
          </div>

          {source.lastRunAt && (
            <div className="hint">
              Last run {new Date(source.lastRunAt).toLocaleString()} by {source.lastRunBy} —{" "}
              {source.lastResult === "ok"
                ? `${source.lastCounts.imported} imported, ${source.lastCounts.skippedExisting} already here.`
                : <span style={{ color: "var(--red)" }}>failed: {source.lastError}</span>}
            </div>
          )}

          {err && (
            <div className="err">
              {err.title} {err.detail}
              {err.help && (
                <div style={{ marginTop: 6, fontWeight: 400 }}>
                  In the sheet: <b>Share → General access → Anyone with the link → Viewer</b>,
                  or <b>File → Share → Publish to web</b>.
                </div>
              )}
            </div>
          )}

          {preview && (
            <>
              {/*
                What each column became. A header read as the wrong field is the
                failure that looks like success — the rows arrive and one column of
                money is quietly zero — so it is said before anything is imported.
              */}
              <h2 className="sec">Columns</h2>
              <div className="chiprow">
                {preview.mapped.map((m) => (
                  <span key={m.field} className="pill n">{m.header} → {m.field}</span>
                ))}
              </div>
              {preview.ignored.length > 0 && (
                <div className="hint">
                  Not used: {preview.ignored.join(", ")}. Profit is not imported — it is
                  worked out from revenue and cost, so a stored copy could disagree with them.
                </div>
              )}

              <h2 className="sec">
                {counts.read} row{counts.read === 1 ? "" : "s"} read
              </h2>
              <div className="chiprow" style={{ marginBottom: 10 }}>
                <span className="pill g">{counts.imported} to import</span>
                {counts.reconciled > 0 && <span className="pill g">{counts.reconciled} already paid</span>}
                {counts.skippedExisting > 0 && <span className="pill n">{counts.skippedExisting} already here</span>}
                {counts.skippedScope > 0 && <span className="pill r">{counts.skippedScope} not yours</span>}
                {counts.skippedBad > 0 && <span className="pill a">{counts.skippedBad} unusable</span>}
              </div>

              <div className="tablewrap" style={{ maxHeight: 320, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Row</th><th>Campaign</th><th>Network</th><th>Vertical</th>
                      <th>Month</th><th className="right">Revenue</th><th className="right">Cost</th>
                      <th>What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.results.map((r) => {
                      const o = OUTCOME[r.outcome] || OUTCOME.skipped;
                      return (
                        <tr key={r.rowNumber} style={r.outcome === "import" ? undefined : { opacity: 0.65 }}>
                          <td className="muted">{r.rowNumber}</td>
                          <td>{r.campaign || <span className="muted">—</span>}</td>
                          <td>{r.network || <span className="muted">—</span>}</td>
                          <td>{r.vertical || <span className="muted">—</span>}</td>
                          <td className="muted nowrap">{r.earnedMonth ? monthLabel(r.earnedMonth) : "—"}</td>
                          <td className="num">{r.amountExpected ? money(r.amountExpected) : "—"}</td>
                          <td className="num muted">{r.adCost ? money(r.adCost) : "—"}</td>
                          <td>
                            <span className={"pill " + o.cls}>{o.label}</span>
                            {r.why && <div className="muted" style={{ fontSize: 11 }}>{r.why}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/*
                Said plainly and by name. A run that quietly brought in half a sheet
                looks exactly like one that brought in all of it, and the missing half
                is noticed weeks later when a total does not add up.
              */}
              {counts.skippedScope > 0 && (
                <div className="hint warn">
                  {counts.skippedScope} row{counts.skippedScope === 1 ? " is" : "s are"} in{" "}
                  {preview.outOfScope.join(", ")} — not verticals on your account, so they are
                  left for whoever holds them. Nothing about them changes here.
                </div>
              )}

              <div className="hint">
                A row already imported is left exactly as it is. Once a payment has been
                reconciled here the sheet and this app have diverged on purpose, and an
                import that wrote over that would undo the work every time it ran.
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
