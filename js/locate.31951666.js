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
  // PH2: which phone, so a refusal says where that phone turns location on (phone-model locationHelp)
  const platform = () => P().platformOf(root.navigator?.userAgent, root.navigator?.maxTouchPoints);
  const problemOf = (code) => P().locateProblem(code, platform(), root.navigator?.userAgent || "");
  // PH2 (the owner's iPhone refused a photo with location on): the browser is asked at once, in the same task as the call, so a call
  // from a tap is the tap's own request (Safari prompts for, and may only honour, a request that comes straight from a tap; nothing
  // is awaited first, not even the permission's state). A first fix can take a while indoors: up to LOCATE_WAIT (20 s). An iPhone
  // that answers "unavailable" (no fix yet) is asked once more without high accuracy, within the same wait.
  function get({ maxAge = 15000, timeout = P().LOCATE_WAIT } = {}) {
    if (!geo()) return Promise.resolve({ ok: false, problem: problemOf("off") });
    if (lastFix && P().fresh(lastFix, Date.now(), maxAge)) return Promise.resolve({ ok: true, fix: lastFix });
    if (asking) return asking;
    const until = Date.now() + timeout;
    asking = new Promise((resolve) => {
      const ask = (high) => {
        try {
          geo().getCurrentPosition((pos) => { const f = take(pos); if (f) known = known === "denied" ? "granted" : known; resolve(f ? { ok: true, fix: f } : { ok: false, problem: problemOf(2) }); },
            (err) => {
              if (err?.code === 1) { refused(); known = "denied"; }
              else if (err?.code === 2 && high && until - Date.now() > 1500) { ask(false); return; }
              resolve({ ok: false, problem: problemOf(err?.code) });
            }, { enableHighAccuracy: high, timeout: Math.max(1000, until - Date.now()), maximumAge: maxAge });
        } catch { resolve({ ok: false, problem: problemOf(2) }); }
      };
      ask(true);
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
  FP.locate = { last: () => lastFix, get, permission, permissionNow: () => (geo() ? known : "denied"), warm, watch, forget: () => { lastFix = null; }, platform };
})(window);
