// Access keys for QGIS (QGIS1a, #456): the rules of the page where a person makes and revokes their own personal access keys,
// without the DOM. A key lets QGIS read the person's layers through the `features` service exactly as they see them in the app;
// it is shown once, when it is made, and only its fingerprint is kept (public.personal_access_token_issue). The page is
// js/tokens.js; the database functions are in migration 20261109010000.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else (root.FP = root.FP || {}).tokensModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  // How long a key lasts: the choices offered (the database allows 1 to 90 days).
  const DAYS = [[7, "7 days"], [30, "30 days"], [60, "60 days"], [90, "90 days (the longest)"]];
  const DEFAULT_DAYS = 30;
  // The columns the page reads (the key's fingerprint is readable by nobody, so a select of every column is refused).
  const COLUMNS = "id,name,token_hint,created_at,expires_at,last_used_at,revoked_at";
  // The step-by-step guide (docs/QGIS.md in the repository).
  const DOCS_URL = "https://github.com/RuralConsulting/farm-platform/blob/main/docs/QGIS.md";
  const day = (v) => (v ? new Date(v).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" }) : null);

  // The address QGIS is given: the features service of the app's own Supabase project.
  const serviceUrl = (supabaseUrl) => String(supabaseUrl || "").replace(/\/+$/, "") + "/functions/v1/features";

  // A key's name, trimmed: 1 to 80 characters.
  function checkName(v) {
    const text = String(v ?? "").trim();
    if (!text) return { ok: false, error: "Give the key a name, such as \"QGIS on my laptop\", so you can tell your keys apart." };
    if (text.length > 80) return { ok: false, error: "A name is at most 80 characters." };
    return { ok: true, text };
  }
  const checkDays = (v) => { const n = Number(v); return DAYS.some(([d]) => d === n) ? n : DEFAULT_DAYS; };

  // Where a key stands, at `now` (a Date or ISO string): in use, revoked, or expired.
  function state(t, now = new Date()) {
    if (t?.revoked_at) return "revoked";
    if (t?.expires_at && new Date(t.expires_at) <= new Date(now)) return "expired";
    return "in_use";
  }
  const STATE_WORDS = { in_use: "In use", revoked: "Revoked", expired: "Expired" };

  // The list: keys in use first (newest first), then the others; each with one plain line about it.
  function rows(list, now = new Date()) {
    const order = { in_use: 0, expired: 1, revoked: 2 };
    return (Array.isArray(list) ? list : []).map((t) => {
      const s = state(t, now);
      const when = s === "revoked" ? "revoked " + day(t.revoked_at) : (s === "expired" ? "expired " : "expires ") + day(t.expires_at);
      const used = t.last_used_at ? "last used " + day(t.last_used_at) : "not used yet";
      return { id: t.id, name: t.name || "Unnamed key", hint: (t.token_hint || "") + "…", state: s, stateWords: STATE_WORDS[s],
        line: "Made " + day(t.created_at) + " · " + when + " · " + used, revocable: s === "in_use", created: t.created_at || "" };
    }).sort((a, b) => order[a.state] - order[b.state] || String(b.created).localeCompare(String(a.created)));
  }

  const issueCall = (name, days) => ({ fn: "personal_access_token_issue", args: { key_name: name, days } });
  const revokeCall = (id) => ({ fn: "personal_access_token_revoke", args: { token_id: id } });

  // What a refusal from the database means, in plain words (its own words when it gave them).
  function refusal(error) {
    const code = error?.code, m = String(error?.message || "");
    if (code === "22023" && m) return m + ".";
    if (code === "28000") return "Sign in again, then make the key.";
    if (code === "P0002") return "That key isn't one of yours, or it's gone.";
    if (code === "PGRST202" || /Could not find the function/.test(m)) return "Access keys aren't available yet: the database hasn't been updated.";
    return "That didn't work just now: " + (m || "no answer") + ". Try again in a moment.";
  }

  // The steps for QGIS, under a new key (the full steps are docs/QGIS.md).
  function qgisSteps(url) {
    return [
      "In QGIS: Layer > Add Layer > Add WFS / OGC API - Features Layer, then New.",
      "URL: " + url,
      "Authentication: add a configuration of type \"API Header\", with the header X-API-Key and this key as its value.",
      "Connect, pick the layers you want, and Add.",
    ];
  }

  return { DAYS, DEFAULT_DAYS, COLUMNS, DOCS_URL, serviceUrl, checkName, checkDays, state, rows, issueCall, revokeCall, refusal, qgisSteps, day };
});
