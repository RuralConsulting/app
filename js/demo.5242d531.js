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
    // V6: "?simple=client" (not staff), "staff" or "unreadable" (the staff flag can't be read) before the hash turns the simple view on in the demo
    // (PF1: "facilitator", a client who is the group's facilitator)
    const simple = new URLSearchParams(root.location.search).get("simple");
    // N2b: "?groupsites=none" makes the demo group one the old model has no area for (an MCCC sub-group): group_wq_sites is empty
    const groupSites = new URLSearchParams(root.location.search).get("groupsites");
    // UI2: "?groupmap=none" makes the demo group one with nothing in the older map model (an MCCC group): its Overview has no map
    // of its own, only its published map under Maps
    const groupMap = new URLSearchParams(root.location.search).get("groupmap");
    // LK2: the first batch of layer looks (tools/looks/first_batch.json, copied by build.sh), held as proposed looks; optional
    const looks = active ? fetch("demo/looks-first-batch.json").then((r) => (r.ok ? r.json() : null), () => null) : null;
    const ready = active ? Promise.all([fetch("demo/demo-farm.json").then((r) => {
      if (!r.ok) throw new Error("Demo fixture unavailable. Build the app before opening the demo.");
      return r.json();
    }), looks]).then(([fixture, batch]) => api.dataset(fixture, { sparse, farmer, multi, group, queue, looks: batch, simple, groupSites, groupMap })) : null;
    root.FP.demo = { ...api, active, sparse, farmer, group, simple: active ? simple : null, href: (h) => api.href(h, sparse, farmer, multi, group, queue), ready, client: active ? api.client(ready) : null };
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
  const VIEWS = /^$|^\/(home|maps|ask|create|documents|people|onboarding)$/;
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
      if (suffix === "/privacy") return "#/privacy";   // V8: the privacy and terms note
      // LK2: the staff page for layer looks, with the group's map at group scale
      if (suffix === "/ops/looks") return "#/ops/looks";
      // ON3b: ".../manage" and its tabs are the group's manage space
      if (suffix === "/maps") return "#/group/" + GROUP + "/maps" + (/[?&]item=[0-9a-f-]{36}/.exec(hash)?.[0].replace("&", "?") || "");   // V4
      return /^(?:\/(?:home|documents|events|people(?:\/(?:log|follow-ups|add-person|add-contact|review))?|create|settings|manage(?:\/(?:members|gaps|updates|sites|settings))?))?$/.test(suffix) ? "#/group/" + GROUP + suffix : null;
    }
    const [path, query] = hash.replace(/^#\/demo\/(empty|farmer|multi)(?=\/|\?|$)/, "#/demo").split("?");
    let suffix = path.slice("#/demo".length), farm = FARM;
    if (suffix === "/") suffix = "";
    if (suffix === "/farms") return "";
    if (suffix === "/privacy") return "#/privacy";              // V8: the privacy and terms note, in any demo
    if (suffix === "/layers") return "#/layers";                  // Layer notes (LN2): the same screen for advisors and farm editors
    if (suffix === "/account/qgis" && !multi) return "#/account/qgis";   // the person's access keys for QGIS (QGIS1a)
    if (suffix === "/ops" && !multi) return "#/ops";            // the staff Operations page
    if (suffix === "/ops/layers" && !multi) return "#/ops/layers";   // and its Layers page (advisor notes)
    if (suffix === "/ops/looks" && !multi) return "#/ops/looks";     // and its Looks page (LK2)
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
    if (hash === "#/privacy") return group ? "#/demo/group/privacy" : "#/demo" + (multi ? "/multi" : sparse ? "/empty" : farmer ? "/farmer" : "") + "/privacy";
    if (hash === "#/account/qgis") return "#/demo/account/qgis";
    if (hash === "#/ops/layers") return "#/demo/ops/layers";
    if (hash === "#/ops/looks") return group ? "#/demo/group/ops/looks" + (queue ? "?queue=" + queue : "") : "#/demo/ops/looks";
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
  // LK2: the first batch of looks as tools/seed_looks.py proposes them (shared looks, proposed, in the demo advisor's name), and
  // invented reference features for the staff page's pictures only (demo_looks_reference: no other screen asks for them, so no
  // farm's or group's map changes). Nothing here is real.
  const LOOK_ID = (i) => "de000000-0000-4000-8000-00000000c" + String(i + 1).padStart(3, "0");
  function looksRows(batch) {
    return (batch?.looks || []).map((x, i) => ({ id: LOOK_ID(i), layer_id: null, source_key: x.record.source_key || null, theme: x.record.theme || null,
      classify_by: x.record.classify_by || null, classes: copy(x.record.classes || []), symbol: copy(x.record.symbol || {}), label_field: x.record.label_field || null,
      label_min_zoom: x.record.label_min_zoom ?? null, min_zoom: x.record.min_zoom ?? null, max_zoom: x.record.max_zoom ?? null, purpose: x.record.purpose || null,
      status: "proposed", proposed_by: USER, proposed_at: "2026-11-07T01:00:00.000000+00:00", updated_at: "2026-11-07T01:00:" + String(i).padStart(2, "0") + ".123456+00:00",
      reviewed_by: null, reviewed_at: null, superseded_at: null, superseded_by: null, returned_note: null, returned_by: null, returned_at: null }));
  }
  function looksReference(extent) {
    const [[w, s], , [e, n]] = extent.coordinates[0], f = (id, geometry, properties) => ({ type: "Feature", id, geometry, properties: { in_area: true, on_farm: true, authorisations: [], ...properties } });
    const pt = (fx, fy) => ({ type: "Point", coordinates: [w + (e - w) * fx, s + (n - s) * fy] });
    const box = (a, b, c, d) => polygon(w + (e - w) * a, s + (n - s) * b, w + (e - w) * c, s + (n - s) * d);
    const entry = (key, name, theme, features) => ({ key, name, theme, attribution: "Invented for the demo.", replaces_in_extent: [], features: collection(features) });
    return [
      // (with the fields the production sources hold: the PM's samples, 7 Nov 2026)
      entry("ecan-wq-sites", "Surface water quality sites (ECan)", "monitoring_sites", [f(71001, pt(.47, .55), { SITE_NAME: "Demo Creek at the farm bridge (synthetic)", SITE_ID: "SYN-WQ1" }),
        f(71002, pt(.52, .4), { SITE_NAME: "Demo Drain at the culvert (synthetic)", SITE_ID: "SYN-WQ2" })]),
      entry("ecan-consents", "Resource consents (ECan)", "consents", [f(71011, pt(.45, .52), { ConsentNo: "CRC000101", ConsentType: "Water Permit (s14)", ConsentStatus: "Issued - Active" }),
        f(71012, pt(.55, .48), { ConsentNo: "CRC000102", ConsentType: "Discharge Permit (s15)", ConsentStatus: "Issued - Active" }),
        f(71013, pt(.5, .58), { ConsentNo: "CRC000103", ConsentType: "Land Use Consent (s9)", ConsentStatus: "Issued - Active" })]),
      entry("ecan-wells", "Wells and bores (ECan)", "wells", [f(71021, pt(.48, .46), { external_id: "SYN/W1", USE_CODE_1_DESC: "Irrigation", DEPTH: 42 }),
        f(71022, pt(.53, .53), { external_id: "SYN/W2", USE_CODE_1_DESC: "Domestic and Stockwater", DEPTH: 18 })]),
      entry("ecan-lri", "Land Resource Inventory and LUC, Canterbury (NZLRI via ECan)", "luc", [f(71031, box(0, 0, .5, 1), { LUC_CLASS: "3", lcorrunit: "3s 1 (synthetic)" }),
        f(71032, box(.5, 0, 1, 1), { LUC_CLASS: "6", lcorrunit: "6e 2 (synthetic)" })]),
      entry("gns-qmap-250k-geology", "Geological map of New Zealand 1:250,000, geological units (GNS)", "geology", [f(71041, box(0, 0, 1, .5), { rockclass: "gravel", simplename: "Demo gravels (synthetic)" }),
        f(71042, box(0, .5, 1, 1), { rockclass: "loess", simplename: "Demo loess (synthetic)" })]),
      // registered with nothing loaded, as S-map is in production: an empty read (the demo has no S-map sources row, so the
      // page says "none near"; with the source's own count of 0 it says "no data loaded yet")
      { ...entry("smap", "S-map soils (Manaaki Whenua)", "soils", []), feature_count: 0 },
      entry("ecan-nutrient-zones", "LWRP nutrient allocation zones (ECan)", "zones", [f(71061, polygon(171.9, -43.1, 172.2, -42.9), { ZONE_NAME: "Invented nutrient zone (synthetic)", ZONE_CLASS: "Green" })]),
    ];
  }
  // V4: invented published maps: two for the farm (the list; none on the almost-empty farm, the message) and one for the group (opens at once)
  function demoMaps(data, sparse) {
    const row = (id, owner, slug, title, kind) => ({ id: "de000000-0000-4000-8000-00000000d00" + id, farm_id: null, org_id: null, ...owner, slug, title, description: "An invented map for the demo.", kind, archived_at: null });
    const maps = [...(sparse ? [] : [row(1, { farm_id: FARM }, "farm-map", "Farm map (synthetic)", "Farm plan"), row(2, { farm_id: FARM }, "soils", "Soils (synthetic)", "Land")]), row(3, { org_id: GROUP }, "catchment", "Catchment map (synthetic)", "Catchment")];
    const manifest = { bounds: [172, -43, 172.025, -42.98], boundary: "boundary.geojson", files: ["boundary.geojson"], layers: [] };
    data.tables.published_maps = maps;
    data.tables.map_packages = maps.map((m) => ({ map_id: m.id, version: "1", manifest, storage_prefix: (m.farm_id || "org/" + m.org_id) + "/demo", is_current: true, published_at: "2026-11-01T00:00:00Z" }));
  }
  function dataset(fixture, { sparse = false, farmer = false, multi = false, group = false, queue = null, looks = null, simple = null, groupSites = null, groupMap = null } = {}) {
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
    // LK2: the first batch, proposed (served to no map: layer_styles_for_map serves reviewed looks only), and the staff page's
    // invented reference for its pictures
    data.tables.layer_styles = looksRows(looks);
    // QGIS1a: the demo person's access keys for QGIS (invented: one in use, one revoked); a key made here is the demo's own
    data.tables.personal_access_tokens = [
      { id: "de000000-0000-4000-8000-0000000000a1", user_id: USER, name: "QGIS on the office PC", token_hint: "fpat_3f9c", created_at: "2026-11-02T21:10:00Z",
        expires_at: "2027-01-31T21:10:00Z", last_used_at: "2026-11-08T23:40:00Z", revoked_at: null },
      { id: "de000000-0000-4000-8000-0000000000a2", user_id: USER, name: "Old laptop", token_hint: "fpat_71e0", created_at: "2026-10-20T02:00:00Z",
        expires_at: "2026-11-19T02:00:00Z", last_used_at: "2026-10-28T04:15:00Z", revoked_at: "2026-11-01T19:30:00Z" },
    ];
    data.looksReference = looksReference(extent);
    if (sparse) {
      farm.name = "Example farm — almost empty";
      data.map = { ...map, farm: { id: FARM, name: farm.name, region: farm.region }, titles: collection([]), land_units: collection([]), layers: [] };
      data.tables.documents = []; data.tables.authorisations = []; data.tables.obligations = [];
      data.tables.checks = []; data.tables.entries = []; data.tables.entry_links = [];
      data.ask = [];
      data.wqEmpty = true;   // no titles, so no monitoring site is near
    }
    if (group) groupDemo(data, queue);
    demoMaps(data, sparse);
    if (farmer) {
      data.tables.farm_members[0].role = "owner"; data.tables.org_members = [];
      data.user.email = "farmer@example.test";
      data.tables.profiles = [{ user_id: USER, is_staff: false }]; data.tables.ops_job_status = []; data.tables.ops_reference_status = [];
      data.tables.ai_recipes = (f.ops.recipes || []).filter((r) => r.status === "approved");   // what a farmer can read
    }
    data.groupSitesNone = groupSites === "none";
    data.groupMapNone = groupMap === "none";
    if (simple === "client" || simple === "unreadable") {
      data.tables.profiles = [{ user_id: USER, is_staff: false }];
      for (const m of data.groupTables?.org_members || []) m.role = "member";
      if (simple === "unreadable") delete data.tables.profiles;
    }
    // PF1: "?simple=facilitator": a client (not staff) who is the group's facilitator, as a catchment group's coordinator signs in
    if (simple === "facilitator") {
      data.tables.profiles = [{ user_id: USER, is_staff: false }];
      for (const m of data.groupTables?.org_members || []) m.role = "facilitator";
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
      multiGroups(data);
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
  // LP1: the two-farm demo's person also belongs to three invented catchment groups, so the home map has farms and groups on
  // it: a parent group and one of its sub-groups, each with an area place (its geometry in NZTM metres, as the places table holds
  // it; the parent's outline has many points, as a real catchment's does), and a group with no area yet (found by search and
  // the list only). The groups' own spaces are not part of this demo.
  const MULTI_GROUPS = [
    { id: "de000000-0000-4000-8000-0000000003b1", name: "Example Collective (synthetic)", parent: null, area: { at: [172.33, -42.88], r: 0.42, points: 1500 } },
    { id: "de000000-0000-4000-8000-0000000003b2", name: "North Sub-group (synthetic)", parent: "de000000-0000-4000-8000-0000000003b1", area: { at: [172.63, -42.77], r: 0.06, points: 120 } },
    { id: "de000000-0000-4000-8000-0000000003b3", name: "Another Landcare Group (synthetic)", parent: null, area: null },
  ];
  function multiGroups(data) {
    // a wobbly ring round a centre (an illustration, not a catchment), in NZTM metres; made when first read (wq-model.js, which
    // converts, may load after the fixture does)
    const ring = ({ at: [x, y], r, points }) => {
      const W = typeof module === "object" && module.exports ? require("./wq-model.js") : globalThis.FP.wqModel, out = [];
      for (let i = 0; i < points; i++) {
        const a = (2 * Math.PI * i) / points, k = r * (1 + 0.12 * Math.sin(5 * a) + 0.04 * Math.sin(37 * a));
        out.push(W.lngLatToNztm(x + k * Math.cos(a) * 1.35, y + k * Math.sin(a)).map((v) => Math.round(v * 10) / 10));
      }
      return [...out, out[0]];
    };
    for (const g of MULTI_GROUPS) {
      data.tables.organisations.push({ id: g.id, name: g.name, slug: null, kind: "catchment_group", parent_org_id: g.parent });
      data.tables.org_members.push({ org_id: g.id, user_id: USER, role: "member" });
      if (!g.area) continue;
      const row = { id: g.id.slice(0, -3) + "a" + g.id.slice(-2), org_id: g.id, farm_id: null, kind: "area", code: null, name: g.name + " area", valid_to: null };
      let geom = null;
      Object.defineProperty(row, "geom", { enumerable: true, get: () => (geom ||= { type: "MultiPolygon", coordinates: [[ring(g.area)]] }) });
      data.tables.places.push(row);
    }
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
    eventsDemo(data);
    peopleDemo(data);
  }
  // N4: the group's events (public.group_events) and attendance (public.group_event_attendees), invented: past and coming ones
  // around the fixture's date (29 Oct 2026), one all-day on the day daylight saving starts, one cancelled, one with a macron and
  // a comma in its place. Saved in memory only. group_event_people stands in for the editors' picker (names, no emails).
  function eventsDemo(data) {
    const id = (n) => "de000000-0000-4000-8000-0000000004" + String(n).padStart(2, "0"), made = "2026-09-01T00:00:00Z";
    const ev = (n, title, starts_at, ends_at, extra = {}) => ({ id: id(n), org_id: GROUP, title, starts_at, ends_at, all_day: false, place_name: null, latitude: null, longitude: null,
      topics: [], notes: null, head_count: null, cancelled_at: null, cancelled_by: null, created_by: USER, created_at: made, updated_at: made, ...extra });
    data.tables.group_events = [
      ev(1, "Planting day at the wetland (synthetic)", "2026-09-26T12:00:00Z", "2026-09-27T11:00:00Z", { all_day: true, place_name: "Wetland reserve, Waimā Road", latitude: -43.0101, longitude: 172.0402,
        topics: ["Riparian planting", "Biodiversity"], notes: "300 flax and carex planted along the margin.\nThanks to everyone who came.", head_count: 22 }),
      ev(2, "Committee meeting (synthetic)", "2026-10-07T06:00:00Z", "2026-10-07T08:00:00Z", { place_name: "Community hall", topics: ["Committee"], head_count: 9 }),
      ev(3, "Field day at the ford (synthetic)", "2026-10-13T21:00:00Z", "2026-10-14T00:00:00Z", { place_name: "The ford, Ford Road", latitude: -43.0012, longitude: 172.0518,
        topics: ["Water quality", "Riparian planting"], notes: "Walked the creek with the facilitator; looked at the new fencing and the sampling sites." }),
      ev(4, "Water sampling workshop (synthetic)", "2026-10-21T20:30:00Z", "2026-10-21T23:30:00Z", { place_name: "Sampling site 2", topics: ["Water quality"], cancelled_at: "2026-10-18T02:00:00Z", cancelled_by: USER,
        notes: "Postponed: the creek was in flood." }),
      ev(5, "Committee meeting (synthetic)", "2026-11-04T06:00:00Z", "2026-11-04T08:00:00Z", { place_name: "Community hall", topics: ["Committee"] }),
      ev(6, "Nitrogen budgeting evening (synthetic)", "2026-11-11T06:30:00Z", "2026-11-11T08:30:00Z", { place_name: "Rugby club rooms, Main Street", topics: ["Nutrients", "Farm plans"] }),
      ev(7, "Catchment open day (synthetic)", "2026-11-20T11:00:00Z", "2026-11-22T11:00:00Z", { all_day: true, place_name: "Across the catchment", topics: ["Biodiversity", "Water quality"] }),
    ];
    data.tables.group_event_attendees = [
      { id: id(51), event_id: id(3), org_id: GROUP, user_id: USER, group_member_id: null, name: "Demo advisor", note: "Facilitator", added_at: made },
      { id: id(52), event_id: id(3), org_id: GROUP, user_id: null, group_member_id: GROUP_MEMBERS[0].id, name: GROUP_MEMBERS[0].business_name, note: null, added_at: made },
      { id: id(53), event_id: id(3), org_id: GROUP, user_id: null, group_member_id: GROUP_MEMBERS[2].id, name: GROUP_MEMBERS[2].business_name, note: null, added_at: made },
      { id: id(54), event_id: id(3), org_id: GROUP, user_id: null, group_member_id: null, name: "Aroha Tāne (synthetic)", note: "Regional council, land management", added_at: made },
      { id: id(55), event_id: id(2), org_id: GROUP, user_id: null, group_member_id: null, name: "Pat Example (synthetic)", note: "Chair", added_at: made },
    ];
    data.eventPeople = [{ user_id: USER, name: "Demo advisor", role: "admin" }, { user_id: "de000000-0000-4000-8000-000000000499", name: "Mere Example (synthetic)", role: "member" }];
  }
  // PE1: the group's people, the people at its businesses, more about some businesses and an interaction log with follow-ups
  // (public.people, group_member_people, group_member_details, interactions, interaction_links), all invented, around the
  // fixture's date (29 Oct 2026): one follow-up due, one coming, one done, one cancelled entry, one imported call. Saved in memory.
  function peopleDemo(data) {
    const pid = (n) => "de000000-0000-4000-8000-0000000005" + String(n).padStart(2, "0"), iid = (n) => "de000000-0000-4000-8000-0000000006" + String(n).padStart(2, "0");
    const B = (n) => GROUP_MEMBERS[n - 1].id, made = "2026-08-01T00:00:00Z", OTHER = "de000000-0000-4000-8000-000000000499";
    const person = (n, given, family, extra = {}) => ({ id: pid(n), org_id: GROUP, given_name: given, family_name: family, display_name: given + " " + family, job_title: null, emails: [], phones: [],
      postal_address: null, physical_address: null, notes: null, user_id: null, source: "manual", external_id: null, archived_at: null, archived_by: null, created_by: USER, created_at: made, updated_by: USER, updated_at: made, ...extra });
    data.tables.people = [
      person(1, "Aroha", "Example (synthetic)", { job_title: "Owner and director", emails: ["aroha@example.invalid"], phones: ["021 000 0101"], physical_address: "12 Invented Road, Example Valley" }),
      person(2, "Ben", "Sample (synthetic)", { job_title: "Farm manager", phones: ["027 000 0102"] }),
      person(3, "Cara", "Placeholder (synthetic)", { job_title: "Accounts", emails: ["accounts@bravo.example.invalid"] }),
      person(4, "Dan", "Fictional (synthetic)", { emails: ["dan@example.invalid"], phones: ["03 000 0104"], source: "apptivo", external_id: "C-104", created_by: null }),
      person(5, "Eru", "Madeup (synthetic)", { job_title: "Sharemilker" }),
      person(6, "Fern", "Notreal (synthetic)", { archived_at: "2026-06-30T00:00:00Z", archived_by: USER, notes: "Sold up and left the catchment." }),
      person(7, "Hemi", "Invented (synthetic)", { job_title: "Committee chair", phones: ["021 000 0107"] }),
    ];
    const link = (n, b, p, relationship, extra = {}) => ({ id: pid(50 + n), org_id: GROUP, group_member_id: B(b), person_id: pid(p), relationship, is_primary: false, started_on: null, ended_on: null,
      source: "manual", external_id: null, created_by: USER, created_at: made, updated_by: USER, updated_at: made, ...extra });
    data.tables.group_member_people = [link(1, 1, 1, "owner", { is_primary: true }), link(2, 1, 2, "manager"), link(3, 2, 3, "accounts", { is_primary: true }), link(4, 3, 4, "owner", { is_primary: true }),
      link(5, 4, 5, "sharemilker"), link(6, 5, 6, "owner", { ended_on: "2026-06-30" }), link(7, 6, 7, "owner", { is_primary: true }), link(8, 2, 1, "contact")];
    const details = (b, extra) => ({ group_member_id: B(b), org_id: GROUP, trading_name: null, emails: [], phones: [], postal_address: null, physical_address: null, labels: [], status: null, notes: null,
      source: "manual", external_id: null, created_by: USER, created_at: made, updated_by: USER, updated_at: made, ...extra });
    data.tables.group_member_details = [
      details(1, { trading_name: "Alpha Downs (synthetic)", labels: ["Dairy", "Riparian"], emails: ["office@alpha.example.invalid"], phones: ["03 000 0001"], postal_address: "PO Box 1, Example Town", status: "Active" }),
      details(2, { labels: ["Sheep and beef"], status: "Active" }),
      details(3, { labels: ["Dairy", "Committee"], status: "Active", source: "apptivo", external_id: "9003", created_by: null }),
      details(6, { labels: ["Sheep and beef", "Committee"], status: "Active" })];
    const act = (n, kind, direction, happened_at, extra = {}) => ({ id: iid(n), org_id: GROUP, kind, direction, happened_at, duration_minutes: null, subject: null, summary: null, follow_up_on: null,
      follow_up_done_at: null, follow_up_done_by: null, topics: [], logged_by: USER, on_behalf_of: null, source: "manual", external_id: null, cancelled_at: null, cancelled_by: null, created_at: happened_at, updated_by: USER, updated_at: happened_at, ...extra });
    data.tables.interactions = [
      act(1, "call", "outgoing", "2026-10-28T01:30:00Z", { duration_minutes: 15, subject: "Fencing grant application", summary: "Talked through the grant form. Aroha will send the fencing quote by Friday.", follow_up_on: "2026-10-27", topics: ["Fencing", "Grants"] }),
      act(2, "visit", "none", "2026-10-21T22:00:00Z", { duration_minutes: 90, subject: "Farm walk with the facilitator", summary: "Walked the creek margin; looked at the new planting and two crossing points.\nAgreed to look at a culvert in spring.", follow_up_on: "2026-11-10", topics: ["FEP", "Riparian planting"] }),
      act(3, "email", "incoming", "2026-10-15T03:12:00Z", { subject: "Accounts query", summary: "Asked for a copy of the membership invoice.", follow_up_on: "2026-10-20", follow_up_done_at: "2026-10-19T21:00:00Z", follow_up_done_by: USER }),
      act(4, "meeting", "none", "2026-10-07T06:00:00Z", { duration_minutes: 120, subject: "Committee meeting", summary: "Spring planting order agreed." }),
      act(5, "call", "incoming", "2026-09-30T20:45:00Z", { duration_minutes: 5, subject: "Missed water sampling day", logged_by: null, on_behalf_of: "Pat Coordinator (synthetic)", source: "apptivo", external_id: "7002" }),
      act(6, "note", "none", "2026-09-12T02:00:00Z", { subject: "Wrong member", summary: "Logged against the wrong member.", cancelled_at: "2026-09-12T03:00:00Z", cancelled_by: USER }),
      act(7, "message", "outgoing", "2026-10-29T00:10:00Z", { subject: "Reminder: field day", summary: "Texted a reminder about the field day at the ford.", logged_by: OTHER }),
    ];
    const L = (n, i, k, id) => ({ id: iid(50 + n), interaction_id: iid(i), org_id: GROUP, group_member_id: k === "b" ? B(id) : null, person_id: k === "p" ? pid(id) : null, event_id: k === "e" ? id : null, added_by: USER, added_at: made });
    data.tables.interaction_links = [L(1, 1, "b", 1), L(2, 1, "p", 1), L(3, 2, "b", 1), L(4, 2, "p", 2), L(5, 3, "b", 2), L(6, 3, "p", 3), L(7, 4, "b", 6), L(8, 4, "p", 7), L(9, 4, "e", "de000000-0000-4000-8000-000000000402"),
      L(10, 5, "b", 3), L(11, 5, "p", 4), L(12, 6, "b", 4), L(13, 7, "b", 4), L(14, 7, "p", 5)];
    data.crmTeam = [{ user_id: USER, name: "Demo advisor", role: "admin" }, { user_id: OTHER, name: "Mere Example (synthetic)", role: "facilitator" }];
    // SG2: two invented sub-groups of the group and which of its businesses are in them (public.subgroup_businesses); the demo's
    // person is a member of the first. Member 1 is in both; member 3 left the second.
    const sg = (n, sub, b, extra = {}) => ({ id: "de000000-0000-4000-8000-0000000007" + String(n).padStart(2, "0"), org_id: sub, parent_org_id: GROUP, group_member_id: B(b),
      joined_on: null, left_on: null, note: null, source: "gis", external_id: null, created_by: null, created_at: made, updated_by: null, updated_at: made, ...extra });
    data.tables.subgroup_businesses = [sg(1, SUBGROUPS[0].id, 1, { joined_on: "2025-04-01" }), sg(2, SUBGROUPS[0].id, 2), sg(3, SUBGROUPS[1].id, 1, { source: "apptivo" }),
      sg(4, SUBGROUPS[1].id, 3, { joined_on: "2024-01-01", left_on: "2025-06-30", source: "manual" })];
    // M1b: the group's membership types, each member's terms (member 2 changed type; India left), the group's own fields with some
    // values (one a choice no longer offered), and one other contact (a council officer, linked to no member). All invented.
    const mid = (k, n) => "de000000-0000-4000-8000-000000000" + k + String(n).padStart(2, "0");
    data.tables.group_membership_types = ["Full", "Associate", "Community"].map((name, i) => ({ id: mid(8, i + 1), org_id: GROUP, name, sort_order: i + 1, archived_at: null }));
    const term = (n, b, type, joined_on, left_on = null, note = null) => ({ id: mid(8, 10 + n), org_id: GROUP, group_member_id: B(b), membership_type_id: mid(8, type), joined_on, left_on, note, source: "manual" });
    data.tables.group_member_terms = [term(1, 1, 1, "2019-04-01"), term(2, 2, 2, "2018-02-01", "2024-07-01"), term(3, 2, 1, "2024-07-01"), term(4, 3, 1, "2020-09-15"), term(5, 4, 3, null),
      term(6, 5, 1, "2021-03-01"), term(7, 6, 2, "2022-05-10"), term(8, 7, 1, null), term(9, 8, 3, "2023-01-20"), term(10, 9, 1, "2016-06-01", "2025-06-30", "Sold the farm (synthetic)")];
    const fieldDef = (n, key, label, kind, extra = {}) => ({ id: mid(9, n), org_id: GROUP, key, label, kind, choices: [], sort_order: n, shown_in_list: false, archived_at: null, ...extra });
    data.tables.group_fields = [fieldDef(1, "farm_plan", "Farm plan status", "choice", { choices: ["Draft", "Final"] }), fieldDef(2, "nzfap", "NZFAP", "tick"),
      fieldDef(3, "fep_due", "FEP due", "date"), fieldDef(4, "plan_note", "Plan note", "text")];
    const val = (n, b, f, v) => ({ id: mid(9, 20 + n), org_id: GROUP, group_member_id: B(b), field_id: mid(9, f), value: v });
    data.tables.group_member_field_values = [val(1, 1, 1, "Final"), val(2, 1, 2, true), val(3, 1, 3, "2027-03-31"), val(4, 2, 1, "Draft"), val(5, 3, 1, "Awaiting audit"), val(6, 3, 2, true),
      val(7, 4, 2, false), val(8, 6, 1, "Draft"), val(9, 6, 3, "2026-12-01")];
    data.tables.people.push(person(8, "Iris", "Council (synthetic)", { job_title: "Land management advisor", organisation_name: "Regional council (synthetic)", contact_kind: "council", emails: ["iris@council.example.invalid"] }));
    // M2: the group's subscription years and agreements, some members' subscriptions (paid, invoiced and unpaid, not required) and
    // agreements (one signed, no copy attached yet). All invented.
    data.tables.group_subscription_years = [{ id: mid("e", 1), org_id: GROUP, label: "2025/26", default_amount: 150, archived_at: null }, { id: mid("e", 2), org_id: GROUP, label: "2026/27", default_amount: 160, archived_at: null }];
    data.tables.group_agreements = [{ id: mid("e", 11), org_id: GROUP, name: "Membership form", sort_order: 1, archived_at: null }, { id: mid("e", 12), org_id: GROUP, name: "Data sharing agreement", sort_order: 2, archived_at: null }];
    const subRow = (n, b, y, extra) => ({ id: mid("e", 20 + n), org_id: GROUP, group_member_id: B(b), year_id: mid("e", y), amount: null, invoiced_on: null, invoice_ref: null, paid_on: null, not_required: false, note: null, updated_at: made, ...extra });
    data.tables.group_member_subscriptions = [subRow(1, 1, 1, { amount: 150, invoiced_on: "2025-07-01", invoice_ref: "INV-0101", paid_on: "2025-07-20" }), subRow(2, 2, 1, { amount: 150, invoiced_on: "2025-07-01", paid_on: "2025-08-04" }),
      subRow(3, 3, 1, { amount: 150, invoiced_on: "2025-07-01", invoice_ref: "INV-0103" }), subRow(4, 1, 2, { amount: 160, invoiced_on: "2026-07-01", invoice_ref: "INV-0201" }),
      subRow(5, 6, 2, { not_required: true, note: "Life member (synthetic)" })];
    data.tables.group_member_agreements = [{ id: mid("e", 40), org_id: GROUP, group_member_id: B(1), agreement_id: mid("e", 11), signed_on: "2024-04-01", signed_by: "Aroha Example (synthetic)", note: null, document_id: null, updated_at: made }];
    // RV1: questions about the register for the group's advisers to come back to (public.proposals of kind register_review, as
    // tools/load_review_items.py writes them), beside the farm's proposals so Manage's counts and queue are as before. Invented.
    const answers = (...pairs) => [...pairs.map(([action, label]) => ({ action, label })), { action: "other", label: "Something else" }, { action: "not_needed", label: "Not needed" }];
    const ask = (id, key, subject, evidence, candidates, created_at, extra = {}) => ({ id, farm_id: null, org_id: GROUP, kind: "register_review", subject, subject_key: "register:" + key,
      document_id: null, evidence, candidates, status: "proposed", decision: null, decided_by: null, decided_at: null, method_version: "load_review_items v1",
      run_id: "de000000-0000-4000-8000-000000000a07", created_at, applied_at: null, outcome: null, superseded_by: null, proposed_by: null, ...extra });
    data.tables.proposals = [...(data.tables.proposals || []),
      ask(201, "split-hill-block", { topic: "Block split between three owners (synthetic)", question: "The hill block was split into three titles in 2025. Which of the three owners are members of the group? (synthetic)",
        member_numbers: ["3", "5"], place: { lon: 172.689, lat: -42.881 }, ref: "register-check:split:1" },
        ["Title split recorded in 2025 (synthetic)", "Two of the three owners are on the register: members 3 and 5 (synthetic)", "The third owner is not on the register (synthetic)"],
        answers(["all_three", "All three are members"], ["two_on_register", "Only the two on the register"], ["ask_owner", "Ask the third owner to join"]), "2026-10-27T21:00:00Z"),
      ask(202, "company-also-member", { topic: "Company is also another member (synthetic)", question: "Bravo Invented Ltd also appears as member 2's parent company. Does the land under member 9 belong with member 2? (synthetic)",
        member_numbers: ["2", "9"] },
        { "register name": "Bravo Invented Ltd (synthetic)", "same address": true, "shared blocks": 2 },
        answers(["belongs_to_2", "Yes: the land belongs with member 2"], ["separate", "No: they are separate members"]), "2026-10-26T21:00:00Z"),
      ask(203, "no-apptivo-4-42", { topic: "No Apptivo record (synthetic)", question: "Members 4 and 42 have no record in Apptivo. Are they still members? (synthetic)",
        member_numbers: ["4", "42"] }, ["Not found in the Apptivo export of Nov 2026 (synthetic)"],
        answers(["both_current", "Both are current members"], ["left", "They have left"]), "2026-10-25T21:00:00Z"),
      ask(204, "inside-6-7", { topic: "Block inside another member's blocks (synthetic)", question: "Member 7's block sits wholly inside member 6's blocks. Is it the same farm? (synthetic)",
        member_numbers: ["6", "7"], place: { lon: 172.702, lat: -42.874 } }, ["Member 7's block: 12 ha, inside member 6's 340 ha (synthetic)"],
        answers(["same_farm", "Yes: the same farm"], ["lease", "No: member 7 leases it"]), "2026-10-20T21:00:00Z",
        { status: "accepted", decision: { candidate: { action: "lease", label: "No: member 7 leases it" }, chosen_from: "candidates", note: "Confirmed with the owner at the field day (synthetic)", action: "lease", answer: null },
          decided_by: OTHER, decided_at: "2026-10-22T02:00:00Z" })];
  }
  // SG2: the invented sub-groups of "HDLG (example)" (not among the demo person's own groups: their spaces are not part of the demo).
  const SUBGROUPS = [{ id: "de000000-0000-4000-8000-0000000003c1", name: "Ford Creek sub-group (synthetic)", slug: "demo-ford-creek", member: true },
    { id: "de000000-0000-4000-8000-0000000003c2", name: "Hill Country sub-group (synthetic)", slug: "demo-hill-country", member: false }];
  // SG2, as public.subgroup_counts, business_subgroups and subgroup_business_list: for the group's members (any role), as the
  // database answers them; anyone else gets no rows. [data, error], or null for a name it does not know.
  function subgroupRpc(d, name, args) {
    const role = d.groupTables?.org_members.find((m) => m.org_id === GROUP && m.user_id === USER)?.role, rows = d.tables.subgroup_businesses || [];
    const register = d.groupTables?.group_members || [], sub = (id) => SUBGROUPS.find((s) => s.id === id);
    if (!["subgroup_counts", "business_subgroups", "subgroup_business_list"].includes(name)) return null;
    if (!role) return [[]];
    if (name === "subgroup_counts") return [args.parent_org !== GROUP ? [] : SUBGROUPS.map((s) => ({ subgroup_id: s.id, subgroup_name: s.name, subgroup_slug: s.slug,
      current_businesses: rows.filter((r) => r.org_id === s.id && !r.left_on).length, is_member: s.member })).sort((a, b) => a.subgroup_name.localeCompare(b.subgroup_name))];
    if (name === "business_subgroups") return [rows.filter((r) => r.group_member_id === args.b && sub(r.org_id)).map((r) => ({ id: r.id, subgroup_id: r.org_id, subgroup_name: sub(r.org_id).name,
      subgroup_slug: sub(r.org_id).slug, joined_on: r.joined_on, left_on: r.left_on, note: r.note, source: r.source, is_member: sub(r.org_id).member }))];
    return [rows.filter((r) => r.org_id === args.sub_org).map((r) => ({ r, b: register.find((x) => x.id === r.group_member_id) })).filter((x) => x.b)
      .map(({ r, b }) => ({ member_number: b.member_number, business_name: b.business_name, joined_on: r.joined_on, left_on: r.left_on }))];
  }
  // RV1, as public.register_review_answer: the group's facilitators, advisors and admins answer an open item (one of its answers;
  // "other" with the typed answer; "not_needed" sets it aside); recorded in memory only, nothing else changes. [data, error].
  function reviewAnswer(d, args) {
    const role = d.groupTables?.org_members.find((m) => m.org_id === GROUP && m.user_id === USER)?.role;
    const row = (d.tables.proposals || []).find((p) => p.id === args.id && p.kind === "register_review");
    const refuse = (message) => [null, { message }];
    if (!row || !["admin", "advisor", "facilitator"].includes(role)) return refuse("review item " + args.id + " is not open for you to answer");
    if (row.status !== "proposed") return refuse("review item " + args.id + " is already answered");
    const action = String(args.action || "").trim(), answer = String(args.answer || "").trim() || null, note = String(args.note || "").trim() || null;
    if (action === "not_needed") {
      if (answer) return refuse("\"Not needed\" takes no typed answer: say why in the note");
      Object.assign(row, { status: "rejected", decision: { candidate: null, note, action, answer: null } });
    } else {
      const chosen = row.candidates.find((c) => c.action === action);
      if (!chosen) return refuse("that is not one of this item's answers");
      if (action === "other" && !answer) return refuse("type the answer for \"Other\"");
      if (action !== "other" && answer) return refuse("only \"Other\" takes a typed answer: use the note");
      Object.assign(row, { status: "accepted", decision: { candidate: chosen, chosen_from: "candidates", note, action, answer } });
    }
    Object.assign(row, { decided_by: USER, decided_at: new Date().toISOString() });
    return [row];
  }
  // M1b: a member's values of the list and filter fields ({key: value}), as crm_directory gives them.
  function listValues(T, b) {
    const out = {};
    for (const v of (T.group_member_field_values || []).filter((x) => x.group_member_id === b && x.value != null && x.value !== "")) {
      const f = (T.group_fields || []).find((x) => x.id === v.field_id);
      if (f && !f.archived_at && (f.shown_in_list || f.kind !== "text")) out[f.key] = v.value;
    }
    return out;
  }
  // M2: a subscription row's status, as the database derives it (no row: not invoiced), and a member's {year id: status}.
  const subStatus = (s) => (!s ? "not_invoiced" : s.paid_on ? "paid" : s.not_required ? "not_required" : s.invoiced_on ? "invoiced" : "not_invoiced");
  const subValues = (T, b) => Object.fromEntries((T.group_member_subscriptions || []).filter((s) => s.group_member_id === b).map((s) => [s.year_id, subStatus(s)]));
  // M2, as crm_subscriptions_agreements, crm_save_subscription, crm_mark_subscriptions and crm_save_member_agreement (the caller is
  // one of the group's facilitators, advisors or admins: crmRpc checked), with the same refusals as the database's guards.
  function subscriptionsRpc(d, name, args, k) {
    const T = d.tables, refuse = (message) => [null, { message }], reg = d.groupTables?.group_members || [];
    const years = T.group_subscription_years || (T.group_subscription_years = []), ags = T.group_agreements || (T.group_agreements = []);
    const subs = T.group_member_subscriptions || (T.group_member_subscriptions = []), mags = T.group_member_agreements || (T.group_member_agreements = []);
    const now = new Date().toISOString(), docs = () => [...(T.documents || []), ...(d.groupTables?.documents || [])];
    if (name === "crm_subscriptions_agreements") {
      const b = k.byBusiness(args.b);
      if (!b) return [null];
      const has = (key, id, list) => list.some((x) => x[key] === id && x.group_member_id === b.id);
      return [{ group_member_id: b.id,
        subscriptions: years.filter((y) => !y.archived_at || has("year_id", y.id, subs)).sort((x, y) => y.label.toLowerCase().localeCompare(x.label.toLowerCase())).map((y) => {
          const s = subs.find((x) => x.year_id === y.id && x.group_member_id === b.id);
          return { year_id: y.id, label: y.label, default_amount: y.default_amount ?? null, archived: !!y.archived_at, id: s?.id ?? null, amount: s?.amount ?? null, invoiced_on: s?.invoiced_on ?? null,
            invoice_ref: s?.invoice_ref ?? null, paid_on: s?.paid_on ?? null, not_required: !!s?.not_required, note: s?.note ?? null, status: subStatus(s), updated_at: s?.updated_at ?? null };
        }),
        agreements: ags.filter((a) => !a.archived_at || has("agreement_id", a.id, mags)).sort((x, y) => (x.sort_order - y.sort_order) || x.name.toLowerCase().localeCompare(y.name.toLowerCase())).map((a) => {
          const x = mags.find((r) => r.agreement_id === a.id && r.group_member_id === b.id), doc = x?.document_id ? docs().find((dd) => dd.id === x.document_id) : null;
          return { agreement_id: a.id, name: a.name, archived: !!a.archived_at, id: x?.id ?? null, signed_on: x?.signed_on ?? null, signed_by: x?.signed_by ?? null, note: x?.note ?? null,
            document_id: x?.document_id ?? null, document: doc ? { id: doc.id, title: doc.title, original_name: doc.original_name ?? null, storage_path: doc.storage_path ?? null, mime_type: doc.mime_type ?? null } : null,
            updated_at: x?.updated_at ?? null };
        }) }];
    }
    if (name === "crm_save_subscription") {
      const b = k.byBusiness(args.b), y = years.find((x) => x.id === args.yr);
      if (!b) return refuse("Only the group's facilitators, advisors and admins record subscriptions");
      if (!y) return refuse("That subscription year is not this member's group's");
      let s = subs.find((x) => x.group_member_id === b.id && x.year_id === y.id);
      if (!s && y.archived_at) return refuse("That subscription year is archived");
      if (args.not_required && args.paid_on) return refuse("new row for relation \"group_member_subscriptions\" violates check constraint \"group_member_subscriptions_paid_or_not_required\"");
      const tidy = (v) => (v == null ? null : String(v).trim().replace(/\s+/g, " ") || null);
      if (!s) { s = { id: "demo-new-" + ++made, org_id: GROUP, group_member_id: b.id, year_id: y.id }; subs.push(s); }
      Object.assign(s, { amount: args.amount ?? null, invoiced_on: args.invoiced_on || null, invoice_ref: tidy(args.invoice_ref), paid_on: args.paid_on || null, not_required: !!args.not_required,
        note: args.note == null ? null : String(args.note).trim() || null, updated_at: now });
      return [s.id];
    }
    if (name === "crm_mark_subscriptions") {
      if (!["invoiced", "paid"].includes(args.what)) return refuse("Mark them invoiced or paid");
      const y = years.find((x) => x.id === args.yr && x.org_id === args.g && !x.archived_at);
      if (!y) return refuse("That subscription year is not one of this group's open years");
      const day = args.on_date || k.today, key = args.what === "invoiced" ? "invoiced_on" : "paid_on";
      let n = 0;
      for (const b of reg.filter((x) => (args.ids || []).includes(x.id))) {
        let s = subs.find((x) => x.group_member_id === b.id && x.year_id === y.id);
        if (s && (s.not_required || s[key])) continue;
        if (!s) { s = { id: "demo-new-" + ++made, org_id: GROUP, group_member_id: b.id, year_id: y.id, amount: null, invoiced_on: null, invoice_ref: null, paid_on: null, not_required: false, note: null }; subs.push(s); }
        Object.assign(s, { [key]: day, amount: s.amount ?? y.default_amount ?? null, updated_at: now });
        n++;
      }
      return [n];
    }
    if (name === "crm_save_member_agreement") {
      const b = k.byBusiness(args.b), a = ags.find((x) => x.id === args.agreement);
      if (!b) return refuse("Only the group's facilitators, advisors and admins record agreements");
      if (!a) return refuse("That agreement is not this member's group's");
      let x = mags.find((r) => r.group_member_id === b.id && r.agreement_id === a.id);
      if (!x && a.archived_at) return refuse("That agreement is archived");
      if (args.document && args.document !== x?.document_id) {
        const doc = docs().find((dd) => dd.id === args.document);
        if (!doc || doc.org_id !== GROUP || doc.visibility !== "held" || doc.group_member_id !== b.id) return refuse("The signed copy must be a file the group holds for this member");
      }
      if (!x) { x = { id: "demo-new-" + ++made, org_id: GROUP, group_member_id: b.id, agreement_id: a.id }; mags.push(x); }
      Object.assign(x, { signed_on: args.signed_on || null, signed_by: args.signed_by == null ? null : String(args.signed_by).trim().replace(/\s+/g, " ") || null,
        note: args.note == null ? null : String(args.note).trim() || null, document_id: args.document || null, updated_at: now });
      return [x.id];
    }
    return null;
  }
  // M1b, as crm_membership, crm_contacts, crm_email_list and the membership writes (the caller is one of the group's facilitators,
  // advisors or admins: crmRpc checked). Ending and reopening a membership: its admins only, as the database's guard says.
  function membershipRpc(d, name, args, k) {
    const T = d.tables, terms = T.group_member_terms || (T.group_member_terms = []), typeName = (id) => (T.group_membership_types || []).find((t) => t.id === id)?.name || null;
    const now = new Date().toISOString(), day = (x) => x || k.today, refuse = (message) => [null, { message }];
    const reg = d.groupTables?.group_members || [];
    if (name === "crm_membership") {
      const b = k.byBusiness(args.b);
      if (!b) return [null];
      const ts = terms.filter((t) => t.group_member_id === b.id).sort((x, y) => (!!x.left_on - !!y.left_on) || String(y.left_on || "").localeCompare(String(x.left_on || "")) || String(y.joined_on || "").localeCompare(String(x.joined_on || "")));
      return [{ group_member_id: b.id, ended_at: b.ended_at,
        terms: ts.map((t) => ({ id: t.id, membership_type_id: t.membership_type_id, type: typeName(t.membership_type_id), joined_on: t.joined_on, left_on: t.left_on, current: !t.left_on, note: t.note, source: t.source })),
        fields: (T.group_fields || []).filter((f) => !f.archived_at).sort((a, b2) => a.sort_order - b2.sort_order).map((f) => {
          const v = (T.group_member_field_values || []).find((x) => x.group_member_id === b.id && x.field_id === f.id);
          return { field_id: f.id, key: f.key, label: f.label, kind: f.kind, choices: f.choices, shown_in_list: f.shown_in_list, value: v?.value ?? null,
            orphaned: f.kind === "choice" && v?.value != null && !f.choices.includes(v.value) };
        }) }];
    }
    if (name === "crm_contacts") {
      const linked = new Set(T.group_member_people.filter(k.current).map((l) => l.person_id));
      return [T.people.filter((p) => !linked.has(p.id)).sort((a, b) => (!!a.archived_at - !!b.archived_at) || a.display_name.localeCompare(b.display_name)).map((p) => ({ person_id: p.id, display_name: p.display_name,
        job_title: p.job_title, organisation_name: p.organisation_name || null, contact_kind: p.contact_kind || null, emails: p.emails, phones: p.phones, archived_at: p.archived_at, source: p.source,
        last_interaction_at: k.withLink("person_id", p.id).filter((i) => !i.cancelled_at).sort(k.newest)[0]?.happened_at || null }))];
    }
    if (name === "crm_email_list") {
      const ids = args.filter?.ids || reg.map((b) => b.id), sub = args.filter?.subscription;   // M2: the subscription filter
      const subOk = (b) => !sub?.year || !(sub.status || []).length || sub.status.includes(subStatus((T.group_member_subscriptions || []).find((s) => s.group_member_id === b.id && s.year_id === sub.year)));
      return [reg.filter((b) => ids.includes(b.id) && subOk(b)).map((b) => {
        const here = T.group_member_people.filter((l) => l.group_member_id === b.id && k.current(l)).map((l) => ({ l, p: k.byPerson(l.person_id) })).filter((x) => !x.p.archived_at)
          .sort((x, y) => (y.l.is_primary - x.l.is_primary) || x.p.display_name.localeCompare(y.p.display_name))[0];
        return { group_member_id: b.id, member_number: b.member_number, business_name: b.business_name, primary_name: here?.p.display_name || null, emails: here?.p.emails || [],
          business_emails: T.group_member_details.find((x) => x.group_member_id === b.id)?.emails || [] };
      })];
    }
    if (name === "crm_set_field_value") {
      const f = (T.group_fields || []).find((x) => x.id === args.field), v = String(args.value ?? "").trim();
      if (!f || !k.byBusiness(args.b)) return refuse("That field is not this group's");
      if (f.archived_at) return refuse("That field is archived");
      const value = v === "" ? null : f.kind === "tick" ? v === "true" : f.kind === "choice" ? f.choices.find((c) => c.toLowerCase() === v.toLowerCase()) : v;
      if (f.kind === "choice" && v && !value) return refuse("That is not one of the field's choices");
      const rows = T.group_member_field_values || (T.group_member_field_values = []), have = rows.find((x) => x.group_member_id === args.b && x.field_id === f.id);
      if (have) have.value = value; else rows.push({ id: "demo-new-" + ++made, org_id: GROUP, group_member_id: args.b, field_id: f.id, value });
      return [have?.id || rows.at(-1).id];
    }
    if (name === "crm_change_membership_type" || name === "crm_reopen_membership" || name === "crm_end_membership") {
      const b = reg.find((x) => x.id === args.b), cur = terms.find((t) => t.group_member_id === args.b && !t.left_on);
      if (!b) return refuse("No such member");
      if (name === "crm_end_membership") {
        if (k.role !== "admin") return refuse("Only the group's admins end a membership (the member leaves the register); change its type instead");
        if (!cur) return refuse("This member has no current membership to end");
        Object.assign(cur, { left_on: day(args.on_date), note: [cur.note, args.reason].filter(Boolean).join("\n") || null });
        b.ended_at = b.ended_at || cur.left_on + "T00:00:00+13:00";
        return [cur.id];
      }
      if (name === "crm_reopen_membership") {
        if (k.role !== "admin") return refuse("Only the group's admins reopen a membership (the member comes back on the register)");
        b.ended_at = null;
      } else if (b.ended_at && !cur) return refuse("That member has left the register: reopen its membership instead");
      if (cur && cur.membership_type_id === args.type_id) return [cur.id];
      if (cur) cur.left_on = day(args.on_date);
      const t = { id: "demo-new-" + ++made, org_id: GROUP, group_member_id: b.id, membership_type_id: args.type_id, joined_on: day(args.on_date), left_on: null, note: null, source: "manual", created_at: now };
      terms.push(t);
      return [t.id];
    }
    return null;
  }
  // PE1, as the crm_* read functions and crm_save_interaction: the group's facilitators, advisors and admins only (anyone else gets
  // no rows or null), bounded as the database bounds them. Returns [data, error], or null for a name it does not know.
  function crmRpc(d, name, args) {
    const T = d.tables, role = d.groupTables?.org_members.find((m) => m.org_id === GROUP && m.user_id === USER)?.role, today = String(d.asAt).slice(0, 10);
    const allowed = ["facilitator", "advisor", "admin"].includes(role);
    const register = d.groupTables?.group_members || [], current = (l) => !l.ended_on || l.ended_on > today;
    const byBusiness = (id) => register.find((b) => b.id === id), byPerson = (id) => (T.people || []).find((p) => p.id === id);
    const linksOf = (iid) => T.interaction_links.filter((k) => k.interaction_id === iid).map((k) => {
      const b = byBusiness(k.group_member_id), p = byPerson(k.person_id), e = (T.group_events || []).find((x) => x.id === k.event_id);
      return { id: k.id, kind: k.group_member_id ? "business" : k.person_id ? "person" : "event", group_member_id: k.group_member_id, person_id: k.person_id, event_id: k.event_id,
        name: b?.business_name || p?.display_name || e?.title || null, member_number: b?.member_number || null };
    });
    const json = (i) => ({ ...i, links: linksOf(i.id) });
    const newest = (a, b) => String(b.happened_at).localeCompare(String(a.happened_at));
    const withLink = (key, id) => T.interactions.filter((i) => T.interaction_links.some((k) => k.interaction_id === i.id && k[key] === id));
    const open = (i) => !!i.follow_up_on && !i.follow_up_done_at && !i.cancelled_at;
    if (!T.people) return name === "crm_business" || name === "crm_person" || name === "crm_feed_count" || name === "crm_membership" ? [null] : [[]];
    // M1b: the membership types are read by any member of the group (the defaults are already there in the demo)
    if (name === "crm_membership_types") return [role && args.g === GROUP ? [...(T.group_membership_types || [])].sort((a, b) => (!!a.archived_at - !!b.archived_at) || a.sort_order - b.sort_order) : []];
    if (["crm_directory", "crm_people", "crm_feed", "crm_team", "crm_contacts", "crm_email_list"].includes(name) && (!allowed || args.g !== GROUP)) return [[]];
    if (["crm_business", "crm_person", "crm_feed_count", "crm_membership", "crm_subscriptions_agreements"].includes(name) && !allowed) return [null];
    // M2: the writes refused for anyone else, as the database refuses them
    if (["crm_save_subscription", "crm_mark_subscriptions", "crm_save_member_agreement"].includes(name) && (!allowed || (args.g && args.g !== GROUP))) return [null, { message: "Only the group's facilitators, advisors and admins record subscriptions and agreements" }];
    const m1 = membershipRpc(d, name, args, { today, current, byBusiness, byPerson, withLink, newest, allowed, role });
    if (m1) return m1;
    const m2 = subscriptionsRpc(d, name, args, { today, byBusiness });
    if (m2) return m2;
    if (name === "crm_directory") {
      return [[...register].sort((a, b) => (!!a.ended_at - !!b.ended_at) || a.business_name.localeCompare(b.business_name)).slice(0, args.max_rows ?? 2000).map((b) => {
        const dt = T.group_member_details.find((x) => x.group_member_id === b.id);
        const here = T.group_member_people.filter((l) => l.group_member_id === b.id && current(l)).map((l) => ({ l, p: byPerson(l.person_id) })).filter((x) => !x.p.archived_at);
        const first = [...here].sort((x, y) => (y.l.is_primary - x.l.is_primary) || x.p.display_name.localeCompare(y.p.display_name))[0];
        const its = withLink("group_member_id", b.id);
        const cur = (T.group_member_terms || []).find((t) => t.group_member_id === b.id && !t.left_on);   // M1b
        return { group_member_id: b.id, member_number: b.member_number, business_name: b.business_name, ended_at: b.ended_at, trading_name: dt?.trading_name || null, labels: dt?.labels || [], status: dt?.status || null,
          primary_person_id: first?.p.id || null, primary_name: first?.p.display_name || null, people_names: here.map((x) => x.p.display_name).sort(), people_count: here.length,
          last_interaction_at: its.filter((i) => !i.cancelled_at).sort(newest)[0]?.happened_at || null, open_follow_ups: its.filter(open).length, due_follow_ups: its.filter((i) => open(i) && i.follow_up_on <= today).length,
          membership_type: cur ? (T.group_membership_types || []).find((t) => t.id === cur.membership_type_id)?.name || null : null, joined_on: cur?.joined_on || null, fields: listValues(T, b.id), subscriptions: subValues(T, b.id) };
      })];
    }
    if (name === "crm_people") {
      return [[...T.people].sort((a, b) => (!!a.archived_at - !!b.archived_at) || a.display_name.localeCompare(b.display_name)).slice(0, args.max_rows ?? 2000).map((p) => {
        const its = withLink("person_id", p.id);
        return { person_id: p.id, display_name: p.display_name, given_name: p.given_name, family_name: p.family_name, job_title: p.job_title, emails: p.emails, phones: p.phones, has_sign_in: !!p.user_id,
          archived_at: p.archived_at, source: p.source, last_interaction_at: its.filter((i) => !i.cancelled_at).sort(newest)[0]?.happened_at || null, open_follow_ups: its.filter(open).length,
          businesses: T.group_member_people.filter((l) => l.person_id === p.id && current(l)).map((l) => ({ group_member_id: l.group_member_id, business_name: byBusiness(l.group_member_id)?.business_name,
            member_number: byBusiness(l.group_member_id)?.member_number, relationship: l.relationship, is_primary: l.is_primary })) };
      })];
    }
    if (name === "crm_business") {
      const b = byBusiness(args.b);
      if (!b) return [null];
      const its = withLink("group_member_id", b.id).sort(newest);
      return [{ business: { id: b.id, org_id: GROUP, member_number: b.member_number, business_name: b.business_name, ended_at: b.ended_at },
        details: T.group_member_details.find((x) => x.group_member_id === b.id) || null,
        people: T.group_member_people.filter((l) => l.group_member_id === b.id).map((l) => { const p = byPerson(l.person_id); return { link_id: l.id, person_id: p.id, display_name: p.display_name, job_title: p.job_title,
          emails: p.emails, phones: p.phones, relationship: l.relationship, is_primary: l.is_primary, started_on: l.started_on, ended_on: l.ended_on, current: current(l), archived: !!p.archived_at }; })
          .sort((x, y) => (!x.current - !y.current) || (y.is_primary - x.is_primary) || x.display_name.localeCompare(y.display_name)),
        interactions_total: its.length, interactions: its.slice(0, 200).map(json), held_files: b.member_number === "1" ? 2 : 0 }];
    }
    if (name === "crm_person") {
      const p = byPerson(args.p);
      if (!p) return [null];
      const its = withLink("person_id", p.id).sort(newest);
      return [{ person: p, businesses: T.group_member_people.filter((l) => l.person_id === p.id).map((l) => ({ link_id: l.id, group_member_id: l.group_member_id, business_name: byBusiness(l.group_member_id)?.business_name,
        member_number: byBusiness(l.group_member_id)?.member_number, relationship: l.relationship, is_primary: l.is_primary, started_on: l.started_on, ended_on: l.ended_on, current: current(l) })),
        interactions_total: its.length, interactions: its.slice(0, 200).map(json) }];
    }
    if (name === "crm_feed" || name === "crm_feed_count") {
      if (args.g !== GROUP) return [name === "crm_feed" ? [] : null];
      const has = (i, key, id) => T.interaction_links.some((k) => k.interaction_id === i.id && k[key] === id);
      let list = T.interactions.filter((i) => (!args.kinds?.length || args.kinds.includes(i.kind)) && (!args.from_at || Date.parse(i.happened_at) >= Date.parse(args.from_at))
        && (!args.to_at || Date.parse(i.happened_at) < Date.parse(args.to_at)) && (!args.business || has(i, "group_member_id", args.business)) && (!args.person || has(i, "person_id", args.person))
        && (!args.logger || i.logged_by === args.logger) && (args.with_cancelled || !i.cancelled_at)
        && (!args.topic || (i.topics || []).some((t) => t.toLowerCase() === String(args.topic).toLowerCase()))
        && (!args.follow_up || (args.follow_up === "open" && open(i)) || (args.follow_up === "due" && open(i) && i.follow_up_on <= today) || (args.follow_up === "done" && !!i.follow_up_done_at)));
      if (name === "crm_feed_count") return [list.length];
      list = list.sort((a, b) => (["open", "due"].includes(args.follow_up) ? String(a.follow_up_on).localeCompare(String(b.follow_up_on)) : 0) || newest(a, b));
      const from = args.row_offset || 0;
      return [list.slice(from, from + Math.min(args.max_rows ?? 200, 1000)).map(json)];
    }
    if (name === "crm_team") return [d.crmTeam || []];
    if (name === "crm_save_interaction") {
      if (!allowed || args.g !== GROUP) return [null, { message: "Only the organisation's facilitators, advisors and admins log interactions" }];
      const f = args.fields || {}, at = new Date().toISOString();
      let row = args.interaction ? T.interactions.find((i) => i.id === args.interaction) : null;
      if (args.interaction && !row) return [null, { message: "No such interaction" }];
      if (row?.cancelled_at) return [null, { message: "A cancelled interaction cannot be changed: restore it first" }];
      if (!row) { row = { id: "demo-new-" + ++made, org_id: GROUP, logged_by: USER, source: "manual", external_id: null, cancelled_at: null, follow_up_done_at: null, created_at: at, on_behalf_of: null }; T.interactions.push(row); }
      Object.assign(row, { kind: f.kind, direction: f.direction || "none", happened_at: f.happened_at, duration_minutes: f.duration_minutes ?? null, subject: f.subject || null, summary: f.summary || null,
        follow_up_on: f.follow_up_on || null, topics: Array.isArray(f.topics) ? f.topics : [], updated_at: at });
      const want = (args.links || []).map((l) => ({ group_member_id: l.group_member_id || null, person_id: l.person_id || null, event_id: l.event_id || null }));
      const same = (k, l) => k.group_member_id === l.group_member_id && k.person_id === l.person_id && k.event_id === l.event_id;
      T.interaction_links = T.interaction_links.filter((k) => k.interaction_id !== row.id || want.some((l) => same(k, l)));
      for (const l of want) if (!T.interaction_links.some((k) => k.interaction_id === row.id && same(k, l))) T.interaction_links.push({ id: "demo-new-" + ++made, interaction_id: row.id, org_id: GROUP, ...l, added_by: USER, added_at: at });
      return [row.id];
    }
    return null;
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
  // DEC1c: a grouped proposal as tools/reconcile_group.py writes it: four held paddocks (no member id, or the placeholder 999) that lie
  // inside member 1's block (Alpha; MEMBERS[0]'s box), each with its share inside, shape and area. Invented shapes and numbers.
  function paddockGroup(id) {
    const [w, s] = [172.034, -43.002], dx = 0.0035, dy = 0.0028;
    const cells = [[0, 0, 1.0, null, 9.8], [1, 0, 0.97, "999", 10.1], [0, 1, 1.0, null, 9.7], [2, 1, 0.93, null, 8.9]];
    const paddocks = cells.map(([i, j, share, given, ha], k) => {
      const a = w + i * dx * 1.3, b = s + j * dy * 1.3, fid = String(2101 + k);
      return { item_key: PADDOCKS + "#" + fid, fid, id_given: given, names: { PadkName: "Paddock " + fid + " (synthetic)" }, area_ha: ha, share, envelope: false,
        geometry: { type: "Polygon", coordinates: [[[a, b], [a + dx, b], [a + dx, b + dy], [a, b + dy], [a, b]]] } };
    });
    const items = paddocks.map((p) => ({ item_key: p.item_key, gap_id: null, item_sha256: "0".repeat(60) + p.fid, external_id: p.id_given, share: p.share }));
    const m = GROUP_MEMBERS[0];
    const cand = { member: "1", business_name: m.business_name, confidence: 0.93, signals: ["member_blocks"],
      evidence: [{ signal: "member_blocks", paddocks: 4, share_min: 0.9, least_share: 0.93, from: "the paddocks' shapes against the member's blocks in the group's member-blocks layer" }] };
    return { id, org_id: GROUP, farm_id: null, kind: "member_match_paddock_group", subject_key: "paddock_group:" + PADDOCKS + ":1:0000demo0116",
      subject: { gap_kind: "paddock_held", source_file: PADDOCKS, member: "1", part: 1, parts: 1, count: 4, items },
      evidence: { set_aside_because: "held back from the map with no member id; it lies inside one member's blocks", lines: ["  (the reconcile summary's lines for this group, invented)"],
        identity: { kind: "paddock_group", member: "1", business_name: m.business_name, source_file: PADDOCKS, count: 4, share_min: 0.9, least_share: 0.93,
          bbox: [w, s, w + 2 * dx * 1.3 + dx, s + dy * 1.3 + dy], area_ha: 38.5, crs: "EPSG:4326", paddocks },
        test: { share_min: 0.9, method: "reconcile_group/DEC1c-2026-11-07", rule: "the share of the paddock's area inside the member's blocks" } },
      candidates: [cand], status: "proposed", decision: null, decided_by: null, decided_at: null, applied_at: null, outcome: null, document_id: null,
      method_version: "reconcile_group/DEC1c-2026-11-07", run_id: "de000000-0000-4000-8000-000000000a03", created_at: "2026-11-07T03:00:00Z" };
  }
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
    t.monitoring_location_sites.push({ location_id: 9301, site_id: 9101 }, { location_id: 9301, site_id: 9107 },
      // WQ9: the gorge location (ECan's DEMO-03 and the NRWQN-like DEMO-03N): the Sites tab says what the second dataset holds
      { location_id: 9302, site_id: 9103 }, { location_id: 9302, site_id: 9109 });
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
        none(115, "FarmData/Scan 0042 (synthetic).pdf", null), paddockGroup(116)];
      t.proposals.find((p) => p.id === 102).document_id = HELD_DOC;
      t.documents.push({ id: HELD_DOC, org_id: GROUP, farm_id: null, title: "Charlie plan final (synthetic).pdf", doc_type: "fep", tier: "archive", storage_path: "demo/held/charlie-plan-final.pdf",
        created_at: "2026-11-06T02:00:00Z", visibility: "farm" });
      Object.assign(mine, { counts: { fep_unmatched: 5, paddock_held: 5, member_no_extent: 0 }, items: mine.items.filter((i) => i.kind === "fep_unmatched") });
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
      if (!/^member_match_(file|paddock|paddock_group)$/.test(p.kind)) return [null, { message: "only a member match (a set-aside file or paddock) takes a member from the group's register" }];
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
    // DEC3, as migration 20261109020000: "something else" on a rejection only, of the row's kind's shape (app.proposal_other_problem)
    let other = null;
    if (args.other != null) {
      if (args.status !== "rejected") return [null, { message: "something else is recorded as set aside (rejected), naming no member" }];
      const DC = typeof module === "object" && module.exports ? require("./decision-card-model.js") : globalThis.FP.decisionCardModel;
      const why = DC.otherProblem(p, args.other, note || "");
      if (why) return [null, { message: "something else: " + why }];
      other = { reason: args.other.reason, ...(args.other.outcome ? { outcome: args.other.outcome } : {}) };
    }
    Object.assign(p, { status: args.status, decision: { candidate: copy(chosen), note, ...(from ? { chosen_from: from } : {}), ...(Array.isArray(args.viewed) && args.viewed.length ? { viewed: copy(args.viewed) } : {}),
      ...(other ? { other } : {}) }, decided_by: USER, decided_at: new Date().toISOString() });
    return [p];
  }
  function groupRpc(d, name, args) {
    const g = d.group, level = (m) => levelOf(g.setting, m.share), detail = (m) => ["anonymous", "named"].includes(level(m));
    const shown = () => MEMBERS.filter(detail);
    const farmId = (id) => { const m = MEMBERS.find((x) => x.id === id); return m && detail(m) ? id : null; };
    if (!g || (args.g ?? args.group_id) !== GROUP) return ["group_map", "group_member_summary", "group_readiness"].includes(name) ? [null] : [[]];
    if (name === "group_map" && d.groupMapNone) return [null];   // UI2: a group with no older map (?groupmap=none)
    if (name === "group_member_farms") return [shown().map((m) => ({ farm_ref: m.id, name: level(m) === "named" ? m.name : null, level: level(m), extent: polygon(...m.box), area_ha: m.area_ha }))];
    if (name === "group_shared_entries") return [g.shared.map((e) => ({ id: e.id, farm_id: farmId(e.farm), record_type: e.record_type, captured_at: e.captured_at, period_start: null, period_end: null,
      location: e.location, body: e.body, data: null, tags: [] })).sort((a, b) => b.captured_at.localeCompare(a.captured_at))];
    if (name === "group_shared_documents") return [g.sharedDocs.map(({ farm, ...x }) => ({ ...x, farm_id: farmId(farm) }))];
    if (name === "set_group_member_detail") {
      if (d.groupTables?.org_members.find((m) => m.org_id === GROUP && m.user_id === USER)?.role !== "admin") return [null, { message: "Only an admin of this catchment group can change how its member farms are shown" }];
      g.setting = args.level; return [null];
    }
    if (name === "group_wq_sites") return [d.groupSitesNone ? [] : wqOf(d).sites.filter((x) => !x.owner_farm_id)];
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
      { id: "demo-g-l1", name: "Catchment boundary (synthetic)", theme: "catchments", geometry_type: "polygon", group_own: true, epistemic_class: "observation", source: "the group's own map", features: fc([feature(g.area, { name: "HDLG catchment (synthetic)" })]) },
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
      layer("demo-g-l1", "Catchment boundary (synthetic)", "catchments", [f(g.area, { name: "HDLG catchment (synthetic)" }, 39999)]),
      layer("demo-g-l2", "Member blocks (synthetic)", "member_blocks", blocks, { deferred: true }),
      layer("demo-g-l3", "Paddocks (synthetic)", "paddocks", paddocks, { deferred: true }),
      layer("demo-g-l4", "Farm plan: land management units (synthetic)", "land_units", lmu, { deferred: true }),
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
  const KEPT = ["checks", "documents", "entries", "entry_links", "entry_files", "layer_notes", "group_events", "group_event_attendees",   // N4: the group's events
    "people", "group_member_people", "group_member_details",   // PE1: the group's people
    "subgroup_businesses",   // SG2: a business added to a sub-group
    "group_fields", "group_membership_types",   // M1b: a field or type added by the group's admin
    "group_subscription_years", "group_agreements"];   // M2: a year or agreement added by the group's admin
  const EDITED = ["layer_notes", "farm_parcels", "group_events", "group_event_attendees", "people", "group_member_people", "group_member_details", "interactions",
    "subgroup_businesses",   // SG2: ended
    "group_fields", "group_membership_types",   // M1b: renamed, reordered, archived
    "group_subscription_years", "group_agreements"];   // M2: changed, archived   // and the tables whose rows the demo changes (the Layers page; a new block's note)
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
        downstream: { starts: 2, reaches: [{ name: "Example Stream (synthetic)", cum_km: 0.8 }, { name: "Example River (synthetic)", cum_km: 7.4 }], max_km: 50, end_reasons: ["max_km"],
          // ONB2b: each start's route (one down Example Stream, one straight into Example River further down)
          chains: [{ start: 9100001, catchment_area: 14.2, end_reason: "max_km", max_km: 50, reaches: [{ name: "Example Stream (synthetic)", cum_km: 0.8 }, { name: "Example River (synthetic)", cum_km: 7.4 }] },
            { start: 9100002, catchment_area: 3.1, end_reason: "max_km", max_km: 50, reaches: [{ name: "Example River (synthetic)", cum_km: 9.2 }] }], chains_more: 0 },
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
  // GE1b, as public.feature_edit_shape and public.feature_restore_version (GE1a) over the demo's features that carry ids (the
  // group's layers read in parts, the farm's paddock grid): the checks on the feature first (who may edit the layer, the version
  // opened), then the shape; a save keeps the replaced shape as an earlier version (map_feature_versions) and changes the
  // feature in memory, so every later read draws it. d.shapes.refuse (one save) and d.shapes.refuseProbe (until cleared) let
  // the screenshots show a refusal. map_features and map_feature_versions are read as the editor reads them (id, version_no).
  const shapeState = (d) => d.shapes || (d.shapes = { version: new Map(), kept: [], next: 1, refuse: null, refuseProbe: null });
  function shapeFeatures(d) {
    const out = [];
    if (d.group?.parts) for (const l of groupPartsLayers(d)) for (const f of l.all) out.push({ f, layer: l.id, owner: "group" });
    if (d.farmParts) for (const f of farmPartsData(d).paddocks) out.push({ f, layer: FARM_PADDOCKS, owner: "farm" });
    return out;
  }
  function shapeRows(d, table) {
    const st = shapeState(d);
    if (table === "map_feature_versions") return st.kept;
    return shapeFeatures(d).map(({ f, layer }) => ({ id: f.id, layer_id: layer, version_no: st.version.get(f.id) || 1 }));
  }
  function shapeEdit(d, name, args) {
    const B = typeof module === "object" && module.exports ? require("./block-model.js") : globalThis.FP.blockModel;
    const st = shapeState(d), id = Number(args.feature);
    if (args.layer == null || args.feature == null) return [null, { code: "22023", message: "Name the layer and the feature to edit" }];
    const t = shapeFeatures(d).find((x) => x.layer === args.layer && x.f.id === id);
    if (!t) return [null, { code: "P0002", message: "No such feature in this layer" }];
    const role = t.owner === "group" ? d.groupTables?.org_members.find((m) => m.org_id === GROUP && m.user_id === USER)?.role : d.tables.farm_members.find((m) => m.farm_id === FARM && m.user_id === USER)?.role;
    if (!(t.owner === "group" ? ["admin", "advisor"] : ["owner", "admin", "edit"]).includes(role))
      return [null, { code: "42501", message: t.owner === "group" ? "Only the group's admins and advisors edit the group's layers" : "Only the farm's editors edit the farm's layers" }];
    if (st.refuseProbe) return [null, copy(st.refuseProbe)];
    const v = st.version.get(id) || 1;
    if (args.base_version !== v) return [null, { code: "40001", message: "This feature has changed since it was opened (it is now version " + v + "): open it again and redo the edit" }];
    let geom;
    if (name === "feature_edit_shape") {
      const g = args.shape;
      if (!g || typeof g !== "object" || !["Polygon", "MultiPolygon", "LineString", "MultiLineString", "Point", "MultiPoint"].includes(g.type))
        return [null, { code: "22023", message: "The shape must be a GeoJSON geometry (a polygon, line or point)" }];
      if (st.refuse) { const r = st.refuse; st.refuse = null; return [null, r]; }
      geom = copy(g);
    } else {
      const k = st.kept.find((x) => x.id === Number(args.version_id) && x.feature_id === id);
      if (!k) return [null, { code: "P0002", message: "No such earlier version of this feature" }];
      geom = copy(k.geometry);
    }
    const corners = JSON.stringify(geom.coordinates).split("],[").length;
    if (corners > 25000) return [null, { code: "54000", message: "The shape has " + corners + " corners; at most 25000 can be saved" }];
    if (JSON.stringify(geom) === JSON.stringify(t.f.geometry)) return [{ feature: id, layer: args.layer, version: v, previous_version: v, unchanged: true, geometry: copy(t.f.geometry) }];
    st.kept.push({ id: st.next++, feature_id: id, layer_id: args.layer, version_no: v, geometry: copy(t.f.geometry), superseded_at: new Date(Date.now() + st.next).toISOString() });
    t.f.geometry = geom; st.version.set(id, v + 1);
    const area = B.areaHa(geom);
    if (t.f.properties && "area_ha" in t.f.properties) t.f.properties.area_ha = area;
    return [{ feature: id, layer: args.layer, version: v + 1, previous_version: v, edit_kind: name === "feature_edit_shape" ? "shape" : "restore", edited_by: USER, edited_at: new Date().toISOString(),
      vertices: B.shapeOf(geom).flat(2).length + B.shapeOf(geom).flat().length, area_ha: area, length_m: null, trim_cleared: false, unchanged: false, repaired: false, geometry: copy(geom),
      ...(name === "feature_restore_version" ? { restored_from: Number(args.version_id) } : {}) }];
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
    // WQ9: each location member's own record per parameter family, as public.monitoring_location returns it (WQ1's summary over the
    // site's whole series: distinct sampling times, the datasets counted, the first and last), by family
    for (const l of locations) for (const m of l.members) {
      const fams = new Map();
      for (const [k, rows] of Object.entries(series)) {
        const [id, key] = k.split("|");
        if (Number(id) !== m.monitoring_site_id || !rows.length) continue;
        const f = M.familyOf(key), v = fams.get(f) || { times: new Set(), datasets: new Set() };
        for (const r of rows) { v.times.add(r.sampled_at); v.datasets.add(r.source_key); }
        fams.set(f, v);
      }
      m.records = [...fams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([family, v]) => {
        const t = [...v.times].sort();
        return { family, datasets: [...v.datasets].sort(), n: t.length, first_sampled: t[0], last_sampled: t[t.length - 1] };
      });
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
    // N2: the Maps panel asks for a site's band, trend or summary with no preset and no end year (the library's own window)
    if (!body?.preset_id && body?.params && body.params.end_year === undefined && body.params.location_id === undefined) return demoSiteAnalysis(d, body);
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
  // N2: the Maps panel's previews, in the function's reply shape, over the demo's invented series. The browser cannot run the library,
  // so these are stand-in figures (a count, a plain median, an invented band and trend) with the library's record rules on the demo's
  // months, so a short record says "too little data" as the real function does; the real path is tested in supabase/functions/analysis.
  // The window is the library's default: hydrological years ending 30 June 2026 (the demo's results run to Sep 2026).
  const DEMO_BANDS = { "9101|nitrate-toxicity": "B", "9102|nitrate-toxicity": "C", "9101|drp": "B", "9102|drp": "C", "9101|e-coli": "D", "9102|e-coli": "E" };
  const DEMO_TRENDS = { "9101|nitrate-nitrite-n": ["likely", "increasing", 0.031], "9102|nitrate-nitrite-n": ["very likely", "decreasing", -0.052], "9101|e-coli": ["likely", "increasing", 4.2] };
  const BAND_TABLES = { "nitrate-toxicity": "Appendix 2A Table 6 – Nitrate (toxicity)", "e-coli": "Appendix 2A Table 9 – Escherichia coli (E. coli)", drp: "Appendix 2B Table 20 – Dissolved reactive phosphorus" };
  const DEMO_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const demoDay = (t) => Number(t.slice(8, 10)) + " " + DEMO_MONTHS[Number(t.slice(5, 7)) - 1] + " " + t.slice(0, 4);
  function demoSiteAnalysis(d, body) {
    const p = body.params, wq = wqOf(d), site = wq.sites.find((s) => s.site_id === p.site_id);
    if (!site || body.mode !== "preview" || !["summary", "band", "trend"].includes(p.tool)) return null;
    const band = p.tool === "band", years = band ? 5 : Number(p.years) || (p.tool === "trend" ? 10 : 5), end = 2026;
    const from = end - years + "-07-01", to = end + "-06-30";
    const parameter = !band ? p.parameter : p.attribute === "nitrate-toxicity" ? (wq.series[site.site_id + "|nitrate-n"] ? "nitrate-n" : "nitrate-nitrite-n") : p.attribute === "suspended-fine-sediment" ? "clarity" : p.attribute;
    const rows = (wq.series[site.site_id + "|" + parameter] || []).filter((r) => r.sampled_at.slice(0, 10) >= from && r.sampled_at.slice(0, 10) <= to);
    const ds = site.source_key === "ecan-wq-sites" ? "ecan-wq" : site.source_key, src = WQ_SOURCES[ds], unit = WQ_PARAMS[parameter]?.[1] || "";
    const months = new Set(rows.map((r) => r.sampled_at.slice(0, 7))).size, quarters = new Set(rows.map((r) => r.sampled_at.slice(0, 4) + "q" + Math.floor((Number(r.sampled_at.slice(5, 7)) - 1) / 3))).size;
    const hydro = new Set(rows.map((r) => Number(r.sampled_at.slice(0, 4)) + (Number(r.sampled_at.slice(5, 7)) >= 7 ? 1 : 0))).size;
    const coverage = { months, quarters, years_with_data: hydro, expected_months: years * 12, expected_quarters: years * 4 };
    let result = null, unavailable = null;
    if (!rows.length) unavailable = { reason: "no_results", detail: "No " + parameter + " results you can read at this site between " + demoDay(from) + " and " + demoDay(to) + "." };
    else if (p.tool === "summary") {
      const v = rows.map((r) => r.value).sort((a, b) => a - b), mid = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2, med = Number(mid.toPrecision(3));
      result = { samples: rows.length, censored_below: rows.filter((r) => r.qualifier === "<").length, censored_above: rows.filter((r) => r.qualifier === ">").length, median: { lo: med, hi: med, exact: true }, unit };
    } else if (band) {
      const b = DEMO_BANDS[site.site_id + "|" + p.attribute];
      if (!BAND_TABLES[p.attribute]) unavailable = { reason: "missing_class", detail: "The suspended sediment class of this site (Appendix 2C Table 23, from its REC group) is not recorded. An advisor can give the class and REC group at confirmation." };
      else if (months < 54 || quarters < 18) unavailable = { reason: "insufficient_record", detail: "Not enough data for a band: " + months + " of 60 months and " + quarters + " of 20 quarters have a result; the rule (LAWA factsheet: Calculating water quality state for rivers) needs at least 54 months and 18 quarters over 5 years." };
      else if (b) result = { attribute: p.attribute, table: BAND_TABLES[p.attribute], band: b, monthly_values: months, statistics: [], bottom_line: null, notes: [], coverage };
      else unavailable = { reason: "censoring_indeterminate", detail: "Results below or above detection limits leave the band undecided here (invented for the demo)." };
    } else {
      const t = DEMO_TRENDS[site.site_id + "|" + parameter] || ["indeterminate", null, 0.001];
      const enough = years === 5 ? months >= 54 : months >= Math.ceil(0.9 * years * 12) && hydro >= Math.ceil(0.9 * years);
      if (!enough) unavailable = { reason: "insufficient_record", detail: years === 5 ? "A 5-year trend needs monthly values in at least 54 of 60 months; this series has " + months + "."
        : "A " + years + "-year trend needs values in 90% of months (or of quarters) and 90% of years; this series has " + months + " of " + years * 12 + " months, " + quarters + " of " + years * 4 + " quarters and " + hydro + " of " + years + " years." };
      else {
        const conf = t[0] === "very likely" ? 0.96 : t[0] === "likely" ? 0.81 : 0.55, dec = t[1] === "decreasing" ? conf : 1 - conf;
        result = { seasons: "monthly", seasonal: false, seasonality_p: 0.4, values: months, censored_values: 0, s: 0, var_s: 0, z: 0, p_decreasing: dec, p_increasing: 1 - dec, category: t[0], direction: t[1],
          assessment: t[1] === null ? "indeterminate" : t[1] === "decreasing" ? "improving" : "degrading", sen_slope: { per_year: t[2], percent_per_year: null, unit: unit + "/year" }, coverage,
          caveat: "Indicative: calculated by the platform in the LAWA style; not LWP-Trends output and not checked against it." };
      }
    }
    const caveats = rows.length ? [...(src.provisional ? [src.name + ": Provisional until reviewed by ECan."] : []), ...(p.tool === "trend" && result ? [result.caveat] : []),
      "The source does not report the laboratory or method of each result, so method comparability is not checked."] : [];
    const methods = { summary: ["x1-summary v1", "Summary statistics of every sample (replicates collapsed)"], band: ["x1-band v1", "NPS-FM attribute band"], trend: ["x1-trend v1", "Mann-Kendall / seasonal Kendall test with Sen slope, LAWA-style confidence categories (indicative)"] }[p.tool];
    return { preset: null, tool: p.tool, tool_version: "x1-wq 1.0.0", method: { id: methods[0], name: methods[1], ...(band && BAND_TABLES[p.attribute] ? { table: BAND_TABLES[p.attribute] } : {}), percentile: "Hazen", censoring: "x1-censored-bounds v1" },
      parameters: { ...p, parameter, end_year: end, years, from, to }, site: { monitoring_site_id: site.site_id, source_key: site.source_key, external_id: site.external_id, name: site.name },
      measurement_sources: rows.length ? [ds] : [], source_versions: {}, attribution: rows.length ? [{ dataset: ds, name: src.name, statement: src.attribution, provisional: src.provisional ? "Provisional until reviewed by ECan." : null }] : [],
      result, unavailable, caveats, statement: "", ai_proposed_inputs: null, advisor_overrides: {}, note_allowed: false,
      preview_sha256: (site.site_id.toString(16) + p.tool.length.toString(16) + years.toString(16) + parameter.length.toString(16)).padStart(64, "0") };
  }
  // N2b, as public.monitoring_sites (the shared, served ECan sites every signed-in person may read) and as reference_view_features
  // over the ECan site list: each shared demo site has a reference feature, id 70000 + its site id, at its own position.
  const demoFeatureId = (siteId) => 70000 + siteId;
  function demoMonitoringSites(d) {
    return wqOf(d).sites.filter((s) => s.source_key === "ecan-wq-sites" && !s.owner_farm_id && !s.owner_org_id).map((s) => ({ id: s.site_id, external_id: s.external_id, name: s.name,
      site_type: s.site_type, source_key: s.source_key, feature_id: demoFeatureId(s.site_id), farm_id: null, org_id: null }));
  }
  function demoWqFeatures(d, args) {
    const M = typeof module === "object" && module.exports ? require("./wq-model.js") : globalThis.FP.wqModel;
    const [w, e] = [Math.min(args.x0, args.x1), Math.max(args.x0, args.x1)], [s, n] = [Math.min(args.y0, args.y1), Math.max(args.y0, args.y1)];
    const inBox = demoMonitoringSites(d).map((r) => ({ r, at: M.siteLngLat(wqOf(d).sites.find((x) => x.site_id === r.id).geom) })).filter(({ at }) => at && at[0] >= w && at[0] <= e && at[1] >= s && at[1] <= n);
    return { features: { type: "FeatureCollection", features: inBox.map(({ r, at }) => ({ type: "Feature", id: r.feature_id, geometry: { type: "Point", coordinates: at },
      properties: { SITE_NAME: r.name, SITE_ID: r.external_id, external_id: r.external_id } })) }, total_in_box: inBox.length, truncated: false };
  }
  // N2, as public.site_record_summary: each listed demo site's record per parameter family (distinct sampling times, first, last, years).
  function demoRecordSummary(d) {
    const wq = wqOf(d), M = typeof module === "object" && module.exports ? require("./wq-model.js") : globalThis.FP.wqModel, out = [];
    for (const site of wq.sites) {
      const fams = new Map();
      for (const [k, rows] of Object.entries(wq.series)) {
        const [id, key] = k.split("|");
        if (Number(id) !== site.site_id || !rows.length) continue;
        const f = M.familyOf(key), v = fams.get(f) || { times: new Set(), keys: new Set() };
        for (const r of rows) v.times.add(r.sampled_at);
        v.keys.add(key); fams.set(f, v);
      }
      for (const [family, v] of fams) {
        const t = [...v.times].sort();
        out.push({ site_id: site.site_id, source_key: site.source_key, external_id: site.external_id, site_name: site.name, family, parameters: [...v.keys].sort(), n: t.length,
          first_sampled: t[0], last_sampled: t[t.length - 1], years: new Set(t.map((x) => x.slice(0, 4))).size });
      }
    }
    return out;
  }
  // D3, as public.wq_state_trend_for_site: the one invented ECan site matched to a LAWA site (invented values, LAWA's layout).
  function demoLawa(site) {
    if (site !== 9101) return [];
    const base = { lawa_site_id: "demo-lawa-01", lawa_site_name: "Demo Creek at the farm bridge", council_site_id: "DEMO-01", agency: "ECan", release: "2026-10-27", file_name: "lawa-river-wq-demo.xlsx",
      attribution: "Data sourced from LAWA (Land, Air, Water Aotearoa) and Environment Canterbury (invented demo values).", licence: "CC BY 4.0", monitoring_site_id: 9101, match_status: "matched", match_method: "council_site_id", source_key: "lawa-river-wq" };
    return [{ ...base, kind: "state", indicator: "Nitrate nitrogen", attribute: "Nitrate (toxicity) - NO3N", unit: "mg/L", state: "B", period: "hYear 2025", sheet: "State Attribute Results", source_row: 21 },
      { ...base, kind: "trend", indicator: "Nitrate nitrogen", state: "Likely degrading", trend_description: "Likely degrading", trend_score: -1, period: "10 years", sheet: "Trend Results", source_row: 48 }];
  }
  const matches = (row, key, val) => (val && Array.isArray(val.in) ? val.in.includes(row[key]) : val && typeof val === "object" && "is" in val ? (row[key] ?? null) === val.is
    : val && typeof val === "object" && "gte" in val ? Date.parse(row[key]) >= Date.parse(val.gte) : val && typeof val === "object" && "lt" in val ? Date.parse(row[key]) < Date.parse(val.lt) : row[key] === val);
  function client(ready) {
    const result = (data = null, error = null) => ({ data: copy(data), error });
    const error = (message) => result(null, { message });
    function query(table) {
      const filters = [], orders = []; let write = false, singular = false, maybe = false, adding = null, changes = null, removing = false, span = null, counting = false;
      const q = {
        // M2b (#522 review): select(columns, { count: "exact", head: true }) gives the count as the API does (a head read: the count and no
        // rows), so a count-first read (people.js counted) never falls back to its cap and says "Only the first 2,000 are listed"
        select(_columns, options) { if (options?.count) counting = { head: !!options.head }; return q; }, eq(key, val) { filters.push([key, val]); return q; }, in(key, vals) { filters.push([key, { in: vals }]); return q; },
        order(key, options) { orders.push([key, options?.ascending !== false]); return q; }, limit() { return q; },
        // ON3b: `is(key, null)` and `range(from, to)` (inclusive), as PostgREST pages a long read
        is(key, val) { filters.push([key, { is: val }]); return q; }, range(from, to) { span = [from, to]; return q; },
        // UI2: `gte` and `lt` on a timestamp (the Overview's events in the next few weeks)
        gte(key, val) { filters.push([key, { gte: val }]); return q; }, lt(key, val) { filters.push([key, { lt: val }]); return q; },
        insert(rows) { write = true; adding = rows; return q; }, update(values) { write = true; changes = values || null; return q; }, delete() { write = true; removing = true; return q; },
        single() { singular = true; return execute(); }, maybeSingle() { singular = true; maybe = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        const d = await ready, rows = table === "map_features" || table === "map_feature_versions" ? shapeRows(d, table) : table === "site_record_summary" ? demoRecordSummary(d) : table === "monitoring_sites" ? demoMonitoringSites(d) : d.tables[table];
        if (write && adding && KEPT.includes(table)) {
          const now = new Date().toISOString(), added = (Array.isArray(adding) ? adding : [adding]).map((r) => ({ id: "demo-new-" + ++made, created_at: now, ...(table === "layer_notes" ? { updated_at: now, created_by: d.user.id, updated_by: d.user.id } : {}),
            ...(table === "entries" ? { updated_at: now, created_by: d.user.id, captured_at: now } : {}), ...copy(r) }));
          if (added.some((r) => rows.some((x) => x.id === r.id))) return result(null, { code: "23505", message: "duplicate key value violates unique constraint" });
          for (const r of added) {
            if (table === "entry_links") r.farm_id = d.tables.entries.find((e) => e.id === r.entry_id)?.farm_id ?? null;
            if (table === "subgroup_businesses") Object.assign(r, { parent_org_id: GROUP, joined_on: r.joined_on ?? String(d.asAt).slice(0, 10), left_on: null, created_by: d.user.id });   // SG2: as the guard stamps it
            if (table === "group_fields") Object.assign(r, { key: r.key || String(r.label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field", archived_at: null });   // M1b: as the guard makes the key
            rows.push(r);
            if (table === "documents") d.tables.document_relations.push({ id: r.id, tier: r.tier, relates_to: r.relates_to || null, superseded_by: null });
          }
          return result(singular ? added[0] : added);
        }
        // A change or removal of a Layers page note: applied in memory to the rows the filters pick.
        if (write && (changes || removing) && EDITED.includes(table) && filters.length) {
          const hit = rows.filter((row) => filters.every(([key, val]) => matches(row, key, val)));
          if (removing) { for (const r of hit) rows.splice(rows.indexOf(r), 1); return result(null); }
          for (const r of hit) Object.assign(r, copy(changes), { updated_at: new Date().toISOString() });
          return singular ? (hit.length === 1 ? result(hit[0]) : error("Demo row not found")) : result(hit);
        }
        if (write) return error("The demo does not save changes");
        if (!rows) return error("This demo does not provide " + table);
        let selected = [...rows, ...(d.groupTables?.[table] || [])].filter((row) => filters.every(([key, val]) => matches(row, key, val)));
        for (const [key, asc] of [...orders].reverse()) selected = [...selected].sort((a, b) => String(a[key] || "").localeCompare(String(b[key] || "")) * (asc ? 1 : -1));
        const total = selected.length;   // (the count is of every row the filters pick, before a range)
        if (span) selected = selected.slice(span[0], span[1] + 1);
        // N2b: as the real API, at most 1000 rows a request (the stand-in for site_record_summary keeps the cap, so a reader that trusts a
        // full page is caught by a test)
        if (table === "site_record_summary") selected = selected.slice(0, 1000);
        if (counting) return { ...result(counting.head ? null : selected), count: total };
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
        // N2b: the ECan site list's features in a box (reference_view_features), for a group the old model has no area for
        if (name === "reference_view_features" && args.source === "ecan-wq-sites") return result(demoWqFeatures(d, args));
        if (name === "farm_layer_features" || name === "reference_in_view" || name === "reference_view_features") {
          if (!d.farmParts) return result(null, { code: "PGRST202", message: "Could not find the function in the schema cache" });
          return result(...farmParts(d, name, args));
        }
        if (name === "farm_map") return result(args.f === FARM ? d.map : args.f === FARM2 ? d.map2 : null);
        if (name === "group_event_people") return result(args.g === GROUP ? d.eventPeople || [] : []);   // N4
        if (String(name).startsWith("crm_")) { const r = crmRpc(d, name, args || {}); if (r) return result(...r); }   // PE1
        if (name === "register_review_answer") return result(...reviewAnswer(d, args || {}));   // RV1
        { const r = subgroupRpc(d, name, args || {}); if (r) return result(...r); }   // SG2
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
        // LK1, as public.layer_styles_for_map: the reviewed looks in force (the demo has none, so every layer is drawn as before)
        if (name === "layer_styles_for_map") return result((d.tables.layer_styles || []).filter((s) => s.status === "reviewed" && !s.superseded_at));
        // LK2, as public.layer_style_accept and public.layer_style_send_back for a shared look (the batch's): RCL staff only, a
        // proposed look only, against the version the page drew (a changed one: PT409), a send-back with a note. In memory.
        if (name === "layer_style_accept" || name === "layer_style_send_back") {
          const s = (d.tables.layer_styles || []).find((x) => x.id === args.style_id), back = name === "layer_style_send_back";
          const note = String(args.note ?? "").trim();
          if (back && !note) return error("say what to change: a look is sent back with a note");
          if (back && note.length > 2000) return error("a note is at most 2000 characters");
          if (!s || (s.layer_id == null && !d.tables.profiles[0]?.is_staff)) return error("look " + args.style_id + " is not open for you to " + (back ? "send back" : "accept"));
          if (s.status !== "proposed") return error("look " + s.id + " is already reviewed");
          if (args.expected_updated_at != null && args.expected_updated_at !== s.updated_at) return result(null, { code: "PT409", message: "look " + s.id + " has changed since you looked at it: open it again to see the change" });
          const now = new Date().toISOString();
          if (back) Object.assign(s, { returned_note: note, returned_by: USER, returned_at: now });
          else {
            for (const x of d.tables.layer_styles) if (x !== s && x.status === "reviewed" && !x.superseded_at && x.layer_id === s.layer_id && x.source_key === s.source_key && x.theme === s.theme) Object.assign(x, { superseded_at: now, superseded_by: s.id });
            Object.assign(s, { status: "reviewed", reviewed_by: USER, reviewed_at: now });
          }
          return result(s);
        }
        // QGIS1a, as public.personal_access_token_issue and _revoke: the demo person's own keys, in memory. The key shown is the demo's
        // fixed stand-in, never a working key.
        if (name === "personal_access_token_issue") {
          const nm = String(args.key_name ?? "").trim(), days = Number(args.days);
          if (!nm || nm.length > 80) return result(null, { code: "22023", message: "Give the key a name of 1 to 80 characters, such as \"QGIS on my laptop\"" });
          if (!(days >= 1 && days <= 90)) return result(null, { code: "22023", message: "A key lasts from 1 to 90 days" });
          const key = "fpat_demo_key_not_a_working_key_0000000000000000", now = new Date();
          const row = { id: "demo-new-" + ++made, user_id: USER, name: nm, token_hint: key.slice(0, 9), created_at: now.toISOString(),
            expires_at: new Date(now.getTime() + days * 86400000).toISOString(), last_used_at: null, revoked_at: null };
          d.tables.personal_access_tokens.unshift(row);
          return result({ ...row, token: key });
        }
        if (name === "personal_access_token_revoke") {
          const t = (d.tables.personal_access_tokens || []).find((x) => x.id === args.token_id && x.user_id === USER);
          if (!t) return result(null, { code: "P0002", message: "No such access key of yours" });
          if (!t.revoked_at) t.revoked_at = new Date().toISOString();
          return result(t);
        }
        // LK2: the staff page's invented reference entries (its pictures only; the demo farm and group hold none of these)
        if (name === "demo_looks_reference") return result(copy((d.looksReference || []).find((r) => r.key === args.source) || null));
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
        if (name === "feature_edit_shape" || name === "feature_restore_version") return result(...shapeEdit(d, name, args || {}));
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
          // DEC1c: a held paddock in an open grouped proposal counts, one for each paddock in the group
          for (const p of d.groupTables.proposals) if (["proposed", "ambiguous"].includes(p.status) && p.subject?.gap_kind && /^member_(match_file|match_paddock|extent|match_paddock_group)$/.test(p.kind))
            open[p.subject.gap_kind] = (open[p.subject.gap_kind] || 0) + (p.kind === "member_match_paddock_group" ? (p.subject.items || []).length : 1);
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
      storage: { from: () => ({ createSignedUrls: async (paths) => result(paths.map((path) => ({ path, error: null, signedUrl: new URL("demo/map-boundary.geojson", typeof location === "undefined" ? "http://localhost/" : location.href).href }))),   // V4: the one invented outline
        createSignedUrl: async (path) => result({ signedUrl: new URL(path === PHOTO ? PHOTO : String(path).startsWith("demo/held/") && String(path).endsWith(".pdf") ? "demo/source.pdf" : "demo/source.html", typeof location === "undefined" ? "http://localhost/" : location.href).href }),
        upload: async (path) => result({ path }) }) },
    };
  }
  return { FARM, FARM2, USER, ORG, GROUP, MEMBERS, levelOf, groupRpc, proposalsRpc, GROUP_MEMBERS, queueOf, wqOf, wqLatest, askReply, isRoute, isSparse, isFarmer, isMulti, isGroup, routeHash, href, dataset, client };
});
