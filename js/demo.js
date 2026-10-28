// APP-STRUCTURE §6 / §7 stage 0. Synthetic, memory-only data; never construct a Supabase client.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.FP = root.FP || {};
    const active = api.isRoute(root.location.hash), sparse = api.isSparse(root.location.hash), farmer = api.isFarmer(root.location.hash), multi = api.isMulti(root.location.hash);
    const ready = active ? fetch("demo/cairnvale-pdm.json").then((r) => {
      if (!r.ok) throw new Error("Demo fixture unavailable. Build the app before opening the demo.");
      return r.json();
    }).then((pdm) => api.dataset(pdm, { sparse, farmer, multi })) : null;
    root.FP.demo = { ...api, active, sparse, farmer, href: (hash) => api.href(hash, sparse, farmer, multi), ready, client: active ? api.client(ready) : null };
    // Entering/leaving demo always starts a fresh runtime. Real sessions are neither read nor changed.
    root.addEventListener("hashchange", (event) => {
      if (api.isRoute(root.location.hash) !== active || api.isSparse(root.location.hash) !== sparse || api.isFarmer(root.location.hash) !== farmer || api.isMulti(root.location.hash) !== multi) { event.stopImmediatePropagation(); root.location.reload(); }
    });
  }
})(typeof window === "undefined" ? globalThis : window, function () {
  const FARM = "de000000-0000-4000-8000-000000000001";
  const PLAN = "de000000-0000-4000-8000-000000000002";
  const USER = "de000000-0000-4000-8000-000000000003";
  const ORG = "de000000-0000-4000-8000-000000000004";
  const FARM2 = "de000000-0000-4000-8000-000000000005";
  const copy = (v) => structuredClone(v);
  const isRoute = (hash) => /^#\/demo(?:\/|$)/.test(hash);
  const isSparse = (hash) => /^#\/demo\/empty(?:\/|$)/.test(hash);
  const isFarmer = (hash) => /^#\/demo\/farmer(?:\/|$)/.test(hash);
  const isMulti = (hash) => /^#\/demo\/multi(?:\/|$)/.test(hash);
  function routeHash(hash) {
    const multi = isMulti(hash);
    hash = hash.replace(/^#\/demo\/(empty|farmer|multi)(?=\/|$)/, "#/demo");
    const [path, query] = hash.split("?");
    let suffix = path.slice("#/demo".length), farm = FARM;
    if (suffix === "/pattern" || suffix === "/") suffix = "";
    if (suffix === "/farms") return "";
    // Two farms: "#/demo/multi" is the portfolio; "#/demo/multi/farm-1" and ".../farm-2" open one.
    if (multi) {
      if (suffix === "") return "";
      const m = suffix.match(/^\/farm-([12])(?=\/|$)/);
      if (!m) return null;
      farm = m[1] === "2" ? FARM2 : FARM; suffix = suffix.slice(7);
    }
    if (suffix === "/plan" && farm === FARM) suffix = "/plan/" + PLAN;
    if (!/^$|^\/(authorisations|actions|plans|review)$|^\/plan\/[0-9a-f-]{36}$/.test(suffix)) return null;
    return "#/farm/" + farm + suffix + (query ? "?" + query : "");
  }
  function href(hash, sparse = false, farmer = false, multi = false) {
    if (hash === "") return multi ? "#/demo/multi" : "#/demo/farms";
    const farm = [FARM, FARM2].find((id) => hash.startsWith("#/farm/" + id));
    if (!farm) return hash;
    let suffix = hash.slice(("#/farm/" + farm).length);
    if (suffix === "/plan/" + PLAN) suffix = "/plan";
    return "#/demo" + (multi ? "/multi/farm-" + (farm === FARM2 ? 2 : 1) : sparse ? "/empty" : farmer ? "/farmer" : "") + suffix;
  }
  const polygon = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]] });
  const feature = (geometry, properties) => ({ type: "Feature", geometry, properties });
  const collection = (features) => ({ type: "FeatureCollection", features });
  // Mirrors app.can_review (0037): an advisor of the farm's organisation, or the farm's owner.
  const canReview = (d) => d.tables.org_members.length > 0 || d.tables.farm_members.some((m) => m.farm_id === FARM && m.user_id === d.user.id && m.role === "owner");
  // Mirrors public.plan_audit_pack from the demo rows (null unless advisor or owner). Demo hashes are synthetic.
  function auditPack(d, planId) {
    const plan = d.tables.plans.find((p) => p.id === planId);
    if (!plan || !canReview(d)) return null;
    const sup = new Set(d.tables.plan_assessments.map((a) => a.supersedes_id).filter(Boolean));
    const rows = d.tables.plan_assessments.filter((a) => a.plan_id === planId && !sup.has(a.id)).sort((a, b) => b.event_date.localeCompare(a.event_date));
    const hash = "0123456789abcdef".repeat(4);
    return { pack_schema_version: 1, plan_id: plan.id, farm_id: plan.farm_id, title: plan.title, status: plan.status, plan_sha256: null, as_at: "2026-10-28", assessment_count: rows.length,
      assessments: rows.map((a) => {
        const res = d.tables.assessment_action_results.filter((x) => x.assessment_id === a.id).map((x) => ({ result_id: x.id, action_id: x.action_id,
          action_title: (d.pdm?.actions.programme.find((y) => y.id === x.action_id) || {}).title, outcome: x.outcome, reason: x.reason }));
        const doc = d.tables.documents.find((x) => x.id === a.report_document_id), audit = a.kind === "audit";
        return { id: a.id, kind: a.kind, items: { "15a_date": a.event_date, "15b_assessor_name": { name: a.assessor_name, org: a.assessor_org }, "15c_assessor_id_number": a.assessor_id_number,
          "15d_conflict_declaration": { declaration: a.conflict_declaration, note: a.conflict_note, document: null }, "15e_next_audit_due": a.next_audit_due, "15f_recertification_due": a.recertification_due,
          "16a_actions_on_time": audit ? res.filter((x) => x.outcome === "on_time") : null, "16b_actions_not_on_time": audit ? res.filter((x) => x.outcome !== "on_time") : null,
          "16c_grade": { grade: a.grade, scheme: a.grade_scheme } },
          documents: doc ? [{ role: "report", document_id: doc.id, title: doc.title, sha256: doc.sha256 || hash }] : [], supersedes_id: a.supersedes_id, entered_by_person: null, entered_at: a.entered_at, source_page: a.source_page };
      }) };
  }
  function dataset(fixture, { sparse = false, farmer = false, multi = false } = {}) {
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
    const data = { pdm, map, user: { id: USER, email: "advisor@example.test" }, tables: {
      farms: [pdm.farm], plans: [pdm.plan], farm_members: [{ farm_id: FARM, user_id: USER, role: "admin" }],
      org_members: [{ org_id: ORG, user_id: USER, role: "advisor" }], documents: pdm.documents.map((d) => ({ ...d, farm_id: FARM })),
      authorisations: pdm.authorisations.map((a) => ({ ...a, farm_id: FARM })), plan_sections: sections,
      plan_section_sources: sections.flatMap((s) => (s.sources || []).map((c) => ({ section_id: s.id, farm_id: FARM, document_id: c.document_id, page: c.page, note: c.note }))),
    }, nextId: 10 };
    // One certification and one audit with results, so the Audits and certification panel has something to show. Synthetic people.
    const progs = pdm.actions.programme, aid = (i) => "de000000-0000-4000-8000-0000000002" + String(i).padStart(2, "0");
    data.tables.plan_assessments = [
      { id: aid(1), farm_id: FARM, plan_id: PLAN, kind: "certification", event_date: "2025-09-10", assessor_name: "Sam Example", assessor_org: "Example Certifiers Ltd",
        assessor_id_number: "CERT-0001", conflict_declaration: "no_conflict", conflict_note: null, report_document_id: "d-fep", grade: null, grade_scheme: null,
        next_audit_due: "2027-09-10", recertification_due: "2030-09-10", source_page: 3, supersedes_id: null, entered_at: "2025-09-12T00:00:00Z" },
      { id: aid(2), farm_id: FARM, plan_id: PLAN, kind: "audit", event_date: "2026-09-18", assessor_name: "Alex Example", assessor_org: "Example Audits Ltd",
        assessor_id_number: "AUD-0042", conflict_declaration: "conflict_declared", conflict_note: "Advised the farm on a different matter in 2023.",
        report_document_id: "d-fep", grade: "B", grade_scheme: "A to D", next_audit_due: "2028-09-18", recertification_due: null, source_page: 5, supersedes_id: null, entered_at: "2026-09-20T00:00:00Z" },
    ];
    data.tables.assessment_action_results = [
      { id: aid(11), farm_id: FARM, assessment_id: aid(2), action_id: progs[0].id, outcome: "late", reason: "Plan was finished in April, after the March date." },
      { id: aid(12), farm_id: FARM, assessment_id: aid(2), action_id: progs[1].id, outcome: "on_time", reason: null },
      { id: aid(13), farm_id: FARM, assessment_id: aid(2), action_id: progs[2].id, outcome: "not_done", reason: "Fencing delayed by the wet winter." },
    ];
    const checks = pdm.checks.filter((c) => c.author_kind === "system" && !c.confirmed_by && !c.superseded_at);
    const at = "2026-10-27T00:00:00Z";
    data.tables.review_queue = [
      ...checks.map((c) => ({ farm_id: FARM, plan_id: null, item_kind: "system_check", source: "unconfirmed_check", ref_id: c.id, ref: c.id,
        sentence: "The nitrogen cap reads as \"On track\" on the recorded figures: the recorded loss is under the cap — confirm it, or put your own reading",
        detail: { check_id: c.id, status: "on_track" }, created_at: at, state: "open", due_on: null, priority: 3 })),
      { farm_id: FARM, plan_id: PLAN, item_kind: "fact", source: "unchecked_fact", ref_id: "de000000-0000-4000-8000-000000000101", ref: "stock_units",
        sentence: "Sheep stock units, winter is 120 SU — check it", detail: { fact_type: "stock_units", value_num: 120, unit: "SU", document_title: "Synthetic farm notes", page: 4 },
        created_at: at, state: "open", due_on: null, priority: 3 },
      { farm_id: FARM, plan_id: null, item_kind: "fact_conflict", source: "conflict", ref_id: "de000000-0000-4000-8000-000000000103", ref: "stock_numbers",
        sentence: "Stock numbers (dairy cows), 2025/26 has been recorded as 480 or 520 head — pick the one to use",
        detail: { fact_ids: ["de000000-0000-4000-8000-000000000103", "de000000-0000-4000-8000-000000000104"], fact_type: "stock_numbers", item: "dairy_cows", season: "2025/26", scope: "farm", as_at: null, values: ["480", "520"],
          candidates: [{ fact_id: "de000000-0000-4000-8000-000000000103", value: "480", unit: "head", source: "Synthetic farm notes p3" },
            { fact_id: "de000000-0000-4000-8000-000000000104", value: "520", unit: "head", source: "Entered directly" }] },
        created_at: at, state: "open", due_on: null, priority: 2 },
      { farm_id: FARM, plan_id: PLAN, item_kind: "gap", source: "review_item", ref_id: "de000000-0000-4000-8000-000000000102", ref: "A3",
        sentence: "Action A3 has no timeframe in the source document — add one or leave it as written", detail: { kind: "gap", ref: "A3" },
        created_at: at, state: "open", due_on: null, priority: 4 },
    ];
    if (sparse) {
      const farm = { id: FARM, org_id: ORG, name: "Example farm — sparse demo", region: "canterbury" };
      data.pdm = null; // The empty state must not depend on a plan existing.
      data.map = { ...map, farm, titles: collection([]), land_units: collection([]), layers: [], reference: [] };
      data.tables.farms = [farm]; data.tables.plans = []; data.tables.plan_sections = []; data.tables.plan_section_sources = [];
      data.tables.authorisations = []; data.tables.review_queue = []; data.tables.plan_assessments = []; data.tables.assessment_action_results = [];
      data.tables.documents = [{ id: "empty-doc-1", farm_id: FARM, title: "Synthetic property notes" }, { id: "empty-doc-2", farm_id: FARM, title: "Synthetic field notes" }];
    }
    if (farmer) {
      data.tables.farm_members[0].role = "owner"; data.tables.org_members = []; // the farmer is the farm's owner (0037)
      data.user.email = "farmer@example.test";
      if (data.pdm) { data.pdm.viewer.is_advisor = false; data.pdm.actions.not_doing = []; }
    }
    if (multi) {
      // A second, small farm so the portfolio can be exercised: a map extent, one authorisation, two documents.
      const farm = { id: FARM2, org_id: ORG, name: "Waiau Flats — synthetic demo", region: "canterbury" };
      data.tables.farms[0].region = "canterbury";
      data.tables.farms.push(farm);
      data.tables.farm_members.push({ farm_id: FARM2, user_id: USER, role: "admin" });
      data.tables.documents.push({ id: "demo2-doc-1", farm_id: FARM2, title: "Synthetic property notes" }, { id: "demo2-doc-2", farm_id: FARM2, title: "Synthetic field notes" });
      data.tables.authorisations.push({ id: "demo2-auth-1", farm_id: FARM2, title: "Water permit (synthetic)", consent_no: "CRC000001", rule_ref: null });
      const extent = polygon(172.62, -42.78, 172.64, -42.765);
      data.map2 = { farm: { id: FARM2, name: farm.name }, extent, extent_ha: 220, titles: collection([]), land_units: collection([]), layers: [], reference: [] };
    }
    data.tables.farm_summaries = data.tables.farms.map((farm) => summary(data, farm));
    return data;
  }
  // Mirrors public.farm_summaries (0038): what the database counts for the portfolio, from the same fixtures.
  function summary(d, farm) {
    const p = farm.id === FARM ? d.pdm : null, plans = d.tables.plans.filter((x) => x.farm_id === farm.id || (!x.farm_id && farm.id === FARM));
    const actions = p ? p.actions.programme : [], at = p?.as_at || "2026-10-27", overall = p?.values.find((v) => v.fact_type === "overall_risk_significance" &&
      v.state === "recorded" && v.class === "assessment" && v.checked?.at && v.assessed_by && v.assessed_on);
    return { id: farm.id, name: farm.name, region: farm.region || null, extent: (farm.id === FARM2 ? d.map2 : d.map).extent, as_at: at,
      plan_count: plans.length, open_plan_count: plans.filter((x) => ["draft", "in_review"].includes(x.status)).length,
      programme_actions: plans.length ? actions.length : 0,
      overdue_actions: plans.length ? actions.filter((a) => a.due_date && a.due_date < at && a.status !== "done").length : 0,
      authorisation_count: d.tables.authorisations.filter((x) => x.farm_id === farm.id).length,
      advisor_checked: !!plans.length && !!p?.checks.some((c) => c.author_kind === "advisor" && !c.superseded_at),
      document_count: p && plans.length ? p.documents.length : d.tables.documents.filter((x) => x.farm_id === farm.id).length,
      overall_significance: plans.length && overall ? { text: overall.text || String(overall.v), assessed_by: overall.assessed_by, assessed_on: overall.assessed_on } : null };
  }
  function client(ready) {
    const result = (data = null, error = null) => ({ data: copy(data), error });
    const error = (message) => result(null, { message });
    // Mirrors 0039: advisors insert; nothing is updated or deleted; a record is replaced once only; a reason is needed unless on time.
    function recordAssessment(d, table, operation, input) {
      if (operation !== "insert") return error("Assessment records cannot be changed. Record a correction instead");
      if (!d.tables.org_members.length) return error("new row violates row-level security policy for table \"" + table + "\"");
      const rows = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row, id: "de000000-0000-4000-8000-" + String(d.nextId++).padStart(12, "0"), entered_at: new Date().toISOString() }));
      for (const row of rows) {
        if (table === "plan_assessments") {
          if (row.conflict_declaration === "conflict_declared" && !String(row.conflict_note || "").trim()) return error("A declared conflict needs a note");
          if (!String(row.assessor_name || "").trim()) return error("The assessor's name is required");
          if (row.supersedes_id && d.tables.plan_assessments.some((r) => r.supersedes_id === row.supersedes_id)) return error("That record has already been replaced");
        } else if (row.outcome !== "on_time" && !String(row.reason || "").trim()) return error("A reason is needed when an action was late or not done");
      }
      d.tables[table].push(...rows);
      return result(rows[0]);
    }
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
          if (["plan_assessments", "assessment_action_results"].includes(table)) return recordAssessment(d, table, operation, input);
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
        if (name === "review_counts") {
          if (args.farm !== FARM || !canReview(d)) return error("Advisor or owner review only");
          const open = d.tables.review_queue, by = (k) => open.filter((r) => r.source === k).length;
          return result({ total: open.length, by_source: { review_item: by("review_item"), unchecked_fact: by("unchecked_fact"), unconfirmed_check: by("unconfirmed_check"), conflict: by("conflict") }, earliest_due: null });
        }
        if (name === "resolve_review") {
          if (!canReview(d)) return error("Only an advisor or the owner of this farm can resolve review items");
          const rows = d.tables.review_queue, i = rows.findIndex((r) => r.source === args.item_source && r.ref_id === args.item_id);
          if (i < 0) return error("That item is no longer open");
          if (args.item_source === "conflict") {
            if (!String(args.payload?.note || "").trim()) return error("Say why this value is the one to use (note)");
            if (!rows[i].detail.fact_ids.includes(args.payload?.fact_id)) return error("fact_id must be one of the conflicting facts");
          }
          rows.splice(i, 1);
          return result({ ok: true });
        }
        if (name === "farm_map") return result(args.f === FARM ? d.map : args.f === FARM2 ? d.map2 || null : null);
        if (name === "plan_audit_pack") return result(auditPack(d, args.p));
        if (name !== "plan_document") return error("This operation is not available in the demo");
        const plan = d.tables.plans.find((p) => p.id === args.p);
        if (!plan) return result(null);
        const baseline = d.pdm || {
          pdm_schema_version: 1, template: plan.template, template_version: plan.template_version,
          as_at: "2026-10-27", viewer: { is_advisor: true }, farm: d.tables.farms[0], values: [], land_units: [],
          land_unit_count: { state: "calculated", v: 0, calc: { formula: "count(recorded land units)", inputs: [] } },
          extent: d.map.extent, extent_ha: { state: "not_recorded" }, titles: [], leases: [], soils: [], activities: [], risks: [], checks: [],
          actions: { programme: [], possible: [], not_doing: [] }, maps: d.map, authorisations: [], nutrient_history: [], receptors: [],
          documents: d.tables.documents, evidence: [], reference_sources: [], map_sources: [], ai_use: { checked_fact_count: 0, models: [] },
        };
        const pdm = { ...copy(baseline), plan: copy(plan), sections: {} };
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
  return { FARM, FARM2, PLAN, USER, ORG, isRoute, isSparse, isFarmer, isMulti, routeHash, href, dataset, client };
});

