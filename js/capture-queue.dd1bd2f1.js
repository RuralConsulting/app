// B4b: the capture queue. A note or a photo captured in the paddock is kept on the phone first (IndexedDB) and uploaded
// when there is coverage, in the order it was captured, each exactly once. Every step of an upload is idempotent: the
// entry and its file carry ids made on the phone, so a request that half-succeeded (written, answer lost) is retried
// without a second entry or file, and a step already done is not repeated after a reload. An edit made offline carries
// the version it was made on: if the entry changed on the server meanwhile (another device), the server keeps the newer
// version and the offline one is kept beside it in entry_history (public.sync_entry_edit), and the line says so.
// The queue lives in the page's IndexedDB, never in the service worker's caches, so a new sw.js activating while items
// wait leaves them alone (it clears only its own caches). Pure apart from idbStore(); tested in
// tests/app/capture-queue.test.cjs.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.FP = root.FP || {}; root.FP.captureQueue = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const DB = "fp-capture", STORE = "ops";
  const KEEP_DONE = 20;   // finished items kept on the phone (for the Synced line); older ones are let go
  const OPEN = ["pending", "syncing"];
  // Retrying while the phone says it is online (a weak signal never fires "online"): 15 s, doubling to 5 min.
  const RETRY_FIRST_MS = 15000, RETRY_MAX_MS = 300000;
  // A server that answers with an error every time (a 5xx that never clears) would hold the queue for ever: after this
  // many answered failures an item becomes Not uploaded (kept, with Try again) and the rest go on. A request that got no
  // answer at all (no coverage) never counts: that waits as long as it takes.
  const MAX_ANSWERED_FAILURES = 6;

  // ---- where the queue is kept ----------------------------------------------------------------------------------
  // IndexedDB: one object store keyed by an increasing number, so reading it back is capture order. A blob is kept as is.
  function idbStore(idb) {
    let opened = null;
    const open = () => opened || (opened = new Promise((resolve, reject) => {
      const req = idb.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true }); };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); opened = null; }; resolve(db); };
      req.onerror = () => { opened = null; reject(req.error); };
    }));
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
        let out; req.onsuccess = () => { out = req.result; };
        t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
      });
    };
    return { persistent: true,
      add: (op) => tx("readwrite", (s) => s.add(op)), put: (op) => tx("readwrite", (s) => s.put(op)),
      remove: (seq) => tx("readwrite", (s) => s.delete(seq)), all: () => tx("readonly", (s) => s.getAll()) };
  }
  // In memory (no IndexedDB: a private window, or the tests). `rows` is the backing: a test hands the same Map to a second
  // queue to stand for the page reloading. Records are copied in and out, as IndexedDB's structured clone does.
  function memoryStore(rows = new Map(), persistent = false) {
    const clone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
    return { persistent, rows,
      async add(op) { const seq = Math.max(0, ...rows.keys()) + 1; rows.set(seq, clone({ ...op, seq })); return seq; },
      async put(op) { rows.set(op.seq, clone(op)); return op.seq; },
      async remove(seq) { rows.delete(seq); },
      async all() { return [...rows.keys()].sort((a, b) => a - b).map((k) => clone(rows.get(k))); } };
  }

  // ---- what a captured item is ----------------------------------------------------------------------------------
  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif" };
  // A new entry: a photo (with what was written as its caption) when a photo is attached, otherwise a note. The ids are
  // made here so every retry names the same rows. Entry files go in the uploader's own folder (storage policy).
  function captureOp({ farm, user, body, file, at, uuid }) {
    const entryId = uuid(), text = String(body || "").trim();
    if (!file && !text) throw Error("Write a note or add a photo first.");
    const op = { id: uuid(), kind: "create", farm_id: farm, user_id: user, entry_id: entryId, type: file ? "photo" : "note",
      body: text || null, captured_at: at, queued_at: at, state: "pending", done: [], tries: 0, error: null };
    if (file) {
      const fileId = uuid(), mime = String(file.mime || "application/octet-stream").toLowerCase();
      op.file = { id: fileId, blob: file.blob, name: file.name || null, mime, size: file.size, sha256: file.sha256,
        path: farm + "/entries/" + user + "/" + entryId + "/" + fileId + (EXT[mime] ? "." + EXT[mime] : "") };
    }
    return op;
  }
  // CAP1: a capture for a catchment group or sub-group (a photo with tags, a water sample, pest control), made on the phone.
  // `record` is public.capture_save's argument (capture-model.js record()); its client_id names the row on every send, and the
  // photo and thumbnail go to the maker's own folder under that id (capture-model.js paths()). entry_id is the client id, so a
  // refused capture holds nothing else back. The blobs are kept here until sent.
  function groupCaptureOp({ user, record, photo = null, thumb = null, at, uuid }) {
    if (!record?.client_id || !record.org_id) throw Error("A capture needs its place.");
    const file = (f) => (f && f.blob ? { blob: f.blob, path: f.path, mime: "image/jpeg", size: f.blob.size } : null);
    return { id: uuid(), kind: "group_capture", org_id: record.org_id, user_id: user, entry_id: record.client_id, record, photo: file(photo), thumb: file(thumb),
      queued_at: at, state: "pending", done: [], tries: 0, error: null };
  }
  // An edit of an entry's text, made on the version last read (its updated_at).
  function editOp({ farm, user, entry, body, at, uuid }) {
    if (!entry?.id || !entry.updated_at) throw Error("This record can't be edited here.");
    return { id: uuid(), kind: "edit", farm_id: farm, user_id: user, entry_id: entry.id, base_updated_at: entry.updated_at,
      body: String(body ?? ""), queued_at: at, state: "pending", done: [], tries: 0, error: null };
  }

  // ---- what an answer means -------------------------------------------------------------------------------------
  // "ok"; "duplicate" (already written by an earlier try: a unique id, or a storage object already there); "transient"
  // (no answer, a server or session hiccup: try again later, in order); "permanent" (refused: kept, shown, not retried).
  function outcome(res) {
    const e = res && res.error;
    if (!e) return "ok";
    const code = String(e.code || ""), text = String(e.message || e.error || "");
    const status = Number(res.status || e.status || 0), storage = String(e.statusCode || "");
    if (/^[0-9A-Z]{5}$/.test(code) && !/^PGRST/.test(code)) {   // a database answer: decided by its SQLSTATE
      if (code === "23505") return "duplicate";
      return /^(08|28|40|53|57)/.test(code) ? "transient" : "permanent";   // (28: not signed in yet: CAP1's capture_save waits for the sign-in)
    }
    if (storage === "409" || /already exists|duplicate/i.test(text)) return "duplicate";
    if (/^PGRST30/.test(code) || status === 401) return "transient";   // the session needs refreshing
    if (!status || status >= 500 || status === 408 || status === 429) return "transient";
    if (/failed to fetch|fetch failed|network|load failed/i.test(text)) return "transient";
    return "permanent";
  }
  const words = (res) => String(res?.error?.message || res?.error?.error || res?.message || "The upload was refused");
  // Whether the server answered at all (a status, or a database error code), as against no coverage.
  const answered = (res) => Number(res?.status || res?.error?.status || 0) > 0 || /^[0-9A-Z]{5}$/.test(String(res?.error?.code || ""));

  // ---- the queue ------------------------------------------------------------------------------------------------
  // store: idbStore or memoryStore; sb: the Supabase client (or the demo's); user(): the signed-in person's id (only their
  // own items are uploaded, as them); online(): navigator.onLine; onChange(): after every change of state.
  // later(fn, ms) / cancel(handle): the retry timer (setTimeout by default; a test hands in its own clock).
  function createQueue({ store, sb, user, online = () => true, now = () => new Date().toISOString(), uuid, onChange = () => {},
    later = (fn, ms) => setTimeout(fn, ms), cancel = (h) => clearTimeout(h) }) {
    let running = null, again = false, timer = null, delay = RETRY_FIRST_MS;
    const types = new Map();
    async function typeId(key) {
      if (types.has(key)) return types.get(key);
      const res = await sb.from("record_types").select("id,key,farm_id,org_id").eq("key", key);
      if (outcome(res) !== "ok") throw failure(res);
      const t = (res.data || []).find((r) => !r.farm_id && !r.org_id);
      if (!t) throw Object.assign(Error("No " + key + " record type"), { kind: "permanent" });
      types.set(key, t.id); return t.id;
    }
    const failure = (res) => Object.assign(Error(words(res)), { kind: outcome(res), answered: answered(res) });
    async function attempt(request, duplicateOk = true) {
      let res;
      try { res = await request(); } catch (e) { throw Object.assign(Error(e?.message || String(e)), { kind: "transient", answered: false }); }
      const k = outcome(res);
      if (k === "ok" || (k === "duplicate" && duplicateOk)) return res.data;
      // a duplicate where none can be: the same edit sent twice at once; the next try reads the first one's outcome
      throw Object.assign(Error(words(res)), { kind: k === "duplicate" ? "transient" : k, answered: answered(res) });
    }
    const save = async (op) => { await store.put(op); onChange(); };

    // One item, step by step. A step is recorded as done once answered, so a reload resumes after it; each step is also
    // safe to send twice (ids made on the phone; upsert off), for the request whose answer was lost.
    async function perform(op) {
      op.state = "syncing"; op.tries = (op.tries || 0) + 1; await save(op);
      try {
        if (op.kind === "create") {
          if (!op.done.includes("entry")) {
            const type_id = await typeId(op.type);
            await attempt(() => sb.from("entries").insert({ id: op.entry_id, farm_id: op.farm_id, type_id, body: op.body, captured_at: op.captured_at, visibility: "farm" }));
            op.done.push("entry"); await save(op);
          }
          if (op.file && !op.done.includes("upload")) {
            await attempt(() => sb.storage.from("documents").upload(op.file.path, op.file.blob, { contentType: op.file.mime, upsert: false }));
            op.done.push("upload"); await save(op);
          }
          if (op.file && !op.done.includes("file")) {
            await attempt(() => sb.from("entry_files").insert({ id: op.file.id, entry_id: op.entry_id, storage_path: op.file.path, sha256: op.file.sha256,
              mime_type: op.file.mime, size_bytes: op.file.size, variant: "original", captured_at: op.captured_at }));
            op.done.push("file");
          }
          op.state = "synced";
        } else if (op.kind === "group_capture") {
          // CAP1: the photo, its thumbnail, then the record (the database refuses a record whose photo isn't there yet). Each step
          // is safe to send again: an object already there is "duplicate"; capture_save returns the row already made for this id.
          for (const [step, f] of [["upload", op.photo], ["thumb", op.thumb]]) {
            if (f && !op.done.includes(step)) {
              await attempt(() => sb.storage.from("documents").upload(f.path, f.blob, { contentType: f.mime, upsert: false }));
              op.done.push(step); await save(op);
            }
          }
          if (!op.done.includes("record")) {
            op.capture_id = await attempt(() => sb.rpc("capture_save", { c: op.record }), false);
            op.done.push("record");
          }
          op.state = "synced";
          if (op.photo) op.photo = { ...op.photo, blob: null };   // sent: the full photo leaves the phone's storage (the thumbnail stays a while)
        } else {
          const result = await attempt(() => sb.rpc("sync_entry_edit", { p_op: op.id, p_entry: op.entry_id, p_base: op.base_updated_at, p_body: op.body }), false);
          op.done.push("edit");
          op.state = result === "conflict" ? "conflict" : "synced";
        }
        op.error = null; op.synced_at = now(); await save(op);
        return "done";
      } catch (e) {
        op.error = e.message;
        if (e.kind !== "permanent" && e.answered) op.answered_failures = (op.answered_failures || 0) + 1;
        const giveUp = e.kind === "permanent" || (op.answered_failures || 0) >= MAX_ANSWERED_FAILURES;
        if (giveUp && e.kind !== "permanent") op.error = "The server kept refusing it (" + e.message + ")";
        op.state = giveUp ? "failed" : "pending";
        await save(op);
        return giveUp ? "failed" : "stopped";
      }
    }
    // Upload what waits, oldest first, one at a time. A transient failure stops the run (what follows waits its turn); a
    // refused item is kept as failed and the run goes on, except for later items about the same entry, which wait for it.
    async function run() {
      if (!online()) return { uploaded: 0, waiting: true };
      const me = user(), tried = new Set(), held = new Set();
      let uploaded = 0;
      for (;;) {
        const all = (await store.all()).filter((o) => o.user_id === me);
        for (const o of all) if (o.state === "failed") held.add(o.entry_id);
        const next = all.find((o) => !tried.has(o.seq) && OPEN.includes(o.state) && !held.has(o.entry_id));
        if (!next) break;
        tried.add(next.seq);
        const r = await perform(next);
        if (r === "stopped") return { uploaded, waiting: true };
        if (r === "failed") held.add(next.entry_id); else uploaded++;
        if (!online()) return { uploaded, waiting: true };
      }
      await prune(me);
      return { uploaded, waiting: false };
    }
    // Single flight: a sync asked for while one runs runs once more after it (an item added meanwhile is not missed).
    function sync() {
      if (running) { again = true; return running; }
      if (timer !== null) { cancel(timer); timer = null; }
      running = (async () => { let r; do { again = false; r = await run(); } while (again); return r; })()
        .finally(() => { running = null; });
      running.then(schedule, () => schedule({ waiting: true }));
      return running;
    }
    // After a run: something still waits and the phone says it is online (so no "online" event will come), try again
    // later, backing off; one timer at most. Nothing waiting, or offline (the "online" event will ask): no timer.
    function schedule(r) {
      if (!r || !r.waiting) { delay = RETRY_FIRST_MS; return; }
      if (!online() || timer !== null || running) return;
      const wait = delay;
      delay = Math.min(delay * 2, RETRY_MAX_MS);
      timer = later(() => { timer = null; sync(); }, wait);
    }
    async function prune(me) {
      const done = (await store.all()).filter((o) => o.user_id === me && (o.state === "synced" || o.state === "conflict") && !o.kept);
      for (const o of done.slice(0, Math.max(0, done.length - KEEP_DONE))) await store.remove(o.seq);
    }
    // A second edit of an entry while the first still waits replaces the first's text: both were made on the same version,
    // so sending both would make the phone's own second edit a conflict with its first. (Not while an upload runs: it may
    // hold the first already; then the second goes as its own edit, and at worst is kept as a conflict, never lost.)
    async function add(op) {
      const waiting = op.kind === "edit" && !running && (await store.all()).find((o) => o.kind === "edit" && o.state === "pending" && o.user_id === op.user_id && o.entry_id === op.entry_id);
      if (waiting) { waiting.body = op.body; await save(waiting); op = waiting; }
      else { op.seq = await store.add(op); onChange(); }
      if (online()) sync();
      return op;
    }
    // Mine, for this farm, in capture order.
    async function list(farm) { const me = user(); return (await store.all()).filter((o) => o.user_id === me && (!farm || o.farm_id === farm)); }
    async function retry(seq) { const op = (await store.all()).find((o) => o.seq === seq); if (op && op.state === "failed") { op.state = "pending"; op.answered_failures = 0; await save(op); } return sync(); }
    async function dismiss(seq) { await store.remove(seq); onChange(); }
    // CAP1: the group captures of the signed-in person (all of them, or one place's), in capture order; and everything a person
    // left on this phone, removed (signing out: no one's captures stay for the next person).
    async function captures(org) { const me = user(); return (await store.all()).filter((o) => o.kind === "group_capture" && o.user_id === me && (!org || o.org_id === org)); }
    async function forget(who) { for (const o of await store.all()) if (o.user_id === who) await store.remove(o.seq); onChange(); }
    return { add, sync, list, captures, retry, dismiss, forget, store, get running() { return running !== null; }, get retrying() { return timer !== null; } };
  }

  // ---- the lines on the farm's record ---------------------------------------------------------------------------
  // The farm's entries as read (photo and note), with what this phone holds folded in: a capture not yet uploaded is a
  // line of its own, "Pending upload"; one uploaded is the entry's line, "Synced"; a waiting edit shows its own text; a
  // kept conflict shows the server's text and says the offline version was kept. Newest captured first.
  const STATE_WORDS = { pending: "Pending upload", syncing: "Uploading…", synced: "Synced", failed: "Not uploaded", conflict: "Conflict kept" };
  function lines(ops, entries, typeKeys = {}) {
    const byId = new Map();
    for (const e of entries || []) byId.set(e.id, { id: e.id, type: typeKeys[e.type_id] || "note", body: e.body ?? null, captured_at: e.captured_at || e.created_at || null,
      updated_at: e.updated_at || null, state: null, error: null, file: null, seq: null, server: true });
    for (const o of [...(ops || [])].sort((a, b) => a.seq - b.seq)) {
      let line = byId.get(o.entry_id);
      if (o.kind === "create") {
        if (!line) { line = { id: o.entry_id, type: o.type, body: o.body, captured_at: o.captured_at, updated_at: null, server: false }; byId.set(o.entry_id, line); }
        line.file = o.file || null;
      } else if (!line) continue;   // an edit of an entry this view didn't read
      else if (o.state !== "synced" && o.state !== "conflict") line.body = o.body;   // the edit waiting to go up
      line.state = o.state; line.error = o.error || null; line.seq = o.seq; line.op = o.kind;
    }
    return [...byId.values()].sort((a, b) => String(b.captured_at || "").localeCompare(String(a.captured_at || "")));
  }
  const stateWords = (s) => STATE_WORDS[s] || "";

  return { DB, STORE, RETRY_FIRST_MS, RETRY_MAX_MS, MAX_ANSWERED_FAILURES, idbStore, memoryStore, captureOp, groupCaptureOp, editOp, outcome, createQueue, lines, stateWords };
});
