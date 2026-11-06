// A layer's look as a record (LK1, #416 slice 1): which record a map draws a layer with, and the MapLibre paint it gives.
// The records are public.layer_styles rows (one per layer, per reference source, or per theme as the default for every
// layer and source of that theme), read for a map with public.layer_styles_for_map (reviewed looks in force only).
// Precedence when drawing: a reviewed record for that layer (or that reference source), then the reviewed default for its
// theme, then its QGIS style (qml.js), then today's rule (qml.js's colour per theme, or the Map scene's reference look).
// A proposed record draws nowhere but a preview: `preview` hands the records to show as if they had been accepted (each
// stands in for the reviewed record of what it is the look of). Where a record says nothing, or says something malformed
// (a colour that is not #rrggbb, a number out of range), the look below it stands. No DOM; no MapLibre.
(function (root) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const HEX = /^#[0-9a-f]{6}$/i;
  const colour = (v) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined);
  const num = (lo, hi) => (v) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
  // the keys of a symbol (a record's `symbol`, or one of its `classes`) and how each is read; paint names are the qml.js style's
  const KEYS = { fill: ["fill", colour], fillOpacity: ["fill_opacity", num(0, 1)], line: ["line", colour], lineWidth: ["line_width", num(0, 20)],
    lineOpacity: ["line_opacity", num(0, 1)], radius: ["radius", num(1, 20)] };
  function dashOf(v) {
    if (v === true) return [3, 2];
    if (v === false) return null;
    return Array.isArray(v) && v.length === 2 && v.every((x) => num(0.1, 20)(x) !== undefined) ? [v[0], v[1]] : undefined;
  }

  // A record is drawn only when reviewed and in force (never superseded); the database sends no other, and a stray one is not drawn.
  const reviewed = (r) => !!r && r.status === "reviewed" && !r.superseded_at;
  // What a record is the look of, as one key: a layer, a reference source, or a theme's default.
  function keyOf(r) {
    if (!r || typeof r !== "object") return null;
    if (r.layer_id != null) return "l:" + String(r.layer_id).toLowerCase();
    if (r.source_key) return "s:" + r.source_key;
    if (r.theme) return "t:" + r.theme;
    return null;
  }
  // The records in force: the reviewed ones, with any preview record standing in for the record of what it is the look of.
  function inForce(styles, preview) {
    const out = new Map();
    for (const r of list(styles)) { const k = keyOf(r); if (k && reviewed(r) && !out.has(k)) out.set(k, r); }
    for (const r of list(preview)) { const k = keyOf(r); if (k) out.set(k, r); }
    return out;
  }
  // The record a layer or source is drawn with. target: {layerId} for an owned layer, {sourceKey} for a reference source,
  // with its {theme}. opts.preview: the records a preview shows. Null: no record (its QGIS style, then today's rule).
  function pick(styles, target = {}, opts = {}) {
    const m = inForce(styles, opts?.preview);
    if (!m.size) return null;
    if (target.layerId != null && m.has("l:" + String(target.layerId).toLowerCase())) return m.get("l:" + String(target.layerId).toLowerCase());
    if (target.sourceKey && m.has("s:" + target.sourceKey)) return m.get("s:" + target.sourceKey);
    if (target.theme && m.has("t:" + target.theme)) return m.get("t:" + target.theme);
    return null;
  }

  // One value of the look: per class (a match on classify_by) where the classes set it, else the record's own symbol, else
  // the look below (base). Only well-formed values are used.
  function value(record, k, base) {
    const [field, read] = KEYS[k];
    const own = read(record.symbol?.[field]);
    const dflt = own !== undefined ? own : base;
    const classes = list(record.classes).filter((c) => c && c.value != null && c.value !== "" && read(c[field]) !== undefined);
    // (a class needs something under it for the features in no class: with nothing below, the classes are not drawn)
    if (!record.classify_by || !classes.length || dflt === undefined) return dflt;
    // LK2: a class may match the start of the value (`starts_with`, e.g. "Water Permit (s" for ECan's "Water Permit (s14)"),
    // not the whole of it: the classes are then tried in order, the first that matches drawing the feature
    if (classes.some((c) => typeof c.starts_with === "string" && c.starts_with)) {
      const text = ["to-string", ["get", record.classify_by]], expr = ["case"];
      for (const c of classes) {
        const s = typeof c.starts_with === "string" && c.starts_with ? c.starts_with : null;
        expr.push(s ? ["==", ["slice", text, 0, s.length], s] : ["==", text, String(c.value)], read(c[field]));
      }
      expr.push(dflt);
      return expr;
    }
    const expr = ["match", ["to-string", ["get", record.classify_by]]];
    const seen = new Set();
    for (const c of classes) { const v = String(c.value); if (seen.has(v)) continue; seen.add(v); expr.push(v, read(c[field])); }
    expr.push(dflt);
    return expr;
  }
  // The look a record gives, over the look below it (base: a qml.js style, or the Map scene's reference look for one geometry):
  // the same keys as base, each from the record where it says one.
  function paint(record, base = {}) {
    if (!record) return base;
    const out = { ...base };
    for (const k of Object.keys(KEYS)) {
      if (!(k in base) && record.symbol?.[KEYS[k][0]] === undefined) continue;   // a key the base doesn't draw is drawn only if the record sets it
      const v = value(record, k, base[k]);
      if (v !== undefined) out[k] = v;
    }
    if ("dash" in base || record.symbol?.dash !== undefined) { const d = dashOf(record.symbol?.dash); if (d !== undefined) out.dash = d; }
    return out;
  }
  // The zoom range it draws in, as MapLibre layer properties ({} when the record sets none).
  function range(record) {
    const z = num(0, 24), lo = z(record?.min_zoom), hi = z(record?.max_zoom), out = {};
    if (lo !== undefined) out.minzoom = lo;
    if (hi !== undefined && (lo === undefined || hi > lo)) out.maxzoom = hi;
    return out;
  }
  // Its labels: the field and the zoom they show from, or null. LK2: "PadkName,label" is the first of those fields a feature
  // has (`fields`); `field` is the first named.
  function label(record) {
    const fields = (typeof record?.label_field === "string" ? record.label_field : "").split(",").map((f) => f.trim()).filter(Boolean);
    if (!fields.length) return null;
    const from = num(0, 24)(record.label_min_zoom);
    return { field: fields[0], fields, minzoom: from };
  }
  // The label's text as a MapLibre expression: the field, or the first of the fields a feature has.
  // (a field that is missing or empty falls to the next: "PadkName,label" labels a paddock with an empty PadkName by its label)
  function labelText(lab) {
    const fields = lab.fields && lab.fields.length > 1 ? lab.fields : [lab.field], text = (f) => ["to-string", ["get", f]];
    return fields.slice(0, -1).reduceRight((rest, f) => ["case", ["!=", text(f), ""], text(f), rest], text(fields[fields.length - 1]));
  }
  // The sentence the Layers list shows under the layer's name, or null.
  function purpose(record) {
    const s = typeof record?.purpose === "string" ? record.purpose.trim() : "";
    return s || null;
  }

  // A farm's or group's own layer (a farm_map / group_map layer entry): its record, and its look (qml.js's style under it).
  function forLayer(l, styles, opts = {}) {
    const qml = root.FP?.qml || (typeof module !== "undefined" && module.exports ? require("./qml.js") : null);
    const base = qml.style(l);
    const record = pick(styles, { layerId: l?.id, theme: l?.theme }, opts);
    return { record, look: record ? paint(record, base) : base };
  }
  // Today's look for a reference source (the Map scene's, #243): areas a pale blue fill and outline, lines pale blue, points blue.
  const REFERENCE = Object.freeze({
    area: Object.freeze({ fill: "#bfe8ff", fillOpacity: 0.25, line: "#bfe8ff", lineWidth: 1.5 }),
    line: Object.freeze({ line: "#bfe8ff", lineWidth: 2.5 }),
    point: Object.freeze({ fill: "#1e88e5", radius: 7, line: "#ffffff" }),
  });
  // A reference source (a group_reference_context / farm_reference_context entry): its record, and its look per geometry.
  function forReference(r, styles, opts = {}) {
    const record = pick(styles, { sourceKey: r?.key, theme: r?.theme }, opts);
    const look = record ? { area: paint(record, REFERENCE.area), line: paint(record, REFERENCE.line), point: paint(record, REFERENCE.point) } : REFERENCE;
    return { record, look };
  }

  const api = { pick, paint, range, label, labelText, purpose, forLayer, forReference, reviewed, keyOf, REFERENCE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.FP = root.FP || {}).layerStyle = api;
})(typeof window !== "undefined" ? window : globalThis);
