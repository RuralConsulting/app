// CAP1: the add menu on a phone, the pure parts. Tapping the round + on a phone opens a short stack of options rising straight up
// from it, in reach of the thumb: the Add registry's actions this person may use here (add.js available(ctx), never a second list),
// in the person's own order, the first nearest the +; at most five, and when there are more (or some are turned off) the top one is
// "More" (the full Add list, where "Choose what's in the add menu" also is). The choice is kept per person on this device
// (localStorage, never the database). This file decides what the menu holds and where each option sits; capture-ring.js draws it.
// (The owner, 13 Nov 2026, on the first version's fan of options: "buttons randomly placed". So: one straight, even column.)
// PH1 (the owner, 13 Nov 2026: plain rows, "rather than every button being bounded"): the menu is a list rising from the +, one thin
// outline around the set, plain rows of words with a small leading icon, a hairline between groups; "Take a photo" is always first.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.FP = root.FP || {}; root.FP.captureRingModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const MAX = 5;                         // actions in the stack at most (More takes the top place when there are more)
  // PH1: each option is a row ROW px high (a 44 px target), in a list LIST_W wide (narrower on a small window), PAD above and below
  // the rows inside its outline, a hairline (SEP px with its space) between groups; the list's foot sits GAP above the +.
  const ROW = 44, PAD = 6, SEP = 9, LIST_W = 280, GAP = 12, SIZE = 44;
  const PRIMARY = "photo";   // Take a photo: always the first row when the person may take one here

  // ---- what the ring holds ---------------------------------------------------------------------------------------------------------
  const KEY = "fp-ring-v1:";
  const ok = (p) => p && typeof p === "object" && Array.isArray(p.order) && Array.isArray(p.off) && p.order.every((x) => typeof x === "string") && p.off.every((x) => typeof x === "string");
  // The person's choice on this device, or null (none made, unreadable, or storage refused: private browsing). Never throws.
  function readPrefs(storage, user) {
    try { const raw = storage?.getItem(KEY + (user || "anon")); const v = raw ? JSON.parse(raw) : null; return ok(v) ? { order: v.order, off: v.off } : null; } catch { return null; }
  }
  function writePrefs(storage, user, prefs) {
    try { if (!ok(prefs)) return false; storage.setItem(KEY + (user || "anon"), JSON.stringify({ order: prefs.order, off: prefs.off })); return true; } catch { return false; }
  }
  function clearPrefs(storage, user) { try { storage.removeItem(KEY + (user || "anon")); return true; } catch { return false; } }

  // The actions available here in the person's order, each with whether it is in their ring. Without a choice, the registry's order
  // (each role's sensible default: a plain member has the capture actions; a coordinator has them first, then calls, events, files
  // and people, as the registry orders them). An action the person has not placed (new since they chose) comes after theirs, on.
  function arrange(available, prefs) {
    const list = Array.isArray(available) ? available : [];
    const byId = new Map(list.map((a) => [a.id, a]));
    const order = prefs ? prefs.order.filter((id) => byId.has(id)) : [];
    const rest = list.filter((a) => !order.includes(a.id)).map((a) => a.id);
    const off = new Set(prefs ? prefs.off : []);
    const all = [...order, ...rest];
    // PH1: the photo is always first and always on
    const pinned = all.includes(PRIMARY) ? [PRIMARY, ...all.filter((id) => id !== PRIMARY)] : all;
    return pinned.map((id) => ({ action: byId.get(id), on: id === PRIMARY || !off.has(id) }));
  }
  // The menu's options, nearest the + first: [{ kind: "action", action } ..., { kind: "more" }?]. Every action when they fit (at most
  // MAX) and none is turned off; otherwise the first MAX - 1 that are on, then More (the full list). No tool among the actions: the
  // choice of what is in the menu is in the More list and in Records' menu.
  function ring(available, prefs, max = MAX) {
    const all = arrange(available, prefs), on = all.filter((x) => x.on).map((x) => x.action);
    const fitsAll = on.length === all.length && on.length <= max;
    const out = (fitsAll ? on : on.slice(0, max - 1)).map((action) => ({ kind: "action", action }));
    if (!fitsAll) out.push({ kind: "more" });
    return out;
  }
  // The Edit list's change: move one up or down, or turn it on or off; returns the new prefs (all ids placed).
  function move(available, prefs, id, by) {
    const all = arrange(available, prefs), i = all.findIndex((x) => x.action.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= all.length || all[i].action.id === PRIMARY || all[j].action.id === PRIMARY) return toPrefs(all);
    [all[i], all[j]] = [all[j], all[i]];
    return toPrefs(all);
  }
  function toggle(available, prefs, id, on) { return toPrefs(arrange(available, prefs).map((x) => (x.action.id === id && id !== PRIMARY ? { ...x, on: !!on } : x))); }
  const toPrefs = (all) => ({ order: all.map((x) => x.action.id), off: all.filter((x) => !x.on).map((x) => x.action.id) });

  // ---- where each option sits -----------------------------------------------------------------------------------------------------
  // PH1: the rows of a list of n options in `groups` (phone-model rows: [[photo], [others], [more]]), top to bottom, as offsets from
  // the list's top-left inside its outline: every row at the same left (dx 0) and the same height, one under the next. Nothing is
  // placed on an arc or around the +.
  function layout(n, groups = null) {
    const sizes = Array.isArray(groups) ? groups.map((g) => g.length) : [Math.max(0, Math.min(n, MAX + 1))];
    const out = [];
    let y = PAD;
    sizes.forEach((k, gi) => { if (gi) y += SEP; for (let i = 0; i < k; i++) { out.push({ dx: 0, dy: y, h: ROW }); y += ROW; } });
    return out;
  }
  // The list's height for those rows (its padding included).
  const height = (rows) => (rows.length ? rows[rows.length - 1].dy + ROW + PAD : 0);
  // Where the list goes: its right edge on the +'s right edge (never past the window's margin), its foot GAP above the +'s top, and
  // its width LIST_W or the window less its margins. null when it does not fit above the + under the window's top (`top`, below the
  // header) or is too narrow for the words: the full list opens instead. plus: the +'s box in window px.
  function place(rows, { width, plus, top = 0, margin = 8 }) {
    const w = Math.min(LIST_W, width - 2 * margin), h = height(rows);
    const right = Math.min(plus.right, width - margin), bottom = plus.top - GAP;
    if (w < 200 || !rows.length || bottom - h < top + margin) return null;
    return { left: Math.round(right - w), top: Math.round(bottom - h), width: Math.round(w), height: h };
  }
  // CAP1's question, for the list: does it fit (kept as the name the add menu asks)
  const fits = (rows, opts) => !!place(rows, opts);

  // ---- moving through it with keys --------------------------------------------------------------------------------------------------
  // The option focus goes to from `at` (0-based) of n: arrows and Tab step through in order and wrap; Home and End go to the ends.
  function step(key, at, n, shift = false) {
    if (!n) return -1;
    if (key === "Home") return 0;
    if (key === "End") return n - 1;
    const back = key === "ArrowUp" || key === "ArrowLeft" || (key === "Tab" && shift), fwd = key === "ArrowDown" || key === "ArrowRight" || (key === "Tab" && !shift);
    if (!back && !fwd) return at;
    return ((at < 0 ? (back ? 0 : -1) : at) + (back ? n - 1 : 1)) % n;
  }

  return { MAX, SIZE, ROW, PAD, SEP, LIST_W, GAP, PRIMARY, KEY, height, place, readPrefs, writePrefs, clearPrefs, arrange, ring, move, toggle, toPrefs, layout, fits, step };
});
