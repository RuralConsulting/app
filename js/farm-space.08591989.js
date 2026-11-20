// The farm space: header, map with its standing answers, and Ask, Create, Documents. Reads only, except People
// (owners and admins add, change and remove people; the farm_members policies decide what is allowed).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./farm-model.js") : root.FP.farmModel, node ? require("./farm-reference.js") : root.FP.farmReference, node ? require("./route-timing.js") : root.FP.routeTiming,
    node ? require("./layer-kinds.js") : root.FP.kinds, node ? require("./document-files.js") : root.FP.documentFiles);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmSpace = api;
})(typeof window === "undefined" ? globalThis : window, function (M, R, T, K, Files) {
  async function read(query) { const { data, error } = await query; if (error) throw error; return data; }
  // Tiers (F1e) and who chose one (B3's tiered_at) are read when the database has them. relates_to is read through
  // document_relations, which withholds a relationship whose other end the reader can't see. context.documentTiers
  // says what the database holds, so the view offers only what it can save: "chosen" (tier and tiered_at), "tiers" (F1e only)
  // or "none" (F1e not deployed yet: no tier is read, documents go by docClass, nothing is added or moved, no error).
  // It is learnt once per client (page), so a database without the columns costs one refused read, not one per farm.
  const learnt = new WeakMap();
  const DOCUMENT_COLUMNS = "id,title,doc_type,author,author_org,date_prepared,period_start,period_end,page_count,storage_path,original_name,sha256,size_bytes,status,created_at,model,model_version";
  const TIER_COLUMNS = { chosen: ",tier,tiered_at", tiers: ",tier", none: "" };
  const missingColumn = (e) => e && (e.code === "42703" || e.code === "PGRST204" || /column|tier/i.test(e.message || ""));
  async function readDocuments(sb, farm) {
    // V5: bounded: count first, then fetch at most that many.
    const n = await Files.countRows(sb, { farm_id: farm.id });
    // FL1: with the made folder a file sits in, where the database has the column (learnt once, as the tiers are)
    const query = (columns) => sb.from("documents").select(DOCUMENT_COLUMNS + columns + Files.folderColumn(sb)).eq("farm_id", farm.id).order("title").limit(n);
    let rows = null;
    for (const level of learnt.has(sb) ? [learnt.get(sb)] : ["chosen", "tiers", "none"]) {
      let { data, error } = await query(TIER_COLUMNS[level]);
      if (error && Files.noFolders(sb, error)) ({ data, error } = await query(TIER_COLUMNS[level]));
      if (!error) { rows = data; learnt.set(sb, level); break; }
      if (!missingColumn(error) || level === "none") throw error;
    }
    if (learnt.get(sb) === "none" || !rows.length) return rows;
    return Files.withRelations(sb, rows);
  }
  // FU4: the farm's open read-it-in requests (public.plan_import_requests), for the Documents lines. Optional: a database without the
  // table, or a refused read, reads as no requests.
  const PLAN_REQUEST_COLUMNS = "id,document_id,requested_by,requested_by_name,requested_at,status";
  const readPlanRequests = (sb, farm) => Promise.resolve(sb.from("plan_import_requests").select(PLAN_REQUEST_COLUMNS).eq("farm_id", farm.id).eq("status", "requested"))
    .then((r) => (r.error ? [] : r.data || []), () => []);
  const nzToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  const optional = (query) => Promise.resolve(query).then((r) => (r.error ? [] : r.data || []), () => []);
  // What's due's own record-keeping (E5): conditions marked done (a met check nothing has superseded) and records (an
  // entry linking a condition to a document). Optional: if either can't be read, the conditions read as before.
  const readChecks = (sb, farm) => optional(sb.from("checks").select("id,obligation_id,status,created_at,superseded_at").eq("farm_id", farm.id))
    .then((rows) => rows.filter((c) => c.obligation_id && c.status === "met" && !c.superseded_at));
  const readRecords = (sb, farm) => optional(sb.from("entry_links").select("entry_id,obligation_id,document_id").eq("farm_id", farm.id)).then(M.recordLinks);
  // Everything a farm space shows, in one round of caller-scoped reads (row-level security decides what comes back).
  const SOURCE_COLUMNS = "key,name,theme,provider,licence,attribution,summary,refreshed_at,effective_from,feature_count,coverage,serve_to_customers";
  // PERF1b: two halves read at once. The map's (loadMap: farm_map, the farm's own layers since PERF1a, with what its popups
  // and Layers need) is all the farm needs to be drawn; the rest (loadRest) is the standing answers' and the views'. The
  // space draws the farm as soon as the map's half is back and fills in the rest when it comes.
  // onMap (TIM1): called when farm_map itself is back, whatever the three reads beside it are doing (the route's `data` step).
  // LK2 (review-444 follow-up 4): the looks read never holds the map. It has its own short limit; the farm is drawn with the
  // looks if they are back by the time the map's half is, and otherwise they are applied when they come (`lateStyles`).
  const LOOKS_TIMEOUT_MS = 5000;
  function readLooks(sb, farm) {
    let done = false, value = [], timer = null;
    const limit = new Promise((resolve) => { timer = setTimeout(() => resolve([]), (typeof FP === "object" && FP.farmSpace?.looksTimeoutMs) || LOOKS_TIMEOUT_MS); });
    const later = Promise.race([optional(sb.rpc("layer_styles_for_map", { f: farm.id })), limit])
      .then((v) => { clearTimeout(timer); done = true; value = Array.isArray(v) ? v : []; return value; });
    return { now: () => (done ? { styles: value } : { styles: [], lateStyles: later }) };
  }
  async function loadMap(sb, farm, user, { onMap } = {}) {
    const reads = Promise.all([
      read(sb.rpc("farm_map", { f: farm.id })).then((v) => { onMap?.(); return v; }),
      // The advisor notes on the map's layers (LN1): the narrowest shows in a layer's info panel. Optional: without
      // them the map is as it was.
      optional(sb.rpc("layer_notes_for_farm", { f: farm.id })),
      // The farmed boundary (FB1): the area actually farmed, the farm's own record, a layer in Layers once there is one.
      // Optional: without it the map is as it was.
      optional(sb.rpc("farm_holding", { f: farm.id })),
      // Where the reference layers came from (PROV1): each served source's provider, licence, as-at date and summary. Optional:
      // without them a popup still names its layer's source, and the Layers drawer has no Sources entry.
      optional(sb.from("reference_sources").select(SOURCE_COLUMNS).eq("serve_to_customers", true)),
    ]);
    // The reviewed looks of the farm's layers and of the shared sources and themes (LK1, #416), in the same round. Optional:
    // without them every layer is drawn as it was (its QGIS style, then today's rule). Never waited for (readLooks).
    const looks = readLooks(sb, farm);
    const [maps, notes, holding, sources] = await reads;
    if (!maps) throw Error("This farm isn't shared with your login.");
    Object.assign(maps, looks.now());
    // CAP1b: a layer farm_map defers (CAP1a: too large to come inline) may come with no features at all: an empty
    // collection, so the Map scene draws its row and the features read for the map in view fill it
    for (const l of maps.layers || []) if (l && !Array.isArray(l.features?.features)) l.features = { type: "FeatureCollection", features: [] };
    const farmed = M.farmedAreaLayer(holding);
    if (farmed) maps.layers = [...(maps.layers || []), farmed];
    maps.reference = maps.reference || [];   // [] since PERF1a; a database before it still fills it in (read as the cache)
    maps.sources = sources;   // the reference_sources rows, for the provenance lines in popups and the Sources list
    maps.layer_notes = notes; maps.viewer = user.id;   // the notes, and who is reading them (a note says "you" for its own writer)
    return maps;
  }
  // How many features each served source has in the farm's context (PERF1a's farm_reference_counts, no geometry): the
  // Layers drawer's reference rows and the Sources list. {counts, failed}: counts is null when the function isn't there (a
  // database before PERF1a: farm_map's own reference entries say instead), and then nothing failed. Any other error (a
  // timeout, a refused read, a thrown request) is `failed`: the drawer and the Sources list say so (FU2), never an empty list.
  const readCounts = (sb, farm) => Promise.resolve(sb.rpc("farm_reference_counts", { f: farm.id }))
    .then((r) => (r.error ? { counts: null, failed: !R.missing(r.error) } : { counts: !r.data || typeof r.data !== "object" ? null : r.data, failed: false }),
      (e) => ({ counts: null, failed: !R.missing(e) }));
  function loadRest(sb, farm, user) {
    return Promise.all([
      // HV1: maybeSingle: a group's coordinator reading a member's farm has no role on it (null), and reads it all the same
      read(sb.from("farm_members").select("role").eq("farm_id", farm.id).eq("user_id", user.id).maybeSingle()),
      read(sb.from("org_members").select("role").eq("org_id", farm.org_id).eq("user_id", user.id).maybeSingle()),
      readDocuments(sb, farm),
      read(sb.from("authorisations").select("id,kind,title,consent_no,rule_ref,valid_from,valid_to,created_at").eq("farm_id", farm.id).order("title")),
      // Optional: if the dates can't be read, "What's due" says so rather than claiming nothing is due.
      Promise.resolve(sb.from("obligations").select("id,authorisation_id,code,summary,full_text,kind,parameters,due_date,recurrence,source_document_id,source_page").eq("farm_id", farm.id)).then((r) => r, (e) => ({ error: e })),
      sb.today ? sb.today() : nzToday(),
      readChecks(sb, farm), readRecords(sb, farm), readCounts(sb, farm),
    ]);
  }
  function assemble(sb, farm, user, maps, [member, org, documents, authorisations, obligations, today, checks, records, counts]) {
    const role = member?.role || null;
    const advisor = ["owner", "admin", "edit"].includes(role) && ["admin", "advisor", "facilitator"].includes(org?.role);
    // Who the answers are curated for: the farm's own people read them as a farmer, an advisor as an advisor.
    return { farm, user, role, orgRole: org?.role || null, advisor, audience: advisor ? "advisor" : "farmer", maps, documents, authorisations, today, documentTiers: learnt.get(sb) || "none",
      obligations: obligations.error ? [] : obligations.data || [], obligationsError: !!obligations.error, checks, records, referenceCounts: counts.counts, referenceCountsFailed: counts.failed };
  }
  // Both halves, as one context (what the tests and a re-read use).
  async function load(sb, farm, user) {
    const [maps, rest] = await Promise.all([loadMap(sb, farm, user), loadRest(sb, farm, user)]);
    return assemble(sb, farm, user, maps, rest);
  }
  // The light portfolio read (0038): one caller-scoped row per farm, in one request. A farm's full record is
  // read (load) only when that farm is opened.
  const summaries = (sb) => read(sb.from("farm_summaries").select("*"));

  let portfolio = [], user = null, context = null, pending = null, token = 0, openedMap = null, framedOverlap = 0, reserveHeader = () => {};
  // The blocks this space has mounted (docs/BUILDING-BLOCKS.md §2): the map scene, the standing answers, the open view.
  let scene = null, answers = [], view = null;
  // Water quality nearby (M1b, wq.js): a line after the standing answers; its sites are on the map only while it is open.
  let wq = null;
  // The standing answers' models, and the What's due line whose place the map is framed on (null: the farm).
  let standing = [], focused = null;
  // What the map shows (E5, #244): the layer rows drawn for this farm, the route it is showing, the place a chosen
  // What's due line brings, whether a photo has been opened in this view, and the layers the person set by hand.
  let layerEntries = [], shownRoute = null, focusPlace = null, photoShown = false, handSet = new Map(), layersButton = null;
  let stackOk = new Set(), offZoom = null;   // LK4: context fills the person chose to show together ("a|b"); the zoom rules' hook
  // Ask (the farm's Ask function): the layer set its answer brought up (until the view changes), and the last answer on
  // this farm, kept so the Ask tab shows it again after a source or the plan was opened.
  let askSet = null, lastAsk = null, askToken = 0;
  // PERF1b: the farm being read (its map's half, and the id it is for), and its reference sources (farm-reference.js),
  // read one at a time when something switches one on; the drawn scene's own rows until the Layers rows are made.
  let mapsPending = null, pendingFor = null, refs = null, sceneEntries = [];
  // TIM1 (#409, #410): the route timing run for the farm being read (route-timing.js), from when its route began loading.
  let timing = null;
  // CAP1b: what is read for the map in view (group-layers.js, the module the group map uses): the farm's deferred layers and
  // the reference sources whose entry came truncated; made only when the farm has one, with the map's moveend hook.
  let parts = null, offMove = null;
  const unmount = (...handles) => { for (const h of handles.flat()) h?.destroy(); };
  // A farm left: what was being read for it is dropped (a read still on its way is ignored when it lands).
  function forget() { pending = null; mapsPending = null; pendingFor = null; refs?.destroy(); refs = null; sceneEntries = []; dropParts(); timing = null; T?.cancel("farm"); }
  function dropParts() { parts?.destroy(); parts = null; offMove?.(); offMove = null; }
  // Each answer is an Answer block in its own host, so the space never writes answer HTML itself.
  function answer(host, model, options) {
    const node = el("div", { class: "block-host" });
    host.append(node);
    return FP.blocks.render(node, { block: "answer", owner: { farm: context.farm.id }, options }, { read: () => model, level: 2, href: FP.href });
  }
  const $ = (s) => FP.$(s), el = (...a) => FP.el(...a);
  function close() {
    FP.mapsView?.close();
    FP.placeHome?.close();
    FP.farmPlan?.close();   // FEP1
    FP.farmActions?.close();   // ACT1
    FP.addBlock?.close(false);
    document.body.classList.remove("farm-space-active", "farm-detail", "portfolio-active");
    flushDone();   // a Done still inside its Undo window is written before the farm is left (#258)
    $("#portfolio")?.setAttribute("hidden", ""); token++; context = null; forget(); openedMap = null;
    unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
    wq?.destroy(); wq = null;
    layerEntries = []; focusPlace = null; photoShown = false; handSet = new Map(); stackOk = new Set(); askSet = null; lastAsk = null; pendingAsk = null; proposals.clear();
    $("#farm-space-header")?.setAttribute("hidden", "");
    document.documentElement.style.setProperty("--sheet-overlap", "0px"); framedOverlap = 0;
    FP.add?.update(null);
  }
  function setPortfolio(farms, person) { portfolio = farms; user = person; init(); }
  function init() {
    if ($("#farm-space-header")) return;
    const h = el("header", { id: "farm-space-header", hidden: true });
    // UI1: the space's header. One row: a way back to every place, the farm's mark, name and kind, Add, and one account button
    // (the person, the farm switcher, People, Layer notes, Operations, Change password, Privacy and Sign out sit behind it, on a
    // phone and a computer alike). The views: a segmented control in the header on a computer, a tab bar along the bottom on a phone.
    h.className = "space-head";
    h.innerHTML = '<div class="farm-header-row space-bar"><a id="space-home" class="space-back" href="#/places" hidden><span class="space-back-label">All places</span></a>' +
      '<div class="space-identity"><span id="space-mark" class="space-mark" aria-hidden="true"></span><div class="space-title"><h1><a id="space-farm-name" href="#"></a></h1><p id="space-kind" class="space-kind">Farm</p></div></div>' +
      '<div class="space-actions"><span class="add-slot" id="farm-add-slot"></span>' +
      '<button type="button" id="account-open" class="account-open" aria-haspopup="true" aria-expanded="false" aria-controls="account-menu" aria-label="Account and people"><span id="account-initials" aria-hidden="true"></span></button>' +
      '<div id="account-menu" class="account-menu"><label class="farm-switch-label">Farm<select id="farm-switch"></select></label>' +
      '<span class="farm-links"><a id="space-people" class="link" hidden>People</a><a id="space-layers" class="link" hidden>Layer notes</a><a id="space-ops" class="link ops-link" hidden>Operations</a><a class="link privacy-link" href="#/privacy">Privacy and terms</a></span><span id="space-person"></span><span id="account-role" class="account-role" hidden></span><span class="password-link"><button type="button" class="link b-password">Change password</button></span><button class="link" id="space-signout">Sign out</button></div></div></div>' +
      '<nav id="farm-actions" class="space-tabs" aria-label="Farm"></nav>';
    h.querySelector("#space-home").prepend(FP.icon("back", 20));
    FP.add?.mount(h.querySelector("#farm-add-slot"), "farm");
    document.body.prepend(h);
    FP.privacy?.links();   // V8: the note's link, with the demo's address in the demo
    reserveHeader = () => document.documentElement.style.setProperty("--farm-header-height", h.hidden ? "0px" : h.getBoundingClientRect().height + "px");
    new ResizeObserver(() => { reserveHeader(); measureSheet(); }).observe(h);
    const menu = $("#account-menu"), account = $("#account-open");
    const setMenu = (open) => { menu.classList.toggle("open", open); account.setAttribute("aria-expanded", String(open)); };
    account.addEventListener("click", () => { setMenu(!menu.classList.contains("open")); });
    menu.addEventListener("click", (e) => { if (e.target.closest("a, button")) setMenu(false); });
    menu.addEventListener("change", () => setMenu(false));
    document.addEventListener("click", (e) => { if (!e.target.closest("#account-menu, #account-open")) setMenu(false); });
    window.addEventListener("hashchange", () => setMenu(false));
    // a Done still inside its Undo window is written when the page is hidden or closed (#258)
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushDone(); });
    window.addEventListener("pagehide", flushDone);
    window.addEventListener("resize", () => { measureSheet(); });
    $("#farm-switch").addEventListener("change", (e) => { location.hash = FP.href(farmTarget(e.target.value)); });
    $("#space-signout").addEventListener("click", async () => {
      if (FP.demo?.active) location.href = location.pathname + location.search;
      else { await FP.auth.signOut(); location.hash = ""; location.reload(); }
    });
    // The phone sheets (What's due, and Ask, Create and Documents) open over the map: the farm is re-framed in
    // what stays visible above them, and back again when they close.
    // UI1: each sheet is a peek, open, or full height (a reading or form state); every change is a visible button
    // (Open / Collapse on the bar, Expand / Reduce beside it), never only a drag.
    $("#overview-toggle").addEventListener("click", () => setSheet("due", sheetState("due") === "peek" ? "open" : "peek"));
    $("#space-handle").addEventListener("click", () => setSheet("space", sheetState("space") === "peek" ? "open" : "peek"));
    $("#overview-size").addEventListener("click", () => setSheet("due", sheetState("due") === "full" ? "open" : "full"));
    $("#space-size").addEventListener("click", () => setSheet("space", sheetState("space") === "full" ? "open" : "full"));
    // A photo opened on a phone's map takes the bottom of the map as its sheet: the other sheets fold to their peek
    // first (without re-framing the farm), so the photo is framed in the map left above it.
    $("#map").addEventListener("fp-photo", () => {
      if (focused) { focused = null; markFocused(); }   // the photo's frame replaces a chosen line's: its mark is gone too
      focusPlace = null; photoShown = true; applyScene();   // a photo opened: Photos on, until the view changes
      for (const fold of $("#overview-cards").querySelectorAll("details.checklist-fold[open]"))   // and a chosen line folds away with its mark
        if (standing.some((m) => m.places?.[fold.closest("[data-item-id]")?.dataset.itemId])) fold.open = false;
      if (window.innerWidth > 800) return;
      setSheet("due", "peek", false);
      if (!$("#space-content").hidden) setSheet("space", "peek", false);
      framedOverlap = measureSheet();
    });
    $("#layers-close").addEventListener("click", () => { setDrawer(false); layersButton?.focus(); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // On People, Escape goes home (#242) only when nothing else is open over it (the account menu, Layers, a photo)
      // and the key isn't being typed into a field (the email being added is kept).
      const over = $("#account-menu").classList.contains("open") || !$("#layers-drawer").hidden || !!FP.farmMap.photoOpen();
      const typing = !!e.target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])");
      if (shownRoute?.view === "people" && !over && !typing) $("#space-farm-name").click();
      if ($("#account-menu").classList.contains("open")) { $("#account-menu").classList.remove("open"); $("#account-open").setAttribute("aria-expanded", "false"); $("#account-open").focus(); }
      setDrawer(false);
      setSheet("due", "peek", false);
      if (FP.farmMap.photoOpen()) FP.farmMap.dismissPhoto();
      settleFrame();
    });
    // Opening a What's due line (its fold) whose condition records its place frames the map on it, marks it and brings
    // the layers that place needs; closing it goes back to the farm and the quiet map. A line with no place moves nothing.
    const isOpen = (id) => $("#overview-cards").querySelectorAll('[data-item-id="' + CSS.escape(id || "") + '"] details.checklist-fold[open]').length > 0;
    const choose = (id, open) => {
      const place = id && standing.find((m) => m.places?.[id])?.places[id];
      if (!place) return false;
      const next = open ? id : focused === id ? null : focused;
      if (next === focused) return true;
      if (!FP.farmMap.focus(next ? place : null)) {
        // PERF1b: its bores may not be read yet: read them, then frame it if its line is still open (once: whenRead
        // reads only sources not tried yet, so a second miss moves nothing)
        if (next) whenRead(place, () => { if (isOpen(id)) choose(id, true); });
        return true;   // nothing on this map for it: say nothing, move nothing
      }
      focused = next; focusPlace = next ? place : null;
      applyScene(); markFocused();
      return true;
    };
    // toggle doesn't bubble: listen as it passes down
    $("#overview-cards").addEventListener("toggle", (e) => {
      const fold = e.target;
      if (!fold.matches?.("details.checklist-fold")) return;
      const id = fold.closest("[data-item-id]")?.dataset.itemId;
      const stillOpen = isOpen(id);
      choose(id, fold.open || stillOpen);
    }, true);
    // Done and Add the record (E5): a condition marked done, or a document added and linked to it.
    $("#overview-cards").addEventListener("click", (e) => {
      const done = e.target.closest("[data-check-done]"), undo = e.target.closest("[data-check-undo]");
      if (done) { startDone(done.dataset.checkDone); return; }
      if (undo) { undoDone(undo.dataset.checkUndo); return; }
      if (e.target.closest("[data-doc-cancel]")) { const box = e.target.closest(".checklist-upload"); box.replaceChildren(); box.hidden = true; }
    });
    $("#overview-cards").addEventListener("change", (e) => { const input = e.target.closest?.("[data-check-file]"); if (input) chooseRecord(input); });
    // Consent conditions from ECan (CC1): Fetch on a What's due line, then Accept or Discard (there and in Ask's answer).
    for (const host of [$("#overview-cards"), $("#space-content")]) host.addEventListener("click", (e) => {
      const fetch = e.target.closest("[data-fetch-conditions]"), yes = e.target.closest("[data-cc-accept]"), no = e.target.closest("[data-cc-discard]");
      if (fetch) fetchConditions(fetch); else if (yes) acceptConditions(yes); else if (no) discardConditions(no);
    });
    // Water-quality analyses in Ask's answer (X1): Confirm, Recalculate with the person's settings, Save as note.
    $("#space-content").addEventListener("click", (e) => {
      const b = e.target.closest("[data-wq-confirm], [data-wq-recalc], [data-wq-note]");
      if (b) wqAction(b);
    });
    $("#overview-cards").addEventListener("submit", (e) => { if (e.target.matches(".checklist-upload .doc-confirm-form")) { e.preventDefault(); addRecord(e.target); } });
    $("#space-content").addEventListener("click", async (e) => {
      const button = e.target.closest("[data-open-document]");
      const doc = button && context?.documents.find((d) => d.id === button.dataset.openDocument);
      if (!doc?.storage_path) return;
      // An onboarding report (ON1) opens in the checklist view, as it was saved.
      if (String(doc.doc_type || "").toLowerCase() === "onboarding_report") { location.hash = FP.href(M.href(context.farm.id, "onboarding", doc.id)); return; }
      // the document opened is the one selected: the map follows it (the plan brings the FEP's layers)
      const stay = shownRoute?.view === "documents" && shownRoute.item !== doc.id ? FP.href(M.href(context.farm.id, "documents", doc.id)) : null;
      if (stay) location.replace(stay);
      // FL2: the file opens inside the app, read with the person's sign-in; no signed storage link reaches the address bar
      FP.fileView.open({ sb: FP.sb, path: doc.storage_path, name: FP.documentsBlock.downloadName(doc), title: M.docTitle(doc), size: doc.size_bytes, opener: button, stay });
    });
    // Enter asks (Shift+Enter is a new line); the phone keyboard's key reads "send" for the same reason.
    $("#space-content").addEventListener("keydown", (e) => {
      if (!e.target.matches?.("#ask-input") || !M.entersToSubmit(e)) return;
      e.preventDefault(); $("#ask-form").requestSubmit();
    });
    $("#space-content").addEventListener("submit", (e) => {
      if (e.target.matches("#people-add")) { e.preventDefault(); addPerson(); return; }
      if (!e.target.matches("#ask-form")) return;
      e.preventDefault();
      const question = $("#ask-input").value.trim();
      if (!question) { $("#ask-input").focus(); return; }
      askQuestion(question);
    });
    // An answer's confirmations: the person's Confirm makes the change, as them; Not now puts it away.
    $("#space-content").addEventListener("click", (e) => {
      const yes = e.target.closest("[data-ask-confirm]"), no = e.target.closest("[data-ask-dismiss]");
      if (yes) confirmAsk(Number(yes.dataset.askConfirm), yes);
      else if (no && lastAsk?.result.confirmations?.[Number(no.dataset.askDismiss)]) { lastAsk.result.confirmations[Number(no.dataset.askDismiss)].state = "dismissed"; showAnswer(false); }
    });
    $("#space-content").addEventListener("change", (e) => {
      const select = e.target.closest("[data-role-for]");
      if (select) changeRole(select.dataset.roleFor, select.value, select);
    });
    $("#space-content").addEventListener("click", (e) => {
      const button = e.target.closest("[data-remove]");
      if (!button) return;
      // Two steps: the first press asks, the second removes.
      if (!button.dataset.confirm) {
        button.dataset.confirm = "1"; button.textContent = "Remove access?"; button.classList.add("confirm");
        return;
      }
      removePerson(button.dataset.remove, button);
    });
    $("#space-content").addEventListener("focusout", (e) => {
      const button = e.target.closest?.("[data-remove][data-confirm]");
      if (button) { delete button.dataset.confirm; button.textContent = "Remove"; button.classList.remove("confirm"); }
    });
  }
  function markFocused() {
    for (const n of $("#overview-cards").querySelectorAll("[data-item-id]")) {
      const place = standing.some((m) => m.places?.[n.dataset.itemId]);
      n.classList.toggle("has-place", place); n.classList.toggle("framed-record", place && n.dataset.itemId === focused);
    }
  }
  // The phone sheets (UI1): "peek" (the bar only), "open" (about 60%) or "full" (the whole map area, for reading or a form).
  // Wide screens have no sheets: the same markup is the rail beside the map and these controls are hidden there.
  const sheetBox = (which) => $(which === "space" ? "#space-content" : "#overview-rail");
  function sheetState(which) {
    const box = sheetBox(which), open = which === "space" ? !box.classList.contains("peeked") : box.classList.contains("expanded");
    return !open ? "peek" : box.classList.contains("full") ? "full" : "open";
  }
  function setSheet(which, state, frame = true) {
    const space = which === "space", box = sheetBox(which), open = state !== "peek", name = space ? $("#space-handle-label").textContent || "this view" : "What's due";
    if (space) box.classList.toggle("peeked", !open); else box.classList.toggle("expanded", open);
    box.classList.toggle("full", state === "full");
    $(space ? "#space-handle" : "#overview-toggle").setAttribute("aria-expanded", String(open));
    $(space ? "#space-act" : "#overview-act").textContent = open ? "Collapse" : "Open";
    const size = $(space ? "#space-size" : "#overview-size");
    size.hidden = !open; size.textContent = state === "full" ? "Reduce" : "Expand"; size.setAttribute("aria-pressed", String(state === "full"));
    size.setAttribute("aria-label", (state === "full" ? "Reduce " : "Expand ") + name + (state === "full" ? " from full height" : " to full height"));
    if (open && window.innerWidth <= 800) FP.farmMap.closePopup?.();   // a popup would sit under the sheet
    if (frame) settleFrame();
  }
  // Phone: how far the open sheet covers the map (--sheet-overlap, read by the map when it frames the farm).
  function measureSheet() {
    let overlap = 0;
    const sheet = window.innerWidth <= 800 && [$("#space-content"), $("#overview-rail")].find((n) => !n.hidden);
    if (sheet) overlap = sheet.classList.contains("full") ? framedOverlap : M.sheetOverlap($("#map").getBoundingClientRect().bottom, sheet.getBoundingClientRect().top);   // full height: the farm keeps the frame it had
    document.documentElement.style.setProperty("--sheet-overlap", overlap + "px");
    return overlap;
  }
  // A sheet opened or closed: frame the farm again in the visible map, unless it is already framed for that.
  function settleFrame() {
    const overlap = measureSheet();
    if (overlap === framedOverlap || !context) return;
    framedOverlap = overlap;
    FP.farmMap.reframe(context.maps.extent);
  }
  function farmTarget(id) {
    let target = id ? M.href(id, "home") : "";   // J2: a farm opens on its Home
    try { if (id) target = sessionStorage.getItem("fp-view-" + user.id + "-" + id) || target; } catch {}
    return target;
  }
  // The home page's map screen (LP1): the farm space puts its own things away and leaves the map, whole-window, to js/home.js,
  // which draws every farm and group the person can see (the NZ -> farm zoom starts here).
  function showPortfolio() {
    FP.mapsView?.close();
    token++;
    flushDone();
    context = null; forget(); openedMap = null;
    unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
    wq?.destroy(); wq = null;
    document.body.classList.remove("farm-space-active", "farm-detail");
    document.body.classList.add("portfolio-active");
    $("#farm-space-header")?.setAttribute("hidden", "");
    document.documentElement.style.setProperty("--sheet-overlap", "0px"); framedOverlap = 0;
    for (const id of ["#space-content", "#overview-rail", "#layers-drawer", "#map-msg"]) $(id).hidden = true;
    document.title = "Farms and groups | " + FP.brand?.product;
    FP.add?.update(null);
    FP.show("screen-map");
    $("#portfolio").hidden = false;
  }
  function header(farm, route) {
    $("#farm-space-header").hidden = false;
    const name = $("#space-farm-name");
    name.textContent = farm.name; name.href = FP.href(M.href(farm.id, "home"));   // J2: the farm's name leads to its Home
    if (route.view === "home") name.setAttribute("aria-current", "page"); else name.removeAttribute("aria-current");
    // (drawn first with the farm's map, before the farm's roles are read: People and Layer notes come with them)
    const person = FP.demo?.active ? (context?.advisor ? "Demo advisor" : "Demo farmer") : user.user_metadata?.display_name || user.email;
    $("#space-person").textContent = person;
    $("#account-initials").textContent = M.initials(FP.demo?.active ? person : user.user_metadata?.display_name, user.email);
    const select = $("#farm-switch");
    select.replaceChildren(el("option", { value: "" }, "All farms"), ...portfolio.map((f) => el("option", { value: f.id }, f.name)));
    // HV1: a member farm is not among the person's farms: the switcher still names it, marked read only, and cannot be chosen
    if (farm.readOnly && !portfolio.some((f) => f.id === farm.id)) { const o = el("option", { value: farm.id }, farm.name + " (read only)"); o.disabled = true; select.append(o); }
    select.value = farm.id;
    $(".farm-switch-label").style.display = portfolio.length < 2 ? "none" : "";
    // The home view is the first tab, so from Ask, Create or Documents the way back is a tab, not a guess at the title.
    // V6: a client's tabs are the allow-list (simple-view.js)
    // J2: staff's order: Home, Maps, Files, Ask and Create, then the Working map (UI2's Overview: the farm map with What's due), under
    // More as in a group (space-nav.js)
    const tabs = tabsFor(farm);
    const navTabs = tabs.map(([key, label]) => ({ key, label, href: FP.href(M.href(farm.id, key)), icon: FP.icons?.forView(key) }));
    // (FEP2: on the Plan page no section is marked: it is reached from Home but is not Home)
    if (FP.spaceNav) FP.spaceNav.render($("#farm-actions"), navTabs, route.view);
    else $("#farm-actions").replaceChildren(...navTabs.map((t) => el("a", { href: t.href, "data-tab": t.key, ...(route.view === t.key ? { "aria-current": "page" } : {}) }, FP.icon(t.icon), el("span", {}, t.label))));
    // HV1: a member's farm opened by a coordinator of its group says so: "Member farm · read only" under its name, and the account
    // menu's line; nothing on it offers a change (the person has no role on the farm, and the database lets them read only)
    const roleLine = farm.readOnly ? M.readOnlyLine : FP.spaceNav?.roleLine(context?.farm.id === farm.id ? context.role : null, "farm") || "", roleNode = $("#account-role");
    if (roleNode) { roleNode.textContent = roleLine; roleNode.hidden = !roleLine; }
    const kind = $("#space-kind");
    if (kind) { kind.textContent = farm.readOnly ? M.readOnlyKind : "Farm"; kind.classList.toggle("space-kind-readonly", !!farm.readOnly); }
    // UI1: where the person is and how to get back: every place, when they have more than this one; a member farm, back to the
    // group it was opened from (HV1)
    const home = $("#space-home");
    home.hidden = !farm.readOnly && !(FP.groupSpace?.hasPortfolio ? FP.groupSpace.hasPortfolio() : portfolio.length > 1);
    home.setAttribute("href", FP.href(farm.readOnly && farm.back?.href ? farm.back.href : "#/places"));   // J2c: Places itself, never the bare address (which may land in a place)
    const backLabel = home.querySelector(".space-back-label");
    if (backLabel) backLabel.textContent = farm.readOnly && farm.back?.label ? farm.back.label : "All places";
    const letters = monogram(farm.name);   // (no letters at all: a neutral place glyph)
    $("#space-mark").replaceChildren(letters || FP.icon("places", 18));
    // UI1: Add, for what this person may add to this farm (add.js); the role comes with the farm's reads, or is read on its own
    // for Maps (which reads nothing else of the farm)
    const addCtx = ({ role, tiers }) => ({ space: "farm", id: farm.id, name: farm.name, role, documentTiers: tiers, staff: !!FP.ops?.isStaff?.(), views: tabs.map(([key]) => key), view: route.view });
    if (context?.farm.id === farm.id) FP.add?.update(addCtx({ role: context.role, tiers: context.documentTiers }));
    else { FP.add?.update(null); farmRole(farm).then((r) => { if ($("#space-farm-name").getAttribute("href") === FP.href(M.href(farm.id, "home"))) FP.add?.update(addCtx(r)); }); }
    $("#space-signout").textContent = FP.demo?.active ? "Exit demo" : "Sign out";
    const people = $("#space-people");
    people.hidden = !M.canManage(context?.role); people.href = FP.href(M.href(farm.id, "people"));
    // Layer notes (LN2): offered to the farm's editors and to the advisors of the organisation that services it, never to a viewer.
    const layerNotes = $("#space-layers");
    if (!context) layerNotes.hidden = true;
    else layerNotes.hidden = !FP.layerNotes?.offersNotes({ farmRole: context.role, orgRole: context.orgRole });
    layerNotes.href = FP.href("#/layers");
    if (route.view === "people") people.setAttribute("aria-current", "page"); else people.removeAttribute("aria-current");
    $("#account-open").toggleAttribute("data-current", route.view === "people");
  }

  // The sections a person sees on a farm, [key, label] in order: a client's are the allow-list (simple-view.js)
  const staffTabs = () => [["home", "Home"], ["maps", "Maps"], ["documents", "Files"], ["actions", "Actions"], ...M.views.filter(([k]) => !["maps", "documents"].includes(k)), ["map", "Working map"]];
  const farmTabs = () => (FP.simpleView?.on() ? FP.simpleView.tabs("farm") : staffTabs());
  // ACT1: a farm's Actions is for the people with a role on it: a member farm opened by a group's coordinator (HV1, read only) has no
  // Actions section (the database gives them none of the list)
  // (RCL staff: the owner, 19 Nov 2026, any farm's list)
  const tabsFor = (farm) => farmTabs().filter(([key]) => key !== "actions" || !farm?.readOnly || FP.ops?.isStaff?.() === true);
  // UI1: a farm's mark (a farm has no logo of its own): its monogram (icons.js, the same rule as a group's)
  const monogram = (name) => FP.icons.monogram(name);
  // UI1: the person's role on a farm, and whether its Files can take new files (the documents' tier columns: farm-space's own
  // `learnt`, or a read of no rows that asks for them), for Add on a view that reads nothing else of the farm (Maps). One row
  // under farm_members' own policy, kept for the session.
  const roles = new Map();
  function farmRole(farm) {
    if (context?.farm.id === farm.id) return Promise.resolve({ role: context.role, tiers: context.documentTiers });
    if (!roles.has(farm.id)) {
      const role = Promise.resolve(FP.sb.from("farm_members").select("role").eq("farm_id", farm.id).eq("user_id", user.id).maybeSingle()).then((r) => r?.data?.role || null, () => null);
      // (a failed read, or a refused one that is not about the columns, is not kept: it is asked again when the space next opens)
      let failed = false;
      const tiers = learnt.has(FP.sb) ? Promise.resolve(learnt.get(FP.sb))
        : Promise.resolve(FP.sb.from("documents").select("id" + TIER_COLUMNS.chosen).eq("farm_id", farm.id).limit(0))
          .then((r) => (!r?.error ? "chosen" : missingColumn(r.error) ? "tiers" : ((failed = true), null)), () => ((failed = true), null));
      const both = Promise.all([role, tiers]).then(([r, t]) => { if (failed || r === null) roles.delete(farm.id); return { role: r, tiers: t }; });
      roles.set(farm.id, both);
    }
    return roles.get(farm.id);
  }

  // ---- People: who can open the farm, for its owner and admins (A0) -----------------------------------
  let people = [];
  const peopleMsg = (text, kind) => { const p = $("#people-msg"); if (!p) return; p.textContent = text || ""; p.dataset.kind = kind || ""; };
  function roleSelect(id, value, label) {
    return el("select", { id, ...(label ? { "aria-label": label } : {}) }, ...M.roles.map(([k, name]) => el("option", { value: k, ...(k === value ? { selected: true } : {}) }, name)));
  }
  function peopleView() {
    const section = el("section", { class: "space-view people-view", "data-view": "people" }, el("h2", {}, "People"),
      el("a", { class: "link people-close", href: $("#space-farm-name").getAttribute("href") }, "Close"));
    if (!M.canManage(context.role)) return section.append(el("p", { class: "people-count" }, "Only the farm's owner or an admin can see who has access.")), section;
    section.append(el("p", { id: "people-count", class: "people-count" }, "Reading who has access…"),
      el("ul", { id: "people-list", class: "people-list" }),
      el("p", { id: "people-msg", class: "people-msg", role: "status", "aria-live": "polite" }),
      el("form", { id: "people-add", class: "people-add", novalidate: true },
        el("h3", {}, "Add a person"),
        el("div", { class: "people-add-row" },
          el("label", {}, el("span", {}, "Email address"), el("input", { id: "people-email", type: "email", autocomplete: "off", inputmode: "email", autocapitalize: "none", spellcheck: "false", required: true })),
          el("label", {}, el("span", {}, "Access"), roleSelect("people-role", "view")),
          el("button", { type: "submit" }, "Add"))));
    return section;
  }
  function renderPeople() {
    const list = $("#people-list");
    if (!list) return;
    const n = people.length;
    $("#people-count").textContent = n === 1 ? "One person can open this farm." : n + " people can open this farm.";
    list.replaceChildren(...people.map((p) => el("li", { "data-person-id": p.id },
      el("div", { class: "person" }, el("b", {}, p.name || p.email), el("small", {}, [p.name ? p.email : null, p.note || null].filter(Boolean).join(" · "))),
      p.editable ? el("div", { class: "person-controls" }, roleSelect("role-" + p.id, p.role, "Access for " + p.email), el("button", { type: "button", class: "link", "data-remove": p.id }, "Remove"))
        : el("div", { class: "person-controls" }, el("span", { class: "role-name" }, p.roleName)))));
    for (const s of list.querySelectorAll("select")) s.dataset.roleFor = s.id.slice(5);
  }
  async function loadPeople() {
    const farm = context.farm.id, { data, error } = await FP.sb.rpc("farm_people", { f: farm });
    if (context?.farm.id !== farm) return;
    if (error) { $("#people-count").textContent = "Couldn't read who has access: " + error.message; return; }
    people = M.people(data, context.today); renderPeople();
  }
  const who = (id) => people.find((p) => p.id === id)?.email || "They";
  async function changeRole(id, role, select) {
    const before = people.find((p) => p.id === id)?.role;
    select.disabled = true; peopleMsg("");
    const { data, error } = await FP.sb.from("farm_members").update({ role }).eq("farm_id", context.farm.id).eq("user_id", id).select("user_id");
    select.disabled = false;
    if (error || !data?.length) { select.value = before; peopleMsg(error?.message || "That change wasn't allowed.", "error"); return; }
    peopleMsg(who(id) + " now has " + M.roles.find(([k]) => k === role)[1] + " access.", "ok");
    await loadPeople();
  }
  async function removePerson(id, button) {
    button.disabled = true; peopleMsg("");
    const email = who(id);
    const { data, error } = await FP.sb.from("farm_members").delete().eq("farm_id", context.farm.id).eq("user_id", id).select("user_id");
    if (error || !data?.length) { button.disabled = false; peopleMsg(error?.message || "That change wasn't allowed.", "error"); return; }
    peopleMsg(email + " no longer has access.", "ok");
    await loadPeople();
  }
  async function addPerson() {
    const input = $("#people-email"), button = $("#people-add button[type=submit]"), email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { peopleMsg("Enter their email address.", "error"); input.focus(); return; }
    button.disabled = true; peopleMsg("Adding " + email + "…");
    const { data, error } = await FP.sb.functions.invoke("invite", { body: { farm_id: context.farm.id, email, role: $("#people-role").value } });
    button.disabled = false;
    if (error) {
      let message = error.message;
      try { message = (await error.context.json()).error || message; } catch {}
      peopleMsg(message, "error"); return;
    }
    input.value = "";
    // One reply whether or not they already had a login (the server says nothing about that either).
    peopleMsg(data.resent ? data.email + " hasn't signed in yet, so the email was sent again."
      : "Added " + data.email + ". Anyone new gets an email with a link to set a password.", "ok");
    await loadPeople();
  }
  // ---- The map's layers (E5, #244) ------------------------------------------------------------------
  // The map starts quiet (the farm boundary; photos once zoomed in) and layers come up by context, by one rule:
  // a What's due line brings what its place needs, an opened photo brings Photos, the plan selected in Documents brings
  // the FEP's layers; Ask, Create and People keep the quiet map. A layer the person sets by hand in Layers stays as they
  // set it. Pure: view is the route ({ view, item }), focus { place, photo }, context the farm's documents.
  // LK4: what each context brings is a view of the kind registry (app/layer-kinds.json, FP.kinds), never a list kept here.
  // The opening view (config.js farmView.view, "quiet": the boundary, and photos by zoom) and every kind whose default rule
  // has it on (quiet; zoom:<z> once the map's zoom reaches z); a plan selected in Documents brings the fep view, an opened
  // photo the photos view, an answer in Ask the view its set names (fep, photos, water, consents, soils_landform,
  // infrastructure, catchment); a What's due line's place brings its land units and the rows of its themes' kinds (the
  // rows that hold the kind: waterways brings the farm's own waterways and Rivers, wells the bores).
  // Every row the farm's map has, with its kind: its own layers, the reference sources counted in its context (PERF1b: listed
  // before they are read) and those farm_map carried itself, and Rivers.
  function rowKinds(m, counts, sources) {
    const out = new Map([["extent", "extent"], ["titles", "titles"], ["actions", "actions"]]);
    for (const l of m?.layers || []) if (K.isData(l)) out.set(l.theme, K.kindOf(l.theme, l.geometry_type));
    const themeOf = new Map([...(sources || m?.sources || []), ...(m?.reference || [])].map((s) => [s.key, s.theme]));
    // (the sources Rivers is drawn from are behind it: Rivers is their kind's row, DM2)
    const kindOfSource = (key, theme) => (M.behindRivers(key) ? null : K.refKindOf(theme));
    for (const [i, r] of (m?.reference || []).entries()) out.set(r.key || "reference-" + i, kindOfSource(r.key, r.theme));
    for (const [k, n] of Object.entries(counts || {})) if (Number(n) > 0 || n?.by_viewport === true) out.set(k, kindOfSource(k, themeOf.get(k)));   // (CAP1a: a dense source, {by_viewport: true})
    out.set("rivers", "waterways");
    return out;
  }
  const mapKeys = (m, counts) => [...rowKinds(m, counts).keys()].filter((k) => k !== "actions");
  // The views in force for a route and its focus, in the order they were brought.
  function viewsIn(view, focus, context) {
    const f = focus || {}, v = view || {}, out = [globalThis.FP_CONFIG?.farmView?.view || "quiet"];
    if (v.view === "documents" && v.item) {
      const doc = (context?.documents || []).find((d) => String(d.id) === String(v.item));
      if (doc && M.isPlan(doc)) out.push("fep");
    }
    if (f.photo) out.push("photos");
    if (f.set && f.set !== "all" && K.view(f.set)) out.push(f.set);
    return [...new Set(out.filter((k) => K.view(k)))];
  }
  // Which rows hold a theme's kind (a place's theme): a reference row that governs it is any row of that kind.
  function governs(theme, context, index = null) {
    const kind = K.kindOf(theme), rows = rowKinds(context?.maps, context?.referenceCounts, index || context?.maps?.sources);
    for (const s of index || []) if (!rows.has(s.key)) rows.set(s.key, M.behindRivers(s.key) ? null : K.refKindOf(s.theme));
    return kind ? [...rows].filter(([, k]) => k === kind).map(([key]) => key) : [];
  }
  // For farm-reference.js placeKeys: each theme -> the rows of its kind (Rivers and the sources of that kind).
  const governsMap = (place, context, index) => Object.fromEntries((place?.themes || []).map((t) => [t, governs(t, context, index)]));
  function sceneFor(view, focus, context) {
    const f = focus || {}, vs = viewsIn(view, focus, context), rows = rowKinds(context?.maps, context?.referenceCounts);
    const kinds = K.kindsOn(vs, f.zoom), on = [];
    // each kind on: its own key (a farm layer's row is its theme), and every row of that kind
    for (const k of kinds) { if ((K.registry().kinds.find((x) => x.key === k)?.owner || []).includes("farm")) on.push(k); for (const [key, rk] of rows) if (rk === k) on.push(key); }
    if (f.place) {
      if ((f.place.land_units || []).length) on.push("land_units");
      for (const theme of f.place.themes || []) { on.push(theme); on.push(...governs(theme, context)); }
      for (const k of f.place.layers || []) on.push(k);
    }
    // an answer in Ask that asks for every layer: every row the farm's map has
    if (f.set === "all") on.push(...mapKeys(context?.maps, context?.referenceCounts));
    const rowList = [...rows].map(([key, kind]) => ({ key, kind }));
    return new Set(K.resolveExclusive([...new Set(on)], rowList, vs));
  }
  // A row turned on or off (PERF1b): a reference source not read yet is read now, its switch busy (on, not off) until it
  // has come; the map draws it then (arrive). Turning a row off never reads anything.
  // CAP1b: a deferred layer, or a source whose entry came truncated, is read for the map in view when it is on.
  function show(e, on) {
    FP.farmMap.setVisible(e, on);
    if (on && e.pending && refs) refs.want([e.key]);
    const id = partId(e);
    if (id && parts?.has(id)) { if (on) parts.show(id, viewNow()); else parts.hide(id); }
    rowState(e);
  }
  // Every row as the scene says, unless the person set it by hand; the drawer's switches follow.
  function applyScene() {
    if (!context || !layerEntries.length) return;
    const want = sceneFor(shownRoute, { place: focusPlace, photo: photoShown, set: askSet, zoom: FP.farmMap.camera?.()?.zoom }, context);
    for (const e of layerEntries) {
      const on = handSet.has(e.key) ? handSet.get(e.key) : want.has(e.key);
      if (e.on !== on) show(e, on);
      checkRow(e, on);
      underRow(e, on);
    }
    restack();
  }
  // What sits under a row while it is on: Consents' "Past consents" switch, and a legend (CL1).
  function underRow(e, on) {
    if (e.pastInput) e.pastInput.closest("label").hidden = !on;
    for (const n of e.legendNodes || []) n.hidden = !on;
  }
  // A row's switches (its view's, and All layers' while that is open) say what the row is.
  // LP2: and the group headings say again how many of theirs are on
  function checkRow(e, on) { for (const i of e.inputs || (e.input ? [e.input] : [])) i.checked = on; K.refreshGroups?.($("#layer-list")); }
  // LK4: two shared context fills on at once (stacked by hand, or a view that allows the pair): the one drawn second is drawn
  // as an outline and hatch, so the overlap reads.
  function restack() {
    const second = K.stackedKeys(layerEntries);
    for (const e of layerEntries) if (K.isContextFill(e.kind, e.geometry || "polygon") && !e.rivers) FP.farmMap.setStacked?.(e, second.has(e.key));
  }
  // ---- Reference sources read on demand (PERF1b, farm-reference.js) ----------------------------------------------------
  // The Layers rows of the reference sources this farm's context holds, before their features are read: a row with no
  // map layers yet (pending), filled in when the source arrives. Consents keep their "Past consents" switch.
  const placeholder = (s) => ({ key: s.key, name: M.layerName(s), sub: null, section: "reference", ids: [], on: false, pending: true, theme: s.theme ?? null, kind: K.refKindOf(s.theme),
    ...(K.refKindOf(s.theme) === "consents" || s.key === "ecan-consents" ? { past: { ids: [], on: false }, legend: M.CONSENT_CLASSES.map((c) => ({ key: c.key, label: c.label, fill: c.fill, ring: c.ring })) } : {}), ...purposeOf(s) });
  // LK1: a source's sentence before it is read, from the reviewed look of the source or its theme ({} when there is none)
  const purposeOf = (s) => {
    const rec = FP.layerStyle?.pick(context?.maps?.styles, { sourceKey: s.key, theme: s.theme }), p = rec ? FP.layerStyle.purpose(rec) : null;
    return p ? { purpose: p } : {};
  };
  // The drawer's rows: the farm's own, then a row per reference source by name (drawn already, or to be read), then Rivers.
  function layerRows(entries) {
    const drawnRefs = new Map(entries.filter((e) => e.section === "reference" && !e.rivers).map((e) => [e.key, e]));
    const refRows = (refs?.index || []).map((s) => drawnRefs.get(s.key) || placeholder(s));
    for (const [key, e] of drawnRefs) if (!refs?.has(key)) refRows.push(e);
    for (const e of refRows) if (M.behindRivers(e.key)) e.kind = null;   // LK4: behind Rivers (DM2): listed under All layers only
    return [...entries.filter((e) => e.section !== "reference"), ...refRows, ...entries.filter((e) => e.rivers)];
  }
  function startReference() {
    refs?.destroy();
    const farm = context.farm.id, mine = refs = FP.farmReference.create({ sb: FP.sb, farm, counts: context.referenceCounts, sources: context.maps.sources,
      preloaded: context.maps.reference, onArrive: (entry) => { if (refs === mine) arrive(entry); }, onChange: (key) => { if (refs === mine) changed(key); } });
  }
  // A source has come: it joins the scene on the map (the Map scene's addReference), shown as its row now says.
  function arrive(entry) {
    const rows = layerEntries.filter((e) => e.key === entry.key && e.pending);
    if (!rows.length) return;
    const drawn = FP.farmMap.addReference(entry);
    if (!drawn) return;
    for (const e of rows) {
      e.ids = drawn.ids; e.pending = false; e.order = drawn.order; e.geometry = drawn.geometry;
      if (e.past && drawn.past) e.past.ids = drawn.past.ids;
      FP.farmMap.setVisible(e, e.on);
      if (e.past) FP.farmMap.setPast(e, e.past.on);
    }
    restack();   // LK4: a context fill that came while another is on is drawn as outline and hatch
    // CAP1b: too many in the farm's context to come at once (truncated, no features): never drawn in part; its row says
    // so, and it is read for the map in view while it is on
    if (R.truncated(entry)) {
      const p = ensureParts(context.farm.id), id = p.add(refPart(entry.key), { name: M.layerName(entry), feature_count: entry.feature_count ?? null,
        fn: "reference_in_view", simplify: false, read: (w) => R.inView(FP.sb, entry.key, w) });
      for (const e of rows) { if (e.on) p.show(id, viewNow()); rowState(e); }
    }
    // a chosen line (or an answer's frame) waiting on this source is framed again, now that its features are on the map
    if (focusPlace && FP.farmReference.placeKeys(focusPlace, [refs.index.find((s) => s.key === entry.key)].filter(Boolean), governsMap(focusPlace, context, refs.index)).length) FP.farmMap.focus(focusPlace);
  }
  // A source's state changed (reading, read, couldn't be read): its switch, and the Sources list.
  function changed(key) {
    for (const e of layerEntries.filter((x) => x.key === key)) {
      if (refs.state(key) === "failed" && e.pending) {
        // nothing was drawn: the switch reads off, and the next switch (or the next line that needs it) reads it again
        handSet.delete(key); FP.farmMap.setVisible(e, false);
        checkRow(e, false);
        underRow(e, false);
      }
      rowState(e);
    }
    renderSources();
  }
  // The row's switch: busy while its source is on its way (still on), a line under the name once it couldn't be read.
  // CAP1b: a deferred layer's line is the shared module's ("Loading…", "Couldn't load just now", "Zoom in to see <name>
  // (<count>)"); a source whose entry came truncated says PROV1's "Too many to show here (n), zoom in" while it is on and
  // nothing of it is drawn; a layer farm_map could not bound at all, "Too many to show here (n)".
  function rowState(e) {
    if (!e.input) return;
    const id = partId(e), viewed = !!id && !!parts?.has(id), many = e.truncated && !viewed ? e.count ?? null : undefined;
    // CAP1a: titles or land units over farm_map's cap (an empty collection, truncated, its count): a line only, no read
    const listOnly = e.section === "farm" && !viewed ? M.tooManyToDraw(e.key === "titles" ? context?.maps?.titles : e.key === "land_units" ? context?.maps?.land_units : null, e.key === "titles" ? "titles" : "land units") : null;
    if (!viewed && many === undefined && !listOnly && !refs?.has(e.key)) return;
    const li = e.input.closest("li");
    let st, text;
    if (listOnly) { st = "too-many"; text = listOnly; }
    else if (many !== undefined) { st = "too-many"; text = FP.groupLayers.tooManyLine(many); }
    else if (viewed && e.section !== "reference") { st = parts.state(id); text = parts.line(id, e.name); }
    else if (viewed) {
      st = parts.state(id);
      const n = refs?.entry(e.key)?.feature_count ?? refs?.index.find((s) => s.key === e.key)?.count ?? null;
      text = !e.on || st === "loaded" ? "" : st === "loading" ? "Loading…" : st === "failed" ? "Couldn't load just now" : FP.provenance.tooManyZoom(n);
    } else {
      st = refs.state(e.key);
      text = st === "loading" ? "Loading…" : st === "failed" ? "Couldn't load just now" : "";
    }
    e.input.setAttribute("aria-busy", String(st === "loading"));
    li?.classList.toggle("layer-loading", st === "loading");
    let note = li?.querySelector(".layer-state");
    if (!text) { note?.remove(); return; }
    if (!note && li) { note = el("small", { class: "layer-state", role: "status" }); e.input.closest("label").querySelector("span")?.append(note); }
    if (note) { note.textContent = text; note.dataset.state = st; }
  }
  // ---- Read for the map in view (CAP1b, group-layers.js) ---------------------------------------------------------------------
  // A row's id in the shared module: a deferred layer's own id, or "ref:<key>" for a source whose entry came truncated.
  const refPart = (key) => "ref:" + key;
  const partId = (e) => (e.deferred && e.layerId != null ? String(e.layerId) : e.section === "reference" && !e.rivers && parts?.has(refPart(e.key)) ? refPart(e.key) : null);
  // The map in view for a read; none while the map is still moving (the fly-in to the farm): it is read when it comes to rest.
  const viewNow = () => (FP.farmMap.camera?.()?.moving ? null : FP.farmMap.view?.() || null);
  // The module for this farm, made the first time something needs it, with the map's moveend hook (read again at each rest).
  function ensureParts(farmId, layers = context?.maps?.layers || []) {
    if (parts) return parts;
    const L = FP.groupLayers, cfg = globalThis.FP_CONFIG?.farmView || {};
    const rowsOf = (id) => (layerEntries.length ? layerEntries : sceneEntries).filter((e) => partId(e) === id);
    const mine = parts = L.create({ sb: FP.sb, farm: farmId, layers, max: cfg.maxFeatures || L.MAX_FEATURES,
      onData: (id, features) => { if (parts === mine) for (const e of rowsOf(id)) FP.farmMap.layerData?.(e, features); },
      onChange: (id) => {
        if (parts !== mine) return;
        for (const e of rowsOf(id)) {
          // one failed read never fails the farm: nothing of it on the map, its switch reads off and its row says so;
          // the next switch reads it again
          if (mine.state(id) === "failed" && !mine.drawn(id) && e.on) { handSet.delete(e.key); FP.farmMap.setVisible(e, false); checkRow(e, false); }
          rowState(e);
        }
      } });
    offMove = FP.farmMap.onMoveEnd?.(() => { if (parts === mine) mine.moved(FP.farmMap.view()); }) || null;
    return mine;
  }
  // Once the farm is drawn: a farm with a deferred layer reads those the map opens with for the view (none with nothing
  // deferred: the farm is drawn whole from farm_map, as before).
  function startParts(farmId, maps) {
    dropParts();
    if (!FP.groupLayers?.hasDeferred(maps)) return;
    const p = ensureParts(farmId, maps.layers);
    for (const e of sceneEntries) if (e.on && partId(e) && p.has(partId(e))) p.show(partId(e), viewNow());
  }
  // The sources a place needs before it can be framed (its themes, the rows that govern them, the layers it names), not
  // tried yet; read, then `then` runs (once: a source that still can't be read doesn't loop).
  function whenRead(place, then) {
    const keys = refs ? FP.farmReference.placeKeys(place, refs.index, governsMap(place, context, refs.index)).filter((k) => refs.state(k) === "pending") : [];
    if (!keys.length) return false;
    const mine = token;
    refs.want(keys).then(() => { if (mine === token) then(); });
    return true;
  }
  // After the farm is drawn and the map is idle: the short list the standing answers most often bring up, read ahead one
  // at a time (config farmView.prefetch), never the region-wide zones; hidden until something switches them on.
  function prefetchWhenIdle() {
    const mine = refs, list = globalThis.FP_CONFIG?.farmView?.prefetch || FP.farmReference.PREFETCH;
    const go = () => { if (refs === mine && mine) mine.prefetch(list, { readRivers: () => FP.farmMap.readRiversAhead?.() }); };
    const idle = () => (typeof requestIdleCallback === "function" ? requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 500));
    Promise.resolve(FP.farmMap.atRest?.()).then(idle, idle);
  }
  let drawerFolded = [];   // the sheets (and their state) the drawer folded under it on a phone: put back when it closes
  function setDrawer(open) {
    const was = !$("#layers-drawer").hidden;
    $("#layers-drawer").hidden = !open;
    layersButton?.setAttribute("aria-expanded", String(open));
    if (!open) { if (was) for (const [which, state] of drawerFolded) if (sheetState(which) === "peek") setSheet(which, state, false); drawerFolded = []; }
    if (open) {
      // UI1: a popup would sit under the drawer, so it is put away. Phone: the drawer is a panel over the lower map, so an open
      // sheet folds to its bar under it (the farm keeps the frame it had, in the map above); the command bar and the map's
      // controls stay clear.
      FP.farmMap.closePopup?.();
      if (window.innerWidth <= 800 && !was) {
        drawerFolded = ["due", "space"].filter((w) => !(w === "space" && $("#space-content").hidden) && sheetState(w) !== "peek").map((w) => [w, sheetState(w)]);
        for (const [which] of drawerFolded) setSheet(which, "peek", false);
      }
      $("#layers-close").focus();
    }
  }
  // Layers: a button on the map itself, under the zoom and compass, that needs no explanation (an icon and the word).
  const LAYERS_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10 2 1 6.5l9 4.5 9-4.5zm-6.8 7.6L1 10.7l9 4.5 9-4.5-2.2-1.1L10 13zm0 4.2L1 14.9l9 4.5 9-4.5-2.2-1.1L10 17.2z"/></svg>';
  // Add a block (UI1): a visible action on the map for the farm's editors (M.canEdit, the farm_members role the space already
  // read: no new query), under Layers. Hidden for a viewer; the typed command and Ask's block.add stay as they were.
  const BLOCK_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 3h2v6h6v2h-6v6H9v-6H3V9h6z"/></svg>';
  let blockButton = null;
  function addLayersControl() {
    if (layersButton) return;
    const button = el("button", { type: "button", id: "layers-open", class: "layers-open", "aria-controls": "layers-drawer", "aria-expanded": "false", onclick: () => setDrawer($("#layers-drawer").hidden) });
    button.innerHTML = LAYERS_ICON + "<span>Layers</span>";
    blockButton = el("button", { type: "button", id: "block-open", class: "layers-open", hidden: true, title: "Add a block of land to the farm", onclick: () => openBlock() });
    blockButton.innerHTML = BLOCK_ICON + "<span>Add a block</span>";
    const box = el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group layers-ctrl" }, button, blockButton);
    FP.farmMap.addControl({ onAdd: () => box, onRemove: () => box.remove() }, "top-right");
    layersButton = button;
    // GE1b: Edit shape in a feature's popup (FP.shapeEditor; only with its trial switched on, so by default nothing changes)
    FP.farmMap.featureTools?.((hit, at) => (FP.shapeEditor && context ? FP.shapeEditor.tools(hit, at, { space: "farm", owner: context.farm.id, role: context.role,
      surface: FP.farmMap, boundary: () => [context?.maps?.extent].filter(Boolean) }) : null));
  }
  // The drawer (LK4): the rows grouped by view (the registry's views: Farm, Farm plan, Water, Consents, Soils and landform …),
  // each row once under its kind's view, then All layers, folded, with every row (FP.kinds.drawer). A plain name (with its
  // area for the boundary and titles), the layer's sentence (LK1) and a switch; where a layer came from is in its features'
  // popups. In All layers, layers made for a job sit together under one heading. Working and annotation layers are never listed.
  function renderLayers(entries) {
    layerEntries = entries;
    for (const e of entries) { e.inputs = []; e.legendNodes = []; }
    // TIDY1: no two rows read the same: a reference source says whose it is ("Bores (ECan)"), and a second layer of the farm's
    // own kind takes a quiet "From …" line (#411's, as the group's Layers card does)
    const sources = context?.maps?.sources || [], layers = context?.maps?.layers || [];
    const told = FP.groupLayers.drawerNames(entries.map((e) => {
      const l = e.layerIndex != null ? layers[e.layerIndex] : null, s = e.section === "reference" && !e.rivers ? sources.find((x) => x.key === e.key) : null;
      return { name: e.name, from: l ? FP.groupLayers.fromLine(l) : s?.name ? "From " + s.name : null, full: l ? l.name || null : s?.name || null,
        whose: s ? FP.provenance?.shortProvider?.(s.provider) || null : null };
    }));
    const toldOf = new Map(entries.map((e, n) => [e, told[n]]));
    const row = (e, secondary = false) => {
      const input = el("input", { type: "checkbox", role: "switch", checked: e.on, onchange: (ev) => setLayer(e.key, ev.target.checked) });
      e.inputs = [...(e.inputs || []).filter((i) => i.isConnected !== false), input];
      if (!secondary) e.input = input;
      const pastInput = e.past ? el("input", { type: "checkbox", role: "switch", checked: e.past.on, onchange: (ev) => FP.farmMap.setPast(e, ev.target.checked) }) : null;
      if (!secondary) e.pastInput = pastInput;
      const past = e.past ? el("label", { class: "layer-past", ...(e.on ? {} : { hidden: true }) }, pastInput, el("span", {}, "Past consents")) : null;
      // CL1: what a classified layer's colours mean (Consents: by type), under its row while it is on
      const legend = e.legend?.length ? el("ul", { class: "layer-legend", "data-layer-legend": e.key, ...(e.on ? {} : { hidden: true }) },
        ...e.legend.map((c) => el("li", { "data-legend": c.key }, el("span", { class: "layer-swatch", style: "background:" + c.fill + ";border-color:" + c.ring }), el("span", {}, c.label)))) : null;
      if (legend) e.legendNodes = [...(e.legendNodes || []).filter((n) => n.isConnected !== false), legend];
      // CAP1b: a deferred layer (read for the map in view) says how many features it holds, as the group's rows do
      const sub = e.sub || (e.deferred && e.count != null ? FP.groupLayers.featureCount(e.count) : null);
      // LK1: what the layer is for, when its reviewed look says (a row with no record reads as before)
      const purpose = e.purpose ? el("small", { class: "layer-purpose" }, e.purpose) : null;
      const t = toldOf.get(e), from = t?.from ? el("small", { class: "layer-from" }, t.from) : null;
      return el("li", e.deferred ? { "data-layer": "deferred" } : {}, el("label", {}, input, el("span", {}, el("b", {}, t?.name || e.name), sub ? el("small", {}, sub) : null, from, purpose)), legend, past);
    };
    // FU2: the counts couldn't be read (not: this farm has none), so a Reference line says so and offers to read again
    const tail = context?.referenceCountsFailed ? [el("li", { class: "group", "data-layer-section": "reference" }, "Reference"), countsError()] : [];
    const jobs = (rows) => {
      const out = rows.filter((e) => !e.job).map((e) => row(e, !!K.primaryView(e.kind)));
      const by = new Map();
      for (const e of rows.filter((e) => e.job)) { if (!by.has(e.job.id)) by.set(e.job.id, { job: e.job, entries: [] }); by.get(e.job.id).entries.push(e); }
      for (const { job, entries: es } of by.values()) out.push(el("li", { class: "group job" }, M.jobHeading(job)), ...es.map((e) => row(e, !!K.primaryView(e.kind))));
      return out;
    };
    $("#layer-list").replaceChildren(...K.drawer(entries, { el, row: (e) => row(e), all: jobs, tail, onFold: () => { for (const e of entries) rowState(e); },
      set: (e, on) => setLayer(e.key, on), scope: "farm:" + (context?.farm?.id ?? "") }));
    for (const e of entries) rowState(e);
  }
  // FU2: the reference sources could not be counted just now. One line in the Reference list, with a way to read again.
  function countsError() {
    const retry = el("button", { type: "button", class: "link", onclick: () => retryCounts(retry) }, "Try again");
    return el("li", { class: "layer-error", "data-layer-error": "reference-counts" }, el("small", { role: "status" }, FP.provenance?.COUNTS_FAILED || "Reference layers couldn't load just now."), retry);
  }
  async function retryCounts(button) {
    const farm = context?.farm;
    if (!farm || button.disabled) return;
    button.disabled = true; button.textContent = "Trying again…";
    const r = await readCounts(FP.sb, farm);
    if (context?.farm !== farm) return;
    context.referenceCounts = r.counts; context.referenceCountsFailed = r.failed;
    startReference(); renderLayers(layerRows(sceneEntries)); renderSources(); if (!r.failed) prefetchWhenIdle();
  }
  // The Layers drawer's Sources entry (PROV1): the served sources this farm's map draws (and its water-quality sources), with
  // when each was refreshed, its licence and what it is; sources registered but empty say "Not loaded yet". Folded by default.
  // The group space's drawer calls the same FP.provenance.section with its own reference rows and keys.
  function renderSources() {
    const slot = $("#drawer-sources-slot");
    if (!slot || !context || !FP.provenance?.section) return;
    const open = slot.querySelector("details")?.open;
    // a results dataset (ecan-wq) is judged by the results this farm's water-quality line holds, not by a refresh date it never gets
    const held = FP.provenance.heldBy(wq?.sites?.() || []);
    // PERF1b: the sources counted in the farm's context (farm_reference_counts), read or not, so a line reads the same as
    // when farm_map carried every source; one that couldn't be read just now says so
    // CL1: and Rivers' two sources while Rivers is drawn (its row is not a counted reference source)
    const keys = M.withRiverSources([...(refs ? refs.keys() : []), ...(context.maps?.reference || []).map((r) => r.key), ...held.keys], sceneEntries);
    const node = FP.provenance.section(context.maps?.sources, { keys, loadedKeys: held.loadedKeys, asAt: held.asAt, region: context.farm?.region || context.maps?.farm?.region,
      failedKeys: refs ? refs.failedKeys() : [], countsFailed: !!context.referenceCountsFailed });
    if (node && open) node.open = true;
    slot.replaceChildren(...(node ? [node] : []));
  }
  // A layer set by hand (its switch in the drawer, or "Show <layer>" from the command bar): it stays as set (E5).
  // LK4: a shared context fill switched on switches the other one off (one at a time, by default); its row then says what it
  // replaced, with Show both to stack them (kept for the farm's session).
  function setLayer(key, on, { stack = false } = {}) {
    const off = on && !stack ? K.exclusiveOff(key, layerEntries, { views: viewsIn(shownRoute, { photo: photoShown, set: askSet }, context), stacked: stackOk }) : [];
    for (const k of off) setLayer(k, false);
    handSet.set(key, on);
    for (const x of layerEntries.filter((x) => x.key === key)) {
      show(x, on);
      checkRow(x, on);
      replacedNote(x, on ? layerEntries.filter((o) => off.includes(o.key)) : []);
      underRow(x, on);
    }
    restack();
  }
  // Under a context fill that replaced another: "Replaced Soils" and Show both (both on; the second drawn as outline and hatch).
  function replacedNote(e, gone) {
    const label = e.input?.closest("label"), was = label?.querySelector(".layer-replaced");
    was?.remove();
    if (!label || !gone.length) return;
    const both = el("button", { type: "button", class: "link", onclick: (ev) => {
      ev.preventDefault();
      for (const o of gone) { stackOk.add(e.key + "|" + o.key); setLayer(o.key, true, { stack: true }); }
      label.querySelector(".layer-replaced")?.remove();
    } }, "Show both");
    label.querySelector("span")?.append(el("small", { class: "layer-replaced" }, K.replacedLine([...new Set(gone.map((o) => o.name))]) + " · ", both));
  }
  // ---- The command bar (E4): one line for what the person wants. A phrase that names layers (the Layers drawer's own
  // rows) offers "Show <layer>" as they type; anything else goes to Ask on Enter (the Ask view, filled in and asked).
  // No new calls: it is the drawer's switch and Ask's own form. "/" focuses it; Escape clears it. ----------------------
  let pendingAsk = null, commandPick = -1, commandOptions = [];
  function commandBar() {
    if ($("#command-bar")) return;
    const input = el("input", { id: "command-input", type: "search", autocomplete: "off", spellcheck: "false", enterkeyhint: "go", role: "combobox",
      "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": "command-list", placeholder: "Ask, or show a layer" });
    const form = el("form", { id: "command-bar", class: "command-bar", role: "search" },
      el("label", { for: "command-input", class: "visually-hidden" }, "Ask a question or show a layer"), input,
      el("kbd", { class: "command-key", "aria-hidden": "true" }, "/"),
      el("ul", { id: "command-list", class: "command-list", role: "listbox", "aria-label": "Suggestions", hidden: true }));
    // Phone: across the top of the map. Wide: in the header row, between the farm's name and its links, so it covers
    // none of the map (the farm keeps its frame).
    const wideQ = window.matchMedia("(min-width: 801px)");
    const place = () => { if (wideQ.matches) $("#farm-space-header .space-identity").after(form); else $("#screen-map").append(form); };
    place(); wideQ.addEventListener("change", place);
    input.addEventListener("input", () => { commandPick = -1; suggest(); });
    input.addEventListener("focus", suggest);
    input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) closeSuggestions(); }, 150));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (input.value) { input.value = ""; closeSuggestions(); } else input.blur(); return; }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && commandOptions.length) {
        e.preventDefault();
        const n = commandOptions.length, down = e.key === "ArrowDown";
        commandPick = commandPick < 0 ? (down ? 0 : n - 1) : (commandPick + (down ? 1 : n - 1)) % n;
        drawSuggestions();
      }
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); const intent = M.commandIntent(input.value, layerEntries); run((commandOptions[commandPick] || defaultOption(intent))); });
    $("#command-list").addEventListener("mousedown", (e) => e.preventDefault());   // a tap on a suggestion keeps the input's focus
    $("#command-list").addEventListener("click", (e) => { const li = e.target.closest("[data-option]"); if (li) run(commandOptions[Number(li.dataset.option)]); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !document.body.classList.contains("farm-space-active")) return;
      if (e.target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      e.preventDefault(); input.focus();
    });
  }
  // FB1: a statement of new land ("I've bought a block", "add land": FP.blockModel.isBlockIntent) offers the guided Add a
  // block first, for the farm's editors, and Enter starts it. A question or show that only talks about new land ("Is the
  // new block in the nitrate zone?": mentionsNewLand) offers it last, and Enter asks. Anything else is as before.
  const canAddLand = () => M.canEdit(context?.role) && !!FP.addBlock && !!FP.blockModel;
  const BLOCK_OPTION = { kind: "block", label: "Add a block of land to the farm" };
  const ONBOARDING_OPTION = { kind: "onboarding", label: "Open the onboarding checklist" };
  const optionsFor = (intent) => {
    if (intent.kind === "none") return [];
    const statement = canAddLand() && FP.blockModel.isBlockIntent(intent.text), mention = canAddLand() && !statement && FP.blockModel.mentionsNewLand(intent.text);
    const onboarding = !!FP.onboardingModel?.isIntent(intent.text);
    return [...(onboarding ? [{ ...ONBOARDING_OPTION, lead: true }] : []), ...(statement ? [{ ...BLOCK_OPTION, lead: true }] : []),
      ...intent.layers.map((l) => ({ kind: "layer", key: l.key, label: (l.on ? "Showing " : "Show ") + l.name })), { kind: "ask", text: intent.text, label: "Ask: " + intent.text },
      ...(mention ? [BLOCK_OPTION] : [])];
  };
  // Enter with nothing picked: Add a block for a statement of new land, the first layer when the phrase names layers,
  // otherwise Ask.
  const defaultIndex = (intent, all) => (all[0]?.lead ? 0 : intent.kind === "layer" ? all.findIndex((o) => o.kind === "layer") : all.findIndex((o) => o.kind === "ask"));
  const defaultOption = (intent) => { const all = optionsFor(intent); return all[defaultIndex(intent, all)] || null; };
  function suggest() {
    const intent = M.commandIntent($("#command-input").value, layerEntries);
    commandOptions = optionsFor(intent);
    if (commandPick < 0 && intent.kind !== "none") commandPick = defaultIndex(intent, commandOptions);
    drawSuggestions();
  }
  function drawSuggestions() {
    const list = $("#command-list"), input = $("#command-input");
    list.replaceChildren(...commandOptions.map((o, n) => el("li", { id: "command-option-" + n, role: "option", "data-option": String(n), "data-kind": o.kind,
      "aria-selected": String(n === commandPick) }, o.label)));
    list.hidden = !commandOptions.length || document.activeElement !== input;
    input.setAttribute("aria-expanded", String(!list.hidden));
    if (commandPick >= 0 && !list.hidden) input.setAttribute("aria-activedescendant", "command-option-" + commandPick); else input.removeAttribute("aria-activedescendant");
  }
  function closeSuggestions() { commandOptions = []; commandPick = -1; drawSuggestions(); }
  function run(option) {
    const input = $("#command-input");
    if (!option || !context) return;
    if (option.kind === "layer") { setLayer(option.key, true); input.value = ""; closeSuggestions(); return; }
    if (option.kind === "block") { input.value = ""; closeSuggestions(); input.blur(); openBlock(); return; }
    if (option.kind === "onboarding") { input.value = ""; closeSuggestions(); input.blur(); location.hash = FP.href(M.href(context.farm.id, "onboarding")); return; }
    const question = option.text.trim();
    if (!question) return;
    input.value = ""; closeSuggestions(); input.blur();
    if (shownRoute?.view === "ask" && $("#ask-form")) { askFrom(question); return; }
    pendingAsk = question;
    location.hash = FP.href(M.href(context.farm.id, "ask"));
  }
  // ---- Add a block (FB1): the guided steps over the map (add-block.js). The farm is read again once a block is saved, so
  // its boundary and extent show the new land; a cancelled flow wrote nothing and changes nothing. ----------------------
  function openBlock() {
    if (!context || !canAddLand()) return false;
    const farm = context.farm, route = shownRoute || { view: "map" };
    if (route.view !== "map") { location.hash = FP.href(M.href(farm.id, "map")); }
    setDrawer(false);
    FP.addBlock.open(context, {
      uploadDocument: (file) => blockDocument(farm.id, file),
      onClose: async (saved) => {
        if (!saved || context?.farm.id !== farm.id) return;
        // Read the farm again: its boundary now takes in the block. Re-reading starts the map quiet, which dropped the
        // layers the person had set by hand (the creek and drain, Rivers): they are put back as they were, and the new
        // Farmed area comes up so the saved shape is seen.
        // PERF1b: the reference sources are read again for the new extent, those set by hand as they are put back.
        const kept = new Map(handSet);
        context = null; forget(); openedMap = null;
        await open(farm, { farm: farm.id, view: "map" });
        if (context?.farm.id !== farm.id) return;
        for (const [key, on] of kept) if (layerEntries.some((e) => e.key === key)) setLayer(key, on);
        if (layerEntries.some((e) => e.key === "farmed_area")) setLayer("farmed_area", true);
      },
    });
    return true;
  }
  // A document about the new block: filed as the documents block would guess it (the same file already here is reused).
  async function blockDocument(farm, file) {
    const D = FP.documentsBlock, a = D.arrange(context.documents), mains = [...a.primaries, ...a.more].map((p) => p.doc);
    const [it] = D.guessBatch([file], mains);
    if (it.tooBig) throw Error("too large to add here (over 100 MB)");
    const sha = await D.sha256Hex(await file.arrayBuffer()), same = context.documents.find((d) => d.sha256 === sha);
    if (same) return same.id;
    const id = await documentStore(farm, () => []).add({ file, title: it.guess.title, doc_type: it.guess.doc_type, tier: it.guess.tier, relates_to: it.guess.tier === "supporting" ? it.guess.relates_to : null });
    if (context?.farm.id === farm) context.documents = await readDocuments(FP.sb, context.farm).catch(() => context.documents);
    return id;
  }
  // Ask's own form, filled in and asked: the question shows as if typed there.
  function askFrom(question) { $("#ask-input").value = question; $("#ask-form").requestSubmit(); }
  // ---- What's due: Done and Add the record (E5, #245) ---------------------------------------------------
  // Done writes a check (met, by the person, as farmer or advisor); Add the record uploads a document (B3's upload,
  // as supporting), writes a note entry saying what it records and links the entry to the condition and the document.
  // Row-level security decides what is allowed; the demo keeps both in memory.
  const dueItem = (id) => standing.find((m) => m.key === "due")?.body?.data.items.find((i) => i.id === id) || null;
  const obligationOf = (item) => item && (context?.obligations || []).find((o) => String(o.id) === item.obligation_id);
  // The line's message (an error): under the line beside an inline Done, else in its fold.
  const say = (node, text) => { const p = node.closest("li[data-item-id]")?.querySelector(":scope > .checklist-msg") || node.closest(".checklist-body")?.querySelector(".checklist-msg"); if (p) p.textContent = text || ""; };
  const isDone = (item) => (context?.checks || []).some((c) => String(c.obligation_id) === String(item?.obligation_id) && c.status === "met" && !c.superseded_at);
  // The check Done writes: met, by the person, as farmer or advisor. All it needs is taken when Done is tapped, so it can
  // be written after the Undo window, or as the person leaves the farm, from what was true at the tap.
  const inflight = new Set();   // lines whose Done is being written by Ask's Confirm: a tap on the line meanwhile is refused
  function doneRow(id) {
    const item = dueItem(id);
    return !item?.obligation_id || isDone(item) || inflight.has(id) ? null : { farm: context.farm.id, item, obligation: obligationOf(item)?.id ?? item.obligation_id, advisor: !!context.advisor, user: user.id };
  }
  async function writeDone(id, w) {
    const { farm, item } = w;
    try {
      const { data, error } = await FP.sb.from("checks").insert({ farm_id: farm, obligation_id: w.obligation, status: "met",
        explanation: "Marked done in the app", author_kind: w.advisor ? "advisor" : "farmer", author_user: w.user, due_date: item.due || null })
        .select("id,obligation_id,status,created_at,superseded_at").single();
      if (error || !data) return error?.message || "That change wasn't allowed.";
      if (context?.farm.id !== farm) return true;   // written; the person has gone to another farm
      context.checks = [...(context.checks || []), data];
      redrawDue(id);
      return true;
    } catch (err) { return err?.message || "That change wasn't allowed."; }
  }
  // Done from Ask's Confirm (the person has just confirmed it there): written at once, and not twice.
  async function markDone(id, button) {
    const w = doneRow(id);
    if (!w || undoable.has(id)) return dueItem(id) && (isDone(dueItem(id)) || inflight.has(id) || undoable.has(id)) ? "That is already marked done." : "That can't be marked done here.";
    button.disabled = true; say(button, ""); inflight.add(id);
    try {
      const result = await writeDone(id, w);
      if (result !== true) { button.disabled = false; say(button, result); }
      return result;
    } finally { inflight.delete(id); }
  }
  // ---- Done with an Undo (#258) ---------------------------------------------------------------------------
  // Done on a What's due line shows "Marked done. Undo" for UNDO_MS, with no modal. Nothing is written until the window
  // closes (or the person goes to another view or farm, or the page is hidden); Undo inside it means nothing was ever
  // written, and a second Done on a line that is waiting (or being written) is refused. farm-model.js undoWindow.
  const undoable = M.undoWindow({ write: async (id, w) => {
    const result = await writeDone(id, w);
    if (result !== true && context?.farm.id === w.farm) { showDone(id, true); for (const b of cards(id)) say(b, result); }
  } });
  const cards = (id) => $("#overview-cards").querySelectorAll('[data-check-done="' + CSS.escape(id) + '"]');
  // Every Done button for the line (on the line, behind "and N more", in Everything recorded) gives way to the Undo, or comes back.
  function showDone(id, back) {
    for (const b of cards(id)) {
      b.parentElement.querySelectorAll(":scope > .checklist-undo").forEach((n) => n.remove());
      b.hidden = !back;
      if (!back) b.after(el("span", { class: "checklist-undo", role: "status" }, "Marked done. ",
        el("button", { type: "button", "data-check-undo": id, "aria-label": "Undo: " + (dueItem(id)?.text || "marked done") }, "Undo")));
    }
  }
  function startDone(id) {
    const w = doneRow(id);
    if (!w || !undoable.start(id, w)) return;
    showDone(id, false);
  }
  function undoDone(id) {
    if (!undoable.undo(id)) return;
    showDone(id, true);
    [...cards(id)].find((b) => b.offsetParent)?.focus({ preventScroll: true });
  }
  const flushDone = () => { undoable.flush().catch(() => {}); };
  const uploads = new Map();   // line id -> the file chosen for its record, as the documents block guessed it
  function chooseRecord(input) {
    const file = input.files?.[0], li = input.closest("[data-item-id]"), box = li?.querySelector(".checklist-upload");
    const item = dueItem(li?.dataset.itemId);
    input.value = "";
    if (!file || !box || !item) return;
    const D = FP.documentsBlock, a = D.arrange(context.documents), mains = [...a.primaries, ...a.more].map((p) => p.doc), from = obligationOf(item)?.source_document_id;
    const [it] = D.guessBatch([file], mains);
    // a record is supporting; its kind from what the condition needs, and it sits with the decision the condition is in
    it.guess = { ...it.guess, tier: "supporting", doc_type: M.recordKind(item.needs) || it.guess.doc_type,
      relates_to: mains.some((d) => d.id === from) ? from : it.guess.relates_to };
    uploads.set(li.dataset.itemId, [it]);
    box.innerHTML = D.confirmHtml([it], mains); box.hidden = false;
    box.querySelector("input[name^=title-]")?.focus();
  }
  let noteType = null;
  async function noteTypeId() {
    if (noteType) return noteType;
    const { data, error } = await FP.sb.from("record_types").select("id,key,farm_id,org_id").eq("key", "note");
    if (error) throw error;
    const t = (data || []).find((r) => !r.farm_id && !r.org_id);
    if (!t) throw Error("no note record type");
    return (noteType = t.id);
  }
  // An entry written for a line whose links then failed: a retry with the same document links that entry, not a second one.
  const unlinked = new Map();   // line id -> { entry, document }
  async function addRecord(form) {
    const D = FP.documentsBlock, li = form.closest("[data-item-id]"), id = li.dataset.itemId, item = dueItem(id), ob = obligationOf(item), farm = context.farm.id;
    const msg = form.querySelector(".doc-msg"), button = form.querySelector('button[type="submit"]');
    const [choice] = D.confirmed(uploads.get(id) || [], (name) => form.elements.namedItem(name)?.value ?? null);
    if (!choice || !ob) return;
    button.disabled = true; msg.textContent = "Adding…";
    try {
      // the same file already among the farm's documents is linked, not added twice
      const sha = await D.sha256Hex(await choice.file.arrayBuffer()), same = context.documents.find((d) => d.sha256 === sha);
      const documentId = same ? same.id : await documentStore(farm, () => []).add(choice);
      await linkRecord(farm, ob, documentId, same ? M.docTitle(same) : choice.title, id);
      if (context?.farm.id !== farm) return;
      context.documents = await readDocuments(FP.sb, context.farm);
      uploads.delete(id);
      redrawDue(id);
    } catch (err) {
      if (context?.farm.id !== farm) return;
      // the document may have been added before the entry or its links failed: read again, so a retry links it
      context.documents = await readDocuments(FP.sb, context.farm).catch(() => context.documents);
      if (context?.farm.id !== farm) return;
      button.disabled = false; msg.textContent = "Not added: " + (err?.message || err);
    }
  }
  // A document recorded against a condition: a note entry saying what it records, linked to the condition and the
  // document (two links: the table allows one target per row). Add the record and a confirmed answer in Ask share it;
  // id is the What's due line, so a retry after the links failed reuses the entry already written for it.
  async function linkRecord(farm, ob, documentId, title, id) {
    const a = (context.authorisations || []).find((x) => x.id === ob.authorisation_id);
    const what = [a?.consent_no || M.ruleRef(a), ob.code && /^\d/.test(ob.code) ? "condition " + ob.code : null].filter(Boolean).join(" ");
    const kept = unlinked.get(id), entry = kept && kept.document === documentId ? { id: kept.entry } :
      await read(FP.sb.from("entries").insert({ farm_id: farm, type_id: await noteTypeId(), visibility: "farm",
        body: "Record for " + (what || "a condition") + ": " + title }).select("id").single());
    unlinked.set(id, { entry: entry.id, document: documentId });
    await read(FP.sb.from("entry_links").insert([{ entry_id: entry.id, obligation_id: ob.id }, { entry_id: entry.id, document_id: documentId }]));
    unlinked.delete(id);
    if (context?.farm.id === farm) context.records = [...(context.records || []), { obligation_id: ob.id, document_id: documentId }];
  }
  // The standing answers drawn from the farm's records (again, after Done or Add the record).
  function drawStanding() {
    unmount(answers); answers = []; $("#overview-cards").replaceChildren();
    standing = M.standingAnswers(context);
    answers = standing.map((m) => answer($("#overview-cards"), m, { compact: true, summary: true }));
    if (wq) $("#overview-cards").append(wq.node);   // after the standing answers, with its open state kept through a redraw
    markFocused();
    for (const id of undoable.waiting()) showDone(id, false);   // a Done still inside its Undo window keeps its Undo through a redraw
    // Phone: the closed sheet shows What's due's first clause over the handle ("3 things need a record"), whole, and never
    // ends inside a word (#240)
    const due = standing.find((m) => m.key === "due");
    $("#overview-peek").textContent = M.peek(due?.answer?.text || $('#overview-cards [data-answer-key="due"] .answer-sentence')?.textContent || "");
    // a proposal fetched from ECan stays shown under its line through a redraw (CC1)
    for (const [no, p] of proposals) for (const b of $("#overview-cards").querySelectorAll('[data-fetch-conditions="' + CSS.escape(no) + '"]')) showProposal(b, p);
  }
  // A line just marked done or recorded is shown where it now sits, in Everything recorded.
  function redrawDue(id) {
    if (focused) { focused = null; focusPlace = null; FP.farmMap.focus(null); applyScene(); }   // its fold is drawn again closed
    drawStanding();
    const all = $('#overview-cards [data-answer-key="due"] details.answer-all'), line = all?.querySelector('[data-item-id="' + CSS.escape(id) + '"]');
    if (!line) return;
    all.open = true;
    line.scrollIntoView({ block: "nearest" }); line.focus({ preventScroll: true });
  }
  // ---- Consent conditions from ECan (CC1) -----------------------------------------------------------------
  // "Fetch conditions from ECan" on a consent whose conditions aren't recorded (its What's due line, or its expiry line):
  // the consent-conditions function reads them as the person may (an editor of the farm, the farm's own consent, none
  // recorded) and returns a proposal, shown under the line with ECan's wording and the attribution. Accept, for an advisor
  // of the farm, records them as that person (public.accept_consent_conditions: the obligations policies decide); the
  // line then leaves What's due's "needs a record" and the conditions take its place. Discard puts the proposal away.
  // Nothing is written by fetching. A proposal Ask fetched (consent.conditions) shows and is accepted the same way.
  const OBLIGATION_COLUMNS = "id,authorisation_id,code,summary,full_text,kind,parameters,due_date,recurrence,source_document_id,source_page";
  const proposals = new Map();   // consent number -> the proposal shown for it on this farm
  const unrecorded = (no) => { const a = (context?.authorisations || []).find((x) => x.kind === "consent" && String(x.consent_no || "").trim().toUpperCase() === no);
    return !!a && !(context.obligations || []).some((o) => o.authorisation_id === a.id); };
  // The proposal under its Fetch button (which gives way to it).
  function showProposal(button, p) {
    const box = button.closest(".checklist-fetch")?.querySelector(".checklist-proposal");
    if (!box) return;
    box.innerHTML = FP.consentConditions.html(p, { canAccept: !!context?.advisor }); box.hidden = false; button.hidden = true;
  }
  async function fetchConditions(button) {
    const no = button.dataset.fetchConditions, farm = context?.farm.id, msg = button.closest(".checklist-fetch")?.querySelector(".checklist-msg");
    if (!farm || !unrecorded(no)) return;
    button.disabled = true; if (msg) msg.textContent = "Asking ECan…";
    const r = await FP.consentConditions.request(FP.sb, farm, no);
    if (context?.farm.id !== farm) return;
    button.disabled = false;
    if (r.kind !== "proposal") { if (msg) msg.textContent = r.message; return; }
    if (msg) msg.textContent = "";
    proposals.set(no, r.proposal);
    for (const b of $("#overview-cards").querySelectorAll('[data-fetch-conditions="' + CSS.escape(no) + '"]')) showProposal(b, r.proposal);
  }
  async function acceptConditions(button) {
    const no = button.dataset.ccAccept, farm = context?.farm.id, msg = button.closest(".cc-proposal")?.querySelector(".cc-msg");
    const p = proposals.get(no) || (lastAsk?.farm === farm ? (lastAsk.result.proposals || []).find((x) => x.consent_no === no) : null);
    if (!p || !context?.advisor || !unrecorded(no)) return;
    button.disabled = true; if (msg) msg.textContent = "Recording…";
    try {
      await FP.consentConditions.accept(FP.sb, p);
      if (context?.farm.id !== farm) return;
      context.obligations = await read(FP.sb.from("obligations").select(OBLIGATION_COLUMNS).eq("farm_id", farm));
      proposals.delete(no);
      for (const x of lastAsk?.result.proposals || []) if (x.consent_no === no) x.state = "done";
      drawStanding();
      if (button.closest("#ask-answer")) showAnswer(false);
    } catch (err) {
      if (context?.farm.id !== farm) return;
      button.disabled = false; if (msg) msg.textContent = err?.message || String(err);
    }
  }
  function discardConditions(button) {
    const no = button.dataset.ccDiscard;
    proposals.delete(no);
    for (const x of lastAsk?.result.proposals || []) if (x.consent_no === no) x.state = "dismissed";
    for (const b of $("#overview-cards").querySelectorAll('[data-fetch-conditions="' + CSS.escape(no) + '"]')) {
      const box = b.closest(".checklist-fetch").querySelector(".checklist-proposal");
      box.replaceChildren(); box.hidden = true; b.hidden = false;
    }
    if (button.closest("#ask-answer")) showAnswer(false); else $("#overview-cards").querySelector('[data-fetch-conditions="' + CSS.escape(no) + '"]')?.focus();
  }
  // ---- Documents (B3): the sentence, then the Documents block; editors add documents and move them between tiers --
  const editor = () => ["owner", "admin", "edit"].includes(context?.role) && context.documentTiers === "chosen";
  let documentsNotice = null, documentsOffer = [];   // B3DZ: the main documents just filed, for the line that offers to read them in (shown once)
  // ---- Onboarding (ON1): the guided checklist of what the platform holds for the farm, what it can propose and what needs
  // a person (onboarding.js). A saved report (?item=) opens as it was saved. ------------------------------------------------
  function onboardingView(host, item) {
    const farm = context.farm, node = el("div", { class: "onboarding-host" });
    host.append(node);
    let gone = false;
    const editsFarm = ["owner", "admin", "edit"].includes(context.role);
    FP.onboarding.mount(node, { sb: FP.sb, farm, user: { id: user.id, name: user.user_metadata?.display_name || null }, canEdit: editsFarm, item: item || null,
      docs: context.documents, store: documentStore(farm.id, () => []), liveHref: FP.href(M.href(farm.id, "onboarding")),
      onAction: (kind, id) => {
        if (gone) return;
        if (kind === "add_block") { openBlock(); return; }
        if (kind === "documents") { location.hash = FP.href(M.href(farm.id, "documents", id || undefined)); return; }
        if (kind === "whats_due") location.hash = FP.href(M.href(farm.id, "map"));
      },
      onSaved: async () => { if (context?.farm.id === farm.id) context.documents = await readDocuments(FP.sb, context.farm); } });
    // DEC2: a file opened from a finding is framed as an object URL: leaving Onboarding gives each one back
    return { destroy: () => { gone = true; node.onclick = node.onsubmit = null; FP.decisionCard?.sweep(true); } };
  }
  function documentsView(host, item) {
    const sentence = el("div", { class: "block-host" }), list = el("div", { class: "block-host documents-host" });
    const onboarding = el("p", { class: "documents-onboarding" }, el("a", { href: FP.href(M.href(context.farm.id, "onboarding")) }, "Onboarding checklist"),
      " · what the platform holds for this farm and what needs a person");
    const wrap = el("section", { class: "documents-view", "data-view": "documents" }, sentence, onboarding, list);
    host.append(wrap);
    const farm = context.farm.id, handles = [];
    const data = () => ({ documents: context.documents, place: context.farm.name, canEdit: editor(), canAdd: editor(), canSupersede: editor() && !!FP.ops?.isStaff?.(), notice: documentsNotice, offer: documentsOffer, readInHref: FP.simpleView?.on() ? null : FP.href(M.href(farm, "onboarding")),
      requests: context.planRequests || [], userId: user?.id || null, folders: context.folders, space: "farm" });
    handles.push(FP.blocks.render(sentence, { block: "answer", owner: { farm }, options: { compact: true } }, { read: () => { const sentenceData = M.documents(context, FP.documentsBlock.arrange(context.documents)); return FP.simpleView?.on() ? { ...sentenceData, title: "Files" } : sentenceData; }, level: 2, href: FP.href }));
    // PH3: folders, then files; drawn with no files too, so the screen says so in one sentence
    handles.push(FP.blocks.render(list, { block: "documents", owner: { farm }, options: { selected: item || null, explorer: true } },
        { read: () => { const d = data(); documentsNotice = null; documentsOffer = []; return d; }, level: 3, nested: true, href: FP.href, store: documentStore(farm, () => handles) }));
    // FU4: the open requests are read once the view is up, and drawn when they arrive (unless a notice or a fresh offer is waiting to be shown).
    // UI1 (review of #504): never while files are waiting at the confirm step (drawing the block again would drop them): the requests
    // are drawn once that step is confirmed or cancelled.
    const mine = context;
    const confirming = () => !!list.querySelector(".doc-confirm:not([hidden])");
    const drawRequests = () => { if (!documentsNotice && !documentsOffer.length) for (const h of handles) h.refresh(); };
    // (FL1: the farm's made folders the same way: read once the view is up, drawn when they arrive; a name being typed is not lost either)
    const drawLater = () => {
      if (!confirming() && !list.querySelector("[data-fx-name-form]")) { drawRequests(); return; }
      const wait = new MutationObserver(() => {
        if (!list.isConnected || context !== mine) { wait.disconnect(); return; }
        if (!confirming() && !list.querySelector("[data-fx-name-form]")) { wait.disconnect(); drawRequests(); }
      });
      wait.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
    };
    if (!context.planRequests) readPlanRequests(FP.sb, context.farm).then((rows) => {
      if (context !== mine) return;
      context.planRequests = rows;
      drawLater();
    });
    if (context.folders === undefined) Files.readFolders(FP.sb, { farm_id: farm }).then((rows) => {
      if (context !== mine) return;
      context.folders = rows;
      drawLater();
    });
    return { destroy: () => unmount(handles) };
  }
  // Upload, register and move, as the signed-in person: storage and documents policies decide (F1e, B3).
  function documentStore(farm, handles) {
    const D = FP.documentsBlock;
    return {
      add: (item) => Files.addFile(FP.sb, { farm_id: farm }, item, context.documents),
      move: (id, change) => Files.moveFile(FP.sb, id, change),
      // FL1: the farm's made folders, and a file into or out of one (document_folders' and documents' policies decide)
      makeFolder: (name) => Files.makeFolder(FP.sb, { farm_id: farm }, name),
      renameFolder: (id, name) => Files.renameFolder(FP.sb, id, name),
      removeFolder: (id) => Files.removeFolder(FP.sb, id),
      toFolder: (id, folder) => Files.toFolder(FP.sb, id, folder),
      supersede: (id, by) => Files.supersedeFile(FP.sb, id, by),
      download: (doc) => Files.downloadFile(FP.sb, doc),
      // FU4: The read-it-in button asks for the plan to be read in: one row in plan_import_requests (public.request_plan_import), the same row
      // again if the plan already has an open request. Nothing is imported: an advisor confirms PL11's import, which marks the request.
      async requestReadIn(id) {
        const { data, error } = await FP.sb.rpc("request_plan_import", { p_document: id });
        if (error) throw error;
        if (!data) throw Error("The request wasn't recorded.");
        if (context?.farm.id === farm) context.planRequests = [...(context.planRequests || []).filter((r) => String(r.document_id) !== String(data.document_id)), data];
        return data;
      },
      // Read the farm's documents again and redraw, with one line saying what happened.
      async changed(notice, extra) {
        if (context?.farm.id !== farm) return;
        const [documents, folders] = await Promise.all([readDocuments(FP.sb, context.farm), Files.readFolders(FP.sb, { farm_id: farm })]);
        if (context?.farm.id !== farm) return;
        context.documents = documents; context.folders = folders;
        documentsNotice = notice || null;
        documentsOffer = Array.isArray(extra?.offer) ? extra.offer : [];
        for (const h of handles()) h.refresh();
      },
    };
  }
  // ---- Ask: the question goes to the farm's Ask function; its answer, its sources as links, the map arranged as it
  // says (after the answer is shown), and each change it offers as a line the person confirms or puts away. ---------
  async function askQuestion(question) {
    const farm = context.farm.id, mine = ++askToken, button = $("#ask-form button[type=submit]");
    $("#ask-answer").replaceChildren(el("p", { class: "ask-question" }, question), el("p", { class: "ask-wait", role: "status" }, "Reading the farm's records…"));
    if (button) button.disabled = true;
    const result = await FP.ask.request(FP.sb, farm, question);
    if (mine !== askToken || context?.farm.id !== farm) return;
    if (button) button.disabled = false;
    lastAsk = { farm, question, result };
    showAnswer(true);
  }
  const canChange = () => M.canEdit(context?.role);
  // An offered change the farm space can make: a condition of this farm that What's due lists (and, to attach, one of
  // its documents). A condition What's due doesn't list is never offered.
  const offered = (c) => canChange() && (context.obligations || []).some((o) => String(o.id) === c.obligation_id) &&
    !!dueItem("obligation-" + c.obligation_id)?.obligation_id &&
    (c.verb !== "document.attach" || (context.documents || []).some((d) => String(d.id) === c.document_id));
  function showAnswer(run) {
    const box = $("#ask-answer");
    if (!box || !lastAsk || lastAsk.farm !== context?.farm.id) return;
    const { question, result } = lastAsk, farm = context.farm.id, nodes = [el("p", { class: "ask-question" }, question)];
    if (result.kind !== "answer") nodes.push(el("p", { class: "answer-sentence" }, result.message));
    else {
      for (const b of FP.ask.blocks(result.text)) nodes.push(b.type === "list" ? el("ul", { class: "ask-list" }, ...b.items.map((t) => el("li", {}, t))) : el("p", { class: "ask-text" }, b.text));
      if (result.sources.length) nodes.push(el("div", { class: "ask-sources" }, el("h3", {}, "Sources"), el("ul", {}, ...result.sources.map((s) =>
        el("li", {}, el("a", { href: FP.href(s.kind === "document" ? M.href(farm, "documents", s.id) : M.href(farm, "map", "obligation-" + s.id)) }, s.label))))));
      const changes = result.confirmations.map((c, n) => [c, n]).filter(([c]) => c.state !== "dismissed" && offered(c));
      if (changes.length) nodes.push(el("ul", { class: "ask-confirm" }, ...changes.map(([c, n]) => el("li", {}, el("span", {}, c.label),
        c.state === "done" ? el("span", { class: "ask-confirm-msg", role: "status" }, "Done.") :
          el("span", { class: "ask-confirm-actions" }, el("button", { type: "button", "data-ask-confirm": String(n) }, "Confirm"),
            el("button", { type: "button", class: "link", "data-ask-dismiss": String(n) }, "Not now"), el("span", { class: "ask-confirm-msg", role: "status" }))))));
      // Conditions Ask fetched from ECan (CC1): the same proposal as What's due's, for a consent still without them.
      for (const p of result.proposals || []) {
        if (p.state === "dismissed") continue;
        if (p.state === "done") { nodes.push(el("p", { class: "ask-note", role: "status" }, "Recorded the conditions of " + p.consent_no + ".")); continue; }
        if (!unrecorded(p.consent_no)) continue;
        const box = el("div", { class: "ask-proposal" });
        box.innerHTML = FP.consentConditions.html(p, { canAccept: !!context?.advisor });
        nodes.push(box);
      }
      // Water-quality analyses (X1): a card each, the figures from the platform's library; an editor confirms one to record it.
      (result.analyses || []).forEach((p, n) => {
        const box = el("div", { class: "ask-analysis" });
        box.innerHTML = FP.wqAnalysis.html(p, { n, canConfirm: canChange() });
        nodes.push(box);
      });
      // Where the farm drains (H1f): the nearest downstream monitoring site and what LAWA publishes for it, from the function's
      // code (not the model's words), with the context module that assembled it.
      const dr = FP.ask.drainsLines(result.drains_to);
      if (dr) {
        const part = (title, items) => (items.length ? [el("p", { class: "ask-drains-label" }, title), el("ul", {}, ...items.map((t) => el("li", {}, t)))] : []);
        nodes.push(el("section", { class: "ask-drains", "aria-label": dr.title }, el("h3", {}, dr.title),
          ...(dr.site ? [el("p", { class: "ask-drains-site" }, el("strong", {}, dr.site)), el("p", { class: "ask-drains-where" }, dr.where)] : [el("p", { class: "ask-drains-site" }, dr.message)]),
          ...(dr.lawa_message ? [el("p", { class: "ask-drains-lawa" }, dr.lawa_message)] : []),
          ...part("LAWA's latest state (LAWA's own NPS-FM attribute band labels, as published)", dr.state),
          ...part("LAWA's trend", dr.trend),
          ...(dr.credit ? [el("p", { class: "ask-drains-credit" }, dr.credit)] : []),
          el("p", { class: "ask-drains-author" }, dr.author)));
      }
      for (const note of result.notes) nodes.push(el("p", { class: "ask-note" }, note));
    }
    box.replaceChildren(...nodes);
    if (run && result.kind === "answer") runAsk(result.ui);
  }
  // ---- Water-quality analysis (X1) --------------------------------------------------------------------------------
  // A card's buttons: Recalculate asks the analysis function for a new preview with the person's settings; Confirm sends the
  // preview they see, which the function recalculates and records as them only if it is unchanged (otherwise the new one is
  // shown to confirm); Save as note adds the text to the farm's own note on the site layer. Nothing is recorded otherwise.
  async function wqAction(button) {
    const farm = context?.farm.id, all = lastAsk?.farm === farm ? lastAsk.result.analyses || [] : [];
    const n = Number(button.dataset.wqConfirm ?? button.dataset.wqRecalc ?? button.dataset.wqNote), p = all[n], card = button.closest(".wq-card");
    if (!p || !canChange() || !card) return;
    const W = FP.wqAnalysis, owner = { farm_id: farm };
    button.disabled = true;
    if (button.dataset.wqNote !== undefined) {
      try { await W.saveNote(FP.sb, farm, p, card.querySelector("[data-wq-note-text]")?.value); p.noteSaved = true; p.message = ""; }
      catch (err) { p.message = err?.message || String(err); }
    } else {
      const recalc = button.dataset.wqRecalc !== undefined, overrides = recalc ? W.overridesFrom(card, p) : p.overrides;
      const r = await W.request(FP.sb, W.body(p, recalc ? "preview" : "confirm", owner, overrides));
      if (context?.farm.id !== farm) return;
      if (r.kind === "preview" || r.kind === "changed") all[n] = { ...r.preview, overrides, message: r.kind === "changed" ? r.message : "" };
      else if (r.kind === "saved") {
        all[n] = { ...r.preview, overrides, state: "saved", message: "", analysis_id: r.id };
        // RD1: the recorded analysis's review state (a line only when something could not be fingerprinted or has changed).
        all[n].review = (await W.reviews(FP.sb, [r.id]))[r.id] || null;
        if (context?.farm.id !== farm) return;
      }
      else p.message = r.message;
    }
    showAnswer(false);
  }
  // Where a map.frame verb points: a land unit, a condition's recorded place, one of the map's layers; null is the farm.
  function askPlace(place, ctx, models) {
    const [kind, ...rest] = String(place || "").split(":"), v = rest.join(":");
    if (kind === "land_unit") return { land_units: [v], themes: [] };
    if (kind === "obligation") return (models || []).find((m) => m.places?.["obligation-" + v])?.places["obligation-" + v] || null;
    // a reference source of the farm's context (PERF1b: counted, read or not), or a layer's theme
    const reference = (ctx?.maps?.reference || []).some((r) => r.key === v) || Number(ctx?.referenceCounts?.[v]) > 0;
    if (kind === "layer") return reference ? { land_units: [], themes: [], layers: [v] } : { land_units: [], themes: [v] };
    return null;
  }
  // The answer's map verbs, in order, once it is shown: the layer set it names and the place it frames (the last one
  // given), or Documents opened on the plan. The previous answer's arrangement goes first; Layers set by hand stay.
  function runAsk(actions) {
    askSet = null;
    let frame;   // undefined: no frame named; null: the farm
    for (const a of actions) {
      if (a.verb === "map.layers") askSet = a.set;
      else if (a.verb === "map.frame") frame = askPlace(a.place, context, standing);
      else if (a.verb === "block.add") { applyScene(); openBlock(); return; }   // FB1: the AI opens the steps; only the person saves
      else if (a.verb === "plan.open" && (context.documents || []).some((d) => String(d.id) === a.document_id)) {
        applyScene(); location.hash = FP.href(M.href(context.farm.id, "documents", a.document_id)); return;
      }
    }
    if (frame === undefined) { if (focusPlace) { focusPlace = null; FP.farmMap.focus(null); } }
    else if (!frame || !FP.farmMap.focus(frame)) {
      focusPlace = null; FP.farmMap.focus(null);
      // PERF1b: the layer it frames may not be read yet: read it, then frame it if the answer's arrangement still stands
      const set = askSet;
      if (frame) whenRead(frame, () => { if (askSet === set && !focusPlace && FP.farmMap.focus(frame)) focusPlace = frame; });
    }
    else focusPlace = frame;
    applyScene();
  }
  async function confirmAsk(n, button) {
    const c = lastAsk?.result.confirmations?.[n], farm = context?.farm.id;
    if (!c || lastAsk.farm !== farm || !offered(c)) return;
    const msg = button.closest("li")?.querySelector(".ask-confirm-msg"), ob = context.obligations.find((o) => String(o.id) === c.obligation_id);
    button.disabled = true; if (msg) msg.textContent = "";
    try {
      if (c.verb === "obligation.done") {
        const done = await markDone("obligation-" + ob.id, button);
        if (done !== true) throw Error(done);
      } else {
        const doc = context.documents.find((d) => String(d.id) === c.document_id);
        await linkRecord(farm, ob, doc.id, M.docTitle(doc), "obligation-" + ob.id);
        if (context?.farm.id === farm) drawStanding();
      }
      if (context?.farm.id !== farm) return;
      c.state = "done"; showAnswer(false);
    } catch (err) {
      if (context?.farm.id !== farm) return;
      button.disabled = false; if (msg) msg.textContent = err?.message || String(err);
    }
  }
  // A condition's line opened from a link (an answer's source): What's due shows it, open, with its place framed.
  function revealLine(id) {
    const line = $("#overview-cards").querySelector('[data-item-id="' + CSS.escape(id) + '"]');
    if (!line) return;
    const outer = line.parentElement?.closest("details.answer-all, details.answer-fold");
    if (outer) outer.open = true;
    const fold = line.querySelector("details.checklist-fold");
    if (fold) fold.open = true;
    setSheet("due", "open", false);
    line.scrollIntoView({ block: "nearest" }); line.focus({ preventScroll: true });
  }
  function askView() {
    const form = el("form", { id: "ask-form", class: "ask-form" },
      el("label", { for: "ask-input", class: "visually-hidden" }, "Question"),
      el("textarea", { id: "ask-input", rows: "3", autocomplete: "off", enterkeyhint: "send", placeholder: "When is the next audit due?" }),
      el("button", { type: "submit" }, "Ask"));
    return el("section", { class: "space-view", "data-view": "ask" }, el("h2", {}, "Ask"), form, el("div", { id: "ask-answer", class: "ask-answer", "aria-live": "polite" }));
  }
  function createView() {
    const view = el("section", { class: "space-view", "data-view": "create" }, el("h2", {}, "Create"),
      el("p", {}, "These can't be made here yet."),
      el("ul", { class: "output-list" }, ...M.outputs.map(([key, label]) => el("li", { "data-output": key }, el("span", {}, label)))));
    // A note or a photo from the paddock (B4b): kept on the phone without coverage, uploaded when back online; the farm's
    // recent notes and photos below it, each with its upload state. Placed first: it is what a farmer comes here for.
    if (FP.capture) {
      const host = el("div", { class: "capture-host" });
      view.querySelector("h2").after(host, el("h3", { class: "output-heading" }, "Reports"));
      FP.capture.mount(host, { sb: FP.sb, farm: context.farm, user: context.user, el, canEdit: canChange() });
    }
    // Water-quality results from a spreadsheet (the farm's own, or a group's the person edits): upload, check, confirm.
    if (canChange() && FP.wqImport) {
      const open = el("button", { type: "button", class: "wq-open" }, "Import water-quality results");
      open.addEventListener("click", () => { open.remove(); FP.wqImport.mount(view, { sb: FP.sb, farm: context.farm, el, documentsBlock: FP.documentsBlock }); });
      view.append(open);
    }
    return view;
  }
  // V4: Maps is its own screen under the farm's header (js/maps-view.js): no farm map and none of the farm's reads.
  function openMaps(farm, route) {
    if (context && context.farm.id !== farm.id) close();   // another farm's reads and map go first
    token++;
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    setDrawer(false); FP.farmMap.closePopup?.(); FP.shapeEditor?.close();
    FP.show("screen-maps");
    header(farm, route); reserveHeader();
    document.title = farm.name + " · " + M.viewLabel("maps") + " | " + FP.brand?.product;
    return FP.mapsView.open($("#screen-maps"), { owner: { farm: farm.id }, name: farm.name, item: route.item || null, href: (id) => FP.href(M.href(farm.id, "maps", id)) });
  }
  // J2: Home is its own screen under the farm's header (place-home.js): search, the add actions, the sections; no farm map and none
  // of the farm's reads (as Maps)
  function openHome(farm, route) {
    if (context && context.farm.id !== farm.id) close();   // another farm's reads and map go first
    token++;
    FP.mapsView?.close();
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    setDrawer(false); FP.farmMap.closePopup?.(); FP.shapeEditor?.close();
    FP.show("screen-farm-home");
    header(farm, route); reserveHeader();
    document.title = farm.name + " · " + M.viewLabel("home") + " | " + FP.brand?.product;
    const tabs = tabsFor(farm);
    const addCtx = farmRole(farm).then(({ role, tiers }) => ({ space: "farm", id: farm.id, name: farm.name, role, documentTiers: tiers, staff: !!FP.ops?.isStaff?.(), views: tabs.map(([key]) => key), view: "home" }));
    const host = $("#screen-farm-home");
    // FEP1: the Plan row beside Maps and Files, for RCL staff, the coordinators of a group the farm belongs to and (FEP2) the farm's own
    // people, only when the farm has plan records (farm-plan.js homeRow)
    const extra = FP.farmPlan ? FP.farmPlan.homeRow(farm, { sb: FP.sb, who: planWho(farm) }).then((row) => (row ? [row] : [])) : null;
    // ACT1: one quiet line when the person has actions for now ("Actions · 2 for now"), absent when there is nothing
    const waiting = FP.farmActions && tabs.some(([key]) => key === "actions") ? FP.farmActions.homeLine(farm, { sb: FP.sb, who: planWho(farm) }).then((w) => (w ? [w] : [])) : null;
    host.replaceChildren(FP.placeHome.view({ space: "farm", place: { id: farm.id, name: farm.name }, sections: tabs, addCtx, sb: FP.sb, extra, waiting }));
    // NP1b: the working notes, drawn only for those the database lets read them (RCL staff on the farm; a member group's coordinators)
    const notes = FP.workingNotes?.view(farm.id, { sb: FP.sb });
    if (notes) host.querySelector(".place-home")?.append(notes);
    host.scrollTop = 0;
  }
  // FEP1: who the person is on this farm, for the Plan page and its Home row: their farm role (farm_members, as Add reads it), the
  // staff flag, and their own catchment groups with their roles (read at sign-in)
  // Fails closed: a failed farm_members read rejects (never "no role"), so the Plan shows to nobody it should not (farm-plan.js)
  const planWho = (farm) => (context?.farm.id === farm.id ? Promise.resolve(context.role)
    : Promise.resolve(FP.sb.from("farm_members").select("role").eq("farm_id", farm.id).eq("user_id", user.id).maybeSingle()).then((r) => { if (!r || r.error) throw r?.error || Error("no answer"); return r.data?.role || null; }))
    .then((role) => ({ role, staff: FP.ops?.isStaff?.() === true, staffKnown: FP.ops?.staffKnown?.() === true, groups: FP.groupSpace?.groups?.() || [] }));
  // FEP1: the farm's Plan is its own screen under the farm's header (js/farm-plan.js), read only; none of the farm's reads (FEP2: its
  // own small map of the boundary and land units, made and removed with the page)
  function openPlan(farm, route) {
    if (context && context.farm.id !== farm.id) close();   // another farm's reads and map go first
    token++;
    FP.mapsView?.close();
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    setDrawer(false); FP.farmMap.closePopup?.(); FP.shapeEditor?.close();
    // (its screen is made here, beside Home's, so the sign-in page carries nothing of it)
    if (!$("#screen-farm-plan")) $("#screen-farm-home").after(el("main", { id: "screen-farm-plan", class: "farm-plan-screen", hidden: true }));
    FP.show("screen-farm-plan");
    header(farm, route); reserveHeader();
    document.title = farm.name + " · " + M.viewLabel("plan") + " | " + FP.brand?.product;
    return FP.farmPlan?.open($("#screen-farm-plan"), { farm, sb: FP.sb, who: planWho(farm) });
  }
  // ACT1: the farm's Actions is its own screen under the farm's header (js/farm-plan.js, FP.farmActions): none of the farm's other reads
  function openActions(farm, route) {
    if (context && context.farm.id !== farm.id) close();   // another farm's reads and map go first
    token++;
    FP.mapsView?.close();
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    setDrawer(false); FP.farmMap.closePopup?.(); FP.shapeEditor?.close();
    // (its screen is made here, beside Home's, so the sign-in page carries nothing of it)
    if (!$("#screen-farm-actions")) $("#screen-farm-home").after(el("main", { id: "screen-farm-actions", class: "farm-actions-screen", hidden: true }));
    FP.show("screen-farm-actions");
    header(farm, route); reserveHeader();
    document.title = farm.name + " · " + M.viewLabel("actions") + " | " + FP.brand?.product;
    try { sessionStorage.setItem("fp-view-" + user.id + "-" + farm.id, M.href(farm.id, "actions")); } catch {}
    // (a member farm a coordinator opened: not theirs, nothing read)
    const who = farm.readOnly && FP.ops?.isStaff?.() !== true ? Promise.resolve({ role: null }) : planWho(farm);
    return FP.farmActions?.open($("#screen-farm-actions"), { farm, sb: FP.sb, who });
  }
  async function open(farm, route) {
    flushDone();   // going to another view (or farm) writes any Done still inside its Undo window (#258)
    if (route.view !== "home") FP.placeHome?.close();
    if (route.view !== "plan") FP.farmPlan?.close();
    if (route.view !== "actions") FP.farmActions?.close();
    if (route.view === "actions") return openActions(farm, route);
    if (route.view === "plan") return openPlan(farm, route);
    if (route.view === "home") return openHome(farm, route);
    if (route.view === "maps") return openMaps(farm, route);
    FP.mapsView?.close();
    const current = ++token;
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    setDrawer(false);
    $("#space-handle-label").textContent = M.viewLabel(route.view) || "";
    setSheet("due", "peek", false); setSheet("space", "open", false);
    FP.farmMap.closePopup?.();   // UI1: a feature popup belongs to the view it was opened in
    FP.shapeEditor?.close();      // GE1b: and so does a shape being edited (nothing unsaved is written)
    // (a farm whose read is still on its way is not read again: a second route to it waits for the same reads)
    const reading = context?.farm.id !== farm.id && pendingFor !== farm.id;
    if (reading) {
      context = null; openedMap = null; forget();
      unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
      wq?.destroy(); wq = null;
      layerEntries = []; handSet = new Map(); stackOk = new Set();
      $("#space-body").replaceChildren(); $("#overview-cards").replaceChildren(); $("#overview-peek").textContent = "";
      // TIM1 (#409): the drawn-time clock starts here, as the farm's reads start (after sign-in, whatever screen came before)
      const run = timing = T?.begin("farm", farm.id) || null;
      // PERF1b: the map's half and the rest are read at once; the farm is drawn as soon as the map's half is back
      const maps = loadMap(FP.sb, farm, user, { onMap: () => run?.step("data") }), rest = loadRest(FP.sb, farm, user);
      pendingFor = farm.id; mapsPending = maps;
      pending = Promise.all([maps, rest]).then(([m, r]) => assemble(FP.sb, farm, user, m, r));
      pending.catch(() => {});   // the failure is shown by whichever await meets it first
    }
    FP.show("screen-map");
    document.body.classList.toggle("farm-detail", route.view !== "map");
    $("#space-content").hidden = route.view === "map";
    $("#overview-rail").hidden = route.view !== "map";
    $("#map-msg").hidden = false; $("#map-msg").textContent = "Loading the farm…";
    try {
      header(farm, route); reserveHeader();
      // TIM1: the map (its WebGL context and style) is made now, beside the farm's reads, not after farm_map is back; inside
      // the try, so a browser that can't make one gets "Couldn't load the farm", not a blank screen
      if (reading) { const run = timing; Promise.resolve(FP.farmMap.loaded?.()).then(() => run?.step("style"), () => {}); }
      if (openedMap !== farm.id) {
        const run = timing;
        const maps = context?.maps || await mapsPending;
        if (current !== token) return;
        // A sheet that opens with the view (Ask, Create, Documents) covers part of the map: the first fly lands clear of it.
        framedOverlap = measureSheet();
        // TIM1 (#410): the farm's outline on screen now, on a map that has shown nothing yet, not a black map until the
        // style, the tiles and the flight in have come; the `outline` step when it (or the map's own line) is first on screen
        FP.farmMap.sketch?.(maps.extent);
        FP.farmMap.outlineShown?.().then((at) => run?.step("outline", at));
        // The Map scene block draws the farm on the space's one map (FP.farmMap), so the NZ -> farm zoom carries on.
        unmount(scene);
        scene = FP.blocks.render($("#farm-scene"), { block: "map-scene", owner: { farm: farm.id } }, { read: () => context?.maps || maps, surface: FP.farmMap, level: 2 });
        const drawn = await scene.ready;
        if (current !== token) return;
        if (!drawn) throw Error("Map unavailable for this farm.");
        sceneEntries = drawn.entries; openedMap = farm.id;
        // LK2: looks that were not back when the farm was drawn are applied to its map when they come (none: nothing changes)
        // (and the Layers drawer's rows, once drawn, take the looks' sentences)
        maps.lateStyles?.then((styles) => { if (openedMap === farm.id && styles.length) { maps.styles = styles; FP.farmMap.restyle?.(styles); if (refs) renderLayers(layerRows(sceneEntries)); } });
        // LK4: a kind on from a zoom (paddocks, tracks, drone imagery) comes and goes as the map's zoom crosses it
        offZoom?.(); offZoom = FP.farmMap.onMoveEnd?.(() => { if (openedMap === farm.id) applyScene(); }) || null;
        startParts(farm.id, maps);   // CAP1b: a deferred layer the map opens with is read for the view (nothing, with none)
        // the farm is on the map: the message goes now, not when the standing answers have been read (PERF1b)
        $("#map-msg").hidden = true; farmDrawn(run);
        addLayersControl(); commandBar();
      }
      const loaded = context || await pending;
      if (current !== token) return;
      context = loaded;
      header(farm, route); reserveHeader();
      FP.capture?.start({ sb: FP.sb, user: context.user });   // B4b: what waits on this phone uploads once a farm is open
      document.title = farm.name + (route.view === "map" ? "" : " · " + M.viewLabel(route.view)) + " | " + FP.brand?.product;
      try { sessionStorage.setItem("fp-view-" + user.id + "-" + farm.id, M.href(farm.id, route.view)); } catch {}
      // the Layers rows once the farm's counts are known: the reference sources listed, each read when switched on
      if (!refs) { startReference(); renderLayers(layerRows(sceneEntries)); renderSources(); prefetchWhenIdle(); }
      FP.farmMap.resize(); settleFrame();
      if (blockButton) blockButton.hidden = !canAddLand();   // Add a block: for the farm's editors only
      unmount(view); view = null;
      if (focused) { focused = null; FP.farmMap.focus(null); }   // a new view starts on the farm
      askSet = null;   // and an answer's layers go with the Ask view
      // Water quality nearby: one line per farm. Another view closes it, so its sites leave the quiet map.
      if (!wq && FP.wq) {
        wq = FP.wq.create({ sb: FP.sb, farm, extent: context.maps.extent, provenance: (key, at) => FP.provenance?.lineFor(context?.maps?.sources, key, null, at) || null });
        wq.ready.then(renderSources);   // the water-quality sources join the Sources list once the sites are known
      }
      if (route.view !== "map") wq?.collapse({ reframe: true });
      // and on the quiet map, with what this view brings (the plan selected in Documents: the FEP's layers); a photo
      // opened in an earlier view no longer counts
      shownRoute = { view: route.view, item: route.item || null }; focusPlace = null; photoShown = false;
      applyScene();
      drawStanding();
      $("#space-body").scrollTop = 0;   // the sheet's scroller outlasts the view: each view opens at its top
      if (route.view === "documents") {
        $("#space-body").replaceChildren();
        view = documentsView($("#space-body"), route.item);
        const selected = $("#space-body").querySelector('[data-item-id="' + CSS.escape(route.item || "") + '"]');
        if (selected) { selected.scrollIntoView({ block: "nearest" }); selected.focus({ preventScroll: true }); }
      } else if (route.view === "ask") {
        $("#space-body").replaceChildren(askView()); showAnswer(false);
        if (pendingAsk) { const q = pendingAsk; pendingAsk = null; askFrom(q); }
      }
      else if (route.view === "map" && route.item) revealLine(route.item);
      else if (route.view === "create") { $("#space-body").replaceChildren(createView()); }
      else if (route.view === "people") { $("#space-body").replaceChildren(peopleView()); if (M.canManage(context.role)) await loadPeople(); }
      else if (route.view === "onboarding") { $("#space-body").replaceChildren(); view = onboardingView($("#space-body"), route.item); }
      $("#map-msg").hidden = true;
    } catch (e) {
      if (!context && pendingFor === farm.id) forget();   // a farm that couldn't be read is read again when next opened
      if (current === token) { FP.farmMap.unsketch?.(); $("#map-msg").hidden = false; $("#map-msg").textContent = "Couldn't load the farm: " + (e.message || e); }
    }
  }
  // PERF1b (4), TIM1 (#409, #410): measured, not guessed. A farm drawn from its reads (its boundary on the map, "Loading the
  // farm…" gone) is the run's `drawn` step, timed from when the farm's route began loading (route-timing.js: never the
  // page's start or the sign-in screen, and dropped if the person left the farm first); then the map at rest is its `idle`.
  // The figure is kept for this browser's tab, so Operations can show it to staff with its steps beside the build version.
  function farmDrawn(run) {
    if (!run?.step("drawn")) return;
    Promise.resolve(FP.farmMap.whenIdle?.()).then(() => run.step("idle"), () => {});
  }
  // The last figure for this browser's tab: { ms, farm, from, steps, at }, or null.
  const lastDrawn = () => T?.last("farm") ?? null;
  return { load, loadMap, loadRest, summaries, setPortfolio, showPortfolio, close, open, sceneFor, askPlace, openBlock, lastDrawn, viewsIn, governs, governsMap, looksTimeoutMs: LOOKS_TIMEOUT_MS };
});

