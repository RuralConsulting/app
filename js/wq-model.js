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
  const SOURCE_NAMES = { "ecan-wq-sites": "Environment Canterbury", "ecan-wq": "Environment Canterbury", "niwa-hydro-sites": "NIWA", "niwa-hydro": "NIWA" };
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
  const CENSORED = ["<", ">", "≤", "≥"];
  // A result as the source reported it: "<0.002" stays "<0.002". The qualifier is never dropped, the limit never shown as exact.
  function valueText(row) {
    const reported = text(row?.value_text);
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
      provisional: !!r.provisional, source_key: r.source_key || null, assessment: NOT_ASSESSED,
    }));
    out.sort((a, b) => a.name.localeCompare(b.name));
    const first = list(rows).find((r) => r && (text(r.source_name) || text(r.attribution)));
    return { rows: out, source: text(first?.source_name), attribution: text(first?.attribution), provisional: out.some((r) => r.provisional) };
  }
  // The Chart block's data for a site and parameter: the series read, the unit, the source's attribution and the provisional
  // flag from the latest row. No bands (none are passed), so the chart says "not assessed". A comparison site is a second series.
  function chartData({ site, parameter, name, unit, series, attribution, provisional, compare, bands }) {
    const points = (rows) => list(rows).filter((r) => r && r.value !== null && r.value !== undefined).map((r) => ({
      t: r.sampled_at, value: Number(r.value), qualifier: CENSORED.includes(r.qualifier) ? r.qualifier : null, text: text(r.value_text) || null }));
    return {
      title: (name || parameter) + " at " + (site?.name || "this site"),
      parameter: { key: parameter, name: name || parameter, unit: unit || text(list(series)[0]?.unit) },
      attribution: attribution || "", provisional: !!provisional, ...(bands ? { bands } : {}),
      series: [{ id: "site-" + site?.id, label: site?.name || "This site", owner: site?.owner || "", points: points(series) },
        ...(compare?.site ? [{ id: "site-" + compare.site.id, label: compare.site.name, owner: compare.site.owner || "", points: points(compare.series) }] : [])],
    };
  }

  return { NOT_ASSESSED, RADIUS_KM, SOURCE_NAMES, sourceName, nztmToLngLat, lngLatToNztm, siteLngLat, date, distanceText, valueText, isCensored, ownerLabel, sites, featureCollection, summary, sourcesLine, latest, chartData };
});
