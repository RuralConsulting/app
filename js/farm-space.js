// Farm-space frame and caller-scoped reads. The only write is resolve_review (0031), from the Review view.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./farm-model.js") : root.FP.farmModel);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmSpace = api;
})(typeof window === "undefined" ? globalThis : window, function (M) {
  async function read(query) { const { data, error } = await query; if (error) throw error; return data; }
  async function load(sb, farm, user) {
    const [member, org, plans] = await Promise.all([
      read(sb.from("farm_members").select("role").eq("farm_id", farm.id).eq("user_id", user.id).single()),
      read(sb.from("org_members").select("role").eq("org_id", farm.org_id).eq("user_id", user.id).maybeSingle()),
      read(sb.from("plans").select("id,title,status,plan_date,version_label,created_at").eq("farm_id", farm.id).order("created_at", { ascending: false })),
    ]);
    const canEdit = ["owner", "admin", "edit"].includes(member.role);
    const owner = member.role === "owner";
    const advisor = canEdit && ["admin", "advisor", "facilitator"].includes(org?.role);
    const selected = plans.find((p) => ["draft", "in_review"].includes(p.status)) || plans[0];
    let pdm, frozen = false, assembled = false;
    if (selected) {
      pdm = await read(sb.rpc("plan_document", { p: selected.id }));
      if (pdm && (pdm.farm?.id !== farm.id || pdm.plan?.farm_id !== farm.id)) throw Error("This plan information is unavailable for this farm.");
      assembled = !!pdm;
      frozen = assembled && ["signed_off", "superseded"].includes(selected.status);
    }
    if (!pdm) {
      // These existing reads also serve the map and prose/source picker. Never create a plan to open a farm.
      const [maps, documents, authorisations] = await Promise.all([
        read(sb.rpc("farm_map", { f: farm.id })),
        read(sb.from("documents").select("id,title").eq("farm_id", farm.id).order("title")),
        read(sb.from("authorisations").select("id,title,consent_no,rule_ref").eq("farm_id", farm.id).order("title")),
      ]);
      if (!maps) throw Error("This farm isn't shared with your login.");
      pdm = { farm, maps, documents, authorisations, values: [], checks: [], risks: [], sections: {},
        actions: { programme: [], possible: [] }, land_units: [], receptors: [] };
    }
    let reviewCounts = null;
    if (advisor || owner) {
      const result = await sb.rpc("review_counts", { farm: farm.id });
      if (!result.error) reviewCounts = result.data; // Optional badge: failure is unknown, never zero.
    }
    return { farm, user, plans, pdm, frozen, canEdit, advisor, owner, reviewCounts, assemblyMissing: !assembled, uncited: !assembled };
  }
  let portfolio = [], user = null, context = null, pending = null, token = 0, openedMap = null, lastView = null, currentRoute = null, flash = null;
  const $ = (s) => FP.$(s), el = (...a) => FP.el(...a);
  function close() { document.body.classList.remove("farm-space-active", "farm-detail", "farm-reader", "portfolio-active"); $("#portfolio")?.setAttribute("hidden", ""); token++; context = null; pending = null; openedMap = null; $("#farm-space-header")?.setAttribute("hidden", ""); }
  function setPortfolio(farms, person) { portfolio = farms; user = person; init(); }
  function init() {
    if ($("#farm-space-header")) return;
    const h = el("header", { id: "farm-space-header", hidden: true });
    h.innerHTML = '<div class="farm-header-row"><h1 id="space-farm-name"></h1><label class="farm-switch-label">Farm<select id="farm-switch"></select></label>' +
      '<span id="space-person"></span><a id="space-review" hidden></a><button class="link" id="space-signout">Sign out</button></div>' +
      '<div class="farm-header-lower"><nav id="farm-tabs" aria-label="Farm views"></nav><form id="farm-jump"><label for="jump-input">Jump to</label>' +
      '<input id="jump-input" list="jump-options" placeholder="Consent, action, land unit or document" autocomplete="off"><datalist id="jump-options"></datalist><button>Go</button></form></div><p id="jump-message" role="status" hidden></p>';
    document.body.prepend(h);
    const reserve = () => document.documentElement.style.setProperty("--farm-header-height", h.hidden ? "0px" : h.getBoundingClientRect().height + "px");
    new ResizeObserver(reserve).observe(h);
    $("#farm-switch").addEventListener("change", (e) => {
      location.hash = FP.href(farmTarget(e.target.value));
    });
    $("#space-signout").addEventListener("click", async () => {
      if (FP.demo?.active) location.href = location.pathname + location.search;
      else { await FP.auth.signOut(); location.hash = ""; location.reload(); }
    });
    $("#farm-jump").addEventListener("submit", (e) => {
      e.preventDefault(); const term = $("#jump-input").value.trim().toLowerCase();
      const found = term && jumpItems().find((i) => i.label.toLowerCase().includes(term));
      const msg = $("#jump-message"); msg.hidden = !!found; msg.textContent = found ? "" : "No recorded item matches that name.";
      if (found) location.hash = FP.href(found.href);
    });
    $("#overview-toggle").addEventListener("click", () => {
      const rail = $("#overview-rail"), expanded = rail.classList.toggle("expanded");
      $("#overview-toggle").setAttribute("aria-expanded", String(expanded));
      $("#overview-toggle").textContent = expanded ? "Close overview" : "Farm overview";
    });
    $("#layers-open").addEventListener("click", () => { $("#layers-drawer").hidden = false; $("#layers-open").setAttribute("aria-expanded", "true"); $("#layers-close").focus(); });
    $("#layers-close").addEventListener("click", () => { $("#layers-drawer").hidden = true; $("#layers-open").setAttribute("aria-expanded", "false"); $("#layers-open").focus(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("#layers-drawer").hidden = true; $("#overview-rail").classList.remove("expanded"); $("#overview-toggle").setAttribute("aria-expanded", "false"); $("#overview-toggle").textContent = "Farm overview"; $("#layers-open").setAttribute("aria-expanded", "false"); } });
    $("#overview-cards").addEventListener("click", (e) => {
      if (e.target.closest("a,button,details")) return;
      const target = e.target.closest(".answer-panel")?.querySelector("h2 a");
      if (target) location.hash = target.getAttribute("href");
    });
    $("#space-content").addEventListener("click", (e) => {
      if (e.target.closest("[data-start-plan]") && context?.canEdit) FP.plan.routes.startNew($("#space-content"), context.farm, user, context.plans, context.advisor);
      const doc = e.target.closest("[data-open-document]");
      if (doc) {
        const source = context?.pdm.documents?.find((d) => d.id === doc.dataset.openDocument);
        if (source?.storage_path) FP.plan.routes.openDocument(doc, source.storage_path);
      }
    });
    $("#space-content").addEventListener("submit", async (e) => {
      const form = e.target.closest(".review-form"); if (!form) return;
      e.preventDefault();
      const decision = e.submitter?.value, field = (n) => form.elements[n]?.value.trim() || "", fail = (m) => { const p = form.querySelector(".review-error"); p.textContent = m; p.hidden = false; };
      const source = form.dataset.reviewSource, payload = {};
      if (field("note")) payload.note = field("note");
      if (decision === "reject" && !payload.note) return fail("Say why you are rejecting it.");
      if (decision === "correct") {
        if (!field("value")) return fail("Enter the corrected value.");
        payload[/^-?\d+(\.\d+)?$/.test(field("value")) ? "value_num" : "value_text"] = field("value");
      }
      if (decision === "pin") {
        const chosen = form.querySelector('input[name="fact"]:checked');
        if (!chosen) return fail("Choose the value to use.");
        if (!payload.note) return fail("Say why this one.");
        payload.fact_id = chosen.value;
      }
      if (decision === "disagree") {
        if (!field("status")) return fail("Choose your reading.");
        if (!payload.note) return fail("Say why you read it differently.");
        payload.status = field("status");
      }
      for (const b of form.querySelectorAll("button")) b.disabled = true;
      const result = await FP.sb.rpc("resolve_review", { item_source: source, item_id: form.dataset.reviewId, decision, payload });
      if (result.error) { for (const b of form.querySelectorAll("button")) b.disabled = false; return fail(result.error.message || "Couldn't save that."); }
      flash = "Saved."; open(context.farm, currentRoute);
    });
    $("#space-content").addEventListener("change", (e) => {
      if (!e.target.matches("[data-record-filter]")) return;
      const host = e.target.closest(".answer-panel"), area = host.querySelector('[data-record-filter="management"]')?.value || "";
      const place = host.querySelector('[data-record-filter="place"]')?.value || "";
      let shown = 0, total = 0;
      for (const card of host.querySelectorAll(".record-card")) {
        total++;
        const places = (card.dataset.placeIds || "").split(" ").filter(Boolean);
        card.hidden = !!(area && card.dataset.managementArea !== area || place && !places.includes(place));
        if (!card.hidden) shown++;
      }
      for (const group of host.querySelectorAll(".record-group")) {
        const visible = [...group.querySelectorAll(".record-card")].filter((card) => !card.hidden).length;
        group.hidden = visible === 0;
        const heading = group.querySelector("h3");
        if (heading) heading.textContent = heading.textContent.replace(/\s+\(\d+\)$/, "") + " (" + visible + ")";
      }
      const count = host.querySelector(".record-filter-count");
      if (count) count.textContent = area || place ? "Showing " + shown + " of " + total + " records." : "Showing all " + total + " records.";
    });
  }
  function farmTarget(id) {
    let target = id ? M.href(id, "map") : "";
    try { if (id) target = sessionStorage.getItem("fp-view-" + user.id + "-" + id) || target; } catch {}
    return target;
  }
  // The light portfolio read (0038): one caller-scoped row per farm, in one request. A farm's full record is
  // read (load) only when that farm is opened.
  const summaries = (sb) => read(sb.from("farm_summaries").select("*"));
  // Portfolio: every farm with its one sentence, and a map of them all. A farm with no summary row shows its
  // name and says so.
  async function showPortfolio() {
    const current = ++token, rows = portfolio.map((farm) => ({ farm, line: "", extent: null }));
    context = null; pending = null; openedMap = null; lastView = null; currentRoute = null;
    FP.plan.routes.cancel();
    document.body.classList.remove("farm-space-active", "farm-detail", "farm-reader");
    document.body.classList.add("portfolio-active");
    $("#farm-space-header")?.setAttribute("hidden", "");
    for (const id of ["#space-content", "#overview-rail", "#layers-drawer", "#map-msg"]) $(id).hidden = true;
    document.title = "Farms | Farm platform";
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
  function jumpItems() {
    if (!context) return [];
    const p = context.pdm, f = context.farm.id;
    return [
      ...((p.authorisations || []).map((a) => ({ label: [a.consent_no || a.rule_ref, a.title].filter(Boolean).join(" "), href: M.href(f, "authorisations", a.id) }))),
      ...((p.actions?.programme || []).map((a) => ({ label: [a.map_code, a.title].filter(Boolean).join(" "), href: M.href(f, "actions", a.id) }))),
      ...((p.land_units || []).map((u) => ({ label: [u.code, u.name].filter(Boolean).join(" "), href: M.href(f, "map", u.id) }))),
      ...((p.documents || []).map((d) => ({ label: d.title, href: M.href(f, "plans", d.id) }))),
    ];
  }
  function links(host) { for (const a of host.querySelectorAll('a[href^="#/farm/"]')) a.setAttribute("href", FP.href(a.getAttribute("href"))); }
  function header(farm, route) {
    const h = $("#farm-space-header"); h.hidden = false;
    $("#space-farm-name").textContent = farm.name; $("#space-person").textContent = FP.demo?.active ? (context.advisor ? "Demo advisor" : "Demo farmer") : user.user_metadata?.display_name || user.email;
    const select = $("#farm-switch");
    select.replaceChildren(el("option", { value: "" }, "All farms"), ...portfolio.map((f) => el("option", { value: f.id }, f.name)));
    select.value = farm.id;
    $(".farm-switch-label").style.display = portfolio.length < 2 ? "none" : "";
    $("#farm-tabs").replaceChildren(...M.views.map(([key, label]) => el("a", { href: FP.href(M.href(farm.id, key)), ...(route.view === key || route.view === "reader" && key === "plans" ? { "aria-current": "page" } : {}) }, label)));
    const review = $("#space-review"); review.hidden = !(context.advisor || context.owner);
    review.href = FP.href(M.href(farm.id, "review"));
    const count = context.reviewCounts?.total;
    review.textContent = "Review" + (Number.isInteger(count) && count >= 0 ? " (" + count + ")" : "");
    if (route.view === "review") review.setAttribute("aria-current", "page"); else review.removeAttribute("aria-current");
    $("#space-signout").textContent = FP.demo?.active ? "Exit demo" : "Sign out";
    $("#jump-options").replaceChildren(...jumpItems().map((i) => el("option", { value: i.label })));
  }
  function renderLayers(entries) {
    const row = (e) => el("li", {}, el("label", {}, el("input", { type: "checkbox", checked: e.on, onchange: (ev) => FP.farmMap.setVisible(e, ev.target.checked) }),
      el("span", {}, el("b", {}, e.name), e.sub ? el("small", {}, e.sub) : null)));
    const children = entries.filter((e) => !e.job).map(row), jobs = new Map();
    for (const e of entries.filter((e) => e.job)) { if (!jobs.has(e.job.id)) jobs.set(e.job.id, { job: e.job, entries: [] }); jobs.get(e.job.id).entries.push(e); }
    for (const { job, entries: es } of jobs.values()) children.push(el("li", { class: "group" }, "Made for: " + job.name), ...es.map(row));
    $("#layer-list").replaceChildren(...children);
  }
  function selectGeometry(item) {
    if (!item) return;
    const p = context.pdm;
    const unit = (p.land_units || []).find((u) => u.id === item);
    const action = (p.actions?.programme || []).find((a) => a.id === item);
    const risk = (p.risks || []).find((r) => r.id === item);
    const auth = (p.authorisations || []).find((a) => a.id === item);
    const activity = (p.activities || []).find((a) => (auth?.activity_ids || []).includes(a.id));
    const geom = unit?.geom || action?.geom || action?.places?.[0]?.geom || (p.land_units || []).find((u) => u.id === (risk?.place_id || activity?.place_id))?.geom;
    if (geom) FP.farmMap.frame(geom);
  }
  async function open(farm, route) {
    const current = ++token;
    document.body.classList.remove("portfolio-active"); $("#portfolio").hidden = true;
    document.body.classList.add("farm-space-active");
    FP.plan.routes.cancel();
    $("#layers-drawer").hidden = true;
    $("#layers-open").setAttribute("aria-expanded", "false");
    $("#overview-rail").classList.remove("expanded");
    $("#overview-toggle").setAttribute("aria-expanded", "false");
    $("#overview-toggle").textContent = "Farm overview";
    if (lastView === "reader" && route.view !== "reader") { context = null; openedMap = null; }
    lastView = route.view;
    if (context?.farm.id !== farm.id) {
      context = null; openedMap = null;
      $("#space-content").replaceChildren(); $("#overview-cards").replaceChildren(); $("#space-review").hidden = true;
      pending = load(FP.sb, farm, user);
    }
    FP.show(route.view === "reader" ? "screen-plans" : "screen-map");
    document.body.classList.toggle("farm-reader", route.view === "reader");
    document.body.classList.toggle("farm-detail", !["map", "reader"].includes(route.view));
    $("#space-content").hidden = route.view === "map" || route.view === "reader";
    $("#overview-rail").hidden = route.view !== "map";
    $("#map-msg").hidden = false; $("#map-msg").textContent = "Loading the farm…";
    try {
      const loaded = context || await pending;
      if (current !== token) return;
      context = loaded; currentRoute = route;
      if (route.view === "review" && (context.advisor || context.owner)) {
        const queue = await FP.sb.from("review_queue").select("*").eq("farm_id", farm.id);
        if (current !== token) return;
        context.reviewError = !!queue.error; context.reviewQueue = queue.error ? null : queue.data || [];
        if (!queue.error) context.reviewCounts = { ...(context.reviewCounts || {}), total: context.reviewQueue.length };
      }
      header(farm, route);
      document.title = farm.name + " · " + (M.views.find(([key]) => key === route.view)?.[1] || "Review") + " | Farm platform";
      try { sessionStorage.setItem("fp-view-" + user.id + "-" + farm.id, (route.view === "reader" ? "#/farm/" + farm.id + "/plan/" + route.plan : M.href(farm.id, route.view, route.item))); } catch {}
      if (route.view === "reader") { $("#map-msg").hidden = true; await FP.plan.routes.open({ plan: route.plan }, farm); return; }
      if (openedMap !== farm.id) {
        const view = await FP.farmMap.open(farm.id, context.pdm.maps);
        if (current !== token) return;
        if (!view) throw Error("Map unavailable for this farm.");
        if (!view.entries.some((e) => e.key === "actions")) {
          const entry = FP.farmMap.addActions(context.pdm.actions?.programme, context.pdm.land_units);
          if (entry) view.entries.push(entry);
        }
        renderLayers(view.entries); openedMap = farm.id;
      }
      FP.farmMap.resize();
      const models = M.models(context), keys = ["authorisations", "actions", "plans", ...(context.advisor || context.owner ? ["review"] : [])];
      $("#overview-cards").innerHTML = keys.map((key) => FP.answer.render({ ...models[key], compact: true, startAction: null })).join("");
      links($("#overview-cards"));
      if (route.view !== "map") {
        const model = { ...models[route.view], selectedId: route.item };
        $("#space-content").innerHTML = FP.answer.render(model); links($("#space-content"));
        if (flash && route.view === "review") { $("#space-content h2").after(el("p", { class: "review-status", role: "status" }, flash)); }
        flash = null;
        const doc = route.view === "plans" && (context.pdm.documents || []).find((d) => d.id === route.item && d.storage_path);
        if (doc) $("#space-content").append(el("button", { type: "button", "data-open-document": doc.id }, "Open source document"));
        const selected = [...$("#space-content").querySelectorAll("[data-item-id]")].find((n) => n.dataset.itemId === route.item);
        selected?.scrollIntoView({ block: "nearest" }); if (selected) selected.focus({ preventScroll: true });
      }
      selectGeometry(route.item);
      $("#map-msg").hidden = true;
    } catch (e) { if (current === token) { $("#map-msg").hidden = false; $("#map-msg").textContent = "Couldn't load the farm: " + (e.message || e); } }
  }
  return { load, summaries, setPortfolio, showPortfolio, close, open };
});

