// Water quality nearby (M1b): a line in the farm space that lists the monitoring sites near the farm (nearest first, with
// distance). Opening it puts the sites on the map (and only then: the map starts quiet, E5), and opening a site shows its latest
// values as reported, with the source's attribution and the provisional flag. Tapping a value opens the Chart block with that
// parameter's series (and a second site to compare, if the person chooses one). Reads only, through the M1a functions
// wq_sites_near, wq_site_latest and measurement_series as the caller (row-level security decides what comes back).
// No band, grade or trend is shown: those come later from a versioned analysis method (X1), so each value says "not assessed".
(function (root) {
  const FP = root.FP;
  const M = () => FP.wqModel;
  const el = (...a) => FP.el(...a);

  async function rpc(sb, name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data || [];
  }
  const bbox = (extent, points) => {
    const flat = [...(extent?.coordinates?.[0] || []), ...points];
    const xs = flat.map((c) => c[0]), ys = flat.map((c) => c[1]);
    const w = Math.min(...xs), e = Math.max(...xs), s = Math.min(...ys), n = Math.max(...ys);
    return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
  };

  // sb: the Supabase client (or the demo's); farm: the farm row; extent: the farm's boundary (GeoJSON); map: FP.farmMap.
  // sitesRead: how the sites are read, when not wq_sites_near for the farm (the group space reads group_wq_sites, S5).
  function create({ sb, farm, extent, map = FP.farmMap, sitesRead = null }) {
    let sites = [], opened = false, selected = null, destroyed = false, markers = [];
    const panels = new Map();   // site id -> { panel, latest, chart, handle, parameter }
    const node = el("details", { class: "wq-line", "data-wq": "", hidden: true });
    const count = el("span", { class: "wq-count" });
    node.append(el("summary", { class: "wq-summary" }, el("span", { class: "wq-title" }, "Water quality nearby"), count));
    const body = el("div", { class: "wq-body" });
    node.append(body);

    const ready = (sitesRead ? sitesRead() : rpc(sb, "wq_sites_near", { farm_id: farm.id, km: M().RADIUS_KM })).then((rows) => {
      if (destroyed) return;
      sites = M().sites(rows, farm.id);
      // Nothing near, or not readable: the line is not there (the map and the standing answers stay as they were).
      if (!sites.length) return;
      count.textContent = M().summary(sites);
      draw(); node.hidden = false;
    }).catch(() => {});

    function draw() {
      body.replaceChildren(
        el("p", { class: "wq-source" }, M().sourcesLine(sites) + ". Results are shown as reported."),
        el("p", { class: "wq-assess-note" }, "Bands, grades and trends: " + M().NOT_ASSESSED + "."),
        el("ol", { class: "wq-sites" }, ...sites.map((s) => {
          const button = el("button", { type: "button", class: "wq-site-button", "aria-expanded": "false", "data-wq-site": s.id, onclick: () => select(s.id, panels.get(s.id)?.panel.hidden !== false) },
            el("span", { class: "wq-n", "aria-hidden": "true" }, String(s.n)), el("span", { class: "wq-site-name" }, s.name),
            el("small", {}, [s.away, s.last, s.owner].filter(Boolean).join(" · ")));
          const panel = el("div", { class: "wq-site-panel", hidden: true });
          panels.set(s.id, { panel, button, loaded: false });
          return el("li", { class: "wq-site", "data-site-id": s.id }, button, panel);
        })));
    }

    // ---- the map: the sites appear while the line is open and go when it closes ----------------------------------
    function showOnMap() {
      hideFromMap();
      const gl = globalThis.maplibregl;
      if (!gl || !map?.glMap) return;
      const points = sites.filter((s) => s.lngLat);
      for (const s of points) {
        const pin = el("button", { type: "button", class: "wq-pin", "data-wq-pin": s.id, title: s.name + (s.distance ? ", " + s.distance : ""), "aria-label": "Water quality site " + s.n + ": " + s.name,
          onclick: (ev) => { ev.stopPropagation(); select(s.id, true); } }, el("i", {}, String(s.n)), el("span", {}, s.name));
        markers.push({ id: s.id, pin, marker: new gl.Marker({ element: pin, anchor: "center" }).setLngLat(s.lngLat).addTo(map.glMap()) });
      }
      markSelected();
      map.reframe?.(bbox(extent, points.map((s) => s.lngLat)));
    }
    function hideFromMap(reframe = false) {
      const had = markers.length > 0;
      for (const m of markers.splice(0)) m.marker.remove();
      if (reframe && had && extent) map.reframe?.(extent);
    }
    function markSelected() { for (const m of markers) m.pin.classList.toggle("selected", m.id === selected); }

    // ---- a site: its latest values ------------------------------------------------------------------------------
    async function select(id, open) {
      const entry = panels.get(id);
      if (!entry) return;
      if (open) {
        if (selected !== null && selected !== id) { const prev = panels.get(selected); prev.panel.hidden = true; prev.button.setAttribute("aria-expanded", "false"); }
        selected = id;
      } else if (selected === id) selected = null;
      entry.panel.hidden = !open; entry.button.setAttribute("aria-expanded", String(open));
      markSelected();
      if (open && !entry.loaded) await loadLatest(id, entry);
      if (open) entry.button.scrollIntoView?.({ block: "nearest" });
    }
    async function loadLatest(id, entry) {
      entry.panel.replaceChildren(el("p", { class: "wq-status", role: "status" }, "Loading the latest results…"));
      try {
        const site = sites.find((s) => s.id === id), latest = M().latest(await rpc(sb, "wq_site_latest", { site: id }));
        if (destroyed) return;
        entry.loaded = true; entry.latest = latest;
        if (!latest.rows.length) { entry.panel.replaceChildren(el("p", { class: "wq-status" }, "No results recorded for this site yet.")); return; }
        entry.chart = el("div", { class: "wq-chart", "aria-live": "polite" });
        entry.panel.replaceChildren(
          el("ul", { class: "wq-values", "aria-label": "Latest results at " + site.name }, ...latest.rows.map((r) =>
            el("li", {}, el("button", { type: "button", class: "wq-value", "data-parameter": r.parameter, "aria-expanded": "false", "aria-label": r.name + ": " + r.value + (r.unit ? " " + r.unit : "") + ", " + r.date + ". Show the chart.",
              onclick: () => showChart(id, entry, r) },
              el("span", { class: "wq-name" }, r.name),
              el("span", { class: "wq-val" }, r.value + (r.unit ? " " + r.unit : "")),
              el("span", { class: "wq-date" }, r.date + (r.censored ? " · below or above a limit" : "")),
              el("span", { class: "wq-assess" }, r.assessment))))),
          el("p", { class: "wq-attribution" }, [latest.provisional ? el("span", { class: "wq-provisional" }, "Provisional") : null, latest.provisional ? " " : null,
            latest.attribution || (latest.source ? "Source: " + latest.source + "." : "")]),
          entry.chart);
      } catch (e) {
        entry.panel.replaceChildren(el("p", { class: "wq-status", role: "status" }, "Couldn't read this site's results."));
      }
    }

    // ---- a parameter: the chart --------------------------------------------------------------------------------
    async function showChart(id, entry, row) {
      const site = sites.find((s) => s.id === id);
      for (const b of entry.panel.querySelectorAll(".wq-value")) b.setAttribute("aria-expanded", String(b.dataset.parameter === row.parameter));
      entry.parameter = row.parameter; entry.compare = null;
      entry.chart.replaceChildren(el("p", { class: "wq-status", role: "status" }, "Loading the chart…"));
      let series;
      try { series = await rpc(sb, "measurement_series", { site: id, parameter_key: row.parameter }); } catch { entry.chart.replaceChildren(el("p", { class: "wq-status" }, "Couldn't read this series.")); return; }
      entry.series = series;
      drawChart(site, entry, row);
    }
    function drawChart(site, entry, row) {
      entry.handle?.destroy();
      const host = el("div", { class: "block-host wq-chart-host" });
      const others = sites.filter((s) => s.id !== site.id);
      const select_ = el("select", { class: "wq-compare-select", "aria-label": "Compare with another site" }, el("option", { value: "" }, "No comparison"),
        ...others.map((s) => el("option", { value: String(s.id), ...(entry.compare?.site.id === s.id ? { selected: true } : {}) }, s.name + " (" + (s.distance || "") + ")")));
      select_.addEventListener("change", async () => {
        const other = others.find((s) => String(s.id) === select_.value);
        if (!other) { entry.compare = null; drawChart(site, entry, row); return; }
        select_.disabled = true;
        try { entry.compare = { site: other, series: await rpc(sb, "measurement_series", { site: other.id, parameter_key: row.parameter }) }; } catch { entry.compare = null; }
        drawChart(site, entry, row);
        entry.chart.querySelector(".wq-compare-select")?.focus({ preventScroll: true });   // the picker is drawn again: keep the keyboard on it
      });
      const bar = el("div", { class: "wq-chart-bar" }, others.length ? el("label", {}, el("span", {}, "Compare with "), select_) : null,
        el("button", { type: "button", class: "link wq-chart-close", onclick: () => { entry.handle?.destroy(); entry.handle = null; entry.chart.replaceChildren(); for (const b of entry.panel.querySelectorAll(".wq-value")) b.setAttribute("aria-expanded", "false"); } }, "Close chart"));
      entry.chart.replaceChildren(bar, host);
      const data = M().chartData({ site, parameter: row.parameter, name: row.name, unit: row.unit, series: entry.series, attribution: entry.latest.attribution || (entry.latest.source ? "Source: " + entry.latest.source + "." : ""),
        provisional: row.provisional, compare: entry.compare });
      entry.handle = FP.blocks.render(host, { block: "chart", owner: { farm: farm.id } }, { read: () => data, level: 4, href: FP.href });
    }

    node.addEventListener("toggle", () => {
      if (destroyed || node.open === opened) return;
      opened = node.open;
      if (opened) showOnMap(); else { hideFromMap(true); fold(); }
    });
    // Closed, the line forgets which site was open: it opens fresh next time.
    function fold() { if (selected !== null) select(selected, false); }
    return {
      node, ready, sites: () => sites, isOpen: () => opened,
      select: (id) => { if (!node.open) node.open = true; return select(id, true); },
      // Closing the line takes the sites off the map. A view that is not the map's closes it too (reframe: put the farm back).
      collapse({ reframe = false } = {}) { if (!node.open) return; opened = false; node.open = false; hideFromMap(reframe); fold(); },
      destroy() { destroyed = true; for (const p of panels.values()) p.handle?.destroy(); hideFromMap(false); node.remove(); },
    };
  }
  FP.wq = { create };
})(typeof window === "undefined" ? globalThis : window);
