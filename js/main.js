// Screens and routing: sign in -> the farm (or the portfolio if there are several) -> the farm space.
// Routes: #/farm/<id> (map and standing answers), #/farm/<id>/ask, /create and /documents; #/ops (RCL staff).
(() => {
  const { $, $$, el, show, sb } = FP;
  let farms = [], allFarms = [];
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
    const { data, error } = await sb.from("farms").select("id, name, region, org_id").order("name");
    if (error) { show("screen-farms"); msg("#farms-msg", error.message); return; }
    allFarms = data; farms = data;
    FP.farmSpace.setPortfolio(farms, user);
    await FP.ops.checkStaff(user);
    readyToRoute = true; route();
  }

  function route() {
    if (!readyToRoute) return;
    const hash = FP.demo?.active ? FP.demo.routeHash(location.hash) : location.hash;
    // The Farm Environment Plan and Freshwater Farm Plan documents, on the invented farm: only in the demo.
    if (FP.demo?.active && /^#\/plans(?:\?|$)/.test(hash || "")) { FP.farmSpace.close(); FP.ops.close(); FP.gallery.close(); FP.farmPlansDemo.open(hash); return; }
    FP.farmPlansDemo.close();
    // The block gallery: fixture data only, so only in the demo.
    if (FP.demo?.active && /^#\/blocks(?:\?|$)/.test(hash || "")) { FP.farmSpace.close(); FP.ops.close(); FP.gallery.open(hash); return; }
    FP.gallery.close();
    // Operations: RCL staff only. Anyone else asking for it is simply taken to their farms.
    if (hash === "#/ops" && FP.ops.isStaff()) { FP.farmSpace.close(); FP.ops.open(); return; }
    FP.ops.close();
    const route = FP.farmModel.match(hash);
    const farm = (route && allFarms.find((f) => f.id === route.farm)) || (farms.length === 1 ? farms[0] : null);
    if (farm) FP.farmSpace.open(farm, route?.farm === farm.id ? route : { farm: farm.id, view: "map" });
    else listFarms();
  }

  function listFarms() {
    if (farms.length) { FP.farmSpace.showPortfolio(); return; }
    FP.farmSpace.close();
    msg("#farms-msg", FP.brand.no_farms_note);
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

  window.addEventListener("hashchange", () => { if (farms.length) route(); });
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") { readyToRoute = false; FP.farmSpace.close(); show("screen-signin"); } });

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
        ...[["#/demo", "Advisor demo"], ["#/demo/empty", "Almost-empty farm"], ["#/demo/farmer", "Farmer demo"], ["#/demo/multi", "Two farms"], ["#/demo/ops", "Operations"], ["#/demo/blocks", "Blocks"], ["#/demo/plans", "Farm Environment Plan"]].map(([href, label]) => el("a", { href }, label)),
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



