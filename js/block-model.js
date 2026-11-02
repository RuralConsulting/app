// FB1 "I've bought a block" (Josh, 2 Nov 2026, Q8): the guided flow's model. Pure, apart from the flow's calls on the
// client it is given (the same client the app uses: Supabase, or the demo's memory). The LINZ primary parcels are a
// shared layer: the flow reads them (parcels_in_view, parcel_union) and saves only references to the chosen ones and the
// farm's own farmed boundary (add_block, one call). Nothing is written before Save, so Cancel at any step writes nothing.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.blockModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => (Array.isArray(v) ? v : []);
  const SOURCE = "linz-primary-parcels";

  // ---- what someone types: "I've bought a block", "add a block", "new block", "add land" ------------------------------
  // Only a clear statement of new land opens the steps (isBlockIntent): "bought" (or purchased, acquired, taken on) and
  // up to three words before a word for land, or a short command ("add a block", "new block", "add land", "add parcels").
  // A question ("Is the new block in the nitrate zone?", "How much N on the new block") or a show ("Show the new block")
  // never does: it goes to Ask, with Add a block offered beside it when it talks about new land (mentionsNewLand).
  // "add land units" is a layer, not land: a word for land followed by "unit(s)" doesn't count.
  const LAND = String.raw`(?:block|blocks|land|parcel|parcels|title|titles|section|property|ha|hectares|acres)\b(?!\s+units?\b)`;
  const BOUGHT = new RegExp(String.raw`\b(?:bought|purchased|acquired|taken on|took on)\s+(?:[\w'.-]+\s+){0,3}` + LAND, "i");
  const COMMAND = /^(?:please\s+)?(?:add|new|another)\s+(?:a\s+|an\s+|some\s+|more\s+|the\s+new\s+)?(?:block|land|parcels?|titles?)(?:\s+of\s+land)?(?:\s+to\s+the\s+farm)?[.!]?$/i;
  const NOT_A_STATEMENT = /^(?:how|is|are|does|do|did|can|could|should|will|would|has|have|show|what|whats|what's|when|where|which|who|why|tell|list|explain)\b/i;
  const ABOUT_NEW_LAND = new RegExp(String.raw`\b(?:new|extra|another|bought|purchased|acquired)\s+(?:[\w'-]+\s+){0,2}` + LAND, "i");
  const clean = (text) => String(text || "").trim().replace(/[’‘]/g, "'");
  function isBlockIntent(text) {
    const t = clean(text);
    if (!t || t.length > 120 || /\?\s*$/.test(t) || NOT_A_STATEMENT.test(t)) return false;
    return COMMAND.test(t) || BOUGHT.test(t);
  }
  // Talks about new land without saying to add it: Add a block is offered, Ask stays what Enter does.
  function mentionsNewLand(text) {
    const t = clean(text);
    return !!t && t.length <= 200 && !isBlockIntent(t) && ABOUT_NEW_LAND.test(t);
  }

  // ---- a parcel as the list shows it ------------------------------------------------------------------------------------
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  // Area in hectares: the parcel's own area from the database (area_ha), else LINZ's calculated or survey area (m²).
  function parcelArea(props) {
    const p = props || {};
    const ha = num(p.area_ha);
    if (ha !== null) return ha;
    const m2 = num(p.calc_area) ?? num(p.survey_area);
    return m2 === null ? null : Math.round(m2 / 100) / 100;
  }
  const ha = (v) => (v === null || v === undefined ? "" : (v >= 100 ? Math.round(v).toLocaleString("en-NZ") : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + " ha");
  function parcelRow(feature) {
    const p = feature?.properties || {};
    const id = num(feature?.id ?? p.reference_id ?? p.id);
    return { id, external_id: String(p.external_id ?? p.id ?? ""), appellation: String(p.appellation || "").trim() || "Parcel " + (p.external_id ?? p.id ?? id),
      area_ha: parcelArea(p), titles: String(p.titles || "").trim() || null, intent: String(p.parcel_intent || "").trim() || null, held: !!p.held };
  }

  // ---- selection: the parcels the person has tapped, in the order they tapped them ---------------------------------------
  const emptySelection = () => ({ ids: [], rows: {}, features: {} });
  function toggle(sel, feature) {
    const row = parcelRow(feature);
    if (row.id === null || row.held) return sel;   // a parcel the farm already holds is shown, not chosen again
    const on = sel.ids.includes(row.id);
    const ids = on ? sel.ids.filter((x) => x !== row.id) : [...sel.ids, row.id];
    const rows = { ...sel.rows }, features = { ...sel.features };
    if (on) { delete rows[row.id]; delete features[row.id]; } else { rows[row.id] = row; features[row.id] = { type: "Feature", id: row.id, geometry: feature.geometry, properties: { ...(feature.properties || {}), reference_id: row.id } }; }
    return { ids, rows, features };
  }
  function summary(sel) {
    const rows = sel.ids.map((id) => sel.rows[id]).filter(Boolean);
    const known = rows.filter((r) => r.area_ha !== null);
    const total = known.reduce((s, r) => s + r.area_ha, 0);
    return { count: rows.length, rows, area_ha: known.length ? Math.round(total * 100) / 100 : null,
      text: rows.length ? rows.length + (rows.length === 1 ? " parcel" : " parcels") + (known.length ? ", " + ha(total) : "") : "No parcels chosen" };
  }

  // ---- geometry: rings, areas and the dissolve ----------------------------------------------------------------------------
  // Rings are GeoJSON lng/lat; areas use a local equirectangular projection (good to well under 1% at a farm's size).
  const KEY = 1e7;
  const keyOf = (c) => Math.round(c[0] * KEY) + "," + Math.round(c[1] * KEY);
  const open = (ring) => (ring.length > 1 && keyOf(ring[0]) === keyOf(ring[ring.length - 1]) ? ring.slice(0, -1) : ring.slice());
  const close = (ring) => (ring.length ? [...ring, ring[0]] : ring);
  const polygonsOf = (g) => (g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? list(g.coordinates) : g?.type === "Feature" ? polygonsOf(g.geometry) : []);
  function signedArea(ring, lat0) {
    const r = open(ring), k = Math.cos((lat0 * Math.PI) / 180) * 111320, m = 110540;
    let s = 0;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += (a[0] * k) * (b[1] * m) - (b[0] * k) * (a[1] * m); }
    return s / 2;
  }
  const latOf = (polys) => { const ys = polys.flatMap((p) => list(p[0]).map((c) => c[1])); return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0; };
  // Area of a Polygon or MultiPolygon in hectares (holes taken out).
  function areaHa(geom) {
    const polys = polygonsOf(geom), lat0 = latOf(polys);
    let s = 0;
    for (const p of polys) list(p).forEach((ring, i) => { const a = Math.abs(signedArea(ring, lat0)); s += i === 0 ? a : -a; });
    return Math.round((s / 10000) * 100) / 100;
  }
  function inside(pt, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  // Points along a ring that are on a straight line between their neighbours add nothing: dropped.
  function simplify(ring) {
    let r = ring.slice();
    for (let changed = true; changed && r.length > 3;) {
      changed = false;
      for (let i = 0; i < r.length && r.length > 3; i++) {
        const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        if (Math.abs(cross) / len < 1e-9 || keyOf(a) === keyOf(b)) { r.splice(i, 1); changed = true; i--; }
      }
    }
    return r;
  }
  // The chosen parcels as one shape: edges two parcels share cancel out, so neighbouring parcels become one polygon and
  // parcels apart stay apart. A vertex of one parcel lying on another's edge splits that edge first (cadastral parcels meet
  // at T-junctions). Returns a Polygon, a MultiPolygon, or null. The database's parcel_union (st_union) is the same
  // shape for the app; this is for the demo and as a check.
  function dissolve(geoms) {
    const rings = [];
    for (const g of list(geoms)) for (const p of polygonsOf(g)) list(p).forEach((ring, i) => {
      let r = open(ring).filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
      if (r.length < 3) return;
      const ccw = signedArea(r, r[0][1]) > 0;
      if ((i === 0) !== ccw) r = r.reverse();   // outer rings anticlockwise, holes clockwise
      rings.push(r);
    });
    if (!rings.length) return null;
    const points = new Map();
    for (const r of rings) for (const c of r) points.set(keyOf(c), c);
    const all = [...points.values()];
    const edges = new Map();   // "a>b" -> [a, b]
    const onSegment = (p, a, b) => {
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!len || Math.abs(cross) / len > 1e-8) return false;
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
      return t > 1e-9 && t < 1 - 1e-9;
    };
    const add = (a, b) => {
      const ka = keyOf(a), kb = keyOf(b);
      if (ka === kb) return;
      if (edges.has(kb + ">" + ka)) edges.delete(kb + ">" + ka);   // shared with a neighbour: inside the union
      else if (!edges.has(ka + ">" + kb)) edges.set(ka + ">" + kb, [a, b]);
    };
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const on = all.filter((p) => onSegment(p, a, b)).sort((p, q) => Math.hypot(p[0] - a[0], p[1] - a[1]) - Math.hypot(q[0] - a[0], q[1] - a[1]));
      let from = a;
      for (const p of [...on, b]) { add(from, p); from = p; }
    }
    // chain what is left into rings
    const out = new Map();
    for (const [k, e] of edges) { const s = keyOf(e[0]); if (!out.has(s)) out.set(s, []); out.get(s).push(k); }
    const used = new Set(), result = [];
    for (const k of edges.keys()) {
      if (used.has(k)) continue;
      const ring = [], start = keyOf(edges.get(k)[0]);
      let cur = k;
      while (cur && !used.has(cur)) {
        used.add(cur);
        const [a, b] = edges.get(cur);
        ring.push(a);
        const kb = keyOf(b);
        if (kb === start) break;
        cur = (out.get(kb) || []).find((x) => !used.has(x));
      }
      const r = simplify(ring);
      if (r.length >= 3) result.push(r);
    }
    const lat0 = result.length ? result[0][0][1] : 0;
    const outers = result.filter((r) => signedArea(r, lat0) > 0).map((r) => [r]), holes = result.filter((r) => signedArea(r, lat0) < 0);
    for (const h of holes) {
      const home = outers.filter((o) => inside(h[0], o[0]) || inside(h[Math.floor(h.length / 2)], o[0]))
        .sort((x, y) => Math.abs(signedArea(x[0], lat0)) - Math.abs(signedArea(y[0], lat0)))[0];
      if (home) home.push(h);
    }
    if (!outers.length) return null;
    const polys = outers.map((p) => p.map(close));
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }

  // ---- the farmed area being adjusted: polygons of open rings, addressed [polygon, ring, vertex] --------------------------
  function shapeOf(geom) { return polygonsOf(geom).map((p) => list(p).map((r) => open(r).map((c) => [c[0], c[1]]))); }
  function geometryOf(shape) {
    const polys = list(shape).map((p) => p.filter((r) => r.length >= 3).map(close)).filter((p) => p.length);
    if (!polys.length) return null;
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }
  const copy = (shape) => shape.map((p) => p.map((r) => r.map((c) => c.slice())));
  const at = (shape, [p, r]) => shape[p]?.[r];
  function moveVertex(shape, where, lngLat) {
    const s = copy(shape), ring = at(s, where);
    if (!ring || !ring[where[2]]) return shape;
    ring[where[2]] = [lngLat[0], lngLat[1]];
    return s;
  }
  // A new point on the edge after vertex v (the "+" between two points).
  function insertVertex(shape, where, lngLat) {
    const s = copy(shape), ring = at(s, where);
    if (!ring) return shape;
    const v = where[2], next = ring[(v + 1) % ring.length];
    ring.splice(v + 1, 0, lngLat ? [lngLat[0], lngLat[1]] : [(ring[v][0] + next[0]) / 2, (ring[v][1] + next[1]) / 2]);
    return s;
  }
  // A ring keeps three points at least.
  function removeVertex(shape, where) {
    const s = copy(shape), ring = at(s, where);
    if (!ring || ring.length <= 3) return shape;
    ring.splice(where[2], 1);
    return s;
  }
  // Handles for the map: a point per vertex and a "+" at each edge's middle.
  function handles(shape) {
    const vertices = [], middles = [];
    list(shape).forEach((p, pi) => p.forEach((ring, ri) => ring.forEach((c, vi) => {
      vertices.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: { p: pi, r: ri, v: vi } });
      const n = ring[(vi + 1) % ring.length];
      middles.push({ type: "Feature", geometry: { type: "Point", coordinates: [(c[0] + n[0]) / 2, (c[1] + n[1]) / 2] }, properties: { p: pi, r: ri, v: vi } });
    })));
    return { vertices: { type: "FeatureCollection", features: vertices }, middles: { type: "FeatureCollection", features: middles } };
  }

  // ---- the flow: pick -> confirm (does the farmed area need adjusting?) -> adjust -> saved -> note ---------------------
  // Each step's actions return the next state; only save() and saveNote() write, and only through the client given.
  const STEPS = ["pick", "confirm", "adjust", "saved", "note"];
  function createFlow({ sb, farm, onChange = () => {} }) {
    let state = { step: "pick", selection: emptySelection(), acquired: "", note: "", union: null, shape: null, drawing: null, result: null, error: null, busy: false };
    const set = (patch) => { state = { ...state, ...patch }; onChange(state); return state; };
    const writes = [];   // every write this flow made (the tests read it)
    let closed = false;
    async function rpc(name, args) {
      const { data, error } = await sb.rpc(name, args);
      if (error) throw Error(error.message || String(error));
      return data;
    }
    return {
      get state() { return state; }, writes, STEPS,
      get closed() { return closed; },
      toggle(feature) { if (state.step !== "pick" || closed) return state; return set({ selection: toggle(state.selection, feature), error: null }); },
      clear() { return set({ selection: emptySelection() }); },
      // parcels_in_view: the shared layer, read for the map in view (a filter on the layer, nothing copied).
      async parcelsIn(bounds) {
        const [[w, s], [e, n]] = bounds;
        const rows = await rpc("parcels_in_view", { f: farm, west: w, south: s, east: e, north: n });
        return { type: "FeatureCollection", features: list(rows).map((r) => ({ type: "Feature", id: Number(r.id), geometry: r.web_geom,
          properties: { ...(r.props || {}), reference_id: Number(r.id), external_id: r.external_id, area_ha: r.area_ha, held: !!r.held } })) };
      },
      async next() {
        if (state.step !== "pick" || !state.selection.ids.length || closed) return state;
        set({ busy: true, error: null });
        try {
          const u = await rpc("parcel_union", { parcel_ids: state.selection.ids });
          const union = u?.geometry || dissolve(state.selection.ids.map((id) => state.selection.features[id]?.geometry));
          return set({ step: "confirm", union, union_ha: u?.area_ha ?? areaHa(union), busy: false });
        } catch (e) { return set({ busy: false, error: e.message }); }
      },
      back() {
        if (closed) return state;
        const to = { confirm: "pick", adjust: "confirm" }[state.step];
        return to ? set({ step: to, error: null, drawing: null }) : state;
      },
      setAcquired(v) { return set({ acquired: String(v || "").slice(0, 10) }); },
      // "Does the farmed area need adjusting?" Yes: the parcels' shape to start from. No: save as they are.
      adjust() { if (state.step !== "confirm" || closed) return state; return set({ step: "adjust", shape: shapeOf(state.union), drawing: null, error: null }); },
      reshape(shape) { if (state.step !== "adjust") return state; return set({ shape, error: null }); },
      reset() { if (state.step !== "adjust") return state; return set({ shape: shapeOf(state.union), drawing: null }); },
      // Redraw: the person taps the corners of the farmed area; three or more make a shape.
      startDrawing() { if (state.step !== "adjust") return state; return set({ drawing: [] }); },
      tapDrawing(lngLat) { if (!state.drawing) return state; return set({ drawing: [...state.drawing, [lngLat[0], lngLat[1]]] }); },
      undoCorner() { if (!state.drawing) return state; return set({ drawing: state.drawing.slice(0, -1) }); },
      finishDrawing() {
        if (!state.drawing) return state;
        if (state.drawing.length < 3) return set({ error: "Tap at least three corners." });
        return set({ shape: [[state.drawing]], drawing: null, error: null });
      },
      farmed() { return state.step === "adjust" ? geometryOf(state.shape) : null; },
      async save() {
        if (closed || state.busy || !["confirm", "adjust"].includes(state.step) || !state.selection.ids.length) return state;
        const farmed = state.step === "adjust" ? geometryOf(state.shape) : null;
        if (state.step === "adjust" && !farmed) return set({ error: "The farmed area needs three points or more." });
        set({ busy: true, error: null });
        const args = { f: farm, parcel_ids: state.selection.ids, farmed, acquired: /^\d{4}-\d{2}-\d{2}$/.test(state.acquired) ? state.acquired : null, block_note: null };
        try {
          writes.push({ rpc: "add_block", args });
          const result = await rpc("add_block", args);
          return set({ step: "saved", result, busy: false, shape: farmed ? state.shape : null, drawing: null });
        } catch (e) { writes.pop(); return set({ busy: false, error: e.message }); }
      },
      noteStep() { if (state.step !== "saved" || closed) return state; return set({ step: "note", error: null }); },
      // A note and/or a document about the block: the note on each parcel just added; the document (already uploaded by
      // the caller, which passes its id) linked from them.
      async saveNote(note, documentId) {
        if (state.step !== "note" || closed || state.busy) return state;
        const ids = list(state.result?.parcels), text = String(note || "").trim();
        if (!ids.length || (!text && !documentId)) return set({ error: "Write a note or choose a document." });
        set({ busy: true, error: null });
        const change = { ...(text ? { note: text } : {}), ...(documentId ? { document_id: documentId } : {}) };
        try {
          writes.push({ table: "farm_parcels", change, ids });
          const { data, error } = await sb.from("farm_parcels").update(change).in("id", ids).select("id");
          if (error) throw Error(error.message || String(error));
          if (!list(data).length) throw Error("That change wasn't allowed.");
          return set({ step: "saved", noted: true, note: text, busy: false });
        } catch (e) { return set({ busy: false, error: e.message }); }
      },
      cancel() { closed = true; return set({ step: "closed" }); },
    };
  }

  return { SOURCE, isBlockIntent, mentionsNewLand, parcelArea, parcelRow, ha, emptySelection, toggle, summary, areaHa, dissolve, simplify,
    shapeOf, geometryOf, moveVertex, insertVertex, removeVertex, handles, createFlow, STEPS };
});
