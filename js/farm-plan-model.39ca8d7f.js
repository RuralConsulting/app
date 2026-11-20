// FEP1: a farm's Plan page, the pure part. What the farm's plan said, as at the plan's date, read only: its land units with the use
// and the inherent-risk ratings the plan gave each, and the actions it ticked with the plan's own By when and Progress. No DOM, no
// reads, no clock: farm-plan.js reads as the signed-in person and hands the rows here.
//
// What a plan's records are (the owner, 14 Nov 2026): a rating is the plan author's rating of the LAND (Low, Medium, High…), not of
// how it is managed; an action is a line ticked from the plan's list, with a By when that is a PERIOD ("2 Years", never a date) and a
// progress word as at the plan's date. So this page never makes a due date, never says "overdue", never colours a rating as good or
// bad, never ranks, and never shows the app's own status word: only the plan's words, as stored. Nothing here can be ticked or changed.
//
// Who sees it: RCL staff, the coordinators (facilitators, advisors, admins) of a catchment group the farm is actively associated with
// (HV1, 14 Nov 2026), and (FEP2, the owner, 19 Nov 2026, reversing the version 1 rule) the farm's own people. Nobody else. That is the
// app's rule (`audience`); the database has always let a farm's own people read these rows (app.can_view), so no policy changed.
//
// FEP2 (the owner, 19 Nov 2026): actions first, grouped by topic with a sort by land unit or timeframe (`arrange`), each one row with
// a small mark for the plan's progress word (`progressMark`); the ratings in one small table, land units down and the six risks across,
// one dot per cell, green / orange / red for the plan author's Low / Medium / High (`table`, `levelOf`): a cell that can't be read
// without doubt is not coloured, and says "see the plan".
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
  // "staff", "farm", "coordinator" or null (no page, no row, nothing read).
  //   staff: the staff flag (profiles.is_staff; unknown or unreadable is not staff)
  //   farmRole: the person's role on this farm (farm_members), or null; any role makes them one of the farm's own people (FEP2: they
  //   see their own farm's Plan)
  //   groups: the person's catchment groups with their role; associations: this farm's associations the person can read
  function audience({ staff = false, farmRole = null, groups = [], associations = [] } = {}) {
    if (staff === true) return "staff";
    if (farmRole) return "farm";
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
      return { id: u.id, code: str(u.code).replace(/^LMU-/, "").trim() || null, rawCode: str(u.code).trim() || null, name: str(u.name).trim() || "Land unit", uses, risks: own,
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
      x.landUnits = [...(placesOf.get(a.id) || [])].map((p) => unitOf.get(p)).sort(byCode).map((u) => ({ id: u.id, name: str(u.name).trim() || "Land unit", code: str(u.code).replace(/^LMU-/, "").trim() || null }));
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
      landUnits, loose, actions: groups, items: shaped, counts: { landUnits: landUnits.length, risks: risks.length, actions: actions.length },
      empty: !risks.length && !actions.length && !acts.length,
      capped,
    };
  }
  function mostCommon(xs) { const n = new Map(); for (const x of xs) n.set(x, (n.get(x) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null; }

  // ---- FEP2: the ratings as one small table -----------------------------------------------------------------------------------------
  // A rating word's dot: "low", "medium" or "high" only when the WHOLE word is one of those three (Moderate is the same step as Medium
  // on the plans' three-step scale). Anything else ("Very High", "Medium-High", "Nil", a range) gets no colour: never a guess.
  function levelOf(word) {
    const w = str(word).trim();
    if (/^low$/i.test(w)) return "low";
    if (/^(?:medium|moderate)$/i.test(w)) return "medium";
    if (/^high$/i.test(w)) return "high";
    return null;
  }
  const LEVEL_WORDS = { low: "Low", medium: "Medium", high: "High" };
  // The six risks the plans rate, in the plan's order, with the short heading the table uses (the plan's own name stays the button's
  // full name); a risk of any other name gets a column of its own after these, headed by its own words.
  const RISK_HEADS = { "nitrogen leaching": "Nitrogen", "phosphorus leaching": "Phosphorus", runoff: "Runoff", erosion: "Erosion", "soil compaction": "Compaction", "mahinga kai": "Mahinga kai" };
  // One cell from the ratings a land unit has under one risk: { state: "rated", level, word } (level null: a word with no dot, shown as
  // its word), "unread" (not read with certainty, or two ratings that disagree: "see the plan"), or "none" (no rating read for it).
  function cellOf(list_) {
    if (!list_.length) return { state: "none", level: null, word: null };
    const words = [...new Set(list_.map((r) => r.rating))];
    if (words.length !== 1 || words[0] == null) return { state: "unread", level: null, word: null };
    return { state: "rated", level: levelOf(words[0]), word: words[0] };
  }
  // m: build()'s model. { columns: [{ key, name (the plan's own), head (short) }], rows: [{ id, code, name, uses, area, rated, cells }] }
  function table(m) {
    const all = [...list(m?.landUnits).flatMap((u) => u.risks), ...list(m?.loose)];
    const names = [...new Map(all.map((r) => [r.name.toLowerCase(), r.name])).values()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const columns = names.map((name) => ({ key: name.toLowerCase(), name, head: RISK_HEADS[name.toLowerCase()] || name }));
    const row = (u) => ({ id: u.id, code: u.code || null, name: u.name, uses: u.uses || [], area: u.area ?? null, rated: u.risks.length > 0,
      cells: columns.map((c) => cellOf(u.risks.filter((r) => r.name.toLowerCase() === c.key))) });
    const rows = list(m?.landUnits).map(row);
    if (list(m?.loose).length) rows.push(row({ id: null, code: null, name: WORDS.looseTitle, uses: [], area: null, risks: m.loose }));
    return { columns, rows };
  }
  // The land unit each risk's dots colour on the map, for one chosen column: { <land unit id>: "low" | "medium" | "high" | null }
  function shading(t, key) {
    const i = list(t?.columns).findIndex((c) => c.key === key), out = {};
    if (i < 0) return out;
    for (const r of list(t.rows)) if (r.id) out[r.id] = r.cells[i]?.state === "rated" ? r.cells[i].level : null;
    return out;
  }

  // ---- FEP2: the actions, one row each, sorted three ways -------------------------------------------------------------------------
  // The plan's progress word as a small mark: an empty circle for Not started, half for Underway, full for Finished; none for any other
  // word or none (the word itself is shown when the row is opened).
  function progressMark(word) {
    const w = str(word).trim();
    if (/^not started$/i.test(w)) return "empty";
    if (/^(?:underway|under way|in progress|started|ongoing)$/i.test(w)) return "half";
    if (/^(?:finished|complete|completed|done)$/i.test(w)) return "full";
    return null;
  }
  const MARK_WORDS = { empty: "Not started", half: "Underway", full: "Finished" };
  // A By when as a length, for sorting only (the page shows the plan's words): "2 Years", "18 months", "1 yr". null: not a plain period.
  function periodDays(byWhen) {
    const m = /^(\d{1,3}(?:\.\d{1,2})?)\s*(years?|yrs?|months?|mths?|weeks?|wks?|days?)$/i.exec(str(byWhen).trim());
    if (!m) return null;
    const n = Number(m[1]), u = m[2].toLowerCase();
    return n * (/^y/.test(u) ? 365 : /^m/.test(u) ? 30 : /^w/.test(u) ? 7 : 1);
  }
  const SORTS = [["topic", "Topic"], ["unit", "Land unit"], ["time", "By when"]];
  // The actions in groups for one sort: { key, title, items } in order; within a group, the plan's own order (its page).
  //   topic: the topic the plan filed each under, in the order they first appear; actions with none last (no heading when it is the only group)
  //   unit: each action under its first land unit, in code order; then those tied to none
  //   time: each By when as the plan wrote it, shortest period first, then words that are no plain period; then none given, then not read
  function arrange(m, by = "topic") {
    const items = list(m?.items);
    if (by === "unit") {
      const units = list(m?.landUnits), groups = units.map((u) => ({ key: "u:" + u.id, title: [u.code, u.name].filter(Boolean).join(" · "), items: [] }));
      const none = { key: "u:", title: "Not tied to a land unit", items: [] };
      for (const a of items) { const u = a.landUnits[0]; (groups.find((g) => g.key === "u:" + u?.id) || none).items.push(a); }
      return [...groups, none].filter((g) => g.items.length);
    }
    if (by === "time") {
      const groups = new Map();
      for (const a of items) {
        const key = a.byWhen != null ? "t:" + a.byWhen : a.said === "none" ? "t:none" : "t:unread";
        if (!groups.has(key)) groups.set(key, { key, title: a.byWhen != null ? "By when " + a.byWhen : a.said === "none" ? "The plan gives no By when" : "By when not read: see the plan", items: [], days: a.byWhen != null ? periodDays(a.byWhen) : null, text: a.byWhen });
        groups.get(key).items.push(a);
      }
      const place = (g) => (g.key === "t:none" ? 3 : g.key === "t:unread" ? 4 : g.days == null ? 2 : 1);
      return [...groups.values()].sort((x, y) => place(x) - place(y) || (x.days ?? 0) - (y.days ?? 0) || str(x.text).localeCompare(str(y.text), "en", { numeric: true }))
        .map(({ key, title, items: xs }) => ({ key, title, items: xs }));
    }
    return list(m?.actions).map((g) => ({ key: "a:" + g.key, title: g.title, items: g.items }));
  }
  // What the row shows at its right: the land unit(s) by code (else name) and the By when as the plan wrote it
  function rowMeta(a) {
    const units = list(a?.landUnits).map((u) => u.code || u.name);
    return { units: units.join(", ") || null, byWhen: a?.byWhen ?? null };
  }

  // ---- FEP2: the plan's land units on the map ---------------------------------------------------------------------------------------
  // farm_map's land units carry the land unit's code and name (not its id): each of the plan's land units is matched to exactly one
  // feature, by its code as stored, else its code without "LMU-", else its name; a match that is not one-to-one is no match.
  function mapUnits(landUnits, features) {
    const fs = list(features).filter((f) => f?.geometry?.coordinates), out = new Map(), used = new Set();
    const norm = (v) => str(v).trim().toLowerCase(), bare = (v) => norm(v).replace(/^lmu-/, "");
    const tries = [(u, f) => u.rawCode && norm(f.properties?.code) === norm(u.rawCode), (u, f) => u.code && bare(f.properties?.code) === bare(u.code),
      (u, f) => u.name && norm(f.properties?.name) === norm(u.name)];
    for (const u of list(landUnits)) {
      for (const t of tries) {
        const hits = fs.filter((f) => t(u, f));
        if (hits.length === 1 && !used.has(hits[0])) { out.set(u.id, hits[0]); used.add(hits[0]); break; }
        if (hits.length > 1) break;
      }
    }
    return out;
  }

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
    // FEP2
    openPlan: "Open the plan",
    actionsHead: "Actions", ratingsHead: "Land units and the plan's risk ratings", usesHead: "What the farm already does",
    sortLabel: "Sort actions by",
    noRatingsRow: "No ratings read; see the plan",
    seeThePlan: "see the plan",
    unreadCell: "Not read with certainty; see the plan",
    noneCell: "No rating read",
    keyLine: (name) => name + ", as the plan's author rated the land:",
    keyHint: "Choose a risk's heading to shade the land units by it.",
    keyNone: "Grey: no rating read for it, or not read with certainty; see the plan",
    mapUnavailable: "The map isn't available in this browser.",
    mapFailed: "The map couldn't be drawn just now.",
    mapOpen: "Open the map", mapClose: "Back to the list",
  };
  // FEP2: the one quiet line at the foot: what date the plan's words are from, and what a rating is
  const footLine = (dateText) => (dateText ? "As the plan said on " + dateText + "; nothing here has been updated since." : "As the plan said (its date is not recorded); nothing here has been updated since.")
    + " Ratings are the plan author's, of the land, not of how it is farmed.";
  // FEP2: the header's one line of facts: the farm's area (once the map has it), its land units, the plan's date
  const factsLine = ({ areaHa = null, landUnits = 0, dateText = null } = {}) => [Number.isFinite(areaHa) && areaHa > 0 ? Math.round(areaHa).toLocaleString("en-NZ") + " ha" : null,
    landUnits ? plural(landUnits, "land unit", "land units") : null, dateText ? "plan dated " + dateText : "the plan's date is not recorded"].filter(Boolean).join(" · ");
  const cappedLine = (capped) => {
    const k = Object.keys(capped || {});
    return k.length ? "This farm has more plan records than this page reads at once (" + k.map((x) => ({ landUnits: "land units", activities: "land-unit uses", risks: "risk ratings", actions: "actions", actionPlaces: "action places", actionRisks: "action links", files: "plan files" })[x] || x).join(", ") + "): the first ones are shown. The PDF has them all." : null;
  };

  return { COORDINATOR_ROLES, coordinatedGroupIds, audience, unmark, split, pdfPage, dateIn, activityWords, ratingOf, riskName, risk, action, planWords, RISK_ORDER,
    CAPS, PLAN_TYPES, planFile, fileName, build, heading, countLine, areaText, progressLabel, WORDS, cappedLine, day,
    // FEP2
    levelOf, LEVEL_WORDS, RISK_HEADS, table, shading, progressMark, MARK_WORDS, periodDays, SORTS, arrange, rowMeta, mapUnits, footLine, factsLine };
});

