// CAP1: the add menu on a phone, the pure parts. Tapping the round + on a phone opens a short stack of options rising straight up
// from it, in reach of the thumb: the Add registry's actions this person may use here (add.js available(ctx), never a second list),
// in the person's own order, the first nearest the +; at most five, and when there are more (or some are turned off) the top one is
// "More" (the full Add list, where "Choose what's in the add menu" also is). The choice is kept per person on this device
// (localStorage, never the database). This file decides what the menu holds and where each option sits; capture-ring.js draws it.
// (The owner, 13 Nov 2026, on the first version's fan of options: "buttons randomly placed". So: one straight, even column.)
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.FP = root.FP || {}; root.FP.captureRingModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const MAX = 5;                         // actions in the stack at most (More takes the top place when there are more)
  // A round option is a 44 px target; options sit STEP apart, straight up from the +'s centre (the first one STEP above it); each one's
  // words are a quiet pill to its LEFT, right-aligned in one column (at most LABEL_W wide, cut short with an ellipsis beyond).
  const SIZE = 44, STEP = 56, LABEL_W = 180, LABEL_H = 28, GAP = 10;

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
    return [...order, ...rest].map((id) => ({ action: byId.get(id), on: !off.has(id) }));
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
    if (i < 0 || j < 0 || j >= all.length) return toPrefs(all);
    [all[i], all[j]] = [all[j], all[i]];
    return toPrefs(all);
  }
  function toggle(available, prefs, id, on) { return toPrefs(arrange(available, prefs).map((x) => (x.action.id === id ? { ...x, on: !!on } : x))); }
  const toPrefs = (all) => ({ order: all.map((x) => x.action.id), off: all.filter((x) => !x.on).map((x) => x.action.id) });

  // ---- where each option sits -----------------------------------------------------------------------------------------------------
  // Positions of n options (n <= MAX + 1: the actions and More) about the +'s centre, in px: straight up, evenly spaced, the first
  // nearest the + (dx 0: every option's centre on the +'s centre line).
  const layout = (n) => Array.from({ length: Math.max(0, Math.min(n, MAX + 1)) }, (_, i) => ({ dx: 0, dy: -STEP * (i + 1) }));
  // Whether a layout fits a phone: every option and its words inside the window with a margin and above the tab bar's top
  // (`floor`), and no two options touching. plus: the +'s centre in window px. (Where it can't fit, the full list opens instead.)
  function fits(positions, { width, plus, floor, margin = 8 }) {
    const R = SIZE / 2;
    const items = positions.map((p) => ({ x: plus.x + p.dx, y: plus.y + p.dy }));
    for (const [i, a] of items.entries()) {
      if (a.x + R > width - margin || a.x - R - GAP - LABEL_W < margin || a.y - Math.max(R, LABEL_H / 2) < margin || a.y + R > floor) return false;
      if (Math.abs(a.y - plus.y) < SIZE + 4) return false;
      for (const b of items.slice(i + 1)) if (Math.abs(a.y - b.y) < SIZE + 4 && Math.abs(a.x - b.x) < SIZE + 4) return false;
    }
    return true;
  }

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

  return { MAX, SIZE, STEP, LABEL_W, LABEL_H, GAP, KEY, readPrefs, writePrefs, clearPrefs, arrange, ring, move, toggle, toPrefs, layout, fits, step };
});
