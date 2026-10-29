// The farm space: header, map with its standing answers, and Ask, Create, Documents. Reads only, except People
// (owners and admins add, change and remove people; the farm_members policies decide what is allowed).
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./farm-model.js") : root.FP.farmModel);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmSpace = api;
})(typeof window === "undefined" ? globalThis : window, function (M) {
  async function read(query) { const { data, error } = await query; if (error) throw error; return data; }
  const nzToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  // Everything a farm space shows, in one round of caller-scoped reads (row-level security decides what comes back).
  async function load(sb, farm, user) {
    const [member, org, maps, documents, authorisations, obligations, today] = await Promise.all([
      read(sb.from("farm_members").select("role").eq("farm_id", farm.id).eq("user_id", user.id).single()),
      read(sb.from("org_members").select("role").eq("org_id", farm.org_id).eq("user_id", user.id).maybeSingle()),
      read(sb.rpc("farm_map", { f: farm.id })),
      read(sb.from("documents").select("id,title,doc_type,author,author_org,date_prepared,page_count,storage_path,created_at").eq("farm_id", farm.id).order("title")),
      read(sb.from("authorisations").select("id,kind,title,consent_no,rule_ref,valid_from,valid_to,created_at").eq("farm_id", farm.id).order("title")),
      // Optional: if the dates can't be read, "What's due" says so rather than claiming nothing is due.
      Promise.resolve(sb.from("obligations").select("id,authorisation_id,code,summary,due_date,recurrence").eq("farm_id", farm.id)).then((r) => r, (e) => ({ error: e })),
      sb.today ? sb.today() : nzToday(),
    ]);
    if (!maps) throw Error("This farm isn't shared with your login.");
    const advisor = ["owner", "admin", "edit"].includes(member.role) && ["admin", "advisor", "facilitator"].includes(org?.role);
    return { farm, user, role: member.role, advisor, maps, documents, authorisations, today,
      obligations: obligations.error ? [] : obligations.data || [], obligationsError: !!obligations.error };
  }
  // The light portfolio read (0038): one caller-scoped row per farm, in one request. A farm's full record is
  // read (load) only when that farm is opened.
  const summaries = (sb) => read(sb.from("farm_summaries").select("*"));

  let portfolio = [], user = null, context = null, pending = null, token = 0, openedMap = null;
  const $ = (s) => FP.$(s), el = (...a) => FP.el(...a);
  function close() {
    document.body.classList.remove("farm-space-active", "farm-detail", "portfolio-active");
    $("#portfolio")?.setAttribute("hidden", ""); token++; context = null; pending = null; openedMap = null;
    $("#farm-space-header")?.setAttribute("hidden", "");
  }
  function setPortfolio(farms, person) { portfolio = farms; user = person; init(); }
  function init() {
    if ($("#farm-space-header")) return;
    const h = el("header", { id: "farm-space-header", hidden: true });
    h.innerHTML = '<div class="farm-header-row"><h1><a id="space-farm-name" href="#"></a></h1><label class="farm-switch-label">Farm<select id="farm-switch"></select></label>' +
      '<a id="space-people" class="link" hidden>People</a><span id="space-person"></span><button class="link" id="space-signout">Sign out</button></div>' +
      '<nav id="farm-actions" aria-label="Farm"></nav>';
    document.body.prepend(h);
    const reserve = () => document.documentElement.style.setProperty("--farm-header-height", h.hidden ? "0px" : h.getBoundingClientRect().height + "px");
    new ResizeObserver(reserve).observe(h);
    $("#farm-switch").addEventListener("change", (e) => { location.hash = FP.href(farmTarget(e.target.value)); });
    $("#space-signout").addEventListener("click", async () => {
      if (FP.demo?.active) location.href = location.pathname + location.search;
      else { await FP.auth.signOut(); location.hash = ""; location.reload(); }
    });
    $("#overview-toggle").addEventListener("click", () => {
      const rail = $("#overview-rail"), expanded = rail.classList.toggle("expanded");
      $("#overview-toggle").setAttribute("aria-expanded", String(expanded));
    });
    $("#layers-open").addEventListener("click", () => { $("#layers-drawer").hidden = false; $("#layers-open").setAttribute("aria-expanded", "true"); $("#layers-close").focus(); });
    $("#layers-close").addEventListener("click", () => { $("#layers-drawer").hidden = true; $("#layers-open").setAttribute("aria-expanded", "false"); $("#layers-open").focus(); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      $("#layers-drawer").hidden = true; $("#layers-open").setAttribute("aria-expanded", "false");
      $("#overview-rail").classList.remove("expanded"); $("#overview-toggle").setAttribute("aria-expanded", "false");
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
    $("#space-content").addEventListener("submit", (e) => {
      if (e.target.matches("#people-add")) { e.preventDefault(); addPerson(); return; }
      if (!e.target.matches("#ask-form")) return;
      e.preventDefault();
      const question = $("#ask-input").value.trim();
      if (!question) { $("#ask-input").focus(); return; }
      $("#ask-answer").replaceChildren(el("p", { class: "ask-question" }, question), el("p", { class: "answer-sentence" }, "Ask is coming — S4"));
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
  function farmTarget(id) {
    let target = id ? M.href(id, "map") : "";
    try { if (id) target = sessionStorage.getItem("fp-view-" + user.id + "-" + id) || target; } catch {}
    return target;
  }
  // Portfolio: every farm with its one sentence, and a map of them all (the NZ -> farm zoom starts here).
  async function showPortfolio() {
    const current = ++token, rows = portfolio.map((farm) => ({ farm, line: "", extent: null }));
    context = null; pending = null; openedMap = null;
    document.body.classList.remove("farm-space-active", "farm-detail");
    document.body.classList.add("portfolio-active");
    $("#farm-space-header")?.setAttribute("hidden", "");
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
    $("#space-person").textContent = FP.demo?.active ? (context.advisor ? "Demo advisor" : "Demo farmer") : user.user_metadata?.display_name || user.email;
    const select = $("#farm-switch");
    select.replaceChildren(el("option", { value: "" }, "All farms"), ...portfolio.map((f) => el("option", { value: f.id }, f.name)));
    select.value = farm.id;
    $(".farm-switch-label").style.display = portfolio.length < 2 ? "none" : "";
    $("#farm-actions").replaceChildren(...M.views.map(([key, label]) => el("a", { href: FP.href(M.href(farm.id, key)), ...(route.view === key ? { "aria-current": "page" } : {}) }, label)));
    $("#space-signout").textContent = FP.demo?.active ? "Exit demo" : "Sign out";
    const people = $("#space-people");
    people.hidden = !M.canManage(context.role); people.href = FP.href(M.href(farm.id, "people"));
    if (route.view === "people") people.setAttribute("aria-current", "page"); else people.removeAttribute("aria-current");
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
  function renderLayers(entries) {
    const row = (e) => el("li", {}, el("label", {}, el("input", { type: "checkbox", checked: e.on, onchange: (ev) => FP.farmMap.setVisible(e, ev.target.checked) }),
      el("span", {}, el("b", {}, e.name), e.sub ? el("small", {}, e.sub) : null)));
    const children = entries.filter((e) => !e.job).map(row), jobs = new Map();
    for (const e of entries.filter((e) => e.job)) { if (!jobs.has(e.job.id)) jobs.set(e.job.id, { job: e.job, entries: [] }); jobs.get(e.job.id).entries.push(e); }
    for (const { job, entries: es } of jobs.values()) children.push(el("li", { class: "group" }, "Made for: " + job.name), ...es.map(row));
    $("#layer-list").replaceChildren(...children);
  }
  function askView() {
    const form = el("form", { id: "ask-form", class: "ask-form" },
      el("label", { for: "ask-input", class: "visually-hidden" }, "Question"),
      el("textarea", { id: "ask-input", rows: "3", autocomplete: "off", placeholder: "When is the next audit due?" }),
      el("button", { type: "submit" }, "Ask"));
    return el("section", { class: "space-view", "data-view": "ask" }, el("h2", {}, "Ask"), form, el("div", { id: "ask-answer", class: "ask-answer", "aria-live": "polite" }));
  }
  function createView() {
    return el("section", { class: "space-view", "data-view": "create" }, el("h2", {}, "Create"),
      el("ul", { class: "output-list" }, ...M.outputs.map(([key, label]) => el("li", { "data-output": key }, el("span", {}, label), el("small", {}, "coming")))));
  }
  async function open(farm, route) {
    const current = ++token;
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    $("#layers-drawer").hidden = true; $("#layers-open").setAttribute("aria-expanded", "false");
    $("#overview-rail").classList.remove("expanded"); $("#overview-toggle").setAttribute("aria-expanded", "false");
    if (context?.farm.id !== farm.id) {
      context = null; openedMap = null;
      $("#space-content").replaceChildren(); $("#overview-cards").replaceChildren();
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
      header(farm, route);
      document.title = farm.name + (route.view === "map" ? "" : " · " + M.viewLabel(route.view)) + " | " + FP.brand?.product;
      try { sessionStorage.setItem("fp-view-" + user.id + "-" + farm.id, M.href(farm.id, route.view)); } catch {}
      if (openedMap !== farm.id) {
        const view = await FP.farmMap.open(farm.id, context.maps);
        if (current !== token) return;
        if (!view) throw Error("Map unavailable for this farm.");
        renderLayers(view.entries); openedMap = farm.id;
      }
      FP.farmMap.resize();
      $("#overview-cards").innerHTML = M.standingAnswers(context).map((m) => FP.answer.render({ ...m, compact: true })).join("");
      if (route.view === "documents") {
        $("#space-content").innerHTML = FP.answer.render({ ...M.documents(context), selectedId: route.item });
        const selected = [...$("#space-content").querySelectorAll("[data-item-id]")].find((n) => n.dataset.itemId === route.item);
        if (selected) { selected.scrollIntoView({ block: "nearest" }); selected.focus({ preventScroll: true }); }
      } else if (route.view === "ask") { $("#space-content").replaceChildren(askView()); }
      else if (route.view === "create") { $("#space-content").replaceChildren(createView()); }
      else if (route.view === "people") { $("#space-content").replaceChildren(peopleView()); if (M.canManage(context.role)) await loadPeople(); }
      for (const a of $("#space-content").querySelectorAll('a[href^="#/farm/"]')) a.setAttribute("href", FP.href(a.getAttribute("href")));
      for (const a of $("#overview-cards").querySelectorAll('a[href^="#/farm/"]')) a.setAttribute("href", FP.href(a.getAttribute("href")));
      $("#map-msg").hidden = true;
    } catch (e) { if (current === token) { $("#map-msg").hidden = false; $("#map-msg").textContent = "Couldn't load the farm: " + (e.message || e); } }
  }
  return { load, summaries, setPortfolio, showPortfolio, close, open };
});
