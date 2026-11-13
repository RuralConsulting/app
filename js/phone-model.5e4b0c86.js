// PH1: the phone flow, the pure parts. On a phone a group opens on a plain map of its area (phone-area.js) with one control that
// finds where the person is (locate.js), a short list of what is near them, nearest first, and the + (capture-ring.js) whose first
// row takes a photo (capture-photo.js quick). A photo needs the phone's position (the owner, 13 Nov 2026: "Prerequisite is that gps
// for photos must be turned on"). This file decides the words, the nearby list and whether the camera may open; it reads nothing
// and draws nothing.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./capture-model.js") : null, root);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.phoneModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (captureModel, root) {
  const C = () => captureModel || root.FP.captureModel;
  const PHONE = "(max-width: 800px)";   // the app's own phone width (add.js, ui.css)
  // The nearby list: at most NEARBY rows shown; the sites read at most READ_CAP (group_wq_sites is the group's sites within 5 km of
  // its area, under the read's own rules; the cap only bounds a very large group)
  const NEARBY = 8, READ_CAP = 500;
  // A position this old or newer opens the camera at once; an older one is asked for again first (ms)
  const PHOTO_FIX_AGE = 2 * 60 * 1000;
  // PH2: how long a request for the position waits. A first fix indoors, or after the phone has been asleep, can take well over the
  // browser's usual few seconds on an iPhone; the screen says "Finding your position…" meanwhile.
  const LOCATE_WAIT = 20000;

  // ---- where the person is ---------------------------------------------------------------------------------------------------------
  // A fix as the app keeps it: { lat, lon, accuracy, at } from a GeolocationPosition, or null when it is not a real place.
  function fix(p, now = Date.now()) {
    const c = p?.coords || p;
    const lat = Number(c?.latitude ?? c?.lat), lon = Number(c?.longitude ?? c?.lon), acc = Number(c?.accuracy);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
    const at = Number.isFinite(p?.timestamp) ? p.timestamp : Number.isFinite(p?.at) ? p.at : now;
    return { lat, lon, accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null, at };
  }
  const fresh = (f, now = Date.now(), age = PHOTO_FIX_AGE) => !!f && now - f.at <= age && now - f.at >= -60000;

  // PH2: which phone, for where its settings are: "ios" (an iPhone or iPad, whichever browser: every one of them asks iOS),
  // "android", or "other" (a computer, or a phone we can't tell). From the browser's user agent and touch points.
  function platformOf(ua = "", touchPoints = 0) {
    const s = String(ua || "");
    if (/iPhone|iPad|iPod/i.test(s) || (/Macintosh/i.test(s) && Number(touchPoints) > 1)) return "ios";
    if (/Android/i.test(s)) return "android";
    return "other";
  }
  // The browser's own name in iOS's Location Services list ("Safari Websites" for Safari; Chrome and Firefox are listed as apps)
  // An Android phone's browser by name, or null when its user agent doesn't say plainly (most others claim "Chrome" too, so they are
  // tested first)
  const androidBrowser = (ua = "") => (/SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /EdgA\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera" : /DuckDuckGo/.test(ua) ? "DuckDuckGo" : /; wv\)/.test(ua) ? null : /Chrome\//.test(ua) ? "Chrome" : null);
  const iosBrowser = (ua = "") => (/CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /EdgiOS/.test(ua) ? "Edge" : "Safari Websites");
  // Where to turn location on, step by step, for this phone (the owner's iPhone said only "your browser or phone settings"): an
  // iPhone needs Location Services on for Safari Websites (or the browser) and the site allowed in Safari's page menu; an Android
  // phone needs Location on and the site allowed in Chrome. A site refused once is not asked again until the page is reloaded.
  function locationHelp(platform = "other", ua = "") {
    if (platform === "ios") {
      const app = iosBrowser(ua), safari = app === "Safari Websites";
      // (an iPhone with Location Services, or Safari Websites, set to Never answers "refused" at once and never asks: the first step)
      // (the three choices on that screen are exactly "Never", "Ask Next Time or When I Share" and "While Using the App"; Never refuses
      // at once without asking, as on the owner's iPhone, 13 Nov 2026)
      return safari ? [
        "Open Settings › Privacy & Security › Location Services › Safari Websites.",
        "Choose “While Using the App” or “Ask Next Time or When I Share”.",
        "Come back here and tap Try again.",
        "Still refused? In Safari tap aA (or the page menu) beside the address › Website Settings › Location › Allow.",
      ] : [
        "Open Settings › Privacy & Security › Location Services › " + app + ".",
        "Choose “While Using the App” or “Ask Next Time or When I Share”.",
        "Come back here and tap Try again.",
      ];
    }
    if (platform === "android") {
      // review of #538, 8: the browser is named only when its user agent says which it is
      const b = androidBrowser(ua);
      return [
        "Open Settings › Location and turn it on.",
        b === "Chrome" ? "In Chrome, tap the icon left of the address › Permissions › Location › Allow."
          : b ? "In " + b + ", open this site's settings (the icon beside the address) › Location › Allow."
            : "In your browser's site settings for this page, allow Location.",
        "Come back here and tap Try again.",
      ];
    }
    return ["Allow location for this site in your browser (the icon beside the address), and check location is on for the device.", "Come back here and tap Try again."];
  }

  // Why the phone gave no position, from the browser's error code (1 refused, 2 unavailable, 3 too slow) or "off" (no location at
  // all in this browser) or "denied" (the permission is known to be refused before asking): { key, text, how }.
  function locateProblem(code, platform = "other", ua = "") {
    if (code === 1 || code === "denied") return { key: "refused", text: "Location is turned off for this app.", how: locationHelp(platform, ua).join(" "), help: locationHelp(platform, ua) };
    if (code === "off") return { key: "off", text: "This browser can't share where you are.", how: "Open the app in your phone's own browser to use location." };
    if (code === 3) return { key: "slow", text: "Finding where you are is taking too long.", how: "Step into the open if you can, then try again." };
    return { key: "unavailable", text: "This phone couldn't find where you are just now.", how: "Check location is on in the phone's settings, then try again." };
  }
  // The one sentence a photo gives when there is no position (the owner: GPS on is the prerequisite for photos); the steps that
  // follow it are locationHelp's, for this phone
  const PHOTO_NEEDS_LOCATION = "Photos need location turned on, and this phone isn't sharing it with the app just now.";
  // Whether the camera may open now: "go" (a fresh position, location not refused since), "ask" (ask the phone first: a tap always
  // asks, even where the browser last said "denied", since only asking lets an iPhone that has been put right answer, and the
  // browser's own answer decides), "refused" (no location at all in this browser: say so and do not open the camera).
  function photoGate({ permission = "prompt", last = null, now = Date.now(), supported = true } = {}) {
    if (!supported) return "refused";
    if (permission === "denied") return "ask";
    return fresh(last, now) ? "go" : "ask";
  }
  // The fix a photo may carry: one taken no more than PHOTO_FIX_AGE before (or a minute after) the moment that matters (the shot, or
  // Save), else null. A held position never stands in for a phone whose location has since gone (review of #535, 1).
  function fixForShot(f, at, age = PHOTO_FIX_AGE) {
    const t = typeof at === "string" ? Date.parse(at) : Number(at);
    if (!f || !Number.isFinite(t) || !Number.isFinite(f.at)) return null;
    return t - f.at <= age && f.at - t <= 60000 ? f : null;
  }
  // The sentence a photo gives when there is no position, true to why (review of #535, 5): refused or no location in this browser is
  // "Photos need location turned on..."; slow or unavailable says so, as location is on.
  function photoProblem(problem, platform = "other", ua = "") {
    const key = problem?.key || "refused";
    if (key === "off") return { key, text: "Photos need where you are, and this browser can't share it.", help: ["Open the app in your phone's own browser (Safari on an iPhone, Chrome on Android), then try again."] };
    if (key === "refused") return { key, text: PHOTO_NEEDS_LOCATION, help: locationHelp(platform, ua) };
    if (key === "slow") return { key, text: "Photos need where you are, and this phone is taking too long to find it. Step into the open if you can, then try again." };
    return { key, text: "Photos need where you are, and this phone couldn't find it just now. Check location is on in the phone's settings, then try again." };
  }
  // "Within 12 m": how sure the position is, as a person reads it
  const accuracyWords = (m) => (Number.isFinite(m) ? "within " + (m < 1000 ? Math.max(1, Math.round(m)) + " m" : (m / 1000).toFixed(1) + " km") : "");

  // ---- what is nearby -------------------------------------------------------------------------------------------------------------
  // group_wq_sites' rows as the list reads them: { id, name, lngLat, last } (a row with no readable place is left out).
  function sitesFrom(rows, siteLngLat) {
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const lngLat = siteLngLat?.(r.geom) || null;
      if (r?.site_id == null || !lngLat) continue;
      out.push({ id: r.site_id, name: r.name || r.external_id || "Site " + r.site_id, lngLat, last: r.last_sampled || null });
    }
    return out;
  }
  // The sites nearest `from` ({ lat, lon }), nearest first, at most `cap`, each with its distance in words: [{ id, name, km, words }].
  // (capture-model.js nearest: the same distance the water sample screen uses)
  function nearby(sites, from, cap = NEARBY) {
    if (!from) return [];
    const byId = new Map((sites || []).map((s) => [s.id, s]));
    return C().nearest((sites || []).map((s) => ({ site_id: s.id, name: s.name, lngLat: s.lngLat })), { latitude: from.lat, longitude: from.lon }, cap)
      .map((n) => ({ ...byId.get(n.site_id), id: n.site_id, name: n.name, km: n.km, words: C().kmWords(n.km) }));
  }
  // The line above the list: where the distances are measured from. Before the person is located the list is the area's sites near
  // the middle of the map; PH2 (the owner: "Nearest to the middle of the map" read oddly) the line then only says how to sort it by
  // distance from you, quietly, with the Locate icon between its two parts (LOCATE_HINT).
  function nearbyLine({ located, fix: f, count }) {
    if (!count) return null;
    if (located && f) return "Nearest to you" + (f.accuracy != null ? " (" + accuracyWords(f.accuracy) + ")" : "");
    return null;
  }
  const LOCATE_HINT = ["Tap", "to sort by distance from you"];

  // PH2: a name as a person reads it. Environment Canterbury's site names come in capitals ("STOCK RACE,SH72/TRAMWAY RD"): shown in
  // sentence case, with a space after a comma, and any word with a digit in it (SH72, OAL0010) kept as it is. A name with any
  // small letter, or too short to be shouting (SH72), is shown as stored. Display only: the stored name never changes.
  function displayName(name) {
    const s = String(name ?? "");
    if (/[a-zāēīōū]/.test(s) || (s.match(/[A-ZĀĒĪŌŪ]/g) || []).length < 4) return s;
    const words = s.replace(/,(?=\S)/g, ", ").toLowerCase().split(/(\s+|[/(),-])/);
    let first = true;
    return words.map((w) => {
      if (/\d/.test(w)) { first = false; return w.toUpperCase(); }
      if (first && /[a-zāēīōū]/.test(w)) { first = false; return w[0].toUpperCase() + w.slice(1); }
      return w;
    }).join("");
  }

  // ---- the group's outline ------------------------------------------------------------------------------------------------------
  // PH2 (the owner: "show the group first, not group and sub-groups at once"): a group's area is often several areas side by side
  // (MCCC's sub-groups' catchments), and drawing each one's edge makes a tangle of shared borders. This is the outer edge of all of
  // them together, as lines: one area's own rings as they are; several are put on a grid (about `cells` across the whole), joined,
  // small gaps between neighbours closed, and the edge of the joined shape traced and simplified. Good to a cell (a few tens of
  // metres on a large group), which is what a line on a phone's overview needs. Returns a GeoJSON MultiLineString or null.
  const polygonsOf = (g) => (g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : g?.type === "Feature" ? polygonsOf(g.geometry) : []);
  function outerOutline(geom, { cells = 640, close = 1 } = {}) {
    let polys = polygonsOf(geom).filter((p) => Array.isArray(p) && Array.isArray(p[0]) && p[0].length >= 4);
    if (!polys.length) return null;
    if (polys.length === 1) return { type: "MultiLineString", coordinates: polys[0].map((r) => r.slice()) };
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of polys) for (const [x, y] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    const k = Math.cos((((s + n) / 2) * Math.PI) / 180) || 1;   // cells about square on the ground
    const size = Math.max((e - w) * k, n - s) / cells || 1e-9, pad = close + 2;
    const W = Math.ceil(((e - w) * k) / size) + 2 * pad, H = Math.ceil((n - s) / size) + 2 * pad;
    const gx = (x) => ((x - w) * k) / size + pad, gy = (y) => (n - y) / size + pad;   // grid units; rows go down
    // review of #538, 9: each ring simplified to a third of a cell first (detail finer than the grid only costs time)
    polys = polys.map((p) => p.map((ring) => { const g = simplifyLine(ring.map((c) => [gx(c[0]), gy(c[1])]), 0.33); return g.length >= 4 ? g : ring.map((c) => [gx(c[0]), gy(c[1])]); }));
    const gxy = (c) => c;   // (rings are in grid units from here)
    let grid = new Uint8Array(W * H);
    // fill each polygon (even-odd, holes kept) at the cells' centres, row by row
    for (const p of polys) {
      const edges = [];
      for (const ring of p) for (let i = 0; i + 1 < ring.length; i++) { const a = gxy(ring[i]), b = gxy(ring[i + 1]); edges.push([a[0], a[1], b[0], b[1]]); }
      for (let row = 0; row < H; row++) {
        const yc = row + 0.5, xs = [];
        for (const [x1, y1, x2, y2] of edges) if ((y1 <= yc) !== (y2 <= yc)) xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) for (let c = Math.max(0, Math.ceil(xs[i] - 0.5)); c < Math.min(W, Math.ceil(xs[i + 1] - 0.5)); c++) grid[row * W + c] = 1;
      }
    }
    // close the gaps between neighbours' edges (each simplified on its own): grow by `close` cells, then shrink back
    const grow = (g, v) => { const o = new Uint8Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      let hit = false;
      for (let dr = -close; dr <= close && !hit; dr++) for (let dc = -close; dc <= close && !hit; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < H && cc >= 0 && cc < W && g[rr * W + cc] === v) hit = true; }
      o[r * W + c] = hit ? v : 1 - v;
    } return o; };
    if (close > 0) grid = grow(grow(grid, 1), 0);
    // trace the edge between filled and empty cells (marching squares on the cells' centres), as closed rings
    const at = (r, c) => (r >= 0 && r < H && c >= 0 && c < W ? grid[r * W + c] : 0);
    const next = new Map(), key = (x, y) => x * 2 + "," + y * 2;
    const seg = (a, b) => { const ka = key(...a); (next.get(ka) || next.set(ka, []).get(ka)).push(b); };
    for (let r = -1; r < H; r++) for (let c = -1; c < W; c++) {
      const tl = at(r, c), tr = at(r, c + 1), br = at(r + 1, c + 1), bl = at(r + 1, c), idx = tl * 8 + tr * 4 + br * 2 + bl;
      if (idx === 0 || idx === 15) continue;
      const T = [c + 1, r + 0.5], R = [c + 1.5, r + 1], B = [c + 1, r + 1.5], L = [c + 0.5, r + 1];   // cell centres sit at +0.5
      const S = { 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[R, T]], 5: [[L, T], [R, B]], 6: [[B, T]], 7: [[L, T]], 8: [[T, L]], 9: [[T, B]], 10: [[T, R], [B, L]], 11: [[T, R]], 12: [[R, L]], 13: [[R, B]], 14: [[B, L]] }[idx];
      for (const [a, b] of S) seg(a, b);
    }
    const back = ([x, y]) => [Math.round((w + ((x - pad) * size) / k) * 1e6) / 1e6, Math.round((n - (y - pad) * size) * 1e6) / 1e6];
    const lines = [];
    for (const [start, outs] of next) {
      while (outs.length) {
        const ring = [];
        let p = outs.pop(), from = start;
        ring.push(from.split(",").map((v) => Number(v) / 2));
        for (let guard = 0; p && guard < 1e6; guard++) {
          ring.push(p);
          const kp = key(...p);
          if (kp === start) break;
          const o = next.get(kp);
          p = o && o.length ? o.pop() : null;
        }
        if (ring.length >= 4) lines.push(simplifyLine(ring, 0.6).map(back));
      }
    }
    return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
  }
  // review of #538, 9: the outline is worked out once per group and area and kept, in memory and (when given a store, the phone's
  // localStorage) by a hash of the area itself, so a changed area is worked out again. outlineHeld says whether it is kept already.
  const OUTLINE_VERSION = 1, kept = new Map();
  function areaHash(geom) {
    let h = 2166136261;
    const s = JSON.stringify(geom?.coordinates ?? null);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36) + "-" + s.length.toString(36);
  }
  const outlineKey = (geom, key) => "fp-outline-" + OUTLINE_VERSION + "-" + String(key || "") + "-" + areaHash(geom);
  function outlineHeld(geom, { store = null, key = "" } = {}) {
    const k = outlineKey(geom, key);
    if (kept.has(k)) return true;
    try { return !!store?.getItem(k); } catch { return false; }
  }
  function outlineFor(geom, { store = null, key = "" } = {}) {
    const k = outlineKey(geom, key);
    if (kept.has(k)) return kept.get(k);
    try { const v = store?.getItem(k); if (v) { const g = JSON.parse(v); kept.set(k, g); return g; } } catch { /* not kept */ }
    const g = outerOutline(geom);
    kept.set(k, g);
    try {
      if (store && g) {
        // one kept outline per group: an older one for the same group is taken away
        const prefix = "fp-outline-" + OUTLINE_VERSION + "-" + String(key || "") + "-";
        for (let i = store.length - 1; i >= 0; i--) { const n = store.key(i); if (n && n.startsWith("fp-outline-") && n.startsWith(prefix) && n !== k) store.removeItem(n); }
        store.setItem(k, JSON.stringify(g));
      }
    } catch { /* full or private: kept in memory only */ }
    return g;
  }
  // PH2: where a sub-group's name goes: inside its largest part, at the middle of the widest stretch across it through its centre
  // (a bay or a bend would put a plain centre outside). [lng, lat] or null.
  function labelPoint(geom) {
    const polys = polygonsOf(geom).filter((p) => Array.isArray(p?.[0]) && p[0].length >= 4);
    if (!polys.length) return null;
    const area = (r) => { let s = 0; for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s / 2); };
    const big = polys.reduce((a, b) => (area(b[0]) > area(a[0]) ? b : a));
    const ys = big[0].map((c) => c[1]), y = (Math.min(...ys) + Math.max(...ys)) / 2, xs = [];
    for (const ring of big) for (let i = 0; i + 1 < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]; if ((y1 <= y) !== (y2 <= y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)); }
    xs.sort((a, b) => a - b);
    let best = null;
    for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
    return best ? [(best[0] + best[1]) / 2, y] : null;
  }
  // PH2: which names to show: in order (the larger sub-groups first), each unless it would touch one already kept, sit on a control
  // (`blockers`) or run off the map (`view`, { width, height }). Boxes { l, t, r, b } in the map's pixels. A Set of the indexes kept.
  function keepLabels(boxes, blockers = [], view = null, gap = 4) {
    const hit = (a, b) => a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap;
    const kept = new Set(), placed = [];
    (boxes || []).forEach((b, i) => {
      if (!b) return;
      if (view && (b.l < 2 || b.t < 2 || b.r > view.width - 2 || b.b > view.height - 2)) return;
      if (blockers.some((x) => hit(b, x)) || placed.some((x) => hit(b, x))) return;
      kept.add(i); placed.push(b);
    });
    return kept;
  }
  // Douglas-Peucker on a line of [x, y] (grid units), keeping its ends
  function simplifyLine(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let far = -1, at = -1;
      const [x1, y1] = pts[a], [x2, y2] = pts[b], len = Math.hypot(x2 - x1, y2 - y1);
      for (let i = a + 1; i < b; i++) {
        const d = len ? Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / len : Math.hypot(pts[i][0] - x1, pts[i][1] - y1);
        if (d > far) { far = d; at = i; }
      }
      if (far > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  const NO_SITES = "No water quality sites near this group.";
  const SITES_FAILED = "Couldn't load nearby sites just now.";

  // ---- the + list ---------------------------------------------------------------------------------------------------------------
  // The add menu's options as rows, top to bottom: Take a photo first (the primary one), then the rest in order, then More. Rows are
  // grouped so a hairline sits between groups: [[photo], [others...], [more]] (empty groups left out).
  const PRIMARY = "photo";
  function rows(slots) {
    const list = Array.isArray(slots) ? slots : [];
    const first = list.filter((s) => s.kind === "action" && s.action?.id === PRIMARY);
    const rest = list.filter((s) => s.kind === "action" && s.action?.id !== PRIMARY), more = list.filter((s) => s.kind === "more");
    return [first, rest, more].filter((g) => g.length);
  }
  // The words on a row: the action's verb ("Take a photo") where it has one, else its label
  const rowWords = (a) => (a ? a.verb || a.label : "More");

  // ---- the tag step ----------------------------------------------------------------------------------------------------------------
  // The tags offered after the shot, in one line: CAP1's chips (the group's own tags, this phone's recent ones, then CAP1's suggested
  // set), at most `max`.
  const QUICK_TAGS = 6;
  const quickTags = (chips, max = QUICK_TAGS) => C().tidyTags(chips).slice(0, max);

  return { PHONE, NEARBY, READ_CAP, PHOTO_FIX_AGE, LOCATE_WAIT, PRIMARY, QUICK_TAGS, PHOTO_NEEDS_LOCATION, NO_SITES, SITES_FAILED, LOCATE_HINT,
    fix, fresh, fixForShot, photoProblem, locateProblem, locationHelp, platformOf, photoGate, accuracyWords, sitesFrom, nearby, nearbyLine,
    displayName, outerOutline, outlineFor, outlineHeld, labelPoint, keepLabels, rows, rowWords, quickTags };
});
