// CAP1: capture on a phone. "Take a photo" is the fastest path in the app: tap + then Photo, the camera opens, then one short screen
// (the photo, tag chips, an optional note, the place, where and when it was taken) and one filled button, Save. A water sample and pest
// control are the same screen with a tag preset and a few fields of their own. Save never waits for the network: the capture (the
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

  // ---- the phone's own position, when the person allows it --------------------------------------------------------------------------------
  function here() {
    return new Promise((resolve) => {
      const g = root.navigator.geolocation;
      if (!g) { resolve(null); return; }
      try { g.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }), () => resolve(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }); }
      catch { resolve(null); }
    });
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
    try { camera.click(); } catch { /* the screen's own buttons */ }
  }

  function open(ctx, kind, camera, library) {
    close();
    const places = placesFor(ctx);
    const st = { kind, org: places[0]?.id || ctx.id, file: null, prepared: null, meta: null, device: null, pin: null, tags: new Set(C().KINDS[kind].preset ? [C().KINDS[kind].preset] : []),
      chips: [], busy: false, asked: false, reading: 0, species: kind === "pest_control" ? "deer" : null };
    const title = C().KINDS[kind].title;
    const msg = el("p", { class: "cap-msg", role: "status", id: "cap-msg" });

    // the photo
    const img = el("img", { class: "cap-img", id: "cap-img", alt: "", hidden: true });
    const take = el("button", { type: "button", class: "cap-take", id: "cap-take" }, FP.icon("camera", 22), el("span", {}, "Take a photo"));
    const choose = el("button", { type: "button", class: "link cap-choose", id: "cap-choose" }, "Choose from your photos");
    const again = el("button", { type: "button", class: "link cap-again", id: "cap-again", hidden: true }, "Take another");
    const photoBox = el("div", { class: "cap-photo", "data-has-photo": "false" }, img, el("div", { class: "cap-photo-empty" }, take, choose), again, camera, library);
    take.addEventListener("click", () => camera.click());
    again.addEventListener("click", () => camera.click());
    choose.addEventListener("click", () => library.click());
    for (const input of [camera, library]) input.addEventListener("change", () => { const f = input.files?.[0]; input.value = ""; if (f) usePhoto(f); });

    // tags
    const chipsBox = el("div", { class: "cap-chips", role: "group", "aria-label": "Tags" });
    const newTag = el("input", { type: "text", id: "cap-tag-new", class: "cap-tag-new", maxlength: String(C().MAX_TAG), placeholder: "Add a tag", enterkeyhint: "done", autocomplete: "off", "aria-label": "Add a tag" });
    const addTag = el("button", { type: "button", class: "cap-tag-add", id: "cap-tag-add", "aria-label": "Add this tag" }, FP.icon("plus", 18));
    function drawChips() {
      const names = C().tidyTags([...st.chips, ...st.tags]);
      chipsBox.replaceChildren(...names.map((t) => {
        const on = [...st.tags].some((x) => x.toLowerCase() === t.toLowerCase());
        const b = el("button", { type: "button", class: "chip cap-chip", "aria-pressed": String(on), "data-tag": t }, t);
        b.addEventListener("click", () => { for (const x of [...st.tags]) if (x.toLowerCase() === t.toLowerCase()) st.tags.delete(x); if (!on) st.tags.add(t); drawChips(); chipsBox.querySelector('[data-tag="' + CSS.escape(t) + '"]')?.focus(); });
        return b;
      }));
    }
    function typedTag() {
      const t = C().tidyTags([newTag.value])[0];
      if (!t) return;
      if (C().tidyTags([...st.tags, t]).length > C().MAX_TAGS) { msg.textContent = "At most " + C().MAX_TAGS + " tags."; return; }
      st.tags.add(t); if (!st.chips.some((x) => x.toLowerCase() === t.toLowerCase())) st.chips.push(t);
      newTag.value = ""; drawChips();
    }
    addTag.addEventListener("click", typedTag);
    newTag.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); typedTag(); } });
    const tagsBox = el("fieldset", { class: "cap-tags" }, el("legend", {}, "Tags"), chipsBox, el("div", { class: "cap-tag-row" }, newTag, addTag));
    tagChoices(st.org, C().KINDS[kind].preset).then((list) => { st.chips = list; if (screen?.node === node) drawChips(); });
    drawChips();

    // the kind's own fields
    const fields = kindFields(kind, st);

    // note
    const note = el("input", { type: "text", id: "cap-note", maxlength: String(C().MAX_NOTE), placeholder: "Optional", autocomplete: "off", enterkeyhint: "done" });
    const noteBox = el("label", { class: "cap-field", for: "cap-note" }, el("span", {}, "Note"), note);

    // the place
    let placeBox;
    if (places.length > 1) {
      const sel = el("select", { id: "cap-place" }, ...places.map((g) => el("option", { value: g.id, selected: g.id === st.org }, g.name)));
      sel.addEventListener("change", () => { st.org = sel.value; tagChoices(st.org, C().KINDS[kind].preset).then((l) => { st.chips = l; drawChips(); }); fields.placeChanged?.(); });
      placeBox = el("label", { class: "cap-field", for: "cap-place" }, el("span", {}, "Place"), sel);
    } else placeBox = el("p", { class: "cap-line cap-place", id: "cap-place-line" }, FP.icon("places", 18), el("span", {}, "To ", el("b", {}, places[0]?.name || ctx.name)));

    // where and when
    const posText = el("span", { id: "cap-pos-text" });
    const useHere = el("button", { type: "button", class: "link", id: "cap-use-here" }, "Use my location");
    const dropPin = el("button", { type: "button", class: "link", id: "cap-drop-pin", "aria-expanded": "false" }, "Drop a pin");
    const pinMap = el("div", { class: "cap-pin-map", id: "cap-pin-map", hidden: true });
    const posBox = el("div", { class: "cap-line cap-pos" }, el("span", { class: "cap-dot", "aria-hidden": "true" }), posText, el("span", { class: "cap-pos-acts" }, useHere, dropPin));
    const timeText = el("span", { id: "cap-time-text" });
    const timeBox = el("p", { class: "cap-line cap-time" }, FP.icon("events", 18), timeText);
    const pos = () => C().position({ meta: st.meta, device: st.device, pin: st.pin });
    const taken = () => C().takenAt(st.meta, new Date().toISOString());
    function drawWhere() {
      const p = pos();
      posText.textContent = C().positionLine(p);
      posBox.dataset.has = p ? "true" : "false";
      const t = taken();
      timeText.textContent = "Taken " + C().when(t.at) + (t.from === "photo" ? " (from the photo)" : "");
      fields.positionChanged?.(p);
      drawShared?.();
    }
    useHere.addEventListener("click", async () => { posText.textContent = "Finding where you are…"; st.device = await here(); st.pin = null; if (!st.device) msg.textContent = "This phone didn't give a position. Drop a pin instead, or save without one."; drawWhere(); });
    dropPin.addEventListener("click", () => togglePin());
    let map = null, marker = null;
    function togglePin() {
      const opening = pinMap.hidden;
      pinMap.hidden = !opening; dropPin.setAttribute("aria-expanded", String(opening));
      if (!opening) { map?.remove(); map = null; marker = null; return; }
      const gl = root.maplibregl, p = pos();
      if (!gl || root.navigator.onLine === false) { pinMap.replaceChildren(el("p", { class: "cap-quiet" }, "The map needs a connection. Save without a position, or with the one shown.")); return; }
      try {
        gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js");
        map = new gl.Map({ container: pinMap, style: FP.basemaps.style("aerial"), ...(p ? { center: [p.longitude, p.latitude], zoom: 15 } : { bounds: [[166.3, -47.4], [178.6, -34.3]] }), attributionControl: { compact: true } });
        if (p) marker = new gl.Marker().setLngLat([p.longitude, p.latitude]).addTo(map);
        map.on("click", (e) => { st.pin = { lat: e.lngLat.lat, lon: e.lngLat.lng }; if (marker) marker.setLngLat(e.lngLat); else marker = new gl.Marker().setLngLat(e.lngLat).addTo(map); drawWhere(); });
      } catch { pinMap.replaceChildren(el("p", { class: "cap-quiet" }, "The map couldn't open here.")); }
    }

    // share
    const share = el("input", { type: "checkbox", id: "cap-share" });
    const shareBox = el("label", { class: "cap-share", for: "cap-share" }, share, el("span", {}, el("b", {}, "Share with everyone in the group"), el("small", {}, "Otherwise only you and the group's coordinators see it.")));

    // Save: the one filled button
    const save = el("button", { type: "button", class: "cap-save", id: "cap-save" }, "Save");
    save.addEventListener("click", () => doSave());
    const shut = el("button", { type: "button", class: "cap-close", id: "cap-close", "aria-label": "Close without saving" }, FP.icon("close", 22));
    shut.addEventListener("click", () => close(true));

    // review of #529, 2: shared with the group, its position goes with it: said quietly under the position line
    const sharedWhere = el("p", { class: "cap-quiet cap-shared-where", id: "cap-shared-where", hidden: true }, "Shared with the group, so is where it was taken.");
    const drawShared = () => { sharedWhere.hidden = !(share.checked && pos()); };
    share.addEventListener("change", drawShared);
    const body = el("div", { class: "cap-body" }, photoBox, tagsBox, fields.node, noteBox, placeBox, posBox, sharedWhere, pinMap, timeBox, shareBox, msg);
    const node = el("div", { class: "cap-screen", id: "cap-screen", role: "dialog", "aria-modal": "true", "aria-labelledby": "cap-title", "data-kind": kind },
      el("header", { class: "cap-head" }, shut, el("h2", { id: "cap-title" }, title), el("span", { class: "cap-head-gap" })),
      body, el("footer", { class: "cap-foot" }, save));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(true); return; }
      if (e.key !== "Tab") return;
      const f = [...node.querySelectorAll("button:not([disabled]), input:not([hidden]):not([type=file]), select, textarea, a[href]")].filter((x) => x.getClientRects().length);
      if (!f.length) return;
      if (e.shiftKey && root.document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && root.document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    // (back to what opened it: a Home tile, or the + when the ring that opened it has gone)
    const from = root.document.activeElement;
    screen = { node, ctx, opener: from && from !== root.document.body && from.isConnected ? from : (FP.add?.buttons?.() || []).find((b) => !b.hidden && b.getClientRects().length) || null };
    root.document.body.append(node);
    root.document.body.classList.add("cap-open");
    drawWhere();
    take.focus();

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
      if (img.src) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(got.photo); img.hidden = false; img.alt = "The photo you took";
      photoBox.dataset.hasPhoto = "true"; again.hidden = false;
      msg.textContent = "";
      // (review of #529, 2: the phone is asked for its position only when the person taps "Use my location", never by itself)
      drawWhere();
    }

    async function doSave() {
      if (st.busy) return;
      st.busy = true; save.disabled = true; msg.textContent = "";
      try {
        const typed = fields.values(), probs = C().fieldProblems(kind, typed);
        fields.showProblems?.(probs);
        if (probs.length) throw Object.assign(Error(probs.length === 1 ? "Check the field marked above." : "Check the fields marked above."), { plain: true });
        const { clientId, sending } = await keep({ org: st.org, kind, taken: taken(), position: pos(), note: note.value, tags: [...st.tags], shared: share.checked,
          fields: fields.values(), prepared: st.prepared });
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
    const P = FP.phoneModel, places = placesFor(ctx), placeName = places[0]?.name || ctx.name;
    const st = { org: places[0]?.id || ctx.id, fix: null, prepared: null, shotAt: null, tags: new Set(), chips: [], busy: false, reading: 0, note: null };
    const camera = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, id: "qp-camera" });
    const body = el("div", { class: "cap-body qp-body" });
    const save = el("button", { type: "button", class: "cap-save", id: "qp-save" }, "Save");
    const foot = el("footer", { class: "cap-foot qp-foot", hidden: true }, save);
    const shut = el("button", { type: "button", class: "cap-close", id: "qp-close", "aria-label": "Close without saving" }, FP.icon("close", 22));
    const node = el("div", { class: "cap-screen qp", id: "qp-screen", role: "dialog", "aria-modal": "true", "aria-labelledby": "qp-title", "data-state": "locating" },
      el("header", { class: "cap-head" }, shut, el("h2", { id: "qp-title" }, "Photo"), el("span", { class: "cap-head-gap" })), body, foot, camera);
    shut.addEventListener("click", () => close(true));
    node.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(true); } });
    const from = root.document.activeElement;
    screen = { node, ctx, opener: from && from !== root.document.body && from.isConnected ? from : (FP.add?.buttons?.() || []).find((b) => !b.hidden && b.getClientRects().length) || null };
    root.document.body.append(node);
    root.document.body.classList.add("cap-open");
    const live = () => screen?.node === node;
    // plain rows in one outline (the owner's guide): a small leading icon, then the words; the primary row's icon in a filled circle
    const row = (id, icon, words, onclick, primary = false) => el("button", { type: "button", class: "qp-row" + (primary ? " qp-primary" : ""), id, onclick },
      el("span", { class: "qp-dot", "aria-hidden": "true" }, FP.icon(icon, primary ? 18 : 20)), el("span", {}, words));
    const set = (...rows) => el("div", { class: "qp-set", role: "group" }, ...rows);
    const msg = el("p", { class: "cap-msg", role: "status", id: "qp-msg" });
    const whereWords = () => ["To " + placeName, st.shotAt ? C().when(st.shotAt) : null, st.fix ? P.accuracyWords(st.fix.accuracy) : null].filter(Boolean).join(" · ");
    let where = null;
    const drawWhere = () => { if (where) where.textContent = whereWords(); };

    function show(state, problem = null) {
      node.dataset.state = state;
      foot.hidden = state !== "photo";
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
      foot.hidden = true;
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
    function drawPhoto() {
      const img = el("img", { class: "cap-img qp-img", id: "qp-img", alt: "The photo you took", src: URL.createObjectURL(st.prepared.photo) });
      const chips = el("div", { class: "qp-tags", role: "group", "aria-label": "Tag (optional)", id: "qp-tags" });
      const drawChips = () => chips.replaceChildren(...st.chips.map((t) => {
        const on = [...st.tags].some((x) => x.toLowerCase() === t.toLowerCase());
        const b = el("button", { type: "button", class: "chip qp-chip", "aria-pressed": String(on), "data-tag": t }, t);
        b.addEventListener("click", () => { for (const x of [...st.tags]) if (x.toLowerCase() === t.toLowerCase()) st.tags.delete(x); if (!on) st.tags.add(t); drawChips(); chips.querySelector('[data-tag="' + CSS.escape(t) + '"]')?.focus(); });
        return b;
      }));
      tagChoices(st.org, null).then((list) => { st.chips = P.quickTags(list); if (live()) drawChips(); });
      const note = el("input", { type: "text", id: "qp-note", class: "qp-note", maxlength: String(C().MAX_NOTE), placeholder: "Add a note (optional)", autocomplete: "off", enterkeyhint: "done", "aria-label": "Note (optional)" });
      note.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); note.blur(); } });
      where = el("p", { class: "qp-quiet qp-where", id: "qp-where" });
      drawWhere();
      const again = el("button", { type: "button", class: "link qp-again", id: "qp-again", onclick: () => openCamera() }, "Take it again");
      body.replaceChildren(el("div", { class: "qp-photo" }, img, again), chips, note, where, msg);
      st.note = note;
      show("photo");
      drawChips();
      save.focus();
    }
    save.addEventListener("click", async () => {
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
    });

    // the gate: a fresh position opens the camera on this same tap; otherwise the phone is asked first
    openCamera();
  }

  // The water sample's site and readings; pest control's species and count. Each kind: { node, values(), positionChanged?(p) }.
  function kindFields(kind, st) {
    if (kind === "water_sample") {
      const siteSel = el("select", { id: "cap-site", hidden: true });
      const siteName = el("input", { type: "text", id: "cap-site-name", maxlength: "120", placeholder: "Site name (optional)", autocomplete: "off" });
      const rows = el("div", { class: "cap-readings" });
      const more = el("button", { type: "button", class: "link", id: "cap-reading-add" }, "Add a reading");
      const addRow = () => {
        const i = rows.childElementCount;
        if (i >= C().MAX_READINGS) return;
        rows.append(el("div", { class: "cap-reading-wrap", "data-reading-wrap": String(i) }, el("div", { class: "cap-reading", "data-reading": String(i) },
          el("input", { type: "text", class: "cap-r-name", maxlength: "40", placeholder: "Nitrate", "aria-label": "Reading " + (i + 1) + ": what" }),
          el("input", { type: "text", class: "cap-r-value", inputmode: "decimal", placeholder: "0.0", "aria-label": "Reading " + (i + 1) + ": value" }),
          el("input", { type: "text", class: "cap-r-unit", maxlength: "20", placeholder: "mg/L", "aria-label": "Reading " + (i + 1) + ": unit" })),
          el("p", { class: "cap-field-msg", id: "cap-reading-msg-" + i, role: "status" })));
        more.hidden = rows.childElementCount >= C().MAX_READINGS;
      };
      more.addEventListener("click", () => { addRow(); rows.lastElementChild?.querySelector("input")?.focus(); });
      addRow();
      let sites = [];
      const drawSites = (p) => {
        const near = C().nearest(sites, p, 5);
        siteSel.hidden = !near.length; siteName.hidden = near.length > 0 && siteSel.value !== "";
        if (!near.length) return;
        const was = siteSel.value;
        siteSel.replaceChildren(el("option", { value: "" }, "Another place (type it)"), ...near.map((s) => el("option", { value: String(s.site_id), selected: String(s.site_id) === was }, s.name + " · " + C().kmWords(s.km))));
        siteName.hidden = siteSel.value !== "";
      };
      siteSel.addEventListener("change", () => { siteName.hidden = siteSel.value !== ""; });
      const load = () => sitesFor(st.org).then((s) => { sites = s; drawSites(C().position({ meta: st.meta, device: st.device, pin: st.pin })); });
      load();
      const node = el("fieldset", { class: "cap-kind cap-water" }, el("legend", {}, "Sample"),
        el("label", { class: "cap-field", for: "cap-site" }, el("span", {}, "Site"), siteSel, siteName), el("p", { class: "cap-sub" }, "Field readings (optional)"), rows, more,
        el("p", { class: "cap-quiet" }, "Lab results are added to this record later. They stay the group's record: nothing here goes into the regional council's water quality data."));
      const showProblems = (probs) => {
        [...rows.children].forEach((w, i) => {
          const p = probs.find((x) => x.key === "reading-" + i), v = w.querySelector(".cap-r-value");
          v.setAttribute("aria-invalid", p ? "true" : "false"); v.setAttribute("aria-describedby", "cap-reading-msg-" + i);
          w.querySelector(".cap-field-msg").textContent = p ? p.text : "";
        });
        rows.querySelector("[aria-invalid=true]")?.focus();
      };
      return { node, positionChanged: drawSites, placeChanged: load, showProblems,
        values: () => {
          const pick = !siteSel.hidden && siteSel.value ? sites.find((s) => String(s.site_id) === siteSel.value) : null;
          return { site_id: pick ? pick.site_id : null, site_name: pick ? pick.name : siteName.value,
            readings: [...rows.children].map((w) => w.querySelector(".cap-reading")).map((r) => ({ name: r.querySelector(".cap-r-name").value, value: r.querySelector(".cap-r-value").value, unit: r.querySelector(".cap-r-unit").value })) };
        } };
    }
    if (kind === "pest_control") {
      const group = el("div", { class: "cap-chips", role: "group", "aria-label": "Species" });
      const draw = () => group.replaceChildren(...C().SPECIES.map(([k, label]) => {
        const b = el("button", { type: "button", class: "chip cap-chip", "aria-pressed": String(st.species === k), "data-species": k }, label);
        b.addEventListener("click", () => { st.species = st.species === k ? null : k; draw(); group.querySelector('[data-species="' + k + '"]')?.focus(); });
        return b;
      }));
      draw();
      const count = el("input", { type: "text", id: "cap-count", inputmode: "numeric", value: "1", "aria-label": "How many", class: "cap-count", "aria-describedby": "cap-count-msg" });
      const countMsg = el("p", { class: "cap-field-msg", id: "cap-count-msg", role: "status" });
      const showProblems = (probs) => { const p = probs.find((x) => x.key === "count"); count.setAttribute("aria-invalid", p ? "true" : "false"); countMsg.textContent = p ? p.text : ""; if (p) count.focus(); };
      const node = el("fieldset", { class: "cap-kind cap-pest" }, el("legend", {}, "What"), group,
        el("label", { class: "cap-field cap-field-short", for: "cap-count" }, el("span", {}, "How many"), count), countMsg);
      return { node, showProblems, values: () => ({ species: st.species, count: count.value }) };
    }
    return { node: null, values: () => ({}) };
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
    userId: () => me, confirmed: () => confirmed, isOpen: () => !!screen, prepare, quick };
})(window);
