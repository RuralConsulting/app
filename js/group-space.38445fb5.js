// The catchment group's space (S5, docs/CATCHMENT-SPACE.md): the farm space's shape at catchment scale. Map (the group's
// own layers, member farms at the level the group and each farm allow, shared reference areas and sites) with the group's
// standing answers (members, what's due, what's changed, water quality nearby); Documents (the group's own, tiered, and
// what member farms shared); Events (N4, events.js: the group's events and attendance, a calendar, export and import); People (PE1, people.js: businesses, people and an interaction log, for the group's facilitators, advisors and admins); Create → Monthly update (drafted by code, edited here, stored as a group document); Settings
// (a group admin chooses how member farms are shown). Every read is as the signed-in person, through row-level security
// and the group functions (group_map, group_member_summary, group_member_farms, group_shared_entries/documents,
// group_wq_sites); nothing needs AI. The water-quality card opens with the group's standing answer, "What does our
// water-quality data tell us, compared with ECan's sites?" (MC1, group-wq-answer.js): written by code from the analysis
// library under the group's published method (X1b preset), above B8's chart.
// PERF3b: the map is read in parts. group_map (PERF3a) is light: the group's area, the member farms and the small layers
// inline; a large layer (`deferred`) is read for the map in view when it is switched on (group-layers.js), and each
// reference source when it is switched on (group_reference_context, through farm-reference.js), counted beside the map
// (group_reference_counts). The group opens quiet: its area and member blocks, read once right after the first paint
// (the `group-drawn` measure staff see on Operations). A layer or source that can't be read says so on its row; the group
// never fails for it. A group_map from before PERF3a (every layer inline) draws as it did.
(function (root) {
  const FP = root.FP;
  const G = () => FP.groupModel, U = () => FP.groupUpdate;
  const el = (...a) => FP.el(...a), $ = (s) => FP.$(s);
  const DOC_COLUMNS = "id,title,doc_type,author,author_org,date_prepared,period_start,period_end,storage_path,original_name,sha256,status,created_at,tier,tiered_at,visibility";
  let groups = [], person = null, ctx = null, token = 0, mapHandle = null, mapReady = null, surface = null, entries = [], wq = null, wqAnswer = null, draft = null, notice = null, lastView = null;
  // PERF3b: the group map's deferred layers (group-layers.js), its reference sources (farm-reference.js) with the rows of
  // those not read yet, and the map's moveend hook: all for the map drawn now, and dropped with it.
  let parts = null, refs = null, placeholders = new Map(), offMove = null, countsFailed = false;
  let stackOk = new Set();   // LK4: context fills the person chose to show together ("a|b"), for the map drawn now
  // TIM1 (#409, #410): the route timing run for the group map being drawn (route-timing.js), from when its route began loading.
  let timing = null;
  let addCtx = null;   // UI2: what Add offers here (header), for the Add in What needs doing
  let shownTabs = [];   // J2: the sections drawn for this person here ([key, label]), for Home's shortcuts
  const T = () => FP.routeTiming || null;
  // MC1: a computer (wider than a phone's 800 px, ui.css's breakpoint) gets the group's overview on Home; crossing the breakpoint
  // with Home open draws the other one
  const COMPUTER = "(min-width: 801px)";
  const computer = () => !!root.matchMedia?.(COMPUTER).matches;
  root.matchMedia?.(COMPUTER).addEventListener?.("change", () => {
    const screen = root.document?.querySelector("#screen-group");
    if (screen && !screen.hidden && screen.dataset.view === "home" && ctx?.group && lastView === "home") open(ctx.group, { view: "home" });
  });
  const featureCount = (n) => Number(n).toLocaleString("en-NZ") + (Number(n) === 1 ? " feature" : " features");

  async function read(query) { const { data, error } = await query; if (error) throw error; return data; }
  const optional = (query) => Promise.resolve(query).then((r) => (r.error ? null : r.data), () => null);
  const list = (v) => (Array.isArray(v) ? v : []);
  // V5: the group's documents: bounded (count first, then at most that many), with what each relates to and what replaced it.
  const groupDocuments = async (sb, id) => FP.documentFiles.withRelations(sb, await FP.documentFiles.readRows(sb, { org_id: id }, DOC_COLUMNS));

  function setGroups(rows, user) { groups = rows || []; person = user; }
  const find = (id) => groups.find((g) => g.id === id) || null;

  // ---- reads -------------------------------------------------------------------------------------------------------------
  // HOT1: three reads, each kept once per group, so a slow one never fails a view. The base (the standing answers, Documents and
  // Create) has no map in it; the extras are the admin's readiness card, the group's area and the reference sources; `group_map`
  // (every feature of every layer the group owns: the one heavy read) is drawn beside the Map, Documents and Create views, but no
  // panel waits for it, and a failure or a wait there only fails the map area. The manage space reads none of the three.
  const MAP_TIMEOUT_MS = 25000;
  const LOOKS_TIMEOUT_MS = 5000;   // LK2: the looks read's own limit (it takes about 0.05 s; the map never waits for it)
  async function load(group) {
    const sb = FP.sb, today = typeof sb.today === "function" ? await sb.today() : G().isoDay(Date.now());
    const since = new Date(Date.parse(String(today).slice(0, 10) + "T00:00:00Z") - 30 * 86400000).toISOString();
    const [summary, members, own, documents, shared, sharedDocs, obligations, types] = await Promise.all([
      optional(sb.rpc("group_member_summary", { g: group.id })),
      optional(sb.rpc("group_member_farms", { g: group.id })),
      optional(sb.from("entries").select("id,type_id,body,captured_at,visibility").eq("org_id", group.id).order("captured_at", { ascending: false })),
      optional(groupDocuments(sb, group.id).then((data) => ({ data }))),
      optional(sb.rpc("group_shared_entries", { group_id: group.id })),
      optional(sb.rpc("group_shared_documents", { group_id: group.id })),
      optional(sb.from("obligations").select("id,code,summary,kind,due_date,recurrence").eq("org_id", group.id)),
      optional(sb.from("record_types").select("id,key,label")),
    ]);
    const typeKey = new Map(list(types).map((t) => [t.id, t.key])), label = new Map(list(types).map((t) => [t.key, t.label]));
    return { group, today: String(today).slice(0, 10), since, map: null, sources: [], summary: summary || {}, members: list(members), types: list(types),
      typeLabel: (k) => label.get(k) || String(k || "record").replace(/_/g, " "),
      ownEntries: list(own).map((e) => ({ ...e, record_type: typeKey.get(e.type_id) || "note" })), documents: list(documents),
      sharedEntries: list(shared), sharedDocuments: list(sharedDocs), obligations: list(obligations), readiness: null, area: null };
  }
  // The Map view's own extras (every read optional).
  async function loadHome(group) {
    const sb = FP.sb;
    const [sources, readiness, areas] = await Promise.all([
      // PROV1: where the reference layers came from (the popups' provenance line and the Layers card's Sources entry)
      optional(sb.from("reference_sources").select(FP.provenance.COLUMNS).eq("serve_to_customers", true)),
      // ON2: onboarding readiness of member farms, for group admins only (the database returns null to anyone else)
      G().canManage(group.role) ? optional(sb.rpc("group_readiness", { g: group.id })) : null,
      // WQ4: the group's area (a place of kind area the group owns), so a group with none shows as not ready
      G().canManage(group.role) ? optional(sb.from("places").select("code,name,description,method,valid_to").eq("org_id", group.id).eq("kind", "area")) : null,
    ]);
    return { sources: list(sources), readiness: readiness || null, area: G().groupArea(areas) };
  }
  // LK2: a read the map does not wait for. now(): {styles} when it is back already, else {styles: [], lateStyles} (a promise of
  // them, [] when the read failed or ran out of time).
  function readLater(promise) {
    let done = false, value = [];
    const later = Promise.resolve(promise).then((v) => { done = true; value = list(v); return value; }, () => { done = true; return value; });
    return { now: () => (done ? { styles: value } : { styles: [], lateStyles: later }) };
  }
  const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the map took too long")), ms);
    Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
  // Each is started once per group's context and kept (the base and the extras forget a failure; the heavy map read does not).
  function ensureBase(c) {
    return c.pending || (c.pending = load(c.group).then((d) => (c.data = d), (e) => { c.pending = null; throw e; }));
  }
  function ensureHome(c) {
    return c.home || (c.home = ensureBase(c).then(async (d) => Object.assign(d, await loadHome(d.group)), (e) => { c.home = null; throw e; }));
  }
  function ensureMap(c) {
    // (a failed or slow answer is kept too: the heavy read is not repeated on every view; leaving the group space asks again)
    // LK1 (#416): beside it, the reviewed looks of the group's layers and of the shared sources and themes. Optional: without
    // them every layer is drawn as it was (its QGIS style, then today's rule).
    // LK2 (review-444 follow-up 4): the map never waits for them. The looks read has its own short limit; the map is drawn as
    // soon as group_map is back, with the looks if they are here by then, and otherwise they are applied when they come
    // (`lateStyles`, drawMap).
    if (c.mapPending) return c.mapPending;
    const ms = FP.groupSpace.mapTimeoutMs || MAP_TIMEOUT_MS;
    const looks = readLater(optional(withTimeout(FP.sb.rpc("layer_styles_for_map", { g: c.group.id }), Math.min(ms, FP.groupSpace.looksTimeoutMs || LOOKS_TIMEOUT_MS))));
    return (c.mapPending = withTimeout(read(FP.sb.rpc("group_map", { g: c.group.id })), ms).then((map) => {
      if (map && typeof map === "object") Object.assign(map, looks.now());
      return map;
    }));
  }

  // ---- the screen ----------------------------------------------------------------------------------------------------------
  // The map's parts go with the map (put away, drawn again, or the group left).
  function dropParts() { parts?.destroy(); parts = null; refs?.destroy(); refs = null; placeholders = new Map(); offMove?.(); offMove = null; countsFailed = false; stackOk = new Set(); }
  function close() {
    token++; dropParts(); timing = null; T()?.cancel("group");
    FP.mapsView?.close();
    FP.phoneArea?.close();   // PH1
    wq?.destroy(); wq = null; wqAnswer?.destroy(); wqAnswer = null;
    mapHandle?.destroy(); mapHandle = null; surface = null; entries = [];
    ctx = null; draft = null;
    hideNeeds();
    FP.placeHome?.close(); FP.groupOverview?.close();
    FP.records?.close();   // CAP1
    FP.wqPage?.close();   // WQV1
    FP.groupManage?.forget(); lastView = null;   // ON3b: leaving the group space drops the manage space's reads
    document.body.classList.remove("group-space-active");
    FP.add?.update(null);
  }
  // V8: the group's own logo, for a group listed in GROUP_LOGOS; every other group's header stays without one.
  function showLogo(group) {
    const img = $("#group-logo");
    if (!img) return;
    const logo = G().groupLogo(group);
    img.hidden = !logo;
    if (logo) { img.src = logo.src; img.alt = logo.alt; } else { img.removeAttribute("src"); img.alt = ""; }
  }
  const monogram = (name) => FP.icons.monogram(name);   // UI1: the same rule as a farm's (icons.js)
  // UI1: what the group is: a catchment group, or a sub-group of its parent (named when the person is a member of the parent too)
  function kindOf(group) {
    if (!group.parent_org_id) return "Catchment group";
    const parent = groups.find((g) => g.id === group.parent_org_id);
    return parent ? "Sub-group of " + parent.name : "Sub-group";
  }
  // (without space-nav.js, as in a test page: the tabs as plain links)
  const plainTabs = (nav, tabs, view) => nav.replaceChildren(...tabs.map((t) => el("a", { href: t.href, class: "group-tab", "data-tab": t.key, ...(t.key === view ? { "aria-current": "page" } : {}) },
    FP.icon && t.icon ? FP.icon(t.icon) : null, el("span", {}, t.label), t.badge?.() || null)));
  function header(group, route) {
    showLogo(group);
    // UI1: a group with no logo of its own has a quiet monogram in its place
    const mark = $("#group-mark"), logo = G().groupLogo(group);
    if (mark) { mark.hidden = !!logo; mark.replaceChildren(logo ? "" : monogram(group.name) || FP.icon("places", 18)); }
    $("#group-name").textContent = group.name;
    // UI2: the second line is the kind; the role is said in the account menu, and beside the kind on a computer (space-nav.js)
    const lines = FP.spaceNav?.headerLines({ kind: kindOf(group), role: group.role || null }) || { kind: kindOf(group), second: kindOf(group), menu: "" };
    const kindNode = $("#group-kind");
    kindNode.replaceChildren(lines.kind, ...(lines.second !== lines.kind ? [el("span", { class: "space-role" }, lines.second.slice(lines.kind.length))] : []));
    const roleNode = $("#group-account-role");
    if (roleNode) { roleNode.textContent = lines.menu; roleNode.hidden = !lines.menu; }
    // ON3b: the manage space is linked for the group's admins, advisors and facilitators only (a plain member never sees the link)
    // V6: a client's tabs are the allow-list (simple-view.js)
    // PE1: People (personal information) is linked for the group's facilitators, advisors and admins only, in either view
    const people = ([k]) => k !== "people" || !!FP.peopleModel?.canSeeTab(group, groups);   // SG2: and, in a sub-group, its parent's too
    const tabs = (FP.simpleView?.on() ? FP.simpleView.tabs("group") : G().views.filter(([k]) => k !== "manage" || FP.groupManageModel?.showsLink(group.role))).filter(people);   // UI1: the views drawn, for Add
    // UI2: five on a phone's tab bar and six in a computer's segmented control; the rest under More (space-nav.js)
    (FP.spaceNav?.render || plainTabs)($("#group-nav"), tabs.map(([key, label]) => ({ key, label, href: FP.href(G().href(group.id, key)), icon: FP.icons?.forView(key),
      badge: key === "people" ? () => FP.groupPeople?.countBadge?.(group.id) : null })), route.view,   // RV1: open review items, once People has read them
      // PH2: on a phone Search is a button in the bar: Home's own search (place-home.js, compact) in a sheet that takes the screen
      { search: FP.placeHome ? (opener) => searchSheet(opener, group, tabs) : null });
    const back = $("#group-back");
    // PH5: in a sub-group the back leads up to its parent's Home (a tap on the parent's map goes down into it), where the person may
    // open the parent; otherwise to Places, for someone with more than one place
    const parent = group.parent_org_id ? find(group.parent_org_id) : null;
    back.hidden = !parent && !(FP.groupSpace.hasPortfolio?.());
    back.setAttribute("href", parent ? FP.href(G().href(parent.id, "home")) : FP.href("#/places"));   // J2c: Places itself, never the bare address (which may land in a place)
    const backLabel = back.querySelector(".space-back-label");
    if (backLabel) backLabel.textContent = parent ? parent.name : "All places";
    back.setAttribute("aria-label", parent ? "Back to " + parent.name : "All places");
    if (FP.icon && !back.querySelector("svg")) back.prepend(FP.icon("back", 20));
    // UI1: Add, for what this person may add to this group (add.js)
    FP.add?.mount($("#group-add-slot"), "group");
    addCtx = { space: "group", id: group.id, name: group.name, role: group.role || null, staff: !!FP.ops?.isStaff?.(), views: tabs.map(([key]) => key), view: route.view };
    shownTabs = tabs;
    FP.add?.update(addCtx);
  }
  async function open(group, route) {
    const current = ++token;
    document.body.classList.add("group-space-active");
    FP.show("screen-group");
    header(group, route);
    $("#screen-group").dataset.view = route.view;
    if (route.view !== "map") hideNeeds();   // UI2: What needs doing is the Working map's (UI2's Overview)
    if (route.view !== "home") { FP.placeHome?.close(); FP.groupOverview?.close(); FP.phoneArea?.close(); }
    if (route.view !== "records") FP.records?.close();   // CAP1
    if (route.view !== "water") FP.wqPage?.close();   // WQV1: its map and charts go with the page
    if (route.view !== "water") FP.wqRound?.close();   // SR1: a round being typed is kept as a draft in the browser
    // ON3b: the manage space's reads last only across its own tabs: entering it from another view, or for another group, reads again
    if (route.view === "manage" && (lastView !== "manage" || ctx?.group.id !== group.id)) FP.groupManage?.forget(group.id);
    // DEC1b: leaving Manage removes its decision cards' small maps (each a WebGL context and the engine's listeners)
    if (lastView === "manage" && route.view !== "manage") FP.decisionCard?.sweep(true);
    lastView = route.view;
    // ON3b: the manage space is a queue, not a map: the map is put away (drawn again when the person goes back to it)
    if (route.view === "manage" || route.view === "maps" || route.view === "events" || route.view === "people" || route.view === "home" || route.view === "records" || route.view === "water") { dropParts(); wq?.destroy(); wq = null; wqAnswer?.destroy(); wqAnswer = null; mapHandle?.destroy(); mapHandle = null; mapReady = null; surface = null; entries = []; $("#group-map").replaceChildren(); timing = null; T()?.cancel("group"); if (ctx?.data) { ctx.data.mapSettled = null; ctx.data.settleMap = null; } }
    if (ctx?.group.id !== group.id) {
      dropParts(); wq?.destroy(); wq = null; wqAnswer?.destroy(); wqAnswer = null; mapHandle?.destroy(); mapHandle = null; surface = null; entries = []; draft = null;
      ctx = { group };   // HOT1: nothing is read yet; each view asks for what it draws
    }
    // V4: Maps fills the space under the header (js/maps-view.js) and asks for none of the group's reads
    if (route.view === "maps") {
      document.title = group.name + " · " + G().viewLabel("maps") + " | " + (FP.brand?.product || "");
      return FP.mapsView.open($("#group-maps"), { owner: { org: group.id }, name: group.name, item: route.item || null, href: (id) => FP.href(G().href(group.id, "maps", id)),
        waterQuality: !!FP.groupOverview?.takeWaterQuality?.() });   // MC1: "Open water quality" on the overview
    }
    FP.mapsView?.close();
    // N4: Events is a calendar, not a map: the panel takes the width and the view reads and writes the group's events itself
    // (events.js), with none of the group's other reads
    if (route.view === "events") {
      document.title = group.name + " · " + G().viewLabel("events") + " | " + (FP.brand?.product || "");
      const panel = $("#group-panel"), today = typeof FP.sb.today === "function" ? String(await FP.sb.today()).slice(0, 10) : null;
      if (current !== token) return;
      panel.replaceChildren(FP.groupEvents.view(group, { sb: FP.sb, person, today, now: today && FP.demo?.active ? today + "T00:00:00Z" : null }));
      panel.scrollTop = 0;
      return;
    }
    // PE1: People is a list, not a map: the panel takes the width and the view reads and writes the group's people itself
    // (people.js); a role that may not read them is told so there and nothing is asked of the database
    if (route.view === "people") {
      document.title = group.name + " · " + G().viewLabel("people") + " | " + (FP.brand?.product || "");
      // PF1: the same group's People already open (the address changed with its screen, or the route was drawn again as the app
      // starts): the view follows the address itself, keeping what it has read and where the person was
      const shown = $("#group-panel").firstElementChild;
      if (shown?.peopleRoute && shown.dataset.group === group.id && FP.peopleModel?.canSeeTab(group, groups) && pendingSearch?.view !== "people") { shown.peopleRoute(route.tab || null); return; }
      const panel = $("#group-panel"), today = typeof FP.sb.today === "function" ? String(await FP.sb.today()).slice(0, 10) : null;
      if (current !== token) return;
      const q = pendingSearch?.view === "people" ? pendingSearch.q : ""; pendingSearch = null;
      panel.replaceChildren(FP.groupPeople.view(group, { sb: FP.sb, person, today, now: today && FP.demo?.active ? today + "T09:00:00+13:00" : null, tab: route.tab || null, q,
        parent: group.parent_org_id ? groups.find((x) => x.id === group.parent_org_id) || null : null }));   // SG2: a sub-group's parent, when the person is in it
      panel.scrollTop = 0;
      return;
    }
    // WQV1: Water quality is a page of its own (wq-page.js): its filter bar, figures and Map | Chart | Table take the width, with its own
    // bounded reads and none of the group's
    if (route.view === "water") {
      document.title = group.name + " · " + G().viewLabel("water") + " | " + (FP.brand?.product || "");
      const panel = $("#group-panel"), today = typeof FP.sb.today === "function" ? String(await FP.sb.today()).slice(0, 10) : null;
      if (current !== token) return;
      // SR1: `/water/round[?item=<round>]`: a coordinator enters a sampling round, or reopens one to correct it (wq-round.js)
      if (route.tab === "round" && FP.wqRound) { FP.wqPage?.close(); panel.replaceChildren(FP.wqRound.view(group, { sb: FP.sb, today, roundId: route.item || null })); }
      else { FP.wqRound?.close(); panel.replaceChildren(FP.wqPage.view(group, { sb: FP.sb, today: FP.demo?.active ? today : null, groups })); }
      panel.scrollTop = 0;
      return;
    }
    // CAP1: Records is a list, not a map: the group's captures (records.js), read as the person, with what this phone has not sent first
    if (route.view === "records") {
      document.title = group.name + " · " + G().viewLabel("records") + " | " + (FP.brand?.product || "");
      const panel = $("#group-panel");
      panel.replaceChildren(FP.records.view(group, { sb: FP.sb, item: route.item || null }));
      panel.scrollTop = 0;
      return;
    }
    // J2: Home is a launcher, not a map: search, the add actions, the sections and anything waiting (place-home.js), with none of the
    // group's own reads; a person with one place lands here, and Places opens a group here
    if (route.view === "home") {
      document.title = group.name + " · " + G().viewLabel("home") + " | " + (FP.brand?.product || "");
      const panel = $("#group-panel"), today = typeof FP.sb.today === "function" ? String(await FP.sb.today()).slice(0, 10) : G().isoDay(Date.now());
      if (current !== token) return;
      const home = { space: "group", place: group, sections: shownTabs, people: !!FP.peopleModel?.canSeeTab(group, groups), addCtx, sb: FP.sb, today,
        search: (view, q) => { pendingSearch = { view, q }; } };
      // MC1: on a computer a group's Home is its overview (group-overview.js: the numbers, the trends and the map, with Home's search);
      // a phone has its area map (PH1, above)
      // PH1: on a phone, Home is the group's area on a plain map: Locate me, what is near, and the + (phone-area.js)
      if (FP.phoneArea?.phone()) {
        FP.placeHome?.close(); FP.groupOverview?.close();
        $("#screen-group").dataset.home = "area";
        panel.replaceChildren(FP.phoneArea.view({ group, sb: FP.sb })); panel.scrollTop = 0; return;
      }
      FP.phoneArea?.close();
      const overview = !!FP.groupOverview && computer();
      $("#screen-group").dataset.home = overview ? "overview" : "launcher";
      if (overview) panel.replaceChildren(FP.groupOverview.view({ group, groups, person, sb: FP.sb, today, home }));
      else { FP.groupOverview?.close(); panel.replaceChildren(FP.placeHome.view(home)); }
      panel.scrollTop = 0;
      return;
    }
    // TIM1 (#409): a view that draws the map, with no map drawn or being drawn, starts the drawn-time clock here (after
    // sign-in, whatever screen came before); a second route while it is still drawing keeps the same clock
    if (route.view !== "manage" && !mapHandle) timing = T()?.begin("group", group.id) || null;
    const panel = $("#group-panel");
    panel.replaceChildren(el("p", { class: "group-status", role: "status" }, "Loading the group…"));
    const home = !["documents", "create", "manage"].includes(route.view), thisCtx = ctx;
    try {
      document.title = group.name + (route.view === "map" ? "" : " · " + G().viewLabel(route.view)) + " | " + (FP.brand?.product || "");
      // HOT1: the manage space opens from the group record alone (its group and role): it asks for no map and waits for no group load
      if (route.view === "manage") {
        const node = await FP.groupManage.view(group, route, { settings: G().canManage(group.role) ? () => settingsView(group) : null });
        if (current === token) { panel.replaceChildren(node); panel.scrollTop = 0; }
        return;
      }
      // The heavy map read starts at once, beside the light reads, and no view waits for it to show its panel: the map area is drawn when
      // the map arrives (or says it could not). Documents and Create need only the base reads; the Map view's cards need the extras too.
      const mapAsked = ensureMap(thisCtx), homeAsked = ensureHome(thisCtx);
      mapAsked.catch(() => {}); homeAsked.catch(() => {});
      const run = timing; mapAsked.then(() => run?.step("data"), () => {});   // TIM1: group_map back
      const data = await (home ? homeAsked : ensureBase(thisCtx));
      if (current !== token) return;
      panel.replaceChildren();
      // PM (5 Nov, PERF3b): the water-quality card loads on its own. Its sites read starts now, beside the map, and the card (the
      // group's answer, then B8's line once the map is drawn) is on the page at once; the map panel never waits on it.
      // GWQ1 (#457): it is the Map view's first card, above the standing answers, so a reader finds the sites and charts at once.
      if (route.view === "documents") { panel.append(documentsView(data)); setTimeout(() => takeSearch("documents", panel.querySelector("[data-doc-search]")), 60); }
      else if (route.view === "create") panel.append(createView(data));
      // UI2 (Josh): the launcher leads (above the map on a phone: find, the sections, Add), the map is secondary, and water quality
      // and recent changes come last, folded
      else { needsBlock(data, current); panel.append(...mapView(data), waterCard(data)); }
      panel.scrollTop = 0;
      const mapped = drawMap(data, current, mapAsked, homeAsked).catch(() => null);
      if (!home) return;   // Documents and Create: the map is drawn beside them when it arrives; nothing more of theirs depends on it
      await mapped;
      if (current !== token) return;
      const slot = panel.querySelector('[data-card="members"]');   // the group's own layers are known once the map is
      if (slot && data.map) slot.replaceWith(membersCard(data));
      if (entries.length) { const water = panel.querySelector('[data-card="water"]'); if (water?.before) water.before(layersCard()); else panel.append(layersCard()); }
    } catch (e) {
      if (current === token) panel.replaceChildren(el("p", { class: "group-status", role: "alert" }, "Couldn't load the group: " + (e.message || e)));
    }
  }

  // The map: its own surface in the space (the group is never drawn on a farm's map).
  async function drawMap(data, current, asked, extras) {
    const host = $("#group-map"), run = timing;
    host.hidden = false; $("#screen-group")?.classList?.remove("no-map");
    if (!mapHandle) host.replaceChildren(el("p", { class: "group-status", role: "status" }, "Loading the map…"));
    try { data.map = await asked; }
    catch {
      // HOT1: a map that failed or took too long is the map area's failure alone; the standing answers are already on the page
      if (current !== token) return;
      mapSettled(data, true);   // the water-quality answer waits for nothing more
      mapHandle?.destroy(); mapHandle = null; mapReady = null;
      host.replaceChildren(el("div", { class: "group-map-empty", "data-state": "failed", role: "alert" }, el("p", {}, "The group's map couldn't load just now. Reload the page to try again.")));
      return;
    }
    if (current !== token) return;
    await extras.catch(() => null);   // the reference sources (the map's popups); the map is drawn without them if they could not be read
    await FP.kinds?.ready;   // LK4: the kind registry (read once per page) orders and opens the map
    if (current !== token) return;
    if (data.map) data.map.sources = data.sources;
    if (!data.map?.extent) {
      mapSettled(data, true);
      mapHandle?.destroy(); mapHandle = null;
      // UI2: no empty box. The map area goes, and a group with a published map (Maps) has a card for it at the top of the cards
      host.replaceChildren(); host.hidden = true; $("#screen-group")?.classList?.add("no-map");
      if ($("#screen-group")?.dataset.view === "map") publishedCard(data, current);
      return;
    }
    if (mapHandle) return mapReady;   // already drawn, or being drawn: wait for it
    host.replaceChildren();
    // UI2 (Josh: a phone is for capturing and looking up; the map is for the bigger screen): on a phone the map is a short strip under
    // the launcher; one tap opens it, another puts it back
    const grow = el("button", { type: "button", class: "map-expand", "aria-pressed": "false", onclick: () => {
      const on = !!$("#screen-group")?.classList?.toggle("map-open");
      grow.setAttribute("aria-pressed", String(on)); grow.lastChild.textContent = on ? "Smaller map" : "Open the map";
      setTimeout(() => { surface?.resize?.(); if (data.map?.extent) surface?.frame?.(data.map.extent); }, 260);
    } }, FP.icon ? FP.icon("maps", 16) : null, el("span", {}, "Open the map"));
    $("#screen-group")?.classList?.remove("map-open");
    // LK4: the group opens quiet, from the kind registry (group-layers.js defaultShow)
    const show = FP.groupLayers.defaultShow(data.map, root.FP_CONFIG?.groupView);
    // the reference sources counted beside the draw (no geometry), for the Layers rows once the map is drawn
    const counts = readCounts(data.group);
    const handle = mapHandle = FP.blocks.render(host, { block: "map-scene", owner: { org: data.group.id }, options: { show } }, { read: () => data.map, level: 2 });
    mapReady = handle.ready.catch(() => null);
    const drawn = await mapReady;
    // the map belongs to the group, not the view: kept for later views unless the group itself changed meanwhile
    // APP2: a put-away map's late "nothing drawn" is no longer this open's to settle: it must not open a newer open's gate
    if (mapHandle !== handle || !drawn) { if (!drawn && current === token) mapSettled(data, true); return; }
    surface = drawn.surface || null; entries = drawn.entries || [];
    startParts(data, show, counts);
    host.append(grow);
    // a phone's short strip: the group framed in it (the map's opening frame is for a taller map)
    if (root.matchMedia?.("(max-width: 760px)").matches && data.map?.extent) surface?.atRest?.().then(() => { if (mapHandle === handle) surface?.frame?.(data.map.extent); });
    // LK2: looks that were not back when the map was drawn are applied to it when they come (none: nothing changes)
    data.map.lateStyles?.then((styles) => {
      if (mapHandle !== handle || !surface || !styles.length) return;
      data.map.styles = styles; surface.restyle?.(styles);
      // the rows of sources not read yet take their sentence from the looks now here, in place (a row on or being read keeps
      // its switch and state)
      for (const [key, e] of placeholders) {
        const rec = FP.layerStyle?.pick(styles, { sourceKey: key, theme: e.theme }), purpose = rec ? FP.layerStyle.purpose(rec) : null;
        if (purpose) e.purpose = purpose; else delete e.purpose;
      }
      renderLayerList();
    });
    // GE1b: Edit shape in a feature's popup (FP.shapeEditor; only with its trial switched on, so by default nothing changes).
    // The boundary to snap to: the group's area and the member farms' outlines as the map drew them.
    const own = surface;
    surface?.featureTools?.((hit, at) => (FP.shapeEditor ? FP.shapeEditor.tools(hit, at, { space: "group", owner: data.group.id, role: data.group.role, surface: own,
      boundary: () => [data.map?.extent, ...(data.map?.layers || []).filter((l) => l?.theme === "member_farms" || l?.id === "member-farms").flatMap((l) => l.features?.features || [])].filter(Boolean) }) : null));
    // TIM1 (#410): the map's style loaded and the group's outline first on screen, as steps of the route's run
    run?.step("style", surface?.styleLoadedAt?.() ?? undefined);
    surface?.outlineShown?.().then((at) => run?.step("outline", at));
    if (!wq && FP.wq && surface) {
      // one read of the group's sites, for the line and the answer alike (the answer then keeps to the group's own and ECan's)
      const sites = sitesFor(data);
      wq = FP.wq.create({ sb: FP.sb, farm: { id: data.group.id }, extent: data.map.extent, map: surface, provenance: (key, at) => FP.provenance.lineFor(data.map.sources, key, null, at),
        sitesRead: () => sites, keepView: true });   // APP2b: opening or closing the line never takes the camera from a person who moved it
      if (!wqAnswer) wqAnswer = answerCard(data, sites);
      // B8's line joins the water-quality card already on the page (the Map view), under the group's answer
      document.querySelector("#group-panel .group-wq-line")?.replaceChildren(wq.node);
      wq.ready.then(() => {
        const slot = document.querySelector(".group-sources");
        if (!slot) return;
        const open = slot.querySelector("details")?.open, node = sourcesNode();
        if (node && open) node.open = true;
        slot.replaceChildren(...(node ? [node] : []));
      });
    }
  }

  // UI2: a group with nothing in the older map model may still have a published map: one compact card leads to it. The list is the
  // one Maps reads (maps-view.js listMaps, kept for a minute, so opening Maps next reads nothing again).
  function publishedCard(data, current) {
    const panel = $("#group-panel"), owner = { org: data.group.id };
    const slot = el("section", { class: "group-card group-published", "data-card": "published" }, el("p", { class: "group-status", role: "status" }, "Looking for the group's map…"));
    if (panel.prepend) panel.prepend(slot); else panel.append(slot);
    Promise.resolve(FP.mapsView?.listMaps?.(owner) || []).then((maps) => maps, () => []).then((maps) => {
      if (current !== token) return;
      if (!maps.length) { slot.replaceChildren(el("h2", {}, "Map"), el("p", { class: "group-fine" }, "Nothing is mapped for this group yet.")); return; }
      const first = maps[0], one = maps.length === 1;
      slot.replaceChildren(el("div", { class: "published-thumb", "aria-hidden": "true" }, FP.icon("maps", 26)),
        el("div", { class: "published-text" }, el("h2", {}, one ? "This group's map" : "This group's maps"),
          el("p", {}, one ? first.title : maps.map((m) => m.title).join(", "))),
        el("a", { class: "published-open", href: FP.href(G().href(data.group.id, "maps", one ? first.id : null)) }, one ? "Open the map" : "Open the maps"));
    });
  }

  // ---- UI2: the Overview's launcher (its first block) -----------------------------------------------------------------------------
  // Josh: people open the app to get something or to do something, not to be told what to do. So the Overview leads with a search
  // (what it finds is the section's own search: Files and, for the roles People is for, People, with the words typed), the sections
  // people come for as calm tiles (Maps, Files, Events with the next event, People), and the Add actions shown openly (the same
  // registry as the + button). Then, only when there is something, one quiet "Waiting" line of links. Reads: none new. The next
  // event (group_events, at most one, for any member) and, for People's roles, the follow-ups due (crm_feed_count, as People's
  // Follow-ups count them) and the open register questions (the proposals count People makes). The group's own obligations
  // come from the group load the page already made.
  const DO_LABEL = { file: "Add a file", event: "Add an event", interaction: "Log a call or visit", person: "Add a person" };
  let pendingSearch = null;   // { view, q }: the words typed in the Overview's search, for the section it opens
  // PH2: the bar's Search on a phone: Home's search (the same box, over the same lists, with the same reads) in a sheet that takes the
  // screen; a result opens its section as on Home, and the sheet closes with the move
  function searchSheet(opener, group, tabs) {
    if (!FP.sheet || !FP.placeHome) return;
    const home = { space: "group", place: group, sections: tabs, people: !!FP.peopleModel?.canSeeTab(group, groups), addCtx, sb: FP.sb, today: G().isoDay(Date.now()),
      search: (view, q) => { pendingSearch = { view, q }; }, compact: true };
    const moved = () => FP.sheet.close(false);
    window.addEventListener("hashchange", moved, { once: true });
    FP.sheet.open({ opener, title: "Search", className: "fp-search", onClose: () => { window.removeEventListener("hashchange", moved); FP.placeHome.close(); },
      body: () => { const v = FP.placeHome.view(home); setTimeout(() => v.querySelector("input")?.focus(), 50); return v; } });
  }
  // The words typed on the Overview, put into the section's own search once it is drawn (Files: the documents block's search)
  function takeSearch(view, input) {
    if (pendingSearch?.view !== view) return;
    const q = pendingSearch.q; pendingSearch = null;
    if (!input || !q) return;
    input.value = q; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus();
  }
  function hideNeeds() { const n = $("#group-needs"); if (n) { n.hidden = true; n.replaceChildren(); } $("#screen-group")?.classList?.remove("has-needs"); }
  function needsBlock(data, current) {
    const box = $("#group-needs");
    if (!box) return;
    // (People's pieces follow the tab's own rule: in a sub-group, its parent's facilitators, advisors and admins too)
    const g = data.group, sb = FP.sb, views = addCtx?.views || [], people = !!FP.peopleModel?.canSeeTab?.(g, groups) && views.includes("people");
    const to = (view, tab = null) => FP.href(G().href(g.id, view, tab));
    // GET: the search
    const input = el("input", { type: "search", id: "launch-search", autocomplete: "off", spellcheck: "false", placeholder: people ? "Find a file, a member or a person" : "Find a file", "aria-label": "Find" });
    const results = el("ul", { class: "launch-results", hidden: true, "aria-label": "Where to look" });
    const go = (view, tab = null) => { pendingSearch = { view, q: input.value.trim() }; location.hash = to(view, tab); };
    const drawResults = () => {
      const q = input.value.trim();
      results.hidden = !q;
      if (!q) { results.replaceChildren(); return; }
      const words = q.toLowerCase().split(/\s+/), files = (data.documents || []).filter((d) => words.every((w) => String(d.title || "").toLowerCase().includes(w))).length;
      results.replaceChildren(
        el("li", {}, el("button", { type: "button", "data-launch": "documents", onclick: () => go("documents") }, FP.icon("files", 18),
          el("span", {}, el("b", {}, "Files"), el("small", {}, files ? FP.peopleModel.plural(files, "title matches", "titles match") : "Search every file for “" + q + "”")))),
        ...(people ? [el("li", {}, el("button", { type: "button", "data-launch": "people", onclick: () => go("people") }, FP.icon("people", 18),
          el("span", {}, el("b", {}, "People"), el("small", {}, "Members and people matching “" + q + "”"))))] : []));
    };
    input.addEventListener("input", drawResults);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) { e.preventDefault(); results.querySelector("button")?.click(); } });
    // GET: the sections people come for
    const tile = (key, label, icon, sub) => el("a", { class: "launch-tile", href: to(key), "data-launch-tile": key }, el("span", { class: "launch-icon", "aria-hidden": "true" }, FP.icon(icon, 22)),
      el("span", { class: "launch-text" }, el("b", {}, label), sub ? el("small", {}, sub) : null));
    const eventSub = el("small", {}, "");
    const tiles = [views.includes("maps") ? tile("maps", "Maps", "maps", "Published maps") : null, views.includes("documents") ? tile("documents", "Files", "files", "Plans, consents and maps") : null,
      views.includes("events") ? tile("events", "Events", "events", null) : null, people ? tile("people", "People", "people", "Members and people") : null].filter(Boolean);
    const eventsTile = tiles.find((t) => t.dataset.launchTile === "events");
    if (eventsTile) { eventsTile.querySelector(".launch-text").append(eventSub); eventSub.textContent = "Calendar"; }
    // DO: what this person may add here (add.js's registry), shown openly
    const acts = (addCtx ? FP.add?.available?.(addCtx) || [] : []).map((a) => el("button", { type: "button", class: "launch-do", "data-add-action": a.id, onclick: () => a.run(addCtx) },
      FP.icon(a.icon, 18), el("span", {}, DO_LABEL[a.id] || "Add " + a.label.toLowerCase())));
    const waiting = el("p", { class: "launch-waiting", hidden: true });
    // on a phone the tab bar already leads to every section, so the tiles give way to one quiet row: the next event, when there is one
    const nextRow = el("a", { class: "launch-next", href: to("events"), hidden: true }, FP.icon("events", 18), el("span", {}), FP.icon("chevron", 16));
    $("#screen-group")?.classList?.remove("map-open");
    box.replaceChildren(el("div", { class: "launch-search" }, FP.icon("search", 18), input), results,
      ...(acts.length ? [el("div", { class: "launch-dos", role: "group", "aria-label": "Add" }, ...acts)] : []),
      el("nav", { class: "launch-tiles", "aria-label": "Sections" }, ...tiles), nextRow, waiting);
    box.hidden = false;
    $("#screen-group")?.classList?.add("has-needs");
    // Waiting: quiet links, only when there is something
    const items = [];
    const due = G().due(data.obligations, data.today);
    if (due.length) items.push({ order: 2, node: el("a", { href: "#group-due-card", onclick: (e) => { e.preventDefault(); const c = $("#group-due-card"); if (c) { c.open = true; c.scrollIntoView({ block: "start" }); } } },
      FP.peopleModel.plural(due.length, "obligation", "obligations") + " due") });
    const drawWaiting = () => {
      if (current !== token) return;
      const list = items.sort((a, b) => a.order - b.order).map((x) => x.node);
      waiting.hidden = !list.length;
      waiting.replaceChildren(...(list.length ? [el("span", { class: "launch-waiting-label" }, "Waiting"), ...list.flatMap((n, i) => (i ? [el("span", { "aria-hidden": "true" }, " · "), n] : [n]))] : []));
    };
    drawWaiting();
    const asks = [];
    if (people) {
      asks.push(Promise.resolve(sb.rpc("crm_feed_count", FP.peopleModel.feedArgs(g.id, { followUp: "due" }))).then((r) => {
        const n = Number(r?.data) || 0;
        if (!r?.error && n > 0) items.push({ order: 0, node: el("a", { href: to("people", "follow-ups"), "data-waiting": "follow-ups" }, FP.peopleModel.plural(n, "follow-up", "follow-ups") + " due") });
      }, () => {}));
      const R = FP.reviewItemsModel;
      if (R) asks.push(Promise.resolve(sb.from("proposals").select("id", { count: "exact", head: true }).eq("org_id", g.id).in("kind", R.KINDS).eq("status", "proposed")).then((r) => {
        const n = typeof r?.count === "number" ? r.count : Array.isArray(r?.data) ? R.openCount(R.items(r.data)) : 0;
        if (!r?.error && n > 0) items.push({ order: 1, node: el("a", { href: to("people", "review"), "data-waiting": "review" }, n + " to review") });
      }, () => {}));
    }
    if (eventsTile && FP.eventsModel) {
      asks.push(Promise.resolve(sb.from("group_events").select("id,title,starts_at,ends_at,all_day,cancelled_at").eq("org_id", g.id).is("cancelled_at", null)
        .gte("starts_at", new Date(Date.parse(data.today + "T00:00:00+13:00")).toISOString()).order("starts_at", { ascending: true }).range(0, 0)).then((r) => {
        const ev = (r?.error ? [] : r?.data || [])[0];
        if (current === token && ev) {
          const [, m, d] = FP.eventsModel.dayKey(ev.starts_at).split("-").map(Number), when = d + " " + FP.eventsModel.MONTHS[m - 1].slice(0, 3);
          eventSub.textContent = "Next: " + when + " · " + ev.title;
          nextRow.querySelector("span").replaceChildren(el("small", {}, "Next event"), el("b", {}, when + " · " + ev.title)); nextRow.hidden = false;
        }
      }, () => {}));
    }
    Promise.all(asks).then(drawWaiting);
  }

  // ---- Map view: the standing answers -------------------------------------------------------------------------------------
  function card(title, ...body) { return el("section", { class: "group-card" }, el("h2", {}, title), ...body); }
  // UI2: a card folded to its title (water quality, recent changes): opened with a tap, its contents already in the page
  function folded(title, ...body) { return el("details", { class: "group-card group-fold" }, el("summary", {}, el("h2", {}, title)), ...body); }
  // The group's sites (group_wq_sites), read once per group's context and on their own: the answer and B8's line share it.
  function sitesFor(data) {
    if (!data.sitesRead) { data.sitesRead = FP.sb.rpc("group_wq_sites", { g: data.group.id }).then((r) => { if (r.error) throw r.error; return r.data || []; }); data.sitesRead.catch(() => {}); }
    return data.sitesRead;
  }
  // The Water quality card: the group's written answer first (its own loading state while it works), then B8's line of sites
  // and its chart, which needs the map and joins the card when the map is drawn.
  function waterCard(data) {
    if (!wqAnswer) wqAnswer = answerCard(data, sitesFor(data));
    const box = folded("Water quality", ...(wqAnswer ? [wqAnswer.node] : []), el("div", { class: "group-wq-line" }, ...(wq ? [wq.node] : [])));
    box.dataset.card = "water";
    return box;
  }
  // MC1: the group's standing water-quality answer, as the Answer block (its loading state while the analysis function works).
  // Every figure is the analysis library's, computed now as this person (preview, nothing stored); the words are code's.
  // TIM1 (#410): the answer's analysis calls (four for HDLG) wait until the group's map is drawn, or can't be, so they never
  // share the database with the map's own reads and are not in `group-drawn`; the presets, sites and picks are read at once.
  // The wait is bounded (MAP_SETTLE_MS): a map that never settles never holds the answer back for longer.
  const MAP_SETTLE_MS = 15000;
  function mapSettled(data, now = false) {
    if (!data.mapSettled) {
      let open; data.mapSettled = new Promise((res) => { open = res; }); data.settleMap = open;
      const timer = setTimeout(open, MAP_SETTLE_MS); timer?.unref?.();
    }
    if (now) data.settleMap();
    return data.mapSettled;
  }
  // Each answer waits on the gate of the map draw it belongs to (taken when the answer is made). Manage puts the map and its
  // answer away and drops the gate: an answer put away never asks (its timer still fires once, and does nothing).
  const afterMap = (data) => { const gate = mapSettled(data); return (sb, body) => gate.then(() => (data.mapSettled === gate ? FP.wqAnalysis.request(sb, body) : new Promise(() => {}))); };
  function answerCard(data, sites) {
    if (!FP.groupWqAnswer || !FP.blocks) return null;
    const host = el("div", { class: "block-host group-wq-answer", "data-card": "wq-answer" });
    const A = FP.groupWqAnswer, request = afterMap(data);
    const handle = FP.blocks.render(host, { block: "answer", owner: { org: data.group.id }, options: { summary: true } },
      { read: () => sites.then((rows) => A.build({ sb: FP.sb, group: data.group, sites: rows, request })).then(A.answer), level: 3, nested: true, href: FP.href });
    handle.ready?.catch?.(() => {});
    return { node: host, destroy: () => handle.destroy() };
  }
  function membersCard(data) {
    const ownLayers = list(data.map?.layers).filter((l) => l.group_own);
    const box = card("Member farms", el("ul", { class: "group-lines" }, ...G().memberLines(data.summary, { hasOwnLayers: ownLayers.length > 0 }).map((t) => el("li", {}, t))),
      data.members.length ? el("p", { class: "group-fine" }, "Shown in detail: " + data.members.map((m) => m.name || "a member farm (not named)").join(", ") + ".") : null);
    box.dataset.card = "members";
    return box;
  }
  function mapView(data) {
    const members = membersCard(data);
    const due = G().due(data.obligations, data.today);
    const dueCard = folded("What's due", due.length
      ? el("ul", { class: "group-lines" }, ...due.map((d) => el("li", { class: d.overdue ? "overdue" : "" }, el("span", {}, d.text), el("small", {}, d.when))))
      : el("p", {}, "No obligations are recorded for the group itself. Member farms' obligations stay with each farm."));
    const changes = G().changed({ ownEntries: data.ownEntries, ownDocuments: data.documents, sharedEntries: data.sharedEntries, sharedDocuments: data.sharedDocuments,
      members: data.members, typeLabel: data.typeLabel, since: data.since });
    const changedCard = folded("What's changed (30 days)", changes.length
      ? el("ul", { class: "group-lines" }, ...changes.slice(0, 12).map((c) => el("li", {}, el("span", {}, c.text), el("small", {}, c.date + " · " + c.who))))
      : el("p", {}, "Nothing new from the group or shared by member farms in the last 30 days."));
    const out = [members];
    // UI2: the group's own obligations, folded (the launcher's Waiting line says how many are due and opens it)
    dueCard.id = "group-due-card"; dueCard.dataset.card = "due"; out.push(dueCard);
    if (G().canManage(data.group.role) && data.readiness) out.push(readinessCard(data.readiness, data.area));
    // DQ1's hook: what the last group load set aside, for the group's admins (the database decides what each person sees)
    if (G().canManage(data.group.role) && FP.ops?.groupGaps) { const gaps = el("div", { class: "group-gaps" }); FP.ops.groupGaps(gaps, data.group.id); out.push(gaps); }
    out.push(changedCard);
    return out;
  }
  // ON2: the onboarding readiness of member farms (group admins). Counts by readiness state and by finding type, as the
  // database returned them; a farm listed only at the level the group and the farm both allow.
  function readinessCard(result, area) {
    const r = G().readiness(result);
    const box = el("section", { class: "group-card group-readiness", "data-card": "readiness" }, el("h2", {}, "Onboarding readiness"),
      el("p", { class: "group-fine" }, "The onboarding report's checks, as last worked out for each member farm in group totals. Counts of farms; a farm is listed only where both the group and its owner allow it. Figures from fewer than " + G().K + " farms are never shown, and no farm's private files are read."),
      el("p", {}, r.summary),
      // ON3d: a farm's "to confirm" decisions are rows written when a farm editor opens its Onboarding view (FU3: said plainly here)
      el("p", { class: "group-fine", "data-readiness-note": "unopened" }, "A farm whose Onboarding view nobody has opened has no proposal rows yet, so its \"To confirm\" findings count as open until a farm editor opens it."));
    // RDY1: the figures are each farm's stored outcome; when one counts, and how many farms have none yet
    if (r.dateRule) box.append(el("p", { class: "group-fine", "data-readiness-note": "date-rule" }, r.dateRule));
    if (r.pending) box.append(el("p", { "data-readiness": "not-assessed" }, r.pending.text));
    // WQ4: the group's area, with what to do when it has none
    if (area) box.append(el("h3", {}, "Group area"), el("ul", { class: "group-lines" }, el("li", { "data-area": area.state },
      el("span", {}, area.text), el("small", {}, area.detail), ...(area.action ? [el("small", {}, "What to do: " + area.action)] : []))));
    if (r.empty) return box;
    box.append(el("h3", {}, "By readiness"), r.statesHeld
      ? el("p", {}, "Not shown: a state would count fewer than " + G().K + " farms, and the other states would give it away.")
      : el("ul", { class: "group-lines" }, ...r.states.map((s) => el("li", { "data-state": s.key }, s.text))));
    box.append(el("h3", {}, "What the checks found"), r.findings.length
      ? el("ul", { class: "group-lines" }, ...r.findings.map((f) => el("li", { "data-rule": f.rule }, f.text)))
      : el("p", {}, "Nothing open on any farm in group totals."));
    if (r.rows.length) box.append(el("h3", {}, "Farms shown in detail"), el("ul", { class: "group-lines readiness-farms" }, ...r.rows.map((f) =>
      el("li", {}, el("span", {}, f.label + " · " + f.readiness),
        el("small", {}, f.notAssessed ? "No checks worked out yet" : (f.findings.join("; ") || "Nothing open") + (f.assessedOn ? " · as at " + f.assessedOn : ""))))));
    return box;
  }
  function layersCard() {
    return card("Layers", el("ul", { class: "group-layers" }, ...rowNodes()), el("div", { class: "group-sources" }, sourcesNode()));
  }
  // The card's rows, each with a line where another row has the same name (#411: HDLG lists "Land units" twice and "Farm plan:
  // features" six times): where it came from (FP.groupLayers.fromLine: the load's file and set), so a reader can tell them apart.
  function rowNodes() {
    const rows = layerRows(), layers = list(ctx?.data?.map?.layers), sources = list(ctx?.data?.map?.sources);
    const origin = (e) => {
      const l = e.layerIndex != null ? layers[e.layerIndex] : null;
      if (l) return { from: FP.groupLayers.fromLine(l), full: l.name || null };
      if (e.rivers) return { from: "From the shared river network", full: null };
      const s = e.section === "reference" ? sources.find((x) => x.key === e.key) || refs?.index?.find((x) => x.key === e.key) : null;
      return { from: s?.name ? "From " + s.name : null, full: s?.name || null };
    };
    const lines = FP.groupLayers.sameNameLines(rows.map((e) => (e.countsError ? { name: null } : { name: e.name, ...origin(e) })));
    const fromOf = new Map(rows.map((e, n) => [e, lines[n]]));
    // LK4: grouped by view (the registry's), each row once under its kind's view, then All layers, folded (FP.kinds.drawer);
    // the counts error under a Reference heading of its own
    const real = rows.filter((e) => !e.countsError), K = FP.kinds;
    if (!K?.drawer) return rows.map((e, n) => layerRow(e, lines[n]));
    for (const e of real) e.inputs = [];
    const tail = rows.some((e) => e.countsError) ? [el("li", { class: "group", "data-layer-section": "reference" }, "Reference"), countsError()] : [];
    return K.drawer(real, { el, row: (e) => layerRow(e, fromOf.get(e)), all: (every) => every.map((e) => layerRow(e, fromOf.get(e), !!K.primaryView(e.kind ?? K.kindOf(e.theme ?? e.key)))), tail });
  }
  // One row: a switch, the layer's name and what it is. PERF3b: a deferred layer says how many features it holds, and a row
  // has a line under it while it is read, when it couldn't be, or when too many are in view to draw ("Zoom in to see …").
  function layerRow(e, from = null, secondary = false) {
    if (e.countsError) return countsError();
    const own = new Set(list(ctx?.data?.map?.layers).filter((l) => l.group_own).map((l) => l.theme));
    const input = el("input", { type: "checkbox", role: "switch", ...(e.on ? { checked: true } : {}), onchange: (ev) => setRow(e, ev.target.checked) });
    e.inputs = [...(e.inputs || []).filter((i) => i.isConnected !== false), input];
    if (secondary) {
      const li = el("li", { "data-layer": e.deferred ? "deferred" : e.pending ? "pending" : e.section }, el("label", {}, input, el("span", {}, e.name)));
      return li;
    }
    e.input = input;
    const what = e.key === "member_farms" ? "shared by each farm, at the level both allow" : e.section === "farm" && own.has(e.key) ? "the group's own map" : e.section === "reference" ? "shared reference" : null;
    const sub = [what, e.deferred && e.count != null ? featureCount(e.count) : null].filter(Boolean).join(" · ");
    // LK1: what the layer is for, when its reviewed look says (a row with no record reads as before)
    const li = el("li", { "data-layer": e.deferred ? "deferred" : e.pending ? "pending" : e.section }, el("label", {}, e.input, el("span", {}, e.name), sub ? el("small", {}, sub) : null,
      from ? el("small", { class: "layer-from" }, from) : null, e.purpose ? el("small", { class: "layer-purpose" }, e.purpose) : null));
    rowState(e);
    return li;
  }
  // The card's rows: the group's own layers and the member farms, then a row per reference source by name (drawn already,
  // or read when switched on), then Rivers. A group has no titles of its own.
  function layerRows() {
    const drawnRefs = new Map(entries.filter((e) => e.section === "reference" && !e.rivers).map((e) => [e.key, e]));
    const refRows = (refs?.index || []).map((s) => drawnRefs.get(s.key) || placeholder(s));
    for (const [key, e] of drawnRefs) if (!refs?.has(key)) refRows.push(e);
    for (const e of refRows) if (FP.farmModel.behindRivers?.(e.key)) e.kind = null;   // LK4: behind Rivers (DM2): under All layers only
    return [...entries.filter((e) => e.section !== "reference" && e.key !== "titles"), ...(countsFailed ? [{ countsError: true }] : []), ...refRows, ...entries.filter((e) => e.rivers)];
  }
  // The reference sources could not be counted just now (not: the group has none): one line, with a way to read again.
  function countsError() {
    const retry = el("button", { type: "button", class: "link", onclick: () => {
      const data = ctx?.data, mine = parts;
      if (!data || !mine || retry.disabled) return;
      retry.disabled = true; retry.textContent = "Trying again…";
      readCounts(data.group).then((r) => { if (parts !== mine) return; countsFailed = r.failed; startReference(data, r.counts); renderLayerList(); });
    } }, "Try again");
    return el("li", { class: "layer-error", "data-layer-error": "reference-counts" }, el("small", { role: "status" }, FP.provenance?.COUNTS_FAILED || "Reference layers couldn't load just now."), retry);
  }
  // A reference source's row before its features are read: kept, so its switch and state last across the card's redraws.
  // (The group's sources are zones, catchments and monitoring sites: no consents, so no "Past consents" switch.)
  function placeholder(s) {
    if (!placeholders.has(s.key)) {
      // LK1: the source's sentence before it is read, from the reviewed look of the source or its theme
      const rec = FP.layerStyle?.pick(ctx?.data?.map?.styles, { sourceKey: s.key, theme: s.theme }), purpose = rec ? FP.layerStyle.purpose(rec) : null;
      placeholders.set(s.key, { key: s.key, name: FP.farmModel.layerName(s), sub: null, section: "reference", ids: [], on: false, pending: true, theme: s.theme ?? null,
        kind: FP.kinds?.refKindOf(s.theme) ?? null, ...(purpose ? { purpose } : {}) });
    }
    return placeholders.get(s.key);
  }
  // The Sources entry drawn again in place (kept open if it was open).
  function renderSourcesSlot() {
    const slot = document.querySelector(".group-sources");
    if (!slot) return;
    const open = slot.querySelector("details")?.open, node = sourcesNode();
    if (node && open) node.open = true;
    slot.replaceChildren(...(node ? [node] : []));
  }
  // The Layers card's list drawn again (the counts have come): the card itself stays where it is.
  function renderLayerList() {
    const ul = document.querySelector("#group-panel .group-layers");
    if (ul) ul.replaceChildren(...rowNodes());
    renderSourcesSlot();
  }
  // A switch. PERF3b: a deferred layer is read for the map in view, a reference source not read yet is read now (its
  // switch busy, on, until it has come); turning a row off never reads anything.
  function setRow(e, on, { stack = false } = {}) {
    if (!surface) return;
    // LK4: a shared context fill switched on switches the other off (one at a time by default); its row says what it replaced,
    // with Show both to stack them
    const all = layerRows().filter((x) => !x.countsError), off = on && !stack && FP.kinds ? FP.kinds.exclusiveOff(e.key, all, { stacked: stackOk }) : [];
    for (const o of all.filter((x) => off.includes(x.key))) setRow(o, false);
    surface.setVisible(e, on);
    checkRow(e, on);
    replacedNote(e, on ? all.filter((x) => off.includes(x.key)) : []);
    if (e.deferred && parts?.has(e.layerId)) { if (on) parts.show(e.layerId, surface.view?.() || null); else parts.hide(e.layerId); }
    else if (on && e.pending && refs) refs.want([e.key]);
    offIfTooMany(e);
    rowState(e);
    restack();
  }
  // LK4: every switch of a row (its view's, and All layers' while that is open) says what the row is
  function checkRow(e, on) { for (const i of e.inputs || (e.input ? [e.input] : [])) i.checked = on; }
  // Two shared context fills on at once: the one drawn second as outline and hatch, so the overlap reads.
  function restack() {
    if (!FP.kinds || !surface?.setStacked) return;
    const rows = layerRows().filter((x) => !x.countsError), second = FP.kinds.stackedKeys(rows);
    for (const x of rows) if (!x.rivers && FP.kinds.isContextFill(x.kind ?? FP.kinds.kindOf(x.theme), x.geometry || "polygon")) surface.setStacked(x, second.has(x.key));
  }
  function replacedNote(e, gone) {
    const label = e.input?.closest?.("label");
    label?.querySelector(".layer-replaced")?.remove();
    if (!label || !gone.length) return;
    const both = el("button", { type: "button", class: "link", onclick: (ev) => {
      ev.preventDefault?.();
      for (const o of gone) { stackOk.add(e.key + "|" + o.key); setRow(o, true, { stack: true }); }
      label.querySelector(".layer-replaced")?.remove();
    } }, "Show both");
    label.append(el("small", { class: "layer-replaced" }, FP.kinds.replacedLine([...new Set(gone.map((o) => o.name))]) + " · ", both));
  }
  // The row's line: "Loading…" (the switch busy), "Couldn't load just now", the zoom-in line, or "Too many to show here"
  // (a layer or source PERF3a could not bound: never drawn in part); nothing once drawn.
  function rowState(e) {
    if (!e.input) return;
    const deferred = !!e.deferred && !!parts?.has(e.layerId), source = !deferred && e.section === "reference" && !!refs?.has(e.key);
    // too many: any count, null included (PERF3c: a dense source's entry is truncated and not counted); undefined: not too many
    const many = tooManyOf(e), tooMany = many !== undefined;
    if (!deferred && !source && !tooMany) return;
    const st = tooMany ? "too-many" : deferred ? parts.state(e.layerId) : refs.state(e.key);
    const text = tooMany ? FP.groupLayers.tooManyLine(many) : deferred ? parts.line(e.layerId, e.name) : st === "loading" ? "Loading…" : st === "failed" ? "Couldn't load just now" : "";
    e.input.setAttribute("aria-busy", String(st === "loading"));
    const label = e.input.closest("label");
    let note = label?.querySelector(".layer-state");
    if (!text) { note?.remove(); return; }
    if (!note && label) { note = el("small", { class: "layer-state", role: "status" }); label.append(note); }
    if (note) { note.textContent = text; note.dataset.state = st; }
  }

  // A row whose layer or source came back truncated: its count (undefined when it is not), so its row says so, off.
  function tooManyOf(e) {
    if (e.truncated) return e.count ?? null;
    const entry = e.section === "reference" ? refs?.entry(e.key) : null;
    return FP.groupLayers.tooMany(entry) ? entry.feature_count ?? refs.index.find((s) => s.key === e.key)?.count ?? null : undefined;
  }
  // Nothing of it can be drawn: the switch reads off (the row's line says why).
  function offIfTooMany(e) {
    if (tooManyOf(e) === undefined) return;
    if (e.on) surface?.setVisible(e, false);
    checkRow(e, false);
  }

  // ---- The map's parts (PERF3b) ---------------------------------------------------------------------------------------------
  // How many features each served source has in the group's context (group_reference_counts, no geometry). {counts, failed}:
  // counts is null when the function isn't there (a database before PERF3a: group_map's own reference entries say instead).
  function readCounts(group) {
    return Promise.resolve(FP.sb.rpc("group_reference_counts", { g: group.id })).then((r) => (r?.error ? { counts: null, failed: !FP.farmReference.missing(r.error) }
      : { counts: r?.data && typeof r.data === "object" ? r.data : null, failed: false }), (e) => ({ counts: null, failed: !FP.farmReference.missing(e) }));
  }
  // Once the map is drawn: its deferred layers (the member blocks read now for the frame, simplified; the rest when switched
  // on), the read again on each rest of the map, the reference rows from the counts, and the idle read ahead.
  function startParts(data, show, counts) {
    dropParts();
    const run = timing;   // TIM1: the run this map's drawing belongs to (drawMap has just checked it is still the map shown)
    const cfg = root.FP_CONFIG?.groupView || {}, group = data.group.id, rows = (id) => entries.filter((e) => e.deferred && String(e.layerId) === id);
    const mine = parts = FP.groupLayers.create({ sb: FP.sb, group, layers: data.map.layers, max: cfg.maxFeatures || FP.groupLayers.MAX_FEATURES,
      onData: (id, features) => { if (parts === mine) for (const e of rows(id)) surface?.layerData?.(e, features); },
      onChange: (id) => {
        if (parts !== mine) return;
        for (const e of rows(id)) {
          // one failed layer never fails the group: nothing of it on the map, its switch reads off and its row says so;
          // the next switch reads it again
          if (mine.state(id) === "failed" && !mine.drawn(id) && e.on) { surface?.setVisible(e, false); checkRow(e, false); }
          rowState(e);
        }
      } });
    offMove = surface?.onMoveEnd?.(() => { if (parts === mine) mine.moved(surface.view()); }) || null;
    // a layer group_map could not bound (PERF3a: the member farms over its caps) is listed, off, "Too many to show here"
    for (const e of entries) if (e.truncated && e.on) surface?.setVisible(e, false);
    // the opening's deferred layers (the member blocks): right after the first paint, each once, simplified, for the box the
    // map frames (the group's area: where the map is flying to). Never whole (#375); truncated says to zoom in.
    const frame = FP.groupLayers.frameOf(data.map.extent);
    Promise.all(mine.opening(show).map((id) => mine.show(id, frame))).then((reads) => {
      if (parts === mine && reads.every((r) => r && !r.truncated)) groupDrawn(run);
    }).finally(() => { if (parts === mine) mapSettled(data, true); });
    counts.then((r) => {
      if (parts !== mine) return;
      countsFailed = r.failed;
      startReference(data, r.counts);
      renderLayerList();
      if (!r.failed) prefetchWhenIdle(cfg.prefetch);
    });
  }
  function startReference(data, counts) {
    refs?.destroy(); placeholders = new Map();
    const group = data.group.id;
    const mine = refs = FP.farmReference.create({ sb: FP.sb, farm: group, counts, sources: data.map.sources, preloaded: data.map.reference,
      context: (key) => FP.sb.rpc("group_reference_context", { g: group, source: key }),
      onArrive: (entry) => { if (refs === mine) arrive(entry); }, onChange: (key) => { if (refs === mine) changed(key); } });
  }
  // A source has come: it joins the scene on the map (the Map scene's addReference), shown as its row now says.
  function arrive(entry) {
    const e = placeholders.get(entry.key);
    if (!e?.pending || !surface?.addReference) return;
    if (FP.groupLayers.tooMany(entry)) { offIfTooMany(e); return; }   // PERF3a: over its caps, never a partial draw
    const drawn = surface.addReference(entry);
    if (!drawn) return;
    e.ids = drawn.ids; e.pending = false; e.order = drawn.order; e.geometry = drawn.geometry;
    surface.setVisible(e, e.on);
    restack();
  }
  // A source's state changed (reading, read, couldn't be read): its switch, its row and the Sources list.
  function changed(key) {
    const e = placeholders.get(key) || entries.find((x) => x.key === key && x.section === "reference");
    // nothing was drawn: the switch reads off, and the next switch reads it again
    if (e && refs.state(key) === "failed" && e.pending) { surface?.setVisible(e, false); checkRow(e, false); }
    if (e) { offIfTooMany(e); rowState(e); }
    renderSourcesSlot();
  }
  // After the group is drawn and the map is idle: the config list (groupView.prefetch), read ahead one at a time, never a
  // zone polygon; hidden until something switches them on.
  function prefetchWhenIdle(keys) {
    const mine = refs, wanted = Array.isArray(keys) ? keys : [];
    if (!mine || !wanted.length) return;
    const go = () => { if (refs === mine) mine.prefetch(wanted); };
    const idle = () => (typeof requestIdleCallback === "function" ? requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 500));
    Promise.resolve(surface?.atRest?.()).then(idle, idle);
  }
  // PERF3b (4), TIM1 (#409, #410): measured, not guessed. The group's area and member blocks on the map are the run's
  // `drawn` step, timed from when the group's route began loading (route-timing.js: never the page's start or the sign-in
  // screen, and dropped if the person left the group or went to Manage first); then the map at rest is its `idle`. Kept for
  // this tab for staff on Operations, with its steps, beside `farm-drawn`. A browser without the performance or storage
  // APIs just has no figure.
  function groupDrawn(run) {
    if (!run?.step("drawn")) return;
    Promise.resolve(surface?.whenIdle?.()).then(() => run.step("idle"), () => {});
  }
  const lastDrawn = () => T()?.last("group") ?? null;
  // The Sources entry (PROV1): the same call the farm's drawer makes. A results dataset is judged by the results the group's water-quality
  // line holds (heldBy), so the entry is drawn again once those sites are known. PERF3b: with the sources counted in the
  // group's context, read or not, so a line reads the same as when group_map carried every source; one that couldn't be
  // read just now says so.
  function sourcesNode() {
    const held = FP.provenance.heldBy(wq?.sites?.() || []);
    return FP.provenance.section(ctx?.data?.map?.sources, { keys: [...entries.filter((e) => e.section === "reference").map((e) => e.key), ...(refs ? refs.keys() : []), ...held.keys],
      loadedKeys: held.loadedKeys, asAt: held.asAt, region: ctx?.data?.group?.region, failedKeys: refs ? refs.failedKeys() : [], countsFailed });
  }

  // ---- Documents ---------------------------------------------------------------------------------------------------------------
  function documentsView(data) {
    const wrap = el("section", { class: "group-documents", "data-view": "documents" }, el("h2", {}, "Files"));
    const own = el("div", { class: "block-host documents-host" });
    wrap.append(own);
    // PH3: one file explorer: the group's own files in folders by kind, and what member farms shared as a folder of its own (read as before)
    const shared = () => data.sharedDocuments.map((d) => ({ ...d, attribution: G().attribution(d, data.members) }));
    // V5: the group's editors add files (the database's rule is the same: any role but plain member); staff who can edit mark a new issue as superseding an old one.
    const editable = G().canWrite(data.group.role), Files = FP.documentFiles, owner = { org_id: data.group.id };
    let handle = null;
    const store = {
      add: (item) => Files.addFile(FP.sb, owner, item, data.documents),
      move: (id, change) => Files.moveFile(FP.sb, id, change),
      supersede: (id, by) => Files.supersedeFile(FP.sb, id, by),
      download: (doc) => Files.downloadLink(FP.sb, doc),
      async changed(message) { data.documents = await groupDocuments(FP.sb, data.group.id); notice = message || null; handle?.refresh(); notice = null; },
    };
    handle = FP.blocks.render(own, { block: "documents", owner: { org: data.group.id }, options: { explorer: true } }, { read: () => ({ documents: data.documents, shared: shared(), canEdit: editable, canAdd: editable, canSupersede: editable && !!FP.ops?.isStaff?.(), notice }), level: 3, nested: true, href: FP.href, store });
    notice = null;
    wrap.addEventListener("click", async (e) => {
      const button = e.target.closest("[data-open-document]");
      const doc = button && [...data.documents, ...data.sharedDocuments].find((d) => d.id === button.dataset.openDocument);
      if (!doc?.storage_path) return;
      button.disabled = true;
      const { data: url, error } = await FP.sb.storage.from("documents").createSignedUrl(doc.storage_path, 3600);
      button.disabled = false;
      if (error || !url?.signedUrl) { button.textContent = "Couldn't open it"; return; }
      window.open(url.signedUrl, "_blank", "noopener");
    });
    return wrap;
  }

  // ---- Create → Monthly update ------------------------------------------------------------------------------------------------
  async function monitoringResults(data, period) {
    const sites = await optional(FP.sb.rpc("group_wq_sites", { g: data.group.id }));
    const out = [];
    for (const s of list(sites).slice(0, 8)) {
      const latest = await optional(FP.sb.rpc("wq_site_latest", { site: s.site_id }));
      for (const r of list(latest)) if (G().within(r.sampled_at, period)) out.push({ site_id: s.site_id, site: s.name, parameter: r.parameter, parameter_name: r.parameter_name,
        value_text: r.value_text ?? String(r.value), unit: r.unit, sampled_at: r.sampled_at, source_key: r.source_key, attribution: r.attribution, provisional: !!r.provisional });
    }
    return out;
  }
  // What member farms share, and how each may be attributed, read fresh (not the space's copy from when it opened).
  async function sharedNow(data) {
    const [shared, sharedDocs, members] = await Promise.all([read(FP.sb.rpc("group_shared_entries", { group_id: data.group.id })),
      read(FP.sb.rpc("group_shared_documents", { group_id: data.group.id })), read(FP.sb.rpc("group_member_farms", { g: data.group.id }))]);
    return { shared: list(shared), sharedDocs: list(sharedDocs), members: list(members) };
  }
  async function makeDraft(data, ym) {
    const period = G().monthPeriod(ym);
    const [summary, results, now] = await Promise.all([optional(FP.sb.rpc("group_member_summary", { g: data.group.id, p_from: period.from, p_to: period.to })),
      monitoringResults(data, period), sharedNow(data)]);
    return U().assemble({ group: { ...data.group, member_detail: summary?.member_detail || data.summary.member_detail }, period, members: now.members, summary: summary || {},
      ownEntries: data.ownEntries, sharedEntries: now.shared, ownDocuments: data.documents, sharedDocuments: now.sharedDocs, results,
      typeLabel: data.typeLabel, now: new Date().toISOString(), by: person?.email || null });
  }
  function createView(data) {
    const wrap = el("section", { class: "group-create", "data-view": "create" }, el("h2", {}, "Create"));
    if (!G().canWrite(data.group.role)) {
      wrap.append(el("p", {}, "A group facilitator, editor or admin makes the monthly update. Saved updates are in Files."));
      return wrap;
    }
    const month = el("input", { type: "month", id: "update-month", value: draft?.period.key || G().lastMonth(data.today), max: data.today.slice(0, 7) });
    const body = el("div", { class: "update-body", "aria-live": "polite" });
    const make = el("button", { type: "button", class: "primary", onclick: async () => {
      make.disabled = true; body.replaceChildren(el("p", { class: "group-status", role: "status" }, "Drafting from the month's records…"));
      try { draft = await makeDraft(data, month.value || G().lastMonth(data.today)); drawDraft(body, data); }
      catch (e) { body.replaceChildren(el("p", { role: "alert" }, "Couldn't draft the update: " + (e.message || e))); }
      make.disabled = false;
    } }, draft ? "Draft again" : "Draft the update");
    wrap.append(el("h3", {}, "Monthly update"),
      el("p", { class: "group-fine" }, "Drafted by code from the month's group records, what member farms shared with the group and the group's monitoring results. Every line shows its sources. Edit it here, then save it to the group's Files. Nothing is emailed and no AI is used."),
      el("div", { class: "update-controls" }, el("label", { for: "update-month" }, "Month "), month, make), body);
    if (draft) drawDraft(body, data);
    return wrap;
  }
  function drawDraft(body, data, stale = []) {
    const staleIds = new Set(stale.map((s) => s.id));
    const sections = draft.sections.map((s) => el("section", { class: "update-section" }, el("h4", {}, s.heading),
      el("ol", { class: "update-lines" }, ...s.lines.map((l) => {
        const text = el("textarea", { rows: "2", "aria-label": s.heading + " line", oninput: (ev) => U().edit(draft, l.id, ev.target.value) });
        text.value = l.text;
        return el("li", { class: "update-line" + (staleIds.has(l.id) ? " stale" : ""), "data-line": l.id }, text,
          el("small", {}, staleIds.has(l.id) ? "No longer shared with the group as drafted: remove or rewrite this line before saving." :
            (l.sources || []).length ? "Sources: " + l.sources.map((x) => x.kind.replace("_", " ")).join(", ") : l.own ? "Your own line." : "No source: a note."),
          el("button", { type: "button", class: "link", onclick: () => { U().remove(draft, l.id); drawDraft(body, data); } }, "Remove"));
      })),
      el("button", { type: "button", class: "link", onclick: () => { U().add(draft, s.key, ""); drawDraft(body, data); } }, "Add a line")));
    const save = el("button", { type: "button", class: "primary", onclick: () => saveDraft(body, data, save) }, "Save to Files");
    body.replaceChildren(el("h4", { class: "update-title" }, draft.title), ...sections,
      el("p", { class: "group-fine update-sharing" }, U().sharingNote(draft)), save);
  }
  // Save: read what is delivered now; a line whose source is no longer shared must go first; then the HTML file is stored
  // and registered as the group's document (org members only).
  async function saveDraft(body, data, button) {
    button.disabled = true;
    try {
      const [own, docs, now] = await Promise.all([
        read(FP.sb.from("entries").select("id").eq("org_id", data.group.id)), read(FP.sb.from("documents").select("id").eq("org_id", data.group.id)), sharedNow(data)]);
      const live = { entry: new Set(list(own).map((r) => r.id)), document: new Set(list(docs).map((r) => r.id)),
        shared_entry: new Map(now.shared.map((r) => [r.id, r.farm_id || null])), shared_document: new Map(now.sharedDocs.map((r) => [r.id, r.farm_id || null])),
        members: now.members };
      const stale = U().recheck(draft, live);
      if (stale.length) { drawDraft(body, data, stale); body.prepend(el("p", { role: "alert", class: "update-alert" }, stale.length + (stale.length === 1 ? " line relies" : " lines rely") + " on records no longer shared with the group as they were when drafted (a record withdrawn, or a farm no longer named). Remove or rewrite them, then save.")); return; }
      const author = person?.email || null, savedAt = new Date().toISOString();
      const html = U().render(draft, { savedAt, savedBy: person?.id || null, author });
      const bytes = new TextEncoder().encode(html), sha = await FP.documentsBlock.sha256Hex(bytes.buffer);
      const path = "org/" + data.group.id + "/" + sha + ".html";
      const up = await FP.sb.storage.from("documents").upload(path, new Blob([bytes], { type: "text/html" }), { contentType: "text/html", upsert: false });
      if (up.error && !/exist|duplicate|409/i.test(String(up.error.message || "") + (up.error.statusCode || ""))) throw up.error;
      const row = U().documentRow(draft, { sha256: sha, path, size: bytes.length, author, savedAt });
      const saved = await read(FP.sb.from("documents").insert(row).select("id").single());
      data.documents = [...data.documents, { ...row, id: saved?.id || "saved", created_at: savedAt }];
      notice = "Saved “" + draft.title + "” to the group's Files.";
      draft = null;
      location.hash = FP.href(G().href(data.group.id, "documents"));
    } catch (e) {
      body.append(el("p", { role: "alert", class: "update-alert" }, "Couldn't save the update: " + (e.message || e)));
    } finally { button.disabled = false; }
  }

  // ---- Settings (group admins): how member farms are shown; drawn in the manage space's Settings tab (ON3b) ------------------------
  // HOT1: it reads the setting itself when the tab opens (the group's member summary), with its own error line, and needs nothing of the
  // group's load or map.
  function settingsView(group) {
    const wrap = el("div", { class: "group-settings-wrap" }, el("p", { class: "group-status", role: "status" }, "Reading the current setting…"));
    Promise.resolve().then(() => FP.sb.rpc("group_member_summary", { g: group.id })).then((r) => { if (r.error) throw r.error; return r.data || {}; }).then(
      (summary) => wrap.replaceChildren(settingsForm(group, summary.member_detail || "aggregated")),
      (e) => wrap.replaceChildren(el("p", { class: "group-status", role: "alert", "data-state": "settings-failed" }, "Couldn't read how member farms are shown: " + (e?.message || e))));
    return wrap;
  }
  function settingsForm(group, current) {
    const form = el("form", { class: "group-settings" },
      el("fieldset", {}, el("legend", {}, "How member farms are shown to the group"),
        ...G().LEVELS.map((lv) => el("label", { class: "group-choice" }, el("input", { type: "radio", name: "member-detail", value: lv, ...(lv === current ? { checked: true } : {}) }),
          el("span", {}, G().LEVEL_TEXT[lv])))),
      el("p", { class: "group-fine" }, "This is the most the group shows. Each farm's owner chooses the most their farm allows, and a farm is shown at the lower of the two. Figures from fewer than " + G().K + " farms are never shown."),
      el("p", { class: "group-fine" }, "A record a farm owner shares with the group always shows its content and its exact location, whatever this setting; the setting decides only whether the group can tell which farm it came from."),
      el("p", { class: "group-fine" }, "The group's own layers, such as its member blocks layer, are the group's own map and are always shown."),
      el("button", { type: "submit", class: "primary" }, "Save"), el("p", { class: "group-status", role: "status" }));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const level = form.querySelector("input[name=member-detail]:checked")?.value, status = form.querySelector(".group-status");
      if (!level) return;
      const { error } = await FP.sb.rpc("set_group_member_detail", { g: group.id, level });
      if (error) { status.textContent = "Couldn't save: " + error.message; return; }
      status.textContent = "Saved. Member farms are now shown " + level + " where each farm allows it.";
      // the map and figures are read again at the new level, when the person goes to a view that draws them
      if (ctx?.group.id === group.id) ctx = { group: ctx.group };
      dropParts(); mapHandle?.destroy(); mapHandle = null; mapReady = null; wq?.destroy(); wq = null; wqAnswer?.destroy(); wqAnswer = null;
    });
    return form;
  }

  FP.groupSpace = { setGroups, find, open, close, load, lastDrawn, showLogo, groups: () => groups, hasPortfolio: null, mapTimeoutMs: MAP_TIMEOUT_MS, looksTimeoutMs: LOOKS_TIMEOUT_MS,
    surface: () => surface };   // GE1b: the group map's surface (the browser walk projects a block's corners with it)
})(typeof window === "undefined" ? globalThis : window);
