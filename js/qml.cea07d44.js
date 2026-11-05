// Turn a layer's saved QGIS style (QML) into MapLibre paint settings: the platform's small style system.
// Handles what farm layers use: single symbol and categorised renderers with simple fill, line and marker
// symbol layers. Anything else (SVG markers, patterns, rule-based) falls back to a colour per theme.
(function (root) {
  const THEME_COLOURS = {
    land_units: "#f2b33d", contaminant_sources: "#d9472b", point_features: "#2f7fd8", plantings: "#3fa34d",
    lines: "#7a5cc7", fences: "#ff8c1a", photos: "#ffffff", measurements: "#ffd84d",
  };
  const FALLBACK = "#ff8c1a";
  const MM_TO_PX = 3.78;

  // every <Option name=.. value=..> or <prop k=.. v=..> in a chunk of QML, whatever the attribute order
  function props(xml) {
    const out = {};
    for (const tag of xml.match(/<(?:Option|prop)\b[^>]*\/?>/g) || []) {
      const a = attrs(tag);
      const k = a.name ?? a.k, v = a.value ?? a.v;
      if (k && v != null && !(k in out)) out[k] = v;
    }
    return out;
  }
  function attrs(tag) {
    const a = {};
    for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) a[m[1]] = unescape(m[2]);
    return a;
  }
  function unescape(s) {
    return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }
  // QGIS colours: "r,g,b,a" (older) or "r,g,b,a,rgb:..." (newer)
  function colour(v) {
    if (!v) return null;
    const n = v.split(",").slice(0, 4).map(Number);
    if (n.length < 3 || n.some(Number.isNaN)) return null;
    const hex = "#" + n.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
    return { hex, alpha: n.length > 3 ? n[3] / 255 : 1 };
  }
  function width(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.max(1, n * MM_TO_PX) : fallback;
  }

  // one <symbol> body -> {kind, fill, fillOpacity, line, lineWidth, dash, radius}
  function symbol(body, type, symbolAlpha) {
    const layer = (body.match(/<layer\b[^>]*>[\s\S]*?<\/layer>/) || [""])[0];
    const cls = (layer.match(/class="([^"]+)"/) || [])[1] || "";
    const p = props(layer);
    const alpha = Number.isFinite(parseFloat(symbolAlpha)) ? parseFloat(symbolAlpha) : 1;
    const s = { kind: type, cls, simple: /^Simple(Fill|Line|Marker)$/.test(cls) };
    if (type === "fill") {
      const c = colour(p.color), o = colour(p.outline_color);
      s.fill = c?.hex; s.fillOpacity = p.style === "no" || !c ? 0 : c.alpha * alpha;
      s.line = o?.hex; s.lineWidth = p.outline_style === "no" || !o ? 0 : width(p.outline_width, 1);
      s.lineOpacity = (o?.alpha ?? 1) * alpha;
    } else if (type === "line") {
      const c = colour(p.line_color || p.color);
      s.line = c?.hex; s.lineOpacity = (c?.alpha ?? 1) * alpha; s.lineWidth = width(p.line_width, 2);
      s.dash = /dash|dot/.test(p.line_style || "") ? [3, 2] : null;
    } else {
      const c = colour(p.color), o = colour(p.outline_color);
      s.fill = c?.hex; s.fillOpacity = (c?.alpha ?? 1) * alpha; s.line = o?.hex || "#ffffff";
      s.radius = Math.max(4, width(p.size, 8) / 2);
    }
    return s;
  }

  // QML -> {renderer, attr, symbol, categories: [{value, label, symbol}]}
  function parse(qml) {
    if (!qml) return null;
    const r = qml.match(/<renderer-v2\b[^>]*>/);
    if (!r) return null;
    const ra = attrs(r[0]);
    const symbols = {};
    const block = (qml.match(/<renderer-v2\b[\s\S]*?<\/renderer-v2>/) || [""])[0];
    for (const m of block.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)) {
      const a = attrs(m[1]);
      if (a.name != null && !(a.name in symbols)) symbols[a.name] = symbol(m[2], a.type || "fill", a.alpha);
    }
    const categories = [];
    for (const m of block.matchAll(/<category\b[^>]*\/?>/g)) {
      const a = attrs(m[0]);
      if (a.render === "false") continue;
      if (symbols[a.symbol]) categories.push({ value: a.value, label: a.label || a.value, symbol: symbols[a.symbol] });
    }
    const first = symbols["0"] || Object.values(symbols)[0] || null;
    return { renderer: ra.type, attr: ra.attr || null, symbol: first, categories };
  }

  // A layer's look for the map: per geometry kind, a colour expression and widths.
  function style(layer) {
    const fallback = THEME_COLOURS[layer.theme] || FALLBACK;
    const p = parse(layer.qml);
    const base = p?.symbol || {};
    const pick = (k, dflt) => {
      if (p?.renderer === "categorizedSymbol" && p.attr && p.categories.length) {
        const expr = ["match", ["to-string", ["get", p.attr]]];
        for (const c of p.categories) {
          if (c.value === "" || c.value == null) continue;
          expr.push(String(c.value), c.symbol[k] ?? dflt);
        }
        expr.push(dflt);
        return expr.length > 3 ? expr : dflt;
      }
      return base[k] ?? dflt;
    };
    const kind = layer.geometry_type;
    if (kind === "polygon") {
      // fills are see-through on the web so the aerial shows (QGIS print styles are often solid)
      return { fill: pick("fill", fallback), fillOpacity: Math.min(base.fillOpacity ?? 0.25, 0.45), line: pick("line", fallback),
               lineWidth: Math.min(base.lineWidth || 2, 4) };
    }
    if (kind === "line") {
      return { line: pick("line", fallback), lineWidth: Math.min(base.lineWidth || 2.5, 6), dash: base.dash || null };
    }
    return { fill: pick("fill", fallback), line: base.line || "#ffffff", radius: base.radius || 6 };
  }

  const api = { parse, style, colour };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.FP = root.FP || {}).qml = api;
})(typeof window !== "undefined" ? window : globalThis);
