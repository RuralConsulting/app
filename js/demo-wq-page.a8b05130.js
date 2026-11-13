// WQV1: the demo's Water quality page, on invented data only (no real site, sample or person). demo.js calls it for the reads the page
// makes, in exactly the shapes the database gives:
//   * always: public.wq_site_figures and public.wq_state_trend_for_sites over the demo's water quality sites (wqDemo in demo.js), so the
//     page opens in every group demo;
//   * with "?wq=sub" or "?wq=parent" before the hash (the MCCC-like demo): more public sites of several ECan types, written as ECan writes
//     them (trailing spaces; an effluent site; a site with no type), groundwater wells and a spring, a NIWA site, and two invented
//     sub-groups' own datasets with field-meter, test-strip and laboratory results and censored values. The viewer is on the first
//     sub-group ("sub") or on neither ("parent": a coordinator of the parent group only); a sub-group's own sites and results are given
//     only to a viewer on that sub-group, as row-level security does (the second sub-group's are never given to either).
// Values are a fixed function of the month, so the demo reads the same on every day.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(() => (node ? require("./wq-model.js") : root.FP.wqModel), () => (node ? require("./wq-page-model.js") : root.FP.wqPageModel));
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.demoWqPage = api; }
})(typeof window === "undefined" ? globalThis : window, function (W, P) {
  const list = (v) => (Array.isArray(v) ? v : []);
  // The MCCC-like demo's invented area and its two invented sub-groups (their ids are demo.js's SUBGROUPS).
  const AREA = [171.94, -43.08, 172.14, -42.94];
  const SUB_A = "de000000-0000-4000-8000-0000000003c1", SUB_B = "de000000-0000-4000-8000-0000000003c2";
  const SUB_AREAS = { [SUB_A]: [171.94, -43.08, 172.035, -42.94], [SUB_B]: [172.045, -43.08, 172.14, -42.94] };
  const SUB_NAMES = { [SUB_A]: "Ford Creek sub-group (synthetic)", [SUB_B]: "Hill Country sub-group (synthetic)" };
  const PARAMS = { "nitrate-nitrite-n": ["Nitrate-nitrite nitrogen (NNN)", "mg/L"], "nitrate-n": ["Nitrate nitrogen", "mg/L"], drp: ["Dissolved reactive phosphorus", "mg/L"],
    "e-coli": ["E. coli", "/100 mL"], turbidity: ["Turbidity", "NTU"], clarity: ["Visual clarity (black disc)", "m"], conductivity: ["Conductivity (at 25 °C)", "µS/cm"] };
  const SOURCES = {
    "demo-ford-wq": { name: "Ford Creek sub-group sampling (synthetic)", attribution: "Source: the Ford Creek sub-group's own sampling (invented demo values).", provisional: false, org: SUB_A },
    "demo-hill-wq": { name: "Hill Country sub-group sampling (synthetic)", attribution: "Source: the Hill Country sub-group's own sampling (invented demo values).", provisional: false, org: SUB_B },
  };
  // id, external id, name, site_type (as the source writes it), where, owner, and its records: [key, from [y, m], to [y, m], every n months,
  // base, trend per year, how measured { method, lab, sp (the parameter as written) }]
  const ECAN = { src: "ecan-wq" };
  const SITES = [
    { id: 9401, ext: "SQ90401", name: "Ford Stream at Bridge Road (synthetic)", type: "Rivers, Drains, Creeks  ", at: [171.985, -43.035], records: [
      ["nitrate-nitrite-n", [2012, 0], [2026, 8], 1, 2.1, 0.035, ECAN], ["e-coli", [2012, 0], [2026, 8], 1, 1.1, 0, ECAN], ["drp", [2012, 0], [2026, 8], 1, 1.4, -0.01, ECAN], ["clarity", [2014, 0], [2026, 8], 1, 1.2, 0, ECAN]] },
    { id: 9402, ext: "SQ90402", name: "Mill Drain at the outlet (synthetic)", type: "Rivers - below discharges ", at: [172.11, -43.06], records: [
      ["nitrate-nitrite-n", [2016, 0], [2026, 7], 1, 3.4, -0.03, ECAN], ["e-coli", [2016, 0], [2026, 7], 1, 2.2, 0, ECAN]] },
    { id: 9403, ext: "SQ90403", name: "Hill Lake (synthetic)", type: "Lakes ", at: [172.12, -42.955], records: [["nitrate-nitrite-n", [2019, 0], [2021, 9], 4, 0.3, 0, ECAN]] },
    { id: 9404, ext: "SQ90404", name: "Treatment pond outfall (synthetic)", type: "Effluent, Sewage", at: [172.13, -43.07], records: [["nitrate-nitrite-n", [2020, 0], [2026, 6], 2, 9, 0, ECAN]] },
    { id: 9405, ext: "SQ90405", name: "Upper Ford Stream (synthetic)", type: "Rivers, Drains, Creeks", at: [171.955, -42.95], records: [["nitrate-nitrite-n", [2018, 0], [2026, 8], 1, 1.0, 0, ECAN], ["e-coli", [2018, 0], [2026, 8], 1, 0.6, 0, ECAN]] },
    { id: 9406, ext: "SQ90406", name: "Roadside site (synthetic, no type recorded)", type: null, at: [172.085, -42.99], records: [["nitrate-nitrite-n", [2021, 0], [2026, 6], 3, 1.8, 0, ECAN]] },
    { id: 9407, ext: "SQ90407", name: "Coast Road estuary (synthetic)", type: "Marine", at: [172.135, -43.075], records: [["e-coli", [2020, 0], [2026, 6], 2, 0.4, 0, ECAN]] },
    // groundwater (ECan): two current wells, a spring the source counts as groundwater, and one well last sampled in 2012
    { id: 9411, ext: "M35/9411", depth: 42, name: "Well M35/9411 (synthetic)", type: "Groundwater-Wells ", at: [171.99, -42.985], records: [["nitrate-nitrite-n", [2010, 1], [2026, 7], 3, 6.2, 0.06, ECAN], ["e-coli", [2016, 1], [2026, 7], 6, 0.01, 0, ECAN], ["conductivity", [2010, 1], [2026, 7], 3, 1, 0, ECAN]] },
    { id: 9412, ext: "M35/9412", depth: 18.5, name: "Well M35/9412 (synthetic)", type: "Groundwater-Wells", at: [172.07, -43.02], records: [["nitrate-nitrite-n", [2014, 9], [2026, 9], 12, 4.1, -0.02, ECAN]] },
    { id: 9413, ext: "M35/9413", name: "Spring at Terrace Road (synthetic)", type: "Groundwater-Springs ", at: [172.03, -42.965], records: [["nitrate-nitrite-n", [2020, 2], [2026, 8], 3, 5.0, 0.02, ECAN]] },
    { id: 9414, ext: "M35/9414", depth: 65, name: "Well M35/9414 (synthetic)", type: "Groundwater-Wells", at: [172.1, -42.97], records: [["nitrate-nitrite-n", [2005, 0], [2012, 0], 6, 7.5, 0, ECAN]] },
    // NIWA's national network: one site by the coast (its own dataset)
    { id: 9420, ext: "DEMO-NRWQN-20", name: "Demo River near the coast, national network (synthetic)", type: "River", at: [172.12, -43.045], source: "niwa-nrwqn-sites", records: [
      ["nitrate-n", [2015, 0], [2026, 5], 1, 0.6, 0.01, { src: "niwa-nrwqn" }], ["clarity", [2015, 0], [2026, 5], 1, 2.0, 0, { src: "niwa-nrwqn" }]] },
    // the Ford Creek sub-group's own: field UV-meter nitrate-N most months, a laboratory nitrate-nitrite-N each quarter, a test strip
    { id: 9501, ext: "FC-01", name: "Ford Creek at the woolshed (synthetic)", type: "surface water", at: [171.975, -43.0], own: "demo-ford-wq", records: [
      ["nitrate-n", [2024, 0], [2026, 8], 1, 2.6, 0.05, { src: "demo-ford-wq", method: "Field UV meter", sp: "Nitrate-N (UV)" }],
      ["nitrate-nitrite-n", [2024, 1], [2026, 7], 3, 2.4, 0.05, { src: "demo-ford-wq", method: "Lab", lab: "Invented Laboratories Ltd", sp: "Nitrate + nitrite N" }],
      ["drp", [2024, 1], [2026, 7], 3, 0.6, 0, { src: "demo-ford-wq", method: "Lab", lab: "Invented Laboratories Ltd", sp: "DRP", censor: 0.005 }],
      ["e-coli", [2024, 1], [2026, 7], 3, 0.8, 0, { src: "demo-ford-wq", method: "Lab", lab: "Invented Laboratories Ltd", sp: "E. coli" }]] },
    { id: 9502, ext: "FC-02", name: "Ford Creek springhead (synthetic)", type: "springhead", at: [171.96, -43.02], own: "demo-ford-wq", records: [
      ["nitrate-n", [2024, 3], [2026, 8], 1, 4.2, 0, { src: "demo-ford-wq", method: "Field UV meter", sp: "Nitrate-N (UV)" }]] },
    { id: 9503, ext: "FC-03", name: "Ford Creek farm bore (synthetic)", type: "groundwater", at: [171.97, -43.05], own: "demo-ford-wq", records: [
      ["nitrate-nitrite-n", [2024, 2], [2026, 8], 3, 7.9, 0, { src: "demo-ford-wq", method: "Lab", lab: "Invented Laboratories Ltd", sp: "NNN" }],
      ["nitrate-n", [2025, 0], [2026, 8], 2, 7.4, 0, { src: "demo-ford-wq", method: "Nitrate test strip", sp: "Nitrate (strip)" }]] },
    // the Hill Country sub-group's own (never given to this demo's viewers: neither is on that sub-group)
    { id: 9511, ext: "HC-01", name: "Hill Country stream (synthetic)", type: "stream", at: [172.09, -43.0], own: "demo-hill-wq", records: [
      ["nitrate-nitrite-n", [2024, 0], [2026, 8], 1, 1.4, 0, { src: "demo-hill-wq", method: "Lab", lab: "Invented Laboratories Ltd", sp: "NNN" }]] },
    { id: 9512, ext: "HC-02", name: "Hill Country bore (synthetic)", type: "groundwater", at: [172.1, -43.03], own: "demo-hill-wq", records: [
      ["nitrate-n", [2025, 0], [2026, 8], 2, 5.5, 0, { src: "demo-hill-wq", method: "Test strip", sp: "Nitrate (strip)" }]] },
  ];
  // LAWA's published results for the invented ECan sites (invented values, LAWA's layout; the rows public.wq_state_trend_for_sites gives)
  const LAWA = { 9401: [["Nitrate nitrogen", "Nitrate (toxicity) - NO3N", "C", "Very likely degrading", -2], ["E.coli", "Escherichia coli (E.coli)", "D", "Indeterminate", 0], ["DRP", "Dissolved reactive phosphorus", "B", "Likely improving", 1]],
    9402: [["Nitrate nitrogen", "Nitrate (toxicity) - NO3N", "C", "Likely improving", 1], ["E.coli", "Escherichia coli (E.coli)", "E", "Likely degrading", -1]],
    9405: [["Nitrate nitrogen", "Nitrate (toxicity) - NO3N", "A", "Indeterminate", 0]],
    9102: [["Nitrate nitrogen", "Nitrate (toxicity) - NO3N", "C", "Likely improving", 1]] };

  const wave = (i, k) => Math.sin(i * 0.52 + k) * 0.5 + Math.sin(i * 1.7 + k * 3) * 0.25;
  function series(site, [key, from, to, every, base, trend, how], k) {
    const out = [];
    for (let y = from[0], m = from[1], i = 0; y < to[0] || (y === to[0] && m <= to[1]); m += every, i++) {
      while (m > 11) { m -= 12; y++; }
      if (y > to[0] || (y === to[0] && m > to[1])) break;
      const yrs = y - from[0] + m / 12, grow = 1 + trend * yrs * 3;
      let value, qualifier = null;
      if (key === "e-coli") { value = Math.round(Math.max(1, 120 * base * (1 + 1.3 * wave(i, k)) * (m >= 10 || m <= 1 ? 1.5 : 1))); if (base < 0.05) { value = 1; qualifier = "<"; } }
      else if (key === "drp") { value = Math.max(0.002, 0.012 * base * grow * (1 + 0.6 * wave(i, k + 2))); const lim = how.censor || 0.004; if (value < lim) { value = lim; qualifier = "<"; } }
      else if (key === "clarity") value = Math.max(0.2, base * (1 + 0.5 * wave(i, k + 1)));
      else if (key === "conductivity") value = Math.round(180 + 40 * wave(i, k));
      else value = Math.max(0.05, base * grow * (1 + 0.28 * wave(i, k) + (m >= 5 && m <= 8 ? 0.15 : 0)));
      if (key !== "e-coli" && key !== "conductivity") value = Number(value.toPrecision(3));
      const sampled_at = new Date(Date.UTC(y, m, 6 + ((site.id + i * 3 + k) % 14), 21, 0, 0)).toISOString();
      out.push({ sampled_at, value, qualifier, value_text: (qualifier || "") + String(value), unit: PARAMS[key][1], sample_id: site.ext + "-" + key + "-" + (i + 1), series: "", replicate_no: 1,
        datetime_flag: null, source_key: how.src, superseded_at: null, aggregate: "", n_values: null, method: how.method || null, lab: how.lab || "", source_parameter: how.sp || PARAMS[key][0] });
    }
    return out;
  }
  const box = ([w, s, e, n]) => ({ type: "MultiPolygon", coordinates: [[[[w, s], [e, s], [e, n], [w, n], [w, s]].map(([x, y]) => W().lngLatToNztm(x, y).map((v) => Math.round(v * 10) / 10))]] });

  // Adds the MCCC-like demo to the demo's water quality data (wqDemo's shape): sites, series, sources, and what the page reads beside them.
  function extend(wq, group) {
    if (wq.page) return wq;
    const place = ([lng, lat]) => { const [x, y] = W().lngLatToNztm(lng, lat); return { type: "Point", coordinates: [Math.round(x * 100) / 100, Math.round(y * 100) / 100] }; };
    for (const s of SITES) {
      wq.sites.push({ site_id: s.id, external_id: s.ext, name: s.name, site_type: s.type, distance_m: 0, geom: place(s.at), source_key: s.own || s.source || "ecan-wq-sites",
        owner_farm_id: null, owner_org_id: s.own ? SOURCES[s.own].org : null, ...(s.source ? { niwa: true } : {}), ...(s.depth ? { depth_m: s.depth } : {}) });
      s.records.forEach((r, k) => { wq.series[s.id + "|" + r[0]] = series(s, r, k); });
    }
    for (const site of wq.sites) {
      const all = Object.entries(wq.series).filter(([k]) => k.startsWith(site.site_id + "|")).flatMap(([, rows]) => rows);
      site.last_sampled = all.length ? all.map((r) => r.sampled_at).sort().pop() : null;
    }
    Object.assign(wq.params, PARAMS);
    Object.assign(wq.sources, SOURCES);
    wq.page = { group, area: box(AREA), subAreas: Object.fromEntries(Object.entries(SUB_AREAS).map(([id, b]) => [id, box(b)])) };
    return wq;
  }
  // Whether the viewer reads a site: a sub-group's own only for a viewer on that sub-group (viewer "sub" is on the first only).
  function readable(wq, viewer, siteId) {
    const s = wq.sites.find((x) => x.site_id === siteId);
    if (!s) return false;
    if (!viewer || !s.owner_org_id || !Object.values(SOURCES).some((x) => x.org === s.owner_org_id)) return true;
    return viewer === "sub" && s.owner_org_id === SUB_A;
  }
  const nzYear = (t) => Number(new Intl.DateTimeFormat("en-NZ", { year: "numeric", timeZone: "Pacific/Auckland" }).format(new Date(t)));
  const median = (v) => { const s = [...v].sort((a, b) => a - b), i = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2) : null; };
  // As public.wq_site_figures.
  function figures(wq, viewer, args) {
    const ids = list(args.p_sites), fam = args.p_family, from = args.p_from ? Date.parse(args.p_from) : -Infinity, withField = !!args.p_include_field;
    if (ids.length > 250) return [null, { code: "22023", message: "At most 250 sites at a time (asked for " + ids.length + ")" }];
    const keys = Object.keys(wq.params).filter((k) => (k === "nitrate-n" || k === "nitrate-nitrite-n" ? "nitrate" : k) === fam), out = [];
    for (const id of ids) {
      const site = wq.sites.find((s) => s.site_id === id);
      if (!site || !readable(wq, viewer, id)) continue;
      const shared = !site.owner_org_id && !site.owner_farm_id;
      for (const key of keys) {
        const rows = list(wq.series[id + "|" + key]).filter((r) => Date.parse(r.sampled_at) >= from && !r.superseded_at && r.aggregate === "")
          .map((r) => ({ ...r, k: P().methodKind(r.method, r.lab, r.source_parameter, shared) }));
        if (!rows.length) continue;
        const times = (f) => new Set(rows.filter(f).map((r) => r.sampled_at)).size, used = rows.filter((r) => r.value != null && (withField || ["lab", "unrecorded"].includes(r.k)));
        const med = median(used.map((r) => Number(r.value))), last = [...rows].sort((a, b) => b.sampled_at.localeCompare(a.sampled_at) || a.replicate_no - b.replicate_no)[0];
        const years = new Map();
        for (const r of used) { const y = nzYear(r.sampled_at); years.set(y, [...(years.get(y) || []), Number(r.value)]); }
        out.push({ site_id: id, parameter: key, unit: rows[0].unit, n: times(() => true), n_lab: times((r) => r.k === "lab"), n_field: times((r) => r.k === "field"), n_strip: times((r) => r.k === "strip"),
          n_unrecorded: times((r) => r.k === "unrecorded"), n_censored: rows.filter((r) => r.qualifier).length,
          first_sampled: rows.map((r) => r.sampled_at).sort()[0], last_sampled: rows.map((r) => r.sampled_at).sort().pop(),
          latest_at: last.sampled_at, latest_text: last.value_text, latest_value: last.value, latest_qualifier: last.qualifier, latest_method: last.k,
          median: med, median_n: used.length, median_censored: med != null && used.some((r) => (["<", "≤"].includes(r.qualifier) && r.value >= med) || ([">", "≥"].includes(r.qualifier) && r.value <= med)),
          yearly: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, median: median(v), n: v.length })) });
      }
    }
    return [out];
  }
  // As public.wq_state_trend_for_sites: the latest state band per indicator and the 10-year trend, for the matched sites asked about.
  function lawa(wq, args, demoLawa) {
    const out = [];
    for (const id of list(args.p_sites)) {
      const base = { monitoring_site_id: id, lawa_site_id: "demo-lawa-" + id, release: "27oct2026", attribution: "Data sourced from LAWA (Land, Air, Water Aotearoa) and Environment Canterbury (invented demo values)." };
      const mine = LAWA[id] || [];
      for (const [indicator, attribute, band] of mine) out.push({ ...base, kind: "state", indicator, attribute, unit: null, state: band, period: "hYear 2025", trend_score: null, trend_description: null });
      for (const [indicator, , , description, score] of mine) out.push({ ...base, kind: "trend", indicator, attribute: null, unit: null, state: description, period: "10 years", trend_score: score, trend_description: description });
      if (!mine.length) for (const r of list(demoLawa(id))) if (r.kind === "state" || (r.kind === "trend" && r.period === "10 years"))
        out.push({ monitoring_site_id: id, lawa_site_id: r.lawa_site_id, kind: r.kind, indicator: r.indicator, attribute: r.attribute || null, unit: r.unit || null, state: r.state,
          period: r.period, trend_score: r.trend_score ?? null, trend_description: r.trend_description || null, release: r.release, attribution: r.attribution });
    }
    return [out];
  }
  // As public.measurements read by the page for the ticked sites (its own policies: the viewer's readable rows only).
  function measurements(wq, viewer) {
    const out = [];
    for (const [k, rows] of Object.entries(wq.series)) {
      const [id, key] = k.split("|"), site = Number(id);
      if (!readable(wq, viewer, site)) continue;
      for (const r of rows) out.push({ ...r, site_id: site, parameter: key, method: r.method ?? null, lab: r.lab ?? "", source_parameter: r.source_parameter || (wq.params[key]?.[0] ?? key) });
    }
    return out;
  }
  // As public.places (kind area) for the group and the sub-groups the viewer is on; as public.subgroup_counts for the parent group.
  function places(wq, viewer, GROUP) {
    if (!wq.page) return null;
    return [{ id: "demo-g-area", org_id: GROUP, kind: "area", valid_to: null, geom: wq.page.area },
      ...(viewer === "sub" ? [{ id: "demo-sub-a-area", org_id: SUB_A, kind: "area", valid_to: null, geom: wq.page.subAreas[SUB_A] }] : [])];
  }
  const subgroups = (viewer) => [SUB_A, SUB_B].map((id) => ({ subgroup_id: id, subgroup_name: SUB_NAMES[id], subgroup_slug: null, current_businesses: 0, is_member: viewer === "sub" && id === SUB_A }));
  // As public.monitoring_sites for NIWA's network sites (shared: every signed-in person reads them).
  const niwaSites = (wq) => wq.sites.filter((s) => s.niwa).map((s) => ({ id: s.site_id, external_id: s.external_id, name: s.name, site_type: s.site_type, source_key: s.source_key,
    geom: s.geom, farm_id: null, org_id: null }));
  // The supporting layers' reads for the MCCC-like demo (invented shapes): reference_view_features for groundwater allocation zones,
  // lakes and wells, and waterways_in_view for the rivers. [data] or null for anything else.
  const ring = (pts) => [pts.concat([pts[0]])];
  const SUPPORT = {
    "ecan-gw-allocation-zones": [{ id: 98001, geometry: { type: "Polygon", coordinates: ring([[171.93, -43.09], [172.04, -43.09], [172.05, -42.93], [171.93, -42.93]]) }, properties: { name: "Ford Plains zone (synthetic)" } },
      { id: 98002, geometry: { type: "Polygon", coordinates: ring([[172.04, -43.09], [172.15, -43.09], [172.15, -42.93], [172.05, -42.93]]) }, properties: { name: "Hill Terraces zone (synthetic)" } }],
    "linz-topo50-lake-polygons": [{ id: 98101, geometry: { type: "Polygon", coordinates: ring([[172.113, -42.958], [172.127, -42.957], [172.129, -42.951], [172.115, -42.95]]) }, properties: { name: "Hill Lake (synthetic)" } }],
    "ecan-wells": [[171.991, -42.986], [172.0, -42.99], [172.071, -43.021], [172.03, -42.966], [172.1, -42.971]].map((c, i) => ({ id: 98200 + i, geometry: { type: "Point", coordinates: c }, properties: { name: "Bore (synthetic)" } })),
  };
  const RIVERS = [["Ford Stream (synthetic)", [[171.95, -42.94], [171.965, -42.99], [171.985, -43.035], [172.0, -43.085]], 5],
    ["Mill Drain (synthetic)", [[172.06, -42.97], [172.09, -43.02], [172.11, -43.06], [172.13, -43.085]], 4]];
  function support(name, args) {
    const inBox = (c) => c[0] >= Math.min(args.x0, args.x1) - 0.2 && c[0] <= Math.max(args.x0, args.x1) + 0.2;
    if (name === "reference_view_features" && SUPPORT[args.source]) {
      const f = SUPPORT[args.source].filter((x) => inBox(x.geometry.type === "Point" ? x.geometry.coordinates : x.geometry.coordinates[0][0])).map((x) => ({ type: "Feature", ...x }));
      return [{ features: { type: "FeatureCollection", features: f }, total_in_box: f.length, truncated: false }];
    }
    if (name === "waterways_in_view") return [RIVERS.map(([n, coords, order], i) => ({ id: 98300 + i, web_geom: { type: "LineString", coordinates: coords }, named: true, name: n,
      order_class: order >= 5 ? "river" : "stream", stream_order_min: order, stream_order_max: order }))];
    return null;
  }
  return { waterType: (t) => W().waterType(t), support, AREA, SUB_A, SUB_B, SUB_NAMES, SITES, LAWA, extend, readable, figures, lawa, measurements, places, subgroups, niwaSites };
});
