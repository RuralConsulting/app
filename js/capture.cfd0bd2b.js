// B4b: record a note or a photo from the farm's Create view, with or without coverage. What is saved goes into the capture
// queue on this phone first (capture-queue.js, IndexedDB) and uploads when the phone is online, oldest first; the farm's
// recent notes and photos are listed below the form with each one's state: Pending upload, Uploading…, Synced, Not
// uploaded (with Try again) or Conflict kept (edited on another device meanwhile: both versions are in the entry's history).
// The queue starts when a farm opens (start), so what waits uploads without the Create view being open.
(function (root) {
  const FP = root.FP, Q = FP.captureQueue;
  const uuid = () => root.crypto.randomUUID();
  let queue = null, who = null, client = null, kept = true, held = false;
  const views = new Set();
  const changed = () => views.forEach((v) => v.refresh());

  // IndexedDB, or memory when this browser has none to give (then the view says captures are kept only while it is open).
  function store() {
    let inner = null;
    const pick = async () => {
      if (inner) return inner;
      try { const s = Q.idbStore(root.indexedDB); await s.all(); inner = s; }
      catch { inner = Q.memoryStore(); kept = false; changed(); }
      return inner;
    };
    return { add: async (op) => (await pick()).add(op), put: async (op) => (await pick()).put(op),
      remove: async (seq) => (await pick()).remove(seq), all: async () => (await pick()).all() };
  }
  // One queue per signed-in person; called when a farm opens and when the Create view mounts. Uploads what waits.
  // CAP1: `hold` keeps what is saved on the phone without sending it: the app opened offline for the last person signed in on this
  // phone, before their sign-in could be confirmed (main.js); it is sent once they are signed in (start again without hold).
  function start({ sb, user, hold = false }) {
    held = !!hold;
    if (!queue || who !== user.id || client !== sb) {
      who = user.id; client = sb;
      queue = Q.createQueue({ store: store(), sb, user: () => who, online: () => !held && root.navigator.onLine !== false, uuid, onChange: changed });
    }
    queue.sync().then(() => views.forEach((v) => v.reload()), () => {});
    return queue;
  }
  // CAP1: whether this browser keeps what waits after it closes (IndexedDB), as far as is known yet
  const keeps = () => kept;
  // CAP1: listen for changes of the queue (a capture saved, sent, refused); returns a function that stops listening
  function watch(fn) { const v = { refresh: fn, reload: fn }; views.add(v); return () => views.delete(v); }
  root.addEventListener("online", () => { if (queue) queue.sync().then(() => views.forEach((v) => v.reload()), () => {}); changed(); });
  root.addEventListener("offline", changed);
  // The app back in front (a phone puts it to sleep in a pocket): try what waits now rather than at the next retry.
  root.document?.addEventListener("visibilitychange", () => {
    if (queue && root.document.visibilityState === "visible") queue.sync().then(() => views.forEach((v) => v.reload()), () => {});
  });

  async function sha256(blob) {
    const buf = await root.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const when = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Pacific/Auckland" }) : ""; };
  const STATE_NOTE = {
    pending: "Saved on this phone; it uploads when you're back online.",
    conflict: "Changed on another device while you were offline. The newer version is shown; yours is kept in the entry's history.",
  };

  function mount(host, { sb, farm, user, el, canEdit = false }) {
    const q = start({ sb, user });
    const note = el("textarea", { name: "capture-note", rows: "3", maxlength: "4000", placeholder: "What you see, or what you did" });
    const photo = el("input", { name: "capture-photo", type: "file", accept: "image/*", capture: "environment" });
    const save = el("button", { type: "submit" }, "Save");
    const msg = el("p", { class: "capture-msg", role: "status" });
    const net = el("p", { class: "capture-net", role: "status" });
    const list = el("ul", { class: "capture-list", "aria-label": "Recent notes and photos" });
    const form = el("form", { class: "capture-form" }, el("h3", {}, "Record a note or photo"),
      el("label", {}, "Note", note), el("label", {}, "Photo", photo), el("div", { class: "capture-actions" }, save), msg);
    const box = el("section", { class: "capture", "data-capture": "" }, canEdit ? form : null, el("h3", {}, "Notes and photos"), net, list);
    host.append(box);
    let entries = [], types = {}, unread = false, editing = null, urls = [], shown = false;
    const say = (t) => { msg.textContent = t || ""; };

    // The farm's own notes and photos, newest first (row-level security decides what comes back).
    async function reload() {
      try {
        const t = await sb.from("record_types").select("id,key,farm_id,org_id");
        if (t.error) throw t.error;
        types = Object.fromEntries((t.data || []).filter((r) => ["note", "photo"].includes(r.key) && (!r.farm_id || r.farm_id === farm.id)).map((r) => [r.id, r.key]));
        const e = await sb.from("entries").select("id,type_id,body,captured_at,created_at,updated_at,created_by").eq("farm_id", farm.id)
          .in("type_id", Object.keys(types)).order("captured_at", { ascending: false }).limit(20);
        if (e.error) throw e.error;
        entries = e.data || []; unread = false;
      } catch { unread = true; }
      await refresh();
    }
    function line(l) {
      const open = l.state === "pending" || l.state === "syncing";
      const kids = [];
      if (l.file?.blob && typeof URL.createObjectURL === "function") { const u = URL.createObjectURL(l.file.blob); urls.push(u); kids.push(el("img", { class: "capture-thumb", src: u, alt: "" })); }
      const head = el("p", { class: "capture-head" }, el("span", { class: "capture-kind" }, l.type === "photo" ? "Photo" : "Note"), el("span", { class: "capture-when" }, when(l.captured_at)),
        l.state ? el("span", { class: "capture-state", "data-state": l.state }, Q.stateWords(l.state)) : null);
      const text = editing === l.id ? null : el("p", { class: "capture-body" }, l.body || (l.type === "photo" ? "No caption" : ""));
      const body = el("div", { class: "capture-main" }, head, text);
      if (editing === l.id) {
        const area = el("textarea", { name: "capture-edit", rows: "3", maxlength: "4000", "aria-label": "Edit the note" });
        area.value = l.body || "";
        body.append(area, el("div", { class: "capture-actions" },
          el("button", { type: "button", onclick: () => edit(l, area.value) }, "Save"),
          el("button", { type: "button", class: "link", onclick: () => { editing = null; refresh(); } }, "Cancel")));
      }
      if (STATE_NOTE[l.state]) body.append(el("p", { class: "capture-note" }, STATE_NOTE[l.state]));
      if (l.state === "failed") body.append(el("p", { class: "capture-note" }, l.error || ""), el("div", { class: "capture-actions" },
        el("button", { type: "button", onclick: () => q.retry(l.seq) }, "Try again")));
      if (l.state === "conflict") body.append(el("div", { class: "capture-actions" }, el("button", { type: "button", class: "link", onclick: () => q.dismiss(l.seq) }, "OK")));
      if (canEdit && l.server && l.type === "note" && !open && editing !== l.id && l.updated_at)
        body.append(el("div", { class: "capture-actions" }, el("button", { type: "button", class: "link", onclick: () => { editing = l.id; refresh(); } }, "Edit")));
      kids.push(body);
      return el("li", { class: "capture-line", "data-entry": l.id, "data-state": l.state || "server" }, ...kids);
    }
    async function refresh() {
      // Mounted before the view is placed on the page; once shown and then taken off (another view), it stops listening.
      if (!box.isConnected) { if (shown) views.delete(view); return; }
      shown = true;
      const ls = Q.lines(await q.list(farm.id), entries, types);
      urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
      list.replaceChildren(...(ls.length ? ls.map(line) : [el("li", { class: "capture-empty" }, unread ? "The farm's notes and photos show here when you're back online." : "No notes or photos yet.")]));
      net.textContent = [root.navigator.onLine === false ? "Offline. What you save stays on this phone and uploads when you're back online." : "",
        kept ? "" : "This browser can't keep captures after it closes: keep the app open until they upload."].filter(Boolean).join(" ");
    }
    async function edit(l, text) {
      const entry = entries.find((e) => e.id === l.id);
      try { await q.add(Q.editOp({ farm: farm.id, user: user.id, entry, body: text, at: new Date().toISOString(), uuid })); editing = null; }
      catch (e) { say(e.message); }
      refresh();
    }
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const file = photo.files && photo.files[0] || null;
      save.disabled = true;
      try {
        const f = file ? { blob: file, name: file.name, mime: file.type, size: file.size, sha256: await sha256(file) } : null;
        await q.add(Q.captureOp({ farm: farm.id, user: user.id, body: note.value, file: f, at: new Date().toISOString(), uuid }));
        root.navigator.storage?.persist?.().catch(() => {});   // ask the browser not to clear what waits
        form.reset();
        say(root.navigator.onLine === false ? "Saved on this phone. It uploads when you're back online." : "Saved.");
      } catch (e) { say(e.message || String(e)); }
      finally { save.disabled = false; refresh(); }
    });
    const view = { refresh, reload };
    views.add(view);
    refresh(); reload();
    return { destroy() { views.delete(view); urls.forEach((u) => URL.revokeObjectURL(u)); box.remove(); }, refresh, reload, queue: q };
  }
  FP.capture = { start, mount, keeps, watch, get queue() { return queue; }, get held() { return held; } };
})(window);
