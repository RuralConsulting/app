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
    const active = api.isRoute(hash), sparse = api.isSparse(hash), farmer = api.isFarmer(hash), multi = api.isMulti(hash), group = api.isGroup(hash), queue = api.queueOf(hash);
    const ready = active ? fetch("demo/demo-farm.json").then((r) => {
      if (!r.ok) throw new Error("Demo fixture unavailable. Build the app before opening the demo.");
      return r.json();
    }).then((fixture) => api.dataset(fixture, { sparse, farmer, multi, group, queue })) : null;
    root.FP.demo = { ...api, active, sparse, farmer, group, href: (h) => api.href(h, sparse, farmer, multi, group, queue), ready, client: active ? api.client(ready) : null };
    // Entering or leaving a demo variant always starts a fresh runtime. Real sessions are neither read nor changed.
    root.addEventListener("hashchange", (event) => {
      const h = root.location.hash;
      if (api.isRoute(h) !== active || api.isSparse(h) !== sparse || api.isFarmer(h) !== farmer || api.isMulti(h) !== multi || api.isGroup(h) !== group || api.queueOf(h) !== queue) { event.stopImmediatePropagation(); root.location.reload(); }
    });
  }
})(typeof window === "undefined" ? globalThis : window, function () {
  const FARM = "de000000-0000-4000-8000-000000000001";
  const USER = "de000000-0000-4000-8000-000000000003";
  const ORG = "de000000-0000-4000-8000-000000000004";
  const FARM2 = "de000000-0000-4000-8000-000000000005";
  const GROUP = "de000000-0000-4000-8000-000000000006";   // the catchment group (S5): "HDLG (example)", invented members
  const PHOTO = "demo/photo-synthetic.svg";   // a drawn stand-in: no real photo is in the demo
  const VIEWS = /^$|^\/(ask|create|documents|people|onboarding)$/;
  const copy = (v) => structuredClone(v);
  const isRoute = (hash) => /^#\/demo(?:\/|\?|$)/.test(hash);
  const isSparse = (hash) => /^#\/demo\/empty(?:\/|\?|$)/.test(hash);
  const isFarmer = (hash) => /^#\/demo\/farmer(?:\/|\?|$)/.test(hash);
  const isMulti = (hash) => /^#\/demo\/multi(?:\/|\?|$)/.test(hash);
  // The catchment group demo (S5): the advisor is also an admin of "HDLG (example)", a group with invented members.
  const isGroup = (hash) => /^#\/demo\/group(?:\/|\?|$)/.test(hash);
  // ON3b: the group demo's queue as the live one can be: "?queue=sparse" (a handful of rows, mostly ambiguous, and many items
  // with no member evidence) or "?queue=empty" (nothing open); null is the full invented queue. DEC1b: "?queue=cards" is one open row
  // of each kind of decision card, as HDLG's are after DEC1a (workbook and PDF identities, a file the group holds, a held paddock, two
  // files with no candidate, one of them written before DEC1a with no identity).
  const queueOf = (hash) => (isGroup(hash) && /[?&]queue=(sparse|empty|cards)(?:&|$)/.exec(hash)?.[1]) || null;
  // "#/demo..." -> the app's own "#/farm/<id>..." route ("" is the portfolio, null is not a demo route).
  function routeHash(hash) {
    const multi = isMulti(hash);
    // "#/demo/group" is the group's space, ".../documents", ".../create", ".../settings" its views, ".../farms" the portfolio.
    if (isGroup(hash)) {
      const suffix = hash.split("?")[0].slice("#/demo/group".length);
      if (suffix === "/farms") return "";
      // ON3b: ".../manage" and its tabs are the group's manage space
      return /^(?:\/(?:documents|create|settings|manage(?:\/(?:members|gaps|updates|sites|settings))?))?$/.test(suffix) ? "#/group/" + GROUP + suffix : null;
    }
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
  function href(hash, sparse = false, farmer = false, multi = false, group = false, queue = null) {
    if (group && hash === "") return "#/demo/group/farms" + (queue ? "?queue=" + queue : "");
    if (hash === "") return multi ? "#/demo/multi" : "#/demo/farms";
    if (hash === "#/layers") return "#/demo" + (multi ? "/multi" : sparse ? "/empty" : farmer ? "/farmer" : "") + "/layers";
    if (hash === "#/ops") return "#/demo/ops";
    if (hash === "#/ops/layers") return "#/demo/ops/layers";
    if (/^#\/(?:blocks|plans)(?:\?|$)/.test(hash)) return "#/demo" + hash.slice(1);
    if (hash.startsWith("#/group/" + GROUP)) return "#/demo/group" + hash.slice(("#/group/" + GROUP).length) + (queue ? "?queue=" + queue : "");
    const farm = [FARM, FARM2].find((id) => hash.startsWith("#/farm/" + id));
    if (!farm) return hash;
    return "#/demo" + (multi ? "/multi/farm-" + (farm === FARM2 ? 2 : 1) : sparse ? "/empty" : farmer ? "/farmer" : "") + hash.slice(("#/farm/" + farm).length);
  }
  const polygon = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
  const feature = (geometry, properties) => ({ type: "Feature", geometry, properties });
  const collection = (features) => ({ type: "FeatureCollection", features });
  const owned = (rows, farm) => rows.map((r) => ({ ...r, farm_id: farm }));
  function dataset(fixture, { sparse = false, farmer = false, multi = false, group = false, queue = null } = {}) {
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
      places: [],      // the farm demo has none; the group demo's area is in groupTables (WQ4)
      farms: [farm], farm_members: [{ farm_id: FARM, user_id: USER, role: "admin" }], org_members: [{ org_id: ORG, user_id: USER, role: "advisor" }],
      documents: owned(f.documents, FARM), authorisations: owned(f.authorisations, FARM), obligations: owned(f.obligations, FARM),
      // one condition marked done and one with its record linked, so What's due and the gallery show both
      checks: owned(f.checks || [], FARM), record_types: f.record_types || [], entries: owned(f.entries || [], FARM), entry_links: owned(f.entry_links || [], FARM), entry_files: [],
      // The staff Operations page: invented job records, one failing and one late. The farmer demo is not staff.
      profiles: [{ user_id: USER, is_staff: true }], ops_job_status: f.ops.jobs, ops_reference_status: f.ops.references,
      // Invented how-to recipes (AI1): one approved, one draft. Approve / Retire answer that the demo does not save changes.
      ai_recipes: f.ops.recipes || [],
      // The Layers page (LN1): invented reference sources and advisor notes; the advisor's organisation is a group scope.
      reference_sources: f.ops.sources || [], layer_notes: f.ops.layer_notes || [],
      map_layers: map.layers.map((l) => ({ id: l.id, name: l.name, theme: l.theme, farm_id: FARM, org_id: null })),
      organisations: [{ id: ORG, name: "Example Advisory Ltd (synthetic)", kind: "consultancy" }],
      // FB1: the farm's holding and farmed boundary start empty; the parcels around it are invented (parcels()).
      farm_parcels: [], farm_boundaries: [],
      plan_import_requests: [],   // FU4: "Read this plan in" requests made in this session (public.request_plan_import)
      proposals: [],   // ON3d: the farm's "to confirm" lines as proposals (farmChecksSync), made when the Onboarding view is opened
    }, reference: { [FARM]: f.reference || [] }, build: f.ops.build, loadGaps: f.ops.load_gaps || [], ratchet: f.ops.ratchet || null, onboardingEffort: f.ops.onboarding_effort || null, ask: f.ask || [], parcels: parcels(extent), wq: null, wqEmpty: false };   // wq is made when first read (wqOf): wq-model.js may load after this
    if (sparse) {
      farm.name = "Example farm — almost empty";
      data.map = { ...map, farm: { id: FARM, name: farm.name, region: farm.region }, titles: collection([]), land_units: collection([]), layers: [] };
      data.tables.documents = []; data.tables.authorisations = []; data.tables.obligations = [];
      data.tables.checks = []; data.tables.entries = []; data.tables.entry_links = [];
      data.ask = [];
      data.wqEmpty = true;   // no titles, so no monitoring site is near
    }
    if (group) groupDemo(data, queue);
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
  // S5: the catchment group "HDLG (example)" with invented member farms, records, documents and its own layers. Each member
  // farm's own share choice is `share`; how it is shown follows the group's setting (memory only) by the database's rule:
  // the lower of the two, none without a farm share. The demo's rows stand in for group_map, group_member_summary,
  // group_member_farms, group_shared_entries/documents, group_wq_sites and group_wq_pick.
  const MEMBERS = [
    { id: "de000000-0000-4000-8000-0000000002a1", name: "Ridge Road (synthetic)", share: "named", area_ha: 420, findings: { "fep.not_read": 1, "consent.no_decision": 1, "document.tier_unconfirmed": 2 }, box: [172.032, -43.004, 172.05, -42.988] },
    { id: "de000000-0000-4000-8000-0000000002a2", name: "Downs Station (synthetic)", share: "anonymous", area_ha: 610, findings: { "fep.missing": 1, "consent.no_conditions": 1, "document.tier_unconfirmed": 1 }, box: [172.055, -43.03, 172.08, -43.01] },
    { id: "de000000-0000-4000-8000-0000000002a3", name: "Gorge Flats (synthetic)", share: "aggregated", area_ha: 380, findings: { "fep.missing": 1, "document.tier_unconfirmed": 1 }, box: [172.065, -42.985, 172.085, -42.968] },
    { id: "de000000-0000-4000-8000-0000000002a4", name: "Mill Road (synthetic)", share: "aggregated", area_ha: 290, findings: { "fep.missing": 1, "document.tier_unconfirmed": 3 }, box: [171.99, -43.03, 172.005, -43.012] },
    { id: "de000000-0000-4000-8000-0000000002a5", name: "Lagoon Block (synthetic)", share: null, area_ha: 510, findings: { "holding.none": 1, "document.held": 1, "fep.missing": 1 }, box: [172.09, -43.045, 172.105, -43.03] },
    { id: "de000000-0000-4000-8000-0000000002a6", name: "Terrace Downs (synthetic)", share: "aggregated", area_ha: 350, findings: { "fep.missing": 1, "area.mismatch": 1, "document.tier_unconfirmed": 1 }, box: [171.975, -42.975, 171.995, -42.96] },
  ];
  // The demo's stand-in for the database's HMAC farm ref label (app.group_farm_ref): a hash of group and farm, never the id itself
  const demoRefLabel = (id) => { let h = 2166136261; for (const ch of "demo-group:" + id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0").slice(0, 6).toUpperCase(); };
  // ON1's finding rules and their states (as app.onboarding_finding_states), for the demo's group readiness
  const READINESS_RULES = { "holding.none": "gap", "consent.no_decision": "gap", "document.held": "gap", "fep.missing": "gap",
    "area.mismatch": "verify", "consent.not_in_ecan": "verify", "consent.status_differs": "verify", "document.duplicate": "verify",
    "document.tier_unconfirmed": "verify", "parcel.not_current": "verify",
    "consent.no_conditions": "propose", "consent.not_recorded": "propose", "fep.confirm_report": "propose", "fep.not_read": "propose" };
  const LEVELS = ["aggregated", "anonymous", "named"];
  const levelOf = (setting, share) => (share ? LEVELS[Math.min(LEVELS.indexOf(setting), LEVELS.indexOf(share))] : "none");
  function groupDemo(data, queue = null) {
    // The group's rows sit beside the farm's (merged into reads), so the farm's and the gallery's counts are unchanged.
    const t = data.groupTables = { organisations: [], org_members: [], record_types: [], entries: [], documents: [], obligations: [], places: [] }, at = (d) => d + "T09:30:00+12:00";
    // WQ4: the group's area, as the loader makes it (the preset's applies_to.area is this code)
    t.places.push({ id: "demo-g-area", org_id: GROUP, kind: "area", code: "hdlg-catchment", name: "HDLG (example) catchment", method: "member_blocks_buffer_1km",
      description: "Working boundary: the group's member blocks plus 1 km (synthetic).", valid_to: null });
    t.organisations.push({ id: GROUP, name: "HDLG (example)", kind: "catchment_group" });
    t.org_members.push({ org_id: GROUP, user_id: USER, role: "admin" });
    t.record_types.push({ id: "rt-planting", key: "planting", label: "Planting", farm_id: null, org_id: null },
      { id: "rt-meeting", key: "meeting", label: "Meeting", farm_id: null, org_id: null }, { id: "rt-sample", key: "water_sample", label: "Water sample", farm_id: null, org_id: null });
    t.entries.push(
      { id: "demo-g-e1", org_id: GROUP, type_id: "rt-meeting", body: "Field day at the ford: 14 people walked the creek with the facilitator (synthetic).", captured_at: at("2026-09-12"), visibility: "farm" },
      { id: "demo-g-e2", org_id: GROUP, type_id: "rt-sample", body: "Group sampling run at four sites; bottles to the lab the same day (synthetic).", captured_at: at("2026-09-18"), visibility: "farm" },
      { id: "demo-g-e3", org_id: GROUP, type_id: "rt-note", body: "Private: the facilitator's own reminder (synthetic).", captured_at: at("2026-09-20"), visibility: "private" },
      { id: "demo-g-e4", org_id: GROUP, type_id: "rt-meeting", body: "Committee meeting: agreed the spring planting order (synthetic).", captured_at: at("2026-10-07"), visibility: "farm" });
    t.documents.push(
      { id: "demo-g-d1", org_id: GROUP, title: "Catchment plan 2025 (synthetic)", doc_type: "memo", author_org: "HDLG (example)", date_prepared: "2025-06-30", created_at: "2025-07-02T00:00:00Z", tier: "primary", tiered_at: "2025-07-02T00:00:00Z", visibility: "farm", storage_path: "org/demo/plan.pdf" },
      { id: "demo-g-d2", org_id: GROUP, title: "Water sampling protocol (synthetic)", doc_type: "memo", author_org: "HDLG (example)", date_prepared: "2026-03-01", created_at: "2026-03-02T00:00:00Z", tier: "primary", tiered_at: "2026-03-02T00:00:00Z", visibility: "farm", storage_path: "org/demo/protocol.pdf" });
    t.obligations.push(
      { id: "demo-g-o1", org_id: GROUP, code: "G1", summary: "Annual catchment monitoring report to the regional council (synthetic)", kind: "date", due_date: "2026-12-15", recurrence: "annual" },
      { id: "demo-g-o2", org_id: GROUP, code: "G2", summary: "Keep the group's sampling records with the lab results (synthetic)", kind: "practice", due_date: null, recurrence: null });
    data.group = { setting: "aggregated", area: polygon(171.96, -43.05, 172.115, -42.955),
      shared: [
        { id: "demo-g-s1", farm: MEMBERS[0].id, record_type: "planting", body: "Planted 300 flax and carex along the creek margin (synthetic).", captured_at: at("2026-09-05"), location: { type: "Point", coordinates: [1570100, 5236200] } },
        { id: "demo-g-s2", farm: MEMBERS[0].id, record_type: "note", body: "Stock exclusion fence finished on the south bank (synthetic).", captured_at: at("2026-09-21"), location: null },
        { id: "demo-g-s3", farm: MEMBERS[2].id, record_type: "planting", body: "Wetland edge replanted after the flood (synthetic).", captured_at: at("2026-09-14"), location: null },
        { id: "demo-g-s4", farm: MEMBERS[4].id, record_type: "water_sample", body: "Drain sample taken at the boundary culvert (synthetic).", captured_at: at("2026-09-25"), location: null },
        { id: "demo-g-s6", farm: MEMBERS[5].id, record_type: "planting", body: "Shelter belt gaps replanted (synthetic).", captured_at: at("2026-09-17"), location: null },
        { id: "demo-g-s5", farm: MEMBERS[1].id, record_type: "note", body: "Spring stock count done; no change to the wintering paddocks (synthetic).", captured_at: at("2026-10-15"), location: null }],
      sharedDocs: [{ id: "demo-g-sd1", farm: MEMBERS[0].id, title: "Riparian planting plan (synthetic)", doc_type: "memo", created_at: "2026-09-20T03:00:00Z", tier: "primary", storage_path: "demo/riparian.pdf" }] };
    manageDemo(data, queue);
  }
  // ON3b: the group's manage space. An invented business register (group_members) with farm associations, DQ1's gaps for the
  // group (group_load_gaps), ON3a's proposals about them as tools/reconcile_group.py writes them (subject, evidence, candidates),
  // and WQ2's location members. Invented member numbers and names only.
  const GROUP_MEMBERS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India"].map((w, i) => ({
    id: "de000000-0000-4000-8000-0000000003" + String(i + 1).padStart(2, "0"), org_id: GROUP, member_number: String(i + 1), business_name: w + " Invented Ltd",
    ended_at: w === "India" ? "2025-06-30T00:00:00Z" : null, created_at: "2026-06-01T00:00:00Z" }));
  const PADDOCKS = "Paddock master (synthetic).gpkg";
  // DEC1b: what identifies each proposal's subject, as tools/reconcile_group.py stores it after DEC1a (evidence.identity), and a
  // group-held copy of one file (proposals.document_id, as VIS1 will link it). Invented text and shapes only.
  const HELD_DOC = "de000000-0000-4000-8000-000000000d01";
  const IDENTITY = {
    charlie: { kind: "workbook", format: "xlsm", cover: [{ label: "Farm Name", value: "Charlie Downs (synthetic)", sheet: "CoverPage" }, { label: "Owner", value: "C. Invented", sheet: "CoverPage" },
      { label: "Farm Address", value: "12 Invented Road, Example Valley (synthetic)", sheet: "CoverPage" }, { label: "Audit Date", value: "2021-03-04", sheet: "CoverPage" }] },
    bravo: { kind: "workbook", format: "xlsm", cover: [{ label: "Farm Name", value: "Bravo Foxtrot Partnership (synthetic)", sheet: "CoverPage" }, { label: "Owner(s)", value: "B. and F. Invented", sheet: "CoverPage" },
      { label: "Date Prepared", value: "2019-08-21", sheet: "CoverPage" }] },
    charliePdf: { kind: "document", format: "pdf", pages: 14, truncated: false, first_page: "Farm Environment Plan (synthetic)\nCharlie Invented Ltd\nCharlie Downs, 12 Invented Road, Example Valley\n" +
      "Prepared for the example catchment group\nVersion 3, March 2021\nPrepared by an invented consultant\nThis plan is an invented example for the demo; no part of it is real." },
    paddock: { kind: "paddock", id_field: "hdlg_id", id_given: "999", names: { PadkName: "Winter block (synthetic)" }, crs: "EPSG:4326", area_ha: 11.8, vertices: 6, simplified_m: 0, envelope: false,
      geometry: { type: "Polygon", coordinates: [[[172.0285, -43.0012], [172.0322, -43.001], [172.0327, -42.9985], [172.0301, -42.9978], [172.0283, -42.999], [172.0285, -43.0012]]] },
      bbox: [172.0283, -43.0012, 172.0327, -42.9978] },
    golf: { kind: "document", format: "docx", truncated: true, first_page: "Golf Hill Station (synthetic)\nFarm Environment Plan, draft for review\nOwner: G. Invented\nAddress: 3 Invented Lane, Example Valley (synthetic)\n" +
      "Date: 14 February 2022\n\n1. About the farm\nThe farm runs sheep and beef on rolling hill country with two invented streams crossing it. Most of the land is in pasture; " +
      "the gullies are retired into native planting. This text is invented for the demo and stands for the first page of a real plan, cut at the bound the proposal run keeps." },
  };
  function manageProposals() {
    const run = "de000000-0000-4000-8000-000000000a01", mv = "reconcile_group/A14a-2026-11-06";
    const cand = (n, confidence, signals, evidence) => ({ member: String(n), business_name: GROUP_MEMBERS[n - 1].business_name, confidence, signals, evidence });
    const file = (path, kind = "fep_unmatched", external_id = null) => ({ gap_kind: kind, item_key: path, gap_id: null, source_file: path.split("/").pop(), external_id, item_sha256: "0".repeat(63) + "1" });
    const paddock = (fid, external_id = null) => ({ gap_kind: "paddock_held", item_key: PADDOCKS + "#" + fid, gap_id: null, source_file: PADDOCKS, external_id, item_sha256: null });
    const ev = (because, identity) => ({ set_aside_because: because, lines: ["  (the reconcile summary's lines for this item, invented)"], replaces_stale_match: null, ...(identity ? { identity } : {}) });
    const row = (id, kind, subject, status, candidates, extra = {}) => ({ id, org_id: GROUP, farm_id: null, kind, subject, subject_key: subject.gap_kind ? subject.gap_kind + ":" + subject.item_key : String(subject.location_key),
      evidence: ev(extra.because || "no member number in the file name", extra.identity), candidates, status, decision: null, decided_by: null, decided_at: null, applied_at: null, outcome: null,
      document_id: extra.document_id || null, method_version: mv, run_id: run, created_at: "2026-11-04T09:00:00Z", ...extra.row });
    const decided = (c, note, at) => ({ decision: { candidate: c, note }, decided_by: USER, decided_at: at });
    const c4 = cand(4, 0.9, ["member_number"], [{ signal: "member_number", from: "member folder in the path", folder: "HDLG 4 Delta (synthetic)", number: "4", confidence: 0.9 }]);
    const c1 = cand(1, 0.8, ["member_number"], [{ signal: "member_number", from: "field AltId", value: "HDLG-1", number: "1", confidence: 0.8 }]);
    const c2 = cand(2, 0.85, ["fep_title"], [{ signal: "fep_title", found: "member number", number: "2", text: "HDLG member 2 farm plan (synthetic)", confidence: 0.85 }]);
    return [
      row(101, "member_match_file", file("FarmData/HDLG 3 Charlie (synthetic)/Charlie Downs FEP 2021 (synthetic).xlsm"), "proposed", [
        cand(3, 0.97, ["member_number", "business_name"], [{ signal: "member_number", from: "member folder in the path", folder: "HDLG 3 Charlie (synthetic)", number: "3", confidence: 0.9 },
          { signal: "business_name", file_words: "charlie downs", name: "Charlie Invented Ltd", name_from: "the register", similarity: 0.82, confidence: 0.697 }])],
        { identity: IDENTITY.charlie }),
      row(102, "member_match_file", file("FarmData/Charlie plan final (synthetic).pdf"), "proposed", [
        cand(3, 0.75, ["fep_title"], [{ signal: "fep_title", found: "business name", name: "Charlie Invented Ltd", name_from: "the register", text: "Farm Environment Plan for Charlie Invented Ltd (synthetic)", confidence: 0.75 }])],
        { identity: IDENTITY.charliePdf }),
      row(103, "member_match_paddock", paddock(118, "999"), "proposed", [
        cand(5, 0.86, ["member_number", "business_name"], [{ signal: "member_number", from: "text in field Notes", value: "HDLG 5 winter block", number: "5", confidence: 0.6 },
          { signal: "business_name", field: "Owner", value: "Echo Invented", name: "Echo Invented Ltd", name_from: "the register", similarity: 0.9, confidence: 0.765 }])],
        { because: "placeholder member id", identity: IDENTITY.paddock }),
      row(104, "member_match_file", file("FarmData/Bravo Foxtrot plan (synthetic).xlsm"), "ambiguous", [
        cand(2, 0.72, ["business_name"], [{ signal: "business_name", file_words: "bravo foxtrot", name: "Bravo Invented Ltd", name_from: "the register", similarity: 0.85, confidence: 0.722 }]),
        cand(6, 0.68, ["business_name"], [{ signal: "business_name", file_words: "bravo foxtrot", name: "Foxtrot Invented Ltd", name_from: "the register", similarity: 0.8, confidence: 0.68 }])],
        { identity: IDENTITY.bravo }),
      row(105, "member_match_file", file("FarmData/HDLG 4 Delta (synthetic)/FEP 2020 (synthetic).pdf"), "accepted", [c4], { row: decided(c4, "Checked with the facilitator (synthetic)", "2026-11-04T21:10:00Z") }),
      row(106, "member_match_paddock", paddock(7), "applied", [c1], { because: "no member id", row: { ...decided(c1, null, "2026-11-04T21:20:00Z"), applied_at: "2026-11-05T02:00:00Z", outcome: { recorded: true } } }),
      row(107, "member_match_file", file("FarmData/HDLG member 2 plan (synthetic).pdf"), "applied", [c2], { row: { ...decided(c2, null, "2026-10-18T21:00:00Z"), applied_at: "2026-10-20T02:00:00Z", outcome: { recorded: true } } }),
      // a site question (site_succession): an invented row of the kind ON3c will feed (no run writes these yet): is DEMO-02 a co-located
      // record of the farm bridge location?
      { id: 108, org_id: GROUP, farm_id: null, kind: "site_succession", subject: { location_key: "demo-creek-at-the-farm-bridge", name: "Demo Creek at the farm bridge, synthetic location", site_ids: [9101, 9102] },
        subject_key: "demo-creek-at-the-farm-bridge:9102", evidence: { set_aside_because: "two sites 600 m apart on the same creek (invented)", lines: [] },
        candidates: [{ name: "DEMO-02 co-located with the farm bridge location", role: "co_located", site_id: 9102 }], status: "proposed", decision: null, decided_by: null, decided_at: null,
        applied_at: null, outcome: null, method_version: "seed/WQ2-demo", run_id: run, created_at: "2026-11-04T09:00:00Z" },
      ...feedProposals(),
    ];
  }
  // ON3c: the group's ongoing feed as tools/load_group.py and tools/refresh_reference.py write it: an analysis due for review and
  // the gaps a group load newly set aside (new), and a reference change near members marked follow up. Invented content.
  const FEED_ANSWERS = [{ action: "seen" }, { action: "follow_up" }];
  function feedProposals() {
    const run = "de000000-0000-4000-8000-000000000a02";
    const row = (id, kind, subject_key, subject, evidence, created_at, extra = {}) => ({ id, org_id: GROUP, farm_id: null, kind, subject, subject_key, evidence,
      candidates: copy(FEED_ANSWERS), status: "proposed", decision: null, decided_by: null, decided_at: null, applied_at: null, outcome: null,
      method_version: "on3c-feed v1", run_id: run, created_at, ...extra });
    return [
      row(111, "review_due", "analysis:demo-analysis-1", { analysis_id: "demo-analysis-1", module: "x1/band", theme: "water_quality", made_at: "2026-09-12T02:00:00Z" },
        { reasons: [{ kind: "reference", source: "ecan-wq-sites", text: "Surface water quality sites (ECan) was refreshed with different content since this analysis was made." }],
          fingerprint: "0".repeat(32), checked_at: "2026-11-05T03:00:00Z" }, "2026-11-05T03:00:00Z"),
      row(112, "load_gap", "load_gap:paddock_held", { gap_kind: "paddock_held" },
        { gap_kind: "paddock_held", new: 2, open: 2, unlisted: 0, carried_from: null, loaded_at: "2026-11-05T02:00:00Z", items: [
          { item_key: PADDOCKS + "#121", source_file: PADDOCKS, reason: "no member id", new: true },
          { item_key: PADDOCKS + "#122", source_file: PADDOCKS, external_id: "999", reason: "placeholder member id", new: true }] }, "2026-11-05T02:00:00Z"),
      row(113, "reference_change", "reference:ecan-consents", { source_key: "ecan-consents" },
        { source_key: "ecan-consents", source_name: "Resource consents (ECan)", refresh_id: 1, refreshed_at: "2026-11-02T14:30:00Z", first_pull: false, partial: false,
          added: 1, changed: 2, removed: 0, members: ["3", "5"], members_count: 2, farms_count: 1, context_buffer_m: 2000, earlier: [] }, "2026-11-02T15:00:00Z",
        { status: "accepted", decision: { candidate: { action: "follow_up" }, note: "Check the new take near member 3 (synthetic)" }, decided_by: USER, decided_at: "2026-11-03T21:00:00Z" }),
    ];
  }
  function manageDemo(data, queue = null) {
    const t = data.groupTables, at = (d) => d + "T09:30:00+12:00";
    for (const k of ["group_members", "farm_group_associations", "proposals", "group_load_gaps", "monitoring_location_sites"]) { data.tables[k] = data.tables[k] || []; t[k] = []; }
    t.group_members.push(...copy(GROUP_MEMBERS));
    MEMBERS.forEach((m, i) => t.farm_group_associations.push({ id: "demo-g-a" + (i + 1), org_id: GROUP, farm_id: m.id, group_member_id: GROUP_MEMBERS[i].id, status: "active",
      group_approved_at: at("2026-06-02"), farm_approved_at: at("2026-06-" + String(10 + i)), ended_at: null, ended_side: null, created_at: at("2026-06-02") }));
    t.farm_group_associations.push(
      { id: "demo-g-a7", org_id: GROUP, farm_id: "de000000-0000-4000-8000-0000000002b7", group_member_id: GROUP_MEMBERS[6].id, status: "pending", group_approved_at: at("2026-10-28"), farm_approved_at: null, ended_at: null, ended_side: null, created_at: at("2026-10-28") },
      { id: "demo-g-a9", org_id: GROUP, farm_id: "de000000-0000-4000-8000-0000000002b9", group_member_id: GROUP_MEMBERS[8].id, status: "ended", group_approved_at: at("2025-01-10"), farm_approved_at: at("2025-01-20"), ended_at: at("2025-06-30"), ended_side: "farm", created_at: at("2025-01-10") });
    t.proposals.push(...manageProposals());
    // the gap rows the group admin reads: the applied paddock (106) is still open, so it is still to be placed; 107's is resolved
    t.group_load_gaps.push({ org_id: GROUP, kind: "paddock_held", item_key: PADDOCKS + "#7", resolved_at: null },
      { org_id: GROUP, kind: "fep_unmatched", item_key: "FarmData/HDLG member 2 plan (synthetic).pdf", resolved_at: "2026-10-21T02:00:00Z" });
    t.monitoring_location_sites.push({ location_id: 9301, site_id: 9101 }, { location_id: 9301, site_id: 9107 });
    data.loadGaps = [...(data.loadGaps || []), { group_id: GROUP, group_name: "HDLG (example)", detail: true, checked_at: "2026-11-04T08:00:00Z",
      counts: { fep_unmatched: 5, fep_not_in_register: 1, paddock_held: 38, member_no_extent: 2 }, open_proposals: { fep_unmatched: 3, paddock_held: 1 },
      items: [
        { kind: "fep_not_in_register", member_number: null, business_name: null, external_id: "42", reason: "member number is not in the register", items: 1, files: ["HDLG_42 Final (synthetic).xlsm"] },
        { kind: "fep_unmatched", member_number: null, business_name: null, external_id: null, reason: "no member number in the file name", items: 5, files: ["Bravo Foxtrot plan (synthetic).xlsm", "Charlie Downs FEP 2021 (synthetic).xlsm", "Charlie plan final (synthetic).pdf", "Hill block notes (synthetic).pdf", "Untitled plan (synthetic).xlsm"] },
        { kind: "member_no_extent", member_number: "7", business_name: "Golf Invented Ltd", external_id: "7", reason: "FarmData folder only, not in the members layer", items: 1, files: ["HDLG Members (synthetic).gpkg"] },
        { kind: "member_no_extent", member_number: "8", business_name: "Hotel Invented Ltd", external_id: "8", reason: "FarmData folder only, not in the members layer", items: 1, files: ["HDLG Members (synthetic).gpkg"] },
        { kind: "paddock_held", member_number: null, business_name: null, external_id: null, reason: "no member id", items: 30, files: [PADDOCKS] },
        { kind: "paddock_held", member_number: null, business_name: null, external_id: "999", reason: "placeholder member id", items: 8, files: [PADDOCKS] }] }];
    const mine = data.loadGaps[data.loadGaps.length - 1];
    if (queue === "sparse") {
      // as a real first reconciliation run can leave it: 1 file proposed, 3 ambiguous, 1 paddock proposed; most items with no member evidence
      const rows = t.proposals.filter((p) => [102, 103, 104].includes(p.id));
      const amb = (id, path, a, b) => ({ ...copy(rows.find((p) => p.id === 104)), id, subject_key: "fep_unmatched:" + path,
        subject: { gap_kind: "fep_unmatched", item_key: path, gap_id: null, source_file: path.split("/").pop(), external_id: null, item_sha256: "0".repeat(63) + "2" },
        candidates: [a, b].map(([n, c]) => ({ member: String(n), business_name: GROUP_MEMBERS[n - 1].business_name, confidence: c, signals: ["business_name"],
          evidence: [{ signal: "business_name", file_words: "invented downs", name: GROUP_MEMBERS[n - 1].business_name, name_from: "the register", similarity: 0.8, confidence: c }] })) });
      t.proposals = [...rows, amb(109, "FarmData/Downs plan 2019 (synthetic).pdf", [1, 0.7], [5, 0.66]), amb(110, "FarmData/Invented Downs FEP (synthetic).xlsm", [2, 0.71], [8, 0.69])];
      t.group_load_gaps = [];
      Object.assign(mine, { counts: { fep_unmatched: 9, paddock_held: 1117, member_no_extent: 2 }, open_proposals: { fep_unmatched: 4, paddock_held: 1 },
        items: mine.items.filter((i) => i.kind !== "fep_not_in_register").map((i) => (i.kind === "paddock_held" ? { ...i, items: i.external_id ? 17 : 1100 } : i.kind === "fep_unmatched" ? { ...i, items: 9 } : i)) });
    }
    if (queue === "empty") {
      t.proposals = t.proposals.filter((p) => p.status === "applied" && p.id === 107);   // only what was placed long ago
      t.group_load_gaps = []; Object.assign(mine, { counts: {}, open_proposals: {}, items: [] });
    }
    // DEC1b: the group's own layers by name and theme (map_layers: the card's map reads the neighbours of a held paddock by box)
    data.tables.map_layers = data.tables.map_layers || [];
    t.map_layers = groupPartsLayers(data).map((l) => ({ id: l.id, org_id: GROUP, name: l.name, theme: l.theme, geometry_type: l.geometry_type, source_file: l.theme === "paddocks" ? PADDOCKS : null,
      source: l.source, style: {} }));
    if (queue === "cards") {
      // one open row of each kind of card: the workbook (101) and the PDF the group holds a copy of (102), the held paddock (103), the
      // ambiguous workbook (104), a Word file with no candidate (114) and a file proposed before DEC1a with no candidate and no identity (115)
      const file = (path) => ({ gap_kind: "fep_unmatched", item_key: path, gap_id: null, source_file: path.split("/").pop(), external_id: null, item_sha256: "0".repeat(63) + "3" });
      const none = (id, path, identity) => ({ ...copy(t.proposals.find((p) => p.id === 104)), id, subject: file(path), subject_key: "fep_unmatched:" + path, status: "proposed", candidates: [],
        evidence: { set_aside_because: "no member number in the file name", lines: [], replaces_stale_match: null, ...(identity ? { identity } : {}) } });
      t.proposals = [...t.proposals.filter((p) => [101, 102, 103, 104].includes(p.id)), none(114, "FarmData/Hill station plan draft (synthetic).docx", IDENTITY.golf),
        none(115, "FarmData/Scan 0042 (synthetic).pdf", null)];
      t.proposals.find((p) => p.id === 102).document_id = HELD_DOC;
      t.documents.push({ id: HELD_DOC, org_id: GROUP, farm_id: null, title: "Charlie plan final (synthetic).pdf", doc_type: "fep", tier: "archive", storage_path: "demo/held/charlie-plan-final.pdf",
        created_at: "2026-11-06T02:00:00Z", visibility: "farm" });
      Object.assign(mine, { counts: { fep_unmatched: 5, paddock_held: 1, member_no_extent: 0 }, items: mine.items.filter((i) => i.kind === "fep_unmatched") });
    }
  }
  // As public.proposals_open_counts and public.proposals_decide (ON3a): counts for any member of the group; a decision by an
  // admin, advisor or facilitator only, from proposed or ambiguous, naming one of the row's own candidates (kept in memory).
  const contains = (e, c) => !!e && typeof e === "object" && Object.entries(c).every(([k, v]) => JSON.stringify(e[k]) === JSON.stringify(v));
  function proposalsRpc(d, name, args) {
    const role = d.groupTables?.org_members.find((m) => m.org_id === GROUP && m.user_id === USER)?.role || null, rows = d.groupTables?.proposals || [];
    if (name === "proposals_open_counts") {
      if (args.org_id !== GROUP || !role) return [null];
      const out = {};
      for (const p of rows) if (["proposed", "ambiguous"].includes(p.status)) out[p.kind] = (out[p.kind] || 0) + 1;
      return [out];
    }
    // ON3c, as public.proposals_since_seen and public.proposals_mark_seen: the demo person's last look (in memory; the invented
    // last look is 4 Nov 2026, so the feed's rows of 5 Nov are new), and counts of what was made since
    if (name === "proposals_since_seen") {
      if (args.org_id !== GROUP || !role) return [null];
      const seen = d.seenAt === undefined ? "2026-11-04T10:00:00Z" : d.seenAt, out = {};
      for (const p of rows) if (seen ? Date.parse(p.created_at) > Date.parse(seen) && p.status !== "superseded" : ["proposed", "ambiguous"].includes(p.status)) out[p.kind] = (out[p.kind] || 0) + 1;
      return [{ seen_at: seen, since: out }];
    }
    if (name === "proposals_mark_seen") {
      if (args.org_id !== GROUP || !role) return [null];
      d.seenAt = new Date().toISOString();
      return [d.seenAt];
    }
    // ON3c, as public.proposals_propose: a site question only, by the group's admins, advisors and facilitators
    if (name === "proposals_propose") {
      if (args.kind !== "site_succession") return [null, { message: "a person proposes only a site question (site_succession), not " + args.kind }];
      if (args.org_id !== GROUP || !["admin", "advisor", "facilitator"].includes(role)) return [null, { message: "only the group's admins, advisors and facilitators propose a site question" }];
      const sites = [...new Set((args.subject?.sites || []).map((x) => String(x).trim()).filter(Boolean))].sort();
      if (sites.length < 2 || sites.length > 20) return [null, { message: "name 2 to 20 site ids, each at most 60 characters" }];
      const key = "proposed:" + args.subject.relation + ":" + sites.join(",");
      if (rows.some((r) => r.kind === "site_succession" && r.subject_key === key && ["proposed", "ambiguous", "accepted"].includes(r.status))) return [null, { message: "a question about these sites is already open" }];
      const note = String(args.evidence?.note || "").trim() || null;
      const row = { id: Math.max(0, ...rows.map((r) => r.id)) + 1, org_id: GROUP, farm_id: null, kind: "site_succession",
        subject: { ...args.subject, sites, name: args.subject.name || sites.join(", ") }, subject_key: key,
        evidence: { ...(note ? { note } : {}), lines: ["Proposed in the group's manage space"] }, candidates: [{ label: "Add it to the reviewed monitoring-locations manifest (RCL applies it)" }],
        status: "proposed", decision: null, decided_by: null, decided_at: null, applied_at: null, outcome: null, proposed_by: USER,
        method_version: "proposals_propose v1", run_id: "de000000-0000-4000-8000-000000000a03", created_at: new Date().toISOString() };
      rows.push(row);
      return [copy(row)];
    }
    const p = rows.find((r) => r.id === args.id);
    if (!p || !["admin", "advisor", "facilitator"].includes(role)) return [null, { message: "proposal " + args.id + " is not open for you to decide" }];
    if (!["proposed", "ambiguous"].includes(p.status)) return [null, { message: "proposal " + args.id + " is already " + p.status }];
    if (!["accepted", "rejected"].includes(args.status)) return [null, { message: "a decision is accepted or rejected" }];
    // DEC1b, as DEC1a's proposals_decide: the arguments the card sent (the screenshots read them), a member from the register
    // (current members of this group only; one of the candidates is recorded as that candidate), and what was in view
    d.lastDecide = copy(args);
    let chosen = null, from = args.status === "accepted" ? "candidates" : null;
    if (args.status === "accepted" && args.chosen_from === "register") {
      if (!/^member_match_(file|paddock)$/.test(p.kind)) return [null, { message: "only a member match (a set-aside file or paddock) takes a member from the group's register" }];
      const m = GROUP_MEMBERS.find((x) => (args.candidate?.member == null || x.member_number === String(args.candidate.member)) && (args.candidate?.group_member_id == null || x.id === args.candidate.group_member_id));
      if (!m) return [null, { message: "member " + (args.candidate?.member ?? "") + " is not on this group's register" }];
      if (m.ended_at) return [null, { message: "member " + m.member_number + " has left this group's register" }];
      chosen = p.candidates.find((c) => c.member === m.member_number) || { member: m.member_number, business_name: m.business_name, group_member_id: m.id };
      if (!p.candidates.includes(chosen)) from = "register";
    } else if (args.status === "accepted") {
      if (!p.candidates.length) return [null, { message: "proposal " + p.id + " has no candidates: name the member from the register (chosen_from register)" }];
      if (args.candidate == null) { if (p.status === "ambiguous") return [null, { message: "an ambiguous proposal needs one of its candidates chosen" }]; chosen = p.candidates[0]; }
      else {
        const hits = p.candidates.filter((e) => contains(e, args.candidate));
        if (hits.length !== 1) return [null, { message: "the chosen candidate must be exactly one of this proposal's candidates (" + hits.length + " match)" }];
        chosen = hits[0];
      }
    } else if (args.candidate != null) return [null, { message: "a rejection names no candidate" }];
    const note = String(args.note || "").trim() || null;
    Object.assign(p, { status: args.status, decision: { candidate: copy(chosen), note, ...(from ? { chosen_from: from } : {}), ...(Array.isArray(args.viewed) && args.viewed.length ? { viewed: copy(args.viewed) } : {}) },
      decided_by: USER, decided_at: new Date().toISOString() });
    return [p];
  }
  function groupRpc(d, name, args) {
    const g = d.group, level = (m) => levelOf(g.setting, m.share), detail = (m) => ["anonymous", "named"].includes(level(m));
    const shown = () => MEMBERS.filter(detail);
    const farmId = (id) => { const m = MEMBERS.find((x) => x.id === id); return m && detail(m) ? id : null; };
    if (!g || (args.g ?? args.group_id) !== GROUP) return ["group_map", "group_member_summary", "group_readiness"].includes(name) ? [null] : [[]];
    if (name === "group_member_farms") return [shown().map((m) => ({ farm_ref: m.id, name: level(m) === "named" ? m.name : null, level: level(m), extent: polygon(...m.box), area_ha: m.area_ha }))];
    if (name === "group_shared_entries") return [g.shared.map((e) => ({ id: e.id, farm_id: farmId(e.farm), record_type: e.record_type, captured_at: e.captured_at, period_start: null, period_end: null,
      location: e.location, body: e.body, data: null, tags: [] })).sort((a, b) => b.captured_at.localeCompare(a.captured_at))];
    if (name === "group_shared_documents") return [g.sharedDocs.map(({ farm, ...x }) => ({ ...x, farm_id: farmId(farm) }))];
    if (name === "set_group_member_detail") {
      if (d.groupTables?.org_members.find((m) => m.org_id === GROUP && m.user_id === USER)?.role !== "admin") return [null, { message: "Only an admin of this catchment group can change how its member farms are shown" }];
      g.setting = args.level; return [null];
    }
    if (name === "group_wq_sites") return [wqOf(d).sites.filter((x) => !x.owner_farm_id)];
    if (name === "group_wq_pick") return [demoPick(wqOf(d), args)];
    if (name === "group_wq_presets") return [[DEMO_PRESET]];
    if (name === "group_readiness") {
      // as the database (public.group_readiness): a group admin only; ON1's findings per farm in totals (invented here),
      // counted with the same k = 3 rule, the readiness states held back together, rows only at anonymous or named.
      // RDY1: every demo farm's stored outcome is current (none "not yet assessed"), worked out on an invented date.
      if (d.groupTables?.org_members.find((m) => m.org_id === GROUP && m.user_id === USER)?.role !== "admin") return [null];
      const inTotals = MEMBERS.filter((m) => level(m) !== "none"), small = (n) => n > 0 && n < 3, suppressed = [];
      const fig = (key, ms) => { if (small(ms.length) || small(ms.filter((m) => m.share === "aggregated").length)) { suppressed.push(key); return null; } return ms.length; };
      const readiness = (f) => ["gap", "verify", "propose"].map((st, i) => Object.keys(f).some((r) => READINESS_RULES[r] === st) && ["missing", "to_check", "to_confirm"][i]).find(Boolean) || "ready";
      const assessed = fig("farms_assessed", inTotals);
      const states = ["missing", "to_check", "to_confirm", "ready"].map((st) => ({ state: st, farms: fig("state:" + st, inTotals.filter((m) => readiness(m.findings) === st)) }));
      const heldStates = states.some((x) => x.farms === null);
      for (const k of suppressed.filter((x) => x.startsWith("state:"))) suppressed.splice(suppressed.indexOf(k), 1);
      if (heldStates) suppressed.push("by_state");
      const byFinding = Object.entries(READINESS_RULES).map(([rule, state]) => ({ rule, state, farms: fig("finding:" + rule, inTotals.filter((m) => m.findings[rule])) }));
      return [{ schema: "group-readiness/1", k: 3, member_detail: g.setting, linked_farms: MEMBERS.length, truncated: false,
        assessed_within_days: 90, farms_assessed: assessed, not_assessed: fig("not_assessed", []),
        by_state: states.map((x) => ({ state: x.state, farms: heldStates ? null : x.farms })), by_finding: byFinding,
        farms: inTotals.filter(detail).map((m) => ({ ref: m.id, label: level(m) === "named" ? m.name : "Member farm " + demoRefLabel(m.id),
          name: level(m) === "named" ? m.name : null, level: level(m), readiness: readiness(m.findings), findings: m.findings, assessed_on: "2026-11-04" })),
        suppressed: suppressed.sort() }];
    }
    if (name === "group_member_summary") {
      const inTotals = MEMBERS.filter((m) => level(m) !== "none"), from = args.p_from ? Date.parse(args.p_from) : -Infinity, to = args.p_to ? Date.parse(args.p_to) : Infinity;
      const period = g.shared.filter((e) => Date.parse(e.captured_at) >= from && Date.parse(e.captured_at) < to), farms = new Set(period.map((e) => e.farm));
      // as the database: held back below 3 farms, in the whole figure or in the part no setting ever shows farm by farm
      // (taken from each farm's own share, so switching the group's setting cannot isolate a farm)
      const small = (n) => n > 0 && n < 3, suppressed = [], unseen = (ids) => ids.filter((id) => [null, "aggregated"].includes(MEMBERS.find((m) => m.id === id).share)).length;
      if (small(inTotals.length) || small(unseen(inTotals.map((m) => m.id)))) suppressed.push("farms_in_totals", "mapped_area_ha");
      if (small(farms.size) || small(unseen([...farms]))) suppressed.push("farms_contributing");
      const types = new Map(); for (const e of period) types.set(e.record_type, (types.get(e.record_type) || 0) + 1);
      const held = (key) => suppressed.includes(key);
      return [{ k: 3, member_detail: g.setting, linked_farms: MEMBERS.length, farms_in_totals: held("farms_in_totals") ? null : inTotals.length,
        mapped_area_ha: held("mapped_area_ha") ? null : Math.round(inTotals.reduce((a, m) => a + m.area_ha, 0) / 100) * 100,
        farms_contributing: held("farms_contributing") ? null : farms.size, shared_records: period.length,
        shared_by_type: [...types].map(([type, count]) => ({ type, label: type, count })), suppressed, period: { from: args.p_from || null, to: args.p_to || null } }];
    }
    // group_map: the farm_map shape, so the Map scene block draws it as it draws a farm
    const feature = (geometry, properties) => ({ type: "Feature", geometry, properties });
    const fc = (features) => ({ type: "FeatureCollection", features });
    // PERF3b: by default the demo's group is a database before PERF3a (every layer inline; the per-layer and per-source
    // functions missing). `d.group.parts` (the screenshots set it) is PERF3a's light result instead (groupParts).
    if (["group_layer_features", "group_reference_counts", "group_reference_context"].includes(name)) {
      if (!g.parts) return [null, { code: "PGRST202", message: "Could not find the function in the schema cache" }];
      return groupParts(d, name, args);
    }
    if (g.parts) return [groupPartsMap(d, shown, level)];
    const layers = [
      { id: "demo-g-l1", name: "Catchment boundary (synthetic)", theme: "catchment", geometry_type: "polygon", group_own: true, epistemic_class: "observation", source: "the group's own map", features: fc([feature(g.area, { name: "HDLG catchment (synthetic)" })]) },
      { id: "demo-g-l2", name: "Member blocks (synthetic)", theme: "member_blocks", geometry_type: "polygon", group_own: true, epistemic_class: "observation", source: "the group's own members layer",
        features: fc(MEMBERS.map((m, i) => feature(polygon(...m.box), { member_number: "00" + (i + 1) }))) },
    ];
    if (shown().length) layers.push({ id: "member-farms", name: "Member farms (shared by each farm)", theme: "member_farms", geometry_type: "polygon", group_own: false, epistemic_class: "observation",
      source: "each member farm's own map, shown at the level the farm and the group both allow", features: fc(shown().map((m) => feature(polygon(...m.box), { name: level(m) === "named" ? m.name : "Member farm (not named)", level: level(m), area_ha: m.area_ha }))) });
    return [{ farm: { id: GROUP, name: "HDLG (example)", region: "canterbury" }, group: { id: GROUP, name: "HDLG (example)", member_detail: g.setting }, extent: g.area, extent_ha: 13000, extent_label: "Group area",
      titles: fc([]), land_units: fc([]), layers, reference: [] }];
  }
  // PERF3b: the demo group's map as PERF3a's light group_map gives it, for the screenshots (d.group.parts): the catchment
  // boundary and the member farms inline; the member blocks, an invented paddock grid (more than group_layer_features'
  // max in the whole group's box) and an invented farm-plan layer deferred, each with its count and box. The farm-plan
  // layer's first read fails (a statement timeout, as production gave) and the next succeeds. Invented reference: a
  // nutrient zone and two wetland areas, read per source. Nothing here is real.
  function groupPartsLayers(d) {
    const g = d.group;
    if (g.partsLayers) return g.partsLayers;
    const f = (geometry, properties, id) => ({ type: "Feature", id, geometry, properties });
    const [w, s0, e, n] = [171.96, -43.05, 172.115, -42.955], cols = 70, rows = 70, dx = (e - w) / cols, dy = (n - s0) / rows;
    const paddocks = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) paddocks.push(f(polygon(w + i * dx + dx * .06, s0 + j * dy + dy * .06, w + (i + 1) * dx - dx * .06, s0 + (j + 1) * dy - dy * .06),
      { name: "Paddock " + (i * rows + j + 1) + " (synthetic)", area_ha: 3.1 }, 50000 + i * rows + j));
    const lmu = MEMBERS.flatMap((m, k) => [0, 1, 2].map((q) => { const [a, b, c, dd] = m.box, mid = a + (c - a) * (q + 1) / 4;
      return f(polygon(a + (c - a) * q / 4, b, mid, dd), { name: "LMU " + (k + 1) + "." + (q + 1) + " (synthetic)" }, 60000 + k * 3 + q); }));
    const blocks = MEMBERS.map((m, i) => f(polygon(...m.box), { member_number: "00" + (i + 1) }, 40000 + i));
    const bboxOf = (fs) => fs.reduce((b, x) => { const c = x.geometry.coordinates[0]; for (const [lng, lat] of c) { b[0] = Math.min(b[0], lng); b[1] = Math.min(b[1], lat); b[2] = Math.max(b[2], lng); b[3] = Math.max(b[3], lat); } return b; }, [180, 90, -180, -90]);
    const layer = (id, name, theme, features, extra = {}) => ({ id, name, theme, geometry_type: "polygon", group_own: true, epistemic_class: "observation", source: "the group's own map",
      feature_count: features.length, bbox: bboxOf(features), all: features, ...extra });
    g.partsLayers = [
      layer("demo-g-l1", "Catchment boundary (synthetic)", "catchment", [f(g.area, { name: "HDLG catchment (synthetic)" }, 39999)]),
      layer("demo-g-l2", "Member blocks (synthetic)", "member_blocks", blocks, { deferred: true }),
      layer("demo-g-l3", "Paddocks (synthetic)", "paddocks", paddocks, { deferred: true }),
      layer("demo-g-l4", "Farm plan: land management units (synthetic)", "land_management_units", lmu, { deferred: true }),
    ];
    g.failOnce = new Set(["demo-g-l4"]);
    const ref = (key, name, theme, features) => ({ key, name, theme, attribution: "Invented for the demo.", replaces_in_extent: null, features: collection(features) });
    g.partsReference = [
      ref("ecan-nutrient-zones", "LWRP nutrient allocation zones (ECan)", "zones", [f(polygon(171.9, -43.1, 172.2, -42.9), { name: "Invented nutrient zone (synthetic)", external_id: "demo-z1", in_area: true, authorisations: [] }, 70001)]),
      ref("ecan-wetland-areas", "Wetland areas, DOC desktop study (ECan)", "wetlands", [f(polygon(172.04, -43.0, 172.046, -42.995), { name: "Invented wetland (synthetic)", external_id: "demo-w1", in_area: true, authorisations: [] }, 70002),
        f(polygon(172.07, -43.02, 172.074, -43.017), { name: "Invented wetland 2 (synthetic)", external_id: "demo-w2", in_area: true, authorisations: [] }, 70003)]),
    ];
    return g.partsLayers;
  }
  function groupPartsMap(d, shown, level) {
    const g = d.group, layers = groupPartsLayers(d).map(({ all, ...l }) => ({ ...l, features: collection(l.deferred ? [] : copy(all)) }));
    if (shown().length) layers.push({ id: "member-farms", name: "Member farms (shared by each farm)", theme: "member_farms", geometry_type: "polygon", group_own: false, epistemic_class: "observation",
      source: "each member farm's own map, shown at the level the farm and the group both allow",
      features: collection(shown().map((m) => feature(polygon(...m.box), { name: level(m) === "named" ? m.name : "Member farm (not named)", level: level(m), area_ha: m.area_ha }))) });
    return { farm: { id: GROUP, name: "HDLG (example)", region: "canterbury" }, group: { id: GROUP, name: "HDLG (example)", member_detail: g.setting }, extent: g.area, extent_ha: 13000, extent_label: "Group area",
      titles: collection([]), land_units: collection([]), layers, reference: [] };
  }
  // As public.group_layer_features, group_reference_counts and group_reference_context (PERF3a), over the invented layers.
  function groupParts(d, name, args) {
    const g = d.group, layers = groupPartsLayers(d);
    if (name === "group_reference_counts") return [Object.fromEntries(g.partsReference.map((r) => [r.key, r.features.features.length]))];
    if (name === "group_reference_context") return [copy(g.partsReference.find((r) => r.key === args.source) || null)];
    const l = layers.find((x) => x.id === args.layer);
    if (!l) return [null];
    if (g.failOnce.delete(l.id)) return [null, { code: "57014", message: "canceling statement due to statement timeout" }];
    const box = args.x0 == null ? null : [args.x0, args.y0, args.x1, args.y1];
    const hit = (x) => { if (!box) return true; const c = x.geometry.coordinates[0]; const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
      return Math.max(...xs) >= box[0] && Math.min(...xs) <= box[2] && Math.max(...ys) >= box[1] && Math.min(...ys) <= box[3]; };
    const inBox = l.all.filter(hit), max = args.max_features ?? 4000;
    if (inBox.length > max) return [{ features: collection([]), total_in_box: inBox.length, truncated: true }];
    return [{ features: collection(copy(inBox)), total_in_box: inBox.length, truncated: false }];
  }
  // CAP1b: the demo farm as CAP1a's farm_map gives a large farm, for the screenshots and tests (d.farmParts): an invented
  // paddock grid deferred (no features, its count and box; more than farm_layer_features' max in the whole farm's box), and
  // its titles over farm_map's cap (640: a list-only line), and
  // an invented dense bore source whose farm_reference_context entry comes truncated (its count, no features), read by
  // viewport with reference_in_view. By default the demo farm is a database before CAP1a (both functions missing). Nothing
  // here is real.
  const FARM_PADDOCKS = "demo-f-paddocks", DENSE = "ecan-wells";
  function farmPartsData(d) {
    if (d.farmPartsData) return d.farmPartsData;
    const [[w, s0], , [e, n]] = d.map.extent.coordinates[0], cols = 70, rows = 70, dx = (e - w) / cols, dy = (n - s0) / rows;
    const paddocks = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) paddocks.push({ type: "Feature", id: 80000 + i * rows + j,
      geometry: polygon(w + i * dx + dx * .06, s0 + j * dy + dy * .06, w + (i + 1) * dx - dx * .06, s0 + (j + 1) * dy - dy * .06), properties: { name: "Paddock " + (i * rows + j + 1) + " (synthetic)", area_ha: 0.9 } });
    const bores = [], bw = w - .005, bs = s0 - .005, side = 80, bx = (e - w + .01) / side, by = (n - s0 + .01) / side;
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) bores.push({ id: 90000 + i * side + j, lng: bw + (i + .5) * bx, lat: bs + (j + .5) * by, external_id: "SYN/D" + (i * side + j + 1) });
    d.farmPartsData = { paddocks, bores, layer: { id: FARM_PADDOCKS, name: "Paddocks (synthetic)", theme: "paddocks", geometry_type: "polygon", epistemic_class: "observation", source: "the farm's own map",
      feature_count: paddocks.length, bbox: [w, s0, e, n], deferred: true, features: collection([]) } };
    return d.farmPartsData;
  }
  function farmParts(d, name, args) {
    const p = farmPartsData(d);
    // (its titles over farm_map's cap too: an empty collection, truncated, with the count; the outline still draws)
    if (name === "farm_map") return [{ ...copy(d.map), titles: { ...collection([]), truncated: true, feature_count: 640 }, layers: [...copy(d.map.layers), copy(p.layer)] }];
    if (name === "farm_reference_counts") return [{ [DENSE]: p.bores.length }];
    if (name === "farm_reference_context") {
      if (args.source !== DENSE) return [null];
      return [{ key: DENSE, name: "Wells (ECan)", theme: "wells", attribution: "Invented for the demo.", replaces_in_extent: [], truncated: true, feature_count: p.bores.length, features: collection([]) }];
    }
    if (name === "farm_layer_features") {
      if (args.f !== FARM || args.layer !== FARM_PADDOCKS) return [null];
      if (![args.x0, args.y0, args.x1, args.y1].every(Number.isFinite)) return [null, { code: "22023", message: "A box is required" }];
      const hit = (x) => { const c = x.geometry.coordinates[0]; return c[2][0] >= args.x0 && c[0][0] <= args.x1 && c[2][1] >= args.y0 && c[0][1] <= args.y1; };
      const inBox = p.paddocks.filter(hit), max = args.max_features ?? 4000;
      if (inBox.length > max) return [{ features: collection([]), total_in_box: inBox.length, truncated: true }];
      return [{ features: collection(copy(inBox)), total_in_box: inBox.length, truncated: false }];
    }
    // CAP2's reference_view_features: one source, the box in degrees (required), at most max_features (4,000 at most), as
    // {features, total_in_box, truncated}; null for a source that is not the demo's dense one
    if (name === "reference_view_features") {
      if (![args.x0, args.y0, args.x1, args.y1].every(Number.isFinite)) return [null, { code: "P0001", message: "A box is needed" }];
      if (args.source !== DENSE) return [null];
      const max = Math.min(args.max_features ?? 1000, 4000);
      const inBox = p.bores.filter((b) => b.lng >= Math.min(args.x0, args.x1) && b.lng <= Math.max(args.x0, args.x1) && b.lat >= Math.min(args.y0, args.y1) && b.lat <= Math.max(args.y0, args.y1));
      if (inBox.length > max) return [{ features: collection([]), total_in_box: max + 1, truncated: true }];
      return [{ features: collection(inBox.map((b) => ({ type: "Feature", id: b.id, geometry: { type: "Point", coordinates: [b.lng, b.lat] },
        properties: { name: "Bore " + b.external_id + " (synthetic)", external_id: b.external_id } }))), total_in_box: inBox.length, truncated: false }];
    }
    // reference_in_view: the box in NZTM metres, as the database takes it; at most max_rows rows (5,000 at most)
    const W = typeof module === "object" && module.exports ? require("./wq-model.js") : globalThis.FP.wqModel;
    const [x0, y0] = W.nztmToLngLat(args.bbox_xmin, args.bbox_ymin), [x1, y1] = W.nztmToLngLat(args.bbox_xmax, args.bbox_ymax);
    const want = Array.isArray(args.sources) ? args.sources : null, n = Math.min(args.max_rows ?? 5000, 5000);
    const rows = (want && !want.includes(DENSE) ? [] : p.bores).filter((b) => b.lng >= x0 && b.lng <= x1 && b.lat >= y0 && b.lat <= y1).slice(0, n);
    return [rows.map((b) => ({ id: b.id, source_key: DENSE, external_id: b.external_id, web_geom: { type: "Point", coordinates: [b.lng, b.lat] },
      props: { name: "Bore " + b.external_id + " (synthetic)", external_id: b.external_id } }))];
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
  // B4b: the capture queue's entries and entry files too (ids made on the phone; a second insert of one id is refused as
  // the database refuses it, 23505, which the queue reads as "already written").
  const KEPT = ["checks", "documents", "entries", "entry_links", "entry_files", "layer_notes"];
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
    const CN = typeof module === "object" && module.exports ? require("./consent-no.js") : globalThis.FP.consentNo;
    const crcs = (x) => CN.find(String(x.title || "") + " " + String(x.original_name || ""));
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
  // ON3d, as public.farm_onboarding_sync and public.proposals_decide over the demo farm: the checklist's "to confirm" lines (the model's
  // own, over onboardingInputs) as farm_onboarding_check proposals kept in d.tables.proposals for the session, and a farm editor's
  // decision on one. Ids start at 9001 so they never meet the group demo's.
  let farmProposalId = 9000;
  const farmEditor = (d, f) => ["owner", "admin", "edit"].includes(d.tables.farm_members.find((m) => m.farm_id === f)?.role);
  function farmChecksSync(d, f) {
    if (!f || !farmEditor(d, f)) return [null, { message: "only an editor of the farm can list what it has to decide" }];
    const OM = typeof module === "object" && module.exports ? require("./onboarding-model.js") : globalThis.FP.onboardingModel;
    const inputs = onboardingInputs(d, f);
    if (!inputs) return [{ proposed: 0, changed: 0, resolved: 0 }];
    const items = OM.build(inputs, { now: d.asAt + "T09:00:00Z" }).items.filter((i) => OM.DECISION_RULES.includes(i.rule));
    const rows = d.tables.proposals, now = new Date().toISOString();
    let made = 0, resolved = 0;
    for (const it of items) {
      if (rows.some((p) => p.farm_id === f && p.subject_key === it.key && ["proposed", "ambiguous", "accepted", "rejected"].includes(p.status))) continue;
      const tail = it.key.slice(it.key.indexOf(":") + 1);
      // FU3b: a "to check" or "missing" line is acknowledged (seen, correct or not the farm's)
      const candidate = it.rule === "consent.not_recorded" ? { action: "add_to_register", consent_no: tail } : it.rule === "consent.no_conditions" ? { action: "fetch_conditions", consent_no: tail }
        : it.rule === "fep.confirm_report" ? { action: "confirm_report", document_id: tail } : it.rule === "fep.not_read" ? { action: "read_plan_in", document_id: tail } : { action: "acknowledge" };
      rows.push({ id: ++farmProposalId, farm_id: f, org_id: null, kind: OM.FARM_CHECK_KIND, subject: { rule: it.rule, evidence: tail }, subject_key: it.key, document_id: null,
        evidence: { rule: it.rule }, candidates: [candidate], status: "proposed", decision: null, decided_by: null, decided_at: null, applied_at: null, created_at: now });
      made++;
    }
    for (const p of rows) if (p.farm_id === f && p.kind === OM.FARM_CHECK_KIND && ["proposed", "ambiguous"].includes(p.status) && !items.some((i) => i.key === p.subject_key)) { p.status = "superseded"; resolved++; }
    return [{ proposed: made, changed: 0, resolved }];
  }
  function farmDecide(d, args) {
    const row = d.tables.proposals.find((p) => p.id === args.id && p.farm_id);
    if (!row || !farmEditor(d, row.farm_id)) return [null, { message: "proposal " + args.id + " is not open for you to decide" }];
    if (!["proposed", "ambiguous"].includes(row.status)) return [null, { message: "proposal " + args.id + " is already " + row.status }];
    let chosen = null;
    if (args.status === "accepted") {
      chosen = args.candidate ? row.candidates.find((c) => Object.entries(args.candidate).every(([k, v]) => c[k] === v)) : row.status === "ambiguous" ? null : row.candidates[0];
      if (!chosen) return [null, { message: row.status === "ambiguous" && !args.candidate ? "an ambiguous proposal needs one of its candidates chosen" : "the chosen candidate must be exactly one of this proposal's candidates (0 match)" }];
    } else if (args.status !== "rejected") return [null, { message: "a decision is accepted or rejected" }];
    Object.assign(row, { status: args.status, decision: { candidate: chosen, note: String(args.note || "").trim() || null }, decided_by: d.user.id, decided_at: new Date().toISOString() });
    return [row];
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
  const WQ_PARAMS = { "nitrate-nitrite-n": ["Nitrate-nitrite nitrogen (NNN)", "mg/L"], "nitrate-n": ["Nitrate nitrogen", "mg/L"], drp: ["Dissolved reactive phosphorus", "mg/L"], "e-coli": ["E. coli", "/100 mL"], turbidity: ["Turbidity", "NTU"] };
  const WQ_SOURCES = {
    "ecan-wq": { name: "Environment Canterbury", attribution: "Source: Environment Canterbury (invented demo values). Results are provisional until reviewed by ECan.", provisional: true },
    "demo-farm-wq": { name: "Example farm's own sampling (synthetic)", attribution: "Source: the farm's own sampling (invented demo values).", provisional: false },
    "demo-hdlg-wq": { name: "HDLG (example) group sampling (synthetic)", attribution: "Source: the group's own sampling (invented demo values).", provisional: false },
    // WQ8: another agency's dataset at a demo location (NRWQN-like; invented values), credited as the NRWQN migration credits it
    "niwa-nrwqn": { name: "Earth Sciences New Zealand (NIWA)", attribution: "Earth Sciences New Zealand (NIWA) (invented demo values).", provisional: true },
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
      // MC1: the catchment group's own sampling sites (D2, owned by the group): in the group's space only, never the farm's line
      { id: 9201, external_id: "HDLG-G1", name: "Group sampling at the ford (synthetic)", lng: 172.0405, lat: -43.0005, type: "river", params: ["nitrate-nitrite-n"], from: [2023, 6], base: 1.3, group: true },
      { id: 9202, external_id: "HDLG-G2", name: "Group sampling at the culvert (synthetic)", lng: 172.072, lat: -43.022, type: "stream", params: ["nitrate-nitrite-n"], from: [2024, 0], base: 0.9, group: true },
      // WQ2: the farm bridge site's predecessor (sampled Jul 2016 to Jun 2020, then replaced by DEMO-01): no longer listed near the
      // farm, read only through the invented monitoring location below
      { id: 9107, external_id: "DEMO-01A", name: "Demo Creek above the old farm bridge (synthetic)", lng: 172.0322, lat: -42.9882, type: "river", params: ["nitrate-nitrite-n", "drp"], from: [2016, 6], to: [2020, 5], base: 1.9, retired: true },
      // WQ6 (Q18): a recorder beside the farm bridge site (co-located), the only one with nitrate-N; its different key is its own line
      { id: 9108, external_id: "DEMO-01R", name: "Demo Creek recorder at the farm bridge (synthetic)", lng: 172.0318, lat: -42.9888, type: "river", params: ["nitrate-n"], from: [2023, 0], base: 1.2, retired: true },
      // WQ8: another agency's long record at the gorge (NRWQN-like, its own dataset niwa-nrwqn), to Dec 2022, before DEMO-03 began: read
      // only through the invented location at the gorge below, drawn as its own line beside ECan's
      { id: 9109, external_id: "DEMO-03N", name: "Demo River at the gorge, national network (synthetic)", lng: 172.0624, lat: -42.9683, type: "river", params: ["nitrate-nitrite-n", "drp"], from: [2016, 6], to: [2022, 11], base: 0.9, retired: true, nrwqn: true },
    ];
    // WQ2: an invented monitoring location (as public.monitoring_location returns it): the farm bridge site and its predecessor.
    const locations = [{ id: 9301, key: "demo-creek-at-the-farm-bridge", name: "Demo Creek at the farm bridge, synthetic location", note: "Invented for the demo.",
      members: [
        { monitoring_site_id: 9101, source_key: "ecan-wq-sites", external_id: "DEMO-01", name: "Demo Creek at the farm bridge (synthetic)", site_type: "river", role: "current", valid_from: "2020-07-01", valid_to: null, note: null },
        { monitoring_site_id: 9107, source_key: "ecan-wq-sites", external_id: "DEMO-01A", name: "Demo Creek above the old farm bridge (synthetic)", site_type: "river", role: "predecessor", valid_from: "2016-07-01", valid_to: "2020-06-30", note: null },
        { monitoring_site_id: 9108, source_key: "ecan-wq-sites", external_id: "DEMO-01R", name: "Demo Creek recorder at the farm bridge (synthetic)", site_type: "river", role: "co_located", valid_from: "2023-01-01", valid_to: null, note: null }] },
      // WQ8: the gorge site (ECan, from Jan 2023) and another agency's site beside it (NRWQN-like, to Dec 2022): two datasets, one line each
      { id: 9302, key: "demo-river-at-the-gorge", name: "Demo River at the gorge, synthetic location", note: "Invented for the demo.",
        members: [
          { monitoring_site_id: 9103, source_key: "ecan-wq-sites", external_id: "DEMO-03", name: "Demo River at the gorge (synthetic)", site_type: "river", role: "current", valid_from: "2023-01-01", valid_to: null, note: null },
          { monitoring_site_id: 9109, source_key: "niwa-nrwqn-sites", external_id: "DEMO-03N", name: "Demo River at the gorge, national network (synthetic)", site_type: "river", role: "co_located", valid_from: "2016-07-01", valid_to: "2022-12-31", note: null }] }];
    const sites = defs.filter((d) => !d.retired).map((d) => ({ site_id: d.id, external_id: d.external_id, name: d.name, site_type: d.type, distance_m: toBox(d.lng, d.lat), geom: place(d.lng, d.lat),
      source_key: d.own ? "demo-farm-wq" : d.group ? "demo-hdlg-wq" : "ecan-wq-sites", owner_farm_id: d.own ? FARM : null, owner_org_id: d.group ? GROUP : null }));
    const series = {};
    const wave = (i, k) => Math.sin(i * 0.52 + k) * 0.5 + Math.sin(i * 1.7 + k * 3) * 0.25;
    for (const d of defs) {
      const months = [];
      const [ey, em] = d.to || [2026, 8];
      for (let y = d.from[0], m = d.from[1]; y < ey || (y === ey && m <= em); m++) { if (m > 11) { y++; m = 0; } if (y > ey || (y === ey && m > em)) break; months.push([y, m]); }
      if (d.count) months.length = d.count;
      d.params.forEach((key, k) => {
        series[d.id + "|" + key] = months.map(([y, m], i) => {
          const sampled_at = new Date(Date.UTC(y, m, 8 + ((i * 5 + k) % 12), 21, 0, 0)).toISOString();
          let value, qualifier = null;
          if (key === "nitrate-nitrite-n" || key === "nitrate-n") value = Math.max(0.01, d.base * (1 + 0.45 * wave(i, k) + (m >= 5 && m <= 8 ? 0.25 : 0)));
          else if (key === "drp") { value = Math.max(0.002, 0.008 * (d.base + 0.4) * (1 + 0.6 * wave(i, k + 2))); if (value < 0.01) { value = 0.01; qualifier = "<"; } }   // below the lab's limit: kept as "<0.01"
          else if (key === "e-coli") { value = Math.round(Math.max(1, 110 * d.base * (1 + 1.4 * wave(i, k + 1)) * (1 + (m >= 10 || m <= 1 ? 0.5 : 0)))); if (value > 2419) { value = 2419; qualifier = ">"; } }
          else value = Math.max(0.3, 2.6 * d.base * (1 + 0.8 * wave(i, k + 4)));
          if (key !== "e-coli") value = Number(value.toPrecision(3));
          return { sampled_at, value, qualifier, value_text: (qualifier || "") + String(value), unit: WQ_PARAMS[key][1], sample_id: d.external_id + "-" + (i + 1), series: "", replicate_no: 1,
            datetime_flag: null, source_key: d.own ? "demo-farm-wq" : d.group ? "demo-hdlg-wq" : d.nrwqn ? "niwa-nrwqn" : "ecan-wq", superseded_at: null, aggregate: "", n_values: null };
        });
      });
    }
    for (const site of sites) {   // the last sample date is read off the series (null: no results yet)
      const all = Object.entries(series).filter(([k]) => k.startsWith(site.site_id + "|")).flatMap(([, rows]) => rows);
      site.last_sampled = all.length ? all.map((r) => r.sampled_at).sort().pop() : null;
    }
    return { sites, series, params: WQ_PARAMS, sources: WQ_SOURCES, locations };
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
  // MC1: the catchment group's published method (X1b preset, as public.group_wq_presets returns it) and the analysis
  // function's previews for its standing water-quality answer. The browser cannot run the library, so the figures here are
  // invented demo values in the function's reply shape (the real path is tested in supabase/functions/analysis/group_answer.test.ts).
  const DEMO_PRESET = { preset_id: "de000000-0000-4000-8000-0000000003c1", family: "hdlg-nitrate-band", version: 1, title: "HDLG nitrate toxicity band, ECan record to June 2025",
    definition: { schema: "wq-preset/1", family: "hdlg-nitrate-band", title: "HDLG nitrate toxicity band, ECan record to June 2025", tool: "band",
      parameters: { attribute: "nitrate-toxicity", end_year: 2025, dataset: "ecan-wq" }, applies_to: { area: "hdlg-catchment" },
      caveats: ["The group reports state to 30 June 2025 from ECan's record; its own sampling is shown beside it, never pooled."], confirmed_overrides: ["dataset", "end_year"] } };
  // site -> invented results over 1 Jul 2020 to 30 Jun 2025 (n is the demo series' count in that window); band: a letter, or why not
  const DEMO_RESULTS = {
    9101: { n: 60, median: 1.71, band: "B", p95: 2.62 }, 9102: { n: 60, median: 2.46, band: "C", p95: 3.71 },
    9103: { n: 30, median: 0.74, band: { reason: "insufficient_record", detail: "Not enough data for a band: 30 of 60 months and 10 of 20 quarters have a result; the rule (LAWA factsheet: Calculating water quality state for rivers) needs at least 54 months and 18 quarters over 5 years." } },
    9201: { n: 24, median: 1.38 }, 9202: { n: 18, median: 0.95 },
  };
  // WQ3, as public.group_wq_pick: the ECan sites of the demo's group area that are active, with at least 40 nitrate-nitrite-N sampling times
  // in the last 5 years (the demo's series end in Sep 2026); LAWA-matched first (demoLawa), then the longer record (years, then n), then the
  // id; a site in a monitoring location comes as the location, labelled with its current site (the invented location 9301 is the farm
  // bridge site's, as WQ2's demo has it). Never nearest.
  const DEMO_LOCATION = { id: 9301, key: "demo-creek-at-the-farm-bridge", name: "Demo Creek at the farm bridge, synthetic location", current_site_id: 9101,
    members: [{ monitoring_site_id: 9101, source_key: "ecan-wq-sites", external_id: "DEMO-01", name: "Demo Creek at the farm bridge (synthetic)", role: "current", valid_from: "2020-07-01", valid_to: null, samples: 60 },
      { monitoring_site_id: 9107, source_key: "ecan-wq-sites", external_id: "DEMO-01A", name: "Demo Creek above the old farm bridge (synthetic)", role: "predecessor", valid_from: "2016-07-01", valid_to: "2020-06-30", samples: 0 }] };
  // WQ7: the demo group's downstream set (public.group_downstream_sites): site -> km along the river from member land (invented)
  const DEMO_DOWNSTREAM_KM = { 9101: 1.4, 9103: 6.2 };
  function demoPick(wq, args) {
    const since = Date.UTC(2021, 8, 1), recent = Date.UTC(2025, 8, 1);
    const rows = wq.sites.filter((s) => s.source_key === "ecan-wq-sites" && !s.owner_org_id && !s.owner_farm_id).map((s) => {
      const nnn = wq.series[s.site_id + "|" + (args.p_parameter === "nitrate-n" ? "nitrate-nitrite-n" : args.p_parameter)] || [];
      const at = nnn.map((r) => Date.parse(r.sampled_at));
      return { s, n: nnn.length, years: new Set(nnn.map((r) => r.sampled_at.slice(0, 4))).size, n5: at.filter((t) => t >= since).length, active: at.some((t) => t >= recent) };
    }).filter((x) => x.active && x.n5 >= 40);
    const lawa = (x) => demoLawa(x.s.site_id).length > 0;
    rows.sort((a, b) => lawa(b) - lawa(a) || b.years - a.years || b.n - a.n || a.s.external_id.localeCompare(b.s.external_id));
    // WQ7 (Q20 default, on for the demo's HDLG example): the sites on a river reach downstream of member land first, each tier in
    // WQ3's order; every row says which rule placed it (invented reach distances).
    const down = (x) => (DEMO_DOWNSTREAM_KM[x.s.site_id] !== undefined ? 1 : 0);
    rows.sort((a, b) => down(b) - down(a));          // stable: WQ3's order is kept within each tier
    return rows.map((x, i) => {
      const loc = x.s.site_id === DEMO_LOCATION.current_site_id ? DEMO_LOCATION : null;
      return { pick_rank: i + 1, site_id: x.s.site_id, external_id: x.s.external_id, name: x.s.name, site_type: x.s.site_type, source_key: x.s.source_key, family: "nitrate",
        parameter_keys: ["nitrate-nitrite-n"], n: x.n, years: x.years, n_last_5y: x.n5, first_sampled: null, last_sampled: x.s.last_sampled, lawa_matched: lawa(x),
        location_id: loc ? loc.id : null, location_key: loc ? loc.key : null, location_name: loc ? loc.name : null, member_site_ids: [x.s.site_id], total: rows.length,
        placed_by: down(x) ? "downstream of member land" : "in the group's area", downstream_km: down(x) ? DEMO_DOWNSTREAM_KM[x.s.site_id] : null };
    });
  }
  function demoAnalysis(d, body) {
    const loc = body?.params?.location_id === DEMO_LOCATION.id ? DEMO_LOCATION : null;
    const site = wqOf(d).sites.find((s) => s.site_id === (loc ? loc.current_site_id : body?.params?.site_id)), res = DEMO_RESULTS[site?.site_id];
    if (!site || body.mode !== "preview") return null;
    const band = !!body.preset_id, ds = site.source_key === "ecan-wq-sites" ? "ecan-wq" : site.source_key, src = WQ_SOURCES[ds];
    // the band, as the library: nitrate-N, else nitrate-nitrite-N where only that is measured (the demo's sites measure NNN)
    const parameter = band ? (res && wqOf(d).series[site.site_id + "|nitrate-nitrite-n"] ? "nitrate-nitrite-n" : "nitrate-n") : body.params.parameter;
    const has = !!res && !!wqOf(d).series[site.site_id + "|" + parameter];
    const window = { end_year: 2025, years: 5, from: "2020-07-01", to: "2025-06-30" };
    const none = { reason: "no_results", detail: "No " + parameter + " results you can read at this site between 1 Jul 2020 and 30 Jun 2025." };
    const unavailable = !has ? none : band && typeof res.band !== "string" ? res.band : null;
    const caveats = has ? [...(src.provisional ? [src.name + ": Provisional until reviewed by ECan."] : []), "The source does not report the laboratory or method of each result, so method comparability is not checked."] : [];
    if (band && has) caveats.unshift("HDLG's method \"" + DEMO_PRESET.title + "\" (v1): " + DEMO_PRESET.definition.caveats[0],
      "No nitrate-N results here, so nitrate-nitrite-N (total oxidised nitrogen) is used, as LAWA does for nitrate toxicity; it slightly overstates nitrate.");
    const result = unavailable ? null : band ? { band: res.band, monthly_values: res.n, statistics: [{ label: "Median", display: res.median + " mg/L" }, { label: "95th percentile", display: res.p95 + " mg/L" }] }
      : { samples: res.n, censored_below: 0, censored_above: 0, median: { lo: res.median, hi: res.median, exact: true }, unit: "mg/L" };
    return { preset: band ? { family: DEMO_PRESET.family, version: 1, title: DEMO_PRESET.title, group: "HDLG (example)", applied: true } : null,
      tool: band ? "band" : "summary", tool_version: "x1-wq 1.0.0", method: { id: band ? "x1-band v1" : "x1-summary v1", name: band ? "NPS-FM attribute band: Nitrate (toxicity)" : "Summary statistics of every sample (replicates collapsed)",
        ...(band ? { table: "Appendix 2A Table 6 – Nitrate (toxicity)" } : {}), percentile: "Hazen", censoring: "x1-censored-bounds v1" },
      parameters: { tool: band ? "band" : "summary", ...(loc ? { location_id: loc.id } : { site_id: site.site_id }), parameter, ...(band ? { attribute: "nitrate-toxicity", dataset: "ecan-wq" } : {}), ...window },
      site: { monitoring_site_id: site.site_id, source_key: site.source_key, external_id: site.external_id, name: site.name },
      ...(loc ? { location: { location_id: loc.id, key: loc.key, name: loc.name, members: loc.members } } : {}),
      measurement_sources: has ? [ds] : [], source_versions: has ? { [ds]: { rows: res.n, last_load_run_id: 1, max_updated_at: "2026-09-30T00:00:00Z", rows_sha256: "0".repeat(64) } } : {},
      attribution: has ? [{ dataset: ds, name: src.name, statement: src.attribution, provisional: src.provisional ? "Provisional until reviewed by ECan." : null }] : [],
      result, unavailable, caveats, statement: "", ai_proposed_inputs: null, advisor_overrides: {}, note_allowed: false,
      preview_sha256: (site.site_id.toString(16) + (band ? "b" : "5") + parameter.length.toString(16)).padStart(64, "0") };
  }
  // D3, as public.wq_state_trend_for_site: the one invented ECan site matched to a LAWA site (invented values, LAWA's layout).
  function demoLawa(site) {
    if (site !== 9101) return [];
    const base = { lawa_site_id: "demo-lawa-01", lawa_site_name: "Demo Creek at the farm bridge", council_site_id: "DEMO-01", agency: "ECan", release: "2026-10-27", file_name: "lawa-river-wq-demo.xlsx",
      attribution: "Data sourced from LAWA (Land, Air, Water Aotearoa) and Environment Canterbury (invented demo values).", licence: "CC BY 4.0", monitoring_site_id: 9101, match_status: "matched", match_method: "council_site_id", source_key: "lawa-river-wq" };
    return [{ ...base, kind: "state", indicator: "Nitrate nitrogen", attribute: "Nitrate (toxicity) - NO3N", unit: "mg/L", state: "B", period: "hYear 2025", sheet: "State Attribute Results", source_row: 21 },
      { ...base, kind: "trend", indicator: "Nitrate nitrogen", state: "Likely degrading", trend_description: "Likely degrading", trend_score: -1, period: "10 years", sheet: "Trend Results", source_row: 48 }];
  }
  function client(ready) {
    const result = (data = null, error = null) => ({ data: copy(data), error });
    const error = (message) => result(null, { message });
    function query(table) {
      const filters = [], orders = []; let write = false, singular = false, maybe = false, adding = null, changes = null, removing = false, span = null;
      const q = {
        select() { return q; }, eq(key, val) { filters.push([key, val]); return q; }, in(key, vals) { filters.push([key, { in: vals }]); return q; },
        order(key, options) { orders.push([key, options?.ascending !== false]); return q; }, limit() { return q; },
        // ON3b: `is(key, null)` and `range(from, to)` (inclusive), as PostgREST pages a long read
        is(key, val) { filters.push([key, { is: val }]); return q; }, range(from, to) { span = [from, to]; return q; },
        insert(rows) { write = true; adding = rows; return q; }, update(values) { write = true; changes = values || null; return q; }, delete() { write = true; removing = true; return q; },
        single() { singular = true; return execute(); }, maybeSingle() { singular = true; maybe = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        const d = await ready, rows = d.tables[table];
        if (write && adding && KEPT.includes(table)) {
          const now = new Date().toISOString(), added = (Array.isArray(adding) ? adding : [adding]).map((r) => ({ id: "demo-new-" + ++made, created_at: now, ...(table === "layer_notes" ? { updated_at: now, created_by: d.user.id, updated_by: d.user.id } : {}),
            ...(table === "entries" ? { updated_at: now, created_by: d.user.id, captured_at: now } : {}), ...copy(r) }));
          if (added.some((r) => rows.some((x) => x.id === r.id))) return result(null, { code: "23505", message: "duplicate key value violates unique constraint" });
          for (const r of added) {
            if (table === "entry_links") r.farm_id = d.tables.entries.find((e) => e.id === r.entry_id)?.farm_id ?? null;
            rows.push(r);
            if (table === "documents") d.tables.document_relations.push({ id: r.id, tier: r.tier, relates_to: r.relates_to || null, superseded_by: null });
          }
          return result(singular ? added[0] : added);
        }
        // A change or removal of a Layers page note: applied in memory to the rows the filters pick.
        if (write && (changes || removing) && EDITED.includes(table) && filters.length) {
          const hit = rows.filter((row) => filters.every(([key, val]) => (val && Array.isArray(val.in) ? val.in.includes(row[key]) : val && typeof val === "object" && "is" in val ? (row[key] ?? null) === val.is : row[key] === val)));
          if (removing) { for (const r of hit) rows.splice(rows.indexOf(r), 1); return result(null); }
          for (const r of hit) Object.assign(r, copy(changes), { updated_at: new Date().toISOString() });
          return singular ? (hit.length === 1 ? result(hit[0]) : error("Demo row not found")) : result(hit);
        }
        if (write) return error("The demo does not save changes");
        if (!rows) return error("This demo does not provide " + table);
        let selected = [...rows, ...(d.groupTables?.[table] || [])].filter((row) => filters.every(([key, val]) => (val && Array.isArray(val.in) ? val.in.includes(row[key]) : val && typeof val === "object" && "is" in val ? (row[key] ?? null) === val.is : row[key] === val)));
        for (const [key, asc] of [...orders].reverse()) selected = [...selected].sort((a, b) => String(a[key] || "").localeCompare(String(b[key] || "")) * (asc ? 1 : -1));
        if (span) selected = selected.slice(span[0], span[1] + 1);
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
        // CAP1b: with d.farmParts the demo farm is a large farm as CAP1a gives it (farmParts); without, a database before CAP1a
        if (d.farmParts && args.f === FARM && ["farm_map", "farm_reference_counts", "farm_reference_context", "farm_layer_features"].includes(name)) return result(...farmParts(d, name, args));
        if (name === "farm_layer_features" || name === "reference_in_view" || name === "reference_view_features") {
          if (!d.farmParts) return result(null, { code: "PGRST202", message: "Could not find the function in the schema cache" });
          return result(...farmParts(d, name, args));
        }
        if (name === "farm_map") return result(args.f === FARM ? d.map : args.f === FARM2 ? d.map2 : null);
        // PERF1b, as public.farm_reference_counts and public.farm_reference_context (PERF1a): the farm's reference entries
        // (d.reference by farm; the fixture's `reference`, none in the demo) counted, and one served source's entry read on
        // its own (no features here: its entry with none; not served or no such farm: null). farm_map's `reference` is [].
        if (name === "farm_reference_counts" || name === "farm_reference_context") {
          if (args.f !== FARM && !(args.f === FARM2 && d.map2)) return result(null);
          const entries = (d.reference || {})[args.f] || [], n = (r) => (r.features?.features || []).length;
          if (name === "farm_reference_counts") return result(Object.fromEntries(entries.filter((r) => n(r) > 0).map((r) => [r.key, n(r)])));
          const src = (d.tables.reference_sources || []).find((s) => s.key === args.source && s.serve_to_customers);
          if (!src) return result(null);
          return result(copy(entries.find((r) => r.key === args.source) || { key: src.key, name: src.name, theme: src.theme, attribution: src.attribution || null,
            replaces_in_extent: [], features: collection([]) }));
        }
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
          return result(wqOf(d).sites.filter((x) => !x.owner_org_id && x.distance_m <= (args.km ?? 10) * 1000).sort((a, b) => a.distance_m - b.distance_m || a.external_id.localeCompare(b.external_id)));
        }
        if (name === "wq_site_latest") return result(wqLatest(wqOf(d), args.site));
        // D3, as public.wq_state_trend_for_site: LAWA's results through the crosswalk (one invented matched site)
        if (name === "wq_state_trend_for_site") return result(demoLawa(args.site));
        // S5's group functions by name (group_load_gaps is DQ1's, below)
        if (/^(group_(map|member_summary|member_farms|shared_entries|shared_documents|wq_sites|wq_pick|wq_presets|readiness|layer_features|reference_counts|reference_context)|set_group_member_detail)$/.test(name)) return result(...groupRpc(d, name, args || {}));
        // ON3a/ON3b: the group's proposal counts and decisions (in memory); an association request is not saved in the demo
        if (/^proposals_(open_counts|decide|since_seen|mark_seen|propose)$/.test(name) && d.group) return result(...proposalsRpc(d, name, args || {}));
        if (name === "request_farm_group_association") return error("The demo does not save changes");
        // FU4, as public.request_plan_import: a farm editor's ask for one of the farm's plans, once per plan (the open request again on a second ask),
        // in memory for the session, stamped with the fixture's date so the screenshots read the same on every day.
        if (name === "request_plan_import") {
          const doc = d.tables.documents.find((x) => x.id === args?.p_document);
          if (!doc || !farmEditor(d, doc.farm_id)) return error("that plan is not one you can ask to have read in");
          if (!["fep", "fwfp"].includes(doc.doc_type) || doc.tier === "archive" || doc.visibility === "private") return error("only a plan (not archived, not private) is read in");
          let row = d.tables.plan_import_requests.find((r) => r.document_id === doc.id && r.status === "requested");
          if (!row) {
            const me = d.tables.profiles?.[0];
            row = { id: d.tables.plan_import_requests.length + 1, farm_id: doc.farm_id, document_id: doc.id, requested_by: d.user.id, requested_by_name: me?.display_name || "Demo advisor",
              requested_at: d.asAt + "T09:30:00+13:00", status: "requested", note: null, closed_at: null, closed_by: null };
            d.tables.plan_import_requests.push(row);
          }
          return result(row);
        }
        // ON1, as public.onboarding_report_inputs: the demo farm's own records, and invented public context.
        if (name === "onboarding_report_inputs") return result(onboardingInputs(d, args.f));
        // ON3d, as public.farm_onboarding_sync, and public.proposals_decide for one of the farm's rows (the group demo's are ON3b's below).
        if (name === "farm_onboarding_sync") return result(...farmChecksSync(d, args?.f));
        if (name === "proposals_decide" && d.tables.proposals.some((p) => p.id === args?.id && p.farm_id)) return result(...farmDecide(d, args));
        // B4b, as public.sync_entry_edit: applied on the version it was made on, else kept as a conflict; once per edit id.
        if (name === "sync_entry_edit") {
          const e = d.tables.entries.find((x) => x.id === args.p_entry);
          if (!e) return result(null, { code: "42501", message: "That entry is not available to edit" });
          d.syncOps = d.syncOps || {};
          if (!d.syncOps[args.p_op]) {
            if ((e.updated_at || null) === (args.p_base || null)) { e.body = args.p_body; e.updated_at = new Date().toISOString(); d.syncOps[args.p_op] = "applied"; }
            else d.syncOps[args.p_op] = "conflict";
          }
          return result(d.syncOps[args.p_op]);
        }
        // WQ2, as public.monitoring_location and public.monitoring_location_series over the invented location: each member's
        // results within its dates (the demo's members do not overlap) and the window asked for (p_from / p_to, NZ dates, inclusive),
        // oldest first, each with its site
        if (name === "monitoring_location") {
          const ls = wqOf(d).locations || [];
          return result(ls.find((l) => args.p_location != null ? l.id === args.p_location : l.members.some((m) => m.monitoring_site_id === args.p_site)) || null);
        }
        if (name === "monitoring_location_series") {
          const l = (wqOf(d).locations || []).find((x) => x.id === args.p_location);
          const nz = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date(t));
          return result(!l ? [] : l.members.filter((m) => m.monitoring_site_id != null).flatMap((m) => (wqOf(d).series[m.monitoring_site_id + "|" + args.p_parameter] || [])
            .filter((r) => (!m.valid_from || nz(r.sampled_at) >= m.valid_from) && (!m.valid_to || nz(r.sampled_at) <= m.valid_to)
              && (!args.p_from || nz(r.sampled_at) >= args.p_from) && (!args.p_to || nz(r.sampled_at) <= args.p_to)).map((r) => ({ ...r, site_id: m.monitoring_site_id })))
            .sort((a, b) => a.sampled_at.localeCompare(b.sampled_at)));
        }
        if (name === "measurement_series") {
          const from = args.from_time ? Date.parse(args.from_time) : -Infinity, to = args.to_time ? Date.parse(args.to_time) : Infinity;
          return result((wqOf(d).series[args.site + "|" + args.parameter_key] || []).filter((r) => Date.parse(r.sampled_at) >= from && Date.parse(r.sampled_at) < to));
        }
        // DQ1, as public.group_load_gaps: the invented group's gaps for staff (the demo's advisor); a farmer is in no group.
        // The demo group's open_proposals is counted from its proposals now (ON3a: open gaps with an open proposal), so a decision shows.
        if (name === "group_load_gaps") return result(d.tables.profiles[0]?.is_staff ? (d.loadGaps || []).filter((g) => !args?.group_id || g.group_id === args.group_id).map((g) => {
          if (g.group_id !== GROUP || !d.groupTables?.proposals) return g;
          const open = {};
          for (const p of d.groupTables.proposals) if (["proposed", "ambiguous"].includes(p.status) && p.subject?.gap_kind && /^member_(match_file|match_paddock|extent)$/.test(p.kind)) open[p.subject.gap_kind] = (open[p.subject.gap_kind] || 0) + 1;
          return { ...g, open_proposals: open };
        }) : []);
        // EV1, as public.ai_ratchet_evaluation: invented counts for the demo's advisor (staff only), the same for any period.
        if (name === "ai_ratchet_evaluation") return d.tables.profiles[0]?.is_staff && d.ratchet ? result(d.ratchet) : error("The AI evaluation is for RCL staff");
        // MC3, as public.onboarding_effort_rollup: invented numbers for the demo's advisor (staff only), the same for any period.
        if (name === "onboarding_effort_rollup") return d.tables.profiles[0]?.is_staff && d.onboardingEffort ? result(d.onboardingEffort) : error("The onboarding effort rollup is for RCL staff");
        return error("This operation is not available in the demo");
      },
      // The demo never sends invitations or saves changes; Ask answers from the fixture, the way the Ask function replies.
      functions: { invoke: async (name, options) => {
        if (name === "ask") return result(askReply((await ready).ask, options?.body?.question));
        // MC1: the analysis function's previews for the group's standing answer (invented figures; preview only, nothing stored)
        if (name === "analysis") { const r = demoAnalysis(await ready, options?.body); return r ? result({ preview: r }) : error("Water-quality analysis isn't available yet."); }
        if (name === "consent-conditions") { const r = demoConditions(await ready, options?.body); return r ? result(r) : error("You can fetch the conditions only of a consent on a farm you edit, whose conditions aren't recorded yet."); }
        return error("The demo does not save changes");
      } },
      // Every document opens the one stand-in page (DEC1b: a file the group holds, under demo/held/, the stand-in PDF a card frames);
      // the demo's photo points name the one stand-in picture.
      storage: { from: () => ({ createSignedUrl: async (path) => result({ signedUrl: new URL(path === PHOTO ? PHOTO : String(path).startsWith("demo/held/") && String(path).endsWith(".pdf") ? "demo/source.pdf" : "demo/source.html", typeof location === "undefined" ? "http://localhost/" : location.href).href }),
        upload: async (path) => result({ path }) }) },
    };
  }
  return { FARM, FARM2, USER, ORG, GROUP, MEMBERS, levelOf, groupRpc, proposalsRpc, GROUP_MEMBERS, queueOf, wqOf, wqLatest, askReply, isRoute, isSparse, isFarmer, isMulti, isGroup, routeHash, href, dataset, client };
});
