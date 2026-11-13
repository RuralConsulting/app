// PH1: where the phone is. One place that asks the browser for the phone's position (navigator.geolocation) and keeps the last fix
// in memory for this page, so the map's "Locate me" and a photo share it, and a photo taken just after locating opens the camera at
// once. Nothing is stored or sent: a fix goes into a capture only when the person saves one. Works offline: the position comes
// from the phone, not the network. The words are phone-model.js's.
//
//   FP.locate.last()                 the last fix ({ lat, lon, accuracy, at }) or null
//   FP.locate.get({ maxAge })        Promise of { ok: true, fix } or { ok: false, problem } (phone-model locateProblem)
//   FP.locate.permission()           Promise of "granted" | "denied" | "prompt" (what the browser says, "prompt" when it won't say)
//   FP.locate.warm()                 asks for a position only if the person has already allowed it (never a prompt)
//   FP.locate.watch(fn)              fn(fix) on each new fix while watched; returns a function that stops it
(function (root) {
  const FP = root.FP;
  const P = () => FP.phoneModel;
  let lastFix = null, asking = null;
  const listeners = new Set();
  let watchId = null;
  const geo = () => root.navigator?.geolocation || null;
  const take = (pos) => { const f = P().fix(pos); if (f) { lastFix = f; for (const fn of [...listeners]) { try { fn(f); } catch { /* one listener's fault */ } } } return f; };

  // The permission as the browser last said it, kept current (a photo decides on the same tap, with no time to ask); a refusal
  // drops the held position, so it never stands in for a phone whose location has gone (review of #535, 1 and 4).
  let known = "prompt", watching = null;
  const refused = () => { lastFix = null; };
  async function permission() {
    if (!geo()) return (known = "denied");
    try {
      const s = await root.navigator.permissions?.query?.({ name: "geolocation" });
      if (s && s !== watching) { watching = s; s.addEventListener?.("change", () => { known = s.state; if (s.state === "denied") refused(); }); }
      known = s?.state || "prompt";
    } catch { known = "prompt"; }
    if (known === "denied") refused();
    return known;
  }
  permission();
  function get({ maxAge = 15000, timeout = 15000 } = {}) {
    if (!geo()) return Promise.resolve({ ok: false, problem: P().locateProblem("off") });
    if (lastFix && P().fresh(lastFix, Date.now(), maxAge)) return Promise.resolve({ ok: true, fix: lastFix });
    if (asking) return asking;
    asking = new Promise((resolve) => {
      try {
        geo().getCurrentPosition((pos) => { const f = take(pos); resolve(f ? { ok: true, fix: f } : { ok: false, problem: P().locateProblem(2) }); },
          (err) => { if (err?.code === 1) refused(); resolve({ ok: false, problem: P().locateProblem(err?.code) }); }, { enableHighAccuracy: true, timeout, maximumAge: maxAge });
      } catch { resolve({ ok: false, problem: P().locateProblem(2) }); }
    }).finally(() => { asking = null; });
    return asking;
  }
  async function warm() { if ((await permission()) === "granted") return get({ maxAge: 60000 }); return null; }
  function watch(fn) {
    listeners.add(fn);
    if (watchId == null && geo()) {
      try { watchId = geo().watchPosition((pos) => take(pos), (err) => { if (err?.code === 1) refused(); }, { enableHighAccuracy: true, maximumAge: 15000 }); } catch { watchId = null; }
    }
    return () => {
      listeners.delete(fn);
      if (!listeners.size && watchId != null) { try { geo()?.clearWatch(watchId); } catch { /* gone */ } watchId = null; }
    };
  }
  FP.locate = { last: () => lastFix, get, permission, permissionNow: () => (geo() ? known : "denied"), warm, watch, forget: () => { lastFix = null; } };
})(window);
