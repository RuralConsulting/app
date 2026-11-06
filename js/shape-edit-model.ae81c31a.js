// GE1b (#417 slice GE1): reshape a block, paddock or land unit that is already on the map, as a new version (GE1a). The
// model: who is offered Edit shape (Q27), the corner edits with undo and redo until Save, snapping to neighbours, parcels,
// waterways and the boundary within a stated pixel tolerance, every refusal in plain words, and the session's reads and
// its two writes. Pure, apart from the session's calls on the client it is given (Supabase, or the demo's memory).
// The corner edits are the add-block editor's own (FP.blockModel: shapeOf, geometryOf, moveVertex, insertVertex,
// removeVertex, handles), so both editors move, add and remove corners the same way; add-block itself is unchanged.
// What is read, all bounded (CONTEXT: a count, then at most that many features): the feature's version (map_features,
// under its members' read rule), its shape whole (farm_layer_features / group_layer_features for a box round it,
// unsimplified, at most READ_MAX features: the same read gives its neighbours in the layer), and for snapping the parcels
// (reference_view_features) and waterways (waterways_in_view) in that box. What is written: only Save
// (public.feature_edit_shape, with the version opened) and, after it, Undo the save (public.feature_restore_version,
// the earlier version restored as a new one). Before any work the session asks feature_edit_shape with no shape: every
// check on the feature (who may edit the layer, a reference or designation layer, a farm layer whose features are also
// places, removed or set aside, a later version) runs first, and with all of them passed the call is refused for the
// missing shape (22023) and writes nothing, so a person never reshapes something the save would refuse for who they are
// or what it is. Phone: view only (the tools are never offered, and the editor does not open).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./block-model.js") : root.FP.blockModel);
  if (node) module.exports = api; else root.FP.shapeEditModel = api;
})(typeof window === "undefined" ? globalThis : window, function (B) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const SNAP_PX = 10;           // a dragged corner snaps to a corner or edge within this many screen pixels
  const MAX_CORNERS = 25000;    // as app.feature_edit_max_vertices() (GE1a): more cannot be saved
  const HISTORY = 200;          // undo steps kept until Save
  const READ_MAX = 400;         // features in the box round the shape (it and its neighbours); more and a smaller box is read
  const PHONE_MAX = 800;        // the app's phone rule (the map's sheet layout below 801 px): no editing tools
  const PARCELS = "linz-primary-parcels";

  // ---- who is offered Edit shape (Q27, PM 7 Nov 2026) ---------------------------------------------------------------------
  // A group's admins and advisors edit the group's own layers; a farm's editors edit the farm's own layers; nobody edits a
  // shared reference layer, and a farm layer whose features are also places (land units) is not reshaped yet (GE1a, 0A000).
  // Where a person who edits this space taps something they cannot edit, the popup says why, never a silent nothing. A person
  // who edits nothing here sees the popup exactly as before. GE1 reshapes areas (blocks, paddocks, land units).
  const isPhone = (width) => Number.isFinite(width) && width <= PHONE_MAX;
  const editsSpace = (space, role) => (space === "group" ? ["admin", "advisor"].includes(role) : space === "farm" ? ["owner", "admin", "edit"].includes(role) : false);
  const WHY = {
    reference: "A shared reference layer: shapes can be snapped to it, but it is never edited here.",
    units: "The farm's land units are also its places, so they are not reshaped yet: changing the shape alone would leave the place with its old shape.",
    members: "Each member farm's boundary is the farm's own: it is changed on that farm's map, not here.",
    designation: "A designation layer comes from the loading tools only, so it is not edited here.",
    lines: "Only areas (blocks, paddocks and land units) can be reshaped so far.",
  };
  // Trial (PM, 7 Nov 2026): until Josh has looked at the group map (A26), the tools show only for RCL staff who have switched
  // on "Shape editor (trial)" on the Operations Layers tab (a setting kept in their browser). Switch off: null for everything,
  // and every popup is as before. Corners are dragged with a mouse or pen (fine: the device's main pointer is precise): on a
  // touch-first device (a tablet, whatever its width) the tools are not offered, as on a phone.
  // target: { reference: key } | { units: true } (a farm's register land units) | { layer, id } (a layer's feature)
  // -> null (nothing shown), { edit: true }, or { edit: false, why }
  function offer({ space, role, width, target, trial = false, staff = false, fine = false } = {}) {
    if (trial !== true || staff !== true) return null;
    if (isPhone(width) || fine !== true || !target || !editsSpace(space, role)) return null;
    if (target.reference) return { edit: false, why: WHY.reference };
    if (target.units) return { edit: false, why: WHY.units };
    const l = target.layer;
    if (!l) return null;
    if (l.group_own === false || l.theme === "member_farms") return space === "group" ? { edit: false, why: WHY.members } : null;
    if (!l.id || target.id === null || target.id === undefined || !Number.isFinite(Number(target.id))) return null;
    if (l.epistemic_class === "designation") return { edit: false, why: WHY.designation };
    if (l.geometry_type !== "polygon") return { edit: false, why: WHY.lines };
    if (space === "farm" && l.theme === "land_units") return { edit: false, why: WHY.units };
    return { edit: true };
  }

  // What the popup's tools are about: the tapped (top) feature when it can be edited; else a layer's feature under the tap that
  // can (a member block under the member farms' outline), named by its layer; else the top one's reason, if it has one.
  // hit: { edit: target, under: [target] }; offerFor(target) -> offer(). -> null, or { target, offer, under }
  function pickTarget(hit, offerFor) {
    const top = hit?.edit ? offerFor(hit.edit) : null;
    if (top?.edit) return { target: hit.edit, offer: top, under: false };
    const same = (a, b) => !!a && !!b && a.layerIndex === b.layerIndex && String(a.id) === String(b.id);
    for (const t of list(hit?.under)) {
      if (same(t, hit.edit)) continue;
      const o = offerFor(t);
      if (o?.edit) return { target: t, offer: o, under: true };
    }
    return top ? { target: hit.edit, offer: top, under: false } : null;
  }

  // ---- refusals, in plain words (GE1a's SQLSTATEs) -----------------------------------------------------------------------
  // -> { code, text, reload (a later version: offer Reload), close (nothing more can be done here) }
  function refusal(err, { space } = {}) {
    const code = String(err?.code || ""), msg = String(err?.message || err || "");
    const out = (text, more = {}) => ({ code, text, reload: false, close: false, ...more });
    if (code === "42501") {
      if (/reference/i.test(msg)) return out(WHY.reference, { close: true });
      if (/designation/i.test(msg)) return out(WHY.designation, { close: true });
      return out(space === "group" ? "Only the group's admins and advisors can change the group's layers." :
        "Only the farm's editors can change the farm's layers (and only its advisors an interpretation or assessment layer).", { close: true });
    }
    if (code === "0A000") return out(/land units/i.test(msg) ? WHY.units :
      "This layer's shapes are also the farm's places (loaded as paddocks or blocks), so they are not reshaped yet: changing the shape alone would leave the place with its old shape.", { close: true });
    if (code === "P0002") return out("This shape can't be found any more: it may have been removed, or you may no longer see its layer. Close it and open the map again.", { close: true });
    if (code === "55000") return out(/set aside/i.test(msg) ? "This shape is set aside here by an overlapping dataset, so it can't be reshaped here." :
      "This shape was removed by a later load of its file, so it can't be changed.", { close: true });
    if (code === "unexpected") return out("The shape couldn't be checked before editing, so it isn't opened. Nothing was changed.", { close: true });
    if (code === "40001") {
      const v = msg.match(/version (\d+)/);
      return out("Someone saved a change to this shape after you opened it" + (v ? " (it is now version " + v[1] + ")" : "") + ". Reload it to see their change, then make your edit again.", { reload: true });
    }
    if (code === "54000") return out("The shape has too many corners to save (at most " + MAX_CORNERS.toLocaleString("en-NZ") + "). Remove some corners, then save again.");
    if (code === "22023") {
      if (/not in New Zealand/i.test(msg)) return out("The shape can't be saved: part of it is outside New Zealand. Move those corners back.");
      if (/repaired/i.test(msg)) return out("The shape can't be saved as drawn: its edges cross in a way that can't be repaired. Move the corners so the edges don't cross.");
      if (/empty/i.test(msg)) return out("The shape is empty: it needs three corners or more.");
      if (/holds/i.test(msg)) return out("This layer holds areas, and the shape is not one. Start again from the saved shape.");
      return out("The shape can't be saved as drawn. Move the corners so it is one clear area, then save again.");
    }
    return out("The shape wasn't saved" + (msg ? ": " + msg : "") + ". Nothing was changed.");
  }

  // ---- corner edits with undo and redo until Save -------------------------------------------------------------------------
  // A shape is FP.blockModel's: polygons of open rings, a corner addressed [polygon, ring, vertex]; every edit is made with
  // blockModel's moveVertex, insertVertex or removeVertex, as add-block makes it. The history keeps each step as what it
  // changed (one corner: where, and its coordinates before and after), never a copy of the shape, so a 10,000-corner block
  // keeps its 200 steps in a few kilobytes (GE1b measured it). A drag is one step: the corner moves as the pointer does (each
  // move a preview) and the step is kept when it ends. Whether the shape differs from the one saved is told by the steps
  // (the step the shape is at, against the step it was saved at), not by comparing the shapes.
  const corners = (shape) => list(shape).reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0);
  const at3 = (shape, w) => shape?.[w[0]]?.[w[1]]?.[w[2]];
  const sameAt = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
  function createEditor(shape) {
    let now = shape, past = [], future = [], drag = null, picked = null, made = 0, step = 0, savedAt = 0, floor = 0, count = corners(shape);
    // one step: { kind: "move" | "insert" | "remove", where, from, to, id }: redone and undone with blockModel's own edits
    const before = (w) => [w[0], w[1], w[2] - 1];   // insertVertex puts the new corner after this one
    const redoOf = (st, shp) => (st.kind === "move" ? B.moveVertex(shp, st.where, st.to)
      : st.kind === "insert" ? B.insertVertex(shp, before(st.where), st.to) : B.removeVertex(shp, st.where));
    const undoOf = (st, shp) => (st.kind === "move" ? B.moveVertex(shp, st.where, st.from)
      : st.kind === "insert" ? B.removeVertex(shp, st.where) : B.insertVertex(shp, before(st.where), st.from));
    const delta = (st) => (st.kind === "insert" ? 1 : st.kind === "remove" ? -1 : 0);
    const keep = (st) => {
      st.id = ++made; past.push(st); if (past.length > HISTORY) floor = past.shift().id;   // the oldest step goes: the shape keeps it (floor)
      future = []; step = st.id; count += delta(st);
    };
    return {
      get shape() { return now; }, get picked() { return picked; }, get dragging() { return !!drag; },
      get canUndo() { return past.length > 0 && !drag; }, get canRedo() { return future.length > 0 && !drag; },
      get dirty() { return step !== savedAt || (!!drag && !sameAt(at3(now, drag.where), drag.from)); },
      get corners() { return count; }, get steps() { return { past: past.length, future: future.length }; },
      // what the history holds (the undo and redo steps), for the measure of its memory
      history() { return { past, future }; },
      geometry() { return B.geometryOf(now); },
      areaHa() { const g = B.geometryOf(now); return g ? B.areaHa(g) : null; },
      pick(where) { picked = where ? where.slice(0, 3) : null; return picked; },
      // a drag: begin on the corner, move (each a preview), end (one undo step, if it moved)
      begin(where) { const c = at3(now, where); if (drag || !c) return false; drag = { where: where.slice(0, 3), from: c.slice() }; picked = drag.where; return true; },
      move(where, lngLat) { if (!drag) return false; now = B.moveVertex(now, drag.where, lngLat); return true; },
      end() {
        if (!drag) return false;
        const d = drag, to = at3(now, d.where); drag = null;
        if (!to || sameAt(to, d.from)) return false;
        keep({ kind: "move", where: d.where, from: d.from, to: to.slice() });
        return true;
      },
      // the "+" between two corners: a new corner on that edge, picked
      insert(where) {
        const next = B.insertVertex(now, where);
        if (next === now) return false;
        const w = [where[0], where[1], where[2] + 1];
        now = next; keep({ kind: "insert", where: w, from: null, to: at3(now, w).slice() });
        picked = w; return true;
      },
      // a ring keeps three corners at least
      remove(where = picked) {
        if (!where) return false;
        const c = at3(now, where), next = B.removeVertex(now, where);
        if (next === now || !c) return false;
        now = next; keep({ kind: "remove", where: where.slice(0, 3), from: c.slice(), to: null });
        picked = null; return true;
      },
      undo() {
        if (!past.length || drag) return false;
        const st = past.pop(); now = undoOf(st, now); future.push(st); count -= delta(st);
        step = past.length ? past[past.length - 1].id : floor; picked = null; return true;
      },
      redo() {
        if (!future.length || drag) return false;
        const st = future.pop(); now = redoOf(st, now); past.push(st); count += delta(st);
        step = st.id; picked = null; return true;
      },
      // after Save, or a reload: this shape is the one saved; the history starts again
      reset(shape) { now = shape; past = []; future = []; drag = null; picked = null; step = savedAt = floor = 0; count = corners(shape); },
    };
  }

  // ---- snapping -------------------------------------------------------------------------------------------------------------
  // The snap targets: every corner and edge of the features given, by kind (neighbour, parcel, waterway, boundary), in a
  // grid by degrees so a pointer move looks only at what is near it. A dragged corner snaps to the nearest target corner
  // within SNAP_PX screen pixels, else to the nearest point on a target edge within them; nothing nearer, it goes where the
  // pointer is. project(lngLat) -> [x, y] in screen pixels (the map's), so the tolerance is the same at every zoom.
  const KIND_TEXT = { neighbour: "a neighbouring shape", parcel: "a parcel boundary", waterway: "a waterway", boundary: "the boundary" };
  function linesOf(geom) {
    const g = geom?.type === "Feature" ? geom.geometry : geom;
    if (!g) return [];
    if (g.type === "Polygon") return list(g.coordinates);
    if (g.type === "MultiPolygon") return list(g.coordinates).flat();
    if (g.type === "LineString") return [g.coordinates];
    if (g.type === "MultiLineString") return list(g.coordinates);
    if (g.type === "GeometryCollection") return list(g.geometries).flatMap(linesOf);
    return [];
  }
  const ok = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);
  // sources: [{ kind, features: [geometry | Feature] }]; skip: a feature id not to snap to (the shape being edited)
  function snapIndex(sources, { skip = null, cell = 0.002 } = {}) {
    const grid = new Map(), segs = [];
    const keyOf = (i, j) => i + ":" + j;
    for (const s of list(sources)) for (const f of list(s?.features)) {
      if (skip != null && f && f.id != null && String(f.id) === String(skip)) continue;
      for (const line of linesOf(f)) for (let k = 0; k + 1 < list(line).length; k++) {
        const a = line[k], b = line[k + 1];
        if (!ok(a) || !ok(b)) continue;
        const n = segs.push({ a, b, kind: s.kind }) - 1;
        const i0 = Math.floor(Math.min(a[0], b[0]) / cell), i1 = Math.floor(Math.max(a[0], b[0]) / cell);
        const j0 = Math.floor(Math.min(a[1], b[1]) / cell), j1 = Math.floor(Math.max(a[1], b[1]) / cell);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) { (grid.get("*") || grid.set("*", []).get("*")).push(n); continue; }   // a very long edge: always looked at
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = keyOf(i, j); (grid.get(key) || grid.set(key, []).get(key)).push(n); }
      }
    }
    return { grid, segs, cell, size: segs.length,
      near([w, s, e, n]) {
        const out = new Set(grid.get("*") || []);
        for (let i = Math.floor(w / cell); i <= Math.floor(e / cell); i++) for (let j = Math.floor(s / cell); j <= Math.floor(n / cell); j++) for (const x of grid.get(keyOf(i, j)) || []) out.add(x);
        return [...out].map((x) => segs[x]);
      } };
  }
  // -> null, or { lngLat, kind, at: "corner" | "edge", text }. box: the lng/lat box the tolerance covers round the pointer
  // (the map's unproject of the pointer +- SNAP_PX); without one, every segment is looked at.
  function snap(index, lngLat, project, { tolerance = SNAP_PX, box = null } = {}) {
    if (!index?.size || !ok(lngLat)) return null;
    const p = project(lngLat), cand = box ? index.near(box) : index.segs;
    let best = null, edge = null;
    for (const s of cand) {
      for (const c of [s.a, s.b]) {
        const q = project(c), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d <= tolerance && (!best || d < best.d)) best = { d, lngLat: [c[0], c[1]], kind: s.kind, at: "corner" };
      }
      if (best) continue;   // a corner within reach wins over any edge
      const a = project(s.a), b = project(s.b), dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
      if (d <= tolerance && (!edge || d < edge.d)) edge = { d, lngLat: [s.a[0] + t * (s.b[0] - s.a[0]), s.a[1] + t * (s.b[1] - s.a[1])], kind: s.kind, at: "edge" };
    }
    const hit = best || edge;
    return hit ? { lngLat: hit.lngLat, kind: hit.kind, at: hit.at, text: "Snapped to " + (hit.at === "corner" ? "a corner of " : "") + KIND_TEXT[hit.kind] + "." } : null;
  }
  // The sentence under the snap switch: what it snaps to, from the targets read (a kind not read is not claimed).
  function snapLine(kinds) {
    const have = ["neighbour", "parcel", "waterway", "boundary"].filter((k) => list(kinds).includes(k));
    const words = { neighbour: "neighbours", parcel: "parcels", waterway: "waterways", boundary: "the boundary" };
    if (!have.length) return "Nothing to snap to was read here.";
    const names = have.map((k) => words[k]);
    return "Snaps to " + (names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0]) + " within " + SNAP_PX + " px. Hold Alt to place a corner freely.";
  }

  // ---- the box round a shape, and the session's reads and writes -----------------------------------------------------------
  function bboxOf(geom) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const line of linesOf(geom)) for (const c of list(line)) if (ok(c)) { w = Math.min(w, c[0]); s = Math.min(s, c[1]); e = Math.max(e, c[0]); n = Math.max(n, c[1]); }
    return Number.isFinite(w) ? [w, s, e, n] : null;
  }
  const pad = ([w, s, e, n], share, least = 0.0005) => { const dx = Math.max((e - w) * share, least), dy = Math.max((n - s) * share, least); return [w - dx, s - dy, e + dx, n + dy]; };

  // One editing session on one feature. space: "farm" | "group"; owner: the farm's or group's id; layer: the map layer
  // ({id, name, theme, geometry_type}); id: the feature's id; box: [w, s, e, n] round it as drawn (the read gets it whole);
  // at: the point tapped (a smaller box when the first holds too much); boundary: [geometry | Feature] to snap to.
  function createSession({ sb, space, owner, layer, id, box = null, at = null, boundary = [] }) {
    const own = space === "farm" ? "farm_layer_features" : "group_layer_features", ownerArg = space === "farm" ? { f: owner } : { g: owner };
    const writes = [];   // every write this session made (the tests read it)
    let state = { status: "idle", version: null, feature: null, neighbours: [], snaps: [], kinds: [], saved: null, refusal: null, error: null };
    const set = (patch) => (state = { ...state, ...patch });
    const fail = (e) => set({ status: "failed", error: "The shape couldn't be opened: " + (e?.message || e) + "." });
    async function call(name, args) {
      const r = await sb.rpc(name, args);
      if (r?.error) throw r.error;
      return r?.data;
    }
    // the version the person opens (and saves on)
    async function readVersion() {
      const r = await sb.from("map_features").select("id,version_no").eq("id", Number(id)).eq("layer_id", layer.id).maybeSingle();
      if (r?.error) throw r.error;
      return r?.data ? Number(r.data.version_no) : null;
    }
    // the feature whole (unsimplified) and its neighbours in the layer, for a box round it; too many there: a small box at the tap
    async function readShape() {
      const tries = [box && pad(box, 0.25), at && [at[0] - 0.0002, at[1] - 0.0002, at[0] + 0.0002, at[1] + 0.0002]].filter(Boolean);
      for (const [w, s, e, n] of tries) {
        const d = await call(own, { ...ownerArg, layer: layer.id, x0: w, y0: s, x1: e, y1: n, tolerance_m: 0, max_features: READ_MAX });
        if (!d) throw Object.assign(new Error("No such feature in this layer"), { code: "P0002" });
        const feats = list(d.features?.features), me = feats.find((f) => String(f.id) === String(id));
        if (!d.truncated && me) return { feature: me, neighbours: feats.filter((f) => f !== me) };
      }
      return null;
    }
    // what a dragged corner can snap to round the shape: the neighbours (above), parcels and waterways in the box, the boundary.
    // Each read on its own: one that fails or is too much for the box is left out (the snap line names only what was read).
    async function readSnaps(geom) {
      const b = pad(bboxOf(geom), 0.3, 0.002), [w, s, e, n] = b, sources = [];
      if (state.neighbours.length) sources.push({ kind: "neighbour", features: state.neighbours });
      const parcels = call("reference_view_features", { source: PARCELS, x0: w, y0: s, x1: e, y1: n, tolerance_m: 0, max_features: 1000 })
        .then((d) => (d && !d.truncated ? list(d.features?.features) : []), () => []);
      const water = call("waterways_in_view", { bbox_xmin: w, bbox_ymin: s, bbox_xmax: e, bbox_ymax: n, min_order: 1, max_rows: 2000, bbox_srid: 4326 })
        .then((rows) => list(rows).filter((r) => r?.web_geom?.coordinates).map((r) => r.web_geom), () => []);
      const [p, wv] = await Promise.all([parcels, water]);
      if (p.length) sources.push({ kind: "parcel", features: p });
      if (wv.length) sources.push({ kind: "waterway", features: wv });
      const bd = list(boundary).filter(Boolean);
      if (bd.length) sources.push({ kind: "boundary", features: bd });
      return sources;
    }
    // GE1a's checks on the feature, without a shape: refused for the shape (22023) means every check on the feature passed
    // (only a refusal for the missing shape opens the editor: a call that answered without refusing is not a pass)
    async function probe(version) {
      try { await call("feature_edit_shape", { layer: layer.id, feature: Number(id), shape: null, base_version: version }); }
      catch (e) { return String(e?.code) === "22023" ? null : e; }
      return { code: "unexpected", message: "the check before editing did not refuse a missing shape" };
    }
    async function open() {
      set({ status: "loading", refusal: null, error: null, saved: null });
      try {
        const version = await readVersion();
        if (version === null) { set({ status: "refused", refusal: refusal({ code: "P0002" }, { space }) }); return state; }
        const why = await probe(version);
        // a later version at the probe: there is no edit to keep yet and no Reload in the popup, so it says to tap the shape again
        if (why) {
          const r = String(why.code) === "40001" ? { ...refusal(why, { space }), reload: false, close: true, text: "This shape changed after the map was drawn: close this and tap the shape again." }
            : refusal(why, { space });
          set({ status: "refused", refusal: r, version }); return state;
        }
        const got = await readShape();
        if (!got) { set({ status: "failed", error: "This shape has too many neighbours in its layer to read it whole here, so it can't be edited here yet." }); return state; }
        if (B.shapeOf(got.feature.geometry).length === 0) { set({ status: "failed", error: "This shape isn't an area, so it can't be reshaped here." }); return state; }
        if (corners(B.shapeOf(got.feature.geometry)) > MAX_CORNERS) { set({ status: "refused", refusal: refusal({ code: "54000" }) }); return state; }
        set({ version, feature: got.feature, neighbours: got.neighbours });
        const snaps = await readSnaps(got.feature.geometry);
        return set({ status: "editing", snaps, kinds: snaps.map((s) => s.kind) });
      } catch (e) {
        if (e?.code && /^(42501|0A000|P0002|55000)$/.test(String(e.code))) return set({ status: "refused", refusal: refusal(e, { space }) });
        return fail(e);
      }
    }
    // Save: the shape as a new version, made from the version opened. A refusal keeps the edit on screen (a later version
    // offers Reload, which drops it); success keeps what Undo the save needs.
    async function save(geometry) {
      if (state.status !== "editing" || !geometry) return state;
      set({ status: "saving", refusal: null });
      const args = { layer: layer.id, feature: Number(id), shape: geometry, base_version: state.version };
      try {
        writes.push({ rpc: "feature_edit_shape", args });
        const r = await call("feature_edit_shape", args);
        if (r?.unchanged) { writes.pop(); return set({ status: "editing", refusal: { code: "unchanged", text: "Nothing has changed since the shape was saved.", reload: false, close: false } }); }
        return set({ status: "saved", version: Number(r.version), saved: r, feature: { ...state.feature, geometry: r.geometry || geometry } });
      } catch (e) {
        writes.pop();
        const r = refusal(e, { space });
        return set({ status: r.reload ? "stale" : r.close ? "refused" : "editing", refusal: r });
      }
    }
    // Undo the save: the version it replaced, restored as a new version (its row id read from the feature's kept versions).
    async function undoSave() {
      if (state.status !== "saved" || !state.saved) return state;
      const before = Number(state.saved.previous_version);
      set({ status: "saving", refusal: null });
      try {
        const r = await sb.from("map_feature_versions").select("id,version_no,superseded_at").eq("feature_id", Number(id)).eq("version_no", before).order("superseded_at", { ascending: false }).limit(1);
        if (r?.error) throw r.error;
        const row = list(r?.data)[0];
        if (!row) throw Object.assign(new Error("No such earlier version of this feature"), { code: "P0002" });
        const args = { layer: layer.id, feature: Number(id), version_id: Number(row.id), base_version: state.version };
        writes.push({ rpc: "feature_restore_version", args });
        const out = await call("feature_restore_version", args);
        return set({ status: "restored", version: Number(out.version), saved: out, feature: { ...state.feature, geometry: out.geometry || state.feature.geometry } });
      } catch (e) {
        if (writes.at(-1)?.rpc === "feature_restore_version") writes.pop();
        const r = refusal(e, { space });
        return set({ status: r.reload ? "stale" : "saved", refusal: { ...r, text: r.reload ? r.text : "The save wasn't undone: " + r.text } });
      }
    }
    // After a save or an undo: carry on editing from the version now saved.
    function keepEditing() { if (["saved", "restored"].includes(state.status)) set({ status: "editing", saved: null, refusal: null }); return state; }
    return { get state() { return state; }, writes, open, save, undoSave, keepEditing, reload: open };
  }

  return { SNAP_PX, MAX_CORNERS, HISTORY, READ_MAX, PHONE_MAX, PARCELS, WHY, isPhone, editsSpace, offer, pickTarget, refusal, corners, createEditor,
    snapIndex, snap, snapLine, linesOf, bboxOf, pad, createSession };
});
