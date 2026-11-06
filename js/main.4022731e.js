// Screens and routing: sign in -> the farm (or the portfolio if there are several) -> the farm space.
// Routes: #/farm/<id> (map and standing answers), #/farm/<id>/ask, /create and /documents; #/ops and #/ops/layers (RCL staff);
// #/group/<id> (a catchment group's space, S5) and its /documents, /create and /settings.
(() => {
  const { $, $$, el, show, sb } = FP;
  let farms = [], allFarms = [], groups = [];
  let readyToRoute = false;

  function msg(id, text) { $(id).textContent = text || ""; }

  function welcome(user) {
    $("#welcome-email").value = user?.email || "";
    $("#welcome-who").textContent = user?.email ? "Signing in as " + user.email + "." : "";
    show("screen-welcome"); $("#wp1").focus();
  }

  async function start() {
    readyToRoute = false;
    // Arriving from an emailed link: take the sign-in it carries, clear it from the address bar, and (for an
    // invitation) ask for a password before anything else.
    const link = FP.demo?.active ? null : FP.auth.fromLink(location.hash);
    if (link) {
      history.replaceState(null, "", location.pathname + location.search);
      if (link.error) { show("screen-signin"); msg("#signin-msg", link.error); return; }
      const err = await FP.auth.acceptLink(link);
      if (err) { show("screen-signin"); msg("#signin-msg", err); return; }
      if (link.type === "invite" || link.type === "recovery") {
        welcome(await FP.auth.user()); return;
      }
    }
    const user = await FP.auth.user();
    if (!user) { show("screen-signin"); $("#email").focus(); return; }
    if (!FP.demo?.active) {
      try { if (await FP.auth.needsPassword()) { welcome(user); return; } }
      catch (e) { show("screen-signin"); msg("#signin-msg", e.message); return; }
    }
    for (const w of $$(".who")) w.textContent = FP.demo?.active ? "Demo advisor · fixture data" : `Signed in as ${user.email}`;
    $("#pw-email").value = user.email;
    // PERF1b: the farms, the person's memberships (then their organisations, only if there are any) and the staff flag
    // are read at once; a link straight to one of the person's farms is followed as soon as the farms are known, so
    // the farm's own reads start before the group and staff reads finish.
    const farmsRead = Promise.resolve(sb.from("farms").select("id, name, region, org_id").order("name")).then((r) => r, (e) => ({ error: e }));
    const groupsRead = readGroups(user), staffRead = Promise.resolve(FP.ops.checkStaff(user)).catch(() => false);
    const { data, error } = await farmsRead;
    if (error) { show("screen-farms"); msg("#farms-msg", error.message); return; }
    allFarms = data; farms = data;
    FP.farmSpace.setPortfolio(farms, user);
    FP.ops.showLinks?.();   // the farm space's header exists now: its Operations link as the staff read says (or will)
    const early = farmLink();
    if (early) { readyToRoute = true; route(); }
    groups = await groupsRead;
    FP.groupSpace.setGroups(groups, user);
    FP.groupSpace.hasPortfolio = () => farms.length + groups.length > 1;
    await staffRead;
    readyToRoute = true;
    if (early !== location.hash) route();   // the farm already open stays as it is; anything else is routed now
  }
  // The address names one of the person's farms (a view of it): followed before the groups and the staff flag are known.
  function farmLink() {
    const hash = FP.demo?.active ? FP.demo.routeHash(location.hash) : location.hash, r = hash && FP.farmModel.match(hash);
    return r && allFarms.some((f) => f.id === r.farm) ? location.hash : null;
  }

  // The catchment groups the person belongs to (S5). A failure here leaves the farms as they were.
  async function readGroups(user) {
    try {
      const { data: mine, error } = await sb.from("org_members").select("org_id, role").eq("user_id", user.id);
      if (error || !mine?.length) return [];
      const { data: orgs, error: e2 } = await sb.from("organisations").select("id, name, kind").in("id", mine.map((m) => m.org_id));
      if (e2) return [];
      return (orgs || []).filter((o) => o.kind === "catchment_group").map((o) => ({ ...o, role: mine.find((m) => m.org_id === o.id)?.role || null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch { return []; }
  }

  function route() {
    if (!readyToRoute) return;
    const hash = FP.demo?.active ? FP.demo.routeHash(location.hash) : location.hash;
    // TIM1 (#409): Operations, Layers, the plan screens and the gallery don't close the group space; the group's drawn-time run
    // is dropped all the same, so a figure never takes in the time spent there
    const toGroup = !!FP.groupModel.match(hash) || (!farms.length && groups.length === 1 && !FP.farmModel.match(hash));
    if (!toGroup) FP.routeTiming?.cancel("group");
    // The Farm Environment Plan and Freshwater Farm Plan documents, on the invented farm: only in the demo.
    if (FP.demo?.active && /^#\/plans(?:\?|$)/.test(hash || "")) { FP.farmSpace.close(); FP.ops.close(); FP.gallery.close(); FP.farmPlansDemo.open(hash); return; }
    FP.farmPlansDemo.close();
    // A draft Freshwater Farm Plan (FW1), signed in: gap list first; Accept, Edit and Draft with AI. Never printed.
    const draft = !FP.demo?.active && /^#\/plan-draft\/([0-9a-f-]{36})$/.exec(hash || "");
    if (draft) { FP.farmSpace.close(); FP.ops.close(); FP.gallery.close(); FP.farmPlanDraft.open(FP.sb, draft[1]); return; }
    FP.farmPlanDraft.close();
    // The block gallery: fixture data only, so only in the demo.
    if (FP.demo?.active && /^#\/blocks(?:\?|$)/.test(hash || "")) { FP.farmSpace.close(); FP.ops.close(); FP.gallery.open(hash); return; }
    FP.gallery.close();
    // Operations: RCL staff only. Anyone else asking for it is simply taken to their farms.
    if (hash === "#/ops" && FP.ops.isStaff()) { FP.farmSpace.close(); FP.opsLayers.close(); FP.ops.open(); return; }
    // Operations → Layers (LN1): the advisor notes on every layer, for RCL staff.
    if (hash === "#/ops/layers" && FP.ops.isStaff()) { FP.farmSpace.close(); FP.ops.close(); FP.opsLayers.open(); return; }
    // Layer notes (LN2): the same screen for a group's advisors and a farm's editors, scoped by their roles (the page offers nothing to a viewer).
    if (hash === "#/layers") { FP.farmSpace.close(); FP.ops.close(); FP.opsLayers.open(); return; }
    FP.ops.close(); FP.opsLayers.close();
    // A catchment group's space (S5); a person whose only place is one group goes straight to it.
    const groupRoute = FP.groupModel.match(hash), group = groupRoute && FP.groupSpace.find(groupRoute.group);
    if (group) { FP.farmSpace.close(); FP.groupSpace.open(group, groupRoute); return; }
    if (!farms.length && groups.length === 1 && !FP.farmModel.match(hash)) { FP.farmSpace.close(); FP.groupSpace.open(groups[0], { group: groups[0].id, view: "map" }); return; }
    FP.groupSpace.close();
    const route = FP.farmModel.match(hash);
    // one farm and no group: straight to it; with a group too, the portfolio lists both
    const farm = (route && allFarms.find((f) => f.id === route.farm)) || (farms.length === 1 && !groups.length ? farms[0] : null);
    if (farm) FP.farmSpace.open(farm, route?.farm === farm.id ? route : { farm: farm.id, view: "map" });
    else listFarms();
  }

  function listFarms() {
    // the catchment groups the person belongs to, under the farms (or alone, when there are no farms)
    const links = () => groups.map((g) => el("li", {}, el("a", { href: FP.href(FP.groupModel.href(g.id)) }, el("b", {}, g.name), el("small", {}, "Catchment group"))));
    for (const id of ["#portfolio-groups", "#farms-groups"]) { $(id).replaceChildren(...links()); $(id).hidden = !groups.length; }
    if (farms.length) { FP.farmSpace.showPortfolio(); return; }
    FP.farmSpace.close();
    msg("#farms-msg", groups.length ? "" : FP.brand.no_farms_note);
    show("screen-farms");
  }

  // ---- events --------------------------------------------------------------------------------------
  $("#f-signin").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button");
    btn.disabled = true; msg("#signin-msg", "");
    const err = await FP.auth.signIn($("#email").value, $("#password").value);
    btn.disabled = false;
    if (err) { msg("#signin-msg", err); return; }
    $("#password").value = "";
    start();
  });

  $("#f-welcome").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true; msg("#welcome-msg", "");
    const err = await FP.auth.setPassword($("#wp1").value, $("#wp2").value);
    btn.disabled = false;
    if (err) { msg("#welcome-msg", err); return; }
    $("#wp1").value = ""; $("#wp2").value = "";
    start();
  });

  $("#f-password").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true; msg("#pw-msg", "");
    const err = await FP.auth.changePassword($("#pw0").value, $("#pw1").value, $("#pw2").value);
    btn.disabled = false;
    if (err) { msg("#pw-msg", err); return; }
    for (const id of ["#pw0", "#pw1", "#pw2"]) $(id).value = "";
    msg("#pw-msg", "");
    alertDone();
  });
  function alertDone() {
    const p = $("#pw-msg");
    p.classList.add("ok"); p.textContent = "Password changed. Use the new one next time you sign in.";
    setTimeout(() => { p.classList.remove("ok"); p.textContent = ""; back(); }, 2500);
  }
  function back() { route(); }
  $("#b-pw-back").addEventListener("click", back);
  for (const b of $$(".b-password")) b.addEventListener("click", () => { msg("#pw-msg", ""); show("screen-password"); $("#pw0").focus(); });
  for (const b of $$(".b-signout")) b.addEventListener("click", async () => {
    if (FP.demo?.active) { location.href = location.pathname + location.search; return; }
    FP.groupManage?.forget();   // ON3b: no group's queue outlives the sign-in
    await FP.auth.signOut(); location.hash = ""; location.reload();
  });
  if (FP.basemaps.names.length < 2) $("#drawer-background").hidden = true;
  // Background and terrain live in the Layers drawer, under the farm's own layers (they are secondary).
  const pressed = (name) => { for (const o of $$("[data-basemap]")) o.setAttribute("aria-pressed", String(o.dataset.basemap === name)); };
  for (const name of FP.basemaps.names) {
    const b = FP.el("button", { type: "button", "data-basemap": name, "aria-pressed": String(name === "aerial") }, FP.basemaps.labels[name]);
    $(".basemaps").appendChild(b);
    b.addEventListener("click", async () => {
      pressed(name);
      try { await FP.farmMap.basemap(name); } catch { pressed("aerial"); FP.farmMap.basemap("aerial"); }
    });
  }
  if (!FP.basemaps.missingKey) {
    const t = $("#terrain-toggle"); $("#drawer-terrain").hidden = false; t.checked = FP.basemaps.terrainDefault();
    t.addEventListener("change", () => FP.farmMap.terrain(t.checked));
  }

  window.addEventListener("hashchange", () => { if (farms.length || groups.length) route(); });
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") { readyToRoute = false; FP.routeTiming?.cancel(); FP.farmSpace.close(); show("screen-signin"); } });

  // installable app: cache the app's own files (never farm data or sign-in) for fast, flaky-coverage starts
  if (!FP.demo?.active && "serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  if (FP.demo?.active) {
    document.body.classList.add("demo-mode");
    for (const b of $$(".b-signout")) b.textContent = "Exit demo";
    // Phone: one row ("DEMO", what it is, and a Demos button); the links to the other demos open under it.
    // Wide: the links stay in the row.
    const banner = el("aside", { class: "demo-banner", "aria-label": "Demonstration" },
      el("b", {}, "DEMO"), el("span", {}, "Synthetic data · Illustrative map"),
      el("button", { type: "button", class: "demo-switch", "aria-expanded": "false", "aria-controls": "demo-links" }, "Demos"),
      el("div", { id: "demo-links", class: "demo-links" },
        ...[["#/demo", "Advisor demo"], ["#/demo/empty", "Almost-empty farm"], ["#/demo/farmer", "Farmer demo"], ["#/demo/multi", "Two farms"], ["#/demo/group", "Catchment group"], ["#/demo/ops", "Operations"], ["#/demo/blocks", "Blocks"], ["#/demo/plans", "Farm Environment Plan"]].map(([href, label]) => el("a", { href }, label)),
        el("a", { href: location.pathname + location.search }, "Exit")));
    document.body.prepend(banner);
    const setDemoLinks = (open) => { banner.classList.toggle("open", open); banner.querySelector(".demo-switch").setAttribute("aria-expanded", String(open)); };
    banner.querySelector(".demo-switch").addEventListener("click", () => setDemoLinks(!banner.classList.contains("open")));
    document.addEventListener("click", (e) => { if (!e.target.closest(".demo-switch")) setDemoLinks(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && banner.classList.contains("open")) { setDemoLinks(false); banner.querySelector(".demo-switch").focus(); } });
    const reserveBanner = () => document.documentElement.style.setProperty("--demo-banner-height", banner.getBoundingClientRect().height + "px");
    reserveBanner();
    new ResizeObserver(reserveBanner).observe(banner);
    FP.demo.ready.then(start).catch((e) => { show("screen-farms"); msg("#farms-msg", e.message); });
  } else start();
})();



