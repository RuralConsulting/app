// MC1: a group's overview on a computer, the pure parts (group-overview.js reads and draws). On a computer a group's Home is its
// overview (docs/PRODUCT.md, "Home"): a few headline numbers, the water quality trends, and the map of the group's area and its
// sub-groups, with a ranked list beside it and one filter (sub-group, period) for the whole page. A phone keeps Home as it is.
// No DOM, no reads, no clock: every input is handed in.
//
// Nothing here calculates a statistic. Each site's trend is the analysis library's (the `analysis` function's preview, exactly as a
// site's panel in Maps asks for it, N2), classed by wq-sites-model.js trendClass, the same fields its trendWords reads, so the
// overview and a site's panel never disagree. The only rule of this file's own is which sites are NOT sent for a trend: those whose
// record cannot meet the library's minimum (fewer sampling times than the rule needs, or nothing sampled near the window), which the
// library would answer "too little data" for anyway; they are counted as too little data without a call.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./wq-model.js") : root.FP.wqModel, node ? require("./wq-sites-model.js") : root.FP.wqSitesModel,
    node ? require("./home-model.js") : root.FP.homeModel);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.groupOverviewModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (W, S, H) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const fin = (v) => Number.isFinite(num(v));
  const YEAR_MS = 365.25 * 86400000;

  // ---- the filter: one for the whole page ----------------------------------------------------------------------------------
  // The period: the numbers count results sampled in it; the trends are over the same years (the whole record: the library's
  // longest window, 20 years, as a site's panel does: wq-sites-model analysisYears).
  const PERIODS = Object.freeze([
    { key: "all", years: 0, label: "All time" },
    { key: "10y", years: 10, label: "Last 10 years" },
    { key: "5y", years: 5, label: "Last 5 years" },
  ]);
  const periodOf = (key) => PERIODS.find((p) => p.key === key) || PERIODS[0];
  // When a period starts: `years` before the day given (an ISO date or time), as an ISO instant; null for all time.
  function since(today, key) {
    const p = periodOf(key), t = Date.parse(String(today || "").slice(0, 10) + "T00:00:00Z");
    if (!p.years || !Number.isFinite(t)) return null;
    const d = new Date(t);
    d.setUTCFullYear(d.getUTCFullYear() - p.years);
    return d.toISOString();
  }
  const trendYears = (key) => S.analysisYears(periodOf(key).years);
  // What the page remembers per person and group (localStorage; the caller wraps it in try/catch).
  const storeKey = (personId, groupId) => "fp-overview:" + String(personId || "anyone") + ":" + String(groupId || "");
  // A stored filter made safe: a sub-group that is no longer one of the group's is dropped, an unknown period is all time.
  function filterFrom(stored, subgroups) {
    let v = stored;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
    const ids = new Set(list(subgroups).map((s) => s.id));
    return {
      sub: v && ids.has(v.sub) ? v.sub : null,
      period: v && PERIODS.some((p) => p.key === v.period) ? v.period : "all",
      sort: v && ["name", "area", "results", "latest"].includes(v.sort) ? v.sort : "name",
    };
  }
  const filterText = (f) => JSON.stringify({ sub: f.sub || null, period: f.period, sort: f.sort });

  // ---- numbers in words ------------------------------------------------------------------------------------------------------
  const count = (n) => (fin(n) ? Math.round(num(n)).toLocaleString("en-NZ") : "");
  // Hectares with no false precision: a tenth under 10 ha, whole hectares under 1,000, the nearest 10 under 10,000, then the
  // nearest 100. Never "0 ha": an area that rounds to nothing (or none) is null, and the tile is left out.
  function hectares(ha) {
    const v = num(ha);
    if (!Number.isFinite(v) || v <= 0) return null;
    const r = v < 10 ? Math.round(v * 10) / 10 : v < 1000 ? Math.round(v) : v < 10000 ? Math.round(v / 10) * 10 : Math.round(v / 100) * 100;
    if (!(r > 0)) return null;
    return r.toLocaleString("en-NZ", { maximumFractionDigits: 1 }) + " ha";
  }
  const plural = (n, one, many) => count(n) + " " + (Number(n) === 1 ? one : many);
  const yearOf = (t) => { const d = Date.parse(t); return Number.isFinite(d) ? new Date(d).getUTCFullYear() : null; };

  // ---- areas (places of kind 'area', EPSG:2193) ---------------------------------------------------------------------------------
  // Polygon rings in NZTM metres, from a GeoJSON geometry (or its text) as the API gives a geometry column; one in degrees is
  // converted. [[outer, ...holes], ...], or null.
  function metreRings(geom) {
    let g = geom;
    if (typeof g === "string") { try { g = JSON.parse(g); } catch { return null; } }
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : null;
    if (!Array.isArray(polys) || !polys.length) return null;
    const first = polys[0]?.[0]?.[0];
    if (!Array.isArray(first) || !fin(first[0]) || !fin(first[1])) return null;
    const degrees = Math.abs(first[0]) <= 180 && Math.abs(first[1]) <= 90;
    return polys.map((p) => list(p).map((ring) => list(ring).map((c) => (degrees ? W.lngLatToNztm(c[0], c[1]) : [Number(c[0]), Number(c[1])]))));
  }
  const ringArea = (ring) => { let a = 0; for (let i = 0, n = ring.length; i < n; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
  const polyArea = (p) => Math.max(0, ringArea(p[0] || []) - p.slice(1).reduce((s, r) => s + ringArea(r), 0));
  // The area of a geometry in hectares (planar in NZTM, whose scale error is under 0.1% across New Zealand); null when unreadable.
  function areaHa(geom) {
    const polys = metreRings(geom);
    if (!polys) return null;
    return polys.reduce((s, p) => s + polyArea(p), 0) / 10000;
  }
  // Where a place's marker sits: the centroid of its largest part (in metres, then degrees), or that part's middle when the
  // centroid can't be worked out.
  function labelPoint(geom) {
    const polys = metreRings(geom);
    if (!polys) return null;
    const big = polys.reduce((a, p) => (polyArea(p) > polyArea(a) ? p : a), polys[0]), ring = big[0] || [];
    let cx = 0, cy = 0, a2 = 0;
    for (let i = 0, n = ring.length; i < n; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n], f = x1 * y2 - x2 * y1; a2 += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; }
    if (a2 && Number.isFinite(cx / (3 * a2))) return W.nztmToLngLat(cx / (3 * a2), cy / (3 * a2));
    const xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1]);
    return xs.length ? W.nztmToLngLat((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2) : null;
  }
  // The places rows (org_id, geom; several current areas of one owner are one area) to: org id -> { ha, at, shape: { geometry, bbox } }.
  // A row with no readable geometry is left out, so a group whose area has no shape counts as having none.
  function areas(rows) {
    const by = new Map();
    for (const r of list(rows)) if (r && r.org_id && r.geom) by.set(r.org_id, [...(by.get(r.org_id) || []), r.geom]);
    const out = new Map();
    for (const [org, geoms] of by) {
      const joined = H.joinAreas(geoms), ha = geoms.reduce((s, g) => s + (areaHa(g) || 0), 0), shape = joined && H.lighten(joined);
      if (!shape || !(ha > 0)) continue;
      out.set(org, { ha, at: labelPoint(joined), shape });
    }
    return out;
  }

  // ---- the sites -----------------------------------------------------------------------------------------------------------
  // reads: [{ org, rows }] (group_wq_sites(org, 0): the sites inside that place's area); all: rows of wq_site_result_counts for all
  // time; period: the same for the period chosen (null: all time). Each site has a row with parameter null (every result) and a row
  // per key asked (KEYS). now: ms. Each site once, with the places it is inside:
  // { id, name, externalId, lngLat, type, kind, orgs, keys: { key: { family, results, times, first, last } }, periodKeys (the same
  //   in the period), families: { family: { keys, times (the most of any key), last } }, results, ownResults, times, first, last,
  //   periodResults, periodOwn, periodLast, recent (a result in the last 5 years), current (N2c: recent, and at least 12 sampling
  //   times; read from the site's every result, so it can only let a sparse site in, never hold a full one back) }
  const KEYS = Object.freeze(["nitrate-n", "nitrate-nitrite-n", "e-coli", "drp", "turbidity"]);
  function sites(reads, all, period, now) {
    const by = new Map();
    for (const { org, rows } of list(reads)) for (const r of list(rows)) {
      if (!r || r.site_id == null) continue;
      const id = Number(r.site_id), s = by.get(id);
      if (s) { if (!s.orgs.includes(org)) s.orgs.push(org); continue; }
      by.set(id, { id, name: String(r.name || r.external_id || "Monitoring site"), externalId: String(r.external_id || ""), lngLat: W.siteLngLat(r.geom),
        type: r.site_type || null, kind: W.waterKind(r.site_type), own: !!(r.owner_org_id || r.owner_farm_id), orgs: [org],
        keys: {}, periodKeys: {}, families: {}, results: 0, ownResults: 0, times: 0, first: null, last: null, periodResults: 0, periodOwn: 0, periodLast: null });
    }
    const one = (c) => ({ family: c.family || c.parameter, results: num(c.results) || 0, times: num(c.sampling_times) || 0, first: c.first_sampled || null, last: c.last_sampled || null });
    for (const c of list(all)) {
      const s = by.get(Number(c?.site_id));
      if (!s) continue;
      if (c.parameter) { s.keys[c.parameter] = one(c); continue; }
      Object.assign(s, { results: num(c.results) || 0, ownResults: num(c.own_results) || 0, times: num(c.sampling_times) || 0, first: c.first_sampled || null, last: c.last_sampled || null });
    }
    for (const s of by.values()) { s.periodResults = s.results; s.periodOwn = s.ownResults; s.periodLast = s.last; s.periodKeys = s.keys; }
    if (period) {
      for (const s of by.values()) { s.periodResults = 0; s.periodOwn = 0; s.periodLast = null; s.periodKeys = {}; }
      for (const c of list(period)) {
        const s = by.get(Number(c?.site_id));
        if (!s) continue;
        if (c.parameter) { s.periodKeys[c.parameter] = one(c); continue; }
        Object.assign(s, { periodResults: num(c.results) || 0, periodOwn: num(c.own_results) || 0, periodLast: c.last_sampled || null });
      }
    }
    const recentFrom = now - S.CURRENT.years * YEAR_MS, later = (a, b) => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a);
    return [...by.values()].map((s) => {
      const families = {};
      for (const [k, v] of Object.entries(s.keys)) {
        const f = families[v.family] || (families[v.family] = { keys: [], times: 0, last: null });
        f.keys.push(k); f.times = Math.max(f.times, v.times); f.last = later(f.last, v.last);
      }
      const recent = !!s.last && Date.parse(s.last) >= recentFrom;
      return { ...s, families, recent, current: recent && s.times >= S.CURRENT.minResults };
    }).sort((a, b) => a.name.localeCompare(b.name, "en-NZ") || a.id - b.id);
  }
  // The sites the filter covers: a sub-group's, or all of them.
  const inScope = (all, filter) => list(all).filter((s) => !filter?.sub || s.orgs.includes(filter.sub));

  // ---- the trends --------------------------------------------------------------------------------------------------------
  // The measures the trend band shows, in N2's order of the ones people ask about (wq-sites-model FIRST), at most four. Nitrate is
  // its family (ECan's routine nitrate is nitrate-nitrite-N): a site's trend is on nitrate-N where it has any, else nitrate-nitrite-N,
  // as the library's band chooses; the two keys are never pooled.
  const MEASURES = Object.freeze([
    { key: "nitrate", family: "nitrate", keys: ["nitrate-n", "nitrate-nitrite-n"], label: "Nitrate" },
    { key: "e-coli", family: "e-coli", keys: ["e-coli"], label: "E. coli" },
    { key: "drp", family: "drp", keys: ["drp"], label: "Dissolved reactive phosphorus", short: "DRP" },
    { key: "turbidity", family: "turbidity", keys: ["turbidity"], label: "Turbidity" },
  ]);
  const measureOf = (key) => MEASURES.find((m) => m.key === key) || null;
  // The library's minimum record for a trend over `years` (supabase/functions/_shared/wq/tools.ts trendSeasons): 5 years needs
  // monthly values in at least 54 months; longer windows need 90% of months, or of quarters, and 90% of years. Each value is at
  // least one distinct sampling time, so fewer sampling times than this can never make a trend.
  const minTimes = (years) => (years === 5 ? 54 : Math.ceil(0.9 * 4 * years));
  // The window the library works over ends at the last complete hydrological year (30 June), at most a year before today, and
  // starts `years` before that: a record with nothing since `years` + 2 years ago has nothing in it.
  const windowFloor = (now, years) => now - (years + 2) * YEAR_MS;
  // What to ask for: one analysis request per site and measure whose record could make a trend, at most TREND_CAP of them a measure;
  // a record that can't is "little" (too little data) without a call. The key of a family a site is asked about is the one with the
  // most sampling times in the period (all time: its whole record); a tie goes to the first of the measure's keys (nitrate-N). Over
  // the cap, the sites with a result in the last 5 years come first (so stopped sites do not crowd out current ones), then the most
  // sampling times of that key in the period, then the site's id; the rest are left out of the count, never called too little data.
  // sites: those in scope; owner: { org }; key: the period.
  // -> { asks: [{ site, measure, parameter, body }], known: Map("site|measure" -> class), considered: Map(measure -> Set(site ids)),
  //      left: Map(measure -> how many left out), used: Map(measure -> { key: sites }), years, cap }
  const TREND_CAP = 40;
  function trendPlan(scope, owner, key, now, measures = MEASURES, { cap = TREND_CAP } = {}) {
    const years = trendYears(key), period = periodOf(key).years, asks = [], known = new Map(), considered = new Map(), left = new Map(), used = new Map();
    for (const m of list(measures).map((x) => (typeof x === "string" ? measureOf(x) : x)).filter(Boolean)) {
      const seen = new Set(), candidates = [];
      for (const s of list(scope)) {
        const have = m.keys.filter((k) => s.keys?.[k]?.times > 0);
        if (!have.length) continue;
        const inPeriod = (k) => s.periodKeys?.[k]?.times || 0;
        const parameter = [...have].sort((a, b) => inPeriod(b) - inPeriod(a) || (s.keys[b].times - s.keys[a].times) || m.keys.indexOf(a) - m.keys.indexOf(b))[0];
        const rec = s.keys[parameter];
        if (rec.times < minTimes(years) || !rec.last || Date.parse(rec.last) < windowFloor(now, years)) { known.set(s.id + "|" + m.key, "little"); seen.add(s.id); continue; }
        candidates.push({ s, parameter, rank: inPeriod(parameter) });
      }
      candidates.sort((a, b) => (b.s.recent - a.s.recent) || (b.rank - a.rank) || (a.s.id - b.s.id));
      const taken = candidates.slice(0, Math.max(0, cap)), counted = new Map();
      for (const c of taken) {
        seen.add(c.s.id);
        counted.set(c.parameter, (counted.get(c.parameter) || 0) + 1);
        const body = S.analysisRequest(owner, "trend", c.s.id, c.parameter, period);
        if (body) asks.push({ site: c.s.id, measure: m.key, parameter: c.parameter, body });
        else known.set(c.s.id + "|" + m.key, "unavailable");
      }
      considered.set(m.key, seen); left.set(m.key, candidates.length - taken.length); used.set(m.key, Object.fromEntries(counted));
    }
    return { asks, known, considered, left, used, years, cap };
  }
  // A measure's counts over the sites in scope that have a record of it (or, given `only`, over those sites alone: the ones a plan
  // asked about or knew). classes: Map("site|measure" -> class, undefined while asked).
  // { measure, improving, indeterminate, degrading, little, other, pending, sites, assessed }
  function band(scope, measure, classes, only = null) {
    const out = { measure, improving: 0, indeterminate: 0, degrading: 0, little: 0, other: 0, pending: 0, sites: 0, assessed: 0 };
    const m = measureOf(measure);
    if (!m) return out;
    for (const s of list(scope)) {
      if (only ? !only.has(s.id) : !(s.families?.[m.family]?.times > 0)) continue;
      out.sites++;
      const c = classes?.get(s.id + "|" + measure);
      if (c === undefined) out.pending++;
      else if (c === "improving" || c === "indeterminate" || c === "degrading" || c === "little") out[c]++;
      else out.other++;
    }
    out.assessed = out.improving + out.indeterminate + out.degrading;
    return out;
  }
  // The bands the page shows: the measures at least one site in scope has, in MEASURES' order (at most four).
  const bands = (scope, classes) => MEASURES.map((m) => band(scope, m.key, classes)).filter((b) => b.sites > 0).slice(0, 4);
  // N2's words for each class (wq-sites-model trendWords: "No clear trend", "Too little data"), and the order the bar is drawn in.
  const CLASS_WORDS = Object.freeze({ improving: "improving", indeterminate: "no clear trend", degrading: "degrading", little: "too little data" });
  const BAR = ["improving", "indeterminate", "degrading"];
  // "4 improving · 9 no clear trend · 3 degrading", then the rest: "12 with too little data", "2 not worked out", "working out 5".
  function bandWords(b) {
    const main = BAR.filter((k) => b[k] > 0).map((k) => count(b[k]) + " " + CLASS_WORDS[k]);
    const rest = [b.little ? count(b.little) + " with too little data" : null, b.other ? count(b.other) + " not worked out" : null].filter(Boolean);
    return { main: main.join(" · ") || (b.pending ? "" : "No site has enough results for a trend"), rest: rest.join(" · "), pending: b.pending ? "Working out " + plural(b.pending, "site", "sites") + "…" : "" };
  }
  // The one plain sentence above the band.
  function trendSentence(scope, shown, key) {
    const years = trendYears(key);
    if (!list(scope).length) return null;
    if (!list(shown).length) return "None of the sites here has results of these measures yet.";
    return "Indicative trends over the last " + years + " years" + (periodOf(key).years ? "" : " (the longest the method takes)") +
      " at each site with enough results, worked out the same way as on each site's page in Maps.";
  }

  // ---- the headline numbers -----------------------------------------------------------------------------------------------
  // What describes the group as a whole and is cheap (the owner, 13 Nov 2026: no water numbers here; water quality is a card).
  // input: { group, subgroups: [{ id, name, member }], areas: Map, filter, members (null: not read or not this person's), events
  // (this year's, null: not read) }. Four tiles at most, each { key, value, label, note }; a tile with nothing honest to say is left
  // out (never "0 ha", never "not available").
  function tiles({ group, subgroups = [], areas: A = new Map(), filter = { sub: null, period: "all" }, members = null, events = null } = {}) {
    const out = [], subs = list(subgroups), isSub = !!group?.parent_org_id;
    if (!isSub && subs.length) {
      const mapped = subs.filter((s) => A.has(s.id)).length;
      out.push({ key: "subgroups", value: count(subs.length), label: subs.length === 1 ? "Sub-group" : "Sub-groups",
        note: mapped === subs.length ? null : mapped ? count(mapped) + " with a boundary" : "No boundaries held yet" });
    }
    const own = A.get(group?.id);
    const ha = filter.sub ? A.get(filter.sub)?.ha : own ? own.ha : subs.reduce((s, x) => s + (A.get(x.id)?.ha || 0), 0);
    const haText = hectares(ha);
    if (haText) {
      const mapped = subs.filter((s) => A.has(s.id)).length;
      out.push({ key: "area", value: haText, label: "Area", note: filter.sub ? subs.find((s) => s.id === filter.sub)?.name || null
        : own ? "The group's area" : mapped < subs.length ? "In " + count(mapped) + " of " + count(subs.length) + " sub-groups" : null });
    }
    if (!isSub && fin(members) && num(members) > 0) out.push({ key: "members", value: count(members), label: num(members) === 1 ? "Member" : "Members", note: null });
    if (fin(events) && num(events) > 0) out.push({ key: "events", value: count(events), label: num(events) === 1 ? "Event this year" : "Events this year", note: null });
    return out.slice(0, 4);
  }

  // ---- the Water quality card -------------------------------------------------------------------------------------------
  // The headline measure: the first of MEASURES that a surface-water site in scope has a record of (nitrate, where there is any).
  const surface = (scope) => list(scope).filter((s) => s.kind === "surface");
  const headlineMeasure = (scope) => MEASURES.find((m) => surface(scope).some((s) => s.families?.[m.family]?.times > 0))?.key || null;
  // One short sentence (surface water only: the site types say which is which, wq-model waterKind), one stacked bar of the headline
  // measure, and the sites and samples in a quiet line. plan: trendPlan's, for the headline measure at the surface-water sites.
  // While any trend is still being worked out the card says only that (and the line), so its sentence never changes under the
  // reader; a trend that could not be worked out is said as such, never as too few results.
  // -> { measure, band, pending, sentence, line, notes, years } or null when there are no sites.
  const PARAMETER_NAMES = Object.freeze({ "nitrate-n": "nitrate-N", "nitrate-nitrite-n": "nitrate-nitrite-N" });
  function wqCard({ scope = [], classes = new Map(), filter = { period: "all" }, plan = null, measure = headlineMeasure(scope) } = {}) {
    const sc = list(scope), period = periodOf(filter.period);
    if (!sc.length) return null;
    const samples = sc.reduce((n, s) => n + (s.periodResults || 0), 0), own = sc.reduce((n, s) => n + (s.periodOwn || 0), 0);
    const first = sc.map((s) => s.first).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    const line = plural(sc.length, "site", "sites") + " · " + plural(samples, "sample", "samples") + (period.years ? " in the " + period.label.toLowerCase() : first && samples ? " since " + yearOf(first) : "") +
      (own > 0 && own < samples ? " (the groups' own " + count(own) + ")" : "");
    const m = measureOf(measure), years = trendYears(filter.period);
    if (!m) return { measure: null, band: null, pending: false, sentence: "No surface-water site here has results of nitrate, E. coli, DRP or turbidity yet.", line, notes: [], years };
    const b = band(surface(sc), m.key, classes, plan?.considered?.get(m.key) || null), label = m.label, notes = [];
    if (b.pending) return { measure: m.key, band: null, pending: true, sentence: "Working out the trends…", line, notes, years };
    let sentence;
    if (!b.assessed && b.other) sentence = "The " + label.toLowerCase() + " trends couldn't be worked out just now.";
    else if (!b.assessed) sentence = "Too few results at the surface-water sites here for a " + label.toLowerCase() + " trend yet.";
    else sentence = label + " is improving at " + count(b.improving) + " of " + plural(b.assessed, "surface-water site", "surface-water sites") + " assessed" +
      (b.degrading ? " and degrading at " + count(b.degrading) : "") + (b.indeterminate ? "; no clear trend at " + count(b.indeterminate) : "") + "." +
      (b.other ? " At " + plural(b.other, "site", "sites") + " the trend couldn't be worked out just now." : "");
    if (plan?.left?.get(m.key) > 0) notes.push("Worked out for the " + count(plan.cap) + " surface-water sites with the most results" + (period.years ? " in the period" : "") + ", recent ones first.");
    const used = Object.entries(plan?.used?.get(m.key) || {}).filter(([, n]) => n > 0);
    if (used.length > 1 || (used.length === 1 && used[0][0] !== m.keys[0])) notes.push(label + " as " + used.sort((x, y) => y[1] - x[1]).map(([k, n]) => (PARAMETER_NAMES[k] || k) + " at " + plural(n, "site", "sites")).join(" and ") + " (the longer record at each).");
    return { measure: m.key, band: b, pending: false, sentence, line, notes, years };
  }

  // ---- the cards: a curated menu, not a chart builder ---------------------------------------------------------------------
  // A registry like the Add registry (add.js): a card is { id, title, group, line (what it shows, for the picker), order, can(viewer),
  // load?(ctx), render(ctx, data) }. Adding a card type is registering one; the layout never changes for it.
  const CARD_GROUPS = Object.freeze(["About the group", "Water", "Activity"]);
  function createCards() {
    const defs = [];
    return {
      register(def) {
        if (!def?.id || typeof def.render !== "function" || defs.some((d) => d.id === def.id)) return false;
        defs.push({ order: 100, can: () => true, ...def }); defs.sort((a, b) => a.order - b.order); return true;
      },
      list: () => [...defs],
      get: (id) => defs.find((d) => d.id === id) || null,
      // the cards this person may have here, in the registry's order
      available: (viewer) => defs.filter((d) => { try { return !!d.can(viewer || {}); } catch { return false; } }),
    };
  }
  const cardsKey = (personId, groupId) => "fp-overview-cards:" + String(personId || "anyone") + ":" + String(groupId || "");
  // A person's layout for the cards available ({ order: [ids], hidden: [ids] }), made safe: unknown ids dropped, a card new since it
  // was saved added at its default place (shown), every card once. The default: every available card shown, in the registry's order.
  function layoutFrom(stored, available) {
    let v = stored;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
    const ids = list(available).map((d) => (typeof d === "string" ? d : d.id));
    const kept = list(v?.order).filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
    const order = [...kept];
    for (const id of ids) if (!order.includes(id)) order.splice(Math.min(ids.indexOf(id), order.length), 0, id);
    return { order, hidden: list(v?.hidden).filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i) };
  }
  const layoutText = (l) => JSON.stringify({ order: list(l?.order), hidden: list(l?.hidden) });
  const shownCards = (l) => list(l?.order).filter((id) => !list(l?.hidden).includes(id));
  function moveCard(l, id, by) {
    const order = [...list(l.order)], i = order.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return l;
    [order[i], order[j]] = [order[j], order[i]];
    return { ...l, order };
  }
  const toggleCard = (l, id, on) => ({ ...l, hidden: on ? list(l.hidden).filter((x) => x !== id) : [...new Set([...list(l.hidden), id])] });
  // The picker's list: the available cards under their group headings, in the person's order within each.
  function pickerGroups(available, l) {
    const defs = list(available), pos = (id) => list(l?.order).indexOf(id);
    return CARD_GROUPS.map((g) => ({ name: g, cards: defs.filter((d) => d.group === g).sort((a, b) => pos(a.id) - pos(b.id))
      .map((d) => ({ id: d.id, title: d.title, line: d.line || "", shown: !list(l?.hidden).includes(d.id) })) })).filter((g) => g.cards.length);
  }
  // Where "Open water quality" goes, in one place: the group's Water quality page (WQV1, `#/group/<id>/water`).
  const waterQualityLink = (groupId, href) => ({ href: href(groupId, "water"), opensPanel: false });

  // The calm line under the tiles and on the map when something is missing; null when nothing is.
  function emptyLine({ areas: A = new Map(), sites: all = [], filter = {}, sitesRead = true } = {}) {
    if (filter.sub ? !A.has(filter.sub) : !A.size) return filter.sub ? "No boundary held for this sub-group yet." : "No boundary held for this group yet.";
    if (sitesRead && !inScope(all, filter).length) return "No water quality monitoring sites lie inside the boundaries held.";
    return null;
  }

  // ---- the ranked list ---------------------------------------------------------------------------------------------------
  // The sub-groups with what is known of each (area, sites inside, results in the period, the chosen measure's band), sorted by
  // name, area (largest first) or results (most first); none known go last.
  function subgroupRows(subgroups, A, all, classes, measure, sort = "name") {
    const rows = list(subgroups).map((s) => {
      const inside = list(all).filter((x) => x.orgs.includes(s.id));
      return { id: s.id, name: s.name, member: s.member !== false, ha: A.get(s.id)?.ha ?? null, area: hectares(A.get(s.id)?.ha), sites: inside.length,
        results: inside.reduce((n, x) => n + (x.periodResults || 0), 0), band: measure ? band(inside, measure, classes) : null, hasArea: A.has(s.id) };
    });
    const by = {
      name: (a, b) => a.name.localeCompare(b.name, "en-NZ"),
      area: (a, b) => (b.ha ?? -1) - (a.ha ?? -1) || a.name.localeCompare(b.name, "en-NZ"),
      results: (a, b) => b.results - a.results || (b.ha ?? -1) - (a.ha ?? -1) || a.name.localeCompare(b.name, "en-NZ"),
    };
    return rows.sort(by[sort] || by.name);
  }
  // The sites (a group with no sub-groups, or one sub-group chosen): results in the period, the latest result, the chosen
  // measure's class. Sorted by name, results (most first) or latest (newest first).
  function siteRows(scope, classes, measure, sort = "name") {
    const rows = list(scope).map((s) => ({ id: s.id, name: s.name, results: s.periodResults || 0, last: s.last, latest: s.last ? W.date(s.last) : null,
      cls: measure ? classes?.get(s.id + "|" + measure) ?? (s.families?.[measureOf(measure)?.family] ? undefined : null) : null, current: s.current }));
    const by = {
      name: (a, b) => a.name.localeCompare(b.name, "en-NZ"),
      results: (a, b) => b.results - a.results || a.name.localeCompare(b.name, "en-NZ"),
      latest: (a, b) => (Date.parse(b.last) || 0) - (Date.parse(a.last) || 0) || a.name.localeCompare(b.name, "en-NZ"),
    };
    return rows.sort(by[sort] || by.name);
  }
  // A site's class for the chosen measure, in N2's words ("No clear trend"), for its row.
  const classLabel = (c) => (c === undefined ? "Working out…" : c === null ? "" : c === "little" ? "Too little data" : c === "indeterminate" ? "No clear trend"
    : c === "improving" ? "Improving" : c === "degrading" ? "Degrading" : "Not worked out");

  // ---- context layer themes (N1: the core layers' theme headings, as the published maps' Layers panel lists them) -----------------
  // core_layers rows drawn as context on every map and still offered, grouped by theme in the order of each theme's first layer.
  // -> [{ name, layers: [{ key, title, tiles_path, source_layer, layers: [{ type, paint, layout, filter, minzoom, maxzoom }] }] }]
  function contextThemes(rows) {
    const ok = (ref) => ref?.draw === "context" && ref.every_map === true && ref.offered !== false && ref.style && typeof ref.style === "object" && !Array.isArray(ref.style);
    const at = (r) => (Number.isFinite(r.style.reference.order) ? r.style.reference.order : 1e6);
    const themes = [];
    for (const r of list(rows).filter((x) => ok(x?.style?.reference) && typeof x.tiles_path === "string" && x.tiles_path.startsWith("core/")).sort((a, b) => at(a) - at(b))) {
      const ref = r.style.reference, st = ref.style, name = typeof ref.group === "string" && ref.group.trim() ? ref.group.trim() : "Context layers";
      const layers = list(st.layers).filter((x) => x && ["fill", "line", "circle"].includes(x.type)).map((x) => ({ type: x.type, paint: x.paint && typeof x.paint === "object" ? x.paint : {},
        layout: x.layout && typeof x.layout === "object" ? x.layout : {}, ...(Array.isArray(x.filter) ? { filter: x.filter } : {}),
        ...(fin(x.minzoom) ? { minzoom: Number(x.minzoom) } : {}), ...(fin(x.maxzoom) ? { maxzoom: Number(x.maxzoom) } : {}) }));
      if (!layers.length || typeof st.source_layer !== "string") continue;
      let t = themes.find((x) => x.name === name);
      if (!t) themes.push(t = { name, layers: [] });
      t.layers.push({ key: r.key, title: r.title || r.key, tiles_path: r.tiles_path, source_layer: st.source_layer, layers, startsOn: ref.starts_on === true });
    }
    return themes;
  }

  return { PERIODS, periodOf, since, trendYears, storeKey, filterFrom, filterText, count, hectares, plural, metreRings, areaHa, labelPoint, areas, sites, inScope,
    headlineMeasure, wqCard, KEYS, TREND_CAP, PARAMETER_NAMES, CARD_GROUPS, createCards, cardsKey, layoutFrom, layoutText, shownCards, moveCard, toggleCard, pickerGroups, waterQualityLink,
    MEASURES, measureOf, minTimes, windowFloor, trendPlan, band, bands, CLASS_WORDS, BAR, bandWords, trendSentence, tiles, emptyLine, subgroupRows, siteRows, classLabel,
    contextThemes, YEAR_MS };
});
