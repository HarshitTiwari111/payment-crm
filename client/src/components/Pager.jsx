/*
 * Pagination.
 *
 * Always on screen once there are rows, even on a single page — it is where the
 * "how many of these are there?" answer lives, and a control that appears and
 * disappears depending on the row count is harder to trust than one that is simply
 * always there.
 *
 * Page numbers collapse around the current page (1 … 4 5 6 … 20) so a long list
 * never grows a second line of buttons.
 */
import React, { useEffect, useMemo, useState } from "react";
import { IconPrev, IconNext } from "../icons";

/*
 * Paging a list this app already holds in full.
 *
 * The Payout and Log screens are paged by the server, because those two tables are
 * the ones that grow without limit. Everything else — accounts, networks, a
 * payout's own ledger, a report's breakdown — arrives complete in one response, so
 * paging it is a rendering decision rather than a fetching one, and this hook is
 * the whole of it.
 *
 * Ten rows, like the Payout screen the rest of these are read beside. It is a
 * page size chosen for a phone and for the two lists that sit inside dialogs,
 * and nobody wants the same table paged differently depending on which screen
 * they opened it from — so it is decided here rather than per caller, and the
 * Rows control changes it for anyone who wants more.
 *
 * It clamps the page rather than trusting it. A filter that shortens the list
 * underneath you (ticking "show deactivated" off, say) would otherwise leave you
 * standing on page 4 of a list that now has two, reading an empty table and with no
 * obvious way back.
 */
export function usePaged(rows, initialLimit = 10) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(initialLimit);

  const all = rows || [];
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safe = Math.min(page, pages);

  useEffect(() => { if (page !== safe) setPage(safe); }, [page, safe]);

  const slice = useMemo(
    () => all.slice((safe - 1) * limit, safe * limit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, safe, limit]
  );

  return {
    rows: slice,
    pager: {
      page: safe, pages, total, limit,
      onPage: setPage,
      onLimit: (n) => { setLimit(n); setPage(1); },
    },
  };
}

/** Which page numbers to show: always the ends, plus a window around the current. */
function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push("…");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push("…");
  out.push(pages);
  return out;
}

export default function Pager({
  page, pages, total, limit,
  onPage, onLimit,
  perPageOptions = [10, 25, 50, 100],
  noun = "row",
  // "row" + s is right and "entry" + s is not; anything irregular says so itself
  plural = noun + "s",
}) {
  if (!total) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);
  const nums = pageList(page, pages);

  return (
    <div className="pager">
      <div className="info">
        Showing <b>{first}–{last}</b> of <b>{total}</b> {total === 1 ? noun : plural}
        {pages > 1 ? <> · page <b>{page}</b> of <b>{pages}</b></> : null}
      </div>

      <div className="controls">
        {onLimit && (
          <label className="perpage">
            Rows
            <select value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
              {perPageOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}

        <button
          className="pagenum" disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page" title="Previous page"
        >
          <IconPrev size={14} />
        </button>

        {nums.map((n, i) => (
          n === "…"
            ? <span className="gap" key={"gap" + i}>…</span>
            : (
              <button
                key={n}
                className={"pagenum" + (n === page ? " on" : "")}
                onClick={() => onPage(n)}
                aria-current={n === page ? "page" : undefined}
              >
                {n}
              </button>
            )
        ))}

        <button
          className="pagenum" disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page" title="Next page"
        >
          <IconNext size={14} />
        </button>
      </div>
    </div>
  );
}
