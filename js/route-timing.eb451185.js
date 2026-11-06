// TIM1 (#409, #410): how long a farm or a group took to draw, measured from when its route began loading, never from the
// page's start (which counted the sign-in screen) and never across a move to another screen. Each run keeps the steps on
// the way, in ms from the route's start: `data` (farm_map / group_map back), `style` (the map's style loaded), `outline`
// (the boundary first on screen), `drawn` (the space's own drawn point: the farm's boundary on the map, or the group's area
// and member blocks) and `idle` (the map at rest after it). One run at a time: a farm or group route that starts reading its
// map begins one (a second route to what is still loading keeps it), and leaving the screen drops it, so a figure is never
// taken across a move between screens. The last run that reached `drawn` is kept for the tab (sessionStorage) for staff on
// Operations (ops-model.js drawnLine and stepsLine). Marks go to the performance timeline too (fp-farm-route, fp-farm-data,
// ..., and the `farm-drawn` / `group-drawn` measures) for a browser's own tools. Never throws: a browser without the
// performance or storage APIs just has no figure.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.routeTiming = api; }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  const KEYS = { farm: "fp-farm-drawn", group: "fp-group-drawn" };
  const STEPS = ["data", "style", "outline", "drawn", "idle"];
  let current = null;
  const now = () => { try { return root.performance.now(); } catch { return NaN; } };
  const mark = (name) => { try { root.performance.mark(name); } catch { /* no performance API */ } };

  function save(r) {
    try {
      root.sessionStorage.setItem(KEYS[r.kind], JSON.stringify({ ms: r.steps.drawn, [r.kind]: r.id, from: "route", steps: { ...r.steps }, at: r.at }));
    } catch { /* no storage: no figure */ }
  }
  // begin("farm" | "group", id): the route has begun loading this farm's or group's map. Returns the run's handle.
  function begin(kind, id) {
    if (!KEYS[kind]) return null;
    if (current && current.kind === kind && current.id === id) return current.handle;
    const r = { kind, id, start: now(), steps: {}, at: null };
    current = r;
    mark("fp-" + kind + "-route");
    r.handle = {
      kind, id,
      // step(name, at?): a step reached, at `at` (performance.now() time) or now. Ignored once the run is dropped or
      // replaced, for a name already recorded, or for a name that isn't a step. A step before the route's start (the
      // map's style loaded on an earlier screen) counts as 0.
      step(name, at) {
        if (current !== r || !STEPS.includes(name) || r.steps[name] != null) return false;
        const t = Number.isFinite(at) ? at : now(), ms = Math.max(0, Math.round(t - r.start));
        if (!Number.isFinite(ms)) return false;
        r.steps[name] = ms;
        mark("fp-" + kind + "-" + name);
        if (name === "drawn") {
          r.at = new Date().toISOString();
          try { root.performance.measure(kind + "-drawn", "fp-" + kind + "-route", "fp-" + kind + "-drawn"); } catch { /* no measure */ }
        }
        if (r.steps.drawn != null) save(r);   // a step after drawn (idle) joins the kept figure
        if (r.steps.drawn != null && r.steps.idle != null) current = null;   // the run is complete
        return true;
      },
      live: () => current === r,
    };
    return r.handle;
  }
  // cancel(kind?): the screen was left; the run open for it (or any run) is dropped, with nothing kept from it.
  function cancel(kind) { if (current && (!kind || current.kind === kind)) current = null; }
  // The last kept figure for this tab: { ms, farm | group, from, steps, at }, or null.
  function last(kind) {
    try { const v = JSON.parse(root.sessionStorage.getItem(KEYS[kind]) || "null"); return v && Number.isFinite(v.ms) ? v : null; } catch { return null; }
  }
  return { begin, cancel, last, STEPS, KEYS, running: () => (current ? { kind: current.kind, id: current.id, steps: { ...current.steps } } : null) };
});
