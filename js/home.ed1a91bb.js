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
  // (OV1: the map also says, as `areasFailed`, when the areas' own read failed, so a caller can tell a failed read from no outline)
  async function readShapes(sb, farms, groups) {
    const shapes = new Map();
    const put = (id, geom) => { const light = geom && H.lighten(geom); if (light) shapes.set(id, { ...light, pointZoom: H.pointZoom(light.bbox) }); };
    const farmIds = new Set(farms.map((f) => f.id)), groupIds = groups.map((g) => g.id);
    // (HV1: by id, since a group's coordinators also read their members' farms, which are not the person's own places)
    const farmRead = farmIds.size ? rows(sb.from("farm_summaries").select("id,extent").in("id", [...farmIds].slice(0, CAP.farms)).limit(Math.min(farmIds.size, CAP.farms))) : [];
    const areaRead = (async () => {
      if (!groupIds.length) return [];
      const where = (q) => q.eq("kind", "area").is("valid_to", null).in("org_id", groupIds);
      const n = await count(where(sb.from("places").select("id", { count: "exact", head: true })));
      if (n === 0) return [];
      const r = await Promise.resolve(where(sb.from("places").select("org_id,geom")).limit(Math.min(n ?? CAP.areas, CAP.areas))).catch(() => null);
      if (!r || r.error) { shapes.areasFailed = true; return []; }
      return r.data || [];
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
  // at: the group stepped into on the map (PL2: one level at a time), or null for the top level
  let list = [], shapes = new Map(), token = 0, chosen = null, bound = false, at = null, onMap = false, going = null;
  const $ = (s) => root.FP.$(s), el = (...a) => root.FP.el(...a);
  const wide = () => root.innerWidth > 800;
  // The map's edges the panel (and the card, once one is open) cover, so a place is framed in what stays visible.
  function padding() {
    const map = $("#map")?.getBoundingClientRect(), panel = $("#portfolio")?.getBoundingClientRect(), card = $("#home-card");
    if (!map || !panel) return { top: 60, left: 60, right: 60, bottom: 60 };
    const cardH = card && !card.hidden ? card.getBoundingClientRect().height + 16 : 0;
    // wide: the panel and the card share the left-hand column
    if (wide()) return { top: 60, right: 70, bottom: 50, left: Math.min(Math.max(panel.right, card && !card.hidden ? card.getBoundingClientRect().right : 0) - map.left + 40, map.width / 2) };
    // PL2b: a phone: the header bar along the top (the panel), the sheet (or the card in its place) along the bottom
    return { top: Math.min(panel.bottom - map.top + 24, map.height / 2), right: 40, bottom: Math.min(24 + Math.max(cardH, sheetHeight()), map.height / 3), left: 40 };
  }
  // ---- PL2b: on a phone, Places' search and list are a sheet along the bottom, as a group's Home has (phone-area.js peekSheet) -------
  // Closed ("peek"): its grabber and one row, "All places (n)" (and the way back out of a group stepped into). Pulled up ("half"): the
  // search and the list. A tap on the grabber or the row opens or closes it, a drag on either follows the finger and settles at the
  // nearer stop, Escape closes it. It lies over the map: the map's box never changes (map-keep.js: WebKit blanks a resized map).
  // searchOpen: Search was tapped (the sheet takes the screen, its box at the top, until the sheet next closes; a search typed does too)
  let sheetState = "peek", sheetDrag = null, sheetDragged = false, searchOpen = false;
  const markSearching = () => $("#home-sheet")?.classList.toggle("searching", sheetState === "half" && (searchOpen || !!$("#home-search")?.value.trim()));
  const sheetHeight = () => { const s = $("#home-sheet"); if (!s || wide() || $("#portfolio")?.hidden) return 0; const r = s.getBoundingClientRect(); return s.getClientRects().length ? Math.round(r.height) : 0; };
  function settle(next, { focus = false } = {}) {
    const s = $("#home-sheet"), grip = $("#home-grip");
    if (!s) return;
    sheetState = next; s.dataset.state = next; s.style.height = ""; s.classList.remove("dragging");
    if (next === "peek") searchOpen = false;
    markSearching();
    grip?.setAttribute("aria-expanded", String(next === "half"));
    grip?.setAttribute("aria-label", next === "half" ? "Show less of Places" : "Show all places");
    $("#home-peek-line")?.setAttribute("aria-expanded", String(next === "half"));
    // (in the tap itself: iOS raises the keyboard only for a focus made while handling the tap)
    if (focus) $("#home-search")?.focus({ preventScroll: true });
  }
  // The phone's pieces, made here rather than in index.html (the sign-in page's weight, SI1): the header's mark tile and round Search;
  // the sheet's grabber (Home's, capture.css .pa-grip) and its one row (Home's .pa-row: an icon, the words, the count, a chevron); the
  // card's grabber. A computer hides them (farm-space.css "PL2b").
  function build() {
    const icon = (name, size = 20) => root.FP.icon ? root.FP.icon(name, size) : "";
    const grip = (id, label, more = {}) => el("button", { type: "button", id, class: "home-grip pa-grip", "aria-label": label, ...more }, el("span", { class: "pa-grip-bar", "aria-hidden": "true" }));
    const title = $("#portfolio .home-title"), sheet = $("#home-sheet"), card = $("#home-card");
    if (!title || !sheet || $("#home-grip")) return;
    title.before(el("span", { class: "home-mark space-mark", "aria-hidden": "true" }, icon("map", 18)));
    title.after(el("button", { type: "button", id: "home-search-open", class: "home-search-open", "aria-label": "Find a farm or group", "aria-controls": "home-sheet-body" }, icon("search")));
    // ST1: RCL staff open on the list of their places (staff-home.js); from this map, one tap back to it. Shown to staff only (show()).
    title.after(el("a", { id: "home-to-list", class: "home-to-list", href: "#/places", "aria-label": "List of places", title: "List of places", hidden: true }, icon("list", 20)));
    sheet.prepend(grip("home-grip", "Show all places", { "aria-expanded": "false", "aria-controls": "home-sheet-body" }));
    $("#home-level").after(el("button", { type: "button", id: "home-peek-line", class: "home-peek-line pa-row", "aria-controls": "home-sheet-body" },
      el("span", { class: "pa-dot", "aria-hidden": "true" }, icon("map")), el("span", { class: "pa-text" }, el("b", {}, "All places")),
      el("span", { id: "home-peek-count", class: "pa-far" }), el("span", { class: "pa-chev", "aria-hidden": "true" }, icon("up", 16))));
    card?.prepend(grip("home-card-grip", "Show all places"));
  }
  function bindSheet() {
    const s = $("#home-sheet"), grip = $("#home-grip"), line = $("#home-peek-line");
    if (!s || !grip) return;
    const toggle = () => { if (sheetDragged) { sheetDragged = false; return; } settle(sheetState === "half" ? "peek" : "half"); };
    grip.addEventListener("click", toggle);
    line?.addEventListener("click", toggle);
    $("#home-search-open")?.addEventListener("click", () => { unchoose({ keepMap: true }); searchOpen = true; settle("half", { focus: true }); });
    $("#home-card-grip")?.addEventListener("click", () => { unchoose({ keepMap: true }); settle("half"); });
    s.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetState === "half" && !e.defaultPrevented && !e.target.value) { e.preventDefault(); e.stopPropagation(); settle("peek"); grip.focus(); } });
    // the drag (on the grabber or the one row): the finger is followed over the whole page once it is down
    const doc = root.document;
    const down = (e) => {
      if (e.button > 0 || wide()) return;
      const peekH = sheetState === "peek" ? s.getBoundingClientRect().height : (grip.offsetHeight + (line?.offsetHeight || 52) + 6);
      sheetDrag = { y: e.clientY, h: s.getBoundingClientRect().height, id: e.pointerId, moved: false, peek: peekH, half: Math.round(root.innerHeight * 0.6) };
      doc.addEventListener("pointermove", move, { passive: false }); doc.addEventListener("pointerup", up); doc.addEventListener("pointercancel", up);
    };
    const move = (e) => {
      const d = sheetDrag;
      if (!d || e.pointerId !== d.id) return;
      const dy = d.y - e.clientY;
      if (!d.moved) { if (Math.abs(dy) < 6) return; d.moved = true; sheetDragged = true; s.classList.add("dragging"); s.dataset.state = "half"; }
      s.style.height = Math.max(d.peek, Math.min(d.half + 24, d.h + dy)) + "px";
      d.last = { y: e.clientY, t: performance.now(), prev: d.last };
      e.preventDefault();
    };
    const up = (e) => {
      const d = sheetDrag;
      if (!d || e.pointerId !== d.id) return;
      sheetDrag = null;
      doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", up); doc.removeEventListener("pointercancel", up);
      if (!d.moved) return;
      const h = s.getBoundingClientRect().height, p = d.last?.prev, fast = p ? (p.y - d.last.y) / Math.max(16, d.last.t - p.t) : 0;
      settle(Math.abs(fast) > 0.6 ? (fast > 0 ? "half" : "peek") : (Math.abs(h - d.half) < Math.abs(h - d.peek) ? "half" : "peek"));
      setTimeout(() => { sheetDragged = false; }, 0);
    };
    for (const t of [grip, line].filter(Boolean)) t.addEventListener("pointerdown", down);
    // the map's scale and credit ride above the sheet (or the card), as on a group's Home
    const map = $("#map"), card = $("#home-card");
    if (map && typeof ResizeObserver !== "undefined") {
      const keep = () => map.style.setProperty("--home-sheet-h", (wide() ? 0 : Math.max(sheetHeight(), card && !card.hidden ? Math.round(card.getBoundingClientRect().height) : 0)) + "px");
      const ro = new ResizeObserver(keep);
      ro.observe(s); if (card) ro.observe(card);
      root.addEventListener("resize", keep);
    }
  }
  // UI2: the list's swatch is the place's colour on the map (its group's hue; a sub-group lighter; a farm its ink marker)
  function swatch(p) {
    const P = root.FP.mapPalette, css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    if (!P) return {};
    if (p.kind === "farm") return { style: "--swatch: " + css("--map-farm") };
    const hue = P.hues(css)[P.hueIndex(p.kind === "subgroup" && p.parentId ? p.parentId : p.id)];
    return { style: "--swatch: " + (p.kind === "subgroup" ? P.tone(hue, 0.3) : hue) };
  }
  function item(p, where, detail = null) {
    return el("li", { class: "home-item" + (p.within && where === "list" ? " sub" : ""), "data-kind": p.kind, "data-id": p.id },
      el("button", { type: "button", "data-home-place": p.id, "data-from": where }, el("i", { class: "home-swatch", "aria-hidden": "true", ...swatch(p) }),
        el("span", {}, el("b", {}, p.name), el("small", {}, detail ?? H.kindLabel(p)))));
  }
  // PL2: the list grouped, a group's sub-groups folded under it (its row first; a tap on the chevron shows them), one quiet line each
  // and no "Sub-group of …" repeated on every row. Search still finds every place by name.
  function drawList() {
    const subs = (p) => list.filter((x) => x.within === p.id && x.kind !== "farm").length;
    $("#home-list").replaceChildren(...H.grouped(list).map(({ place: p, children }) => {
      const li = item(p, "list", H.rowLabel(p, subs(p)));
      if (!children.length) return li;
      const id = "home-subs-" + p.id, open = children.some((c) => c.id === chosen);
      li.classList.add("has-subs");
      li.append(el("button", { type: "button", class: "home-expand", "aria-expanded": String(open), "aria-controls": id, "aria-label": "Show the " + children.length + " sub-groups of " + p.name }, el("i", { "aria-hidden": "true" })),
        el("ul", { class: "home-subs", id, ...(open ? {} : { hidden: true }) }, ...children.map((c) => item(c, "list", H.rowLabel(c)))));
      return li;
    }));
    $("#home-count").textContent = "(" + list.length + ")";
    const peek = $("#home-peek-count");
    if (peek) peek.textContent = String(list.length);
    $("#home-peek-line")?.setAttribute("aria-label", "All places, " + list.length);
  }
  // ---- PL2: the map shows one level: the top level, or the places inside the group stepped into ---------------------------------
  const mapItem = (p) => ({ id: p.id, kind: p.kind, name: p.name, hueKey: p.kind === "subgroup" && p.parentId ? p.parentId : p.id,
    logo: p.kind === "farm" ? null : root.FP.groupModel?.groupLogo?.({ slug: p.slug })?.src || null, ...shapes.get(p.id) });
  const placeOf = (id) => list.find((x) => x.id === id) || null;
  function drawLevel({ keep = false } = {}) {
    const g = at && placeOf(at), back = $("#home-level");
    if (back) {
      back.hidden = !g;
      if (g) {
        const up = g.within && placeOf(g.within);
        $("#home-level-back").textContent = up ? "Back to " + up.name : "Back to all places";
        $("#home-level-name").textContent = g.name;
      }
    }
    if (!onMap) return Promise.resolve();
    const items = H.level(list, at).filter((p) => shapes.has(p.id)).map(mapItem);
    const ctx = g && shapes.has(g.id) ? mapItem(g) : null;
    // TR1: Places is drawn at once from what it read last time and again when its read comes back, so a level asked for meanwhile may be
    // overtaken by a newer draw of the map: this waits for the newest draw to finish, so a caller sees the map as it now is
    const drawing = lastDraw = Promise.resolve(root.FP.farmMap.home(items, (id) => goThere(id), padding(), { context: ctx, frame: ctx?.bbox || null, keep }));
    return (async () => { let p = drawing; await p; while (lastDraw !== p) { p = lastDraw; await p; } })();
  }
  // PH5 (the owner, 14 Nov 2026: "just zoom to it smoothly"): a place tapped on the map is marked, the map eases to it, and then it
  // opens (its own space), with no card to approve first. MapLibre gives no click after a drag or a pinch, so neither opens anything.
  // The list and search still choose a place and show its card, with Open for the keyboard.
  async function goThere(id) {
    const p = placeOf(id);
    if (!p) return;
    const mine = token;
    if ((p.within || null) !== at) { at = p.within || null; await drawLevel(); if (mine !== token) return; }
    chosen = p.id; going = p.id;
    showCard(false);
    for (const b of document.querySelectorAll("[data-home-place]")) b.setAttribute("aria-current", String(b.dataset.homePlace === p.id));
    const open = () => { if (going === p.id && mine === token && document.body.classList.contains("portfolio-active")) root.location.hash = root.FP.href(H.openHref(p)); };
    if (handOver(p)) { open(); return; }
    const flying = root.FP.farmMap.homeGo?.(p.id, padding(), open);
    if (!flying) open();
  }
  // TR1 (the owner, 16 Nov 2026: "transitions are smooth from page to page map to map"): a group or sub-group opens at once, its outline
  // handed to the map it opens on (its own Home's map), which carries on from this map's picture and makes the one move into it
  // (map-handoff.js). A farm opens on this same map, which flies there itself (homeGo, as before).
  function handOver(p) {
    if (p.kind === "farm" || !root.FP.mapHandoff) return false;
    const s = shapes.get(p.id);
    root.FP.farmMap.homeMark?.(p.id);
    root.FP.mapHandoff.entering(s ? { id: p.id, kind: p.kind, geometry: s.geometry, bbox: s.bbox } : { id: p.id, kind: p.kind });
    return true;
  }
  // Into a group (its places shown, the group's own mark gone), or back out to where it sits
  async function step(to) {
    at = to || null;
    unchoose({ keepMap: true });
    await drawLevel();
  }
  function drawResults() {
    const q = $("#home-search").value, found = H.search(list, q);
    $("#home-results").replaceChildren(...found.map((p) => item(p, "search")));
    $("#home-results").hidden = !found.length;
    $("#home-none").textContent = q.trim() && !found.length ? "No farm or group matches “" + q.trim() + "”." : "";
    const clear = $("#home-clear");
    if (clear) clear.hidden = !(q.trim() && !found.length);
    $("#home-fold").hidden = !!q.trim();   // while searching, the matches stand in for the list
    markSearching();   // (a phone: a search typed takes the screen, its box at the top)
  }
  // A place chosen (on the map, in the list or in search): marked and framed on the map, and its card shown.
  // A place chosen from the list or search that is not at the level drawn takes the map to its level first (never both levels).
  async function choose(id, { focus = false } = {}) {
    const p = placeOf(id);
    if (!p) return;
    const mine = token;
    going = null;
    if ((p.within || null) !== at) { at = p.within || null; await drawLevel(); if (mine !== token) return; }
    chosen = p.id;
    $("#home-card-name").textContent = p.name;
    $("#home-card-kind").textContent = H.kindLabel(p);
    $("#home-card-note").hidden = shapes.has(p.id);
    $("#home-card-open").href = root.FP.href(H.openHref(p));
    $("#home-card-open").setAttribute("aria-label", "Open " + p.name);
    // a group with places inside it on the map: a quiet second action to step into it
    const inner = H.level(list, p.id).filter((x) => shapes.has(x.id)), into = $("#home-card-into");
    if (into) {
      into.hidden = !inner.length;
      into.textContent = inner.every((x) => x.kind === "subgroup") ? "Show its " + inner.length + " sub-group" + (inner.length === 1 ? "" : "s") : "Show the " + inner.length + " place" + (inner.length === 1 ? "" : "s") + " in it";
    }
    showCard(true);
    for (const b of document.querySelectorAll("[data-home-place]")) b.setAttribute("aria-current", String(b.dataset.homePlace === p.id));
    root.FP.farmMap.homeChoose?.(p.id, padding());
    if (focus) $("#home-card-open").focus();
  }
  // PL2b: on a phone the card of the place chosen takes the sheet's place along the bottom (CSS: #portfolio.has-card)
  function showCard(on) {
    $("#home-card").hidden = !on;
    $("#portfolio")?.classList.toggle("has-card", !!on);
    if (on) settle("peek");
    // inside a group stepped into, its way back out stays one tap away: on a phone the row goes onto the card while the card shows
    // (the sheet is put away then), and back to the sheet after
    const level = $("#home-level"), card = $("#home-card"), grip = $("#home-grip");
    if (level && card && grip) {
      if (on && !wide()) { if (level.parentElement !== card) $("#home-card-grip")?.after(level); }
      else if (level.parentElement !== grip.parentElement) grip.after(level);
    }
  }
  function unchoose({ keepMap = false } = {}) {
    chosen = null; going = null; showCard(false);
    for (const b of document.querySelectorAll("[data-home-place]")) b.setAttribute("aria-current", "false");
    if (!keepMap) root.FP.farmMap.homeChoose?.(null, padding());
  }
  function bind() {
    if (bound) return;
    bound = true;
    build();
    bindSheet();
    keepMap();
    $("#home-search").addEventListener("input", drawResults);
    $("#home-clear")?.addEventListener("click", () => { $("#home-search").value = ""; drawResults(); $("#home-search").focus(); });
    // RF1: on a phone the Places card spans the map's width and the map's controls (Locate, Aerial | Topo) stand below it, never
    // beside it: the card's bottom edge, kept as --portfolio-bottom on the map, however the card grows (search, the list opened)
    const panel = $("#portfolio"), map = $("#map");
    if (panel && map && typeof ResizeObserver !== "undefined") {
      // (from the top of the screen the panel and the map share: PERF3e's new-version line in WebKit lifts the map's own top above it,
      // nv-keep, and farm-space.css adds the line's height there)
      const keep = () => { const p = panel.getBoundingClientRect(), m = (panel.offsetParent || map).getBoundingClientRect(); map.style.setProperty("--portfolio-bottom", (panel.hidden || !p.height ? 0 : Math.max(0, Math.round(p.bottom - m.top))) + "px"); };
      new ResizeObserver(keep).observe(panel);
      root.addEventListener("resize", keep);
    }
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
      const fold = e.target.closest(".home-expand");
      if (fold) {
        const subs = document.getElementById(fold.getAttribute("aria-controls")), open = fold.getAttribute("aria-expanded") !== "true";
        fold.setAttribute("aria-expanded", String(open)); if (subs) subs.hidden = !open;
        return;
      }
      const b = e.target.closest("[data-home-place]");
      if (!b) return;
      const fromSearch = b.dataset.from === "search";
      if (fromSearch) { $("#home-search").value = b.querySelector("b").textContent; $("#home-results").hidden = true; }
      // a phone: the sheet goes back down, and the place chosen shows in its place (its card)
      // a click by keyboard (no pointer position) takes the focus to Open
      choose(b.dataset.homePlace, { focus: e.detail === 0 });
    });
    // (its own listener: on a phone the row sits on the card while a place's card shows)
    $("#home-level-back")?.addEventListener("click", () => { const g = at && placeOf(at); step(g?.within || null); });
    $("#home-card-close").addEventListener("click", () => { const back = chosen && $('#portfolio [data-home-place="' + CSS.escape(chosen) + '"]'); unchoose(); back?.focus(); });
    $("#home-card-into")?.addEventListener("click", () => { if (chosen) step(chosen); });
    // Escape: the card closes; with no card open, the map steps back out of the group it is in
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || !document.body.classList.contains("portfolio-active")) return;
      if (!$("#home-card").hidden) unchoose();
      else if (sheetState === "half" && !wide()) settle("peek");
      else if (at && !e.target.closest?.("input")) { const g = placeOf(at); step(g?.within || null); }
    });
  }
  // PL2b, the review of #571: in a browser built on WebKit a map whose box changes size after its first draw shows blank (map-keep.js), as
  // Places' did when the phone was turned. Its map is made again once the box has settled at its new size, at the same place and zoom,
  // with Places drawn on it again (as the group overview and Water quality do, #555, #560). Only while Places shows, never mid-move; the
  // farm's map on the same box is left to the farm space.
  let keeper = null;
  function keepMap() {
    const box = $("#map");
    if (keeper || !box || !root.FP.mapKeep?.watch) return;
    keeper = root.FP.mapKeep.watch(box, () => {
      if (!onMap || !document.body.classList.contains("portfolio-active") || document.documentElement.getAttribute("data-map-moving") === "on") return;
      const m = root.FP.farmMap.glMap?.(), cam = m && { center: m.getCenter(), zoom: m.getZoom() };
      if (!root.FP.farmMap.renew?.()) return;
      drawLevel({ keep: true }).then(() => { const n = root.FP.farmMap.glMap?.(); if (cam && n) n.jumpTo(cam); keeper?.made(); });
    });
  }
  // The home page: the farm space has already put its own things away and shown the map screen (farmSpace.showPortfolio).
  async function show({ farms = [], groups = [] } = {}) {
    const mine = ++token, sb = root.FP.sb;
    bind();
    document.title = "Farms and groups | " + (root.FP.brand?.product || "");
    chosen = null; going = null; at = null; onMap = false; showCard(false); $("#home-search").value = ""; drawResults();
    const toList = $("#home-to-list");
    if (toList) { toList.hidden = !root.FP.ops?.isStaff?.(); toList.href = root.FP.href("#/places"); }
    // wide screens open with the list showing; a phone opens with its sheet closed (the list is the sheet pulled up, never folded there)
    $("#home-fold").open = true;
    settle("peek");
    list = H.places(farms, groups); shapes = new Map();
    // TR1: arriving from another map (a place's Home, its Maps): this map takes its camera and picture and moves on from there
    // (map-handoff.js; nothing is handed over on a deep link or a reload, and Places opens directly, as before)
    const box = $("#map"), handed = box && root.FP.mapHandoff?.take({ box });
    root.FP.farmMap.renew?.();   // (WebKit only: the map, hidden while another screen showed, made again)
    keeper?.made();   // (the size it shows at now: a box that changed while another screen showed is not a turn of the phone)
    if (handed) root.FP.farmMap.arrive?.(handed);
    // TR1: the outlines read when Places was last shown this visit are drawn at once (the move out starts without waiting for the read);
    // the same read is made again below, and the map is drawn again only if what comes back differs (without moving the camera)
    const kept = held && held.key === placesKey(farms, groups) ? held : null;
    if (kept) { shapes = kept.shapes; onMap = true; }
    drawList(); drawLevel();
    const [found, parents] = await Promise.all([readShapes(sb, farms, groups).catch(() => new Map()), readParents(sb, groups).catch(() => ({}))]);
    if (mine !== token || !document.body.classList.contains("portfolio-active")) return;
    if (Object.keys(parents).length) { list = H.places(farms, groups, parents); drawList(); drawResults(); }
    held = { key: placesKey(farms, groups), shapes: found };
    if (kept && sameShapes(kept.shapes, found)) { shapes = found; return; }
    shapes = found;
    // PL2: the top level only (each top-level group one outline and one mark; its sub-groups appear once it is stepped into).
    // UI2: a sub-group is drawn in its parent's hue, lighter (map-palette.js)
    onMap = true;
    await drawLevel({ keep: !!kept });
  }
  // TR1: the outlines last read for this person's places, kept for this visit only (in memory), for the next time Places is shown
  let held = null, lastDraw = Promise.resolve();
  const placesKey = (farms, groups) => [...farms.map((f) => "f" + f.id), ...groups.map((g) => "g" + g.id)].sort().join(",");
  const sameShapes = (a, b) => a.size === b.size && [...a].every(([id, s]) => JSON.stringify(b.get(id)?.bbox) === JSON.stringify(s.bbox) && b.get(id)?.geometry?.coordinates?.length === s.geometry?.coordinates?.length);
  return { readShapes, readParents, show, CAP };
});
