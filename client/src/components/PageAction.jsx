/*
 * The buttons that live in a page's header, on the right of its title.
 *
 * "Add payout" belongs beside the Payout heading, but the heading is drawn by App
 * and the button's state (which modal is open) belongs to the page underneath it.
 * Rather than lift that state up — App has no business knowing about payout modals —
 * the page registers its actions here and App renders whatever is registered.
 *
 * Registration clears on unmount, so changing tab always empties the slot: a page
 * cannot leave its buttons behind on somebody else's screen.
 */
import React, { createContext, useContext, useEffect, useState, useMemo } from "react";

const Ctx = createContext({ actions: null, setActions: () => {} });

export function PageActionProvider({ children }) {
  const [actions, setActions] = useState(null);
  const value = useMemo(() => ({ actions, setActions }), [actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read what the current page registered. For the header only. */
export function usePageActions() {
  return useContext(Ctx).actions;
}

/**
 * Put one or more buttons in this page's header.
 *
 * Each is `{ label, onClick, variant }`, where variant is "primary" (the default)
 * or "ghost". The ARRAY ITSELF must be stable — wrap it in useMemo over stable
 * callbacks — or this re-registers on every render and the header flickers.
 */
export function useRegisterPageActions(actions) {
  const { setActions } = useContext(Ctx);
  useEffect(() => {
    setActions(actions);
    return () => setActions(null);
  }, [setActions, actions]);
}
