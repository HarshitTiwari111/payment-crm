/*
 * Sign in — split panel: branding on the left, the form on the right.
 *
 * The field is labelled "Username" rather than "Email address" because that is what
 * accounts are actually keyed on here; calling it email would just make people type
 * one and fail.
 *
 * Two-factor is a second STEP, not a third field: the code is only asked for once
 * the password has already been accepted, so nobody types a code for a password
 * they got wrong.
 */
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { IconMoney, IconUser, IconLock, IconEye, IconEyeOff, IconArrowLeft } from "../icons";

export default function Login() {
  const { login } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);

  useEffect(() => { if (needsTotp) codeRef.current?.focus(); }, [needsTotp]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setNote("");

    if (!needsTotp && (!username.trim() || !password)) {
      setErr("Enter your username and password.");
      return;
    }
    if (needsTotp && !totp.trim()) {
      setErr("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setBusy(true);
    try {
      await login(username.trim(), password, needsTotp ? totp.trim() : undefined);
    } catch (ex) {
      const code = ex.code;
      const body = ex.body || {};

      if (code === "totp_required") {
        setNeedsTotp(true);
        setNote("Password accepted. Now enter the code from your authenticator app.");
      } else if (code === "invalid_totp") {
        setErr("That code is not right. Codes change every 30 seconds — try the current one.");
        setTotp("");
      } else if (code === "account_locked") {
        setErr(`Too many failed attempts. This account is locked for ${body.minutes || "a few"} minute(s).`);
        setNeedsTotp(false);
      } else if (code === "rate_limited") {
        setErr("Too many attempts from here. Wait a few minutes and try again.");
      } else if (code === "invalid_input") {
        setErr("Check the username and password fields.");
      } else {
        setErr(
          body.attemptsLeft !== undefined && body.attemptsLeft <= 3
            ? `Invalid username or password. ${body.attemptsLeft} attempt(s) left before the account locks.`
            : "Invalid username or password"
        );
        setPassword("");
        setNeedsTotp(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const backToPassword = () => {
    setNeedsTotp(false);
    setTotp("");
    setErr("");
    setNote("");
    setPassword("");
  };

  return (
    <div id="login">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo"><IconMoney size={44} /></div>
          <h1>Payment CRM</h1>
          <p>What every network owes, what actually arrived, and what is late.</p>
          <div className="login-rule">Enterprise Dashboard</div>
        </div>

        <form className="login-form" onSubmit={submit}>
          <h2>{needsTotp ? "One more step" : "Welcome back"}</h2>
          <p className="lead">{needsTotp ? "Two-factor verification" : "Sign in to your account"}</p>

          {err ? <div className="login-err">{err}</div> : null}
          {note ? <div className="login-note">{note}</div> : null}

          {!needsTotp ? (
            <>
              <div className="field">
                <label htmlFor="li-user">Username</label>
                <span className="input-icon">
                  <span className="ic"><IconUser size={17} /></span>
                  <input
                    id="li-user"
                    autoComplete="username"
                    autoFocus
                    placeholder="your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </span>
              </div>

              <div className="field">
                <label htmlFor="li-pass">Password</label>
                <span className="input-icon has-toggle">
                  <span className="ic"><IconLock size={17} /></span>
                  <input
                    id="li-pass"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="peek"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    title={show ? "Hide password" : "Show password"}
                  >
                    {show ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                  </button>
                </span>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="li-totp">Authentication code</label>
              <span className="input-icon">
                <span className="ic"><IconLock size={17} /></span>
                <input
                  id="li-totp"
                  ref={codeRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={12}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  style={{ letterSpacing: "3px", fontSize: 17 }}
                />
              </span>
              <div className="muted" style={{ fontSize: 12, marginTop: 7 }}>
                From your authenticator app. A recovery code works here too.
              </div>
            </div>
          )}

          <button className="btn signin" type="submit" disabled={busy}>
            {busy ? "Signing in…" : needsTotp ? "Verify" : "Sign In"}
          </button>

          {needsTotp ? (
            <button type="button" className="btn ghost" style={{ width: "100%", marginTop: 10 }} onClick={backToPassword}>
              <IconArrowLeft size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              Back
            </button>
          ) : (
            <div className="login-foot">Contact your administrator for account access</div>
          )}
        </form>
      </div>
    </div>
  );
}
