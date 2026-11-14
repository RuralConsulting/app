// UI2: the calm map palette for the app's own overview maps (the home Places map and a group's or farm's Overview), after Felt:
// seven soft hues chosen only to be told apart (a softened Okabe-Ito set, safe for the common colour-vision deficiencies; never a group's brand) on a quiet background, thin crisp outlines of the same hue with a gentle translucent fill, and a
// subtle casing under each line so it still reads on the aerial. Each group keeps one hue wherever it is drawn (from its id, so the
// Places map and its Overview agree); a sub-group takes its parent's hue, lighter. The hues are tokens (--map-hue-1 … 7,
// tokens.css); the outline is the hue toned darker on a light map and lighter on a dark map or the aerial. The published maps'
// viewer (viewer.js) has its own styles and is not touched.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.mapPalette = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const HUES = 7;
  // the tokens' values, for use where there is no stylesheet (tests); the browser reads tokens.css
  const DEFAULT_HUES = ["#5f9bd8", "#3fae8c", "#b083c4", "#d6ad4f", "#6cc0e5", "#d98879", "#8f9bb3"];
  // A stable hue for a key (a group's id): FNV-1a, so the same group has the same colour on every map and every visit.
  function hueIndex(key) {
    let h = 2166136261;
    for (const ch of String(key ?? "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h % HUES;
  }
  const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const out = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  // Mixed towards white (t > 0) or black (t < 0) by |t|.
  function tone(colour, t) {
    const rgb = hex(colour);
    if (!rgb) return colour;
    return out(rgb.map((v) => (t >= 0 ? v + (255 - v) * t : v * (1 + t))));
  }
  // WCAG relative luminance and contrast, for the outlines' rule below
  const lum = (c) => { const rgb = hex(c); if (!rgb) return 1; const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // The plain light map's ground (LINZ Topolite's paper and the app's own map background) an outline must stand out from
  const LIGHT_GROUND = "#f2f2ee";
  // An outline on a light map: the hue toned darker until it reaches `min` against the ground (3:1, WCAG's non-text contrast)
  function darkEnough(c, t, min) { let out = tone(c, t); for (let k = t; contrast(out, LIGHT_GROUND) < min && k > -0.9; k -= 0.05) out = tone(c, k); return out; }
  // The look of one place. hue: its hue's colour; sub: a sub-group (a lighter fill, a thinner outline); onDark: a dark map or the
  // aerial (lighter lines). On a light map every outline reaches 3:1 against the ground; a group's own reaches 4:1.
  function look(hue, { sub = false, onDark = false } = {}) {
    const base = sub ? tone(hue, 0.3) : hue;
    return {
      fill: base, fillOpacity: sub ? 0.14 : 0.2,
      line: onDark ? tone(base, sub ? 0.45 : 0.3) : darkEnough(hue, sub ? -0.25 : -0.3, sub ? 3.05 : 4),
      lineWidth: sub ? 1.2 : 1.5,
      casing: onDark ? "rgba(0, 0, 0, 0.38)" : "rgba(255, 255, 255, 0.85)",
    };
  }
  // A farm's marker: ink on a light map, white on a dark one, with a ring of the other for contrast.
  const farmMarker = (onDark) => (onDark ? { fill: "#ffffff", ring: "#1c1c1e" } : { fill: "#2f3542", ring: "#ffffff" });
  // The hue colours from the page's tokens (falls back to the defaults outside a browser)
  function hues(css) {
    return DEFAULT_HUES.map((d, i) => { const v = css ? String(css("--map-hue-" + (i + 1)) || "").trim() : ""; return hex(v) ? v : d; });
  }
  // A member block counts as leased when its `leased` attribute says yes (yes, y, true or 1, any case; empty is not leased); only a
  // block with no `leased` attribute at all falls back to a tenure, ownership or status that mentions a lease. The map draws the
  // same rule as a MapLibre expression (blocks/map-scene.js LEASED).
  function isLeased(props) {
    const p = props || {};
    if (Object.prototype.hasOwnProperty.call(p, "leased")) return ["yes", "y", "true", "1"].includes(String(p.leased ?? "").trim().toLowerCase());
    return String(p.tenure ?? p.Tenure ?? p.ownership ?? p.status ?? "").toLowerCase().includes("lease");
  }
  // UI2b, PH5: the background a map opens on: the person's stored choice when it is one of the backgrounds this map can draw,
  // otherwise the aerial (the owner, 14 Nov 2026: "the base map loads slow and doesn't look great. Probably best to be aerial until we
  // find another solution"); the plain map stays one tap away. choices: the backgrounds this map offers (none without a LINZ key,
  // except the demo's stand-ins).
  // The owner then chose the topo as the one-tap alternative ("Topo", LINZ's Topo50 map, basemaps.js): a choice remembered from
  // before, of the plain map ("topolite", shown as "Map"), is taken as the topo.
  const LEGACY = { topolite: "topo", topographic: "topo", map: "topo" };
  function startBackground(stored, choices) {
    const c = Array.isArray(choices) ? choices : [];
    const s = LEGACY[stored] || stored;
    return c.includes(s) ? s : c.includes("aerial") || !c.length ? "aerial" : c[0];
  }

  // ---- PH5: a place's map is about that place; its sub-groups told apart by fill --------------------------------------------
  // Everything outside the place the map is about (a group, a sub-group, a farm) under black at this opacity: the place is the
  // bright part. Chosen from pictures at 25, 35, 45 and 55% on the aerial and the plain map (_claude/look-rounds/ph5/mask/): 35% at
  // first (PH5), 45% since HM1 (the owner, 14 Nov 2026).
  const MASK_OPACITY = 0.45;
  // The sub-groups' fills: seven clear hues, none a brand's, none the strong red, orange or brown the published map had, and no white
  // (it read as haze, or as the group's own unfilled area). Bold enough to read on the aerial at SUBGROUP_FILL, so no strong outline
  // is needed: a hairline of the same hue between neighbours, and the mask shows the group's outer edge.
  // (blue, amber, violet, lime, rose, sky, sand: one calm family, none neon (review of #540, round 2), chosen on the colours as drawn
  // (drawnDifference below): every pair in the set at least ΔE 27 apart in normal sight over every ground, so no two are ever
  // confusable, and each clearly apart (normal and colour-blind sight) from at least three others, which subgroupColours uses)
  const SUBGROUP_HUES = ["#1f6feb", "#ffbe0b", "#8338ec", "#8ac926", "#e0609a", "#48bfe3", "#f4a261"];
  const SUBGROUP_FILL = 0.55, SUBGROUP_FILL_PLAIN = 0.5, SUBGROUP_LINE = 0.75;
  // A sub-group's look: its fill, and a hairline of the same hue (a touch lighter on the aerial, darker on the plain map)
  function subgroupLook(hue, { onDark = true } = {}) {
    return { fill: hue, fillOpacity: onDark ? SUBGROUP_FILL : SUBGROUP_FILL_PLAIN, line: tone(hue, onDark ? 0.25 : -0.3), lineWidth: SUBGROUP_LINE, lineOpacity: 0.9 };
  }
  // ---- colour difference, as a person sees it (CIE L*a*b*, ΔE 1976), and as the common deficiencies see it ------------------------
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  function lab(c) {
    const rgb = hex(c);
    if (!rgb) return [0, 0, 0];
    const [r, g, b] = rgb.map(lin);
    const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const [fx, fy, fz] = xyz.map(f);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  // Machado, Oliveira and Fernandes (2009), severity 1: how a colour looks to a person with protanopia, deuteranopia or tritanopia
  const CVD = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  };
  function seenAs(c, kind) {
    const m = CVD[kind], rgb = hex(c);
    if (!m || !rgb) return c;
    const l = rgb.map(lin);
    return out(m.map((row) => gam(Math.max(0, Math.min(1, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])))));
  }
  const deltaE = (a, b) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  // the least difference between two colours across normal sight and the three deficiencies
  const leastDifference = (a, b) => Math.min(deltaE(a, b), ...Object.keys(CVD).map((k) => deltaE(seenAs(a, k), seenAs(b, k))));

  // Which sub-groups touch: each a list of polygons' rings ([[lng, lat], ...]); two touch where a point of one lies within `tol`
  // degrees of an edge of the other (shared borders are drawn twice, each a little differently). Pairs of indexes, i < j.
  const ringsOf = (g) => (g?.type === "Polygon" ? g.coordinates : g?.type === "MultiPolygon" ? g.coordinates.flat() : g?.type === "Feature" ? ringsOf(g.geometry) : []);
  function neighbours(geoms, { tol = null, sample = 300 } = {}) {
    const parts = geoms.map((g) => ringsOf(g).filter((r) => Array.isArray(r) && r.length >= 4));
    const boxes = parts.map((rings) => { let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const r of rings) for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); } return [w, s, e, n]; });
    const all = boxes.filter((b) => Number.isFinite(b[0]));
    const span = all.length ? Math.max(Math.max(...all.map((b) => b[2])) - Math.min(...all.map((b) => b[0])), Math.max(...all.map((b) => b[3])) - Math.min(...all.map((b) => b[1]))) : 0;
    const t = tol ?? Math.max(span * 0.004, 1e-6);
    const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let k = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; k = Math.max(0, Math.min(1, k)); return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy); };
    const pairs = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (!Number.isFinite(A[0]) || !Number.isFinite(B[0]) || A[0] > B[2] + t || B[0] > A[2] + t || A[1] > B[3] + t || B[1] > A[3] + t) continue;
      const pts = parts[i].flat(), step = Math.max(1, Math.floor(pts.length / sample));
      let hit = false;
      for (let p = 0; p < pts.length && !hit; p += step) {
        const q = pts[p];
        if (q[0] < B[0] - t || q[0] > B[2] + t || q[1] < B[1] - t || q[1] > B[3] + t) continue;
        for (const r of parts[j]) { for (let k = 0; k + 1 < r.length; k++) if (segDist(q, r[k], r[k + 1]) <= t) { hit = true; break; } if (hit) break; }
      }
      if (hit) pairs.push([i, j]);
    }
    return pairs;
  }
  // ---- the colours as drawn (review of #540, 5): a fill is seen blended over the ground under it, not as its bare colour -----------
  // Two samples of the aerial (a dark green paddock, a pale tussock hill) at SUBGROUP_FILL, and the plain map's ground at
  // SUBGROUP_FILL_PLAIN. Two fills are clearly apart when, as drawn over every one of these, they differ by ΔE 30 or more in normal
  // sight and by ΔE 20 or more for each of the three common deficiencies.
  const GROUNDS = [["#2f4a24", "aerial"], ["#a89a74", "aerial"], ["#eceee8", "plain"]];
  const CLEAR = 30, CLEAR_CVD = 20;
  const blend = (c, g, a) => { const x = hex(c), y = hex(g); return x && y ? out(x.map((v, i) => v * a + y[i] * (1 - a))) : c; };
  function drawnDifference(a, b) {
    let normal = Infinity, cvd = Infinity;
    for (const [g, kind] of GROUNDS) {
      const o = kind === "aerial" ? SUBGROUP_FILL : SUBGROUP_FILL_PLAIN, x = blend(a, g, o), y = blend(b, g, o);
      normal = Math.min(normal, deltaE(x, y)); cvd = Math.min(cvd, ...Object.keys(CVD).map((k) => deltaE(seenAs(x, k), seenAs(y, k))));
    }
    return { normal, cvd, clear: normal >= CLEAR && cvd >= CLEAR_CVD };
  }
  // A stable number for a key (a sub-group's id): FNV-1a
  const seedOf = (key) => { let h = 2166136261; for (const ch of String(key ?? "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  // The sub-groups' colours: [{ key, name, geometry }] -> Map name -> hue. key: the sub-group's id (its name where no id is known).
  // Review of #540, 7: stable. Each sub-group starts from its own hue (from its key), and keeps it unless a neighbour already
  // coloured (in key order) is not clearly apart from it as drawn; then it takes the next hue in the set that is. So a sub-group added
  // or removed can change only the colours of its own neighbours, never the whole group's. The same ids and shapes give the same
  // colours on every map (Home on a phone, the computer's overview, the Maps tab, which matches its categories to the sub-groups first).
  function subgroupColours(items, set = SUBGROUP_HUES) {
    const list = (items || []).filter((x) => x && x.name != null).map((x) => ({ key: String(x.key ?? x.name), name: String(x.name), geometry: x.geometry || null }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const touching = list.map(() => new Set());
    for (const [i, j] of neighbours(list.map((x) => x.geometry))) { touching[i].add(j); touching[j].add(i); }
    const apart = set.map((a) => set.map((b) => (a === b ? { normal: 0, cvd: 0, clear: false } : drawnDifference(a, b))));
    const orderOf = list.map((x) => { const seed = seedOf(x.key) % set.length; return set.map((_, k) => (seed + k) % set.length); });
    // review of #540, round 2: every touching pair clearly apart where the set allows it. In key order each tries its own hue first,
    // then the next ones; where a later one finds none left, the search steps back and tries an earlier one's next hue (a bounded
    // search; the first answer is the one closest to each sub-group's own hue, so the colours stay put as sub-groups come and go)
    const got = [];
    let steps = 0;
    // (where no colouring keeps every neighbour clear in colour-blind sight too, as where four meet at a corner, the colour-blind bar
    // is lowered a step at a time; normal sight never goes below the set's own floor, and touching sub-groups never share a colour)
    const BARS = [CLEAR_CVD, 15, 10, 5, 0];
    const ok = (k, n, cvdBar) => k !== n && apart[k][n].normal >= CLEAR && apart[k][n].cvd >= cvdBar;
    const go = (i, bar) => {
      if (i === list.length) return true;
      if (++steps > 50000) return false;
      const near = [...touching[i]].filter((j) => j < i).map((j) => got[j]);
      for (const k of orderOf[i]) if (near.every((n) => ok(k, n, bar))) { got[i] = k; if (go(i + 1, bar)) return true; }
      return false;
    };
    let solved = false;
    for (const bar of BARS) { steps = 0; got.length = 0; if (go(0, bar)) { solved = true; break; } }
    if (!solved) {
      // no colouring keeps every neighbour clearly apart (or too long to find): each the most apart it can be, from its own hue on
      got.length = 0;
      list.forEach((x, i) => {
        const near = [...touching[i]].filter((j) => j < i).map((j) => got[j]);
        const score = (k) => Math.min(...near.map((n) => (k === n ? -1 : Math.min(apart[k][n].normal, apart[k][n].cvd * 1.5))));
        const fit = orderOf[i].find((k) => near.every((n) => apart[k][n].clear));
        got.push(fit ?? (near.length ? orderOf[i].reduce((a, b) => (score(b) > score(a) ? b : a)) : orderOf[i][0]));
      });
    }
    const outMap = new Map();
    list.forEach((x, i) => outMap.set(x.name, set[got[i]]));
    return outMap;
  }
  // PH5: the outside of a place as one polygon set: the whole world with the place's outer edge cut out, and anything the place
  // itself leaves out (a hole) shaded too, as it is outside. outline: a MultiLineString of closed rings (phone-model.js outerOutline,
  // or a polygon's own rings); each ring is the place's edge or a hole's by how many others it sits inside. A FeatureCollection, or
  // null when there is no ring.
  const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const masks = new WeakMap();   // outline -> its mask: an outline kept by phone-model.js outlineFor is worked out once
  function outsideMask(outline) {
    if (outline && typeof outline === "object" && masks.has(outline)) return masks.get(outline);
    const m = maskOf(outline);
    if (outline && typeof outline === "object") masks.set(outline, m);
    return m;
  }
  function maskOf(outline) {
    const rings = (outline?.type === "MultiLineString" ? outline.coordinates : outline?.type === "LineString" ? [outline.coordinates] : [])
      .filter((r) => Array.isArray(r) && r.length >= 4).map((r) => (r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r : [...r, r[0]]));
    if (!rings.length) return null;
    const inside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const area = (r) => { let s = 0; for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
    const ccw = (r) => (area(r) > 0 ? r : r.slice().reverse()), cw = (r) => (area(r) < 0 ? r : r.slice().reverse());
    // a ring's depth: the rings it lies inside (tested at a point of it); its parent: the smallest of those
    const info = rings.map((r, i) => {
      const holders = rings.map((o, j) => (j !== i && Math.abs(area(o)) > Math.abs(area(r)) && inside(r[0], o) ? j : -1)).filter((j) => j >= 0);
      const parent = holders.length ? holders.reduce((a, b) => (Math.abs(area(rings[a])) < Math.abs(area(rings[b])) ? a : b)) : -1;
      return { depth: holders.length, parent };
    });
    // the shaded parts: the world less every top edge; then each hole (odd depth) less the place's rings inside it
    const polys = [[ccw(WORLD), ...rings.filter((_, i) => info[i].depth === 0).map(cw)]];
    rings.forEach((r, i) => { if (info[i].depth % 2 === 1) polys.push([ccw(r), ...rings.filter((_, j) => info[j].parent === i).map(cw)]); });
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polys } }] };
  }
  // A polygon geometry's own rings as an outline (for a place with one part, or a farm: no grid needed)
  const ringsOutline = (geom) => { const r = ringsOf(geom).filter((x) => Array.isArray(x) && x.length >= 4); return r.length ? { type: "MultiLineString", coordinates: r } : null; };
  return { HUES, DEFAULT_HUES, LIGHT_GROUND, MASK_OPACITY, SUBGROUP_HUES, SUBGROUP_FILL, SUBGROUP_FILL_PLAIN, SUBGROUP_LINE, startBackground, hueIndex, tone, look,
    subgroupLook, subgroupColours, neighbours, drawnDifference, blend, GROUNDS, outsideMask, ringsOutline, deltaE, seenAs, leastDifference, farmMarker, hues, contrast, isLeased };
});
