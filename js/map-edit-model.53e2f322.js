// ML1: a published map's layers edited in the app, its rules without the DOM or the map. A set of edits (public.published_map_edits,
// migration 20261113079000) is kept beside the map, never in its package, so a publish from QGIS keeps it; it is applied to the
// package's manifest each time the map is read (maps-view.js readPackage), before the viewer (viewer.js, the portal's, not edited)
// draws it. Each layer is known by its id (the plugin's slug of its QGIS title). What an edit can say:
//   shade: false            the darkening outside the place is off for everyone (the package's own "Shade outside" and the app's 45%)
//   order: [ids]            the map's own layers top first (moved only within their heading in the editor)
//   layers[id].visible      on or off as the map opens, for everyone
//   layers[id].title        the name shown
//   layers[id].opacity      0..1, times the published opacity (an imagery layer's own opacity)
//   layers[id].color        #rrggbb, a simple layer's one colour (fill and outline, a line, or a point)
//   layers[id].width        px, a simple layer's line or outline width
//   layers[id].removed      taken off this map: not listed or drawn for anyone; never deleted, and put back from the editor
// Layers published once for many maps (shared_layers, the core register) are not edited here.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else (root.FP = root.FP || {}).mapEditModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const HEX = /^#[0-9a-f]{6}$/;
  const MAX_LAYERS = 300, MAX_ID = 120, MAX_TITLE = 200;
  const KEYS = ["visible", "title", "opacity", "color", "width", "removed"];
  // A small calm set (the soft hues the app gives groups, map-palette.js DEFAULT_HUES), then white and near-black for lines
  const PALETTE = [["#5f9bd8", "Blue"], ["#3fae8c", "Green"], ["#b083c4", "Purple"], ["#d6ad4f", "Gold"], ["#6cc0e5", "Sky"],
    ["#d98879", "Coral"], ["#8f9bb3", "Slate"], ["#ffffff", "White"], ["#2b2b2b", "Black"]];
  const WIDTHS = [[0.75, "Thin"], [1.5, "Medium"], [3, "Thick"]];
  const list = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const round = (v, d = 100) => Math.round(v * d) / d;
  const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const okId = (id) => typeof id === "string" && id.length >= 1 && id.length <= MAX_ID;

  // Only what the database accepts (app.map_edits_valid), tidied: anything else is dropped, never guessed.
  function normalize(edits) {
    const e = obj(edits) || {}, out = { v: 1 };
    if (e.shade === false) out.shade = false;
    const order = list(e.order).filter(okId);
    if (order.length) out.order = [...new Set(order)].slice(0, MAX_LAYERS);
    const layers = {};
    for (const [id, x] of Object.entries(obj(e.layers) || {}).slice(0, MAX_LAYERS)) {
      if (!okId(id) || !obj(x)) continue;
      const y = {};
      if (typeof x.visible === "boolean") y.visible = x.visible;
      if (typeof x.title === "string" && x.title.trim() && x.title.trim().length <= MAX_TITLE) y.title = x.title.trim();
      if (num(x.opacity) !== null && x.opacity >= 0 && x.opacity <= 1) y.opacity = round(x.opacity);
      if (typeof x.color === "string" && HEX.test(x.color.toLowerCase())) y.color = x.color.toLowerCase();
      if (num(x.width) !== null && x.width >= 0 && x.width <= 20) y.width = round(x.width);
      if (x.removed === true) y.removed = true;
      if (Object.keys(y).length) layers[id] = y;
    }
    if (Object.keys(layers).length) out.layers = layers;
    return out;
  }
  const isEmpty = (edits) => { const e = normalize(edits); return e.shade !== false && !e.order && !e.layers; };

  // ---- what a layer is ---------------------------------------------------------------------------------------------------------------
  const ownLayers = (manifest) => list(manifest?.layers).filter((L) => L && okId(L.id));
  const vectorParts = (L) => (obj(L?.vector) && Array.isArray(L.vector.layers) ? L.vector.layers.filter((v) => v && obj(v.by)) : []);
  const classKeys = (L) => [...new Set(vectorParts(L).flatMap((v) => Object.keys(v.by)))];
  // A simple layer: one class, drawn from its QGIS style by the web map, in one of the plain shapes: an area (a fill, and perhaps an
  // outline), a line, or a point. Its colour and line can be changed here; anything with several classes or parts stays QGIS's.
  function simple(L) {
    const parts = vectorParts(L);
    if (!L?.features || L.draw || !parts.length || classKeys(L).length !== 1) return false;
    const types = parts.map((v) => v.type);
    if (L.geometry === "polygon") return types.length <= 2 && types.filter((t) => t === "fill").length === 1 && types.every((t) => t === "fill" || t === "line");
    if (L.geometry === "line") return types.length === 1 && types[0] === "line";
    if (L.geometry === "point") return types.length === 1 && types[0] === "circle";
    return false;
  }
  const hasLine = (L) => simple(L) && vectorParts(L).some((v) => v.type === "line");
  const imagery = (L) => L?.kind === "imagery" || (!vectorParts(L).length && !!L?.tiles);
  // The layer's one colour and line width as published (a simple layer's), for the editor's picker
  function colourOf(L) {
    const parts = vectorParts(L), main = parts.find((v) => v.type === "fill") || parts[0], k = main ? Object.keys(main.by)[0] : null;
    const c = k ? String(main.by[k].color || "").toLowerCase() : "";
    return HEX.test(c) ? c : null;
  }
  function widthOf(L) {
    const line = vectorParts(L).find((v) => v.type === "line"), k = line ? Object.keys(line.by)[0] : null;
    return k ? num(line.by[k].width) : null;
  }
  // An area or line swatch for the legend, as calmLayer draws one (an SVG data: image, which the app's content policy allows)
  function swatch(L, colour, { opacity = 1, width = null } = {}) {
    const fill = vectorParts(L).find((v) => v.type === "fill"), fk = fill ? Object.keys(fill.by)[0] : null;
    const fo = round((fk ? num(fill.by[fk].opacity) ?? 1 : 1) * opacity);
    const w = Math.max(1, Math.min(4, width ?? widthOf(L) ?? 1.5));
    const svg = L.geometry === "line"
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M2 14 C7 6, 13 18, 18 8" fill="none" stroke="' + colour + '" stroke-opacity="' + round(opacity) + '" stroke-width="' + w + '" stroke-linecap="round"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="1.5" y="1.5" width="17" height="17" rx="2" fill="' + colour + '" fill-opacity="' + fo + '" stroke="' + colour + '" stroke-width="1"/></svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  // ---- applying a set of edits to a manifest -------------------------------------------------------------------------------------------
  function applyLayer(L, x) {
    if (!x) return L;
    const out = { ...L };
    if (typeof x.visible === "boolean") out.visible = x.visible;
    if (x.title) {
      out.title = x.title;
      // a one-entry legend that said the layer's name says the new one
      if (Array.isArray(L.legend) && L.legend.length === 1 && String(L.legend[0]?.label || "").trim() === String(L.title || "").trim()) out.legend = [{ ...L.legend[0], label: x.title }];
    }
    const op = x.opacity ?? null, colour = simple(L) ? x.color ?? null : null, width = hasLine(L) ? x.width ?? null : null;
    if (op !== null && imagery(L)) out.opacity = round(op * (num(L.opacity) ?? 1));
    if ((op !== null && vectorParts(L).length) || colour || width !== null) {
      out.vector = { ...L.vector, layers: L.vector.layers.map((v) => {
        if (!v || !obj(v.by)) return v;
        return { ...v, by: Object.fromEntries(Object.entries(v.by).map(([k, p]) => {
          const q = { ...p };
          if (op !== null) {
            q.opacity = round((num(p.opacity) ?? 1) * op);
            if (v.type === "circle" && p.stroke) q.stroke_opacity = round((num(p.stroke_opacity) ?? 1) * op);
          }
          if (colour) q.color = colour;
          if (width !== null && v.type === "line") q.width = width;
          return [k, q];
        })) };
      }) };
    }
    // an area's or a line's one swatch drawn again in its new colour (a point's legend the viewer draws from its style itself)
    if ((colour || width !== null || op !== null) && simple(L) && L.geometry !== "point" && Array.isArray(out.legend) && out.legend.length === 1) {
      out.legend = [{ ...out.legend[0], icon: swatch(L, colour || colourOf(L) || "#8f9bb3", { opacity: op ?? 1, width }) }];
    }
    return out;
  }
  // The map's own layers in the edited order: the layers the order names take the places those layers had, in its order; a layer it
  // does not name (new since, from a later publish) keeps its place.
  function reorder(layers, order) {
    if (!order?.length) return layers;
    const at = new Map(order.map((id, i) => [id, i]));
    const named = layers.filter((L) => L && at.has(L.id)).sort((a, b) => at.get(a.id) - at.get(b.id));
    let k = 0;
    return layers.map((L) => (L && at.has(L.id) ? named[k++] : L));
  }
  function apply(manifest, edits) {
    if (!obj(manifest) || !Array.isArray(manifest.layers)) return manifest;
    const e = normalize(edits);
    if (isEmpty(e)) return manifest;
    const ed = e.layers || {};
    const ordered = reorder(manifest.layers.map((L) => (L && ed[L.id] ? applyLayer(L, ed[L.id]) : L)), e.order);
    const gone = (L) => !!(L && ed[L.id]?.removed);
    const out = { ...manifest, layers: ordered.filter((L) => !gone(L)) };
    // a shared layer goes in at its place among the map's own layers (viewer.js mergeShared): one taken off before it moves it up one
    if (Array.isArray(manifest.shared_layers) && manifest.layers.some(gone)) {
      out.shared_layers = manifest.shared_layers.map((r) => (r && Number.isFinite(r.position) ? { ...r, position: r.position - ordered.slice(0, r.position).filter(gone).length } : r));
    }
    if (e.shade === false) { delete out.mask; out.shade = false; }
    return out;
  }

  // ---- the editor's draft --------------------------------------------------------------------------------------------------------------
  // Only what differs from the published map is kept, so a value put back as published is no edit, and an empty draft is "as published".
  function prune(edits, published) {
    const e = normalize(edits), layers = ownLayers(published), byId = new Map(layers.map((L) => [L.id, L]));
    const out = { v: 1 };
    if (e.shade === false && (published?.mask || published?.boundary)) out.shade = false;
    if (e.order) {
      const ids = layers.map((L) => L.id), mine = reorder(layers, e.order).map((L) => L.id);
      if (mine.join("\n") !== ids.join("\n")) out.order = mine;
    }
    const kept = {};
    for (const [id, x] of Object.entries(e.layers || {})) {
      const L = byId.get(id);
      if (!L) { kept[id] = x; continue; }   // a layer not in this version (renamed or left out in QGIS): its edit is kept, unused
      const y = {};
      if (typeof x.visible === "boolean" && x.visible !== (L.visible !== false)) y.visible = x.visible;
      if (x.title && x.title !== String(L.title || "").trim()) y.title = x.title;
      if (x.opacity !== undefined && x.opacity !== 1) y.opacity = x.opacity;
      if (x.color && simple(L) && x.color !== colourOf(L)) y.color = x.color;
      if (x.width !== undefined && hasLine(L) && x.width !== widthOf(L)) y.width = x.width;
      if (x.removed) y.removed = true;
      if (Object.keys(y).length) kept[id] = y;
    }
    if (Object.keys(kept).length) out.layers = kept;
    return out;
  }
  const same = (a, b, published) => JSON.stringify(prune(a, published)) === JSON.stringify(prune(b, published));
  // One value for one layer in the draft (null or undefined clears it back to the published)
  function set(edits, id, key, value) {
    if (!okId(id) || !KEYS.includes(key)) return normalize(edits);
    const e = copy(normalize(edits)), layers = e.layers || {}, x = { ...(layers[id] || {}) };
    if (value === null || value === undefined || value === false && key === "removed") delete x[key]; else x[key] = value;
    if (Object.keys(x).length) layers[id] = x; else delete layers[id];
    if (Object.keys(layers).length) e.layers = layers; else delete e.layers;
    return normalize(e);
  }
  function setShade(edits, on) { const e = copy(normalize(edits)); if (on) delete e.shade; else e.shade = false; return normalize(e); }
  // The map's own layers as the editor lists them: in the draft's order, each with its heading, its published values and the draft's
  const rowsOf = (published, edits) => {
    const e = normalize(edits), ed = e.layers || {};
    return reorder(ownLayers(published), e.order).map((L) => {
      const x = ed[L.id] || {};
      return { id: L.id, group: String(L.group || ""), published: L, title: x.title || String(L.title || L.id), visible: typeof x.visible === "boolean" ? x.visible : L.visible !== false,
        opacity: x.opacity ?? 1, colour: simple(L) ? x.color || colourOf(L) : null, width: hasLine(L) ? x.width ?? widthOf(L) : null,
        removed: !!x.removed, simple: simple(L), line: hasLine(L), imagery: imagery(L), edited: Object.keys(x).length > 0 };
    });
  };
  // Move a layer one place up (-1) or down (+1) among the layers under the same heading (skipping any taken off); the new draft, or
  // the same one when it cannot move
  function move(published, edits, id, dir) {
    const rows = rowsOf(published, edits), i = rows.findIndex((r) => r.id === id);
    if (i < 0) return normalize(edits);
    let j = i + dir;
    while (rows[j] && rows[j].removed && rows[j].group === rows[i].group) j += dir;
    if (!rows[j] || rows[j].group !== rows[i].group) return normalize(edits);
    const ids = rows.map((r) => r.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return normalize({ ...normalize(edits), order: ids });
  }
  const idsOf = (published, edits) => rowsOf(published, edits).map((r) => r.id).join("\n");
  const canMove = (published, edits, id, dir) => idsOf(published, move(published, edits, id, dir)) !== idsOf(published, edits);
  const shadeOn = (edits) => normalize(edits).shade !== false;
  // Whether this map has a darkening to turn off: its package's own "Shade outside", or the app's (a map with a boundary)
  const hasShade = (published) => !!(published?.mask || published?.boundary);

  // ---- words ---------------------------------------------------------------------------------------------------------------------------
  const WHO = "Saved changes show for everyone who can open this map.";
  const KEPT = "Kept when Rural Consulting publishes this map again from QGIS. A layer renamed in QGIS starts again as published.";
  const day = (v) => (v ? new Date(v).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" }) : "");
  const savedLine = (saved) => (saved?.created_at ? (isEmpty(saved.edits) ? "As published. Last reset " : "Changed here. Last saved ") + day(saved.created_at) + "." : "As published from QGIS.");
  // What a refused save means, in plain words
  function refusal(error) {
    const code = String(error?.code || ""), text = String(error?.message || "");
    if (code === "42501" || /row-level security|permission denied/i.test(text)) return "Couldn't save: only Rural Consulting staff signed in with their two-factor code can change this map.";
    if (code === "23514") return "Couldn't save: one of the changes isn't one this map can take. Cancel and try again.";
    if (code === "stale") return "Someone else saved changes to this map since you opened it. Cancel to see theirs, then make yours again.";
    return "Couldn't save just now. Check your connection and try again.";
  }
  const countLine = (n) => (n === 1 ? "1 change" : n + " changes");
  // How many things the draft changes from the published map (for the line beside Save)
  function changes(edits, published) {
    const e = prune(edits, published), ids = new Set(ownLayers(published).map((L) => L.id));
    return (e.shade === false ? 1 : 0) + (e.order ? 1 : 0) + Object.entries(e.layers || {}).filter(([id]) => ids.has(id)).reduce((n, [, x]) => n + Object.keys(x).length, 0);
  }

  return { PALETTE, WIDTHS, MAX_LAYERS, normalize, isEmpty, simple, hasLine, imagery, colourOf, widthOf, swatch, applyLayer, reorder, apply, prune, same, set, setShade,
    rowsOf, move, canMove, shadeOn, hasShade, savedLine, refusal, countLine, changes, WHO, KEPT };
});
