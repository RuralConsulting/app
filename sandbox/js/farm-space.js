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
  const DOCUMENT_COLUMNS = "id,title,doc_type,author,author_org,date_prepared,page_count,storage_path,original_name,sha256,status,created_at";
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
  // Everything a farm space shows, in one round of caller-scoped reads (row-level security decides what comes back).
  async function load(sb, farm, user) {
    const [member, org, maps, documents, authorisations, obligations, today] = await Promise.all([
      read(sb.from("farm_members").select("role").eq("farm_id", farm.id).eq("user_id", user.id).single()),
      read(sb.from("org_members").select("role").eq("org_id", farm.org_id).eq("user_id", user.id).maybeSingle()),
      read(sb.rpc("farm_map", { f: farm.id })),
      readDocuments(sb, farm),
      read(sb.from("authorisations").select("id,kind,title,consent_no,rule_ref,valid_from,valid_to,created_at").eq("farm_id", farm.id).order("title")),
      // Optional: if the dates can't be read, "What's due" says so rather than claiming nothing is due.
      Promise.resolve(sb.from("obligations").select("id,authorisation_id,code,summary,full_text,kind,parameters,due_date,recurrence,source_document_id,source_page").eq("farm_id", farm.id)).then((r) => r, (e) => ({ error: e })),
      sb.today ? sb.today() : nzToday(),
    ]);
    if (!maps) throw Error("This farm isn't shared with your login.");
    const advisor = ["owner", "admin", "edit"].includes(member.role) && ["admin", "advisor", "facilitator"].includes(org?.role);
    // Who the answers are curated for: the farm's own people read them as a farmer, an advisor as an advisor.
    return { farm, user, role: member.role, advisor, audience: advisor ? "advisor" : "farmer", maps, documents, authorisations, today, documentTiers: learnt.get(sb) || "none",
      obligations: obligations.error ? [] : obligations.data || [], obligationsError: !!obligations.error };
  }
  // The light portfolio read (0038): one caller-scoped row per farm, in one request. A farm's full record is
  // read (load) only when that farm is opened.
  const summaries = (sb) => read(sb.from("farm_summaries").select("*"));

  let portfolio = [], user = null, context = null, pending = null, token = 0, openedMap = null, framedOverlap = 0, reserveHeader = () => {};
  // The blocks this space has mounted (docs/BUILDING-BLOCKS.md §2): the map scene, the standing answers, the open view.
  let scene = null, answers = [], view = null;
  // The standing answers' models, and the What's due line whose place the map is framed on (null: the farm).
  let standing = [], focused = null;
  const unmount = (...handles) => { for (const h of handles.flat()) h?.destroy(); };
  // Each answer is an Answer block in its own host, so the space never writes answer HTML itself.
  function answer(host, model, options) {
    const node = el("div", { class: "block-host" });
    host.append(node);
    return FP.blocks.render(node, { block: "answer", owner: { farm: context.farm.id }, options }, { read: () => model, level: 2, href: FP.href });
  }
  const $ = (s) => FP.$(s), el = (...a) => FP.el(...a);
  function close() {
    document.body.classList.remove("farm-space-active", "farm-detail", "portfolio-active");
    $("#portfolio")?.setAttribute("hidden", ""); token++; context = null; pending = null; openedMap = null;
    unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
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
      '<span class="farm-links"><a id="space-people" class="link" hidden>People</a><a id="space-ops" class="link ops-link" hidden>Operations</a><button type="button" id="more-open" class="link" aria-controls="layers-drawer" aria-expanded="false">More</button></span><span id="space-person"></span><button class="link" id="space-signout">Sign out</button></div></div>' +
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
    window.addEventListener("resize", () => { measureSheet(); });
    $("#farm-switch").addEventListener("change", (e) => { location.hash = FP.href(farmTarget(e.target.value)); });
    $("#space-signout").addEventListener("click", async () => {
      if (FP.demo?.active) location.href = location.pathname + location.search;
      else { await FP.auth.signOut(); location.hash = ""; location.reload(); }
    });
    // The phone sheets (What's due, and Ask, Create and Documents) open over the map: the farm is re-framed in
    // what stays visible above them, and back again when they close.
    $("#overview-toggle").addEventListener("click", () => {
      const rail = $("#overview-rail"), expanded = rail.classList.toggle("expanded");
      $("#overview-toggle").setAttribute("aria-expanded", String(expanded));
      settleFrame();
    });
    $("#space-handle").addEventListener("click", () => {
      const peeked = $("#space-content").classList.toggle("peeked");
      $("#space-handle").setAttribute("aria-expanded", String(!peeked));
      settleFrame();
    });
    $("#more-open").addEventListener("click", () => { $("#layers-drawer").hidden = false; $("#more-open").setAttribute("aria-expanded", "true"); $("#layers-close").focus(); });
    $("#layers-close").addEventListener("click", () => { $("#layers-drawer").hidden = true; $("#more-open").setAttribute("aria-expanded", "false"); $("#more-open").focus(); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if ($("#account-menu").classList.contains("open")) { $("#account-menu").classList.remove("open"); $("#account-open").setAttribute("aria-expanded", "false"); $("#account-open").focus(); }
      $("#layers-drawer").hidden = true; $("#more-open").setAttribute("aria-expanded", "false");
      $("#overview-rail").classList.remove("expanded"); $("#overview-toggle").setAttribute("aria-expanded", "false");
      settleFrame();
    });
    // Choosing a What's due line whose condition records a place frames the map on it and marks it; choosing it
    // again goes back to the farm. A line with no place moves nothing and claims nothing.
    $("#overview-cards").addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      const id = e.target.closest("[data-item-id]")?.dataset.itemId, place = id && standing.find((m) => m.places?.[id])?.places[id];
      if (!place) return;
      const again = focused === id;
      if (!FP.farmMap.focus(again ? null : place)) return;
      focused = again ? null : id;
      markFocused();
    });
    $("#space-content").addEventListener("click", async (e) => {
      const button = e.target.closest("[data-open-document]");
      const doc = button && context?.documents.find((d) => d.id === button.dataset.openDocument);
      if (!doc?.storage_path) return;
      button.disabled = true;
      const { data, error } = await FP.sb.storage.from("documents").createSignedUrl(doc.storage_path, 3600);
      button.disabled = false;
      if (error || !data?.signedUrl) { button.textContent = "Couldn't open it"; return; }
      window.open(data.signedUrl, "_blank", "noopener");
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
      $("#ask-answer").replaceChildren(el("p", { class: "ask-question" }, question), el("p", { class: "answer-sentence" }, "Questions can't be answered here yet."));
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
  // Phone: how far the open sheet covers the map (--sheet-overlap, read by the map when it frames the farm).
  function measureSheet() {
    let overlap = 0;
    const sheet = window.innerWidth <= 800 && [$("#space-content"), $("#overview-rail")].find((n) => !n.hidden);
    if (sheet) overlap = M.sheetOverlap($("#map").getBoundingClientRect().bottom, sheet.getBoundingClientRect().top);
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
    context = null; pending = null; openedMap = null;
    unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
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
    $("#farm-actions").replaceChildren(...M.views.map(([key, label]) => el("a", { href: FP.href(M.href(farm.id, key)), ...(route.view === key ? { "aria-current": "page" } : {}) }, label)));
    $("#space-signout").textContent = FP.demo?.active ? "Exit demo" : "Sign out";
    const people = $("#space-people");
    people.hidden = !M.canManage(context.role); people.href = FP.href(M.href(farm.id, "people"));
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
    const section = el("section", { class: "space-view people-view", "data-view": "people" }, el("h2", {}, "People"));
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
  // The drawer's Farm and Reference lists: a plain name, the line saying where it came from, and a switch. Layers
  // made for a job sit together under one sentence-case heading.
  function renderLayers(entries) {
    const row = (e) => el("li", {}, el("label", {}, el("input", { type: "checkbox", role: "switch", checked: e.on, onchange: (ev) => FP.farmMap.setVisible(e, ev.target.checked) }),
      el("span", {}, el("b", {}, e.name), e.sub ? el("small", {}, e.sub) : null)));
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
  // ---- Documents (B3): the sentence, then the Documents block; editors add documents and move them between tiers --
  const editor = () => ["owner", "admin", "edit"].includes(context?.role) && context.documentTiers === "chosen";
  let documentsNotice = null;
  function documentsView(host, item) {
    const sentence = el("div", { class: "block-host" }), list = el("div", { class: "block-host documents-host" });
    const wrap = el("section", { class: "documents-view", "data-view": "documents" }, sentence, list);
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
      async add({ file, title, doc_type, tier, relates_to }) {
        const bytes = await file.arrayBuffer(), sha = await D.sha256Hex(bytes);
        const same = context.documents.find((d) => d.sha256 === sha);
        if (same) throw Error("already here as " + M.docTitle(same));
        const path = D.storagePath(farm, sha, file.name), mime = file.type || "application/octet-stream";
        const up = await FP.sb.storage.from("documents").upload(path, file, { contentType: mime, upsert: false });
        // The same bytes uploaded before but never described: describe them now (the database checks they are yours).
        if (up.error && !/exist|duplicate|409/i.test(String(up.error.message || "") + (up.error.statusCode || ""))) throw up.error;
        const { data, error } = await FP.sb.from("documents").insert({ farm_id: farm, title, doc_type, original_name: file.name, mime_type: mime,
          sha256: sha, size_bytes: file.size, storage_path: path, tier, relates_to: relates_to || null, tiered_at: new Date().toISOString() }).select("id").single();
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
  function askView() {
    const form = el("form", { id: "ask-form", class: "ask-form" },
      el("label", { for: "ask-input", class: "visually-hidden" }, "Question"),
      el("textarea", { id: "ask-input", rows: "3", autocomplete: "off", enterkeyhint: "send", placeholder: "When is the next audit due?" }),
      el("button", { type: "submit" }, "Ask"));
    return el("section", { class: "space-view", "data-view": "ask" }, el("h2", {}, "Ask"), form, el("div", { id: "ask-answer", class: "ask-answer", "aria-live": "polite" }));
  }
  function createView() {
    return el("section", { class: "space-view", "data-view": "create" }, el("h2", {}, "Create"),
      el("p", {}, "These can't be made here yet."),
      el("ul", { class: "output-list" }, ...M.outputs.map(([key, label]) => el("li", { "data-output": key }, el("span", {}, label)))));
  }
  async function open(farm, route) {
    const current = ++token;
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    $("#layers-drawer").hidden = true; $("#more-open").setAttribute("aria-expanded", "false");
    $("#overview-rail").classList.remove("expanded"); $("#overview-toggle").setAttribute("aria-expanded", "false");
    $("#space-content").classList.remove("peeked"); $("#space-handle").setAttribute("aria-expanded", "true");
    $("#space-handle-label").textContent = M.viewLabel(route.view) || "";
    if (context?.farm.id !== farm.id) {
      context = null; openedMap = null;
      unmount(scene, answers, view); scene = null; answers = []; view = null; standing = []; focused = null;
      $("#space-body").replaceChildren(); $("#overview-cards").replaceChildren();
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
        renderLayers(drawn.entries); openedMap = farm.id;
      }
      FP.farmMap.resize(); settleFrame();
      unmount(answers, view); view = null; $("#overview-cards").replaceChildren();
      if (focused) { focused = null; FP.farmMap.focus(null); }   // a new view starts on the farm
      standing = M.standingAnswers(context);
      answers = standing.map((m) => answer($("#overview-cards"), m, { compact: true }));
      markFocused();
      $("#space-body").scrollTop = 0;   // the sheet's scroller outlasts the view: each view opens at its top
      if (route.view === "documents") {
        $("#space-body").replaceChildren();
        view = documentsView($("#space-body"), route.item);
        const selected = $("#space-body").querySelector('[data-item-id="' + CSS.escape(route.item || "") + '"]');
        if (selected) { selected.scrollIntoView({ block: "nearest" }); selected.focus({ preventScroll: true }); }
      } else if (route.view === "ask") { $("#space-body").replaceChildren(askView()); }
      else if (route.view === "create") { $("#space-body").replaceChildren(createView()); }
      else if (route.view === "people") { $("#space-body").replaceChildren(peopleView()); if (M.canManage(context.role)) await loadPeople(); }
      $("#map-msg").hidden = true;
    } catch (e) { if (current === token) { $("#map-msg").hidden = false; $("#map-msg").textContent = "Couldn't load the farm: " + (e.message || e); } }
  }
  return { load, summaries, setPortfolio, showPortfolio, close, open };
});
