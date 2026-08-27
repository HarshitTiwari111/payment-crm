/* Bits used across the Payments screens. */
import React from "react";
import { money } from "../../api/format";

export const STATUS_TONE = {
  pending: ["n", "pending"],
  partial: ["a", "partial"],
  received: ["g", "received"],
  overdue: ["r", "overdue"],
  written_off: ["r", "written off"],
};

export function StatusPill({ status, isOverdue }) {
  const [tone, label] = STATUS_TONE[status] || STATUS_TONE.pending;
  return (
    <>
      <span className={"pill " + tone}>{label}</span>
      {/* A partial payment past its due date keeps the "partial" status but still
          needs chasing, so it carries its own late marker. */}
      {isOverdue && status !== "overdue" && status !== "written_off" && (
        <span className="pill r" style={{ marginLeft: 4, fontSize: 10 }}>late</span>
      )}
    </>
  );
}

export const DEDUCTION_REASONS = [
  ["validation", "Validation — leads rejected"],
  ["scrub", "Scrub — quality cut"],
  ["chargeback", "Chargeback"],
  ["fx", "FX / conversion"],
  ["other", "Other"],
];

export const NET_TERMS = [
  ["", "Use the network's default"],
  ["0", "Immediate"],
  ["7", "Net-7"],
  ["15", "Net-15"],
  ["30", "Net-30"],
  ["45", "Net-45"],
  ["60", "Net-60"],
  ["90", "Net-90"],
];

/** Money that should read as a loss. */
export function Cut({ n, cur }) {
  if (!n) return <span className="muted">—</span>;
  return <span style={{ color: "var(--red)" }}>−{money(n, cur)}</span>;
}

export function Money({ n, cur, bold, zero = "—" }) {
  if (!n) return <span className="muted">{zero}</span>;
  return <span style={bold ? { fontWeight: 700 } : undefined}>{money(n, cur)}</span>;
}
