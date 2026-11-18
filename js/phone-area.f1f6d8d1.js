// PH1: a group's Home on a phone (the owner, 13 Nov 2026: "simple load to area (group or subgroup), can quick locate to where I am
// (based on gps location), and then can either find local info (like a wq site to return to), or do an action from the plus symbol").
// A plain map of the group's area with almost nothing on it, one "Locate me" control (a dot and its accuracy ring at the phone's
// position), and below it one short list of what is near: the water quality sites the person may read, nearest first with the
// distance. Tapping a site shows it on the map and opens what Maps already shows for it (wq-sites.js's panel: its latest results,
// chart, band and trend). No layer switching. The + (add.js, capture-ring.js) floats above the list. The words are phone-model.js's.
//
// Reads: none new, and none wider. Each is one the app already makes, as the signed-in person (row-level security and the
// functions' own rules decide what comes back):
//   places (kind area)   the group's area, as Places reads it (home.js readShapes)
//   group_wq_sites       the group's sites, as Maps' water quality reads them (wq-sites.js), capped at phone-model READ_CAP rows
//   a site's results     only when the person opens one, through wq-sites.js's own reads (wq_site_latest, measurement_series, ...)
// HM1 (the owner, 14 Nov 2026: option A, "the map with a peek"): a thin sheet over the bottom of the map, above the bar, with ONE useful
// line (the next event, else the latest thing added, else the place's facts). Pulled half way up (a drag, or a tap on its handle): a
// search box for this place (place-home.js, compact), one quiet line of facts (the computer dashboard's figures, group-overview-model.js
// tiles), at most four rows of what is new or next, and the sub-groups. Its reads are each one another screen already makes, as the
// person, each bounded to one row or a head count, and only for a section the person may open:
//   group_events         the next one (Events; place-home.js's read)
//   captures             the newest one, and a head count of photos taken in the last week (Records; records.js's table and rules)
//   sampling_rounds      the newest one (Water quality; the group's coordinators only, wq-round.js's read)
//   proposals            a head count of questions to review (People's roles; place-home.js's read)
//   group_members        a head count (the group's coordinators; group-overview.js's read)
//   subgroup_counts and the areas   the map's names' own reads (below), shared
// MV2 (PRODUCT.md "One Map design"): the pulled-up sheet ends with what the map shows, in the Maps tab's order and words: "Sub-groups"
// (with its key) and, under Reference, "Shade outside the group" (kept on this device with a computer's Home). No new read.
(function (root) {
  const FP = root.FP;
  const P = () => FP.phoneModel;
  const el = (...a) => FP.el(...a);
  const NZ = [[166.3, -47.4], [178.6, -34.3]];
  const AFTER_MAP_LATEST = 10000;   // HM1: the sheet's reads wait for the map's first draw, but never longer than this (ms)
  const BASE_KEY = "fp-overview-basemap";   // the overviews' background, remembered on this device (map-scene.js, group-overview.js)
  const SHADE_KEY = "fp-overview-shade";    // MV2: "Shade outside the group" off on this device ("off"), the same key as a computer's Home (MV1)
  const shadeStored = () => { try { return root.localStorage?.getItem(SHADE_KEY) !== "off"; } catch { return true; } };
  let shown = null;

  const phone = () => !!root.matchMedia?.(P().PHONE).matches;
  // A circle of `m` metres about a fix, as a polygon (the accuracy ring)
  function ring(f, m, steps = 48) {
    const out = [], lat = (f.lat * Math.PI) / 180, dy = m / 111320, dx = m / (111320 * Math.max(Math.cos(lat), 0.01));
    for (let i = 0; i <= steps; i++) { const a = (i / steps) * 2 * Math.PI; out.push([f.lon + dx * Math.cos(a), f.lat + dy * Math.sin(a)]); }
    return out;
  }
  const meData = (f) => ({ type: "FeatureCollection", features: f ? [
    ...(f.accuracy ? [{ type: "Feature", properties: { kind: "ring" }, geometry: { type: "Polygon", coordinates: [ring(f, Math.max(f.accuracy, 5))] } }] : []),
    { type: "Feature", properties: { kind: "dot" }, geometry: { type: "Point", coordinates: [f.lon, f.lat] } }] : [] });

  // opts: { group: { id, name }, sb }. Returns the Home element; the map is made once it is on the page.
  // PH2 (the owner, 13 Nov 2026: "For the Home Screen the rest is the map just showing the overview view of the group… maybe just a
  // label in the centre of where each subgroup is to quickly navigate to them if you want to (but not forced to)"): Home on a phone is
  // only the map: the group's outer outline, one small name at the centre of each sub-group, Locate me and the +. PH5 (the owner,
  // 14 Nov 2026): the aerial first, everything outside the area darkened (map-palette.js MASK_OPACITY), each sub-group a clear fill,
  // and a tap on a name or a fill zooms there and opens it (goTo). HM1: Home's sheet along the bottom (peekSheet), with the search in it
  // when pulled up. "Near you" is a small sheet that comes up only once Locate me is tapped (Home's sheet stepping aside), and closes.
  // opts.home: place-home.js's options for this group (its sections, whether People is the person's, the search's hand-over), for the
  // sheet's search and which rows it may show (HM1); opts.today: "YYYY-MM-DD"
  function view({ group, sb = FP.sb, home = null, today = null }) {
    close();
    const me = { place: group.id, alive: true, map: null, overlay: null, stop: null, wq: null, sites: null, rows: null, located: null, centre: null, timer: null, open: false, labels: [], handoff: undefined,
      show: { subs: true, shade: shadeStored() } };   // MV2: what the sheet's Map switches show (the shade as this device last left it)
    shown = me;
    const live = () => me.alive && shown === me;
    const mapBox = el("div", { class: "pa-map", id: "pa-map", role: "region", "aria-label": "Map of " + group.name });
    const locate = el("button", { type: "button", class: "pa-locate", id: "pa-locate", "aria-label": "Locate me", title: "Locate me" }, FP.icon("locate", 22));
    // RF1 (PRODUCT.md: LINZ's topo one tap away on every map): Aerial | Topo in the same top-right cluster, under Locate
    const bg = el("div", { class: "pa-bg map-bg-switch", id: "pa-bg", role: "group", "aria-label": "Background", hidden: true });
    const stage = el("div", { class: "pa-stage" }, mapBox, locate, bg);
    const line = el("p", { class: "pa-line", id: "pa-line" });
    const say = el("div", { class: "pa-say", id: "pa-say", role: "status", "aria-live": "polite" });
    const set = el("ul", { class: "pa-set", id: "pa-near", "aria-label": "Near you" });
    const shut = el("button", { type: "button", class: "pa-shut", id: "pa-shut", "aria-label": "Close Near you", onclick: () => openSheet(false) }, FP.icon("close", 20));
    const sheet = el("section", { class: "pa-sheet", id: "pa-sheet", "aria-labelledby": "pa-near-title", hidden: true },
      el("div", { class: "pa-sheet-head" }, el("h2", { id: "pa-near-title" }, "Near you"), shut), line, say, set);
    // the group's area, its sub-groups and theirs: each read once, for the map and for the sheet alike
    // (the area first, for the map's frame and its mask; the sub-groups, their shapes and the sheet's reads only after the map has drawn
    // the area: afterMap, review of HM1)
    // (OV1: a failed read of the group's own boundary is noted, so an area summed from its sub-groups is never given as the group's)
    const area = Promise.resolve().then(() => FP.home?.readShapes?.(sb, [], [group]) || new Map())
      .then((m) => { if (m.areasFailed) me.areaFailed = true; return m.get(group.id) || null; }, () => { me.areaFailed = true; return null; });
    let subgroupsRead = null, subShapesRead = null;
    // the sub-groups' names and fills: drawn once, and only on a map that has loaded (its sources added), whichever comes last, the
    // map's load or the reads (second review of HM1: a map loading after the timer still gets its fills)
    function labels() {
      if (me.labelled || !me.loaded || !subgroupsRead || !me.map || !live()) return;
      me.labelled = true;
      drawLabels().catch(() => {});
    }
    function afterMap() {
      if (subgroupsRead || !live()) return;
      subgroupsRead = readSubgroups().catch(() => []);
      subShapesRead = subgroupsRead.then((subs) => (subs.length ? Promise.resolve(FP.home?.readShapes?.(sb, [], subs)).then((m) => { if (!m || m.areasFailed) me.subAreasFailed = true; return m; }, () => { me.subAreasFailed = true; return null; }) : new Map()));
      peek.start();
      labels();
    }
    const peek = peekSheet();
    const wrap = el("section", { class: "pa", "data-view": "home", "aria-label": "Home" }, stage, peek.node, sheet);
    me.wrap = wrap; me.peek = peek;
    function openSheet(on) {
      me.open = on; sheet.hidden = !on;
      // HM1: Near you takes the bottom while it is open; Home's own sheet steps aside, closed, and comes back after
      peek.away(on);
      if (on) draw(); else { problem(null); locate.focus({ preventScroll: true }); }
      root.requestAnimationFrame?.(() => { me.map?.resize(); placeLabels(); });
      for (const ms of [450, 900]) root.setTimeout?.(() => live() && placeLabels(), ms);   // once the + has settled above the sheet (add.js)
    }
    // MV2: the sheet's Map switches on this map: the shade outside and the sub-groups' fills, lines and names (layout only: the map's box,
    // its sources and its listeners are untouched)
    function applyShow() {
      stage.classList.toggle("pa-subs-off", !me.show.subs);
      const m = me.map;
      if (!m || !live()) return;
      try {
        if (m.getLayer("pa-mask")) m.setLayoutProperty("pa-mask", "visibility", me.show.shade ? "visible" : "none");
        for (const id of ["pa-subs-fill", "pa-subs-line"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", me.show.subs ? "visible" : "none");
      } catch { /* the map is going */ }
    }
    // the map's frame keeps clear of the sheet along the bottom
    const pad = () => ({ top: 72, bottom: 24 + (peek.node.hidden ? 60 : peek.height()), left: 28, right: 28 });

    // ---- HM1: Home's sheet -------------------------------------------------------------------------------------------------------
    // Closed ("peek"): a handle and one line. Pulled half way ("half"): search, the facts, what is new or next, the sub-groups. A drag
    // on the handle or the line follows the finger and settles at the nearer stop (a quick flick goes the way it was flung); a tap on
    // the handle opens or closes it; Escape closes it. The + rides just above it (add.js lifts it), the map's credit too, and the map's
    // names keep off it; the sheet is opaque and takes its own taps, so nothing under it is ever tapped through it.
    function peekSheet() {
      const keys = (home?.sections || []).map((s) => (Array.isArray(s) ? s[0] : s?.key)).filter(Boolean);
      const grip = el("button", { type: "button", class: "pa-grip", id: "pa-grip", "aria-expanded": "false", "aria-controls": "pa-peek-body", "aria-label": "Show more of " + group.name },
        el("span", { class: "pa-grip-bar", "aria-hidden": "true" }));
      const lineBox = el("div", { class: "pa-peek-line", id: "pa-peek-line" });
      const searchSlot = el("div", { class: "pa-search-slot" });
      const facts = el("p", { class: "pa-facts", id: "pa-facts", hidden: true });
      const next = el("ul", { class: "pa-set pa-next", id: "pa-next", "aria-label": "New and next", hidden: true });
      const quiet = el("p", { class: "pa-empty", id: "pa-empty", hidden: true });
      const subsList = el("ul", { class: "pa-subs-list" });
      // (OV1: the list of sub-groups couldn't be read: the person's own are listed, and the sheet says the list is not every one)
      const subsNote = el("p", { class: "pa-empty", id: "pa-subs-failed", hidden: true });
      const subsBox = el("section", { class: "pa-set pa-subs", id: "pa-subs", "aria-labelledby": "pa-subs-title", hidden: true }, el("h3", { id: "pa-subs-title" }, "Sub-groups"), subsNote, subsList);
      // MV2 (PRODUCT.md "One Map design"; the owner, 16 Nov 2026: "the maps are just simpler and much easier to navigate"): what the map
      // shows, in the Maps tab's and a computer Home's order and words: the map's layers as switches, each with what its colours mean
      // under it ("Sub-groups"), then one Reference group ("Shade outside the group"). At the sheet's foot, inside it, so it is inert at
      // rest (the body is hidden at the peek) and one panel shows at a time. Aerial | Topo stays on the map, one tap away (PH5, RF1).
      const mapSet = el("section", { class: "pa-mapset", id: "pa-mapset", "aria-labelledby": "pa-mapset-title" });
      const body = el("div", { class: "pa-peek-body", id: "pa-peek-body", hidden: true }, searchSlot, facts, next, quiet, subsBox, mapSet);
      const node = el("section", { class: "pa-peek", id: "pa-peek", "data-state": "peek", "aria-label": "About " + group.name }, grip, lineBox, body);
      // (OV1 failed: the reads of what's new or next that failed, never taken for none)
      const got = { event: undefined, latest: undefined, round: null, photos: null, review: null, members: null, subs: null, areas: new Map(), failed: new Set() };
      const NEW_READS = ["event", "latest", "photos", "round", "review"];
      let state = "peek", peekH = 0, halfH = 0, settleTimer = null, search = null, drag = null, dragged = false;
      const reducedNow = () => !!root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const setVar = () => me.wrap?.style.setProperty("--pa-peek-h", (node.hidden ? 0 : Math.round(node.getBoundingClientRect().height)) + "px");
      // (the closed sheet's height: its handle and its line, measured while they show)
      function measurePeek() {
        if (!lineBox.hidden && !node.hidden && lineBox.offsetHeight) peekH = Math.round(lineBox.offsetTop + lineBox.offsetHeight + (parseFloat(getComputedStyle(node).paddingBottom) || 0));
        return peekH || 80;
      }
      function measureHalf() {
        const h = stage.getBoundingClientRect(), b = (bg.hidden ? locate : bg).getBoundingClientRect();
        const bar = [...root.document.querySelectorAll(".space-tabs")].map((t) => t.getBoundingClientRect()).find((r) => r.height);
        const plus = [...root.document.querySelectorAll(".add-button")].map((x) => x.getBoundingClientRect()).find((r) => r.height);
        halfH = P().halfHeight({ stage: h.height, top: b.bottom - h.top, plus: (plus?.height || 52) + 14, floor: bar ? bar.top : root.innerHeight, screen: root.innerHeight, peek: measurePeek() });
        return halfH;
      }
      // the search: Home's own (place-home.js, compact), made when the sheet first opens (it reads nothing until it is used), and made
      // again when the bar's Search, or another screen, has since taken place-home's one live search
      function ensureSearch() {
        if (!home || !FP.placeHome?.view) return;
        if (search?.isConnected && search.querySelector("input")?.value) return;
        search = FP.placeHome.view({ ...home, compact: true });
        searchSlot.replaceChildren(search);
      }
      // the map's names follow the sheet
      function afterMove() { root.requestAnimationFrame?.(() => live() && placeLabels()); for (const ms of [450, 900]) root.setTimeout?.(() => live() && placeLabels(), ms); }
      // (from: where a drag let go, read while the finger held it; held: a drag left it at half while searching, RF2)
      function settleAt(next, { animate = true, from: fromAt = null, held = false } = {}) {
        clearTimeout(settleTimer);
        node.classList.toggle("pa-held", held);
        const from = fromAt ?? node.getBoundingClientRect().height;
        if (state === "peek" && !node.classList.contains("pa-dragging")) measurePeek();
        state = next;
        node.dataset.state = next;
        grip.setAttribute("aria-expanded", String(next === "half"));
        grip.setAttribute("aria-label", (next === "half" ? "Show less of " : "Show more of ") + group.name);
        if (next === "half") { ensureSearch(); drawMapSet(true); lineBox.hidden = true; body.hidden = false; }
        const to = next === "half" ? measureHalf() : measurePeek();
        const done = () => {
          node.classList.remove("pa-moving");
          if (state === "peek") { body.hidden = true; lineBox.hidden = false; node.style.height = ""; } else node.style.height = halfH + "px";
          setVar(); afterMove();
        };
        if (!animate || reducedNow() || !from) { done(); return; }
        node.style.height = from + "px";
        void node.offsetHeight;   // (the start of the move, drawn)
        node.classList.add("pa-moving");
        node.style.height = to + "px";
        settleTimer = setTimeout(done, 260);
      }
      grip.addEventListener("click", () => { if (dragged) { dragged = false; return; } settleAt(state === "half" ? "peek" : "half"); });
      node.addEventListener("keydown", (e) => { if (e.key === "Escape" && state === "half" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); settleAt("peek"); grip.focus(); } });
      // ---- the drag (on the handle, or on the one line) ----
      // (the finger is followed over the whole page once it is down: it soon leaves the handle; nothing is captured, so a plain tap on the
      // line's row is still a tap on it)
      // RF2 (the review of HM1: while searching, a slow drag jumped on its first 6 px and sprang back on release): while the search's
      // results take the sheet (CSS: the full height), the drag reaches the full height and starts from it; on release the height is
      // read before the drag's class comes off (that class is what lets the full-height rule give way to the finger), and the sheet
      // settles at the nearest of closed, half and full. Held at half while searching, it says so (pa-held), so the full-height rule
      // leaves it there until it is next moved.
      const doc = root.document;
      const searching = () => !!node.querySelector(".ph-compact.searching");
      const down = (e) => {
        if (e.button > 0 || node.hidden) return;
        const full = searching() ? Math.round((node.offsetParent || node.parentElement)?.getBoundingClientRect().height - 8) || null : null;
        drag = { y: e.clientY, h: node.getBoundingClientRect().height, t: performance.now(), id: e.pointerId, moved: false, peek: state === "peek" ? measurePeek() : peekH || 80, half: measureHalf(), full };
        doc.addEventListener("pointermove", move, { passive: false });
        doc.addEventListener("pointerup", up);
        doc.addEventListener("pointercancel", up);
      };
      const move = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dy = drag.y - e.clientY;
        if (!drag.moved) {
          if (Math.abs(dy) < 6) return;
          drag.moved = true; dragged = true;
          clearTimeout(settleTimer);
          node.classList.remove("pa-moving"); node.classList.add("pa-dragging");
          ensureSearch(); drawMapSet(true); body.hidden = false;
        }
        const h = Math.max(drag.peek, Math.min(drag.full > drag.half ? drag.full : drag.half + 24, drag.h + dy));
        // (RF2: where the finger has been in the last moment, so a flick is told from a slow drag that was held before it was let go)
        const now = performance.now();
        drag.trail = (drag.trail || []).filter((p) => now - p.t <= 120).concat({ y: e.clientY, t: now });
        node.style.height = h + "px";
        lineBox.hidden = h > drag.peek + 24;   // (the one line gives way to the rest as it comes up)
        setVar();
        e.preventDefault();
      };
      const up = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const d = drag; drag = null;
        doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", up); doc.removeEventListener("pointercancel", up);
        if (!d.moved) return;
        const h = node.getBoundingClientRect().height;   // (read while it is the finger's)
        // a flick: the speed over the last moment of the drag (a drag held still before it is let go is not one)
        const now = performance.now(), recent = (d.trail || []).filter((p) => now - p.t <= 120);
        const fast = recent.length ? (recent[0].y - e.clientY) / Math.max(16, now - recent[0].t) : 0;
        const stops = d.full > d.half ? [["peek", d.peek], ["half", d.half], ["full", d.full]] : [["peek", d.peek], ["half", d.half]];
        let at = stops.reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))[0];
        if (Math.abs(fast) > 0.6) at = fast > 0 ? (stops.find(([, x]) => x > h + 1)?.[0] || stops[stops.length - 1][0]) : ([...stops].reverse().find(([, x]) => x < h - 1)?.[0] || "peek");
        const held = at === "half" && stops.length === 3;
        node.classList.toggle("pa-held", held);
        if (at === "full") node.classList.add("pa-moving");   // (the full-height rule takes over from where it was let go, and eases there)
        node.classList.remove("pa-dragging");
        settleAt(at === "peek" ? "peek" : "half", { from: h, held });
        setTimeout(() => { dragged = false; }, 0);
      };
      for (const target of [grip, lineBox]) target.addEventListener("pointerdown", down);
      // (a drag that began on the line's row is not a tap on it)
      lineBox.addEventListener("click", (e) => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } }, true);

      // ---- what it says ----
      const go = (open) => {
        if (open.event) { if (FP.groupEvents?.open) FP.groupEvents.open(group.id, open.event.id); else root.location.hash = FP.href(FP.groupModel.href(group.id, "events")); return; }
        if (open.round) { root.location.hash = FP.href(FP.wqRoundModel?.href?.(group.id, open.round.id) || FP.groupModel.href(group.id, "water")); return; }
        root.location.hash = FP.href(FP.groupModel.href(group.id, open.view, open.tab || open.item || null));
      };
      const row = (r, id = null) => el("li", {}, el("button", { type: "button", class: "pa-row", "data-row": r.key, ...(id ? { id } : {}), onclick: () => go(r.open) },
        el("span", { class: "pa-dot", "aria-hidden": "true" }, FP.icon(r.icon, 20)),
        el("span", { class: "pa-text" }, el("b", {}, r.title), r.note ? el("small", {}, r.note) : null),
        el("span", { class: "pa-chev", "aria-hidden": "true" }, FP.icon("chevron", 16))));
      // (OV1: the list of sub-groups couldn't be read: neither their count nor an area summed from them is a fact of the group's; the
      // group's own boundary couldn't be read, or some sub-groups' with none of its own: no area, never a part of it as the whole)
      const areaUnknown = () => me.areaFailed || (!got.areas.has(group.id) && (me.subsFailed || me.subAreasFailed));
      const factsTiles = () => (FP.groupOverviewModel?.tiles?.({ group, subgroups: got.subs || [], areas: got.areas, members: got.members }) || [])
        .filter((t) => !(me.subsFailed && t.key === "subgroups") && !(t.key === "area" && areaUnknown()));
      function drawLine() {
        if (got.event === undefined || (got.event === null && got.latest === undefined)) return;   // (until the next event, or the latest thing, is known)
        const r = P().peekLine({ event: got.event, latest: got.latest, facts: P().factsLine(factsTiles()), name: group.name, failed: got.failed.has("event") || got.failed.has("latest") });
        lineBox.dataset.line = r.key;
        if (r.open) lineBox.replaceChildren(el("ul", { class: "pa-peek-row" }, row(r, "pa-peek-open")));
        else lineBox.replaceChildren(el("p", { class: "pa-row pa-row-plain", id: "pa-peek-open", "data-row": r.key },
          el("span", { class: "pa-dot", "aria-hidden": "true" }, FP.icon(r.icon, 20)), el("span", { class: "pa-text" }, el("b", {}, r.title))));
        if (state === "peek") root.requestAnimationFrame?.(() => { if (live()) { measurePeek(); setVar(); } });
      }
      function drawBody() {
        const f = P().factsLine(factsTiles());
        facts.textContent = f; facts.hidden = !f;
        const rows = P().nextRows({ event: got.event || null, round: got.round, photos: got.photos, review: got.review });
        next.replaceChildren(...rows.map((r) => row(r)));
        next.hidden = !rows.length;
        // nothing new or next: one honest sentence (what was added is older than a week; or nothing at all), never invented content
        const settled = got.event !== undefined && got.latest !== undefined;
        const failed = NEW_READS.some((k) => got.failed.has(k));
        quiet.textContent = settled && failed ? P().failedLine(rows.length > 0) : !rows.length && settled ? (got.latest ? "Nothing new in the last week." : P().emptyLine(group.name)) : "";
        quiet.hidden = !quiet.textContent;
        drawSubs();
      }
      // MV2: the sheet's Map switches. Switching applies at once to this map; the shade is kept on this device (shared with a computer's Home)
      // (made when the sheet is pulled up, as its search is: a closed sheet holds no control, HM1)
      function drawMapSet(open = false) {
        if (!open && !mapSet.dataset.made) return;
        mapSet.dataset.made = "1";
        const sub = !!group.parent_org_id, hasSubs = !!me.subs?.size;
        const sw = (id, label, on, change) => el("label", { class: "pa-switch-row" },
          el("input", { type: "checkbox", class: "pa-switch", id, ...(on ? { checked: true } : {}), onchange: (e) => change(e.target.checked) }), el("span", {}, label));
        mapSet.replaceChildren(el("h3", { id: "pa-mapset-title" }, "Map"),
          ...(hasSubs ? [el("div", { class: "pa-mrow" }, sw("pa-show-subgroups", "Sub-groups", me.show.subs, (v) => { me.show.subs = v; applyShow(); }),
            el("p", { class: "pa-mkey" }, "Each sub-group in its own colour, as in the list"))] : []),
          el("p", { class: "pa-mref", id: "pa-mref", role: "heading", "aria-level": "4" }, "Reference"),
          el("div", { class: "pa-mrow" }, sw("pa-show-shade", sub ? "Shade outside the sub-group" : "Shade outside the group", me.show.shade, (v) => {
            me.show.shade = v;
            try { root.localStorage?.setItem(SHADE_KEY, v ? "on" : "off"); } catch { /* kept for this visit */ }
            applyShow();
          })));
      }
      function drawSubs() {
        drawMapSet();
        const subs = got.subs || [];
        subsBox.hidden = !subs.length && !me.subsFailed;
        subsNote.textContent = me.subsFailed ? P().SUBS_FAILED : ""; subsNote.hidden = !me.subsFailed;
        subsList.replaceChildren(...subs.map((s) => {
          const colour = me.colours?.get(s.name) || null, ha = FP.groupOverviewModel?.hectares?.(got.areas.get(s.id)?.ha);
          const parts = [el("span", { class: "pa-dot", "aria-hidden": "true" }, el("span", { class: "pa-swatch", ...(colour ? { style: "background:" + colour } : {}) })),
            el("span", { class: "pa-name" }, s.name), ha ? el("span", { class: "pa-far" }, ha) : null];
          const drawn = me.subs?.get(s.id);
          // one the person is in opens (zoomed to first when it is on the map); one they are not in is only zoomed to, as on the map; one
          // with neither is a plain, quieter line
          if (!s.member && !drawn) return el("li", { class: "pa-sub-only" }, el("span", { class: "pa-row pa-row-plain", "data-sub": s.id }, ...parts));
          return el("li", {}, el("button", { type: "button", class: "pa-row" + (s.member ? "" : " pa-sub-zoom"), "data-sub": s.id,
            "aria-label": (s.member ? "Open " : "Zoom to ") + s.name + (ha ? ", " + ha : ""), onclick: () => {
              settleAt("peek", { animate: false });
              if (drawn) goTo(drawn); else root.location.hash = FP.href(FP.groupModel.href(s.id, "home"));
            } }, ...parts));
        }));
      }

      // ---- the reads (each the person's own; each one row or a head count; each for a section the person may open) ----
      const rows1 = (q) => Promise.resolve(q).then((r) => (r?.error ? null : Array.isArray(r?.data) ? r.data : []), () => null);
      const head = (q) => Promise.resolve(q).then((r) => (r?.error ? null : Number.isInteger(r?.count) ? r.count : Array.isArray(r?.data) ? r.data.length : null), () => null);
      const safely = (make) => { try { return make(); } catch { return Promise.resolve(null); } };
      const H = FP.placeHomeModel, day = String(today || H?.nzDay?.() || new Date().toISOString()).slice(0, 10);
      const coordinator = ["facilitator", "advisor", "admin"].includes(group.role);
      const redraw = () => { if (live()) { drawLine(); drawBody(); } };
      // (review of HM1: started only once the map has drawn the area, from afterMap below, so none of them competes with the area read,
      // the mask and the first tiles; until then the closed sheet holds its place, empty)
      let started = false;
      function start() {
      if (started || !live()) return;
      started = true;
      if (keys.includes("events")) {
        safely(() => rows1(sb.from("group_events").select("id,title,starts_at,ends_at,all_day,place_name,cancelled_at").eq("org_id", group.id).is("cancelled_at", null)
          .gte("starts_at", H?.nzDayStart?.(day) || new Date().toISOString()).order("starts_at", { ascending: true }).range(0, 0)))
          .then((r) => { got.event = r?.[0] || null; if (r === null) got.failed.add("event"); redraw(); });
      } else got.event = null;
      if (keys.includes("records")) {
        safely(() => rows1(sb.from("captures").select("id,kind,note,taken_at").eq("org_id", group.id).is("archived_at", null).order("taken_at", { ascending: false }).range(0, 0)))
          .then((r) => { got.latest = r?.[0] || null; if (r === null) got.failed.add("latest"); redraw(); });
        const since = P().daysBefore(day, P().NEW_DAYS);
        if (since) safely(() => head(sb.from("captures").select("id", { count: "exact", head: true }).eq("org_id", group.id).is("archived_at", null).eq("kind", "photo").gte("taken_at", since)))
          .then((n) => { got.photos = n ? { n, since } : null; if (n === null) got.failed.add("photos"); redraw(); });
      } else got.latest = null;
      if (coordinator && keys.includes("water")) {
        safely(() => rows1(sb.from("sampling_rounds").select("id,sampled_on,counts").eq("org_id", group.id).order("sampled_on", { ascending: false }).limit(1)))
          .then((r) => { got.round = r?.[0] || null; if (r === null) got.failed.add("round"); redraw(); });
      }
      if (home?.people && keys.includes("people") && FP.reviewItemsModel) {
        safely(() => head(sb.from("proposals").select("id", { count: "exact", head: true }).eq("org_id", group.id).in("kind", FP.reviewItemsModel.KINDS).eq("status", "proposed")))
          .then((n) => { got.review = n; if (n === null) got.failed.add("review"); redraw(); });
      }
      if (!group.parent_org_id && FP.peopleModel?.canSee?.(group.role)) {
        safely(() => head(sb.from("group_members").select("id", { count: "exact", head: true }).eq("org_id", group.id).is("ended_at", null))).then((n) => { got.members = n; redraw(); });
      }
      // the sub-groups and the areas, as the map's names read them (shared)
      Promise.all([subgroupsRead, area, subShapesRead]).then(([subs, own, shapes]) => {
        if (!live()) return;
        got.subs = subs || [];
        const ha = (g) => (g ? FP.groupOverviewModel?.areaHa?.(g) : null);
        if (ha(own?.geometry) > 0) got.areas.set(group.id, { ha: ha(own.geometry) });
        for (const s of got.subs) { const v = ha(shapes?.get?.(s.id)?.geometry); if (v > 0) got.areas.set(s.id, { ha: v }); }
        redraw();
      });
      }
      drawBody();
      return {
        node, start, height: () => (node.hidden ? 0 : Math.round(node.getBoundingClientRect().height) || measurePeek()),
        state: () => state, half: () => halfH || measureHalf(), peekHeight: () => measurePeek(),
        open: (s, o) => settleAt(s, o), subs: drawSubs, setVar,
        away(on) { if (on && state !== "peek") settleAt("peek", { animate: false }); node.hidden = !!on; setVar(); },
        // the bar's Search on Home: this sheet's own box, pulled up
        focusSearch() {
          if (node.hidden) return false;
          settleAt("half");
          const input = searchSlot.querySelector("input");
          if (!input) return false;
          setTimeout(() => { if (live()) input.focus({ preventScroll: true }); }, 30);
          return true;
        },
      };
    }

    // ---- the list -------------------------------------------------------------------------------------------------------------
    // PH2: a name in capitals (Environment Canterbury's) is shown in sentence case and wraps to two lines (phone-model displayName)
    const row = (s) => el("li", {}, el("button", { type: "button", class: "pa-row", "data-site": String(s.id), onclick: () => openSite(s), title: s.name },
      el("span", { class: "pa-dot", "aria-hidden": "true" }, FP.icon("water", 18)),
      el("span", { class: "pa-name" }, P().displayName(s.name)), el("span", { class: "pa-far" }, s.words)));
    function draw() {
      if (!live()) return;
      if (me.finding && !me.located) { line.textContent = "Finding your position…"; set.replaceChildren(); set.hidden = true; return; }
      if (me.sites === null) { line.textContent = "Looking for what is near…"; set.replaceChildren(); set.hidden = true; return; }
      if (me.sites === false) { line.textContent = P().SITES_FAILED; set.replaceChildren(); set.hidden = true; return; }
      const from = me.located || me.centre;
      const near = P().nearby(me.sites, from);
      const said = near.length ? P().nearbyLine({ located: !!me.located, fix: me.located, count: near.length }) : P().NO_SITES;
      // PH2: before locating, one quiet hint with the Locate icon in it, instead of "Nearest to the middle of the map"
      if (said) line.textContent = said;
      else line.replaceChildren(P().LOCATE_HINT[0], FP.icon("locate", 15), P().LOCATE_HINT[1]);
      set.replaceChildren(...near.map(row));
      set.hidden = !near.length;
    }
    function problem(p) {
      if (!p) { say.replaceChildren(); return; }
      say.replaceChildren(el("p", { class: "pa-say-text" }, p.text + " " + p.how),
        el("div", { class: "pa-set pa-set-one" }, el("button", { type: "button", class: "pa-row", id: "pa-retry", onclick: () => find(true) },
          el("span", { class: "pa-dot", "aria-hidden": "true" }, FP.icon("locate", 18)), el("span", { class: "pa-name" }, "Try again"))));
    }

    // ---- where the person is ------------------------------------------------------------------------------------------------------
    function showMe(f, fly) {
      if (!live() || !f) return;
      me.located = f;
      const src = me.map?.getSource?.("pa-me");
      if (src) src.setData(meData(f));
      if (fly && me.map) me.map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(me.map.getZoom(), 14), padding: { top: 40, bottom: 40, left: 40, right: 40 }, duration: root.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 600 });
      locate.setAttribute("aria-pressed", "true");
      draw();
    }
    // tapped (fly): the phone is asked from the tap itself (locate.js), and Near you comes up; already allowed when Home opens: the dot
    // only, quietly
    async function find(fly) {
      const asked = FP.locate.get({ maxAge: 5000 });
      locate.disabled = true; locate.classList.add("pa-busy"); problem(null);
      if (fly) { me.finding = true; openSheet(true); }
      const got = await asked;
      if (!live()) return;
      me.finding = false;
      locate.disabled = false; locate.classList.remove("pa-busy");
      if (!got.ok) { locate.setAttribute("aria-pressed", "false"); if (fly) { problem(got.problem); draw(); } return; }
      showMe(got.fix, fly);
      if (!me.stop) me.stop = FP.locate.watch((f) => showMe(f, false));
    }
    locate.addEventListener("click", () => find(true));

    // ---- PH5: a tap goes there (the owner, 14 Nov 2026: "Don't have it have to approve opening a group once you click on it on the
    // map, just zoom to it smoothly") ---------------------------------------------------------------------------------------------
    // A sub-group's name or its fill, tapped: the map eases to it (about 750 ms; at once where the person asks for less motion), and
    // then the person is in it (its own Home, its own mask) when they may open it; one they may not open is only zoomed to, its name
    // showing. MapLibre gives no click after a drag or a pinch, so neither ever navigates. The header's back leads up again.
    const FLY_MS = 750, LAST_MS = 2000, PRESSES = ["pointerdown", "touchstart", "mousedown", "wheel"];
    const reduced = () => !!root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Review of #540, 1: the open belongs to one fly. Any touch or press the person makes anywhere on the screen while it flies (the map:
    // a drag, a pinch; Locate, the +, the bar or any control: review of #540, round 3), or a wheel, cancels it, and so does another tap
    // (which flies on its own); the place opens only when its fly ends uninterrupted. Returns the cancel (also me.cancelGo).
    function goTo(s) {
      const map = me.map, x = me.subs?.get(s.id);
      if (!map || !x || !live()) return null;
      me.cancelGo?.();
      const fly = { s, live: true };
      me.going = s.id;
      const doc = root.document;
      const stop = () => {
        fly.live = false;
        if (me.going === s.id) me.going = null;
        for (const ev of PRESSES) doc?.removeEventListener(ev, cancel, true);
        map.off("movestart", byPerson); map.off("moveend", ended);
        root.clearTimeout(fly.timer); root.clearTimeout(fly.last);
        for (const l of me.labels) if (l.id === s.id) l.node.classList.remove("pa-going");
        if (me.cancelGo === stop) me.cancelGo = null;
      };
      const cancel = () => { if (fly.live) stop(); };
      const byPerson = (e) => { if (e?.originalEvent) cancel(); };
      // (force: the last word, a bounded time after the fly should have ended: a map that never reports rest, say with its tiles failing,
      // still takes the person there; a move of theirs has cancelled it before then)
      const open = (force = false) => {
        if (!fly.live || !live() || me.going !== s.id || (!force && map.isMoving?.())) return;
        if (s.member) handOn(s);   // TR1
        const go = s.member;
        stop();
        if (go) root.location.hash = FP.href(FP.groupModel.href(s.id, "home"));
      };
      const ended = (e) => { if (!e?.originalEvent) open(); };
      me.cancelGo = stop;
      for (const l of me.labels) l.node.classList.toggle("pa-going", l.id === s.id);
      const ms = reduced() ? 0 : FLY_MS;
      map.fitBounds(x.bbox, { padding: pad(), maxZoom: 14, duration: ms, essential: false });
      // (listened for after the fly starts, so the end of a fly it stopped is not taken for its own)
      for (const ev of PRESSES) doc?.addEventListener(ev, cancel, true);
      map.on("movestart", byPerson);
      if (ms) map.on("moveend", ended);
      // with no fly (reduced motion, or already there) the open waits a moment for a touch; otherwise it is a safety net once the fly
      // should have ended, and opens only if the map is at rest and nothing cancelled it
      fly.timer = root.setTimeout(open, ms ? ms + 400 : 150);
      fly.last = root.setTimeout(() => open(true), ms + LAST_MS);
      return stop;
    }
    me.goTo = goTo;
    // TR1: the sub-group about to be opened, handed to the map it opens on (its outline, so that map frames it at once and the move
    // carries on from here: map-handoff.js)
    function handOn(s) {
      const x = me.subs?.get(s.id);
      if (x?.geometry) FP.mapHandoff?.entering({ id: s.id, kind: "subgroup", geometry: x.geometry, bbox: x.bbox });
    }

    // ---- the sub-groups' names, one at the centre of each (a tap goes there) -----------------------------------------------------
    // Drawn over the map; where two would touch, or one would sit on a control, the smaller sub-group's name waits until zoomed in.
    function placeLabels() {
      const map = me.map;
      if (!map || !me.labels.length) return;
      const h = stage.getBoundingClientRect();
      // (HM1: and Home's sheet, with the handle's reach above its edge: no name sits under it, or is tapped through it)
      const blockers = [locate, bg, peek.node, ...stage.querySelectorAll(".maplibregl-ctrl-bottom-left > *, .maplibregl-ctrl-bottom-right > *"), ...root.document.querySelectorAll(".add-button:not([hidden])")]
        .filter((n) => !n.hidden && n.getClientRects().length).map((n) => { const r = n.getBoundingClientRect(), up = n === peek.node ? 16 : 4; return { l: r.left - h.left - 4, t: r.top - h.top - up, r: r.right - h.left + 4, b: r.bottom - h.top + 4 }; });
      const boxes = me.labels.map((x) => {
        if (!x.w && x.node.offsetWidth) { x.w = x.node.offsetWidth; x.h = x.node.offsetHeight; }   // measured while it shows
        const p = map.project(x.at), w = x.w || 120, ht = x.h || 28;
        return { l: p.x - w / 2, t: p.y - ht / 2, r: p.x + w / 2, b: p.y + ht / 2, x: p.x, y: p.y };
      });
      const keep = P().keepLabels(boxes, blockers, { width: h.width, height: h.height });
      me.labels.forEach((x, i) => {
        x.node.hidden = !keep.has(i);
        x.node.style.transform = "translate(" + Math.round(boxes[i].x) + "px, " + Math.round(boxes[i].y) + "px) translate(-50%, -50%)";
      });
    }
    async function drawLabels() {
      const subs = await subgroupsRead;
      // (TR1: none to draw: their layers back as drawn, for a later look)
      if (live() && !subs.length) for (const id of ["pa-subs-fill", "pa-subs-line"]) FP.mapHandoff?.setLevel(me.map, id, 1);
      if (!live() || !subs.length) return;
      const shapes = await subShapesRead;
      // PH5: each sub-group's own fill, in the set that tells neighbours apart (map-palette.js subgroupColours), the same on every map
      // (every sub-group, with an area or not, keyed by its id: the same set and keys the Maps tab colours, review of #540, 2)
      const colours = me.colours = FP.mapPalette?.subgroupColours?.(subs.map((s) => ({ key: s.id, name: s.name, geometry: shapes?.get(s.id)?.geometry || null }))) || new Map();
      if (!live() || !shapes) { if (live()) peek.subs(); return; }
      const layer = el("div", { class: "pa-labels", "aria-label": "Sub-groups" });
      const drawn = subs.filter((s) => shapes.get(s.id)?.geometry);
      me.subs = new Map(drawn.map((s) => [s.id, { ...s, bbox: shapes.get(s.id).bbox, geometry: shapes.get(s.id).geometry }]));
      peek.subs();   // HM1: the sheet's sub-groups, with their colours and somewhere to zoom to
      const look = (c) => FP.mapPalette?.subgroupLook?.(c, { onDark: me.onDark }) || { fill: c, fillOpacity: 0.5, line: c, lineWidth: 0.75, lineOpacity: 0.9 };
      // (drawn again when the background changes: the fills are for a dark or a light ground)
      me.paintSubs = () => me.map?.getSource("pa-subs")?.setData({ type: "FeatureCollection", features: drawn.map((s) => {
        const lk = look(colours.get(s.name) || "#3a86ff");
        return { type: "Feature", geometry: shapes.get(s.id).geometry, properties: { id: s.id, fill: lk.fill, fo: lk.fillOpacity, line: lk.line } };
      }) });
      me.paintSubs();
      // TR1: the fills and their names fade in as they come (never a pop, and never a move of the camera)
      FP.mapHandoff?.fade(me.map, ["pa-subs-fill", "pa-subs-line"], { from: 0, to: 1, ms: 400 });
      layer.classList.add("tr-in");
      me.labels = drawn.map((s) => {
        const shape = shapes.get(s.id), at = P().labelPoint(shape.geometry);
        // review of #538, 1, and PH5: a tap on any name zooms to its sub-group; only one the person is in is then opened (as the computer's
        // overview links them); another's is zoomed to and its name shown, nothing more
        const node = el("button", { type: "button", class: "pa-label" + (s.member ? "" : " pa-label-only"), "data-sub": s.id, "data-open": String(!!s.member), title: s.name,
          "aria-label": s.member ? "Open " + s.name + " (sub-group)" : "Zoom to " + s.name + " (sub-group)" }, s.name);
        node.addEventListener("click", () => goTo(s));
        layer.append(node);
        return { id: s.id, node, at, size: (shape.bbox[1][0] - shape.bbox[0][0]) * (shape.bbox[1][1] - shape.bbox[0][1]) };
      }).filter((x) => x.at).sort((a, b) => b.size - a.size);
      stage.append(layer);
      placeLabels();
      // a tap on a sub-group's fill goes there too (the smallest under the finger, where two overlap)
      me.map.on("click", "pa-subs-fill", (e) => {
        const hit = (e.features || []).map((f) => me.subs.get(f.properties.id)).filter(Boolean).sort((a, b) => (a.bbox[1][0] - a.bbox[0][0]) * (a.bbox[1][1] - a.bbox[0][1]) - (b.bbox[1][0] - b.bbox[0][0]) * (b.bbox[1][1] - b.bbox[0][1]))[0];
        if (hit) goTo(hit);
      });
      // (once a frame at most while the map moves)
      let queued = false;
      me.map.on("move", () => { if (queued) return; queued = true; root.requestAnimationFrame(() => { queued = false; if (live()) placeLabels(); }); });
    }
    // the group's sub-groups, as its overview reads them (subgroup_counts: their names, for any member), and the ones the person is in
    async function readSubgroups() {
      if (group.parent_org_id) return [];
      try {
        const { data, error } = await sb.rpc("subgroup_counts", { parent_org: group.id });
        if (error) throw error;
        return (Array.isArray(data) ? data : []).map((r) => ({ id: r.subgroup_id, name: r.subgroup_name, parent_org_id: group.id, member: !!r.is_member })).filter((s) => s.id && s.name).slice(0, 40);
      } catch { me.subsFailed = true; return (FP.groupSpace?.groups?.() || []).filter((g) => g.parent_org_id === group.id).map((g) => ({ ...g, member: true })).slice(0, 40); }
    }

    // ---- a site: shown on the map, and what Maps shows for it -----------------------------------------------------------------------
    function openSite(s) {
      if (!me.map || !FP.wqSites) return;
      // the sites as read here are the panel's own first read (wq-sites.js keeps its reads in this state), so nothing is read twice
      me.wq = me.wq || { cache: new Map([["sites", Promise.resolve({ rows: me.rows || [], where: "group" })]]), framed: true };
      me.wq.on = true; me.wq.chosen = [s.id]; me.wq.adding = false;
      try { me.overlay?.remove(); } catch { /* gone */ }
      try { me.overlay = FP.wqSites.attach({ map: me.map, holder: stage, sb, owner: { org: group.id }, state: me.wq }); } catch { me.overlay = null; }
      const h = stage.clientHeight || 400;
      me.map.easeTo({ center: s.lngLat, zoom: Math.max(me.map.getZoom(), 13), padding: { top: 24, bottom: Math.round(h * 0.55), left: 24, right: 24 }, duration: 0 });
    }

    // ---- the map, once the Home is on the page ------------------------------------------------------------------------------------
    const sites = (async () => {
      const q = sb.rpc("group_wq_sites", { g: group.id });
      const r = await (q && typeof q.limit === "function" ? q.limit(P().READ_CAP) : q);
      if (r?.error) throw r.error;
      me.rows = (Array.isArray(r?.data) ? r.data : []).slice(0, P().READ_CAP);
      return P().sitesFrom(me.rows, FP.wqModel?.siteLngLat);
    })();
    sites.then((s) => { me.sites = s; draw(); }, () => { me.sites = false; draw(); });
    draw();

    // ---- TR1: arriving from another map (map-handoff.js) ---------------------------------------------------------------------------
    // The picture handed over covers this map until it has drawn at the same camera; then it fades away (the other map's own symbols
    // with it), and this map eases ONCE to its frame while the place's own fill and darkening fade in. The sheet's and the names' reads
    // start as that move begins (the frame is known then: #552's order, after the map has loaded and been framed, is kept). A touch
    // during the move takes it over (MapLibre stops the ease); nothing moves the camera afterwards.
    async function arrive(h, map, box, framed) {
      await h.reveal(map);
      if (!live()) return;
      // (the area's read may land well after the picture has gone: a map the person has moved meanwhile stays where they put it)
      const going = box && !me.located && h.mayMove(map) ? FP.mapHandoff.ease(map, { bounds: box, padding: pad(), maxZoom: 14 }) : null;
      const from = me.fillFrom ?? 0.06, AREA_FILL = 0.06;
      FP.mapHandoff.tween(700, (k) => { if (live() && map.getLayer("pa-area-fill")) map.setPaintProperty("pa-area-fill", "fill-opacity", from + (AREA_FILL - from) * k); });
      framed();
      await going;
      if (!live()) return;
      const c = map.getCenter();
      me.centre = { lat: c.lat, lon: c.lng };
      draw();
    }

    function makeMap() {
      if (!live() || !wrap.isConnected) return;
      const gl = root.maplibregl;
      if (!gl) { mapBox.replaceChildren(el("p", { class: "pa-quiet" }, "The map couldn't open here.")); afterMap(); return; }
      try {
        gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js");
        // PH5: the aerial, unless the person chose the plain map on an overview on this phone (map-scene.js's own key)
        let stored = null; try { stored = root.localStorage.getItem(BASE_KEY); } catch { /* private mode */ }
        // (the demo has no tiles: its two choices stand over the plain ground, as on the other overviews)
        const choices = FP.basemaps.names.length >= 2 ? FP.basemaps.names : FP.demo?.active ? ["aerial", "topo"] : [];
        // TR1: the map just left hands over its camera and its picture (map-handoff.js): this map opens where that one was, under the
        // picture, and moves on from there; its background too, so the ground does not change under the move (not remembered here)
        takeHandoff();
        const h = me.handoff?.refit() || null;
        const start = me.base = (h?.base && choices.includes(h.base) ? h.base : null) || FP.mapPalette?.startBackground?.(stored, choices) || "aerial";
        const darkGround = (k) => (k === "aerial" ? !FP.basemaps.missingKey || /dark/.test(getComputedStyle(root.document.documentElement).colorScheme || "") : false);
        me.onDark = darkGround(start);
        // PH2: the credit is the small "i" in the bottom left (its terms need it within reach; tapping it shows it), never a dark box
        // across the map under the +, which sits bottom right above the list
        const at = h ? { center: h.camera.center, zoom: h.camera.zoom } : { bounds: NZ };
        const map = me.map = new gl.Map({ container: mapBox, style: FP.basemaps.style(start, { reliefOnAerial: false }), ...at, attributionControl: false, pitchWithRotate: false, dragRotate: false });
        me.unhand = FP.mapHandoff?.register(map, { kind: "phone-home", base: () => me.base, marks: () => stage.querySelectorAll(".pa-label:not([hidden])") }) || null;
        h?.raise();   // (the picture stays over the map made under it)
        h?.watch(map);   // (and goes once this map has drawn, whatever the area's read is doing)
        map.addControl(new gl.AttributionControl({ compact: true }), "bottom-left");
        FP.basemaps.quietCredit?.(map);
        map.touchZoomRotate?.disableRotation?.();
        // RF1: Aerial | Topo, one tap away. (PH5: Home reads the overviews' remembered background and never writes it: the choice here
        // is for this visit; the one kept is made on Places or the Water quality page)
        if (choices.length >= 2) {
          const mark = () => { for (const b of bg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.base === me.base)); };
          const use = async (k) => {
            if (!live() || k === me.base) return;
            me.base = k; mark();
            me.onDark = darkGround(k);
            me.paintEdge?.();
            me.paintSubs?.();
            if (!FP.basemaps.names.includes(k)) return;   // (the demo: the plain ground stands for both)
            // TR1: the two backgrounds cross-faded (basemaps.js swap), never the plain ground between them
            try { await (FP.basemaps.swap || FP.basemaps.pick)(map, k); } catch { /* the plain ground stays */ }
          };
          bg.replaceChildren(...[["aerial", "Aerial"], ["topo", "Topo"]].filter(([k]) => choices.includes(k)).map(([k, t]) => el("button", { type: "button", "data-base": k, onclick: () => use(k) }, t)));
          bg.hidden = false; mark();
        }
        map.on("load", async () => {
          if (!live()) return;
          if (start !== "aerial") FP.basemaps.pick(map, start).catch(() => {});
          // the group's own soft hue, as Places draws it (map-palette.js); PH2: one thin line, the group's outer edge only (the owner:
          // "show the group first"), over the faintest fill. PH5: everything outside the area under the mask, so the line is quiet
          const cs = getComputedStyle(root.document.documentElement), css = (k) => cs.getPropertyValue(k);
          const hue = FP.mapPalette ? FP.mapPalette.hues(css)[FP.mapPalette.hueIndex(group.parent_org_id || group.id)] : "#5f9bd8";
          // TR1: the group's edge drawn exactly as Places draws the group (its hue's line over a faint casing, map-palette.js look), so
          // the move from Places reads as zooming into the same thing; a sub-group as Places draws a sub-group
          const edgeLook = () => FP.mapPalette?.look(hue, { sub: !!group.parent_org_id, onDark: me.onDark }) || { line: hue, casing: "rgba(0, 0, 0, 0.38)", lineWidth: 1.5 };
          const look = edgeLook();
          me.paintEdge = () => {
            const lk = edgeLook();
            if (map.getLayer("pa-area-line")) map.setPaintProperty("pa-area-line", "line-color", lk.line);
            if (map.getLayer("pa-area-casing")) map.setPaintProperty("pa-area-casing", "line-color", lk.casing);
          };
          const none = { type: "FeatureCollection", features: [] };
          map.addSource("pa-mask", { type: "geojson", data: none });
          map.addSource("pa-area", { type: "geojson", data: none });
          map.addSource("pa-subs", { type: "geojson", data: none });
          map.addSource("pa-edge", { type: "geojson", data: none });
          // (the mask first: under the area, the sub-groups, the outline and the person's dot; the names and controls are over the map)
          map.addLayer({ id: "pa-mask", type: "fill", source: "pa-mask", paint: { "fill-color": "#000000", "fill-opacity": FP.mapPalette?.MASK_OPACITY ?? 0.45, "fill-antialias": false } });
          map.addLayer({ id: "pa-area-fill", type: "fill", source: "pa-area", paint: { "fill-color": hue, "fill-opacity": 0.06, "fill-antialias": false } });   // (no seams where the areas meet)
          // PH5: the sub-groups told apart by fill, a hairline of the same hue between neighbours, no dashed casing
          map.addLayer({ id: "pa-subs-fill", type: "fill", source: "pa-subs", paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fo"] } });
          map.addLayer({ id: "pa-subs-line", type: "line", source: "pa-subs", layout: { "line-join": "round" }, paint: { "line-color": ["get", "line"], "line-width": FP.mapPalette?.SUBGROUP_LINE ?? 0.75, "line-opacity": 0.9 } });
          map.addLayer({ id: "pa-area-casing", type: "line", source: "pa-edge", layout: { "line-join": "round" }, paint: { "line-color": look.casing, "line-width": look.lineWidth + 2 } });
          map.addLayer({ id: "pa-area-line", type: "line", source: "pa-edge", layout: { "line-join": "round" }, paint: { "line-color": look.line, "line-width": look.lineWidth } });
          // TR1: arriving from another map, what this map adds comes in by fading (the outline is already in the picture handed over)
          if (h) for (const id of ["pa-mask", "pa-subs-fill", "pa-subs-line"]) FP.mapHandoff.setLevel(map, id, 0);
          // (and the place's own fill starts as Places fills it, then thins to Home's faint one as the sub-groups' fills come: arrive)
          if (h) { me.fillFrom = look.fillOpacity ?? 0.2; map.setPaintProperty("pa-area-fill", "fill-opacity", me.fillFrom); }
          map.addSource("pa-me", { type: "geojson", data: meData(me.located) });
          map.addLayer({ id: "pa-me-ring", type: "fill", source: "pa-me", filter: ["==", ["get", "kind"], "ring"], paint: { "fill-color": "#2f7de1", "fill-opacity": 0.14 } });
          map.addLayer({ id: "pa-me-dot", type: "circle", source: "pa-me", filter: ["==", ["get", "kind"], "dot"], paint: { "circle-radius": 7, "circle-color": "#2f7de1", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
          applyShow();   // MV2: as the sheet's Map switches stand (the shade as this device last left it)
          // TR1: the outline handed over with the tap (the same read of the same area, made by the map just left) frames the map at once;
          // this Home's own read of it still runs (for the sheet's facts) and is otherwise not waited for
          const shape = h?.place?.geometry && h.place.bbox ? { geometry: h.place.geometry, bbox: h.place.bbox } : await area;
          if (!live()) return;
          let box = null;
          if (shape?.geometry) {
            map.getSource("pa-area").setData({ type: "Feature", properties: {}, geometry: shape.geometry });
            // (arriving: its rings at once, as the map left drew them, until the outer edge below is worked out)
            if (h) map.getSource("pa-edge").setData({ type: "Feature", properties: {}, geometry: shape.geometry });
            box = shape.bbox;
            // review of #538, 9: the outline after the map is drawn, never before; worked out once per group and area (phone-model
            // outlineFor: kept in memory and on this phone, by a hash of the area), so a Home opened again draws it at once
            let store = null; try { store = root.localStorage; } catch { /* private mode */ }
            const drawEdge = () => {
              if (!live()) return;
              const edge = P().outlineFor(shape.geometry, { store, key: group.id });
              if (edge && live() && map.getSource("pa-edge")) map.getSource("pa-edge").setData({ type: "Feature", properties: {}, geometry: edge });
              // PH5: the mask from the same kept outline (worked out once per outline: map-palette.js outsideMask)
              const mask = edge && FP.mapPalette?.outsideMask?.(edge);
              if (mask && live() && map.getSource("pa-mask")) {
                map.getSource("pa-mask").setData(mask);
                // TR1: the darkening outside comes in by fading (during the move, when arriving from another map), never a pop
                // (arriving: once the picture has gone, so the darkening is part of the move, not built up under the fading picture)
                Promise.resolve(h?.reveal(map)).then(() => { if (live()) FP.mapHandoff?.fade(map, "pa-mask", { from: 0, to: 1, ms: h ? 600 : 350 }); });
              }
            };
            if (P().outlineHeld(shape.geometry, { store, key: group.id })) drawEdge();
            else if (root.requestIdleCallback) root.requestIdleCallback(drawEdge, { timeout: 600 }); else root.setTimeout(drawEdge, 50);
          }
          if (!box) {
            const s = await sites.catch(() => []);
            const pts = (s || []).map((x) => x.lngLat);
            if (pts.length) box = [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]];
          }
          if (!live()) return;
          // TR1: arriving from another map, one ease from where it was (arrive); otherwise framed at once, as before
          if (h) { arrive(h, map, box, framed); return; }
          if (box && !me.located) map.fitBounds(box, { padding: pad(), maxZoom: 14, duration: 0 });
          framed();
          function framed() {
            const c = map.getCenter();
            me.centre = { lat: c.lat, lon: c.lng };
            draw();
            me.loaded = true;
            afterMap();   // the sub-groups' names and Home's sheet, now the area is drawn
            labels();     // (the reads may have started already, from the timer)
          }
        });
      } catch { mapBox.replaceChildren(el("p", { class: "pa-quiet" }, "The map couldn't open here.")); afterMap(); }
      // (a map whose style never loads, its tiles failing on a poor connection, still gets its sheet, in time)
      me.latest = root.setTimeout?.(() => afterMap(), FP.phoneArea.latestMs ?? AFTER_MAP_LATEST);   // (latestMs: the browser walk's shorter wait)
    }
    // TR1: the picture of the map just left is laid over this map's box before the first frame of this screen is drawn (the map itself is
    // made a frame later, under it), so no frame shows an empty map
    function takeHandoff() {
      if (me.handoff !== undefined || !live() || !mapBox.isConnected) return;
      me.handoff = FP.mapHandoff?.take({ box: mapBox, id: group.id }) || null;
      me.handoff?.cover();
    }
    // (as soon as this Home is on the page, in the same task that put it there: no frame is drawn before it)
    (root.queueMicrotask || ((f) => Promise.resolve().then(f)))(takeHandoff);
    root.requestAnimationFrame?.(() => { takeHandoff(); root.requestAnimationFrame(() => { peek.setVar(); makeMap(); }); });
    // (a phone turned, or the browser's bars coming and going: the sheet's half way is worked out again)
    me.onResize = () => { if (!live()) return; if (peek.state() === "half") peek.open("half", { animate: false }); peek.setVar(); };
    root.addEventListener("resize", me.onResize);
    // already allowed: the person's position at once, without a prompt
    FP.locate?.permission?.().then((s) => { if (s === "granted" && live()) find(false); });
    return wrap;
  }

  function close() {
    const me = shown;
    shown = null;
    if (!me) return;
    me.alive = false;
    if (me.onResize) root.removeEventListener("resize", me.onResize);
    root.clearTimeout?.(me.latest);
    try { me.cancelGo?.(); } catch { /* gone */ }
    try { me.stop?.(); } catch { /* gone */ }
    try { me.overlay?.remove(); } catch { /* gone */ }
    try { me.handoff?.drop(); me.unhand?.(); } catch { /* gone */ }   // TR1
    try { me.map?.remove(); } catch { /* gone */ }
  }

  // HM1: search() pulls Home's sheet up with its search box in hand (the bar's More, Search), false when Home is not showing;
  // sheet() says where the sheet is (for the browser walk), and sheet("half" | "peek") moves it
  const search = () => !!(shown?.alive && shown.wrap?.isConnected && shown.peek?.focusSearch());
  const sheet = (to) => {
    const p = shown?.alive ? shown.peek : null;
    if (!p) return null;
    if (to) p.open(to, { animate: false });
    return { state: p.state(), height: p.height(), half: p.half(), peek: p.peekHeight() };
  };
  FP.phoneArea = { view, close, phone, search, sheet, debug: () => shown?.map || null, base: () => shown?.base || null, place: () => shown?.place || null };
})(window);
