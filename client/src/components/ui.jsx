/* Small shared building blocks — the same visual pieces the original build used. */
import React, { useEffect } from "react";
import { money, pct, statusClass, barColor } from "../api/format";

export function Modal({ title, onClose, children, actions, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"modal" + (wide ? " wide" : "")}>
        <h3>{title}</h3>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, style }) {
  return (
    <div className="field" style={style}>
      {label && <label>{label}</label>}
      {children}
    </div>
  );
}

/** A plain figure card. */
export function Simple({ k, v, sub }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

/** A figure card with an achievement bar against its target. */
/*
 * Same shape as Simple, plus a progress reading — and deliberately the same HEIGHT.
 *
 * The bar used to sit in the flow with a note under it, which made this card ~50px
 * taller than the plain ones beside it; grid stretches a row to its tallest card, so
 * two cards ended up as mostly empty space. It is a strip along the card's bottom
 * edge instead: same information, no extra height, and the row stays even.
 */
export function Kpi({ k, v, sub, achieved }) {
  const shown = isFinite(achieved) && !isNaN(achieved);
  return (
    <div className="card">
      <div className="k">
        <span>{k}</span>
        {shown ? <span className={"pill " + statusClass(achieved)}>{pct(achieved)}</span> : null}
      </div>
      <div className="v">{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
      {shown && (
        <span className="kpibar">
          <span style={{ width: Math.min(100, Math.max(0, achieved)) + "%", background: barColor(achieved) }} />
        </span>
      )}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function Loading({ what = "Loading…" }) {
  return <div className="muted">{what}</div>;
}

/** Money in green when positive, red when negative. */
export function Signed({ n, cur }) {
  if (n === null || n === undefined || isNaN(n)) return <span className="muted">—</span>;
  return <span style={{ color: n >= 0 ? "var(--green)" : "var(--red)" }}>{money(n, cur)}</span>;
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Checkbox list used for verticals and tab permissions. */
export function CheckList({ options, value, onChange, empty = "— none —" }) {
  const set = new Set(value || []);
  if (!options.length) return <div className="msdd-empty">{empty}</div>;
  return (
    <div className="checkwrap">
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        return (
          <label key={val} className="checkline">
            <input
              type="checkbox"
              checked={set.has(val)}
              onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(val); else next.delete(val);
                onChange([...next]);
              }}
            />
            {label}
          </label>
        );
      })}
    </div>
  );
}
