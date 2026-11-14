// SH1: photos a person already has (the phone's library, or shared in from the gallery or WhatsApp on Android) brought into a group as
// photo captures, several at once. The pure parts: each chosen photo as an item (its own date and place, read from the photo; never
// the phone's position unless the person chooses "Where I am now"), duplicates (the same photo chosen twice, or one already added),
// the one tag and note for all with a change per photo, what is sent for each (capture-model.js record, through the same queue as a
// photo taken with the camera), and the words. No DOM, no reads: capture-library.js draws and reads.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? { captureModel: require("./capture-model.js") } : null, root);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.captureLibraryModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (nodeDeps, root) {
  const C = () => nodeDeps?.captureModel || root.FP.captureModel;

  // At most this many photos in one go (each is read and made smaller on the phone first; more waits for the next go)
  const MAX_PHOTOS = 20;
  // Photos this phone remembers adding, per person and place (for "already added"); the newest kept
  const REMEMBER = 500;
  const ADDED_KEY = "fp-cap-added-v1:";

  // ---- one photo ------------------------------------------------------------------------------------------------------------------------
  // Its keys for spotting the same photo again: the hash of its bytes, and (when the photo has its own time) that time with its place.
  // The second catches the same photo handed over again as a fresh copy (an iPhone makes a new JPEG of it each time it is chosen).
  // SH1b: the time carries the fraction of the second when the photo has it (SubSecTimeOriginal), so photos of one burst differ.
  function keysFor({ sha256 = null, meta = null } = {}) {
    const out = [];
    if (sha256) out.push("h:" + sha256);
    if (meta?.taken_at) out.push("t:" + meta.taken_at + (meta.taken_subsec ? "." + meta.taken_subsec : "") + "|" + (meta.lat ?? "") + "|" + (meta.lon ?? ""));
    return out;
  }
  // An item for the review: { id, name, size, sha256, meta, prepared, problem } as read. Where starts at the photo's own place when
  // it has one, else none; when is the photo's own time, else now (said plainly: "No date in this photo").
  function item({ id, name = "", size = 0, sha256 = null, meta = null, prepared = null, problem = null }, now = new Date().toISOString()) {
    const own = !!(meta && C().position({ meta }));
    return { id, name, size, sha256, meta, prepared, keys: keysFor({ sha256, meta }), taken: C().takenAt(meta, now), where: own ? "photo" : "none",
      pin: null, device: null, tags: null, note: null, removed: false, anyway: false, dup: null, state: problem ? "unreadable" : "ready", problem: problem || null,
      clientId: null };
  }
  const hasOwnPlace = (it) => !!(it?.meta && C().position({ meta: it.meta }));

  // ---- duplicates -------------------------------------------------------------------------------------------------------------------------
  // In the order chosen: a photo whose key was seen earlier in this go is "twice" (chosen twice); one whose key this phone remembers
  // adding (known) is "added". The first of a pair is kept. Unreadable photos are left as they are.
  // SH1b: within one go the bytes' hash decides: photos taken in the same second at the same place with different bytes (a burst) are
  // different photos. The time-and-place key counts within a go only for a photo whose hash could not be taken.
  function markDuplicates(items, known = new Set()) {
    const seen = new Set();
    const same = (it) => (it.sha256 ? seen.has("h:" + it.sha256) : it.keys.some((k) => seen.has(k)));
    return (items || []).map((it) => {
      if (it.state === "unreadable") return it;
      let dup = null;
      if (same(it)) dup = "twice";
      else if (it.keys.some((k) => known.has(k))) dup = "added";
      it.keys.forEach((k) => seen.add(k));
      return { ...it, dup: dup || (it.dup === "server" ? "server" : null) };
    });
  }
  // The times to ask the server about: the photos' own times (only a photo's own time can match one added before), each once, at most 50.
  function queryTimes(items) {
    const out = [];
    for (const it of items || []) if (it.state === "ready" && !it.dup && it.taken?.from === "photo" && !out.includes(it.taken.at)) out.push(it.taken.at);
    return out.slice(0, 50);
  }
  // The person's own captures read back for those times ([{ taken_at, latitude, longitude }]): a photo with the same time to the second
  // and the same place (or none on both) was added before, from this phone or another.
  function serverMatches(items, rows) {
    const near = (a, b) => (a == null && b == null) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6);
    return (items || []).map((it) => {
      if (it.state !== "ready" || it.dup || it.taken?.from !== "photo") return it;
      const t = Date.parse(it.taken.at);
      const hit = (rows || []).some((r) => Date.parse(r.taken_at) === t && near(r.latitude ?? null, it.meta?.lat ?? null) && near(r.longitude ?? null, it.meta?.lon ?? null));
      return hit ? { ...it, dup: "server" } : it;
    });
  }
  // This phone's memory of what was added: a list of keys, newest last. read() takes what localStorage holds (or nothing).
  function readAdded(raw) { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.filter((k) => typeof k === "string") : []; } catch { return []; } }
  const remember = (list, keys) => [...(list || []).filter((k) => !keys.includes(k)), ...keys].slice(-REMEMBER);
  const addedKey = (user, org) => ADDED_KEY + user + ":" + org;

  // ---- what is added ---------------------------------------------------------------------------------------------------------------------
  // The photos that go: readable, not left out, and not a duplicate unless the person chose to add it anyway.
  const going = (items) => (items || []).filter((it) => it.state === "ready" && !it.removed && (!it.dup || it.anyway));
  // Where it goes on the map: the photo's own place, the phone's (only when the person chose "Where I am now"), a pin, or none.
  function position(it) {
    if (it.where === "photo") return C().position({ meta: it.meta });
    if (it.where === "here") return C().position({ device: it.device });
    if (it.where === "pin") return C().position({ pin: it.pin });
    return null;
  }
  // The one tag and note for all ({ tags, note }), or this photo's own where the person changed it
  const tagsOf = (it, all) => (it.tags ?? all.tags ?? []);
  const noteOf = (it, all) => (it.note ?? all.note ?? "");
  // capture-photo.js keep()'s argument for one photo
  function keepInput(it, all, org) {
    return { org, kind: "photo", taken: it.taken, position: position(it), note: noteOf(it, all), tags: tagsOf(it, all), shared: !!all.shared, fields: {}, prepared: it.prepared };
  }

  // ---- words --------------------------------------------------------------------------------------------------------------------------------
  const plural = (n, one, many) => C().plural(n, one, many);
  const addLabel = (n) => (n ? "Add " + plural(n, "photo", "photos") : "Add");
  // SH1b: the same, short, for a top row too narrow for it beside the title (320 px with large text): "Add 19"
  const addShort = (n) => (n ? "Add " + n : "Add");
  const dateLine = (it) => (it.state === "unreadable" ? it.name || "A file" : it.taken?.from === "photo" ? C().whenWords(it.taken.at) : "No date in this photo");
  // The Where row of an opened photo, short (the line above it gives the place itself)
  const WHERE_WORDS = { photo: "From the photo", here: "Where you are", pin: "Pin you dropped", none: "No place" };
  const whereWord = (it) => WHERE_WORDS[it.where] || "No place";
  // The line under the list when nothing is left to add but duplicates
  const nothingNew = (items) => (!going(items).length && (items || []).some((it) => it.state === "ready" && it.dup && !it.removed) ?
    "Nothing new to add. To add a photo again anyway, open it." : null);
  // The place as a person reads it: the nearest of the group's known places (its water quality sites) within 25 km with the distance,
  // else the position itself; "No place in this photo" when it has none, "No place" when the person took it off.
  function placeLine(it, sites = []) {
    const p = position(it);
    if (!p) return hasOwnPlace(it) ? "No place" : "No place in this photo";
    const near = C().nearest(sites, p, 1)[0];
    const at = near && near.km <= 25 ? (near.km < 0.05 ? "At " + near.name : C().kmWords(near.km) + " from " + near.name) : C().latLonWords(p);
    return (it.where === "here" ? "Where you are: " : it.where === "pin" ? "Pin: " : "") + at;
  }
  const DUP_WORDS = { twice: "Chosen twice: added once", added: "Already added from this phone", server: "Looks already added: same time and place as one of yours" };
  const dupLine = (it) => (it.dup ? (it.anyway ? "Added anyway" : DUP_WORDS[it.dup]) : null);
  // A photo that can't be used, said plainly (heic: a format this browser can't open, as on Android Chrome)
  function problemWords(kind, name = "") {
    if (kind === "tooBig") return "Too large to send, even made smaller.";
    if (kind === "heic" || /\.hei[cf]$/i.test(name)) return "This browser can't open this kind of photo (HEIC). Choose it on an iPhone, or as a JPEG.";
    return "This photo can't be read here.";
  }
  // The line under the list when photos have no place of their own. An iPhone leaves the place out of photos chosen from its library
  // unless the person turns Location on under Options in the picker; photos saved from WhatsApp never carry one.
  function noPlaceNote(items, platform = "other") {
    const ready = (items || []).filter((it) => it.state === "ready" && !it.removed);
    const none = ready.filter((it) => !hasOwnPlace(it)).length;
    if (!none) return null;
    const start = none === ready.length ? (none === 1 ? "This photo has no place in it." : "None of these photos has a place in it.") : plural(none, "photo has", "photos have") + " no place in " + (none === 1 ? "it." : "them.");
    const how = platform === "ios" ? " An iPhone leaves the place out unless you allow it: next time, tap Options at the top of the photo picker and turn on Location." : "";
    return start + how + " Photos saved from WhatsApp carry no place. Open a photo to drop a pin, or add it without a place.";
  }
  // The person's queue item for each added photo: its words now ("Waiting to send", "Sending…", "Sent", "Not sent")
  function sendState(it, ops) {
    if (it.state === "notkept") return { key: "notkept", words: "Not kept on this phone", error: it.problem };
    const op = (ops || []).find((o) => o.entry_id === it.clientId);
    if (!op) return { key: "pending", words: C().STATE_WORDS.pending, error: null };
    return { key: op.state, words: C().STATE_WORDS[op.state] || "", error: op.state === "failed" ? op.error || null : null, seq: op.seq };
  }
  // One line over the list after Add: how many were sent, wait, or did not go
  function doneLine(items, ops, online = true) {
    const sent = items.filter((it) => it.clientId || it.state === "notkept");
    const s = sent.map((it) => sendState(it, ops).key);
    const ok = s.filter((k) => k === "synced").length, bad = s.filter((k) => k === "failed" || k === "notkept").length, wait = s.length - ok - bad;
    const parts = [ok ? plural(ok, "sent", "sent") : null, wait ? (online ? plural(wait, "sending", "sending") : plural(wait, "kept on this phone", "kept on this phone")) : null,
      bad ? plural(bad, "not sent", "not sent") : null].filter(Boolean);
    return parts.join(" · ") + (wait && !online ? ": they send when you're back in range." : bad ? ". Try again on each one marked." : ".");
  }

  // ---- Android's Share --------------------------------------------------------------------------------------------------------------------
  // What the service worker kept ({ at, files: [{ key, name, type, size, modified }] }): only images, at most MAX_PHOTOS, and only if it
  // is under a day old (an older share was not meant for now). null otherwise.
  const SHARE_AGE = 24 * 3600 * 1000;
  function sharedFiles(index, now = Date.now()) {
    if (!index || !Array.isArray(index.files) || !Number.isFinite(index.at) || now - index.at > SHARE_AGE || index.at > now + 60000) return null;
    const files = index.files.filter((f) => f && typeof f.key === "string" && (/^image\//.test(f.type || "") || /\.(jpe?g|png|webp|hei[cf]|gif)$/i.test(f.name || ""))).slice(0, MAX_PHOTOS);
    return files.length ? files : null;
  }
  // SH1b: whose they are. sw.js writes into the index who was last signed in on this phone when the share arrived (`for`: their id, or
  // null when nobody was). "mine": the person now signed in is that person. "before": nobody was signed in, and this is a sign-in within
  // SHARE_WAIT of the share (the review then says so, with "Not mine: discard"). null: someone else's, or waited too long; they are
  // discarded unseen. Shown at most once either way: the cache is cleared as it is read.
  const SHARE_WAIT = 10 * 60 * 1000;
  const BEFORE_WORDS = "Photos shared to the app before you signed in", NOT_MINE = "Not mine: discard";
  function shareFor(index, me, now = Date.now()) {
    if (!me || !sharedFiles(index, now)) return null;
    if (index.for != null) return index.for === me ? "mine" : null;
    return now - index.at <= SHARE_WAIT ? "before" : null;
  }
  // The places shared photos can go: the groups the person is a member of with a role that may capture (add.js mayCapture's roles)
  const MEMBER_ROLES = ["member", "editor", "facilitator", "advisor", "admin"];
  const shareTargets = (groups) => (groups || []).filter((g) => g?.id && MEMBER_ROLES.includes(g.role));

  return { MAX_PHOTOS, REMEMBER, ADDED_KEY, SHARE_AGE, keysFor, item, hasOwnPlace, markDuplicates, queryTimes, serverMatches, readAdded, remember, addedKey,
    going, position, tagsOf, noteOf, keepInput, addLabel, dateLine, whereWord, nothingNew, placeLine, dupLine, DUP_WORDS, problemWords, noPlaceNote, sendState, doneLine, sharedFiles, shareTargets,
    SHARE_WAIT, BEFORE_WORDS, NOT_MINE, shareFor, addShort };
});
