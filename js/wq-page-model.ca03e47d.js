// WQV1: a group's Water quality page, the pure parts (wq-page.js draws them). One consistent picture of every monitoring site and result a
// person can read in a group's area, whatever its source (ECan, NIWA, the group's own or a sub-group's own sampling): surface water and
// groundwater kept apart (wq-model.js waterType, mirrored by public.wq_water_type), one measure at a time as a family (nitrate-N and
// nitrate-nitrite-N are "Nitrate", never pooled: each site's line is one key), the method of every result in view (lab solid, field
// hollow: methodKind, mirrored by public.wq_method_kind), N2c's one useful-sites rule (wq-sites-model.js isCurrent) applied per measure,
// LAWA's published 10-year trend as the only class (nothing is graded here), and the same rows behind the headline figures, the map, the
// chart and the table. No DOM, network or clock.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./wq-model.js") : root.FP.wqModel, node ? require("./wq-sites-model.js") : root.FP.wqSitesModel,
    node ? require("./group-wq-answer.js") : root.FP.groupWqAnswer);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.wqPageModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (W, S, G) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const fmt = (n) => Number(n || 0).toLocaleString("en-NZ");
  const plural = (n, one, many) => fmt(n) + " " + (Number(n) === 1 ? one : many);
  const YEAR = 365.25 * 86400000;

  // ---- water types -------------------------------------------------------------------------------------------------------------
  // The page's two views; a site of no known type is shown with surface water ("surface water?") and counted as needing a type.
  const TYPES = [["surface", "Surface water"], ["groundwater", "Groundwater"]];
  const TYPE_WORDS = { surface: "Surface water", groundwater: "Groundwater", other: "Other (not shown)", unknown: "Not recorded (shown with surface water)" };
  const viewOf = (type) => (type === "groundwater" ? "groundwater" : type === "surface" || type === "unknown" ? "surface" : null);

  // ---- methods -------------------------------------------------------------------------------------------------------------------
  // How a result was measured, as public.wq_method_kind (migration 20261113071000) has it: lab, field (a meter or probe), strip (a test
  // strip or kit) or unrecorded (an owned dataset that does not say). A council's or NIWA's result (shared) is a laboratory result unless
  // its parameter name says field ("Turbidity (Field)").
  // The order matters (review of #532, on the production texts): a lab named in `lab` is a laboratory result; otherwise the method
  // text decides from its start and its negations, never from any word in it: a text that begins "Not stated", "Not recorded" or
  // "Unknown" is not recorded; "not a laboratory result" / "not a lab ..." is taken out before matching; then strip words, then field
  // words, then laboratory words.
  const UNRECORDED = /^(not stated|not recorded|unknown)/, NOT_LAB = /not an? (laboratory|lab)\b[a-z ]*/g;
  const STRIP = /(\bstrips?\b|dip ?stick|test kit|colou?r ?card|aquachek)/, LAB = /(\blab|laborator|hill lab|analytica|eurofins|watercare)/;
  const FIELD = /(\bfield\b|\bmeters?\b|\buv\b|\bprobes?\b|\bsonde|\bsensors?\b|nitratax|in.?situ|hand.?held|portable|\bysi\b|trios|\bsuna\b)/;
  function methodKind(method, lab, sourceParameter, shared) {
    if (String(lab ?? "").trim()) return "lab";
    const raw = String(method ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (UNRECORDED.test(raw)) return "unrecorded";
    const m = raw.replace(NOT_LAB, " ");
    if (STRIP.test(m)) return "strip";
    if (FIELD.test(m)) return "field";
    if (LAB.test(m)) return "lab";
    if (/\bfield\b/.test(String(sourceParameter ?? "").toLowerCase())) return "field";
    return shared ? "lab" : "unrecorded";
  }
  const METHOD_WORDS = { lab: "laboratory", field: "field meter", strip: "test strip", unrecorded: "method not recorded" };
  const hollow = (kind) => kind === "field" || kind === "strip";

  // ---- measures --------------------------------------------------------------------------------------------------------------------
  // key: the summary's family (WQ1); keys: the parameter keys it holds. The first few for each water type lead; the rest are under More.
  const MEASURES = [
    { key: "nitrate", name: "Nitrate", keys: ["nitrate-n", "nitrate-nitrite-n"], unit: "mg/L" },
    { key: "e-coli", name: "E. coli", keys: ["e-coli"], unit: "/100 mL" },
    { key: "drp", name: "Dissolved reactive phosphorus", short: "Phosphorus (DRP)", keys: ["drp"], unit: "mg/L" },
    { key: "clarity", name: "Clarity", keys: ["clarity"], unit: "m" },
    { key: "tp", name: "Total phosphorus", keys: ["tp"], unit: "mg/L" },
    { key: "turbidity", name: "Turbidity", keys: ["turbidity"], unit: "NTU" },
    { key: "ammoniacal-n", name: "Ammoniacal nitrogen", keys: ["ammoniacal-n"], unit: "mg/L" },
    { key: "tn", name: "Total nitrogen", keys: ["tn"], unit: "mg/L" },
    { key: "tss", name: "Total suspended solids", keys: ["tss"], unit: "mg/L" },
    { key: "conductivity", name: "Conductivity", keys: ["conductivity"], unit: "µS/cm" },
    { key: "temperature", name: "Water temperature", keys: ["temperature"], unit: "°C" },
    { key: "dissolved-oxygen", name: "Dissolved oxygen", keys: ["dissolved-oxygen"], unit: "mg/L" },
    { key: "ph", name: "pH", keys: ["ph"], unit: "pH units" },
  ];
  const FIRST = { surface: ["nitrate", "e-coli", "drp", "clarity"], groundwater: ["nitrate", "e-coli"] };
  const measure = (key) => MEASURES.find((m) => m.key === key) || null;
  const measuresFor = (type) => {
    const first = FIRST[type] || FIRST.surface;
    return { first: first.map(measure), more: MEASURES.filter((m) => !first.includes(m.key)) };
  };
  const KEY_NAMES = { "nitrate-n": "nitrate-N", "nitrate-nitrite-n": "nitrate+nitrite-N" };
  const keyName = (key) => KEY_NAMES[key] || measure(key)?.name || key;

  // ---- periods -------------------------------------------------------------------------------------------------------------------
  const PERIODS = [["all", "All years"], ["10", "Last 10 years"], ["5", "Last 5 years"]];
  const periodFrom = (period, now) => (period === "10" || period === "5" ? new Date(now - Number(period) * YEAR).toISOString() : null);
  const periodWords = (period) => (PERIODS.find(([k]) => k === period)?.[1] || "All years").toLowerCase();

  // ---- sites ----------------------------------------------------------------------------------------------------------------------
  // rows: group_wq_sites (the group's area: ECan and the own sites the person may read) and NIWA's sites in or near the area, in their
  // shape. ctx: { org, names (Map id -> name of the person's organisations) }.
  function sites(rows, { org = null, names = null } = {}) {
    const seen = new Set();
    return list(rows).filter((r) => r && r.site_id != null && !seen.has(r.site_id) && seen.add(r.site_id)).map((r) => {
      const type = W.waterType(r.site_type);
      // a shared well is named by its number alone (never its locality or use: for a household bore its results are its drinking water)
      const well = type === "groundwater" && !(r.owner_org_id || r.owner_farm_id) && text(r.external_id);
      return { id: r.site_id, name: well || text(r.name) || text(r.external_id) || "Monitoring site", externalId: text(r.external_id), siteType: text(r.site_type),
        type, view: viewOf(type), source: W.sourceLabel(r, { org, names }), sourceKey: r.source_key || null, ownerOrg: r.owner_org_id || null,
        own: !!(r.owner_org_id || r.owner_farm_id), shared: !(r.owner_org_id || r.owner_farm_id), lngLat: W.siteLngLat(r.geom),
        lastSampled: r.last_sampled || null, distance_m: Number(r.distance_m) || 0,
        // a well's depth where its source holds one (wq_area_sites depth_m): it matters for reading groundwater nitrate
        below: W.belowDischarge(r.site_type),
        depth: r.depth_m != null && r.depth_m !== "" && Number.isFinite(Number(r.depth_m)) && Number(r.depth_m) > 0 ? Number(r.depth_m) : null };
    });
  }
  // "42 m deep", quietly beside a well's name; nothing where no depth is held.
  const depthText = (s) => (s?.depth ? fmt(Number(s.depth.toPrecision(3))) + " m deep" : "");
  // The quiet words beside a site's name: a well's depth; "below a discharge" for a site the source says is not ambient.
  const tagsOf = (s) => [depthText(s), s?.below ? "below a discharge" : ""].filter(Boolean).join(" · ");
  // Which form of the measure a row's figures are (only where the measure has more than one): "as nitrate-N".
  const keyLine = (r, measureKey) => ((measure(measureKey)?.keys.length || 0) > 1 && r?.key ? "as " + keyName(r.key) : "");
  const KEY_RULE = "Each site uses the form of the measure with the most laboratory results (for nitrate: nitrate-N or nitrate+nitrite-N); the two are never pooled.";
  // The sites whose type is not known: coordinators are told how many (a person fixes the data, never this page).
  const needsType = (all) => list(all).filter((s) => s.type === "unknown");
  // Where a sub-group is chosen: its own sites, and the shared ones inside its area (rings: [[lng, lat], ...] lists of its area).
  function inRings(p, rings) {
    if (!p) return false;
    let inside = false;
    for (const ring of list(rings)) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // The rings of a GeoJSON polygon or multipolygon in NZTM (as places holds it) or degrees, as [lng, lat] lists.
  function rings(geom) {
    let g = geom;
    if (typeof g === "string") { try { g = JSON.parse(g); } catch { return []; } }
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    const deg = (c) => (Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90 ? [c[0], c[1]] : W.nztmToLngLat(c[0], c[1]));
    return polys.flatMap((poly) => list(poly).map((ring) => list(ring).filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map(deg)));
  }
  // The NIWA sites within km of the area (rings, degrees): each point's distance to the area by an equirectangular step, enough at 5 km.
  function near(p, rs, km) {
    if (!p) return false;
    if (inRings(p, rs)) return true;
    const kx = 111.32 * Math.cos((p[1] * Math.PI) / 180), ky = 111.2;
    for (const ring of rs) for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
      const dx = (bx - ax) * kx, dy = (by - ay) * ky, px = (p[0] - ax) * kx, py = (p[1] - ay) * ky, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
      if (Math.hypot(px - t * dx, py - t * dy) <= km) return true;
    }
    return false;
  }
  function filterSites(all, { type = "surface", sub = null, subRings = null } = {}) {
    return list(all).filter((s) => s.view === type && (!sub || s.ownerOrg === sub || (!s.own && inRings(s.lngLat, subRings))));
  }

  // ---- the rows: one per site of the chosen measure ---------------------------------------------------------------------------------
  // summary: { site id: site_record_summary row of the measure's family } (n over the whole record, last_sampled); figures: rows of
  // public.wq_site_figures (one per site and key); lawa: { site id: rows of public.wq_state_trend_for_sites }.
  // A shared site with no result of the measure is not a row; one with results is shown when N2c's rule says it is current (a result in
  // the last 5 years and at least 12 results of this measure), and under the switch otherwise ("held"). Own sites are always shown.
  // Each site's figures are one key: the one with the most laboratory results, then the most results (never two keys pooled).
  function pickFigure(rows) {
    return [...list(rows)].sort((a, b) => (b.n_lab || 0) - (a.n_lab || 0) || (b.n || 0) - (a.n || 0) || String(a.parameter).localeCompare(String(b.parameter)))[0] || null;
  }
  function rowsFor(sitesIn, { summary = {}, figures = [], lawa = {}, measureKey = "nitrate", now = Date.now() } = {}) {
    const byId = new Map();
    for (const f of list(figures)) byId.set(f.site_id, [...(byId.get(f.site_id) || []), f]);
    const out = [];
    for (const s of list(sitesIn)) {
      const sum = summary[s.id] || null, f = pickFigure(byId.get(s.id));
      if (!s.own && !sum && !f) continue;   // a shared site with none of this measure: not a row
      const lastAt = sum?.last_sampled ? Date.parse(sum.last_sampled) : f?.last_sampled ? Date.parse(f.last_sampled) : null;
      const counted = sum ? Number(sum.n) : f ? Number(f.n) : null;
      const current = S.isCurrent({ owned: s.own, lastAt: Number.isFinite(lastAt) ? lastAt : null, counted: counted ?? 0 }, now);
      const cls = classOf(lawa[s.id], measureKey);
      out.push({ ...s, current, held: !current, key: f?.parameter || null, keyName: f?.parameter ? keyName(f.parameter) : null, unit: f?.unit || measure(measureKey)?.unit || "",
        n: f?.n || 0, nLab: f?.n_lab || 0, nField: (f?.n_field || 0) + (f?.n_strip || 0), nStrip: f?.n_strip || 0, nUnrecorded: f?.n_unrecorded || 0, nCensored: f?.n_censored || 0,
        first: f?.first_sampled || null, last: f?.last_sampled || null, recordN: counted, recordLast: Number.isFinite(lastAt) ? new Date(lastAt).toISOString() : null,
        latestText: f?.latest_text ?? null, latestAt: f?.latest_at || null, latestMethod: f?.latest_method || null,
        median: f?.median == null ? null : Number(f.median), medianN: f?.median_n || 0, medianCensored: !!f?.median_censored, yearly: list(f?.yearly),
        trend: cls.trend, trendWords: cls.trendWords, band: cls.band, bandWords: cls.bandWords,
        // the site's other keys of the family: said and drawn on its own chart, never in its figures
        also: list(byId.get(s.id)).filter((x) => x !== f).map((x) => ({ key: x.parameter, keyName: keyName(x.parameter), n: x.n || 0, nLab: x.n_lab || 0, nField: (x.n_field || 0) + (x.n_strip || 0), nUnrecorded: x.n_unrecorded || 0 })) });
    }
    return out;
  }
  // The rows shown: every current row, and the held ones too when the switch is on. hidden: how many the switch would add.
  const shownRows = (rows, showAll = false) => list(rows).filter((r) => showAll || !r.held);
  const hiddenCount = (rows) => list(rows).filter((r) => r.held).length;

  // ---- LAWA's trend: the only class on the page ----------------------------------------------------------------------------------
  // LAWA's published 10-year trend of the measure's indicator (group-wq-answer.js lawaOf matches the indicator, as the group's answer and
  // the Maps panel read it), as one of three classes, and its latest state band. Nothing is graded here.
  const CLASSES = [["degrading", "Getting worse"], ["indeterminate", "No clear trend"], ["improving", "Getting better"]];
  const CLASS_COLOURS = { improving: "#4a8fc8", indeterminate: "#c4b17e", degrading: "#d8773c", none: "#8e8e96" };
  function classOf(rows, measureKey) {
    const m = measure(measureKey), param = m?.keys[0] || measureKey;
    const l = list(rows).length ? G.lawaOf(rows, param) : null;
    const t = l?.trend?.find((x) => /^10 years$/.test(text(x.period))) || null, d = text(t?.description).toLowerCase();
    const trend = !t ? null : /improving/.test(d) ? "improving" : /degrading/.test(d) ? "degrading" : /indeterminate/.test(d) ? "indeterminate" : null;
    const s = l?.state?.[0] || null;
    return { trend, trendWords: t ? t.description : null, band: s ? s.band : null, bandWords: s ? s.attribute + " band " + s.band + (s.period ? " (" + s.period + ")" : "") : null };
  }

  // ---- the headline figures: from the rows shown, so they always equal the table ---------------------------------------------------
  function headline(rows) {
    const r = list(rows), withResults = r.filter((x) => x.n > 0);
    const latest = withResults.map((x) => x.last).filter(Boolean).sort().pop() || null;
    const classes = Object.fromEntries(CLASSES.map(([k]) => [k, r.filter((x) => x.trend === k).length]));
    const assessed = CLASSES.reduce((n, [k]) => n + classes[k], 0);
    return { sites: withResults.length, samples: withResults.reduce((n, x) => n + x.n, 0), latest, classes, assessed, rows: r.length,
      field: withResults.reduce((n, x) => n + x.nField, 0), own: r.filter((x) => x.own).length };
  }
  // The one plain sentence under the figures.
  function sentence(h, measureKey, type) {
    const name = measure(measureKey)?.name || measureKey;
    if (!h.rows) return "No " + (type === "groundwater" ? "groundwater" : "surface water") + " site here has " + lower(name) + " results.";
    if (!h.assessed) return type === "groundwater" ? "LAWA publishes trends for river sites only. Open a site to see its results."
      : "LAWA publishes no 10-year trend of " + lower(name) + " at these sites. Open a site to see its results.";
    const c = h.classes, rest = [c.improving ? "better at " + fmt(c.improving) : "", c.indeterminate ? "no clear trend at " + fmt(c.indeterminate) : ""].filter(Boolean);
    return name + " is getting worse at " + fmt(c.degrading) + " of the " + plural(h.assessed, "site", "sites") + " LAWA assessed over 10 years" + (rest.length ? "; " + rest.join(", ") : "") + ".";
  }
  // What the classes rest on, said beside the bar so it is not read as the whole group's picture: "LAWA assesses 35 of the 120
  // surface-water sites here." Nothing for groundwater (LAWA reports rivers only) or when there are no sites.
  const basis = (h, type) => (type === "groundwater" || !h.rows ? null
    : "LAWA assesses " + fmt(h.assessed) + " of the " + plural(h.rows, "surface-water site", "surface-water sites") + " here.");
  const lower = (name) => (/^E\. coli/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));
  // The stacked bar's parts, in order, each with its share (0 to 1).
  const bar = (h) => CLASSES.map(([k, label]) => ({ key: k, label, n: h.classes[k], share: h.assessed ? h.classes[k] / h.assessed : 0, colour: CLASS_COLOURS[k] })).filter((x) => x.n);

  // ---- symbols: one set for every source --------------------------------------------------------------------------------------------
  // Shape by water type (circle surface water, square groundwater); colour by LAWA's trend when there is one, else a quiet neutral
  // dot; a ring for the group's own sites (its sub-groups' too); paler and smaller for an older or sparse site shown by the switch.
  function symbol(row) {
    const shape = row.type === "groundwater" ? "square" : "circle", cls = row.trend || "none";
    return { shape, cls, ring: !!row.own, faded: !!row.held, icon: ["wq", shape, cls, row.own ? "own" : "pub", row.held ? "faded" : "full"].join("-") };
  }
  const ICONS = (() => { const out = []; for (const shape of ["circle", "square"]) for (const cls of [...CLASSES.map(([k]) => k), "none"]) for (const own of [true, false]) for (const held of [true, false]) out.push({ shape, cls, ring: own, faded: held, icon: ["wq", shape, cls, own ? "own" : "pub", held ? "faded" : "full"].join("-") }); return out; })();
  // RF1: on a phone, sites closer than `radius` px at the zoom shown are one cluster mark (MapLibre's clustering) until `maxZoom`; the
  // mark is a dark ink circle with a thin light edge and the count, never a colour that reads as a state. Each site is a 44 px target
  // (`hit` px round it). Trend colours on the map are LAWA's 10-year trend, never a grade, and the key says so.
  const CLUSTER = { radius: 26, maxZoom: 14, hit: 22, ink: "#1d1d1f", edge: "rgba(255,255,255,0.9)" };
  const CLUSTER_WORDS = "Several sites close together: tap to zoom in";
  const TREND_NOT_GRADE = "Colour is LAWA's published 10-year trend of the chosen measure (getting better, worse, or no clear trend), not a grade of the water. LAWA reports river sites only.";
  // Whether any site drawn (one with a place) is coloured by a LAWA trend
  const trendsShown = (rows) => list(rows).some((r) => r && r.lngLat && r.trend !== "none" && !!CLASS_COLOURS[r.trend]);
  // The site nearest a tap among the targets under it ([{ id, at: {x, y} }], point {x, y}); null when none
  function nearestSite(targets, point) {
    let best = null, d = Infinity;
    for (const t of list(targets)) {
      if (!t || !Number.isFinite(t.id) || !t.at) continue;
      const dd = Math.hypot(t.at.x - point.x, t.at.y - point.y);
      if (dd < d) { d = dd; best = t.id; }
    }
    return best;
  }
  // The legend, the same on the map, beside the chart and under the table.
  function legend({ type = "surface", own = true, held = false } = {}) {
    const shape = type === "groundwater" ? "square" : "circle";
    return [
      { shape, cls: "none", label: type === "groundwater" ? "Groundwater site (well or bore)" : "Surface water site (river, stream, drain, lake)" },
      ...(own ? [{ shape, cls: "none", ring: true, label: "The group's own sampling (its sub-groups' too)" }] : []),
      // LAWA reports rivers only: a groundwater legend has no trend classes
      ...(type === "groundwater" ? [] : [...CLASSES.map(([k, label]) => ({ shape, cls: k, label: label + " (LAWA, 10 years)" })), { shape, cls: "none", label: "No LAWA trend" }]),
      ...(held ? [{ shape, cls: "none", faded: true, label: "Older or sparse site" }] : []),
    ];
  }

  // ---- the table ------------------------------------------------------------------------------------------------------------------
  const COLUMNS = [["name", "Site"], ["source", "Source"], ["typeWords", "Water type"], ["n", "Results"], ["first", "First"], ["last", "Last"], ["latestText", "Latest"], ["median", "Median"], ["trendWords", "LAWA trend"]];
  function sortRows(rows, key = "own", dir = "asc") {
    const k = (r) => (key === "own" ? (r.own ? 0 : 1) : key === "typeWords" ? TYPE_WORDS[r.type] : key === "latestText" ? r.latestAt : r[key]);
    const sign = dir === "desc" ? -1 : 1;
    return [...list(rows)].sort((a, b) => {
      const x = k(a), y = k(b);
      if (x == null && y == null) return a.name.localeCompare(b.name);
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sign * c || (key === "own" ? (b.last || "").localeCompare(a.last || "") : 0) || a.name.localeCompare(b.name);
    });
  }
  const medianText = (r) => (r.median == null ? "–" : (r.medianCensored ? "≈" : "") + S.tidy(r.median) + (r.unit ? " " + r.unit : ""));
  const latestText = (r) => (r.latestText == null ? "–" : S.tidy(r.latestText) + (r.unit ? " " + r.unit : ""));
  const methodsText = (r) => [r.nLab ? fmt(r.nLab) + " lab" : "", r.nField ? fmt(r.nField) + " field" : "", r.nUnrecorded ? fmt(r.nUnrecorded) + " method not recorded" : ""].filter(Boolean).join(", ");
  // The download: the rows shown, as the person read them (the database's rules decided what came back), with the formula guard
  // (people-model.js toCsv: a cell that starts = + - @ is written as text).
  const CSV_COLUMNS = [["name", "Site"], ["externalId", "Site id"], ["source", "Source"], ["typeWords", "Water type"], ["siteType", "Site type as recorded"],
    ["keyName", "Measured as"], ["unit", "Unit"], ["n", "Results"], ["nLab", "Laboratory results"], ["nField", "Field or test-strip results"], ["nUnrecorded", "Method not recorded"],
    ["first", "First sample"], ["last", "Last sample"], ["latestText", "Latest result"], ["latestAt", "Latest date"], ["latestMethodWords", "Latest method"],
    ["medianOut", "Median"], ["trendWords", "LAWA trend (10 years)"], ["band", "LAWA band"], ["shown", "Shown by default"]];
  const day = (t) => (t ? new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date(t)) : "");
  function csv(rows, toCsv) {
    return toCsv(CSV_COLUMNS, list(rows).map((r) => ({ ...r, typeWords: TYPE_WORDS[r.type], first: day(r.first), last: day(r.last), latestAt: day(r.latestAt),
      latestMethodWords: METHOD_WORDS[r.latestMethod] || "", medianOut: r.median == null ? "" : (r.medianCensored ? "about " : "") + S.tidy(r.median), trendWords: r.trendWords || "", band: r.band || "",
      shown: r.held ? "no (older or sparse)" : "yes" })));
  }
  const fileName = (group, measureKey, type, today) => [group, "water quality", type, measure(measureKey)?.name || measureKey, today].join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".csv";

  // ---- ticks and the chart ---------------------------------------------------------------------------------------------------------
  const MAX_TICKED = S.MAX_CHOSEN;
  // The sites ticked when the page opens: the group's own with results first, then the current sites with the most results; three.
  function defaultTicks(rows, n = 3) {
    const r = list(rows).filter((x) => x.n > 0);
    return [...r.filter((x) => x.own), ...r.filter((x) => !x.own).sort((a, b) => b.n - a.n)].slice(0, n).map((x) => x.id);
  }
  const tick = (ticked, id) => (list(ticked).includes(id) ? list(ticked).filter((x) => x !== id) : list(ticked).length >= MAX_TICKED ? list(ticked) : [...list(ticked), id]);
  // The tick list beside the chart: the group's own first, then the rest by their latest result.
  const tickList = (rows) => [...list(rows).filter((x) => x.own && x.n > 0), ...list(rows).filter((x) => !x.own && x.n > 0).sort((a, b) => String(b.last).localeCompare(String(a.last)))];
  // A site's results as the chart block draws them: one key (the row's), field and test-strip readings hollow, censored ones as N2 draws
  // them. series: rows read from public.measurements (method, lab, source_parameter, source_key with each).
  function points(series, key, shared) {
    return list(series).filter((r) => r && r.parameter === key && r.value !== null && r.value !== undefined).map((r) => ({
      t: r.sampled_at, value: Number(r.value), qualifier: W.isCensored(r) ? r.qualifier : null, text: W.reportedText(r),
      field: hollow(methodKind(r.method, r.lab, r.source_parameter, shared)) }));
  }
  function chartData({ rows, seriesBySite, measureKey, period }) {
    const m = measure(measureKey), r = list(rows), keys = [...new Set(r.map((x) => x.key).filter(Boolean))];
    const series = r.map((x) => ({ id: "site-" + x.id, label: x.name + (keys.length > 1 && x.key ? " (" + keyName(x.key) + ")" : ""), owner: x.source, points: points(seriesBySite?.[x.id], x.key, x.shared) }));
    // groundwater: never the NPS-FM's river bands; the drinking-water limit as a reference line (wq-sites-model.js drinkingWater)
    const gw = r.some((x) => x.type === "groundwater"), bands = keys.length === 1 ? S.bandsFor(keys[0], r) : null;
    return { title: (m?.name || measureKey) + (r.length === 1 ? " at " + r[0].name : " at " + plural(r.length, "site", "sites")) + ", " + periodWords(period),
      parameter: { key: measureKey, name: m?.name || measureKey, unit: r.find((x) => x.unit)?.unit || m?.unit || "" }, palette: "sites",
      ...(gw ? { limits: keys.length === 1 ? S.drinkingWater(keys[0]) : [] } : {}),
      ...(bands ? { bands } : { assess: gw ? S.GROUNDWATER_WORDS : keys.length > 1 ? "Nitrate-N and nitrate-nitrite-N are drawn as they were measured, each site its own line; never pooled." : "The NPS-FM has no bands for this measure here." }),
      series };
  }
  // One site on its own: every key of the measure it holds, each its own line (nitrate-N from a field meter beside the laboratory's
  // nitrate-nitrite-N), never joined or pooled. series: the site's rows of the measure's keys.
  function siteChartData({ row, series, measureKey, period }) {
    const m = measure(measureKey), keys = [...new Set(list(series).map((r) => r?.parameter).filter(Boolean))].sort((a, b) => (a === row.key ? -1 : b === row.key ? 1 : a.localeCompare(b)));
    const gw = row.type === "groundwater", one = keys.length <= 1, bands = keys.length && keys.every((k) => S.ATTRIBUTE_OF[k] === S.ATTRIBUTE_OF[keys[0]]) ? S.bandsFor(keys[0], [row]) : null;
    return { title: (m?.name || measureKey) + " at " + row.name + ", " + periodWords(period), parameter: { key: measureKey, name: m?.name || measureKey, unit: row.unit || m?.unit || "" },
      ...(one ? {} : { palette: "sites" }), ...(bands ? { bands } : { assess: gw ? S.GROUNDWATER_WORDS : "The NPS-FM has no bands for this measure here." }),
      ...(gw ? { limits: S.drinkingWater(keys[0] || row.key) } : {}),
      series: (keys.length ? keys : [row.key]).map((k, i) => ({ id: "site-" + row.id + "-" + k, label: one ? row.name : keyName(k), owner: one ? row.source : "", ...(i ? { part: true, note: "another key, its own line" } : {}),
        points: points(series, k, row.shared) })) };
  }
  // The direction for the group: per year, the median of the sites' own yearly medians (each site counts once a year, whichever way it
  // was sampled most), over the rows shown that have at least one; a year with fewer than MIN_YEAR_SITES sites is left out.
  const MIN_YEAR_SITES = 3;
  function medianByYear(rows) {
    const byYear = new Map();
    for (const r of list(rows)) for (const y of list(r.yearly)) if (y && Number.isFinite(Number(y.median))) byYear.set(y.year, [...(byYear.get(y.year) || []), Number(y.median)]);
    const med = (v) => { const s = [...v].sort((a, b) => a - b), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
    return [...byYear.entries()].filter(([, v]) => v.length >= MIN_YEAR_SITES).sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, median: Number(med(v).toPrecision(3)), sites: v.length }));
  }
  function medianChart(rows, measureKey, period) {
    const m = measure(measureKey), years = medianByYear(rows), unit = list(rows).find((x) => x.unit)?.unit || m?.unit || "";
    return { title: (m?.name || measureKey) + ": the median of the sites' yearly medians, " + periodWords(period),
      parameter: { key: measureKey, name: m?.name || measureKey, unit }, assess: "Each year is the middle value of the sites' own yearly medians (" + MIN_YEAR_SITES + " sites or more); it shows the direction, not a grade.",
      series: [{ id: "median", label: "Median of the sites' yearly medians", points: years.map((y) => ({ t: Date.UTC(y.year, 6, 1), value: y.median, text: String(y.median) + " (" + y.sites + " sites)" })) }] };
  }

  // ---- words ----------------------------------------------------------------------------------------------------------------------
  const sourcesLine = (all) => { const names = [...new Set(list(all).map((s) => s.source))].sort((a, b) => rank(a) - rank(b)); return names.length ? "Sources: " + (names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]) + "." : ""; };
  const rank = (s) => (s === "This group's own" ? 0 : /'s? own$/.test(s) ? 1 : 2);
  const fieldNote = (h, includeField) => (!h.field ? "" : includeField ? "Medians include " + plural(h.field, "field or test-strip reading", "field or test-strip readings") + "."
    : "Medians use laboratory results (and results whose method is not recorded); " + plural(h.field, "field or test-strip reading is", "field or test-strip readings are") + " left out.");
  // Said once, quietly, to someone in a group with sub-groups they are not on: nothing about what those sub-groups hold (no count, no names).
  const NOT_SHARED = "A sub-group's own results are seen only by the people on that sub-group.";
  const HELD_WORDS = S.HELD_WORDS;
  const whenText = (t) => (t ? W.date(t) : "–");

  return { TYPES, TYPE_WORDS, viewOf, methodKind, METHOD_WORDS, hollow, MEASURES, FIRST, measure, measuresFor, keyName, PERIODS, periodFrom, periodWords,
    sites, depthText, tagsOf, keyLine, KEY_RULE, needsType, inRings, rings, near, filterSites, pickFigure, rowsFor, shownRows, hiddenCount, CLASSES, CLASS_COLOURS, classOf, headline, sentence, basis, bar,
    symbol, ICONS, legend, CLUSTER, CLUSTER_WORDS, TREND_NOT_GRADE, trendsShown, nearestSite, COLUMNS, sortRows, medianText, latestText, methodsText, CSV_COLUMNS, csv, fileName, MAX_TICKED, defaultTicks, tick, tickList,
    points, chartData, siteChartData, MIN_YEAR_SITES, medianByYear, medianChart, sourcesLine, fieldNote, NOT_SHARED, HELD_WORDS, whenText };
});
