// N2: water quality sites in Maps. On a farm's or a group's published map, a "Water quality" button switches the monitoring sites on:
// the sites near the farm (wq_sites_near, as the farm's "Water quality nearby" line reads them) or the group's sites (group_wq_sites,
// as the group space reads them), drawn as pins named at close zoom. Opening a site shows a panel (beside the map on a computer, a
// sheet from the bottom on a phone): its source and the "provisional" note where the source says so, its record, and for the chosen
// measure a chart (the Chart block) with the NPS-FM band shading where there are bands, the NPS-FM band, the indicative trend and LAWA's
// published state and trend, then the latest result of every measure. Up to six sites can be compared: one chart, a line per site, and
// a table. js/viewer.js is not changed: the button and the panel are the app's own, laid over the map the viewer fills.
// N2b (the live check, 12 Nov 2026): the button is placed by measuring the viewer's own buttons (how many there are differs per map), so
// it never sits under one; a group the old model has no area for (an MCCC sub-group: an organisation and a published map) lists the
// shared sites inside its published map (reference_view_features over the map's bounds, then those sites' monitoring_sites rows); the
// list leads with sites sampled lately, folds away sites with no results and has a search; numbers are shown to sensible figures; the
// source's credit is said once, at the foot; a measure's chart comes first; a failed series read is tried once more as samples only.
// Every read is the signed-in person's own, through the existing functions and policies (wq_site_latest, site_record_summary,
// measurement_series, wq_state_trend_for_site, reference_view_features, monitoring_sites, and the `analysis` function's preview,
// which computes the median, band and trend with the tested library and stores nothing). Nothing here widens what anyone can read.
// The words are wq-sites-model.js's.
(function (root) {
  const FP = root.FP;
  const M = () => FP.wqSitesModel, W = () => FP.wqModel, A = () => FP.wqAnalysis;
  const CONCURRENCY = 4, IN_BATCH = 200, MAX_SPLITS = 2, SHOW_KEY = "wqs-show-older";
  const list = (v) => (Array.isArray(v) ? v : []);
  // replaceChildren would print a left-out part (null) as the word "null": leave such parts out
  const fill = (node, ...kids) => node.replaceChildren(...kids.filter((k) => k != null && k !== false));

  async function pool(tasks, n) {
    const out = new Array(tasks.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
    return out;
  }

  // map: the MapLibre map RCLViewer.mount returned; holder: the element the viewer fills; owner: { farm } or { org }; state: kept by
  // maps-view across a redraw of the same map (renewed links), so what the person had open stays open; bounds: the published map's
  // [west, south, east, north]. Returns { remove() }.
  function attach({ map, holder, sb, owner, state, bounds = null, el = FP.el, now = () => Date.now() }) {
    const st = state || {};
    st.chosen = list(st.chosen); st.years = M().pickYears(st.years); st.cache = st.cache || new Map(); st.query = st.query || "";
    // N2c: older and sparse sites are hidden until the person switches them on; the choice is remembered on this device
    if (st.showAll === undefined) { try { st.showAll = root.localStorage?.getItem(SHOW_KEY) === "1"; } catch { st.showAll = false; } }
    const gl = root.maplibregl;
    let sites = null, where = owner.farm ? "farm" : "group", partial = false, gone = false, token = 0, chart = null, framed = !!st.framed;
    const markers = new Map();

    // ---- reads, each once per map (failures are not kept) ------------------------------------------------------------------
    const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data || []; };
    // bad(value): a reply that resolved but is a failure (the analysis function's {kind: "error"}): not kept either
    function once(key, make, bad = () => false) {
      if (!st.cache.has(key)) {
        const p = make(); st.cache.set(key, p);
        p.then((v) => { if (bad(v) && st.cache.get(key) === p) st.cache.delete(key); }, () => { if (st.cache.get(key) === p) st.cache.delete(key); });
      }
      return st.cache.get(key);
    }
    // A group's sites; when the group read has none (no area in the old model), the shared sites inside the published map.
    const readSites = () => once("sites", async () => {
      if (owner.farm) return { rows: await rpc("wq_sites_near", { farm_id: owner.farm, km: W().RADIUS_KM }), where: "farm" };
      const rows = await rpc("group_wq_sites", { g: owner.org });
      if (rows.length || !M().boxes(bounds).length) return { rows, where: "group" };
      const box = await sitesInBox(bounds);
      return { rows: box.rows, where: "map", partial: box.partial };
    });
    // reference_view_features (the ECan site list's features in a box, at most 1000; a fuller box is split, at most twice), then the
    // monitoring sites of those features (monitoring_sites: shared, served sites, which every signed-in person may read), then their
    // latest sample (site_record_summary: council sites). Bounded: at most 4^MAX_SPLITS boxes, ids read IN_BATCH at a time.
    // partial: a box still too full after its splits, or more sites than MAX_READ: the list says not every site is listed.
    async function sitesInBox(b) {
      const features = [];
      let partial = false;
      const take = async (box, depth) => {
        const res = await rpc("reference_view_features", { source: "ecan-wq-sites", x0: box[0], y0: box[1], x1: box[2], y1: box[3] });
        if (res?.truncated && depth < MAX_SPLITS) { for (const q of M().quarters(box)) await take(q, depth + 1); return; }
        if (res?.truncated) partial = true;
        features.push(...list(res?.features?.features));
      };
      for (const box of M().boxes(b)) await take(box, 0);
      const all = [...new Set(features.map((f) => Number(f.id)).filter(Number.isFinite))];
      if (all.length > M().MAX_READ) partial = true;
      const ids = all.slice(0, M().MAX_READ);
      const siteRows = [], summary = [];
      for (let i = 0; i < ids.length; i += IN_BATCH) {
        const { data, error } = await sb.from("monitoring_sites").select("id, external_id, name, site_type, source_key, feature_id")
          .eq("source_key", "ecan-wq-sites").in("feature_id", ids.slice(i, i + IN_BATCH)).limit(IN_BATCH);
        if (error) throw error;
        siteRows.push(...list(data));
      }
      // one row per site AND parameter family, and the API answers at most 1000 rows a request: read in pages (M().summaryRows)
      try { summary.push(...await M().summaryRows(sb, siteRows.map((r) => r.id))); }
      catch { /* without it the sites still list, as having no results yet */ }
      return { rows: M().boxRows(siteRows, features, summary), partial };
    }
    const latestOf = (id) => once("latest|" + id, async () => W().latest(await rpc("wq_site_latest", { site: id })));
    // the council's summary, for shared sites only (M().record); a failed read is not kept and shows no line
    const recordOf = (site) => (!site.shared ? Promise.resolve(null) : once("record|" + site.id, async () => {
      const { data, error } = await sb.from("site_record_summary").select("family, n, first_sampled, last_sampled, years, refreshed_at").eq("site_id", site.id).limit(40);
      if (error) throw error;
      return M().record(data, site);
    }).catch(() => null));
    // A measure's results in the window. A read that fails is tried once more as samples only (resolution "raw": no daily means),
    // which is cheaper for the database; { rows, raw } says which was drawn.
    const seriesOf = (id, parameter, years) => once(["series", id, parameter, years].join("|"), async () => {
      const from = M().windowStart(new Date(now()).toISOString(), years), args = { site: id, parameter_key: parameter, ...(from ? { from_time: from } : {}) };
      try { return { rows: await rpc("measurement_series", args), raw: false }; }
      catch { return { rows: await rpc("measurement_series", { ...args, resolution: "raw" }), raw: true }; }
    });
    const analysis = (tool, id, parameter, years) => {
      // WQV1: a groundwater site is never sent for an NPS-FM band (the river and lake bands do not apply to a well)
      if (tool === "band" && !M().gradable(byId(id))) return Promise.resolve({ groundwater: true });
      const body = M().analysisRequest(owner, tool, id, parameter, years);
      return body ? once("analysis|" + M().requestKey(body), () => A().request(sb, body), (r) => r?.kind === "error") : Promise.resolve(null);
    };
    // { rows }, or { failed: true } when the read failed (said as such, and not kept), or null for a site LAWA does not report on
    const lawaOf = (site) => (site.shared && site.source_key === "ecan-wq-sites"
      ? once("lawa|" + site.id, () => rpc("wq_state_trend_for_site", { site: site.id })).then((rows) => ({ rows }), () => ({ failed: true })) : Promise.resolve(null));
    const byId = (id) => sites?.find((s) => s.id === id) || null;

    // ---- the button over the map: placed under the viewer's own buttons, never on one ------------------------------------------
    // The viewer's buttons differ per map (a compare control on some), and its "Whole property" button sits under them on a
    // computer, so a fixed place would land on one. The button is the app's own, laid over the map, and moved to just below whichever
    // of them reaches lowest down the right-hand side, each time they change size or the map does.
    const toggle = el("button", { type: "button", class: "wqs-toggle", "aria-pressed": "false", title: "Show the water quality monitoring sites on this map",
      onclick: () => (st.on ? switchOff() : switchOn()) }, el("span", { class: "wqs-drop", "aria-hidden": "true" }), el("span", {}, "Water quality"));
    // PH2: on a phone the list of sites opens only on request: "Sites" beside the chip once the dots are on (a dot still opens its site)
    // (review of #538, 7: the sites chosen stay chosen; the panel opens on them, with "All sites" back to the list)
    const listBtn = el("button", { type: "button", class: "wqs-list-btn", "aria-label": "List the water quality sites", onclick: () => { openPanel(); render(true); } }, "Sites");
    const control = el("div", { class: "wqs-ctrl" }, toggle, listBtn);
    holder.append(control);
    const phone = () => !!root.matchMedia?.("(max-width: 720px)").matches;
    function place() {
      if (gone) return;
      // PH2: on a phone the chip sits top left, under "Whole area" (the right-hand side is the map's one cluster of controls)
      if (phone()) {
        const h = holder.getBoundingClientRect(), fit = holder.querySelector(".rv-fit")?.getBoundingClientRect();
        control.style.right = "auto"; control.style.left = "12px";
        control.style.top = (fit && fit.height ? Math.round(fit.bottom - h.top + 10) : 12) + "px";
        return;
      }
      control.style.left = "";
      const h = holder.getBoundingClientRect(), stack = holder.querySelector(".maplibregl-ctrl-top-right");
      const covers = [...(stack ? [stack] : []), ...holder.querySelectorAll(".rv-fit")].map((n) => n.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0 && r.right > h.left + h.width / 2);   // only what is on the right-hand side
      const s = stack?.getBoundingClientRect();
      const right = s && s.width ? Math.max(h.right - s.right, 0) + 10 : 10;
      const top = M().buttonTop(covers.map((r) => ({ top: r.top - h.top, bottom: r.bottom - h.top, left: r.left - h.left, right: r.right - h.left })), h.width - right);
      control.style.top = top + "px"; control.style.right = right + "px";
    }
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    const changes = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => { observe(); place(); });
    function observe() {
      if (!watch) return;
      watch.disconnect(); watch.observe(holder);
      for (const n of holder.querySelectorAll(".maplibregl-ctrl-top-right, .maplibregl-ctrl-top-right > *, .rv-fit")) watch.observe(n);
    }
    observe();
    changes?.observe(holder, { childList: true, subtree: true });
    map.on("resize", place);
    place();

    // ---- the panel ----------------------------------------------------------------------------------------------------------
    const back = el("button", { type: "button", class: "wqs-back", hidden: true, onclick: () => { st.chosen = []; st.adding = false; drawPins(); render(); } }, "‹ All sites");
    const close = el("button", { type: "button", class: "wqs-close", "aria-label": "Close water quality", onclick: () => closePanel(true) }, "×");
    const body = el("div", { class: "wqs-body" });
    const status = el("p", { class: "wqs-status", role: "status", "aria-live": "polite" });
    const panel = el("section", { class: "wqs-panel", role: "dialog", "aria-modal": "false", "aria-label": "Water quality", hidden: true },
      el("div", { class: "wqs-bar" }, back, close), status, body);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePanel(true); } });
    holder.append(panel);

    function openPanel() { panel.hidden = false; holder.classList.add("wqs-open"); place(); }
    function closePanel(focusToggle) {
      panel.hidden = true; holder.classList.remove("wqs-open"); token++;
      // (PH2: a chart brought into view can scroll the map's own box, which never scrolls by design: put it back, so nothing on the map
      // is left under the header)
      if (holder.scrollTop) holder.scrollTop = 0;
      place();
      chart?.destroy(); chart = null;
      if (focusToggle) toggle.focus({ preventScroll: true });
    }
    const say = (t) => { status.textContent = t || ""; };

    // ---- the pins -----------------------------------------------------------------------------------------------------------
    // PH2: the dots' size follows the zoom (small far out), and where they would pile up only the first of them shows until zoomed in:
    // the chosen ones, then the group's own, then sites with recent results (wq-sites-model thin)
    const near = () => {
      const z = map.getZoom();
      holder.classList.toggle("wqs-near", z >= M().LABEL_ZOOM);
      holder.dataset.wqsZoom = z < 10 ? "far" : z < 13 ? "mid" : "near";
      thin();
    };
    function thin() {
      if (!markers.size) return;
      const byId = new Map((sites || []).map((s) => [s.id, s]));
      const pts = [...markers.keys()].map((id) => { const s = byId.get(id), p = map.project(s.lngLat); return { id, x: p.x, y: p.y, rank: M().thinRank(s, st.chosen) }; });
      const hide = M().thin(pts, M().DOT_GAP);
      for (const [id, m] of markers) m.pin.classList.toggle("wqs-thinned", hide.has(id));
    }
    function drawPins() {
      clearPins();
      if (!gl?.Marker || !sites) return;
      for (const s of M().pinned(sites, st.chosen, st.showAll).filter((x) => x.lngLat)) {
        // WQV1: the page's symbols: a square for groundwater, a ring for the group's own
        const pin = el("button", { type: "button", class: "wqs-pin" + (s.current && !s.sparse ? "" : " wqs-older") + (s.waterType === "groundwater" ? " wqs-gw" : "") + (s.owned ? " wqs-own" : ""), "data-wqs-site": s.id,
          title: s.name + (s.line ? " · " + s.line : ""), "aria-label": "Water quality site: " + s.name + (s.line ? ", " + s.line : ""),
          onclick: (e) => { e.stopPropagation(); pinClicked(s.id); } }, el("i", { "aria-hidden": "true" }), el("span", { class: "wqs-label" }, s.name));
        markers.set(s.id, { pin, marker: new gl.Marker({ element: pin, anchor: "center" }).setLngLat(s.lngLat).addTo(map) });
      }
      mark(); near();
    }
    function clearPins() { for (const m of markers.values()) m.marker.remove(); markers.clear(); }
    function mark() {
      holder.classList.toggle("wqs-comparing", st.chosen.length > 1);
      for (const [id, m] of markers) {
        const slot = st.chosen.indexOf(id) + 1;
        m.pin.classList.toggle("wqs-chosen", slot > 0);
        if (slot) { m.pin.dataset.slot = String(slot); m.pin.querySelector("i").textContent = st.chosen.length > 1 ? String(slot) : ""; }
        else { delete m.pin.dataset.slot; m.pin.querySelector("i").textContent = ""; }
        m.pin.setAttribute("aria-pressed", String(slot > 0));
      }
      thin();
    }
    // The first time the sites go on, the map widens (never zooms in) so every pin is clear of what sits over the map: the viewer's
    // panel (left on a computer), the map's buttons and this panel (right), the sheet (bottom, on a phone).
    function frame() {
      if (framed || !gl?.LngLatBounds) return;
      const pts = M().pinned(sites, st.chosen, st.showAll).filter((s) => s.lngLat).map((s) => s.lngLat);
      if (!pts.length) return;
      framed = st.framed = true;
      const w = holder.clientWidth, h = holder.clientHeight;
      const pad = M().framePadding(w, h, control.getBoundingClientRect().width || 120);
      const clear = (p) => { const q = map.project(p); return q.x >= pad.left && q.x <= w - pad.right && q.y >= pad.top && q.y <= h - pad.bottom; };
      if (pts.every(clear)) return;
      const b = map.getBounds(), all = new gl.LngLatBounds(b.getSouthWest(), b.getNorthEast());
      for (const p of pts) all.extend(p);
      map.fitBounds(all, { padding: pad, maxZoom: map.getZoom(), duration: 0 });
    }

    // ---- on and off ---------------------------------------------------------------------------------------------------------
    async function switchOn() {
      st.on = true; toggle.setAttribute("aria-pressed", "true"); holder.classList.add("wqs-on");
      // PH2: on a phone the dots come on alone; the list waits for "Sites" (a site already chosen opens as before)
      if (!phone() || st.chosen?.length) openPanel(); else place();
      fill(body); say("Loading the water quality sites…");
      const t = ++token;
      // WQV1: a sub-group's own site is named for its sub-group (the person's groups), as on the Water quality page
      const names = new Map((FP.groupSpace?.groups?.() || []).map((g) => [g.id, g.name]));
      try { const read = await readSites(); where = read.where; partial = !!read.partial; sites = M().restore(M().siteList(read.rows, owner, now(), where, names), st); }
      catch { if (t === token && !gone) { say(""); fill(body, el("p", {}, "Couldn't load the water quality sites just now."), el("button", { type: "button", class: "wqs-button", onclick: switchOn }, "Try again")); } return; }
      if (gone || !st.on) return;
      drawPins(); frame();
      if (t === token) render();
    }
    // The person switching the sites off ends the visit: sites found sparse in it are held back the next time they are switched on.
    function switchOff() {
      st.heldBack = new Set([...(st.heldBack || []), ...(st.sparse || [])]); st.sparse = new Set();
      st.on = false; st.chosen = []; st.adding = false; toggle.setAttribute("aria-pressed", "false");
      holder.classList.remove("wqs-on", "wqs-near", "wqs-comparing"); clearPins(); closePanel(false);
    }
    // A pin: the site alone, or added to the comparison when the person is adding sites (or already comparing).
    function pinClicked(id) {
      const adding = st.adding || st.chosen.length > 1;
      if (adding && !st.chosen.includes(id) && M().full(st.chosen)) { openPanel(); say("You can compare up to " + M().MAX_CHOSEN + " sites. Remove one to add another."); return; }
      pick(id, adding);
    }
    function pick(id, add) {
      st.chosen = M().choose(st.chosen, id, { add });
      if (st.chosen.length > 1 || !add) st.adding = false;
      if (!markers.has(id)) drawPins(); else mark();
      openPanel(); render(true);
    }

    // ---- what the panel shows ----------------------------------------------------------------------------------------------
    function render(focus = false) {
      chart?.destroy(); chart = null; say("");
      back.hidden = st.chosen.length === 0;
      panel.dataset.view = st.chosen.length === 0 ? "list" : st.chosen.length === 1 ? "site" : "compare";   // a phone keeps the list short, so the pins show above it
      const view = st.chosen.length === 0 ? showList() : st.chosen.length === 1 ? showSite(st.chosen[0]) : showCompare();
      if (focus) Promise.resolve(view).then(() => body.querySelector("h2")?.focus({ preventScroll: true }));
      return view;
    }
    const heading = (text) => el("h2", { tabindex: "-1" }, text);
    const siteButton = (s) => el("li", {}, el("button", { type: "button", class: "wqs-site" + (s.current ? "" : " wqs-older"), onclick: () => pick(s.id, false) },
      el("b", {}, s.name), s.line || s.held || s.sparse ? el("small", {}, [s.line, s.held ? "older or sparse" : s.sparse ? "few results" : ""].filter(Boolean).join(" · ")) : null));

    // The list: sites sampled lately first, then older ones; those with no results folded away; a search over every site read.
    function showList() {
      const results = el("div", { class: "wqs-results" }), intro = el("p", { class: "wqs-meta" });
      const search = el("input", { type: "search", class: "wqs-search", placeholder: "Search every site by name", "aria-label": "Search water quality sites by name", value: st.query });
      const toggleAll = el("input", { type: "checkbox", class: "wqs-show-all", role: "switch", ...(st.showAll ? { checked: true } : {}) });
      const fold = (label, items, open) => el("details", { class: "wqs-none", ...(open ? { open: true } : {}) }, el("summary", {}, label + " (" + items.length + ")"), el("ul", { class: "wqs-list" }, ...items.map(siteButton)));
      const draw = () => {
        const l = M().listing(sites, st.query, st.showAll);
        intro.textContent = M().intro(sites, owner, where, st.showAll, l.search);
        fill(results,
          l.shown.length ? el("ul", { class: "wqs-list" }, ...l.shown.map(siteButton)) : null,
          l.more ? el("p", { class: "wqs-hint" }, l.more + " more " + (l.more === 1 ? "site is" : "sites are") + " not listed. Search by name to find " + (l.more === 1 ? "it." : "them.")) : null,
          l.others.length || l.none.length ? el("details", { class: "wqs-held", open: true }, el("summary", {}, "Older or sparse sites (" + l.held + ")"),
            l.others.length ? el("ul", { class: "wqs-list" }, ...l.others.map(siteButton)) : null, l.none.length ? fold("Sites with no results", l.none, false) : null,
            l.left ? el("p", { class: "wqs-hint" }, l.left + " more " + (l.left === 1 ? "is" : "are") + " not listed; search by name to find one.") : null) : null,
          st.query && !l.matched ? el("p", { class: "wqs-hint" }, "No site's name matches “" + st.query + "”.") : null);
      };
      search.addEventListener("input", () => { st.query = search.value; draw(); });
      toggleAll.addEventListener("change", () => {
        st.showAll = toggleAll.checked;
        try { root.localStorage?.setItem(SHOW_KEY, st.showAll ? "1" : "0"); } catch { /* not remembered: still applies now */ }
        drawPins(); draw();
      });
      const held = sites.filter((s) => !s.current).length;
      // WQV1: a group's map leads to its Water quality page (every site, Surface water and Groundwater, Map, Chart and Table)
      const page = owner.org && FP.groupModel ? el("p", { class: "wqs-hint wqs-pagelink" }, el("a", { href: FP.href(FP.groupModel.href(owner.org, "water")) }, "Open the Water quality page")) : null;
      fill(body, heading("Water quality sites"), page, intro,
        held ? el("label", { class: "wqs-switch" }, toggleAll, el("span", {}, "Show older and sparse sites")) : null,
        held ? el("p", { class: "wqs-hint" }, M().HELD_WORDS) : null,
        partial ? el("p", { class: "wqs-hint wqs-partial" }, M().PARTIAL) : null,
        sites.length ? el("p", { class: "wqs-hint" }, "Choose a site on the map or in this list to see its results. You can then compare up to " + M().MAX_CHOSEN + " sites.") : null,
        sites.length ? search : null, results);
      draw();
    }

    // The control to add a site to the comparison: a list of the other sites with results (a keyboard or a phone need not find the pin).
    function adder() {
      if (M().full(st.chosen)) return el("p", { class: "wqs-hint" }, "You are comparing the most sites at once (" + M().MAX_CHOSEN + "). Remove one to add another.");
      const pickList = el("select", { class: "wqs-add", "aria-label": "Add a site to compare" }, el("option", { value: "" }, "Add a site…"),
        ...sites.filter((s) => s.hasResults && !st.chosen.includes(s.id)).slice(0, M().MAX_READ).map((s) => el("option", { value: String(s.id) }, s.name + (s.away ? " (" + s.away + ")" : ""))));
      pickList.addEventListener("change", () => { const id = Number(pickList.value); if (id) pick(id, true); });
      return el("div", { class: "wqs-adder" }, el("p", { class: "wqs-hint" }, "Tap another site on the map, or choose one here:"), pickList);
    }
    const select = (label, cls, options, value, onchange) => {
      const s = el("select", { class: cls }, ...options.map(([v, t]) => el("option", { value: String(v), ...(String(v) === String(value) ? { selected: true } : {}) }, t)));
      s.addEventListener("change", () => onchange(s.value));
      return el("label", { class: "wqs-field" }, el("span", {}, label), s);
    };
    const periodPicker = (redraw) => select("Period", "wqs-years", M().WINDOWS.map((w) => [w.years, w.label]), st.years, (v) => { st.years = M().pickYears(v); redraw(); });
    // N2c: the period holds none of the results: one tap to the whole record (the period picker follows)
    const wholeRecord = (redraw) => el("button", { type: "button", class: "wqs-button", onclick: () => {
      st.years = 0; for (const p of body.querySelectorAll(".wqs-years")) p.value = "0"; redraw();
    } }, "Show the whole record");
    function drawChart(host, data) {
      chart?.destroy();
      chart = FP.blocks.render(host, { block: "chart", owner: owner.farm ? { farm: owner.farm } : { org: owner.org } }, { read: () => data, level: 3, href: FP.href });
    }
    // How the figures were worked out: the library's methods and caveats, as its previews give them.
    function how(results) {
      const previews = results.filter((r) => r?.kind === "preview").map((r) => r.preview);
      const methods = [...new Set(previews.map((p) => p.method?.id + (p.method?.name ? ": " + p.method.name : "")).filter((x) => x && !x.startsWith("undefined")))];
      const caveats = [...new Set(previews.flatMap((p) => p.caveats))];
      return el("details", { class: "wqs-how" }, el("summary", {}, "How these are worked out"),
        el("p", {}, "The median, band and trend are worked out by the platform's tested water-quality library from the results you can read, each time you look; nothing is stored. Bands follow the NPS-FM; the trend is indicative."),
        methods.length ? el("ul", {}, ...methods.map((m) => el("li", {}, m))) : null,
        caveats.length ? el("ul", { class: "wqs-caveats" }, ...caveats.map((c) => el("li", {}, c))) : null);
    }
    const creditLine = (...latests) => { const c = M().credit(...latests); return c ? el("p", { class: "wqs-source" }, c) : null; };

    // One site: its facts, then the chosen measure (picker, chart, band, trend, LAWA), then the latest result of every measure.
    async function showSite(id) {
      const t = ++token, site = byId(id);
      if (!site) { st.chosen = []; return showList(); }
      fill(body, heading(site.name)); say("Loading this site's results…");
      let latest, rec;
      try { [latest, rec] = await Promise.all([latestOf(id), recordOf(site)]); }
      catch { if (t === token) { say(""); body.append(el("p", {}, "Couldn't read this site's results just now.")); } return; }
      if (t !== token || gone) return;
      say("");
      // N2c: the site's own count, now it is read: too few results of every measure and it is "sparse" (its pin goes paler)
      const refined = M().refine(site, rec);
      if (refined !== site) {
        sites = sites.map((x) => (x.id === id ? refined : x));
        if (refined.sparse) { st.sparse = new Set([...(st.sparse || []), id]); markers.get(id)?.pin.classList.add("wqs-older"); }
      }
      const offered = M().parameters({ [id]: latest }, [id]);
      st.parameter = M().pickParameter(offered, st.parameter);
      const host = el("div", { class: "block-host wqs-chart" }), findings = el("div", { class: "wqs-findings", "aria-live": "polite" });
      const measurePicker = select("Measure", "wqs-parameter", offered.map((p) => [p.key, p.name]), st.parameter, (v) => { st.parameter = v; pressed(); measure(); });
      const values = el("ul", { class: "wqs-values", "aria-label": "Latest results at " + site.name }, ...latest.rows.map((r) => {
        const own = M().recordOf(rec, r.parameter);
        return el("li", {}, el("button", { type: "button", class: "wqs-value", "data-parameter": r.parameter, "aria-pressed": String(r.parameter === st.parameter),
          onclick: () => { st.parameter = r.parameter; measurePicker.querySelector("select").value = r.parameter; pressed(); measure(true); } },
          el("span", { class: "wqs-name" }, r.name), el("span", { class: "wqs-val" }, M().tidy(r.value) + (r.unit ? " " + r.unit : "")),
          el("small", {}, r.date + (r.censored ? " · below or above a detection limit" : "") + (own ? " · " + own.text : ""))));
      }));
      const pressed = () => { for (const b of values.querySelectorAll(".wqs-value")) b.setAttribute("aria-pressed", String(b.dataset.parameter === st.parameter)); };
      fill(body, heading(site.name), site.line ? el("p", { class: "wqs-meta" }, site.line) : null,
        latest.provisional ? el("p", { class: "wqs-meta" }, el("span", { class: "wqs-provisional" }, "Provisional"), " The source says these results are provisional.") : null,
        rec ? el("p", { class: "wqs-meta" }, M().recordLine(rec, W().latestInstant(latest.rows.map((r) => r.sampled_at)))) : null,
        ...(latest.rows.length ? [el("div", { class: "wqs-controls" }, measurePicker, periodPicker(() => measure())), host, findings,
          el("h3", {}, "Latest results"), el("p", { class: "wqs-hint" }, "Choose one to see it over time."), values] : [el("p", {}, "No results are recorded for this site yet.")]),
        el("div", { class: "wqs-actions" }, st.adding ? adder() : el("button", { type: "button", class: "wqs-button", onclick: () => { st.adding = true; render(); body.querySelector(".wqs-add")?.focus(); } }, "Compare with another site")),
        creditLine(latest));
      if (!latest.rows.length) return;
      // focus: the person chose from the list below the chart: bring the chart up and say what it shows
      async function measure(focus = false) {
        const m = ++token, parameter = st.parameter, years = st.years, row = latest.rows.find((r) => r.parameter === parameter);
        fill(host, el("p", { class: "wqs-status" }, "Loading the chart…")); fill(findings);
        if (focus) { host.scrollIntoView?.({ block: "start" }); measurePicker.querySelector("select").focus({ preventScroll: true }); }
        const [series, band, trend, lawa] = await Promise.all([seriesOf(id, parameter, years).catch(() => null), analysis("band", id, parameter, years), analysis("trend", id, parameter, years), lawaOf(site)]);
        if (m !== token || gone) return;
        if (!series) fill(host, el("p", {}, "Couldn't read this measure's results just now."));
        else if (!series.rows.length && years) fill(host, el("p", { class: "wqs-empty" }, M().emptyPeriod(years, row?.sampled_at)), wholeRecord(() => measure()));
        else {
          drawChart(host, M().chartData({ sites: [site], parameter, name: row?.name, unit: row?.unit, seriesBySite: { [id]: series.rows }, latestBySite: { [id]: latest }, years }));
          if (series.raw) host.append(el("p", { class: "wqs-hint" }, "Individual samples only: daily means couldn't be read just now."));
        }
        const b = M().bandWords(band, parameter, offered), tr = M().trendWords(trend, years), l = M().lawaLine(lawa, parameter);
        fill(findings,
          el("p", {}, el("b", {}, "NPS-FM band: "), b.long),
          el("p", { class: tr.little ? "wqs-little" : "" }, el("b", {}, "Trend (indicative): "), tr.long),
          l ? el("p", {}, el("b", {}, "LAWA: "), l) : null,
          how([band, trend]));
        if (focus) host.scrollIntoView?.({ block: "start" });
      }
      return measure();
    }

    // A table cell in two parts, the figure and then (smaller, on its own line) what it rests on: "2.28 mg/L" / "19 Sept 2026".
    const cell = (text, sep) => {
      const at = text.indexOf(sep);
      return at < 0 ? el("td", {}, text) : el("td", {}, el("span", { class: "wqs-figure" }, text.slice(0, at)), el("small", {}, text.slice(at + (sep === ", " ? 2 : 1))));
    };
    // Two to six sites: one chart with a line per site, and a table.
    async function showCompare() {
      const t = ++token, chosen = st.chosen.map(byId).filter(Boolean);
      const chips = el("ul", { class: "wqs-chips", "aria-label": "Sites compared" }, ...chosen.map((s, i) => el("li", { class: "wqs-chip", "data-slot": String(i + 1) },
        el("i", { "aria-hidden": "true" }, String(i + 1)), el("span", {}, s.name),
        el("button", { type: "button", "aria-label": "Remove " + s.name + " from the comparison", onclick: () => { st.chosen = M().remove(st.chosen, s.id); st.adding = false; drawPins(); render(); body.querySelector("h2")?.focus({ preventScroll: true }); } }, "×"))));
      fill(body, heading("Comparing " + chosen.length + " sites"), chips, adder()); say("Loading the sites' results…");
      const latest = {};
      await pool(chosen.map((s) => async () => { try { latest[s.id] = await latestOf(s.id); } catch { latest[s.id] = { rows: [] }; } }), CONCURRENCY);
      if (t !== token || gone) return;
      say("");
      const offered = M().parameters(latest, chosen.map((s) => s.id));
      if (!offered.length) { body.append(el("p", {}, "None of these sites has results recorded yet.")); return; }
      st.parameter = M().pickParameter(offered, st.parameter);
      const host = el("div", { class: "block-host wqs-chart" }), table = el("div", { class: "wqs-table-wrap", "aria-live": "polite" });
      body.append(el("div", { class: "wqs-controls" },
        select("Measure", "wqs-parameter", offered.map((p) => [p.key, p.name + (p.sites < chosen.length ? " (" + p.sites + " of " + chosen.length + " sites)" : "")]), st.parameter, (v) => { st.parameter = v; draw(); }),
        periodPicker(() => draw())), host, table);
      const credit = creditLine(...chosen.map((s) => latest[s.id]));
      if (credit) body.append(credit);
      async function draw() {
        const m = ++token, parameter = st.parameter, years = st.years, p = offered.find((x) => x.key === parameter);
        fill(host, el("p", { class: "wqs-status" }, "Loading the chart…")); fill(table);
        const per = {}, series = {};
        await pool(chosen.map((s) => async () => {
          const row = list(latest[s.id]?.rows).find((r) => r.parameter === parameter);
          const [read, summary, band, trend] = row ? await Promise.all([seriesOf(s.id, parameter, years).catch(() => ({ rows: [] })), analysis("summary", s.id, parameter, years), analysis("band", s.id, parameter, years), analysis("trend", s.id, parameter, years)]) : [{ rows: [] }, null, null, null];
          series[s.id] = read.rows; per[s.id] = { latest: latest[s.id], summary, band, trend };
        }), CONCURRENCY);
        if (m !== token || gone) return;
        if (years && Object.values(series).every((r) => !list(r).length)) {
          const last = W().latestInstant(chosen.map((s) => list(latest[s.id]?.rows).find((r) => r.parameter === parameter)?.sampled_at));
          fill(host, el("p", { class: "wqs-empty" }, M().emptyPeriod(years, last)), wholeRecord(() => draw()));
        } else drawChart(host, M().chartData({ sites: chosen, parameter, name: p?.name, unit: p?.unit, seriesBySite: series, latestBySite: latest, years }));
        const rows = M().compareRows(chosen, parameter, per, years, offered);
        const windowLabel = M().WINDOWS.find((w) => w.years === years)?.label.toLowerCase() || "";
        fill(table, el("table", { class: "wqs-table" }, el("caption", {}, (p?.name || parameter) + ", " + windowLabel),
          el("thead", {}, el("tr", {}, ...["Site", "Latest", "Median", "NPS-FM band", "Trend (indicative)"].map((h) => el("th", { scope: "col" }, h)))),
          el("tbody", {}, ...rows.map((r) => el("tr", { "data-slot": String(r.slot) }, el("th", { scope: "row" }, el("i", { "aria-hidden": "true" }, String(r.slot)), r.name),
            cell(r.latest, ", "), cell(r.median, " ("), el("td", {}, r.band), cell(r.trend, ", "))))),
          el("p", { class: "wqs-hint" }, M().compareHint(years)),
          how(Object.values(per).flatMap((x) => [x.band, x.trend])));
      }
      return draw();
    }

    // ---- start, and leave ------------------------------------------------------------------------------------------------------
    map.on("zoom", near);
    near();
    if (st.on) switchOn();
    return {
      remove() {
        gone = true; token++; chart?.destroy(); chart = null; clearPins();
        watch?.disconnect(); changes?.disconnect();
        try { map.off("zoom", near); map.off("resize", place); } catch { /* the map is going too */ }
        control.remove(); panel.remove(); holder.classList.remove("wqs-on", "wqs-near", "wqs-open", "wqs-comparing");
      },
    };
  }
  FP.wqSites = { attach };
})(typeof window === "undefined" ? globalThis : window);
