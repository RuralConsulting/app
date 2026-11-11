// LP1: the home page's pure parts. The places a person can see (their farms and groups, as main.js already reads them) in
// the plugin picker's order, the search over them, what each is called, and their outlines made light for a map of all of
// them (degrees from NZTM where a row comes in metres, then simplified to the outline's own size). No DOM, no reads.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./wq-model.js") : root.FP.wqModel);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.homeModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (W) {
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "en-NZ", { sensitivity: "base" }) || String(a.id).localeCompare(String(b.id));

  // The places, in the plugin's picker order: groups A–Z, each followed by its own sub-groups A–Z (indented: depth 1), then farms
  // A–Z. A sub-group whose parent the person cannot see sits among the groups by its own name. parents: id -> name, for the
  // parents the person can read (their own groups, and any other the database lets them read).
  // Each place: { id, kind: "farm" | "group" | "subgroup", name, parentId, parentName, depth }.
  function places(farms, groups, parents = {}) {
    const list = (v) => (Array.isArray(v) ? v : []);
    const seen = new Map(list(groups).map((g) => [g.id, g]));
    const parentName = (g) => (g.parent_org_id ? seen.get(g.parent_org_id)?.name || parents[g.parent_org_id] || null : null);
    const group = (g, depth) => ({ id: g.id, kind: g.parent_org_id ? "subgroup" : "group", name: g.name, parentId: g.parent_org_id || null, parentName: parentName(g), depth });
    const top = list(groups).filter((g) => !g.parent_org_id || !seen.has(g.parent_org_id)).sort(byName);
    const out = [], placed = new Set();
    const add = (g, depth) => {
      if (placed.has(g.id) || depth > 16) return;   // (a cycle is refused by the database; never loop on one all the same)
      placed.add(g.id); out.push(group(g, Math.min(depth, 1)));
      for (const c of list(groups).filter((x) => x.parent_org_id === g.id).sort(byName)) add(c, depth + 1);
    };
    for (const g of top) add(g, 0);
    for (const g of list(groups).filter((x) => !placed.has(x.id)).sort(byName)) add(g, 0);
    for (const f of [...list(farms)].sort(byName)) out.push({ id: f.id, kind: "farm", name: f.name, parentId: null, parentName: null, depth: 0 });
    return out;
  }

  // What a place is, in words: on its card, under its name in the list and in search.
  const kindLabel = (p) => (p.kind === "farm" ? "Farm" : p.kind === "subgroup" ? (p.parentName ? "Sub-group of " + p.parentName : "Sub-group") : "Catchment group");

  // The search: places whose name (or, for a sub-group, its parent's name) holds every word typed, in any case and with or
  // without macrons. Names that start with what was typed come first, then other name matches, then parent-name matches;
  // each in the list's own order. At most `max`.
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function search(list, query, max = 8) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored = [];
    list.forEach((p, i) => {
      const name = fold(p.name), parent = fold(p.parentName);
      const inName = words.every((w) => name.includes(w)), inEither = words.every((w) => name.includes(w) || parent.includes(w));
      if (!inEither) return;
      scored.push({ p, i, rank: inName ? (name.startsWith(words[0]) ? 0 : 1) : 2 });
    });
    return scored.sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, max).map((s) => s.p);
  }

  // Where a place opens: its space, at the address the router already knows (the simple view sends a client on to Maps).
  const openHref = (p) => (p.kind === "farm" ? "#/farm/" + p.id : "#/group/" + p.id);

  // ---- outlines ---------------------------------------------------------------------------------------------------------------
  // A polygon geometry as degrees: a GeoJSON object (or its text) in degrees, or in NZTM metres as a table's geometry column
  // comes back from the database. Anything but a polygon or multipolygon is null.
  function polygons(geom) {
    let g = geom;
    if (typeof g === "string") { try { g = JSON.parse(g); } catch { return null; } }
    if (!g || !Array.isArray(g.coordinates)) return null;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;
    if (!polys?.length) return null;
    const first = polys[0]?.[0]?.[0];
    if (!Array.isArray(first) || !Number.isFinite(first[0]) || !Number.isFinite(first[1])) return null;
    const metres = Math.abs(first[0]) > 180 || Math.abs(first[1]) > 90;
    return metres ? polys.map((p) => p.map((ring) => ring.map((c) => W.nztmToLngLat(c[0], c[1])))) : polys;
  }
  function bbox(polys) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of polys) for (const ring of p) for (const [x, y] of ring) { w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y); }
    return [[w, s], [e, n]];
  }
  // Douglas–Peucker on one ring (kept closed); a ring left with fewer than four points is dropped.
  function simplifyRing(ring, tol) {
    if (ring.length <= 4) return ring;
    const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
    const stack = [[0, ring.length - 1]], t2 = tol * tol;
    while (stack.length) {
      const [a, b] = stack.pop(); let far = -1, best = t2;
      const [ax, ay] = ring[a], [bx, by] = ring[b], dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = ring[i];
        let d;
        if (!len) d = (px - ax) ** 2 + (py - ay) ** 2;
        else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)); d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2; }
        if (d > best) { best = d; far = i; }
      }
      if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    // (a closed ring starts and ends on one point: the first split is at the point farthest from it)
    const out = ring.filter((_, i) => keep[i]);
    return out.length >= 4 ? out : null;
  }
  const round = (c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];   // about a metre: plenty for a map of all places
  // The outline made light for the home map: simplified at a tolerance from its own size (a 400th of its larger side, so it
  // stays tidy when it is small on screen), and again more coarsely while it has over MAX_POINTS points. Holes and parts that
  // vanish at that tolerance go; the largest part is always kept. Returns { geometry, bbox, points } or null.
  const MAX_POINTS = 600;
  function lighten(geom) {
    const polys = polygons(geom);
    if (!polys) return null;
    const box = bbox(polys), size = Math.max(box[1][0] - box[0][0], box[1][1] - box[0][1]);
    if (!(size > 0)) return null;
    let tol = size / 400, out = null, points = 0;
    for (let pass = 0; pass < 8; pass++, tol *= 2) {
      // a part whose outer ring vanishes goes with its holes
      out = polys.map((p) => { const outer = simplifyRing(p[0], tol); return outer ? [outer, ...p.slice(1).map((r) => simplifyRing(r, tol)).filter(Boolean)] : null; }).filter(Boolean);
      points = out.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0);
      if (out.length && points <= MAX_POINTS) break;
    }
    // nothing left at any tolerance (a sliver): its box stands for it
    if (!out.length) { const [[w, s], [e, n]] = box; out = [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]]; }
    const coords = out.map((p) => p.map((r) => r.map(round)));
    return { geometry: coords.length === 1 ? { type: "Polygon", coordinates: coords[0] } : { type: "MultiPolygon", coordinates: coords }, bbox: box, points };
  }
  // A group's area places (several current ones are drawn together) as one outline.
  function joinAreas(geoms) {
    const parts = geoms.map(polygons).filter(Boolean).flat();
    return parts.length ? { type: "MultiPolygon", coordinates: parts } : null;
  }

  // The zoom below which a place is drawn as a single point: where its outline's larger side would be under SPECK pixels
  // (512-pixel tiles; the north–south side stretched by Web Mercator at its latitude).
  const SPECK = 18;
  function pointZoom(box) {
    const [[w, s], [e, n]] = box, lat = ((s + n) / 2) * Math.PI / 180;
    const size = Math.max(e - w, (n - s) / Math.max(Math.cos(lat), 0.2));
    if (!(size > 0)) return 99;
    return Math.log2((SPECK * 360) / (512 * size));
  }
  const centre = (box) => [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
  const union = (boxes) => boxes.reduce((a, b) => [[Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])], [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])]]);

  return { places, kindLabel, search, fold, openHref, polygons, bbox, simplifyRing, lighten, joinAreas, pointZoom, centre, union, MAX_POINTS, SPECK };
});
