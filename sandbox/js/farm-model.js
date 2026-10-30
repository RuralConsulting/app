// Farm-space routes and the models the answer component renders. No DOM, network or clock: "today" is passed in.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => Array.isArray(v) ? v : [];
  // A farm space is a map with three things you can do (docs/PRODUCT-BRIEF.md "AI is the interface").
  const views = [["ask", "Ask"], ["create", "Create"], ["documents", "Documents"]];
  const outputs = [["fep", "Farm Environment Plan"], ["fwfp", "Freshwater Farm Plan"], ["consent", "Consent summary"],
    ["nzfap", "NZFAP+ walkthrough"], ["catchment", "Catchment story"]];
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10)));
  const date = (d) => isDate(d) ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "date not recorded";
  const day = (d) => isDate(d) ? d.slice(0, 10) : null;
  const addDays = (d, n) => new Date(Date.parse(d.slice(0, 10) + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  // Places reached from the header rather than the three actions: People is for a farm's owner and admins.
  const otherViews = [["people", "People"]];
  const viewLabel = (key) => [...views, ...otherViews].find(([k]) => k === key)?.[1] || null;
  const href = (f, view, id) => "#/farm/" + f + (view && view !== "map" ? "/" + view : "") + (id ? "?item=" + encodeURIComponent(id) : "");
  function match(hash) {
    const m = String(hash || "").match(/^#\/farm\/([0-9a-f-]{36})(?:\/(ask|create|documents|people))?(?:\?item=([^&#]+))?$/);
    try { return m ? { farm: m[1], view: m[2] || "map", item: m[3] ? decodeURIComponent(m[3]) : null } : null; } catch { return null; }
  }
  const authName = (a) => [a.consent_no || a.rule_ref, a.title].filter(Boolean).join(" · ") || "Recorded authorisation";
  const count = (n, one, many) => (n === 1 ? "One " + one : n + " " + many);
  const docKinds = { fep: "Farm Environment Plan", fwfp: "Freshwater Farm Plan", consent_decision: "Consent decision", consent_application: "Consent application",
    overseer_report: "Nutrient budget", memo: "Notes", aee: "Assessment of environmental effects", luc_report: "Land use capability report",
    ghg_report: "Greenhouse gas report", consent_correspondence: "Consent correspondence", correspondence: "Correspondence",
    smap_factsheet: "S-map soil fact sheet", gis_artifact: "Map extract", nzfap_checklist: "NZFAP+ checklist", land_unit_map: "Land unit map",
    image: "Photo or image", other: "Other" };
  const docKind = (k) => docKinds[k] || (k ? String(k).replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : null);

  // ---- Documents: what matters first --------------------------------------------------------------------
  // The tier a document sits in comes from what the record says it is: its type, then its title. When the database
  // carries a tier (F1e) a "supporting" or "archive" there is kept; its "primary" is also what every existing
  // document was given, so it decides nothing and the type and title still do. Pure: a documents row in, out comes
  // { tier: "primary" | "supporting" | "other", rank, kind, fold }; rank orders within a tier (lower first), fold
  // names the quiet group a run of the same kind is folded into.
  const DOC_TIERS = [["primary", "Main documents"], ["supporting", "Supporting"], ["other", "Other"]];
  const DOC_TYPES = {
    fep: ["primary", 0], fwfp: ["primary", 0], farm_environment_plan: ["primary", 0], freshwater_farm_plan: ["primary", 0],
    consent_decision: ["primary", 1], consent_application: ["primary", 1], consent: ["primary", 1], aee: ["primary", 1], nzfap_checklist: ["primary", 1],
    overseer_report: ["primary", 2], nutrient_budget: ["primary", 2], land_unit_map: ["primary", 3], farm_map: ["primary", 3],
    luc_report: ["primary", 4], ghg_report: ["primary", 4],
    consent_correspondence: ["supporting", 0], correspondence: ["supporting", 0], memo: ["supporting", 1],
    smap_factsheet: ["supporting", 2], gis_artifact: ["supporting", 3], image: ["supporting", 4],
  };
  const DOC_FOLDS = { smap_factsheet: "S-map soil fact sheets", gis_artifact: "map extracts" };
  const TITLE_RULES = [   // for a document whose type says nothing: [pattern, tier, rank]
    [/correspondence|\be-?mail\b|\bletter\b|\binformation (?:request|\d+)\b|\bs\.? ?92\b/i, "supporting", 0],
    [/fact ?sheet/i, "supporting", 2],
    [/farm environment plan|freshwater farm plan|\bFEP\b|\bFWFP\b/i, "primary", 0],
    [/\bdecision\b|consent notice/i, "primary", 1], [/assessment of environmental effects|\bAEE\b/i, "primary", 1],
    [/nutrient budget|overseer/i, "primary", 2], [/\bland units?\b|farm map|property map/i, "primary", 3],
    [/greenhouse|\bghg\b|land use capability|\bLUC\b/i, "primary", 4],
  ];
  const ABOUT_CORRESPONDENCE = /correspondence|\be-?mail\b|\bletter\b/i;
  const MAP_EXTRACT = /\bclip|buffer|within \d+ ?km|\bextract\b/i;
  function docClass(d) {
    const row = d || {}, type = String(row.doc_type || "").toLowerCase().trim().replace(/[\s-]+/g, "_"), title = String(row.title || "");
    let [tier, rank] = DOC_TYPES[type] || [null, 0];
    if (type === "gis_artifact" && /\bland units?\b|farm map|property map/i.test(title) && !MAP_EXTRACT.test(title)) [tier, rank] = ["primary", 3];
    if (!tier) { const hit = TITLE_RULES.find(([re]) => re.test(title)); [tier, rank] = hit ? [hit[1], hit[2]] : ["other", 0]; }
    if (tier === "primary" && rank >= 2 && ABOUT_CORRESPONDENCE.test(title)) [tier, rank] = ["supporting", 0];   // "nutrient budget 2012/13 correspondence"
    const given = String(row.tier || "").toLowerCase();
    if (given === "archive") [tier, rank] = ["other", 9];
    else if (given === "supporting" && tier !== "supporting") [tier, rank] = ["supporting", 5];
    return { tier, rank, kind: docKind(row.doc_type), fold: tier === "supporting" ? DOC_FOLDS[type] || null : null };
  }
  // B3: the tier a document is shown in. A tier a person chose is kept: archive and supporting always are (nothing
  // sets them but a person or a loader told to), and primary is when someone chose it (tiered_at, stamped by the
  // database when a person sets or confirms a tier) or a supporting document sits under it. A "primary" nobody chose
  // (F1e gave every existing document that tier) and a row from before tiers still go by docClass, with "other"
  // shown as supporting: a guess never hides a document in the archive. A superseded document is archived.
  // Returns { tier: "primary" | "supporting" | "archive", weight (kind order among primaries, lower first), fold, chosen }.
  function docTier(d, hasChildren = false) {
    const row = d || {}, stored = String(row.tier || "").toLowerCase(), c = docClass({ ...row, tier: null });
    const weight = c.tier === "primary" ? c.rank : 5, fold = DOC_FOLDS[String(row.doc_type || "").toLowerCase().trim().replace(/[\s-]+/g, "_")] || null;
    if (stored === "archive" || row.status === "superseded") return { tier: "archive", weight, fold, chosen: stored === "archive" };
    if (stored === "supporting") return { tier: "supporting", weight, fold, chosen: true };
    if (stored === "primary" && (row.tiered_at || hasChildren)) return { tier: "primary", weight, fold: null, chosen: true };
    return { tier: c.tier === "primary" ? "primary" : "supporting", weight, fold: c.tier === "primary" ? null : fold, chosen: false };
  }
  // A correspondence record titled only by a code ("<consent no> information 3") is shown as what it is: its kind,
  // the consent it is about and the date it was prepared (or its number in the run when it has no date).
  const CODE_TITLE = /^\s*([A-Z]{2,5}\s?\d{4,}[A-Z]?)((?:\s+(?:further|additional|information|info|response|request|reply|letter|e-?mail|correspondence|s\.?\s?92))+)[\s#.,-]*(\d+)?[\s.]*$/i;
  function docTitle(d) {
    const title = String((d || {}).title || "").trim(), m = title.match(CODE_TITLE);
    if (!m) return title || "Document";
    const kind = docKind(d.doc_type) || "Correspondence", when = day(d.date_prepared);
    return kind + " for " + m[1].replace(/\s/g, "").toUpperCase() + (when ? ", " + date(when) : m[3] ? ", no. " + m[3] : "");
  }

  // Why a condition is on the list, in the words of the record: the consent or rule that requires it and the condition
  // number. A condition the record doesn't link to an authorisation says so instead of leaving the line bare. A code
  // that isn't a condition number (a consent's lapse date) names the consent alone.
  const conditionCode = (o) => (o.code && /^\d/.test(o.code) ? o.code : null);
  const obligationReason = (o, a) => {
    const code = conditionCode(o) ? "condition " + o.code : null;
    if (a) return "required by " + (a.consent_no || a.rule_ref || a.title || "a recorded authorisation") + (code ? ", " + code : "");
    return (code ? "from " + code : "from a recorded condition") + ", consent not recorded";
  };
  const params = (o) => (o.parameters && typeof o.parameters === "object" && !Array.isArray(o.parameters) ? o.parameters : {});
  const words = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const and = (xs) => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
  // Where a condition stands from what is recorded, never from what ought to be true: ongoing practice; a date
  // (coming up or passed); or unknown until there is a record (an audit repeating on its last grade, a report after
  // each audit). Rows loaded before schedules were recorded fall back on their date, repeat rule and kind.
  function schedule(o) {
    const p = params(o), when = day(o.due_date);
    if (p.schedule === "continuous") return { state: "ongoing" };
    if (when) return { state: "dated", due: when };
    if (p.schedule === "recurring" || p.schedule === "dated" || words(o.recurrence) || ["date", "reporting"].includes(o.kind)) return { state: "unknown" };
    return { state: "ongoing" };
  }

  // Who the farm space is answering. A farm's own people (owner, managers) read it as a farmer; an advisor or
  // facilitator in the farm's organisation reads it as an advisor. Same records, different curation (APP-STRUCTURE §3).
  const audienceOf = (context) => (context.audience === "farmer" || context.audience === "advisor" ? context.audience : context.advisor === false ? "farmer" : "advisor");
  // The demo fixture marks every invented record "(synthetic)" for the reviewer; the farmer view reads the way a
  // farmer reads their own records, so the marker is not shown there.
  const unmarked = (v) => typeof v === "string" ? v.replace(/\s*\(synthetic\)/gi, "") : Array.isArray(v) ? v.map(unmarked) :
    v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmarked(x)])) : v;
  const lower = (t) => (/^[A-Z][a-z]/.test(t || "") ? t[0].toLowerCase() + t.slice(1) : t || "");
  // What a line is about, for a sentence: "Have the first audit done" -> "the first audit", "Send the season's
  // records" -> "the season's records"; anything else as it is written.
  function about(t) {
    const m = String(t || "").trim().match(/^(?:have|get) (.+) done$/i) || String(t || "").trim().match(/^(?:send|submit|provide|lodge|verify|renew|update) (the .+)$/i);
    return m ? m[1] : lower(String(t || "").trim());
  }
  // An authorisation as a farmer names it: by its title ("Water permit"), never led by a rule code; a title that is
  // the consent's activity ("To use land for farming.") gives way to the consent number.
  const plainName = (a) => {
    const t = unmarked(a.title || "").trim();
    return t && !/\.$/.test(t) ? t : a.consent_no ? "Consent " + a.consent_no : t || a.rule_ref || "Recorded authorisation";
  };
  const setBy = (a) => (!a ? "a recorded condition" : a.kind === "consent" ? "your consent" : a.kind === "permitted_rule" ? "a permitted activity rule" : "a recorded authorisation");
  // Where a condition is on the farm's map, when the record says: its land units (by code) or a theme the map draws
  // ("waterways", "wells"). Never worked out from the wording; no place recorded, no place.
  function placeOf(o) {
    const p = params(o).place, codes = (v) => list(v).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
    if (!p || typeof p !== "object") return null;
    const place = { land_units: codes(p.land_units), themes: codes(p.themes) };
    return place.land_units.length || place.themes.length ? place : null;
  }
  // A consent decision among the farm's documents: the consent exists even before its conditions are read in.
  const isDecision = (d) => String(d.doc_type || "").toLowerCase() === "consent_decision" ||
    (!d.doc_type && /\bdecision\b/i.test(d.title || "") && /\bconsent\b|\b[A-Z]{3}\d{6}\b/i.test(d.title || ""));

  // "What's due": the farm's conditions as a checklist (what needs a record before anything can be said, dates
  // coming up, ongoing practice), with authorisation expiry dates and consents whose conditions aren't recorded.
  // Ordered by consequence: the sentence names what needs a record first, then the next date; its counts are the
  // checklist's own. Promoted lines are what needs a record (the dated first), then the next date, then the practice
  // to keep up, each with its reason. The advisor reads the citation up front; the farmer reads the action and its
  // date, with the consent and condition in the checklist behind it. Nothing is inferred or asserted.
  function due(context) {
    const f = context.farm.id, today = context.today, horizon = addDays(today, 365), auths = list(context.authorisations), obligations = list(context.obligations);
    const farmer = audienceOf(context) === "farmer", name = farmer ? plainName : authName;
    const byId = new Map(auths.map((a) => [a.id, a])), docs = new Map(list(context.documents).map((d) => [d.id, d]));
    const source = (o) => {
      const d = o.source_document_id && docs.get(o.source_document_id), page = Number.isInteger(o.source_page) ? "page " + o.source_page : null;
      return d ? [d.title || "Source document", page].filter(Boolean).join(", ") : page ? "Source " + page : null;
    };
    // Plan content listed under its condition (Appendix B under condition 7) folds into that condition's line.
    const codeOf = (o) => (o.authorisation_id || "") + "|" + (o.code || "");
    const parents = new Set(obligations.map(codeOf)), parts = new Map();
    const partOf = (o) => { const p = words(params(o).part_of); return p && parents.has((o.authorisation_id || "") + "|" + p) ? (o.authorisation_id || "") + "|" + p : null; };
    for (const o of obligations) if (partOf(o)) { const k = partOf(o); if (!parts.has(k)) parts.set(k, []); parts.get(k).push(o); }
    const checklist = [], places = {}, auth = new Map();
    for (const o of obligations) {
      if (partOf(o)) continue;
      const a = byId.get(o.authorisation_id), p = params(o), s = schedule(o), id = "obligation-" + o.id;
      const kids = (parts.get(codeOf(o)) || []).sort((x, y) => String(x.code).localeCompare(String(y.code), "en", { numeric: true }));
      if (placeOf(o)) places[id] = placeOf(o);
      auth.set(id, a);
      checklist.push({ id, text: o.summary || "Recorded condition", reason: obligationReason(o, a),
        state: s.state === "dated" ? undefined : s.state, due: s.due || null, verb: o.code === "lapse" ? "lapses" : "due",
        repeats: words(o.recurrence), needs: words(p.needs_record), basis: s.due ? words(p.due_basis) : null,
        note: [s.due ? words(p.due_basis) : null, words(p.note), words(p.flag)].filter(Boolean).join(" ") || null,
        wording: words(o.full_text), source: source(o), parts: kids.map((k) => k.summary).filter(Boolean),
        detail: [a ? name(a) : null, conditionCode(o) ? "condition " + o.code : null, s.due ? (s.due < today ? "was due " : "due ") + date(s.due) : null, o.recurrence].filter(Boolean).join(" · ") });
    }
    for (const a of auths) {
      const when = day(a.valid_to), code = a.consent_no || a.rule_ref;
      // A consent with none of its conditions recorded says so: on its expiry line, or on a line of its own.
      const bare = a.kind === "consent" && !obligations.some((o) => o.authorisation_id === a.id), unrecorded = "Its conditions aren't recorded yet.";
      if (when) checklist.push({ id: "expiry-" + a.id, text: name(a), reason: farmer && code ? "the expiry date of " + code : "the consent's expiry date", due: when, verb: "expires",
        note: bare ? unrecorded : null, detail: (when < today ? "expired " : "expires ") + date(when) });
      else if (bare) checklist.push({ id: "conditions-" + a.id, text: "Conditions of " + (farmer ? lower(name(a)) : name(a)), reason: "the consent is recorded, its conditions aren't yet", state: "unknown",
        needs: "the consent's conditions", detail: "conditions not recorded" });
    }
    const stateOf = (i) => (i.state === "ongoing" ? "ongoing" : i.due ? (i.due < today ? "passed" : "due") : "unknown");
    const byDate = (a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id), byText = (a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id);
    // The checklist's own groups, so the sentence's counts are the ones under it.
    const coming = checklist.filter((i) => stateOf(i) === "due").sort(byDate);
    const passed = checklist.filter((i) => stateOf(i) === "passed").sort(byDate);
    const needs = [...passed.filter((i) => i.verb === "due"), ...checklist.filter((i) => stateOf(i) === "unknown").sort(byText)];
    const ended = passed.filter((i) => i.verb !== "due");
    const ongoing = checklist.filter((i) => stateOf(i) === "ongoing");
    const calc = (i) => (i.basis ? ", calculated" : "");
    // Each line's reason. Advisor: where it stands and the consent and condition that require it. Farmer: the line
    // leads with the date and the action; its reason is how often, or what sets it.
    for (const i of coming) {
      if (!farmer) i.because = i.verb + " " + date(i.due) + calc(i) + (i.verb === "due" && i.reason ? ", " + i.reason : "");
      else if (i.verb === "expires") { i.lead = date(i.due) + ": " + i.text + " expires"; i.because = "the consent's expiry date"; }
      else { i.lead = "By " + date(i.due) + ": " + lower(i.text); i.because = i.repeats || "set by " + setBy(auth.get(i.id)); }
    }
    for (const i of needs) {
      if (i.id.startsWith("conditions-")) i.because = i.reason;   // a consent with no conditions read in: its line says so
      else if (!farmer) i.because = "needs a record" + (i.needs ? " of " + i.needs : "") + (i.due ? " (due by " + date(i.due) + calc(i) + ")" : "") + (i.reason ? ", " + i.reason : "");
      else if (i.due) { i.lead = "Was due " + date(i.due) + ": " + lower(i.text); i.because = "no record of " + (i.needs || "it") + " yet"; }
      else i.because = "needs a record" + (i.needs ? " of " + i.needs : "");
    }
    // The practice to keep up, in one line: how many, and the consents and conditions that require it.
    let summary = null;
    if (ongoing.length) {
      const by = new Map(), kinds = new Map();
      for (const o of obligations.filter((x) => ongoing.some((i) => i.id === "obligation-" + x.id))) {
        const a = byId.get(o.authorisation_id), key = a ? a.consent_no || a.rule_ref || a.title || "a recorded authorisation" : "conditions with no consent recorded";
        if (!by.has(key)) by.set(key, []);
        kinds.set(key, setBy(a));
        if (conditionCode(o)) by.get(key).push(o.code);
      }
      const named = [...by].map(([k, codes]) => {
        codes.sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
        const shown = codes.length > 6 ? [...codes.slice(0, 5), codes.length - 5 + " more"] : codes;
        return k + (codes.length ? (codes.length === 1 ? ", condition " : ", conditions ") + and(shown) : "");
      });
      // the farmer's line: what sets the practice, without the codes ("your consent and a permitted activity rule")
      const sources = [...new Set(kinds.values())], consents = [...kinds.values()].filter((k) => k === "your consent").length;
      const set = sources.map((k) => (k === "your consent" && consents > 1 ? "your " + consents + " consents" : k));
      summary = { id: "ongoing", text: count(ongoing.length, "practice to keep up", "practices to keep up"),
        because: farmer ? "set by " + and(set) : "required by " + named.join("; "), eligible: true };
    }
    // Promoted, at most three, by consequence: what needs a record (a passed date first, and a second passed date
    // with it), the next date, the practice; then more of each.
    const promoted = [...new Set([needs[0], needs[1]?.due ? needs[1] : null, coming[0], summary, ...needs.slice(1), ...coming.slice(1)])]
      .filter((i) => i && i.because).slice(0, 3);
    for (const i of promoted) i.eligible = true;
    const items = [...new Set([...promoted, ...needs, ...coming, ...ended, ...ongoing])].map(({ id, text, lead, because, eligible, detail }) => ({ id, text: lead || text, because, eligible: !!eligible, detail }));
    // The sentence: how many things need a record and the first of them by name (with the date it was due), then
    // the next date. With nothing needing a record: how many dates are coming up and the next one.
    const next = coming[0];
    const named = (i) => (farmer ? lower(i.text) : about(i.text)) + (i.due ? " (was due " + date(i.due) + calc(i) + ")" : "");
    // Sentence first means short: it names one (the first by date) and counts the rest; the promoted lines list them.
    const first = needs[0], firstSaid = !first ? null : needs.length === 1 ? named(first) : farmer ? "first: " + named(first) :
      "the first is " + named(first).replace(/^the first /i, "the ");
    const nextSaid = !next ? null : next.due > horizon ? "the next date on record is " + (next.verb === "lapses" ? "the lapse date" : next.verb === "expires" ? "the expiry of " + next.text : about(next.text)) + ", " + date(next.due) :
      farmer ? (next.verb === "expires" ? "next, " + date(next.due) + ": " + next.text + " expires" : "next, by " + date(next.due) + ": " + lower(next.text)) :
      next.verb === "expires" ? "next: " + next.text + " expires " + date(next.due) : next.verb === "lapses" ? "next: the lapse date, " + date(next.due) : "next due: " + about(next.text) + ", " + date(next.due);
    const decision = list(context.documents).find(isDecision);
    const answer = context.obligationsError ? null :
      needs.length ? { text: count(needs.length, "thing needs a record", "things need a record"), because: firstSaid + (nextSaid ? "; " + nextSaid : "") } :
      next ? { text: count(coming.length, "recorded date is coming up", "recorded dates are coming up"),
        because: next.due > horizon ? nextSaid : farmer ? nextSaid.replace(/^next/, "the next") : "the next is " + next.text + ", " + next.verb + " " + date(next.due) } :
      checklist.length ? { text: "No recorded dates are coming up", because: ongoing.length ? "what is recorded is practice to keep up" : ended.length ? "the dates on record have passed" : "the recorded conditions have no dates" } : null;
    // The body of All is the Checklist block. The map is handed the farm; a line whose condition records its place
    // (land units, or a theme the map draws) hands the map that place when it is chosen (places, by line id).
    const body = { block: "checklist", data: { today, items: checklist.map(({ detail, because, eligible, lead, ...rest }) => rest) } };
    const model = { key: "due", title: "What's due", rank: "given", items, answer, body, places, audience: farmer ? "farmer" : "advisor",
      total: checklist.length, scene: { farm: f, frame: "extent", area: null }, href: null, allLabel: "Everything recorded",
      // A farm with a consent decision on file but no conditions read in says that, not "nothing recorded".
      empty: { text: context.obligationsError ? "The condition dates couldn't be read." : decision ? "The consent's conditions haven't been read in yet; its decision is in Documents." : "Nothing recorded yet." },
      restricted: !checklist.length, currency: "As at " + date(today), farm: f };
    return farmer ? unmarked(model) : model;
  }

  // "What's changed": records added to the farm, newest first, from their recorded creation time. Records loaded
  // together when the farm was set up are not changes: BULK_LOAD or more with the same added day are one line saying
  // so, never promoted; what is promoted after that is a change since the load.
  const BULK_LOAD = 10;
  function changed(context) {
    const f = context.farm.id, today = context.today, since = addDays(today, -30), farmer = audienceOf(context) === "farmer";
    const records = [
      ...list(context.documents).map((d) => ({ id: "document-" + d.id, text: docTitle(d), href: href(f, "documents", d.id), added: day(d.created_at), kind: "document",
        primary: docTier(d).tier === "primary", source: ["Document", d.author_org || d.author].filter(Boolean).join(" · ") })),
      ...list(context.authorisations).map((a) => ({ id: "authorisation-" + a.id, text: farmer ? plainName(a) : authName(a), added: day(a.created_at), kind: "authorisation", primary: true, source: "Consent record" })),
    ];
    const perDay = new Map();
    for (const r of records) if (r.added) perDay.set(r.added, (perDay.get(r.added) || 0) + 1);
    const earliest = [...perDay.keys()].sort()[0];
    const loads = [...perDay].filter(([, n]) => n >= BULK_LOAD).map(([added, n]) => ({ added, n })).sort((x, y) => y.added.localeCompare(x.added));
    const loadDays = new Set(loads.map((l) => l.added));
    // "when the farm was set up" is only said of the first load, and only once it is older than the window: a load
    // inside the window is just "loaded on <date>", which is true whatever else the farm's history was.
    const loadWhat = (l) => l.n + " records", loadDid = (l) => "were loaded on " + date(l.added) + (l.added === earliest && l.added < since ? " when the farm was set up" : "");
    const real = records.filter((r) => !loadDays.has(r.added));
    const byNewest = (a, b) => String(b.added || "").localeCompare(String(a.added || "")) || a.id.localeCompare(b.id);
    const items = [...real, ...loads.map((l) => ({ id: "load-" + l.added, text: loadWhat(l) + " " + loadDid(l), what: loadWhat(l), did: loadDid(l), added: l.added, kind: "load" }))].sort(byNewest);
    for (const i of items) {
      i.detail = i.kind === "load" ? null : i.added ? "added " + date(i.added) : "date added not recorded";
      if (i.primary && i.added && i.added >= since && i.added <= today) { i.eligible = true; i.because = "added " + date(i.added); }
    }
    const recent = real.filter((r) => r.added && r.added >= since && r.added <= today).sort(byNewest), latest = real.filter((r) => r.added).sort(byNewest)[0];
    // A bulk load inside the window is reported as that, whatever else the farm holds: "nothing was added" would be untrue.
    const recentLoad = loads.find((l) => l.added >= since && l.added <= today);   // newest first
    const alsoLoaded = recentLoad ? "; " + recentLoad.n + " more " + loadDid(recentLoad) : "";
    const answer = recent.length ? { text: count(recent.length, "record was added in the last 30 days", "records were added in the last 30 days"), because: "the latest is " + recent[0].text + ", added " + date(recent[0].added) + alsoLoaded } :
      recentLoad ? { text: recentLoad.n + " records " + loadDid(recentLoad), because: real.length ? "nothing else has been added since" : "nothing has been added since" } :
      latest ? { text: "Nothing was added in the last 30 days", because: "the latest record is " + latest.text + ", added " + date(latest.added) } :
      loads.length ? { text: loads[0].n + " records " + loadDid(loads[0]), because: "nothing has been added since" } : null;
    // The body of All is the Timeline block: one sentence per change, with the date it was added and what it came from.
    const body = { block: "timeline", data: { today, items: items.map((i) => i.kind === "load" ? { id: i.id, kind: "documents", date: i.added, what: i.what, did: i.did, source: "Loaded together" } :
      { id: i.id, kind: i.kind === "document" ? "documents" : "authorisations", date: i.added, what: i.text, did: "was added", href: i.href, source: i.source }) } };
    // The load and nothing since: one sentence, no list behind it.
    const model = { key: "changed", title: "What's changed", rank: "given", items, answer, body, href: null, allLabel: "Everything recorded",
      empty: { text: "Nothing recorded yet." }, restricted: !items.length || (!real.length && loads.length > 0), currency: "As at " + date(today), farm: f };
    return farmer ? unmarked(model) : model;
  }

  // The standing questions whose answers show when a farm opens, curated for who is reading (audienceOf).
  const standingAnswers = (context) => [due(context), changed(context)];

  // The features on a farm's map that a place names: its land units by code, and the farm layers and reference
  // features of its themes ("waterways", "wells"). None on this map: an empty list, and the map stays where it is.
  function placeFeatures(scene, place) {
    const s = scene || {}, p = place || {}, codes = new Set(list(p.land_units)), themes = new Set(list(p.themes));
    const drawn = (fc) => list(fc?.features).filter((x) => x?.geometry?.coordinates);
    return [...drawn(s.land_units).filter((x) => codes.has(x.properties?.code)),
      ...list(s.layers).filter((l) => l.theme !== "land_units" && themes.has(l.theme)).flatMap((l) => drawn(l.features)),
      ...list(s.reference).filter((r) => themes.has(r.theme)).flatMap((r) => drawn(r.features))];
  }

  // Documents: the one sentence over the Documents block (blocks/documents.js). It names the first document in the
  // block's own order (on most farms, its environment plan) and counts the rest, so the headline and the list never
  // disagree; it says "main document", never "plan" (APP-STRUCTURE §3.6). arranged is that block's arrange() of the
  // same documents: the order is never worked out twice. Without it (the block not loaded) the sentence only counts.
  function documents(context, arranged) {
    const docs = list(context.documents), items = docs.map((d) => ({ id: d.id, text: docTitle(d) }));
    const n = (k) => list(arranged?.[k]).length;
    let answer = null;
    if (docs.length && arranged) {
      const mains = [...list(arranged.primaries), ...list(arranged.more)], first = mains[0];
      const supporting = mains.reduce((t, p) => t + list(p.children).length, 0) + n("loose"), archived = n("archive");
      if (first) {
        const d = first.doc, when = monthYear(d.date_prepared);
        const rest = [mains.length > 1 ? (mains.length - 1) + " more main " + (mains.length === 2 ? "document" : "documents") : null,
          supporting ? supporting + " supporting" : null].filter(Boolean);
        answer = { text: "The main document is " + docTitle(d) + (when ? ", " + when : ""),
          because: rest.length ? rest.join(" and ") : archived ? "the rest " + (archived === 1 ? "is" : "are") + " archived" : "nothing else is recorded" };
      } else answer = { text: count(docs.length, "document is recorded", "documents are recorded"), because: "none is a main document yet" };
    } else if (docs.length) answer = { text: count(docs.length, "document is recorded", "documents are recorded"), because: "the main ones lead the list" };
    // No All: the Documents block under the sentence is the list.
    return { key: "documents", title: "Documents", items, answer, rank: "given", empty: { text: "Nothing recorded yet." }, restricted: true };
  }

  // The one plain line under a land unit's name and area on the map: where the map came from, who drew it and when.
  // Built only from what the layer records (its source, its class and the qualifier that goes with it); the way the
  // features were extracted (container, filter) and the survey scale are not for the reader.
  const monthYear = (d) => isDate(d) ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-NZ", { month: "short", year: "numeric", timeZone: "UTC" }) : null;
  const isoTail = /[\s,]*(\d{4}-\d{2}-\d{2})$/;
  function sourceLine(layer) {
    const l = layer || {}, shown = String(l.shown_as || "").trim(), source = String(l.source || "").trim();
    const from = (what, by, when) => what || by || when ? ["From " + (what || "the farm's map"), by ? "drawn by " + by : null, when].filter(Boolean).join(", ") + "." : null;
    if (l.epistemic_class === "assessment") {
      const m = shown.match(/^(.*), ([A-Z][a-z]{2} \d{4})$/);
      return from(source, m ? m[1] : shown, m ? m[2] : monthYear(l.as_at));
    }
    if (l.epistemic_class === "interpretation") {
      // "<model> <version>, <scale> scale, <confidence>": keep the model and a dated version, drop the scale and confidence.
      const head = (shown.split(", ")[0] || "").trim(), v = head.match(isoTail);
      return from(v ? head.replace(isoTail, "") : head || source, null, v ? monthYear(v[1]) : monthYear(l.as_at));
    }
    if (l.epistemic_class === "designation") return shown ? shown[0].toUpperCase() + shown.slice(1) + "." : null;
    return source ? from(source, null, monthYear(l.as_at)) : null;
  }

  // The one plain sentence for a feature the database has placed beside, or trimmed against, another layer
  // (public.farm_map's `resolution` and `resolution_reason`). Null when none applies or the value is unknown: a raw code is never shown.
  function resolutionLine(props) {
    const p = props || {};
    if (p.resolution === "trimmed") return "Shown only where no more detailed map covers it.";
    if (p.resolution !== "beside") return null;
    if (p.resolution_reason === "official_governs") return "Shown beside the official layer, which governs here.";
    if (p.resolution_reason === "designation_stands") return "Shown beside the official designation, which stands.";
    return "Shown beside the official layer.";
  }

  // ---- The layers drawer: one plain name for each layer ------------------------------------------------
  // The drawer says what a layer shows ("Rivers"), not what it was called when it was loaded ("NZ River Centrelines
  // (Topo, 1:50k) (LINZ)"); the one line under it is sourceLine().
  const THEME_NAMES = { land_units: "Land units", plantings: "Plantings", fences: "Fences", photos: "Photos", measurements: "Measurements", contaminant_sources: "Contaminant sources",
    wells: "Bores", consents: "Consents nearby", wetlands: "Wetlands", soils: "Soils", luc: "Land use capability", parcels: "Titles", actions: "Actions" };
  const NAME_RULES = [[/river centrelines?|\bwaterways?\b/i, "Rivers"], [/river environment classification|\bREC\d?\b/i, "River classes"], [/resource consents?/i, "Consents nearby"],
    [/\b(?:wells?|bores?)\b/i, "Bores"], [/\bwetlands?\b/i, "Wetlands"], [/\bs-?map\b|^soils?\b/i, "Soils"], [/land use capability|\bLUC\b/i, "Land use capability"]];
  function layerName(layer) {
    const l = layer || {}, raw = String(l.name || "").trim();
    if (THEME_NAMES[l.theme]) return THEME_NAMES[l.theme];
    const hit = NAME_RULES.find(([re]) => re.test(raw));
    if (hit) return hit[1];
    // otherwise the title less its source in brackets, version and sub-title
    let t = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+v\d+(?:\.\d+)*\b/gi, "").replace(/\s+[-\u2013]\s+.*$/, "").replace(/\s+/g, " ").trim() || raw;
    if (t && t === t.toUpperCase() && /[A-Z]/.test(t)) t = t[0] + t.slice(1).toLowerCase();
    return t || "Layer";
  }
  // The heading over layers made for a job: sentence case, never shouted.
  function jobHeading(job) {
    const n = String((job || {}).name || "").trim(), t = n && n === n.toUpperCase() ? n[0] + n.slice(1).toLowerCase() : n;
    return t ? "Made for " + t : "Made for a job";
  }
  // Submit a question on Enter; Shift+Enter (and anything mid-composition) stays a new line.
  const entersToSubmit = (e) => !!e && e.key === "Enter" && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229;   // 229: Safari ends a composition with isComposing already false

  // Which map labels can be drawn without touching another. items are in priority order, each with the screen
  // box of its label and of its dot ({x, y, w, h}); a label is dropped when it would overlap a label already
  // kept, or another farm's dot. Returns one boolean per item.
  function labelsToShow(items, gap = 4) {
    const hit = (a, b) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
    const kept = [];
    return items.map((it, i) => {
      const clash = kept.some((k) => hit(it.label, k)) || items.some((o, j) => j !== i && o.dot && hit(it.label, o.dot));
      if (!clash) kept.push(it.label);
      return !clash;
    });
  }

  // Which land units keep their name on the map. Every unit always keeps its code (LU1...); the name goes when it
  // would touch a name already kept or another unit's code. The largest unit is looked at first, so it keeps its
  // name longest. items are {area, full, code}: the unit's label box with its name, and its code's box alone
  // ({x, y, w, h}, screen px). Returns one boolean per item, in the order given: true when the name stays.
  function unitNames(items, gap = 4) {
    const order = items.map((it, i) => i).sort((a, b) => (Number(items[b].area) || 0) - (Number(items[a].area) || 0) || a - b);
    const keep = labelsToShow(order.map((i) => ({ label: items[i].full, dot: items[i].code })), gap), out = [];
    order.forEach((i, n) => { out[i] = keep[n]; });
    return out;
  }

  // One sentence per farm for the portfolio, from farm_summaries (0038) counts alone.
  function summaryLine(s) {
    const overdue = Number(s.overdue_actions) || 0, auths = Number(s.authorisation_count) || 0, docs = Number(s.document_count) || 0;
    if (overdue) return count(overdue, "action is past its recorded date.", "actions are past their recorded dates.");
    const parts = [auths ? (auths === 1 ? "1 authorisation" : auths + " authorisations") : null, docs ? (docs === 1 ? "1 document" : docs + " documents") : null].filter(Boolean);
    return parts.length ? parts.join(" and ") + " recorded." : "Nothing recorded yet.";
  }
  // The same sentence from an opened farm's own reads.
  const portfolioLine = (context) => summaryLine({ authorisation_count: list(context.authorisations).length, document_count: list(context.documents).length });

  // People on a farm (farm_people rows), for its owner and admins. Owners are changed through RCL (A1), and
  // nobody changes or removes themselves here, so neither row offers those controls.
  const roles = [["view", "View"], ["edit", "Edit"], ["admin", "Admin"]];
  const roleNames = { owner: "Owner", admin: "Admin", edit: "Edit", view: "View" };
  const canManage = (role) => role === "owner" || role === "admin";
  function people(rows, today) {
    return list(rows).map((r) => ({
      id: r.user_id, email: r.email || "No email recorded", name: r.display_name || null, role: r.role, roleName: roleNames[r.role] || r.role,
      you: !!r.is_you, editable: r.role !== "owner" && !r.is_you,
      note: [r.is_you ? "you" : null, r.signed_in === false ? "hasn't signed in yet" : null,
        isDate(r.added_at) && day(r.added_at) !== today ? "added " + date(r.added_at) : isDate(r.added_at) ? "added today" : null].filter(Boolean).join(" · "),
    }));
  }

  // Phone: how far a bottom sheet reaches up over the map canvas, in px (0 when the sheet is a closed peek or the layout is wide).
  // The map frames the farm in what is left above it.
  const sheetOverlap = (canvasBottom, sheetTop) => (Number.isFinite(canvasBottom) && Number.isFinite(sheetTop) ? Math.max(0, Math.round(canvasBottom - sheetTop)) : 0);
  // The padding that keeps a farm extent clear of the sheet (and of the map's own controls).
  const sheetPadding = (overlap) => ({ top: 40, left: 40, right: 40, bottom: overlap > 0 ? overlap + 20 : 40 });
  // Where a farm sits when its view opens. Phone: clear of the sheet. Wide: the panel is beside the map, not over
  // it, so only the map's own controls count (zoom buttons down the right edge, scale and attribution along the bottom).
  const CONTROL_INSET = { right: 16, bottom: 28 };
  function framePadding(overlap, wide) {
    if (!wide) return sheetPadding(overlap);
    const p = sheetPadding(0);
    return { top: p.top, left: p.left, right: p.right + CONTROL_INSET.right, bottom: p.bottom + CONTROL_INSET.bottom };
  }
  // A flight that starts on a larger canvas than the farm will have (the portfolio fills the window, a farm leaves
  // room for its header and panel) pads by half the difference as well: the camera keeps its centre when the canvas
  // shrinks, so the farm then lands where it would have been framed on the smaller canvas.
  function flightPadding(pad, from, to) {
    const dx = Math.max(0, ((from.width || 0) - (to.width || 0)) / 2), dy = Math.max(0, ((from.height || 0) - (to.height || 0)) / 2);
    return { top: pad.top + dy, left: pad.left + dx, right: pad.right + dx, bottom: pad.bottom + dy };
  }
  // Once the camera has stopped: does the farm's box (canvas px: left, top, right, bottom) lie inside the canvas less
  // its padding? If not, say how far to zoom (log2, never in) and which canvas point to bring to the centre so that it
  // does. Null when it fits, within a pixel and a half.
  function frameFix(box, size, pad, tolerance = 1.5) {
    if (!box || !size || ![box.left, box.top, box.right, box.bottom, size.width, size.height].every(Number.isFinite)) return null;
    const left = pad.left, top = pad.top, right = size.width - pad.right, bottom = size.height - pad.bottom, w = box.right - box.left, h = box.bottom - box.top;
    if (!(w > 0) || !(h > 0) || right <= left || bottom <= top) return null;
    if (box.left >= left - tolerance && box.right <= right + tolerance && box.top >= top - tolerance && box.bottom <= bottom + tolerance) return null;
    const scale = Math.min(1, (right - left) / w, (bottom - top) / h), centre = [size.width / 2, size.height / 2];
    const want = [(left + right) / 2, (top + bottom) / 2], at = [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
    return { zoom: Math.log2(scale), at: [at[0] - (want[0] - centre[0]) / scale, at[1] - (want[1] - centre[1]) / scale] };
  }
  // The header's account button: initials of the person's name, else the first letter of their email.
  const initials = (name, email) => {
    const words = String(name || "").split(/\s+/).filter(Boolean);
    const letters = words.length ? words.slice(0, 2).map((w) => [...w][0]).join("") : [...String(email || "").trim()][0] || "";
    return letters.toUpperCase();
  };

  return { views, otherViews, sheetOverlap, sheetPadding, framePadding, flightPadding, frameFix, docClass, docTier, docKind, docTitle, DOC_TIERS, DOC_TYPES, layerName, jobHeading, entersToSubmit, initials, viewLabel, outputs, match, href, date, standingAnswers, audienceOf, placeFeatures, documents, summaryLine, portfolioLine, sourceLine, resolutionLine, labelsToShow, unitNames, roles, canManage, people };
});
