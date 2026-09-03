/*
 * Reading a Google Sheet, and turning its rows into payouts.
 *
 * Nothing here writes. It fetches, parses, maps and reports what it found; the
 * route decides what to do with that. Keeping the two apart is what makes a
 * preview possible — the same code path answers "what would happen" and "do it",
 * so the preview cannot drift from the import it is previewing.
 *
 * ACCESS. The server has no Google login. It opens the URL exactly as a stranger
 * would, which is why a sheet that is private to its owner comes back as a sign-in
 * page rather than data. That case is detected and named, because "0 rows" would
 * otherwise be indistinguishable from an empty sheet.
 */
const { round2 } = require("../utils/helpers");

/* --------------------------------------------------------------- the URL */

/*
 * Google hands out several shapes of link and only one of them returns CSV.
 * Whatever is pasted — the edit URL from the address bar, a share link, an
 * already-published one — comes out of here as something that answers with data,
 * so nobody has to know which kind they copied.
 */
function toCsvUrl(input) {
  const url = String(input || "").trim();
  if (!url) return "";

  // already published to the web as CSV, or any other direct CSV link
  if (/output=csv|format=csv/i.test(url)) return url;

  const id = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1];
  if (!id) return url;                     // not a Sheets link; try it as given

  // the tab, when the link names one — otherwise Google serves the first sheet
  const gid = (url.match(/[#&?]gid=([0-9]+)/) || [])[1];
  const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

/*
 * A sheet the server cannot read does not fail — Google answers 200 with a login
 * page. Without this check that arrives as a CSV of HTML, parses into nonsense
 * columns, and reports "0 rows mapped", which sends someone looking for the bug in
 * their column names.
 */
function assertCsv(text, res) {
  const looksHtml = /^\s*<(!doctype|html)/i.test(text) || /<title>/i.test(text.slice(0, 2000));
  if (!looksHtml) return;
  const err = new Error("sheet_not_public");
  err.code = "sheet_not_public";
  err.status = 400;
  err.detail = res && res.url && /accounts\.google\.com/.test(res.url)
    ? "Google asked this server to sign in."
    : "Google returned a web page instead of data.";
  throw err;
}

async function fetchCsv(url) {
  const csvUrl = toCsvUrl(url);
  if (!csvUrl) {
    const err = new Error("no_url");
    err.code = "no_url";
    err.status = 400;
    throw err;
  }

  let res;
  try {
    res = await fetch(csvUrl, { redirect: "follow" });
  } catch (e) {
    const err = new Error("fetch_failed");
    err.code = "fetch_failed";
    err.status = 400;
    err.detail = e.message;
    throw err;
  }

  if (!res.ok) {
    const err = new Error("fetch_failed");
    err.code = "fetch_failed";
    err.status = 400;
    err.detail = `Google answered ${res.status}.`;
    throw err;
  }

  const text = await res.text();
  assertCsv(text, res);
  return text;
}

/* --------------------------------------------------------------- the CSV */

/*
 * A CSV parser rather than text.split(","), because these cells hold money and
 * campaign names: "$3,027.00" and "Etsy, Launchigo" both contain the delimiter,
 * and splitting on it silently shifts every column after them by one.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  const s = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }   // an escaped quote, not the end
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }

  // trailing blank lines are not rows
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

/* ----------------------------------------------------------- the columns */

/*
 * Headers are matched loosely on purpose.
 *
 * A real sheet says "Ad Cost (Expense)", "Camapign Name" with the typo it was
 * created with, and "Payment Recived Date" with another. Demanding exact spellings
 * would mean asking someone to edit a sheet other people rely on, so the match
 * strips everything but letters and digits and compares against a list of names
 * each field is known by.
 */
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const FIELDS = {
  externalId: ["id", "rowid", "uniqueid", "camapignname", "campaigncode", "code"],
  campaign: ["campaignname", "campaign"],
  network: ["networkname", "network"],
  vertical: ["vertical"],
  subcategory: ["subvertical", "subcategory", "trafficsource"],
  earnedMonth: ["month", "earnedmonth", "period"],
  adCost: ["adcostexpense", "adcost", "cost", "expense", "spend"],
  overallRevenue: ["overallrevenue", "grossrevenue", "reportedrevenue"],
  amountExpected: ["actualrevenue", "revenue", "amountexpected", "expected", "payout"],
  amountReceived: ["receivedamount", "received", "amountreceived"],
  payAccount: ["bankaccount", "account", "bank"],
  receivedDate: ["paymentrecivedate", "paymentreciveddate", "paymentreceiveddate", "receiveddate", "paymentdate"],
  currency: ["currency"],
  note: ["note", "notes", "remark", "remarks"],
};

/*
 * Which column holds which field. The first header that matches wins, so a sheet
 * with both "Campaign Name" columns — one a code, one a name — keeps them apart:
 * the code column is only ever read as an id, never as the campaign.
 */
function mapHeaders(headerRow) {
  const seen = {};
  const used = new Set();
  headerRow.forEach((raw, i) => {
    const key = norm(raw);
    if (!key) return;
    for (const [field, names] of Object.entries(FIELDS)) {
      if (seen[field] !== undefined) continue;
      if (used.has(i)) continue;
      if (names.includes(key)) { seen[field] = i; used.add(i); break; }
    }
  });
  return seen;
}

/* ------------------------------------------------------------ the values */

const BLANK = new Set(["", "n/a", "na", "-", "—", "null", "none", "#n/a"]);
const isBlank = (v) => BLANK.has(String(v == null ? "" : v).trim().toLowerCase());

/** "$3,027.00" → 3027, "(89.34)" → -89.34, "N/A" → 0. */
function money(v) {
  if (isBlank(v)) return 0;
  const raw = String(v).trim();
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-") || raw.startsWith("−");
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return 0;
  return round2(negative ? -n : n);
}

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

/*
 * The month, from whatever it was typed as. The sheet writes May'26; people also
 * write May 2026, 2026-05 and 05/2026, and a row whose month cannot be read is
 * skipped rather than guessed at — a payout filed under the wrong month is worse
 * than one that was never imported, because nobody goes looking for it.
 */
function monthOf(v) {
  if (isBlank(v)) return "";
  const raw = String(v).trim();

  let m = raw.match(/^(\d{4})[-/](\d{1,2})$/);                    // 2026-05
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;

  m = raw.match(/^(\d{1,2})[-/](\d{4})$/);                        // 05/2026
  if (m) return `${m[2]}-${String(m[1]).padStart(2, "0")}`;

  m = raw.match(/^([a-zA-Z]{3,9})[\s'’`\-/]*(\d{2}|\d{4})$/);     // May'26, May 2026
  if (m) {
    const mm = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mm) return "";
    const y = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${y}-${mm}`;
  }
  return "";
}

/** A date, or "" — never a guess. Ambiguous day/month order is left alone. */
function dateOf(v) {
  if (isBlank(v)) return "";
  const raw = String(v).trim();
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);               // sheets' own d/m/yyyy
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return "";
}

const textOf = (v) => (isBlank(v) ? "" : String(v).trim());

/* ------------------------------------------------------------- the rows */

/*
 * One sheet row becomes one payout, and sometimes a reconciliation with it: a row
 * carrying a received amount is describing money that already arrived, and
 * importing it as merely expected would leave the app showing a debt that is
 * already settled.
 */
function mapRow(cols, cells, rowNumber) {
  const at = (field) => (cols[field] === undefined ? "" : cells[cols[field]]);

  const network = textOf(at("network"));
  const earnedMonth = monthOf(at("earnedMonth"));
  const amountExpected = money(at("amountExpected"));
  const campaign = textOf(at("campaign"));

  const problems = [];
  if (!network) problems.push("no network");
  if (!earnedMonth) problems.push(`month unreadable (${textOf(at("earnedMonth")) || "blank"})`);
  if (!(amountExpected > 0)) problems.push("revenue is zero");

  /*
   * The identity of the row, so a second run recognises it. An explicit id column
   * is used when there is one; otherwise the three things that together name a
   * payout stand in for it. Campaign is included because one network pays for
   * several campaigns in the same month, and without it they would collapse into
   * one another.
   */
  const explicit = textOf(at("externalId"));
  const externalId = explicit || [campaign || "—", network, earnedMonth].join(" | ");

  const received = money(at("amountReceived"));
  const receivedDate = dateOf(at("receivedDate"));
  const account = textOf(at("payAccount"));

  return {
    rowNumber,
    ok: problems.length === 0,
    problems,
    externalId,
    payout: {
      externalId,
      campaign,
      network,
      vertical: textOf(at("vertical")),
      subcategory: textOf(at("subcategory")),
      earnedMonth,
      amountExpected,
      adCost: money(at("adCost")),
      overallRevenue: money(at("overallRevenue")),
      currency: textOf(at("currency")) || undefined,
      payMethod: account ? "bank" : "",
      payAccount: account,
      note: textOf(at("note")),
    },
    // only when the sheet says money arrived; zero is "not yet", not "nothing"
    reconcile: received > 0 ? { amountReceived: received, date: receivedDate || undefined } : null,
  };
}

/** Fetch, parse and map. Returns the rows and what the headers turned into. */
async function read(url) {
  const csv = await fetchCsv(url);
  const table = parseCsv(csv);
  if (!table.length) return { columns: {}, headers: [], rows: [] };

  const headers = table[0].map((h) => String(h).trim());
  const columns = mapHeaders(headers);
  const rows = table.slice(1).map((cells, i) => mapRow(columns, cells, i + 2));
  return { columns, headers, rows };
}

module.exports = {
  toCsvUrl, parseCsv, mapHeaders, monthOf, dateOf, money, isBlank, mapRow, read, FIELDS,
};
