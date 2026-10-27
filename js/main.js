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
    for (const w of $$(".who")) w.textContent = `Signed in as ${user.email}`;
    $("#pw-email").value = user.email;
    const { data, error } = await sb.from("farms").select("id, name, region").order("name");
    if (error) { show("screen-farms"); msg("#farms-msg", error.message); return; }
    farms = data;
    $("#b-farms").hidden = farms.length < 2;
    route();
  }

  function route() {
    const m = location.hash.match(/^#\/farm\/([0-9a-f-]{36})$/);
    const farm = m ? farms.find((f) => f.id === m[1]) : farms.length === 1 ? farms[0] : null;
    if (farm) openFarm(farm.id);
    else listFarms();
  }

  function listFarms() {
    const ul = $("#farm-list");
    ul.replaceChildren(...farms.map((f) => el("li", {}, el("button", { type: "button", onclick: () => { location.hash = `#/farm/${f.id}`; } },
      el("b", {}, f.name), el("span", {}, f.region ? f.region[0].toUpperCase() + f.region.slice(1) : "")))));
    msg("#farms-msg", farms.length ? "" : "No farms are shared with this login yet. Ask RCL to give you access.");
    show("screen-farms");
  }

  async function openFarm(id) {
    show("screen-map");
    afterPassword = "map";
    const note = $("#map-msg");
    note.hidden = false; note.textContent = "Loading the farm…";
    try {
      const view = await FP.farmMap.open(id);
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

  function layerList(entries) {
    $("#layer-list").replaceChildren(...entries.map((e) => {
      const box = el("input", { type: "checkbox", checked: e.on, onchange: (ev) => FP.farmMap.setVisible(e, ev.target.checked) });
      return el("li", {}, el("label", {}, box, el("span", {}, el("b", {}, e.name), e.sub ? el("small", {}, e.sub) : null)));
    }));
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
  for (const b of $$(".b-signout")) b.addEventListener("click", async () => { await FP.auth.signOut(); location.hash = ""; location.reload(); });
  $("#b-farms").addEventListener("click", () => { location.hash = ""; afterPassword = "farms"; listFarms(); });

  $("#b-panel").addEventListener("click", () => {
    const panel = $("#panel");
    const open = panel.classList.toggle("closed") === false;
    $("#b-panel").setAttribute("aria-expanded", String(open));
  });
  if (window.innerWidth < 700) { $("#panel").classList.add("closed"); $("#b-panel").setAttribute("aria-expanded", "false"); }

  for (const b of $$("[data-basemap]")) {
    b.addEventListener("click", () => {
      for (const o of $$("[data-basemap]")) o.setAttribute("aria-pressed", String(o === b));
      FP.farmMap.basemap(b.dataset.basemap);
    });
  }

  window.addEventListener("hashchange", () => { if (farms.length) route(); });
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") show("screen-signin"); });

  // installable app: cache the app's own files (never farm data or sign-in) for fast, flaky-coverage starts
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  start();
})();
