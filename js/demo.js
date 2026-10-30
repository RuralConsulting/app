// Demo mode: synthetic, memory-only data from tests/app/fixtures/demo-farm.json. Never constructs a Supabase client.
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
  const VIEWS = /^$|^\/(ask|create|documents|people)$/;
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
    if (suffix === "/ops" && !multi) return "#/ops";            // the staff Operations page
    if (suffix === "/blocks" && !multi) return "#/blocks" + (query ? "?" + query : "");   // the block gallery
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
    if (hash === "#/ops") return "#/demo/ops";
    if (/^#\/blocks(?:\?|$)/.test(hash)) return "#/demo" + hash.slice(1);
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
    const map = {
      farm: { id: FARM, name: farm.name, region: farm.region }, extent, extent_ha: f.extent_ha,
      titles: collection(f.titles.map((t) => feature(extent, { title_no: t.title_no, estate: t.estate, source: "Synthetic title", area_ha: t.area_ha }))),
      land_units: landUnits, reference: [],
      layers: [{ id: "demo-units", name: "Land units (synthetic)", theme: "land_units", geometry_type: "polygon",
        epistemic_class: "assessment", source: "the 2024 farm plan map", as_at: "2024-08-01", shown_as: "Example Advisory Ltd, Aug 2024", features: landUnits }],
    };
    const data = { asAt: f.as_at, map, map2: null, user: { id: USER, email: "advisor@example.test" }, tables: {
      farms: [farm], farm_members: [{ farm_id: FARM, user_id: USER, role: "admin" }], org_members: [{ org_id: ORG, user_id: USER, role: "advisor" }],
      documents: owned(f.documents, FARM), authorisations: owned(f.authorisations, FARM), obligations: owned(f.obligations, FARM),
      // The staff Operations page: invented job records, one failing and one late. The farmer demo is not staff.
      profiles: [{ user_id: USER, is_staff: true }], ops_job_status: f.ops.jobs, ops_reference_status: f.ops.references,
    }, build: f.ops.build };
    if (sparse) {
      farm.name = "Example farm — almost empty";
      data.map = { ...map, farm: { id: FARM, name: farm.name, region: farm.region }, titles: collection([]), land_units: collection([]), layers: [] };
      data.tables.documents = []; data.tables.authorisations = []; data.tables.obligations = [];
    }
    if (farmer) {
      data.tables.farm_members[0].role = "owner"; data.tables.org_members = [];
      data.user.email = "farmer@example.test";
      data.tables.profiles = [{ user_id: USER, is_staff: false }]; data.tables.ops_job_status = []; data.tables.ops_reference_status = [];
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
    data.tables.farm_summaries = data.tables.farms.map((x) => summary(data, x));
    data.people = people(data, { sparse, farmer });
    return data;
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
  function client(ready) {
    const result = (data = null, error = null) => ({ data: copy(data), error });
    const error = (message) => result(null, { message });
    function query(table) {
      const filters = [], orders = []; let write = false, singular = false, maybe = false;
      const q = {
        select() { return q; }, eq(key, val) { filters.push([key, val]); return q; },
        order(key, options) { orders.push([key, options?.ascending !== false]); return q; },
        insert() { write = true; return q; }, update() { write = true; return q; }, delete() { write = true; return q; },
        single() { singular = true; return execute(); }, maybeSingle() { singular = true; maybe = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        const d = await ready, rows = d.tables[table];
        if (write) return error("The demo does not save changes");
        if (!rows) return error("This demo does not provide " + table);
        let selected = rows.filter((row) => filters.every(([key, val]) => row[key] === val));
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
        return error("This operation is not available in the demo");
      },
      // The demo never sends invitations or saves changes.
      functions: { invoke: async () => error("The demo does not save changes") },
      storage: { from: () => ({ createSignedUrl: async () => result({ signedUrl: new URL("demo/source.html", typeof location === "undefined" ? "http://localhost/" : location.href).href }) }) },
    };
  }
  return { FARM, FARM2, USER, ORG, isRoute, isSparse, isFarmer, isMulti, routeHash, href, dataset, client };
});
