/*
 * Account security: two-factor, active sessions, and recent sign-ins.
 *
 * These three belong together because they answer one question between them —
 * "is anyone else in my account?" 2FA stops it happening, the session list shows
 * whether it already has, and the sign-in history is the evidence either way.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useApp } from "../context/AppContext";
import { Modal, Field, Loading } from "./ui";
import { useToast } from "./Toast";
import Confirm from "./Confirm";
import { IconLock, IconCheck, IconWarn, IconDelete, IconLogout } from "../icons";
import { dateLabel } from "../api/format";

/** "Chrome on Windows" out of a user-agent string — enough to recognise a device. */
function deviceName(ua = "") {
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/*
 * `required` is the enrolment fence: the server has told us this admin cannot reach
 * anything until 2FA is on, so the modal has no way out except finishing or signing
 * out. Escape and the backdrop are neutralised for the same reason — dismissing it
 * would leave a UI whose every request comes back 403.
 */
export default function SecurityModal({ onClose, required }) {
  const { me, logout, refreshMe } = useApp();
  const toast = useToast();

  const [tab, setTab] = useState("twofactor");
  const [enabled, setEnabled] = useState(!!me.twoFactorEnabled);

  const [setup, setSetup] = useState(null);      // { qr, secret }
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(null);
  const [disablePw, setDisablePw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [sessions, setSessions] = useState(null);
  const [history, setHistory] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessions(await api.get("/api/me/sessions").catch(() => []));
  }, []);
  const loadHistory = useCallback(async () => {
    setHistory(await api.get("/api/me/login-history").catch(() => []));
  }, []);

  useEffect(() => {
    if (tab === "sessions") loadSessions();
    if (tab === "history") loadHistory();
  }, [tab, loadSessions, loadHistory]);

  /* ------------------------------------------------------------- 2FA */

  const start = async () => {
    setErr("");
    setBusy(true);
    try {
      setSetup(await api.post("/api/me/2fa/start"));
    } catch (e) {
      setErr("Could not start setup.");
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    setErr("");
    if (!/^\d{6}$/.test(code.trim())) { setErr("Enter the 6-digit code."); return; }
    setBusy(true);
    try {
      const r = await api.post("/api/me/2fa/enable", { code: code.trim() });
      setRecovery(r.recoveryCodes);
      setEnabled(true);
      setSetup(null);
      setCode("");
      toast.success("Two-factor is on", "Save your recovery codes somewhere safe.");
      // lifts the server-side fence in the UI; the codes stay on screen to be copied
      if (required) { try { await refreshMe(); } catch (e2) { /* the next call will */ } }
    } catch (e) {
      setErr(e.code === "bad_code" ? "That code is not right. Try the current one." : "Could not turn it on.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setErr("");
    if (!disablePw) { setErr("Enter your password to confirm."); return; }
    setBusy(true);
    try {
      await api.post("/api/me/2fa/disable", { password: disablePw });
      setEnabled(false);
      setDisablePw("");
      toast.warn("Two-factor turned off", "Your account is now protected by the password alone.");
    } catch (e) {
      setErr(e.code === "wrong_password" ? "That password is not right." : "Could not turn it off.");
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------------------- sessions */

  const revoke = async (id) => {
    try {
      await api.del(`/api/me/sessions/${id}`);
      toast.success("Device signed out");
      loadSessions();
    } catch (e) {
      toast.error("Could not sign that device out");
    }
  };

  return (
    <Modal
      title={required ? "Set up two-factor to continue" : "Account security"}
      onClose={required ? () => {} : onClose}
      wide
      actions={required
        ? [<button key="o" className="btn ghost" onClick={logout}>Sign out</button>]
        : [<button key="c" className="btn ghost" onClick={onClose}>Close</button>]}>

      {required ? (
        <div className="err" style={{ marginBottom: 16 }}>
          This account is an admin, and admin accounts are required to carry a second
          factor. Until it is set up, the rest of the app will not answer.
        </div>
      ) : null}

      {/* the other two tabs read endpoints the fence blocks, so they are hidden until it lifts */}
      {required ? null : (
        <div className="seg" style={{ marginBottom: 16 }}>
          <button className={tab === "twofactor" ? "on" : ""} onClick={() => setTab("twofactor")}>Two-factor</button>
          <button className={tab === "sessions" ? "on" : ""} onClick={() => setTab("sessions")}>Devices</button>
          <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>Sign-in history</button>
        </div>
      )}

      {err ? <div className="err">{err}</div> : null}

      {/* ------------------------------------------------------ 2FA */}
      {tab === "twofactor" && (
        <>
          {recovery ? (
            <>
              <div className="hint warn">
                <IconWarn size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
                <b>Save these now.</b> Each code works once, and this is the only time they are shown.
                They are how you get in if you lose your phone.
              </div>
              <div className="card" style={{ fontFamily: "ui-monospace, monospace", lineHeight: 2, letterSpacing: 1 }}>
                {recovery.map((c) => <div key={c}>{c}</div>)}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => {
                  navigator.clipboard?.writeText(recovery.join("\n"));
                  toast.success("Recovery codes copied");
                }}>Copy codes</button>
                <button className="btn primary" onClick={() => setRecovery(null)}>I have saved them</button>
              </div>
            </>
          ) : enabled ? (
            <>
              <div className="hint">
                <IconCheck size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
                Two-factor is <b>on</b>. Signing in asks for a code from your authenticator app as well
                as your password, so a stolen password on its own is not enough.
              </div>
              <Field label="Turn it off — enter your password to confirm">
                <input type="password" value={disablePw} placeholder="your password"
                  onChange={(e) => setDisablePw(e.target.value)} />
              </Field>
              <button className="btn danger" onClick={disable} disabled={busy}>Turn off two-factor</button>
            </>
          ) : setup ? (
            <>
              <div className="hint">
                Scan this with Google Authenticator, Authy, 1Password — any TOTP app — then type the
                6-digit code it shows to confirm it works.
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
                <img src={setup.qr} alt="Two-factor QR code" width={200} height={200}
                  style={{ borderRadius: 10, background: "#fff", padding: 8 }} />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 5 }}>
                    No camera? Type this key into the app instead:
                  </div>
                  <code style={{
                    display: "block", wordBreak: "break-all", background: "var(--panel2)",
                    border: "1px solid var(--line)", borderRadius: 8, padding: "9px 11px", fontSize: 12.5,
                  }}>{setup.secret}</code>
                  <Field label="Code from the app" style={{ marginTop: 14 }}>
                    <input inputMode="numeric" maxLength={6} placeholder="123456" value={code}
                      onChange={(e) => setCode(e.target.value)}
                      style={{ letterSpacing: 3, fontSize: 17 }} />
                  </Field>
                  <div className="row">
                    <button className="btn ghost" onClick={() => { setSetup(null); setCode(""); }}>Cancel</button>
                    <button className="btn primary" onClick={enable} disabled={busy}>Confirm and turn on</button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="hint">
                <IconLock size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
                Two-factor adds a second check at sign-in: a code from your phone, on top of your
                password. It means a leaked or guessed password alone cannot get anyone in.
                {me.role === "admin" && <> <b>Strongly recommended for admin accounts</b>, which can see and change everything.</>}
              </div>
              <button className="btn primary" onClick={start} disabled={busy}>Set up two-factor</button>
            </>
          )}
        </>
      )}

      {/* -------------------------------------------------- sessions */}
      {tab === "sessions" && (
        sessions === null ? <Loading /> : (
          <>
            <div className="hint">
              Every device currently signed in as you. If you do not recognise one, sign it out —
              and change your password.
            </div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Device</th><th>IP</th><th>Signed in</th><th>Last used</th><th /></tr></thead>
                <tbody>
                  {!sessions.length ? (
                    <tr><td colSpan={5} className="muted">No other sessions.</td></tr>
                  ) : sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {deviceName(s.userAgent)}
                        {s.current && <span className="pill g" style={{ marginLeft: 6 }}>this device</span>}
                      </td>
                      <td className="muted">{s.ip || "—"}</td>
                      <td className="muted">{dateLabel(s.createdAt)}</td>
                      <td className="muted">{dateLabel(s.lastUsedAt)}</td>
                      <td className="right">
                        {!s.current && (
                          <button className="btn ico danger" title="Sign out this device" data-tip="Sign out this device"
                            onClick={() => revoke(s.id)}><IconDelete size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn danger" style={{ marginTop: 14 }} onClick={() => setConfirmAll(true)}>
              <IconLogout size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              Sign out of every device
            </button>
          </>
        )
      )}

      {/* --------------------------------------------------- history */}
      {tab === "history" && (
        history === null ? <Loading /> : (
          <>
            <div className="hint">
              The last 50 sign-in attempts on this account, successful or not. A failed run you do not
              recognise is worth a password change.
            </div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>When</th><th>Result</th><th>Device</th><th>IP</th></tr></thead>
                <tbody>
                  {!history.length ? (
                    <tr><td colSpan={4} className="muted">Nothing recorded yet.</td></tr>
                  ) : history.map((h, i) => (
                    <tr key={i}>
                      <td className="muted nowrap">{dateLabel(h.at)}</td>
                      <td>
                        {h.success
                          ? <span className="pill g">signed in</span>
                          : <span className="pill r">{(h.reason || "failed").replace(/_/g, " ")}</span>}
                        {h.newDevice && <span className="pill a" style={{ marginLeft: 5 }}>new device</span>}
                      </td>
                      <td className="muted">{deviceName(h.userAgent)}</td>
                      <td className="muted">{h.ip || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {confirmAll && (
        <Confirm
          title="Sign out everywhere?"
          message="Every device, including this one, will be signed out. You will need to sign in again."
          detail="Do this if you think someone else has your password — and change the password afterwards."
          confirmLabel="Sign out everywhere"
          onClose={() => setConfirmAll(false)}
          onConfirm={async () => {
            await api.post("/api/logout-all").catch(() => {});
            logout();
          }}
        />
      )}
    </Modal>
  );
}
