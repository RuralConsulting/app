// Ask: a question to the farm's Ask function, and its answer as the farm space shows it. The function reads the farm
// as the signed-in person and answers from what the database holds; nothing here calls a model or holds a key. What
// comes back is kept to the shapes the app knows: text, sources (a document or a condition), the map verbs the farm
// space runs after the answer is shown, confirmations the person can make, and consent conditions fetched from ECan
// for an advisor to accept (CC1, consent-conditions.js), and water-quality analyses the platform calculated, for an editor
// to confirm (X1, wq-analysis.js), and the drains-to facts (H1f): the nearest downstream monitoring site and what LAWA publishes
// for it, assembled by the function's code with the context module named as author. Pure, apart from request().
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./consent-conditions.js") : root.FP.consentConditions, node ? require("./wq-analysis.js") : root.FP.wqAnalysis);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.ask = api;
})(typeof window === "undefined" ? globalThis : window, function (CC, WQ) {
  const UNAVAILABLE = "Ask isn't available yet.";
  // An answer with no text (the model ran out of room, or said nothing) is one plain line, never a blank panel (#256).
  const NO_ANSWER = "Ask couldn't answer that.";
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => typeof v === "string" && v.trim() !== "";
  const SETS = ["quiet", "fep", "photos", "water", "consents", "all"];
  const uiOk = (a) => !!a && ((a.verb === "map.frame" && str(a.place)) || (a.verb === "map.layers" && SETS.includes(a.set)) || (a.verb === "plan.open" && str(a.document_id)) || a.verb === "block.add");
  const confirmOk = (c) => !!c && str(c.obligation_id) && str(c.label) && (c.verb === "obligation.done" || (c.verb === "document.attach" && str(c.document_id)));
  const sourceOk = (s) => !!s && (s.kind === "obligation" || s.kind === "document") && str(s.id) && str(s.label);

  // The function's reply, made safe to show: anything not in a known shape is dropped.
  function reply(data) {
    if (!data || typeof data !== "object") return { kind: "unavailable", message: UNAVAILABLE };
    if (data.refused) return { kind: "refused", message: str(data.message) ? data.message : "That can't be answered here." };
    const text = typeof data.answer_text === "string" ? data.answer_text.trim() : "";
    return { kind: "answer", text: text || NO_ANSWER, sources: list(data.sources).filter(sourceOk),
      ui: list(data.ui_actions).filter(uiOk), confirmations: list(data.confirmations).filter(confirmOk),
      proposals: CC ? list(data.proposals).map(CC.proposal).filter(Boolean) : [],
      analyses: WQ ? list(data.analyses).map(WQ.preview).filter(Boolean) : [], drains_to: drainsTo(data.drains_to), notes: list(data.notes).filter(str) };
  }
  // ---- the drains-to facts (H1f) ------------------------------------------------------------------------------------
  // Kept to the shape the function sends: every value is the function's read (the site and its distance from DM6, LAWA's own
  // band labels, periods, trend words, attribution and release); nothing is worked out here. Anything else is dropped.
  const cut = (v, n) => (str(v) ? String(v).trim().replace(/\s+/g, " ").slice(0, n) : null);
  const SITE = ["found", "none", "not_served", "unavailable"], LAWA = ["state", "no_state", "not_served", "unavailable"];
  function drainsTo(d) {
    if (!d || typeof d !== "object" || !str(d.author) || !SITE.includes(d.site_status)) return null;
    const s = d.site && typeof d.site === "object" && str(d.site.source_key) && str(d.site.external_id) ? d.site : null;
    if ((d.site_status === "found") !== !!s) return null;
    const l = s && d.lawa && typeof d.lawa === "object" && LAWA.includes(d.lawa.status) ? d.lawa : null;
    const km = s && typeof s.distance_km_along === "number" && Number.isFinite(s.distance_km_along) && s.distance_km_along >= 0 ? s.distance_km_along : null;
    return {
      author: cut(d.author, 80), site_status: d.site_status, message: s ? null : cut(d.site_message, 300),
      site: s ? { name: cut(s.name, 160), source_key: cut(s.source_key, 60), external_id: cut(s.external_id, 60), distance_km_along: km } : null,
      lawa: l ? {
        status: l.status, message: l.status === "state" ? null : cut(l.message, 300), attribution: cut(l.attribution, 300), release_date: cut(l.release_date, 40),
        state: list(l.state).filter((x) => x && str(x.attribute) && str(x.band)).slice(0, 12).map((x) => ({ attribute: cut(x.attribute, 120), band: cut(x.band, 12), period: cut(x.period, 40) })),
        trend: list(l.trend).filter((x) => x && str(x.indicator) && str(x.description)).slice(0, 12).map((x) => ({ indicator: cut(x.indicator, 120), description: cut(x.description, 80), period: cut(x.period, 40) })),
      } : null,
    };
  }
  // The card's lines, as plain text the farm space puts in elements (never HTML): the site, LAWA's state and trend, the
  // credit, then the author.
  function drainsLines(d) {
    if (!d) return null;
    const site = d.site ? (d.site.name || "Unnamed site") + " (" + d.site.source_key + " " + d.site.external_id + ")" : null;
    const where = d.site ? (d.site.distance_km_along === null ? "On the REC2 chain downstream of the farm" :
      Math.round(d.site.distance_km_along * 10) / 10 + " km downstream along the REC2 river network (from the top of the farm's segment)") : null;
    const l = d.lawa;
    return {
      title: "Nearest downstream monitoring site", site, where, message: d.message,
      lawa_message: l && l.status !== "state" ? l.message : null,
      state: l ? l.state.map((x) => x.attribute + ": band " + x.band + (x.period ? " (" + x.period + ")" : "")) : [],
      trend: l ? l.trend.map((x) => x.indicator + ": " + x.description + (x.period ? " (" + x.period + ")" : "")) : [],
      credit: l && (l.state.length || l.trend.length) ? [l.attribution, l.release_date ? "LAWA release " + l.release_date : null].filter(Boolean).join(" ") || null : null,
      author: d.author + " · assembled from the database by code; nothing calculated",
    };
  }
  // A function that isn't deployed (404), is down or can't be reached says one line; its own refusal of the request
  // (sign-in, a malformed question, the model not answering) says what it said.
  async function request(sb, farm, question) {
    let res;
    try { res = await sb.functions.invoke("ask", { body: { farm_id: farm, question } }); } catch { return { kind: "unavailable", message: UNAVAILABLE }; }
    if (!res.error) return reply(res.data);
    const status = res.error.context?.status;
    let body = null;
    try { body = await res.error.context.json(); } catch {}
    return status && status !== 404 && body && str(body.error) ? { kind: "error", message: body.error } : { kind: "unavailable", message: UNAVAILABLE };
  }
  // The answer text as paragraphs and lists: a line starting "- " is a list item; a blank line ends a paragraph.
  function blocks(text) {
    const out = [];
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trim(), item = line.match(/^[-•*]\s+(.*)$/);
      if (!line) { out.push(null); continue; }
      const last = out[out.length - 1];
      if (item) { if (last?.type === "list") last.items.push(item[1]); else out.push({ type: "list", items: [item[1]] }); }
      else if (last?.type === "p") last.text += " " + line;
      else out.push({ type: "p", text: line });
    }
    return out.filter(Boolean);
  }
  return { UNAVAILABLE, NO_ANSWER, SETS, reply, request, blocks, drainsTo, drainsLines };
});
