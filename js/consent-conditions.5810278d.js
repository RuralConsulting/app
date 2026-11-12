// Consent conditions from ECan (CC1): What's due's "Fetch conditions from ECan" on a consent whose conditions aren't
// recorded, and the same proposal when Ask fetched them. The consent-conditions function (or Ask) reads them from ECan's
// Open Data Portal as the signed-in person may; what comes back is a proposal, shown here with ECan's wording, what it
// states outright (limits, timeframes) and where it came from (CC BY 4.0, Environment Canterbury). Nothing is recorded
// until an advisor of the farm taps Accept: that calls public.accept_consent_conditions as them (an advisor's own
// write, under the obligations policies); Discard puts it away. Pure, apart from request() and accept().
// FC1 (#400): the consent number is any form ECAN1's shared pattern recognises (consent-no.js: CRC, NCY, SCY, WTK, MLB, with a
// letter and a .n version); ECan's portal answers every one of them. An answer with no conditions says which it is (`held`):
// ECan holds none for the number (the header alone), or ECan's record says the consent has none ("No conditions.").
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./consent-no.js") : root.FP.consentNo);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.consentConditions = api;
})(typeof window === "undefined" ? globalThis : window, function (CN) {
  const UNAVAILABLE = "Fetching conditions from ECan isn't available yet.";
  const KINDS = ["limit", "date", "reporting", "practice"];
  const HELD = ["conditions", "none_held", "none_stated", "none_listed"];
  const CRC = CN.CONSENT_NO;
  const ECAN = "https://data.ecan.govt.nz/";
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => typeof v === "string" && v.trim() !== "";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dates = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });

  // A proposal as the function sent it, kept to the shape the app knows; null when it isn't one.
  function proposal(p) {
    if (!p || typeof p !== "object" || p.verb !== "consent.conditions" || !str(p.authorisation_id) || !CRC.test(String(p.consent_no))) return null;
    const s = p.source || {};
    if (!str(s.url) || !s.url.startsWith(ECAN) || !Number.isFinite(Date.parse(s.retrieved_at))) return null;
    const conditions = list(p.conditions).filter((c) => c && str(c.code) && str(c.summary) && str(c.text) && KINDS.includes(c.kind)).map((c) => ({
      code: c.code, heading: str(c.heading) ? c.heading : null, text: c.text, summary: c.summary, kind: c.kind,
      limits: list(c.limits).filter((l) => l && Number.isFinite(l.value) && str(l.unit)).map((l) => ({ value: l.value, unit: l.unit, text: str(l.text) ? l.text : String(l.value) + " " + l.unit })),
      dates: list(c.dates).filter(str), timeframes: list(c.timeframes).filter(str) }));
    // what ECan's answer says when it lists no conditions; a function from before FC1 sent no `held`: its header-only answer read as "lists none"
    const held = conditions.length ? "conditions" : HELD.includes(p.held) && p.held !== "conditions" ? p.held : "none_listed";
    return { verb: p.verb, authorisation_id: p.authorisation_id, consent_no: p.consent_no, label: str(p.label) ? p.label : "Conditions of " + p.consent_no, held,
      source: { consent_no: p.consent_no, url: s.url, retrieved_at: s.retrieved_at, publisher: str(s.publisher) ? s.publisher : "Environment Canterbury",
        licence: str(s.licence) ? s.licence : "CC BY 4.0", attribution: str(s.attribution) ? s.attribution : "Conditions from Environment Canterbury's Open Data Portal, licensed CC BY 4.0." },
      conditions, skipped: list(p.skipped).filter((x) => x && str(x.code)).map((x) => ({ code: x.code, reason: str(x.reason) ? x.reason : "not a condition" })) };
  }
  // The function's reply: a proposal, or one line saying why not. Not deployed (404), down or unreachable: one line.
  async function request(sb, farm, consent_no) {
    let res;
    try { res = await sb.functions.invoke("consent-conditions", { body: { farm_id: farm, consent_no } }); } catch { return { kind: "error", message: UNAVAILABLE }; }
    if (!res.error) { const p = proposal(res.data?.proposal); return p ? { kind: "proposal", proposal: p } : { kind: "error", message: "ECan's reply couldn't be read." }; }
    const status = res.error.context?.status;
    let body = null;
    try { body = await res.error.context.json(); } catch {}
    return status && status !== 404 && body && str(body.error) ? { kind: "error", message: body.error } : { kind: "error", message: UNAVAILABLE };
  }
  // What Accept sends: the consent, where the conditions came from, and the conditions exactly as proposed.
  const acceptArgs = (p) => ({ p_authorisation: p.authorisation_id, p_source: { consent_no: p.consent_no, url: p.source.url, retrieved_at: p.source.retrieved_at },
    p_conditions: p.conditions.map(({ code, heading, text, summary, kind, limits, dates, timeframes }) => ({ code, heading, text, summary, kind, limits, dates, timeframes })) });
  async function accept(sb, p) {
    const { data, error } = await sb.rpc("accept_consent_conditions", acceptArgs(p));
    if (error) throw Error(/already has conditions/i.test(error.message || "") ? "This consent's conditions are already recorded." :
      /row-level security|not one you can|permission/i.test(error.message || "") ? "Only an advisor of the farm can record these." : error.message || "That wasn't recorded.");
    return Number(data) || 0;
  }
  const retrieved = (p) => dates.format(new Date(p.source.retrieved_at));
  const states = (c) => [...c.limits.map((l) => l.text), ...c.timeframes, ...c.dates];
  // The proposal, drawn: what it is, each condition (number, heading, its first sentence, what it states, ECan's
  // wording in a fold), the attribution, then Accept (an advisor) or the line saying who accepts, and Discard.
  function html(p, o = {}) {
    const n = p.conditions.length, key = esc(p.consent_no);
    const head = n ? "ECan lists " + n + " condition" + (n === 1 ? "" : "s") + " for " + p.consent_no + ". Check them; accepting records them as the consent's conditions."
      : p.held === "none_held" ? "ECan holds no conditions for " + p.consent_no + ". If the consent has conditions, record them from the decision itself."
      : p.held === "none_stated" ? "ECan's record says " + p.consent_no + " has no conditions."
      : "ECan lists no conditions for " + p.consent_no + ".";
    const items = p.conditions.map((c) => '<li class="cc-condition" data-cc-code="' + esc(c.code) + '"><p class="cc-line"><span class="cc-code">Condition ' + esc(c.code) + "</span>" +
      (c.heading ? ' <span class="cc-heading">' + esc(c.heading) + "</span>" : "") + "</p>" +
      '<p class="cc-summary">' + esc(c.summary) + "</p>" + (states(c).length ? '<p class="cc-states">States: ' + esc(states(c).join("; ")) + "</p>" : "") +
      '<details class="cc-wording"><summary>As written</summary><blockquote>' + esc(c.text) + "</blockquote></details></li>").join("");
    const skipped = p.skipped.length ? '<p class="cc-skipped">' + esc(p.skipped.map((s) => "Condition " + s.code + " (" + s.reason + ")").join("; ")) + " is not recorded.</p>" : "";
    const actions = n ? (o.canAccept ? '<button type="button" data-cc-accept="' + key + '">Accept and record ' + n + " condition" + (n === 1 ? "" : "s") + "</button>"
      : '<span class="cc-who">An advisor of the farm accepts these.</span>') : "";
    return '<div class="cc-proposal" data-cc-proposal="' + key + '">' + '<p class="cc-head">' + esc(head) + "</p>" + (n ? '<ol class="cc-list">' + items + "</ol>" : "") + skipped +
      '<p class="cc-attr">Source: ' + esc(p.source.publisher) + ", consent " + key + ", retrieved " + esc(retrieved(p)) + " (" + esc(p.source.licence) + '). <a href="' + esc(p.source.url) +
      '" target="_blank" rel="noopener noreferrer">ECan\'s data</a></p>' +
      '<div class="cc-actions">' + actions + '<button type="button" class="link" data-cc-discard="' + key + '">Discard</button></div><p class="cc-msg" role="status" aria-live="polite"></p></div>';
  }
  return { UNAVAILABLE, proposal, request, acceptArgs, accept, html };
});
