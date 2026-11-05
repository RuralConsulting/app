// ON1 — the onboarding readiness report (docs/ONBOARDING-REPORT.md). Pure: the database's onboarding_report_inputs(f)
// in, the report out — its sections and checklist items, the findings of named deterministic rules, the effort record and
// the stored document (onboarding-report/1). No DOM, network, clock or AI: "now" and the person are passed in.
//
// Every item is one checklist line: { key, section, rule, state, text, detail?, source?, action?, evidence }. States:
//   found        public context the platform already holds (nothing to do)
//   done         the record has it (parcels held, a plan read in, areas agree)
//   propose      a proposal waits for a person, through the flow that owns it (nothing is written here)
//   verify       a mismatch, possible duplicate or unconfirmed item a person should look at
//   gap          evidence that is absent
//   unavailable  a source not loaded or not served, or a section that couldn't be read (not the farm's gap)
// A person's tick (`checked`: { verdict: "correct" | "not_ours" | "seen", note, by, at }) sits on the item; it is carried to
// the next report only while the item's evidence is unchanged. Findings say what differs and whose source it is, never a
// compliance verdict.
// ON3d: the four "propose" findings (DECISION_RULES) are not ticked. Each is a row of public.proposals (kind farm_onboarding_check,
// written by public.farm_onboarding_sync) that a farm editor accepts or sets aside through public.proposals_decide; build() takes
// those rows (opts.proposals) and a decided one sits on the item as its `checked` (accepted: "correct", set aside: "not_ours"),
// so counts, effort and the stored document read it as they read a tick. ON2 reads the same rows in the database.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.onboardingModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const SCHEMA = "onboarding-report/1";
  const RULES_VERSION = "on1-rules/1";
  // area.mismatch: a document's stated area and the held land differ by more than both of these.
  const AREA_PCT = 0.10, AREA_HA = 2;
  const STATES = ["found", "done", "propose", "verify", "gap", "unavailable"];
  const VERDICTS = ["correct", "not_ours", "seen"];
  const SECTIONS = [["farm", "The farm"], ["context", "Public context"], ["documents", "Documents"], ["proposals", "What can be proposed"],
    ["checks", "Gaps, duplicates and mismatches"], ["sharing", "Sharing"], ["effort", "Effort"]];
  const RULES = ["holding.none", "holding.parcels", "parcel.not_current", "area.mismatch", "area.agrees", "consent.not_in_ecan",
    "consent.not_recorded", "consent.status_differs", "consent.no_conditions", "consent.no_decision", "consent.ecan_not_loaded",
    "document.duplicate", "document.tier_unconfirmed", "document.held", "fep.missing", "fep.not_read", "fep.read_in", "fep.confirm_report",
    "context.not_loaded", "context.found", "context.none", "context.unreadable", "sharing"];
  // The public context the report looks for: [key, label, source keys, what it is called when counted (one, many)].
  const THEMES = [
    ["downstream", "Where the farm drains", ["niwa-rec2-rivers"]],
    ["sites", "Monitoring sites downstream", ["ecan-wq-sites", "ecan-flow-sites", "ecan-mci-sites", "niwa-hydro-sites"]],
    ["surface_water", "Rivers and streams on or near the farm", ["niwa-rec2-rivers", "linz-topo50-river-centrelines"]],
    ["groundwater", "Groundwater: allocation zones and wells", ["ecan-wells", "ecan-gw-allocation-zones", "ecan-sw-allocation-zones"]],
    ["consents", "ECan resource consents", ["ecan-consents"], ["consent", "consents"]],
    ["wetlands", "Wetlands", ["ecan-wetland-areas", "fenz-regional-wetlands-ecan"], ["wetland", "wetlands"]],
    ["soils", "Soils (S-map)", ["smap"], ["soil polygon", "soil polygons"]],
    ["luc", "Land use capability (NZLRI)", ["lris-nzlri-luc-2021", "ecan-lri"], ["LUC unit", "LUC units"]],
    ["geology", "Geology (QMAP)", ["gns-qmap-250k-geology"], ["geological unit", "geological units"]],
    ["zones", "Nutrient allocation zones", ["ecan-nutrient-zones", "ecan-nutrient-subareas"], ["zone", "zones"]],
  ];
  const PLAN_TYPES = ["fep", "fwfp"];
  // ON3d: the findings a farm editor decides as proposals (the "propose" state's rules), and the proposals kind that holds them.
  const FARM_CHECK_KIND = "farm_onboarding_check";
  const DECISION_RULES = ["fep.not_read", "fep.confirm_report", "consent.not_recorded", "consent.no_conditions"];
  const OPEN_STATUSES = ["proposed", "ambiguous"], LIVE_STATUSES = ["proposed", "ambiguous", "accepted"];
  const OWN_TYPES = ["onboarding_report", "plan_import", "plan_import_report"];   // the report's and the readers' own files

  const list = (v) => Array.isArray(v) ? v : [];
  const num = (v) => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const day = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  const dates = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const date = (d) => day(d) ? dates.format(new Date(day(d) + "T12:00:00Z")) : "date not recorded";
  const ha = (v) => (Math.round(Number(v) * 10) / 10).toLocaleString("en-NZ") + " ha";
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const crcOf = (s) => String(s || "").toUpperCase().replace(/\s/g, "");
  const docTitle = (d) => String(d?.title || d?.original_name || "a document").trim();
  const docType = (d) => String(d?.doc_type || "").toLowerCase();
  const stable = (v) => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

  // ---- provenance ---------------------------------------------------------------------------------------------------
  function sourceIndex(inputs) { return new Map(list(inputs?.sources).map((s) => [s.key, s])); }
  // "NZ Primary Parcels (LINZ) · CC BY 4.0 · as at 2 Nov 2026"
  function sourceLine(s) {
    if (!s) return null;
    return [s.name || s.key, s.licence || null, s.refreshed_at ? "as at " + date(s.refreshed_at) : "refresh date not recorded"].filter(Boolean).join(" · ");
  }
  const sourceRef = (s) => s ? { kind: "reference", key: s.key, name: s.name || s.key, provider: s.provider || null, licence: s.licence || null, as_at: day(s.refreshed_at) } : null;
  const docRef = (d) => d ? { kind: "document", id: d.id, title: docTitle(d), date: day(d.date_prepared) || day(d.created_at) } : null;
  const fnRef = (name) => ({ kind: "function", name });

  const item = (section, rule, state, subject, text, extra = {}) => ({ key: rule + ":" + subject, section, rule, state, text, ...extra,
    evidence: extra.evidence !== undefined ? stable(extra.evidence) : stable(text) });

  // ---- 1. the farm --------------------------------------------------------------------------------------------------
  function heldArea(h) {
    const current = list(h?.parcels).filter((p) => p.current && num(p.area_ha) != null);
    if (current.length) return { area: current.reduce((a, p) => a + num(p.area_ha), 0), basis: "the held parcels", kind: "parcels" };
    if (num(h?.titles?.count) > 0 && num(h?.titles?.area_ha) > 0) return { area: num(h.titles.area_ha), basis: "the farm's titles", kind: "titles" };
    if (num(h?.boundary?.area_ha) > 0) return { area: num(h.boundary.area_ha), basis: "the farmed area", kind: "boundary" };
    return null;
  }
  function farmItems(inputs, src) {
    const h = inputs.holding || {}, parcels = list(h.parcels), linz = src.get("linz-primary-parcels"), out = [];
    const titles = num(h.titles?.count) || 0;
    if (!parcels.length && !titles && !h.boundary) {
      out.push(item("farm", "holding.none", "gap", "farm", "The farm's land isn't identified yet: choose its LINZ parcels.",
        { detail: "Public context, consents on the farm and area checks all start from the parcels.", action: { kind: "add_block", label: "Choose the parcels" }, source: sourceRef(linz) }));
      return out;
    }
    if (parcels.length) {
      const current = parcels.filter((p) => p.current), area = current.reduce((a, p) => a + (num(p.area_ha) || 0), 0);
      out.push(item("farm", "holding.parcels", "done", "parcels", plural(parcels.length, "LINZ parcel", "LINZ parcels") + " held" + (current.length ? ", " + ha(area) : ""),
        { detail: current.map((p) => p.appellation).filter(Boolean).slice(0, 12).join("; ") || null, source: sourceRef(linz), source_line: sourceLine(linz),
          evidence: parcels.map((p) => p.external_id).sort() }));
      for (const p of parcels.filter((x) => !x.current))
        out.push(item("farm", "parcel.not_current", "verify", p.external_id, "Parcel " + (p.appellation || p.external_id) + " is no longer a current LINZ parcel",
          { detail: "LINZ may have redrawn or replaced it. Check the holding and choose its replacement.", source: sourceRef(linz), source_line: sourceLine(linz), evidence: p }));
    }
    if (titles) out.push(item("farm", "holding.parcels", "done", "titles", plural(titles, "title", "titles") + " recorded, " + ha(h.titles.area_ha), { evidence: h.titles }));
    if (h.boundary) out.push(item("farm", "holding.parcels", "done", "boundary", "Farmed area " + ha(h.boundary.area_ha) + " (" +
      (h.boundary.method === "drawn" ? "drawn by a person" : h.boundary.method === "parcels" ? "the parcels as they are" : "loaded") + ", " +
      plural(num(h.boundary.versions) || 1, "version", "versions") + ")", { evidence: h.boundary }));
    return out;
  }

  // ---- 2. public context --------------------------------------------------------------------------------------------
  function contextItems(inputs, src) {
    const ctx = inputs.context || {}, errors = inputs.errors || {}, out = [];
    const hasExtent = num(inputs.holding?.extent_area_ha) > 0;
    const counts = new Map(list(ctx.in_context).map((c) => [c.source_key, c]));
    for (const [key, label, keys, words] of THEMES) {
      const registered = keys.map((k) => src.get(k)).filter(Boolean), served = registered.filter((s) => s.served);
      const sources = served.map(sourceRef), lines = served.map(sourceLine).join("; ") || null;
      if (!hasExtent) { out.push(item("context", "context.not_loaded", "unavailable", key, label + ": shown once the farm's land is identified", { evidence: "no-extent" })); continue; }
      if (!served.length) {
        out.push(item("context", "context.not_loaded", "unavailable", key, label + ": not loaded on the platform yet",
          { detail: registered.length ? "Registered (" + registered.map((s) => s.name || s.key).join(", ") + ") but not yet cleared to show." : "No source for this is loaded yet.", evidence: "not-loaded" }));
        continue;
      }
      const errKey = { downstream: "downstream", sites: "sites", surface_water: "surface_water", groundwater: "groundwater" }[key] || "in_context";
      if (errors[errKey]) { out.push(item("context", "context.unreadable", "unavailable", key, label + ": couldn't be read just now", { detail: String(errors[errKey]), evidence: "error" })); continue; }
      const found = (text, detail, evidence) => out.push(item("context", "context.found", "found", key, text, { detail, sources, source_line: lines, evidence }));
      const none = (text) => out.push(item("context", "context.none", "found", key, text, { sources, source_line: lines, evidence: "none" }));
      if (key === "downstream") {
        const d = ctx.downstream, names = list(d?.reaches).map((r) => r.name).filter(Boolean);
        if (!d || !num(d.starts)) none(label + ": no REC2 river reach found from the farm");
        else found(names.length ? "Drains to " + names.slice(0, 4).join(", then ") : label + ": " + plural(num(d.starts), "starting reach", "starting reaches") + ", unnamed",
          num(d.max_km) != null ? "Followed " + Math.round(num(d.max_km)) + " km down the REC2 network" : null, names);
      } else if (key === "sites") {
        const s = list(ctx.sites);
        if (!s.length) none(label + ": none within 25 km downstream");
        else found(plural(s.length, "monitoring site", "monitoring sites") + " downstream; nearest " + (s[0].site_name || s[0].external_id) + ", " + Number(s[0].distance_km_along).toFixed(1) + " km along",
          s.slice(0, 6).map((x) => (x.site_name || x.external_id) + " (" + x.site_kind + ", " + Number(x.distance_km_along).toFixed(1) + " km)").join("; "), s.map((x) => x.source_key + "/" + x.external_id));
      } else if (key === "surface_water") {
        const w = ctx.surface_water;
        if (!w || !num(w.count)) none(label + ": none within 2 km");
        else found(plural(num(w.count), "reach", "reaches") + " within 2 km" + (num(w.on_farm) ? ", " + num(w.on_farm) + " on the farm" : ""),
          list(w.named).slice(0, 8).map((n) => n.name + (n.on_farm ? " (on the farm)" : "")).join("; ") || null, [w.count, w.on_farm]);
      } else if (key === "groundwater") {
        const g = ctx.groundwater, zones = [...list(g?.allocation_zone?.groundwater), ...list(g?.allocation_zone?.surface_water)].map((z) => z.name).filter(Boolean);
        const wells = list(g?.wells);
        if (!g || (!zones.length && !wells.length)) none(label + ": none found");
        else found([zones.length ? "In " + zones.join(", ") : null, wells.length ? plural(wells.length, "well", "wells") + " nearby" + (wells.some((w) => w.on_farm) ? " (" + wells.filter((w) => w.on_farm).length + " on the farm)" : "") : null].filter(Boolean).join("; "),
          wells.slice(0, 5).map((w) => (w.well_no || w.external_id) + " · " + Math.round(num(w.distance_m) || 0) + " m" + (num(w.depth_m) != null ? " · " + num(w.depth_m) + " m deep" : "")).join("; ") || null,
          [zones, wells.map((w) => w.external_id)]);
      } else {
        const n = keys.reduce((a, k) => a + (num(counts.get(k)?.count) || 0), 0), on = keys.reduce((a, k) => a + (num(counts.get(k)?.on_farm) || 0), 0);
        const [one, many] = words || ["feature", "features"];
        // CAP1a: a source with more than 5,000 in the context is not counted exactly ({count: 5000, more_than: 5000})
        const more = keys.some((k) => counts.get(k)?.more_than != null);
        if (!n) none(label + ": none in the farm's context");
        else found((more ? "More than " + n.toLocaleString("en-NZ") + " " + many : plural(n, one, many)) + " in the farm's context" +
          (on && !more ? ", " + on + " on the farm" : ""), null, [n, on]);
      }
    }
    return out;
  }

  // ---- 3. documents -------------------------------------------------------------------------------------------------
  const listed = (docs) => docs.filter((d) => !OWN_TYPES.includes(docType(d)));
  function documentItems(inputs) {
    const docs = listed(list(inputs.documents)), out = [];
    const primaries = docs.filter((d) => d.tier === "primary"), byParent = new Map();
    for (const d of docs) if (d.relates_to) byParent.set(d.relates_to, [...(byParent.get(d.relates_to) || []), d]);
    if (!docs.length) out.push(item("documents", "document.held", "gap", "none", "No documents yet: add the farm's plans, consents and reports",
      { detail: "Drop them in Documents; each is classified by its name and a person confirms the kind and tier.", action: { kind: "documents", label: "Open Documents" }, evidence: 0 }));
    for (const d of primaries) {
      const under = byParent.get(d.id) || [];
      out.push(item("documents", "document.held", "done", d.id, docTitle(d) + (under.length ? " (with " + plural(under.length, "supporting document", "supporting documents") + ")" : ""),
        { source: docRef(d), detail: [d.doc_type, day(d.date_prepared) ? "prepared " + date(d.date_prepared) : null, d.visibility !== "farm" ? "visible: " + d.visibility : null].filter(Boolean).join(" · "), evidence: [d.id, under.map((u) => u.id)] }));
    }
    for (const d of docs.filter((x) => !x.tiered_at && x.tier !== "archive"))
      out.push(item("documents", "document.tier_unconfirmed", "verify", d.id, "Confirm what " + docTitle(d) + " is: its kind and tier come from its name only",
        { source: docRef(d), action: { kind: "documents", item: d.id, label: "Open in Documents" }, evidence: [d.tier, d.doc_type] }));
    return out;
  }

  // ---- 4. what can be proposed ---------------------------------------------------------------------------------------
  // A reader's output, summarised: a PL11 confirm report (plan-import-report/1) or a read-in PlanDocument (plan-document/1).
  function planProposals(json) {
    if (!json || typeof json !== "object") return null;
    const label = (v) => [v.node, v.instance, v.field].filter((x) => x != null && x !== "").join(" · ");
    const show = (v) => v == null ? "(blank)" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (json.schema === "plan-import-report/1") {
      const values = list(json.values);
      return { kind: "confirm_report", accepted: values.filter((v) => v.accept).length, total: values.length,
        disagreements: list(json.disagreements).length, unmapped: list(json.unmapped).length, confirmed_by: json.confirmed_by || null,
        values: values.slice(0, 40).map((v) => ({ label: label(v), value: show(v.value), accepted: !!v.accept, fact_type: v.fact_type || null })) };
    }
    if (json.schema === "plan-document/1") {
      const values = list(json.values);
      return { kind: "plan_document", total: values.length, unmapped: list(json.unmapped).length,
        values: values.slice(0, 40).map((v) => ({ label: label(v), value: show(v.value), confidence: num(v.confidence) })) };
    }
    return null;
  }
  // FU4: who asked for a plan to be read in and when (the person's display name when they had one; the day in New Zealand).
  const nzDates = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });
  const requestedBy = (r) => String(r.requested_by_name || "").trim() || "a farm editor";
  const requestedOn = (r) => (Number.isFinite(Date.parse(r.requested_at)) ? nzDates.format(new Date(r.requested_at)) : "a date not recorded");
  function proposalItems(inputs, opts) {
    const docs = list(inputs.documents), c = inputs.consents || {}, out = [], plans = opts.plans || {};
    const plansHeld = docs.filter((d) => PLAN_TYPES.includes(docType(d)) && d.tier !== "archive");
    for (const p of plansHeld) {
      const imports = docs.filter((d) => docType(d) === "plan_import" && d.relates_to === p.id);
      const reports = docs.filter((d) => docType(d) === "plan_import_report" && d.relates_to === p.id);
      for (const r of reports) {
        const s = plans[r.id];
        out.push(item("proposals", "fep.confirm_report", "propose", r.id, "A confirm report for " + docTitle(p) + " is waiting" +
          (s ? ": " + s.total + " values proposed, " + s.accepted + " accepted so far" + (s.disagreements ? ", " + plural(s.disagreements, "disagreement", "disagreements") + " with recorded facts" : "") : ""),
          { detail: "An advisor checks each value and confirms the import in one pass; nothing is loaded until then.", source: docRef(r), proposals: s || null, evidence: [r.id, s?.accepted, s?.total] }));
      }
      if (imports.length) {
        const s = plans[imports[0].id];
        out.push(item("proposals", "fep.read_in", "done", p.id, docTitle(p) + " has been read in (" + date(imports[0].created_at) + ")",
          { detail: s ? s.total + " values read from it" : null, source: docRef(imports[0]), proposals: s || null, evidence: imports.map((d) => d.id) }));
      } else if (!reports.length) {
        // FU4: the farm editor's "Read this plan in" (public.plan_import_requests, opts.requests) is what makes this the advisor's queue: who asked and when.
        const ask = list(opts.requests).find((r) => r && r.status === "requested" && String(r.document_id) === String(p.id));
        out.push(item("proposals", "fep.not_read", "propose", p.id, "An advisor reads this plan in: " + docTitle(p) + (ask ? " (requested by " + requestedBy(ask) + ", " + requestedOn(ask) + ")" : ""),
          { detail: (ask ? "Asked for by " + requestedBy(ask) + " on " + requestedOn(ask) + ". " : "") + "Not read in yet. The plan reader proposes its land units, areas, actions and ratings for the advisor to confirm in one pass (PL11); nothing is loaded without that confirm.",
            source: docRef(p), action: { kind: "advisor", label: "For an advisor" }, evidence: p.id }));
      }
    }
    for (const k of list(c.candidates).filter((x) => !x.already_registered && !x.dismissed))
      out.push(item("proposals", "consent.not_recorded", "propose", crcOf(k.consent_no), "ECan consent " + crcOf(k.consent_no) + " is on the farm but not in its register",
        { detail: [k.consent_type || k.permit_type, k.status, k.valid_to ? "expires " + date(k.valid_to) : null].filter(Boolean).join(" · ") + ". An advisor adds it to the register or records that it isn't the farm's.",
          source: { kind: "reference", key: "ecan-consents", name: "Resource consents (ECan)", as_at: day(c.ecan_as_at) }, action: { kind: "advisor", label: "For an advisor" }, evidence: k }));
    for (const a of list(c.register).filter((x) => !x.has_conditions && x.consent_no))
      out.push(item("proposals", "consent.no_conditions", "propose", crcOf(a.consent_no), "Conditions of " + crcOf(a.consent_no) + " aren't recorded: fetch them from ECan",
        { detail: "An advisor fetches the conditions from ECan's Open Data Portal and accepts them; nothing is recorded until then.", action: { kind: "whats_due", label: "Open What's due" },
          source: { kind: "reference", key: "ecan-consent-conditions", name: "Consent conditions (ECan Open Data Portal)", licence: "CC BY 4.0" }, evidence: a.id }));
    return out;
  }

  // ---- 5. gaps, duplicates and mismatches ----------------------------------------------------------------------------
  const normTitle = (t) => String(t || "").toLowerCase().replace(/\.[a-z0-9]{1,5}$/, "").replace(/\b(final|issued|signed|copy|draft|v\d+)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  function duplicates(docs) {
    const live = listed(docs).filter((d) => d.tier !== "archive"), pairs = new Map();
    const add = (a, b, why) => { const ids = [a.id, b.id].sort(), k = ids.join("|"); if (!pairs.has(k)) pairs.set(k, { a, b, why }); };
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const sameCrc = a.tier === "primary" && b.tier === "primary" && docType(a) === docType(b) && list(a.crcs).some((x) => list(b.crcs).includes(x));
      const sameTitle = normTitle(a.title) && normTitle(a.title) === normTitle(b.title) && (day(a.date_prepared) || null) === (day(b.date_prepared) || null);
      const sameName = a.original_name && String(a.original_name).toLowerCase() === String(b.original_name || "").toLowerCase();
      if (sameCrc) add(a, b, "same kind and consent number " + list(a.crcs).find((x) => list(b.crcs).includes(x)));
      else if (sameName) add(a, b, "same file name, different contents");
      else if (sameTitle) add(a, b, "same title" + (day(a.date_prepared) ? " and date" : ""));
    }
    return [...pairs.entries()].map(([k, p]) => item("checks", "document.duplicate", "verify", k, "Possible duplicate: " + docTitle(p.a) + " and " + docTitle(p.b),
      { detail: p.why + ". If one replaces the other, move the older to Archive.", sources: [docRef(p.a), docRef(p.b)], action: { kind: "documents", item: p.a.id, label: "Open in Documents" }, evidence: k }));
  }
  function checkItems(inputs) {
    const out = [], docs = list(inputs.documents), byId = new Map(docs.map((d) => [d.id, d])), c = inputs.consents || {};
    // Areas: what a document states against the land held.
    const held = heldArea(inputs.holding), seen = new Set();
    for (const f of list(inputs.facts).filter((x) => x.fact_type === "farm_area" && num(x.value_num) != null)) {
      if (seen.has(f.source_document_id)) continue;   // the newest stated area per document (inputs are newest first)
      seen.add(f.source_document_id);
      const d = byId.get(f.source_document_id), stated = num(f.value_num);
      if (!held) continue;
      const diff = Math.abs(stated - held.area), share = diff / Math.max(stated, held.area);
      const subject = f.source_document_id + ":" + held.kind, srcs = [docRef(d) || { kind: "document", id: f.source_document_id, title: "a document" }, fnRef("onboarding_report_inputs: " + held.basis)];
      if (diff > AREA_HA && share > AREA_PCT)
        out.push(item("checks", "area.mismatch", "verify", subject, (d ? docTitle(d) : "A document") + " states " + ha(stated) + "; " + held.basis + " total " + ha(held.area),
          { detail: "They differ by " + ha(diff) + " (" + Math.round(share * 100) + " %). The plan may describe a different area (effective, leased, before a purchase), or the holding may be incomplete." + (f.source_page ? " Stated on page " + f.source_page + "." : ""),
            sources: srcs, evidence: [stated, Math.round(held.area * 100) / 100] }));
      else out.push(item("checks", "area.agrees", "done", subject, (d ? docTitle(d) : "A document") + "'s stated area (" + ha(stated) + ") agrees with " + held.basis + " (" + ha(held.area) + ")",
        { sources: srcs, evidence: [stated, Math.round(held.area * 100) / 100] }));
    }
    // Consents: every number the farm names, against ECan's record.
    const named = new Map();
    for (const a of list(c.register)) if (a.consent_no) named.set(crcOf(a.consent_no), [...(named.get(crcOf(a.consent_no)) || []), "the consent register"]);
    for (const d of listed(docs)) for (const n of list(d.crcs)) named.set(n, [...(named.get(n) || []), docTitle(d)]);
    const ecanSrc = { kind: "reference", key: "ecan-consents", name: "Resource consents (ECan)", as_at: day(c.ecan_as_at) };
    if (named.size && !c.ecan_served)
      out.push(item("checks", "consent.ecan_not_loaded", "unavailable", "ecan", "ECan's consents aren't loaded yet, so the farm's consent numbers can't be checked against them", { evidence: [...named.keys()].sort() }));
    else for (const e of list(c.ecan)) {
      const where = [...new Set(named.get(e.consent_no) || [])];
      if (!e.found) out.push(item("checks", "consent.not_in_ecan", "verify", e.consent_no, e.consent_no + " is named in " + where.join(" and ") + " but isn't in ECan's consents" + (c.ecan_as_at ? " (as at " + date(c.ecan_as_at) + ")" : ""),
        { detail: "It may be mistyped, surrendered, or newer than ECan's data. Check the number against the consent decision.", sources: [ecanSrc], evidence: [e.consent_no, false] }));
      const reg = list(c.register).find((a) => crcOf(a.consent_no) === e.consent_no);
      if (e.found && reg) {
        const diffs = [];
        if (day(reg.valid_to) && day(e.valid_to) && day(reg.valid_to) !== day(e.valid_to)) diffs.push("expiry " + date(reg.valid_to) + " in the register, " + date(e.valid_to) + " in ECan's data");
        if (reg.status && e.status && String(reg.status).trim().toLowerCase() !== String(e.status).trim().toLowerCase()) diffs.push("status “" + reg.status + "” in the register, “" + e.status + "” in ECan's data");
        if (diffs.length) out.push(item("checks", "consent.status_differs", "verify", e.consent_no, e.consent_no + ": the register and ECan's data differ",
          { detail: diffs.join("; ") + ".", sources: [ecanSrc], evidence: [reg.valid_to, reg.status, e.valid_to, e.status] }));
      }
    }
    // Absent evidence: a consent with no decision on file; no plan at all.
    for (const a of list(c.register).filter((x) => x.consent_no)) {
      const n = crcOf(a.consent_no);
      const decision = a.source_document_id || listed(docs).some((d) => list(d.crcs).includes(n) && ["consent_decision", "consent"].includes(docType(d)));
      if (!decision) out.push(item("checks", "consent.no_decision", "gap", n, "No consent decision on file for " + n,
        { detail: "Add the decision document so its conditions and dates can be checked against the source.", action: { kind: "documents", label: "Add it in Documents" }, evidence: n }));
    }
    if (!docs.some((d) => PLAN_TYPES.includes(docType(d)) && d.tier !== "archive"))
      out.push(item("checks", "fep.missing", "gap", "plan", "No Farm Environment Plan or Freshwater Farm Plan on file",
        { detail: "If the farm has one, add it in Documents; an advisor can then read it in.", action: { kind: "documents", label: "Add it in Documents" }, evidence: 0 }));
    return out.concat(duplicates(docs));
  }

  // ---- 6. sharing ---------------------------------------------------------------------------------------------------
  const SHARE_WORDS = { aggregated: "in catchment totals only (aggregated)", anonymous: "in catchment views without its name (anonymous)", named: "in catchment views by name (named)" };
  function sharingItems(inputs) {
    const s = inputs.sharing || {}, groups = list(s.groups), out = [];
    out.push(item("sharing", "sharing", "found", "groups", groups.length ? "Member of " + groups.map((g) => (g.name || "a catchment group") + (g.status === "active" ? "" : " (" + g.status + ")")).join(", ") : "Not a member of any catchment group", { evidence: groups }));
    out.push(item("sharing", "sharing", "found", "catchment_share", s.catchment_share ? "Shown " + (SHARE_WORDS[s.catchment_share] || s.catchment_share) : "Not in any catchment rollup", { evidence: s.catchment_share || null }));
    const e = s.entries || {}, d = s.documents || {};
    const parts = [[num(d.group), "document", "documents", "a group"], [num(d.public), "document", "documents", "a public link"],
      [num(e.group), "record", "records", "a group"], [num(e.public), "record", "records", "a public link"]].filter(([n]) => n > 0);
    out.push(item("sharing", "sharing", "found", "shared", parts.length ? parts.map(([n, one, many, how]) => plural(n, one, many) + " shared with " + how).join("; ") : "Nothing shared",
      { detail: "Counts of what you can see; sharing is set by the farm's owner.", evidence: [e, d] }));
    return out;
  }

  // ---- ticks ----------------------------------------------------------------------------------------------------------
  // Saved ticks (from the last saved report) then a draft's (unsaved, this browser), each kept only while the item's
  // evidence is what it was when ticked.
  function applyTicks(items, ...sources) {
    const by = new Map(items.map((i) => [i.key, i]));
    for (const ticks of sources) for (const [key, t] of Object.entries(ticks || {})) {
      const it = by.get(key);
      if (it && t && t.verdict === "cleared") { delete it.checked; delete it.stale_tick; continue; }   // a draft's undo of a saved tick
      if (!it || !t || !VERDICTS.includes(t.verdict)) continue;
      if (t.evidence !== undefined && t.evidence !== it.evidence) { it.stale_tick = { verdict: t.verdict, at: t.at || null }; delete it.checked; continue; }
      it.checked = { verdict: t.verdict, note: t.note ? String(t.note).slice(0, 500) : null, by: t.by || null, at: t.at || null };
      delete it.stale_tick;
    }
    return items;
  }
  // ---- decisions (ON3d) -----------------------------------------------------------------------------------------------
  const isDecisionKey = (key) => DECISION_RULES.some((r) => String(key).startsWith(r + ":"));
  // The row that speaks for a finding: its live proposal (proposed, ambiguous or accepted), else the newest rejection; a superseded
  // or applied row is history and says nothing about a finding that is still there.
  function proposalFor(rows, key) {
    const mine = list(rows).filter((r) => r && r.subject_key === key);
    const newest = (a, b) => Number(b.id) - Number(a.id);
    return mine.filter((r) => LIVE_STATUSES.includes(r.status)).sort(newest)[0] || mine.filter((r) => r.status === "rejected").sort(newest)[0] || null;
  }
  // Sets each decision-rule item from the table: its proposal (for the buttons) and, once decided, its `checked`. Whatever a saved
  // report or a browser draft carried onto these items is dropped: the table is the one record of the outcome.
  function applyDecisions(items, rows) {
    for (const it of items) {
      if (!DECISION_RULES.includes(it.rule)) continue;
      delete it.checked; delete it.stale_tick; delete it.proposal;
      const p = proposalFor(rows, it.key);
      if (!p) continue;
      it.proposal = { id: p.id, status: p.status, candidates: list(p.candidates), decision: p.decision || null, decided_by: p.decided_by || null, decided_at: p.decided_at || null };
      if (p.status === "accepted" || p.status === "rejected")
        it.checked = { verdict: p.status === "accepted" ? "correct" : "not_ours", note: p.decision?.note ? String(p.decision.note).slice(0, 500) : null, by: p.decided_by || null, at: p.decided_at || null, decided: true };
    }
    return items;
  }
  // What accepting a candidate means, in words (the candidate's `action` is what app.farm_onboarding_checks writes).
  function candidateText(c) {
    const no = c?.consent_no ? String(c.consent_no) : null;
    switch (c?.action) {
      case "add_to_register": return "Add " + (no || "this consent") + " to the farm's consent register";
      case "fetch_conditions": return "Fetch the conditions of " + (no || "this consent") + " from ECan";
      case "read_plan_in": return "An advisor reads this plan in";
      case "confirm_report": return "An advisor confirms the import from this report";
      default: return "Do what is proposed";
    }
  }
  // The arguments of public.proposals_decide for a button: "accept" (the proposed candidate, or `pick`, an index, among several) or
  // "reject". null when an ambiguous row has no candidate picked.
  function decisionArgs(proposal, action, { pick = null, note = "" } = {}) {
    if (!proposal || !Number.isFinite(Number(proposal.id))) return null;
    const text = String(note || "").trim() || null, cands = list(proposal.candidates);
    if (action === "reject") return { id: proposal.id, status: "rejected", candidate: null, note: text };
    const chosen = pick != null && pick !== "" ? cands[Number(pick)] : proposal.status === "proposed" ? cands[0] : null;
    return chosen ? { id: proposal.id, status: "accepted", candidate: chosen, note: text } : null;
  }
  // Ticks the browser kept before ON3d on the decision-rule items: those still valid, as decisions to make (correct -> accepted,
  // not the farm's -> set aside; "to follow up" decided nothing), and the draft without any decision-rule key, so nothing about
  // these findings is written back to the browser, except a tick whose line has no proposal yet. `report` was built with the table's rows.
  function localTicksToMigrate(report, draft) {
    const items = new Map(list(report?.items).map((i) => [i.key, i]));
    const migrate = [], keep = {};
    for (const [key, t] of Object.entries(draft && typeof draft === "object" ? draft : {})) {
      if (!isDecisionKey(key)) { keep[key] = t; continue; }
      const it = items.get(key);
      if (it && !it.proposal) { keep[key] = t; continue; }   // its line has no proposal (yet): the tick stays until it has one
      if (!it || !OPEN_STATUSES.includes(it.proposal.status) || !t || !["correct", "not_ours"].includes(t.verdict)) continue;
      if (t.evidence !== undefined && t.evidence !== it.evidence) continue;   // what it rested on has changed since
      if (t.verdict === "correct" && it.proposal.status !== "proposed") continue;   // an ambiguous row needs a candidate chosen by a person
      migrate.push({ key, proposal: it.proposal, action: t.verdict === "correct" ? "accept" : "reject", note: t.note ? String(t.note).slice(0, 500) : "" });
    }
    return { migrate, keep };
  }

  const ticksOf = (items) => Object.fromEntries(items.filter((i) => i.checked).map((i) => [i.key, { ...i.checked, evidence: i.evidence }]));

  // ---- the report -----------------------------------------------------------------------------------------------------
  // inputs: onboarding_report_inputs(f); opts: { now (ISO), plans: { docId: planProposals(..) }, saved: previous report JSON, draft: ticks }
  function build(inputs, opts = {}) {
    if (!inputs || typeof inputs !== "object") return null;
    const src = sourceIndex(inputs);
    const items = [...farmItems(inputs, src), ...contextItems(inputs, src), ...documentItems(inputs), ...proposalItems(inputs, opts), ...checkItems(inputs), ...sharingItems(inputs)];
    const aud = audience(inputs);
    // A private earlier report's ticks and notes (perhaps another member's, read by the owner) never pass into a report
    // the whole farm can read.
    applyTicks(items, opts.saved?.audience === "private" && aud !== "private" ? null : opts.saved?.ticks, opts.draft);
    if (Array.isArray(opts.proposals)) applyDecisions(items, opts.proposals);   // ON3d: the table, not a tick, speaks for these findings
    const counts = Object.fromEntries(STATES.map((s) => [s, items.filter((i) => i.state === s).length]));
    counts.checked = items.filter((i) => i.checked).length;
    counts.open = items.filter((i) => ["propose", "verify", "gap"].includes(i.state) && !i.checked).length;
    const sections = SECTIONS.filter(([k]) => k !== "effort").map(([key, title]) => ({ key, title, items: items.filter((i) => i.section === key) }));
    return { farm: { id: inputs.farm?.id || null, name: inputs.farm?.name || null }, inputs_as_at: inputs.as_at || null, counts, sections, items,
      audience: aud, effort: effort(inputs, items, opts) };
  }
  // Narrowest audience: a private document the report names or copies from makes it private (as PL14 issues are). Every
  // document counts, the readers' files too (a confirm report's values are copied in); only earlier onboarding reports
  // don't, as nothing is copied from them but ticks (and a private one's ticks are not carried: build()).
  const audience = (inputs) => list(inputs?.documents).some((d) => docType(d) !== "onboarding_report" && d.visibility === "private") ? "private" : "farm";

  // What it took: elapsed time from the first step, the steps people took by hand, what was found without a person.
  function effort(inputs, items, opts = {}) {
    const e = inputs.effort || {}, now = opts.now || inputs.as_at || null;
    const starts = [e.farm_created_at, e.first_parcel_at, e.first_document_at].filter((x) => typeof x === "string" && Number.isFinite(Date.parse(x)));
    const started = starts.length ? starts.reduce((a, b) => Date.parse(a) <= Date.parse(b) ? a : b) : null;
    const elapsed = started && now && Number.isFinite(Date.parse(now)) ? Math.max(0, Math.round((Date.parse(now) - Date.parse(started)) / 60000)) : null;
    const ticked = items.filter((i) => i.checked), notOurs = ticked.filter((i) => i.checked.verdict === "not_ours").length;
    const proposals = items.filter((i) => i.state === "propose").length + (num(e.dismissals) || 0) + (num(e.conditions_accepted) ? 1 : 0);
    const corrections = (num(e.dismissals) || 0) + notOurs;
    const minutes = num(opts.minutes_by_hand);
    return {
      started_at: started, generated_at: now, elapsed_minutes: elapsed,
      minutes_by_hand: minutes != null && minutes >= 0 && minutes <= 100000 ? Math.round(minutes) : null,
      hand_steps: { parcels_chosen: num(e.parcels_by_person) || 0, boundaries_drawn: num(e.boundaries_drawn) || 0, documents_uploaded: num(e.documents_by_person) || 0,
        tiers_chosen: num(e.tiers_chosen) || 0, consent_candidates_dismissed: num(e.dismissals) || 0, conditions_accepted: num(e.conditions_accepted) || 0, items_checked: ticked.length },
      automatic: { context_found: items.filter((i) => i.section === "context" && i.state === "found").length,
        ecan_matches: items.filter((i) => i.rule === "consent.not_recorded").length + list(inputs.consents?.ecan).filter((x) => x.found).length,
        findings: items.filter((i) => i.section === "checks" && i.state !== "done").length },
      corrections_per_100: proposals ? Math.round((100 * corrections) / proposals) : null,
      timings_ms: { ...(inputs.timings_ms || {}), ...(num(opts.client_ms) != null ? { total: Math.round(num(opts.client_ms)) } : {}) },
    };
  }
  // 45 minutes · 6 hours · 248 days
  const elapsedWords = (m) => m < 120 ? plural(m, "minute", "minutes") : m < 48 * 60 ? Math.round(m / 60) + " hours" : plural(Math.round(m / 1440), "day", "days");
  function effortLines(e) {
    if (!e) return [];
    const h = e.hand_steps || {}, a = e.automatic || {};
    const steps = [[h.parcels_chosen, "parcel chosen", "parcels chosen"], [h.boundaries_drawn, "boundary drawn", "boundaries drawn"], [h.documents_uploaded, "document added", "documents added"],
      [h.tiers_chosen, "document kind confirmed", "document kinds confirmed"], [h.consent_candidates_dismissed, "consent set aside", "consents set aside"],
      [h.conditions_accepted, "condition accepted", "conditions accepted"], [h.items_checked, "item checked", "items checked"]].filter(([n]) => n > 0).map(([n, o, m]) => plural(n, o, m));
    return [
      e.started_at ? "Started " + date(e.started_at) + (e.elapsed_minutes != null ? "; " + elapsedWords(e.elapsed_minutes) + " to this report" : "") : null,
      "By hand: " + (steps.length ? steps.join(", ") : "nothing yet") + (e.minutes_by_hand != null ? "; " + plural(e.minutes_by_hand, "minute", "minutes") + " recorded" : ""),
      "Found without a person: " + plural(a.context_found || 0, "context line", "context lines") + ", " + plural(a.ecan_matches || 0, "ECan match", "ECan matches"),
      e.corrections_per_100 != null ? "Corrections: " + e.corrections_per_100 + " per 100 proposals" : null,
    ].filter(Boolean);
  }

  // The stored document: onboarding-report/1, canonical JSON (sorted keys). person: { id, name }.
  function documentJson(report, { person, now, inputs_hash, minutes_by_hand } = {}) {
    if (!report) return null;
    const e = { ...report.effort, minutes_by_hand: num(minutes_by_hand) != null && num(minutes_by_hand) >= 0 ? Math.round(num(minutes_by_hand)) : report.effort?.minutes_by_hand ?? null };
    const doc = { schema: SCHEMA, rules: RULES_VERSION, thresholds: { area_mismatch_pct: AREA_PCT * 100, area_mismatch_ha: AREA_HA },
      farm: report.farm, generated_at: now || null, generated_by: person ? { id: person.id || null, name: person.name || null } : null,
      inputs_as_at: report.inputs_as_at, inputs_hash: inputs_hash || null, audience: report.audience, counts: report.counts,
      sections: report.sections.map((s) => ({ key: s.key, title: s.title, items: s.items.map(({ section, proposal, ...i }) => i) })),
      ticks: ticksOf(report.items), effort: e };
    return stable(doc);
  }
  // A saved report read back (null when it is not one).
  function readDocument(text) {
    try { const d = typeof text === "string" ? JSON.parse(text) : text; return d && d.schema === SCHEMA && Array.isArray(d.sections) ? d : null; } catch { return null; }
  }
  // A saved report as the checklist draws it: the same shape build() returns.
  function fromDocument(d) {
    if (!d) return null;
    const sections = list(d.sections).map((s) => ({ key: s.key, title: s.title, items: list(s.items).map((i) => ({ ...i, section: s.key })) }));
    return { farm: d.farm || {}, inputs_as_at: d.inputs_as_at || null, counts: d.counts || {}, sections, items: sections.flatMap((s) => s.items),
      audience: d.audience || "farm", effort: d.effort || null, saved: { at: d.generated_at || null, by: d.generated_by || null } };
  }
  const fileName = (now) => "onboarding-report-" + (day(now) || "undated") + ".json";
  const title = (now) => "Onboarding report, " + date(now);
  // MC3: the saved report's effort block as the row public.onboarding_effort_records keeps (numbers only; the stored file holds the
  // same block). A count that is not a plain number is dropped, never guessed. null when there is no effort block.
  function effortRecord(e) {
    if (!e || typeof e !== "object") return null;
    const whole = (v) => { const n = num(v); return n != null && n >= 0 && n <= 100000000 ? Math.round(n) : null; };
    const counts = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" && !Array.isArray(o) ? o : {}).map(([k, v]) => [k, whole(v)]).filter(([, v]) => v !== null));
    const when = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
    const minutes = whole(e.minutes_by_hand);
    return { started_at: when(e.started_at), elapsed_minutes: whole(e.elapsed_minutes), minutes_by_hand: minutes !== null && minutes <= 100000 ? minutes : null,
      hand_steps: counts(e.hand_steps), automatic: counts(e.automatic), corrections_per_100: whole(e.corrections_per_100) };
  }
  // Plan reader files worth fetching for proposals: a PL11 confirm report or a read-in PlanDocument, JSON, under 2 MB.
  const planFiles = (inputs) => list(inputs?.documents).filter((d) => ["plan_import", "plan_import_report"].includes(docType(d)) && d.storage_path &&
    (/json/i.test(d.mime_type || "") || /\.json$/i.test(d.storage_path)) && (num(d.size_bytes) == null || num(d.size_bytes) <= 2 * 1024 * 1024));
  const isIntent = (text) => /\bonboard(ing)?\b|\bget(ting)? started\b|\breadiness\b|\bset ?up (the|this) farm\b/i.test(String(text || ""));

  return { SCHEMA, RULES_VERSION, AREA_PCT, AREA_HA, STATES, VERDICTS, SECTIONS, RULES, THEMES, FARM_CHECK_KIND, DECISION_RULES, build, applyTicks,
    applyDecisions, candidateText, decisionArgs, localTicksToMigrate, isDecisionKey, ticksOf, planProposals, heldArea,
    audience, effort, effortLines, effortRecord, documentJson, readDocument, fromDocument, fileName, title, planFiles, isIntent, sourceLine, normTitle };
});