// ACT1: a farm's Actions list, the pure part (the owner, 19 Nov 2026, the design mock approved "as drawn"). One list per farm: To do,
// grouped Now (due within about a month, or already past), Later, and "When it happens, or no date"; Done, newest first, a repeating
// action's latest time only. Each action has the people responsible: one is the normal case, several are allowed, none is "Anyone".
// Everyone with a role on the farm sees the whole list; it opens on Mine (yours and Anyone's), with Everyone and each person one tap
// away. No overdue, no red, no score: a date that has passed simply sits in Now. A repeating action goes to Done when ticked and comes
// back by itself (a new row made by the tick, hidden until its shows_from): a month before a yearly or six-monthly one is due, a week
// before a monthly one, two days before a weekly one. The repeat maths is the database's (app.action_next_due, app.action_comes_back,
// migration 20261113088000), done the same way here so the screen can say "Comes back 1 July 2027" at once. No DOM, no reads, no clock:
// "today" is handed in (New Zealand's day). farm-plan.js (FP.farmActions) reads, ticks and draws.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports.actions = api; else { root.FP = root.FP || {}; root.FP.farmActionsModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (v == null ? "" : String(v));
  const EVERY = ["year", "6 months", "month", "week"];
  const STEP_MONTHS = { year: 12, "6 months": 6, month: 1 };
  // how many days before it is due a repeating action comes back onto To do
  const LEAD = { year: 30, "6 months": 30, month: 7, week: 2 };
  const NOW_DAYS = 31;   // Now: due within about a month (or already past)
  // (ACT1, the owner: RCL staff act on any farm's list as its editors do, on the farm's behalf: "staff" here)
  const ROLES = ["view", "edit", "admin", "owner", "staff"];
  const canEdit = (role) => ROLES.indexOf(role) >= 1;
  const hasRole = (role) => ROLES.includes(role);

  // ---- days (YYYY-MM-DD, no clock, no time zone) ----------------------------------------------------------------------------------
  function parse(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(day));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo) ? { y, m: mo, d } : null;
  }
  const isDay = (day) => !!parse(day);
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (y, m, d) => String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const utc = (day) => { const p = parse(day); return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN; };
  function addDays(day, n) {
    const t = utc(day);
    if (!Number.isFinite(t)) return null;
    const x = new Date(t + n * 86400000);
    return iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
  }
  // months added as Postgres adds an interval of months: the same day, or the month's last day when it has fewer
  function addMonths(day, n) {
    const p = parse(day);
    if (!p) return null;
    const total = p.y * 12 + (p.m - 1) + n, y = Math.floor(total / 12), m = (total % 12) + 1;
    return iso(y, m, Math.min(p.d, daysIn(y, m)));
  }
  const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

  // ---- the repeat maths (the database's: app.action_next_due, app.action_comes_back) -----------------------------------------------
  // The first date on the schedule (anchor + k steps, k >= 1) after `after`. Months and years are added to the anchor, never to the
  // date before, so a month end stays a month end and 29 Feb comes back as 28 Feb, and 29 Feb again in the next leap year.
  function nextDue(anchor, every, after) {
    const a = parse(anchor), x = parse(after);
    if (!a || !x || !EVERY.includes(every)) return null;
    let k;
    if (every === "week") k = Math.max(1, Math.trunc(daysBetween(anchor, after) / 7));
    else k = Math.max(1, Math.trunc(((x.y - a.y) * 12 + x.m - a.m) / STEP_MONTHS[every]) - 1);
    for (let i = 0; i < 10000; i++, k++) {
      const d = every === "week" ? addDays(anchor, 7 * k) : addMonths(anchor, STEP_MONTHS[every] * k);
      if (d > after) return d;
    }
    return null;
  }
  const comesBack = (due, every) => (isDay(due) && LEAD[every] != null ? addDays(due, -LEAD[every]) : null);
  // What a tick of `a` will make, as action_tick does: the next due date and the day it comes back (null when it does not repeat).
  // anchor: the series' first due date (the action's own when it is the first, or unknown).
  function nextOf(a, today, anchor = null) {
    if (!a || !EVERY.includes(a.every) || !isDay(a.due)) return null;
    let from = isDay(anchor) ? anchor : a.due;
    if (from !== a.due && nextDue(from, a.every, addDays(a.due, -1)) !== a.due) from = a.due;   // (moved off the schedule: from its own date)
    const due = nextDue(from, a.every, a.due > today ? a.due : today);
    return due ? { due, showsFrom: comesBack(due, a.every) } : null;
  }

  // ---- rows ---------------------------------------------------------------------------------------------------------------------------
  // An actions row (and its people) as the screen uses it
  function row(r, people = []) {
    const who = [...new Set(list(people).filter((p) => p && p.action_id === r.id && p.user_id).map((p) => p.user_id))];
    return { id: r.id, title: str(r.title).trim(), note: r.description ? str(r.description) : "", due: isDay(r.due_date) ? str(r.due_date).slice(0, 10) : null,
      whenText: r.when_text ? str(r.when_text) : null, every: EVERY.includes(r.repeat_every) ? r.repeat_every : null, seriesId: r.series_id || null,
      showsFrom: isDay(r.shows_from) ? str(r.shows_from).slice(0, 10) : null, status: r.status || "planned", done: r.status === "done",
      completedOn: isDay(r.completed_on) ? str(r.completed_on).slice(0, 10) : null, completedBy: r.completed_by || null, createdBy: r.created_by || null, who };
  }
  const rows = (actions, people) => list(actions).filter((r) => r && r.id).map((r) => row(r, people));
  // on To do now: not done, not dropped, not a next time waiting to come back
  const open = (a, today) => !a.done && a.status !== "not_doing" && !(a.showsFrom && a.showsFrom > today);
  const waiting = (a, today) => !a.done && a.status !== "not_doing" && !!a.showsFrom && a.showsFrom > today;
  // Mine: yours, and anything for Anyone; Everyone; or one person's (their user id)
  function passes(a, filter, me) {
    if (filter === "everyone") return true;
    if (!filter || filter === "mine") return !a.who.length || a.who.includes(me);
    return a.who.includes(filter);
  }
  const GROUPS = [["now", "Now"], ["later", "Later"], ["when", "When it happens, or no date"]];
  const groupOf = (a, today) => (!a.due ? "when" : daysBetween(today, a.due) <= NOW_DAYS ? "now" : "later");
  const byDue = (x, y) => str(x.due || "9999").localeCompare(str(y.due || "9999")) || x.title.localeCompare(y.title, "en-NZ") || str(x.id).localeCompare(str(y.id));
  // To do: [{ key, title, items }] in the three groups, each by date (soonest first); an empty group is left out
  function todo(actions, { filter = "mine", me = null, today }) {
    const mine = list(actions).filter((a) => open(a, today) && passes(a, filter, me));
    return GROUPS.map(([key, title]) => ({ key, title, items: mine.filter((a) => groupOf(a, today) === key).sort(byDue) })).filter((g) => g.items.length);
  }
  const todoCount = (actions, opts) => todo(actions, opts).reduce((n, g) => n + g.items.length, 0);
  // Done, newest first; a repeating action's latest time only
  function done(actions, { filter = "mine", me = null } = {}) {
    const d = list(actions).filter((a) => a.done && passes(a, filter, me));
    const latest = new Map();
    for (const a of d) if (a.seriesId) { const l = latest.get(a.seriesId); if (!l || str(l.completedOn) < str(a.completedOn) || (l.completedOn === a.completedOn && str(l.due) < str(a.due))) latest.set(a.seriesId, a); }
    return d.filter((a) => !a.seriesId || latest.get(a.seriesId) === a)
      .sort((x, y) => str(y.completedOn).localeCompare(str(x.completedOn)) || str(y.due).localeCompare(str(x.due)) || x.title.localeCompare(y.title, "en-NZ"));
  }
  // The day a done repeating action's next time comes back (its series' waiting row), or null
  function backOf(a, actions, today) {
    if (!a?.seriesId) return null;
    const w = list(actions).filter((x) => x.seriesId === a.seriesId && x.id !== a.id && waiting(x, today)).sort(byDue)[0];
    return w ? w.showsFrom : null;
  }
  // For a farm's Home: how many of the person's (and Anyone's) are in Now, and the first one's title
  function nowLine(actions, { me, today }) {
    const g = todo(actions, { filter: "mine", me, today }).find((x) => x.key === "now");
    return g ? { count: g.items.length, first: g.items[0].title } : null;
  }

  // ---- who ------------------------------------------------------------------------------------------------------------------------------
  // people: farm_action_people rows ({ user_id, name, role, is_you })
  const person = (people, id) => list(people).find((p) => p.user_id === id) || null;
  const shortName = (name) => str(name).trim().split(/\s+/)[0] || "Someone";
  function initials(name) {
    const w = str(name).replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || "?").slice(0, 2)).toLocaleUpperCase("en-NZ");
  }
  // (RCL staff named on the list without a role on the farm read "Sam (RCL)": by display name only, never an email)
  const nameOf = (people, id, me, { you = "you" } = {}) => {
    if (id && id === me) return you;
    const p = person(people, id);
    return p?.staff && !p.role ? shortName(p.name) + " (RCL)" : shortName(p?.name || "someone on the farm");
  };
  const and = (ws) => (ws.length < 2 ? ws.join("") : ws.slice(0, -1).join(", ") + " and " + ws[ws.length - 1]);
  // "Anyone", "You", "Jordan", "You and Riley"
  const whoWords = (ids, people, me) => (!list(ids).length ? "Anyone" : and(list(ids).map((id) => nameOf(people, id, me, { you: "You" }))));
  const ROLE_WORDS = { owner: "owner", admin: "admin", edit: "can edit", view: "can view" };
  // the people who may be made responsible: those with a role on the farm (RCL staff without one never are)
  const assignable = (people) => list(people).filter((p) => p && p.role);
  // The person button's words: "Mine", "Everyone", or their name
  const filterLabel = (filter, people, me) => (!filter || filter === "mine" ? "Mine" : filter === "everyone" ? "Everyone" : nameOf(people, filter, me, { you: "You" }));
  // The person menu: Mine (and Anyone), Everyone, then each person on the farm other than you
  const filterChoices = (people, me) => [{ key: "mine", label: "Mine", hint: "and Anyone's" }, { key: "everyone", label: "Everyone" },
    ...assignable(people).filter((p) => p.user_id !== me).map((p) => ({ key: p.user_id, label: shortName(p.name), hint: ROLE_WORDS[p.role] || "" }))];
  // Where the list opens: Mine, except for RCL staff with nothing of theirs to do there, who open on everyone's (the owner, 19 Nov 2026)
  const startFilter = (actions, { role = null, me = null, today } = {}) =>
    (STAFF_ROLES.includes(role) && !list(actions).some((a) => open(a, today) && a.who.includes(me)) ? "everyone" : "mine");
  // RCL staff signed in without two-factor: they read the list, and change nothing (the database's rule: staff's writes need aal2)
  const STAFF_ROLES = ["staff", "staff-look"];

  // ---- words ----------------------------------------------------------------------------------------------------------------------------
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // "15 December" (this year), "30 June 2027" (another), or always with the year
  function dayWords(day, today, { year = false } = {}) {
    const p = parse(day), t = parse(today);
    return p ? p.d + " " + MONTHS[p.m - 1] + (year || !t || t.y !== p.y ? " " + p.y : "") : "";
  }
  function shortDay(day, today) {
    const p = parse(day), t = parse(today);
    return p ? p.d + " " + MONTHS[p.m - 1].slice(0, 3) + (!t || t.y !== p.y ? " " + p.y : "") : "";
  }
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  // When, in plain words: "By 15 December", "By 31 July, every year", "By 1 Dec, every 6 months", "By the 1st, every month",
  // "Every week, by Monday", the when line itself, or "No date". Never "overdue".
  function whenWords(a, today) {
    if (!a.due) return a.whenText || "No date";
    const p = parse(a.due);
    if (a.every === "year") return "By " + p.d + " " + MONTHS[p.m - 1] + ", every year";
    if (a.every === "6 months") return "By " + shortDay(a.due, today) + ", every 6 months";
    if (a.every === "month") return "By the " + ord(p.d) + ", every month";
    if (a.every === "week") return "Every week, by " + WEEKDAYS[new Date(utc(a.due)).getUTCDay()];
    return "By " + dayWords(a.due, today);
  }
  // A row's one quiet line. To do: who (left out under Mine when it is only you), then when. Done: "Done today by you", "for Jordan
  // and Riley" (when shared), and "Comes back 1 July 2027" for a repeating one.
  function line(a, { filter = "mine", me = null, people = [], today, back = null }) {
    if (a.done) {
      return [{ text: "Done " + (a.completedOn === today ? "today" : shortDay(a.completedOn, today)) + " by " + nameOf(people, a.completedBy, me) },
        a.who.length > 1 || (a.who.length === 1 && a.who[0] !== a.completedBy) ? { text: "for " + whoWords(a.who, people, me).replace(/^You\b/, "you") } : null,
        back ? { text: "Comes back " + dayWords(back, today, { year: true }), back: true } : null].filter(Boolean);
    }
    const onlyMe = (filter === "mine" || !filter) && a.who.length === 1 && a.who[0] === me;
    return [a.who.length && !onlyMe ? { text: whoWords(a.who, people, me) } : null, { text: whenWords(a, today) }].filter(Boolean);
  }
  const lineText = (bits) => list(bits).map((b) => b.text).join(" · ");
  // What a screen reader hears for a row (the title, who, when; or done and by whom)
  function label(a, opts) {
    return (a.done ? "Done: " : "") + a.title + ". " + (a.done ? lineText(line(a, opts)) : "For " + whoWords(a.who, opts.people, opts.me) + ". " + whenWords(a, opts.today)) + ".";
  }
  const toast = (back, today) => (back ? "Done. Comes back " + dayWords(back, today, { year: true }) : "Done");
  // the hint under Repeats in the form
  const repeatHint = (every) => "When it is ticked it goes to Done, and comes back " + (every === "month" ? "a week" : every === "week" ? "two days" : "a month") + " before it is next due.";

  // ---- who may do what (the database's rules, migration 20261113088000; this only decides what to offer) -------------------------------
  const canAdd = (role) => canEdit(role);
  // anyone with a role on the farm ticks their own and Anyone's; the farm's editors and above tick any
  const canTick = (a, role, me) => !!a && !a.done && hasRole(role) && (canEdit(role) || !a.who.length || a.who.includes(me));
  // undo: the person who ticked it, or the farm's editors and above
  const canUndo = (a, role, me) => !!a && a.done && hasRole(role) && (canEdit(role) || (!!me && a.completedBy === me));

  // ---- the form (adding by hand, and changing one) ------------------------------------------------------------------------------------
  // form: { title, who: [user ids], when: "date" | "repeat" | "event" | "none", date, every, from, whenText }. Returns { ok, row, who,
  // problem: { field, text } }: row is what is written to actions (title, due_date, repeat_every, when_text).
  const WHEN = ["date", "repeat", "event", "none"];
  function fromForm(form, people = null) {
    const f = form || {}, title = str(f.title).trim().replace(/\s+/g, " ");
    const bad = (field, text) => ({ ok: false, problem: { field, text } });
    if (!title) return bad("title", "Say what needs doing.");
    if (title.length > 300) return bad("title", "Keep it under 300 characters.");
    const when = WHEN.includes(f.when) ? f.when : "date";
    let row;
    if (when === "date") {
      if (!isDay(f.date)) return bad("date", "Choose the date it is due by, or another kind of when.");
      row = { due_date: str(f.date).slice(0, 10), repeat_every: null, when_text: null };
    } else if (when === "repeat") {
      if (!EVERY.includes(f.every)) return bad("every", "Choose how often.");
      if (!isDay(f.from)) return bad("from", "Choose the date it is first due.");
      row = { due_date: str(f.from).slice(0, 10), repeat_every: f.every, when_text: null };
    } else if (when === "event") {
      const w = str(f.whenText).trim().replace(/\s+/g, " ");
      if (w.length > 200) return bad("whenText", "Keep it under 200 characters.");
      row = { due_date: null, repeat_every: null, when_text: w || null };
    } else row = { due_date: null, repeat_every: null, when_text: null };
    const known = people ? new Set(assignable(people).map((p) => p.user_id)) : null;
    const who = [...new Set(list(f.who))].filter((id) => !known || known.has(id));
    return { ok: true, row: { title, ...row }, who };
  }
  // The form's starting values: a new one (for you, by a date a week on), or an action being changed
  function formFor(a, { me = null, today } = {}) {
    if (!a) return { title: "", who: me ? [me] : [], when: "date", date: addDays(today, 7), every: "year", from: today, whenText: "" };
    return { title: a.title, who: a.who.slice(), when: a.every ? "repeat" : a.due ? "date" : a.whenText ? "event" : "none", date: a.every ? addDays(today, 7) : a.due || addDays(today, 7),
      every: a.every || "year", from: a.every ? a.due : today, whenText: a.whenText || "" };
  }
  // The Who hint under the chips
  const whoHint = (n) => (n === 0 ? "Nobody chosen: it shows for anyone on the farm." : n === 1 ? "Tap another name to share it." : "Shared: one tick completes it for all of them.");

  const WORDS = {
    title: "Actions", todo: "To do", done: "Done", show: "Show", doneHead: "Done, newest first",
    add: "Add an action", change: "Change", markDone: "Mark done", save: "Save", cancel: "Cancel", close: "Close",
    loading: "Reading the farm's actions…", failed: "The farm's actions couldn't be read just now. Check your connection and try again.",
    notYours: "This list is for the people of this farm.", notReady: "The Actions list isn't ready on this farm yet.",
    emptyTodo: "Nothing to do here. New ones you add will show here.", emptyMine: "Nothing for you here.", emptyDone: "Nothing ticked yet.",
    mineFoot: "Showing yours and anything for Anyone.", showEveryone: "Show everyone's",
    pick: "Choose an action to see it here.",
    tickFailed: "That couldn't be ticked off just now. It is back on the list.", tickOffline: "You're offline, so nothing was ticked. It is back on the list.",
    undoFailed: "That couldn't be undone just now.", saveFailed: "That couldn't be saved just now. Check your connection and try again.",
    added: "Added", saved: "Saved", undone: (t) => "Back on the list: " + t, ticked: (t, back) => "Done: " + t + (back ? ". Comes back " + back : ""),
    soundOn: "Ticking sound: on", soundOff: "Ticking sound: off", soundTurnOff: "Turn off", soundTurnOn: "Turn on",
    homeLine: (n) => n + " for now", homeRow: "Things to do, and who does them",
    needsTwoFactor: "You're signed in without two-factor, so this list is for looking at only. Sign in with two-factor to add, tick or change actions.",
    lockedTwoFactor: "Needs two-factor sign-in to tick",
  };

  // ---- ACT2: proof on a ticked action (a photo, or a file such as a scanned form) ----------------------------------------------------
  // The owner: "They could also attach evidence (take a photo of the form), to the action when ticked off"; "give other options for
  // proof, not just photo (maybe add file, or take photo)". Offered, never forced. The database's rules (migration 20261113092000):
  // whoever could tick the action adds proof to it once it is ticked off; whoever added it, or the farm's editors and above (and RCL
  // staff in a two-factor session), take it off.
  const PROOF_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
    "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "text/plain": "txt" };
  const PROOF_MAX_BYTES = 25 * 1024 * 1024;
  const PROOF_ACCEPT = { photo: "image/*", file: ".pdf,.doc,.docx,.txt,image/*" };
  // What a chosen file is as proof: { ok, kind: "photo" | "file", mime } or { ok: false, problem }
  function proofFile(file, want = "file") {
    const mime = String(file?.type || "").toLowerCase(), size = Number(file?.size);
    if (!PROOF_MIME[mime]) return { ok: false, problem: "That kind of file can't be added as proof. A photo, a PDF, a Word file or plain text can." };
    if (!(size > 0)) return { ok: false, problem: "That file is empty." };
    if (size > PROOF_MAX_BYTES) return { ok: false, problem: "That file is over 25 MB." };
    if (want === "photo" && !/^image\//.test(mime)) return { ok: false, problem: "Choose a photo, or Add a file for anything else." };
    return { ok: true, kind: /^image\//.test(mime) ? "photo" : "file", mime };
  }
  // Each action's proof: { [actionId]: [{ id, entryId, kind, createdBy, createdAt, path, mime }] }, oldest first
  function proofs(evidence, files) {
    const byEntry = new Map(list(files).filter((f) => f && f.entry_id && (!f.variant || f.variant === "original")).map((f) => [f.entry_id, f]));
    const out = {};
    for (const e of list(evidence)) {
      if (!e?.action_id || !e.entry_id) continue;
      const f = byEntry.get(e.entry_id);
      (out[e.action_id] ||= []).push({ id: e.id, entryId: e.entry_id, kind: e.kind === "photo" ? "photo" : "file", createdBy: e.created_by || null,
        createdAt: e.created_at || null, path: f?.storage_path || null, mime: f?.mime_type || null });
    }
    for (const k of Object.keys(out)) out[k].sort((x, y) => str(x.createdAt).localeCompare(str(y.createdAt)));
    return out;
  }
  // whoever could tick it adds proof to it, once it is ticked off
  const canProof = (a, role, me) => !!a && a.done && hasRole(role) && (canEdit(role) || !a.who.length || a.who.includes(me));
  const canRemoveProof = (p, role, me) => !!p && hasRole(role) && (canEdit(role) || (!!me && p.createdBy === me));
  // a file chip's word: "PDF", "Word", "Text", "File"
  const fileWord = (mime) => (mime === "application/pdf" ? "PDF" : /word/.test(String(mime)) ? "Word" : mime === "text/plain" ? "Text" : /^image\//.test(String(mime)) ? "Photo" : "File");
  const PROOF_WORDS = {
    sheetTitle: "Add proof", lede: "Optional. A photo of the form you sent, or of the job done, or a file. It is kept with this action.",
    takePhoto: "Take a photo", choosePhoto: "Choose a photo", addFile: "Add a file", notNow: "Not now", addProof: "Add proof", heading: "Proof",
    sending: "Sending the proof…", added: "Proof added", removed: "Proof taken off", remove: "Take off", open: "Open",
    failed: "The proof couldn't be sent just now. The action is still ticked off.", offline: "You're offline, so the proof wasn't sent. The action is still ticked off.",
    removeFailed: "That proof couldn't be taken off just now.",
    unsent: "Proof didn't finish sending",
  };

  return { EVERY, LEAD, NOW_DAYS, GROUPS, ROLE_WORDS, WHEN, WORDS, parse, isDay, addDays, addMonths, daysBetween, nextDue, comesBack, nextOf, row, rows, open, waiting, passes, groupOf,
    todo, todoCount, done, backOf, nowLine, person, shortName, initials, nameOf, whoWords, filterLabel, filterChoices, dayWords, shortDay, whenWords, line, lineText, label, toast,
    repeatHint, canEdit, canAdd, canTick, canUndo, fromForm, formFor, whoHint, assignable, startFilter,
    PROOF_MIME, PROOF_MAX_BYTES, PROOF_ACCEPT, PROOF_WORDS, proofFile, proofs, canProof, canRemoveProof, fileWord };
});
