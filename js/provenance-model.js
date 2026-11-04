// Provenance everywhere (PROV1): where a reference layer came from, in the shapes the app shows. No DOM, network or clock.
// A reference source (public.reference_sources, read as the caller; the same rows Ask's data dictionary comes from) carries its
// name, provider, licence, when it was last refreshed (refreshed_at) or its own effective date, and the dictionary summary. This
// module turns those rows into (1) the one plain provenance line a popup, list or chart carries, (2) the "Sources" list for a
// space's Layers drawer, and (3) the "Not loaded" state of a source that is registered but holds nothing. It never invents a
// date or a licence: what the row does not say reads "date not recorded" / "licence terms being recorded".
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.provenance = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const list = (v) => (Array.isArray(v) ? v : []);
  const day = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });
  const dateOnly = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  // "28 Oct 2026" from a timestamp (the New Zealand day) or a plain date; null when there is none or it is not a date.
  function dateText(v) {
    const s = text(typeof v === "string" ? v : v instanceof Date ? v.toISOString() : null);
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + "T12:00:00Z"); return Number.isFinite(d.getTime()) ? dateOnly.format(d) : null; }
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? day.format(d) : null;
  }

  // The licence's name from the long recorded wording ("CC BY 4.0 (CanterburyMaps open data, unless specifically stated). ...
  // accepted for use by ..." keeps only "CC BY 4.0"); null when the wording names none (the recorded text is the owner's
  // internal note, so it is not shown).
  const LICENCE = /\bCC0(?: 1\.0)?\b|\bCC[ -]BY(?:[- ](?:NC|SA|ND))*(?: \d\.\d)?|\bOpen Government Licen[cs]e(?: \(?New Zealand\)?)?/i;
  function licenceName(licence) {
    const m = String(licence ?? "").match(LICENCE);
    if (!m) return null;
    const name = m[0].replace(/\s+/g, " ").trim();
    return /^open/i.test(name) ? name : name.toUpperCase().replace(/^CC-BY/, "CC BY");
  }

  // A source row as the app uses it. `served` is the database's serve_to_customers.
  function normalise(row) {
    const r = row || {};
    const name = text(r.name) || text(r.key);
    if (!name) return null;
    const count = r.feature_count == null ? null : Number(r.feature_count);
    const refreshed = text(r.refreshed_at);
    return { key: text(r.key), name, provider: text(r.provider), licence: licenceName(r.licence), attribution: text(r.attribution), summary: text(r.summary), theme: text(r.theme),
      coverage: text(r.coverage), served: r.serve_to_customers === true || r.served === true, refreshedAt: refreshed, featureCount: Number.isFinite(count) ? count : null,
      asAt: dateText(r.refreshed_at) || dateText(r.effective_from), asAtKind: dateText(r.refreshed_at) ? "refreshed" : dateText(r.effective_from) ? "effective" : null,
      // loaded: a refresh has run and left features behind. A source registered but never refreshed (or refreshed to nothing) is "not loaded".
      loaded: !!refreshed && count !== 0 };
  }

  // The rows by key: Map(key -> normalised). Rows without a key are dropped.
  function index(rows) {
    const out = new Map();
    for (const row of list(rows)) { const s = normalise(row); if (s?.key) out.set(s.key, s); }
    return out;
  }

  // The provenance line, in plain parts: "Source: Wells and bores (ECan), Environment Canterbury. As at 28 Oct 2026. Licence: CC BY 4.0."
  // `src` is a normalised source (see normalise), or a layer-shaped fallback {name, attribution} when the row could not be read.
  // Null when there is no source at all. A missing date or licence is said so, never left out or made up.
  function parts(src) {
    const s = src && (src.asAtKind !== undefined ? src : normalise(src));
    if (!s) return null;
    const lead = s.provider && !s.name.toLowerCase().includes(s.provider.toLowerCase()) ? s.name + ", " + s.provider : s.name;
    return { source: lead, asAt: s.asAt ? "As at " + s.asAt : "As at date not recorded", licence: s.licence ? "Licence: " + s.licence : "Licence terms being recorded", loaded: s.loaded !== false };
  }
  function line(src) {
    const p = parts(src);
    return p ? "Source: " + p.source + ". " + p.asAt + ". " + p.licence + "." : null;
  }

  // A source with the sample date a space holds as its as-at, when the row has no date of its own.
  function withSample(src, at) {
    const d = !src.asAt && at ? dateText(at) : null;
    return d ? { ...src, asAt: d, asAtKind: "sample" } : src;
  }

  // The line for a source by key from an index (or from the raw rows), falling back to the layer's own name when the row is
  // not there: `fallback` is the map's reference entry ({name, attribution}). Null when neither names a source.
  // `asAt`: a date to use when the row has none (the latest sample a space holds, for a results dataset that is never "refreshed").
  function lineFor(sources, key, fallback, asAt) {
    const idx = sources instanceof Map ? sources : index(sources);
    const hit = idx.get(key);
    if (hit) return line(withSample(hit, asAt));
    return fallback ? line({ name: text(fallback.name) || text(fallback.attribution), key }) : null;
  }
  // The lines for several keys, one each, those that have no source left out (rivers draw from two).
  const linesFor = (sources, keys) => { const idx = sources instanceof Map ? sources : index(sources); return list(keys).map((k) => lineFor(idx, k)).filter(Boolean); };

  // Does a source's stated coverage reach a farm in this region? An unstated coverage is not ruled out; "other" is not assumed.
  function reaches(coverage, region) {
    const c = String(coverage || "").toLowerCase(), r = String(region || "").toLowerCase();
    if (!c || c === "national") return true;
    if (c === "other") return false;   // another region's, by its own word
    if (!r) return true;               // a space with no stated region (a group): Canterbury's and the Hurunui's are not ruled out
    return c === r || (c === "hurunui" && r === "canterbury");
  }

  // The Sources list of a space: the served sources relevant to it, loaded ones first (by name) then those not loaded.
  // Relevant: a loaded source is one the space draws (its key is in `keys`: the map's reference layers and the monitoring
  // sources its water-quality line reads); a source not loaded is listed when its coverage reaches the space's region,
  // because the gap is part of the picture. Never a source that is not served to customers.
  // A measurements-theme source (the results of a monitoring dataset, e.g. ecan-wq) is never "refreshed" by the reference tool, so it is
  // judged by what the space holds: `loadedKeys` are the datasets whose results the space has (see heldBy), `asAt` their latest sample dates.
  // Without results it is listed in neither list; it is not "not loaded" on the strength of an empty refresh date.
  function sourcesFor(rows, { keys = [], region = null, loadedKeys = [], asAt = {} } = {}) {
    const want = new Set(keys), held = new Set(loadedKeys);
    const all = [...index(rows).values()].filter((s) => s.served).filter((s) => s.theme !== "measurements" || held.has(s.key))
      .map((s) => (held.has(s.key) ? { ...withSample(s, asAt[s.key]), loaded: true } : s));
    const byName = (a, b) => a.name.localeCompare(b.name, "en-NZ", { sensitivity: "base" });
    return {
      loaded: all.filter((s) => s.loaded && want.has(s.key)).sort(byName),
      notLoaded: all.filter((s) => !s.loaded && (want.has(s.key) || reaches(s.coverage, region))).sort(byName),
    };
  }

  // What a space's monitoring sites say about the sources behind them: each site's source key (ecan-wq-sites) and its results dataset
  // (ecan-wq, the key without "-sites"). The dataset is held when a site has a sample; its as-at is the latest sample date.
  function heldBy(sites) {
    const keys = new Set(), loadedKeys = new Set(), asAt = {};
    for (const x of list(sites)) {
      const k = text(x?.source_key);
      if (!k) continue;
      const dataset = k.replace(/-sites$/, "");
      keys.add(k); keys.add(dataset);
      const t = Date.parse(x.lastSampled);
      if (Number.isFinite(t)) { loadedKeys.add(dataset); if (!(Date.parse(asAt[dataset]) >= t)) asAt[dataset] = x.lastSampled; }
    }
    return { keys: [...keys], loadedKeys: [...loadedKeys], asAt };
  }

  // What a source not loaded says, in one plain sentence (never an error).
  const NOT_LOADED = "Not loaded yet: nothing from this source is on the map or in answers.";

  // The reference_sources columns the app reads for provenance (the farm space and the group space both ask for these).
  const COLUMNS = "key,name,theme,provider,licence,attribution,summary,refreshed_at,effective_from,feature_count,coverage,serve_to_customers";

  return { heldBy, COLUMNS, dateText, licenceName, normalise, index, parts, line, lineFor, linesFor, reaches, sourcesFor, NOT_LOADED };
});
