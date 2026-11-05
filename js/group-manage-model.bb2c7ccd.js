// The group's manage space (ON3b, docs/CATCHMENT-SPACE.md "Manage"): its pure parts. Who sees which tab, the count line, and
// the words for each tab from the rows the database returned to the signed-in person: the business register and its farm
// associations (Members), ON3a's proposals about DQ1's set-aside files and paddocks grouped by proposed member (Gaps), WQ2's
// monitoring locations near the group (Sites). No DOM, no reads, no AI: group-manage.js reads as the person and hands the rows
// here; people decide only through public.proposals_decide (`decision` below builds its arguments).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.groupManageModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  // ---- who sees what ------------------------------------------------------------------------------------------------------
  // The group's admins, advisors and facilitators read and decide its proposals (app.is_org_advisor, ON3a's RLS); a plain
  // member or editor gets the counts only (public.proposals_open_counts), so the space offers them the count line and Members,
  // never an empty Gaps tab that would read as "nothing open" (PM ruling, 5 Nov 2026). Settings is the group admin's form.
  const DECIDERS = ["admin", "advisor", "facilitator"];
  const canDecide = (role) => DECIDERS.includes(role);
  const canManage = (role) => role === "admin";
  const TABS = [["members", "Members"], ["gaps", "Gaps"], ["sites", "Sites"], ["settings", "Settings"]];
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
  const MEMBER_KINDS = ["member_match_file", "member_match_paddock", "member_extent"];
  const DECIDE_KINDS = [...MEMBER_KINDS, "document_tier"];
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
  const SIGNAL_WORD = { member_number: "member number", business_name: "business name", fep_title: "the plan's title" };
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
      text: "No access: only the group's members and RCL staff see what is open for it." };
    const c = access === "ok" && counts && typeof counts === "object" ? counts : null, g = gaps && typeof gaps === "object" ? gaps : null;
    const decide = c ? Object.entries(c).filter(([k]) => k !== "site_succession").reduce((n, [, v]) => n + (Number(v) || 0), 0) : null;
    const site = c ? Number(c.site_succession) || 0 : null;
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
      if (k && MEMBER_KINDS.includes(p.kind) && waitingForLoad(p, ctx)) out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  // ---- proposals ------------------------------------------------------------------------------------------------------------
  const base = (p) => String(p || "").split("/").pop();
  // What the proposal is about, in words: the file, the paddock (its layer file and feature id), the member, the site.
  function itemOf(p) {
    const s = p?.subject || {}, gap = GAP_WORDS[s.gap_kind];
    if (p.kind === "member_match_file") return { title: s.source_file || base(s.item_key) || p.subject_key, what: gap?.what || "FEP file", path: s.item_key || null,
      id: s.external_id ? "number given: " + s.external_id : null };
    if (p.kind === "member_match_paddock") {
      const [layer, fid] = String(s.item_key || "").split("#");
      return { title: fid ? "Paddock " + fid + " in " + base(layer) : s.item_key || p.subject_key, what: gap?.what || "Paddock", path: null,
        id: s.external_id ? "id given: " + s.external_id : "no member id" };
    }
    if (p.kind === "member_extent") return { title: s.member_number ? "Member " + s.member_number : s.item_key || p.subject_key, what: gap?.what || "Member extent", path: null, id: null };
    if (p.kind === "site_succession") return { title: s.name || s.location_name || s.location_key || p.subject_key, what: "Site succession or co-location", path: null, id: null };
    return { title: s.title || s.name || p.subject_key, what: "Document's kind", path: null, id: null };
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
      const mine = e.file_words != null ? "The file name's words " + q(e.file_words) : "Field " + e.field + " " + q(e.value);
      return mine + (e.file_words != null ? " are like " : " is like ") + q(e.name) + (e.name_from ? " (" + e.name_from + ")" : "") + (e.similarity != null ? ", similarity " + e.similarity : "");
    }
    if (e.signal === "fep_title") {
      return "The plan's title names the " + (e.found === "business name" ? "business" : e.found || "member") + " " + q(e.number || e.name) + (e.text ? ": " + q(e.text) : "");
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
    const chosen = p.decision?.candidate ? candidateOf(p.decision.candidate) : null;
    const note = p.decision?.note || null, by = p.decided_at ? day(p.decided_at) : null;
    let state, text;
    if (p.status === "proposed") { state = "proposed"; text = "Proposed: " + (cands[0]?.label || "no member"); }
    else if (p.status === "ambiguous") { state = "ambiguous"; text = "Pick one of these members, or Not this"; }
    else if (waitingForLoad(p, ctx)) { state = "accepted"; text = "Accepted" + (chosen ? " (" + chosen.label + ")" : "") + ", placed on the next group load"; }
    else if (p.status === "rejected") { state = "rejected"; text = "Not this: it stays set aside"; }
    else { state = "done"; text = p.status === "applied" ? "Placed" : "No longer open"; }
    const evidence = p.evidence && typeof p.evidence === "object" ? p.evidence : {};
    return { id: p.id, kind: p.kind, status: p.status, state, text, item, candidates: cands, proposed: p.status === "proposed" ? cands[0] || null : null, chosen, note,
      decided: by ? "Decided " + by + (note ? " · " + note : "") : null,
      because: evidence.set_aside_because ? (p.kind === "site_succession" ? "Why: " : "Set aside because: ") + evidence.set_aside_because : null,
      replaces: evidence.replaces_stale_match?.member ? "Replaces a match to member " + evidence.replaces_stale_match.member + " the load no longer uses" : null,
      lines: (Array.isArray(evidence.lines) ? evidence.lines : []).filter((l) => typeof l === "string"),
      open: OPEN.includes(p.status), canPick: OPEN.includes(p.status) && cands.length > 1 };
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

  // The Gaps tab: the open, accepted and still-to-be-placed proposals about the group's set-aside items, one line each with its
  // evidence, grouped by proposed member (a row with several close candidates under "More than one member could fit"); then, per
  // gap kind, how many open items have no proposal and what would place them. `gaps` is this group's group_load_gaps entry.
  function gapsTab(rows, { gaps = null, open = null, decidedHere = new Set() } = {}) {
    const ctx = { open, checkedAt: gaps?.checked_at || null };
    const lines = (Array.isArray(rows) ? rows : []).filter((p) => p && DECIDE_KINDS.includes(p.kind))
      .map((p) => line(p, ctx)).filter((l) => l.open || l.state === "accepted" || (l.state === "rejected" && decidedHere.has(l.id)));
    const groups = new Map();
    for (const l of lines) {
      // under the member proposed (or the one accepted); a row just turned down stays where it was proposed
      const who = l.state === "ambiguous" ? null : l.proposed || l.chosen || (l.state === "rejected" && l.candidates.length === 1 ? l.candidates[0] : null);
      const key = l.kind === "document_tier" ? "other" : l.state === "ambiguous" ? "ambiguous" : who?.member != null ? "member:" + who.member : "other";
      if (!groups.has(key)) groups.set(key, { key, member: who?.member ?? null,
        title: key === "ambiguous" ? "More than one member could fit" : key === "other" ? "Other questions" : who.label, lines: [] });
      groups.get(key).lines.push(l);
    }
    const order = (g) => (g.key === "ambiguous" ? -1 : g.key === "other" ? 1e9 : Number(g.member) || 1e8);
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
    const summary = !rows.length ? null : [plural(current.length, "business on the register", "businesses on the register") + (rows.length > current.length ? " (" + num(rows.length - current.length) + " retired)" : ""),
      num(rows.filter((r) => r.active).length) + " linked to a farm in the tool", ...(noExtentCount ? [plural(noExtentCount, "without a map extent", "without a map extent")] : [])].join(" · ");
    return { rows, unlinked, summary, empty: !rows.length,
      emptyText: "No businesses are on the group's register yet. RCL's group load adds them from the group's members layer.",
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
      .sort((a, b) => String(a.name).localeCompare(String(b.name))).map((l) => ({ id: l.id, key: l.key, name: l.name, note: l.note || null, members: l.members.map(memberSite) }));
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
      // ON3a gives people no way to write a proposal (only the tools insert them), so a new question goes to RCL as a note.
      // PM ruling (5 Nov 2026): succession questions go to RCL's seed run; no one can propose one here yet (ON3a lets only the tools
      // insert proposals; ON3c adds a proposals_propose RPC for this)
      propose: "To propose a succession or co-location, tell RCL the site ids, which one carries the record now and the dates each counts for. " +
        "It goes to RCL's reviewed seed run of the monitoring-locations manifest; once loaded, it shows under Monitoring locations." };
  }

  return { DECIDERS, canDecide, canManage, TABS, tabs, tabFor, showsLink, countLine, noEvidence, waitingByGap, itemOf, evidenceText, line, waitingForLoad, decision, replace,
    gapsTab, membersTab, associationText, sitesTab, farmId, email, INVITE_ROLES, MEMBER_KINDS, DECIDE_KINDS, day };
});
