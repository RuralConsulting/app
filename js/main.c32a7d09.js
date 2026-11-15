// Screens and routing: sign in -> the farm (or the portfolio if there are several) -> the farm space.
// Routes: #/farm/<id>/home (J2: Home, the first section), #/farm/<id> (the Working map: the map and standing answers, RCL staff),
// #/farm/<id>/ask, /create and /documents; #/ops, #/ops/layers and #/ops/looks (RCL staff);
// #/group/<id> (a catchment group's space, S5: its Working map) and its /home, /documents, /create and /settings; #/account/qgis (the person's access
// keys for QGIS, QGIS1a).
// V6: a client gets the simple view (simple-view.js, the allow-list): every route is checked against it first.
// V8: #/privacy, the privacy and terms note (privacy.js), for everyone, signed in or not; asked once after sign-in per version.
(() => {
  const { $, $$, el, show, sb } = FP;
  let farms = [], allFarms = [], groups = [];
  // HV1: the farms the person reads only as a coordinator of a group they belong to: opened read only (from the group's People),
  // never among the person's own places; and the group last opened, which a member farm's back link returns to
  let memberFarms = [], lastGroup = null;
  // HV1: the farms read is bounded (every read of a large owner is): a coordinator also reads every member farm of their groups,
  // and this is well above any group's size
  const FARMS_CAP = 2000;
  let readyToRoute = false;
  // PERF3d: each start (and each sign-out) is a new run; an answer that arrives for an older run is dropped, never drawn or kept
  let run = 0;

  function msg(id, text) { $(id).textContent = text || ""; }

  function welcome(user) {
    $("#welcome-email").value = user?.email || "";
    $("#welcome-who").textContent = user?.email ? "Signing in as " + user.email + "." : "";
    show("screen-welcome"); $("#wp1").focus();
  }

  async function start() {
    readyToRoute = false;
    const mine = ++run, stale = () => mine !== run;
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
    FP.privacy.links();
    // CAP1: opened with no coverage, by the last person signed in on this phone (or with a session that can't be refreshed offline):
    // their groups as last read, so + and Photo work; captures are kept on the phone and sent once they are signed in again
    if (!FP.demo?.active && navigator.onLine === false) {
      const last = FP.captures?.lastPlaces();
      if (last && (!user || user.id === last.user.id) && last.groups.length) { startOffline(user, last); return; }
    }
    // V8: the privacy and terms note is open to everyone, signed in or not
    if (!user) { if (FP.privacy.isRoute(location.hash)) { FP.privacy.open(); return; } show("screen-signin"); $("#email").focus(); return; }
    // PERF3d: everything the start needs to know about the person is asked at once, as soon as the session is known (before, four
    // waves one after another). Only the asking moves: the answers are taken in the same order as before, each gate first, and
    // nothing read is drawn, kept or acted on until the gates before it have passed (startupReads, below; the reasoning per gate
    // is there). A start that stops at a gate, or is overtaken by a sign-out or another start, drops what it read.
    const reads = startupReads(user);
    if (!FP.demo?.active) {
      try { const needs = await reads.password; if (stale()) return; if (needs) { welcome(user); return; } }
      catch (e) { if (stale()) return; show("screen-signin"); msg("#signin-msg", e.message); return; }
    }
    // V8: the note, once, before anything else, for each version a person has not yet acknowledged (staff too). Never keeps
    // anyone out: a note or record that can't be read or written lets them in and asks again next time (privacy.js).
    await FP.privacy.gate(user, reads.privacy);
    if (stale()) return;
    for (const w of $$(".who")) w.textContent = FP.demo?.active ? "Demo advisor · fixture data" : `Signed in as ${user.email}`;
    // UI1: the account menus' round buttons carry the person's initials
    for (const i of $$(".account-initials")) i.textContent = FP.demo?.active ? "D" : FP.accountMenu.initials(user);
    $("#pw-email").value = user.email;
    // PERF1b: a link straight to one of the person's farms is followed as soon as the farms are known, so the farm's own reads
    // start before the group and staff answers are taken. V2: the staff flag goes on to the two-factor step, for staff only, and
    // only now, after the note (the step may enrol an authenticator); if it asks anything, nothing is routed until it is answered
    // (a farm a link already opened is closed first).
    const groupsRead = reads.groups, staffRead = Promise.resolve(FP.ops.checkStaff(user, reads.staff)).catch(() => false)
      .then((isStaff) => (stale() ? false : FP.twoFactor?.gate(isStaff, () => FP.farmSpace.close())));
    const [{ data, error }, ownRows] = await Promise.all([reads.farms, reads.own]);
    if (stale()) return;
    if (error) { show("screen-farms"); msg("#farms-msg", error.message); return; }
    const split = FP.farmModel.splitFarms(data, ownRows);
    allFarms = split.own; farms = split.own; memberFarms = split.member;
    FP.farmSpace.setPortfolio(farms, user);
    FP.ops.showLinks?.();   // the farm space's header exists now: its Operations link as the staff read says (or will)
    const early = FP.twoFactor?.asking() ? null : farmLink();
    // V6: a link the simple view would not open as it stands waits for the staff flag (a staff sign-in is never sent away from
    // it); a link to a client's own Files or Maps opens at once, and is drawn again below if the person turns out to be staff.
    if (early && FP.simpleView.on() && FP.simpleView.gate(routed()).action !== "open") { await staffRead; if (stale()) return; }
    const earlySimple = FP.simpleView.on();
    if (early) { readyToRoute = true; route(); }
    const read = await groupsRead;
    if (stale()) return;
    groups = read;
    FP.groupSpace.setGroups(groups, user);
    FP.placeHome?.setPlaces({ farms: allFarms, groups });   // J2: the places Home's search may lead to
    FP.groupSpace.hasPortfolio = () => farms.length + groups.length > 1;
    FP.captures?.signedIn(user, groups);   // CAP1: remembers the person's groups for an offline start, and sends what waits
    const asked = await staffRead;
    if (stale()) return;
    readyToRoute = true;
    if (early !== location.hash || asked) route();   // the farm already open stays as it is; anything else is routed now
    else if (earlySimple !== FP.simpleView.on()) route();   // V6: opened as the simple view, and the person turned out to be staff
  }
  // CAP1: the offline start. Nothing is read: the groups are the ones last read on this phone (names and roles), the simple view
  // applies (staff can't be confirmed), and each place's sections draw what they can. Back in range, everything starts properly.
  function startOffline(user, last) {
    const who = user || last.user;
    for (const w of $$(".who")) w.textContent = "Offline" + (who.email ? " · " + who.email : "");
    for (const i of $$(".account-initials")) i.textContent = FP.accountMenu.initials(who);
    allFarms = []; farms = []; groups = last.groups;
    FP.farmSpace.setPortfolio(farms, who);
    FP.groupSpace.setGroups(groups, who);
    FP.placeHome?.setPlaces({ farms: [], groups });
    FP.groupSpace.hasPortfolio = () => groups.length > 1;
    FP.captures.offline(who);
    // (the staff flag can't be read offline, so J2c's landing would give Places: a bare address opens the person's first group instead)
    if (!location.hash || location.hash === "#" || location.hash === "#/") history.replaceState(null, "", FP.groupModel.href(groups[0].id, "home"));
    readyToRoute = true;
    route();
    window.addEventListener("online", () => start(), { once: true });
  }
  // The address names one of the person's farms (a view of it): followed before the groups and the staff flag are known.
  const routed = () => (FP.demo?.active ? FP.demo.routeHash(location.hash) : location.hash);
  function farmLink() {
    const hash = routed(), r = hash && FP.farmModel.match(hash);
    return r && allFarms.some((f) => f.id === r.farm) ? location.hash : null;
  }

  // PERF3d: the start-up reads, all asked at once. Each is a read the person makes anyway, of their own rows under their own
  // row-level rights, with the same columns and limits as before; none writes. Asking early breaches no gate, because each gate
  // is about what is SHOWN or DONE, not about what the database lets this session read, and start() takes the answers in order:
  //  - Setting a password (an invitation or recovery link): the link's session already reads exactly these rows (the database
  //    has no rule that waits for the password); the gate makes sure the person chooses one before using the app. While it is
  //    asked, nothing read here is drawn or kept: start() stops at the welcome screen and a new start (after the password is
  //    set) reads afresh.
  //  - The privacy note: it says how the person's data is handled and never keeps anyone out; the reads below fetch only the
  //    person's own memberships and flag into their own browser. Nothing is drawn, remembered on the phone (the offline places)
  //    or sent (waiting captures) until I understand; the acknowledgement itself is written only then, as before.
  //  - Two-factor (staff): only the staff flag is read early. The step itself (which may enrol an authenticator) still starts
  //    after the note, and publishing is closed by the database to any session without the code, as before.
  // Each falls back exactly as it did when it was asked later; only the password check can fail, and start() says so as before.
  function startupReads(user) {
    const demo = !!FP.demo?.active;
    const password = demo ? null : FP.auth.needsPassword();
    password?.catch(() => {});   // (taken by start(); a start that stops before it never leaves it unhandled)
    return {
      password,
      privacy: FP.privacy.check(user),   // the note's file, then this person's row for its version
      // the farms (bounded: a coordinator also reads every member farm of their groups)
      farms: Promise.resolve(sb.from("farms").select("id, name, region, org_id").order("name").limit(FARMS_CAP)).then((r) => r, (e) => ({ error: e })),
      // HV1: beside it, the person's own farm rows, which tell their farms from the member farms a coordinator also reads. If they
      // can't be read, every farm read is taken as the person's own (as before HV1), so a coordinator's member farms would then show
      // in their Places: chosen so that nobody ever loses a farm of their own to a failed read
      // (bounded like the farms read)
      own: Promise.resolve(sb.from("farm_members").select("farm_id").eq("user_id", user.id).limit(FARMS_CAP)).then((r) => (r?.error ? null : r?.data || []), () => null),
      groups: readGroups(user),
      staff: FP.ops.readStaff(user),   // the staff flag's read alone: nothing is set or shown from it until checkStaff takes it
    };
  }

  // The catchment groups the person belongs to (S5), each with its organisation in the same read (PERF3d: PostgREST's embedded
  // select; the organisation comes under organisations' own policy, so it is exactly the row the second read used to fetch, and
  // tests/db/startup_groups_embed.test.sql checks the two agree). A failure here leaves the farms as they were.
  async function readGroups(user) {
    try {
      // LP1: with each group's parent (SG1's parent_org_id), so the home page puts sub-groups under their parent; a database
      // without the column is read as before
      const read = (columns) => sb.from("org_members").select(columns).eq("user_id", user.id);
      let { data: mine, error } = await read("org_id, role, organisations(id, name, slug, kind, parent_org_id)");
      if (error) ({ data: mine, error } = await read("org_id, role, organisations(id, name, slug, kind)"));
      if (error || !mine?.length) return [];
      return mine.filter((m) => m.organisations && m.organisations.kind === "catchment_group").map((m) => ({ ...m.organisations, role: m.role || null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch { return []; }
  }

  // Every screen put away, for the "not available" page.
  function closeAll() {
    FP.routeTiming?.cancel();
    FP.farmPlansDemo?.close(); FP.farmPlanDraft.close(); FP.gallery.close(); FP.tokens?.close();
    FP.ops.close(); FP.opsLayers.close(); FP.opsLooks?.close(); FP.groupSpace.close(); FP.farmSpace.close();
  }
  // The view a person's one farm or group opens on: its Home (J2), for clients (the first of the allow-list) and staff alike.
  const homeView = (space) => (FP.simpleView.on() ? FP.simpleView.landing(space) : "home");
  // V6: a client's Files is a plain list, with no farm or group map beside it.
  const markFiles = (view) => $("body").classList.toggle("simple-files", FP.simpleView.on() && view === "documents");

  function route() {
    if (!readyToRoute || FP.twoFactor?.asking()) return;
    const hash = routed();
    // V6: the simple view. Nothing below this runs for a route a client may not open.
    const simple = FP.simpleView.on();
    $("body").classList.toggle("simple-view", simple);
    $("body").classList.remove("simple-files");
    if (simple) {
      const gate = FP.simpleView.gate(hash);
      // (only into the person's own farm or group: anyone else's address falls through to their farms below, and a person with
      // none gets no hashchange routing, so a redirect would leave them on the screen they were on)
      if (gate.action === "go" && (gate.space === "farm" ? [...allFarms, ...memberFarms] : groups).some((p) => p.id === gate.id)) { location.replace(FP.href(gate.href)); return; }
      if (gate.action === "hidden") { closeAll(); FP.simpleView.notAvailable(gate, { farms: allFarms, groups }); return; }
    }    // V8: the privacy and terms note, for everyone (a client reaches it through the simple view's CLIENT_PAGES)
    if (FP.privacy.isRoute(hash)) { closeAll(); FP.privacy.open(); return; }
    // TIM1 (#409): Operations, Layers, the plan screens and the gallery don't close the group space; the group's drawn-time run
    // is dropped all the same, so a figure never takes in the time spent there
    // J2c: where the bare address (and so sign-in) opens: one place, a coordinator's own group, a farmer's one farm, or Places
    // (home-model.js landing). Decided only here, once the groups and the staff flag are read, so Places never shows first.
    // (a link to one of the person's own farms is that farm, never the landing; any other address the router cannot open falls back to it)
    // (HV1: a member farm's address, opened read only below, counts as one the router opens, so it never falls back to the landing)
    const ownFarm = ((r) => !!r && (allFarms.some((f) => f.id === r.farm) || memberFarms.some((f) => f.id === r.farm)))(FP.farmModel.match(hash));
    const land = FP.homeModel.landing(hash, { farms: allFarms, groups, staff: FP.ops.isStaff(), staffKnown: !!FP.ops.staffKnown?.() });
    const toGroup = !!FP.groupModel.match(hash) || (land.to === "group" && !ownFarm);
    if (!toGroup) FP.routeTiming?.cancel("group");
    // The Farm Environment Plan and Freshwater Farm Plan documents, on the invented farm: only in the demo.
    if (FP.demo?.active && /^#\/plans(?:\?|$)/.test(hash || "")) { FP.farmSpace.close(); FP.ops.close(); FP.gallery.close(); FP.farmPlansDemo.open(hash); return; }
    FP.farmPlansDemo?.close();   // (PERF3a: the demo's code is loaded only in the demo)
    // A draft Freshwater Farm Plan (FW1), signed in: gap list first; Accept, Edit and Draft with AI. Never printed.
    const draft = !FP.demo?.active && /^#\/plan-draft\/([0-9a-f-]{36})$/.exec(hash || "");
    if (draft) { FP.farmSpace.close(); FP.ops.close(); FP.gallery.close(); FP.farmPlanDraft.open(FP.sb, draft[1]); return; }
    FP.farmPlanDraft.close();
    // The block gallery: fixture data only, so only in the demo.
    if (FP.demo?.active && /^#\/blocks(?:\?|$)/.test(hash || "")) { FP.farmSpace.close(); FP.ops.close(); FP.gallery.open(hash); return; }
    FP.gallery.close();
    // Access keys for QGIS (QGIS1a): anyone signed in, for their own keys. Any other route clears a key shown once.
    if (hash === "#/account/qgis") { FP.farmSpace.close(); FP.ops.close(); FP.opsLayers.close(); FP.opsLooks?.close(); FP.tokens.open(); return; }
    FP.tokens?.close();
    // Operations: RCL staff only. Anyone else asking for it is simply taken to their farms.
    // Operations → Looks (LK2): a proposed layer look judged on two pictures, accepted or sent back with a note; RCL staff only.
    // Any other route takes its two maps away.
    if (hash === "#/ops/looks" && FP.ops.isStaff()) { FP.farmSpace.close(); FP.ops.close(); FP.opsLayers.close(); FP.opsLooks.open(); return; }
    FP.opsLooks?.close();
    if (hash === "#/ops" && FP.ops.isStaff()) { FP.farmSpace.close(); FP.opsLayers.close(); FP.ops.open(); return; }
    // Operations → Layers (LN1): the advisor notes on every layer, for RCL staff.
    if (hash === "#/ops/layers" && FP.ops.isStaff()) { FP.farmSpace.close(); FP.ops.close(); FP.opsLayers.open(); return; }
    // Layer notes (LN2): the same screen for a group's advisors and a farm's editors, scoped by their roles (the page offers nothing to a viewer).
    if (hash === "#/layers") { FP.farmSpace.close(); FP.ops.close(); FP.opsLayers.open(); return; }
    FP.ops.close(); FP.opsLayers.close();
    // A catchment group's space (S5); the bare address of a person who lands in a group (J2c) goes straight to it.
    const groupRoute = FP.groupModel.match(hash), group = groupRoute && FP.groupSpace.find(groupRoute.group);
    // PF1: People is the group's facilitators', advisors' and admins' only; decided here, with the group's role already read (this
    // runs only once the groups are known), so an address of People answers "not available" to anyone else and never to them
    if (group && groupRoute.view === "people" && !FP.peopleModel?.canSeeTab(group, groups)) { closeAll(); FP.simpleView.notAvailable({ space: "group", id: group.id }, { farms: allFarms, groups }); return; }
    if (group) lastGroup = group;   // HV1: the group a member farm opened from it goes back to
    if (group) { FP.farmSpace.close(); markFiles(groupRoute.view); FP.groupSpace.open(group, groupRoute); return; }
    const landed = land.to === "group" && !ownFarm && FP.groupSpace.find(land.id);
    if (landed) { const view = homeView("group"); lastGroup = landed; FP.farmSpace.close(); markFiles(view); FP.groupSpace.open(landed, { group: landed.id, view }); return; }
    FP.groupSpace.close();
    const route = FP.farmModel.match(hash);
    // the farm the address names, or the one the bare address lands on (one farm and no group, or a farmer's one farm in its group)
    const farm = (route && allFarms.find((f) => f.id === route.farm)) || (land.to === "farm" ? allFarms.find((f) => f.id === land.id) : null);
    if (farm) { const shown = route?.farm === farm.id ? route : { farm: farm.id, view: homeView("farm") }; markFiles(shown.view); FP.farmSpace.open(farm, shown); }
    // HV1: a member's farm the person reads as a coordinator of its group, opened only by its address (People's link), read only,
    // with a way back to the group they came from
    else if (route && memberFarms.some((f) => f.id === route.farm)) openMemberFarm(memberFarms.find((f) => f.id === route.farm), route, hash, simple);
    else listFarms();
  }
  function openMemberFarm(member, route, hash, simple) {
    const back = lastGroup ? { href: FP.groupModel.href(lastGroup.id, "people"), label: lastGroup.name } : null;
    // (a client's bare address of the farm goes to its landing, as for their own farm)
    const shown = simple && FP.simpleView.gate(hash).action !== "open" ? { ...route, view: homeView("farm") } : route;
    markFiles(shown.view); FP.farmSpace.open({ ...member, back }, shown);
  }

  // LP1: Places, a map of every farm and group the person can see, with search and a folded list (home.js); "#/places" always
  // opens it ("All places"). A person the bare address lands in a place (J2c) was taken there above; a person with none gets the plain note.
  function listFarms() {
    if (farms.length + groups.length) { FP.farmSpace.showPortfolio(); FP.home.show({ farms, groups }); return; }
    FP.farmSpace.close();
    msg("#farms-msg", FP.brand.no_farms_note);
    show("screen-farms");
  }

  // ---- events --------------------------------------------------------------------------------------
  // SI1 (sign-in first): the sign-in form's submit is signin.js's (it is on the page before the rest of the app); it starts the app through FP.main.
  FP.main = { start };

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
  // UI1: one handler for every Change password and Sign out, wherever the menu that holds it was drawn (the farm header's is made later)
  window.addEventListener("click", async (e) => {
    if (e.target.closest(".b-password")) { msg("#pw-msg", ""); show("screen-password"); $("#pw0").focus(); return; }
    if (!e.target.closest(".b-signout")) return;
    if (FP.demo?.active) { location.href = location.pathname + location.search; return; }
    // CAP1: says what has not been sent (it would be lost) and clears this person's captures from the phone; staying signed in is a choice
    if (FP.captures && !(await FP.captures.beforeSignOut())) return;
    FP.groupManage?.forget();   // ON3b: no group's queue outlives the sign-in
    await FP.auth.signOut(); location.hash = ""; location.reload();
  });
  FP.accountMenu?.wire($("#home-account-open"), $("#home-account-menu"));
  FP.accountMenu?.wire($("#group-account-open"), $("#group-account-menu"));
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

  window.addEventListener("hashchange", () => {
    if (FP.privacy.asking()) return;   // the first sign-in note waits for I understand
    if (farms.length || groups.length) route();
    // V8: signed out (or with no farm or group), the note opens from its link, and leaving it goes back to where the person was
    else if (FP.privacy.isRoute(routed())) FP.privacy.open();
    else if (!$("#screen-privacy").hidden) start();
  });
  // (PERF3d: a sign-out ends the run, so whatever its start-up reads bring back afterwards is dropped)
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") { readyToRoute = false; FP.routeTiming?.cancel(); run++; FP.farmSpace.close(); show("screen-signin"); } });

  // installable app: cache the app's own files (never farm data or sign-in) for fast, flaky-coverage starts (SI1: boot.js
  // registers sw.js once the page is up and quiet, never ahead of the first screen)
  FP.boot?.worker();

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



