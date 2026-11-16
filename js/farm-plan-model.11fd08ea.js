// FEP1: a farm's Plan page, the pure part. What the farm's plan said, as at the plan's date, read only: its land units with the use
// and the inherent-risk ratings the plan gave each, and the actions it ticked with the plan's own By when and Progress. No DOM, no
// reads, no clock: farm-plan.js reads as the signed-in person and hands the rows here.
//
// What a plan's records are (the owner, 14 Nov 2026): a rating is the plan author's rating of the LAND (Low, Medium, High…), not of
// how it is managed; an action is a line ticked from the plan's list, with a By when that is a PERIOD ("2 Years", never a date) and a
// progress word as at the plan's date. So this page never makes a due date, never says "overdue", never colours a rating as good or
// bad, never ranks, and never shows the app's own status word: only the plan's words, as stored. Nothing here can be ticked or changed.
//
// Who sees it (v1, the owner's rulings): RCL staff, and the coordinators (facilitators, advisors, admins) of a catchment group the
// farm is actively associated with (HV1, 14 Nov 2026). A farm's own people do not, until the owner decides otherwise. That is
// the app's rule (`audience`): the database has always let a farm's own people read these rows.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.FP = root.FP || {}; root.FP.farmPlanModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (v == null ? "" : String(v));

  // ---- who sees the page --------------------------------------------------------------------------------------------------------
  // The roles HV1 calls a group's coordinators (app.coordinated_farm_ids): never a group's editors or plain members.
  const COORDINATOR_ROLES = ["facilitator", "advisor", "admin"];
  // The groups the person coordinates for HV1's purpose, from their own groups (main.js readGroups: id, role, parent_org_id): a group
  // where they hold a coordinator role, and a sub-group of such a group that they can see (HV1: a parent's coordinators read what
  // its sub-groups' farms hold; only a sub-group they are in lets them read its association, so one they are not in fails closed).
  function coordinatedGroupIds(groups) {
    const gs = list(groups).filter((g) => g && g.id);
    const mine = new Set(gs.filter((g) => COORDINATOR_ROLES.includes(g.role)).map((g) => g.id));
    for (const g of gs) if (g.parent_org_id && mine.has(g.parent_org_id)) mine.add(g.id);
    return mine;
  }
  // "staff", "coordinator" or null (no page, no row, nothing read).
  //   staff: the staff flag (profiles.is_staff; unknown or unreadable is not staff)
  //   farmRole: the person's role on this farm (farm_members), or null; any role makes them one of the farm's own people
  //   groups: the person's catchment groups with their role; associations: this farm's associations the person can read
  // A coordinator who is ALSO on the farm (holds a farm role) is treated as the farm's own person: fail closed, the v1 rule wins.
  function audience({ staff = false, farmRole = null, groups = [], associations = [] } = {}) {
    if (staff === true) return "staff";
    if (farmRole) return null;
    const mine = coordinatedGroupIds(groups);
    return list(associations).some((a) => a && a.status === "active" && mine.has(a.org_id)) ? "coordinator" : null;
  }

  // ---- the plan's words ---------------------------------------------------------------------------------------------------------
  // A loader's tag at the start of a stored sentence ("PL2 load: ", "PF1 load: ") is the import's marker, not the plan's words: it is
  // taken off, and nothing else is changed (no case, no spelling, no punctuation).
  const MARKER = /^\s*[A-Z][A-Z0-9]{0,9} load:\s*/;
  const unmark = (t) => str(t).replace(MARKER, "").trim();
  // "what the plan said, as at 2021-05-01: " in front of an activity's words: the page's own heading already says it
  const SAID = /^what the plan said, as at [^:]{1,40}:\s*/i;
  // A sentence and where it was read, when the stored text ends with one bracketed note: "Sheep grazing (FEP Land!C12)" ->
  // { text: "Sheep grazing", source: "FEP Land!C12" }. Both are the stored text's own characters.
  function split(t) {
    const s = str(t).trim(), m = /^([\s\S]*?\S)\s*\(([^()]*)\)\s*$/.exec(s);
    return m ? { text: m[1], source: m[2] } : { text: s, source: null };
  }
  // The plan's PDF page a stored sentence names ("…, PDF page 7)"), or null
  function pdfPage(t) { const m = /\bPDF page (\d{1,4})\b/.exec(str(t)); return m ? Number(m[1]) : null; }
  // The plan's date a stored sentence names ("as at 2021-05-01", "FEP of 2021-05-01"), or null
  function dateIn(t) { const m = /\b(?:as at|FEP of) (\d{4}-\d{2}-\d{2})\b/.exec(str(t)); return m ? m[1] : null; }

  // A land unit's use, as the plan said it (activities.description, else its name)
  function activityWords(a) {
    const t = unmark(a?.description).replace(SAID, "");
    if (t) return split(t);
    const n = str(a?.name).trim();
    return { text: n, source: null };
  }

  // A rating word read from a risk's sentence, as the loads write it: "<topic>, inherent risk <value> on <the land unit's name>, as the
  // plan's author rated it". A label is given only when the WHOLE value between "inherent risk " and " on <this land unit's own
  // name>, as the plan's author rated it" is a word of a rating scale ("Low on flats, High on hill" or "Medium on Low terraces" give
  // none); without the land unit's name, none. The word as the plan wrote it, never recased. The sentence is shown either way.
  const RATING_WORD = /^(?:(?:very |extremely )?(?:low|medium|moderate|high)(?:\s*(?:-|–|to|\/)\s*(?:very )?(?:low|medium|moderate|high))?|nil|negligible|not applicable|n\/a)$/i;
  const AUTHOR = ", as the plan's author rated it";
  function ratingOf(description, unitName) {
    const t = unmark(description), name = str(unitName).trim();
    if (!name) return null;
    const start = t.indexOf("inherent risk "), end = t.indexOf(" on " + name + AUTHOR);
    if (start < 0 || end < start + 14 || t.indexOf("inherent risk ", start + 1) >= 0 || t.indexOf(" on " + name + AUTHOR, end + 1) >= 0) return null;
    const value = t.slice(start + 14, end);
    return value === value.trim() && RATING_WORD.test(value) ? value : null;
  }
  // What a risk is about, as its sentence names it ("Nitrogen leaching, inherent risk …" -> "Nitrogen leaching"). 421 of the 845
  // ratings in the live app sit on the catch-all route "other" (erosion, soil compaction, mahinga kai): they are named by their own
  // words, never "other". A sentence that names nothing falls back on the route and what it carries, in plain words.
  const PATHWAYS = { leaching: "Leaching", runoff: "Runoff", critical_source_area: "Critical source area", drain: "Drains", direct: "Direct to water" };
  function riskName(r) {
    const m = /^(.{2,60}?),\s*inherent risk\b/.exec(unmark(r?.description));
    if (m) return m[1].trim();
    const route = PATHWAYS[r?.pathway] || null, what = list(r?.contaminants).filter(Boolean).join(", ");
    if (route) return what ? route + " (" + what + ")" : route;
    return what ? "Risk to water (" + what + ")" : "A risk the record does not name";
  }
  // The order a land unit's ratings are listed in: the plan's own order of topics, then any other by name
  const RISK_ORDER = ["nitrogen leaching", "phosphorus leaching", "runoff", "erosion", "soil compaction", "mahinga kai"];
  const rank = (name) => { const i = RISK_ORDER.indexOf(str(name).toLowerCase()); return i < 0 ? RISK_ORDER.length : i; };
  function risk(r, unitName) {
    const words = split(unmark(r?.description));
    return { id: r?.id, name: riskName(r), rating: ratingOf(r?.description, unitName), sentence: words.text, source: words.source, page: pdfPage(r?.description) };
  }

  // An action's By when and Progress as the plan wrote them, read only from the plan's own part of the stored sentence, in the exact
  // shapes the loads write (never from the plan's comment, the loader's status sentence or anything else; a period stays a period):
  //  - PL2 (and the plan import): "… What the plan said, as at <date>: By when <value> (<sheet>!<cell>); Progress <value> (<sheet>!<cell>).
  //    Comment: … Status '…': …". The plan's part ends at the first ". Comment: " or ". Status '"; each value runs up to its own cell
  //    reference, so "Dec. 2025" or "2 years (about)" are kept whole. "no By when and no Progress given" reads as neither.
  //  - PF1 (the pilot load, as corrected by PF1b): below.
  // Anything that does not fit its shape exactly gives no value, never a guess: the page then says "see the plan", and says the plan
  // gave none only when the load itself says so.
  const CELL = String.raw` \(([^()]*![A-Za-z]{1,3}\$?\d{1,7})\)`;
  const PL2_SAID = /(?:What the plan said, as at [^:]{1,40}|As written in the plan(?:, [^:]{1,40})?): /;
  // (a value may run over lines in its cell, as the reader keeps them: read as part of the value, shown with each break as a space,
  // as long as the value still ends at its own cell reference)
  const PL2_WORDS = new RegExp(String.raw`^(?:By when ([\s\S]+?)` + CELL + String.raw`)?(?:(?:^|; )Progress ([\s\S]+?)` + CELL + ")?$");
  // PF1 (the pilot load): its own "comment: …; by when: …; progress: …" came from rows the reader had misplaced (PF1-ACTIONS-NOTE), so it
  // is never read. The plan's words are in the correction PF1b appended on a new line (load_pf1b.py), each up to its own cell and page:
  // "PF1b correction: By when (as written in the plan, <date>): <value> [Sum of Act!Q<row>, PDF page <n>]; Progress (as written in the
  // plan, <date>): <value> [Sum of Act!R<row>, PDF page <n>]. status '<status>' set by …", or "By when and Progress: blank in the plan
  // […]" (the plan gave neither), or "By when and Progress: not read (…)".
  const PF1B_AT = "\nPF1b correction: ";
  const PF1B_REF = (col) => String.raw` \[Sum of Act!` + col + String.raw`\d{1,6}, PDF page [^\[\]]*\]`;
  const PF1B_WORDS = new RegExp(String.raw`^(?:By when \(as written in the plan, [^()]{1,40}\): ([\s\S]+?)` + PF1B_REF("Q") + String.raw`)?(?:(?:^|; )Progress \(as written in the plan, [^()]{1,40}\): ([\s\S]+?)` + PF1B_REF("R") + ")?$");
  const NONE_GIVEN = /^no By when and no Progress given\b/;
  // { byWhen, progress, said }: said is "read" (the plan's words were read; either may be null when the plan gave only one), "none"
  // (the load itself says the plan gave neither: PL2's "no By when and no Progress given", or a PF1 sentence with neither key) or
  // "unread" (the words could not be read with certainty: the page then points to the plan, never claims there were none)
  function planWords(t) {
    const unread = { byWhen: null, progress: null, said: "unread" }, none = { byWhen: null, progress: null, said: "none" };
    const clean = (v) => { if (v == null) return null; const x = v.replace(/[ \t]*(?:\r\n|\r|\n)[ \t]*/g, " "); return x.trim() && x === x.trim() ? x : null; };
    const at = PL2_SAID.exec(t);
    if (at) {
      let said = t.slice(at.index + at[0].length);
      const ends = [". Comment: ", ". Status '"].map((x) => said.indexOf(x)).filter((i) => i >= 0);
      said = ends.length ? said.slice(0, Math.min(...ends)) : said.replace(/\.$/, "");
      if (NONE_GIVEN.test(said)) return none;
      const m = said ? PL2_WORDS.exec(said) : null;
      const out = m ? { byWhen: clean(m[1]), progress: clean(m[3]), said: "read" } : null;
      return out && (out.byWhen || out.progress) ? out : unread;
    }
    const at1b = t.indexOf(PF1B_AT);
    if (at1b >= 0 && t.indexOf(PF1B_AT, at1b + 1) < 0) {
      let block = t.slice(at1b + PF1B_AT.length);
      const end = block.lastIndexOf(". status '");
      if (end < 0) return unread;
      block = block.slice(0, end);
      if (/^By when and Progress: blank in the plan \[Sum of Act!Q\d{1,6}:R\d{1,6}, PDF page [^\[\]]*\]$/.test(block)) return none;
      const m = PF1B_WORDS.exec(block);
      const out = m && block ? { byWhen: clean(m[1]), progress: clean(m[2]), said: "read" } : null;
      return out && (out.byWhen || out.progress) ? out : unread;
    }
    return unread;
  }
  // The topic the plan filed the action under ("PL2 load: Nutrient management, an additional action ticked in the FEP …")
  const AREA = /^(.{2,80}?), (?:an additional action ticked in the FEP|selected in the FEP of)\b/;
  function action(a) {
    const t = unmark(a?.description), words = planWords(t);
    const area = AREA.exec(t)?.[1]?.trim() || null;
    return { id: a?.id, title: str(a?.title).trim(), area, byWhen: words.byWhen, progress: words.progress, said: words.said,
      comment: str(a?.rationale).trim() || null, page: Number.isInteger(a?.source_page) && a.source_page > 0 ? a.source_page : null,
      documentId: a?.source_document_id || null };
  }

  // ---- the page -----------------------------------------------------------------------------------------------------------------
  // How many rows of each kind are read for one farm (one request each, at most this many; the page says when a farm has more). The
  // largest farm in the live app has about 60 ratings; these leave room and stay under the API's 1,000 a request.
  const CAPS = { landUnits: 200, activities: 400, risks: 900, actions: 400, actionPlaces: 900, actionRisks: 900, files: 20 };
  const PLAN_TYPES = ["fep", "fwfp", "farm_environment_plan", "freshwater_farm_plan"];
  const kindOf = (d) => str(d?.doc_type).toLowerCase().trim().replace(/[\s-]+/g, "_");
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}/.test(str(d)) && Number.isFinite(Date.parse(str(d).slice(0, 10)));
  const day = (d) => (isDay(d) ? new Date(str(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null);
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const byCode = (a, b) => str(a.code || a.name).localeCompare(str(b.code || b.name), "en", { numeric: true }) || str(a.name).localeCompare(str(b.name));

  // The plan file the records were read from: the file most of the actions name, else the farm's newest plan file that is not
  // superseded. Only files of a plan type are considered.
  function planFile(files, actions) {
    const plans = list(files).filter((d) => d && PLAN_TYPES.includes(kindOf(d)));
    const named = new Map();
    for (const a of list(actions)) if (a?.source_document_id) named.set(a.source_document_id, (named.get(a.source_document_id) || 0) + 1);
    const most = [...named].sort((x, y) => y[1] - x[1]).map(([id]) => plans.find((d) => d.id === id)).find(Boolean);
    if (most) return most;
    return plans.filter((d) => d.status !== "superseded").sort((x, y) => str(y.date_prepared).localeCompare(str(x.date_prepared)))[0] || null;
  }
  const fileName = (d) => str(d?.title).trim() || str(d?.original_name).trim() || "The plan file";

  // rows: { landUnits (land_units view: id, code, name, description, area_ha), activities, risks, actions, actionPlaces, actionRisks,
  // files (the farm's plan files) }, each as read. Returns what the page draws.
  function build(rows = {}) {
    const R = rows || {};
    const units = list(R.landUnits).filter((u) => u && u.id).slice().sort(byCode);
    const unitOf = new Map(units.map((u) => [u.id, u]));
    const acts = list(R.activities).filter(Boolean), risks = list(R.risks).filter(Boolean), actions = list(R.actions).filter(Boolean);
    // each land unit: its use(s), its ratings (in the plan's order of topics), the PDF page it is printed on
    const landUnits = units.map((u) => {
      const own = risks.filter((r) => r.place_id === u.id).map((r) => risk(r, u.name)).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
      const uses = acts.filter((a) => a.place_id === u.id).map(activityWords).filter((w) => w.text);
      const area = Number(u.area_ha);
      return { id: u.id, code: str(u.code).replace(/^LMU-/, "").trim() || null, name: str(u.name).trim() || "Land unit", uses, risks: own,
        area: Number.isFinite(area) && area > 0 ? area : null, page: pdfPage(u.description) || own.map((r) => r.page).find(Boolean) || null };
    });
    // ratings on no land unit the person can read (on the whole farm, or a land unit not shown)
    const loose = risks.filter((r) => !r.place_id || !unitOf.has(r.place_id)).map((r) => risk(r, null)).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
    // the land units each action is tied to (its own place, and its action_places), by name
    const placesOf = new Map();
    const tie = (a, p) => { if (!unitOf.has(p)) return; const s = placesOf.get(a) || new Set(); s.add(p); placesOf.set(a, s); };
    for (const a of actions) if (a.place_id) tie(a.id, a.place_id);
    for (const l of list(R.actionPlaces)) if (l) tie(l.action_id, l.place_id);
    const riskById = new Map(risks.map((r) => [r.id, r]));
    const shaped = actions.map((a) => {
      const x = action(a);
      x.landUnits = [...(placesOf.get(a.id) || [])].map((p) => unitOf.get(p)).sort(byCode).map((u) => ({ id: u.id, name: str(u.name).trim() || "Land unit" }));
      x.risks = list(R.actionRisks).filter((l) => l && l.action_id === a.id && riskById.has(l.risk_id)).map((l) => {
        const r = riskById.get(l.risk_id), u = unitOf.get(r.place_id);
        return riskName(r) + (u ? " on " + (str(u.name).trim() || "Land unit") : "");
      });
      return x;
    }).sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || a.title.localeCompare(b.title));
    // grouped by the topic the plan filed them under, in the order they first appear; one group when no topic was read
    const groups = [];
    for (const x of shaped) {
      const key = x.area || "";
      let g = groups.find((y) => y.key === key);
      if (!g) groups.push((g = { key, title: x.area, items: [] }));
      g.items.push(x);
    }
    groups.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1));
    const file = planFile(R.files, actions);
    const when = (file && isDay(file.date_prepared) && str(file.date_prepared).slice(0, 10))
      || mostCommon([...risks, ...acts, ...actions].map((r) => dateIn(r.description)).filter(Boolean));
    const capped = Object.fromEntries(Object.entries(R.capped || {}).filter(([, v]) => v));
    return {
      file: file ? { id: file.id, name: fileName(file), path: file.storage_path || null } : null,
      date: when || null, dateText: day(when),
      landUnits, loose, actions: groups, counts: { landUnits: landUnits.length, risks: risks.length, actions: actions.length },
      empty: !risks.length && !actions.length && !acts.length,
      capped,
    };
  }
  function mostCommon(xs) { const n = new Map(); for (const x of xs) n.set(x, (n.get(x) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null; }

  // ---- the words ------------------------------------------------------------------------------------------------------------------
  const heading = (dateText) => (dateText ? "What the plan said, as at " + dateText : "What the plan said (the plan's date is not recorded)");
  const countLine = (c) => [c.landUnits ? plural(c.landUnits, "land unit", "land units") : null, c.risks ? plural(c.risks, "risk rating", "risk ratings") : null,
    c.actions ? plural(c.actions, "action", "actions") : null].filter(Boolean);
  const areaText = (ha) => (Number.isFinite(ha) && ha > 0 ? Number(ha).toLocaleString("en-NZ", { maximumFractionDigits: 1 }) + " ha as mapped" : null);
  const progressLabel = "Progress at the plan date";
  const WORDS = {
    rowLabel: "Plan", rowLine: "What the farm's plan said · read only",
    loading: "Reading the plan…",
    failed: "This page couldn't be read just now. Try again in a moment.",
    notYours: "This page isn't open to you.",
    none: "No plan has been read into the app for this farm. Its plan file, if there is one, is in Files.",
    landUnitsTitle: "Land units", landUnitsNote: "Each land unit's use and the plan author's rating of its inherent risk: a rating of the land, not of how it is farmed.",
    actionsTitle: "Actions in the plan", actionsNote: "The actions the plan ticked, in its own words. By when and Progress are as the plan wrote them on its date; nothing here has been updated since.",
    looseTitle: "Ratings not tied to a land unit",
    noRatings: "No ratings for this land unit were read from the plan.",
    noWords: "The plan gives no By when or Progress for this action.",
    seePlan: "By when and Progress: see the plan",
    foot: [
      "Where this comes from: the plan's own workbook and PDF, as the group digitised them and they were read into the app.",
      "What is not here: the plan's objectives, targets and practice descriptions, and any audit of the plan.",
      "The PDF is the plan. Where this page and the PDF differ, the PDF is right.",
    ],
  };
  const cappedLine = (capped) => {
    const k = Object.keys(capped || {});
    return k.length ? "This farm has more plan records than this page reads at once (" + k.map((x) => ({ landUnits: "land units", activities: "land-unit uses", risks: "risk ratings", actions: "actions", actionPlaces: "action places", actionRisks: "action links", files: "plan files" })[x] || x).join(", ") + "): the first ones are shown. The PDF has them all." : null;
  };

  return { COORDINATOR_ROLES, coordinatedGroupIds, audience, unmark, split, pdfPage, dateIn, activityWords, ratingOf, riskName, risk, action, planWords, RISK_ORDER,
    CAPS, PLAN_TYPES, planFile, fileName, build, heading, countLine, areaText, progressLabel, WORDS, cappedLine, day };
});
