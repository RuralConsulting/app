// The group's manage space (ON3b, docs/CATCHMENT-SPACE.md "Manage"): its pure parts. Who sees which tab, the count line, and
// the words for each tab from the rows the database returned to the signed-in person: the business register and its farm
// associations (Members), ON3a's proposals about DQ1's set-aside files and paddocks grouped by proposed member (Gaps), WQ2's
// monitoring locations near the group (Sites). No DOM, no reads, no AI: group-manage.js reads as the person and hands the rows
// here; people decide only through public.proposals_decide (`decision` below builds its arguments).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  // WQ9: a location's other datasets are worded as the water-quality chart words them (wq-model.js, loaded before this file)
  const api = factory(node ? require("./wq-model.js") : root.FP && root.FP.wqModel);
  if (node) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.groupManageModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (W) {
  // ---- who sees what ------------------------------------------------------------------------------------------------------
  // The group's admins, advisors and facilitators read and decide its proposals (app.is_org_advisor, ON3a's RLS); a plain
  // member or editor gets the counts only (public.proposals_open_counts), so the space offers them the count line and Members,
  // never an empty Gaps tab that would read as "nothing open" (PM ruling, 5 Nov 2026). Settings is the group admin's form.
  const DECIDERS = ["admin", "advisor", "facilitator"];
  const canDecide = (role) => DECIDERS.includes(role);
  const canManage = (role) => role === "admin";
  // ON3c: Updates is the ongoing feed (analyses due for review, new gaps after a group load, reference changes near members)
  const TABS = [["members", "Members"], ["gaps", "Gaps"], ["updates", "Updates"], ["sites", "Sites"], ["settings", "Settings"]];
  function tabs(role) {
    return TABS.filter(([k]) => k === "members" || (k === "settings" ? canManage(role) : canDecide(role)));
  }
  // The tab to show: the one asked for when the person may see it, else the queue for a decider and Members for anyone else.
  function tabFor(role, asked) {
    const keys = tabs(role).map(([k]) => k);
    return keys.includes(asked) ? asked : canDecide(role) ? "gaps" : "members";
  }
  // Whether the group header links to the space (a plain member never sees the link; the route itself shows them Members).
  const showsLink = canDecide;

  // ---- words --------------------------------------------------------------------------------------------------------------
  const num = (n) => Number(n).toLocaleString("en-NZ");
  const plural = (n, one, many) => num(n) + " " + (Number(n) === 1 ? one : many);
  const TZ = "Pacific/Auckland";
  const day = (t) => {
    if (!t) return null;
    // a date on its own (an NZ date, as monitoring_location_sites keeps them) is that day as written; an instant, its NZ day
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(t)), d = new Date(dateOnly ? String(t) + "T12:00:00Z" : t);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: dateOnly ? "UTC" : TZ }) : null;
  };
  // DEC1c: held paddocks inside one member's blocks, one proposal per member and source layer (several paddocks, one decision)
  const GROUP_KIND = "member_match_paddock_group";
  const MEMBER_KINDS = ["member_match_file", "member_match_paddock", "member_extent", GROUP_KIND];
  const DECIDE_KINDS = [...MEMBER_KINDS, "document_tier"];
  // ON3c: the feed's kinds. A person marks each seen or follow up (its two candidates, through proposals_decide); never "to decide".
  const FEED_KINDS = ["review_due", "load_gap", "reference_change"];
  // RV1: questions about the register (register_review) are answered in People → To review; Manage only counts them
  const REVIEW_KIND = "register_review";
  const OPEN = ["proposed", "ambiguous"];
  const GAP_WORDS = {
    fep_unmatched: { what: "FEP file with no member number in its name", one: "FEP file not linked to a member", many: "FEP files not linked to a member" },
    fep_not_in_register: { what: "FEP file naming a member number that is not in the register", one: "FEP file naming a number not in the register", many: "FEP files naming a number not in the register" },
    paddock_held: { what: "Paddock held back from the map", one: "paddock held back from the map", many: "paddocks held back from the map" },
    member_no_extent: { what: "Member with no map extent", one: "member with no map extent", many: "members with no map extent" },
  };
  // What would place an item that no member is proposed for (DQ1's resolve lines, ops-model.js).
  const RESOLVE = {
    fep_unmatched: "Put the member number in the file name the way the group's load reads it, then re-run the group load.",
    fep_not_in_register: "Add the member to the register, or correct the number in the file name; then re-run the group load.",
    paddock_held: "Give each paddock its member's id in the paddock layer, then re-run the group load.",
  };
  const SIGNAL_WORD = { member_number: "member number", business_name: "member's name", fep_title: "the plan's title", member_blocks: "inside the member's blocks" };
  const ROLE_WORD = { current: "current site", successor: "successor", predecessor: "predecessor", co_located: "co-located" };

  // ---- the count line -----------------------------------------------------------------------------------------------------
  // "5 to decide · 1,116 paddocks held with no member evidence · 31 members without an extent · 2 site questions":
  // public.proposals_open_counts ({kind: open proposals}) beside DQ1's public.group_load_gaps for this group. A set-aside item with
  // no proposal is still open: the load's open gaps of each kind less those with an open proposal (`open_proposals`) and, when the
  // person can read the rows, less those accepted and waiting for the next group load (`waiting`, {gap kind: n}).
  // `access`: "ok" (counts read), "none" (proposals_open_counts returned null: the caller is neither a member of the group nor RCL
  // staff) or "error" (the read failed). Neither of the last two ever reads "Nothing open".
  const HELD = [["paddock_held", "paddock held with no member evidence", "paddocks held with no member evidence"],
    ["fep", "FEP file with no member evidence", "FEP files with no member evidence"]];
  function noEvidence(g, waiting = {}) {
    const c = g?.counts || {}, o = g?.open_proposals || {}, w = waiting || {};
    const rest = (k) => Math.max(0, (Number(c[k]) || 0) - (Number(o[k]) || 0) - (Number(w[k]) || 0));
    return { paddock_held: rest("paddock_held"), fep: rest("fep_unmatched") + rest("fep_not_in_register") };
  }
  // `waiting` null: no proposal rows were read (a plain member, or a failed read), so the items left after the open proposals may
  // include accepted ones: they are said in DQ1's own words ("more paddocks held back from the map"), never "no member evidence".
  // `gapsAccess` "error": DQ1's read failed; the line says so and is never "Nothing open".
  const HELD_PLAIN = { paddock_held: ["paddock held back from the map", "paddocks held back from the map"], fep: ["FEP file not linked to a member", "FEP files not linked to a member"] };
  function countLine(counts, gaps, { access = counts && typeof counts === "object" ? "ok" : "error", waiting = null, gapsAccess = "ok" } = {}) {
    if (access === "none") return { parts: [], empty: false, unknown: true, noAccess: true,
      text: "No access: only the people in this group and RCL staff see what is open for it." };
    const c = access === "ok" && counts && typeof counts === "object" ? counts : null, g = gaps && typeof gaps === "object" ? gaps : null;
    const decide = c ? Object.entries(c).filter(([k]) => k !== "site_succession" && k !== REVIEW_KIND && !FEED_KINDS.includes(k)).reduce((n, [, v]) => n + (Number(v) || 0), 0) : null;
    const site = c ? Number(c.site_succession) || 0 : null;
    const review = c ? Number(c[REVIEW_KIND]) || 0 : null;   // RV1: answered in People → To review, not here
    const updates = c ? FEED_KINDS.reduce((n, k) => n + (Number(c[k]) || 0), 0) : null;
    const noExtent = g ? Number(g.counts?.member_no_extent) || 0 : null;
    const held = g ? noEvidence(g, waiting) : { paddock_held: 0, fep: 0 };
    const parts = [];
    if (decide) parts.push({ key: "decide", n: decide, text: num(decide) + " to decide" });
    const proposedOf = (k) => k === "fep" ? (Number(g?.open_proposals?.fep_unmatched) || 0) + (Number(g?.open_proposals?.fep_not_in_register) || 0) : Number(g?.open_proposals?.[k]) || 0;
    for (const [k, one, many] of HELD) {
      if (!held[k]) continue;
      if (waiting) parts.push({ key: k === "fep" ? "fep_no_evidence" : "paddock_no_evidence", n: held[k], text: plural(held[k], one, many) });
      else parts.push({ key: k === "fep" ? "fep_held" : "paddock_held", n: held[k], text: (proposedOf(k) ? num(held[k]) + " more " : num(held[k]) + " ") + HELD_PLAIN[k][held[k] === 1 ? 0 : 1] });
    }
    if (noExtent) parts.push({ key: "no_extent", n: noExtent, text: plural(noExtent, "member without an extent", "members without an extent") });
    if (site) parts.push({ key: "site", n: site, text: plural(site, "site question", "site questions") });
    if (updates) parts.push({ key: "updates", n: updates, text: plural(updates, "update", "updates") });
    if (review) parts.push({ key: "review", n: review, text: plural(review, "register question to review (in People)", "register questions to review (in People)") });
    const unread = [...(!c ? ["the open proposals could not be read"] : []), ...(gapsAccess === "error" ? ["the group load's gaps could not be read"] : [])];
    if (unread.length) return { parts, empty: false, unknown: true, noAccess: false, text: [...parts.map((p) => p.text), ...unread].join(" · ") };
    return { parts, empty: !parts.length, unknown: false, noAccess: false, text: parts.length ? parts.map((p) => p.text).join(" · ") : "Nothing open" };
  }
  // Accepted (or applied, not yet placed) proposals per gap kind, from the rows a decider reads: their items are open gaps, but not
  // ones with no member evidence.
  function waitingByGap(rows, ctx = {}) {
    const out = {};
    for (const p of Array.isArray(rows) ? rows : []) {
      const k = p?.subject?.gap_kind;
      // a group waits for the load with each of its paddocks
      if (k && MEMBER_KINDS.includes(p.kind) && waitingForLoad(p, ctx)) out[k] = (out[k] || 0) + (p.kind === GROUP_KIND ? groupWaiting(p) : 1);
    }
    return out;
  }

  // ---- proposals ------------------------------------------------------------------------------------------------------------
  const base = (p) => String(p || "").split("/").pop();
  // What the proposal is about, in words: the file, the paddock (its layer file and feature id), the member, the site.
  const groupItems = (p) => (Array.isArray(p?.subject?.items) ? p.subject.items.filter((i) => i && i.item_key) : []);
  // the paddocks of a group that wait for the load: every one while it is accepted; once applied (--confirm), only those recorded
  // (outcome.paddocks) or already recorded, never its not_used ones, which are proposed again
  const groupWaiting = (p) => {
    if (p.status !== "applied" || !p.outcome || typeof p.outcome !== "object") return groupItems(p).length || 1;
    return (Number(p.outcome.paddocks) || 0) + (Number(p.outcome.already_recorded) || 0);
  };
  function itemOf(p) {
    const s = p?.subject || {}, gap = GAP_WORDS[s.gap_kind];
    if (p.kind === GROUP_KIND) {
      const n = groupItems(p).length || Number(s.count) || 0, part = Number(s.parts) > 1 ? " (part " + s.part + ")" : "";   // no "of M": once another part is decided, M is stale (F4)
      return { title: num(n) + (n === 1 ? " paddock" : " paddocks") + " in " + (base(s.source_file) || "the paddock layer") + part, what: "Paddocks held back from the map, inside one member's blocks",
        path: null, id: "no member id" };
    }
    if (p.kind === "member_match_file") return { title: s.source_file || base(s.item_key) || p.subject_key, what: gap?.what || "FEP file", path: s.item_key || null,
      id: s.external_id ? "number given: " + s.external_id : null };
    if (p.kind === "member_match_paddock") {
      const [layer, fid] = String(s.item_key || "").split("#");
      return { title: fid ? "Paddock " + fid + " in " + base(layer) : s.item_key || p.subject_key, what: gap?.what || "Paddock", path: null,
        id: s.external_id ? "id given: " + s.external_id : "no member id" };
    }
    if (p.kind === "member_extent") return { title: s.member_number ? "Member " + s.member_number : s.item_key || p.subject_key, what: gap?.what || "Member extent", path: null, id: null };
    if (p.kind === "site_succession") {
      // ON3c: one a person proposed (public.proposals_propose) names its sites, the relation and the one that carries the record now
      const sites = Array.isArray(s.sites) ? (s.relation === "co_located" ? "co-located: " : "succession: ") + s.sites.join(", ") + (s.current ? " (now " + s.current + ")" : "")
        + (s.valid_from ? " from " + day(s.valid_from) : "") : null;
      return { title: s.name || s.location_name || s.location_key || p.subject_key, what: "Site succession or co-location", path: null, id: sites };
    }
    return { title: s.title || s.name || p.subject_key, what: "File's kind", path: null, id: null };
  }
  const q = (v) => "“" + String(v) + "”";
  // One piece of evidence, as tools/reconcile_group.py writes it (file_evidence, title_evidence, paddock_evidence), in words.
  function evidenceText(e) {
    if (!e || typeof e !== "object") return String(e ?? "");
    if (e.signal === "member_number") {
      if (e.folder) return "In the member's folder " + q(e.folder);
      if (e.file_name) return "The file name has the number " + e.number + " (" + q(e.file_name) + ")";
      if (/^text in field /.test(e.from || "")) return "Field " + String(e.from).slice(14) + " names member " + e.number + " (" + q(e.value) + ")";
      if (/^field /.test(e.from || "")) return "Field " + String(e.from).slice(6) + " gives member number " + e.number + " (" + q(e.value) + ")";
      return "Member number " + e.number + (e.from ? " (" + e.from + ")" : "");
    }
    if (e.signal === "business_name") {
      // RCN1: a file named for the person, the business written as initials and a surname
      if (e.surname) return "The file name has the surname " + q(e.surname) + ", as in " + q(e.name) + (e.name_from ? " (" + String(e.name_from).replace(/, by surname$/, "") + ")" : "");
      const mine = e.file_words != null ? "The file name's words " + q(e.file_words) : "Field " + e.field + " " + q(e.value);
      return mine + (e.file_words != null ? " are like " : " is like ") + q(e.name) + (e.name_from ? " (" + e.name_from + ")" : "") + (e.similarity != null ? ", similarity " + e.similarity : "");
    }
    if (e.signal === "fep_title") {
      // RCN1: a labelled field on the plan's cover ("Farm Name"), its value like the member's name
      if (e.field && e.text) return "The plan's cover gives " + q(e.text) + ", like " + q(e.name) + (e.name_from ? " (" + e.name_from + ")" : "");
      return "The plan's title names the " + (e.found === "business name" ? "member" : e.found || "member") + " " + q(e.number || e.name) + (e.text ? ": " + q(e.text) : "");
    }
    if (e.signal === "member_blocks") {
      // DEC1c: the paddocks' shapes against the member's blocks
      const pct = (v) => Math.round(Number(v) * 100) + "%", n = Number(e.paddocks) || 0;
      return (n === 1 ? "The paddock has" : "Each of the " + num(n) + " paddocks has") + " at least " + pct(e.share_min ?? 0.9) + " of its area inside the member's blocks"
        + (e.least_share != null && n > 1 ? " (the least " + pct(e.least_share) + ")" : "");
    }
    return Object.entries(e).filter(([k]) => k !== "confidence").map(([k, v]) => k + " " + v).join(", ");
  }
  const memberLabel = (c) => c ? "Member " + c.member + (c.business_name ? ", " + c.business_name : "") : "No member";
  const candidateOf = (c) => ({ member: c.member ?? null, label: c.member != null ? memberLabel(c) : String(c.name || c.label || c.site || JSON.stringify(c)),
    confidence: c.confidence ?? null, signals: (Array.isArray(c.signals) ? c.signals : []).map((s) => SIGNAL_WORD[s] || s),
    evidence: (Array.isArray(c.evidence) ? c.evidence : []).map(evidenceText), raw: c });
  // The chosen candidate as proposals_decide names it: by its member number when it has one, else the whole candidate.
  const choose = (c) => c && Object.prototype.hasOwnProperty.call(c, "member") ? { member: c.member } : c || null;

  // An accepted row reads "accepted, placed on the next group load" until the load has placed it; so does an `applied` one
  // (reconcile_group.py --confirm records the match and marks it applied; the group load places it later) whose gap is still
  // open: `open` is the set of "<gap kind>:<item key>" of the group's open gaps (the group admin reads them), or, for an advisor
  // or facilitator who cannot read the gap rows, null: then a row applied after the last group load is still to be placed.
  function waitingForLoad(p, { open = null, checkedAt = null } = {}) {
    if (p.status === "accepted") return true;
    if (p.status !== "applied") return false;
    const s = p.subject || {};
    if (open instanceof Set && s.gap_kind && s.item_key) return open.has(s.gap_kind + ":" + s.item_key);
    if (!checkedAt || !p.applied_at) return true;
    return Date.parse(p.applied_at) > Date.parse(checkedAt);
  }
  function line(p, ctx = {}) {
    const item = itemOf(p), cands = (Array.isArray(p.candidates) ? p.candidates : []).map(candidateOf);
    // DEC1a: a member named from the register (chosen_from "register") is not one of the candidates; rows decided before it have none
    const chosen = p.decision?.candidate ? { ...candidateOf(p.decision.candidate), register: p.decision.chosen_from === "register" } : null;
    const note = p.decision?.note || null, by = p.decided_at ? day(p.decided_at) : null;
    let state, text;
    // DEC1a: a set-aside file with no candidate is proposed with none; DEC1b: the register is searched for its member
    if (p.status === "proposed") { state = "proposed"; text = cands.length ? "Proposed: " + cands[0].label : "No suggestion: pick a member"; }
    else if (p.status === "ambiguous") { state = "ambiguous"; text = cands.length === 1 ? "One possible member: pick it, or Not this" : "Pick one of these members, or Not this"; }
    else if (waitingForLoad(p, ctx)) { state = "accepted"; text = "Accepted" + (chosen ? " (" + chosen.label + (chosen.register ? ", from the register" : "") + ")" : "") + ", placed on the next group load"; }
    // DEC3: "something else" is a rejection that says what the item is instead (decision.other); a plain Not this has none
    else if (p.status === "rejected" && p.decision?.other && typeof p.decision.other === "object") { state = "other"; text = DC().otherText(p.kind, p.decision.other) || "Something else"; }
    else if (p.status === "rejected") { state = "rejected"; text = "Not this: it stays set aside"; }
    else { state = "done"; text = p.status === "applied" ? "Placed" : "No longer open"; }
    if (p.kind === GROUP_KIND) {
      // DEC1c: one answer for every paddock in the group
      const n = groupItems(p).length, all = n === 1 ? "the paddock" : "all " + num(n);
      if (state === "proposed" && cands.length) text = "Proposed for " + all + ": " + cands[0].label;
      else if (state === "accepted") text = "Accepted " + all + (chosen ? " (" + chosen.label + (chosen.register ? ", from the register" : "") + ")" : "") + ", placed on the next group load";
      else if (state === "rejected") text = "Not this: " + (n === 1 ? "it stays" : "they stay") + " held back";
    }
    const evidence = p.evidence && typeof p.evidence === "object" ? p.evidence : {};
    return { id: p.id, kind: p.kind, status: p.status, state, text, item, candidates: cands, proposed: p.status === "proposed" ? cands[0] || null : null, chosen, note,
      decided: by ? "Decided " + by + (note ? " · " + note : "") : null,
      because: evidence.set_aside_because ? (p.kind === "site_succession" ? "Why: " : "Set aside because: ") + evidence.set_aside_because
        : p.kind === "site_succession" && typeof evidence.note === "string" && evidence.note ? "Why: " + evidence.note : null,
      replaces: evidence.replaces_stale_match?.member ? "Replaces a match to member " + evidence.replaces_stale_match.member + " the load no longer uses" : null,
      lines: (Array.isArray(evidence.lines) ? evidence.lines : []).filter((l) => typeof l === "string"),
      // a pick is offered where there is a choice, and for an ambiguous row whatever its candidates: with one candidate (RCN1,
      // a surname alone) nothing is pre-filled, so picking it is the only way to accept it
      open: OPEN.includes(p.status), canPick: OPEN.includes(p.status) && (cands.length > 1 || p.status === "ambiguous") };
  }
  // The arguments of public.proposals_decide for a person's choice: accept (the proposed member, or the one picked), or not this.
  function decision(p, action, { member = null, note = "" } = {}) {
    const cands = Array.isArray(p.candidates) ? p.candidates : [];
    const text = String(note || "").trim() || null;
    if (action === "reject") return { id: p.id, status: "rejected", candidate: null, note: text };
    const pick = member != null ? cands.find((c) => String(c.member) === String(member)) : p.status === "proposed" ? cands[0] : null;
    if (!pick) return null;   // an ambiguous row needs a member picked
    return { id: p.id, status: "accepted", candidate: choose(pick), note: text };
  }
  const replace = (rows, row) => (rows || []).map((r) => (r.id === row?.id ? row : r));

  // ---- DEC1b: the decision card (decision-card.js) for a proposal line ------------------------------------------------------------
  // The card puts the question with the thing it is about (the file's identity, or the held paddock framed on a small map) and
  // answers it with the candidates first and, for a member match, any current member of the register (`register`: the
  // group_members rows read, or null when they could not be read). `answering`: the person decides here (the buttons are drawn).
  const DC = () => (typeof module === "object" && module.exports ? require("./decision-card-model.js") : globalThis.FP.decisionCardModel);
  const candidateCard = (c) => ({ label: c.label, detail: [c.confidence != null ? "confidence " + c.confidence : null, c.signals.length ? c.signals.join(", ") : null].filter(Boolean).join(" · ") || null,
    evidence: c.evidence });
  function card(p, ctx = {}, { register = null, answering = false } = {}) {
    const l = line(p, ctx), dc = DC();
    const chosen = l.chosen ? { ...candidateCard(l.chosen), detail: l.chosen.register ? "from the register" : candidateCard(l.chosen).detail } : null;
    // read only: the proposed (or chosen) member's evidence, or every candidate's when more than one could fit
    const readOnly = l.state === "ambiguous" ? l.candidates.map(candidateCard) : l.proposed ? [candidateCard(l.proposed)] : chosen ? [chosen] : [];
    const thing = dc.thingOf(p);
    // DEC3 (#455 A, E): an undecided row's question in words, its map's subject and legend, and its "something else" answer; a
    // decided row has neither, and its card is drawn exactly as before
    const subject = l.open ? dc.subjectOf(p, thing) : null, other = l.open ? dc.otherOf(p) : null;
    return { id: l.id, p, line: l, title: l.item.title, sub: [l.item.what, l.item.id, l.item.path && l.item.path !== l.item.title ? l.item.path : null].filter(Boolean).join(" · "),
      state: l.state, stateText: l.text, lines: [l.because, l.replaces], thing, ...(subject ? { subject } : {}), ...(other ? { other } : {}),
      candidates: answering ? l.candidates.map(candidateCard) : readOnly, shown: answering ? [] : readOnly.map((_, i) => i),
      answer: dc.answerOf(p), register: dc.registerAllowed(p) ? register : null, canAnswer: false, decided: l.decided && !l.open ? l.decided : null,
      // DEC1c: accept all, pick another member (for all of them), or not this
      ...(p.kind === GROUP_KIND ? { labels: groupLabels(p) } : {}) };
  }
  function groupLabels(p) {
    const n = groupItems(p).length, all = n === 1 ? "the paddock" : "all " + num(n);
    return { accept: "Accept " + all, pick: "Accept " + all + " for the member picked", reject: "Not this",
      register: "Or another member, for " + all + ": search the register by number or name" };
  }
  // A feed row (Updates) as a card: its words, and its two answers as buttons (Seen, Follow up).
  function feedCard(p) {
    const l = feedLine(p);
    return { id: l.id, p, line: l, title: l.title, sub: l.what, state: l.state, stateText: l.text + (l.note ? " · " + l.note : ""), lines: l.lines, thing: { type: "plain" },
      candidates: [], shown: [], answer: { mode: "actions", actions: [{ key: "seen", label: "Seen", primary: true }, { key: "follow_up", label: "Follow up" }] },
      register: null, canAnswer: false, decided: null };
  }

  // The Gaps tab: the open, accepted and still-to-be-placed proposals about the group's set-aside items, one line each with its
  // evidence, grouped by proposed member (a row with several close candidates under "More than one member could fit"); then, per
  // gap kind, how many open items have no proposal and what would place them. `gaps` is this group's group_load_gaps entry.
  function gapsTab(rows, { gaps = null, open = null, decidedHere = new Set() } = {}) {
    const ctx = { open, checkedAt: gaps?.checked_at || null };
    const lines = (Array.isArray(rows) ? rows : []).filter((p) => p && DECIDE_KINDS.includes(p.kind))
      .map((p) => line(p, ctx)).filter((l) => l.open || l.state === "accepted" || ((l.state === "rejected" || l.state === "other") && decidedHere.has(l.id)));
    const groups = new Map();
    for (const l of lines) {
      // under the member proposed (or the one accepted); a row just turned down stays where it was proposed
      const who = l.state === "ambiguous" ? null : l.proposed || l.chosen || ((l.state === "rejected" || l.state === "other") && l.candidates.length === 1 ? l.candidates[0] : null);
      // RCN1: a row with one candidate and nothing chosen (a surname alone) is weak evidence, not a choice between members
      const key = l.kind === "document_tier" ? "other" : l.state === "ambiguous" ? (l.candidates.length === 1 ? "weak" : "ambiguous") : who?.member != null ? "member:" + who.member : "other";
      if (!groups.has(key)) groups.set(key, { key, member: who?.member ?? null,
        title: key === "ambiguous" ? "More than one member could fit" : key === "weak" ? "One possible member, not certain" : key === "other" ? "Other questions" : who.label, lines: [] });
      groups.get(key).lines.push(l);
    }
    const order = (g) => (g.key === "ambiguous" ? -1 : g.key === "weak" ? -0.5 : g.key === "other" ? 1e9 : Number(g.member) || 1e8);
    const list = [...groups.values()].sort((a, b) => order(a) - order(b) || String(a.member).localeCompare(String(b.member)));
    for (const g of list) {
      g.lines.sort((a, b) => (a.open ? 0 : 1) - (b.open ? 0 : 1) || String(a.item.title).localeCompare(String(b.item.title)) || a.id - b.id);
      const toDecide = g.lines.filter((l) => l.open).length, accepted = g.lines.filter((l) => l.state === "accepted").length;
      g.count = [toDecide ? num(toDecide) + " to decide" : null, accepted ? num(accepted) + " accepted" : null].filter(Boolean).join(" · ");
    }
    const counts = gaps?.counts || {}, proposed = gaps?.open_proposals || {};
    // per gap kind, every open item the load set aside: with a proposal to decide, accepted and waiting for the next load, or
    // with no member evidence (no proposal at all: still open, and what would place it); members with no extent likewise
    const waiting = waitingByGap(rows, ctx);
    const setAside = ["paddock_held", "fep_unmatched", "fep_not_in_register", "member_no_extent"].filter((k) => Number(counts[k]) > 0).map((k) => {
      const n = Number(counts[k]), withProposal = Math.min(n, Number(proposed[k]) || 0), accepted = Math.min(n - withProposal, Number(waiting[k]) || 0);
      const rest = n - withProposal - accepted;
      const split = [withProposal ? num(withProposal) + " to decide" : null, accepted ? num(accepted) + " accepted, placed on the next group load" : null,
        rest ? num(rest) + " with no member evidence" : null].filter(Boolean);
      return { kind: k, n, withProposal, accepted, rest,
        text: k === "member_no_extent" ? plural(n, "member without an extent", "members without an extent") + " (on the register, no block in the members layer; see Members)"
          : plural(n, GAP_WORDS[k].one, GAP_WORDS[k].many) + " set aside by the last group load: " + (split.join(", ") || "none open"),
        resolve: rest ? (k === "member_no_extent" ? "Add the member's block to the members layer, then re-run the group load." : RESOLVE[k]) : null };
    });
    return { groups: list, lines: lines.length, toDecide: lines.filter((l) => l.open).length, setAside,
      checked: gaps?.checked_at ? "Last group load checked " + day(gaps.checked_at) : null, empty: !lines.length && !setAside.length };
  }

  // ---- Members ----------------------------------------------------------------------------------------------------------------
  // The business register (group_members, readable by every member of the group) with each business's farm associations as the
  // person may read them (a group admin: pending and ended too; others: active only), and DQ1's "no extent" (the list for a group
  // admin; the count for anyone else).
  function associationText(a) {
    if (a.status === "active") return { state: "active", text: "Linked to a farm in the tool since " + (day(a.farm_approved_at) || "a date not recorded") };
    if (a.status === "pending") return { state: "pending", text: "Requested " + (day(a.group_approved_at) || "") + "; waiting for the farm's owner to approve" };
    return { state: "ended", text: "Ended " + (day(a.ended_at) || "") + (a.ended_side ? " by the " + a.ended_side : "") };
  }
  const byNumber = (a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || String(a).localeCompare(String(b));
  function membersTab({ register = [], associations = [], gaps = null, canManage: admin = false } = {}) {
    const assoc = (Array.isArray(associations) ? associations : []).filter(Boolean);
    const noExtent = new Map((gaps?.detail && Array.isArray(gaps.items) ? gaps.items : []).filter((i) => i?.kind === "member_no_extent" && i.member_number != null)
      .map((i) => [String(i.member_number), i.reason || "no block in the members layer"]));
    const assocOf = (id) => assoc.filter((a) => a.group_member_id === id).sort((a, b) => String(b.created_at || b.group_approved_at).localeCompare(String(a.created_at || a.group_approved_at)))
      .map((a) => ({ id: a.id, farm: a.farm_id || null, ...associationText(a) }));
    const rows = (Array.isArray(register) ? register : []).filter(Boolean).sort((a, b) => byNumber(a.member_number, b.member_number)).map((m) => {
      const links = assocOf(m.id);
      return { id: m.id, number: String(m.member_number), name: m.business_name, retired: m.ended_at ? "Retired " + day(m.ended_at) : null, associations: links,
        active: links.some((l) => l.state === "active"), pending: links.some((l) => l.state === "pending"),
        noExtent: noExtent.has(String(m.member_number)) ? "No map extent: " + noExtent.get(String(m.member_number)) : null };
    });
    const unlinked = assoc.filter((a) => !a.group_member_id).map((a) => ({ id: a.id, farm: a.farm_id || null, ...associationText(a) }));
    const current = rows.filter((r) => !r.retired), noExtentCount = Number(gaps?.counts?.member_no_extent) || 0;
    const summary = !rows.length ? null : [plural(current.length, "member on the register", "members on the register") + (rows.length > current.length ? " (" + num(rows.length - current.length) + " retired)" : ""),
      num(rows.filter((r) => r.active).length) + " linked to a farm in the tool", ...(noExtentCount ? [plural(noExtentCount, "without a map extent", "without a map extent")] : [])].join(" · ");
    return { rows, unlinked, summary, empty: !rows.length,
      emptyText: "No members are on the group's register yet. RCL's group load adds them from the group's members layer.",
      noExtentNote: noExtentCount && !noExtent.size ? plural(noExtentCount, "member has", "members have") + " no map extent. The list is for the group's admins." : null,
      noExtentResolve: noExtentCount ? "Add the member's block to the members layer, then re-run the group load." : null,
      canInvite: !!admin, canRequest: !!admin,
      businesses: current.map((r) => ({ id: r.id, label: "Member " + r.number + ", " + r.name })) };
  }
  // The farm id a group admin types to request an association (request_farm_group_association takes the farm's id; the farm's
  // owner gives it to the group). Lower case, the uuid shape, or null.
  const farmId = (v) => { const s = String(v || "").trim().toLowerCase(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null; };
  const email = (v) => { const s = String(v || "").trim(); return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(s) && s.length <= 254 ? s.toLowerCase() : null; };
  const INVITE_ROLES = [["view", "Can view"], ["edit", "Can edit"]];

  // ---- Sites --------------------------------------------------------------------------------------------------------------------
  // WQ2's monitoring locations among the sites near the group (public.group_wq_sites: the sites its water-quality card lists), each
  // with its member sites, roles and dates (public.monitoring_location); the group's own sites; and the site questions (open
  // site_succession proposals). Read only: a location is a reviewed manifest entry RCL loads, never edited here.
  // WQ9: `also`, one line per other dataset a location's members hold beside its current site's ("Also measured by Earth Sciences New
  // Zealand (NIWA), 1989 to 2024."), from the members' records that monitoring_location already returns: no other read. No count (PM
  // ruling, 6 Nov 2026): the tab is about no one parameter; the chart gives the count of the parameter it draws. WQ10: the span is each
  // member's record within its dates at the place (otherDatasets clips the summary's first and last to valid_from / valid_to).
  function memberSite(m) {
    const id = m.external_id || (m.monitoring_site_id != null ? "site " + m.monitoring_site_id : "an agency id");
    const from = day(m.valid_from), to = day(m.valid_to);
    return { id, name: m.name || null, role: ROLE_WORD[m.role] || m.role, source: m.source_key || null,
      dates: from && to ? from + " to " + to : from ? "from " + from : to ? "to " + to : "dates not recorded", note: m.note || null };
  }
  function sitesTab({ sites = [], locations = [], proposals = [], groupId = null, gaps = null, open = null } = {}) {
    const list = (Array.isArray(sites) ? sites : []).filter(Boolean);
    const near = new Set(list.map((s) => s.site_id));
    const locs = (Array.isArray(locations) ? locations : []).filter((l) => l && Array.isArray(l.members) && l.members.some((m) => near.has(m.monitoring_site_id)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))).map((l) => ({ id: l.id, key: l.key, name: l.name, note: l.note || null, members: l.members.map(memberSite),
        also: W ? W.alsoMeasured(W.otherDatasets(l), undefined, { count: false }) : [] }));
    const inLoc = new Set(locs.flatMap((l) => (locations.find((x) => x.id === l.id)?.members || []).map((m) => m.monitoring_site_id)));
    const own = list.filter((s) => groupId && s.owner_org_id === groupId).sort((a, b) => String(a.external_id).localeCompare(String(b.external_id)))
      .map((s) => ({ id: s.external_id, name: s.name, last: s.last_sampled ? "last sampled " + day(s.last_sampled) : "no results yet" }));
    const others = list.filter((s) => !inLoc.has(s.site_id) && !(groupId && s.owner_org_id === groupId)).length;
    const questions = (Array.isArray(proposals) ? proposals : []).filter((p) => p?.kind === "site_succession")
      .map((p) => line(p, { open, checkedAt: gaps?.checked_at || null })).filter((l) => l.open || l.state === "accepted");
    return { locations: locs, own, others, questions, empty: !list.length && !questions.length,
      // PM ruling (5 Nov 2026): the tab reads public.group_wq_sites and says so; MC1's in-area pick (group_wq_pick) is unchanged
      scope: "Sites within 5 km of the group's area (the sites the map's water-quality line lists).",
      emptyText: "No monitoring sites are recorded within 5 km of the group's area yet.",
      noLocations: list.length && !locs.length ? "None of the sites near the group is in a monitoring location yet." : null,
      othersText: others ? plural(others, "other site", "other sites") + " within 5 km " + (others === 1 ? "is" : "are") + " in no monitoring location (they are on the map's water-quality line)." : null,
      // ON3c: a decider proposes one here (public.proposals_propose, site_succession only); RCL applies an accepted one through the
      // reviewed monitoring-locations manifest, so accepting it changes nothing else.
      // PM ruling (5 Nov 2026): succession questions go to RCL's seed run; ON3c lets a decider propose one here first
      propose: "Propose a succession or co-location: name the site ids, which one carries the record now and the date it counts from. " +
        "It becomes a site question for the group to decide; an accepted one goes to RCL's reviewed seed run of the monitoring-locations manifest, "
        + "and once loaded it shows under Monitoring locations." };
  }
  // The arguments of public.proposals_propose from the Sites form: site ids (commas or spaces between them), succession or
  // co-located, the one that carries the record now, the date it counts from, a name and a note. { error } when they would be refused.
  function proposeArgs(groupId, { sites = "", relation = "succession", current = "", validFrom = "", name = "", note = "" } = {}) {
    const ids = [...new Set(String(sites).split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
    if (ids.length < 2 || ids.length > 20) return { error: "Name 2 to 20 site ids." };
    if (ids.some((s) => s.length > 60)) return { error: "A site id is at most 60 characters." };
    if (!["succession", "co_located"].includes(relation)) return { error: "Choose a succession or a co-location." };
    const cur = String(current || "").trim();
    if (cur && !ids.includes(cur)) return { error: "The site that carries the record now must be one of the sites." };
    const from = String(validFrom || "").trim();
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: "Write the date as YYYY-MM-DD." };
    const subject = { relation, sites: ids };
    if (cur) subject.current = cur;
    if (from) subject.valid_from = from;
    if (String(name).trim()) subject.name = String(name).trim().slice(0, 200);
    const text = String(note || "").trim();
    return { kind: "site_succession", org_id: groupId, subject, evidence: text ? { note: text.slice(0, 2000) } : {} };
  }

  // ---- Updates: the ongoing feed (ON3c) ---------------------------------------------------------------------------------------------
  // public.proposals rows of the feed kinds, as tools/load_group.py and tools/refresh_reference.py write them (app.feed_review_due,
  // app.feed_load_gaps, app.feed_reference_change): one line each, newest first, with its evidence in words, and its state: new
  // (proposed), seen, or follow up (accepted with that answer). Superseded rows are not shown (their successor is).
  const FEED_WORDS = { review_due: "Analysis due for review", load_gap: "New gaps from a group load", reference_change: "Reference layer changed near members" };
  // "1, 4, 7 and 5 more": the first three of the names given, and how many more of `total`
  const listNames = (a, total) => {
    const s = (Array.isArray(a) ? a : []).map(String), shown = s.slice(0, 3), more = Math.max(Number(total) || 0, s.length) - shown.length;
    return shown.join(", ") + (more > 0 ? " and " + num(more) + " more" : "");
  };
  function feedLine(p) {
    const e = p.evidence && typeof p.evidence === "object" ? p.evidence : {}, s = p.subject || {};
    let title, lines = [];
    if (p.kind === "review_due") {
      title = "An analysis " + (s.module ? "(" + s.module + ") " : "") + "made " + (day(s.made_at) || "earlier") + " is due for review";
      lines = (Array.isArray(e.reasons) ? e.reasons : []).map((r) => r?.text).filter(Boolean);
    } else if (p.kind === "load_gap") {
      const w = GAP_WORDS[s.gap_kind] || { one: "item set aside", many: "items set aside" }, n = Number(e.new) || 0, open = Number(e.open) || 0;
      title = "The group load on " + (day(e.loaded_at || p.created_at) || "its last run") + " set aside " + plural(n, "new " + w.one, "new " + w.many)
        + (open > n ? " (" + num(open) + " unseen and still open)" : "");
      const items = (Array.isArray(e.items) ? e.items : []).slice(0, 10).map((i) => (i.member_number ? "Member " + i.member_number : i.source_file || i.item_key)
        + (i.reason ? ": " + i.reason : "") + (i.new === false ? " (earlier)" : ""));
      const rest = (Number(e.unlisted) || 0) + Math.max(0, (Array.isArray(e.items) ? e.items.length : 0) - 10);
      lines = rest ? [...items, "and " + num(rest) + " more"] : items;
    } else {
      const counts = [["added", "added"], ["changed", "changed"], ["removed", "removed"]].filter(([k]) => Number(e[k])).map(([k, w]) => num(e[k]) + " " + w);
      title = (e.source_name || s.source_key || "A reference layer") + " was refreshed " + (day(e.refreshed_at) || "") + ": " + (counts.join(", ") || "changes")
        + " within " + (e.context_buffer_m != null ? num(e.context_buffer_m) + " m" : "the context distance") + " of members";
      const who = [];
      if (Number(e.members_count)) who.push("Members " + listNames(e.members, e.members_count));
      if (Number(e.farms_count)) who.push(plural(e.farms_count, "associated farm", "associated farms"));
      lines = who.length ? ["Near: " + who.join("; ")] : [];
      const earlier = Array.isArray(e.earlier) ? e.earlier.length : 0;
      if (earlier) lines.push(plural(earlier, "earlier refresh", "earlier refreshes") + " not yet seen, included");
      if (e.first_pull) lines.push("The layer's first load: every feature is new");
    }
    const action = p.decision?.candidate?.action || null, note = p.decision?.note || null;
    const state = p.status === "proposed" ? "new" : p.status === "accepted" ? (action === "follow_up" ? "follow_up" : "seen") : "done";
    const text = state === "new" ? "New" : state === "follow_up" ? "Follow up" + (day(p.decided_at) ? ", marked " + day(p.decided_at) : "") : state === "seen" ? "Seen " + (day(p.decided_at) || "") : "No longer current";
    return { id: p.id, kind: p.kind, what: FEED_WORDS[p.kind] || p.kind, title, lines, state, text: text.trim(), note, open: p.status === "proposed", created_at: p.created_at };
  }
  function feedTab(rows) {
    const lines = (Array.isArray(rows) ? rows : []).filter((p) => p && FEED_KINDS.includes(p.kind) && ["proposed", "accepted"].includes(p.status)).map(feedLine)
      .sort((a, b) => (a.open ? 0 : 1) - (b.open ? 0 : 1) || String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
    const n = lines.filter((l) => l.open).length;
    return { lines, open: n, empty: !lines.length, emptyText: "Nothing new: no analysis is due for review, and no group load or reference refresh has changed anything near members.",
      summary: lines.length ? plural(n, "new update", "new updates") + (lines.length > n ? " · " + num(lines.length - n) + " seen or followed up" : "") : null };
  }
  // The arguments of public.proposals_decide for a feed row: seen or follow up (one of its two candidates), with a note.
  function feedDecision(p, action, note = "") {
    if (!p || !["seen", "follow_up"].includes(action)) return null;
    return { id: p.id, status: "accepted", candidate: { action }, note: String(note || "").trim() || null };
  }

  // ---- "since you last looked" (ON3c) -------------------------------------------------------------------------------------------------
  // From public.proposals_since_seen ({seen_at, since: {kind: n}}); null (no access) or an unread answer draws no line.
  const SINCE_WORDS = [["review_due", "analysis due for review", "analyses due for review"], ["load_gap", "new gap update from a group load", "new gap updates from group loads"],
    ["reference_change", "reference change near members", "reference changes near members"], ["site_succession", "site question", "site questions"],
    ["register_review", "register question to review", "register questions to review"]];   // RV1
  function sinceLine(r) {
    if (!r || typeof r !== "object" || typeof r.since !== "object" || r.since == null) return null;
    const c = r.since, parts = [];
    for (const [k, one, many] of SINCE_WORDS) if (Number(c[k])) parts.push({ key: k, n: Number(c[k]), text: plural(c[k], one, many) });
    const other = Object.entries(c).filter(([k]) => !SINCE_WORDS.some(([w]) => w === k)).reduce((n, [, v]) => n + (Number(v) || 0), 0);
    if (other) parts.push({ key: "proposals", n: other, text: plural(other, "proposal", "proposals") });
    const when = r.seen_at ? day(r.seen_at) : null;
    const text = !r.seen_at ? (parts.length ? "Your first look: " + parts.map((p) => p.text).join(" · ") + " open" : "Your first look: nothing open")
      : parts.length ? "Since you last looked (" + when + "): " + parts.map((p) => p.text).join(" · ") : "Nothing new since you last looked (" + when + ")";
    return { text, parts, first: !r.seen_at, seenAt: r.seen_at || null };
  }

  return { DECIDERS, canDecide, canManage, TABS, tabs, tabFor, showsLink, countLine, noEvidence, waitingByGap, itemOf, evidenceText, line, waitingForLoad, decision, replace,
    gapsTab, membersTab, associationText, sitesTab, proposeArgs, feedLine, feedTab, feedDecision, sinceLine, farmId, email, INVITE_ROLES, MEMBER_KINDS, DECIDE_KINDS, FEED_KINDS, day,
    card, feedCard };
});
