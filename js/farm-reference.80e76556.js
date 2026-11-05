// The farm map's reference layers, read one source at a time (PERF1b). The farm draws from farm_map, which carries the
// farm's own layers only (PERF1a: its `reference` is []); each reference source's features are read with
// public.farm_reference_context(f, source) only when something switches that source on (a Layers switch, a What's due
// line, an Ask answer's layer set, a hand-set layer put back after Add a block), and kept for the farm's session. The
// Layers drawer and the Sources list need only the list and the counts: the reference_sources rows the farm space
// already reads, and public.farm_reference_counts(f) ({source_key: n}, no geometry). After the farm is drawn and the map
// is idle, the short list the standing answers most often bring up is read ahead, one at a time (config farmView.prefetch),
// never the region-wide zone polygons. A source that fails is "couldn't load just now" and is read again when next
// switched on; the farm never fails for it.
// Either side may be deployed first: with the database before PERF1a (no farm_reference_counts, farm_map's own
// `reference` filled in) the list and the features come from farm_map, as before; with farm_reference_context missing
// (PostgREST 404 / PGRST202) a source falls back to farm_map's entry for it. No DOM, no clock: the browser parts are the
// host's (farm-space.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmReference = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => (Array.isArray(v) ? v : []);
  const count = (fc) => (Array.isArray(fc?.features) ? fc.features.length : 0);
  // What the standing answers most often bring up: Rivers (the shared waterways row, read for the map in view), bores,
  // consents and water-quality sites. config.js farmView.prefetch overrides it.
  const PREFETCH = ["rivers", "ecan-wells", "ecan-consents", "ecan-wq-sites"];
  // The region-wide zone and catchment polygons (one or two features of 4-14 k vertices each): never read ahead, even if
  // a config list names one; they are read when switched on.
  const ZONES = /(?:^|-)(?:zones?|subregions|catchments)(?:-|$)/;
  const isZone = (s) => ZONES.test(String(s?.key || "")) || /zone|catchment/i.test(String(s?.theme || ""));
  // A function the database doesn't have yet (PostgREST: 404 / PGRST202, or its "could not find the function" message; Postgres: 42883). Not "does not exist": that also
  // says a relation inside a function is missing, which is a failure to report, not a database to fall back for.
  const missing = (e) => !!e && (e.code === "PGRST202" || e.code === "42883" || e.status === 404 || /could not find the function/i.test(String(e.message || "")));

  // The served sources with features in this farm's context, by name (as farm_map listed them): {key, name, theme,
  // attribution, count}. counts: farm_reference_counts' object, or null when it could not be read (a database without
  // it): then the sources farm_map itself carried. A served source with no features here is not listed.
  function index(sources, counts, preloaded) {
    const rows = new Map(list(sources).filter((s) => s && s.key && s.serve_to_customers !== false).map((s) => [s.key, s]));
    const out = new Map();
    if (counts && typeof counts === "object") {
      for (const [key, n] of Object.entries(counts)) {
        // PERF3c: a dense source in a group's area comes as {by_viewport: true} (not counted): listed, with no count
        const k = n && typeof n === "object" && n.by_viewport === true ? null : Number(n);
        if (k !== null && !(k > 0)) continue;
        const s = rows.get(key) || list(preloaded).find((r) => r?.key === key) || { key };
        out.set(key, { key, name: s.name || key, theme: s.theme || null, attribution: s.attribution || null, count: k });
      }
    }
    for (const r of list(preloaded)) {
      if (!r?.key || out.has(r.key) || !count(r.features)) continue;
      out.set(r.key, { key: r.key, name: r.name || r.key, theme: r.theme || null, attribution: r.attribution || null, count: count(r.features) });
    }
    return [...out.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  // The reference keys a set of scene keys (farm-space.js sceneFor) asks for: those in the index. "rivers" is the shared
  // waterways row (read for the map in view as the person pans), not a reference source.
  const keysFor = (want, idx) => { const w = new Set(want || []); return list(idx).filter((s) => w.has(s.key)).map((s) => s.key); };
  // The sources a What's due line's place (or an Ask frame) needs drawn before it can be framed: those of its themes,
  // the rows its themes are governed by, and the layers it names.
  function placeKeys(place, idx, governs = {}) {
    const p = place || {}, themes = new Set(list(p.themes)), keys = new Set(list(p.layers));
    for (const t of themes) for (const k of governs[t] || []) keys.add(k);
    return list(idx).filter((s) => keys.has(s.key) || themes.has(s.theme)).map((s) => s.key);
  }

  // One farm's reference sources for its session. sb: the caller's client; farm: its id; counts / sources / preloaded as
  // index(); onArrive(entry): a source's entry has been read (draw it); onChange(key, state): a source's state changed.
  // context(key): the read of one source's entry (PERF3b: a group's map passes public.group_reference_context's); the
  // farm's farm_reference_context by default.
  function create({ sb, farm, counts = null, sources = [], preloaded = [], onArrive = () => {}, onChange = () => {}, context = null } = {}) {
    const idx = index(sources, counts, preloaded), known = new Map(idx.map((s) => [s.key, s]));
    const cache = new Map(), loading = new Map(), failed = new Map();
    let gone = false, contextMissing = false, prefetching = null;
    // farm_map's own entries (a database before PERF1a): already drawn by the Map scene, so already loaded
    for (const r of list(preloaded)) if (r?.key && known.has(r.key)) cache.set(r.key, r);
    const state = (key) => (cache.has(key) ? "loaded" : loading.has(key) ? "loading" : failed.has(key) ? "failed" : known.has(key) ? "pending" : "none");
    const fallback = (key) => list(preloaded).find((r) => r?.key === key) || { ...known.get(key), features: { type: "FeatureCollection", features: [] } };
    async function fetchOne(key) {
      if (contextMissing) return fallback(key);
      let r;
      try { r = await (context ? context(key) : sb.rpc("farm_reference_context", { f: farm, source: key })); } catch (e) { r = { error: e }; }
      if (r?.error && missing(r.error)) { contextMissing = true; return fallback(key); }
      if (r?.error) throw r.error;
      // null: not served, or the farm can no longer be read; nothing to draw
      return r?.data || { ...known.get(key), features: { type: "FeatureCollection", features: [] } };
    }
    function read(key) {
      if (cache.has(key)) return Promise.resolve(cache.get(key));
      if (loading.has(key)) return loading.get(key);
      failed.delete(key);
      const p = fetchOne(key).then((entry) => {
        loading.delete(key);
        if (gone) return null;
        const e = { ...entry, key };
        cache.set(key, e);
        onArrive(e); onChange(key, "loaded");
        return e;
      }, (err) => {
        loading.delete(key);
        if (gone) return null;
        failed.set(key, err?.message || String(err));
        onChange(key, "failed");
        return null;
      });
      loading.set(key, p);
      onChange(key, "loading");
      return p;
    }
    // Read every key asked for that this farm has and that isn't already here or on its way (a failed one again).
    const want = (keys) => Promise.all([...new Set(keys || [])].filter((k) => known.has(k) && !cache.has(k)).map(read));
    // Read ahead, one at a time: the config list's sources this farm has (never a zone polygon). "rivers" is the host's
    // (it reads the shared waterways for the map in view): readRivers is called for it. A source already here, on its
    // way or failed is skipped (failed: read again on the next switch, not behind the person's back).
    function prefetch(keys = PREFETCH, { readRivers = null } = {}) {
      if (prefetching) return prefetching;
      prefetching = (async () => {
        for (const key of list(keys)) {
          if (gone) return;
          if (key === "rivers") { if (readRivers) { try { await readRivers(); } catch { /* the Rivers row reads again when switched on */ } } continue; }
          const s = known.get(key);
          if (!s || isZone(s) || state(key) !== "pending") continue;
          await read(key);
        }
      })();
      return prefetching;
    }
    return {
      index: idx, has: (key) => known.has(key), keys: () => idx.map((s) => s.key), state, entry: (key) => cache.get(key) || null,
      failedKeys: () => [...failed.keys()], error: (key) => failed.get(key) || null, want, prefetch,
      destroy: () => { gone = true; },
    };
  }

  return { PREFETCH, index, keysFor, placeKeys, isZone, missing, create };
});
