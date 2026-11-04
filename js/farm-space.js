// The farm space: header, map with its standing answers, and Ask, Create, Documents. Reads only, except People
// (owners and admins add, change and remove people; the farm_members policies decide what is allowed).
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./farm-model.js") : root.FP.farmModel);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmSpace = api;
})(typeof window === "undefined" ? globalThis : window, function (M) {
  async function read(query) { const { data, error } = await query; if (error) throw error; return data; }
  // Tiers (F1e) and who chose one (B3's tiered_at) are read when the database has them. relates_to is read through
  // document_relations, which withholds a relationship whose other end the reader can't see. context.documentTiers
  // says what the database holds, so the view offers only what it can save: "chosen" (tier and tiered_at), "tiers" (F1e only)
  // or "none" (F1e not deployed yet: no tier is read, documents go by docClass, nothing is added or moved, no error).
  // It is learnt once per client (page), so a database without the columns costs one refused read, not one per farm.
  const learnt = new WeakMap();
  const DOCUMENT_COLUMNS = "id,title,doc_type,author,author_org,date_prepared,period_start,period_end,page_count,storage_path,original_name,sha256,status,created_at,model,model_version";
  const TIER_COLUMNS = { chosen: ",tier,tiered_at", tiers: ",tier", none: "" };
  const missingColumn = (e) => e && (e.code === "42703" || e.code === "PGRST204" || /column|tier/i.test(e.message || ""));
  async function readDocuments(sb, farm) {
    const query = (columns) => sb.from("documents").select(DOCUMENT_COLUMNS + columns).eq("farm_id", farm.id).order("title");
    let rows = null;
    for (const level of learnt.has(sb) ? [learnt.get(sb)] : ["chosen", "tiers", "none"]) {
      const { data, error } = await query(TIER_COLUMNS[level]);
      if (!error) { rows = data; learnt.set(sb, level); break; }
      if (!missingColumn(error) || level === "none") throw error;
    }
    if (learnt.get(sb) === "none" || !rows.length) return rows;
    const { data: relations, error } = await sb.from("document_relations").select("id,relates_to").in("id", rows.map((d) => d.id));
    const parent = new Map((error ? [] : relations || []).map((r) => [r.id, r.relates_to]));
    return rows.map((d) => ({ ...d, relates_to: parent.get(d.id) ?? null }));
  }
  const nzToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  const optional = (query) => Promise.resolve(query).then((r) => (r.error ? [] : r.data || []), () => []);
  // What's due's own record-keeping (E5): conditions marked done (a met check nothing has superseded) and records (an
  // entry linking a condition to a document). Optional: if either can't be read, the conditions read as before.
  const readChecks = (sb, farm) => optional(sb.from("checks").select("id,obligation_id,status,created_at,superseded_at").eq("farm_id", farm.id))
    .then((rows) => rows.filter((c) => c.obligation_id && c.status === "met" && !c.superseded_at));
  const readRecords = (sb, farm) => optional(sb.from("entry_links").select("entry_id,obligation_id,document_id").eq("farm_id", farm.id)).then(M.recordLinks);
  // Everything a farm space shows, in one round of caller-scoped reads (row-level security decides what comes back).
  const SOURCE_COLUMNS = "key,name,theme,provider,licence,attribution,summary,refreshed_at,effective_from,feature_count,coverage,serve_to_customers";
  async function load(sb, farm, user) {
    const [member, org, maps, documents, authorisations, obligations, today, checks, records, notes, holding, sources] = await Promise.all([
      read(sb.from("farm_members").select("role").eq("farm_id", farm.id).eq("user_id", user.id).single()),
      read(sb.from("org_members").select("role").eq("org_id", farm.org_id).eq("user_id", user.id).maybeSingle()),
      read(sb.rpc("farm_map", { f: farm.id })),
      readDocuments(sb, farm),
      read(sb.from("authorisations").select("id,kind,title,consent_no,rule_ref,valid_from,valid_to,created_at").eq("farm_id", farm.id).order("title")),
      // Optional: if the dates can't be read, "What's due" says so rather than claiming nothing is due.
      Promise.resolve(sb.from("obligations").select("id,authorisation_id,code,summary,full_text,kind,parameters,due_date,recurrence,source_document_id,source_page").eq("farm_id", farm.id)).then((r) => r, (e) => ({ error: e })),
      sb.today ? sb.today() : nzToday(),
      readChecks(sb, farm), readRecords(sb, farm),
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
    if (!maps) throw Error("This farm isn't shared with your login.");
    const farmed = M.farmedAreaLayer(holding);
    if (farmed) maps.layers = [...(maps.layers || []), farmed];
    maps.sources = sources;   // the reference_sources rows, for the provenance lines in popups and the Sources list
    maps.layer_notes = notes; maps.viewer = user.id;   // the notes, and who is reading them (a note says "you" for its own writer)
    const advisor = ["owner", "admin", "edit"].includes(member.role) && ["admin", "advisor", "facilitator"].includes(org?.role);
    // Who the answers are curated for: the farm's own people read them as a farmer, an advisor as an advisor.
    return { farm, user, role: member.role, orgRole: org?.role || null, advisor, audience: advisor ? "advisor" : "farmer", maps, documents, authorisations, today, documentTiers: learnt.get(sb) || "none",
      obligations: obligations.error ? [] : obligations.data || [], obligationsError: !!obligations.error, checks, records };
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
  // Ask (the farm's Ask function): the layer set its answer brought up (until the view changes), and the last answer on
  // this farm, kept so the Ask tab shows it again after a source or the plan was opened.
  let askSet = null, lastAsk = null, askToken = 0;
  const unmount = (...handles) => { for (const h of handles.flat()) h?.destroy(); };
  // Each answer is an Answer block in its own host, so the space never writes answer HTML itself.
  function answer(host, model, options) {
    const node = el("div", { class: "block-host" });
    host.append(node);
    return FP.blocks.render(node, { block: "answer", owner: { farm: context.farm.id }, options }, { read: () => model, level: 2, href: FP.href });
  }
  const $ = (s) => FP.$(s), el = (...a) => FP.el(...a);
  function close() {
    FP.addBlock?.close(false);
    document.body.classList.remove("farm-space-active", "farm-detail", "portfolio-active");
    flushDone();   // a Done still inside its Undo window is written before the farm is left (#258)
    $("#portfolio")?.setAttribute("hidden", ""); token++; context = null; pending = null; openedMap = null;
    unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
    wq?.destroy(); wq = null;
    layerEntries = []; focusPlace = null; photoShown = false; handSet = new Map(); askSet = null; lastAsk = null; pendingAsk = null; proposals.clear();
    $("#farm-space-header")?.setAttribute("hidden", "");
    document.documentElement.style.setProperty("--sheet-overlap", "0px"); framedOverlap = 0;
  }
  function setPortfolio(farms, person) { portfolio = farms; user = person; init(); }
  function init() {
    if ($("#farm-space-header")) return;
    const h = el("header", { id: "farm-space-header", hidden: true });
    // Phone: row one is the farm and one account button, row two the three things to do. The person, the farm
    // switcher, People, Operations and Sign out sit behind the button; on a wide screen they stay in the row.
    h.innerHTML = '<div class="farm-header-row"><h1><a id="space-farm-name" href="#"></a></h1>' +
      '<button type="button" id="account-open" class="account-open" aria-haspopup="true" aria-expanded="false" aria-controls="account-menu" aria-label="Account and people"><span id="account-initials" aria-hidden="true"></span></button>' +
      '<div id="account-menu" class="account-menu"><label class="farm-switch-label">Farm<select id="farm-switch"></select></label>' +
      '<span class="farm-links"><a id="space-people" class="link" hidden>People</a><a id="space-layers" class="link" hidden>Layer notes</a><a id="space-ops" class="link ops-link" hidden>Operations</a></span><span id="space-person"></span><button class="link" id="space-signout">Sign out</button></div></div>' +
      '<nav id="farm-actions" aria-label="Farm"></nav>';
    document.body.prepend(h);
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
    const choose = (id, open) => {
      const place = id && standing.find((m) => m.places?.[id])?.places[id];
      if (!place) return false;
      const next = open ? id : focused === id ? null : focused;
      if (next === focused) return true;
      if (!FP.farmMap.focus(next ? place : null)) return true;   // nothing on this map for it: say nothing, move nothing
      focused = next; focusPlace = next ? place : null;
      applyScene(); markFocused();
      return true;
    };
    // toggle doesn't bubble: listen as it passes down
    $("#overview-cards").addEventListener("toggle", (e) => {
      const fold = e.target;
      if (!fold.matches?.("details.checklist-fold")) return;
      const id = fold.closest("[data-item-id]")?.dataset.itemId;
      const stillOpen = $("#overview-cards").querySelectorAll('[data-item-id="' + CSS.escape(id || "") + '"] details.checklist-fold[open]').length > 0;
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
      button.disabled = true;
      const { data, error } = await FP.sb.storage.from("documents").createSignedUrl(doc.storage_path, 3600);
      button.disabled = false;
      if (error || !data?.signedUrl) { button.textContent = "Couldn't open it"; return; }
      window.open(data.signedUrl, "_blank", "noopener");
      // the document opened is the one selected: the map follows it (the plan brings the FEP's layers)
      if (shownRoute?.view === "documents" && shownRoute.item !== doc.id) location.replace(FP.href(M.href(context.farm.id, "documents", doc.id)));
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
    let target = id ? M.href(id, "map") : "";
    try { if (id) target = sessionStorage.getItem("fp-view-" + user.id + "-" + id) || target; } catch {}
    return target;
  }
  // Portfolio: every farm with its one sentence, and a map of them all (the NZ -> farm zoom starts here).
  async function showPortfolio() {
    const current = ++token, rows = portfolio.map((farm) => ({ farm, line: "", extent: null }));
    flushDone();
    context = null; pending = null; openedMap = null;
    unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
    wq?.destroy(); wq = null;
    document.body.classList.remove("farm-space-active", "farm-detail");
    document.body.classList.add("portfolio-active");
    $("#farm-space-header")?.setAttribute("hidden", "");
    document.documentElement.style.setProperty("--sheet-overlap", "0px"); framedOverlap = 0;
    for (const id of ["#space-content", "#overview-rail", "#layers-drawer", "#map-msg"]) $(id).hidden = true;
    document.title = "Farms | " + FP.brand?.product;
    FP.show("screen-map");
    $("#portfolio").hidden = false;
    const select = (row) => { if (row.extent) FP.farmMap.zoomTo(row.extent); location.hash = FP.href(farmTarget(row.farm.id)); };
    const items = rows.map((row) => {
      row.node = el("li", {}, el("button", { type: "button", onclick: () => select(row) }, el("b", {}, row.farm.name),
        row.farm.region ? el("small", {}, row.farm.region[0].toUpperCase() + row.farm.region.slice(1)) : null, el("span", {})));
      return row.node;
    });
    $("#portfolio-list").replaceChildren(...items);
    let found;
    try { found = new Map((await summaries(FP.sb)).map((r) => [r.id, r])); } catch { found = new Map(); }
    if (current !== token) return;
    for (const row of rows) {
      const summary = found.get(row.farm.id);
      row.line = summary ? M.summaryLine(summary) : "Couldn't read this farm.";
      row.extent = summary?.extent || null;
      row.node.querySelector("span").textContent = row.line;
    }
    await FP.farmMap.portfolio(rows.map((r) => ({ id: r.farm.id, name: r.farm.name, extent: r.extent })), (id) => select(rows.find((r) => r.farm.id === id)));
  }
  function header(farm, route) {
    $("#farm-space-header").hidden = false;
    const name = $("#space-farm-name");
    name.textContent = farm.name; name.href = FP.href(M.href(farm.id, "map"));
    if (route.view === "map") name.setAttribute("aria-current", "page"); else name.removeAttribute("aria-current");
    const person = FP.demo?.active ? (context.advisor ? "Demo advisor" : "Demo farmer") : user.user_metadata?.display_name || user.email;
    $("#space-person").textContent = person;
    $("#account-initials").textContent = M.initials(FP.demo?.active ? person : user.user_metadata?.display_name, user.email);
    const select = $("#farm-switch");
    select.replaceChildren(el("option", { value: "" }, "All farms"), ...portfolio.map((f) => el("option", { value: f.id }, f.name)));
    select.value = farm.id;
    $(".farm-switch-label").style.display = portfolio.length < 2 ? "none" : "";
    // The home view is the first tab, so from Ask, Create or Documents the way back is a tab, not a guess at the title.
    $("#farm-actions").replaceChildren(...[["map", "What's due"], ...M.views].map(([key, label]) => el("a", { href: FP.href(M.href(farm.id, key)), ...(route.view === key ? { "aria-current": "page" } : {}) }, label)));
    $("#space-signout").textContent = FP.demo?.active ? "Exit demo" : "Sign out";
    const people = $("#space-people");
    people.hidden = !M.canManage(context.role); people.href = FP.href(M.href(farm.id, "people"));
    // Layer notes (LN2): offered to the farm's editors and to the advisors of the organisation that services it, never to a viewer.
    const layerNotes = $("#space-layers");
    layerNotes.hidden = !FP.layerNotes?.offersNotes({ farmRole: context.role, orgRole: context.orgRole }); layerNotes.href = FP.href("#/layers");
    if (route.view === "people") people.setAttribute("aria-current", "page"); else people.removeAttribute("aria-current");
    $("#account-open").toggleAttribute("data-current", route.view === "people");
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
  const QUIET = ["extent", "photos"];   // the boundary; photo pins curated by zoom (photo-model.js pinsShown)
  const FEP_LAYERS = ["extent", "land_units", "contaminant_sources", "plantings", "proposed_actions", "line_features"];
  // The reference row that governs a place's theme: Rivers (the shared waterways layer, DM2) for waterways, bores for
  // wells; wetlands has none yet.
  const GOVERNS = { waterways: ["rivers"], wells: ["ecan-wells"] };
  // The layer sets an answer in Ask can bring up (the action list's map.layers): water is the rivers and bores.
  const ASK_SETS = { quiet: [], fep: FEP_LAYERS, photos: ["photos"], water: ["waterways", ...GOVERNS.waterways, ...GOVERNS.wells], consents: ["consents", "ecan-consents"] };
  const mapKeys = (m) => ["extent", "titles", ...(m?.layers || []).map((l) => l.theme), ...(m?.reference || []).map((r, i) => r.key || "reference-" + i), "rivers"];
  function sceneFor(view, focus, context) {
    const on = new Set(globalThis.FP_CONFIG?.farmView?.defaultOn || QUIET), f = focus || {}, v = view || {};
    if (v.view === "documents" && v.item) {
      const doc = (context?.documents || []).find((d) => String(d.id) === String(v.item));
      if (doc && M.isPlan(doc)) for (const k of FEP_LAYERS) on.add(k);
    }
    if (f.place) {
      if ((f.place.land_units || []).length) on.add("land_units");
      for (const theme of f.place.themes || []) { on.add(theme); for (const k of GOVERNS[theme] || []) on.add(k); }
      for (const k of f.place.layers || []) on.add(k);
    }
    if (f.photo) on.add("photos");
    // an answer in Ask brings the set it names (all: every layer the farm's map has)
    for (const k of f.set === "all" ? mapKeys(context?.maps) : ASK_SETS[f.set] || []) on.add(k);
    return on;
  }
  // Every row as the scene says, unless the person set it by hand; the drawer's switches follow.
  function applyScene() {
    if (!context || !layerEntries.length) return;
    const want = sceneFor(shownRoute, { place: focusPlace, photo: photoShown, set: askSet }, context);
    for (const e of layerEntries) {
      const on = handSet.has(e.key) ? handSet.get(e.key) : want.has(e.key);
      if (e.on !== on) FP.farmMap.setVisible(e, on);
      if (e.input) e.input.checked = on;
      if (e.pastInput) e.pastInput.closest("label").hidden = !on;
    }
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
  }
  // The drawer's Farm and Reference lists: a plain name (with its area for the boundary and titles) and a switch;
  // where a layer came from is in its features' popups. Layers made for a job sit together under one heading.
  function renderLayers(entries) {
    layerEntries = entries;
    const row = (e) => {
      e.input = el("input", { type: "checkbox", role: "switch", checked: e.on, onchange: (ev) => setLayer(e.key, ev.target.checked) });
      e.pastInput = e.past ? el("input", { type: "checkbox", role: "switch", checked: e.past.on, onchange: (ev) => FP.farmMap.setPast(e, ev.target.checked) }) : null;
      const past = e.past ? el("label", { class: "layer-past", ...(e.on ? {} : { hidden: true }) }, e.pastInput, el("span", {}, "Past consents")) : null;
      return el("li", {}, el("label", {}, e.input, el("span", {}, el("b", {}, e.name), e.sub ? el("small", {}, e.sub) : null)), past);
    };
    const children = [];
    for (const [section, heading] of [["farm", "Farm"], ["reference", "Reference"]]) {
      const own = entries.filter((e) => e.section === section);
      if (!own.length) continue;
      children.push(el("li", { class: "group", "data-layer-section": section }, heading), ...own.filter((e) => !e.job).map(row));
      const jobs = new Map();
      for (const e of own.filter((e) => e.job)) { if (!jobs.has(e.job.id)) jobs.set(e.job.id, { job: e.job, entries: [] }); jobs.get(e.job.id).entries.push(e); }
      for (const { job, entries: es } of jobs.values()) children.push(el("li", { class: "group job" }, M.jobHeading(job)), ...es.map(row));
    }
    $("#layer-list").replaceChildren(...children);
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
    const keys = [...(context.maps?.reference || []).map((r) => r.key), ...held.keys];
    const node = FP.provenance.section(context.maps?.sources, { keys, loadedKeys: held.loadedKeys, asAt: held.asAt, region: context.farm?.region || context.maps?.farm?.region });
    if (node && open) node.open = true;
    slot.replaceChildren(...(node ? [node] : []));
  }
  // A layer set by hand (its switch in the drawer, or "Show <layer>" from the command bar): it stays as set (E5).
  function setLayer(key, on) {
    handSet.set(key, on);
    for (const x of layerEntries.filter((x) => x.key === key)) {
      FP.farmMap.setVisible(x, on);
      if (x.input) x.input.checked = on;
      if (x.pastInput) x.pastInput.closest("label").hidden = !on;
    }
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
    const place = () => { if (wideQ.matches) $("#farm-space-header h1").after(form); else $("#screen-map").append(form); };
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
        const kept = new Map(handSet);
        context = null; openedMap = null;
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
  let documentsNotice = null;
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
    return { destroy: () => { gone = true; node.onclick = node.onsubmit = null; } };
  }
  function documentsView(host, item) {
    const sentence = el("div", { class: "block-host" }), list = el("div", { class: "block-host documents-host" });
    const onboarding = el("p", { class: "documents-onboarding" }, el("a", { href: FP.href(M.href(context.farm.id, "onboarding")) }, "Onboarding checklist"),
      " · what the platform holds for this farm and what needs a person");
    const wrap = el("section", { class: "documents-view", "data-view": "documents" }, sentence, onboarding, list);
    host.append(wrap);
    const farm = context.farm.id, handles = [];
    const data = () => ({ documents: context.documents, canEdit: editor(), canAdd: editor(), notice: documentsNotice });
    handles.push(FP.blocks.render(sentence, { block: "answer", owner: { farm }, options: { compact: true } }, { read: () => M.documents(context, FP.documentsBlock.arrange(context.documents)), level: 2, href: FP.href }));
    if (context.documents.length || editor())
      handles.push(FP.blocks.render(list, { block: "documents", owner: { farm }, options: { selected: item || null } },
        { read: () => { const d = data(); documentsNotice = null; return d; }, level: 3, nested: true, href: FP.href, store: documentStore(farm, () => handles) }));
    return { destroy: () => unmount(handles) };
  }
  // Upload, register and move, as the signed-in person: storage and documents policies decide (F1e, B3).
  function documentStore(farm, handles) {
    const D = FP.documentsBlock;
    return {
      async add({ file, title, doc_type, tier, relates_to, visibility }) {
        const bytes = await file.arrayBuffer(), sha = await D.sha256Hex(bytes);
        const same = context.documents.find((d) => d.sha256 === sha);
        if (same) throw Error("already here as " + M.docTitle(same));
        const path = D.storagePath(farm, sha, file.name), mime = file.type || "application/octet-stream";
        const up = await FP.sb.storage.from("documents").upload(path, file, { contentType: mime, upsert: false });
        // The same bytes uploaded before but never described: describe them now (the database checks they are yours).
        if (up.error && !/exist|duplicate|409/i.test(String(up.error.message || "") + (up.error.statusCode || ""))) throw up.error;
        const { data, error } = await FP.sb.from("documents").insert({ farm_id: farm, title, doc_type, original_name: file.name, mime_type: mime,
          sha256: sha, size_bytes: file.size, storage_path: path, tier, relates_to: relates_to || null, tiered_at: new Date().toISOString(),
          ...(visibility === "private" ? { visibility } : {}) }).select("id").single();
        if (error) throw error;
        return data.id;
      },
      async move(id, change) {
        const { data, error } = await FP.sb.from("documents").update({ ...change, tiered_at: new Date().toISOString() }).eq("id", id).select("id");
        if (error) throw error;
        if (!data?.length) throw Error("That change wasn't allowed.");
      },
      // Read the farm's documents again and redraw, with one line saying what happened.
      async changed(notice) {
        if (context?.farm.id !== farm) return;
        context.documents = await readDocuments(FP.sb, context.farm);
        documentsNotice = notice || null;
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
    if (kind === "layer") return (ctx?.maps?.reference || []).some((r) => r.key === v) ? { land_units: [], themes: [], layers: [v] } : { land_units: [], themes: [v] };
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
    else if (!frame || !FP.farmMap.focus(frame)) { focusPlace = null; FP.farmMap.focus(null); }
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
    // Water-quality results from a spreadsheet (the farm's own, or a group's the person edits): upload, check, confirm.
    if (canChange() && FP.wqImport) {
      const open = el("button", { type: "button", class: "wq-open" }, "Import water-quality results");
      open.addEventListener("click", () => { open.remove(); FP.wqImport.mount(view, { sb: FP.sb, farm: context.farm, el, documentsBlock: FP.documentsBlock }); });
      view.append(open);
    }
    return view;
  }
  async function open(farm, route) {
    flushDone();   // going to another view (or farm) writes any Done still inside its Undo window (#258)
    const current = ++token;
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    setDrawer(false);
    $("#space-handle-label").textContent = M.viewLabel(route.view) || "";
    setSheet("due", "peek", false); setSheet("space", "open", false);
    FP.farmMap.closePopup?.();   // UI1: a feature popup belongs to the view it was opened in
    if (context?.farm.id !== farm.id) {
      context = null; openedMap = null;
      unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
      wq?.destroy(); wq = null;
      layerEntries = []; handSet = new Map();
      $("#space-body").replaceChildren(); $("#overview-cards").replaceChildren(); $("#overview-peek").textContent = "";
      pending = load(FP.sb, farm, user);
    }
    FP.show("screen-map");
    document.body.classList.toggle("farm-detail", route.view !== "map");
    $("#space-content").hidden = route.view === "map";
    $("#overview-rail").hidden = route.view !== "map";
    $("#map-msg").hidden = false; $("#map-msg").textContent = "Loading the farm…";
    try {
      const loaded = context || await pending;
      if (current !== token) return;
      context = loaded;
      header(farm, route); reserveHeader();
      document.title = farm.name + (route.view === "map" ? "" : " · " + M.viewLabel(route.view)) + " | " + FP.brand?.product;
      try { sessionStorage.setItem("fp-view-" + user.id + "-" + farm.id, M.href(farm.id, route.view)); } catch {}
      if (openedMap !== farm.id) {
        // A sheet that opens with the view (Ask, Create, Documents) covers part of the map: the first fly lands clear of it.
        framedOverlap = measureSheet();
        // The Map scene block draws the farm on the space's one map (FP.farmMap), so the NZ -> farm zoom carries on.
        unmount(scene);
        scene = FP.blocks.render($("#farm-scene"), { block: "map-scene", owner: { farm: farm.id } }, { read: () => context.maps, surface: FP.farmMap, level: 2 });
        const drawn = await scene.ready;
        if (current !== token) return;
        if (!drawn) throw Error("Map unavailable for this farm.");
        renderLayers(drawn.entries); renderSources(); openedMap = farm.id;
        addLayersControl(); commandBar();
      }
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
    } catch (e) { if (current === token) { $("#map-msg").hidden = false; $("#map-msg").textContent = "Couldn't load the farm: " + (e.message || e); } }
  }
  return { load, summaries, setPortfolio, showPortfolio, close, open, sceneFor, askPlace, openBlock };
});
