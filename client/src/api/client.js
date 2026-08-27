/*
 * One fetch wrapper for the whole app.
 *
 * SILENT REFRESH. Access tokens last minutes, not weeks — which is what makes a
 * stolen one nearly worthless, but it also means requests will routinely come back
 * "token_expired" while somebody is still working. When that happens this retries
 * the call once behind a refresh, so the person never sees it. Only if the refresh
 * itself fails do we fall back to the login screen.
 *
 * Concurrent 401s share ONE refresh: without that, ten parallel requests would each
 * try to rotate the token, nine would present an already-rotated one, and the
 * server's reuse detection would correctly read that as theft and sign everyone out.
 */
const BASE = import.meta.env.VITE_API_BASE || "";

export class ApiError extends Error {
  constructor(status, code, body) {
    super(code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/*
 * "View team": the account an admin is currently reading the app as.
 *
 * It rides on every request as a header rather than being threaded through forty
 * call sites — the alternative was adding a parameter to every fetch in the app and
 * hoping none was ever forgotten, which is exactly how a screen ends up quietly
 * showing the wrong person's money. The server ignores it unless the caller is an
 * admin, and it can only narrow what comes back.
 */
let viewAs = null;
export function setViewAs(id) { viewAs = id ? String(id) : null; }

let refreshing = null;

async function doRefresh() {
  if (!refreshing) {
    refreshing = fetch(BASE + "/api/refresh", { method: "POST", credentials: "include" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function send(method, url, body) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (viewAs) headers["X-View-As"] = viewAs;
  return fetch(BASE + url, {
    method,
    credentials: "include",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function parse(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return text; }
}

async function request(method, url, body, { retry = true } = {}) {
  let res = await send(method, url, body);

  // an expired access token is recoverable; a rejected session is not
  if (res.status === 401 && retry && !url.startsWith("/api/refresh") && !url.startsWith("/api/login")) {
    const payload = await parse(res.clone()).catch(() => null);
    const code = payload && payload.error;
    if (code === "token_expired" || code === "not_authenticated") {
      const ok = await doRefresh();
      if (ok) res = await send(method, url, body);
    }
  }

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("auth:expired"));
    const payload = await parse(res);
    throw new ApiError(401, (payload && payload.error) || "not_authenticated", payload);
  }

  const payload = await parse(res);
  if (!res.ok) throw new ApiError(res.status, payload && payload.error, payload);
  return payload;
}

export const api = {
  get: (url) => request("GET", url),
  post: (url, body) => request("POST", url, body),
  put: (url, body) => request("PUT", url, body),
  del: (url, body) => request("DELETE", url, body),
  /** For login and refresh: no retry, and 401 is a normal answer to read, not an event. */
  raw: async (method, url, body) => {
    const res = await send(method, url, body);
    const payload = await parse(res);
    if (!res.ok) throw new ApiError(res.status, payload && payload.error, payload);
    return payload;
  },
};

/** Build a query string, skipping empty values. */
export function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}
