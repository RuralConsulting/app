// WQ4: a water quality site opened from a group's Maps tab. One file (its name kept short: the sign-in page's weight counts every
// script line): first the pure parts, with no DOM, network or clock, then the view that draws them.
// The owner (15 Nov 2026, on his phone): "On the wq when I click I'd like to see a chart of wq (select between different parameters). Will
// need to be sized appropriately especially for my phone. And for labels they need to be improved, they're too long and not easy to read".
//   * A published (QGIS) layer is a water quality layer when its points name a site (a site id or site name field) AND it says water
//     quality in a way no other layer would (isWqLayer, review of #570): a column named for a water quality measure (nnn, nitrate..., e_coli...,
//     ecoli..., drp, clarity, turbidity), or a `parameter` column beside a median or p95 column, or "water quality" / "WQ" in its title. A
//     median, p95, value, result, status, samples or mean column alone is not enough (bores have a median depth, traps a status, soil
//     samples a count): such a layer keeps its own labels and taps. Nothing in the published layer is stored against a monitoring site, so a
//     tapped point is matched to one of the group's monitoring sites (the Water quality page's sites) by matchSite, which takes a site only
//     when nothing about the point contradicts it, and stops at any doubt: a wrong chart is worse than none. No match: the viewer's own
//     details, with plain field names (fieldLabel); never a chart from the layer's summary numbers. A match keeps the point's own published
//     fields one tap away in the view (publishedRows).
//   * A site's measures: only those it has results of (its site_record_summary families), nitrate (the page's first measure) first.
//   * Its chart: the Water quality page's own site chart (wq-page-model.js siteChartData: one key per line, field readings hollow, censored
//     results as limits), drawn over the map's level colours where the measure has them (wq-page-model.js LEVEL_BANDS), and only from
//     MIN_POINTS results: with fewer, the results are said in a sentence.
//   * Labels: one short name per site (shortName), never the measure's numbers (the colour carries the level).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./wq-page-model.js") : root.FP.wqPageModel, node ? require("./wq-model.js") : root.FP.wqModel,
    node ? require("./wq-sites-model.js") : root.FP.wqSitesModel);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.wqSiteViewModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (P, W, S) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const text = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
  const norm = (v) => text(v).toLowerCase();
  const plural = (n, one, many) => Number(n).toLocaleString("en-NZ") + " " + (Number(n) === 1 ? one : many);

  // ---- a published layer's fields -------------------------------------------------------------------------------------------------
  const ID_FIELD = /^(site_?id|site_?code|site_?no|site_?number|siteid|sitecode|external_?id)$/i;
  const NAME_FIELD = /^(site_?name|sitename|site_?label)$/i;
  // the columns that say water quality on their own, and the summary columns that do only beside a `parameter` column
  const WQ_FIELD = /^(nnn|nitrate.*|e_?coli.*|ecoli.*|drp|clarity|turbidity)$/i;
  const SUMMARY_FIELD = /^(median|med|p95|percentile_?95)$/i, PARAMETER_FIELD = /^parameter$/i;
  const WQ_TITLE = /\b(water quality|wq)\b/i;
  const saysWq = (names, title) => names.some((n) => WQ_FIELD.test(n)) || (names.some((n) => PARAMETER_FIELD.test(n)) && names.some((n) => SUMMARY_FIELD.test(n))) || WQ_TITLE.test(text(title));
  const fieldName = (f) => (typeof f === "string" ? f : text(f?.name));
  // A feature's site id and site name, from the first field of each kind that holds something.
  function featureKeys(props) {
    const p = props && typeof props === "object" ? props : {};
    let id = "", name = "";
    for (const [k, v] of Object.entries(p)) {
      if (k.startsWith("_") || v == null || text(v) === "") continue;
      if (!id && ID_FIELD.test(k)) id = text(v);
      if (!name && NAME_FIELD.test(k)) name = text(v);
    }
    return { id, name };
  }
  // A layer of the published map that is about water quality sites: points whose fields name a site, and that say water quality (saysWq).
  // L: the manifest's layer entry ({ id, title, geometry, fields: [{ name, alias }] }). Without its fields nothing can be told: false.
  function isWqLayer(L) {
    if (!L || L.geometry !== "point") return false;
    const names = list(L.fields).map(fieldName).filter(Boolean);
    return names.some((n) => ID_FIELD.test(n) || NAME_FIELD.test(n)) && saysWq(names, L.title);
  }
  // The same from a tapped feature's own properties (a layer whose field list the package did not carry).
  function isWqFeature(props, title = "") {
    const keys = Object.keys(props && typeof props === "object" ? props : {}).filter((k) => !k.startsWith("_"));
    const k = featureKeys(props);
    return !!(k.id || k.name) && saysWq(keys, title);
  }
  // A tapped point's own published fields, as the viewer listed them, under plain names where the app has them: [[label, value]].
  function publishedRows(props) {
    return Object.entries(props && typeof props === "object" ? props : {}).filter(([k, v]) => !k.startsWith("_") && v != null && text(v) !== "")
      .map(([k, v]) => [fieldLabel(k) || k, text(v)]);
  }
  const wqLayerIds = (manifest) => list(manifest?.layers).filter(isWqLayer).map((L) => String(L.id));

  // Plain names for a published water quality layer's columns, where the app can name them; any other column is left as published.
  const FIELD_WORDS = { source: "Source", site_name: "Site", sitename: "Site", site_id: "Site id", siteid: "Site id", site_code: "Site id", sitecode: "Site id",
    external_id: "Site id", parameter: "Measure", measure: "Measure", value: "Value", result: "Result", median: "Median", med: "Median", mean: "Mean",
    p95: "95th percentile", percentile_95: "95th percentile", max_value: "Highest", min_value: "Lowest", samples: "Samples", n_samples: "Samples",
    sample_count: "Samples", status: "Status", unit: "Unit", units: "Unit", site_type: "Site type", first_sampled: "First sampled", last_sampled: "Last sampled",
    date: "Date", year: "Year", notes: "Notes", note: "Note" };
  const fieldLabel = (name) => FIELD_WORDS[norm(name)] || null;
  // The manifest the viewer is given: each water quality layer's columns named plainly (only where the package gave no name of its own),
  // and where its features name their site, its own per-measure labels kept for the publisher's data but drawn from no zoom on (the app
  // writes one short label per site instead: wqsv.js labels). Nothing else changes. Returns the manifest as it was when none is.
  const NO_LABEL_ZOOM = 99;
  function tidyManifest(manifest) {
    if (!Array.isArray(manifest?.layers)) return manifest;
    let changed = false;
    const layers = manifest.layers.map((L) => {
      if (!isWqLayer(L)) return L;
      changed = true;
      const fields = list(L.fields).map((f) => {
        if (typeof f !== "object" || !f) return f;
        const plain = fieldLabel(f.name), own = text(f.alias);
        return plain && (!own || own === f.name) ? { ...f, alias: plain } : f;
      });
      const named = list(L.fields).some((f) => NAME_FIELD.test(fieldName(f)) || ID_FIELD.test(fieldName(f)));
      return { ...L, fields, wqSites: true, ...(L.labels && named ? { labels: { ...L.labels, minzoom: NO_LABEL_ZOOM }, wqOwnLabels: true } : {}) };
    });
    return changed ? { ...manifest, layers } : manifest;
  }

  // ---- matching a tapped feature to a monitoring site ---------------------------------------------------------------------------
  const ll = (p) => (Array.isArray(p) ? (Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null) : p && Number.isFinite(p.lng) && Number.isFinite(p.lat) ? [p.lng, p.lat] : null);
  function metres(a, b) {
    const p = ll(a), q = ll(b);
    if (!p || !q) return null;
    const kx = 111320 * Math.cos(((p[1] + q[1]) / 2) * Math.PI / 180), ky = 110540;
    return Math.hypot((p[0] - q[0]) * kx, (p[1] - q[1]) * ky);
  }
  const NEAR_M = 30, KEY_M = 2000;
  // Names compared as whole words (review of #570, round two): case, punctuation and repeated spaces are set aside and ONE trailing bracket
  // is left out ("Washpen upper (FCG 5-U)" is "washpen upper"). Two names are the same when their words are; they agree when the shorter's
  // words are a run of whole words in the longer ("mill road ford" in "demo creek at the mill road ford"; never "site 1" in "site 10"),
  // and a single everyday word on its own ("Ford", "Bridge", "Upper") never agrees with anything.
  const words = (v) => text(v).toLowerCase().replace(/\s*\([^()]*\)\s*$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  const bare = (v) => words(v).join(" ");
  const GENERIC = new Set(["ford", "bridge", "stream", "creek", "river", "site", "upper", "lower", "mid", "middle", "drain", "culvert", "weir", "bore", "well",
    "spring", "springs", "trib", "tributary", "main", "north", "south", "east", "west", "outlet", "inlet", "lake", "pond", "dam", "road", "farm", "point"]);
  const sameName = (a, b) => { const x = bare(a); return !!x && x === bare(b); };
  function namesAgree(a, b) {
    const x = words(a), y = words(b);
    if (!x.length || !y.length) return false;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    if (short.length === 1 && GENERIC.has(short[0])) return false;
    for (let i = 0; i + short.length <= long.length; i++) if (short.every((w, j) => long[i + j] === w)) return true;
    return false;
  }
  // A code is the same code, trimmed and ignoring case only (never "5-U" in "15-U"). The point's code is its site id, or its published
  // source and site id joined by a space ("FCG" and "5-U" is "FCG 5-U": how a group's own results are coded when imported).
  const codeOf = (v) => text(v).toLowerCase();
  const pointCodes = (k, props) => { const src = Object.entries(props && typeof props === "object" ? props : {}).find(([f, v]) => /^source$/i.test(f) && text(v))?.[1];
    return k.id ? [codeOf(k.id), ...(src ? [codeOf(text(src) + " " + k.id)] : [])] : []; };
  const sameCode = (codes, c) => !!codeOf(c) && codes.includes(codeOf(c));
  // The water type a published point states (a site_type or water_type field), as the app's words: "groundwater", "surface" or null.
  function pointType(props) {
    const p = props && typeof props === "object" ? props : {};
    const v = Object.entries(p).find(([k, x]) => /^(site_?type|water_?type)$/i.test(k) && text(x))?.[1];
    if (!v) return null;
    const t = W.waterType(v);
    return t === "groundwater" ? "groundwater" : t === "surface" ? "surface" : null;
  }
  // feature: { props, lngLat }; sites: the Water quality page's sites (wq-page-model.js sites: { id, name, externalId, lngLat, type, ... }).
  // { site, how: "id" | "name", metres } or { site: null, why: "none" | "ambiguous" | "contradicted" }. In this order, and the
  // first step that finds anything decides (review of #570: a doubt never falls through to a weaker step):
  //   1. its site id, the same code as a site's, within 2 km: one site (else the one of them within 30 m, else no match). Further than 30 m
  //      away, the point's name must not disagree with the site's.
  //   2. its site name, the same name, within 2 km, the same way; the codes, where both have one, must be the same.
  //   Nothing else: being near, or a name that only holds the point's (round three), never makes a match. Name containment (namesAgree) is
  //   used only as a check on a code that already matches, further than 30 m away.
  // Only sites with a place count (a site with none is never "near"), and never a site of the other water type when the point says its type.
  function matchSite(feature, sites) {
    const at = ll(feature?.lngLat), props = feature?.props, k = featureKeys(props), type = pointType(props), codes = pointCodes(k, props);
    const all = list(sites).filter((s) => s && s.id != null && ll(s.lngLat) && (!type || !s.type || s.type === "unknown" || (type === "groundwater") === (s.type === "groundwater")));
    const dist = (s) => metres(at, s.lngLat);
    if (!at) return { site: null, why: "none" };
    const within = (s, m) => { const d = dist(s); return d != null && d <= m; };
    const nameOk = (s) => !k.name || !text(s.name) || namesAgree(k.name, s.name);
    const codeOk = (s) => !k.id || !text(s.externalId) || sameCode(codes, s.externalId);
    const one = (hits, how, check) => {
      let got = hits;
      if (got.length > 1) { got = hits.filter((s) => within(s, NEAR_M)); if (got.length !== 1) return { site: null, why: "ambiguous" }; }
      const s = got[0];
      if (!check(s)) return { site: null, why: "contradicted" };
      return { site: s, how, metres: dist(s) };
    };
    if (k.id) {
      const hits = all.filter((s) => sameCode(codes, s.externalId) && within(s, KEY_M));
      if (hits.length) return one(hits, "id", (s) => within(s, NEAR_M) || nameOk(s));
    }
    if (k.name) {
      const hits = all.filter((s) => sameName(s.name, k.name) && within(s, KEY_M));
      if (hits.length) return one(hits, "name", codeOk);
    }
    // (round three: no third step. A site is never taken for being near, nor for a name that only holds the point's: "Taylors Upper" is
    // not "Taylors Upper trib", nor "Washpen" "Washpen upper". A site with the same code or the very same name within 30 m is found above.)
    return { site: null, why: "none" };
  }

  // ---- labels ----------------------------------------------------------------------------------------------------------------------
  // A site's name as a map label: without a trailing bracket ("(synthetic)", "(SQ35045)"), at most `max` characters, cut at a word.
  function shortName(name, max = 26) {
    let t = text(name).replace(/\s*\([^()]*\)\s*$/, "").trim() || text(name);
    if (t.length <= max) return t;
    const cut = t.slice(0, max + 1), at = cut.lastIndexOf(" ");
    return (at >= Math.floor(max / 2) ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:–-]+$/, "") + "…";
  }
  // One label per site from a published map's water quality layers: layers: [{ id, features: GeoJSON features }]. A site is its site id
  // (else its name); features of the same site within 50 m, and any two features within 5 m, are one site. [{ key, text, full, lngLat, layers }]
  const SAME_SITE_M = 50, SAME_SPOT_M = 5;
  function siteLabels(layers) {
    const out = [];
    for (const L of list(layers)) for (const f of list(L?.features)) {
      const g = f?.geometry, at = g?.type === "Point" ? ll(g.coordinates) : null;
      if (!at) continue;
      const k = featureKeys(f.properties), own = text(f.properties?._lbl), key = norm(k.id) || norm(k.name) || "lbl:" + norm(own);
      // (round two: a point that names no site keeps its own published label: a label the app cannot replace is never dropped)
      const full = k.name || k.id || own;
      if (!full) continue;
      const same = out.find((x) => { const d = metres(x.lngLat, at); return d != null && (d <= SAME_SPOT_M || (x.key === key && d <= SAME_SITE_M)); });
      if (same) { if (!same.layers.includes(String(L.id))) same.layers.push(String(L.id)); continue; }
      out.push({ key: key + "@" + at.map((v) => v.toFixed(5)).join(","), text: k.name || k.id ? shortName(full) : full, full, lngLat: at, layers: [String(L.id)] });
    }
    return out;
  }
  // Which labels show: each beside its dot (right, else left), never over another label or another site's dot, inside the box;
  // the earlier ones first. items: [{ key, x, y, w, h, dot }] in screen pixels (x, y the dot's centre; dot its radius); avoid: boxes
  // ({ x0, y0, x1, y1 }) laid over the map (its buttons and panels), which a name never goes under.
  // Returns Map key -> "right" | "left" for those shown.
  function placeLabels(items, { width = Infinity, height = Infinity, pad = 4, gap = 4, avoid = [] } = {}) {
    const boxes = list(avoid).filter((b) => b && b.x1 > b.x0 && b.y1 > b.y0).map((b) => ({ ...b })), shown = new Map();
    const dots = list(items).map((it) => ({ key: it.key, x0: it.x - (it.dot || 6), x1: it.x + (it.dot || 6), y0: it.y - (it.dot || 6), y1: it.y + (it.dot || 6) }));
    const hits = (b, own) => boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) || dots.some((d) => d.key !== own && b.x0 < d.x1 && b.x1 > d.x0 && b.y0 < d.y1 && b.y1 > d.y0);
    for (const it of list(items)) {
      const r = (it.dot || 6) + gap, top = it.y - it.h / 2;
      for (const side of ["right", "left"]) {
        const x0 = side === "right" ? it.x + r : it.x - r - it.w, b = { x0, x1: x0 + it.w, y0: top, y1: top + it.h };
        if (b.x0 < pad || b.y0 < pad || b.x1 > width - pad || b.y1 > height - pad || hits(b, it.key)) continue;
        boxes.push(b); shown.set(it.key, side); break;
      }
    }
    return shown;
  }

  // ---- a site's measures ------------------------------------------------------------------------------------------------------------
  // summary: the site's site_record_summary rows ({ family, n, ... }). The measures it has results of, in the page's order for its water
  // type with nitrate first; with no summary at all (an own site the summary has not caught up with), the type's first measures.
  // [{ key, name, label, n }]
  const MAIN = "nitrate";
  function measuresOf(summary, type = "surface") {
    const n = new Map(list(summary).filter((r) => r && Number(r.n) > 0).map((r) => [text(r.family), Number(r.n)]));
    const { first, more } = P.measuresFor(type === "groundwater" ? "groundwater" : "surface");
    const order = [P.measure(MAIN), ...first, ...more, ...P.MEASURES].filter((m, i, a) => m && a.findIndex((x) => x.key === m.key) === i);
    const pick = n.size ? order.filter((m) => n.has(m.key)) : first;
    return pick.map((m) => ({ key: m.key, name: m.name, label: m.short || m.name, n: n.get(m.key) || null }));
  }

  // ---- the chart ---------------------------------------------------------------------------------------------------------------------
  const MIN_POINTS = 3;
  // The Water quality page's level colours as the chart's background bands ({ label, ranges: [{ label, from, to, colour }] }), or null for a measure the
  // map draws in one plain colour.
  function levelBands(row) {
    const set = P.bandsFor(row);
    if (!set) return null;
    let from = 0;
    const ranges = set.bands.map(([to, colour]) => { const r = { label: "", from, to, colour }; from = to; return r; });
    const words = set.bands.map(([to], i) => (to == null ? "over " + S.tidy(set.bands[i - 1][0]) : S.tidy(i ? set.bands[i - 1][0] : 0) + " to " + S.tidy(to))).join(", ");
    // (review of #570: a published dot is coloured by its own QGIS style, so these are named as the Water quality page's, never "the map's")
    return { label: "the Water quality page's level colours for " + (P.measure(row.measureKey)?.name || row.measureKey).toLowerCase().replace(/^e\. coli/i, "E. coli") + ", " + words + " " + set.unit +
      (row.type === "groundwater" ? "; the NPS-FM's river and lake bands do not apply to groundwater" : ""), ranges };
  }
  // What the chart part of the view shows for one site and measure: { kind: "chart", data } from MIN_POINTS results; { kind: "few", words }
  // with one or two; { kind: "none", words } with none. row: the page's row of the site for the measure (wq-page-model.js rowsFor);
  // series: the site's results of the measure's keys (public.measurements, as the page reads them).
  function chartOf({ row, series, measureKey, period = "all" }) {
    const m = P.measure(measureKey), name = (m?.name || measureKey), lower = /^E\. coli/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
    const when = period === "all" ? "" : " in the " + P.periodWords(period);
    if (!row) return { kind: "none", words: "No " + lower + " results at this site" + when + "." };
    const data = P.siteChartData({ row, series, measureKey, period });
    const points = data.series.flatMap((s) => s.points).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    if (!points.length) return { kind: "none", words: "No " + lower + " results at this site" + when + "." };
    const unit = data.parameter.unit ? " " + data.parameter.unit : "";
    if (points.length < MIN_POINTS) {
      const said = points.map((p) => S.tidy(p.text || p.value) + unit + " on " + W.date(p.t) + (p.field ? " (a field reading)" : ""));
      return { kind: "few", words: "Only " + plural(points.length, lower + " result", lower + " results") + " here, too few to draw over time: " + (said.length === 2 ? said.join(" and ") : said[0]) + "." };
    }
    const bands = levelBands(row);
    const { bands: npsfm, assess, ...rest } = data;
    return { kind: "chart", data: { ...rest, title: name + ", " + P.periodWords(period), ...(bands ? { bands } : npsfm ? { bands: npsfm } : { assess }) } };
  }
  // The lines under the measure's name: its level (what its dot's colour stands for), the colour's range, the results and the latest,
  // as the page's card says them (wq-page-model.js card).
  function facts(row, measureKey, period = "all") {
    if (!row) return [];
    const c = P.card(row, measureKey, period);
    return [c.level, c.band, [c.results, c.latest].filter(Boolean).join(" · "), c.note].filter(Boolean);
  }

  return { ID_FIELD, NAME_FIELD, WQ_FIELD, SUMMARY_FIELD, WQ_TITLE, featureKeys, isWqLayer, isWqFeature, publishedRows, namesAgree, sameName, pointType, wqLayerIds, FIELD_WORDS, fieldLabel, NO_LABEL_ZOOM, tidyManifest,
    metres, NEAR_M, KEY_M, matchSite, shortName, SAME_SITE_M, SAME_SPOT_M, siteLabels, placeLabels, MAIN, measuresOf, MIN_POINTS, levelBands, chartOf, facts };
});

