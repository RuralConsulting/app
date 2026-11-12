// LP1: the home page. A map of every farm and group the person can see (main.js has already read them, under the existing
// policies), each drawn as its own light outline, or as a point when zoomed far out; a search box; a folded list in the plugin
// picker's order; and a small card for the place chosen, with Open to its space. The pure parts are home-model.js.
//
// Reads, all caller-scoped (row-level security decides what comes back) and bounded, a count first and then at most that many:
//   farm_summaries   id and extent only, for the person's farms (their count is the farms list main.js read under the same
//                    policies); the extent as the portfolio read it, simplified here
//   places           the groups' current area places (kind 'area'): counted, then their geometry (NZTM, as stored), simplified here
//   organisations    the names of sub-groups' parents the person is not a member of, where the database lets them read one
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(root, node ? require("./home-model.js") : root.FP.homeModel);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.home = api; }
})(typeof window === "undefined" ? globalThis : window, function (root, H) {
  const CAP = { farms: 500, areas: 500 };
  // A row count by a head request; null when it can't be read (the read below then takes the cap).
  async function count(query) {
    try { const { count: n, error } = await query; return !error && Number.isInteger(n) ? n : null; } catch { return null; }
  }
  const rows = (query) => Promise.resolve(query).then((r) => (r?.error ? [] : r?.data || []), () => []);
  // Each place's outline for the map: Map id -> { geometry, bbox, pointZoom }. A place with no outline is simply not in it.
  async function readShapes(sb, farms, groups) {
    const shapes = new Map();
    const put = (id, geom) => { const light = geom && H.lighten(geom); if (light) shapes.set(id, { ...light, pointZoom: H.pointZoom(light.bbox) }); };
    const farmIds = new Set(farms.map((f) => f.id)), groupIds = groups.map((g) => g.id);
    const farmRead = farmIds.size ? rows(sb.from("farm_summaries").select("id,extent").limit(Math.min(farmIds.size, CAP.farms))) : [];
    const areaRead = (async () => {
      if (!groupIds.length) return [];
      const where = (q) => q.eq("kind", "area").is("valid_to", null).in("org_id", groupIds);
      const n = await count(where(sb.from("places").select("id", { count: "exact", head: true })));
      if (n === 0) return [];
      return rows(where(sb.from("places").select("org_id,geom")).limit(Math.min(n ?? CAP.areas, CAP.areas)));
    })();
    const [farmRows, areaRows] = await Promise.all([farmRead, areaRead]);
    for (const r of farmRows) if (farmIds.has(r.id)) put(r.id, r.extent);
    const byGroup = new Map();
    for (const r of areaRows) if (r.geom) byGroup.set(r.org_id, [...(byGroup.get(r.org_id) || []), r.geom]);
    for (const [id, geoms] of byGroup) put(id, H.joinAreas(geoms));
    return shapes;
  }
  // The names of the parents of the person's sub-groups that are not among their own groups: id -> name, for those the database
  // lets them read (a parent they can't read leaves its sub-groups saying "Sub-group").
  async function readParents(sb, groups) {
    const mine = new Set(groups.map((g) => g.id)), wanted = [...new Set(groups.map((g) => g.parent_org_id).filter((id) => id && !mine.has(id)))];
    if (!wanted.length) return {};
    const found = await rows(sb.from("organisations").select("id,name").in("id", wanted).limit(wanted.length));
    return Object.fromEntries(found.filter((o) => wanted.includes(o.id)).map((o) => [o.id, o.name]));
  }

  // ---- in the browser ----------------------------------------------------------------------------------------------------
  let list = [], shapes = new Map(), token = 0, chosen = null, bound = false;
  const $ = (s) => root.FP.$(s), el = (...a) => root.FP.el(...a);
  const wide = () => root.innerWidth > 800;
  // The map's edges the panel (and the card, once one is open) cover, so a place is framed in what stays visible.
  function padding() {
    const map = $("#map")?.getBoundingClientRect(), panel = $("#portfolio")?.getBoundingClientRect(), card = $("#home-card");
    if (!map || !panel) return { top: 60, left: 60, right: 60, bottom: 60 };
    const cardH = card && !card.hidden ? card.getBoundingClientRect().height + 16 : 0;
    // wide: the panel and the card share the left-hand column
    if (wide()) return { top: 60, right: 70, bottom: 50, left: Math.min(Math.max(panel.right, card && !card.hidden ? card.getBoundingClientRect().right : 0) - map.left + 40, map.width / 2) };
    return { top: Math.min(panel.bottom - map.top + 24, map.height / 2), right: 40, bottom: Math.min(40 + cardH, map.height / 3), left: 40 };
  }
  const label = (p) => [el("b", {}, p.name), el("small", {}, H.kindLabel(p))];
  // UI2: the list's swatch is the place's colour on the map (its group's hue; a sub-group lighter; a farm its ink marker)
  function swatch(p) {
    const P = root.FP.mapPalette, css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    if (!P) return {};
    if (p.kind === "farm") return { style: "--swatch: " + css("--map-farm") };
    const hue = P.hues(css)[P.hueIndex(p.kind === "subgroup" && p.parentId ? p.parentId : p.id)];
    return { style: "--swatch: " + (p.kind === "subgroup" ? P.tone(hue, 0.3) : hue) };
  }
  function item(p, where) {
    return el("li", { class: "home-item" + (p.depth && where === "list" ? " sub" : ""), "data-kind": p.kind, "data-id": p.id },
      el("button", { type: "button", "data-home-place": p.id, "data-from": where }, el("i", { class: "home-swatch", "aria-hidden": "true", ...swatch(p) }), el("span", {}, ...label(p))));
  }
  function drawList() {
    $("#home-list").replaceChildren(...list.map((p) => item(p, "list")));
    $("#home-count").textContent = "(" + list.length + ")";
  }
  function drawResults() {
    const q = $("#home-search").value, found = H.search(list, q);
    $("#home-results").replaceChildren(...found.map((p) => item(p, "search")));
    $("#home-results").hidden = !found.length;
    $("#home-none").textContent = q.trim() && !found.length ? "No farm or group matches “" + q.trim() + "”." : "";
    $("#home-fold").hidden = !!q.trim();   // while searching, the matches stand in for the list
  }
  // A place chosen (on the map, in the list or in search): marked and framed on the map, and its card shown.
  function choose(id, { focus = false } = {}) {
    const p = list.find((x) => x.id === id);
    if (!p) return;
    chosen = p.id;
    $("#home-card-name").textContent = p.name;
    $("#home-card-kind").textContent = H.kindLabel(p);
    $("#home-card-note").hidden = shapes.has(p.id);
    $("#home-card-open").href = root.FP.href(H.openHref(p));
    $("#home-card-open").setAttribute("aria-label", "Open " + p.name);
    $("#home-card").hidden = false;
    for (const b of document.querySelectorAll("[data-home-place]")) b.setAttribute("aria-current", String(b.dataset.homePlace === p.id));
    root.FP.farmMap.homeChoose?.(p.id, padding());
    if (focus) $("#home-card-open").focus();
  }
  function unchoose() {
    chosen = null; $("#home-card").hidden = true;
    for (const b of document.querySelectorAll("[data-home-place]")) b.setAttribute("aria-current", "false");
    root.FP.farmMap.homeChoose?.(null, padding());
  }
  function bind() {
    if (bound) return;
    bound = true;
    $("#home-search").addEventListener("input", drawResults);
    $("#home-search").addEventListener("keydown", (e) => {
      const first = $("#home-results").querySelector("button");
      if (e.key === "Enter" && first) { e.preventDefault(); first.click(); }
      else if (e.key === "ArrowDown" && first) { e.preventDefault(); first.focus(); }
      else if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; drawResults(); }
    });
    $("#home-results").addEventListener("keydown", (e) => {
      const b = e.target.closest("button"), li = b?.closest("li");
      if (e.key === "ArrowDown") { e.preventDefault(); li?.nextElementSibling?.querySelector("button")?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (li?.previousElementSibling?.querySelector("button") || $("#home-search")).focus(); }
    });
    $("#portfolio").addEventListener("click", (e) => {
      const b = e.target.closest("[data-home-place]");
      if (!b) return;
      const fromSearch = b.dataset.from === "search";
      if (fromSearch) { $("#home-search").value = b.querySelector("b").textContent; $("#home-results").hidden = true; }
      // a phone: the open list covers most of the map, so it folds away to show the place chosen from it
      else if (!wide()) $("#home-fold").open = false;
      // a click by keyboard (no pointer position) takes the focus to Open
      choose(b.dataset.homePlace, { focus: e.detail === 0 });
    });
    $("#home-card-close").addEventListener("click", () => { const back = chosen && $('#portfolio [data-home-place="' + CSS.escape(chosen) + '"]'); unchoose(); back?.focus(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented && !$("#home-card").hidden && document.body.classList.contains("portfolio-active")) unchoose(); });
  }
  // The home page: the farm space has already put its own things away and shown the map screen (farmSpace.showPortfolio).
  async function show({ farms = [], groups = [] } = {}) {
    const mine = ++token, sb = root.FP.sb;
    bind();
    document.title = "Farms and groups | " + (root.FP.brand?.product || "");
    chosen = null; $("#home-card").hidden = true; $("#home-search").value = ""; drawResults();
    // wide screens open with the list showing; a phone keeps it folded under the search box
    $("#home-fold").open = wide();
    list = H.places(farms, groups); shapes = new Map();
    drawList();
    const [found, parents] = await Promise.all([readShapes(sb, farms, groups).catch(() => new Map()), readParents(sb, groups).catch(() => ({}))]);
    if (mine !== token || !document.body.classList.contains("portfolio-active")) return;
    if (Object.keys(parents).length) { list = H.places(farms, groups, parents); drawList(); drawResults(); }
    shapes = found;
    // UI2: a sub-group is drawn in its parent's hue, lighter (map-palette.js)
    const items = list.filter((p) => shapes.has(p.id)).map((p) => ({ id: p.id, kind: p.kind, name: p.name, hueKey: p.kind === "subgroup" && p.parentId ? p.parentId : p.id, ...shapes.get(p.id) }));
    await root.FP.farmMap.home(items, (id) => choose(id), padding());
  }
  return { readShapes, readParents, show, CAP };
});
