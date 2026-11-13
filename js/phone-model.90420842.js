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

  // Why the phone gave no position, from the browser's error code (1 refused, 2 unavailable, 3 too slow) or "off" (no location at
  // all in this browser) or "denied" (the permission is known to be refused before asking): { key, text, how }.
  function locateProblem(code) {
    if (code === 1 || code === "denied") return { key: "refused", text: "Location is turned off for this app.",
      how: "Turn it on in your browser's settings for this site (or in the phone's settings, under Location), then try again." };
    if (code === "off") return { key: "off", text: "This browser can't share where you are.", how: "Open the app in your phone's own browser to use location." };
    if (code === 3) return { key: "slow", text: "Finding where you are is taking too long.", how: "Step into the open if you can, then try again." };
    return { key: "unavailable", text: "This phone couldn't find where you are just now.", how: "Check location is on in the phone's settings, then try again." };
  }
  // The one sentence a photo gives when there is no position (the owner: GPS on is the prerequisite for photos)
  const PHOTO_NEEDS_LOCATION = "Photos need location turned on: allow it for this site in your browser or phone settings, then try again.";
  // Whether the camera may open now: "go" (a fresh position), "ask" (ask the phone first), "refused" (known to be refused, or no
  // location in this browser: say so and do not open the camera).
  function photoGate({ permission = "prompt", last = null, now = Date.now(), supported = true } = {}) {
    if (!supported) return "refused";
    if (permission === "denied") return "refused";
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
  function photoProblem(problem) {
    const key = problem?.key || "refused";
    if (key === "refused" || key === "off") return { key, text: PHOTO_NEEDS_LOCATION };
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
  // The line above the list: where the distances are measured from.
  function nearbyLine({ located, fix: f, count }) {
    if (!count) return null;
    if (located && f) return "Nearest to you" + (f.accuracy != null ? " (" + accuracyWords(f.accuracy) + ")" : "");
    return "Nearest to the middle of the map";
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

  return { PHONE, NEARBY, READ_CAP, PHOTO_FIX_AGE, PRIMARY, QUICK_TAGS, PHOTO_NEEDS_LOCATION, NO_SITES, SITES_FAILED,
    fix, fresh, fixForShot, photoProblem, locateProblem, photoGate, accuracyWords, sitesFrom, nearby, nearbyLine, rows, rowWords, quickTags };
});
