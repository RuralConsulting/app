// The staff page for layer looks (LK2, #416 slice 2), its rules without the DOM or the map: which looks it lists (the shared
// ones, a theme's default or a reference source's, which RCL staff decide), what it says about each, the scene each picture
// draws (the look's own layers and sources, at group scale on a catchment group and at paddock scale on a farm), and what an
// accept or a send-back that the database refused means. Plain words; nothing here writes. The page is js/ops-looks.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else (root.FP = root.FP || {}).looksModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => (Array.isArray(v) ? v : []);
  // A theme's name in plain words (the batch's themes; anything else by its own words).
  const THEMES = { member_blocks: "Member blocks", paddocks: "Paddocks", land_units: "Land units", waterways: "Waterways", zones: "Zones",
    wells: "Wells", consents: "Consents", monitoring_sites: "Monitoring sites", luc: "Land use capability", geology: "Geology", soils: "Soils" };
  const themeName = (t) => THEMES[t] || String(t || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const HEX = /^#[0-9a-f]{6}$/i;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const day = (v) => (v ? new Date(v).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "Pacific/Auckland" }) : null);

  // What a look is the look of, in words: "Theme: Zones (every layer and source of that theme)" or "Source: <its name>".
  function target(r, sources = []) {
    if (r?.source_key) {
      const s = list(sources).find((x) => x.key === r.source_key);
      return { kind: "source", key: r.source_key, name: s?.name || r.source_key, theme: s?.theme || null, words: "The reference source " + (s?.name || r.source_key) };
    }
    if (r?.theme) return { kind: "theme", key: r.theme, name: themeName(r.theme), theme: r.theme, words: "Every layer and reference source of the theme " + themeName(r.theme) };
    return { kind: "layer", key: r?.layer_id || null, name: "One layer", theme: null, words: "One layer" };
  }
  // The look's standing, in words.
  function standing(r) {
    if (r?.status === "reviewed") return r.superseded_at ? "Replaced" : "Accepted" + (r.reviewed_at ? " on " + day(r.reviewed_at) : "");
    if (r?.returned_note) return "Sent back" + (r.returned_at ? " on " + day(r.returned_at) : "");
    return "Proposed, not accepted";
  }
  const open = (r) => r?.status === "proposed";

  // One symbol (a record's own, or a class's) in words: "line #ffd54f, 2 px; fill #ffd54f at 8%; dot 6 px".
  function symbolWords(s = {}) {
    const out = [];
    if (HEX.test(s.line || "") || num(s.line_width) != null) out.push("line " + [s.line, num(s.line_width) != null ? s.line_width + " px" : null, num(s.line_opacity) != null && s.line_opacity < 1 ? Math.round(s.line_opacity * 100) + "%" : null].filter(Boolean).join(", "));
    if (HEX.test(s.fill || "") || num(s.fill_opacity) != null) out.push(num(s.fill_opacity) === 0 ? "no fill" : "fill " + [s.fill, num(s.fill_opacity) != null ? "at " + Math.round(s.fill_opacity * 100) + "%" : null].filter(Boolean).join(" "));
    if (num(s.radius) != null) out.push("dot " + s.radius + " px");
    if (s.dash === true || Array.isArray(s.dash)) out.push("dashed");
    return out.join("; ");
  }
  // The record's fields, as the page lists them: [label, words].
  function fields(r, sources = []) {
    const t = target(r, sources), out = [["What it is the look of", t.words]];
    out.push(["What it is for", r?.purpose || "Not said"]);
    out.push(["Drawn", symbolWords(r?.symbol) || "As today"]);
    if (r?.classify_by) out.push(["By " + r.classify_by, list(r.classes).map((c) => (c.label || c.value) + " (" + (c.starts_with ? "starting " + c.starts_with : c.value) + "): " + (symbolWords(c) || "as above")).join("; ")
      || "Not yet in classes: one look for every value"]);
    const labels = String(r?.label_field || "").split(",").map((f) => f.trim()).filter(Boolean);
    out.push(["Labels", labels.length ? "The " + labels[0] + " field" + (labels.length > 1 ? " (else " + labels.slice(1).join(", else ") + ")" : "") + (num(r.label_min_zoom) != null ? ", from zoom " + r.label_min_zoom : ", at every zoom") : "None"]);
    const lo = num(r?.min_zoom), hi = num(r?.max_zoom);
    out.push(["Shown", lo == null && hi == null ? "At every zoom" : [lo != null ? "from zoom " + lo : null, hi != null ? "to zoom " + hi : null].filter(Boolean).join(" ").replace(/^./, (c) => c.toUpperCase())]);
    out.push(["Standing", standing(r)]);
    if (r?.returned_note) out.push(["What to change", r.returned_note]);
    return out;
  }
  // The looks the page lists: the shared ones (no layer), open proposals first, then those in force; by name.
  function rows(styles, sources = []) {
    const shared = list(styles).filter((r) => r && r.layer_id == null && (r.status === "proposed" || !r.superseded_at));
    const name = (r) => target(r, sources).name;
    return shared.sort((a, b) => (open(b) - open(a)) || name(a).localeCompare(name(b))).map((r) => ({ id: r.id, name: name(r), standing: standing(r), open: open(r), record: r }));
  }

  // ---- the pictures -----------------------------------------------------------------------------------------------------------
  // The reference sources a look's picture reads: its own source, or the served sources of its theme (at most four).
  const MAX_SOURCES = 4;
  function sourcesFor(r, sources = []) {
    if (r?.source_key) return [r.source_key];
    if (!r?.theme) return [];
    return list(sources).filter((s) => s.theme === r.theme && s.serve_to_customers !== false).map((s) => s.key).slice(0, MAX_SOURCES);
  }
  // The layers of the base map (group_map's or farm_map's) the look is about: its theme's.
  const layersFor = (r, base) => (r?.theme ? list(base?.layers).filter((l) => l?.theme === r.theme) : []);
  // The scene a picture draws: the base map's extent (its outline) with only the look's own layers and sources, so the two
  // pictures differ only by the look. `features` fills a deferred layer (by id); `reference` the entries read for the look.
  function scene(base, r, { features = {}, reference = [] } = {}) {
    const fc = (f) => ({ type: "FeatureCollection", features: list(f?.features) });
    const layers = layersFor(r, base).map((l) => ({ ...l, deferred: false, features: features[l.id] ? fc(features[l.id]) : fc(l.features) }));
    return { farm: base?.farm || null, extent: base?.extent || null, extent_ha: base?.extent_ha ?? null, extent_label: base?.extent_label || null,
      titles: fc(null), land_units: r?.theme === "land_units" ? fc(base?.land_units) : fc(null), layers, reference: list(reference), styles: [] };
  }
  const show = (r) => ["extent", "reference", ...(r?.theme ? [r.theme] : [])];
  // The frame of each scale: the whole group's area; or about 1.2 km across at the farm's middle (a paddock or two).
  function bbox(geom) {
    let w = 180, s = 90, e = -180, n = -90;
    const walk = (c) => (typeof c[0] === "number" ? ([w, s, e, n] = [Math.min(w, c[0]), Math.min(s, c[1]), Math.max(e, c[0]), Math.max(n, c[1])]) : c.forEach(walk));
    if (geom?.coordinates) walk(geom.coordinates);
    return w <= e ? [w, s, e, n] : null;
  }
  function frame(scale, extent) {
    const b = bbox(extent);
    if (!b) return null;
    if (scale !== "paddock") return b;
    const [w, s, e, n] = b, x = (w + e) / 2, y = (s + n) / 2, dy = 0.6 / 111.32, dx = dy / Math.cos((y * Math.PI) / 180);
    return [x - dx, y - dy, x + dx, y + dy];
  }
  const polygon = ([w, s, e, n]) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
  // The deferred-layer read for a picture: the frame's box, at the scale's tolerance, bounded as the map's own reads (#375).
  const TOLERANCE = { group: 20, paddock: 1 }, MAX_FEATURES = 4000;
  function layerRead(scale, owner, layerId, box) {
    const [x0, y0, x1, y1] = box, args = { layer: layerId, x0, y0, x1, y1, tolerance_m: TOLERANCE[scale] || 20, max_features: MAX_FEATURES };
    return owner.kind === "group" ? { fn: "group_layer_features", args: { g: owner.id, ...args } } : { fn: "farm_layer_features", args: { f: owner.id, ...args } };
  }
  // What a picture says under it: what is on it, or why nothing is.
  // A picture never draws nothing silently: a source no person is served says so, as does one with no data loaded.
  // notHere: served sources this owner's map has no entry for (a group's map carries only some sources: wells, consents and
  // the river networks are a farm's); `scale` words it ("group" or "paddock").
  // noneNear: served sources with data, none of it near this owner. riversRow: the river sources a group's map shows only as its
  // Rivers row (the shared network, waterways_in_view, which keeps its own look), by key.
  function caption(r, sc, { tooMany = [], failed = [], notServed = [], noData = [], notHere = [], noneNear = [], riversRow = [], scale = "group" } = {}) {
    const n = (x) => list(x?.features?.features).length;
    const drawn = list(sc?.layers).reduce((a, l) => a + n(l), 0) + list(sc?.reference).reduce((a, x) => a + n(x), 0) + (r?.theme === "land_units" ? n({ features: sc?.land_units }) : 0);
    const parts = [];
    if (notServed.length) parts.push("not served to people yet: " + notServed.join(", ") + " (no farm's or group's map shows it, so there is nothing to draw it on)");
    if (noData.length) parts.push("no data loaded yet: " + noData.join(", "));
    if (riversRow.length) parts.push("on a group's map only as its Rivers row, the shared river network, which keeps its own look (this look does not change it): " +
      riversRow.map((k) => RIVERS_ROW[k] || k).join(", "));
    if (notHere.length) parts.push((scale === "group" ? "not shown on a group's map: " : "not on this farm's map: ") + notHere.join(", "));
    if (noneNear.length) parts.push((scale === "group" ? "none near this group: " : "none near this farm: ") + noneNear.join(", "));
    if (!drawn && !notServed.length && !noData.length && !notHere.length && !noneNear.length && !riversRow.length) parts.push("Nothing of this look's layers here" + (tooMany.length || failed.length ? "" : ": the map holds none"));
    if (tooMany.length) parts.push("too many to draw at this scale: " + tooMany.join(", "));
    if (failed.length) parts.push("couldn't be read just now: " + failed.join(", "));
    return parts.length ? parts.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : null;
  }
  // The river sources every real group map shows only as its Rivers row (map-scene.js RIVER_SOURCES), in its words.
  const RIVERS_ROW = { "niwa-rec2-rivers": "River network (REC2)", "linz-topo50-river-centrelines": "River lines (Topo50)" };
  // How the page treats one source of a look, from its reference_sources row (null: the row is not readable), what its
  // context read gave, and the scale and source key:
  //   "not_served"  only a source marked not served to customers;
  //   "failed", "too_many" (truncated), "drawn" (a read that returned features always wins);
  //   "no_data"     the source's own count (reference_sources.feature_count) is known to be 0: never the entry's count, which
  //                 is the count near this owner, and never a null count (unknown);
  //   "none_near"   the read came back empty: the source has data, none of it near;
  //   "rivers_row"  at group scale, a river source a group's map shows only as its Rivers row;
  //   "not_here"    served, but this owner's map has no entry for it.
  const knownZero = (v) => v != null && v !== "" && Number(v) === 0;
  function sourceState(row, res, { scale = "group", key = row?.key } = {}) {
    if (row && row.serve_to_customers === false) return "not_served";
    if (res?.error) return "failed";
    if (res?.data?.truncated) return "too_many";
    if (list(res?.data?.features?.features).length) return "drawn";
    if (knownZero(row?.feature_count)) return "no_data";
    if (res?.data) return "none_near";
    return scale === "group" && RIVERS_ROW[key] ? "rivers_row" : "not_here";
  }

  // ---- deciding ---------------------------------------------------------------------------------------------------------------
  // The database's answer to an accept or a send-back, in words. A stale one (SQLSTATE PT409: the look changed since the page
  // drew it) is said as such: the page reads the looks again and draws the look as it is now.
  const stale = (e) => !!e && (e.code === "PT409" || /changed since you looked at it/i.test(String(e.message || "")));
  function refusal(e, what = "accept") {
    if (stale(e)) return "This look changed after the page drew it, so it was not " + (what === "accept" ? "accepted" : "sent back") + ". It is shown again as it is now: look again before you decide.";
    if (/not open for you/i.test(String(e?.message || ""))) return "Only RCL staff decide a shared look.";
    if (/already reviewed/i.test(String(e?.message || ""))) return "Someone has already accepted this look.";
    return "Couldn't " + (what === "accept" ? "accept it" : "send it back") + ": " + (e?.message || e || "the database refused") + ".";
  }
  // A send-back's note: trimmed, required, at most 2,000 characters (as the database's rule).
  function note(text) {
    const t = String(text ?? "").trim();
    if (!t) return { ok: false, text: t, error: "Say what to change: a look is sent back with a note." };
    if (t.length > 2000) return { ok: false, text: t, error: "A note is at most 2,000 characters." };
    return { ok: true, text: t, error: null };
  }
  // The call each decision makes, with the version the page drew the look at.
  const acceptCall = (r) => ({ fn: "layer_style_accept", args: { style_id: r.id, expected_updated_at: r.updated_at } });
  const sendBackCall = (r, text) => ({ fn: "layer_style_send_back", args: { style_id: r.id, note: text, expected_updated_at: r.updated_at } });

  return { THEMES, themeName, target, standing, symbolWords, fields, rows, sourcesFor, layersFor, scene, show, frame, polygon, bbox, layerRead, caption, sourceState, RIVERS_ROW,
    stale, refusal, note, acceptCall, sendBackCall, MAX_SOURCES, TOLERANCE };
});
