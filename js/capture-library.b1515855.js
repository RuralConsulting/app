// SH1 (the owner: the app is empty because the photos people already take sit in the camera roll and WhatsApp): bring photos in.
//   A. + then "Choose photos": the phone's photo library, several at once (any browser; an iPhone cannot Share into a web app).
//   B. Android, the installed app: Share from the gallery or WhatsApp. The service worker keeps what was shared (sw.js takeShare) and
//      opens the app; once the person is signed in (capture-photo.js signedIn calls sharedIn), they choose the place when they have more
//      than one, and the photos land on the same review screen.
// The review screen: the photos as a short list (thumbnail, the date found, the place found or "No place in this photo"); one Tag and
// one Note for all, changeable per photo (open a photo); its place from the photo, a pin, "Where I am now" or none (never the phone's
// position unless chosen); then one action, "Add n photos". Each photo is resized and goes into the same capture queue as a photo taken
// with the camera (capture-photo.js keep: same record, same tables, same sharing choice, same rules); the screen then shows each one
// being sent, and one that is not sent says why with Try again. A photo chosen twice, or one already added, is said and not added twice.
//
//   FP.captureLibrary.choose(ctx)      (the Add registry's run: add.js "photos")
//   FP.captureLibrary.review(ctx, files)
//   FP.captureLibrary.sharedIn(groups)  (capture-photo.js, after the sign-in)
(function (root) {
  const FP = root.FP;
  const M = () => FP.captureLibraryModel, C = () => FP.captureModel;
  const el = (...a) => FP.el(...a);
  const SHARE = "fp-share-in";   // the cache sw.js keeps shared photos in (never one of the app's versioned caches)
  const ls = () => { try { return root.localStorage; } catch { return null; } };

  async function sha256(blob) {
    try {
      const buf = await root.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch { return null; }
  }

  // ---- A: + then Choose photos --------------------------------------------------------------------------------------------------------
  // The picker opens on this same tap (the browser's permission to open it). No capture attribute: the library, not the camera.
  function choose(ctx) {
    if (!FP.captures?.userId?.()) { FP.add?.toast?.("Sign in again to add photos here."); return; }
    const input = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, id: "lib-input" });
    root.document.body.append(input);
    input.addEventListener("change", () => { const files = [...(input.files || [])]; input.remove(); if (files.length) review(ctx, files); }, { once: true });
    input.addEventListener("cancel", () => input.remove(), { once: true });
    try { input.click(); } catch { input.remove(); }
  }

  // ---- the review screen -------------------------------------------------------------------------------------------------------------------
  let screen = null;
  function close() {
    if (!screen) return;
    const s = screen; screen = null;
    s.stop?.(); s.ro?.disconnect();
    s.node.querySelectorAll("img").forEach((i) => { if (i.src.startsWith("blob:")) URL.revokeObjectURL(i.src); });
    s.node.remove();
    root.document.body.classList.remove("cap-open");
    if (s.opener?.isConnected) s.opener.focus();
  }

  async function review(ctx, fileList, { before = false } = {}) {
    const me = FP.captures?.userId?.();
    if (!me) { FP.add?.toast?.("Sign in again to add photos here."); return; }
    FP.captures.close?.();
    close();
    const R = FP.formRows, places = FP.captures.placesFor(ctx);
    const files = [...fileList].slice(0, M().MAX_PHOTOS), over = fileList.length - files.length;
    const st = { org: places[0]?.id || ctx.id, items: [], all: { tags: [], note: "", shared: false }, chips: [], sites: [], open: null, mode: "reading", busy: false };
    const s = R.sheet({ id: "lib-screen", title: "Photos", titleId: "lib-title", saveId: "lib-add", cancelId: "lib-close", className: "cap-screen lib", saveLabel: "Add",
      onSave: () => (st.mode === "sent" ? close() : add()), onCancel: () => close() });
    const node = s.node, save = s.save;
    const urls = new Map();
    let ops = [], map = null, marker = null;
    s.cancel.setAttribute("aria-label", "Cancel: close without adding");
    const live = () => screen?.node === node;
    const status = el("p", { class: "fs-quiet lib-status", id: "lib-status", role: "status" });
    const list = el("ul", { class: "lib-list", id: "lib-list", "aria-label": "The photos" });
    const note = el("p", { class: "fs-quiet lib-noplace", id: "lib-noplace", hidden: true });
    const msg = el("p", { class: "cap-msg fs-say", id: "lib-msg", role: "status" });

    // one Tag and one Note for all of them (a photo's own, once changed, stays its own)
    const tagRow = R.pick({ id: "lib-tags", key: "tags", label: "Tag", title: "Tags", multi: true, empty: "Optional", max: C().MAX_TAGS, tooMany: "At most " + C().MAX_TAGS + " tags.",
      options: () => C().tidyTags([...st.chips, ...st.all.tags]).map((t) => ({ value: t, label: t })), value: () => st.all.tags, onPick: (v) => { st.all.tags = C().tidyTags(v); draw(); },
      allowNew: { label: "New tag", placeholder: "Type a tag", max: C().MAX_TAG, tidy: (t) => C().tidyTags([t])[0] || "" } });
    const noteRow = R.long({ id: "lib-note", key: "note", label: "Note", placeholder: "Optional", max: C().MAX_NOTE, onInput: (v) => { st.all.note = v; } });
    const placeRow = places.length > 1 ? R.pick({ id: "lib-place", key: "place", label: "Save to", title: "Save them to", options: places.map((g) => ({ value: g.id, label: g.name })), value: () => st.org,
      onPick: (v) => { st.org = v; chipsFor(); known(); } }) : null;
    const shareRow = R.toggle({ id: "lib-share", key: "share", label: "Share with everyone in the group", hint: "Otherwise only you and the group's coordinators see them.",
      onChange: (on) => { st.all.shared = on; } });
    const forAll = el("div", { class: "lib-all" }, el("h3", { class: "lib-all-head" }, "For all of them"), R.set(tagRow, noteRow),
      R.more({ label: "More details", rows: [placeRow, shareRow] }));
    // SH1b: shared to the app before this person signed in: said first, with a plain way to throw them away (nothing was added)
    const beforeBox = before ? el("div", { class: "lib-before-box", id: "lib-before" }, el("p", { class: "fs-quiet lib-before" }, M().BEFORE_WORDS + "."),
      el("button", { type: "button", class: "lib-discard", id: "lib-discard", onclick: () => { close(); FP.add?.toast?.("Discarded."); } }, M().NOT_MINE)) : null;
    // SH1b: Tag and Note for all of them above the list, so twenty photos never push them out of reach
    const photosHead = el("h3", { class: "lib-all-head lib-photos-head", id: "lib-photos-head" }, "The photos");
    s.body.append(...(beforeBox ? [beforeBox] : []), status, forAll, photosHead, list, note, msg);
    s.body.classList.add("lib-body");

    const from = root.document.activeElement;
    screen = { node, ctx, opener: from && from !== root.document.body && from.isConnected ? from : (FP.add?.buttons?.() || []).find((b) => !b.hidden && b.getClientRects().length) || null, stop: null };
    root.document.body.append(node);
    s.mounted();
    root.document.body.classList.add("cap-open");
    // (the Add label fitted again when the screen's width changes: a phone turned, or the text size changed)
    // (keyed on the width and the text size, so the label's own change of width never sets it off again)
    let fitted = "";
    const titleEl = s.top.querySelector(".fs-title");
    const ro = typeof root.ResizeObserver === "function" ? new root.ResizeObserver(() => {
      const key = s.top.clientWidth + "|" + (titleEl ? root.getComputedStyle(titleEl).fontSize : "");
      if (key !== fitted && live() && st.mode !== "sent") { fitted = key; root.requestAnimationFrame(() => { if (live() && st.mode !== "sent") label(M().going(st.items).length); }); }
    }) : null;
    ro?.observe(s.top);
    if (titleEl) ro?.observe(titleEl);
    screen.ro = ro;
    save.disabled = true;
    s.top.querySelector(".fs-title")?.focus();

    function chipsFor() { FP.captures.tagChoices?.(st.org, null).then((l) => { st.chips = C().tidyTags(l || []); if (live()) tagRow._draw(); }, () => {}); }
    chipsFor();
    FP.captures.sitesFor?.(st.org).then((x) => { st.sites = x || []; if (live()) draw(); }, () => {});

    // ---- reading each photo: its bytes' hash, what it says about itself, a smaller copy and a thumbnail ----
    for (const [i, f] of files.entries()) {
      if (!live()) return;
      status.textContent = "Reading " + (i + 1) + " of " + files.length + "…";
      const sha = await sha256(f);
      let got = null;
      try { got = await FP.captures.prepare(f); } catch { got = null; }
      if (!live()) return;
      const problem = !got ? M().problemWords(/hei[cf]/i.test(f.type) ? "heic" : "unreadable", f.name) : got.tooBig ? M().problemWords("tooBig") : null;
      st.items.push(M().item({ id: "p" + i, name: f.name, size: f.size, sha256: sha, meta: got?.meta || null, prepared: got && !got.tooBig ? got : null, problem }));
      draw();
    }
    known();
    status.textContent = over > 0 ? "The first " + M().MAX_PHOTOS + " photos are here. Add the rest in another go." : "";
    if (!st.items.some((it) => it.state === "ready")) msg.textContent = files.length === 1 ? "This photo can't be added." : "None of these photos can be added.";

    // duplicates: chosen twice, remembered on this phone, or (online) one of the person's own with the same time and place
    async function known() {
      const kept = new Set(M().readAdded(ls()?.getItem(M().addedKey(me, st.org))));
      st.items = M().markDuplicates(st.items.map((it) => ({ ...it, dup: null })), kept);
      draw();
      const times = M().queryTimes(st.items);
      if (!times.length || !FP.captures.confirmed?.() || root.navigator.onLine === false) return;
      const org = st.org;
      try {
        const r = await Promise.race([Promise.resolve(FP.sb.from("captures").select("taken_at,latitude,longitude").eq("org_id", org).eq("created_by", me).in("taken_at", times).limit(times.length * 4)),
          new Promise((resolve) => setTimeout(() => resolve(null), 4000))]);
        if (!live() || org !== st.org || st.mode !== "review" && st.mode !== "reading" || !r || r.error || !Array.isArray(r.data)) return;
        st.items = M().serverMatches(st.items, r.data);
        draw();
      } catch { /* no check: the phone's own memory and the batch still count */ }
    }

    // ---- drawing ----
    function thumbOf(it) {
      if (!it.prepared) return null;
      if (!urls.has(it.id)) urls.set(it.id, URL.createObjectURL(it.prepared.thumb || it.prepared.photo));
      return urls.get(it.id);
    }
    function draw() {
      if (!live()) return;
      if (st.mode === "reading" && st.items.length === files.length) st.mode = "review";
      // (a photo whose pin map is open keeps its row as it is: the map lives in it)
      if (map && !st.open) pinClose();
      const held = map ? list.querySelector('li[data-item="' + st.open + '"]') : null;
      list.replaceChildren(...st.items.map((it) => (held && it.id === st.open ? held : line(it))));
      const n = M().going(st.items).length;
      if (st.mode !== "sent") {
        label(n);
        save.disabled = st.busy || st.mode === "reading" || !n;
        const t = M().noPlaceNote(st.items, FP.locate?.platform?.() || "other");
        note.textContent = t || ""; note.hidden = !t || st.mode === "reading";
        if (st.mode === "review" && !st.busy) msg.textContent = M().nothingNew(st.items) || (st.items.some((it) => it.state === "ready") ? "" : msg.textContent);
      }
    }
    // SH1b: "Add 19 photos", or "Add 19" when the top row is too narrow for it beside the whole title (320 px with large text)
    function label(n) {
      save.textContent = M().addLabel(n);
      const title = s.top.querySelector(".fs-title");
      if (title && title.scrollWidth > title.clientWidth + 1) save.textContent = M().addShort(n);
    }
    function line(it) {
      const sent = st.mode === "sent" && (it.clientId || it.state === "notkept");
      const state = sent ? M().sendState(it, ops) : null;
      const src = thumbOf(it);
      const pic = src ? el("img", { class: "lib-thumb", src, alt: "" }) : el("span", { class: "lib-thumb lib-thumb-none", "aria-hidden": "true" }, FP.icon("photos", 22));
      const words = el("span", { class: "lib-words" },
        el("span", { class: "lib-date" }, M().dateLine(it)),
        it.state === "unreadable" ? el("span", { class: "lib-line lib-problem" }, it.problem) : el("span", { class: "lib-line lib-place", "data-place": it.where }, M().placeLine(it, st.sites)),
        it.removed && st.mode !== "sent" ? el("span", { class: "lib-line lib-flag" }, "Left out") : null,
        st.mode !== "sent" && M().dupLine(it) ? el("span", { class: "lib-line lib-flag", "data-dup": it.dup }, M().dupLine(it)) : null,
        state ? el("span", { class: "lib-line lib-state", "data-state": state.key }, state.words + (state.error ? ": " + state.error : "")) : null,
        st.mode !== "sent" && it.state === "ready" && (it.tags || it.note != null) ? el("span", { class: "lib-line" }, "Its own tag or note") : null);
      const kids = [];
      if (st.mode === "sent" || it.state !== "ready") kids.push(el("div", { class: "lib-row lib-row-still" }, pic, words));
      else {
        const open = st.open === it.id;
        const b = el("button", { type: "button", class: "lib-row", "aria-expanded": String(open), "aria-controls": "lib-edit-" + it.id, "data-item": it.id }, pic, words,
          el("span", { class: "fs-chev", "aria-hidden": "true" }, FP.icon(open ? "up" : "down", 16)));
        b.addEventListener("click", () => { st.open = open ? null : it.id; pinClose(); draw(); list.querySelector('[data-item="' + it.id + '"]')?.focus(); });
        kids.push(b);
        if (open) kids.push(editor(it));
      }
      if (state && (state.key === "failed" || state.key === "notkept")) {
        const again = el("button", { type: "button", class: "lib-again", "data-again": it.id }, "Try again");
        again.addEventListener("click", () => retry(it, state));
        kids.push(again);
      }
      return el("li", { class: "lib-item", "data-item": it.id, "data-state": state ? state.key : it.removed ? "out" : it.dup && !it.anyway ? "dup" : it.state }, ...kids);
    }

    // ---- one photo's own choices: where, tag, note, leave out (or add a duplicate anyway) ----
    function editor(it) {
      const box = el("div", { class: "lib-edit", id: "lib-edit-" + it.id });
      const whereRow = R.pick({ id: "lib-where-" + it.id, key: "where", label: "Where", title: "Where it was", value: () => it.where,
        words: () => (it.finding ? "Finding where you are…" : M().whereWord(it)),
        options: () => [...(M().hasOwnPlace(it) ? [{ value: "photo", label: "Where the photo was taken", hint: "From the photo" }] : []),
          { value: "pin", label: "Drop a pin on the map" }, { value: "here", label: "Where I am now", hint: "This phone's position, now" }, { value: "none", label: "No place" }],
        onPick: (v) => {
          if (v === "here") { here(it, whereRow); return; }
          it.where = v === "pin" ? (it.pin ? "pin" : it.where) : v;
          if (v === "pin") pinOpen(it, box); else pinClose();
          draw();
        } });
      const tags = R.pick({ id: "lib-tags-" + it.id, key: "tags", label: "Tag", title: "Tags for this photo", multi: true, empty: "Optional", max: C().MAX_TAGS, tooMany: "At most " + C().MAX_TAGS + " tags.",
        options: () => C().tidyTags([...st.chips, ...M().tagsOf(it, st.all)]).map((t) => ({ value: t, label: t })), value: () => M().tagsOf(it, st.all),
        onPick: (v) => { it.tags = C().tidyTags(v); draw(); }, allowNew: { label: "New tag", placeholder: "Type a tag", max: C().MAX_TAG, tidy: (t) => C().tidyTags([t])[0] || "" } });
      const noteR = R.long({ id: "lib-note-" + it.id, key: "note", label: "Note", placeholder: st.all.note ? "Same as the others" : "Optional", max: C().MAX_NOTE, value: it.note ?? "",
        onInput: (v) => { it.note = v === "" ? null : v; } });
      const out = R.action({ id: "lib-out-" + it.id, key: "out", icon: it.removed ? "plus" : "close", label: it.removed ? "Add this photo after all" : "Leave this photo out",
        onClick: () => { it.removed = !it.removed; st.open = null; draw(); } });
      const anyway = it.dup ? R.action({ id: "lib-anyway-" + it.id, key: "anyway", icon: it.anyway ? "close" : "plus", label: it.anyway ? "Don't add it again" : "Add it anyway",
        onClick: () => { it.anyway = !it.anyway; draw(); } }) : null;
      box.append(R.set(whereRow, tags, noteR, anyway, out));
      return box;
    }
    async function here(it, row) {
      it.finding = true; row._draw();
      const got = await FP.locate.get({ maxAge: 60000 });
      it.finding = false;
      if (!live()) return;
      if (got?.ok && got.fix) { it.device = { lat: got.fix.lat, lon: got.fix.lon, accuracy: got.fix.accuracy, at: got.fix.at }; it.where = "here"; pinClose(); draw(); }
      else { row._draw(); R.say(row, "This phone didn't give a position. Drop a pin instead, or add it without a place."); }
    }
    function pinClose() { map?.remove(); map = null; marker = null; node.querySelector(".lib-pin")?.remove(); }
    function pinOpen(it, box) {
      pinClose();
      const holder = el("div", { class: "cap-pin-map lib-pin", id: "lib-pin" });
      box.append(holder);
      const gl = root.maplibregl, p = M().position(it) || (it.meta && C().position({ meta: it.meta }));
      if (!gl || root.navigator.onLine === false) { holder.replaceChildren(el("p", { class: "fs-quiet" }, "The map needs a connection. Add it without a place, or come back to it.")); return; }
      try {
        gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js");
        map = new gl.Map({ container: holder, style: FP.basemaps.style("aerial"), ...(p ? { center: [p.longitude, p.latitude], zoom: 15 } : { bounds: [[166.3, -47.4], [178.6, -34.3]] }), attributionControl: { compact: true } });
        if (p) marker = new gl.Marker().setLngLat([p.longitude, p.latitude]).addTo(map);
        map.on("click", (e) => {
          it.pin = { lat: e.lngLat.lat, lon: e.lngLat.lng }; it.where = "pin";
          if (marker) marker.setLngLat(e.lngLat); else marker = new gl.Marker().setLngLat(e.lngLat).addTo(map);
          const w = list.querySelector('[data-item="' + it.id + '"] .lib-place');
          if (w) { w.textContent = M().placeLine(it, st.sites); w.dataset.place = it.where; }
          box.querySelector('[data-row="where"]')?._draw?.();
        });
      } catch { holder.replaceChildren(el("p", { class: "fs-quiet" }, "The map couldn't open here.")); }
    }

    // ---- Add: each photo into the queue on this phone, in order; one the phone won't keep is said, and the rest go on ----
    async function add() {
      if (st.busy) return;
      const go = M().going(st.items);
      if (!go.length) return;
      st.busy = true; save.disabled = true; msg.textContent = ""; pinClose(); st.open = null;
      const org = st.org, kept = M().readAdded(ls()?.getItem(M().addedKey(me, org)));
      let keys = [];
      for (const [i, it] of go.entries()) {
        status.textContent = "Adding " + (i + 1) + " of " + go.length + "…";
        await keepOne(it, org);
        if (it.clientId) keys = keys.concat(it.keys);
      }
      try { ls()?.setItem(M().addedKey(me, org), JSON.stringify(M().remember(kept, keys))); } catch { /* not remembered: the server check still counts */ }
      st.items = st.items.filter((it) => it.clientId || it.state === "notkept");
      st.mode = "sent"; st.busy = false;
      s.cancel.style.visibility = "hidden";   // (its place kept: the title stays in the middle)
      msg.textContent = "";
      save.textContent = "Done"; save.disabled = false;
      forAll.hidden = true; note.hidden = true;
      FP.captures.badge?.();
      const stop = FP.capture.watch(() => progress());
      screen.stop = stop;
      progress();
      FP.captures.sendNow?.();
    }
    async function keepOne(it, org) {
      try { const { clientId } = await FP.captures.keep(M().keepInput(it, st.all, org)); it.clientId = clientId; it.state = "ready"; it.problem = null; }
      catch (e) { it.state = "notkept"; it.problem = e?.plain ? e.message : e?.message || String(e); }
    }
    async function progress() {
      if (!live()) return;
      try { ops = await FP.captures.waiting(st.org); } catch { ops = []; }
      if (!live()) return;
      status.textContent = M().doneLine(st.items, ops, root.navigator.onLine !== false && FP.captures.confirmed?.() !== false);
      draw();
    }
    async function retry(it, state) {
      if (state.key === "notkept") { await keepOne(it, st.org); FP.captures.badge?.(); FP.captures.sendNow?.(); progress(); return; }
      if (state.seq != null) { try { await FP.capture.queue?.retry(state.seq); } catch { /* the line says it again */ } progress(); }
    }
  }

  // ---- B: Android's Share, after the sign-in ----------------------------------------------------------------------------------------------
  // What sw.js kept is read once and cleared (a share is for now; sharing again brings it back). The person chooses the place first when
  // they have more than one; the photos then land on the review screen.
  // SH1b: the photos are only ever shown to the person they were shared for (M().shareFor: the one signed in on this phone when they
  // arrived, or, when nobody was, the first sign-in within ten minutes, told so with "Not mine: discard"). Anyone else's are deleted
  // unseen. Each sign-in first notes who is signed in here (WHO, read by sw.js when a share arrives); sign-out clears both (forget).
  const WHO = "fp-share-who";
  async function signedInAs(id) {
    try { if (id && root.caches?.open) await (await root.caches.open(WHO)).put("who", new Response(JSON.stringify({ id }), { headers: { "content-type": "application/json" } })); }
    catch { /* not noted: a share then waits as if nobody were signed in (ten minutes, said so) */ }
  }
  async function forget() {
    try { await root.caches?.delete?.(SHARE); } catch { /* nothing kept */ }
    try { await root.caches?.delete?.(WHO); } catch { /* nothing kept */ }
  }
  let sharing = false;
  async function sharedIn(groups, userId = FP.captures?.userId?.() || null) {
    if (!root.caches?.open) return;
    // (read before noting this sign-in: the index already holds who it was for)
    if (sharing) { await signedInAs(userId); return; }
    sharing = true;
    try {
      const has = await root.caches.has?.(SHARE);
      if (has === false) return;
      const c = await root.caches.open(SHARE), idx = await c.match("share-in/index");
      if (!idx) { await root.caches.delete(SHARE); return; }
      let index = null;
      try { index = await idx.json(); } catch { index = null; }
      const whose = M().shareFor(index, userId);
      const files = [];
      for (const f of whose ? M().sharedFiles(index) || [] : []) {
        const r = await c.match(f.key);
        if (r) { const blob = await r.blob(); files.push(new File([blob], f.name || "shared-photo", { type: f.type || blob.type, lastModified: f.modified || Date.now() })); }
      }
      await root.caches.delete(SHARE);
      clean();
      if (!files.length) return;
      await quiet();
      if (FP.captures?.userId?.() !== userId) return;   // (signed out, or someone else, while it settled)
      const before = whose === "before";
      const targets = M().shareTargets(groups);
      if (!targets.length) { FP.add?.toast?.("These photos can't be added: you're not a member of a group here."); return; }
      if (targets.length === 1) { review(ctxOf(targets[0]), files, { before }); return; }
      whichPlace(targets, files, before);
    } catch { try { await root.caches.delete(SHARE); } catch { /* as it is */ } }
    finally { sharing = false; await signedInAs(userId); }
  }
  const ctxOf = (g) => ({ space: "group", id: g.id, name: g.name, role: g.role });
  // the address the share opened (?shared=1) put back to the plain one
  function clean() {
    try { const u = new URL(root.location.href); if (u.searchParams.has("shared")) { u.searchParams.delete("shared"); root.history.replaceState(root.history.state, "", u.pathname + u.search + u.hash); } } catch { /* as it is */ }
  }
  // the app's first screen settled (its route drawn) before the sheet opens over it
  async function quiet() {
    let last = root.location.hash, still = 0;
    for (let i = 0; i < 25 && still < 3; i++) { await new Promise((r) => setTimeout(r, 200)); if (root.location.hash === last) still++; else { last = root.location.hash; still = 0; } }
  }
  function whichPlace(targets, files, before = false) {
    const opts = targets.map((g) => el("button", { type: "button", class: "fs-option lib-which", "data-place": g.id, onclick: () => { FP.sheet.close(); review(ctxOf(g), files, { before }); } },
      el("span", { class: "fs-circle", "aria-hidden": "true" }), el("span", { class: "fs-option-words" }, el("span", {}, g.name))));
    // SH1b: shared before this person signed in: said first, with a plain way to throw them away unseen by anyone
    const head = before ? [el("div", { class: "lib-before-box" }, el("p", { class: "fs-quiet lib-before", id: "lib-which-before" }, M().BEFORE_WORDS + "."),
      el("button", { type: "button", class: "lib-discard", id: "lib-which-discard", onclick: () => { FP.sheet.close(); FP.add?.toast?.("Discarded."); } }, M().NOT_MINE))] : [];
    FP.sheet.open({ opener: null, title: files.length === 1 ? "Which place is this photo for?" : "Which place are these " + files.length + " photos for?", className: "fs-list lib-which-sheet",
      body: () => [...head, el("div", { class: "fs-set fs-options", role: "group" }, ...opts)] });
    root.document.querySelector(".lib-which")?.focus();
  }

  // (the review stays over the page when the address changes: its photos are only on this screen until added)
  FP.captureLibrary = { choose, review, sharedIn, forget, signedInAs, close, isOpen: () => !!screen, SHARE, WHO };
})(window);
