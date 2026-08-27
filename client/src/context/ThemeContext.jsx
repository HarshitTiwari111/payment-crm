/*
 * Light / dark mode.
 *
 * The choice is written to <html data-theme> and remembered in localStorage, so a
 * reload does not flash the wrong theme back. With nothing saved it follows the
 * operating system, which is what someone who has already set their machine to
 * dark expects to see.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const KEY = "payment-crm-theme";
const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

/*
 * The inline script in index.html has already stamped data-theme before paint, so
 * read it back rather than working it out again — that keeps React's first render
 * in step with what is already on screen and avoids a flash.
 */
function initialTheme() {
  const stamped = document.documentElement.getAttribute("data-theme");
  if (stamped === "dark" || stamped === "light") return stamped;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch (e) { /* private mode, storage blocked */ }
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* ignore */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  const value = useMemo(() => ({ theme, dark: theme === "dark", setTheme, toggle }), [theme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
