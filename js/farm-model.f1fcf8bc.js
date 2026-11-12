// Farm-space routes and the models the answer component renders. No DOM, network or clock: "today" is passed in.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./consent-no.js") : root.FP.consentNo);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmModel = api;
})(typeof window === "undefined" ? globalThis : window, function (CN) {
  const root = typeof window === "undefined" ? globalThis : window;
  const list = (v) => Array.isArray(v) ? v : [];
  // LK4/LK3a: a theme read as its kind (layer-kinds.js), so an old name and its new one are the same thing during the rename
  const kindOf = (t, g) => { const K = typeof module === "object" && module.exports ? require("./layer-kinds.js") : root.FP?.kinds; return (K && K.kindOf(t, g)) || t; };
  // A farm space is a map with three things you can do (docs/PRODUCT-BRIEF.md "AI is the interface").
  const views = [["maps", "Maps"], ["ask", "Ask"], ["create", "Create"], ["documents", "Files"]];
  const outputs = [["fep", "Farm Environment Plan"], ["fwfp", "Freshwater Farm Plan"], ["consent", "Consent summary"],
    ["nzfap", "NZFAP+ walkthrough"], ["catchment", "Catchment story"]];
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10)));
  const date = (d) => isDate(d) ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "date not recorded";
  const day = (d) => isDate(d) ? d.slice(0, 10) : null;
  const addDays = (d, n) => new Date(Date.parse(d.slice(0, 10) + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  // Places reached from the header rather than the three actions: People is for a farm's owner and admins.
  // Onboarding (ON1) is reached from the command bar and from Documents.
  const otherViews = [["people", "People"], ["onboarding", "Onboarding"]];
  const viewLabel = (key) => [...views, ...otherViews].find(([k]) => k === key)?.[1] || null;
  const href = (f, view, id) => "#/farm/" + f + (view && view !== "map" ? "/" + view : "") + (id ? "?item=" + encodeURIComponent(id) : "");
  function match(hash) {
    const m = String(hash || "").match(/^#\/farm\/([0-9a-f-]{36})(?:\/(maps|ask|create|documents|people|onboarding))?(?:\?item=([^&#]+))?$/);
    try { return m ? { farm: m[1], view: m[2] || "map", item: m[3] ? decodeURIComponent(m[3]) : null } : null; } catch { return null; }
  }
  // A consent's or document's title as the app quotes it in a sentence or a line: without the full stop its record may
  // end with ("To use land for farming activity." -> "To use land for farming activity").
  const title = (t) => String(t ?? "").trim().replace(/\s*\.+$/, "");
  // A rule's reference as written in the plan ("LWRP Rule 5.41"). A placeholder ("Rule 0.0", "TBC", anything marked
  // synthetic) is not a reference: it is never quoted, and a rule that has no other is not shown as a change (#241).
  const PLACEHOLDER_REF = /^(?:(?:rule|r)\s*)?0+(?:[.\-\s]0+)*$|^(?:tbc|tbd|n\/?a|none|unknown|placeholder|-+)$|synthetic/i;
  const ruleRef = (a) => { const r = typeof a?.rule_ref === "string" ? a.rule_ref.trim() : ""; return r && !PLACEHOLDER_REF.test(r) ? r : null; };
  const authName = (a) => [a.consent_no || ruleRef(a), title(a.title)].filter(Boolean).join(" · ") || "Recorded authorisation";
  const count = (n, one, many) => (n === 1 ? "One " + one : n + " " + many);
  const docKinds = { fep: "Farm Environment Plan", fwfp: "Freshwater Farm Plan", plan_issue: "Issued version", onboarding_report: "Onboarding report", consent_decision: "Consent decision", consent_application: "Consent application",
    overseer_report: "Nutrient budget", memo: "Notes", aee: "Assessment of environmental effects", luc_report: "Land use capability report",
    ghg_report: "Greenhouse gas report", consent_correspondence: "Consent correspondence", correspondence: "Correspondence",
    smap_factsheet: "S-map soil fact sheet", gis_artifact: "Map extract", map_extract: "Map extract", fep_audit: "FEP audit", nzfap_checklist: "NZFAP+ checklist", land_unit_map: "Land unit map",
    image: "Photo or image", other: "Other" };
  const docKind = (k) => docKinds[k] || (k ? String(k).replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : null);

  // ---- Documents: what matters first --------------------------------------------------------------------
  // The tier a document sits in comes from what the record says it is: its type, then its title. When the database
  // carries a tier (F1e) a "supporting" or "archive" there is kept; its "primary" is also what every existing
  // document was given, so it decides nothing and the type and title still do. Pure: a documents row in, out comes
  // { tier: "primary" | "supporting" | "other", rank, kind, fold }; rank orders within a tier (lower first), fold
  // names the quiet group a run of the same kind is folded into.
  const DOC_TIERS = [["primary", "Main files"], ["supporting", "Supporting"], ["other", "Other"]];
  const DOC_TYPES = {
    fep: ["primary", 0], fwfp: ["primary", 0], farm_environment_plan: ["primary", 0], freshwater_farm_plan: ["primary", 0], plan_issue: ["primary", 0],
    consent_decision: ["primary", 1], consent_application: ["primary", 1], consent: ["primary", 1], aee: ["primary", 1], nzfap_checklist: ["primary", 1],
    overseer_report: ["primary", 2], nutrient_budget: ["primary", 2], land_unit_map: ["primary", 3], farm_map: ["primary", 3],
    luc_report: ["primary", 4], ghg_report: ["primary", 4], onboarding_report: ["primary", 5],
    consent_correspondence: ["supporting", 0], correspondence: ["supporting", 0], memo: ["supporting", 1], fep_audit: ["supporting", 0],
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
  // A digitising or georeferencing record (how a map was brought in, "… (pilot)") is background to the plan, not a main
  // document (#223): supporting, unless the farm has no plan, when it may be the only map there is.
  const DIGITISING = /\bdigiti[sz]|georeferenc|\bpilot\b/i;
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
  function docTier(d, hasChildren = false, planExists = true) {
    const row = d || {}, stored = String(row.tier || "").toLowerCase(), c = docClass({ ...row, tier: null });
    const kind = String(row.doc_type || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
    if (planExists && c.tier === "primary" && ["gis_artifact", "map_extract"].includes(kind) && DIGITISING.test(String(row.title || ""))) [c.tier, c.rank] = ["supporting", 3];
    const weight = c.tier === "primary" ? c.rank : 5, fold = DOC_FOLDS[String(row.doc_type || "").toLowerCase().trim().replace(/[\s-]+/g, "_")] || null;
    if (stored === "archive" || row.status === "superseded") return { tier: "archive", weight, fold, chosen: stored === "archive" };
    if (stored === "supporting") return { tier: "supporting", weight, fold, chosen: true };
    if (stored === "primary" && (row.tiered_at || hasChildren)) return { tier: "primary", weight, fold: null, chosen: true };
    return { tier: c.tier === "primary" ? "primary" : "supporting", weight, fold: c.tier === "primary" ? null : fold, chosen: false };
  }
  // The farm's plan among its documents: a main document of the plan kind (its FEP or FWFP). Selecting it in Documents
  // brings the FEP's layers onto the map (E5).
  const isPlan = (d) => { const t = docTier(d); return t.tier === "primary" && t.weight === 0; };
  // The kind of document a condition's record is, from what the condition says it needs; null leaves the guess to the form.
  const recordKind = (needs) => /\baudit/i.test(needs || "") ? "fep_audit" : /nutrient|nitrogen|overseer/i.test(needs || "") ? "overseer_report" : null;
  // A correspondence record titled only by a code ("<consent no> information 3") is shown as what it is: its kind,
  // the consent it is about and the date it was prepared (or its number in the run when it has no date).
  const CODE_TITLE = /^\s*([A-Z]{2,5}\s?\d{4,}[A-Z]?)((?:\s+(?:further|additional|information|info|response|request|reply|letter|e-?mail|correspondence|s\.?\s?92))+)[\s#.,-]*(\d+)?[\s.]*$/i;
  function docTitle(d) {
    const t = title((d || {}).title), m = t.match(CODE_TITLE);
    if (!m) return t || "File";
    const kind = docKind(d.doc_type) || "Correspondence", when = day(d.date_prepared);
    return kind + " for " + m[1].replace(/\s/g, "").toUpperCase() + (when ? ", " + date(when) : m[3] ? ", no. " + m[3] : "");
  }

  // Why a condition is on the list, in the words of the record: the consent or rule that requires it and the condition
  // number. A condition the record doesn't link to an authorisation says so instead of leaving the line bare. A code
  // that isn't a condition number (a consent's lapse date) names the consent alone.
  const conditionCode = (o) => (o.code && /^\d/.test(o.code) ? o.code : null);
  const obligationReason = (o, a) => {
    const code = conditionCode(o) ? "condition " + o.code : null;
    if (a) return "required by " + (a.consent_no || ruleRef(a) || title(a.title) || "a recorded authorisation") + (code ? ", " + code : "");
    return (code ? "from " + code : "from a recorded condition") + ", consent not recorded";
  };
  const params = (o) => (o.parameters && typeof o.parameters === "object" && !Array.isArray(o.parameters) ? o.parameters : {});
  const words = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
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
    return t && !/\.$/.test(t) ? t : a.consent_no ? "Consent " + a.consent_no : title(t) || ruleRef(a) || "Recorded authorisation";
  };
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
    (!d.doc_type && /\bdecision\b/i.test(d.title || "") && (/\bconsent\b|\b[A-Z]{3}\d{6}\b/i.test(d.title || "") || CN.find(d.title).length > 0));

  // "What's due": the farm's conditions as a checklist (what needs a record before anything can be said, dates
  // coming up, ongoing practice), with authorisation expiry dates and consents whose conditions aren't recorded.
  // Ordered by consequence: the sentence names what needs a record first, then the next date; its counts are the
  // checklist's own. Promoted lines are what needs a record (the dated first), then the next date, each one line
  // ("Have the first FEP audit done · due 15 Jan 2026 · no record") whose fold holds the consent, condition, basis and
  // wording; the practice to keep up and what the FEP must contain are two quiet folds under them. A condition marked
  // done (a met, unsuperseded check) or with a record linked to it (an entry linking it to a document) has left what
  // needs a record. The advisor's sentence cites, the farmer's reads the action and its date. Nothing is inferred.
  // FEP: the plan as Josh and the farm's people name it, in every line and sentence here.
  const fep = (t) => String(t ?? "").replace(/\bFarm Environment Plan\b/g, "FEP");
  // A consent's lapse date matters only while it is unused: it is shown when the consent starts in the future or the
  // record says it has not been used (parameters.exercised === false); otherwise it sits in Everything recorded only.
  const lapseMatters = (o, a, today) => params(o).exercised === false || (!!a && !!day(a.valid_from) && day(a.valid_from) > today);
  // A plan-content item (an appendix's list of what the plan must hold, under its condition): not a thing that needs a record.
  const isPlanContent = (o) => o.kind === "plan_content" && !!words(params(o).part_of);
  // Records from entry_links rows: an entry linked to a condition and to a document records that condition with it.
  function recordLinks(links) {
    const by = new Map();
    for (const l of list(links)) {
      if (!l?.entry_id) continue;
      if (!by.has(l.entry_id)) by.set(l.entry_id, { obligations: [], documents: [] });
      if (l.obligation_id) by.get(l.entry_id).obligations.push(l.obligation_id);
      if (l.document_id) by.get(l.entry_id).documents.push(l.document_id);
    }
    return [...by.values()].flatMap((e) => e.obligations.flatMap((obligation_id) => e.documents.map((document_id) => ({ obligation_id, document_id }))));
  }
  function due(context) {
    const f = context.farm.id, today = context.today, horizon = addDays(today, 365), auths = list(context.authorisations), obligations = list(context.obligations);
    const farmer = audienceOf(context) === "farmer", name = farmer ? plainName : authName;
    const byId = new Map(auths.map((a) => [a.id, a])), docs = new Map(list(context.documents).map((d) => [d.id, d]));
    // Done (a met check that nothing has superseded) and records (a document linked to the condition), by obligation id.
    const doneOn = new Map(), recordOf = new Map();
    // the day it was marked done is the farm's (New Zealand) day, not UTC's: a tick at 9 am on 31 Oct reads 31 Oct
    const nzDay = (v) => { const t = Date.parse(v), d = Number.isFinite(t) ? new Date(t).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }) : null; return isDate(d) ? d : day(v); };
    for (const c of list(context.checks)) if (c?.obligation_id && c.status === "met" && !c.superseded_at && day(c.created_at)) {
      const d = nzDay(c.created_at); if (!doneOn.has(c.obligation_id) || doneOn.get(c.obligation_id) < d) doneOn.set(c.obligation_id, d);
    }
    for (const r of list(context.records)) { const d = r && docs.get(r.document_id); if (d && !recordOf.has(r.obligation_id)) recordOf.set(r.obligation_id, d); }
    const source = (o) => {
      const d = o.source_document_id && docs.get(o.source_document_id), page = Number.isInteger(o.source_page) ? "page " + o.source_page : null;
      return d ? [title(d.title) || "Source file", page].filter(Boolean).join(", ") : page ? "Source " + page : null;
    };
    // What the plan must contain (Appendix B under condition 7) is its own fold, not a part of that condition's line.
    const contents = obligations.filter(isPlanContent).sort((x, y) => String(x.code).localeCompare(String(y.code), "en", { numeric: true }));
    const checklist = [], places = {}, auth = new Map(), quiet = new Set();
    for (const o of obligations) {
      if (isPlanContent(o)) continue;
      const a = byId.get(o.authorisation_id), p = params(o), s = schedule(o), id = "obligation-" + o.id;
      if (placeOf(o)) places[id] = placeOf(o);
      auth.set(id, a);
      if (o.code === "lapse" && !lapseMatters(o, a, today)) quiet.add(id);
      const record = recordOf.get(o.id);
      checklist.push({ id, obligation_id: String(o.id), consent: a ? a.consent_no || ruleRef(a) || null : null, text: fep(o.summary || "Recorded condition"), reason: obligationReason(o, a),
        state: s.state === "dated" ? undefined : s.state, due: s.due || null, verb: o.code === "lapse" ? "lapses" : "due",
        repeats: words(o.recurrence), needs: words(p.needs_record), basis: s.due ? words(p.due_basis) : null,
        note: [s.due && words(p.due_basis) ? "Calculated: " + lower(words(p.due_basis)) : null, words(p.note), words(p.flag)].filter(Boolean).join(" ") || null,
        wording: words(o.full_text), source: source(o),
        ...(record ? { record: { title: docTitle(record), href: href(f, "documents", record.id) } } : doneOn.has(o.id) ? { done_on: doneOn.get(o.id) } : {}),
        detail: [a ? name(a) : null, conditionCode(o) ? "condition " + o.code : null, s.due ? (s.due < today ? "was due " : "due ") + date(s.due) : null, o.recurrence].filter(Boolean).join(" · ") });
    }
    for (const a of auths) {
      const when = day(a.valid_to), code = a.consent_no || ruleRef(a);
      // A consent with none of its conditions recorded says so: on its expiry line, or on a line of its own.
      const bare = a.kind === "consent" && !obligations.some((o) => o.authorisation_id === a.id), unrecorded = "Its conditions aren't recorded yet.";
      // A consent with none of its conditions recorded can fetch them from ECan (CC1): on its own line, or its expiry line. FC1: any
      // form ECAN1's pattern recognises (consent-no.js), which ECan's portal answers; the number as the functions key the farm's
      // consents (trimmed, upper case), so a fetched proposal is for this very consent.
      const fetch = bare && CN.CONSENT_NO.test(String(a.consent_no || "").trim().toUpperCase()) ? { fetch_consent: String(a.consent_no).trim().toUpperCase() } : {};
      if (when) checklist.push({ id: "expiry-" + a.id, consent: code || null, text: name(a), reason: farmer && code ? "the expiry date of " + code : "the consent's expiry date", due: when, verb: "expires",
        note: bare ? unrecorded : null, ...fetch, detail: (when < today ? "expired " : "expires ") + date(when) });
      else if (bare) checklist.push({ id: "conditions-" + a.id, text: "Conditions of " + (farmer ? lower(name(a)) : name(a)), reason: "the consent is recorded, its conditions aren't yet", state: "unknown",
        needs: "the consent's conditions", ...fetch, detail: "conditions not recorded" });
    }
    const stateOf = (i) => (i.record || i.done_on ? "done" : i.state === "ongoing" ? "ongoing" : i.due ? (i.due < today ? "passed" : "due") : "unknown");
    const byDate = (a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id), byText = (a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id);
    // The checklist's own groups, so the sentence's counts are the ones under it. A lapse date that doesn't matter
    // (the consent is in use) is in the checklist and nowhere up front.
    const coming = checklist.filter((i) => stateOf(i) === "due" && !quiet.has(i.id)).sort(byDate);
    const passed = checklist.filter((i) => stateOf(i) === "passed").sort(byDate);
    const needs = [...passed.filter((i) => i.verb === "due"), ...checklist.filter((i) => stateOf(i) === "unknown").sort(byText)];
    const ended = passed.filter((i) => i.verb !== "due");
    const ongoing = checklist.filter((i) => stateOf(i) === "ongoing");
    const calc = (i) => (i.basis ? ", calculated" : "");
    // Each promoted line's reason (what the fold opens on): where it stands and the consent and condition that require it.
    for (const i of [...coming, ...needs]) i.because = i.id.startsWith("conditions-") ? i.reason : i.reason || i.detail;
    // Promoted, at most three, by consequence: what needs a record (a passed date first, and a second passed date
    // with it), the next date; then more of each. A date more than a year off is never a promoted line: the sentence
    // names it ("the next date on record is …") and Everything recorded lists it (E5b).
    const near = coming.filter((i) => i.due <= horizon);
    const promoted = [...new Set([needs[0], needs[1]?.due ? needs[1] : null, near[0], ...needs.slice(1), ...near.slice(1)])]
      .filter((i) => i && i.because).slice(0, 3);
    for (const i of promoted) i.eligible = true;
    const items = [...new Set([...promoted, ...needs, ...coming, ...ended, ...ongoing])].map(({ id, text, because, eligible, detail }) => ({ id, text, because, eligible: !!eligible, detail }));
    // The sentence: how many things need a record and the first of them by name (with the date it was due), then
    // the next date. With nothing needing a record: how many dates are coming up and the next one.
    const next = coming[0];
    const named = (i) => (farmer ? lower(i.text) : about(i.text)) + (i.due ? " (was due " + date(i.due) + calc(i) + ")" : "");
    // Sentence first means short: it names one (the first by date) and counts the rest; the promoted lines list them.
    const first = needs[0], firstSaid = !first ? null : needs.length === 1 ? named(first) : farmer ? "first: " + named(first) :
      "the first is " + named(first).replace(/^the first /i, "the ");
    // a far date: "the next date on record is 1 Jan 2035, when CRC251894 expires" (or lapses)
    const ends = (i) => (i.verb === "expires" || i.verb === "lapses") && (i.consent || i.verb === "expires") ? ", when " + (i.consent || i.text) + " " + i.verb : null;
    const nextSaid = !next ? null : next.due > horizon ? "the next date on record is " + (ends(next) ? date(next.due) + ends(next) : about(next.text) + ", " + date(next.due)) :
      farmer ? (next.verb === "expires" ? "next, " + date(next.due) + ": " + next.text + " expires" : "next, by " + date(next.due) + ": " + lower(next.text)) :
      next.verb === "expires" ? "next: " + next.text + " expires " + date(next.due) : next.verb === "lapses" ? "next: the lapse date, " + date(next.due) : "next due: " + about(next.text) + ", " + date(next.due);
    const decision = list(context.documents).find(isDecision);
    const answer = context.obligationsError ? null :
      needs.length ? { text: count(needs.length, "thing needs a record", "things need a record"), because: firstSaid + (nextSaid ? "; " + nextSaid : "") } :
      next ? { text: count(coming.length, "recorded date is coming up", "recorded dates are coming up"),
        because: next.due > horizon ? nextSaid : farmer ? nextSaid.replace(/^next/, "the next") : "the next is " + next.text + ", " + next.verb + " " + date(next.due) } :
      checklist.length ? { text: "No recorded dates are coming up", because: ongoing.length ? "what is recorded is practice to keep up" : ended.length ? "the dates on record have passed" : "the recorded conditions have no dates" } : null;
    // Who may mark a condition done (a check) and add its record (a document linked through an entry): the farm's
    // editors (a view-only member reads); adding a document also needs the database's tiers (B3).
    const editor = ["owner", "admin", "edit"].includes(context.role);
    // Fetch conditions from ECan (CC1): the farm's editors, on a consent with none recorded (the function checks the same).
    const record = { can_tick: editor, can_attach: editor && context.documentTiers === "chosen", can_fetch: editor };
    const rows = checklist.map(({ detail, because, eligible, ...rest }) => rest), ofIds = (ids) => rows.filter((r) => ids.has(r.id));
    // The promoted lines and the folds are drawn by the Checklist block (one line each, the line opens its fold); the
    // body of All is the Checklist block too, with what is done or recorded shown. The map is handed the farm; a line
    // whose condition records its place (land units, or a theme the map draws) hands the map that place when it is
    // chosen (places, by line id).
    // Done sits on the line itself (inline_done): one tap on a phone (#257). A need the three promoted lines leave out is
    // behind "and N more", one tap, so the headline's count is the lines shown plus the "more" (#257).
    const lines = { block: "checklist", data: { today, items: ofIds(new Set(promoted.map((i) => i.id))) }, options: { group: "none", inline_done: true, ...record } };
    const more = needs.filter((i) => !promoted.includes(i));
    const contentRows = contents.map((o) => ({ id: "obligation-" + o.id, text: fep(o.summary || "Recorded condition"), reason: obligationReason(o, byId.get(o.authorisation_id)),
      state: "ongoing", wording: words(o.full_text), source: source(o) }));
    const folds = [
      more.length ? { key: "more", label: "and " + more.length + " more",
        body: { block: "checklist", data: { today, items: ofIds(new Set(more.map((i) => i.id))) }, options: { group: "none", inline_done: true, ...record } } } : null,
      ongoing.length ? { key: "practices", label: count(ongoing.length, "practice to keep up", "practices to keep up"),
        body: { block: "checklist", data: { today, items: ofIds(new Set(ongoing.map((i) => i.id))) }, options: { group: "none" } } } : null,
      contentRows.length ? { key: "fep-contents", label: "What the FEP must contain (" + contentRows.length + ")",
        body: { block: "checklist", data: { today, items: contentRows }, options: { group: "none" } } } : null].filter(Boolean);
    const body = { block: "checklist", data: { today, items: rows }, options: { show_done: true, ...record } };
    const model = { key: "due", title: "What's due", rank: "given", items, answer, lines, folds, body, places, audience: farmer ? "farmer" : "advisor",
      total: checklist.length, scene: { farm: f, frame: "extent", area: null }, href: null, allLabel: "Everything recorded",
      // A farm with a consent decision on file but no conditions read in says that, not "nothing recorded".
      empty: { text: context.obligationsError ? "The condition dates couldn't be read." : decision ? "The consent's conditions haven't been read in yet; its decision is in Files." : "Nothing recorded yet.",
        // "Documents" opens the decision itself (walk #3)
        ...(!context.obligationsError && decision ? { link: { text: "Files", href: href(f, "documents", decision.id) } } : {}) },
      restricted: !checklist.length, currency: "As at " + date(today), farm: f };
    return farmer ? unmarked(model) : model;
  }

  // "What's changed": records added to the farm, newest first, from their recorded creation time. Records loaded
  // together when the farm was set up are not changes: BULK_LOAD or more with the same added day are one line saying
  // so, never promoted; what is promoted after that is a change since the load.
  const BULK_LOAD = 10;
  // #241 A rule that carries no real reference (a placeholder like "Rule 0.0") is not a change anyone can act on: it is not
  // listed, and so never leads the sentence. A consent has its number; a rule needs its reference.
  const shownAsChange = (a) => !!(a?.consent_no || a?.kind === "consent" || ruleRef(a));
  // The record first, its reference after it, the same shape for advisor and farmer: "Permitted activity rule, LWRP Rule 5.41".
  // A consent keeps its number first for the advisor ("CRC000102 · Water permit") and its title alone for the farmer.
  function changeName(a, farmer) {
    if (a.consent_no) return farmer ? plainName(a) : authName(a);
    const base = title(farmer ? unmarked(a.title) : a.title) || "Recorded rule", ref = ruleRef(a);
    return ref && !base.includes(ref) ? base + ", " + ref : base;
  }
  function changed(context) {
    const f = context.farm.id, today = context.today, since = addDays(today, -30), farmer = audienceOf(context) === "farmer";
    const records = [
      ...list(context.documents).map((d) => ({ id: "document-" + d.id, text: docTitle(d), href: href(f, "documents", d.id), added: day(d.created_at), kind: "document",
        primary: docTier(d).tier === "primary", source: ["File", d.author_org || d.author].filter(Boolean).join(" · ") })),
      ...list(context.authorisations).filter(shownAsChange).map((a) => ({ id: "authorisation-" + a.id, text: changeName(a, farmer), added: day(a.created_at), kind: "authorisation", primary: true, source: "Consent record" })),
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

  // The features on a farm's map that a place names: its land units by code, the farm layers and reference features
  // of its themes ("waterways", "wells"), and reference layers it names by key (an answer in Ask framing "Bores").
  // None on this map: an empty list, and the map stays where it is.
  function placeFeatures(scene, place) {
    const s = scene || {}, p = place || {}, codes = new Set(list(p.land_units)), themes = new Set(list(p.themes).map((t) => kindOf(t))), keys = new Set(list(p.layers));
    const drawn = (fc) => list(fc?.features).filter((x) => x?.geometry?.coordinates);
    return [...drawn(s.land_units).filter((x) => codes.has(x.properties?.code)),
      ...list(s.layers).filter((l) => kindOf(l.theme, l.geometry_type) !== "land_units" && themes.has(kindOf(l.theme, l.geometry_type))).flatMap((l) => drawn(l.features)),
      ...list(s.reference).filter((r) => themes.has(kindOf(r.theme)) || keys.has(r.key)).flatMap((r) => drawn(r.features))];
  }

  // E4 farm display (Josh, 2 Nov 2026). The fly-in to a farm is a gentle eased flight a person can follow (about 3.6 s);
  // a device that asks for reduced motion jumps instead. `essential: false` lets MapLibre's own reduced-motion check
  // agree with ours. The same easing as every other move (APP-STRUCTURE §3.7): ease in and out.
  const FLY_MS = 3600, MASK_OPACITY = 0.3, MASK_FADE_MS = 600;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const flight = (reduced) => (reduced ? { duration: 0, essential: false } : { duration: FLY_MS, easing: easeInOut, curve: 1.42, essential: false });
  // Once the flight has landed, everything outside the farm fades to a 30% dim over ~600 ms (none with reduced motion).
  const maskFade = (reduced) => (reduced ? 0 : MASK_FADE_MS);
  // The farm mask: the world with the farm's boundary cut out (DM1: the map outside is dimmed, never removed). Each part
  // of a multipart farm is its own hole; a hole in the farm itself (land inside the boundary that isn't the farm) is
  // dimmed too, as an island of its own. null when there is no boundary to cut. GeoJSON geometry, lng/lat.
  const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  function farmMask(extent) {
    const g = extent?.type === "Feature" ? extent.geometry : extent;
    const polygons = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? list(g.coordinates) : [];
    const ring = (r) => Array.isArray(r) && r.length >= 4 && r.every((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    const outers = polygons.map((p) => list(p)[0]).filter(ring);
    if (!outers.length) return null;
    const islands = polygons.flatMap((p) => list(p).slice(1).filter(ring).map((r) => [r]));
    return islands.length ? { type: "MultiPolygon", coordinates: [[WORLD, ...outers], ...islands] } : { type: "Polygon", coordinates: [WORLD, ...outers] };
  }
  // The command bar: what someone types is a layer to show or a question to Ask. Layers come from the same rows the
  // Layers drawer lists ({ key, name, sub?, section, job? }); a word of the text that starts a word of a layer's name,
  // key or source matches it. A question (a "?", or a question word first) or a long sentence goes to Ask on Enter,
  // with any layers it names still offered; a short phrase that names layers ("creek", "show bores") shows the first.
  const ASKING = /^(who|what|whats|what's|when|where|why|which|how|is|are|was|were|do|does|did|can|could|should|will|would|has|have|tell|list|explain|summari[sz]e|mark)\b/i;
  const SHOWING = /^(show|load|add|display|turn on|open|see|view)\s+(the\s+)?/i;
  const FILLER = new Set(["the", "a", "an", "layer", "layers", "of", "on", "map", "me", "and", "to", "in", "farm", "farm's", "this"]);
  const wordsOf = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
  function commandIntent(input, entries) {
    const raw = String(input || "").trim();
    if (!raw) return { kind: "none", text: "", layers: [] };
    const showing = SHOWING.test(raw), rest = raw.replace(SHOWING, "");
    const query = wordsOf(rest).filter((w) => !FILLER.has(w) && w.length >= 2);
    const asking = !showing && (/\?\s*$/.test(raw) || ASKING.test(raw) || wordsOf(raw).length > 4);
    // a phrase: every word names the layer; a question: any word of it that names a layer (three letters or more)
    const loose = query.filter((w) => w.length >= 3 && !ASKING.test(w));
    const named = (hay) => (asking ? loose.length && loose.some((q) => hay.some((h) => h.startsWith(q))) : query.every((q) => hay.some((h) => h.startsWith(q))));
    const seen = new Set(), layers = [];
    if (query.length) for (const e of list(entries)) {
      if (!e?.key || seen.has(e.key) || !String(e.name || "").trim()) continue;
      const hay = wordsOf([e.name, e.key.replace(/[-_]/g, " "), e.sub, e.source, e.job?.title, e.job?.name].filter(Boolean).join(" "));
      if (named(hay)) { seen.add(e.key); layers.push({ key: e.key, name: e.name, on: !!e.on }); }
    }
    return { kind: layers.length && !asking ? "layer" : "ask", text: raw, layers: layers.slice(0, 5) };
  }
  // #224 What dims when a line's place is chosen: everything on the map around the farm but the chosen areas, as one
  // polygon (a wide box about the farm with each chosen area's outline as a hole). A chosen line or point dims all
  // around it and is drawn over the dim. GeoJSON geometry, lng/lat.
  function dimAround(features, extent) {
    const corners = [];
    const walk = (c) => (typeof c[0] === "number" ? corners.push(c) : c.forEach(walk));
    if (extent?.coordinates) walk(extent.coordinates);
    for (const f of list(features)) if (f?.geometry?.coordinates) walk(f.geometry.coordinates);
    if (!corners.length) return null;
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]), m = 1;   // a degree beyond: past the edge of any farm frame
    const [w, s, e, n] = [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
    const holes = list(features).flatMap((f) => f?.geometry?.type === "Polygon" ? [f.geometry.coordinates[0]] :
      f?.geometry?.type === "MultiPolygon" ? f.geometry.coordinates.map((p) => p[0]) : []).filter((r) => Array.isArray(r) && r.length >= 4);
    return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]], ...holes] };
  }
  // #224 Is a chosen place framed on its own, or marked in the farm's frame? On its own only when framing it zooms in
  // well past the farm's frame: by 1/0.6 or more, i.e. the place fills less than about 60% of what the farm frame shows
  // (LU1 and LU3 run the farm's full height: framing them would move the map without bringing them closer).
  // Boxes are [[w, s], [e, n]] in lng/lat; size and pad are the map canvas and its frame padding in px.
  const PLACE_SHARE = 0.6;
  function framesPlace(place, farm, size, pad) {
    const metres = (b) => { const k = Math.cos((((b[0][1] + b[1][1]) / 2) * Math.PI) / 180); return [Math.max((b[1][0] - b[0][0]) * k, 1e-9), Math.max(b[1][1] - b[0][1], 1e-9)]; };
    const w = (size?.width || 0) - (pad?.left || 0) - (pad?.right || 0), h = (size?.height || 0) - (pad?.top || 0) - (pad?.bottom || 0);
    if (!(w > 0 && h > 0)) return true;
    const scale = ([x, y]) => Math.min(w / x, h / y);
    return scale(metres(place)) / scale(metres(farm)) >= 1 / PLACE_SHARE - 1e-9;
  }
  // #224 Which labels a drawn line runs under: boxes ({ x, y, w, h }, screen px) against paths (lists of [x, y] screen
  // points); a label within `margin` px of the line counts. True for each label the line touches.
  function labelsOnLine(boxes, paths, margin = 3) {
    const cross = (a, b, c, d) => {
      const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
      return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
    };
    return list(boxes).map((b) => {
      const l = b.x - margin, t = b.y - margin, r = b.x + b.w + margin, btm = b.y + b.h + margin;
      const inside = (p) => p[0] >= l && p[0] <= r && p[1] >= t && p[1] <= btm;
      const edges = [[[l, t], [r, t]], [[r, t], [r, btm]], [[r, btm], [l, btm]], [[l, btm], [l, t]]];
      return list(paths).some((path) => path.some(inside) || path.slice(1).some((q, i) => edges.some(([c, d]) => cross(path[i], q, c, d))));
    });
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
        const rest = [mains.length > 1 ? (mains.length - 1) + " more main " + (mains.length === 2 ? "file" : "files") : null,
          supporting ? supporting + " supporting" : null].filter(Boolean);
        answer = { text: "The main file is " + docTitle(d) + (when ? ", " + when : ""),
          because: rest.length ? rest.join(" and ") : archived ? "the rest " + (archived === 1 ? "is" : "are") + " archived" : "nothing else is recorded" };
      } else answer = { text: count(docs.length, "file is recorded", "files are recorded"), because: "none is a main file yet" };
    } else if (docs.length) answer = { text: count(docs.length, "file is recorded", "files are recorded"), because: "the main ones lead the list" };
    // No All: the Documents block under the sentence is the list.
    return { key: "documents", title: "Files", items, answer, rank: "given", empty: { text: "Nothing recorded yet." }, restricted: true };
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
  const THEME_NAMES = { land_units: "Land units", plantings: "Plantings", fences: "Fences", photos: "Photos", measurements: "Measured distances", annotation: "Measured distances", contaminant_sources: "Contaminant sources",
    point_features: "Farm features", line_features: "Farm lines", proposed_actions: "Proposed fences", extent: "Farm boundary", titles: "Titles",
    wells: "Bores", consents: "Consents", wetlands: "Wetlands", soils: "Soils", luc: "Land use capability", parcels: "Titles", actions: "Actions", farmed_area: "Farmed area" };
  // Reference rows by their source. "Rivers" is the shared waterways display layer (DM2, riverLayers below), not a row of
  // farm_map; the source layers behind it (Topo50 lines and the two river networks) start off.
  // DM2: the sources the shared Rivers row is drawn from. LK4: Rivers is their kind's row (waterways): a context brings Rivers,
  // never these, and the Layers drawer lists them under All layers only.
  const RIVER_SOURCES = ["niwa-rec2-rivers", "linz-topo50-river-centrelines", "ecan-rivers"];
  const behindRivers = (key) => RIVER_SOURCES.includes(String(key || ""));
  const KEY_NAMES = { "ecan-wells": "Bores", "ecan-consents": "Consents", "linz-topo50-river-centrelines": "River lines (Topo50)", "niwa-rec2-rivers": "River network (REC2)", "ecan-rivers": "River network (ECan)" };
  const NAME_RULES = [[/river centrelines?|\bwaterways?\b/i, "Rivers"], [/river environment classification|\bREC\d?\b/i, "River classes"], [/resource consents?/i, "Consents"],
    [/\b(?:wells?|bores?)\b/i, "Bores"], [/\bwetlands?\b/i, "Wetlands"], [/\bs-?map\b|^soils?\b/i, "Soils"], [/land use capability|\bLUC\b/i, "Land use capability"]];
  // CAP1a/CAP1b: farm_map's titles or land units over its cap come as an empty collection with `truncated: true` and their
  // feature_count (the farm's outline still draws). There is no by-viewport read for them: their Layers row says so.
  // what: "titles" | "land units"; null when the collection came whole.
  function tooManyToDraw(collection, what) {
    if (collection?.truncated !== true) return null;
    const n = collection.feature_count;
    return "Too many " + what + " to draw here" + (Number.isFinite(Number(n)) && n != null ? " (" + Number(n).toLocaleString("en-NZ") + ")" : "");
  }
  function layerName(layer) {
    const l = layer || {}, raw = String(l.name || "").trim();
    if (KEY_NAMES[l.key]) return KEY_NAMES[l.key];
    if (THEME_NAMES[l.theme]) return THEME_NAMES[l.theme];
    if (l.theme && THEME_NAMES[kindOf(l.theme, l.geometry_type)]) return THEME_NAMES[kindOf(l.theme, l.geometry_type)];   // LK3a: a renamed theme keeps its name
    const hit = NAME_RULES.find(([re]) => re.test(raw));
    if (hit) return hit[1];
    // otherwise the title less its source in brackets, version and sub-title
    let t = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+v\d+(?:\.\d+)*\b/gi, "").replace(/\s+[-\u2013]\s+.*$/, "").replace(/\s+/g, " ").trim() || raw;
    if (t && t === t.toUpperCase() && /[A-Z]/.test(t)) t = t[0] + t.slice(1).toLowerCase();
    return t || "Layer";
  }
  // ---- Rivers (DM2): the shared waterways layer as the map draws it --------------------------------------------
  // Rows of waterways_in_view: one per named run of connected reaches (merged by name, stream-order class and a 10 km
  // cell), so each is labelled once, never once per segment; unnamed runs are drawn and never labelled. Which streams
  // show follows the zoom: order 4 and up at farm scale, order 3 from z13, every stream from z15. Width by order class.
  const RIVER_MIN_ZOOM = 10;   // below this no rivers are read or drawn (the region, not a farm)
  const riverMinOrder = (zoom) => (zoom >= 15 ? 1 : zoom >= 13 ? 3 : 4);
  const RIVER_ORDER = ["coalesce", ["get", "stream_order_max"], 0];
  const RIVER_BANDS = [
    { band: "large", filter: [">=", RIVER_ORDER, 4], minzoom: RIVER_MIN_ZOOM },
    { band: "order3", filter: ["==", RIVER_ORDER, 3], minzoom: 13 },
    { band: "small", filter: ["<", RIVER_ORDER, 3], minzoom: 15 },
  ];
  const byClass = (river, stream, minor) => ["match", ["get", "order_class"], "river", river, "stream", stream, minor];
  const RIVER_WIDTH = ["interpolate", ["linear"], ["zoom"], 11, byClass(2.2, 1.4, 0.9), 16, byClass(5, 3, 1.8)];
  const RIVER_CASING = ["interpolate", ["linear"], ["zoom"], 11, byClass(4.2, 3.4, 2.9), 16, byClass(7, 5, 3.8)];
  // The map's layer specs for one source: per band a dark casing and the light blue line, then (where the map has
  // glyphs) its labels: white italic text with a soft shadow and no box (RCL's map style), along the line, far apart,
  // never over another label, and only for named runs.
  function riverLayers(source, { labels = true } = {}) {
    const round = { "line-cap": "round", "line-join": "round" };
    const lines = RIVER_BANDS.flatMap(({ band, filter, minzoom }) => [
      { id: "rivers-" + band + "-casing", type: "line", source, minzoom, filter, layout: round, paint: { "line-color": "#000000", "line-opacity": 0.45, "line-width": RIVER_CASING } },
      { id: "rivers-" + band + "-line", type: "line", source, minzoom, filter, layout: round, paint: { "line-color": "#bfe8ff", "line-width": RIVER_WIDTH } },
    ]);
    if (!labels) return lines;
    return [...lines, ...RIVER_BANDS.map(({ band, filter, minzoom }) => ({
      id: "rivers-" + band + "-label", type: "symbol", source, minzoom, filter: ["all", filter, ["==", ["get", "named"], true]],
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Open Sans Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 11, 16, 14], "symbol-spacing": 1000, "text-max-angle": 30,
        "text-allow-overlap": false, "text-ignore-placement": false, "text-keep-upright": true, "text-padding": 4 },
      paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0, 0, 0, 0.6)", "text-halo-width": 1.2, "text-halo-blur": 0.8 },
    }))];
  }
  // waterways_in_view rows as a FeatureCollection for the source (properties: what the style and the popup read).
  function riverFeatures(rows) {
    return { type: "FeatureCollection", features: list(rows).filter((r) => r?.web_geom?.coordinates).map((r) => ({
      type: "Feature", id: r.id, geometry: r.web_geom,
      properties: { name: r.named ? r.name : null, named: !!r.named, order_class: r.order_class,
        stream_order_min: r.stream_order_min ?? null, stream_order_max: r.stream_order_max ?? null } })) };
  }
  // The box to ask for: the map's bounds ([[w, s], [e, n]], lng/lat) widened by a quarter each way, so a short pan
  // needs no new read; null below the zoom rivers are drawn at.
  function riverBox(bounds, zoom) {
    if (!(zoom >= RIVER_MIN_ZOOM) || !bounds) return null;
    const [[w, s], [e, n]] = bounds, dx = (e - w) / 4, dy = (n - s) / 4;
    return { bbox_xmin: w - dx, bbox_ymin: s - dy, bbox_xmax: e + dx, bbox_ymax: n + dy, min_order: riverMinOrder(zoom), max_rows: 5000, bbox_srid: 4326 };
  }
  // The map's bounds lie inside an earlier read's box, at the same stream-order cut: no new read is needed.
  const riverBoxCovers = (had, bounds, zoom) => !!had && !!bounds && had.min_order === riverMinOrder(zoom) &&
    had.bbox_xmin <= bounds[0][0] && had.bbox_ymin <= bounds[0][1] && had.bbox_xmax >= bounds[1][0] && had.bbox_ymax >= bounds[1][1];
  function riverPopup(props) {
    const p = props || {}, lo = p.stream_order_min, hi = p.stream_order_max;
    const order = hi == null ? null : "Stream order " + (lo != null && lo !== hi ? lo + "–" + hi : hi);
    return { title: p.named && p.name ? String(p.name) : "Unnamed stream", layerName: "Rivers", qualifier: order, props: {},
      attribution: "River network: NIWA REC2. Names: LINZ Topo50 (CC BY 4.0) and Environment Canterbury." };
  }
  // ECan consent points (#243): current ones are drawn; a consent whose status says it has ended is past, shown only
  // when the person asks for past consents.
  const PAST_CONSENT = /terminated|expired|lapsed|surrender|cancel|declined|withdrawn|superseded/i;
  const pastConsent = (p) => PAST_CONSENT.test(String((p || {}).ConsentStatus || ""));
  // A date as ECan's service gives it (epoch milliseconds, or text) as YYYY-MM-DD, or null.
  function serviceDay(v) {
    if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });   // the NZ day, not UTC's
    const t = String(v ?? "").trim(), nz = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (nz) return nz[3] + "-" + nz[2].padStart(2, "0") + "-" + nz[1].padStart(2, "0");
    return isDate(t) ? t.slice(0, 10) : /^\d{10,13}$/.test(t) ? serviceDay(Number(t)) : null;
  }
  // A consent point's popup: "Consent CRC… · <type>", then "<status> · expires <date>", its holder (public ECan data,
  // never in a list row or heading) and the link to ECan's own record.
  function consentPopup(props, layer, where) {
    const p = props || {}, no = String(p.ConsentNo || p.external_id || "").trim(), type = String(p.ConsentType || "").trim(), status = String(p.ConsentStatus || "").trim();
    const ends = serviceDay(p.Expires) || serviceDay(p.toDate), link = String(p.LINK || "").trim();
    return { title: ["Consent " + no, type].filter((x) => x && x !== "Consent ").join(" · ") || "Consent", layerName: layerName(layer),
      qualifier: [status, ends ? "expires " + date(ends) : null].filter(Boolean).join(" · ") || null, resolution: where || null,
      props: p.HolderName ? { holder: String(p.HolderName).trim() } : {}, permits: list(p.authorisations),
      link: /^https:\/\//i.test(link) ? { href: link, text: "ECan record" } : null, attribution: (layer || {}).attribution || null };
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
    const parts = [auths ? (auths === 1 ? "1 authorisation" : auths + " authorisations") : null, docs ? (docs === 1 ? "1 file" : docs + " files") : null].filter(Boolean);
    return parts.length ? parts.join(" and ") + " recorded." : "Nothing recorded yet.";
  }
  // The same sentence from an opened farm's own reads.
  const portfolioLine = (context) => summaryLine({ authorisation_count: list(context.authorisations).length, document_count: list(context.documents).length });

  // People on a farm (farm_people rows), for its owner and admins. Owners are changed through RCL (A1), and
  // nobody changes or removes themselves here, so neither row offers those controls.
  const roles = [["view", "View"], ["edit", "Edit"], ["admin", "Admin"]];
  const roleNames = { owner: "Owner", admin: "Admin", edit: "Edit", view: "View" };
  const canManage = (role) => role === "owner" || role === "admin";
  // Who may change what the farm holds (add a block, mark a condition done, link a record): the farm_members roles the app
  // already reads (UI1: the one rule behind every "may edit" control, so Add a block is never shown to a viewer).
  const canEdit = (role) => role === "owner" || role === "admin" || role === "edit";
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

  // The map's attribution on a phone (#259): the (i), opening on tap. `ctrl` is MapLibre's attribution <details>; a compact
  // one starts shown until the map first moves, so it is folded here. MapLibre calls a canvas this wide or narrower compact.
  const PHONE_MAP = 640;
  const isPhoneMap = (width) => Number.isFinite(width) && width <= PHONE_MAP;
  function foldAttribution(ctrl) {
    if (!ctrl?.classList?.contains("maplibregl-compact")) return false;
    ctrl.classList.remove("maplibregl-compact-show"); ctrl.removeAttribute("open");
    return true;
  }

  // The closed phone sheet's peek (#240): the sentence's first clause, whole. A clause longer than `max` ends at a word
  // boundary with an ellipsis, never inside a word; the sentence is cut at its first dash or semicolon.
  function peek(text, max = 72) {
    const first = String(text ?? "").replace(/\s+/g, " ").trim().split(/ [—–] |; /)[0].trim();
    if (first.length <= max) return first;
    const cut = first.slice(0, max + 1), at = cut.lastIndexOf(" ");
    return (at > 0 ? cut.slice(0, at) : first.slice(0, max)).replace(/[\s,.:;—–-]+$/, "") + "…";
  }

  // Done with a way back (#258). start(id, payload) opens a short window; undo(id) inside it means nothing was written;
  // when the window closes, or flush() is called (the person navigates), write(id, payload) is called once. A second start
  // on a line that is already waiting (or being written) is refused, so one line never makes two records.
  // The clock is passed in (setTimeout/clearTimeout in the app) so the window can be tested without waiting.
  const UNDO_MS = 8000;
  function undoWindow({ write, ms = UNDO_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const waiting = new Map(), writing = new Set();
    const commit = (id) => {
      const w = waiting.get(id);
      if (!w) return Promise.resolve(false);
      clearTimer(w.timer); waiting.delete(id); writing.add(id);
      // the write starts now (not on a later tick): a page being hidden gets its request out
      let done; try { done = Promise.resolve(write(id, w.payload)); } catch (err) { done = Promise.reject(err); }
      return done.finally(() => writing.delete(id)).then(() => true);
    };
    return {
      ms,
      start(id, payload) {
        if (waiting.has(id) || writing.has(id)) return false;
        waiting.set(id, { payload, timer: setTimer(() => { commit(id).catch(() => {}); }, ms) });
        return true;
      },
      undo(id) { const w = waiting.get(id); if (!w) return false; clearTimer(w.timer); waiting.delete(id); return true; },
      has: (id) => waiting.has(id) || writing.has(id),
      waiting: () => [...waiting.keys()],
      commit,
      flush: () => Promise.all([...waiting.keys()].map(commit)),
    };
  }

  // FB1: the farm's current farmed boundary (farm_holding's boundary) as one of the map's own layers, "Farmed area";
  // null when the farm has none yet.
  function farmedAreaLayer(holding) {
    const b = holding && typeof holding === "object" ? holding.boundary : null;
    if (!b?.geometry?.type) return null;
    return { id: "farmed-area", name: "Farmed area", theme: "farmed_area", geometry_type: "polygon", epistemic_class: "observation",
      source: "the farm's own record", as_at: String(b.valid_from || "").slice(0, 10) || null, shown_as: null,
      features: { type: "FeatureCollection", features: [{ type: "Feature", geometry: b.geometry, properties: { name: "Farmed area", area_ha: b.area_ha ?? null } }] } };
  }
  return { RIVER_SOURCES, behindRivers, farmedAreaLayer, flight, FLY_MS, easeInOut, maskFade, MASK_OPACITY, MASK_FADE_MS, farmMask, commandIntent, peek, undoWindow, UNDO_MS, ruleRef, isPhoneMap, foldAttribution, riverLayers, riverFeatures, riverBox, riverBoxCovers, riverMinOrder, riverPopup, RIVER_MIN_ZOOM, dimAround, framesPlace, PLACE_SHARE, labelsOnLine, views, otherViews, sheetOverlap, sheetPadding, framePadding, flightPadding, frameFix, docClass, docTier, docKind, docTitle, title, DOC_TIERS, DOC_TYPES, layerName, tooManyToDraw, pastConsent, consentPopup, isPlan, recordKind, recordLinks, jobHeading, entersToSubmit, initials, viewLabel, outputs, match, href, date, standingAnswers, audienceOf, placeFeatures, documents, summaryLine, portfolioLine, sourceLine, resolutionLine, labelsToShow, unitNames, roles, canManage, canEdit, people };
});
