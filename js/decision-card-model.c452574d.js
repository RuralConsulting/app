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
  // proposals_decide takes a member from the register for these kinds only (DEC1a; DEC1c's grouped held paddocks too)
  const GROUP_KIND = "member_match_paddock_group";
  const REGISTER_KINDS = ["member_match_file", "member_match_paddock", GROUP_KIND];
  const OPEN = ["proposed", "ambiguous"];
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
    if (id.kind === "paddock_group") {
      // DEC1c: the held paddocks inside one member's blocks, each with its shape (simplified), area, share inside and the id it was given
      const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
      const paddocks = list(id.paddocks).filter((x) => x && typeof x === "object").map((x) => {
        const g = x.geometry && typeof x.geometry === "object" && /^(Multi)?Polygon$/.test(x.geometry.type) && Array.isArray(x.geometry.coordinates) ? x.geometry : null;
        return { itemKey: x.item_key ? str(x.item_key) : null, fid: x.fid != null ? str(x.fid) : null, idGiven: x.id_given != null && str(x.id_given) ? str(x.id_given) : null,
          areaHa: num(x.area_ha), share: num(x.share), geometry: g,
          // DEC3: the paddock's own name fields (as a single paddock's), for its name on the map
          names: x.names && typeof x.names === "object" ? Object.entries(x.names).filter(([, v]) => v != null && str(v).trim()).map(([k, v]) => ({ field: k, value: str(v).trim() })) : [] };
      });
      const shapes = paddocks.filter((x) => x.geometry);
      // one outline for all of them: a multipolygon of each paddock's polygons
      const geometry = shapes.length ? { type: "MultiPolygon", coordinates: shapes.flatMap((x) => (x.geometry.type === "Polygon" ? [x.geometry.coordinates] : x.geometry.coordinates)) } : null;
      const b = list(id.bbox).length === 4 && list(id.bbox).every((n) => Number.isFinite(Number(n))) ? id.bbox.map(Number) : null;
      return { kind: "paddock_group", member: id.member != null ? str(id.member) : null, businessName: id.business_name ? str(id.business_name) : null,
        sourceFile: id.source_file ? str(id.source_file) : null, count: num(id.count) ?? paddocks.length, shareMin: num(id.share_min), leastShare: num(id.least_share),
        areaHa: num(id.area_ha), paddocks, geometry, bbox: b || (geometry ? bboxOf(geometry) : null) };
    }
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
    if (p?.kind === GROUP_KIND || identity?.kind === "paddock_group") {
      // DEC1c: the grouped paddocks, framed together with the member's blocks
      const g = identity?.kind === "paddock_group" ? identity : null;
      const file = s.source_file || g?.sourceFile || null;
      return { type: "place", group: true, identity: g, geometry: g?.geometry || null, bbox: g?.bbox || null, itemKey: p?.subject_key ? str(p.subject_key) : null,
        featureId: null, layerFile: file ? str(file).split("/").pop() : null, member: s.member != null ? str(s.member) : g?.member || null, count: g?.count ?? list(s.items).length };
    }
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
    if (identity.kind === "paddock_group") {
      const ha = (v) => (Math.round(v * 10) / 10).toLocaleString("en-NZ") + " ha";
      const pct = (v) => Math.round(v * 100) + "%";
      const n = identity.count, who = identity.member ? "member " + identity.member + (identity.businessName ? " (" + identity.businessName + ")" : "") : "the member";
      const facts = [n + (n === 1 ? " paddock" : " paddocks") + (identity.sourceFile ? " in " + identity.sourceFile : ""), identity.areaHa != null ? ha(identity.areaHa) + " in all" : null,
        identity.shareMin != null ? "each at least " + pct(identity.shareMin) + " inside the blocks of " + who + (identity.leastShare != null ? " (the least " + pct(identity.leastShare) + ")" : "") : null].filter(Boolean);
      const rows = identity.paddocks.map((x) => ({ label: "Paddock " + (x.fid || x.itemKey || "?"), detail: [x.areaHa != null ? ha(x.areaHa) : null, x.share != null ? pct(x.share) + " inside" : null,
        x.idGiven ? "id given: " + x.idGiven : "no member id"].filter(Boolean).join(" · ") }));
      return { kind: "paddock_group", facts, rows, empty: !identity.geometry,
        text: identity.geometry ? "Outlined on the map with the blocks of " + who + "; each shape simplified to draw." : "Their shapes are not held, so they can't be shown on the map." };
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
  function decide(p, action, { pick = null, note = "", viewed = null, mode = null, other = null } = {}) {
    if (!p || !Number.isFinite(Number(p.id))) return null;
    const text = str(note).trim() || null, cands = list(p.candidates), seen = viewedList(viewed);
    const out = (o) => (seen.length ? { ...o, viewed: seen } : o);
    if (action === "reject") return out({ id: p.id, status: "rejected", candidate: null, note: text });
    // DEC3: "something else": a rejection that says what the item is instead (null until the answer is whole: otherProblem says why)
    if (action === "other") {
      if (otherProblem(p, other, note)) return null;
      return out({ id: p.id, status: "rejected", candidate: null, note: text, other: { reason: other.reason, ...(otherOf(p).outcomes.length ? { outcome: other.outcome } : {}) } });
    }
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

  // ---- DEC3 (#455 A): what the card asks about, standing out --------------------------------------------------------------------
  // An undecided card says its question in a sentence above the thing ("Are these 100 paddocks (681.7 ha) member 7's?"), and its map
  // draws three things only, each its own look, with a legend of them: the paddocks asked about (filled, their own colour), the
  // proposed member's blocks (a faint outline) and the other members' blocks (fainter still, grey). Tapping a paddock names it (its own
  // name field, else its id) with its area and share inside the member's blocks; names are drawn on the shapes only zoomed in to
  // paddock scale (from zoom 16), never on a group at its own frame. A decided card is drawn as it was (no subject): `subjectOf` is
  // null for every row that is not proposed or ambiguous.
  // The three looks (layer_styles records' shape, LK1), and the colours the legend's swatches repeat.
  const LOOKS = {
    subject: { fill: "#00c8ff", fill_opacity: 0.45, line: "#00c8ff", line_width: 2.5 },
    member: { fill_opacity: 0, line: "#ffffff", line_width: 1.5, line_opacity: 0.85 },
    others: { fill_opacity: 0, line: "#a8a8a8", line_width: 1, line_opacity: 0.6 },
  };
  const LABEL_FROM_ZOOM = 16;
  const ha1 = (v) => (Math.round(v * 10) / 10).toLocaleString("en-NZ", { maximumFractionDigits: 1 }) + " ha";
  const memberOf = (v) => { const s = str(v).trim(); return /^\d+$/.test(s) ? String(Number(s)) : s; };
  // a paddock's name: its own name field (the first one held), else "Paddock <id>"
  const nameOf = (names, fid, fallback) => (list(names)[0]?.value || (fid ? "Paddock " + fid : fallback));
  function siteQuestion(s, cands) {
    const sites = list(s?.sites).map(str).filter(Boolean);
    if (sites.length >= 2) {
      const named = sites.length === 2 ? sites.join(" and ") : sites.slice(0, -1).join(", ") + " and " + sites[sites.length - 1];
      return s.relation === "co_located" ? "Are " + named + " two records of one place?"
        : "Are " + named + " one site under successive ids" + (s.current ? ", now recorded as " + str(s.current) : "") + "?";
    }
    const c = cands[0], label = c ? str(c.label || c.name || "") : "";
    return label ? "Is this right: " + label + "?" : null;
  }
  function subjectOf(p, thing = null) {
    if (!p || !OPEN.includes(p.status)) return null;
    const t = thing || thingOf(p), cands = list(p.candidates), s = p.subject || {};
    // the member the question names: a proposed row's one candidate (a group's member)
    const proposed = p.status === "proposed" && cands.length >= 1 && cands[0]?.member != null ? memberOf(cands[0].member) : null;
    if (t.type === "place") {
      const g = t.group ? t.identity : null, member = t.group ? (t.member != null ? memberOf(t.member) : proposed) : proposed;
      const n = t.group ? Number(t.count) || 0 : 1, area = t.group ? g?.areaHa ?? null : t.identity?.areaHa ?? null;
      const whose = member ? "member " + member + "'s" : null;
      const question = t.group && n !== 1
        ? (whose ? "Are these " + n.toLocaleString("en-NZ") + " paddocks" + (area != null ? " (" + ha1(area) + ")" : "") + " " + whose + "?"
          : "Whose are these " + n.toLocaleString("en-NZ") + " paddocks" + (area != null ? " (" + ha1(area) + ")" : "") + "?")
        : whose ? "Is this " + (area != null ? ha1(area) + " " : "") + "paddock " + whose + "?" : "Whose is this " + (area != null ? ha1(area) + " " : "") + "paddock?";
      // the paddocks asked about, one feature each, with what a tap shows (the popup lists each property, its key capitalised:
      // "In Member Blocks: 94%"; short, so it fits a phone's card map beside its controls: review F2); name_once: the popup names it once, by its title (popup.js)
      const features = !t.geometry ? [] : t.group
        ? list(g?.paddocks).filter((x) => x.geometry).map((x) => ({ type: "Feature", geometry: x.geometry, properties: {
          name: nameOf(x.names, x.fid, "A paddock"), name_once: true, ...(x.areaHa != null ? { area_ha: x.areaHa } : {}), ...(x.share != null ? { in_member_blocks: Math.round(x.share * 100) + "%" } : {}),
          ...(x.idGiven ? { "id given": x.idGiven } : {}) } }))
        : [{ type: "Feature", geometry: t.geometry, properties: { name: nameOf(t.identity?.names, t.featureId, "The paddock"), name_once: true, ...(t.identity?.areaHa != null ? { area_ha: t.identity.areaHa } : {}),
          ...(t.identity?.idGiven ? { "id given": t.identity.idGiven } : {}) } }];
      const legend = !t.geometry ? [] : [
        { key: "subject", label: t.group && n !== 1 ? "The " + n.toLocaleString("en-NZ") + " paddocks asked about" : "The paddock asked about" },
        ...(member ? [{ key: "member", label: "Member " + member + "'s blocks" }] : []),
        { key: "others", label: member ? "Other members' blocks" : "Members' blocks", whenShown: true }];
      return { question, member, legend, features: { type: "FeatureCollection", features }, looks: LOOKS, labelFromZoom: LABEL_FROM_ZOOM };
    }
    if (p.kind === "member_match_file") {
      return { question: proposed && cands.length === 1 ? "Is this file member " + proposed + "'s?" : proposed ? "Is this file member " + proposed + "'s, or another member's?"
        : p.status === "ambiguous" && cands.length ? "Which member's file is this?" : "Whose file is this?", member: null, legend: [], features: null };
    }
    if (p.kind === "site_succession") {
      const q = siteQuestion(s, cands);
      return q ? { question: q, member: null, legend: [], features: null } : null;
    }
    return null;
  }

  // ---- DEC3 (#455 E): "Something else" ------------------------------------------------------------------------------------------
  // Every card a group decides has a third answer besides a member and Not this: what the item is instead, from a short list, with the
  // note. Recorded through proposals_decide as a rejection (the item stays set aside, no member named) with decision.other =
  // {reason, outcome?} (migration 20261109020000, app.proposal_other_problem holds the same lists). "Not this" keeps its meaning,
  // "none of these members". A decided row reads its answer in words (otherText).
  const SAY = ["other", "Something else: say what in the note"];
  const OTHER = {
    file: { title: "Not a member's file", reasons: [["template", "A template"], ["duplicate", "A duplicate of another file"], ["not_a_farm_plan", "Not a farm plan"],
      ["group_document", "The group's own file"], SAY], outcomeTitle: "What becomes of it",
      outcomes: [["remove_from_group_files", "Remove it from the group's files"], ["keep_as_group_document", "Keep it as a group file"]] },
    paddock: { title: "Not a paddock", reasons: [["sliver", "A sliver"], ["boundary_artefact", "A boundary artefact"], SAY], outcomes: [] },
    any: { title: "Something else", reasons: [SAY], outcomes: [] },
  };
  const OTHER_OF = { member_match_file: "file", member_match_paddock: "paddock", [GROUP_KIND]: "paddock", member_extent: "any", document_tier: "any", site_succession: "any" };
  // the "something else" a row offers, or null (a decided row, a feed row, a farm's row: none)
  function otherOf(p) {
    if (!p || !OPEN.includes(p.status) || p.org_id == null || !OTHER_OF[p.kind]) return null;
    const o = OTHER[OTHER_OF[p.kind]];
    return { kind: OTHER_OF[p.kind], title: o.title, reasons: o.reasons.map(([key, label]) => ({ key, label })), outcomeTitle: o.outcomeTitle || null,
      outcomes: o.outcomes.map(([key, label]) => ({ key, label })) };
  }
  // why the answer can't be sent yet, in words, or null
  function otherProblem(p, other, note = "") {
    const spec = otherOf(p);
    if (!spec) return "Something else can't be recorded for this row.";
    if (!other?.reason || !spec.reasons.some((r) => r.key === other.reason)) return "Pick what it is first.";
    if (spec.outcomes.length && !spec.outcomes.some((r) => r.key === other.outcome)) return "Pick what becomes of it first.";
    if (other.reason === "other" && !str(note).trim()) return "Say what it is in the note.";
    return null;
  }
  // a decided row's "something else" in words: "Not a member's file: a template · remove it from the group's files"
  function otherText(kind, other) {
    if (!other || typeof other !== "object" || !other.reason) return null;
    const o = OTHER[OTHER_OF[kind] || "any"] || OTHER.any;
    const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
    const r = o.reasons.find(([k]) => k === other.reason), out = o.outcomes.find(([k]) => k === other.outcome);
    const reason = other.reason === "other" ? "something else" : r ? low(r[1]) : str(other.reason);
    return (OTHER_OF[kind] === "any" || other.reason === "other" ? "Something else" : o.title + ": " + reason) + (out ? " · " + low(out[1]) : other.outcome ? " · " + str(other.outcome) : "");
  }

  return { GROUP_KIND, REGISTER_KINDS, registerAllowed, identityOf, bboxOf, polygonOf, thingOf, identityView, registerOf, searchRegister, answerOf, decide, viewedItem, viewedList,
    seenIdentity, seenDocument, seenFeature, stamp, subjectOf, LOOKS, LABEL_FROM_ZOOM, otherOf, otherProblem, otherText, OTHER };
});
