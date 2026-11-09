// The layer kind registry in the app (LK4; docs/LAYER-KINDS.md, app/layer-kinds.json — the JSON governs). What a layer IS
// (its kind), where it draws (its tier), whether it is on when a map opens (its default rule), which views (context sets)
// bring it up, and how the Layers drawer groups it all come from the one file the loaders, Ask and QGIS read too. Nothing
// in the app keeps a list of themes of its own.
// Loaded once per page: one fetch of layer-kinds.json, cached as FP.kinds (`ready` resolves when it is in). Until then, and
// if the fetch fails, a tiny inlined fallback (each kind's tier and default rule, and the quiet view) stands, so a map is
// never drawn without an order. In node (tests) the JSON is read directly.
// Pure: no DOM, no MapLibre. The hosts (blocks/map-scene.js, farm-space.js, group-space.js, group-layers.js) ask it.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("../layer-kinds.json") : null, node ? null : root);
  if (node) module.exports = api; else (root.FP = root.FP || {}).kinds = api;
})(typeof window === "undefined" ? globalThis : window, function (json, browser) {
  const list = (v) => (Array.isArray(v) ? v : []);
  // The fallback: "key:tier:rule" for every kind (tests check it against the JSON), and the quiet view. Used only until the
  // file is in, or if it cannot be read.
  const FALLBACK_KINDS = "terrain:1:off drone_ortho:2:zoom:15 plan_image:2:context catchments:3:off zones:3:context luc:3:context soils:3:context " +
    "geology:3:off land_use:3:off groundwater:3:context member_blocks:4:quiet farmed_area:4:context land_units:4:context paddocks:4:zoom:14 " +
    "irrigation:4:context effluent_area:4:context plantings:4:context wetlands:4:context csa:4:context holding_areas:4:context titles:5:off " +
    "extent:5:quiet waterways:6:context drains:6:context fences:6:context proposed_fences:6:context tracks:6:zoom:15 stock_access:6:context " +
    "shelterbelts:6:off line_features:6:context wells:7:context monitoring_sites:7:context consents:7:context contaminant_sources:7:context " +
    "point_features:7:context actions:7:context photos:8:zoom:15 annotation:10:never";
  const FALLBACK_CONTEXT = new Set(["zones", "luc", "soils", "geology", "land_use", "groundwater", "catchments"]);
  function fallback() {
    const kinds = FALLBACK_KINDS.split(" ").map((s) => {
      const [key, tier, ...rule] = s.split(":");
      return { key, label: null, geometry: [], tier: Number(tier), owner: [], default_rule: rule.join(":"), views: [], fill_class: FALLBACK_CONTEXT.has(key) ? "context" : null, aliases: [] };
    });
    return { kinds, views: [{ key: "quiet", label: "Farm", kinds: ["extent", "photos"], extent: "farm", stack_allowed: [] }],
      reference_theme_map: {}, owned_theme_map: { farm_boundaries: "extent", member_farms: "member_blocks", lines: "line_features", measurements: "annotation", proposed_actions: "actions", farm_features: "by_geometry" },
      roles: ["data", "annotation", "working"], fallback: true };
  }

  let reg = null, kinds = new Map(), views = new Map();
  // Use a registry (the JSON's shape). Returns the registry in use.
  function use(r) {
    reg = r && Array.isArray(r.kinds) ? r : fallback();
    kinds = new Map(reg.kinds.map((k) => [k.key, k]));
    views = new Map(list(reg.views).map((v) => [v.key, v]));
    return reg;
  }
  use(json);

  // Row keys the maps use that are not a theme: the shared Rivers row is the waterways kind (DM2).
  const ROW_KINDS = { rivers: "waterways" };
  const geomOf = (g) => { const s = String(g || "").toLowerCase(); return /polygon/.test(s) ? "polygon" : /line/.test(s) ? "line" : /point/.test(s) ? "point" : /raster/.test(s) ? "raster" : null; };
  // The kind of a theme (a map layer's or a reference source's), applying the drift maps for any old value still arriving
  // (`farm_boundaries` -> extent, `monitoring` -> monitoring_sites, …). `farm_features` goes by geometry. Null: not a kind.
  function kindOf(theme, geometry = null) {
    if (theme == null || theme === "") return null;
    const t = String(theme).trim().toLowerCase();
    if (kinds.has(t)) return t;
    if (ROW_KINDS[t]) return ROW_KINDS[t];
    const owned = reg.owned_theme_map?.[t];
    if (owned && t !== "_about") {
      if (owned !== "by_geometry") return kinds.has(owned) ? owned : null;
      const g = geomOf(geometry);
      return g === "polygon" ? "holding_areas" : g === "line" ? "line_features" : "point_features";
    }
    const ref = reg.reference_theme_map?.[t];
    if (ref && t !== "_about") return kinds.has(ref) ? ref : null;
    return null;
  }
  // A reference source's kind: its own drift map first (a source's `measurements` is monitoring sites; a farm's is an annotation).
  function refKindOf(theme) {
    const t = String(theme ?? "").trim().toLowerCase(), ref = t && t !== "_about" ? reg.reference_theme_map?.[t] : null;
    return ref && kinds.has(ref) ? ref : kindOf(theme);
  }
  const kind = (theme, geometry) => kinds.get(kindOf(theme, geometry)) || null;
  // The tier a layer draws at (0–10). A kind drawn in more than one geometry (irrigation, plantings: "4 / 6", "4 / 7") draws
  // its lines with the lines and its points with the points. A theme that is not a kind draws by its geometry.
  function tierOf(theme, geometry = null) {
    const k = kind(theme, geometry), g = geomOf(geometry);
    const t = k ? k.tier : g === "raster" ? 2 : g === "polygon" ? 4 : g === "line" ? 6 : 7;
    if (t >= 3 && t <= 5 && g === "line") return 6;
    if (t >= 3 && t <= 6 && g === "point") return 7;
    return t;
  }
  // quiet | zoom:<z> | context | off | never. A theme that is not a kind is off (by hand only).
  const defaultRule = (theme, geometry) => kind(theme, geometry)?.default_rule || "off";
  const labelOf = (theme, geometry) => kind(theme, geometry)?.label || null;
  const fillClass = (theme, geometry) => kind(theme, geometry)?.fill_class || null;
  // A shared context fill (tier 3, fill_class context): one on at a time by default.
  const isContextFill = (theme, geometry) => { const k = kind(theme, geometry); return !!k && k.tier === 3 && k.fill_class === "context" && geomOf(geometry) !== "line"; };
  const view = (key) => views.get(key) || null;
  const viewKeys = () => [...views.keys()];
  // The views whose kinds hold this kind, in the registry's order.
  const viewsFor = (k) => { const key = kindOf(k) || k; return [...views.values()].filter((v) => list(v.kinds).includes(key)).map((v) => v.key); };
  // The view a kind is listed under in the Layers drawer: the first of its own `views` that holds it, else the first view that
  // holds it; null (listed only under All layers) when none does (titles, drone imagery).
  function primaryView(k) {
    const key = kindOf(k) || k, own = list(kinds.get(key)?.views), holding = viewsFor(key);
    return own.find((v) => holding.includes(v)) || holding[0] || null;
  }
  // Whether a default rule has a layer on, by itself, at a zoom (no view): quiet always; zoom:<z> from zoom z.
  function ruleOn(rule, zoom = null) {
    if (rule === "quiet") return true;
    const m = /^zoom:(\d+(?:\.\d+)?)$/.exec(String(rule || ""));
    return !!m && Number.isFinite(Number(zoom)) && Number(zoom) >= Number(m[1]);
  }
  // The kinds on for a set of views at a zoom: every quiet kind, every zoom kind the zoom has reached, and each view's kinds
  // (a view never brings a kind that is off or never: those are by hand, or with their figure, only).
  function kindsOn(viewList = [], zoom = null) {
    const on = new Set();
    for (const k of kinds.values()) if (ruleOn(k.default_rule, zoom)) on.add(k.key);
    for (const v of list(viewList)) for (const k of list(view(v)?.kinds)) { const r = kinds.get(k)?.default_rule; if (r !== "off" && r !== "never") on.add(k); }
    return on;
  }
  // Whether two kinds may be on together inside these views (a view's stack_allowed pairs).
  function stackAllowed(a, b, viewList = []) {
    return list(viewList).some((v) => list(view(v)?.stack_allowed).some((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)));
  }
  // A layer's role (map_layers.role, LK3a): anything but `data` is never listed and never drawn by default. Missing: data.
  const isData = (layerOrRow) => layerOrRow?.role == null || layerOrRow.role === "data";
  // Never listed in Layers: a working or annotation role, or the annotation kind (drawn only with its figure).
  const listed = (row) => isData(row) && kindOf(row?.kind ?? row?.theme) !== "annotation" && defaultRule(row?.kind ?? row?.theme) !== "never";

  // ---- Draw order ---------------------------------------------------------------------------------------------------------------
  // A drawn thing's order: [tier, owned (1) above shared (0), as_at (newer above older), sort_order (drawn in sort_order: a
  // higher one above a lower, as the map's payload lists them)]. Compared in order; a later insertion of an equal key draws above.
  function orderKey({ theme = null, kind: k = null, geometry = null, tier = null, owned = false, as_at = null, sort_order = 0 } = {}) {
    const t = tier != null ? Number(tier) : tierOf(k || theme, geometry);
    const at = as_at ? Date.parse(as_at) : NaN;
    return [t, owned ? 1 : 0, Number.isFinite(at) ? at : 0, Number(sort_order) || 0];
  }
  function compare(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; }
    return 0;
  }
  // Where a new group of map layers goes among those drawn: before the first slot whose order is above it (null: at the top of
  // the data, under the labels). slots: [{order, first}] (first: the slot's lowest MapLibre layer id); exists(id): on the map.
  function insertBefore(slots, order, exists = () => true) {
    const above = list(slots).filter((s) => compare(s.order, order) > 0).sort((a, b) => compare(a.order, b.order));
    return above.map((s) => s.first).find((id) => id && exists(id)) || null;
  }
  // The rows' order as drawn, lowest first (rows carry `order`, set by the Map scene; one without draws by its kind).
  const orderOfRow = (r) => r?.order || orderKey({ kind: rowKind(r), owned: r?.section && r.section !== "reference" });
  const byDrawOrder = (rows) => [...list(rows)].sort((a, b) => compare(orderOfRow(a), orderOfRow(b)));

  // ---- Tier-3 exclusivity and stacking -------------------------------------------------------------------------------------------
  // A row's kind: as the row says (null: none, e.g. a source behind Rivers), else from its theme or key.
  const rowKind = (r) => (r && "kind" in r ? r.kind : kindOf(r?.theme ?? r?.key));
  const rowIsFill = (r) => !!r && !r.rivers && isContextFill(rowKind(r), r.geometry || "polygon");
  // A context fill switched on: the keys of the other context fills on that go off. Not when the person chose to stack with
  // them (stacked: a Set of keys allowed together, or pairs "a|b"), nor when a view in force allows the pair.
  function exclusiveOff(key, rows, { views: viewList = [], stacked = null } = {}) {
    const all = list(rows), mine = all.find((r) => r.key === key);
    if (!rowIsFill(mine)) return [];
    const k = rowKind(mine), ok = (o) => !!stacked && (stacked.has?.(key + "|" + o.key) || stacked.has?.(o.key + "|" + key));
    return [...new Set(all.filter((r) => r.on && r.key !== key && rowIsFill(r) && !ok(r) && !stackAllowed(k, rowKind(r), viewList)).map((r) => r.key))];
  }
  // A set of keys a scene brings: of the context fills in it, the first brought stays and the others go, unless a view in force
  // lets the pair stack (soils and LUC in Soils and landform). keys: in the order brought; rows: the map's rows.
  function resolveExclusive(keys, rows, viewList = []) {
    const out = [], fills = [], byKey = new Map(list(rows).map((r) => [r.key, r]));
    for (const key of keys) {
      const r = byKey.get(key);   // (a key that is no row of the map, a kind's own name, never takes a fill's place)
      if (!r || !rowIsFill(r)) { out.push(key); continue; }
      const k = rowKind(r);
      if (fills.every((f) => stackAllowed(k, f, viewList))) { fills.push(k); out.push(key); }
    }
    return out;
  }
  // Of the context fills on, every one but the lowest drawn is restyled to outline and hatch, so the overlap reads: their keys.
  function stackedKeys(rows) {
    const on = byDrawOrder(list(rows).filter((r) => r.on && rowIsFill(r)));
    return new Set(on.slice(1).map((r) => r.key));
  }

  // ---- The Layers drawer ---------------------------------------------------------------------------------------------------------
  // The rows grouped by view first (the view's label, its rows, in the registry's order), each listed once under its kind's
  // view; then All layers (every listed row: the drawer folds it). A working or annotation row is never listed.
  function drawerGroups(rows) {
    const shown = list(rows).filter(listed), by = new Map();
    for (const r of shown) {
      const v = primaryView(rowKind(r));
      if (!v) continue;
      if (!by.has(v)) by.set(v, []);
      by.get(v).push(r);
    }
    const groups = [...views.values()].filter((v) => by.has(v.key)).map((v) => ({ view: v.key, label: v.label, rows: by.get(v.key) }));
    return { groups, all: shown, unplaced: shown.filter((r) => !primaryView(rowKind(r))) };
  }
  // The line under a context fill that switched another off, with the way to keep both ("Replaced Soils").
  const replacedLine = (names) => "Replaced " + list(names).join(", ");
  // The drawer's list items (browser only; both spaces): a heading per view and its rows, any `tail` (the counts error), then
  // All layers, folded: its rows are made when it is opened and dropped when it is closed (so each switch is on the page once
  // while it is folded). el: FP.el; row(e): a row's <li>; all(rows): All layers' items (default: row each); onFold(): after
  // All layers opens or closes.
  function drawer(rows, { el, row, all = null, tail = [], onFold = () => {} }) {
    const { groups, all: every } = drawerGroups(rows), out = [];
    for (const g of groups) out.push(el("li", { class: "group", "data-layer-section": "view:" + g.view }, g.label), ...g.rows.map((e) => row(e)));
    out.push(...list(tail));
    // the rows no view holds are listed only here, so All layers is open when nothing else is
    if (every.length) {
      const inner = el("ul", { class: "all-layers-list" }), fold = el("details", { class: "all-layers", ...(groups.length ? {} : { open: true }) }, el("summary", {}, "All layers"), inner);
      const fill = () => inner.replaceChildren(...(fold.open ? (all ? all(every) : every.map((e) => row(e))) : []));
      fold.addEventListener("toggle", () => { fill(); onFold(); });
      fill();
      out.push(el("li", { class: "group-all", "data-layer-section": "all" }, fold));
    }
    return out;
  }

  // ---- Loading -------------------------------------------------------------------------------------------------------------------
  // In the browser: one fetch, cached (FP.kinds.ready). A host that draws a map awaits it; the fallback stands if it fails.
  let ready = Promise.resolve(reg);
  if (browser && typeof browser.fetch === "function") {
    use(null);
    ready = browser.fetch("layer-kinds.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("layer-kinds.json: " + r.status))))
      .then((j) => use(j), (e) => { console.warn("The layer kinds could not be read; the fallback order stands:", e?.message || e); return reg; });
  }

  return {
    get ready() { return ready; }, use, registry: () => reg, kindOf, refKindOf, tierOf, defaultRule, labelOf, fillClass, isContextFill, view, viewKeys, viewsFor,
    primaryView, ruleOn, kindsOn, stackAllowed, isData, listed, orderKey, compare, insertBefore, byDrawOrder, exclusiveOff, resolveExclusive, stackedKeys,
    drawerGroups, replacedLine, drawer, FALLBACK_KINDS,
  };
});