// ACT1: a farm's Actions list (#/farm/<id>/actions), on a phone and a computer, and its one quiet line on the farm's Home. The words
// and the rules are farm-plan-model.js (FP.farmActionsModel); this part of farm-space.js reads, ticks and draws, in the browser only.
// (It sits here, with the farm's other screens, because the app's page, index.html, names the scripts it loads and stays as it is.)
//
// The owner's rulings (19 Nov 2026, the design mock approved "as drawn"): one list per farm, To do (Now, Later, "When it happens, or
// no date") and Done; each action's people responsible (none is Anyone); everyone with a role on the farm sees the whole list, opened
// on Mine, with Everyone and each person behind one button. No overdue, no red, no score. Ticking: the circle fills and pops, two soft
// rising notes (Web Audio, made here: no file, no library; a per-device Sound setting, on at first; silent when the device asks for
// less motion or the setting is off; never an error when audio is unavailable), the row goes to Done with who ticked it and when, and
// Undo for 5 seconds. A repeating action says "Comes back <date>" and comes back by itself (the database makes its next time at the
// tick). Adding by hand and changing one: what, who, when (a date, repeats, when something happens, or no date), for the farm's
// editors and above. Nothing here chooses from the plan or a consent, and nothing is offered after a tick yet (pieces 2 and 3).
//
// Reads (as the signed-in person; row-level security decides what comes back):
//   actions                 the farm's listed actions: those to do (at most 500) and the newest 200 done
//   action_people           who is responsible, by farm (at most 2,000 rows)
//   farm_action_people(f)   the farm's people's names and roles (for anyone with a role on the farm)
// The person's own farm role comes from the farm's header (farm_members, as Add and the Plan read it).
// Writes: action_tick / action_untick (functions), and for the farm's editors and above: actions (insert, update) and action_people
// (insert, delete). A tick that can't be sent says so calmly and puts the row back; there is no queue for later.
(function (root) {
  const FP = root.FP;
  if (!FP || !root.document) return;   // (the browser only: in Node, farm-space.js is its models)
  const A = () => FP.farmActionsModel;
  const W = () => A().WORDS;
  const el = (...a) => FP.el(...a);
  const COLS = "id,title,description,due_date,when_text,repeat_every,series_id,shows_from,status,completed_on,completed_by,created_by";
  const CAP = { open: 500, done: 200, people: 2000 };
  const UNDO_MS = 5000;
  const SOUND_KEY = "fp-actions-sound";
  let shown = null;   // the screen drawn now
  let addOnOpen = null;   // a farm whose Actions should open its Add form once drawn (the + chose "Action" from another screen)
  const afterTick = [];   // ACT1b will offer proof here (a photo, a file...): onTicked(fn) adds a step; nothing is offered yet

  // ---- the day, the person -----------------------------------------------------------------------------------------------------------
  const today = async (sb) => (typeof sb?.today === "function" ? String(await sb.today()).slice(0, 10) : FP.placeHomeModel?.nzDay?.() || new Date().toISOString().slice(0, 10));
  const reduced = () => typeof root.matchMedia === "function" && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = () => !!root.matchMedia?.("(max-width: 800px)").matches;
  const notReady = (e) => !!e && (e.code === "42703" || e.code === "PGRST202" || e.code === "PGRST204" || /does not exist|could not find/i.test(String(e.message || "")));

  // ---- the sound -----------------------------------------------------------------------------------------------------------------------
  // Per device (this browser), on unless turned off. Read and written in a try: a private window or blocked storage is "on", unsaved.
  function soundOn() { try { return root.localStorage?.getItem(SOUND_KEY) !== "off"; } catch { return true; } }
  function setSound(on) { try { root.localStorage?.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* not kept: this visit only */ } }
  let actx = null;
  // two soft rising notes (A5 then E6, a sine with a quiet octave above), about 330 ms in all
  function ding() {
    if (!soundOn() || reduced()) return false;
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      actx = actx || new AC();
      if (actx.state === "suspended") Promise.resolve(actx.resume?.()).catch(() => {});
      const t0 = actx.currentTime + 0.01;
      for (const [hz, at] of [[880, 0], [1318.5, 0.1]]) {
        const o = actx.createOscillator(), o2 = actx.createOscillator(), g = actx.createGain(), g2 = actx.createGain();
        o.type = "sine"; o.frequency.value = hz; o2.type = "sine"; o2.frequency.value = hz * 2; g2.gain.value = 0.18;
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(actx.destination);
        const s = t0 + at;
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.16, s + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
        o.start(s); o2.start(s); o.stop(s + 0.23); o2.stop(s + 0.23);
      }
      return true;
    } catch { return false; }   // no audio here: the tick works without it
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------------------------
  const rowsOf = (r) => { if (r?.error) throw r.error; return Array.isArray(r?.data) ? r.data : []; };
  async function readList(sb, farmId) {
    const base = () => sb.from("actions").select(COLS).eq("farm_id", farmId).eq("listed", true);
    const [open, done, who, people] = await Promise.all([
      Promise.resolve(base().in("status", ["planned", "in_progress", "possible"]).order("due_date").limit(CAP.open + 1)).then(rowsOf),
      Promise.resolve(base().eq("status", "done").order("completed_on", { ascending: false }).limit(CAP.done + 1)).then(rowsOf),
      Promise.resolve(sb.from("action_people").select("action_id,user_id").eq("farm_id", farmId).limit(CAP.people)).then(rowsOf),
      Promise.resolve(sb.rpc("farm_action_people", { f: farmId })).then(rowsOf),
    ]);
    return { actions: [...open.slice(0, CAP.open), ...done.slice(0, CAP.done)], people: who, farmPeople: people, more: open.length > CAP.open };
  }
  // The person's role on the farm, from `who` (a promise of { role, ... }, as farm-space reads it); fails closed (no answer throws)
  // ACT1 (the owner, 19 Nov 2026): RCL staff act on any farm's list as its editors do ("staff"); the database decides in the end (staff's
  // writes need a two-factor session there)
  const readRole = (who) => Promise.resolve(who).then((w) => {
    if (!w || !("role" in w)) throw new Error("the farm role was not read");
    return w.staff === true && !A().canEdit(w.role) ? "staff" : w.role || null;
  });

  // ---- the screen ----------------------------------------------------------------------------------------------------------------------
  // host: the screen; opts: { farm, sb, who }
  async function open(host, { farm, sb = FP.sb, who } = {}) {
    close();
    const me = { alive: true, host, farm, sb, tab: "todo", filter: "mine", sel: null, sideKind: null, farmPeople: [], actions: [], role: null, me: null, today: null, timers: new Set(), pending: new Set() };
    shown = me;
    message(me, W().loading);
    host.scrollTop = 0;
    try {
      me.today = await today(sb);
      me.role = await readRole(who);
      // (RCL staff with no editing role on the farm: their writes need a two-factor session, so without one the list is for looking at)
      if (me.role === "staff") {
        const level = await Promise.resolve(sb.auth?.mfa?.getAuthenticatorAssuranceLevel?.()).then((r) => r?.data?.currentLevel || null, () => null);
        if (level !== "aal2") me.role = "staff-look";
      }
      if (!live(me)) return;
      if (!me.role) { message(me, W().notYours); return; }
      const got = await readList(sb, farm.id);
      if (!live(me)) return;
      me.farmPeople = got.farmPeople; me.more = got.more;
      me.me = got.farmPeople.find((p) => p.is_you)?.user_id || null;
      me.actions = A().rows(got.actions, got.people);
      me.filter = A().startFilter(me.actions, { role: me.role, me: me.me, today: me.today });
    } catch (e) { if (live(me)) message(me, notReady(e) ? W().notReady : W().failed); return; }
    if (!live(me)) return;
    build(me);
    draw(me);
    if (addOnOpen === farm.id) { addOnOpen = null; openForm(me, null); }
  }
  // the +'s "Action" (add.js): the form, on this farm's Actions (opened first when another screen is showing)
  function add(farmId) {
    if (shown?.list && shown.farm.id === farmId) { openForm(shown, null); return; }
    addOnOpen = farmId;
    root.location.hash = FP.href(FP.farmModel.href(farmId, "actions"));
  }
  const live = (me) => me.alive && shown === me;
  function close() {
    if (!shown) return;
    const me = shown;
    me.alive = false;
    for (const t of me.timers) clearTimeout(t);
    me.form?.overlay?.remove();
    root.document.body.classList.remove("acts-form-open");
    me.host?.replaceChildren();
    shown = null;
  }
  function message(me, text) {
    me.host.replaceChildren(el("article", { class: "acts acts-message", "aria-labelledby": "acts-title" },
      el("div", { class: "acts-main" }, el("div", { class: "acts-head" }, el("h1", { id: "acts-title" }, W().title)), el("p", { class: "acts-quiet", role: "status" }, text))));
  }
  const later = (me, fn, ms) => { const t = setTimeout(() => { me.timers.delete(t); if (live(me)) fn(); }, ms); me.timers.add(t); return t; };
  const pause = (me, ms) => new Promise((r) => { const t = setTimeout(() => { me.timers.delete(t); r(); }, ms); me.timers.add(t); });
  const byId = (me, id) => me.actions.find((a) => a.id === id) || null;
  const opts = (me) => ({ filter: me.filter, me: me.me, people: me.farmPeople, today: me.today });

  // the frame: the list at the left and, on a computer, the chosen action (or the form) at the right; the toast and the live region
  function build(me) {
    me.list = el("div", { class: "acts-list" });
    me.addButton = A().canAdd(me.role) ? el("button", { type: "button", class: "acts-btn acts-add", "data-acts": "add", onclick: () => openForm(me, null) }, FP.icon("plus", 18), el("span", {}, W().add)) : null;
    me.seg = el("div", { class: "acts-seg", role: "group", "aria-label": W().show });
    me.whoBtn = el("button", { type: "button", class: "acts-who", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: () => whoMenu(me) });
    me.side = el("aside", { class: "acts-side", "aria-label": "The chosen action" });
    me.toast = el("div", { class: "acts-toast", role: "status", hidden: true });
    me.liveBox = el("p", { class: "acts-live", "aria-live": "polite" });
    me.soundLine = el("p", { class: "acts-sound" });
    const main = el("div", { class: "acts-main" },
      el("div", { class: "acts-head" }, el("h1", { id: "acts-title" }, W().title), me.addButton),
      el("div", { class: "acts-controls" }, me.seg, me.whoBtn),
      me.role === "staff-look" ? el("p", { class: "acts-note-line", "data-acts": "needs-two-factor" }, W().needsTwoFactor) : null,
      me.list, me.soundLine);
    me.article = el("article", { class: "acts", "aria-labelledby": "acts-title" }, main, me.side);
    me.host.replaceChildren(me.article, me.toast, me.liveBox);
  }
  function draw(me) {
    if (!live(me) || !me.list) return;
    const o = opts(me);
    const todoN = A().todoCount(me.actions, o);
    me.seg.replaceChildren(...[["todo", W().todo, todoN], ["done", W().done, null]].map(([k, label, n]) => el("button", { type: "button", "data-tab": k, "aria-pressed": String(me.tab === k),
      onclick: () => { me.tab = k; me.sel = null; if (me.sideKind === "detail") me.sideKind = null; draw(me); } }, label, n != null ? el("span", { class: "acts-n" }, " " + n) : null)));
    const fl = A().filterLabel(me.filter, me.farmPeople, me.me);
    me.whoBtn.replaceChildren(el("span", {}, fl), FP.icon("down", 16));
    me.whoBtn.setAttribute("aria-label", "Whose actions: " + fl);
    const kids = [];
    if (me.tab === "todo") {
      const groups = A().todo(me.actions, o);
      for (const g of groups) kids.push(el("section", { class: "acts-group", "data-group": g.key, "aria-labelledby": "acts-g-" + g.key },
        el("h2", { id: "acts-g-" + g.key }, g.title), el("ul", { class: "acts-rows" }, ...g.items.map((a) => rowNode(me, a)))));
      if (!groups.length) kids.push(empty(me, me.filter !== "everyone" && me.actions.some((a) => A().open(a, me.today)) ? W().emptyMine : W().emptyTodo));
      if (me.filter === "mine") kids.push(el("p", { class: "acts-foot" }, W().mineFoot + " ",
        el("button", { type: "button", class: "acts-link", "data-acts": "everyone", onclick: () => { me.filter = "everyone"; draw(me); } }, W().showEveryone)));
      if (me.more) kids.push(el("p", { class: "acts-quiet" }, "The first 500 to do are shown."));
    } else {
      const d = A().done(me.actions, o);
      kids.push(d.length ? el("section", { class: "acts-group", "data-group": "done", "aria-labelledby": "acts-g-done" }, el("h2", { id: "acts-g-done" }, W().doneHead),
        el("ul", { class: "acts-rows" }, ...d.map((a) => rowNode(me, a)))) : empty(me, W().emptyDone));
    }
    me.list.replaceChildren(...kids);
    const on = soundOn();
    me.soundLine.replaceChildren(on ? W().soundOn : W().soundOff, " · ", el("button", { type: "button", class: "acts-link", "data-acts": "sound", "aria-pressed": String(on),
      onclick: () => { setSound(!on); draw(me); me.soundLine.querySelector("button")?.focus(); } }, on ? W().soundTurnOff : W().soundTurnOn));
    // (the page's one filled button: Add an action, unless the form beside the list has its own Save)
    if (me.addButton) me.addButton.classList.toggle("primary", me.sideKind !== "form");
    drawSide(me);
  }
  function empty(me, text) {
    return el("div", { class: "acts-empty", "data-empty": "" }, el("p", {}, text));
  }
  const CHECK = () => { const s = FP.icon("check", 14); s.classList.add("acts-check"); return s; };
  function initialsOf(me, ids) {
    if (!ids.length) return el("span", { class: "acts-inits", "aria-hidden": "true" }, el("span", { class: "acts-anyone" }, "Anyone"));
    return el("span", { class: "acts-inits", "aria-hidden": "true" }, ...ids.slice(0, 3).map((id) => el("span", {}, A().initials(A().person(me.farmPeople, id)?.name || "?"))));
  }
  function rowNode(me, a) {
    const o = opts(me), back = a.done ? A().backOf(a, me.actions, me.today) : null;
    const bits = A().line(a, { ...o, back });
    const tickable = a.done ? A().canUndo(a, me.role, me.me) : A().canTick(a, me.role, me.me);
    const circle = tickable
      ? el("button", { type: "button", class: "acts-tick", "aria-pressed": String(a.done), "aria-label": (a.done ? "Mark not done: " : "Mark done: ") + a.title,
        onclick: () => (a.done ? untick(me, a.id) : tick(me, a.id)) }, el("span", { class: "acts-c" }, CHECK()))
      : el("span", { class: "acts-tick is-locked", role: "img", "aria-label": a.done ? "Done" : me.role === "staff-look" ? W().lockedTwoFactor : A().whoWords(a.who, me.farmPeople, me.me) + " to tick" }, el("span", { class: "acts-c" }, CHECK()));
    const txt = el("button", { type: "button", class: "acts-txt", "aria-label": A().label(a, { ...o, back }), onclick: () => choose(me, a.id) },
      el("span", { class: "acts-t" }, a.title),
      el("span", { class: "acts-q" }, ...bits.flatMap((b, i) => [i ? " · " : null, b.back ? el("span", { class: "acts-back" }, b.text) : b.text])));
    return el("li", { class: "acts-row" + (a.done ? " done" : "") + (me.sel === a.id && !phone() ? " sel" : ""), "data-id": a.id }, circle, txt, el("span", { class: "acts-end" }, initialsOf(me, a.who)));
  }
  // the person button: Mine, Everyone, or one person (FP.sheet: a sheet on a phone, a popover under the button on a computer)
  function whoMenu(me) {
    const items = A().filterChoices(me.farmPeople, me.me).map((c) => ({ label: c.label, hint: c.hint, current: me.filter === c.key, action: "filter-" + (c.key === "mine" || c.key === "everyone" ? c.key : "person"),
      run: () => { me.filter = c.key; me.sel = null; if (me.sideKind === "detail") me.sideKind = null; draw(me); later(me, () => me.whoBtn.focus(), 0); } }));
    FP.sheet.menu(me.whoBtn, "Whose actions", items, "", "acts-who-menu");
  }

  // ---- the chosen action: the side panel on a computer, a sheet on a phone ------------------------------------------------------------
  function choose(me, id) {
    if (phone()) {
      const a = byId(me, id);
      const node = FP.sheet.open({ title: a?.done ? W().done : W().todo, className: "acts-detail-sheet", opener: me.list.querySelector('.acts-row[data-id="' + CSS.escape(id) + '"] .acts-txt'),
        body: (done) => detailNodes(me, a, done) });
      // (the sheet's own closing button says Close here: "Done" would read as ticking it off)
      const shut = node?.querySelector(".add-cancel");
      if (shut) shut.textContent = W().close;
      return;
    }
    if (me.sideKind === "form") closeForm(me, false);
    me.sel = id; me.sideKind = "detail";
    draw(me);
    const h = me.side.querySelector(".acts-dtitle");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }
  function drawSide(me) {
    if (phone()) { me.side.hidden = true; return; }
    me.side.hidden = false;
    if (me.sideKind === "form" && me.form) { if (!me.side.contains(me.form.node)) me.side.replaceChildren(me.form.node); return; }
    const a = me.sideKind === "detail" && me.sel ? byId(me, me.sel) : null;
    me.side.replaceChildren(...(a ? detailNodes(me, a, null) : [el("p", { class: "acts-quiet acts-pick" }, W().pick)]));
  }
  function detailNodes(me, a, closeSheet) {
    if (!a) return [el("p", { class: "acts-quiet" }, W().pick)];
    const back = A().backOf(a, me.actions, me.today);
    const series = a.seriesId ? me.actions.filter((x) => x.seriesId === a.seriesId && x.done).sort((x, y) => String(y.completedOn).localeCompare(String(x.completedOn))) : a.done ? [a] : [];
    const role = a.who.length === 1 ? A().ROLE_WORDS[A().person(me.farmPeople, a.who[0])?.role] : null;
    const dl = el("dl", { class: "acts-dl" },
      el("dt", {}, "Who"), el("dd", {}, A().whoWords(a.who, me.farmPeople, me.me), role ? el("span", { class: "acts-quiet" }, " (" + role + ")") : null),
      el("dt", {}, "When"), el("dd", {}, A().whenWords(a, me.today)),
      back ? el("dt", {}, "Comes back") : null, back ? el("dd", {}, A().dayWords(back, me.today, { year: true })) : null,
      a.note ? el("dt", {}, "Note") : null, a.note ? el("dd", { class: "acts-note" }, a.note) : null);
    const hist = series.length ? [el("h3", { class: "acts-h3" }, W().done), el("ul", { class: "acts-hist" }, ...series.map((x) => el("li", {},
      el("span", { class: "acts-dot", "aria-hidden": "true" }, CHECK()),
      el("span", {}, A().dayWords(x.completedOn, me.today, { year: true }), el("small", {}, "by " + A().nameOf(me.farmPeople, x.completedBy, me.me))))))] : [];
    const tickIt = A().canTick(a, me.role, me.me) && A().open(a, me.today), change = A().canAdd(me.role) && !a.done;
    const buttons = el("div", { class: "acts-buttons" },
      tickIt ? el("button", { type: "button", class: "acts-btn", "data-acts": "mark-done", onclick: () => { closeSheet?.(); tick(me, a.id); } }, FP.icon("check", 18), el("span", {}, W().markDone)) : null,
      change ? el("button", { type: "button", class: "acts-link", "data-acts": "change", onclick: () => { closeSheet?.(); openForm(me, a.id); } }, W().change) : null);
    // (in a phone's sheet its heading already says To do or Done)
    return [closeSheet ? null : el("p", { class: "acts-quiet acts-state" }, a.done ? W().done : W().todo), el("h2", { class: "acts-dtitle" }, a.title), dl, ...hist, buttons.childElementCount ? buttons : null].filter(Boolean);
  }

  // ---- ticking ------------------------------------------------------------------------------------------------------------------------
  function say(me, text) { me.liveBox.textContent = ""; later(me, () => { me.liveBox.textContent = text; }, 60); }
  function showToast(me, text, undoId = null) {
    clearTimeout(me.toastTimer);
    me.toast.replaceChildren(el("span", {}, text), undoId ? el("button", { type: "button", "data-acts": "undo", onclick: () => { hideToast(me); untick(me, undoId); } }, "Undo") : null);
    me.toast.hidden = false;
    me.toastTimer = later(me, () => hideToast(me), UNDO_MS);
  }
  function hideToast(me) { clearTimeout(me.toastTimer); me.toast.hidden = true; me.toast.replaceChildren(); }
  async function tick(me, id) {
    const a = byId(me, id);
    if (!a || a.done || me.pending.has(id) || !A().canTick(a, me.role, me.me)) return;
    me.pending.add(id);
    ding();
    const sent = Promise.resolve().then(() => me.sb.rpc("action_tick", { action: id })).then((r) => { if (r?.error) throw r.error; return r?.data || {}; });
    sent.catch(() => {});
    const rowEl = me.list.querySelector('.acts-row[data-id="' + CSS.escape(id) + '"]');
    if (rowEl && !reduced()) {
      rowEl.classList.add("ticking");
      await pause(me, 420);
      if (!live(me)) return;
      rowEl.classList.add("leaving");
      await pause(me, 300);
    }
    if (!live(me)) return;
    // to Done at once; put back if the database says no
    Object.assign(a, { done: true, status: "done", completedOn: me.today, completedBy: me.me });
    if (me.sel === id && me.sideKind === "detail") me.sel = id;
    draw(me);
    let r;
    try { r = await sent; } catch {
      me.pending.delete(id);
      if (!live(me)) return;
      Object.assign(a, { done: false, status: "planned", completedOn: null, completedBy: null });
      draw(me);
      const text = root.navigator?.onLine === false ? W().tickOffline : W().tickFailed;
      showToast(me, text); say(me, text);
      return;
    }
    me.pending.delete(id);
    if (!live(me)) return;
    if (r.completed_on) a.completedOn = String(r.completed_on).slice(0, 10);
    let back = null;
    if (r.next?.id) {
      a.seriesId = a.seriesId || a.id;
      back = String(r.next.shows_from).slice(0, 10);
      me.actions.push({ ...a, id: r.next.id, done: false, status: "planned", completedOn: null, completedBy: null, due: String(r.next.due_date).slice(0, 10), showsFrom: back, who: a.who.slice() });
    }
    draw(me);
    showToast(me, A().toast(back, me.today), id);
    say(me, W().ticked(a.title, back ? A().dayWords(back, me.today, { year: true }) : null));
    for (const step of afterTick) { try { step({ farm: me.farm, action: { ...a }, sb: me.sb }); } catch { /* a later step never undoes a tick */ } }
  }
  async function untick(me, id) {
    const a = byId(me, id);
    if (!a || !a.done || me.pending.has(id) || !A().canUndo(a, me.role, me.me)) return;
    me.pending.add(id);
    let r;
    try { r = await Promise.resolve().then(() => me.sb.rpc("action_untick", { action: id })).then((x) => { if (x?.error) throw x.error; return x?.data || {}; }); }
    catch (e) {
      me.pending.delete(id);
      if (!live(me)) return;
      const text = /changed since/i.test(String(e?.message || "")) ? "Its next time has been changed since, so this tick stays." : W().undoFailed;
      showToast(me, text); say(me, text);
      return;
    }
    me.pending.delete(id);
    if (!live(me)) return;
    if (r.removed) me.actions = me.actions.filter((x) => x.id !== r.removed);
    Object.assign(a, { done: false, status: "planned", completedOn: null, completedBy: null });
    hideToast(me);
    draw(me);
    say(me, W().undone(a.title));
    me.list.querySelector('.acts-row[data-id="' + CSS.escape(id) + '"] .acts-tick')?.focus({ preventScroll: true });
  }

  // ---- adding by hand, and changing one -------------------------------------------------------------------------------------------------
  function closeForm(me, refocus = true) {
    const f = me.form;
    if (!f) return;
    f.overlay?.remove();
    me.form = null; me.sideKind = f.editing ? "detail" : null;
    root.document.body.classList.remove("acts-form-open");
    draw(me);
    if (refocus) (f.editing ? me.list.querySelector('.acts-row[data-id="' + CSS.escape(f.editing) + '"] .acts-txt') : me.addButton)?.focus({ preventScroll: true });
  }
  function openForm(me, id) {
    if (!A().canAdd(me.role)) return;
    if (me.form) closeForm(me, false);
    const a = id ? byId(me, id) : null;
    const f = A().formFor(a, { me: me.me, today: me.today });
    const uid = "acts-f";
    const close = () => closeForm(me);
    const title = el("input", { class: "acts-inp", id: uid + "-t", value: f.title, maxlength: "300", autocomplete: "off", placeholder: "For example, send the bore form to ECan", "aria-describedby": uid + "-t-msg" });
    const titleMsg = el("p", { class: "acts-msg", id: uid + "-t-msg" });
    const chips = el("div", { class: "acts-chips", role: "group", "aria-label": "Who" });
    const whoHint = el("p", { class: "acts-hint" });
    const people = A().assignable(me.farmPeople).sort((x, y) => (x.user_id === me.me ? -1 : y.user_id === me.me ? 1 : 0));
    const drawChips = () => {
      chips.replaceChildren(...people.map((p) => el("button", { type: "button", class: "acts-chip", "data-user": p.user_id, "aria-pressed": String(f.who.includes(p.user_id)),
        onclick: (e) => { f.who = f.who.includes(p.user_id) ? f.who.filter((x) => x !== p.user_id) : [...f.who, p.user_id]; drawChips(); chips.querySelector('[data-user="' + CSS.escape(p.user_id) + '"]')?.focus(); } },
        p.user_id === me.me ? "You" : A().shortName(p.name), el("small", {}, A().ROLE_WORDS[p.role] || ""))));
      whoHint.textContent = A().whoHint(f.who.length);
    };
    drawChips();
    const whenSeg = el("div", { class: "acts-seg acts-when", role: "group", "aria-label": "When" });
    const whenBox = el("div", { class: "acts-whenbox" });
    const whenMsg = el("p", { class: "acts-msg" });
    const date = el("input", { class: "acts-inp", type: "date", value: f.date || "", "aria-label": "Due by", onchange: (e) => { f.date = e.target.value; } });
    const every = el("select", { class: "acts-inp", "aria-label": "Every", onchange: (e) => { f.every = e.target.value; drawWhen(); every.focus(); } },
      ...A().EVERY.map((v) => el("option", { value: v, ...(f.every === v ? { selected: true } : {}) }, v)));
    const from = el("input", { class: "acts-inp", type: "date", value: f.from || "", "aria-label": "From", onchange: (e) => { f.from = e.target.value; } });
    const whenText = el("input", { class: "acts-inp", value: f.whenText, maxlength: "200", placeholder: "When the bore is first used", "aria-label": "When it happens", oninput: (e) => { f.whenText = e.target.value; } });
    const drawWhen = () => {
      whenSeg.replaceChildren(...[["date", "On a date"], ["repeat", "Repeats"], ["event", "When…"], ["none", "No date"]].map(([v, l]) => el("button", { type: "button", "data-when": v, "aria-pressed": String(f.when === v),
        onclick: () => { f.when = v; drawWhen(); whenSeg.querySelector('[data-when="' + v + '"]')?.focus(); } }, l)));
      const hint = (t) => el("p", { class: "acts-hint" }, t);
      if (f.when === "date") whenBox.replaceChildren(date);
      else if (f.when === "repeat") whenBox.replaceChildren(el("div", { class: "acts-inline" }, el("span", {}, "Every"), every, el("span", {}, "from"), from), hint(A().repeatHint(f.every)));
      else if (f.when === "event") whenBox.replaceChildren(whenText, hint("For something with no date, that happens when something else does."));
      else whenBox.replaceChildren(hint("It sits under “When it happens, or no date” until it is ticked."));
    };
    drawWhen();
    const note = el("textarea", { class: "acts-inp", id: uid + "-n", rows: "3", maxlength: "2000" }, a?.note || "");
    const save = el("button", { type: "submit", class: "acts-btn primary", "data-acts": "save" }, W().save);
    const cancel = el("button", { type: "button", class: "acts-btn", "data-acts": "cancel", onclick: close }, W().cancel);
    const form = el("form", { class: "acts-form", novalidate: true, "aria-labelledby": uid + "-h" },
      el("div", { class: "acts-form-head" }, el("h2", { id: uid + "-h" }, a ? "Change the action" : W().add),
        el("button", { type: "button", class: "acts-x", "aria-label": W().close, onclick: close }, FP.icon("close", 20))),
      el("div", { class: "acts-field" }, el("label", { for: uid + "-t" }, "What needs doing"), title, titleMsg),
      el("div", { class: "acts-field" }, el("span", { class: "acts-lab" }, "Who"), chips, whoHint),
      el("div", { class: "acts-field" }, el("span", { class: "acts-lab" }, "When"), whenSeg, whenBox, whenMsg),
      el("div", { class: "acts-field" }, el("label", { for: uid + "-n" }, "Note ", el("span", { class: "acts-quiet" }, "(optional)")), note),
      el("div", { class: "acts-form-foot" }, cancel, save));
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      // (a sheet that takes the screen keeps the focus inside it)
      if (e.key !== "Tab" || !me.form?.overlay) return;
      const items = [...form.querySelectorAll("button:not([disabled]), input, select, textarea")].filter((n) => n.getClientRects().length), first = items[0], last = items[items.length - 1];
      if (e.shiftKey && root.document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && root.document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      titleMsg.textContent = whenMsg.textContent = "";
      const out = A().fromForm({ ...f, title: title.value }, me.farmPeople);
      if (!out.ok) {
        (out.problem.field === "title" ? titleMsg : whenMsg).textContent = out.problem.text;
        (out.problem.field === "title" ? title : whenBox.querySelector("input, select"))?.focus();
        return;
      }
      save.disabled = true;
      try {
        const row = { ...out.row, description: note.value.trim() || null };
        const saved = a ? await write(me.sb.from("actions").update(row).eq("id", a.id).select(COLS).single())
          : await write(me.sb.from("actions").insert({ farm_id: me.farm.id, listed: true, ...row }).select(COLS).single());
        const id2 = saved?.id || a?.id;
        const before = a ? a.who : [], add = out.who.filter((x) => !before.includes(x)), drop = before.filter((x) => !out.who.includes(x));
        if (drop.length) await write(me.sb.from("action_people").delete().eq("action_id", id2).in("user_id", drop));
        if (add.length) await write(me.sb.from("action_people").insert(add.map((u) => ({ action_id: id2, farm_id: me.farm.id, user_id: u }))));
        if (!live(me)) return;
        const fresh = A().row({ ...(saved || {}), ...row, id: id2, status: a ? a.status : "planned" }, out.who.map((u) => ({ action_id: id2, user_id: u })));
        if (a) Object.assign(a, { title: fresh.title, note: fresh.note, due: fresh.due, whenText: fresh.whenText, every: fresh.every, who: fresh.who });
        else me.actions.push(fresh);
        me.form.editing = id2; me.sel = id2; me.tab = "todo";
        closeForm(me);
        showToast(me, a ? W().saved : W().added); say(me, (a ? W().saved : W().added) + ": " + fresh.title);
      } catch {
        save.disabled = false;
        whenMsg.textContent = W().saveFailed;
      }
    });
    if (phone()) {
      const overlay = el("div", { class: "acts-overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": uid + "-h" }, form);
      root.document.body.append(overlay);   // (over the farm's header and bar, as a sheet that takes the screen)
      root.document.body.classList.add("acts-form-open");
      me.form = { node: form, overlay, editing: a?.id || null };
    } else {
      me.form = { node: form, editing: a?.id || null };
      me.sideKind = "form";
      draw(me);
    }
    title.focus();
  }
  const write = (q) => Promise.resolve(q).then((r) => { if (r?.error) throw r.error; return r?.data ?? null; });

  // ---- the farm's Home: one quiet line, absent when there is nothing for the person now ------------------------------------------------
  // A promise of { key, text, href } or null
  async function homeLine(farm, { sb = FP.sb, who } = {}) {
    try {
      if (!(await readRole(who))) return null;
      const [t, got] = await Promise.all([today(sb), readList(sb, farm.id)]);
      const me = got.farmPeople.find((p) => p.is_you)?.user_id || null;
      const n = A().nowLine(A().rows(got.actions, got.people), { me, today: t });
      return n ? { key: "actions", text: W().title + " · " + W().homeLine(n.count), href: FP.href(FP.farmModel.href(farm.id, "actions")) } : null;
    } catch { return null; }
  }

  // (for the browser walk: what the screen shows)
  function state() {
    const me = shown;
    return me ? { tab: me.tab, filter: me.filter, sel: me.sel, side: me.sideKind || null, role: me.role, me: me.me, count: me.actions.length, sound: soundOn(), toast: me.toast && !me.toast.hidden ? me.toast.textContent : null } : null;
  }
  FP.farmActions = { open, close, add, homeLine, readList, state, ding, soundOn, setSound, onTicked: (fn) => { if (typeof fn === "function") afterTick.push(fn); } };
})(typeof window === "undefined" ? globalThis : window);
