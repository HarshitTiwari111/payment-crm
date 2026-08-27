/*
 * Toasts — top-right confirmation of what just happened.
 *
 * Every add / edit / delete anywhere in the app reports through here, so the person
 * gets the same feedback in the same place whatever screen they are on. They stack
 * newest-first and clear themselves; an error stays a little longer, because it is
 * the one you actually need to read.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { IconCheck, IconClose, IconInfo, IconWarn } from "../icons";

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

const ICONS = {
  success: <IconCheck size={13} />,
  error: <IconClose size={13} />,
  info: <IconInfo size={13} />,
  warn: <IconWarn size={13} />,
};
const LIFETIME = { success: 3200, info: 3200, warn: 4500, error: 6000 };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((tone, message, detail) => {
    const id = ++seq.current;
    setItems((list) => [{ id, tone, message, detail }, ...list].slice(0, 4));
    setTimeout(() => dismiss(id), LIFETIME[tone] || 3200);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (m, d) => push("success", m, d),
    error: (m, d) => push("error", m, d),
    info: (m, d) => push("info", m, d),
    warn: (m, d) => push("warn", m, d),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={"toast toast-" + t.tone} onClick={() => dismiss(t.id)}>
            <span className="toast-ic">{ICONS[t.tone]}</span>
            <div className="toast-body">
              <div className="toast-msg">{t.message}</div>
              {t.detail ? <div className="toast-detail">{t.detail}</div> : null}
            </div>
            <button className="toast-x" onClick={(e) => { e.stopPropagation(); dismiss(t.id); }} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
