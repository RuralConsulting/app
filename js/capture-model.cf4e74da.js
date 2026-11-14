// CAP1: capture on a phone, the pure parts. A photo with tags is the base record; a water sample and pest control are the same
// screen with a tag preset and a few fields of their own. This decides what a capture is (its record for public.capture_save, its
// photo paths), when and where it was taken (the photo's own time and position, read before resizing, else the phone's), the sizes
// to resize to, which tag chips to offer, and the words. No DOM, no reads: capture-photo.js and records.js draw and read.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? { photoRead: require("./photo-read.js") } : null, root);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.captureModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (nodeDeps, root) {
  const photoRead = () => nodeDeps?.photoRead || root.FP.photoRead;

  // ---- the kinds ---------------------------------------------------------------------------------------------------------------
  // Each kind is the photo screen plus its preset tag and fields. Kept to three (the owner, 13 Nov 2026: customisable without being
  // overwhelming); lab results read by AI are a later item (an outside service needs the owner's decision).
  const KINDS = {
    photo: { label: "Photo", title: "Photo", preset: null, icon: "camera" },
    water_sample: { label: "Water sample", title: "Water sample", preset: "Water sample", icon: "water" },
    pest_control: { label: "Pest control", title: "Pest control", preset: "Pest control", icon: "pest" },
  };
  // SP1: what the catchment groups' own reports count (hares the largest, then possums, magpies, rabbits, geese, cats and more), in
  // the order a phone list reads best: the likely ones, then predators, then birds, then Other. The keys are the database's
  // (app.capture_data_problem, migration 20261113072000; tests/app/sp1-species.test.cjs holds the two lists equal). The picker
  // adds "Not sure" (no species) after these.
  const SPECIES = [["hare", "Hare"], ["possum", "Possum"], ["rabbit", "Rabbit"], ["deer", "Deer"], ["pig", "Pig"], ["goat", "Goat"], ["wallaby", "Wallaby"],
    ["stoat", "Stoat"], ["ferret", "Ferret"], ["weasel", "Weasel"], ["rat", "Rat"], ["hedgehog", "Hedgehog"], ["feral_cat", "Feral cat"],
    ["magpie", "Magpie"], ["goose", "Canada goose"], ["other", "Other"]];
  // How a count says each one: [one, many] ("1 hare", "14 hares", "3 deer", "2 Canada geese")
  const COUNTED = { hare: ["hare", "hares"], possum: ["possum", "possums"], rabbit: ["rabbit", "rabbits"], deer: ["deer", "deer"], pig: ["pig", "pigs"],
    goat: ["goat", "goats"], wallaby: ["wallaby", "wallabies"], stoat: ["stoat", "stoats"], ferret: ["ferret", "ferrets"], weasel: ["weasel", "weasels"],
    rat: ["rat", "rats"], hedgehog: ["hedgehog", "hedgehogs"], feral_cat: ["feral cat", "feral cats"], magpie: ["magpie", "magpies"],
    goose: ["Canada goose", "Canada geese"], other: ["other", "other"] };
  // A group with no tags yet is offered these; each becomes a real tag the first time it is used (it is stored on the capture).
  const SUGGESTED = ["Water sample", "Planting", "Pest control", "Deer", "Fencing", "Wetland", "Weed", "Meeting"];
  const MAX_TAGS = 12, MAX_TAG = 40, MAX_NOTE = 1000, MAX_READINGS = 3;
  // Resizing in the browser before upload: a sensible long edge for a rural connection, and a small thumbnail for lists.
  const MAX_EDGE = 2000, THUMB_EDGE = 480, PHOTO_BUDGET = 700 * 1024, THUMB_BUDGET = 60 * 1024;
  // Never sent larger than this after resizing (review of #529, 7; the database refuses a photo over 8 MB): a copy still over it is
  // made again smaller (FALLBACK_EDGE), and if even that is over, the screen says so and nothing is sent.
  const MAX_UPLOAD = 3 * 1024 * 1024, FALLBACK_EDGE = 1400;

  // ---- tags ----------------------------------------------------------------------------------------------------------------------
  const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  // As the database tidies them: spaces tidied, empty ones dropped, the same tag in any case once (the first spelling), at most 12,
  // each at most 40 characters (a longer one is cut, never refused at Save).
  function tidyTags(list) {
    const seen = new Set(), out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const t = tidy(raw).slice(0, MAX_TAG).trim();
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase()); out.push(t);
      if (out.length === MAX_TAGS) break;
    }
    return out;
  }
  // The chips to offer: the kind's preset first, then the group's tags as capture_tag_suggestions gives them (most used first, the
  // group's own list among them), then any tags this phone used recently for this place, then the suggested set to fill an empty
  // group up to `fill`. Each once, at most `max`.
  function chips({ suggestions = [], recent = [], preset = null, fill = 8, max = 12 } = {}) {
    const from = tidyTags([preset, ...(suggestions || []).map((s) => (typeof s === "string" ? s : s?.name)), ...(recent || [])].filter(Boolean));
    const out = from.slice(0, max);
    for (const s of SUGGESTED) { if (out.length >= fill) break; if (!out.some((t) => t.toLowerCase() === s.toLowerCase())) out.push(s); }
    return out.slice(0, max);
  }

  // ---- when it was taken ----------------------------------------------------------------------------------------------------------
  // A photo's own clock ("2026-11-13T10:22:05", no time zone) is New Zealand time: the instant it names there, summer or winter, as
  // an ISO string with its offset; null when it names no real time (or one that a clock change skips).
  const TZ = "Pacific/Auckland";
  function nzLocalToIso(local) {
    const m = typeof local === "string" && local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const want = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || "00"}`;
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const shown = (t) => fmt.format(new Date(t)).replace(",", "");
    const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    for (const hours of [13, 12]) {
      const t = base - hours * 3600000;
      if (shown(t) === want) return new Date(t).toISOString();
    }
    return null;
  }
  // { at, from }: the photo's own time when it has one that is not in the future (a camera clock set wrong); otherwise now.
  function takenAt(meta, now) {
    const iso = meta?.taken_at ? nzLocalToIso(meta.taken_at) : null;
    if (iso && Date.parse(iso) <= Date.parse(now) + 5 * 60000) return { at: iso, from: "photo" };
    return { at: new Date(Date.parse(now)).toISOString(), from: "device" };
  }

  // ---- where it was taken -----------------------------------------------------------------------------------------------------------
  // The photo's own position first (read from the original, before resizing), else the phone's (when the person allowed it), else none.
  // A pin the person drops replaces either. { latitude, longitude, position_from, accuracy_m } or null.
  const round = (v, d = 7) => Math.round(v * 10 ** d) / 10 ** d;
  const okLatLon = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  function position({ meta = null, device = null, pin = null } = {}) {
    if (pin && okLatLon(pin.lat, pin.lon)) return { latitude: round(pin.lat), longitude: round(pin.lon), position_from: "pin", accuracy_m: null };
    if (meta && okLatLon(meta.lat, meta.lon)) return { latitude: round(meta.lat), longitude: round(meta.lon), position_from: "photo", accuracy_m: null };
    if (device && okLatLon(device.lat, device.lon)) return { latitude: round(device.lat), longitude: round(device.lon), position_from: "device",
      accuracy_m: Number.isFinite(device.accuracy) && device.accuracy >= 0 ? Math.round(device.accuracy) : null };
    return null;
  }
  // "43.5321° S, 172.6362° E": a position as a person reads it (four decimals: about 10 m)
  function latLonWords(p) {
    if (!p || !okLatLon(p.latitude, p.longitude)) return "No position";
    const f = (v, pos, neg) => Math.abs(v).toFixed(4) + "° " + (v < 0 ? neg : pos);
    return f(p.latitude, "N", "S") + ", " + f(p.longitude, "E", "W");
  }
  const FROM_WORDS = { photo: "From the photo", device: "From this phone", pin: "Pin you dropped" };
  function positionLine(p) {
    if (!p) return "No position";
    return FROM_WORDS[p.position_from] + ": " + latLonWords(p) + (p.accuracy_m != null ? " (within " + p.accuracy_m + " m)" : "");
  }

  // The group's monitoring sites nearest a position, nearest first, at most n: [{ site_id, name, km }]. sites: [{ site_id, name,
  // lngLat: [lng, lat] }]. With no position, none (the person types the site instead).
  function nearest(sites, p, n = 5) {
    if (!p || !okLatLon(p.latitude, p.longitude)) return [];
    const k = Math.PI / 180, R = 6371;
    const km = ([lng, lat]) => { const a = Math.sin(((lat - p.latitude) * k) / 2) ** 2 + Math.cos(p.latitude * k) * Math.cos(lat * k) * Math.sin(((lng - p.longitude) * k) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
    return (sites || []).filter((s) => Array.isArray(s.lngLat) && okLatLon(s.lngLat[1], s.lngLat[0])).map((s) => ({ site_id: s.site_id, name: s.name, km: km(s.lngLat) }))
      .sort((a, b) => a.km - b.km || String(a.name).localeCompare(String(b.name))).slice(0, n);
  }
  const kmWords = (km) => (km < 1 ? Math.round(km * 1000 / 10) * 10 + " m" : (km < 10 ? km.toFixed(1) : Math.round(km)) + " km");

  // ---- the photo's sizes ---------------------------------------------------------------------------------------------------------
  // The size to draw a photo of width x height at, for the upload and for the thumbnail (never enlarged).
  const sizes = (width, height) => ({ photo: photoRead().fit(width, height, MAX_EDGE), thumb: photoRead().fit(width, height, THUMB_EDGE) });

  // ---- the record --------------------------------------------------------------------------------------------------------------------
  // Where its files go: the maker's own folder of the place, named by the capture's client id (the database holds it to this).
  const paths = (org, user, clientId) => ({ photo: "org/" + org + "/captures/" + user + "/" + clientId + ".jpg", thumb: "org/" + org + "/captures/" + user + "/" + clientId + "-thumb.jpg" });
  const num = (v) => { const s = String(v ?? "").trim().replace(",", "."); return s !== "" && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s) ? Number(s) : null; };
  // The kind's own fields, as the database checks them (app.capture_data_problem): a water sample's site and up to three readings
  // (each a name, a number and a unit: a reading without a number is left out); pest control's species and a whole count.
  function data(kind, f = {}) {
    if (kind === "water_sample") {
      const d = {};
      if (Number.isFinite(Number(f.site_id)) && f.site_id !== null && f.site_id !== "") d.site_id = Number(f.site_id);
      const name = tidy(f.site_name).slice(0, 120);
      if (name) d.site_name = name;
      const readings = (f.readings || []).map((r) => ({ name: tidy(r?.name).slice(0, 40), value: num(r?.value), unit: tidy(r?.unit).slice(0, 20) }))
        .filter((r) => r.value !== null).slice(0, MAX_READINGS).map((r) => ({ ...(r.name ? { name: r.name } : {}), value: r.value, ...(r.unit ? { unit: r.unit } : {}) }));
      if (readings.length) d.readings = readings;
      return d;
    }
    if (kind === "pest_control") {
      const d = {};
      if (SPECIES.some(([k]) => k === f.species)) d.species = f.species;
      const n = num(f.count);
      if (n !== null && Number.isInteger(n) && n >= 0 && n <= 10000) d.count = n;
      return d;
    }
    return {};
  }
  // What the person typed that isn't a number where one is needed (review of #529, 4): said on the field, never dropped in silence.
  // [{ key: "count" | "reading-<i>", text }]; none when all is well (an empty field is fine: those are optional).
  function fieldProblems(kind, f = {}) {
    const out = [];
    if (kind === "water_sample") (f.readings || []).forEach((r, i) => {
      const v = String(r?.value ?? "").trim();
      if (v && num(v) === null) out.push({ key: "reading-" + i, text: "Type the reading as a number, such as 2.5." });
      else if (!v && (String(r?.name ?? "").trim() || String(r?.unit ?? "").trim())) out.push({ key: "reading-" + i, text: "Add the reading's number, or clear the row." });
    });
    if (kind === "pest_control") {
      const v = String(f.count ?? "").trim(), n = num(v);
      if (v && (n === null || !Number.isInteger(n) || n < 0 || n > 10000)) out.push({ key: "count", text: "Type how many as a whole number, from 0 to 10,000." });
    }
    return out;
  }
  // public.capture_save's argument. input: { clientId, org, user, kind, taken: { at, from }, position, note, tags, shared, fields,
  // photo: { width, height, bytes } | null }. Throws a plain sentence when something the person must fix is missing.
  function record(input) {
    const kind = KINDS[input.kind] ? input.kind : "photo";
    if (!input.clientId || !input.org || !input.user) throw Error("This capture has no place to go.");
    const p = input.position || null, files = input.photo ? paths(input.org, input.user, input.clientId) : null;
    const out = { client_id: input.clientId, org_id: input.org, kind, taken_at: input.taken?.at, taken_at_from: input.taken?.from || "device",
      note: tidy(input.note).slice(0, MAX_NOTE) || null, tags: tidyTags(input.tags), data: data(kind, input.fields), shared_with_group: !!input.shared,
      latitude: p ? p.latitude : null, longitude: p ? p.longitude : null, position_from: p ? p.position_from : null, accuracy_m: p ? p.accuracy_m ?? null : null,
      photo_path: files ? files.photo : null, thumb_path: files && input.photo.thumb !== false ? files.thumb : null,
      photo_bytes: input.photo?.bytes || null, photo_width: input.photo?.width || null, photo_height: input.photo?.height || null };
    if (!out.taken_at) throw Error("This capture has no time.");
    if (kind === "photo" && !files && !out.note && !out.tags.length) throw Error("Take a photo, or write a note, first.");
    return out;
  }

  // ---- words --------------------------------------------------------------------------------------------------------------------
  const SAVED = "Saved";
  const SAVED_OFFLINE = "Saved on this phone, will send when you're back in range";
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  // The waiting line ("2 waiting to send", "1 not sent"), or null when nothing waits.
  function waitingLine(ops) {
    const open = (ops || []).filter((o) => ["pending", "syncing"].includes(o.state)).length, failed = (ops || []).filter((o) => o.state === "failed").length;
    const parts = [open ? plural(open, "waiting to send", "waiting to send") : null, failed ? plural(failed, "not sent", "not sent") : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  // Signing out (review of #529, 1): every unsent item of the person, of every kind (a group capture, a farm note or photo, an
  // offline edit), counted, and the warning true for all of them.
  const unsentCount = (ops) => (ops || []).filter((o) => ["pending", "syncing", "failed"].includes(o.state)).length;
  const signOutWarning = (n) => plural(n, "thing", "things") + " you saved on this phone (photos, notes or changes) " + (n === 1 ? "hasn't" : "haven't") +
    " been sent yet. Signing out removes " + (n === 1 ? "it" : "them") + " from this phone for good. Sign out anyway? (Cancel keeps " + (n === 1 ? "it" : "them") + " and keeps you signed in.)";
  const SIGN_OUT_UNKNOWN = "This phone couldn't check for things waiting to be sent. Signing out removes anything you saved here and haven't sent. Sign out anyway?";
  const badgeCount = (ops) => (ops || []).filter((o) => ["pending", "syncing", "failed"].includes(o.state)).length;
  const STATE_WORDS = { pending: "Waiting to send", syncing: "Sending…", failed: "Not sent", synced: "Sent" };
  const when = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t).toLocaleString("en-NZ", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ }) : ""; };
  const day = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : ""; };
  // A capture's own words beside its tags: "2 deer" / "Nitrate 2.5 mg/L at Culvert".
  function detailLine(c) {
    const d = c?.data || {};
    if (c?.kind === "pest_control") {
      const w = SPECIES.some(([k]) => k === d.species) ? COUNTED[d.species] : null;
      const sp = w ? (d.count === 1 || !Number.isInteger(d.count) ? w[0] : w[1]) : null;
      return [Number.isInteger(d.count) ? d.count + " " : "", sp || (d.count != null ? "seen" : "")].join("").trim() || null;
    }
    if (c?.kind === "water_sample") {
      const r = (d.readings || []).map((x) => [x.name, x.value, x.unit].filter((v) => v !== undefined && v !== null && v !== "").join(" ")).join(", ");
      return [r, d.site_name ? "at " + d.site_name : null].filter(Boolean).join(" ") || null;
    }
    return null;
  }
  // The Records list's tag filter: the tags on what was read, most used first (then by name), each with its count.
  function tagCounts(rows) {
    const m = new Map();
    for (const r of rows || []) for (const t of r.tags || []) { const k = t.toLowerCase(); const e = m.get(k) || { tag: t, n: 0 }; e.n++; m.set(k, e); }
    return [...m.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  }
  const hasTag = (r, tag) => !tag || (r.tags || []).some((t) => t.toLowerCase() === String(tag).toLowerCase());
  // Who made it, as the list says it: "You", their name, or "A member".
  const who = (r, me) => (r.created_by && r.created_by === me ? "You" : r.created_by_name || "A member");

  // ---- PH4: a saved record's page, and the form's short words --------------------------------------------------------------------------
  // "21 Oct 2026 at 2:05 pm": a time as a sentence says it
  function whenWords(iso) {
    const t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return "";
    const d = new Date(t);
    const date = d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
    const time = d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(/\s+/g, " ");
    return date + " at " + time;
  }
  const speciesWord = (k) => SPECIES.find(([x]) => x === k)?.[1] || null;
  const readingWords = (r) => [r?.name, r?.value, r?.unit].filter((v) => v !== undefined && v !== null && v !== "").join(" ");
  // What it is and when, in one sentence: "Water sample, 21 Oct 2026 at 2:05 pm." / "Pest control: 3 deer, ..." / "Photo, 28 Oct
  // 2026 at 11:10 am." (where it was is the Where row's)
  function summary(c) {
    const kind = KINDS[c?.kind] ? c.kind : "photo";
    let what = KINDS[kind].label;
    if (kind === "pest_control") { const n = detailLine(c); if (n) what += ": " + n; }
    const when = whenWords(c?.taken_at);
    return what + (when ? ", " + when : "") + ".";
  }
  // Who sees it, as one quiet line
  const seenBy = (c, groupName) => (c?.shared_with_group ? "Seen by everyone in " + (groupName || "the group") : "Seen by whoever took it and the coordinators of " + (groupName || "the group"));
  // Where, as a person reads it: the sample's own site, else the nearest known site with the distance, from sites: [{ site_id, name,
  // lngLat }] (the group's monitoring sites the person may read). { words, near: { name, km } | null } or null with no position.
  function placeWords(c, sites = [], { within = 25 } = {}) {
    const p = c && okLatLon(c.latitude, c.longitude) ? { latitude: c.latitude, longitude: c.longitude } : null;
    const own = tidy(c?.data?.site_name);
    if (own) return { words: "At " + own, near: null, own: true };
    if (!p) return null;
    const n = nearest(sites, p, 1)[0];
    if (!n || n.km > within) return { words: FROM_WORDS[c.position_from] || "On the map", near: null };
    return { words: n.km < 0.05 ? "At " + n.name : kmWords(n.km) + " from " + n.name, near: { name: n.name, km: n.km } };
  }
  // The record page's rows: only those with a value, in order. [{ key, label, value }] (value a string or a list of strings).
  function factRows(c, { me = null } = {}) {
    const d = c?.data || {}, out = [];
    if ((c?.tags || []).length) out.push({ key: "tags", label: "Tags", value: c.tags.slice() });
    if (c?.kind === "water_sample") (d.readings || []).forEach((r, i) => { const w = readingWords(r); if (w) out.push({ key: "reading-" + i, label: i ? "Reading " + (i + 1) : "Reading", value: w }); });
    if (c?.kind === "pest_control") {
      const sp = speciesWord(d.species);
      if (sp) out.push({ key: "species", label: "What", value: sp });
      if (Number.isInteger(d.count)) out.push({ key: "count", label: "How many", value: String(d.count) });
    }
    if (c?.created_by || c?.created_by_name) out.push({ key: "by", label: "By", value: who(c, me) });
    return out;
  }
  // The water sample's site choices: the nearest known sites (at most `cap`), each with its distance, then "Another place"
  function siteOptions(sites, p, cap = 5) {
    return [...nearest(sites, p, cap).map((s) => ({ value: String(s.site_id), label: s.name, hint: kmWords(s.km) + " away" })), { value: "", label: "Another place", hint: "Type its name" }];
  }
  // review of #539, 2: the site a water sample is put at by itself: the nearest known one only when the position is at it (within
  // SITE_NEAR metres, or the position's own accuracy when that is larger, up to SITE_NEAR_MAX); otherwise none, and the person chooses
  const SITE_NEAR = 100, SITE_NEAR_MAX = 250;
  // review of #539, 1: a "Here" older than two minutes is never saved as here
  const HERE_OLD = "Where you were is more than two minutes old, and this phone didn't give a newer position. Choose Where again: here, a pin, or no position.";
  function closeSite(sites, p) {
    const n = nearest(sites, p, 1)[0];
    if (!n) return null;
    const reach = Math.min(Math.max(SITE_NEAR, Number.isFinite(p?.accuracy_m) ? p.accuracy_m : 0), SITE_NEAR_MAX) / 1000;
    return n.km <= reach ? n : null;
  }
  // A refused change on a record's page, in plain words: refused (the policy, the guard, or no row of theirs: PostgREST's PGRST116
  // "JSON object requested") or not reached
  function refusedWords(e) {
    const t = String(e?.code || "") + " " + String(e?.message || e || "");
    if (/PGRST116|42501|JSON object requested|row-level security|Only the person who made/i.test(t)) return "You can't change this record.";
    if (/fetch|network|Failed/i.test(t)) return "That couldn't be saved: there's no connection just now. Try again when you're back in range.";
    return "That couldn't be saved just now. Try again in a moment.";
  }
  // The form's "Where" row: what it says now
  function whereShort(p) {
    if (!p) return "";
    const acc = p.accuracy_m != null ? " · within " + p.accuracy_m + " m" : "";
    return (p.position_from === "device" ? "Here" : p.position_from === "pin" ? "Pin you dropped" : "From the photo") + acc;
  }

  return { KINDS, SPECIES, COUNTED, SUGGESTED, MAX_TAGS, MAX_TAG, MAX_NOTE, MAX_READINGS, MAX_EDGE, THUMB_EDGE, PHOTO_BUDGET, THUMB_BUDGET, MAX_UPLOAD, FALLBACK_EDGE,
    tidyTags, chips, fieldProblems, nzLocalToIso, takenAt, position, latLonWords, positionLine, nearest, kmWords, sizes, paths, data, record,
    SAVED, SAVED_OFFLINE, waitingLine, badgeCount, unsentCount, signOutWarning, SIGN_OUT_UNKNOWN, STATE_WORDS, when, day, detailLine, tagCounts, hasTag, who, plural,
    whenWords, summary, seenBy, placeWords, factRows, siteOptions, whereShort, speciesWord, readingWords, FROM_WORDS, closeSite, SITE_NEAR, SITE_NEAR_MAX, HERE_OLD, refusedWords };
});
