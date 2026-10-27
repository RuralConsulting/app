// Screens and routing: sign in -> the farm (or a list if there are several) -> the map.
// Farms live at #/farm/<id> so a link opens straight to one.
(() => {
  const { $, $$, el, show, sb } = FP;
  let farms = [];
  let afterPassword = "farms";

  function msg(id, text) { $(id).textContent = text || ""; }

  async function start() {
    const user = await FP.auth.user();
    if (!user) { show("screen-signin"); $("#email").focus(); return; }
    for (const w of $$(".who")) w.textContent = FP.demo?.active ? "Demo advisor · fixture data" : `Signed in as ${user.email}`;
    $("#pw-email").value = user.email;
    const { data, error } = await sb.from("farms").select("id, name, region, org_id").order("name");
    if (error) { show("screen-farms"); msg("#farms-msg", error.message); return; }
    farms = data;
    $("#b-farms").hidden = farms.length < 2;
    route();
  }

  function route() {
    const hash = FP.demo?.active ? FP.demo.routeHash(location.hash) : location.hash;
    if (FP.demo?.active && hash == null) { listFarms(); return; }
    const planRoute = FP.plan.routes.match(hash);
    FP.plan.routes.cancel();
    if (planRoute) {
      const farm = farms.find((f) => f.id === planRoute.farm);
      if (farm) { FP.plan.routes.open(planRoute, farm); return; }
      listFarms(); return;
    }
    const m = hash.match(/^#\/farm\/([0-9a-f-]{36})$/);
    if (FP.demo?.active && hash === "") { listFarms(); return; }
    const farm = m ? farms.find((f) => f.id === m[1]) : farms.length === 1 ? farms[0] : null;
    if (farm) openFarm(farm.id);
    else listFarms();
  }

  function listFarms() {
    const ul = $("#farm-list");
    ul.replaceChildren(...farms.map((f) => el("li", {}, el("button", { type: "button", onclick: () => { location.hash = FP.href(`#/farm/${f.id}`); } },
      el("b", {}, f.name), el("span", {}, f.region ? f.region[0].toUpperCase() + f.region.slice(1) : "")))));
    msg("#farms-msg", farms.length ? "" : "No farms are shared with this login yet. Ask RCL to give you access.");
    show("screen-farms");
  }

  async function openFarm(id) {
    show("screen-map");
    afterPassword = "map";
    $("#farm-plans-link").href = FP.href(`#/farm/${id}/plans`);
    const note = $("#map-msg");
    note.hidden = false; note.textContent = "Loading the farm…";
    try {
      const view = await FP.farmMap.open(id);
      if (FP.plan.routes.match(FP.demo?.active ? FP.demo.routeHash(location.hash) || "" : location.hash)) return;
      FP.farmMap.resize();
      if (!view) { note.textContent = "This farm isn't shared with your login."; return; }
      note.hidden = true;
      document.title = `${view.farm.name} | Farm platform`;
      $("#farm-name").textContent = view.farm.name;
      $("#farm-sub").textContent = `${FP.ha(view.extentHa)} farmed`;
      layerList(view.entries);
    } catch (e) {
      note.textContent = `Couldn't load the farm: ${e.message || e}`;
    }
  }

  // the farm's standing layers first, then layers made for a job under that job's name
  function layerList(entries) {
    const item = (e) => {
      const box = el("input", { type: "checkbox", checked: e.on, onchange: (ev) => FP.farmMap.setVisible(e, ev.target.checked) });
      return el("li", {}, el("label", {}, box, el("span", {}, el("b", {}, e.name), e.sub ? el("small", {}, e.sub) : null)));
    };
    const items = entries.filter((e) => !e.job).map(item);
    const jobs = new Map();
    for (const e of entries.filter((e) => e.job)) {
      if (!jobs.has(e.job.id)) jobs.set(e.job.id, { job: e.job, entries: [] });
      jobs.get(e.job.id).entries.push(e);
    }
    for (const { job, entries: es } of jobs.values()) {
      items.push(el("li", { class: "group" }, el("span", {}, "Made for: " + job.name)), ...es.map(item));
    }
    $("#layer-list").replaceChildren(...items);
  }

  // ---- events --------------------------------------------------------------------------------------
  $("#plan-print").addEventListener("click", () => window.print());
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
  function back() { if (afterPassword === "map") show("screen-map"), FP.farmMap.resize(); else listFarms(); }
  $("#b-pw-back").addEventListener("click", back);
  for (const b of $$(".b-password")) b.addEventListener("click", () => { msg("#pw-msg", ""); show("screen-password"); $("#pw0").focus(); });
  for (const b of $$(".b-signout")) b.addEventListener("click", async () => {
    if (FP.demo?.active) { location.href = location.pathname + location.search; return; }
    await FP.auth.signOut(); location.hash = ""; location.reload();
  });
  $("#b-farms").addEventListener("click", () => { location.hash = ""; afterPassword = "farms"; listFarms(); });

  $("#b-panel").addEventListener("click", () => {
    const panel = $("#panel");
    const open = panel.classList.toggle("closed") === false;
    $("#b-panel").setAttribute("aria-expanded", String(open));
  });
  if (window.innerWidth < 700) { $("#panel").classList.add("closed"); $("#b-panel").setAttribute("aria-expanded", "false"); }

  if (FP.basemaps.names.length < 2) $(".basemaps").hidden = true;
  for (const b of $$("[data-basemap]")) {
    b.addEventListener("click", () => {
      for (const o of $$("[data-basemap]")) o.setAttribute("aria-pressed", String(o === b));
      FP.farmMap.basemap(b.dataset.basemap);
    });
  }

  window.addEventListener("hashchange", () => { if (farms.length) route(); });
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") show("screen-signin"); });

  // installable app: cache the app's own files (never farm data or sign-in) for fast, flaky-coverage starts
  if (!FP.demo?.active && "serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  if (FP.demo?.active) {
    document.body.classList.add("demo-mode");
    for (const b of $$(".b-signout")) b.textContent = "Exit demo";
    const banner = el("aside", { class: "demo-banner", "aria-label": "Demonstration" },
      el("b", {}, "DEMO"), el("span", {}, "Synthetic data · Demo advisor · Illustrative map"),
      ...[["#/demo", "Map"], ["#/demo/farms", "Farms"], ["#/demo/plans", "Plans"], ["#/demo/plan", "Plan"]].map(([href, label]) => el("a", { href }, label)),
      el("a", { href: location.pathname + location.search }, "Exit"));
    document.body.prepend(banner);
    const reserveBanner = () => document.documentElement.style.setProperty("--demo-banner-height", banner.getBoundingClientRect().height + "px");
    reserveBanner();
    new ResizeObserver(reserveBanner).observe(banner);
    FP.demo.ready.then(start).catch((e) => { show("screen-farms"); msg("#farms-msg", e.message); });
  } else start();
})();


