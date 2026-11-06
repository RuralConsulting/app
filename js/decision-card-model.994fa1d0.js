// DEC1b (#414): the decision card's pure parts. One card for every queue that asks a person to decide (a group's gaps, a farm's
// onboarding findings, review-due items, site questions, consent matches): the question is put with the thing it is about, open
// and in view, and the answer is not limited to the platform's guesses. Each queue keeps its own words (group-manage-model.js,
// onboarding-model.js) and hands them here with the proposal row; this file adds what is the same everywhere:
//   - the thing: a document (DEC1a's evidence.identity: a workbook's cover fields, a PDF's or Word file's first page; the file itself
//     when proposals.document_id names one the group holds), a place (a held paddock's geometry), or nothing more than the words;
//   - the answer: the platform's candidates first with their evidence, then, for a member match, the whole register searched by
//     number or name (proposals_decide's chosen_from "register"); "Not this" always; a row with no candidate offers the register only;
//   - what was in view when the person answered (proposals_decide's `viewed`: the identity shown, the file opened, the place framed).
// No DOM, no reads, no AI: decision-card.js draws it and wires it in the browser. Rows written before DEC1a (no identity, no
// document_id, no chosen_from) are drawn from what they do hold.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.decisionCardModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (v == null ? "" : String(v));
  // proposals_decide takes a member from the register for these kinds only (DEC1a)
  const REGISTER_KINDS = ["member_match_file", "member_match_paddock"];
  // (a group's row: the manage space reads org_id; a farm's row has none)
  const registerAllowed = (p) => !!p && REGISTER_KINDS.includes(p.kind) && p.org_id != null;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ---- the thing ------------------------------------------------------------------------------------------------------------
  // DEC1a's evidence.identity, read defensively: anything not of the documented shape is left out, never guessed.
  function identityOf(p) {
    const id = p?.evidence && typeof p.evidence === "object" ? p.evidence.identity : null;
    if (!id || typeof id !== "object" || typeof id.kind !== "string") return null;
    if (id.kind === "workbook") {
      const cover = list(id.cover).filter((c) => c && typeof c === "object" && str(c.label).trim() && str(c.value).trim())
        .map((c) => ({ label: str(c.label).trim(), value: str(c.value).trim(), sheet: c.sheet ? str(c.sheet) : null }));
      return { kind: "workbook", format: id.format ? str(id.format) : null, cover };
    }
    if (id.kind === "document") {
      return { kind: "document", format: id.format ? str(id.format) : null, text: typeof id.first_page === "string" ? id.first_page : "",
        truncated: id.truncated === true, pages: Number.isFinite(Number(id.pages)) && id.pages != null ? Number(id.pages) : null };
    }
    if (id.kind === "paddock") {
      const g = id.geometry && typeof id.geometry === "object" && /^(Multi)?Polygon$/.test(id.geometry.type) && Array.isArray(id.geometry.coordinates) ? id.geometry : null;
      const b = list(id.bbox).length === 4 && list(id.bbox).every((n) => Number.isFinite(Number(n))) ? id.bbox.map(Number) : null;
      const names = id.names && typeof id.names === "object" ? Object.entries(id.names).filter(([, v]) => v != null && str(v).trim()).map(([k, v]) => ({ field: k, value: str(v).trim() })) : [];
      return { kind: "paddock", geometry: g, bbox: b || (g ? bboxOf(g) : null), idField: id.id_field ? str(id.id_field) : null, idGiven: id.id_given != null && str(id.id_given) ? str(id.id_given) : null,
        names, areaHa: Number.isFinite(Number(id.area_ha)) && id.area_ha != null ? Number(id.area_ha) : null, envelope: id.envelope === true,
        simplifiedM: Number.isFinite(Number(id.simplified_m)) ? Number(id.simplified_m) : 0, why: id.why ? str(id.why) : null };
    }
    if (id.kind === "file") return { kind: "file", notRead: str(id.not_read) || "it could not be read" };
    return null;
  }
  // [west, south, east, north] of a GeoJSON polygon or multipolygon
  function bboxOf(g) {
    let w = 180, s = 90, e = -180, n = -90;
    const walk = (c) => { if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else for (const x of c) walk(x); };
    try { walk(g.coordinates); } catch { return null; }
    return w <= e && s <= n ? [w, s, e, n] : null;
  }
  const polygonOf = (b) => ({ type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] });
  // What the card shows beside its question: a document (the identity; the file when document_id names one), a place (the held
  // shape, framed with its neighbours), or plain (the words alone). `doc`: a queue's own document reference ({ id, title }) for a
  // finding that rests on a document (a farm's onboarding line), opened the same way.
  function thingOf(p, { doc = null } = {}) {
    const identity = identityOf(p), s = p?.subject || {};
    const documentId = UUID.test(str(p?.document_id)) ? str(p.document_id).toLowerCase() : doc?.id ? str(doc.id) : null;
    if (p?.kind === "member_match_paddock" || identity?.kind === "paddock") {
      const g = identity?.geometry || (identity?.bbox ? polygonOf(identity.bbox) : null);
      const [layer, fid] = str(s.item_key).split("#");
      return { type: "place", identity, geometry: g, bbox: identity?.bbox || (g ? bboxOf(g) : null), itemKey: s.item_key ? str(s.item_key) : null,
        featureId: fid || null, layerFile: layer ? layer.split("/").pop() : null };
    }
    if (p?.kind === "member_match_file" || identity || documentId) {
      return { type: "document", identity, documentId, title: doc?.title || s.source_file || (s.item_key ? str(s.item_key).split("/").pop() : null), itemKey: s.item_key ? str(s.item_key) : null };
    }
    return { type: "plain" };
  }

  // The identity in words. A document's first page: the first `lines` lines shown at once, the rest behind "the rest of the page".
  const FORMAT = { xlsx: "workbook", xlsm: "workbook", pdf: "PDF", docx: "Word file" };
  function identityView(identity, { lines = 4 } = {}) {
    if (!identity) return { kind: null, empty: true, text: "Nothing that identifies this file is held yet. The next proposal run adds what its cover or first page says." };
    if (identity.kind === "workbook") {
      const sheets = [...new Set(identity.cover.map((c) => c.sheet).filter(Boolean))];
      return { kind: "workbook", fields: identity.cover, empty: !identity.cover.length,
        text: identity.cover.length ? "From the workbook's cover" + (sheets.length ? " (sheet " + sheets.map((x) => "“" + x + "”").join(", ") + ")" : "")
          : "The workbook's cover has none of the labels that identify a farm (farm name, owner, address, date)." };
    }
    if (identity.kind === "document") {
      const all = identity.text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));
      const shown = all.slice(0, lines), more = all.slice(lines);
      const of = identity.format === "pdf" && identity.pages ? " of " + identity.pages + (identity.pages === 1 ? " page" : " pages") : "";
      return { kind: "document", shown, more, empty: !all.length, truncated: identity.truncated,
        text: !all.length ? "The " + (FORMAT[identity.format] || "file") + "'s first page has no text to read (a scan, or an image)."
          : (identity.format === "docx" ? "The Word file's text before its first page break" : "The " + (FORMAT[identity.format] || "file") + "'s first page" + of) + (identity.truncated ? ", cut at 1,500 characters" : "") };
    }
    if (identity.kind === "paddock") {
      const facts = [identity.idGiven ? "id given: " + identity.idGiven + (identity.idField ? " (" + identity.idField + ")" : "") : "no member id given",
        ...identity.names.map((n) => n.field + ": " + n.value), identity.areaHa != null ? (Math.round(identity.areaHa * 10) / 10).toLocaleString("en-NZ") + " ha" : null].filter(Boolean);
      return { kind: "paddock", facts, empty: !identity.geometry && !identity.bbox,
        text: !identity.geometry ? "Its shape is not held" + (identity.why ? ": " + identity.why : "") + "." : identity.envelope ? "Shown as the box around it (the shape is too detailed to hold here)." : identity.simplifiedM ? "Its shape simplified to about " + identity.simplifiedM + " m." : null };
    }
    return { kind: "file", empty: true, text: "The file could not be read: " + identity.notRead + "." };
  }

  // ---- the register -----------------------------------------------------------------------------------------------------------
  // The group's current members (group_members, readable by every member of the group), searched by number or name: an exact
  // number first, then numbers that start with it, then names with a word that starts with it, then names that hold it.
  const fold = (v) => str(v).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  function registerOf(rows) {
    return list(rows).filter((m) => m && !m.ended_at && m.member_number != null)
      .map((m) => ({ member: str(m.member_number), business_name: m.business_name ? str(m.business_name) : null, group_member_id: m.id != null ? str(m.id) : null,
        label: "Member " + m.member_number + (m.business_name ? ", " + m.business_name : "") }))
      .sort((a, b) => (Number(a.member) || 1e9) - (Number(b.member) || 1e9) || a.member.localeCompare(b.member));
  }
  function searchRegister(rows, query, { limit = 8 } = {}) {
    // "Member 12", "No. 12", "#12" are the number; the words are stripped only before a digit, so "Noble" or "Northdale" is a name
    const q = fold(query).trim().replace(/^(?:member|no\.?|#)\s*(?=\d)/, "");
    if (!q) return [];
    const scored = [];
    for (const m of registerOf(rows)) {
      const num = fold(m.member), name = fold(m.business_name);
      const rank = num === q ? 0 : num.startsWith(q) ? 1 : name.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(q)) ? 2 : name.includes(q) ? 3 : null;
      if (rank != null) scored.push([rank, m]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, m]) => m);
  }

  // ---- the answer -------------------------------------------------------------------------------------------------------------
  // mode "member": a member match (candidates by member, the register searched); "choice": pick among the row's candidates (a site
  // question, a farm's "to confirm" line); "actions": each candidate is its own button (Seen / Follow up; Seen, correct / Not the
  // farm's). `preselect`: the candidate a proposed row already names (Accept takes it unless another is picked).
  function answerOf(p, { mode = null } = {}) {
    const cands = list(p?.candidates), member = !!p && REGISTER_KINDS.includes(p.kind);
    const m = mode || (member ? "member" : "choice");
    const none = m === "member" && !cands.length;
    return { mode: m, register: m === "member" && registerAllowed(p), noSuggestion: none,
      prompt: none ? "No suggestion: pick a member" : m === "member" && p?.status === "ambiguous" ? (cands.length === 1 ? "One possible member: pick it, or Not this" : "Pick one of these members, or Not this") : null,
      preselect: p?.status === "proposed" && cands.length ? 0 : null, several: cands.length > 1 };
  }
  // The arguments of public.proposals_decide. action "accept" (with `pick`, or the candidate a proposed row names), "reject", or an
  // action key of mode "actions" ({ status, candidate }). pick: { from: "candidates", index } | { from: "register", member,
  // group_member_id }. null when nothing would be sent (an accept with nothing picked on a row that names no candidate).
  function decide(p, action, { pick = null, note = "", viewed = null, mode = null } = {}) {
    if (!p || !Number.isFinite(Number(p.id))) return null;
    const text = str(note).trim() || null, cands = list(p.candidates), seen = viewedList(viewed);
    const out = (o) => (seen.length ? { ...o, viewed: seen } : o);
    if (action === "reject") return out({ id: p.id, status: "rejected", candidate: null, note: text });
    if (action && typeof action === "object") return out({ id: p.id, status: action.status === "rejected" ? "rejected" : "accepted", candidate: action.status === "rejected" ? null : action.candidate ?? null, note: text });
    if (action !== "accept") return null;
    if (pick?.from === "register") {
      if (!registerAllowed(p) || pick.member == null) return null;
      const c = { member: str(pick.member) };
      if (UUID.test(str(pick.group_member_id))) c.group_member_id = str(pick.group_member_id).toLowerCase();
      return out({ id: p.id, status: "accepted", candidate: c, note: text, chosen_from: "register" });
    }
    const i = pick?.from === "candidates" && Number.isInteger(Number(pick.index)) ? Number(pick.index) : p.status === "proposed" && cands.length ? 0 : null;
    const c = i != null ? cands[i] : null;
    if (!c) return null;
    // a member candidate is named by its number (as before DEC1a); any other kind by the whole candidate
    const member = (mode || answerOf(p).mode) === "member" && Object.prototype.hasOwnProperty.call(c, "member");
    return out({ id: p.id, status: "accepted", candidate: member ? { member: c.member } : c, note: text, ...(member && registerAllowed(p) ? { chosen_from: "candidates" } : {}) });
  }

  // ---- what was in view -------------------------------------------------------------------------------------------------------
  // DEC1a's shape (app.proposal_viewed_problem): at most 10 things, at most 4,000 bytes, each {kind: document|feature|identity,
  // document_id?, layer_id? (ids), item_key?, feature_id? (1-500 characters), bbox? ([w, s, e, n] in degrees), zoom? (0-24),
  // page? (whole, from 1), at? (ISO time)}. Anything else is left out here, so the database never refuses an answer for it.
  const KINDS = ["document", "feature", "identity"];
  function viewedItem(v) {
    if (!v || typeof v !== "object" || !KINDS.includes(v.kind)) return null;
    const o = { kind: v.kind };
    for (const k of ["document_id", "layer_id"]) if (UUID.test(str(v[k]))) o[k] = str(v[k]).toLowerCase();
    for (const k of ["item_key", "feature_id"]) if (v[k] != null && str(v[k]).length >= 1 && str(v[k]).length <= 500) o[k] = str(v[k]);
    const b = list(v.bbox);
    if (b.length === 4 && b.every((n) => typeof n === "number" && Number.isFinite(n)) && b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90 && b[0] <= b[2] && b[1] <= b[3])
      o.bbox = b.map((n) => Math.round(n * 1e6) / 1e6);
    if (typeof v.zoom === "number" && v.zoom >= 0 && v.zoom <= 24) o.zoom = Math.round(v.zoom * 100) / 100;
    if (Number.isInteger(v.page) && v.page >= 1 && v.page <= 100000) o.page = v.page;
    if (typeof v.at === "string" && v.at.length <= 40 && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(v.at)) o.at = v.at;
    return o;
  }
  // `at` as the database accepts it: milliseconds kept to three places, Z
  const stamp = (t) => { const d = t instanceof Date ? t : new Date(t ?? Date.now()); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
  function viewedList(items) {
    const out = [];
    for (const v of list(items)) { const o = viewedItem(v); if (o) out.push(o); }
    // the latest of each thing is the one kept (a place framed three times is one entry, as last framed), then at most 10
    const key = (o) => o.kind + "|" + (o.document_id || "") + "|" + (o.item_key || "") + "|" + (o.feature_id || "");
    const last = new Map();
    for (const o of out) { last.delete(key(o)); last.set(key(o), o); }
    let kept = [...last.values()].slice(-10);
    while (kept.length && new TextEncoder().encode(JSON.stringify(kept)).length > 4000) kept = kept.slice(1);
    return kept;
  }
  // The things a card records as it is used, for viewedList: the identity drawn, the file opened, the place framed.
  const seenIdentity = (thing, at) => ({ kind: "identity", ...(thing?.itemKey ? { item_key: thing.itemKey } : {}), ...(thing?.documentId && UUID.test(thing.documentId) ? { document_id: thing.documentId } : {}), at: stamp(at) });
  const seenDocument = (thing, at, page = 1) => ({ kind: "document", ...(UUID.test(str(thing?.documentId)) ? { document_id: thing.documentId } : {}), ...(thing?.itemKey ? { item_key: thing.itemKey } : {}), page, at: stamp(at) });
  const seenFeature = (thing, camera, at) => ({ kind: "feature", ...(thing?.itemKey ? { item_key: thing.itemKey } : {}), ...(thing?.featureId ? { feature_id: thing.featureId } : {}),
    ...(thing?.bbox ? { bbox: thing.bbox } : {}), ...(camera && Number.isFinite(camera.zoom) ? { zoom: Math.max(0, Math.min(24, camera.zoom)) } : {}), at: stamp(at) });

  return { REGISTER_KINDS, registerAllowed, identityOf, bboxOf, polygonOf, thingOf, identityView, registerOf, searchRegister, answerOf, decide, viewedItem, viewedList,
    seenIdentity, seenDocument, seenFeature, stamp };
});
