// N2: water quality sites in Maps. On a farm's or a group's published map, a "Water quality" button (a map control beside the
// viewer's own, added to the map the viewer returns; js/viewer.js is not changed) switches the monitoring sites on: the sites near the
// farm (wq_sites_near, as the farm's "Water quality nearby" line reads them) or the group's sites (group_wq_sites, as the group space
// reads them), drawn as pins named at close zoom. Opening a site shows a panel (beside the map on a computer, a sheet from the bottom on
// a phone): its source and the "provisional" note where the source says so, its record, its latest result of each measure, and for the
// chosen measure a chart (the Chart block) with the NPS-FM band shading where there are bands, the NPS-FM band, the indicative trend and
// LAWA's published state and trend. Up to six sites can be compared: one chart with a line per site and a table.
// Every read is the signed-in person's own, through the existing functions and policies (wq_site_latest, site_record_summary,
// measurement_series, wq_state_trend_for_site, and the `analysis` function's preview, which computes the median, band and trend
// with the tested library and stores nothing). Nothing here widens what anyone can read. The words are wq-sites-model.js's.
(function (root) {
  const FP = root.FP;
  const M = () => FP.wqSitesModel, W = () => FP.wqModel, A = () => FP.wqAnalysis;
  const CONCURRENCY = 4;
  const list = (v) => (Array.isArray(v) ? v : []);
  // replaceChildren would print a left-out part (null) as the word "null": leave such parts out
  const fill = (node, ...kids) => node.replaceChildren(...kids.filter((k) => k != null && k !== false));

  async function pool(tasks, n) {
    const out = new Array(tasks.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
    return out;
  }

  // map: the MapLibre map RCLViewer.mount returned; holder: the element the viewer fills; owner: { farm } or { org }; state: kept by
  // maps-view across a redraw of the same map (renewed links), so what the person had open stays open. Returns { remove() }.
  function attach({ map, holder, sb, owner, state, el = FP.el, now = () => Date.now() }) {
    const st = state || {};
    st.chosen = list(st.chosen); st.years = M().pickYears(st.years); st.cache = st.cache || new Map();
    const gl = root.maplibregl;
    let sites = null, gone = false, token = 0, chart = null, framed = !!st.framed;
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
    const readSites = () => once("sites", () => (owner.farm ? rpc("wq_sites_near", { farm_id: owner.farm, km: W().RADIUS_KM }) : rpc("group_wq_sites", { g: owner.org })));
    const latestOf = (id) => once("latest|" + id, async () => W().latest(await rpc("wq_site_latest", { site: id })));
    // the council's summary, for shared sites only (M().record); a failed read is not kept and shows no line
    const recordOf = (site) => (!site.shared ? Promise.resolve(null) : once("record|" + site.id, async () => {
      const { data, error } = await sb.from("site_record_summary").select("family, n, first_sampled, last_sampled, years, refreshed_at").eq("site_id", site.id).limit(40);
      if (error) throw error;
      return M().record(data, site);
    }).catch(() => null));
    const seriesOf = (id, parameter, years, latestAt) => once(["series", id, parameter, years].join("|"), () => {
      const from = M().windowStart(latestAt, years);
      return rpc("measurement_series", { site: id, parameter_key: parameter, ...(from ? { from_time: from } : {}) });
    });
    const analysis = (tool, id, parameter, years) => {
      const body = M().analysisRequest(owner, tool, id, parameter, years);
      return body ? once("analysis|" + M().requestKey(body), () => A().request(sb, body), (r) => r?.kind === "error") : Promise.resolve(null);
    };
    // LAWA reports on ECan's own sites only
    // { rows }, or { failed: true } when the read failed (said as such, and not kept), or null for a site LAWA does not report on
    const lawaOf = (site) => (site.shared && site.source_key === "ecan-wq-sites"
      ? once("lawa|" + site.id, () => rpc("wq_state_trend_for_site", { site: site.id })).then((rows) => ({ rows }), () => ({ failed: true })) : Promise.resolve(null));
    const byId = (id) => sites?.find((s) => s.id === id) || null;

    // ---- the button on the map --------------------------------------------------------------------------------------------
    const toggle = el("button", { type: "button", class: "wqs-toggle", "aria-pressed": "false", title: "Show the water quality monitoring sites on this map",
      onclick: () => (st.on ? switchOff() : switchOn()) }, el("span", { class: "wqs-drop", "aria-hidden": "true" }), el("span", {}, "Water quality"));
    const control = el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group wqs-ctrl" }, toggle);
    const ctl = { onAdd: () => control, onRemove: () => control.remove() };
    map.addControl(ctl, "top-right");

    // ---- the panel ----------------------------------------------------------------------------------------------------------
    const back = el("button", { type: "button", class: "wqs-back", hidden: true, onclick: () => { st.chosen = []; st.adding = false; mark(); render(); } }, "‹ All sites");
    const close = el("button", { type: "button", class: "wqs-close", "aria-label": "Close water quality", onclick: () => closePanel(true) }, "×");
    const body = el("div", { class: "wqs-body" });
    const status = el("p", { class: "wqs-status", role: "status", "aria-live": "polite" });
    const panel = el("section", { class: "wqs-panel", role: "dialog", "aria-modal": "false", "aria-label": "Water quality", hidden: true },
      el("div", { class: "wqs-bar" }, back, close), status, body);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePanel(true); } });
    holder.append(panel);

    function openPanel() { panel.hidden = false; holder.classList.add("wqs-open"); }
    function closePanel(focusToggle) {
      panel.hidden = true; holder.classList.remove("wqs-open"); token++;
      chart?.destroy(); chart = null;
      if (focusToggle) toggle.focus({ preventScroll: true });
    }
    const say = (t) => { status.textContent = t || ""; };

    // ---- the pins -----------------------------------------------------------------------------------------------------------
    const near = () => holder.classList.toggle("wqs-near", map.getZoom() >= M().LABEL_ZOOM);
    function drawPins() {
      clearPins();
      if (!gl?.Marker) return;
      for (const s of sites.filter((x) => x.lngLat)) {
        const pin = el("button", { type: "button", class: "wqs-pin" + (s.recent ? "" : " wqs-older"), "data-wqs-site": s.id,
          title: s.name + " · " + s.line, "aria-label": "Water quality site: " + s.name + ", " + s.line,
          onclick: (e) => { e.stopPropagation(); pinned(s.id); } }, el("i", { "aria-hidden": "true" }), el("span", { class: "wqs-label" }, s.name));
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
    }
    // The first time the sites go on, the map widens (never zooms in) so every pin is clear of what sits over the map: the viewer's
    // panel (left on a computer), the map's buttons and this panel (right), the sheet (bottom, on a phone). A pin under the Water
    // quality button could not be tapped.
    function frame() {
      if (framed || !gl?.LngLatBounds) return;
      const pts = sites.filter((s) => s.lngLat).map((s) => s.lngLat);
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
      openPanel(); fill(body); say("Loading the water quality sites…");
      const t = ++token;
      try { sites = M().siteList(await readSites(), owner, now()); }
      catch { if (t === token && !gone) { say(""); fill(body, el("p", {}, "Couldn't load the water quality sites just now."), el("button", { type: "button", class: "wqs-button", onclick: switchOn }, "Try again")); } return; }
      if (gone || !st.on) return;
      drawPins(); frame();
      if (t === token) render();
    }
    function switchOff() {
      st.on = false; st.chosen = []; st.adding = false; toggle.setAttribute("aria-pressed", "false");
      holder.classList.remove("wqs-on", "wqs-near", "wqs-comparing"); clearPins(); closePanel(false);
    }
    // A pin: the site alone, or added to the comparison when the person is adding sites (or already comparing).
    function pinned(id) {
      const adding = st.adding || st.chosen.length > 1;
      if (adding && !st.chosen.includes(id) && M().full(st.chosen)) { openPanel(); say("You can compare up to " + M().MAX_CHOSEN + " sites. Remove one to add another."); return; }
      pick(id, adding);
    }
    function pick(id, add) {
      st.chosen = M().choose(st.chosen, id, { add });
      if (st.chosen.length > 1 || !add) st.adding = false;
      mark(); openPanel(); render(true);
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

    function showList() {
      const recent = sites.filter((s) => s.recent).length;
      fill(body, heading("Water quality sites"), el("p", { class: "wqs-meta" }, M().intro(sites, owner)),
        sites.length ? el("p", { class: "wqs-hint" }, "Choose a site on the map or in this list to see its results. You can then compare up to " + M().MAX_CHOSEN + " sites." +
          (recent < sites.length ? " Paler pins have no sample in the last " + M().RECENT_YEARS + " years." : "")) : null,
        sites.length ? el("ul", { class: "wqs-list" }, ...sites.map((s) => el("li", {}, el("button", { type: "button", class: "wqs-site" + (s.recent ? "" : " wqs-older"), onclick: () => pick(s.id, false) },
          el("b", {}, s.name), el("small", {}, s.line))))) : null);
    }

    // The control to add a site to the comparison: a list of the other sites (a keyboard or a phone need not find the pin).
    function adder() {
      if (M().full(st.chosen)) return el("p", { class: "wqs-hint" }, "You are comparing the most sites at once (" + M().MAX_CHOSEN + "). Remove one to add another.");
      const pickList = el("select", { class: "wqs-add", "aria-label": "Add a site to compare" }, el("option", { value: "" }, "Add a site…"),
        ...sites.filter((s) => !st.chosen.includes(s.id)).map((s) => el("option", { value: String(s.id) }, s.name + (s.distance ? " (" + s.distance + ")" : ""))));
      pickList.addEventListener("change", () => { const id = Number(pickList.value); if (id) pick(id, true); });
      return el("div", { class: "wqs-adder" }, el("p", { class: "wqs-hint" }, "Tap another site on the map, or choose one here:"), pickList);
    }
    const select = (label, cls, options, value, onchange) => {
      const s = el("select", { class: cls }, ...options.map(([v, t]) => el("option", { value: String(v), ...(String(v) === String(value) ? { selected: true } : {}) }, t)));
      s.addEventListener("change", () => onchange(s.value));
      return el("label", { class: "wqs-field" }, el("span", {}, label), s);
    };
    const periodPicker = (redraw) => select("Period", "wqs-years", M().WINDOWS.map((w) => [w.years, w.label]), st.years, (v) => { st.years = M().pickYears(v); redraw(); });
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

    // One site: its record, latest results, and the chosen measure's chart, band, trend and LAWA's results.
    async function showSite(id) {
      const t = ++token, site = byId(id);
      if (!site) { st.chosen = []; return showList(); }
      fill(body, heading(site.name)); say("Loading this site's results…");
      let latest, rec;
      try { [latest, rec] = await Promise.all([latestOf(id), recordOf(site)]); }
      catch { if (t === token) { say(""); body.append(el("p", {}, "Couldn't read this site's results just now.")); } return; }
      if (t !== token || gone) return;
      say("");
      const offered = M().parameters({ [id]: latest }, [id]);
      st.parameter = M().pickParameter(offered, st.parameter);
      const credit = latest.attribution || (latest.source ? "Source: " + latest.source + "." : "");
      const host = el("div", { class: "block-host wqs-chart" }), findings = el("div", { class: "wqs-findings", "aria-live": "polite" });
      const values = el("ul", { class: "wqs-values", "aria-label": "Latest results at " + site.name }, ...latest.rows.map((r) => {
        const own = M().recordOf(rec, r.parameter);
        return el("li", {}, el("button", { type: "button", class: "wqs-value", "data-parameter": r.parameter, "aria-pressed": String(r.parameter === st.parameter),
          onclick: () => { st.parameter = r.parameter; for (const b of values.querySelectorAll(".wqs-value")) b.setAttribute("aria-pressed", String(b.dataset.parameter === r.parameter)); measure(); } },
          el("span", { class: "wqs-name" }, r.name), el("span", { class: "wqs-val" }, r.value + (r.unit ? " " + r.unit : "")),
          el("small", {}, r.date + (r.censored ? " · below or above a detection limit" : "") + (own ? " · " + own.text : ""))));
      }));
      fill(body, heading(site.name), el("p", { class: "wqs-meta" }, site.line),
        credit || latest.provisional ? el("p", { class: "wqs-credit" }, latest.provisional ? el("span", { class: "wqs-provisional" }, "Provisional") : null, latest.provisional ? " " : null, credit) : null,
        rec ? el("p", { class: "wqs-meta" }, M().recordLine(rec, W().latestInstant(latest.rows.map((r) => r.sampled_at)))) : null,
        ...(latest.rows.length ? [el("h3", {}, "Latest results"), el("p", { class: "wqs-hint" }, "Choose a measure to see it over time."), values,
          el("div", { class: "wqs-controls" }, periodPicker(() => measure())), host, findings] : [el("p", {}, "No results are recorded for this site yet.")]),
        el("div", { class: "wqs-actions" }, st.adding ? adder() : el("button", { type: "button", class: "wqs-button", onclick: () => { st.adding = true; render(); body.querySelector(".wqs-add")?.focus(); } }, "Compare with another site")));
      if (!latest.rows.length) return;
      async function measure() {
        const m = ++token, parameter = st.parameter, years = st.years, row = latest.rows.find((r) => r.parameter === parameter);
        fill(host, el("p", { class: "wqs-status" }, "Loading the chart…")); fill(findings);
        const [series, band, trend, lawa] = await Promise.all([seriesOf(id, parameter, years, row?.sampled_at).catch(() => null), analysis("band", id, parameter, years), analysis("trend", id, parameter, years), lawaOf(site)]);
        if (m !== token || gone) return;
        if (!series) fill(host, el("p", {}, "Couldn't read this measure's results just now."));
        else drawChart(host, M().chartData({ sites: [site], parameter, name: row?.name, unit: row?.unit, seriesBySite: { [id]: series }, latestBySite: { [id]: latest }, years }));
        const b = M().bandWords(band, parameter, offered), tr = M().trendWords(trend, years), l = M().lawaLine(lawa, parameter);
        fill(findings, 
          el("p", {}, el("b", {}, "NPS-FM band: "), b.long),
          el("p", { class: tr.little ? "wqs-little" : "" }, el("b", {}, "Trend (indicative): "), tr.long),
          l ? el("p", {}, el("b", {}, "LAWA: "), l) : null,
          how([band, trend]));
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
        el("button", { type: "button", "aria-label": "Remove " + s.name + " from the comparison", onclick: () => { st.chosen = M().remove(st.chosen, s.id); st.adding = false; mark(); render(); body.querySelector("h2")?.focus({ preventScroll: true }); } }, "×"))));
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
      async function draw() {
        const m = ++token, parameter = st.parameter, years = st.years, p = offered.find((x) => x.key === parameter);
        fill(host, el("p", { class: "wqs-status" }, "Loading the chart…")); fill(table);
        const per = {}, series = {};
        await pool(chosen.map((s) => async () => {
          const row = list(latest[s.id]?.rows).find((r) => r.parameter === parameter);
          const [rows, summary, band, trend] = row ? await Promise.all([seriesOf(s.id, parameter, years, row.sampled_at).catch(() => []), analysis("summary", s.id, parameter, years), analysis("band", s.id, parameter, years), analysis("trend", s.id, parameter, years)]) : [[], null, null, null];
          series[s.id] = rows; per[s.id] = { latest: latest[s.id], summary, band, trend };
        }), CONCURRENCY);
        if (m !== token || gone) return;
        drawChart(host, M().chartData({ sites: chosen, parameter, name: p?.name, unit: p?.unit, seriesBySite: series, latestBySite: latest, years }));
        const rows = M().compareRows(chosen, parameter, per, years, offered);
        const windowLabel = M().WINDOWS.find((w) => w.years === years)?.label.toLowerCase() || "";
        fill(table, el("table", { class: "wqs-table" }, el("caption", {}, (p?.name || parameter) + ", " + windowLabel),
          el("thead", {}, el("tr", {}, ...["Site", "Latest", "Median", "NPS-FM band", "Trend (indicative)"].map((h) => el("th", { scope: "col" }, h)))),
          el("tbody", {}, ...rows.map((r) => el("tr", { "data-slot": String(r.slot) }, el("th", { scope: "row" }, el("i", { "aria-hidden": "true" }, String(r.slot)), r.name),
            cell(r.latest, ", "), cell(r.median, " ("), el("td", {}, r.band), cell(r.trend, ", "))))),
          el("p", { class: "wqs-hint" }, "The median and trend are over the hydrological years of the period chosen; the band always over 5 years. Open a site on its own for the reasons and LAWA's results."),
          how(Object.values(per).flatMap((x) => [x.band, x.trend])));
      }
      return draw();
    }

    // ---- start, and leave ------------------------------------------------------------------------------------------------------
    map.on("zoom", near);
    if (st.on) switchOn();
    return {
      remove() {
        gone = true; token++; chart?.destroy(); chart = null; clearPins();
        try { map.off("zoom", near); map.removeControl(ctl); } catch { /* the map is going too */ }
        control.remove(); panel.remove(); holder.classList.remove("wqs-on", "wqs-near", "wqs-open", "wqs-comparing");
      },
    };
  }
  FP.wqSites = { attach };
})(typeof window === "undefined" ? globalThis : window);