// WQ4: a water quality site opened from a group's Maps tab: its name, a measure picker (only the measures it has results of, nitrate
// first), its chart of that measure (the Water quality page's own site chart, over the map's level colours), its level and latest result in
// words, the caveats behind "About these numbers", and one quiet link to the Water quality page. Drawn into the Maps tab's own site panel
// (wq-sites.js: a sheet over the map on a phone, the panel at the right on a computer); the map's box never changes size.
// And the short labels: one per site of a published map's water quality layers (its own per-measure labels are drawn from no zoom on:
// the model above, tidyManifest), laid over the map beside each dot, hidden where they would touch another label or dot.
// Every read is the signed-in person's own and one the Water quality page already makes for them (wq-page.js loader: wq_area_sites,
// subgroup_counts and places once per group and session; wq_site_figures, wq_state_trend_for_sites and public.measurements for this one
// site), plus this one site's rows of site_record_summary (as the Maps panel already reads them). Nothing here widens what anyone can read.
(function (root) {
  if (!root.document) return;   // (the view: a browser's only; Node's tests load the model above)
  const FP = root.FP;
  const V = () => FP.wqSiteViewModel, P = () => FP.wqPageModel, W = () => FP.wqModel;
  const el = (...a) => FP.el(...a);
  const list = (v) => (Array.isArray(v) ? v : []);
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  let chosenMeasure = null;   // the measure last chosen, kept while the app is open (a second site opens on it where it has it)

  // ---- reads ---------------------------------------------------------------------------------------------------------------------
  const namesOf = (b) => new Map([...list(b?.subs).map((s) => [s.id, s.name]), ...list(FP.groupSpace?.groups?.()).map((g) => [g.id, g.name])]);
  // The group's monitoring sites as the Water quality page lists them (its loader: read once per group and session, shared with the page).
  function candidates(sb, org) {
    const L = FP.wqPage?.loader?.(sb, org);
    if (!L) return Promise.resolve([]);
    return L.base().then((b) => P().sites(b.rows, { org, names: namesOf(b) }));
  }
  const summaries = new Map();
  function summaryOf(sb, id) {
    if (!summaries.has(id)) {
      const p = sb.from("site_record_summary").select("family, n, first_sampled, last_sampled, years, refreshed_at").eq("site_id", id).limit(60)
        .then(({ data, error }) => { if (error) throw error; return list(data); });
      summaries.set(id, p);
      p.catch(() => { if (summaries.get(id) === p) summaries.delete(id); });
    }
    return summaries.get(id);
  }

  // ---- the view --------------------------------------------------------------------------------------------------------------------
  // host: the element to fill; site: a site of candidates(); org: the group (or sub-group) whose Maps tab this is.
  // extra: nodes the panel adds at the foot (a computer's "Compare with another site"); published: the tapped point's own fields
  // ({ title, rows: [[label, value]] }), listed under a closed "On this map" (review of #570), never charted; dot: opened from the Water
  // quality button's own dot (only then does the view say what the dot's colour means). Returns { destroy() }.
  function render(host, { sb = FP.sb, org, site, extra = [], published = null, dot = false } = {}) {
    let gone = false, token = 0, chart = null;
    const L = FP.wqPage.loader(sb, org);
    const heading = el("h2", { tabindex: "-1" }, site.name);
    // (review of #570: a phone keeps the old panel's record line. Round two: no "Provisional" tag, which the old panel showed only for
    // results flagged provisional; the Water quality page's reads carry no such flag, so, as on that page, the source's terms are said
    // under "About these numbers" instead)
    const meta = el("p", { class: "wqs-meta" }, [site.source, P().TYPE_WORDS[site.type], P().tagsOf(site)].filter(Boolean).join(" · "));
    const recordBox = el("p", { class: "wqs-meta wqsv-record", hidden: true });
    const picker = el("div", { class: "wqsv-measures", role: "group", "aria-label": "Measure" });
    const factsBox = el("div", { class: "wqsv-facts", "aria-live": "polite" });
    const chartBox = el("div", { class: "block-host wqs-chart wqsv-chart" });
    const about = el("details", { class: "wqs-how wqsv-about" }, el("summary", {}, "About these numbers"));
    const lawaBox = el("p", { class: "wqs-hint wqsv-lawa", hidden: true });
    const page = FP.groupModel ? el("p", { class: "wqsv-open" }, el("a", { href: FP.href(FP.groupModel.href(org, "water")) }, "Open in Water quality")) : null;
    const ownRows = list(published?.rows).filter((r) => Array.isArray(r) && r.length === 2);
    const mapBox = ownRows.length ? el("details", { class: "wqs-how wqsv-published" }, el("summary", {}, "On this map" + (published.title ? ": " + published.title : "")),
      el("dl", { class: "wqsv-fields" }, ...ownRows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]))) : null;
    fill(host, heading, meta, recordBox, picker, chartBox, factsBox, lawaBox, about, mapBox, ...list(extra), page);   // (the chart straight under the measures)
    fill(factsBox, el("p", { class: "wqs-status" }, "Loading this site's results…"));

    let measures = [];
    summaryOf(sb, site.id).catch(() => []).then(async (rows) => {
      if (gone) return;
      const rec = FP.wqSitesModel?.record(rows, site), line = rec ? FP.wqSitesModel.recordLine(rec, null) : "";
      recordBox.textContent = line; recordBox.hidden = !line;
      measures = V().measuresOf(rows, site.type);
      // no summary rows (an own site the summary has not caught up with): only the measures the page's figures find results of
      if (!list(rows).some((r) => Number(r?.n) > 0) && measures.length) {
        const found = await Promise.all(measures.map((m) => L.figures(m.key, null, false, [site.id]).then((f) => list(f).some((x) => Number(x.n) > 0), () => true)));
        if (gone) return;
        measures = measures.filter((m, i) => found[i]);
      }
      if (!measures.length) { fill(picker); fill(factsBox, el("p", {}, "No results are recorded for this site yet.")); return; }
      const want = measures.find((m) => m.key === chosenMeasure) || measures[0];
      draw(want.key);
    });

    function drawPicker(key) {
      fill(picker, measures.map((m) => el("button", { type: "button", class: "wqsv-measure", "data-measure": m.key, "aria-pressed": String(m.key === key),
        onclick: () => { if (m.key !== key) { chosenMeasure = m.key; draw(m.key); } } }, m.label)));
      picker.hidden = measures.length < 2 && !!measures[0];
    }
    async function draw(key) {
      const t = ++token, m = P().measure(key);
      drawPicker(key);
      chart?.destroy(); chart = null;
      fill(chartBox, el("p", { class: "wqs-status" }, "Loading the chart…"));
      fill(factsBox);
      let row = null, series = [];
      try {
        const sum = list(await summaryOf(sb, site.id).catch(() => [])).find((r) => r.family === key) || null;
        const [figures, lawa] = await Promise.all([L.figures(key, null, false, [site.id]),
          site.shared && site.sourceKey === "ecan-wq-sites" ? L.lawa([site.id]).catch(() => ({})) : Promise.resolve({})]);
        row = P().rowsFor([site], { summary: sum ? { [site.id]: sum } : {}, figures, lawa, measureKey: key, now: Date.now() })[0] || null;
        series = row?.key ? await L.series(site.id, m?.keys || [row.key], null) : [];
      } catch {
        if (t !== token || gone) return;
        fill(chartBox, el("p", {}, "Couldn't read this site's results just now."));
        return;
      }
      if (t !== token || gone) return;
      const shown = V().chartOf({ row: row && row.n ? row : null, series, measureKey: key, period: "all" });
      fill(factsBox, V().facts(row && row.n ? row : null, key).map((line, i) => el("p", { class: i ? "wqs-hint" : "wqsv-level" }, line)));
      if (shown.kind === "chart") chart = FP.blocks.render(chartBox, { block: "chart", owner: { org } }, { read: () => shown.data, level: 3, href: FP.href });
      else fill(chartBox, el("p", { class: "wqs-empty wqsv-few" }, shown.words));
      lawaBox.hidden = !row?.trendWords;
      lawaBox.textContent = row?.trendWords ? "LAWA's 10-year trend of " + (m?.name || key).replace(/^(?!E\. coli)./, (c) => c.toLowerCase()) + ": " + row.trendWords + (row.bandWords ? "; " + row.bandWords : "") + "." : "";
      fill(about, el("summary", {}, "About these numbers"), ...aboutLines(row, key));
    }
    function aboutLines(row, key) {
      const h = row ? P().headline([row]) : null, credit = [];
      if (site.sourceKey === "ecan-wq-sites") credit.push("Environment Canterbury's results are provisional until reviewed by ECan (CC BY 4.0).");
      if (site.sourceKey === "niwa-nrwqn-sites") credit.push("NIWA's results: Earth Sciences New Zealand (NIWA).");
      if (row?.trendWords) credit.push("Trends: LAWA (Land, Air, Water Aotearoa), 27 Oct 2026 release, CC BY 4.0.");
      return [
        el("p", {}, "The chart and the figures are the Water quality page's, from every result of this measure you can read here: one line for each way it was measured, never pooled. " + ((P().measure(key)?.keys.length || 0) > 1 ? P().KEY_RULE : "")),
        h && P().fieldNote(h, false) ? el("p", {}, P().fieldNote(h, false)) : null,
        // (review of #570: a published dot is coloured by its own QGIS style; only the Water quality button's dots use these colours)
        el("p", {}, "The chart's background shows the Water quality page's level colours for this measure. They show a level, not a grade." +
          (dot ? " This site's dot on the map has its colour: the site's median of the measure (its latest result where it has fewer than " + P().LEVEL_MEDIAN_MIN + ")." : "")),
        el("p", {}, "A chart needs at least " + V().MIN_POINTS + " results; with fewer they are listed in words."),
        row?.held ? el("p", {}, P().GOOD_WORDS + " " + P().HELD_WORDS) : null,
        credit.length ? el("p", { class: "wqs-source" }, credit.join(" ")) : null,
      ].filter(Boolean);
    }
    return { heading, destroy() { gone = true; token++; chart?.destroy(); chart = null; } };
  }

  // ---- short labels for a published map's water quality sites ------------------------------------------------------------------------
  // map: the viewer's map; holder: the element the viewer fills; manifest: as tidyManifest left it (wqOwnLabels on the layers whose own
  // labels it turned off); url(rel): the map's signed file links. The labels follow the viewer's own Labels switch (off at first on a phone,
  // PH5) and each layer's switch, step aside while the Water quality button's sites are on (their own names show then), and start from
  // LABEL_FROM. Returns { remove() }.
  const LABEL_FROM = 10, LABEL_H = 18, DOT = 9;
  function labels({ map, holder, manifest, url }) {
    const layers = list(manifest?.layers).filter((L) => L.wqOwnLabels && L.features);
    if (!map || !holder || !layers.length || typeof fetch !== "function") return { remove() {} };
    let items = [], gone = false, frame = 0;
    const box = el("div", { class: "wqsv-labels", "aria-hidden": "true" });
    const mapEl = map.getContainer?.();
    if (!mapEl) return { remove() {} };
    mapEl.insertBefore(box, mapEl.querySelector(".maplibregl-control-container"));
    const from = Math.max(LABEL_FROM, ...layers.map((L) => Number(L.visible_from) || 0));
    Promise.all(layers.map((L) => fetch(url(L.features)).then((r) => (r.ok ? r.json() : null)).then((fc) => ({ id: L.id, features: list(fc?.features) }), () => ({ id: L.id, features: [] }))))
      .then((read) => {
        if (gone) return;
        items = V().siteLabels(read).map((it) => {
          const span = el("span", { class: "wqsv-label", title: it.full }, it.text);
          box.append(span);
          return { ...it, span, w: 0 };
        });
        layout();
      });
    // (the viewer's switch ids: the layer id with anything but [a-z0-9_-] left out, looked up by id, so no id can break a selector)
    const sw = (id) => { const n = root.document?.getElementById("rv-l-" + String(id).replace(/[^a-z0-9_-]/gi, "")); return n && holder.contains(n) ? n : null; };
    const layerOn = (id) => { const c = sw(id); return c ? c.checked : layers.find((L) => String(L.id) === id)?.visible !== false; };
    const labelsOn = () => { const c = sw("labels"); return c ? c.checked : true; };
    function layout() {
      frame = 0;
      if (gone || !items.length) return;
      const on = labelsOn() && !holder.classList.contains("wqs-on") && map.getZoom() >= from - 0.25;
      box.hidden = !on;
      if (!on) return;
      const W = mapEl.clientWidth, H = mapEl.clientHeight, peek = parseFloat(getComputedStyle(holder).getPropertyValue("--peek")) || 0;
      const cands = [];
      for (const it of items) {
        if (!it.layers.some(layerOn)) { it.span.hidden = true; continue; }
        const q = map.project(it.lngLat);
        if (q.x < -50 || q.y < -50 || q.x > W + 50 || q.y > H + 50) { it.span.hidden = true; continue; }
        if (!it.w) { it.span.hidden = false; it.w = Math.ceil(it.span.offsetWidth) || it.text.length * 7 + 6; }
        // (the viewer sets the points of several layers at one site side by side: the name clears them all)
        cands.push({ key: it.key, x: q.x, y: q.y, w: it.w, h: LABEL_H, dot: Math.max(DOT, 6 * it.layers.length + 3), it });
      }
      // never under what lies over the map: its buttons, the layer panel on a computer, the site panel
      const m0 = mapEl.getBoundingClientRect(), avoid = [...holder.querySelectorAll(".maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-left, .ph-layers, .wqs-ctrl, .rv-fit, .wqs-panel:not([hidden]), .rv-panel:not(.collapsed)")]
        .map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height).map((r) => ({ x0: r.left - m0.left - 2, y0: r.top - m0.top - 2, x1: r.right - m0.left + 2, y1: r.bottom - m0.top + 2 }));
      const shown = V().placeLabels(cands, { width: W, height: H - peek, avoid });
      for (const c of cands) {
        const side = shown.get(c.key);
        c.it.span.hidden = !side;
        if (!side) continue;
        const x = side === "right" ? c.x + c.dot + 4 : c.x - c.dot - 4 - c.w;
        c.it.span.style.transform = "translate(" + Math.round(x) + "px," + Math.round(c.y - LABEL_H / 2) + "px)";
      }
    }
    const soon = () => { if (!frame) frame = (root.requestAnimationFrame || ((f) => setTimeout(f, 16)))(layout); };
    const onChange = (e) => { if (e.target?.id?.startsWith?.("rv-l-")) soon(); };
    map.on("move", soon); map.on("resize", soon);
    holder.addEventListener("change", onChange);
    const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(soon);
    watch?.observe(holder, { attributes: true, attributeFilter: ["class"] });
    return { remove() { gone = true; try { map.off("move", soon); map.off("resize", soon); } catch { /* the map is going */ } holder.removeEventListener("change", onChange); watch?.disconnect(); box.remove(); }, layout };
  }

  FP.wqSiteView = { candidates, render, labels, LABEL_FROM };
})(typeof window === "undefined" ? globalThis : window);
