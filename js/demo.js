// APP-STRUCTURE §6 / §7 stage 0. Synthetic, memory-only data; never construct a Supabase client.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.FP = root.FP || {};
    const active = api.isRoute(root.location.hash);
    const ready = active ? fetch("demo/cairnvale-pdm.json").then((r) => {
      if (!r.ok) throw new Error("Demo fixture unavailable. Build the app before opening the demo.");
      return r.json();
    }).then(api.dataset) : null;
    root.FP.demo = { ...api, active, ready, client: active ? api.client(ready) : null };
    // Entering/leaving demo always starts a fresh runtime. Real sessions are neither read nor changed.
    root.addEventListener("hashchange", (event) => {
      if (api.isRoute(root.location.hash) !== active) { event.stopImmediatePropagation(); root.location.reload(); }
    });
  }
})(typeof window === "undefined" ? globalThis : window, function () {
  const FARM = "de000000-0000-4000-8000-000000000001";
  const PLAN = "de000000-0000-4000-8000-000000000002";
  const USER = "de000000-0000-4000-8000-000000000003";
  const ORG = "de000000-0000-4000-8000-000000000004";
  const copy = (v) => structuredClone(v);
  const isRoute = (hash) => /^#\/demo(?:\/|$)/.test(hash);
  function routeHash(hash) {
    if (hash === "#/demo" || hash === "#/demo/") return "#/farm/" + FARM;
    if (hash === "#/demo/farms") return "";
    if (hash === "#/demo/plans") return "#/farm/" + FARM + "/plans";
    if (hash === "#/demo/plan") return "#/farm/" + FARM + "/plan/" + PLAN;
    if (hash.startsWith("#/demo/plan/")) return "#/farm/" + FARM + "/plan/" + hash.slice(12);
    return null;
  }
  function href(hash) {
    if (hash === "#/farm/" + FARM) return "#/demo";
    if (hash === "#/farm/" + FARM + "/plans") return "#/demo/plans";
    if (hash === "#/farm/" + FARM + "/plan/" + PLAN) return "#/demo/plan";
    if (hash.startsWith("#/farm/" + FARM + "/plan/")) return "#/demo/plan/" + hash.split("/").pop();
    return hash;
  }
  const polygon = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]] });
  const feature = (geometry, properties) => ({ type: "Feature", geometry, properties });
  const collection = (features) => ({ type: "FeatureCollection", features });
  function dataset(fixture) {
    const pdm = copy(fixture);
    pdm.farm = { ...pdm.farm, id: FARM, org_id: ORG, name: "Cairnvale — synthetic demo" };
    pdm.plan = { ...pdm.plan, id: PLAN, farm_id: FARM, status: "draft", title: "Farm Environment Plan", created_at: "2026-10-27T00:00:00Z" };
    pdm.viewer = { is_advisor: true };
    // Illustrative rectangles, not the real farm boundary or a survey. Keep the test fixture unchanged.
    pdm.extent = polygon(172, -43, 172.025, -42.98);
    pdm.land_units.forEach((u, i) => {
      const w = 172 + (i % 2) * .0125, s = -43 + Math.floor(i / 2) * .01;
      u.geom = polygon(w, s, w + .0125, s + .01);
      u.label_at = { type: "Point", coordinates: [w + .00625, s + .005] };
    });
    const landUnits = collection(pdm.land_units.map((u) => feature(u.geom, {
      code: u.code, name: u.name, area_ha: u.area_ha.v, method: "Synthetic fixture geometry",
      shown_as: "Illustrative only; not a survey", label_at: u.label_at.coordinates,
    })));
    const map = {
      farm: { id: FARM, name: pdm.farm.name }, extent: pdm.extent, extent_ha: pdm.extent_ha.v,
      titles: collection(pdm.titles.map((t) => feature(pdm.extent, { title_no: t.title_no, estate: t.estate_description, source: "Synthetic title", area_ha: 259.2 }))),
      land_units: landUnits, reference: [], layers: [
        { id: "demo-units", name: "Land units (synthetic)", theme: "land_units", geometry_type: "polygon",
          shown_as: "Illustrative geometry, not surveyed boundaries", features: landUnits },
        { id: "demo-actions", name: "Actions (synthetic)", theme: "actions", geometry_type: "point", features: collection(
          pdm.actions.programme.slice(0, 3).map((a, i) => feature({ type: "Point", coordinates: [172.008 + i * .005, -42.992] },
            { name: a.map_code + " " + a.title, map_code: a.map_code, status: a.status, timeframe: a.timeframe_text || a.due_date }))) },
      ],
    };
    pdm.maps = map;
    const sections = Object.entries(pdm.sections).map(([key, s]) => ({ ...s, plan_id: PLAN, farm_id: FARM, section_key: key,
      source_document_id: s.source?.document_id, source_page: s.source?.page }));
    return { pdm, map, user: { id: USER, email: "advisor@example.test" }, tables: {
      farms: [pdm.farm], plans: [pdm.plan], farm_members: [{ farm_id: FARM, user_id: USER, role: "admin" }],
      org_members: [{ org_id: ORG, user_id: USER, role: "advisor" }], documents: pdm.documents.map((d) => ({ ...d, farm_id: FARM })),
      authorisations: pdm.authorisations.map((a) => ({ ...a, farm_id: FARM })), plan_sections: sections,
      plan_section_sources: sections.flatMap((s) => (s.sources || []).map((c) => ({ section_id: s.id, farm_id: FARM, document_id: c.document_id, page: c.page, note: c.note }))),
    }, nextId: 10 };
  }
  function client(ready) {
    const result = (data = null, error = null) => ({ data: copy(data), error });
    const error = (message) => result(null, { message });
    function query(table) {
      const filters = [], orders = []; let operation = "select", input, singular = false, maybe = false;
      const q = {
        select() { return q; }, eq(key, val) { filters.push([key, val]); return q; },
        order(key, options) { orders.push([key, options?.ascending !== false]); return q; },
        insert(rows) { operation = "insert"; input = copy(rows); return q; },
        update(row) { operation = "update"; input = copy(row); return q; },
        single() { singular = true; return execute(); }, maybeSingle() { singular = true; maybe = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        const d = await ready, rows = d.tables[table];
        if (!rows) return error("This demo does not provide " + table);
        let selected = rows.filter((row) => filters.every(([key, val]) => row[key] === val));
        if (operation !== "select") {
          if (!["plans", "plan_sections", "plan_section_sources"].includes(table)) return error("Demo writes are limited to draft plan text");
          const values = operation === "insert" ? (Array.isArray(input) ? input : [input]) : [input];
          const planId = values[0]?.plan_id || (table === "plans" ? selected[0]?.id : null);
          const plan = d.tables.plans.find((p) => p.id === planId);
          if (plan && plan.status !== "draft") return error("Demo plan text can only be changed in draft");
          if (operation === "insert") {
            selected = values.map((row) => ({ ...row, id: row.id || "de000000-0000-4000-8000-" + String(d.nextId++).padStart(12, "0") }));
            rows.push(...selected);
          } else selected.forEach((row) => Object.assign(row, input));
          if (table === "plan_sections") selected.forEach((row) => Object.assign(row, {
            updated_at: new Date().toISOString(), author_kind: "advisor", written_by: { by_name: "Demo advisor" },
            source: row.source_document_id ? { ...d.tables.documents.find((doc) => doc.id === row.source_document_id), document_id: row.source_document_id, page: row.source_page } : null,
          }));
        }
        for (const [key, asc] of [...orders].reverse()) selected = [...selected].sort((a,b) => String(a[key] || "").localeCompare(String(b[key] || "")) * (asc ? 1 : -1));
        if (singular && selected.length !== 1) return maybe && !selected.length ? result(null) : error("Demo row not found or changed");
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
      async rpc(name, args) {
        const d = await ready;
        if (name === "farm_map") return result(args.f === FARM ? d.map : null);
        if (name !== "plan_document") return error("This operation is not available in the demo");
        const plan = d.tables.plans.find((p) => p.id === args.p);
        if (!plan) return result(null);
        const pdm = { ...copy(d.pdm), plan: copy(plan), sections: {} };
        for (const s of d.tables.plan_sections.filter((s) => s.plan_id === args.p)) {
          pdm.sections[s.section_key] = { ...s, sources: d.tables.plan_section_sources.filter((c) => c.section_id === s.id).map((c) => ({
            ...d.tables.documents.find((doc) => doc.id === c.document_id), ...c,
          })) };
        }
        return result(pdm);
      },
      storage: { from: () => ({ createSignedUrl: async () => result({ signedUrl: new URL("demo/source.html", typeof location === "undefined" ? "http://localhost/" : location.href).href }) }) },
    };
  }
  return { FARM, PLAN, USER, ORG, isRoute, routeHash, href, dataset, client };
});
