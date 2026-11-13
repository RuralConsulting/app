// CAP1: capture on a phone. "Take a photo" is the fastest path in the app: tap + then Photo, the camera opens, then one short screen
// and Save. PH4 (the owner: the forms are "clunky"): every screen here is the one pattern for add forms (form-rows.js): Cancel, the
// title and Save in one thin top row, then plain rows. After the shot, the photo and at most three rows (Tag, Note, Place where there is
// a choice); a water sample and pest control open on the fewest rows that make a record (the site, nearest first, and the reading; what
// and how many; where and when prefilled), the photo an optional row, the rest under More details. Save never waits for the network: the capture (the
// resized photo and its thumbnail, and its record) goes into the capture queue on this phone first (capture-queue.js, IndexedDB) and
// is sent when there is coverage, in order, once. The person is back where they were with a quiet "Saved" line that opens it.
//
//   FP.captures.start(ctx, kind)        (the Add registry's run: add.js)
//   FP.captures.signedIn(user, groups)  (main.js, once the sign-in and the person's groups are known; sends what waits)
//   FP.captures.offline(user)           (main.js, the app opened offline for the last person signed in: keeps, does not send)
//   FP.captures.beforeSignOut()         (main.js: says what has not been sent, then clears this person's captures from the phone)
//
// What is decided here: nothing about who reads a capture (public.captures' policies do). The words and the record: capture-model.js.
(function (root) {
  const FP = root.FP;
  const C = () => FP.captureModel, Q = () => FP.captureQueue;
  const el = (...a) => FP.el(...a);
  const uuid = () => root.crypto.randomUUID();
  const PLACES_KEY = "fp-places-v1", TAGS_KEY = "fp-cap-tags-v1:";
  let me = null, confirmed = false, unwatch = null;
  const phoneNow = () => !!root.matchMedia?.(FP.phoneModel?.PHONE || "(max-width: 800px)").matches;

  // ---- this device's small memory (wrapped: private browsing refuses it, and nothing here is needed) -----------------------------------
  const ls = () => { try { return root.localStorage; } catch { return null; } };
  const readJson = (k) => { try { const v = ls()?.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  const writeJson = (k, v) => { try { ls()?.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const drop = (k) => { try { ls()?.removeItem(k); } catch { /* nothing kept */ } };
  // The last person signed in on this phone and their groups (names and roles only), so the app can open offline to + and Photo.
  function rememberPlaces(user, groups) {
    writeJson(PLACES_KEY, { user: { id: user.id, email: user.email || null }, at: new Date().toISOString(),
      groups: (groups || []).map((g) => ({ id: g.id, name: g.name, kind: g.kind || "catchment_group", parent_org_id: g.parent_org_id || null, role: g.role || null })) });
  }
  function lastPlaces() {
    const v = readJson(PLACES_KEY);
    return v && v.user?.id && Array.isArray(v.groups) ? v : null;
  }

  // ---- who, and the queue ------------------------------------------------------------------------------------------------------------
  function setUser(id, isConfirmed) {
    me = id || null; confirmed = !!isConfirmed;
    if (!me) return null;
    const q = FP.capture.start({ sb: FP.sb, user: { id: me }, hold: !confirmed });
    unwatch?.(); unwatch = FP.capture.watch(() => badge());
    badge();
    return q;
  }
  function signedIn(user, groups) {
    if (!user?.id) return;
    if (!FP.demo?.active) rememberPlaces(user, groups);   // (the demo's invented places are never kept for an offline start)
    setUser(user.id, true);
  }
  function offline(user) { setUser(user.id, false); }
  const queue = () => (me ? FP.capture.queue : null);
  async function waiting(org) { const q = queue(); return q ? q.captures(org) : []; }
  // Signing out (review of #529, 1): everything this person saved on the phone and has not sent (group captures, and a farm's offline
  // notes, photos and edits from the Create view: every kind, pending, sending or not sent) is counted and said first, because signing
  // out removes it: the phone may be shared, and no one's unsent records stay for the next person. Cancel removes nothing and the
  // person stays signed in. Only after they confirm does everything of theirs leave this phone, with the places kept for an offline
  // start. Returns false when the person chose to stay signed in.
  async function beforeSignOut() {
    if (!me) return true;
    let open = 0;
    try { open = C().unsentCount(await (queue()?.list() || [])); }
    catch { if (!root.confirm(C().SIGN_OUT_UNKNOWN)) return false; open = 0; }
    if (open && !root.confirm(C().signOutWarning(open))) return false;
    try { await queue()?.forget(me); } catch { /* nothing kept to clear */ }
    drop(PLACES_KEY);
    for (const k of Object.keys(ls() || {})) if (k.startsWith(TAGS_KEY + me)) drop(k);
    me = null; confirmed = false;
    return true;
  }

  // ---- the small count on the + -------------------------------------------------------------------------------------------------------
  async function badge() {
    let n = 0;
    try { n = C().badgeCount(await waiting()); } catch { n = 0; }
    for (const b of (FP.add?.buttons?.() || []).filter((x) => x.dataset.addSpace === "group")) {   // (captures are a group's)
      let dot = b.querySelector(".add-badge");
      if (!n) { dot?.remove(); b.removeAttribute("aria-describedby"); continue; }
      if (!dot) { dot = el("span", { class: "add-badge", "aria-hidden": "true" }); b.append(dot); }
      dot.textContent = n > 9 ? "9+" : String(n);
      let said = root.document.getElementById("add-waiting-" + b.dataset.addSpace);
      if (!said) { said = el("span", { id: "add-waiting-" + b.dataset.addSpace, class: "visually-hidden" }); root.document.body.append(said); }
      said.textContent = C().plural(n, "capture", "captures") + " waiting to send";
      b.setAttribute("aria-describedby", said.id);
    }
    root.document.dispatchEvent(new CustomEvent("fp-captures-changed", { detail: { waiting: n } }));
  }
  root.addEventListener("online", () => badge());
  root.addEventListener("offline", () => badge());

  // ---- the places a capture can go to ---------------------------------------------------------------------------------------------------
  // The group the person is in now, and (only when they are in more than one) the groups beside it: its sub-groups they are in, and its
  // parent when they are in that too.
  function placesFor(ctx) {
    const all = (FP.groupSpace?.groups?.() || []).length ? FP.groupSpace.groups() : lastPlaces()?.groups || [];
    const here = all.find((g) => g.id === ctx.id) || { id: ctx.id, name: ctx.name, parent_org_id: null, role: ctx.role };
    const near = all.filter((g) => g.id !== here.id && (g.parent_org_id === here.id || g.id === here.parent_org_id || (here.parent_org_id && g.parent_org_id === here.parent_org_id)));
    return [here, ...near].filter((g) => ["member", "editor", "facilitator", "advisor", "admin"].includes(g.role));
  }

  // ---- reading a photo: what it says about itself, then a smaller copy --------------------------------------------------------------------
  async function readMeta(file) {
    try { return FP.photoRead.read(new Uint8Array(await file.slice(0, FP.photoRead.HEAD).arrayBuffer())); } catch { return null; }
  }
  async function decode(file) {
    if (typeof root.createImageBitmap === "function") {
      try { const b = await root.createImageBitmap(file, { imageOrientation: "from-image" }); return { src: b, width: b.width, height: b.height, done: () => b.close?.() }; } catch { /* the <img> way */ }
    }
    const url = URL.createObjectURL(file), img = new Image();
    img.src = url;
    try { await img.decode(); } catch { URL.revokeObjectURL(url); return null; }
    return { src: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }
  async function encode(src, size, budget) {
    const c = root.document.createElement("canvas");
    c.width = size.width; c.height = size.height;
    c.getContext("2d").drawImage(src, 0, 0, size.width, size.height);
    const got = await FP.photoRead.encodeUnder((q) => new Promise((resolve) => c.toBlob(resolve, "image/jpeg", q)), budget);
    return got?.blob || null;
  }
  // The photo taken or chosen: its own time and position (read from the original, before it is resized), and the resized copy and
  // thumbnail that are sent. null when the browser cannot read the file as a picture.
  async function prepare(file) {
    const meta = await readMeta(file), pic = await decode(file);
    if (!pic || !pic.width) return null;
    try {
      const s = C().sizes(pic.width, pic.height);
      let size = s.photo, photo = await encode(pic.src, size, C().PHOTO_BUDGET);
      if (photo && photo.size > C().MAX_UPLOAD) { size = FP.photoRead.fit(pic.width, pic.height, C().FALLBACK_EDGE); photo = await encode(pic.src, size, C().PHOTO_BUDGET); }
      if (!photo) return null;
      if (photo.size > C().MAX_UPLOAD) return { tooBig: true };
      const thumb = await encode(pic.src, s.thumb, C().THUMB_BUDGET);
      return { meta, photo, thumb, width: size.width, height: size.height };
    } finally { pic.done(); }
  }

  // ---- tags to offer ----------------------------------------------------------------------------------------------------------------------
  async function tagChoices(org, preset) {
    const key = TAGS_KEY + me + ":" + org, kept = readJson(key) || { suggestions: [], recent: [] };
    let suggestions = kept.suggestions || [];
    if (confirmed && root.navigator.onLine !== false) {
      try {
        const r = await Promise.race([Promise.resolve(FP.sb.rpc("capture_tag_suggestions", { o: org, max_rows: 16 })), new Promise((resolve) => setTimeout(() => resolve(null), 2500))]);
        if (r && !r.error && Array.isArray(r.data)) { suggestions = r.data.map((x) => x.name); writeJson(key, { ...kept, suggestions }); }
      } catch { /* the kept ones */ }
    }
    return C().chips({ suggestions, recent: kept.recent || [], preset });
  }
  function rememberTags(org, tags) {
    const key = TAGS_KEY + me + ":" + org, kept = readJson(key) || { suggestions: [], recent: [] };
    writeJson(key, { ...kept, recent: C().tidyTags([...tags, ...(kept.recent || [])]).slice(0, 12) });
  }

  // ---- the water sample's sites (read once a session per group, when online) --------------------------------------------------------------
  const siteLists = new Map();
  function sitesFor(org) {
    if (!confirmed || root.navigator.onLine === false) return Promise.resolve([]);
    if (!siteLists.has(org)) {
      siteLists.set(org, Promise.resolve(FP.sb.rpc("group_wq_sites", { g: org, km: 5 })).then((r) => (r?.error || !Array.isArray(r?.data) ? [] :
        r.data.map((s) => ({ site_id: s.site_id, name: s.name || s.external_id || "Site " + s.site_id, lngLat: FP.wqModel?.siteLngLat?.(s.geom) || null }))), () => []));
    }
    return siteLists.get(org);
  }

  // ---- the screen ----------------------------------------------------------------------------------------------------------------------------
  let screen = null;
  function start(ctx, kind = "photo") {
    if (!me) { FP.add?.toast?.("Sign in again to take photos here."); return; }
    const K = C().KINDS[kind] ? kind : "photo";
    // PH1: on a phone, a photo is the quick path: the phone's position first, the camera at once, then a tag, a note and Save
    if (K === "photo" && phoneNow() && FP.phoneModel && FP.locate) { quick(ctx); return; }
    // the camera first: the tap that chose the action is what lets the page open it
    const camera = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, id: "cap-camera" });
    const library = el("input", { type: "file", accept: "image/*", hidden: true, id: "cap-library" });
    open(ctx, K, camera, library);
    // PH4: a water sample or pest control opens on its rows (the photo is an optional row); a photo opens the camera at once
    if (K === "photo") try { camera.click(); } catch { /* the screen's own row */ }
  }

  // PH4: the full screen (a water sample, pest control, and a photo on a computer) as FP.formRows lays every add form out: the top row
  // (Cancel, the title, Save), then the fewest rows that make a valid record, prefilled (where: the phone's position when it already
  // has a fresh one, never a prompt by itself; when: now, or the photo's own time), the reading or the count as one large number row,
  // the photo as a row with a camera icon; everything else under More details (tags, note, place, sharing, more readings).
  function open(ctx, kind, camera, library) {
    close();
    const R = FP.formRows, places = placesFor(ctx);
    const held = FP.locate?.last?.(), fresh = held && FP.phoneModel?.fresh?.(held) && FP.locate.permissionNow?.() !== "denied" ? held : null;
    const st = { kind, org: places[0]?.id || ctx.id, file: null, prepared: null, meta: null, device: fresh ? { lat: fresh.lat, lon: fresh.lon, accuracy: fresh.accuracy, at: fresh.at } : null, pin: null,
      tags: C().KINDS[kind].preset ? [C().KINDS[kind].preset] : [], chips: [], busy: false, reading: 0, species: kind === "pest_control" ? "deer" : null, shared: false, finding: false };
    const title = C().KINDS[kind].title;
    const msg = el("p", { class: "cap-msg fs-say", role: "status", id: "cap-msg" });
    const s = R.sheet({ id: "cap-screen", title, titleId: "cap-title", saveId: "cap-save", cancelId: "cap-close", className: "cap-screen", onSave: () => doSave(), onCancel: () => close(true) });
    const node = s.node, save = s.save;
    node.dataset.kind = kind;
    s.cancel.setAttribute("aria-label", "Cancel: close without saving");

    // the photo: a row with a camera icon; once taken, the photo above the rows (a photo) or small in its row (a sample, pest control)
    const img = el("img", { class: "cap-img", id: "cap-img", alt: "", hidden: true });
    const thumb = el("img", { class: "cap-row-thumb", alt: "", hidden: true });
    const photoRow = R.action({ id: "cap-take", key: "photo", icon: "camera", label: "Add a photo", onClick: () => photoChoices() });
    photoRow.append(thumb);
    const photoBox = el("div", { class: "cap-photo", "data-has-photo": "false", hidden: true }, img);
    for (const input of [camera, library]) input.addEventListener("change", () => { const f = input.files?.[0]; input.value = ""; if (f) usePhoto(f); });
    s.sheet.append(camera, library);
    function photoChoices() {
      R.list({ opener: photoRow, title: "Photo", value: null, onPick: (v) => {
        if (v === "camera") { try { camera.click(); } catch { /* the row again */ } }
        else if (v === "library") { try { library.click(); } catch { /* the row again */ } }
        else if (v === "remove") { st.file = null; st.prepared = null; st.meta = null; drawPhoto(); drawWhere(); }
      }, options: [{ value: "camera", label: "Take a photo" }, { value: "library", label: "Choose from your photos" }, ...(st.prepared ? [{ value: "remove", label: "Remove the photo" }] : [])] });
    }
    function drawPhoto() {
      const has = !!st.prepared;
      if (img.src && !has) { URL.revokeObjectURL(img.src); img.removeAttribute("src"); }
      img.hidden = !has || kind !== "photo"; photoBox.hidden = img.hidden; photoBox.dataset.hasPhoto = String(has);
      thumb.hidden = !has || kind === "photo";
      if (has) { const u = URL.createObjectURL(st.prepared.photo); if (kind === "photo") { img.src = u; img.alt = "The photo you took"; } else { thumb.src = u; thumb.alt = "The photo you took"; } }
      photoRow.querySelector(".fs-action-words").textContent = has ? "Photo added" : "Add a photo";
      photoRow.setAttribute("aria-label", has ? "Photo added: change or remove it" : "Add a photo");
    }

    // tags (a choice of several, with a new one typed), note, place
    const tagRow = R.pick({ id: "cap-tags", key: "tags", label: "Tags", title: "Tags", multi: true, max: C().MAX_TAGS, tooMany: "At most " + C().MAX_TAGS + " tags.",
      options: () => C().tidyTags([...st.chips, ...st.tags]).map((t) => ({ value: t, label: t })), value: () => st.tags, onPick: (v) => { st.tags = C().tidyTags(v); },
      allowNew: { label: "New tag", placeholder: "Type a tag", max: C().MAX_TAG, tidy: (t) => C().tidyTags([t])[0] || "" } });
    tagChoices(st.org, C().KINDS[kind].preset).then((list) => { st.chips = list; if (screen?.node === node) tagRow._draw(); });
    const noteRow = R.long({ id: "cap-note", key: "note", label: "Note", placeholder: "Optional", max: C().MAX_NOTE });
    const note = noteRow._input;
    const placeRow = places.length > 1 ? R.pick({ id: "cap-place", key: "place", label: "Place", title: "Save it to", options: places.map((g) => ({ value: g.id, label: g.name })), value: () => st.org,
      onPick: (v) => { st.org = v; tagChoices(st.org, C().KINDS[kind].preset).then((l) => { st.chips = l; tagRow._draw(); }); fields.placeChanged?.(); } }) : null;

    // where and when: prefilled; where opens a short list (here, a pin, none)
    const pos = () => C().position({ meta: st.meta, device: st.device, pin: st.pin });
    const taken = () => C().takenAt(st.meta, new Date().toISOString());
    const pinMap = el("div", { class: "cap-pin-map", id: "cap-pin-map", hidden: true });
    const whereRow = R.pick({ id: "cap-where", key: "where", label: "Where", title: "Where it was", empty: "Add where", value: () => (st.pin ? "pin" : st.device ? "here" : st.meta && pos() ? "photo" : ""),
      words: () => (st.finding ? "Finding where you are…" : C().whereShort(pos())),
      options: () => [...(st.meta && C().position({ meta: st.meta }) ? [{ value: "photo", label: "Where the photo was taken", hint: "From the photo" }] : []),
        { value: "here", label: "Where I am now", hint: "This phone's position" }, { value: "pin", label: "Drop a pin on the map" }, { value: "none", label: "No position" }],
      onPick: (v) => {
        if (v === "here") useHere();
        else if (v === "pin") { st.pin = null; togglePin(true); }
        else if (v === "photo") { st.device = null; st.pin = null; togglePin(false); }
        else if (v === "none") { st.device = null; st.pin = null; st.meta = st.meta ? { ...st.meta, lat: null, lon: null } : null; togglePin(false); }
        drawWhere();
      } });
    const whenRow = R.row({ key: "when", label: "When", control: el("span", { class: "fs-chosen", id: "cap-time-text" }) });
    const sharedWhere = el("p", { class: "fs-quiet cap-shared-where", id: "cap-shared-where", hidden: true }, "Shared with the group, so is where it was taken.");
    function drawWhere() {
      whereRow._draw();
      const t = taken();
      whenRow.querySelector("#cap-time-text").textContent = C().whenWords(t.at) + (t.from === "photo" ? " (from the photo)" : "");
      fields.positionChanged?.(pos());
      sharedWhere.hidden = !(st.shared && pos());
    }
    async function useHere() {
      st.finding = true; st.pin = null; togglePin(false); whereRow._draw();
      const got = await FP.locate.get({ maxAge: 60000 });
      st.finding = false;
      if (screen?.node !== node) return;
      st.device = got?.ok && got.fix ? { lat: got.fix.lat, lon: got.fix.lon, accuracy: got.fix.accuracy, at: got.fix.at } : null;
      R.say(whereRow, st.device ? "" : "This phone didn't give a position. Drop a pin instead, or save without one.");
      drawWhere();
    }
    let map = null, marker = null;
    function togglePin(opening) {
      pinMap.hidden = !opening;
      if (!opening) { map?.remove(); map = null; marker = null; return; }
      const gl = root.maplibregl, p = pos();
      if (!gl || root.navigator.onLine === false) { pinMap.replaceChildren(el("p", { class: "fs-quiet" }, "The map needs a connection. Save without a position, or with the one shown.")); return; }
      try {
        gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js");
        map = new gl.Map({ container: pinMap, style: FP.basemaps.style("aerial"), ...(p ? { center: [p.longitude, p.latitude], zoom: 15 } : { bounds: [[166.3, -47.4], [178.6, -34.3]] }), attributionControl: { compact: true } });
        if (p) marker = new gl.Marker().setLngLat([p.longitude, p.latitude]).addTo(map);
        map.on("click", (e) => { st.pin = { lat: e.lngLat.lat, lon: e.lngLat.lng }; if (marker) marker.setLngLat(e.lngLat); else marker = new gl.Marker().setLngLat(e.lngLat).addTo(map); drawWhere(); });
      } catch { pinMap.replaceChildren(el("p", { class: "fs-quiet" }, "The map couldn't open here.")); }
    }

    // share: off unless the person turns it on (a member's capture is seen by them and the group's coordinators)
    const shareRow = R.toggle({ id: "cap-share", key: "share", label: "Share with everyone in the group", hint: "Otherwise only you and the group's coordinators see it.",
      onChange: (on) => { st.shared = on; drawWhere(); } });
    const share = shareRow._input;

    // the kind's own rows
    const fields = kindFields(kind, st, { R });
    const main = kind === "photo" ? [photoRow, tagRow, noteRow] : [...fields.main, whereRow, whenRow, photoRow];
    const extra = kind === "photo" ? [whereRow, whenRow, placeRow, shareRow] : [...(fields.more || []), tagRow, noteRow, placeRow, shareRow];
    const moreBox = R.more({ label: "More details", rows: extra });
    s.body.append(photoBox, R.set(...main), pinMap, moreBox, sharedWhere, ...(fields.after || []), msg);
    // (review of #529, 2: shared with the group, its position goes with it: said quietly, sharedWhere, under More details)

    // (back to what opened it: a Home tile, or the + when the ring that opened it has gone)
    const from = root.document.activeElement;
    screen = { node, ctx, opener: from && from !== root.document.body && from.isConnected ? from : (FP.add?.buttons?.() || []).find((b) => !b.hidden && b.getClientRects().length) || null };
    root.document.body.append(node);
    s.mounted();
    root.document.body.classList.add("cap-open");
    drawWhere();
    // the focus on the first row that is not a text field (no keyboard until the person taps a field), else Cancel
    ([...s.body.querySelectorAll("button.fs-row")].find((b) => b.getClientRects().length) || s.cancel).focus();

    async function usePhoto(file) {
      st.file = file; const mine = ++st.reading;
      msg.textContent = "Reading the photo…";
      save.disabled = true;
      const got = await prepare(file);
      if (mine !== st.reading || screen?.node !== node) return;
      save.disabled = false;
      if (!got) { msg.textContent = "This photo can't be read here. Take it again with the camera, or choose another."; return; }
      if (got.tooBig) { msg.textContent = "This photo is too large to send, even made smaller. Take it again, or choose another."; return; }
      st.prepared = got; st.meta = got.meta;
      msg.textContent = "";
      drawPhoto();
      // (review of #529, 2: the phone is asked for its position only when the person asks for it, never by itself)
      drawWhere();
    }

    // review of #539, 1: "Here" stands only for two minutes, as a photo's position does (phone-model PHOTO_FIX_AGE). At Save an older one
    // is asked for again, only where the phone already allows it (never a new prompt); none fresh, and nothing is saved as "here": the
    // person is told under Where and chooses again (here, a pin, or no position)
    async function hereStill() {
      if (!st.device || st.pin) return true;
      const P = FP.phoneModel;
      if (P.fresh(st.device, Date.now())) return true;
      let got = null;
      if (FP.locate.permissionNow() === "granted") got = await FP.locate.get({ maxAge: P.PHOTO_FIX_AGE });
      if (screen?.node !== node) return false;
      if (got?.ok && P.fresh(got.fix, Date.now())) { st.device = { lat: got.fix.lat, lon: got.fix.lon, accuracy: got.fix.accuracy, at: got.fix.at }; drawWhere(); return true; }
      st.device = null; drawWhere();
      R.say(whereRow, C().HERE_OLD);
      return false;
    }
    async function doSave() {
      if (st.busy) return;
      st.busy = true; save.disabled = true; msg.textContent = "";
      try {
        if (!(await hereStill())) throw Object.assign(Error("Check the row marked above."), { plain: true });
        const typed = fields.values(), probs = C().fieldProblems(kind, typed);
        fields.showProblems?.(probs);
        if (probs.length) throw Object.assign(Error(probs.length === 1 ? "Check the row marked above." : "Check the rows marked above."), { plain: true });
        const { clientId, sending } = await keep({ org: st.org, kind, taken: taken(), position: pos(), note: note.value, tags: st.tags, shared: share.checked,
          fields: typed, prepared: st.prepared });
        const to = st.org;
        close(true);
        saved(to, clientId, sending);
        badge();
      } catch (e) {
        msg.textContent = e.plain ? e.message : e.message || String(e);
        st.busy = false; save.disabled = false;
      }
    }
  }

  // A capture into the queue on this phone (sent when there is coverage): its record (capture-model.js record, public.capture_save's
  // argument) and its photo and thumbnail. Throws a plain sentence when the phone will not keep it. Returns { clientId, sending }.
  async function keep({ org, kind, taken, position, note, tags, shared, fields, prepared }) {
    const clientId = uuid(), files = prepared ? C().paths(org, me, clientId) : null;
    const record = C().record({ clientId, org, user: me, kind, taken, position, note, tags, shared, fields,
      photo: prepared ? { width: prepared.width, height: prepared.height, bytes: prepared.photo.size, thumb: !!prepared.thumb } : null });
    const op = Q().groupCaptureOp({ user: me, record, photo: files ? { blob: prepared.photo, path: files.photo } : null, thumb: files && prepared.thumb ? { blob: prepared.thumb, path: files.thumb } : null,
      at: new Date().toISOString(), uuid });
    const q = queue();
    if (!q) throw Object.assign(Error("Sign in again to save photos here."), { plain: true });
    try { await q.add(op); }
    catch (e) {
      // the phone refused to keep it (storage full, or storage blocked): say so, and keep the photo on this screen
      throw Object.assign(Error(/quota|space|storage/i.test(String(e?.name) + " " + String(e?.message)) ?
        "This phone has no room left to keep the photo. Free some space, or keep this screen open and try Save again when you're back in range." :
        "This phone wouldn't keep the photo (" + (e?.message || e) + "). Keep this screen open and try Save again."), { plain: true });
    }
    root.navigator.storage?.persist?.().catch(() => {});   // ask the browser not to clear what waits
    rememberTags(org, tags);
    return { clientId, sending: confirmed && root.navigator.onLine !== false };
  }

  // ---- PH1: the quick photo on a phone ------------------------------------------------------------------------------------------------
  // + then Take a photo: the phone's position is needed first (the owner: GPS on is the prerequisite for photos). With a fresh one the
  // camera opens at once; otherwise the phone is asked, and the camera opens as soon as it answers (or from the "Open the camera" row
  // where the browser wants another tap). Refused or unavailable: one sentence and a "Try again" row, and no photo. After the shot:
  // the photo, an optional tag from one line of quiet chips (CAP1's tags), an optional one-line note, Save. The capture carries the
  // phone's own position, its accuracy and the time (from the device, never read from the photo), and is kept by the same queue, so
  // it works offline. So: + then Take a photo, the shutter, then Save.
  function quick(ctx) {
    close();
    const P = FP.phoneModel, places = placesFor(ctx);
    let placeName = places[0]?.name || ctx.name;
    const st = { org: places[0]?.id || ctx.id, fix: null, prepared: null, shotAt: null, tags: new Set(), chips: [], busy: false, reading: 0, note: null };
    const camera = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, id: "qp-camera" });
    const body = el("div", { class: "cap-body qp-body" });
    // PH4: the form pattern's sheet: Cancel, the title, Save (shown once there is a photo); the camera input kept inside it
    const R = FP.formRows;
    const s0 = R.sheet({ id: "qp-screen", title: "Photo", titleId: "qp-title", saveId: "qp-save", cancelId: "qp-close", className: "cap-screen qp", onSave: () => doSave(), onCancel: () => close(true) });
    const node = s0.node, save = s0.save;
    s0.cancel.setAttribute("aria-label", "Cancel: close without saving");
    s0.body.replaceWith(body);
    body.classList.add("fs-body");
    s0.sheet.append(camera);
    node.dataset.state = "locating";
    save.hidden = true;
    const from = root.document.activeElement;
    screen = { node, ctx, opener: from && from !== root.document.body && from.isConnected ? from : (FP.add?.buttons?.() || []).find((b) => !b.hidden && b.getClientRects().length) || null };
    root.document.body.append(node);
    s0.mounted();
    root.document.body.classList.add("cap-open");
    const live = () => screen?.node === node;
    // plain rows in one outline (the owner's guide): a small leading icon, then the words; the primary row's icon in a filled circle
    const row = (id, icon, words, onclick, primary = false) => el("button", { type: "button", class: "qp-row" + (primary ? " qp-primary" : ""), id, onclick },
      el("span", { class: "qp-dot", "aria-hidden": "true" }, FP.icon(icon, primary ? 18 : 20)), el("span", {}, words));
    const set = (...rows) => el("div", { class: "qp-set", role: "group" }, ...rows);
    const msg = el("p", { class: "cap-msg", role: "status", id: "qp-msg" });
    const whereWords = () => [places.length > 1 && st.prepared ? null : "To " + placeName, st.shotAt ? C().when(st.shotAt) : null, st.fix ? "here, " + P.accuracyWords(st.fix.accuracy).replace(/ /g, "\u00a0") : null].filter(Boolean).join(" · ");
    let where = null;
    const drawWhere = () => { if (where) where.textContent = whereWords(); };

    function show(state, problem = null) {
      node.dataset.state = state;
      save.hidden = state !== "photo";
      if (state === "locating") body.replaceChildren(el("p", { class: "qp-quiet", role: "status", id: "qp-locating" }, "Finding your position…"));
      else if (state === "refused") {
        // PH2: what is wrong, then where this phone turns location on, step by step (an iPhone's Settings and Safari's page menu; an
        // Android phone's Settings and Chrome), then Try again, which asks the phone again from that tap
        const why = P.photoProblem(problem, FP.locate.platform?.() || "other", root.navigator.userAgent || "");
        body.replaceChildren(el("p", { class: "qp-say", id: "qp-needs", role: "alert", "data-why": why.key }, why.text),
          ...(why.help?.length ? [el("ol", { class: "qp-help", id: "qp-help" }, ...why.help.map((h) => el("li", {}, h)))] : []),
          set(row("qp-retry", "locate", "Try again", () => openCamera())));
        body.querySelector("#qp-retry")?.focus();
      } else if (state === "ready") {
        where = el("p", { class: "qp-quiet qp-where", id: "qp-where" }, whereWords());
        body.replaceChildren(set(row("qp-open", "camera", "Open the camera", () => openCamera(), true)), where, msg);
      }
    }
    // No position (refused, off, slow or unavailable): the held one is dropped, the photo with it, and nothing is saved (review of #535, 1)
    function refuse(problem) {
      st.fix = null; st.prepared = null; st.shotAt = null; st.reading++;
      show("refused", problem);
    }
    // The camera opens only with a fresh position: one held from the last two minutes, with location not refused since, opens it on
    // this same tap; otherwise the phone is asked first ("Open the camera", "Take it again" and "Try again" all come here)
    function openCamera() {
      const supported = !!root.navigator.geolocation;
      const gate = P.photoGate({ permission: FP.locate.permissionNow(), last: FP.locate.last(), supported });
      if (gate === "refused") { refuse({ key: "off" }); return; }
      if (gate === "go") {
        st.fix = FP.locate.last();
        if (node.dataset.state !== "photo") show("ready");
        try { camera.click(); } catch { /* the "Open the camera" row */ }
        return;
      }
      ask();
    }
    // the person's position, then the camera (it opens if the browser still counts the tap; otherwise the "Open the camera" row).
    // PH2: the phone is asked before anything is awaited, so the request is the tap's own (iPhone Safari), and always asked, even
    // where the browser last said "denied": its answer decides, and a phone put right in Settings is then let through
    async function ask() {
      const asked = FP.locate.get({ maxAge: P.PHOTO_FIX_AGE });
      show("locating");
      const got = await asked;
      if (!live()) return;
      if (!got.ok) { refuse(got.problem); return; }
      st.fix = got.fix; show("ready");
      try { camera.click(); } catch { /* the "Open the camera" row */ }
    }
    camera.addEventListener("change", () => { const f = camera.files?.[0]; camera.value = ""; if (f) usePhoto(f); });

    async function usePhoto(file) {
      const mine = ++st.reading, shot = new Date().toISOString();
      body.replaceChildren(el("p", { class: "qp-quiet", role: "status" }, "Reading the photo…"));
      save.hidden = true;
      // the position at the shot: one from the two minutes before it, or asked for now; none means no photo
      let f = FP.locate.permissionNow() === "denied" ? null : P.fixForShot(FP.locate.last(), shot);
      if (!f) {
        const got = await FP.locate.get({ maxAge: P.PHOTO_FIX_AGE });
        if (!live() || mine !== st.reading) return;
        f = got.ok ? P.fixForShot(got.fix, shot) : null;
        if (!f) { refuse(got.ok ? { key: "unavailable" } : got.problem); return; }
      }
      st.fix = f; st.shotAt = shot;
      // a newer position, if the phone gives one soon (it stands only if it is still the shot's); a refusal drops the held one
      FP.locate.get({ maxAge: 10000 }).then((r) => {
        if (!live() || st.reading !== mine) return;
        if (r.ok && P.fixForShot(r.fix, shot)) { st.fix = r.fix; drawWhere(); }
        else if (!r.ok && r.problem?.key === "refused") st.fix = null;
      });
      const got = await prepare(file);
      if (!live() || mine !== st.reading) return;
      if (!got || got.tooBig) { show("ready"); msg.textContent = got?.tooBig ? "This photo is too large to send, even made smaller. Take it again." : "This photo can't be read here. Take it again."; return; }
      if (st.prepared) node.querySelectorAll("img").forEach((i) => { if (i.src.startsWith("blob:")) URL.revokeObjectURL(i.src); });
      st.prepared = got;
      drawPhoto();
    }
    // PH4: after the shot, the photo fills the top; under it at most three rows: Tag (a short list with ticks; none chosen for the
    // person, as before), Note (one row that grows), and Place only where there is a real choice; Save in the top row
    function drawPhoto() {
      const img = el("img", { class: "cap-img qp-img", id: "qp-img", alt: "The photo you took", src: URL.createObjectURL(st.prepared.photo) });
      const tagRow = R.pick({ id: "qp-tags", key: "tags", label: "Tag", title: "Tags", multi: true, empty: "Optional", max: C().MAX_TAGS, tooMany: "At most " + C().MAX_TAGS + " tags.",
        options: () => C().tidyTags([...st.chips, ...st.tags]).map((t) => ({ value: t, label: t })), value: () => [...st.tags], onPick: (v) => { st.tags = new Set(C().tidyTags(v)); },
        allowNew: { label: "New tag", placeholder: "Type a tag", max: C().MAX_TAG, tidy: (t) => C().tidyTags([t])[0] || "" } });
      tagChoices(st.org, null).then((list) => { st.chips = C().tidyTags(list); if (live()) tagRow._draw(); });
      const noteRow = R.long({ id: "qp-note", key: "note", label: "Note", placeholder: "Optional", max: C().MAX_NOTE });
      const placeRow = places.length > 1 ? R.pick({ id: "qp-place", key: "place", label: "Save to", title: "Save it to", options: places.map((g) => ({ value: g.id, label: g.name })), value: () => st.org,
        onPick: (v) => { st.org = v; placeName = places.find((g) => g.id === v)?.name || placeName; drawWhere(); tagChoices(st.org, null).then((l) => { st.chips = C().tidyTags(l); tagRow._draw(); }); } }) : null;
      where = el("p", { class: "fs-quiet qp-where", id: "qp-where" });
      drawWhere();
      const again = el("button", { type: "button", class: "qp-again", id: "qp-again", onclick: () => openCamera() }, FP.icon("camera", 16), el("span", {}, "Take it again"));
      body.replaceChildren(el("div", { class: "qp-photo" }, img, again), R.set(tagRow, noteRow, placeRow), where, msg);
      st.note = noteRow._input;
      show("photo");
      s0.top.querySelector(".fs-title")?.focus();   // (the sheet's title, not Save: no ring drawn round the action; Tab goes on to the rows)
    }
    async function doSave() {
      if (st.busy || !st.prepared) return;
      // the position is the condition for a photo: the shot's own (from the two minutes before it), and location still on at Save;
      // otherwise nothing is saved (review of #535, 1)
      if (FP.locate.permissionNow() === "denied" || !P.fixForShot(st.fix, st.shotAt)) { refuse({ key: "refused" }); return; }
      st.busy = true; save.disabled = true; msg.textContent = "";
      if (!P.fixForShot(FP.locate.last(), Date.now())) {
        const now = await FP.locate.get({ maxAge: P.PHOTO_FIX_AGE });
        if (!live()) return;
        if (!now.ok) { st.busy = false; save.disabled = false; refuse(now.problem); return; }
      }
      try {
        const { clientId, sending } = await keep({ org: st.org, kind: "photo", taken: { at: st.shotAt, from: "device" }, position: C().position({ device: st.fix }),
          note: st.note?.value || "", tags: [...st.tags], shared: false, fields: {}, prepared: st.prepared });
        const to = st.org;
        close(true);
        saved(to, clientId, sending);
        badge();
      } catch (e) { msg.textContent = e.plain ? e.message : e.message || String(e); st.busy = false; save.disabled = false; }
    }

    // the gate: a fresh position opens the camera on this same tap; otherwise the phone is asked first
    openCamera();
  }

  // The water sample's site and readings; pest control's species and count, as rows (PH4). Each kind: { main: rows first (the fewest
  // that make a valid record), more: rows under More details, after: lines after the sets, first: the row to focus, values(),
  // showProblems(probs), positionChanged?(p), placeChanged?() }.
  function kindFields(kind, st, { R }) {
    if (kind === "water_sample") {
      let sites = [], near = [];
      const nameRow = R.text({ id: "cap-site-name", key: "site-name", label: "Site", placeholder: "Name of the place (optional)", max: 120 });
      const siteRow = R.pick({ id: "cap-site", key: "site", label: "Site", title: "Which site", empty: "Choose", value: () => st.site ?? null,
        options: () => C().siteOptions(sites, C().position({ meta: st.meta, device: st.device, pin: st.pin }), 5),
        onPick: (v) => { st.site = v; st.siteAuto = false; drawSites(); if (v === "") nameRow._input.focus(); } });
      // the nearest known site first (the group's sites the person may read, read once a session, at most five offered)
      const drawSites = (p = C().position({ meta: st.meta, device: st.device, pin: st.pin })) => {
        near = C().nearest(sites, p, 5);
        // review of #539, 2: put at a site by itself only when the position is at it; the person's own choice stays while it is listed
        if (st.siteAuto || st.site == null) { const close = C().closeSite(sites, p); st.site = close ? String(close.site_id) : null; st.siteAuto = true; }
        if (st.site && !near.some((x) => String(x.site_id) === st.site)) st.site = null;
        siteRow.hidden = !near.length;
        nameRow.hidden = near.length > 0 && st.site !== "";   // (a typed name only once "Another place" is chosen, or with no site near)
        nameRow.querySelector(".fs-label").textContent = near.length ? "Site name" : "Site";
        siteRow._draw();
      };
      const load = () => sitesFor(st.org).then((x) => { sites = x; drawSites(); });
      load();
      // a reading: what (in the label's place, quiet), the number (large) and its unit, in one row
      const readings = [];
      const readingRow = (i) => {
        const name = R.input({ type: "text", class: "fs-input fs-label-input cap-r-name", maxlength: "40", placeholder: i ? "What" : "Nitrate", "aria-label": "Reading " + (i + 1) + ": what" });
        const unit = R.input({ type: "text", class: "fs-input fs-unit-input cap-r-unit", maxlength: "20", placeholder: "mg/L", "aria-label": "Reading " + (i + 1) + ": unit" });
        const r = R.big({ id: "cap-r-value-" + i, key: "reading-" + i, labelNode: el("span", { class: "fs-label" }, name), placeholder: "0.0",
          attrs: { class: "fs-input fs-big-input cap-r-value", "aria-label": "Reading " + (i + 1) + ": value" }, unit });
        r.classList.add("cap-reading");
        r.dataset.reading = String(i);
        readings.push(r);
        return r;
      };
      const first = readingRow(0);
      const addOne = R.action({ id: "cap-reading-add", key: "reading-add", icon: "plus", label: "Add another reading", onClick: () => {
        if (readings.length >= C().MAX_READINGS) return;
        const r = readingRow(readings.length);
        addOne.before(r);
        addOne.hidden = readings.length >= C().MAX_READINGS;
        r.querySelector(".cap-r-name")?.focus();
      } });
      const showProblems = (probs) => {
        readings.forEach((w, i) => { const p = probs.find((x) => x.key === "reading-" + i); R.say(w, p ? p.text : ""); });
        readings.find((w) => w.querySelector("[aria-invalid=true]"))?.querySelector(".cap-r-value")?.focus();
      };
      return { main: [siteRow, nameRow, first], more: [addOne], first: first.querySelector(".cap-r-value"),
        after: [R.quiet("Lab results are added to this record later. They stay the group's record: nothing here goes into the regional council's water quality data.", { class: "fs-quiet cap-lab" })],
        positionChanged: (p) => drawSites(p), placeChanged: load, showProblems,
        values: () => {
          const pick = !siteRow.hidden && st.site ? sites.find((x) => String(x.site_id) === st.site) : null;
          return { site_id: pick ? pick.site_id : null, site_name: pick ? pick.name : nameRow._input.value,
            readings: readings.map((r) => ({ name: r.querySelector(".cap-r-name").value, value: r.querySelector(".cap-r-value").value, unit: r.querySelector(".cap-r-unit").value })) };
        } };
    }
    if (kind === "pest_control") {
      const what = R.pick({ id: "cap-species", key: "species", label: "What", title: "What", empty: "Choose", value: () => st.species ?? "",
        options: [...C().SPECIES.map(([k, label]) => ({ value: k, label })), { value: "", label: "Not sure" }], onPick: (v) => { st.species = v || null; } });
      const count = R.big({ id: "cap-count", key: "count", label: "How many", value: "1", inputmode: "numeric", placeholder: "0" });
      count._input.setAttribute("aria-describedby", "cap-count-msg");
      const showProblems = (probs) => { const p = probs.find((x) => x.key === "count"); R.say(count, p ? p.text : ""); if (p) count._input.focus(); };
      return { main: [what, count], first: count._input, showProblems, values: () => ({ species: st.species, count: count._input.value }) };
    }
    return { main: [], values: () => ({}) };
  }
  function close(refocus = false) {
    if (!screen) return;
    const { node, opener } = screen;
    screen = null;
    node.querySelectorAll("img").forEach((i) => { if (i.src.startsWith("blob:")) URL.revokeObjectURL(i.src); });
    node.remove();
    root.document.body.classList.remove("cap-open");
    if (refocus && opener?.isConnected) opener.focus();
  }

  // ---- after Save: a quiet line that opens it ---------------------------------------------------------------------------------------------
  function saved(org, clientId, sending) {
    let t = root.document.getElementById("cap-saved");
    if (!t) { t = el("div", { id: "cap-saved", class: "cap-saved", role: "status" }); root.document.body.append(t); }
    const href = FP.href(FP.groupModel.href(org, "records", clientId));
    t.replaceChildren(el("a", { href, class: "cap-saved-link", "data-capture": clientId }, sending ? C().SAVED : C().SAVED_OFFLINE, el("span", { class: "cap-saved-open" }, "View")));
    t.hidden = false;
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true; }, sending ? 5000 : 8000);
    t.querySelector("a").addEventListener("click", () => { t.hidden = true; });
  }

  root.addEventListener("hashchange", () => close(false));
  FP.captures = { start, close, signedIn, offline, beforeSignOut, rememberPlaces, lastPlaces, badge, waiting, sendNow: () => queue()?.sync(),
    userId: () => me, confirmed: () => confirmed, isOpen: () => !!screen, prepare, quick, sitesFor };
})(window);
