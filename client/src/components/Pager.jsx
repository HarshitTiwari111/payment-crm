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
import React from "react";
import { IconPrev, IconNext } from "../icons";

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
