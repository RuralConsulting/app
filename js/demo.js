// Demo mode: synthetic, memory-only data from tests/app/fixtures/demo-farm.json. Never constructs a Supabase client.
// What's due's two verbs work in the demo (E5): marking a condition done and adding its record (an upload, an entry
// and its links) are kept in this page's memory until it is left or reloaded. Nothing else is saved. Ask answers from
// the fixture's own answers (nothing is sent anywhere), so the demo shows an answer's shape. The Operations Layers page
// (LN1) writes its advisor notes to memory too, and the map's info panels read them.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.FP = root.FP || {};
    const hash = root.location.hash;
    const active = api.isRoute(hash), sparse = api.isSparse(hash), farmer = api.isFarmer(hash), multi = api.isMulti(hash);
    const ready = active ? fetch("demo/demo-farm.json").then((r) => {
      if (!r.ok) throw new Error("Demo fixture unavailable. Build the app before opening the demo.");
      return r.json();
    }).then((fixture) => api.dataset(fixture, { sparse, farmer, multi })) : null;
    root.FP.demo = { ...api, active, sparse, farmer, href: (h) => api.href(h, sparse, farmer, multi), ready, client: active ? api.client(ready) : null };
    // Entering or leaving a demo variant always starts a fresh runtime. Real sessions are neither read nor changed.
    root.addEventListener("hashchange", (event) => {
      const h = root.location.hash;
      if (api.isRoute(h) !== active || api.isSparse(h) !== sparse || api.isFarmer(h) !== farmer || api.isMulti(h) !== multi) { event.stopImmediatePropagation(); root.location.reload(); }
    });
  }
})(typeof window === "undefined" ? globalThis : window, function () {
  const FARM = "de000000-0000-4000-8000-000000000001";
  const USER = "de000000-0000-4000-8000-000000000003";
  const ORG = "de000000-0000-4000-8000-000000000004";
  const FARM2 = "de000000-0000-4000-8000-000000000005";
  const PHOTO = "demo/photo-synthetic.svg";   // a drawn stand-in: no real photo is in the demo
  const VIEWS = /^$|^\/(ask|create|documents|people|onboarding)$/;
  const copy = (v) => structuredClone(v);
  const isRoute = (hash) => /^#\/demo(?:\/|\?|$)/.test(hash);
  const isSparse = (hash) => /^#\/demo\/empty(?:\/|\?|$)/.test(hash);
  const isFarmer = (hash) => /^#\/demo\/farmer(?:\/|\?|$)/.test(hash);
  const isMulti = (hash) => /^#\/demo\/multi(?:\/|\?|$)/.test(hash);
  // "#/demo..." -> the app's own "#/farm/<id>..." route ("" is the portfolio, null is not a demo route).
  function routeHash(hash) {
    const multi = isMulti(hash);
    const [path, query] = hash.replace(/^#\/demo\/(empty|farmer|multi)(?=\/|\?|$)/, "#/demo").split("?");
    let suffix = path.slice("#/demo".length), farm = FARM;
    if (suffix === "/") suffix = "";
    if (suffix === "/farms") return "";
    if (suffix === "/layers") return "#/layers";                  // Layer notes (LN2): the same screen for advisors and farm editors
    if (suffix === "/ops" && !multi) return "#/ops";            // the staff Operations page
    if (suffix === "/ops/layers" && !multi) return "#/ops/layers";   // and its Layers page (advisor notes)
    if (suffix === "/blocks" && !multi) return "#/blocks" + (query ? "?" + query : "");   // the block gallery
    if (suffix === "/plans" && !multi) return "#/plans" + (query ? "?" + query : "");     // the FEP and FWFP documents
    // Two farms: "#/demo/multi" is the portfolio; "#/demo/multi/farm-1" and ".../farm-2" open one.
    if (multi) {
      if (suffix === "") return "";
      const m = suffix.match(/^\/farm-([12])(?=\/|$)/);
      if (!m) return null;
      farm = m[1] === "2" ? FARM2 : FARM; suffix = suffix.slice(7);
    }
    if (!VIEWS.test(suffix)) return null;
    return "#/farm/" + farm + suffix + (query ? "?" + query : "");
  }
  function href(hash, sparse = false, farmer = false, multi = false) {
    if (hash === "") return multi ? "#/demo/multi" : "#/demo/farms";
    if (hash === "#/layers") return "#/demo" + (multi ? "/multi" : sparse ? "/empty" : farmer ? "/farmer" : "") + "/layers";
    if (hash === "#/ops") return "#/demo/ops";
    if (hash === "#/ops/layers") return "#/demo/ops/layers";
    if (/^#\/(?:blocks|plans)(?:\?|$)/.test(hash)) return "#/demo" + hash.slice(1);
    const farm = [FARM, FARM2].find((id) => hash.startsWith("#/farm/" + id));
    if (!farm) return hash;
    return "#/demo" + (multi ? "/multi/farm-" + (farm === FARM2 ? 2 : 1) : sparse ? "/empty" : farmer ? "/farmer" : "") + hash.slice(("#/farm/" + farm).length);
  }
  const polygon = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
  const feature = (geometry, properties) => ({ type: "Feature", geometry, properties });
  const collection = (features) => ({ type: "FeatureCollection", features });
  const owned = (rows, farm) => rows.map((r) => ({ ...r, farm_id: farm }));
  function dataset(fixture, { sparse = false, farmer = false, multi = false } = {}) {
    const f = copy(fixture);
    const farm = { id: FARM, org_id: ORG, name: f.farm.name, region: f.farm.region || null };
    // Illustrative rectangles, not the farm boundary or a survey.
    const extent = polygon(172, -43, 172.025, -42.98);
    const units = f.land_units.map((u, i) => {
      const w = 172 + (i % 2) * .0125, s = -43 + Math.floor(i / 2) * .01;
      return feature(polygon(w, s, w + .0125, s + .01), { code: u.code, name: u.name, area_ha: u.area_ha, method: "digitised from the farm plan map",
        shown_as: "Example Advisory Ltd, Aug 2024", label_at: [w + .00625, s + .005] });
    });
    const landUnits = collection(units);
    // Photo points as the photo import shapes them (file name, EXIF date and time, altitude, the camera's direction when
    // it wrote one), placed by their share of the illustrative extent.
    const photos = (f.photos || []).map(({ id, at, ...props }) => ({ type: "Feature", id, geometry: { type: "Point", coordinates: [172 + at[0] * .025, -43 + at[1] * .02] },
      properties: { ...props, storage_path: PHOTO } }));
    // An illustrative creek and drain across the rectangles (what a setback condition is about), not a survey.
    const water = f.waterways ? [{ id: "demo-waterways", name: f.waterways.name, theme: "waterways", geometry_type: "line", epistemic_class: "assessment",
      source: f.waterways.source, as_at: "2024-08-01", shown_as: "Example Advisory Ltd, Aug 2024", features: collection([
        feature({ type: "LineString", coordinates: [[172.0118, -42.9802], [172.0131, -42.9875], [172.0122, -42.994], [172.0134, -42.9998]] }, { name: "Creek (synthetic)" }),
        feature({ type: "LineString", coordinates: [[172.0005, -42.9952], [172.006, -42.9948], [172.0122, -42.994]] }, { name: "Drain (synthetic)", resolution: "beside", resolution_reason: "official_governs" })]) }] : [];
    const map = {
      farm: { id: FARM, name: farm.name, region: farm.region }, extent, extent_ha: f.extent_ha,
      titles: collection(f.titles.map((t) => feature(extent, { title_no: t.title_no, estate: t.estate, source: "Synthetic title", area_ha: t.area_ha }))),
      land_units: landUnits, reference: [],
      layers: [{ id: "demo-units", name: "Land units (synthetic)", theme: "land_units", geometry_type: "polygon",
        epistemic_class: "assessment", source: "the 2024 farm plan map", as_at: "2024-08-01", shown_as: "Example Advisory Ltd, Aug 2024", features: landUnits }, ...water,
      ...(photos.length ? [{ id: "demo-photos", name: "Photos (synthetic)", theme: "photos", geometry_type: "point", epistemic_class: "observation",
        source: "a farm walk", as_at: "2024-10-02", shown_as: null, features: collection(photos) }] : [])],
    };
    const data = { asAt: f.as_at, map, map2: null, user: { id: USER, email: "advisor@example.test" }, tables: {
      farms: [farm], farm_members: [{ farm_id: FARM, user_id: USER, role: "admin" }], org_members: [{ org_id: ORG, user_id: USER, role: "advisor" }],
      documents: owned(f.documents, FARM), authorisations: owned(f.authorisations, FARM), obligations: owned(f.obligations, FARM),
      // one condition marked done and one with its record linked, so What's due and the gallery show both
      checks: owned(f.checks || [], FARM), record_types: f.record_types || [], entries: owned(f.entries || [], FARM), entry_links: owned(f.entry_links || [], FARM),
      // The staff Operations page: invented job records, one failing and one late. The farmer demo is not staff.
      profiles: [{ user_id: USER, is_staff: true }], ops_job_status: f.ops.jobs, ops_reference_status: f.ops.references,
      // Invented how-to recipes (AI1): one approved, one draft. Approve / Retire answer that the demo does not save changes.
      ai_recipes: f.ops.recipes || [],
      // The Layers page (LN1): invented reference sources and advisor notes; the advisor's organisation is a group scope.
      reference_sources: f.ops.sources || [], layer_notes: f.ops.layer_notes || [],
      map_layers: map.layers.map((l) => ({ id: l.id, name: l.name, theme: l.theme, farm_id: FARM, org_id: null })),
      organisations: [{ id: ORG, name: "Example Advisory Ltd (synthetic)" }],
      // FB1: the farm's holding and farmed boundary start empty; the parcels around it are invented (parcels()).
      farm_parcels: [], farm_boundaries: [],
    }, build: f.ops.build, loadGaps: f.ops.load_gaps || [], ask: f.ask || [], parcels: parcels(extent), wq: null, wqEmpty: false };   // wq is made when first read (wqOf): wq-model.js may load after this
    if (sparse) {
      farm.name = "Example farm — almost empty";
      data.map = { ...map, farm: { id: FARM, name: farm.name, region: farm.region }, titles: collection([]), land_units: collection([]), layers: [] };
      data.tables.documents = []; data.tables.authorisations = []; data.tables.obligations = [];
      data.tables.checks = []; data.tables.entries = []; data.tables.entry_links = [];
      data.ask = [];
      data.wqEmpty = true;   // no titles, so no monitoring site is near
    }
    if (farmer) {
      data.tables.farm_members[0].role = "owner"; data.tables.org_members = [];
      data.user.email = "farmer@example.test";
      data.tables.profiles = [{ user_id: USER, is_staff: false }]; data.tables.ops_job_status = []; data.tables.ops_reference_status = [];
      data.tables.ai_recipes = (f.ops.recipes || []).filter((r) => r.status === "approved");   // what a farmer can read
    }
    if (multi) {
      // A second, small farm so the portfolio can be exercised: its own extent, one authorisation, two documents.
      const second = { id: FARM2, org_id: ORG, name: "Waiau Flats — synthetic demo", region: "canterbury" };
      data.tables.farms.push(second);
      data.tables.farm_members.push({ farm_id: FARM2, user_id: USER, role: "admin" });
      data.tables.documents.push(
        { id: "demo2-doc-1", farm_id: FARM2, title: "Property notes (synthetic)", doc_type: "memo", date_prepared: "2026-02-01", created_at: "2026-02-03T00:00:00Z" },
        { id: "demo2-doc-2", farm_id: FARM2, title: "Field notes (synthetic)", doc_type: "memo", date_prepared: "2026-05-10", created_at: "2026-05-11T00:00:00Z" });
      data.tables.authorisations.push({ id: "demo2-auth-1", farm_id: FARM2, kind: "consent", title: "Water permit (synthetic)", consent_no: "CRC000201", rule_ref: null,
        valid_from: "2016-01-01", valid_to: "2031-01-01", created_at: "2026-02-03T00:00:00Z" });
      data.map2 = { farm: { id: FARM2, name: second.name, region: second.region }, extent: polygon(172.62, -42.78, 172.64, -42.765), extent_ha: 220,
        titles: collection([]), land_units: collection([]), layers: [], reference: [] };
    }
    // Documents as F1e and B3 leave them: every one primary by default, and the walk notes filed with the plan by a
    // person (so the demo shows a supporting document folded under its main one). relates_to is read through the view.
    const plan = data.tables.documents.find((d) => d.doc_type === "fep");
    for (const d of data.tables.documents) {
      d.tier = d.tier || "primary";
      if (plan && d.doc_type === "memo" && d.farm_id === FARM) Object.assign(d, { tier: "supporting", relates_to: plan.id, tiered_at: f.as_at + "T09:00:00+13:00" });
    }
    data.tables.document_relations = data.tables.documents.map((d) => ({ id: d.id, tier: d.tier, relates_to: d.relates_to || null, superseded_by: null }));
    data.tables.farm_summaries = data.tables.farms.map((x) => summary(data, x));
    data.people = people(data, { sparse, farmer });
    return data;
  }
  // FB1: invented LINZ-style primary parcels around the illustrative extent (not a survey, not real appellations): the two
  // the farm's rectangle is made of, and its neighbours east, south, north and west. Ids as reference_features ids.
  function parcels(extent) {
    const [[w, s], , [e, n]] = extent.coordinates[0], mid = (w + e) / 2;
    const boxes = [
      [w, s, mid, n, "Lot 1 DP 400001"], [mid, s, e, n, "Lot 2 DP 400001"],
      [e, s, e + .015, (s + n) / 2, "Lot 1 DP 500101"], [e, (s + n) / 2, e + .015, n, "Lot 2 DP 500101"], [e + .015, s, e + .03, n, "Rural Section 4410"],
      [w, s - .012, mid, s, "Lot 3 DP 500102"], [mid, s - .012, e, s, "Lot 4 DP 500102"], [e, s - .012, e + .03, s, "Part Rural Section 3981"],
      [w - .015, s - .012, w, n, "Rural Section 3977"], [w - .015, n, e + .03, n + .01, "Lot 1 DP 500150"]];
    return boxes.map(([a, b, c, d, appellation], i) => ({ id: 9001 + i, external_id: "demo-parcel-" + (i + 1), web_geom: polygon(a, b, c, d),
      props: { appellation: appellation + " (synthetic)", parcel_intent: "Fee Simple Title", land_district: "Canterbury" }, on_farm: i < 2 }));
  }
  // Who can open each demo farm, as farm_people (20261029000021) returns it. Invented people only.
  function people(d, { sparse, farmer }) {
    const person = (n, email, role, extra = {}) => ({ user_id: "de000000-0000-4000-8000-0000000001" + n, email, display_name: null, role,
      added_at: "2026-03-02T09:00:00+13:00", is_you: false, signed_in: true, ...extra });
    const you = { user_id: USER, email: d.user.email, display_name: farmer ? null : "Demo advisor", is_you: true, signed_in: true, added_at: "2026-03-02T09:00:00+13:00" };
    const one = farmer
      ? [{ ...you, role: "owner" }, person("01", "advisor@example.test", "admin", { display_name: "Demo advisor" })]
      : [person("02", "owner@example.test", "owner"), { ...you, role: "admin" }];
    if (!sparse) one.push(person("03", "manager@example.test", "edit", { display_name: "Farm manager (synthetic)" }),
      person("04", "relief.milker@example.test", "view", { signed_in: false, added_at: d.asAt + "T08:00:00+13:00" }));
    return { [FARM]: one, [FARM2]: [{ ...you, role: "admin" }] };
  }
  // What farm_summaries (0038) gives the portfolio, counted from the same rows.
  function summary(d, farm) {
    const mine = (t) => d.tables[t].filter((r) => r.farm_id === farm.id).length;
    return { id: farm.id, name: farm.name, region: farm.region, extent: (farm.id === FARM2 ? d.map2 : d.map).extent, as_at: d.asAt,
      overdue_actions: 0,
      authorisation_count: mine("authorisations"), document_count: mine("documents") };
  }
  // The tables the demo adds rows to, in memory: What's due's Done (checks) and Add the record (documents, entries, links).
  const KEPT = ["checks", "documents", "entries", "entry_links", "layer_notes"];
  const EDITED = ["layer_notes", "farm_parcels"];   // and the tables whose rows the demo changes (the Layers page; a new block's note)
  let made = 0;
  // The fixture's answer whose words the question contains (the same rule as the app's FP.ask.demoReply).
  function askReply(answers, question) {
    const q = String(question || "").toLowerCase(), all = Array.isArray(answers) ? answers : [];
    const hit = all.find((a) => (a.match || []).some((w) => q.includes(String(w).toLowerCase()))) || all.find((a) => !(a.match || []).length);
    return hit?.reply || { answer_text: "Nothing is recorded on this farm yet.", sources: [], ui_actions: [], confirmations: [], notes: [] };
  }
  // "Fetch conditions from ECan" in the demo (CC1): invented conditions, shaped as the consent-conditions function replies,
  // for a demo consent with none recorded; ECan is never asked. Accept adds them to the demo's obligations, in memory.
  const DEMO_CONDITIONS = [
    { code: "1", heading: "Limits", kind: "practice", text: "The use of land for farming shall only be within the area shown on the plan attached to this consent (synthetic).",
      summary: "The use of land for farming shall only be within the area shown on the plan attached to this consent (synthetic).", limits: [], dates: [], timeframes: [] },
    { code: "2", heading: "Limits", kind: "limit", text: "The area irrigated shall not exceed 40 hectares (synthetic).",
      summary: "The area irrigated shall not exceed 40 hectares (synthetic).", limits: [{ value: 40, unit: "ha", text: "40 hectares" }], dates: [], timeframes: [] },
    { code: "3", heading: "Monitoring", kind: "date", text: "The consent holder shall have the water meter verified within 12 months of the grant of this consent (synthetic).",
      summary: "The consent holder shall have the water meter verified within 12 months of the grant of this consent (synthetic).", limits: [], dates: [], timeframes: ["within 12 months of the grant of this consent"] },
  ];
  function demoConditions(d, body) {
    const no = String(body?.consent_no || "").trim().toUpperCase();
    const a = d.tables.authorisations.find((x) => x.farm_id === body?.farm_id && x.kind === "consent" && x.consent_no === no);
    if (!a || d.tables.obligations.some((o) => o.authorisation_id === a.id)) return null;
    return { proposal: { verb: "consent.conditions", authorisation_id: a.id, consent_no: no, label: "Record 3 conditions of " + no + " from ECan",
      source: { consent_no: no, url: "https://data.ecan.govt.nz/data/4/RMA%20Authorisations/Consent%20conditions/CSV?RecordNo=" + no + "&zip=0", retrieved_at: d.asAt + "T09:00:00+13:00",
        publisher: "Environment Canterbury", licence: "CC BY 4.0", attribution: "Conditions from Environment Canterbury's Open Data Portal (data.ecan.govt.nz), licensed CC BY 4.0." },
      conditions: copy(DEMO_CONDITIONS), skipped: [{ code: "0", heading: null, reason: "definitions, not a condition" }] } };
  }
  // The block flow's calls in memory: the parcels in a box (each flagged held: on the farm or in its holding), their
  // union (FP.blockModel.dissolve, as st_union), and a block added (the parcels as references, a new farmed boundary
  // version, the map's extent grown). The demo's farm is the only one with parcels.
  // ON1: the onboarding report's inputs for a demo farm, shaped as public.onboarding_report_inputs returns them. Its records
  // are the fixture's; the public context is invented (synthetic sources, names and counts).
  function onboardingInputs(d, f) {
    const B = typeof module === "object" && module.exports ? require("./block-model.js") : globalThis.FP.blockModel;
    const farm = d.tables.farms.find((x) => x.id === f);
    if (!farm) return null;
    const rel = new Map(d.tables.document_relations.map((r) => [r.id, r.relates_to]));
    const crcs = (x) => [...new Set((String(x.title || "") + " " + String(x.original_name || "")).toUpperCase().match(/CRC\s?\d{6}(\.\d{1,2})?/g) || [])].map((s) => s.replace(/\s/g, ""));
    const docs = d.tables.documents.filter((x) => x.farm_id === f).map((x) => ({ id: x.id, title: x.title, doc_type: x.doc_type, original_name: x.original_name || null,
      date_prepared: x.date_prepared || null, created_at: x.created_at, tier: x.tier || "primary", tiered_at: x.tiered_at || null, relates_to: rel.get(x.id) ?? x.relates_to ?? null,
      visibility: x.visibility || "farm", by_person: true, storage_path: x.storage_path || null, mime_type: x.mime_type || null, size_bytes: x.size_bytes || null, crcs: crcs(x) }));
    const consents = d.tables.authorisations.filter((a) => a.farm_id === f && a.kind === "consent");
    const mine = f === FARM, area = mine && d.map?.extent ? B.areaHa(d.map.extent) : null, as = "2026-10-28T00:00:00Z";
    const src = (key, name, theme, provider) => ({ key, name, theme, provider, licence: "CC BY 4.0", licence_status: "open", attribution: provider, refreshed_at: as, served: true, feature_count: null });
    return {
      schema: "onboarding-inputs/1", as_at: d.asAt + "T09:00:00Z", farm: { id: farm.id, name: farm.name, region: farm.region, created_at: "2026-03-01T09:00:00Z", catchment_share: mine ? "aggregated" : null },
      holding: { parcels: [], titles: { count: mine ? 2 : 0, area_ha: area || 0 }, boundary: null, extent_area_ha: area },
      sources: [src("linz-primary-parcels", "NZ Primary Parcels (LINZ)", "parcels", "LINZ"), src("niwa-rec2-rivers", "River Environment Classification 2 (NIWA)", "rivers", "NIWA"),
        src("ecan-wq-sites", "Water quality monitoring sites (ECan)", "monitoring_sites", "Environment Canterbury"), src("ecan-wells", "Wells and bores (ECan)", "wells", "Environment Canterbury"),
        src("ecan-consents", "Resource consents (ECan)", "consents", "Environment Canterbury"), src("smap", "S-map soils (Manaaki Whenua)", "soils", "Manaaki Whenua")],
      context: mine ? { in_context: [{ source_key: "smap", count: 5, on_farm: 3 }, { source_key: "ecan-consents", count: 4, on_farm: 2 }, { source_key: "ecan-wells", count: 6, on_farm: 1 }],
        downstream: { starts: 2, reaches: [{ name: "Example Stream (synthetic)", cum_km: 0.8 }, { name: "Example River (synthetic)", cum_km: 7.4 }], max_km: 50, end_reasons: ["max_km"] },
        sites: [{ source_key: "ecan-wq-sites", external_id: "SYN-1", site_kind: "wq", site_name: "Example Stream at Ford Road (synthetic)", distance_km_along: 2.6 }],
        groundwater: { allocation_zone: { groundwater: [{ name: "Example groundwater zone (synthetic)" }], surface_water: [] },
          wells: [{ external_id: "SYN/0001", well_no: "SYN/0001", distance_m: 140, on_farm: true, depth_m: 38 }, { external_id: "SYN/0002", well_no: "SYN/0002", distance_m: 820, on_farm: false, depth_m: 61 }] },
        surface_water: { count: 4, on_farm: 1, named: [{ name: "Example Stream (synthetic)", on_farm: true, distance_m: 0 }] } } : {},
      consents: { register: consents.map((a) => ({ id: a.id, consent_no: a.consent_no, title: a.title, status: a.status || null, valid_from: a.valid_from || null, valid_to: a.valid_to || null,
          source_document_id: a.source_document_id || null, has_conditions: d.tables.obligations.some((o) => o.authorisation_id === a.id), conditions_accepted: 0 })),
        ecan_served: true, ecan_as_at: as, ecan: [...new Set([...consents.map((a) => a.consent_no), ...docs.flatMap((x) => x.crcs)])].sort().map((n) => ({ consent_no: n, found: n !== "CRC000199", status: null, valid_to: null })),
        candidates: mine ? [{ consent_no: "CRC000150", consent_type: "Water permit", permit_type: "Take groundwater", status: "Issued - Active", valid_from: "2019-04-01", valid_to: "2034-04-01", already_registered: false, dismissed: false, live: true }] : [],
        dismissed: 0 },
      documents: docs, facts: mine ? [{ fact_type: "farm_area", value_num: Math.round((area || 0) * 1.25), unit: "ha", method: "document", source_document_id: docs.find((x) => x.doc_type === "fep")?.id || null, source_page: 4, as_at: "2024-08-01" }].filter((x) => x.source_document_id) : [],
      sharing: { catchment_share: mine ? "aggregated" : null, groups: mine ? [{ org_id: ORG, name: "Example catchment group (synthetic)", status: "active" }] : [], entries: { group: 0, public: 0 }, documents: { group: 0, public: 0 } },
      effort: { farm_created_at: "2026-03-01T09:00:00Z", parcels_by_person: 0, first_parcel_at: null, boundaries_drawn: 0, documents_by_person: docs.length, first_document_at: docs.map((x) => x.created_at).sort()[0] || null,
        tiers_chosen: docs.filter((x) => x.tiered_at).length, dismissals: 0, conditions_accepted: 0, consents_registered: consents.length },
      timings_ms: { holding: 1, context: 1, consents: 1, documents: 1, sharing: 1 }, errors: {},
    };
  }
  function holding(d, name, args) {
    const B = typeof module === "object" && module.exports ? require("./block-model.js") : globalThis.FP.blockModel;
    const mine = args.f === FARM, held = (p) => p.on_farm || d.tables.farm_parcels.some((h) => h.farm_id === args.f && h.external_id === p.external_id);
    const box = (g) => { const cs = g.coordinates[0]; return [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))]; };
    const row = (p) => ({ id: p.id, external_id: p.external_id, web_geom: p.web_geom, props: p.props, area_ha: B.areaHa(p.web_geom), held: held(p) });
    if (name === "parcels_in_view") {
      if (!mine) return [[]];
      return [d.parcels.filter((p) => { const [w, s, e, n] = box(p.web_geom); return w < args.east && e > args.west && s < args.north && n > args.south; }).map(row)];
    }
    const chosen = (args.parcel_ids || []).map((id) => d.parcels.find((p) => p.id === Number(id))).filter(Boolean);
    if (name === "parcel_union") { const g = B.dissolve(chosen.map((p) => p.web_geom)); return [g ? { geometry: g, area_ha: B.areaHa(g), parcels: chosen.length } : null]; }
    if (name === "farm_holding") {
      const parcelsHeld = d.tables.farm_parcels.filter((h) => h.farm_id === args.f).map((h) => { const p = d.parcels.find((x) => x.external_id === h.external_id);
        return { type: "Feature", id: p.id, geometry: p.web_geom, properties: { ...p.props, reference_id: p.id, external_id: h.external_id, held_id: h.id, acquired_on: h.acquired_on, note: h.note, document_id: h.document_id } }; });
      const b = d.tables.farm_boundaries.find((x) => x.farm_id === args.f && !x.valid_to);
      return [{ parcels: collection(parcelsHeld), boundary: b ? { id: b.id, geometry: b.geometry, method: b.method, valid_from: b.valid_from, area_ha: B.areaHa(b.geometry) } : null,
        boundary_versions: d.tables.farm_boundaries.filter((x) => x.farm_id === args.f).length }];
    }
    // add_block
    if (!mine || d.tables.farm_members.find((m) => m.farm_id === args.f)?.role === "view") return [null, { message: "Only an editor of this farm can add land to it" }];
    if (!(args.parcel_ids || []).length) return [null, { message: "Choose at least one parcel" }];
    if (chosen.length !== args.parcel_ids.length) return [null, { message: "A chosen parcel is not a current LINZ primary parcel" }];
    const block = args.farmed || B.dissolve(chosen.map((p) => p.web_geom)), now = new Date().toISOString();
    const current = d.tables.farm_boundaries.find((x) => x.farm_id === args.f && !x.valid_to);
    const geometry = B.dissolve([current ? current.geometry : d.map.extent, block]) || block;
    const added = [];
    for (const p of chosen) {
      let h = d.tables.farm_parcels.find((x) => x.farm_id === args.f && x.external_id === p.external_id);
      if (!h) {
        h = { id: "demo-held-" + ++made, farm_id: args.f, source_key: "linz-primary-parcels", external_id: p.external_id, acquired_on: args.acquired || null,
          note: args.block_note || null, document_id: null, added_by: d.user.id, added_at: now };
        d.tables.farm_parcels.push(h);
      }
      added.push(h.id);
    }
    if (current) current.valid_to = now;
    const boundary = { id: "demo-boundary-" + ++made, farm_id: args.f, geometry, method: args.farmed ? "drawn" : "parcels", valid_from: now, valid_to: null, made_by: d.user.id };
    d.tables.farm_boundaries.push(boundary);
    // the extent (as farm_extent): what the farm had, its held parcels whole and the farmed boundary
    d.map.extent = B.dissolve([d.map.extent, ...chosen.map((p) => p.web_geom), geometry]) || d.map.extent;
    d.map.extent_ha = Math.round(B.areaHa(d.map.extent) * 10) / 10;
    return [{ parcels: added, boundary: boundary.id }];
  }
  // M1b: invented monitoring sites around the illustrative extent and their results (a labelled demo, not any real site or
  // sample): shared sites "run by ECan" (provisional) and one the farm samples itself. Values are a fixed function of the
  // month, so the demo and its screenshots read the same on every day. Shaped as wq_sites_near / wq_site_latest /
  // measurement_series return them (the geometry in NZTM, as the database stores it).
  const WQ_PARAMS = { "nitrate-nitrite-n": ["Nitrate-nitrite nitrogen (NNN)", "mg/L"], drp: ["Dissolved reactive phosphorus", "mg/L"], "e-coli": ["E. coli", "/100 mL"], turbidity: ["Turbidity", "NTU"] };
  const WQ_SOURCES = {
    "ecan-wq": { name: "Environment Canterbury", attribution: "Source: Environment Canterbury (invented demo values). Results are provisional until reviewed by ECan.", provisional: true },
    "demo-farm-wq": { name: "Example farm's own sampling (synthetic)", attribution: "Source: the farm's own sampling (invented demo values).", provisional: false },
  };
  function wqDemo(extent) {
    const M = typeof module === "object" && module.exports ? require("./wq-model.js") : globalThis.FP.wqModel;
    const [[w, s], , [e, n]] = extent.coordinates[0];
    const place = (lng, lat) => { const [x, y] = M.lngLatToNztm(lng, lat); return { type: "Point", coordinates: [Math.round(x * 100) / 100, Math.round(y * 100) / 100] }; };
    const toBox = (lng, lat) => Math.round(Math.hypot(Math.max(w - lng, 0, lng - e) * 81500, Math.max(s - lat, 0, lat - n) * 111200));   // metres to the extent
    const defs = [
      { id: 9101, external_id: "DEMO-01", name: "Demo Creek at the farm bridge (synthetic)", lng: 172.0315, lat: -42.989, type: "river", params: ["nitrate-nitrite-n", "drp", "e-coli", "turbidity"], from: [2020, 6], base: 1.6 },
      { id: 9102, external_id: "DEMO-02", name: "Demo Creek at the Mill Road ford (synthetic)", lng: 172.012, lat: -43.0125, type: "river", params: ["nitrate-nitrite-n", "drp", "e-coli", "turbidity"], from: [2020, 6], base: 2.3 },
      { id: 9103, external_id: "DEMO-03", name: "Demo River at the gorge (synthetic)", lng: 172.062, lat: -42.968, type: "river", params: ["nitrate-nitrite-n", "drp"], from: [2023, 0], base: 0.7 },
      { id: 9104, external_id: "DEMO-04", name: "Tributary drain at the boundary (synthetic)", lng: 171.9705, lat: -42.995, type: "stream", params: ["nitrate-nitrite-n"], from: [2026, 5], base: 3.1, count: 3 },
      { id: 9105, external_id: "DEMO-05", name: "Lagoon outlet (synthetic)", lng: 172.098, lat: -43.041, type: "lake", params: [], from: [2026, 0], base: 0 },
      { id: 9106, external_id: "FARM-B1", name: "Farm drain sample point (synthetic)", lng: 172.0125, lat: -42.9915, type: "drain", params: ["nitrate-nitrite-n", "drp"], from: [2022, 8], base: 2.0, own: true },
    ];
    const sites = defs.map((d) => ({ site_id: d.id, external_id: d.external_id, name: d.name, site_type: d.type, distance_m: toBox(d.lng, d.lat), geom: place(d.lng, d.lat),
      source_key: d.own ? "demo-farm-wq" : "ecan-wq-sites", owner_farm_id: d.own ? FARM : null, owner_org_id: null }));
    const series = {};
    const wave = (i, k) => Math.sin(i * 0.52 + k) * 0.5 + Math.sin(i * 1.7 + k * 3) * 0.25;
    for (const d of defs) {
      const months = [];
      for (let y = d.from[0], m = d.from[1]; y < 2026 || (y === 2026 && m <= 8); m++) { if (m > 11) { y++; m = 0; } if (y > 2026 || (y === 2026 && m > 8)) break; months.push([y, m]); }
      if (d.count) months.length = d.count;
      d.params.forEach((key, k) => {
        series[d.id + "|" + key] = months.map(([y, m], i) => {
          const sampled_at = new Date(Date.UTC(y, m, 8 + ((i * 5 + k) % 12), 21, 0, 0)).toISOString();
          let value, qualifier = null;
          if (key === "nitrate-nitrite-n") value = Math.max(0.01, d.base * (1 + 0.45 * wave(i, k) + (m >= 5 && m <= 8 ? 0.25 : 0)));
          else if (key === "drp") { value = Math.max(0.002, 0.008 * (d.base + 0.4) * (1 + 0.6 * wave(i, k + 2))); if (value < 0.01) { value = 0.01; qualifier = "<"; } }   // below the lab's limit: kept as "<0.01"
          else if (key === "e-coli") { value = Math.round(Math.max(1, 110 * d.base * (1 + 1.4 * wave(i, k + 1)) * (1 + (m >= 10 || m <= 1 ? 0.5 : 0)))); if (value > 2419) { value = 2419; qualifier = ">"; } }
          else value = Math.max(0.3, 2.6 * d.base * (1 + 0.8 * wave(i, k + 4)));
          if (key !== "e-coli") value = Number(value.toPrecision(3));
          return { sampled_at, value, qualifier, value_text: (qualifier || "") + String(value), unit: WQ_PARAMS[key][1], sample_id: d.external_id + "-" + (i + 1), series: "", replicate_no: 1,
            datetime_flag: null, source_key: d.own ? "demo-farm-wq" : "ecan-wq", superseded_at: null, aggregate: "", n_values: null };
        });
      });
    }
    for (const site of sites) {   // the last sample date is read off the series (null: no results yet)
      const all = Object.entries(series).filter(([k]) => k.startsWith(site.site_id + "|")).flatMap(([, rows]) => rows);
      site.last_sampled = all.length ? all.map((r) => r.sampled_at).sort().pop() : null;
    }
    return { sites, series, params: WQ_PARAMS, sources: WQ_SOURCES };
  }
  function wqOf(d) {
    if (!d.wq) { const w = wqDemo(d.map.extent); d.wq = d.wqEmpty ? { ...w, sites: [], series: {} } : w; }
    return d.wq;
  }
  // wq_site_latest: the newest result of each parameter at a site, with who it is from and whether it is provisional.
  function wqLatest(wq, site) {
    return Object.entries(wq.series).filter(([k]) => k.startsWith(site + "|")).map(([k, rows]) => {
      const key = k.split("|")[1], last = rows[rows.length - 1], src = wq.sources[last.source_key];
      return { parameter: key, parameter_name: wq.params[key][0], value: last.value, qualifier: last.qualifier, value_text: last.value_text, unit: last.unit, sampled_at: last.sampled_at, ambiguous_dst: false,
        source_key: last.source_key, source_name: src.name, attribution: src.attribution, provisional: src.provisional };
    });
  }
  function client(ready) {
    const result = (data = null, error = null) => ({ data: copy(data), error });
    const error = (message) => result(null, { message });
    function query(table) {
      const filters = [], orders = []; let write = false, singular = false, maybe = false, adding = null, changes = null, removing = false;
      const q = {
        select() { return q; }, eq(key, val) { filters.push([key, val]); return q; }, in(key, vals) { filters.push([key, { in: vals }]); return q; },
        order(key, options) { orders.push([key, options?.ascending !== false]); return q; },
        insert(rows) { write = true; adding = rows; return q; }, update(values) { write = true; changes = values || null; return q; }, delete() { write = true; removing = true; return q; },
        single() { singular = true; return execute(); }, maybeSingle() { singular = true; maybe = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        const d = await ready, rows = d.tables[table];
        if (write && adding && KEPT.includes(table)) {
          const now = new Date().toISOString(), added = (Array.isArray(adding) ? adding : [adding]).map((r) => ({ id: "demo-new-" + ++made, created_at: now, ...(table === "layer_notes" ? { updated_at: now, created_by: d.user.id, updated_by: d.user.id } : {}), ...copy(r) }));
          for (const r of added) {
            if (table === "entry_links") r.farm_id = d.tables.entries.find((e) => e.id === r.entry_id)?.farm_id ?? null;
            rows.push(r);
            if (table === "documents") d.tables.document_relations.push({ id: r.id, tier: r.tier, relates_to: r.relates_to || null, superseded_by: null });
          }
          return result(singular ? added[0] : added);
        }
        // A change or removal of a Layers page note: applied in memory to the rows the filters pick.
        if (write && (changes || removing) && EDITED.includes(table) && filters.length) {
          const hit = rows.filter((row) => filters.every(([key, val]) => (val && Array.isArray(val.in) ? val.in.includes(row[key]) : row[key] === val)));
          if (removing) { for (const r of hit) rows.splice(rows.indexOf(r), 1); return result(null); }
          for (const r of hit) Object.assign(r, copy(changes), { updated_at: new Date().toISOString() });
          return singular ? (hit.length === 1 ? result(hit[0]) : error("Demo row not found")) : result(hit);
        }
        if (write) return error("The demo does not save changes");
        if (!rows) return error("This demo does not provide " + table);
        let selected = rows.filter((row) => filters.every(([key, val]) => (val && Array.isArray(val.in) ? val.in.includes(row[key]) : row[key] === val)));
        for (const [key, asc] of [...orders].reverse()) selected = [...selected].sort((a, b) => String(a[key] || "").localeCompare(String(b[key] || "")) * (asc ? 1 : -1));
        if (singular && selected.length !== 1) return maybe && !selected.length ? result(null) : error("Demo row not found");
        return result(singular ? selected[0] : selected);
      }
      return q;
    }
    return {
      auth: {
        getSession: async () => ({ data: { session: { user: (await ready).user } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => result(), signInWithPassword: async () => error("Sign-in is not used in the demo"),
        updateUser: async () => error("Account settings are not available in the demo"),
      },
      from: query,
      // The fixture's own date, so the standing answers read the same on every day the demo is opened.
      today: async () => (await ready).asAt,
      async rpc(name, args) {
        const d = await ready;
        if (name === "farm_map") return result(args.f === FARM ? d.map : args.f === FARM2 ? d.map2 : null);
        if (name === "farm_people") return result(d.people[args.f] || []);
        // As public.layer_notes_for_farm: the global notes, the advisor's organisation's, and the farm's own.
        if (name === "layer_notes_for_farm") return result((d.tables.layer_notes || []).filter((n) => n.scope === "global" || (n.scope === "group" && n.org_id === ORG) || (n.scope === "farm" && n.farm_id === args.f)));
        // As public.accept_consent_conditions (CC1): the proposal's conditions become the consent's, once.
        if (name === "accept_consent_conditions") {
          const a = d.tables.authorisations.find((x) => x.id === args.p_authorisation);
          if (!a || d.tables.obligations.some((o) => o.authorisation_id === a.id)) return error("This consent already has conditions recorded");
          for (const c of args.p_conditions) d.tables.obligations.push({ id: "demo-new-" + ++made, farm_id: a.farm_id, authorisation_id: a.id, code: c.code, summary: c.summary, full_text: c.text,
            kind: c.kind, parameters: { heading: c.heading, source: { url: args.p_source.url, retrieved_at: args.p_source.retrieved_at, licence: "CC BY 4.0" } },
            due_date: null, recurrence: null, source_document_id: null, source_page: null });
          return result(args.p_conditions.length);
        }
        // FB1, as the database's parcels_in_view, parcel_union, add_block and farm_holding, over the invented parcels.
        if (["parcels_in_view", "parcel_union", "add_block", "farm_holding"].includes(name)) return result(...holding(d, name, args || {}));
        // M1b, as the database's wq_sites_near, wq_site_latest and measurement_series, over the invented sites (wqDemo).
        if (name === "wq_sites_near") {
          if (args.farm_id !== FARM) return result([]);
          return result(wqOf(d).sites.filter((x) => x.distance_m <= (args.km ?? 10) * 1000).sort((a, b) => a.distance_m - b.distance_m || a.external_id.localeCompare(b.external_id)));
        }
        if (name === "wq_site_latest") return result(wqLatest(wqOf(d), args.site));
        // ON1, as public.onboarding_report_inputs: the demo farm's own records, and invented public context.
        if (name === "onboarding_report_inputs") return result(onboardingInputs(d, args.f));
        if (name === "measurement_series") {
          const from = args.from_time ? Date.parse(args.from_time) : -Infinity, to = args.to_time ? Date.parse(args.to_time) : Infinity;
          return result((wqOf(d).series[args.site + "|" + args.parameter_key] || []).filter((r) => Date.parse(r.sampled_at) >= from && Date.parse(r.sampled_at) < to));
        }
        // DQ1, as public.group_load_gaps: the invented group's gaps for staff (the demo's advisor); a farmer is in no group.
        if (name === "group_load_gaps") return result(d.tables.profiles[0]?.is_staff ? (d.loadGaps || []).filter((g) => !args?.group_id || g.group_id === args.group_id) : []);
        return error("This operation is not available in the demo");
      },
      // The demo never sends invitations or saves changes; Ask answers from the fixture, the way the Ask function replies.
      functions: { invoke: async (name, options) => {
        if (name === "ask") return result(askReply((await ready).ask, options?.body?.question));
        if (name === "consent-conditions") { const r = demoConditions(await ready, options?.body); return r ? result(r) : error("You can fetch the conditions only of a consent on a farm you edit, whose conditions aren't recorded yet."); }
        return error("The demo does not save changes");
      } },
      // Every document opens the one stand-in page; the demo's photo points name the one stand-in picture.
      storage: { from: () => ({ createSignedUrl: async (path) => result({ signedUrl: new URL(path === PHOTO ? PHOTO : "demo/source.html", typeof location === "undefined" ? "http://localhost/" : location.href).href }),
        upload: async (path) => result({ path }) }) },
    };
  }
  return { FARM, FARM2, USER, ORG, wqOf, wqLatest, askReply, isRoute, isSparse, isFarmer, isMulti, routeHash, href, dataset, client };
});
