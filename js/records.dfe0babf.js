// CAP1: Records, a group's captures as a list (docs/PRODUCT.md "A list": rows with a title, one quiet line, the date at the right).
// Newest first: the thumbnail, the tags, the date and who; a tag filter; tap one to see the photo full screen with its details. What
// this phone holds and has not sent yet is listed first under "Waiting to send", with Send now, Try again and Remove.
//
// Reads, as the signed-in person (row-level security decides: their own captures, everything in the group for its coordinators, and
// what others shared with the group): public.captures for this group, newest 200 not archived; the thumbnails and the photo through
// signed links the storage policy gives only for a capture the person can read. Nothing else is read and nothing is written here
// except through the capture queue (sending, or removing an unsent capture from this phone).
(function (root) {
  const FP = root.FP;
  const C = () => FP.captureModel;
  const el = (...a) => FP.el(...a);
  const COLUMNS = "id,client_id,org_id,kind,created_by,created_by_name,taken_at,taken_at_from,latitude,longitude,position_from,accuracy_m,note,tags,data,shared_with_group,photo_path,thumb_path,photo_width,photo_height";
  const LIMIT = 200;
  let shown = null;

  function view(group, { sb = FP.sb, item = null } = {}) {
    close();
    const me = { alive: true }, st = { rows: null, failed: false, tag: null, urls: new Map(), local: [], blobs: [] };
    shown = me;
    const live = () => me.alive && shown === me;
    const mine = () => FP.captures?.userId?.() || null;
    const coordinator = ["facilitator", "advisor", "admin"].includes(group.role);
    const wrap = el("section", { class: "records", "data-view": "records", "aria-labelledby": "records-title" });
    // "…": on a phone, what is in the add menu (capture-ring.js edit), kept per person on the device
    const phone = root.matchMedia?.("(max-width: 800px)").matches;
    const menu = phone && FP.sheet?.moreButton && FP.captureRing ? FP.sheet.moreButton("More for Records", () => [{ label: "Choose what's in the add menu", hint: "On this phone: which, and in what order", icon: "create", action: "choose-add-menu",
      run: () => { const ctx = FP.add?.context, b = (FP.add?.buttons?.() || []).find((x) => !x.hidden) || null; if (ctx) FP.captureRing.edit(b, ctx, FP.add.available(ctx)); } }]) : null;
    const head = el("div", { class: "rec-head" }, el("div", {}, el("h2", { id: "records-title" }, "Records"),
      el("p", { class: "rec-quiet" }, coordinator ? "Photos, water samples and pest control: everyone's in this group." : "Photos, water samples and pest control: yours, and what others share with the group.")), menu);
    const waitBox = el("section", { class: "rec-waiting", "aria-labelledby": "rec-waiting-title", hidden: true });
    const filters = el("div", { class: "rec-filters", role: "group", "aria-label": "Show records tagged", hidden: true });
    const status = el("p", { class: "rec-quiet rec-status", role: "status" }, "Loading…");
    const list = el("ul", { class: "rec-list", "aria-label": "Records" });
    wrap.append(head, waitBox, filters, status, list);

    // ---- what this phone has not sent --------------------------------------------------------------------------------------------
    async function drawWaiting() {
      let ops = [];
      try { ops = await (FP.captures?.waiting?.(group.id) || []); } catch { ops = []; }
      if (!live()) return;
      st.local = ops;
      st.blobs.forEach((u) => URL.revokeObjectURL(u)); st.blobs = [];
      const open = ops.filter((o) => o.state !== "synced");
      waitBox.hidden = !open.length;
      if (!open.length) { waitBox.replaceChildren(); return; }
      const offline = root.navigator.onLine === false, held = !FP.captures?.confirmed?.();
      const send = el("button", { type: "button", class: "rec-send", id: "rec-send-now", disabled: offline || held }, FP.icon("send", 18), el("span", {}, "Send now"));
      send.addEventListener("click", async () => { send.disabled = true; try { await FP.captures.sendNow(); } catch { /* the rows say */ } drawWaiting(); load(); });
      const why = offline ? "You're offline. They'll send when you're back in range." : held ? "They'll send once you're signed in." : null;
      waitBox.replaceChildren(
        el("div", { class: "rec-waiting-head" }, el("h3", { id: "rec-waiting-title" }, C().waitingLine(open) || "Waiting to send"), send),
        why ? el("p", { class: "rec-quiet" }, why) : null,
        el("ul", { class: "rec-list rec-list-local" }, ...open.map((o) => localRow(o))));
    }
    function localRow(o) {
      const r = o.record || {}, small = o.thumb?.blob || o.photo?.blob || null;
      let src = null;
      if (small && typeof URL.createObjectURL === "function") { src = URL.createObjectURL(small); st.blobs.push(src); }
      const acts = el("span", { class: "rec-acts" });
      if (o.state === "failed") {
        const again = el("button", { type: "button", class: "link", "data-retry": r.client_id }, "Try again");
        again.addEventListener("click", async () => { again.disabled = true; await FP.capture.queue.retry(o.seq).catch(() => {}); drawWaiting(); load(); });
        acts.append(again);
      }
      const remove = el("button", { type: "button", class: "link rec-remove", "data-remove": r.client_id }, "Remove");
      remove.addEventListener("click", () => {
        const yes = el("button", { type: "button", class: "link rec-remove-yes", "data-remove-yes": r.client_id }, "Remove it from this phone");
        const no = el("button", { type: "button", class: "link" }, "Keep");
        yes.addEventListener("click", async () => { await FP.capture.queue.dismiss(o.seq).catch(() => {}); FP.captures.badge(); drawWaiting(); });
        no.addEventListener("click", () => drawWaiting());
        acts.replaceChildren(el("span", { class: "rec-confirm" }, "It hasn't been sent."), yes, no);
        yes.focus();
      });
      acts.append(remove);
      return el("li", { class: "rec-row rec-row-local", "data-capture": r.client_id, "data-state": o.state },
        el("span", { class: "rec-thumb" }, thumb(src, r.kind)),
        el("span", { class: "rec-text" }, el("b", {}, title(r)), el("small", {}, [C().STATE_WORDS[o.state] || "", o.state === "failed" && o.error ? o.error : null].filter(Boolean).join(" · ")), acts),
        el("span", { class: "rec-date" }, C().day(r.taken_at)));
    }

    // ---- the group's records ---------------------------------------------------------------------------------------------------------
    async function load() {
      let r;
      try { r = await sb.from("captures").select(COLUMNS).eq("org_id", group.id).is("archived_at", null).order("taken_at", { ascending: false }).range(0, LIMIT - 1); }
      catch (e) { r = { error: e }; }
      if (!live()) return;
      if (r?.error) { st.failed = true; if (!st.rows) st.rows = []; }
      else { st.failed = false; st.rows = (r.data || []).sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at))); }
      await signThumbs();
      draw();
    }
    async function signThumbs() {
      const want = (st.rows || []).map((x) => x.thumb_path || x.photo_path).filter((p) => p && !st.urls.has(p));
      if (!want.length || root.navigator.onLine === false) return;
      try {
        const r = await sb.storage.from("documents").createSignedUrls(want, 3600);
        for (const s of r?.data || []) if (s?.signedUrl && !s.error) st.urls.set(s.path, s.signedUrl);
      } catch { /* the rows show their icon instead */ }
    }
    // A thumbnail, or a calm placeholder (the kind's icon) when there is none or it can't load (offline, a link expired): never a broken image
    const placeholder = (kind) => el("span", { class: "rec-thumb-none", "aria-hidden": "true" }, FP.icon(C().KINDS[kind]?.icon || "camera", 22));
    function thumb(src, kind) {
      if (!src) return placeholder(kind);
      const img = el("img", { src, alt: "", loading: "lazy" });
      img.addEventListener("error", () => img.replaceWith(placeholder(kind)), { once: true });
      return img;
    }
    const title = (r) => r.note || (r.tags || []).join(", ") || C().KINDS[r.kind]?.label || "Photo";
    function draw() {
      if (!live()) return;
      const rows = (st.rows || []).filter((x) => C().hasTag(x, st.tag));
      const counts = C().tagCounts(st.rows || []);
      filters.hidden = counts.length < 2 && !st.tag;
      filters.replaceChildren(...[{ tag: null, n: (st.rows || []).length }, ...counts.slice(0, 10)].map((t) => {
        const b = el("button", { type: "button", class: "chip", "aria-pressed": String(st.tag === t.tag || (!t.tag && !st.tag)), "data-filter": t.tag || "" }, t.tag || "All", el("span", { class: "chip-count", "aria-label": "(" + t.n + ")" }, String(t.n)));
        b.addEventListener("click", () => { st.tag = t.tag; draw(); filters.querySelector('[data-filter="' + CSS.escape(t.tag || "") + '"]')?.focus(); });
        return b;
      }));
      const waitingIds = new Set(st.local.filter((o) => o.state !== "synced").map((o) => o.record?.client_id));
      const shownRows = rows.filter((x) => !waitingIds.has(x.client_id));
      status.textContent = st.failed && shownRows.length ? "" : st.failed ? (root.navigator.onLine === false ? "You're offline. The group's records show here when you're back in range." : "The group's records couldn't be read just now.")
        : !shownRows.length ? (st.tag ? "Nothing tagged " + st.tag + "." : "Nothing here yet. Tap + to take a photo.") : (st.rows.length >= LIMIT ? "The newest " + LIMIT + "." : "");
      status.hidden = !status.textContent;
      list.replaceChildren(...shownRows.map((x) => row(x)));
      if (item && !st.opened) {
        const hit = (st.rows || []).find((x) => x.client_id === item || x.id === item);
        if (hit) { st.opened = true; openOne(hit); }
      }
    }
    function row(x) {
      const src = st.urls.get(x.thumb_path || x.photo_path);
      const quiet = [x.kind !== "photo" ? C().KINDS[x.kind]?.label : null, C().detailLine(x), x.note ? (x.tags || []).join(", ") : null, C().who(x, mine()), x.shared_with_group ? "shared" : null].filter(Boolean).join(" · ");
      const b = el("button", { type: "button", class: "rec-row", "data-capture": x.client_id, "data-id": x.id },
        el("span", { class: "rec-thumb" }, thumb(src, x.kind)),
        el("span", { class: "rec-text" }, el("b", {}, title(x)), el("small", {}, quiet)),
        el("span", { class: "rec-date" }, C().day(x.taken_at)));
      b.addEventListener("click", () => openOne(x, b));
      return el("li", {}, b);
    }

    // ---- one record, full screen ------------------------------------------------------------------------------------------------------
    async function openOne(x, from = null) {
      const img = el("img", { class: "rec-photo", alt: x.note ? "Photo: " + x.note : "The photo", hidden: true });
      img.addEventListener("error", () => { img.replaceWith(el("p", { class: "rec-quiet" }, root.navigator.onLine === false ? "The photo shows here when you're back in range." : "The photo couldn't be shown just now.")); }, { once: true });
      const shut = el("button", { type: "button", class: "cap-close", id: "rec-close", "aria-label": "Close" }, FP.icon("close", 22));
      const facts = [
        ["Tags", (x.tags || []).length ? el("span", { class: "rec-tags" }, ...(x.tags || []).map((t) => el("span", { class: "chip chip-static" }, t))) : "None"],
        x.kind !== "photo" ? [C().KINDS[x.kind]?.label, C().detailLine(x) || "—"] : null,
        ["Taken", C().when(x.taken_at) + (x.taken_at_from === "photo" ? " (from the photo)" : "")],
        ["Where", C().positionLine(x.latitude == null ? null : x)],
        ["Place", group.name],
        ["By", C().who(x, mine())],
        ["Seen by", x.shared_with_group ? "Everyone in the group" : "Whoever took it and the group's coordinators"],
      ].filter(Boolean);
      const node = el("div", { class: "cap-screen rec-viewer", id: "rec-viewer", role: "dialog", "aria-modal": "true", "aria-labelledby": "rec-viewer-title" },
        el("header", { class: "cap-head" }, shut, el("h2", { id: "rec-viewer-title" }, title(x)), el("span", { class: "cap-head-gap" })),
        el("div", { class: "cap-body" }, x.photo_path ? el("div", { class: "rec-photo-box" }, img) : null,
          x.note ? el("p", { class: "rec-note" }, x.note) : null,
          el("dl", { class: "rec-facts" }, ...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]))));
      const done = () => { node.remove(); root.document.body.classList.remove("cap-open"); root.removeEventListener("hashchange", done); (from?.isConnected ? from : list.querySelector('[data-capture="' + x.client_id + '"]'))?.focus(); };
      shut.addEventListener("click", done);
      node.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); done(); } if (e.key === "Tab") { e.preventDefault(); shut.focus(); } });
      root.addEventListener("hashchange", done);
      root.document.body.append(node);
      root.document.body.classList.add("cap-open");
      shut.focus();
      if (x.photo_path) {
        const small = st.urls.get(x.thumb_path || x.photo_path);
        if (small) { img.src = small; img.hidden = false; }
        try {
          const r = await sb.storage.from("documents").createSignedUrl(x.photo_path, 3600);
          if (r?.data?.signedUrl) { img.src = r.data.signedUrl; img.hidden = false; }
        } catch { /* the thumbnail stays */ }
      }
    }

    // the queue changed: draw what waits again, and read the list again when something has just been sent
    const sent = new Set();
    const off = FP.capture?.watch?.(async () => {
      if (!live()) { off?.(); return; }
      await drawWaiting();
      const fresh = st.local.filter((o) => o.state === "synced" && !sent.has(o.id));
      fresh.forEach((o) => sent.add(o.id));
      if (fresh.length) load();
    });
    const onOnline = () => { if (live()) { drawWaiting(); load(); } else root.removeEventListener("online", onOnline); };
    root.addEventListener("online", onOnline);
    root.addEventListener("offline", () => { if (live()) drawWaiting(); });
    me.stop = () => { off?.(); root.removeEventListener("online", onOnline); st.blobs.forEach((u) => URL.revokeObjectURL(u)); };
    drawWaiting().then(load);
    return wrap;
  }
  function close() { if (shown) { shown.alive = false; shown.stop?.(); } shown = null; }

  FP.records = { view, close, COLUMNS, LIMIT };
})(typeof window === "undefined" ? globalThis : window);
