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
  // Each place: { id, kind: "farm" | "group" | "subgroup", name, slug, parentId, parentName, depth, within }.
  // PL2: within is the place it sits inside on the Places map, one level at a time: a sub-group's parent and a farm's own group
  // (farms.org_id) when the person sees that group, else null (a top-level place).
  function places(farms, groups, parents = {}) {
    const list = (v) => (Array.isArray(v) ? v : []);
    const seen = new Map(list(groups).map((g) => [g.id, g]));
    const parentName = (g) => (g.parent_org_id ? seen.get(g.parent_org_id)?.name || parents[g.parent_org_id] || null : null);
    const group = (g, depth) => ({ id: g.id, kind: g.parent_org_id ? "subgroup" : "group", name: g.name, slug: g.slug || null, parentId: g.parent_org_id || null, parentName: parentName(g), depth,
      within: g.parent_org_id && seen.has(g.parent_org_id) ? g.parent_org_id : null });
    const top = list(groups).filter((g) => !g.parent_org_id || !seen.has(g.parent_org_id)).sort(byName);
    const out = [], placed = new Set();
    const add = (g, depth) => {
      if (placed.has(g.id) || depth > 16) return;   // (a cycle is refused by the database; never loop on one all the same)
      placed.add(g.id); out.push(group(g, Math.min(depth, 1)));
      for (const c of list(groups).filter((x) => x.parent_org_id === g.id).sort(byName)) add(c, depth + 1);
    };
    for (const g of top) add(g, 0);
    for (const g of list(groups).filter((x) => !placed.has(x.id)).sort(byName)) add(g, 0);
    for (const f of [...list(farms)].sort(byName)) out.push({ id: f.id, kind: "farm", name: f.name, slug: null, parentId: null, parentName: null, depth: 0, within: f.org_id && seen.has(f.org_id) ? f.org_id : null });
    return out;
  }

  // ---- PL2: one level at a time ---------------------------------------------------------------------------------------------
  // Josh, 13 Nov 2026: "it should start with mccc, and then the 10 groups not both at the same time". The places drawn on the Places
  // map at one level: at = null, the top level (every place inside nothing the person sees: top-level groups, a sub-group whose parent
  // they cannot see, farms in no group of theirs); at = a group's id, the places inside it (its sub-groups and its farms).
  const level = (list, at = null) => list.filter((p) => (p.within || null) === (at || null));
  // How many places sit inside each place: id -> count (a group with none is absent).
  function inside(list) {
    const n = new Map();
    for (const p of list) if (p.within) n.set(p.within, (n.get(p.within) || 0) + 1);
    return n;
  }
  // The list ("All places"), grouped: each top-level row with the rows inside it as its `children` (a sub-group's own sub-groups
  // follow it, flattened under the top row, as the database's tree is shallow). Farms that sit inside a group stay among the farms,
  // as the list always had them. Returns [{ place, children: [place] }] in the list's own order.
  function grouped(list) {
    const rows = [], byTop = new Map(), topOf = (p) => { let q = p, guard = 0; while (q?.within && q.kind !== "farm" && guard++ < 16) q = list.find((x) => x.id === q.within) || null; return q; };
    for (const p of list) {
      const top = p.kind === "farm" ? null : topOf(p);
      if (p.kind !== "farm" && top && top.id !== p.id && byTop.has(top.id)) { byTop.get(top.id).children.push(p); continue; }
      const row = { place: p, children: [] };
      rows.push(row);
      if (p.kind !== "farm") byTop.set(p.id, row);
    }
    return rows;
  }
  // A row's one quiet line in the list: what it is, and for a group how many sub-groups it holds. A sub-group under its parent is
  // just "Sub-group" (its parent is the row above it).
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  function rowLabel(p, subs = 0) {
    if (p.kind === "farm") return "Farm";
    if (p.kind === "subgroup" && p.within) return "Sub-group";
    return kindLabel(p) + (subs ? " · " + plural(subs, "sub-group", "sub-groups") : "");
  }

  // Which marks on the map are drawn. items, in priority order (the chosen place first, then the larger places): each { box, bare }
  // (screen boxes, {x, y, w, h}): box the whole mark with its name; bare a group's round marker alone (a farm has none: its dot is
  // never drawn without its name). A mark that lies outside frame, or touches one of the `avoid` boxes (the panel, the card, the
  // map's controls) or a mark already kept, keeps its round marker alone if that fits, and is otherwise dropped until the map is
  // zoomed in. One answer per item: true (the mark and its name), "bare" (the marker alone) or false.
  function marksToShow(items, { avoid = [], frame = null, gap = 4 } = {}) {
    const hit = (a, b, g = gap) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g;
    const outside = (a) => frame && (a.x < frame.x || a.y < frame.y || a.x + a.w > frame.x + frame.w || a.y + a.h > frame.y + frame.h);
    const fits = (box) => !!box && box.w > 0 && !outside(box) && !avoid.some((b) => b && b.w > 0 && hit(box, b, 0)) && !kept.some((k) => hit(box, k));
    const kept = [];
    return items.map(({ box, bare }) => {
      if (fits(box)) { kept.push(box); return true; }
      if (fits(bare)) { kept.push(bare); return "bare"; }
      return false;
    });
  }

  // What a tap on the Places map picks (PL2). hits: what lies under the tap, each { id, on: "mark" | "line" | "fill", size } (a mark is
  // a place's name or round marker; size the area of its outline's box). A mark always wins over an outline, the first mark found
  // being the one on top; among outlines the smallest wins, so a place inside another is reachable. Returns an id or null.
  function pickHit(hits) {
    const list = (Array.isArray(hits) ? hits : []).filter((h) => h && h.id);
    const mark = list.find((h) => h.on === "mark");
    if (mark) return mark.id;
    const shapes = list.filter((h) => h.on === "fill" || h.on === "line").sort((a, b) => (Number(a.size) || 0) - (Number(b.size) || 0));
    return shapes[0]?.id ?? null;
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
  const openHref = (p) => (p.kind === "farm" ? "#/farm/" + p.id : "#/group/" + p.id) + "/home";   // J2: a place opens on its Home

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

  // ---- where a person starts (J2, J2c) ------------------------------------------------------------------------------------------
  // Josh, 13 Nov 2026: Places (the map of all places) is mainly for RCL staff; "If I'm the coordinator of MCCC I want to start
  // directly in that space". Decided from what start-up already read (main.js: the farms, the groups with the person's role and
  // parent_org_id, the staff flag), nothing else. hash: the app's own address (the demo's already turned into it).
  //   link: true            an address of its own (a place, Files, #/ops...): it wins, as the router follows it first; `to` is
  //                         only where an address the router cannot open (someone else's place, a staff page) falls back to
  //   { to: "places" }      Places: "#/places" ("All places"), or the bare address when nothing below decides
  //   { to: "none" }        no farm and no group (the plain note)
  //   { to: "farm" | "group", id }   the bare address opens this place (on its Home)
  // The rule, for the bare address (and so for sign-in):
  //   1. exactly one place: it (staff too, as J2);
  //   2. RCL staff, or the staff flag unread: Places;
  //   3. a coordinator (facilitator, advisor or admin) of one group and of nothing above it: that group. The group's sub-groups and
  //      member farms do not count; every group the person is in must sit in that group's tree (its top-level group's);
  //   4. no coordinator role anywhere, one farm, and every group is the farm's own (farms.org_id) or above it: the farm;
  //   5. anything else, or anything not loaded or unreadable (the groups, a group's parent_org_id): Places.
  const COORDINATOR = new Set(["facilitator", "advisor", "admin"]);
  const isBare = (h) => h == null || h === "" || h === "#" || h === "#/";
  function landing(hash, people = {}) {
    if (hash === "#/places") return { to: "places" };
    return isBare(hash) ? start(people) : { ...start(people), link: true };
  }
  function start({ farms, groups, staff, staffKnown }) {
    if (!Array.isArray(farms) || !Array.isArray(groups)) return { to: "places" };   // not loaded yet: never guess
    if (!farms.length && !groups.length) return { to: "none" };
    if (farms.length + groups.length === 1) return farms.length ? { to: "farm", id: farms[0].id } : { to: "group", id: groups[0].id };
    if (staff || !staffKnown) return { to: "places" };
    // every group's parent must have been read (null for a top-level group): a database without the column decides nothing
    if (!groups.length || groups.some((g) => g.parent_org_id === undefined)) return { to: "places" };
    const byId = new Map(groups.map((g) => [g.id, g]));
    // the chain above a group as far as the person's own groups show it, nearest first (the last may be a parent they are not in)
    const above = (g) => {
      const out = [];
      for (let p = g.parent_org_id; p && out.length < 16 && !out.includes(p); p = byId.get(p)?.parent_org_id) out.push(p);
      return out;
    };
    const tree = (g) => above(g).at(-1) || g.id;   // its topmost known ancestor, or itself
    const coordinated = groups.filter((g) => COORDINATOR.has(g.role));
    if (coordinated.length) {
      const ids = new Set(coordinated.map((g) => g.id));
      const roots = coordinated.filter((g) => !above(g).some((p) => ids.has(p)));   // not under another group they coordinate
      if (roots.length !== 1) return { to: "places" };
      const root = roots[0];
      return groups.every((g) => tree(g) === tree(root)) ? { to: "group", id: root.id } : { to: "places" };
    }
    if (farms.length !== 1) return { to: "places" };
    const farm = farms[0], home = farm.org_id ? byId.get(farm.org_id) : null;
    if (!home) return { to: "places" };   // which group the farm is in is not known from what was read
    const own = new Set([home.id, ...above(home)]);
    return groups.every((g) => own.has(g.id)) ? { to: "farm", id: farm.id } : { to: "places" };
  }

  return { places, level, inside, grouped, rowLabel, marksToShow, pickHit, kindLabel, search, fold, openHref, polygons, bbox, simplifyRing, lighten, joinAreas, pointZoom, centre, union, landing, MAX_POINTS, SPECK };
});
