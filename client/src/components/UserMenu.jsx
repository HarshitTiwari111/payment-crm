/*
 * The avatar menu in the top right: who you are, the theme switch, change
 * password, and log out.
 *
 * These used to be loose buttons in the top bar. Folding them into one menu keeps
 * the bar for the things people change all day — View team, Vertical, Month — and
 * puts the account controls where everyone already looks for them.
 */
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { IconMoon, IconSun, IconLock, IconLogout, IconCaret, IconWarn } from "../icons";

/** First letters of a name, e.g. "Harshit Tiwari" → "HT". */
function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function UserMenu({ onPassword, onSecurity, onLogout }) {
  const { me } = useApp();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me) return null;

  return (
    <div className={"usermenu" + (open ? " open" : "")} ref={ref}>
      <button
        className="usermenu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={me.name}
      >
        <span className="avatar">{initials(me.name)}</span>
        <span className="usermenu-caret"><IconCaret size={14} /></span>
      </button>

      {open && (
        <div className="usermenu-panel" role="menu">
          <div className="usermenu-head">
            <span className="avatar lg">{initials(me.name)}</span>
            <div>
              <div className="nm">{me.name}</div>
              <div className="rl">{me.role}</div>
            </div>
          </div>
          <div className="usermenu-sep" />

          {/* stays open — flipping the theme is something you judge by looking */}
          <button className="usermenu-item" onClick={toggle} role="menuitemcheckbox" aria-checked={dark}>
            <span className="mi">{dark ? <IconSun size={16} /> : <IconMoon size={16} />}</span>
            {dark ? "Light Mode" : "Dark Mode"}
            <span className={"switch sw" + (dark ? " on" : "")} />
          </button>

          <button className="usermenu-item" onClick={() => { setOpen(false); onPassword(); }} role="menuitem">
            <span className="mi"><IconLock size={16} /></span>
            Change password
          </button>

          {/* the nudge is deliberate: an admin account without 2FA is the single
              biggest hole in an otherwise locked-down app */}
          <button className="usermenu-item" onClick={() => { setOpen(false); onSecurity(); }} role="menuitem">
            <span className="mi"><IconWarn size={16} /></span>
            Security
            {!me.twoFactorEnabled && <span className="pill a sw" style={{ fontSize: 9.5 }}>2FA off</span>}
          </button>

          <button className="usermenu-item danger" onClick={() => { setOpen(false); onLogout(); }} role="menuitem">
            <span className="mi"><IconLogout size={16} /></span>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export { initials };
