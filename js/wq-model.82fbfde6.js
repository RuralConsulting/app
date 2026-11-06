// Water quality on the farm (M1b): what the read functions return (wq_sites_near, wq_site_latest, measurement_series),
// shaped for the screen. No DOM, network or clock. Nothing here assesses anything: a band, a grade or a trend comes only
// from a versioned analysis method (module X1), so until one exists the screen says "not assessed" where it would go.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.wqModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => Array.isArray(v) ? v : [];
  const text = (v) => typeof v === "string" && v.trim() ? v.trim() : "";
  const NOT_ASSESSED = "not assessed";
  const RADIUS_KM = 10;
  // The monitoring sites' own source rows name who runs them; the results' rows carry the exact attribution statement.
  // WQ8: the NRWQN dataset is credited as its migration's attribution says (supabase/migrations/20261106034000_niwa_nrwqn.sql).
  const SOURCE_NAMES = { "ecan-wq-sites": "Environment Canterbury", "ecan-wq": "Environment Canterbury", "niwa-hydro-sites": "NIWA", "niwa-hydro": "NIWA",
    "niwa-nrwqn-sites": "Earth Sciences New Zealand (NIWA)", "niwa-nrwqn": "Earth Sciences New Zealand (NIWA)" };
  const sourceName = (key) => SOURCE_NAMES[key] || null;

  // ---- NZTM2000 <-> WGS84 (the sites' geometry is stored in NZTM, EPSG:2193; the map is longitude and latitude) -----
  // Transverse Mercator on GRS80 by Krüger's series (centre 173°E, scale 0.9996, false origin 1600000 E, 10000000 N);
  // accurate to well under a millimetre over New Zealand.
  const GRS80 = { a: 6378137, f: 1 / 298.257222101 }, K0 = 0.9996, LON0 = 173 * Math.PI / 180, FE = 1600000, FN = 10000000;
  const n = GRS80.f / (2 - GRS80.f), A = GRS80.a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180, 13 * n ** 2 / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440, 61 * n ** 3 / 240 - 103 * n ** 4 / 140, 49561 * n ** 4 / 161280];
  const beta = [n / 2 - 2 * n ** 2 / 3 + 37 * n ** 3 / 96 - n ** 4 / 360, n ** 2 / 48 + n ** 3 / 15 - 437 * n ** 4 / 1440, 17 * n ** 3 / 480 - 37 * n ** 4 / 840, 4397 * n ** 4 / 161280];
  const delta = [2 * n - 2 * n ** 2 / 3 - 2 * n ** 3 + 116 * n ** 4 / 45, 7 * n ** 2 / 3 - 8 * n ** 3 / 5 - 227 * n ** 4 / 45, 56 * n ** 3 / 15 - 136 * n ** 4 / 35, 4279 * n ** 4 / 630];
  const rad = Math.PI / 180;
  function nztmToLngLat(e, nth) {
    const xi = (nth - FN) / (K0 * A), eta = (e - FE) / (K0 * A);
    let xi2 = xi, eta2 = eta;
    beta.forEach((b, j) => { const k = 2 * (j + 1); xi2 -= b * Math.sin(k * xi) * Math.cosh(k * eta); eta2 -= b * Math.cos(k * xi) * Math.sinh(k * eta); });
    const chi = Math.asin(Math.sin(xi2) / Math.cosh(eta2));
    let phi = chi;
    delta.forEach((d, j) => { phi += d * Math.sin(2 * (j + 1) * chi); });
    return [(LON0 + Math.atan2(Math.sinh(eta2), Math.cos(xi2))) / rad, phi / rad];
  }
  function lngLatToNztm(lng, lat) {
    const phi = lat * rad, lam = lng * rad - LON0, c = 2 * Math.sqrt(n) / (1 + n);
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
    const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let e = eta, nth = xi;
    alpha.forEach((a, j) => { const k = 2 * (j + 1); e += a * Math.cos(k * xi) * Math.sinh(k * eta); nth += a * Math.sin(k * xi) * Math.cosh(k * eta); });
    return [FE + K0 * A * e, FN + K0 * A * nth];
  }
  // A site's position as [longitude, latitude] from its geometry: GeoJSON (an object or its text) in NZTM, or already degrees.
  function siteLngLat(geom) {
    let g = geom;
    if (typeof g === "string") { try { g = JSON.parse(g); } catch { return null; } }
    const c = g?.type === "Point" ? g.coordinates : null;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    return Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90 ? [c[0], c[1]] : nztmToLngLat(c[0], c[1]);
  }

  // ---- words ---------------------------------------------------------------------------------------------------------
  const dateFormat = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });
  const date = (t) => { const d = new Date(t); return Number.isFinite(d.getTime()) ? dateFormat.format(d) : "date not recorded"; };
  const distanceText = (m) => !Number.isFinite(Number(m)) ? "" : Number(m) < 1000 ? Math.round(Number(m) / 10) * 10 + " m" : (Number(m) / 1000).toFixed(Number(m) < 10000 ? 1 : 0) + " km";
  // A site in the Compare picker: its name and how far it is; the farm's own site is "on this farm", never "(0 m)".
  const compareLabel = (s) => s.name + (Number(s.distance_m) === 0 ? " (on this farm)" : s.distance ? " (" + s.distance + ")" : "");
  const CENSORED = ["<", ">", "≤", "≥"];
  // The text as reported, when it says the same number as the value (in the row's unit); null when there is none, or when it says a
  // different number (text kept in another unit than the value's: it would be printed beside the wrong unit). A text that is not a
  // number ("ND") is kept as it is.
  function reportedText(row) {
    const t = text(row?.value_text);
    if (!t) return null;
    const n = Number(t.replace(/^[<>≤≥]\s*/, "").replace(/,/g, "")), v = row?.value === null || row?.value === undefined || row?.value === "" ? NaN : Number(row.value);
    return !Number.isFinite(n) || !Number.isFinite(v) || Math.abs(n - v) <= 1e-9 * Math.max(1, Math.abs(v)) ? t : null;
  }
  // A result as the source reported it: "<0.002" stays "<0.002". The qualifier is never dropped, the limit never shown as exact.
  function valueText(row) {
    const reported = reportedText(row);
    if (reported) return reported;
    const v = row?.value === null || row?.value === undefined ? NaN : Number(row.value);
    return Number.isFinite(v) ? (CENSORED.includes(row?.qualifier) ? row.qualifier : "") + String(Number(v.toPrecision(4))) : "no value";
  }
  const isCensored = (row) => CENSORED.includes(row?.qualifier);

  // ---- sites ---------------------------------------------------------------------------------------------------------
  // Whose a site is: the farm's own, a group's, or the shared source's (named).
  function ownerLabel(site, farmId) {
    if (site?.owner_farm_id) return site.owner_farm_id === farmId ? "This farm's own" : "Another farm's";
    if (site?.owner_org_id) return "A group's";
    return sourceName(site?.source_key) || "Shared monitoring site";
  }
  // The nearest first, as the read function returns them, with the screen's own fields.
  function sites(rows, farmId, max = 12) {
    return list(rows).filter((r) => r && r.site_id != null).slice(0, max).map((r, i) => ({
      id: r.site_id, n: i + 1, name: text(r.name) || text(r.external_id) || "Monitoring site", externalId: text(r.external_id), type: text(r.site_type),
      distance_m: Number(r.distance_m), distance: distanceText(r.distance_m), away: Number(r.distance_m) > 0 ? distanceText(r.distance_m) + " away" : Number(r.distance_m) === 0 ? "on the farm" : "", lastSampled: r.last_sampled || null,
      last: r.last_sampled ? "last sample " + date(r.last_sampled) : "no results yet", lngLat: siteLngLat(r.geom), source_key: r.source_key || null, owner: ownerLabel(r, farmId),
    }));
  }
  const featureCollection = (sites_, selected = null) => ({ type: "FeatureCollection", features: sites_.filter((s) => s.lngLat).map((s) => ({
    type: "Feature", id: s.id, geometry: { type: "Point", coordinates: s.lngLat }, properties: { site_id: s.id, n: s.n, name: s.name, distance: s.distance, selected: s.id === selected } })) });
  const summary = (sites_, km = RADIUS_KM) => !sites_.length ? "No monitoring sites within " + km + " km" :
    sites_.length + (sites_.length === 1 ? " monitoring site" : " monitoring sites") + " within " + km + " km";
  // The sources a list of sites comes from, named once ("Environment Canterbury"; "This farm's own and Environment Canterbury").
  const sourcesLine = (sites_) => {
    const names = [...new Set(sites_.map((s) => s.owner))];
    return names.length ? "Source: " + (names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]) : "";
  };

  // ---- a site's latest values -----------------------------------------------------------------------------------------
  // One row per parameter: the value as reported, its unit and date, and where a band or trend would go, "not assessed".
  function latest(rows) {
    const out = list(rows).filter((r) => r && r.parameter).map((r) => ({
      parameter: r.parameter, name: text(r.parameter_name) || r.parameter, value: valueText(r), censored: isCensored(r), unit: text(r.unit), sampled_at: r.sampled_at, date: date(r.sampled_at),
      provisional: !!r.provisional, source_key: r.source_key || null, assessment: NOT_ASSESSED, attribution: text(r.attribution) || text(r.source_name),
    }));
    out.sort((a, b) => a.name.localeCompare(b.name));
    const first = list(rows).find((r) => r && (text(r.source_name) || text(r.attribution)));
    return { rows: out, source: text(first?.source_name), attribution: text(first?.attribution), provisional: out.some((r) => r.provisional) };
  }
  // ---- WQ2: a monitoring location (public.monitoring_location) ----------------------------------------------------------
  // A place whose record has passed between site ids (a site replaced by another, a recorder beside it), joined by a reviewed
  // list, never by name or distance. Its label is its name and its CURRENT site's id; its members are listed with their roles
  // and dates. null when the read gave nothing usable (no location, or none of its sites readable).
  const ROLE_WORDS = { current: "current", successor: "successor", predecessor: "predecessor", co_located: "co-located" };
  const dayFormat = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const day = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(text(d)) ? dayFormat.format(new Date(d + "T00:00:00Z")) : "");
  function location(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Number.isFinite(Number(raw.id)) || !text(raw.name)) return null;
    const members = list(raw.members).filter((m) => m && text(m.external_id) && ROLE_WORDS[m.role]);
    const current = members.find((m) => m.role === "current" && m.monitoring_site_id != null) || members.find((m) => m.monitoring_site_id != null);
    return current ? { id: Number(raw.id), key: text(raw.key), name: text(raw.name), current, members } : null;
  }
  const locationLabel = (loc) => loc.name + " (" + loc.current.external_id + ")";
  const memberText = (m) => m.external_id + " (" + ROLE_WORDS[m.role] +
    (day(m.valid_from) && day(m.valid_to) ? ", " + day(m.valid_from) + " to " + day(m.valid_to) : day(m.valid_from) ? ", from " + day(m.valid_from) : day(m.valid_to) ? ", to " + day(m.valid_to) : "") + ")";
  const locationLine = (loc) => "Combined record of " + loc.name + ": " + loc.members.map(memberText).join(", ") +
    ". Each site's results count only within its dates; where dates overlap, the current site's are used.";

  // WQ6 (Q18 default): a location's line is drawn on its CURRENT member's key; another member's different key of the same family
  // (the recorder's nitrate-N beside the current site's nitrate-nitrite-N) is its own labelled line, never pooled with it.
  // FAMILIES mirrors supabase/functions/_shared/wq/families.data.ts (tests/app/wq.test.cjs fails when they differ); a key with no
  // declared family is its own family.
  const FAMILIES = Object.freeze({ "nitrate-n": "nitrate", "nitrate-nitrite-n": "nitrate" });
  const familyOf = (k) => (Object.prototype.hasOwnProperty.call(FAMILIES, k) ? FAMILIES[k] : k);
  const sameFamily = (a, b) => a !== b && familyOf(a) === familyOf(b);
  // The plan for a location's whole-record chart of `parameter`. `held` is {site id: [parameter keys the site has]}. The line is
  // drawn on `parameter` when the current site has it; else on the current site's own key of the family (so the line is the
  // current site's, as its label says); `others` are the other members' results on a different key of that family, one entry per
  // member and key. Nothing in `others` is ever part of the main line.
  function locationPlan(loc, parameter, held) {
    const has = (id, k) => list(held?.[id]).includes(k), cur = loc.current.monitoring_site_id;
    let main = parameter;
    if (!has(cur, parameter)) main = Object.keys(FAMILIES).find((k) => sameFamily(k, parameter) && has(cur, k)) || parameter;
    const others = [];
    for (const m of loc.members) {
      if (m.monitoring_site_id == null || m.monitoring_site_id === cur) continue;
      for (const k of list(held?.[m.monitoring_site_id])) if (sameFamily(k, main)) others.push({ parameter: k, member: m });
    }
    return { main, others };
  }
  const otherLabel = (o) => o.member.external_id + " (" + ROLE_WORDS[o.member.role] + ")";

  // FU2: the location's combined record is read as a window, never whole (public.monitoring_location_series takes p_from / p_to,
  // NZ dates, and answers oldest first; a read that PostgREST caps would drop the NEWEST results). The window is the years the
  // chart draws, ending at the parameter's latest result; it is narrowed (10 years, then 3, then 1) while a read fills the cap.
  const LOCATION_WINDOW_YEARS = [10, 3, 1], READ_CAP = 1000;
  const nzDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" });
  // The NZ date `years` before the latest result's NZ date ("YYYY-MM-DD"), or null when the latest result's time is not understood.
  function locationWindowStart(latestAt, years) {
    const t = new Date(latestAt);
    if (!Number.isFinite(t.getTime()) || !(years > 0)) return null;
    const [y, m, d] = nzDay.format(t).split("-").map(Number);
    const from = new Date(Date.UTC(y - years, m - 1, d));
    if (from.getUTCMonth() !== m - 1) from.setUTCDate(0);   // 29 Feb a non-leap year earlier: the last day of February
    return from.toISOString().slice(0, 10);
  }
  // The newest of some result times (ISO strings; unusable ones ignored), as given, or null when none is usable.
  function latestInstant(times) {
    let best = null, at = -Infinity;
    for (const t of list(times)) { const ms = new Date(t).getTime(); if (Number.isFinite(ms) && ms > at) { at = ms; best = t; } }
    return best;
  }
  // The line under the chart saying which window is drawn, and when a read still filled the cap, that it may be cut short.
  const windowLine = ({ from, years, capped }) => from
    ? "Showing the last " + (years === 1 ? "year" : years + " years") + " of the combined record, from " + day(from) + "." + (capped ? " This window is large and may be cut short." : "")
    : "";

  // The Chart block's data for a site and parameter: the series read, the unit, the source's attribution and the provisional
  // flag from the latest row. No bands (none are passed), so the chart says "not assessed". A comparison site is a second series.
  // WQ2: with a location, the series is the location's combined record, labelled with its name and current site's id, and the
  // first provenance line lists its members and their dates.
  // WQ6: `others` are other members' results on a different key of the family ({ parameter, name, member, rows }): the first with
  // results is drawn as its own labelled line in the second place (it takes the comparison's), named in the provenance, never pooled.
  // WQ8: each dataset's credit, from rows that carry one (latest()'s rows, from wq_site_latest): {dataset key: attribution}. The first
  // credit seen for a key is kept.
  function credits(...rowLists) {
    const out = {};
    for (const r of rowLists.flatMap(list)) if (r && text(r.source_key) && text(r.attribution) && !out[r.source_key]) out[r.source_key] = text(r.attribution);
    return out;
  }
  // WQ8: `credits` ({dataset key: attribution}) names each dataset's agency. A location's record that holds rows of more than one dataset
  // is drawn as one labelled line per dataset (never joined, never pooled), each named in the key with its agency; the chart's credit
  // adds every dataset drawn that the opened site's attribution does not already name.
  function chartData({ site, parameter, name, unit, series, attribution, provisional, compare, bands, provenance, location: loc, window: win, others, credits: credit_ }) {
    const points = (rows) => list(rows).filter((r) => r && r.value !== null && r.value !== undefined).map((r) => ({
      t: r.sampled_at, value: Number(r.value), qualifier: CENSORED.includes(r.qualifier) ? r.qualifier : null, text: reportedText(r) }));
    const agency = (k) => sourceName(k) || text(credit_?.[k]).replace(/^Source:\s*/i, "").replace(/\.$/, "") || k;
    const memberIds = (rows) => [...new Set(list(rows).map((r) => r?.site_id).filter((x) => x != null))].map((id) => loc?.members.find((m) => m.monitoring_site_id === id)?.external_id || String(id));
    // The location's label (its name and current site's id) goes on a line only when the current site gave it results; when the
    // results are all another member's, the line is labelled with that member, never with the current site's id.
    const ids = loc ? [...new Set(list(series).map((r) => r?.site_id).filter((x) => x != null))] : [];
    const foreign = !!loc && ids.length > 0 && !ids.includes(loc.current.monitoring_site_id);
    const lineLabel = !loc ? site?.name || "This site" : foreign ? loc.name + " (" + ids.map((id) => loc.members.find((m) => m.monitoring_site_id === id)?.external_id || id).join(", ") + ")" : locationLabel(loc);
    const extra = loc ? list(others).filter((o) => o && list(o.rows).some((r) => r && r.value !== null && r.value !== undefined)) : [];
    const drawn = extra[0] || null;
    const noteLines = [];
    if (foreign) noteLines.push(loc.current.external_id + ", the current site that labels this location, has no " + (name || parameter) + " results in this window; these are " + ids.map((id) => loc.members.find((m) => m.monitoring_site_id === id)?.external_id || id).join(", ") + "'s.");
    for (const o of extra) {
      noteLines.push(otherLabel(o) + " has " + (o.name || o.parameter) + " results on a different key (" + o.parameter + ")" + (o === drawn ? ": drawn as its own line" : ": not drawn here") +
        ", never pooled with " + (name || parameter) + " and not used for a band" + (o.source ? " (" + o.source + ")" : "") + ".");
    }
    // WQ8: the location's record by dataset (source_key), the current site's dataset first, then the one with the newer results.
    const byKey = new Map();
    if (loc) for (const r of list(series)) { const k = text(r?.source_key); byKey.set(k, [...(byKey.get(k) || []), r]); }
    const cur = loc?.current.monitoring_site_id, newest = (rows) => rows.map((r) => String(r?.sampled_at || "")).sort().pop() || "";
    const groups = [...byKey.entries()].map(([key, rows]) => ({ key, rows, ids: memberIds(rows), own: rows.some((r) => r?.site_id === cur) }))
      .sort((a, b) => Number(b.own) - Number(a.own) || newest(b.rows).localeCompare(newest(a.rows)));
    const split = groups.length > 1;
    if (split) noteLines.unshift("Results from more than one dataset, each drawn as its own line, never joined or pooled: " +
      groups.map((g) => agency(g.key) + " (" + (g.key || "dataset not recorded") + "; " + g.ids.join(", ") + ")").join("; ") + ".");
    const lines = loc ? [locationLine(loc), ...(win ? [windowLine(win)] : []), ...noteLines, ...list(typeof provenance === "string" ? [provenance] : provenance)].filter(Boolean) : provenance;
    const second = drawn ? [{ id: "member-" + drawn.member.monitoring_site_id + "-" + drawn.parameter, label: otherLabel(drawn) + ": " + (drawn.name || drawn.parameter), owner: "", note: "another member's key",
      points: points(list(drawn.rows).filter((r) => r?.site_id == null || r.site_id === drawn.member.monitoring_site_id)) }]
      : compare?.site ? [{ id: "site-" + compare.site.id, label: compare.site.name, owner: compare.site.owner || "", points: points(compare.series) }] : [];
    const main = !split ? [{ id: loc ? "location-" + loc.id : "site-" + site?.id, label: lineLabel, owner: site?.owner || "", points: points(series) }]
      : groups.map((g, i) => ({ id: "location-" + loc.id + (i ? "-" + (g.key || "unknown") : ""), label: g.own ? locationLabel(loc) : loc.name + " (" + g.ids.join(", ") + ")",
        owner: agency(g.key) || site?.owner || "", ...(i ? { note: "another dataset", part: true } : {}), points: points(g.rows) }));
    // WQ8 (NRW1 review item 2): every dataset drawn at a location is credited, not only the opened site's.
    let credit = attribution || "";
    if (loc) {
      const drawnRows = [...list(series), ...(drawn ? list(drawn.rows) : [])], seen = new Map();
      for (const r of drawnRows) { const k = text(r?.source_key); if (k) seen.set(k, [...(seen.get(k) || []), r]); }
      if (credit || seen.size > 1) for (const [k, rows] of seen) {
        const c = (text(credit_?.[k]) || sourceName(k) || k).replace(/^Source:\s*/i, "").replace(/\.$/, "");
        if (!credit.includes(c)) credit = credit ? credit + " Also " + c + ", for " + memberIds(rows).join(", ") + "'s results." : "Source: " + c + ".";
      }
    }
    return {
      title: (name || parameter) + " at " + (loc ? (foreign ? lineLabel : locationLabel(loc)) : site?.name || "this site"),
      parameter: { key: parameter, name: name || parameter, unit: unit || text(list(series)[0]?.unit) },
      attribution: credit, provisional: !!provisional, ...(bands ? { bands } : {}), ...(lines ? { provenance: lines } : {}),
      series: [...main, ...second],
    };
  }

  return { NOT_ASSESSED, RADIUS_KM, compareLabel, SOURCE_NAMES, sourceName, nztmToLngLat, lngLatToNztm, siteLngLat, date, distanceText, valueText, isCensored, ownerLabel, sites, featureCollection, summary, sourcesLine, latest, credits, reportedText, chartData, location, locationLabel, FAMILIES, familyOf, sameFamily, locationPlan, locationLine, locationWindowStart, latestInstant, windowLine, LOCATION_WINDOW_YEARS, READ_CAP };
});
