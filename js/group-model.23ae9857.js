// The catchment group space's pure parts (S5, docs/CATCHMENT-SPACE.md): routes, the member level and its wording,
// the member figures with small-number suppression as the database returns them, attribution of shared records at the
// level both the group and the farm allow, and the group's standing answers (what's due, what's changed). No DOM, no
// reads: group-space.js reads as the signed-in person and hands the rows here.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.groupModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  // ON3b: `/manage[/members|gaps|updates|sites|settings]` is the group's manage space (group-manage.js); the member-detail form moved
  // there, so the old `/settings` address opens the manage space's Settings tab.
  const ROUTE = /^#\/group\/([0-9a-f-]{36})(?:\/(maps|documents|events|people|create|settings|manage)(?:\/(members|gaps|updates|sites|settings|log|follow-ups|add-person|add-contact|review))?)?(?:\?item=([0-9a-f-]{36}))?$/;
  // N4: `/events` is the group's Events view (events.js). PE1: `/people[/log|follow-ups|add-person]` is the group's People view (RV1, PF1: and `/people/review`, its To review list)
  // (people.js; shown only to its facilitators, advisors and admins), the tab opening a form or the follow-ups straight away.
  const views = [["map", "Overview"], ["maps", "Maps"], ["documents", "Files"], ["events", "Events"], ["people", "People"], ["create", "Create"], ["manage", "Manage"]];
  const TABS = { manage: ["members", "gaps", "updates", "sites", "settings"], people: ["log", "follow-ups", "add-person", "add-contact", "review"] };
  function match(hash) {
    const m = String(hash || "").match(ROUTE);
    if (!m || (m[3] && !TABS[m[2]]?.includes(m[3])) || (m[4] && m[2] !== "maps")) return null;
    if (m[2] === "people") return { group: m[1], view: "people", tab: m[3] || null };
    if (m[2] === "maps") return { group: m[1], view: "maps", item: m[4] || null };   // V4: a published map, or the group's list
    if (m[2] === "settings") return { group: m[1], view: "manage", tab: "settings" };
    return m[2] === "manage" ? { group: m[1], view: "manage", tab: m[3] || null } : { group: m[1], view: m[2] || "map" };
  }
  const href = (id, view = "map", tab = null) => "#/group/" + id + (view && view !== "map" ? "/" + view : "") + ((view === "manage" || view === "people") && tab ? "/" + tab : "") + (view === "maps" && tab ? "?item=" + encodeURIComponent(tab) : "");
  const viewLabel = (key) => views.find(([k]) => k === key)?.[1] || null;

  // ---- levels -------------------------------------------------------------------------------------------------------------
  const LEVELS = ["aggregated", "anonymous", "named"];
  const K = 3;
  const LEVEL_TEXT = {
    aggregated: "Aggregated — totals only; no member farm is named or outlined",
    anonymous: "Anonymous — member farm outlines without names",
    named: "Named — member farm names and outlines",
  };
  // The level a farm is shown at: the lower of the group's setting and the farm's own share; none without either.
  function level(groupSetting, farmShare, active = true) {
    if (!active || !farmShare || !LEVELS.includes(farmShare)) return "none";
    const g = LEVELS.indexOf(LEVELS.includes(groupSetting) ? groupSetting : "aggregated");
    return LEVELS[Math.min(g, LEVELS.indexOf(farmShare))];
  }
  const canManage = (role) => role === "admin";
  const canWrite = (role) => ["editor", "facilitator", "advisor", "admin"].includes(role);

  // ---- member figures -----------------------------------------------------------------------------------------------------
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const hidden = (s, key) => Array.isArray(s?.suppressed) && s.suppressed.includes(key);
  const SUPPRESSED = "fewer than " + K + " farms, so not shown";
  // The Members card: what the group may say about member farms, every figure as the database returned it (null = held
  // back for small numbers), the setting it is shown at, and that the group's own layers are its own map.
  function memberLines(summary, { hasOwnLayers = false } = {}) {
    const s = summary || {}, lines = [];
    const linked = Number(s.linked_farms) || 0;
    if (!linked) lines.push("No member farms are linked in the tool yet. The space shows the group's own records and maps and the shared layers.");
    else lines.push(plural(linked, "member farm is", "member farms are") + " linked in the tool.");
    lines.push("Shown " + (LEVEL_TEXT[s.member_detail] || LEVEL_TEXT.aggregated).replace(/^\w+/, (w) => w.toLowerCase()) +
      ". A farm is shown in more detail only where its owner allows it too.");
    if (linked) {
      lines.push("Farms in group totals: " + (hidden(s, "farms_in_totals") ? SUPPRESSED : String(s.farms_in_totals ?? 0)) + ".");
      lines.push("Mapped area of those farms: " + (hidden(s, "mapped_area_ha") ? SUPPRESSED : s.mapped_area_ha == null ? "not mapped" : "about " + Number(s.mapped_area_ha).toLocaleString("en-NZ") + " ha") + ".");
    }
    if (hasOwnLayers) lines.push("Layers marked “the group's own map” are the group's records (such as its member blocks layer) and are shown whatever this setting is.");
    return lines;
  }
  const contributing = (s) => hidden(s, "farms_contributing") ? "Member farms contributing: " + SUPPRESSED + "."
    : s?.farms_contributing == null ? null : "Member farms contributing: " + s.farms_contributing + ".";

  // ---- attribution ---------------------------------------------------------------------------------------------------------
  // A shared record's farm, as far as the level lets the group know it: the database returns farm_id only at anonymous or
  // named, and a name only at named (group_member_farms).
  function attribution(row, members) {
    if (!row?.farm_id) return "a member farm";
    const m = (members || []).find((x) => x.farm_ref === row.farm_id);
    return m?.name || "a member farm (not named)";
  }

  // ---- dates ----------------------------------------------------------------------------------------------------------------
  const TZ = "Pacific/Auckland";
  const isoDay = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
  const shortDate = (t) => t ? new Date(t).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : "date not recorded";
  // The UTC instant of NZ midnight starting y-m-d.
  function nzMidnight(y, m, d) {
    const wall = (t) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(t)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    };
    const t0 = Date.UTC(y, m - 1, d);
    let t = t0 - (wall(t0) - t0);
    t = t0 - (wall(t) - t);
    return new Date(t);
  }
  // A calendar month in NZ time: [from, to) as instants, with its label and its first and last day.
  function monthPeriod(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    const next = m === 12 ? [y + 1, 1] : [y, m + 1];
    const last = new Date(Date.UTC(next[0], next[1] - 1, 0)).getUTCDate();
    return { key: `${y}-${String(m).padStart(2, "0")}`, from: nzMidnight(y, m, 1).toISOString(), to: nzMidnight(next[0], next[1], 1).toISOString(),
      start: `${y}-${String(m).padStart(2, "0")}-01`, end: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
      label: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  // The last complete month before today (NZ), as "YYYY-MM".
  function lastMonth(today) {
    const [y, m] = String(today).slice(0, 10).split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  }
  const within = (t, p) => !!t && Date.parse(t) >= Date.parse(p.from) && Date.parse(t) < Date.parse(p.to);

  // ---- standing answers -----------------------------------------------------------------------------------------------------
  // What's due for the group's own obligations: dated ones first (overdue flagged), then ongoing practice.
  function due(obligations, today) {
    const rows = (obligations || []).map((o) => ({ id: o.id, text: o.summary || o.code || "Obligation", due: o.due_date || null,
      recurrence: o.recurrence || null, overdue: !!o.due_date && o.due_date < String(today).slice(0, 10) }));
    rows.sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || String(a.due || "").localeCompare(String(b.due || "")) || a.text.localeCompare(b.text));
    return rows.map((r) => ({ ...r, when: r.due ? (r.overdue ? "Overdue since " : "Due ") + shortDate(r.due + "T12:00:00Z") : r.recurrence || "Ongoing" }));
  }
  const firstSentence = (text, max = 160) => {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    const s = (t.match(/^.*?[.!?](?=\s|$)/) || [t])[0];
    return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
  };
  // What's changed since `since`: the group's own records and documents, and what member farms shared with the group,
  // newest first; each says whose it is (at the level allowed) and where it came from.
  function changed({ ownEntries = [], ownDocuments = [], sharedEntries = [], sharedDocuments = [], members = [], typeLabel = (k) => k, since }) {
    const after = (t) => !since || (t && Date.parse(t) >= Date.parse(since));
    const lines = [
      ...ownEntries.filter((e) => e.visibility !== "private" && after(e.captured_at)).map((e) => ({ id: "entry:" + e.id, at: e.captured_at,
        text: typeLabel(e.record_type) + ": " + (firstSentence(e.body) || "no text"), who: "The group" })),
      ...ownDocuments.filter((d) => d.visibility !== "private" && after(d.created_at)).map((d) => ({ id: "document:" + d.id, at: d.created_at, text: "File added: " + (d.title || "Untitled"), who: "The group" })),
      ...sharedEntries.filter((e) => after(e.captured_at)).map((e) => ({ id: "shared_entry:" + e.id, at: e.captured_at,
        text: typeLabel(e.record_type) + ": " + (firstSentence(e.body) || "no text"), who: cap(attribution(e, members)) + ", shared with the group" })),
      ...sharedDocuments.filter((d) => after(d.created_at)).map((d) => ({ id: "shared_document:" + d.id, at: d.created_at, text: "File shared: " + (d.title || "Untitled"),
        who: cap(attribution(d, members)) + ", shared with the group" })),
    ];
    return lines.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id)).map((l) => ({ ...l, date: shortDate(l.at) }));
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---- onboarding readiness (ON2) -----------------------------------------------------------------------------------------
  // public.group_readiness(g) as the database returns it for a group admin: ON1's findings per member farm, counted by
  // readiness state and by finding type (null = held back for small numbers), and per-farm rows only where the farm's
  // level lets the group see it (a name at named, a label made from the opaque ref at anonymous). Wording only here.
  const READINESS = [["missing", "Something missing"], ["to_check", "To check"], ["to_confirm", "To confirm"], ["ready", "Nothing open"]];
  // ON1's finding rules (app/js/onboarding-model.js RULES; the database's app.onboarding_finding_states), in plain words.
  const FINDINGS = {
    "holding.none": "Land not identified yet (no parcels chosen)",
    "parcel.not_current": "A held parcel is no longer a current LINZ parcel",
    "area.mismatch": "A file's stated area differs from the land held",
    "consent.not_in_ecan": "A consent number isn't in ECan's data",
    "consent.status_differs": "The consent register and ECan's data differ",
    "consent.not_recorded": "An ECan consent on the farm isn't in its register",
    "consent.no_conditions": "A consent's conditions aren't recorded",
    "consent.no_decision": "No consent decision on file",
    "document.duplicate": "Possible duplicate files",
    "document.tier_unconfirmed": "A file's kind isn't confirmed",
    "document.held": "No files yet",
    "fep.missing": "No Farm Environment Plan or Freshwater Farm Plan on file",
    "fep.not_read": "A plan not read in yet",
    "fep.confirm_report": "A plan's confirm report waiting",
  };
  const farmsText = (n) => n == null ? SUPPRESSED : plural(Number(n), "farm", "farms");
  // RDY1: the database counts each farm's stored outcome (public.farm_onboarding_summary), worked out when a farm editor opens the
  // farm's Onboarding view or at the group's load; a farm with none current is "not yet assessed". Read tolerantly: an answer
  // without these keys (a database before RDY1) shows as it did.
  const NOT_ASSESSED = "Not yet assessed";
  const dateRule = (days) => "A farm is counted once its checks have been worked out in the last " + days + " days under the rules now in force: "
    + "when a farm editor opens its Onboarding view, or at the group's load. Until then it is not yet assessed.";
  function readiness(r) {
    if (!r || typeof r !== "object") return null;
    // CAP2: over the database's cap on farms in group totals (truncated, 500) no farm is checked and no figure is given
    const assessed = r.farms_assessed, linked = Number(r.linked_farms) || 0, truncated = r.truncated === true;
    const days = Number(r.assessed_within_days) || null, hasPending = Object.prototype.hasOwnProperty.call(r, "not_assessed");
    const pending = hasPending && !truncated && linked ? { farms: r.not_assessed ?? null, text: NOT_ASSESSED + ": " + farmsText(r.not_assessed) } : null;
    const byState = new Map((Array.isArray(r.by_state) ? r.by_state : []).map((s) => [s.state, s.farms]));
    const summary = !linked ? "No member farms are linked in the tool yet."
      : truncated ? "Too many member farms to check here: " + plural(linked, "linked farm", "linked farms") + ". The checks run for groups of up to "
        + (Number(r.max_farms) || 500) + " farms in group totals."
      : "Farms in group totals checked: " + (assessed == null ? SUPPRESSED : String(assessed)) + " of " + plural(linked, "linked farm", "linked farms") + ".";
    const states = READINESS.map(([key, label]) => ({ key, label, farms: byState.get(key) ?? null, text: label + ": " + farmsText(byState.get(key)) }));
    const findings = (Array.isArray(r.by_finding) ? r.by_finding : []).filter((f) => f.farms == null || Number(f.farms) > 0)
      .map((f) => ({ rule: f.rule, state: f.state, held: f.farms == null, text: (FINDINGS[f.rule] || f.rule) + ": " + farmsText(f.farms) }));
    const rows = (Array.isArray(r.farms) ? r.farms : []).map((f) => ({
      ref: f.ref, level: f.level, label: f.level === "named" && f.name ? f.name : f.label || "A member farm (not named)",
      readiness: f.readiness === "not_assessed" ? NOT_ASSESSED : (READINESS.find(([k]) => k === f.readiness) || [null, f.readiness])[1],
      findings: Object.entries(f.findings || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => (FINDINGS[k] || k) + (Number(n) > 1 ? " (" + n + ")" : "")),
      ...(f.readiness === "not_assessed" ? { notAssessed: true } : {}), ...(f.assessed_on ? { assessedOn: shortDate(f.assessed_on) } : {}) }));
    return { summary, states, statesHeld: states.every((s) => s.farms == null), findings, rows, truncated,
      empty: assessed === 0 || !linked || truncated, pending, dateRule: days && !truncated ? dateRule(days) : null };
  }

  // ---- the group's area (WQ4) --------------------------------------------------------------------------------------------
  // The group's area is its current `places` row of kind area. tools/load_group.py makes it as the member blocks plus 1 km (method
  // member_blocks_buffer_1km) when the group has none; the group replaces it with an agreed boundary (method agreed_boundary).
  // ON2's card shows it as a readiness line: a group with no area is a finding with its action, because the group's water-quality
  // methods apply to that area. `rows` are the rows the caller read, or null when they could not be read (then nothing is claimed).
  const AREA_NOTES = {
    member_blocks_buffer_1km: "Working boundary: the member blocks plus 1 km, made when the group was set up. Replace it with the boundary the group agrees.",
    agreed_boundary: "Agreed boundary.",
  };
  function groupArea(rows) {
    if (!Array.isArray(rows)) return null;
    const current = rows.filter((r) => r && !r.valid_to).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));
    if (!current.length) return { state: "missing", text: "Group area: missing. The group has no area.",
      detail: "The group's water-quality methods apply to its area, so none can be published for it, and the group's monitoring sites are not found, until it has one.",
      action: "RCL's group load makes the area from the member blocks plus 1 km as a working boundary that the group can replace with an agreed one." };
    const a = current[0];
    return { state: a.method === "member_blocks_buffer_1km" ? "working" : "set", code: a.code || null, name: a.name || a.code, method: a.method || null,
      text: "Group area: " + (a.name || a.code) + (current.length > 1 ? " (and " + (current.length - 1) + " more)" : ""),
      detail: AREA_NOTES[a.method] || (a.description ? String(a.description) : "Area recorded."), action: null };
  }

  // V8: a group's own logo in its header, keyed by the organisation's slug. To add a group: one line here, its file in brand/, and
  // that file in sw.js's list. A group not listed (and any farm) has none.
  const GROUP_LOGOS = new Map([
    ["mccc", { src: "brand/mccc-logo.e9d6f07b.png", alt: "Mid Canterbury Catchment Collective" }],
  ]);
  const groupLogo = (group) => GROUP_LOGOS.get(group?.slug) || null;

  return { match, href, views, viewLabel, LEVELS, LEVEL_TEXT, K, level, canManage, canWrite, memberLines, contributing, attribution,
    nzMidnight, monthPeriod, lastMonth, within, isoDay, shortDate, due, changed, firstSentence, SUPPRESSED, READINESS, NOT_ASSESSED, FINDINGS, readiness, groupArea, GROUP_LOGOS, groupLogo };
});
