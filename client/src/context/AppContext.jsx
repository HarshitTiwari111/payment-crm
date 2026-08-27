/*
 * App-wide state: who is signed in, and the two selectors in the top bar
 * (Vertical / Month) that every page reads from.
 *
 * Nothing here is per-page. A page that needs its own filter keeps it locally; what
 * lives here is only what more than one screen has to agree on.
 */
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { api, setViewAs } from "../api/client";
import { curMonthStr, vertsOf } from "../api/format";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(true);

  /*
   * "View team": which account the screens are read through. It is always the
   * signed-in person for a manager; an admin can point it at one of their managers.
   */
  const [selectable, setSelectable] = useState([]);
  const [viewUser, setViewUserRaw] = useState(null);

  const [month, setMonthRaw] = useState(curMonthStr());
  const [verticalFilter, setVerticalFilter] = useState("");
  const [subcatFilter, setSubcatFilter] = useState("");

  const [verticalOptions, setVerticalOptions] = useState([]);
  const [subcats, setSubcats] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  /** Force every page reading shared data to refetch. */
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  /* -------------------------------------------------------------- session */

  useEffect(() => {
    let alive = true;
    api.get("/api/me")
      .then((u) => { if (alive) setMe(u); })
      .catch(() => { if (alive) setMe(null); })
      .finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, []);

  // any 401 from anywhere drops straight back to the login screen
  useEffect(() => {
    const onExpired = () => setMe(null);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  /*
   * `raw` rather than the usual wrapper: a 401 here is a legitimate answer to read
   * (wrong password, code needed, account locked), not a dead session to react to.
   */
  const login = async (username, password, totp) => {
    const u = await api.raw("POST", "/api/login", { username, password, ...(totp ? { totp } : {}) });
    setMe(u);
    return u;
  };

  /*
   * Re-read the session. Needed after enrolling in 2FA: that changes what the
   * account is allowed to reach, and the UI should follow without a page reload.
   */
  const refreshMe = useCallback(async () => {
    const u = await api.get("/api/me");
    setMe(u);
    return u;
  }, []);

  const logout = async () => {
    try { await api.post("/api/logout"); } catch (e) { /* ignore */ }
    setMe(null);
    window.location.reload();
  };

  /* ---------------------------------------------------------- taxonomy */

  useEffect(() => {
    if (!me) return;
    let alive = true;
    (async () => {
      const [verts, subs] = await Promise.all([
        api.get("/api/verticals").catch(() => []),
        api.get("/api/subcategories").catch(() => []),
      ]);
      if (!alive) return;
      setVerticalOptions(Array.isArray(verts) ? verts : []);
      setSubcats(Array.isArray(subs) ? subs : []);
    })();
    return () => { alive = false; };
  }, [me]);

  /* A new session always starts looking at itself. */
  useEffect(() => {
    if (!me) return;
    setViewUserRaw(me.id);
    setViewAs(null);
  }, [me]);

  /*
   * Who an admin may look through: themselves, then each active manager. Other
   * admins are left out — an admin has no vertical restriction, so viewing as one
   * would show exactly the same screens and only muddle the picker.
   *
   * Kept apart from the reset above so it can follow `reloadKey`: adding a manager
   * on the Users tab has to put them in this list straight away, and folding the two
   * together would snap the view back to the admin on every refresh instead.
   */
  useEffect(() => {
    if (!me) return undefined;
    if (me.role !== "admin") { setSelectable([{ ...me, label: me.name }]); return undefined; }

    let alive = true;
    (async () => {
      const us = await api.get("/api/users").catch(() => []);
      if (!alive) return;
      const managers = (us || [])
        .filter((u) => u.role === "manager" && u.active)
        .map((u) => ({ ...u, label: u.name + (vertsOf(u).length ? " — " + vertsOf(u).join(", ") : "") }));
      setSelectable([{ ...me, label: me.name + " (me · admin)" }, ...managers]);
    })();
    return () => { alive = false; };
  }, [me, reloadKey]);

  /*
   * If the account being viewed disappears — deactivated, or demoted out of the
   * list — fall back to the admin rather than leaving the header pointed at someone
   * the picker no longer offers.
   */
  useEffect(() => {
    if (!me || viewUser == null || !selectable.length) return;
    if (selectable.some((u) => Number(u.id) === Number(viewUser))) return;
    setViewUserRaw(me.id);
    setViewAs(null);
  }, [selectable, viewUser, me]);

  /* ------------------------------------------------------------ selectors */

  /** The account the screens are being read through — usually just me. */
  const scopeUser = useMemo(
    () => selectable.find((u) => Number(u.id) === Number(viewUser)) || me,
    [selectable, viewUser, me]
  );

  /** The verticals that account answers for. Empty for an admin: they see them all. */
  const scopeVerts = useCallback(
    () => (scopeUser && scopeUser.role === "admin" ? [] : vertsOf(scopeUser)),
    [scopeUser]
  );

  /*
   * What the vertical pickers should offer. An admin looking at themselves gets the
   * whole list; anyone scoped to a manager gets only that manager's, because the
   * server answers with nothing for the rest.
   */
  const pickableVerts = useCallback(() => {
    const vs = scopeVerts();
    return vs.length ? vs : verticalOptions;
  }, [scopeVerts, verticalOptions]);

  const subsOf = useCallback((v) => subcats.filter((s) => s.vertical === v), [subcats]);
  const vertHasSubs = useCallback((v) => subcats.some((s) => s.vertical === v), [subcats]);

  const setMonth = (m) => { setMonthRaw(m); refresh(); };

  /*
   * Switching who you are looking at clears the vertical filter: it was picked from
   * the previous person's list, and carrying it over would leave the screens filtered
   * to a vertical the new one has never worked in — reading as "no data" rather than
   * "wrong filter".
   */
  const setViewUser = (id) => {
    const n = Number(id);
    setViewUserRaw(n);
    setViewAs(me && n === me.id ? null : n);
    setVerticalFilter("");
    setSubcatFilter("");
    refresh();
  };

  /** The Vertical dropdown sends "Vertical" or "Vertical::Sub". */
  const pickVertical = (v) => {
    if (v && v.indexOf("::") >= 0) {
      const p = v.split("::");
      setVerticalFilter(p[0]);
      setSubcatFilter(p[1]);
    } else {
      setVerticalFilter(v || "");
      setSubcatFilter("");
    }
    refresh();
  };

  const value = useMemo(() => ({
    me, booting, login, logout, refreshMe,
    selectable, viewUser, setViewUser, scopeUser, scopeVerts, pickableVerts,
    month, setMonth,
    verticalFilter, subcatFilter, pickVertical, setVerticalFilter, setSubcatFilter,
    verticalOptions, setVerticalOptions, subcats, setSubcats,
    subsOf, vertHasSubs,
    reloadKey, refresh,
    isAdmin: me?.role === "admin",
    /** True while an admin is reading the app as somebody else. */
    viewingOther: !!(me && viewUser && Number(viewUser) !== me.id),
  }), [
    me, booting, selectable, viewUser, scopeUser, scopeVerts, pickableVerts,
    month, verticalFilter, subcatFilter,
    verticalOptions, subcats, reloadKey, subsOf, vertHasSubs,
  ]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
