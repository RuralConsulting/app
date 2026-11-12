// N2: water quality sites in Maps, the pure parts (wq-sites.js draws them). In a farm's or a group's published map a person can
// switch on the water quality monitoring sites, open one (its latest results, a chart of a measure with the NPS-FM band shading where
// the NPS-FM has bands for it, the indicative trend, LAWA's published state and trend) and compare up to six. No DOM, network or clock.
// Nothing here calculates a statistic: the median, the band and the trend are the analysis library's (supabase/functions/_shared/wq,
// through the `analysis` function's preview: nothing is stored), and this file only words what came back. The band shading is the
// NPS-FM tables' median band edges, mirrored from bands.data.ts (a test fails when they differ), drawn behind the results and labelled
// as edges for the 5-year median, never as a grade of a single result.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./wq-model.js") : root.FP.wqModel, node ? require("./wq-analysis.js") : root.FP.wqAnalysis,
    node ? require("./group-wq-answer.js") : root.FP.groupWqAnswer);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.wqSitesModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (W, A, G) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const plural = (n, one, many) => Number(n).toLocaleString("en-NZ") + " " + (Number(n) === 1 ? one : many);

  const MAX_SITES = 200;        // the sites drawn: the nearest first, as the read gives them (a group's list can be long)
  const MAX_CHOSEN = 6;         // sites in one comparison
  const RECENT_YEARS = 5;       // a site with no sample in this many years is drawn as an older site
  const LABEL_ZOOM = 13;        // names show from this zoom (and always for a chosen site)
  const WINDOWS = [{ years: 5, label: "Last 5 years" }, { years: 10, label: "Last 10 years" }, { years: 20, label: "Last 20 years" }];
  const DEFAULT_YEARS = 10;
  // The parameters the analysis library takes (supabase/functions/_shared/wq/run.ts PARAMETERS; a test fails when they differ).
  const ANALYSED = ["nitrate-n", "nitrate-nitrite-n", "ammoniacal-n", "drp", "tp", "tn", "e-coli", "turbidity", "clarity", "tss",
    "temperature", "dissolved-oxygen", "conductivity", "ph"];
  // The NPS-FM attribute a parameter is banded by (the library's attribute keys, run.ts BAND_ATTRIBUTES). Nitrate-nitrite-N stands
  // for nitrate where a site has no nitrate-N, as the library and LAWA do.
  const ATTRIBUTE_OF = { "nitrate-n": "nitrate-toxicity", "nitrate-nitrite-n": "nitrate-toxicity", "e-coli": "e-coli", drp: "drp", clarity: "suspended-fine-sediment" };
  // The median column of each NPS-FM table the library bands, as bands.data.ts holds it (best band first: a median at or below the
  // limit is in that band; above the last limit it is `worst`). Suspended fine sediment is left out: its edges depend on the site's
  // sediment class, which is not recorded. `stats`: every statistic the table bands (the band is the worst of them, so the median's
  // edges alone never give a site's band). `labels`: where the table's median column shares one edge between several bands (Table 9:
  // a median of 130 or less is allowed in bands A, B and C), the shading says so instead of naming one band.
  const NPSFM_MEDIAN = Object.freeze({
    "nitrate-toxicity": { table: "Appendix 2A Table 6 – Nitrate (toxicity)", edges: [["A", 1.0], ["B", 2.4], ["C", 6.9]], worst: "D", stats: "the median and the 95th percentile" },
    "e-coli": { table: "Appendix 2A Table 9 – Escherichia coli (E. coli)", edges: [["A", 130], ["D", 260]], worst: "E",
      stats: "four statistics: the median, the 95th percentile and the shares of samples over 540 and over 260", labels: ["Bands A–C (median ≤130)", "Band D", "Band E"] },
    drp: { table: "Appendix 2B Table 20 – Dissolved reactive phosphorus", edges: [["A", 0.006], ["B", 0.010], ["C", 0.018]], worst: "D", stats: "the median and the 95th percentile" },
  });
  // The order measures are offered in: the ones people ask about first, then the rest by name.
  const FIRST = ["nitrate-n", "nitrate-nitrite-n", "e-coli", "drp", "clarity", "turbidity", "ammoniacal-n", "tn", "tp"];
  const TOO_LITTLE = ["insufficient_record", "too_few_values", "repeated_value", "no_results"];
  const NO_LIMITS = Object.freeze([]);   // N3 will pass the group's or farm's own limit lines here; none yet

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = (d) => (/^\d{4}-\d{2}-\d{2}/.test(text(d)) ? Number(d.slice(8, 10)) + " " + MONTHS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4) : "");
  const year = (t) => { const d = new Date(t); return t != null && Number.isFinite(d.getTime()) ? Number(new Intl.DateTimeFormat("en-NZ", { year: "numeric", timeZone: "Pacific/Auckland" }).format(d)) : null; };

  // ---- the sites ---------------------------------------------------------------------------------------------------------
  // The rows of wq_sites_near (a farm), group_wq_sites (a group) or, for a group the old model has no extent for, the shared sites
  // inside its published map (sitesInBox, below), with what the map and the list show. owner: { farm } or { org }. now: ms.
  // where: "farm" | "group" | "map" (the words for distance). Every site read is kept (at most MAX_READ), in this order (N2b, the
  // live check): sites sampled in the last RECENT_YEARS first, then older ones, then sites with no results yet; within each, a
  // farm's nearest first, a group's most recently sampled first (inside a group's area most sites are 0 m away). The list and the
  // pins show the first MAX_SITES with results (listing, pinned); a search reaches the rest.
  const MAX_READ = 1000;
  function siteList(rows, owner, now, where = owner?.farm ? "farm" : "group") {
    const farm = owner?.farm || null, org = owner?.org || null, since = now - RECENT_YEARS * 365.25 * 86400000;
    const usable = list(rows).filter((r) => r && r.site_id != null).slice(0, MAX_READ);
    const out = W.sites(usable, farm, MAX_READ).map((s, i) => {
      const row = usable[i];
      const own = org && row.owner_org_id === org ? "This group's own" : s.owner;
      const at = s.lastSampled ? Date.parse(s.lastSampled) : NaN, has = Number.isFinite(at);
      // a farm says how far a site is ("on the farm" at 0 m); a group or a map says nothing for a site inside it
      const away = where === "farm" ? s.away : Number(s.distance_m) > 0 ? s.distance + " away" : "";
      return { ...s, owner: own, away, recent: has && at >= since, hasResults: has, lastAt: has ? at : null, shared: !row.owner_farm_id && !row.owner_org_id,
        line: [away, s.last, own].filter(Boolean).join(" · ") };
    });
    const tier = (s) => (s.recent ? 0 : s.hasResults ? 1 : 2);
    return out.map((s, i) => [s, i]).sort(([a, i], [b, j]) => tier(a) - tier(b) ||
      (where === "farm" ? (a.distance_m || 0) - (b.distance_m || 0) : (b.lastAt || 0) - (a.lastAt || 0)) || i - j).map(([s]) => s);
  }
  // What the list shows for a search (names containing every word typed, any case): the sites with results, at most MAX_SITES, how
  // many more match, and the sites with no results (folded away under their count).
  function listing(sites, query = "") {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hit = list(sites).filter((s) => words.every((w) => (s.name + " " + (s.externalId || "")).toLowerCase().includes(w)));
    const withResults = hit.filter((s) => s.hasResults), none = hit.filter((s) => !s.hasResults);
    return { shown: withResults.slice(0, MAX_SITES), more: Math.max(withResults.length - MAX_SITES, 0), none, matched: hit.length };
  }
  // The sites with a pin: the first MAX_SITES with results, and any site chosen (one found by a search gets its pin once it is opened).
  function pinned(sites, also = []) {
    const keep = new Set(list(sites).filter((s) => s.hasResults).slice(0, MAX_SITES).map((s) => s.id));
    for (const id of list(also)) keep.add(id);
    return list(sites).filter((s) => keep.has(s.id));
  }
  const intro = (sites, owner, where = owner?.farm ? "farm" : "group") => {
    const n = list(sites).length, none = list(sites).filter((s) => !s.hasResults).length;
    const scope = where === "farm" ? " within " + W.RADIUS_KM + " km of this farm" : where === "map" ? " in or near this map's area" : " in or near this group's area";
    if (!n) return where === "farm" ? "No water quality monitoring sites are recorded within " + W.RADIUS_KM + " km of this farm."
      : where === "map" ? "No water quality monitoring sites are recorded in or near this map's area." : "No sites are linked to this group yet.";
    return plural(n, "monitoring site", "monitoring sites") + scope + (none ? " (" + none + " with no results yet)" : "") + ". " + W.sourcesLine(sites) + ".";
  };

  // When the map's area holds more sites than are read (a box still too full after its splits, or more than MAX_READ), the list says so.
  const PARTIAL = "This map's area holds more sites than are listed here. Zoom in on the map or search by name to find one that is not listed.";
  // The latest sample of each site (site_record_summary: one row per site AND parameter family; a long-record ECan site has about 40),
  // for site ids read SUMMARY_IDS at a time and each batch paged in SUMMARY_PAGE rows by site and family until a short page: the API
  // answers at most 1000 rows a request, in no set order, so a full page is never trusted to be the whole answer. Bounded: at most
  // SUMMARY_PAGES pages a batch. Rows: { site_id, last_sampled }.
  const SUMMARY_IDS = 20, SUMMARY_PAGE = 1000, SUMMARY_PAGES = 20;
  async function summaryRows(sb, siteIds) {
    const ids = [...new Set(list(siteIds))], out = [];
    for (let i = 0; i < ids.length; i += SUMMARY_IDS) {
      for (let page = 0; page < SUMMARY_PAGES; page++) {
        const { data, error } = await sb.from("site_record_summary").select("site_id, family, last_sampled").in("site_id", ids.slice(i, i + SUMMARY_IDS))
          .order("site_id").order("family").range(page * SUMMARY_PAGE, (page + 1) * SUMMARY_PAGE - 1);
        if (error) throw error;
        out.push(...list(data));
        if (list(data).length < SUMMARY_PAGE) break;
      }
    }
    return out;
  }

  // ---- the shared sites inside a map's area (a group with no extent in the old model: N2b) ---------------------------------------
  // The published map's bounds [west, south, east, north] (degrees), with BOX_MARGIN_KM around them (group_wq_sites' own default
  // reach around a group's area), as a box for reference_view_features, which refuses more than 1000 features in one box (it says
  // truncated): the view splits a truncated box in four, at most twice. [] when the bounds are not a box in New Zealand's degrees.
  const BOX_MARGIN_KM = 5;
  function boxes(bounds, km = BOX_MARGIN_KM) {
    const b = list(bounds).map(Number);
    if (b.length !== 4 || !b.every(Number.isFinite) || !(b[2] > b[0]) || !(b[3] > b[1]) || b[0] < 160 || b[2] > 190 || b[1] < -56 || b[3] > -28) return [];
    const dy = km / 111.2, dx = km / (111.32 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180));
    return [[b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy].map((v) => Math.round(v * 1e6) / 1e6)];
  }
  const quarters = ([w, s, e, n]) => { const x = (w + e) / 2, y = (s + n) / 2; return [[w, s, x, y], [x, s, e, y], [w, y, x, n], [x, y, e, n]]; };
  // The rows the panel lists, in group_wq_sites' shape, from the shared sites (monitoring_sites rows: id, external_id, name,
  // site_type, source_key, feature_id) and their features' points (reference_view_features: { id, geometry }), with the latest sample
  // from the council summary (site_record_summary rows: site_id, last_sampled). Inside the map, so 0 m away.
  function boxRows(siteRows, features, summaryRows) {
    const point = new Map(list(features).filter((f) => f && f.geometry?.type === "Point").map((f) => [Number(f.id), f.geometry]));
    const last = new Map();
    for (const r of list(summaryRows)) if (r && r.last_sampled && (!last.has(r.site_id) || r.last_sampled > last.get(r.site_id))) last.set(r.site_id, r.last_sampled);
    return list(siteRows).filter((r) => r && r.id != null && point.has(Number(r.feature_id))).map((r) => ({
      site_id: r.id, external_id: r.external_id, name: r.name, site_type: r.site_type, distance_m: 0, geom: point.get(Number(r.feature_id)),
      last_sampled: last.get(r.id) || null, source_key: r.source_key, owner_farm_id: null, owner_org_id: null }));
  }

  // ---- the chosen sites ----------------------------------------------------------------------------------------------------
  // The comparison as a list of site ids, in the order chosen. add: false opens the site alone; true adds it (at most MAX_CHOSEN).
  function choose(chosen, id, { add = false } = {}) {
    const now = list(chosen);
    if (!add) return [id];
    if (now.includes(id) || now.length >= MAX_CHOSEN) return now;
    return [...now, id];
  }
  const remove = (chosen, id) => list(chosen).filter((x) => x !== id);
  const full = (chosen) => list(chosen).length >= MAX_CHOSEN;

  // ---- the measures --------------------------------------------------------------------------------------------------------
  // The measures at least one chosen site has (from each site's latest results, wq_site_latest via W.latest), each once:
  // { key, name, unit, sites } in FIRST's order, then by name.
  function parameters(latestBySite, ids) {
    const out = new Map();
    for (const id of list(ids)) for (const r of list(latestBySite?.[id]?.rows)) {
      const was = out.get(r.parameter) || { key: r.parameter, name: r.name, unit: r.unit, sites: 0 };
      was.sites++; out.set(r.parameter, was);
    }
    const rank = (k) => (FIRST.includes(k) ? FIRST.indexOf(k) : FIRST.length);
    return [...out.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
  }
  // The measure to show: the one asked for when it is offered, else the first offered, else null.
  const pickParameter = (offered, wanted) => (list(offered).some((p) => p.key === wanted) ? wanted : list(offered)[0]?.key || null);
  const pickYears = (years) => (WINDOWS.some((w) => w.years === Number(years)) ? Number(years) : DEFAULT_YEARS);

  // ---- the record (public.site_record_summary: one row per site and parameter family) ----------------------------------------
  // The summary is rebuilt only after a council load (tools/load_measurements.py), so it is used for shared (council) sites only, as
  // group_wq_sites does: a farm's or group's own sampling imported since would make it stale, and then nothing is said (site.shared).
  function record(rows, site) {
    if (!site?.shared) return null;
    const r = list(rows).filter((x) => obj(x) && Number(x.n) > 0);
    if (!r.length) return null;
    const first = r.map((x) => x.first_sampled).filter(Boolean).sort()[0] || null, last = r.map((x) => x.last_sampled).filter(Boolean).sort().pop() || null;
    const refreshed = r.map((x) => x.refreshed_at).filter(Boolean).sort()[0] || null;
    return { first, last, refreshed, families: r.map((x) => ({ family: text(x.family), n: Number(x.n), first: x.first_sampled || null, last: x.last_sampled || null, years: Number(x.years) || null })) };
  }
  // "Sampled from 2 Mar 1989 to 1 Sep 2026." Never an end earlier than the latest result shown beside it (latestAt): when the site
  // has newer results than the summary, the line runs to the latest result and says the counts are as at the summary.
  function recordLine(rec, latestAt) {
    if (!rec?.first) return "";
    const newer = latestAt && rec.last && Date.parse(latestAt) > Date.parse(rec.last);
    if (!newer) return "Sampled from " + W.date(rec.first) + (rec.last ? " to " + W.date(rec.last) : "") + ".";
    return "Sampled from " + W.date(rec.first) + " to " + W.date(latestAt) + ". Sample counts are as at " + W.date(rec.refreshed || rec.last) + ".";
  }
  // A measure's own record: its family's sample count and first year ("415 samples since 1989").
  function recordOf(rec, parameter) {
    const f = rec?.families.find((x) => x.family === W.familyOf(parameter));
    return f ? { n: f.n, since: year(f.first), text: plural(f.n, "sample", "samples") + (year(f.first) ? " since " + year(f.first) : "") } : null;
  }

  // ---- numbers and credits ----------------------------------------------------------------------------------------------
  // A result as the panel shows it (N2b, the live check: "10.420 mg/L", "107.800 %", "0.000 %"): three significant figures as the
  // Chart block's axis does, whole numbers of 1000 or more kept whole, trailing zeros dropped; a censored result keeps its < or >;
  // text that is not a number ("ND") is kept as it is.
  function tidy(value) {
    const t = text(String(value ?? ""));
    const m = t.match(/^([<>≤≥]?)\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?)$/i);
    if (!m || !m[2] || !/\d/.test(m[2])) return t;
    const n = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(n)) return t;
    const out = Math.abs(n) >= 1000 ? Math.round(n) : Number(n.toPrecision(3));
    return m[1] + String(Object.is(out, -0) ? 0 : out);
  }
  // Who the results are from, once, quietly, at the foot of the panel. The source's own statement, unless it is the licence's
  // template ("This work uses material sourced from [title of work], ... licence by Environment Canterbury."), which is then said
  // in plain words: "Source: Environment Canterbury, CC BY 4.0." Several sources (a comparison): each once.
  function credit(...latests) {
    const one = (L) => {
      const said = text(L?.attribution), by = said.match(/\bby ([^.”"]+?)[.”"\s]*$/), who = by?.[1]?.trim() || W.sourceName(list(L?.rows).find((r) => r.source_key)?.source_key) || text(L?.source);
      if (said && !/\[[^\]]*\]/.test(said)) return said;
      if (!who) return "";
      return "Source: " + who + (/creative commons attribution 4\.0|cc by 4\.0/i.test(said) ? ", CC BY 4.0" : "") + ".";
    };
    return [...new Set(latests.map(one).filter(Boolean))].join(" ");
  }

  // ---- the chart --------------------------------------------------------------------------------------------------------
  // The NPS-FM band shading for a measure: the median edges of its table, as ranges the Chart block draws; null when the NPS-FM has
  // no bands for it here.
  function bandRanges(parameter) {
    const t = NPSFM_MEDIAN[ATTRIBUTE_OF[parameter]];
    if (!t) return null;
    const ranges = [];
    let from = null;
    for (const [band, limit] of t.edges) { ranges.push({ label: "Band " + band, from, to: limit }); from = limit; }
    ranges.push({ label: "Band " + t.worst, from, to: null });
    if (t.labels) ranges.forEach((r, i) => { r.label = t.labels[i]; });
    return { label: "NPS-FM " + t.table + ", the median's edges only. They grade the 5-year median, not single results; a site's band is the worst of " + t.stats +
      ", so it can be worse than the median shows" + (parameter === "nitrate-nitrite-n" ? "; nitrate-nitrite-N stands for nitrate here, as LAWA does" : "") + ".", ranges };
  }
  // Where the Water quality button goes (N2b, the live check: on a map with more of the viewer's buttons it sat exactly on "Whole
  // property"): just below whichever of the viewer's buttons on the right-hand side reaches lowest (covers: their boxes in the map's
  // own pixels, { top, bottom }), with a gap; at the top when there are none.
  const GAP = 8;
  const buttonTop = (covers) => Math.round(Math.max(10, ...list(covers).filter((c) => c && Number.isFinite(c.bottom)).map((c) => c.bottom + GAP)));
  // The map's padding when the sites are framed, so no pin sits under what covers the map: on a computer (720px and wider, the viewer's
  // breakpoint) the viewer's panel on the left and this panel with the map's buttons beside it on the right; on a phone the map's
  // buttons (the Water quality button is the widest, `button` px) on the right and the sheet over the lower half.
  function framePadding(width, height, button = 120) {
    if (width >= 720) return { top: 50, bottom: 50, left: 380, right: 430 + 24 + Math.round(button) + 24 };
    return { top: 60, bottom: Math.round(height * 0.47), left: 30, right: Math.round(button) + 24 };
  }
  // Where a chart window starts: `years` before the latest result (an NZ date), or null for no limit.
  const windowStart = (latestAt, years) => W.locationWindowStart(latestAt, years);
  // The Chart block's data for one site, or for several (one line each, the site colours). seriesBySite: {id: rows of
  // measurement_series}. A site with no results in the window is still in the key ("no results").
  function chartData({ sites, parameter, name, unit, seriesBySite, latestBySite, years, limits = NO_LIMITS }) {
    const all = list(sites), one = all.length === 1;
    const lines = all.map((s) => {
      const L = latestBySite?.[s.id], row = list(L?.rows).find((r) => r.parameter === parameter);
      const d = W.chartData({ site: s, parameter, name, unit, series: seriesBySite?.[s.id] || [], attribution: L?.attribution || "", provisional: row?.provisional });
      const points = d.series[0].points.map((p) => ({ ...p, text: p.text ? tidy(p.text) : p.text }));
      return { site: s, latest: L, row, series: { ...d.series[0], points, id: "site-" + s.id, label: s.name, owner: s.owner || "" } };
    });
    const bands = bandRanges(parameter);
    return {
      title: (name || parameter) + (one ? " at " + all[0].name : " at " + plural(all.length, "site", "sites")) + ", " + (WINDOWS.find((w) => w.years === years)?.label || "").toLowerCase(),
      parameter: { key: parameter, name: name || parameter, unit: unit || "" },
      attribution: "", provisional: lines.some((l) => l.row?.provisional),
      ...(bands ? { bands } : { assess: "The NPS-FM has no bands for this measure here." }),
      ...(one ? {} : { palette: "sites" }),
      limits: list(limits),
      series: lines.map((l) => l.series),
    };
  }

  // ---- the analysis function's previews (POST /functions/v1/analysis, mode preview: nothing is stored) ------------------------
  const ownerOf = (owner) => (owner?.farm ? { farm_id: owner.farm } : { org_id: owner?.org });
  // The request for one tool at one site, or null when the library does not take this measure (no band for it, say).
  function analysisRequest(owner, tool, siteId, parameter, years) {
    if (!ANALYSED.includes(parameter)) return null;
    if (tool === "band") {
      const attribute = ATTRIBUTE_OF[parameter];
      return attribute ? { mode: "preview", owner: ownerOf(owner), params: { tool: "band", site_id: siteId, attribute } } : null;
    }
    return { mode: "preview", owner: ownerOf(owner), params: { tool, site_id: siteId, parameter, years: pickYears(years) } };
  }
  const requestKey = (body) => JSON.stringify(body);
  const windowWords = (p) => (p?.parameters?.from && p?.parameters?.to ? day(p.parameters.from) + " to " + day(p.parameters.to) : "");
  const nameOf = (key, offered) => list(offered).find((x) => x.key === key)?.name || key;

  // The band in words: { short, long, band }. res: what wqAnalysis.request returned, or null when nothing was asked.
  function bandWords(res, parameter, offered) {
    if (!res) return { short: "No NPS-FM band", long: "The NPS-FM has no attribute band the platform works out for this measure.", band: null };
    if (res.kind !== "preview") return { short: "Couldn't be worked out", long: "The NPS-FM band couldn't be worked out just now: " + text(res.message).replace(/\.$/, "") + ".", band: null };
    const p = res.preview, r = p.result;
    if (p.unavailable) return { short: "Not assessed", long: "NPS-FM band not assessed: " + p.unavailable.detail, band: null };
    if (!r?.band) return { short: "Not assessed", long: "NPS-FM band not assessed.", band: null };
    const on = p.parameters?.parameter && p.parameters.parameter !== parameter ? ", worked out on " + nameOf(p.parameters.parameter, offered) : "";
    return { short: "Band " + r.band, band: String(r.band),
      long: "NPS-FM band " + r.band + " (" + (r.table || p.method?.table || "NPS-FM") + "; " + (windowWords(p) ? "5 years, " + windowWords(p) : "5 years") +
        (r.monthly_values ? ", " + plural(r.monthly_values, "monthly value", "monthly values") : "") + on + ")." };
  }

  // The trend in words: { short, long, little } (little: too little data). The library's trend is indicative and says so.
  function trendWords(res, years) {
    const over = " over " + pickYears(years) + " years";
    if (!res) return { short: "No trend", long: "No trend is worked out for this measure.", little: false };
    if (res.kind !== "preview") return { short: "Couldn't be worked out", long: "The trend couldn't be worked out just now: " + text(res.message).replace(/\.$/, "") + ".", little: false };
    const p = res.preview, r = p.result;
    if (p.unavailable) {
      const little = TOO_LITTLE.includes(p.unavailable.reason);
      return { short: little ? "Too little data" : "Not available", little,
        long: (little ? "Too little data for a trend" + over + ". " : "No trend" + over + ": ") + p.unavailable.detail };
    }
    if (!r?.category) return { short: "Not available", long: "No trend" + over + ".", little: false };
    const label = r.assessment === "indeterminate" ? "No clear trend" : r.category.charAt(0).toUpperCase() + r.category.slice(1) + " " + r.assessment;
    const s = r.sen_slope || {}, n = Number(s.per_year);
    const slope = Number.isFinite(n) && s.per_year !== null
      ? (n > 0 ? "+" : "") + Number(n.toPrecision(3)) + " " + text(s.unit).replace(/\/year$/, "") + " a year" + (Number.isFinite(Number(s.percent_per_year)) && s.percent_per_year !== null ? " (" + (s.percent_per_year > 0 ? "+" : "") + Number(Number(s.percent_per_year).toPrecision(2)) + "% a year)" : "")
      : null;
    const conf = Math.round(100 * Math.max(Number(r.p_decreasing) || 0, Number(r.p_increasing) || 0));
    const rests = plural(r.values, r.seasons === "quarterly" ? "quarterly value" : "monthly value", r.seasons === "quarterly" ? "quarterly values" : "monthly values") +
      (r.coverage?.years_with_data ? " in " + r.coverage.years_with_data + " of " + pickYears(years) + " years" : "");
    return { short: label + (slope ? ", " + slope.replace(/ \(.*\)$/, "") : ""), little: false,
      long: label + over + (r.direction ? " (" + r.direction + ", " + conf + "% confidence)" : " (" + conf + "% confidence either way)") + ". " +
        (slope ? "Sen slope " + slope + ". " : "Sen slope not given: results below or above a detection limit decide it. ") +
        "Rests on " + rests + (windowWords(p) ? ", " + windowWords(p) : "") + ". Indicative: worked out by the platform in the LAWA style, not LWP-Trends output." };
  }

  // The median of the window, from the library's summary: "1.7 mg/L (58 samples)", or why there is none.
  function medianWords(res) {
    if (!res) return "Not worked out for this measure";
    if (res.kind !== "preview") return "Couldn't be worked out";
    const p = res.preview, r = p.result;
    if (p.unavailable) return p.unavailable.reason === "no_results" ? "No results in this window" : "Not available";
    if (!r || !Number.isFinite(Number(r.samples))) return "Not available";
    return A.range(r.median, r.unit || "") + " (" + plural(r.samples, "sample", "samples") + ")";
  }

  // LAWA's published state and trend for an ECan site (rows of wq_state_trend_for_site), for one measure: a sentence (shown after
  // "LAWA:"), or null.
  function lawaWords(rows, parameter) {
    const l = G.lawaOf(rows, parameter);
    if (!l || (!l.state.length && !l.trend.length)) return null;
    return (l.release ? "release " + l.release + ": " : "") +
      [...l.state.map((x) => x.attribute + " band " + x.band + (x.period ? " (" + x.period + ")" : "")), ...l.trend.map((x) => x.indicator + " trend" + (x.period ? " over " + x.period : "") + ": " + x.description)].join("; ") +
      "." + (l.attribution ? " " + l.attribution.replace(/\.$/, "") + "." : "");
  }

  // The LAWA line for a site: read is { rows } when wq_state_trend_for_site answered, { failed: true } when it could not be read, null
  // when LAWA does not report on this site (not an ECan site): then there is no line.
  function lawaLine(read, parameter) {
    if (!read) return null;
    if (read.failed) return "LAWA's results couldn't be read just now.";
    return lawaWords(read.rows, parameter) || "LAWA publishes no state or trend for this measure at this site.";
  }

  // The latest result of a measure at a site: "1.7 mg/L, 3 Sep 2026", or null.
  function latestWords(latest, parameter) {
    const r = list(latest?.rows).find((x) => x.parameter === parameter);
    return r ? tidy(r.value) + (r.unit ? " " + r.unit : "") + ", " + r.date : null;
  }

  // The comparison table: one row per chosen site. per: {site id: {latest, summary, band, trend}} (summary, band and trend are the
  // analysis function's replies, or null when not asked).
  function compareRows(sites, parameter, per, years, offered) {
    return list(sites).map((s, i) => {
      const x = per?.[s.id] || {}, latest = latestWords(x.latest, parameter), row = { id: s.id, slot: i + 1, name: s.name, owner: s.owner || "" };
      if (!latest) return { ...row, latest: "No results of this measure", median: "–", band: "–", trend: "–" };
      return { ...row, latest, median: medianWords(x.summary), band: bandWords(x.band, parameter, offered).short, trend: trendWords(x.trend, years).short };
    });
  }

  return { MAX_SITES, MAX_CHOSEN, RECENT_YEARS, LABEL_ZOOM, WINDOWS, DEFAULT_YEARS, ANALYSED, ATTRIBUTE_OF, NPSFM_MEDIAN, NO_LIMITS,
    tidy, credit, siteList, listing, pinned, intro, boxes, BOX_MARGIN_KM, quarters, boxRows, MAX_READ, PARTIAL, summaryRows, SUMMARY_IDS, SUMMARY_PAGE, framePadding, buttonTop, choose, remove, full, parameters, pickParameter, pickYears, record, recordLine, recordOf, bandRanges, windowStart, chartData,
    analysisRequest, requestKey, bandWords, trendWords, medianWords, lawaWords, lawaLine, latestWords, compareRows };
});
