// CO1b: keeping a map on screen when its box changes size, in a browser built on WebKit (Safari's engine).
// The review rig's WebKit stops showing a map (its WebGL canvas) once the canvas changes size after it was first drawn: the map is
// still drawn, but the screen keeps an old frame, so only the markers show, on grey. Nothing on the page brings it back (tried:
// re-inserting or re-showing the canvas, compositing hints, drawing at once, WebGL 2, losing and restoring the context); a new canvas
// made at the new size shows. So, in such a browser only, once the box has settled at a new size the page makes its map again, at the
// same place and zoom. Other browsers resize the map as usual and never rebuild.
// A page's map uses it so:
//   const keep = FP.mapKeep.watch(box, () => rebuild({ center: map.getCenter(), zoom: map.getZoom() }));   // the box holding the map
//   ... keep.made()   (after each map is made: the size it was made at)      keep.stop()   (when the page closes)
// (The Water quality page could use it the same way: watch its .wqp-mapbox, and on a call remove its map and make it again with the
// camera handed in; its layers and sites are drawn again by its own ready handler.)
// Not real Safari-tested: whether real Safari has the fault is still to be seen on a Mac or an iPad.
(function (root) {
  const FP = (root.FP = root.FP || {});
  const DELAY = 250;   // (ms: a window dragged to a new size is rebuilt once, when it stops)
  // WebKit that is not Chromium (Chromium's user agent says AppleWebKit too). `?mapkeep=rebuild` makes any browser rebuild (tests).
  function affected(nav = root.navigator, loc = root.location) {
    try { if (/[?&]mapkeep=rebuild\b/.test(String(loc?.search || ""))) return true; } catch { /* no address */ }
    const ua = String(nav?.userAgent || "");
    return /AppleWebKit\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|OPR|Android)\//.test(ua);
  }
  // box: the element whose size the map follows; rebuild(): makes the map again (only ever called in an affected browser)
  function watch(box, rebuild, { delay = DELAY, isAffected = affected } = {}) {
    if (!box || typeof rebuild !== "function" || typeof ResizeObserver === "undefined" || !isAffected()) return { made() {}, stop() {}, active: false };
    let at = null, timer = 0, stopped = false;
    const size = () => [Math.round(box.clientWidth), Math.round(box.clientHeight)];
    const ro = new ResizeObserver(() => {
      if (stopped || !at) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const now = size();
        if (stopped || !now[0] || !now[1] || (now[0] === at[0] && now[1] === at[1])) return;
        at = now;
        try { rebuild(); } catch { /* the page keeps its map as it is */ }
      }, delay);
    });
    ro.observe(box);
    return { active: true, made() { at = size(); }, stop() { stopped = true; clearTimeout(timer); ro.disconnect(); } };
  }
  FP.mapKeep = { affected, watch, DELAY };
})(typeof window === "undefined" ? globalThis : window);
