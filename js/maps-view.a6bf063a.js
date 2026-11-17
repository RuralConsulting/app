// V4: Maps, in the farm and group spaces. Published maps (V1's published_maps and map_packages, the private map-packages bucket)
// shown with the portal's viewer (js/viewer.js), as portal/portal.js does: read the current package, sign its file links, mount.
// Every read is the signed-in person's, under V1's policies: the owner's members only. A person who is not a member reads no
// map, so no file is signed and the viewer is never started. Only maps not archived and with a current package are listed.
// Signed links last an hour. They are renewed ten minutes before they run out, by drawing the map again where it was; a tab that
// slept past that renews when it is looked at again. If renewing fails, the map goes and the person is told plainly.
// Client suggestions are off in v1: the viewer is given no `suggest`. farm-space.js and group-space.js only say when to open and close.
// CL1: every map offers the reference layers (roads, waterways) stored once on the platform under core/, signed and renewed with the
// map's own files and passed as the viewer's referenceLayers; one whose file is not there is left out and the map opens without it.
// CL2: so is every core layer marked to be offered on every map with its own style (tools/load_core_reference.py --batch).
// N2: each map drawn is given the water quality sites overlay (js/wq-sites.js): a "Water quality" button on the map the viewer
// returns, the sites of this farm or group, and a panel for a site or a comparison. What the person had open is kept while the
// links are renewed (the map is drawn again where it was). An overlay that fails to start leaves the map as it is.
// N2b: the map's bounds go with it: a group the old model has no area for lists the shared sites inside its published map.
// CTX2: on a group's map, the context layers the loader marked starts_on (native vegetation, protected places) are on as it first
// opens on a device; a farm's map starts them all off, as before.
// WQ4: on a group's map, a published water quality layer (its points name a site and carry a measure's summary) has its columns named
// plainly and its own per-measure labels drawn from no zoom on; one short label per site is laid over instead (wqsv.js labels),
// and a tap on one of its sites that matches a group monitoring site opens that site's chart (wq-sites.js feature, the viewer's
// onFeature). viewer.js is not changed.
// ML1: a map's saved edits (public.published_map_edits) are read with its package and applied to its manifest before anything else
// (readPackage), and "Edit layers" (js/map-edit.js) is offered on the panel to those who may change the map.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.FP = root.FP || {};
  const FP = root.FP, BASEMAP_KEY = "rv-basemap";
  const linzKey = () => (FP.demo?.active || typeof FP_CONFIG === "undefined" ? null : FP_CONFIG.linzKey);
  // The viewer reads the person's remembered background as it starts. With no LINZ key (the demo) nothing is to be fetched,
  // so it starts on None; what the person had remembered is put back at once.
  // CTX2: a context layer marked startOn (a group's map, tools/core_layers/layers.json "starts_on") is on as the map opens unless the
  // person has switched it on or off on this device before: the viewer reads its remembered switch ("rv-ctx-<key>") only as it
  // starts, so it is set for the start and taken away again; once the person switches it, the viewer remembers their choice.
  function mount(holder, options) {
    let store = null;
    try { store = localStorage; } catch {}
    const { phoneGroup = false, showing = null, ...rest } = options;
    return api.seedStartOn(store, rest.referenceLayers, () => mountWith(holder, rest), { phoneGroup, showing });
  }
  const phone = () => !!root.matchMedia?.("(max-width: 720px)").matches;   // the viewer's own phone width
  // PH2: what the app sets around the viewer's own controls on a phone (viewer.js is the portal's and is not edited): one "More"
  // control after Locate holds zoom, the compass, 3D, measure and print (shown by maps.css while it is open); the credit starts
  // folded to its "i"; a group's map fits "Whole area" (not "Whole property") and its line says when it was published, not surveyed.
  // MV1 (the owner, 16 Nov 2026, of the older maps portal: "the maps are just simpler and much easier to navigate"): one panel in the
  // portal's shape. Its head: the place's name small, the map's title large, one line of facts (api.meta); "Whole group" (or "Whole
  // farm", "Whole sub-group": api.wholeLabel) at the foot of the one column of controls on a computer.
  function chrome(map, holder, { group = false, sub = false, publishedAt = null, areaHa = null, surveyDate = null, kind = "", place = "" } = {}) {
    const el = (...a) => FP.el(...a);
    const fit = holder.querySelector(".rv-fit");
    if (fit) fit.textContent = api.wholeLabel({ group, sub });
    const line = holder.querySelector(".rv-meta");
    if (line) line.textContent = api.meta({ publishedAt, areaHa, surveyDate: group ? null : surveyDate, kind });
    const kicker = holder.querySelector(".rv-kicker");
    if (kicker && place) kicker.textContent = place;
    FP.basemaps?.quietCredit?.(map);
    const button = el("button", { type: "button", class: "ph-more-btn", "aria-expanded": "false", "aria-label": "More map tools", title: "More map tools" }, FP.icon ? FP.icon("more", 20) : "…");
    const box = el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group ph-more" }, button);
    const more = (on) => { holder.classList.toggle("ph-more-open", on); button.setAttribute("aria-expanded", String(on)); };
    button.addEventListener("click", () => more(!holder.classList.contains("ph-more-open")));
    // a tool that takes over the map (3D, measure, print, compare) closes the list; zoom keeps it open for another tap
    holder.addEventListener("click", (e) => { if (e.target.closest?.(".rv-3d button, .rv-tools button, .ph-fit button")) more(false); });   // (RF1: Whole area too)
    try { map.addControl({ onAdd: () => box, onRemove: () => box.remove() }, "top-right"); } catch {}
    let locate = null;
    try { map.addControl({ onAdd: () => (locate = locateControl(map)), onRemove: () => locate?.remove() }, "top-right"); } catch {}
    // RF1 then MV1: "Whole area" (now "Whole group") is in the one column of controls: at its foot on a computer, under More on a phone.
    // (RF1's Layers chip on a phone is gone from the map: MV1's peek, the sheet's own head, opens the same sheet with one tap.)
    const fitBtn = holder.querySelector(".rv-fit");
    if (fitBtn && !fitBtn.closest(".ph-fit")) {
      const fitBox = el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group ph-fit" }, fitBtn);
      try { map.addControl({ onAdd: () => fitBox, onRemove: () => fitBox.remove() }, "top-right"); } catch {}
    }
    // MV1: on a phone nothing covers the map at rest but the sheet's peek and the +. Locate and More sit in the peek, beside the map's
    // title (maps.css shows them only at a phone's width; on a computer the viewer's own Locate stays in the column). The whole peek
    // opens the sheet (its title and facts are not targets of their own, so a tap on them is a tap on the head: maps.css), and the
    // sheet's handle says whether it is open.
    const bar = holder.querySelector(".rv-titlebar");
    if (bar && !bar.querySelector(".mv-peek-tools")) bar.append(el("div", { class: "mv-peek-tools" }, ...(locate ? [locate] : []), box));
    const grip = holder.querySelector(".rv-toggle-panel"), panel = holder.querySelector(".rv-panel");
    if (grip && panel) {
      grip.setAttribute("aria-label", "Layers and legend");
      // MV1b (the live walk after MV1: on a phone the sites' list over the top half and the layers below it, no map): one panel at a time,
      // the map in view. While the sheet rests at its peek its rows are inert: nothing in them can take the focus or a tap, so nothing
      // can scroll the map's box to bring them into view (a keyboard's Tab, a screen reader, an automated tap did). Opening the sheet
      // closes the sites' panel; Sites closes the sheet (dock).
      const rows = [panel.querySelector(".rv-body"), panel.querySelector(".rv-foot")].filter(Boolean);
      const said = () => {
        const shut = panel.classList.contains("collapsed"), small = phone();
        grip.setAttribute("aria-expanded", String(!shut));
        for (const n of rows) if (n.inert !== (shut && small)) n.inert = shut && small;
        if (!shut && small) { const close = holder.querySelector(".wqs-panel:not([hidden]) .wqs-close"); if (close) close.click(); }
      };
      said();
      if (typeof MutationObserver !== "undefined") new MutationObserver(said).observe(panel, { attributes: true, attributeFilter: ["class"] });
      // (review of #596: taken away with this map, or the listener would keep every map made again alive)
      const width = root.matchMedia?.("(max-width: 720px)");
      width?.addEventListener?.("change", said);
      // (review of #596; MEM1: taken away by dropMap itself, before the map is removed, never only on the map's "remove" event, which a
      // map with a feature's popup open never sends: its remove() stops part way, see dropMap)
      map.mvMediaOff = () => width?.removeEventListener?.("change", said);
    }
    // MV1b: the map's box, and the box it is in, never scroll (the map is drawn to fill them); anything that scrolls one is put back
    // (MEM1: the listener is made outside this function, so it holds no map: the tab's box keeps it for good)
    for (const n of [holder, holder.parentElement].filter(Boolean)) {
      if (n.dataset.mvStill) continue;
      n.dataset.mvStill = "1";
      n.addEventListener("scroll", keepStill, { passive: true });
    }
  }
  // MV1: the panel's body in the portal's order. The map's own layers first, each a switch with its legend under it (the viewer's own
  // rows), then the water quality sites as one more switch (wq-sites.js's own button and its Sites, moved off the map), then one
  // "Reference" group as the portal had it: roads and waterways, the context layers under their own folding themes, "Shade outside" and
  // "Labels", each with its source line. Rows are moved, never made again, so every switch keeps what it does; a row the viewer has not
  // shown (a reference file that has not answered) stays hidden, and the Reference group shows once one of its rows does. Called once
  // the water quality overlay is attached (draw), so its button is there to move.
  function dock(holder) {
    const el = (...a) => FP.el(...a), body = holder.querySelector(".rv-panel .rv-body");
    if (!body || body.querySelector(".mv-ref")) return;
    const wq = holder.querySelector(":scope > .wqs-ctrl");
    const ref = el("div", { class: "mv-ref", role: "group", "aria-labelledby": "mv-ref-head", hidden: "" }, el("div", { class: "mv-ref-head", id: "mv-ref-head", role: "heading", "aria-level": "3" }, "Reference"));
    // the first of the viewer's Reference and context sections, or the shade and labels rows, marks where the group goes
    const first = body.querySelector(":scope > .rv-ref-group, :scope > .rv-ctx-group, :scope > .rv-mask-row");
    body.insertBefore(ref, first || null);
    if (wq) body.insertBefore(el("div", { class: "mv-wq-row" }, wq), ref);
    // (on a phone, Sites opens the sites' own sheet in place of the map's, which steps down to its peek)
    const panel = holder.querySelector(".rv-panel"), grip = holder.querySelector(".rv-toggle-panel");
    wq?.querySelector(".wqs-list-btn")?.addEventListener("click", () => { if (phone() && panel && !panel.classList.contains("collapsed")) grip?.click(); });
    // MV1b: the sites' list closed on a phone while the sheet rests (its rows inert): the keyboard goes back to the sheet's handle, the
    // way to Water quality and Sites again, not to nowhere
    const sitesPanel = holder.querySelector(".wqs-panel");
    if (sitesPanel && grip && typeof MutationObserver !== "undefined") new MutationObserver(() => {
      if (!sitesPanel.hidden || !phone() || !panel?.classList.contains("collapsed")) return;
      const at = holder.ownerDocument.activeElement;
      if (!at || at === holder.ownerDocument.body || !at.isConnected || at.closest?.("[inert]") || sitesPanel.contains(at)) grip.focus({ preventScroll: true });
    }).observe(sitesPanel, { attributes: true, attributeFilter: ["hidden"] });
    for (const row of body.querySelectorAll(".rv-ref-group .rv-ref-row")) ref.append(row);
    for (const s of body.querySelectorAll(":scope > .rv-ctx-group")) ref.append(s);
    for (const row of body.querySelectorAll(":scope > .rv-mask-row")) ref.append(row);
    // shown once any row in it is shown (none of its rows, nor the theme it sits under, hidden)
    const shows = () => [...ref.querySelectorAll(".rv-layer")].some((r) => { for (let n = r; n && n !== ref; n = n.parentElement) if (n.hidden) return false; return true; });
    const check = () => { const on = shows(); if (ref.hidden === on) ref.hidden = !on; };
    check();
    if (typeof MutationObserver !== "undefined") new MutationObserver(check).observe(ref, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  }
  // review of #538, 4: Locate me on a phone's map is the app's own, as on Home (the viewer's is MapLibre's, which a permission query
  // saying "denied" turns off for good and which says nothing when refused): the phone is asked from the tap itself, the real answer
  // decides, and a refusal says where this phone turns location on, with Try again (which asks again from its own tap). On a
  // computer the viewer's own control stays (maps.css shows one or the other).
  // MV1b: a box that holds the map is put back if anything scrolls it (one function for every box, closing over nothing)
  function keepStill(e) { const n = e.currentTarget; if (n.scrollTop && n.querySelector(".maps-viewer, .rv-map")) n.scrollTop = 0; }
  function locateControl(map) {
    const el = (...a) => FP.el(...a), P = FP.phoneModel;
    const btn = el("button", { type: "button", class: "ph-locate-btn", "aria-label": "Locate me", title: "Locate me" }, FP.icon ? FP.icon("locate", 20) : "◎");
    const box = el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group ph-locate" }, btn);
    let marker = null;
    const refused = (problem) => FP.sheet?.open({ opener: btn, title: "Location", className: "ph-locate-sheet", body: (done) => [
      el("p", { class: "ph-locate-say", role: "alert" }, problem.text),
      ...(problem.help?.length ? [el("ol", { class: "qp-help ph-locate-help" }, ...problem.help.map((h) => el("li", {}, h)))] : []),
      el("div", { class: "qp-set", role: "group" }, el("button", { type: "button", class: "qp-row", id: "ph-locate-retry", onclick: () => { done(); ask(); } },
        el("span", { class: "qp-dot", "aria-hidden": "true" }, FP.icon ? FP.icon("locate", 20) : null), el("span", {}, "Try again"))),
    ] });
    function ask() {
      if (!FP.locate || !P) return;
      const asked = FP.locate.get({ maxAge: 5000 });   // (from the tap itself: nothing awaited first)
      btn.classList.add("ph-busy"); btn.setAttribute("aria-busy", "true");
      asked.then((got) => {
        btn.classList.remove("ph-busy"); btn.removeAttribute("aria-busy");
        if (!got.ok) { btn.setAttribute("aria-pressed", "false"); refused(got.problem); return; }
        const f = got.fix, gl = root.maplibregl;
        btn.setAttribute("aria-pressed", "true");
        try {
          if (!marker && gl?.Marker) marker = new gl.Marker({ element: el("span", { class: "ph-me-dot", "aria-label": "You are here" }), anchor: "center" });
          marker?.setLngLat([f.lon, f.lat]).addTo(map);
          map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 14), duration: root.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 600 });
        } catch { /* the map is going */ }
      });
    }
    btn.addEventListener("click", ask);
    return box;
  }
  function mountWith(holder, options) {
    if (linzKey()) return api.heard([root, root.document], () => root.RCLViewer.mount(holder, options));
    let was = null;
    try { was = localStorage.getItem(BASEMAP_KEY); localStorage.setItem(BASEMAP_KEY, "none"); } catch {}
    try { return api.heard([root, root.document], () => root.RCLViewer.mount(holder, options)); }
    finally { try { if (was === null) localStorage.removeItem(BASEMAP_KEY); else localStorage.setItem(BASEMAP_KEY, was); } catch {} }
  }
  FP.mapsView = api.create({
    sb: () => FP.sb, el: (...a) => FP.el(...a), mount, backgrounds: () => api.backgrounds(linzKey()),
    // The viewer's stylesheet sets page-wide rules and is on only while a map is shown (index.html loads it as media="not all").
    // Switching it on returns once it applies: the map takes its size from the holder as it starts, and before the stylesheet
    // is in, the viewer's map element has no height (MapLibre then makes a 300 px canvas and keeps it). Chrome reads the sheet
    // again when its media changes, so it applies only once the page's style sheets list it (checked every 16 ms, 4 s at most).
    phone, chrome, dock,
    // MV1: a sub-group (a group inside another) fits "Whole sub-group"
    subOf: (owner) => !!(owner?.org && (FP.groupSpace?.groups?.() || []).find((g) => g.id === owner.org)?.parent_org_id),
    // PH2: a group's map's sub-groups in the soft neutral set (map-palette.js), and the names of the person's sub-groups to know them by
    calm: async (manifest, owner, url) => {
      const group = !!(owner?.org && !owner.farm), css = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement) : null;
      let bm = null; try { bm = localStorage.getItem(BASEMAP_KEY); } catch {}
      // the group's sub-groups ({ id, name }): as Home reads them (subgroup_counts, for any member), else the person's own
      const mine = (FP.groupSpace?.groups?.() || []).filter((g) => g.parent_org_id === owner?.org).map((g) => ({ id: g.id, name: g.name }));
      let subs = mine;
      if (group && FP.sb?.rpc) {
        try { const { data, error } = await FP.sb.rpc("subgroup_counts", { parent_org: owner.org }); if (!error && Array.isArray(data) && data.length) subs = data.map((r) => ({ id: r.subgroup_id, name: r.subgroup_name })).filter((s) => s.id && s.name).slice(0, 40); } catch { /* the person's own */ }
      }
      const names = subs.map((s) => String(s.name || "").trim().toLowerCase());
      // PH5: the sub-groups' colours from the layer's own shapes (its file, read once here; the viewer's read of it is then the browser's
      // copy), each category matched to its sub-group first (review of #540, 2)
      const L = group && Array.isArray(manifest?.layers) ? manifest.layers.find((x) => api.subgroupLayer(x, names, subs)) : null;
      let colours = null;
      if (L && url && L.features) { try { const r = await fetch(url(L.features)); if (r.ok) colours = api.subgroupColoursOf(L, await r.json(), FP.mapPalette, subs); } catch { /* without the shapes */ } }
      if (L && !colours) colours = api.subgroupColoursOf(L, null, FP.mapPalette, subs);
      const out = api.calmManifest(manifest, { group, palette: FP.mapPalette, names, subs, onDark: (bm || "aerial") === "aerial", colours,
        hues: FP.mapPalette && css ? FP.mapPalette.hues((k) => css.getPropertyValue(k)) : null });
      return group && FP.wqSiteViewModel ? FP.wqSiteViewModel.tidyManifest(out) : out;   // WQ4
    },
    // PH5: a map about one place. A group's (or sub-group's) map: the viewer's white-and-black dashed boundary is hidden (the owner: no
    // dotted lines at overview scale) and everything outside the area is under the 45% mask, cut along the area's outer edge; a farm's
    // map keeps its boundary and gets the mask only when its own package has none. On a phone a published map's own text labels start
    // off (one tap away, Labels in Layers). viewer.js is not edited: its layers are switched from here once it has added them.
    focus: (map, holder, { group = false, manifest = null, url = null, again = false, area = null } = {}) => api.focusMap(map, holder, { group, manifest, url, area, phone: phone() && !again, palette: FP.mapPalette, phoneModel: FP.phoneModel }),
    // SE1: a group's outline redrawn in the app (its current area place made by the outline editor, method "drawn"; at most 2 rows read,
    // one used) is the outline this map shades outside, over the published map's own boundary, so a later publish from QGIS keeps it.
    // An outline the app has not redrawn (the loader's working boundary, or one put back) leaves the published map's own, as before.
    readArea: async (sb, org) => {
      try {
        const { data, error } = await sb.from("places").select("geom").eq("org_id", org).eq("kind", "area").is("valid_to", null).eq("method", "drawn").limit(2);
        if (error || !Array.isArray(data) || data.length !== 1) return null;
        const light = FP.homeModel?.lighten?.(data[0].geom);
        return light ? { geometry: light.geometry, ha: FP.groupOverviewModel?.areaHa?.(data[0].geom) ?? null } : null;
      } catch { return null; }
    },
    styles: (on) => {
      const link = document.querySelector("link[data-viewer-styles]");
      if (!link) return null;
      link.media = on ? "all" : "not all";
      const applies = () => !!link.sheet && [...document.styleSheets].includes(link.sheet);
      if (!on || applies()) return null;
      const until = Date.now() + 4000;
      return new Promise((done) => { (function tick() { if (applies() || Date.now() > until) done(); else setTimeout(tick, 16); })(); });
    },
    overlay: (map, holder, owner, state, bounds, wqLayers = []) => FP.wqSites?.attach({ map, holder, sb: FP.sb, owner, state, bounds, siteView: true, wqLayers }) || null,
    // WQ4: one short label per site of the published map's water quality layers
    labels: (map, holder, manifest, url) => FP.wqSiteView?.labels({ map, holder, manifest, url }) || null,
    unshare: () => FP.shareSave?.clear(),
    // ML1: a map's saved edits (the latest of public.published_map_edits, at most one row read), applied by map-edit-model.js, and the
    // editor (map-edit.js), which offers itself only to those the database lets change the map
    readEdits: async (sb, mapId) => {
      try { const { data, error } = await sb.from("published_map_edits").select("id, edits, created_at, created_by").eq("map_id", mapId).order("created_at", { ascending: false }).limit(1); return error ? null : data?.[0] || null; }
      catch { return null; }
    },
    applyEdits: (manifest, edits) => (FP.mapEditModel ? FP.mapEditModel.apply(manifest, edits) : manifest),
    edit: (ctx) => FP.mapEdit?.attach({ ...ctx, sb: FP.sb }) || null,
    // EX1: the header's "Share or save" (share-save.js): this view as an image, the viewer's own A4 print, and a link to this map
    share: (map, holder, { title, place }) => FP.shareSave?.set(() => {
      const S = FP.shareSaveModel, day = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
      const print = holder.querySelector(".rv-tools button[aria-label^='Print']");
      return { what: title, link: true,
        files: [{ key: "map", label: "Save this view as an image", hint: "PNG, with its title, date, scale and credits", name: S.fileName([place, title, day], "png"), type: "image/png", image: true, share: "map image",
          make: () => FP.shareSave.mapImage(map, { title, sub: S.stamp({ what: "Map", place, product: FP.brand?.product || "the farm platform", day }),
            foot: ["Indicative only: boundaries and features are approximate and are not a legal survey.", S.savedLine({ product: FP.brand?.product || "", day })] }) }],
        ...(print ? { print: () => print.click(), printHint: "One A4 page with its legend, or save it as a PDF" } : {}) };
    }),
    go: (hash) => { location.hash = hash; }, now: () => Date.now(), visible: () => document.visibilityState === "visible",
    setTimer: (f, ms) => setTimeout(f, ms), clearTimer: (t) => clearTimeout(t),
  });
  document.addEventListener("visibilitychange", () => FP.mapsView.wake());
})(typeof window === "undefined" ? globalThis : window, function () {
  const BUCKET = "map-packages";
  const MAX_MAPS = 100, SIGN_BATCH = 500, MAX_SHARED = 50, SHARED_PREFIX = "shared/";
  const MAX_REFERENCE = 40, REFERENCE_PREFIX = "reference/", REFERENCE_DRAWS = ["roads", "waterways"], CONTEXT_DRAW = "context";
  const LINK_SECONDS = 3600, RENEW_MS = (LINK_SECONDS - 600) * 1000;
  const NONE = "No maps have been published here yet.";
  const NONE_HINT = "Rural Consulting publishes maps here; each one appears as soon as it is ready.";
  const UNAVAILABLE = "This map is not available right now.";
  const RAN_OUT = "This map's links have run out and could not be renewed. Check your connection and try again.";
  const LINZ = "https://basemaps.linz.govt.nz/v1/tiles";
  const ATTRIBUTION = "LINZ CC BY 4.0 © Imagery Basemap contributors";

  // LINZ only: the app's content security policy allows no other tile provider, so the viewer's own Esri and S3 defaults are replaced.
  function backgrounds(key) {
    const tiles = (set, ext, extra = "") => [`${LINZ}/${set}/WebMercatorQuad/{z}/{x}/{y}.${ext}?api=${encodeURIComponent(key || "")}${extra}`];
    return {
      basemaps: { aerial: { label: "Aerial", tiles: tiles("aerial", "webp"), attribution: ATTRIBUTION, maxzoom: 22 },
        map: { label: "Topo", tiles: tiles("topo-raster", "webp"), attribution: ATTRIBUTION, maxzoom: 18 } },
      terrain: { tiles: tiles("elevation", "png", "&pipeline=terrain-rgb"), encoding: "mapbox", attribution: ATTRIBUTION },
    };
  }

  // Which stored file each of the manifest's files is: by content (file_map), or <prefix>/<file> (as the portal reads a package).
  function filesByPath(manifest, prefix) {
    const byPath = new Map(), where = (rel) => manifest.file_map?.[rel] || prefix + "/" + rel;
    for (const rel of Array.isArray(manifest.files) ? manifest.files : []) byPath.set(where(rel), [...(byPath.get(where(rel)) || []), rel]);
    return byPath;
  }
  const day = (d) => (d ? new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "");

  function create(env) {
    const { el } = env;
    let shown = null;

    // The owner's maps with a current package, by title (without the manifests, which are large).
    async function readMaps(owner) {
      const sb = env.sb();
      const maps = await sb.from("published_maps").select("id, slug, title, description, kind")
        .eq(owner.farm ? "farm_id" : "org_id", owner.farm || owner.org).is("archived_at", null).order("title").limit(MAX_MAPS);
      if (maps.error) throw maps.error;
      if (!maps.data?.length) return [];
      const current = await sb.from("map_packages").select("map_id, published_at").in("map_id", maps.data.map((m) => m.id)).eq("is_current", true).limit(MAX_MAPS);
      if (current.error) throw current.error;
      const published = new Map((current.data || []).map((p) => [p.map_id, p.published_at]));
      return maps.data.filter((m) => published.has(m.id)).map((m) => ({ ...m, published_at: published.get(m.id) }));
    }

    // UI2: the list is read once and kept for a minute, so a group's Overview (its "This group's map" card) and its Maps share one read
    const listed = new Map();
    function listMaps(owner) {
      const key = owner.farm ? "farm:" + owner.farm : "org:" + owner.org, t = env.now?.() ?? Date.now(), hit = listed.get(key);
      if (hit && t - hit.at < 60000) return hit.p;
      const p = readMaps(owner);
      listed.set(key, { at: t, p });
      p.catch(() => { if (listed.get(key)?.p === p) listed.delete(key); });
      return p;
    }

    // The map's current package and its signed links, or null when it has none the person may have.
    async function readPackage(map, owner = null) {
      const sb = env.sb();
      // SE1: a group's redrawn outline, asked beside the package (no read round added)
      const areaRead = owner?.org && !owner.farm && env.readArea ? Promise.resolve().then(() => env.readArea(sb, owner.org)).catch(() => null) : null;
      // ML1: the map's latest saved edits (public.published_map_edits), kept beside the map so a publish from QGIS keeps them, applied to
      // the manifest the viewer draws; the package as published goes with it for the editor (js/map-edit.js). Asked for at the same time
      // as the package (no read round added before the first draw); a read that fails, or a database without the table, shows the map as
      // published.
      const [{ data: pkg, error }, saved] = await Promise.all([
        sb.from("map_packages").select("manifest, storage_prefix, version").eq("map_id", map.id).eq("is_current", true).maybeSingle(),
        env.readEdits ? Promise.resolve().then(() => env.readEdits(sb, map.id)).catch(() => null) : null]);
      if (error) throw error;
      if (!pkg) return null;
      const byPath = filesByPath(pkg.manifest, pkg.storage_prefix);
      const shared = await sharedLayers(sb, pkg.manifest, byPath);
      const reference = await referenceRows(sb, byPath);
      const paths = [...byPath.keys()], urls = {};
      for (let i = 0; i < paths.length; i += SIGN_BATCH) {
        const { data, error: refused } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + SIGN_BATCH), LINK_SECONDS);
        if (refused) throw refused;
        for (const d of data || []) if (d.signedUrl) for (const rel of byPath.get(d.path) || []) urls[rel] = d.signedUrl;
      }
      if (!Object.keys(urls).some((rel) => !rel.startsWith(SHARED_PREFIX) && !rel.startsWith(REFERENCE_PREFIX))) return null;   // none of the map's own files: as before
      // a layer whose tiles did not all get a link (removed, or the person may not have them) counts as missing: the viewer says so
      const usable = shared.map((L) => (L && [L.tiles, ...(L.tile_parts || []).map((p) => p.tiles)].every((f) => urls[f]) ? L : null));
      // a reference layer whose file did not get a link (not uploaded yet, or removed) is left out: the map opens without it
      const referenceLayers = reference.filter((r) => urls[r.rel]).map((r) => ({ key: r.key, title: r.title, credit: r.credit, url: urls[r.rel], ...(r.style ? { style: r.style } : {}),
        ...(r.group ? { group: r.group } : {}), ...(r.order !== undefined ? { order: r.order } : {}), ...(r.startsOn ? { startsOn: true } : {}) }));
      let manifest = pkg.manifest;
      try { if (saved && env.applyEdits) manifest = env.applyEdits(pkg.manifest, saved.edits); } catch { manifest = pkg.manifest; }
      const area = areaRead ? await areaRead : null;
      return { manifest, published: pkg.manifest, saved, version: pkg.version || null, urls, shared: usable, referenceLayers, area };
    }

    // CL1: the reference layers, from the core register: the rows whose style names how the viewer draws them
    // ({ reference: { draw: "roads" | "waterways", credit } }, written by tools/load_core_reference.py), by key. Each row's one file
    // is signed with the map's own, so every map draws the same stored copy. A read that fails only leaves them out.
    // CL2: a row drawn as "context" and marked every_map carries its own style ({ source_layer, layers, legend }); it is offered by
    // its own key with that style, in the order the loader gave (tools/core_layers/layers.json), and the viewer lists it under
    // Context layers, off until switched on.
    // N1: with its theme (style.reference.group) and order, so the viewer lists it under that theme's heading, which folds.
    async function referenceRows(sb, byPath) {
      let rows = [];
      try {
        const { data, error } = await sb.from("core_layers").select("key, title, style, tiles_path").not("style->reference", "is", null).order("key").limit(MAX_REFERENCE);
        rows = error ? [] : data || [];
      } catch { rows = []; }
      // CL3: a row the loader marked offered false is withdrawn: neither listed nor signed (its file and row stay)
      const context = (ref) => ref?.draw === CONTEXT_DRAW && ref.every_map === true && ref.offered !== false && ref.style && typeof ref.style === "object" && !Array.isArray(ref.style);
      const order = (row) => (context(row.style.reference) ? (Number.isFinite(row.style.reference.order) ? row.style.reference.order : 1e6) : -1);
      return rows.filter((row) => ((REFERENCE_DRAWS.includes(row?.style?.reference?.draw) && row.style.reference.offered !== false) || context(row?.style?.reference)) && typeof row.tiles_path === "string" && row.tiles_path.startsWith("core/"))
        .sort((a, b) => order(a) - order(b))
        .map((row) => {
          const rel = REFERENCE_PREFIX + row.key, ref = row.style.reference;
          byPath.set(row.tiles_path, [...(byPath.get(row.tiles_path) || []), rel]);
          const credit = typeof ref.credit === "string" ? ref.credit : "";
          if (!context(ref)) return { rel, key: ref.draw, title: row.title, credit };
          // N1: its theme heading in the Layers panel and its place, from the loader (style.reference.group, .order)
          return { rel, key: row.key, title: row.title, credit, style: ref.style,
            ...(typeof ref.group === "string" && ref.group.trim() ? { group: ref.group.trim() } : {}),
            ...(Number.isFinite(ref.order) ? { order: ref.order } : {}),
            ...(ref.starts_on === true ? { startsOn: true } : {}) };     // CTX2: on as a group's map opens
        });
    }

    // The layers this map refers to (manifest.shared_layers: core or a group's), from the registers each by its key: one storage
    // path, signed like the map's own files, so every map that refers to a layer shares the one copy. A list the same length as the
    // references, null where a layer is not there; the viewer makes no database calls of its own. Row-level security decides what
    // the person may read of a group's register, and a read that fails only makes the layer missing.
    async function sharedLayers(sb, manifest, byPath) {
      const refs = Array.isArray(manifest.shared_layers) ? manifest.shared_layers.slice(0, MAX_SHARED) : [];
      if (!refs.length) return [];
      const rowsOf = async (query) => { try { const { data, error } = await query; return error ? [] : data || []; } catch { return []; } };
      const found = new Map(), wanted = (tier, org) => [...new Set(refs.filter((r) => r.tier === tier && (tier === "core" || r.org_id === org)).map((r) => r.key))];
      const core = wanted("core");
      if (core.length) for (const row of await rowsOf(sb.from("core_layers").select("key, title, style, tiles_path").in("key", core))) found.set("core:" + row.key, row);
      for (const org of new Set(refs.filter((r) => r.tier === "group").map((r) => r.org_id))) {
        for (const row of await rowsOf(sb.from("group_shared_layers").select("org_id, key, title, style, tiles_path").eq("org_id", org).in("key", wanted("group", org)))) found.set("group:" + org + ":" + row.key, row);
      }
      return refs.map((ref, i) => {
        const row = found.get(ref.tier === "group" ? "group:" + ref.org_id + ":" + ref.key : "core:" + ref.key);
        const layer = row && row.style && typeof row.style.layer === "object" ? row.style.layer : null;
        if (!layer || !row.tiles_path) return null;
        const folder = row.tiles_path.slice(0, row.tiles_path.lastIndexOf("/") + 1), base = SHARED_PREFIX + i + "/";
        const name = (file) => { byPath.set(folder + file, [...(byPath.get(folder + file) || []), base + file]); return base + file; };
        return { ...layer, id: "shared-" + i, title: row.title, tiles: name(row.tiles_path.slice(folder.length)),
          ...(Array.isArray(layer.tile_parts) ? { tile_parts: layer.tile_parts.map((p) => ({ ...p, tiles: name(p.tiles) })) } : {}),
          legend: Array.isArray(layer.legend) ? layer.legend.map((e) => (e.icon ? { ...e, icon: name(e.icon) } : e)) : [] };
      });
    }

    function dropMap(s) {
      try { s.keep?.stop(); } catch {}
      s.keep = null;
      try { s.map?.mvUnheard?.(); } catch {}   // (MV1: the viewer's own window and document listeners, which it never takes away)
      env.clearTimer(s.timer); s.timer = null; s.renewAt = Infinity;
      try { s.overlay?.remove(); } catch {}
      s.overlay = null;
      try { s.labels?.remove(); } catch {}
      s.labels = null;
      try { s.unhand?.(); } catch {}
      // MEM1: a feature's popup still open makes MapLibre's remove() stop part way (the viewer's popup "close" handler asks the
      // half-removed map for a source and throws), so the old map's listeners, its WebGL context and the map itself were kept. The
      // popups are closed first, by their own close button, while the map is still whole; the app's own listeners go first too.
      try { s.map?.mvMediaOff?.(); } catch {}
      try { for (const b of s.map?.getContainer?.()?.querySelectorAll?.(".maplibregl-popup-close-button") || []) b.click(); } catch {}
      try { s.map?.remove(); } catch {}
      s.map = null;
      env.styles(false);
    }
    function say(s, text, ...more) {
      dropMap(s);
      s.host.replaceChildren(el("div", { class: "maps-message", role: "status" }, el("p", {}, text), ...more));
    }
    const tryAgain = (s) => el("button", { type: "button", class: "maps-again", onclick: () => open(s.host, s.opts) }, "Try again");

    function list(s, maps) {
      dropMap(s);
      s.host.replaceChildren(el("section", { class: "maps-list" }, el("h2", {}, "Maps"),
        el("ul", {}, ...maps.map((m) => el("li", {}, el("a", { href: s.opts.href(m.id) }, globalThis.FP?.icon ? el("span", { class: "maps-thumb", "aria-hidden": "true" }, globalThis.FP.icon("maps", 30)) : null, el("b", {}, m.title),
          el("small", {}, [m.kind, m.published_at ? "Updated " + day(m.published_at) : ""].filter(Boolean).join(" · "))))))));
    }

    // MV1 (and map-keep.js): in WebKit a map whose box changes size after it first drew goes blank (a phone turned sideways and back), so
    // there the map is made again where it was, from the links already read (no new read; the hourly renewal still renews them)
    async function draw(s, again = false) {
      const renewing = !!s.map;
      if (!renewing) say(s, "Loading the map…");
      let read = null;
      if (again && s.read) read = s.read;
      else try { read = await readPackage(s.chosen, s.opts.owner); } catch {}
      s.read = read;
      if (s !== shown) return;
      if (!read) { s.handoff?.drop(); say(s, renewing ? RAN_OUT : UNAVAILABLE, tryAgain(s)); return; }
      const m = s.map, at = m && { center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() };
      const kept = m && s.holder ? choicesOf(s.holder) : null;   // MV1: the person's layer switches and opacity, kept when the map is made again (here or on renewal)
      dropMap(s);
      // the viewer's stylesheet on, and read, before the map is made (env.styles), so the map starts at its holder's full size
      try { await env.styles(true); } catch {}
      if (s !== shown) return;
      const holder = el("div", { class: "maps-viewer" });
      // (a legend swatch drawn here is an SVG data: image, passed as it is; every other file is a signed link)
      const url = (rel) => (typeof rel === "string" && rel.startsWith("data:image/svg+xml,") ? rel : read.urls[rel] || "");
      const group = !!(s.opts.owner?.org && !s.opts.owner.farm);
      let manifest = read.manifest;
      try { if (env.calm) manifest = await env.calm(read.manifest, s.opts.owner, url); } catch { manifest = read.manifest; }
      if (s !== shown) return;
      try {
        s.host.replaceChildren(holder);
        s.map = env.mount(holder, {
          manifest: { ...withChoices(manifest, kept), property: s.opts.name, title: s.chosen.title, map_title: s.chosen.title, description: s.chosen.description || "", kind: s.chosen.kind || "" },
          url,
          ...(group && env.phone?.() && !m ? { phoneGroup: true } : {}),
          ...(kept ? { showing: shownStores(kept) } : {}),
          ...(read.shared.length ? { shared: kept ? withChoices({ layers: read.shared.map((L) => L || null) }, kept).layers : read.shared } : {}),
          referenceLayers: startOn(read.referenceLayers, s.opts.owner),
          onBack: s.several ? () => env.go(s.opts.href(null)) : null, backLabel: "All maps",
          // WQ4: a tap on a water quality site that matches a group monitoring site shows its chart (the overlay); otherwise the viewer's own
          onFeature: (ctx) => { try { return s.overlay?.feature?.(ctx) === true; } catch { return false; } },
          ...env.backgrounds(),
        });
        if (at) s.map.jumpTo(at);
        else arriveFrom(s);   // TR1
        try { env.chrome?.(s.map, holder, { group, sub: !!(group && env.subOf?.(s.opts.owner)), publishedAt: s.chosen.published_at, areaHa: read.area?.ha ?? read.manifest?.area_ha, surveyDate: read.manifest?.survey_date || null, kind: s.chosen.kind || "", place: s.opts.name || "" }); } catch {}
        try { env.focus?.(s.map, holder, { group, manifest: read.manifest, url, again: !!m, area: group ? read.area?.geometry || null : null }); } catch {}
        s.holder = holder;
        if (kept) restoreSwitches(s.map, holder, kept);
        // TR1: this map hands over when the address changes (the viewer's background: its own remembered choice)
        s.unhand = globalThis.FP?.mapHandoff?.register?.(s.map, { kind: "maps", base: () => { try { const b = globalThis.localStorage?.getItem("rv-basemap"); return b === "map" ? "topo" : b || "aerial"; } catch { return null; } } }) || null;
      } catch { s.handoff?.drop(); say(s, UNAVAILABLE, tryAgain(s)); return; }
      const wqLayers = (Array.isArray(manifest?.layers) ? manifest.layers : []).filter((L) => L && L.wqSites).map((L) => String(L.id));   // WQ4
      try { s.overlay = env.overlay ? env.overlay(s.map, holder, s.opts.owner, s.wq, read.manifest?.bounds || null, wqLayers) : null; } catch { s.overlay = null; }
      try { s.labels = env.labels ? env.labels(s.map, holder, manifest, url) : null; } catch { s.labels = null; }
      try { env.dock?.(holder); } catch {}   // MV1
      try { env.share?.(s.map, holder, { title: s.chosen.title, place: s.opts.name }); } catch {}   // EX1
      // (the map's own box, which #568's nv-keep holds still while the new-version line shows; never the whole tab)
      s.keep = globalThis.FP?.mapKeep?.watch?.(s.map.getContainer?.() || holder, () => { if (s === shown && s.map) { const left = s.renewAt; draw(s, true).then(() => { if (s === shown && left !== Infinity) { env.clearTimer(s.timer); s.renewAt = left; s.timer = env.setTimer(wake, Math.max(0, left - env.now())); } }); } }) || null;
      s.keep?.made?.();
      s.renewAt = env.now() + RENEW_MS;
      s.timer = env.setTimer(wake, RENEW_MS);
      // ML1: "Edit layers" in the panel, for those who may change this map (js/map-edit.js); a save draws the map again where it was
      try { env.edit?.({ map: s.map, holder, owner: s.opts.owner, chosen: s.chosen, read, redraw: () => { if (s === shown && s.map) draw(s); } }); } catch {}
    }

    // TR1: arriving from another map (the place's Home, Water quality, Places): the viewer's map opens where that map was, under its
    // picture (taken as Maps opened, so no "Loading the map…" shows between two maps), and once it has drawn there the picture fades and
    // the map eases once to the frame the viewer opened on (map-handoff.js). The viewer (viewer.js) is not changed: its map is moved from
    // here, before its first frame.
    function arriveFrom(s) {
      const h = s.handoff, H = globalThis.FP?.mapHandoff, m = s.map;
      if (!h || s.arrived || !H || !m?.getContainer) return;
      s.arrived = true;
      let target = null;
      try { target = { center: m.getCenter().toArray(), zoom: m.getZoom() }; m.jumpTo(h.cameraFor(m.getContainer())); } catch { h.drop(); return; }
      h.refit?.();
      h.watch?.(m);
      h.reveal(m).then(() => { if (s === shown && s.map === m && (!h.mayMove || h.mayMove(m))) H.ease(m, target); });
    }
    // Renew the links once they are due, when the map is being looked at (a timer does not run in a sleeping tab).
    function wake() {
      const s = shown;
      if (!s?.map || !env.visible() || s.renewAt === Infinity) return undefined;
      const left = s.renewAt - env.now();
      if (left > 0) { env.clearTimer(s.timer); s.timer = env.setTimer(wake, left); return undefined; }   // the wall clock can be a little short when the timer fires
      s.renewAt = Infinity;
      return draw(s);
    }

    // host: the element to fill. opts: { owner: { farm } or { org }, name, item (a map's id, or none), href(mapId or null) }.
    async function open(host, opts) {
      close();
      // MC1: opts.waterQuality opens the map with its water quality sites panel on (the overview's "Open water quality")
      const s = shown = { host, opts, map: null, timer: null, renewAt: Infinity, chosen: null, several: false, overlay: null, wq: opts.waterQuality ? { on: true } : {} };
      // TR1: the map just left hands over (its picture over this box from the start; arriveFrom); a list or a message drops it
      s.handoff = globalThis.FP?.mapHandoff?.take?.({ box: host, id: opts.owner?.org || opts.owner?.farm || null }) || null;
      s.handoff?.cover({ inside: false });
      say(s, "Loading maps…");
      let maps;
      try { maps = await listMaps(opts.owner); }
      catch { if (s === shown) { s.handoff?.drop(); say(s, "Couldn't load the maps just now.", tryAgain(s)); } return; }
      if (s !== shown) return;
      if (!maps.length) { s.handoff?.drop(); say(s, NONE, el("p", { class: "maps-hint" }, NONE_HINT)); return; }   // UI1: and what happens next
      s.several = maps.length > 1;
      s.chosen = opts.item ? maps.find((m) => m.id === opts.item) : maps.length === 1 ? maps[0] : null;
      if (opts.item && !s.chosen) { s.handoff?.drop(); say(s, UNAVAILABLE, el("a", { href: opts.href(null) }, "All maps")); return; }
      if (!s.chosen) { s.handoff?.drop(); list(s, maps); return; }
      await draw(s);
    }

    function close() {
      const s = shown;
      if (!s) return;
      shown = null;
      env.unshare?.();   // EX1: the header's Share or save goes with the map
      s.handoff?.drop();   // TR1
      dropMap(s);
      s.host.replaceChildren();
    }
    return { open, close, wake, listMaps, debug: () => shown?.map || null };
  }
  // ---- PH2: a calm group map --------------------------------------------------------------------------------------------------
  // An area as a person reads it: whole hectares, and a large group's to the nearest 10 or 100 ("243,700 ha", not "243,674.3 ha").
  function areaWords(ha) {
    const n = Number(ha);
    if (!Number.isFinite(n) || n <= 0) return "";
    const r = n >= 10000 ? Math.round(n / 100) * 100 : n >= 1000 ? Math.round(n / 10) * 10 : n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
    return r.toLocaleString("en-NZ") + " ha";
  }
  // The line under a group's map title. The viewer says "Surveyed <date>, <area>" from the package's survey_date, which the plugin
  // guesses from the commonest date among the features' date fields (drone photos, on a farm): a group's map is not surveyed. What
  // is true is when this version was published (map_packages.published_at, the date the maps list already gives as "Updated").
  // MV1: one line for any map, as the portal's: a farm's map says when it was surveyed where its package says so (else when it was
  // published), then its area and what kind of map it is ("Farm plan", "Catchment"), which was beside the place's name before.
  const meta = ({ publishedAt = null, areaHa = null, surveyDate = null, kind = "" } = {}) => [surveyDate && day(surveyDate) ? "Surveyed " + day(surveyDate) : publishedAt ? "Updated " + day(publishedAt) : "",
    areaWords(areaHa), String(kind || "").trim()].filter(Boolean).join(" · ");
  // MV1: the listeners a call adds to each of `targets` (the window and the document), recorded so they can be taken away: the viewer
  // adds window resize and document keydown listeners as it mounts and never removes them, which kept every map made again alive
  // (and, in WebKit, its WebGL context). The returned map gets mvUnheard() to take them away.
  function heard(targets, make) {
    const added = [], put = [];
    for (const t of targets.filter(Boolean)) {
      const own = Object.prototype.hasOwnProperty.call(t, "addEventListener"), was = t.addEventListener;
      t.addEventListener = function (type, fn, opts) { added.push([t, type, fn, opts]); return was.call(this, type, fn, opts); };
      put.push(() => { if (own) t.addEventListener = was; else delete t.addEventListener; });
    }
    let made;
    try { made = make(); } finally { for (const p of put) p(); }
    if (made && typeof made === "object") made.mvUnheard = () => { for (const [t, type, fn, opts] of added.splice(0)) try { t.removeEventListener(type, fn, opts); } catch { /* gone */ } };
    return made;
  }
  // MV1: the person's own choices on a map (its switches by id, its opacity sliders by name), to put back on a map made again
  function choicesOf(holder) {
    try {
      return { on: Object.fromEntries([...holder.querySelectorAll(".rv-panel input.rv-switch[id]")].map((i) => [i.id, i.checked])),
        opacity: Object.fromEntries([...holder.querySelectorAll(".rv-panel .rv-opacity input[aria-label]")].map((i) => [i.getAttribute("aria-label"), Number(i.value)])) };
    } catch { return null; }   // (a holder that cannot be read: the map opens as published, as before)
  }
  const switchId = (L) => "rv-l-" + String(L.id).replace(/[^a-z0-9_-]/gi, "");   // (as the viewer names a layer's switch)
  // a manifest whose layers start as the person left them (the viewer draws each layer from its own `visible` and `opacity`)
  function withChoices(manifest, kept) {
    if (!kept || !Array.isArray(manifest?.layers)) return manifest;
    return { ...manifest, layers: manifest.layers.map((L) => {
      if (!L) return L;
      const on = kept.on[switchId(L)], op = kept.opacity[String(L.title) + " opacity"];
      return { ...L, ...(typeof on === "boolean" ? { visible: on } : {}), ...(Number.isFinite(op) ? { opacity: op / 100 } : {}) };
    }) };
  }
  // the stores the viewer reads its reference and context switches from, as they were showing (MV1, review of #589 round 2): a
  // reference switch's id is rv-l-ref-<draw>, a context layer's rv-l-ctx-<key>
  const REF_STORE = { "rv-l-ref-waterways": "rv-ref-ww", "rv-l-ref-roads": "rv-ref-rd" };
  function shownStores(kept) {
    if (!kept?.on) return null;
    const out = {};
    for (const [id, on] of Object.entries(kept.on)) {
      const k = REF_STORE[id] || (id.startsWith("rv-l-ctx-") ? ctxStore(id.slice("rv-l-ctx-".length)) : null);
      if (k && typeof on === "boolean") out[k] = on ? "1" : "0";
    }
    return out;
  }
  // the switches the viewer does not draw from the manifest (Labels, Shade outside the property): set as they were, by their own change
  // event, at once and again once the map has loaded (the shading is added with the style)
  function restoreSwitches(map, holder, kept) {
    const put = () => { for (const id of ["rv-l-labels", "rv-l-mask"]) { const i = holder.querySelector("#" + id); if (i && typeof kept.on[id] === "boolean" && i.checked !== kept.on[id]) { i.checked = kept.on[id]; i.dispatchEvent(new Event("change", { bubbles: true })); } } };
    put();
    try { if (!map.loaded?.()) map.once?.("load", put); } catch { /* the map is going */ }
  }
  // MV1: the button that brings the whole place back into view, in the app's own words for a place
  const wholeLabel = ({ group = false, sub = false } = {}) => (group ? (sub ? "Whole sub-group" : "Whole group") : "Whole farm");
  // The layer on a group's map that is its sub-groups: a categorised area layer drawn by the web map whose title says so, or whose
  // categories are mostly the group's own sub-groups' names (`names`, lower case).
  // (subs: the group's sub-groups, { id, name }: a category matched to one counts, review of #540, 2)
  function subgroupLayer(L, names = [], subs = null) {
    if (!L?.vector || L.geometry !== "polygon" || L.classes?.kind !== "categories") return false;
    if (/\b(sub-?groups?|catchment groups?)\b/i.test(String(L.title || ""))) return true;
    const labels = (L.legend || []).map((g) => String(g?.label || "").trim()).filter(Boolean);
    const matched = subs?.length ? matchSubgroups(labels, subs) : null;
    return labels.length >= 2 && labels.filter((x) => names.includes(x.toLowerCase()) || matched?.get(x)).length * 2 >= labels.length;
  }
  // The owner (13 Nov 2026): sub-groups in a neutral, soft, easy-to-tell-apart set, thin outlines, gentle translucent fills, never
  // brand colours. The same seven soft hues the Places map and a group's overview give groups (map-palette.js), one per sub-group in
  // turn, each with map-palette's outline for the background it opens on; its legend swatches drawn to match (an SVG, which the app's
  // content policy allows as a data: image). Every other layer, and every farm's map, is drawn as published.
  // PH5 (the owner, 14 Nov 2026: "make the group colours more bold and therefore reduce need for clear outside line"): each sub-group
  // a clear fill from the set that tells neighbours apart (map-palette.js subgroupColours, by its name: `colours`, name -> hue, the
  // same colours Home gives them), at an opacity that reads on the aerial, with a hairline of the same hue and no dashes.
  function calmLayer(L, palette, { onDark = true, hues = null, colours = null } = {}) {
    const set = palette.SUBGROUP_HUES || hues || palette.DEFAULT_HUES;
    const keys = [...new Set(L.vector.layers.flatMap((v) => Object.keys(v.by || {})))];
    // a class's name: its legend label, by its place in the legend (the plugin numbers the categories in legend order)
    const nameOf = (k) => String(L.legend?.[k === "*" ? 0 : Number(k) || 0]?.label || "").trim();
    const hueOf = (k) => (colours && colours.get?.(nameOf(k))) || set[(k === "*" ? 0 : Number(k) || 0) % set.length];
    const lookOf = (k) => (palette.subgroupLook ? palette.subgroupLook(hueOf(k), { onDark }) : { ...palette.look(hueOf(k), { onDark }), fillOpacity: 0.5, lineWidth: 0.75, lineOpacity: 0.9 });
    const by = (f) => Object.fromEntries(keys.map((k) => [k, f(lookOf(k), k)]));
    const swatch = (lk) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="1.5" y="1.5" width="17" height="17" rx="2" fill="' +
      lk.fill + '" fill-opacity="' + lk.fillOpacity + '" stroke="' + lk.line + '" stroke-width="1"/></svg>');
    return { ...L, calm: true,
      vector: { ...L.vector, layers: [{ type: "fill", by: by((lk) => ({ color: lk.fill, opacity: lk.fillOpacity })) }, { type: "line", by: by((lk) => ({ color: lk.line, opacity: lk.lineOpacity ?? 0.9, width: lk.lineWidth })) }] },
      legend: (L.legend || []).map((g, i) => ({ ...g, icon: swatch(lookOf(keys.includes(String(i)) ? String(i) : keys[0] || "0")) })) };
  }
  function calmManifest(manifest, { group = false, palette = null, names = [], subs = null, onDark = true, hues = null, colours = null } = {}) {
    if (!group || !palette || !Array.isArray(manifest?.layers)) return manifest;
    let changed = false;
    const layers = manifest.layers.map((L) => (subgroupLayer(L, names, subs) ? ((changed = true), calmLayer(L, palette, { onDark, hues, colours })) : L));
    return changed ? { ...manifest, layers } : manifest;
  }
  // PH5: what the app does to the viewer's map once it is up (env.focus): the viewer's own layers are only switched or added to, never
  // changed in viewer.js. `when` waits for the viewer to have added its layers (it does so as its style loads).
  const BASE_LAYER = /^(bg|bm-.*|hillshade)$/, WAIT_MS = 20000;
  function focusMap(map, holder, { group = false, manifest = null, url = null, phone = false, palette = null, phoneModel = null, area = null } = {}) {
    if (!map) return;
    // (review of #540, 10: it stops listening once the layer is there, or after WAIT_MS if it never comes)
    // (WQ3: and once the map is removed, leaving the page: a removed map has no style, so nothing is asked of it)
    const alive = () => !map._removed;
    const when = (test, then) => {
      try { if (alive() && test()) { then(); return; } } catch { return; }
      let timer = null;
      const off = () => { clearTimeout(timer); map.off("styledata", h); map.off("idle", h); map.off("remove", off); };
      const h = () => { let ok = false; try { ok = alive() && !!test(); } catch { off(); return; } if (!ok) return; off(); then(); };
      map.on("styledata", h); map.on("idle", h); map.once?.("remove", off);
      timer = setTimeout(off, WAIT_MS);
      timer?.unref?.();   // (in Node's tests, the wait never holds the process open)
    };
    // a group's map: no dashed boundary round the area (the mask shows where it ends)
    if (group) when(() => map.getLayer("boundary"), () => { for (const id of ["boundary", "boundary-halo"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none"); });
    // the mask: outside the area's outer edge, under everything the map draws over its background. Review of #540, 4: exactly one
    // mask: a package that shades the outside itself (its "Shade outside", the viewer's own mask) keeps its own, and this is not added
    // ML1: a map whose darkening outside was turned off for everyone (manifest.shade false, map-edit-model.js) gets none
    const addMask = (mask) => when(() => map.getLayer("boundary-halo"), () => {
      if (map.getSource("ph-mask")) return;
      map.addSource("ph-mask", { type: "geojson", data: mask });
      const above = (map.getStyle().layers || []).find((l) => !BASE_LAYER.test(l.id));
      map.addLayer({ id: "ph-mask", type: "fill", source: "ph-mask", paint: { "fill-color": "#000000", "fill-opacity": palette.MASK_OPACITY ?? 0.45, "fill-antialias": false } }, above?.id);
    });
    // SE1: a group's outline redrawn in the app shades the outside instead of the published boundary: the package's own shading (its
    // "Shade outside", the viewer's "mask") is given the redrawn outline once the viewer has added it; else the app's own mask is
    const drawn = group && area && palette?.outsideMask && phoneModel?.outlineFor ? palette.outsideMask(phoneModel.outlineFor(area, { key: "map-area" })) : null;
    if (drawn) {
      if (manifest?.mask) when(() => map.getSource("mask"), () => map.getSource("mask").setData(drawn));
      else if (manifest?.shade !== false) addMask(drawn);
    } else if (!manifest?.mask && manifest?.boundary && manifest?.shade !== false && url && palette?.outsideMask && phoneModel?.outlineFor && typeof fetch === "function") {
      fetch(url(manifest.boundary)).then((r) => (r.ok ? r.json() : null)).then((fc) => {
        const polys = (fc?.features || (fc?.geometry ? [fc] : [])).flatMap((f) => { const g = f.geometry || f; return g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : []; });
        if (!polys.length) return;
        const mask = palette.outsideMask(phoneModel.outlineFor({ type: "MultiPolygon", coordinates: polys }, { key: "map-" + manifest.boundary }));
        if (mask) addMask(mask);
      }).catch(() => { /* the map stays as it is */ });
    }
    // a group's map on a phone: the published map's own text labels start off at the overview (the viewer's Labels switch, in Layers).
    // Review of #540, 3: a farm's own map keeps its labels as published.
    if (phone && group) {
      let tries = 0;
      const off = () => {
        const sw = holder?.querySelector?.("#rv-l-labels");
        if (!sw) { if (++tries < 40) setTimeout(off, 100); return; }
        if (sw.checked) { sw.checked = false; sw.dispatchEvent(new Event("change", { bubbles: true })); }
      };
      off();
    }
  }
  // PH5: the sub-groups' colours for a group's map, from its sub-groups layer's own shapes (so neighbours differ, and each sub-group
  // has the colour Home gives it): Map name -> hue, or null. features: the layer's FeatureCollection (each feature's class `_cls`).
  // Review of #540, 2: a published map names its sub-groups its own way ("Whitcombe Landcare Group", "Otuwharekai Ashburton Lakes")
  // where the platform has "Whitcombe" and "Ashburton Lakes". Each category is matched to the group's own sub-group before colouring:
  // the same name ignoring case; else the one sub-group all of whose words are in the category's name (or all the category's words in
  // the sub-group's), the one with the most words where several are; else, where both have shapes, the sub-group whose area's box
  // overlaps the category's the most (at least half of the smaller). Map label -> sub-group ({ id, name }), or null when none.
  const words = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const boxOf = (g) => { let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity; const walk = (c) => (typeof c?.[0] === "number" ? ([w, s, e, n] = [Math.min(w, c[0]), Math.min(s, c[1]), Math.max(e, c[0]), Math.max(n, c[1])]) : (c || []).forEach(walk)); walk(g?.coordinates); return Number.isFinite(w) ? [w, s, e, n] : null; };
  function matchSubgroups(labels, subs, { shapes = null } = {}) {
    const out = new Map(), list = (subs || []).filter((s) => s && s.name);
    for (const label of labels || []) {
      const lw = words(label), low = String(label).trim().toLowerCase();
      let hit = list.find((s) => String(s.name).trim().toLowerCase() === low) || null;
      if (!hit) {
        const within = list.filter((s) => { const sw = words(s.name); return sw.length && (sw.every((w) => lw.includes(w)) || lw.every((w) => sw.includes(w))); });
        const most = Math.max(0, ...within.map((s) => words(s.name).length));
        const best = within.filter((s) => words(s.name).length === most);
        if (best.length === 1) hit = best[0];
      }
      if (!hit && shapes?.label?.get(label)) {
        const a = boxOf(shapes.label.get(label)), size = (b) => (b[2] - b[0]) * (b[3] - b[1]);
        let top = 0;
        for (const s of list) {
          const b = shapes.sub?.get(s.id) ? boxOf(shapes.sub.get(s.id)) : null;
          if (!a || !b) continue;
          const ov = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
          const share = ov / Math.max(1e-12, Math.min(size(a), size(b)));
          if (share >= 0.5 && share > top) { top = share; hit = s; }
        }
      }
      out.set(label, hit);
    }
    return out;
  }
  // The colours for a group's map: Map category label -> hue. Each category is first matched to its sub-group (matchSubgroups), and
  // the group's every sub-group is coloured by its id, with the category's shapes where it has them: the same set and keys Home
  // colours, so a sub-group has the same colour on both. subs: the group's sub-groups ({ id, name }); with none, by the labels alone.
  function subgroupColoursOf(L, features, palette, subs = []) {
    if (!L || !palette?.subgroupColours) return null;
    const byLabel = new Map();
    for (const f of features?.features || []) {
      const label = String(L.legend?.[Number(f.properties?._cls) || 0]?.label || f.properties?.name || "").trim(), g = f.geometry;
      if (!label || !g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      byLabel.set(label, [...(byLabel.get(label) || []), ...polys]);
    }
    const labels = [...new Set([...(L.legend || []).map((g) => String(g?.label || "").trim()).filter(Boolean), ...byLabel.keys()])];
    const geom = (label) => (byLabel.get(label)?.length ? { type: "MultiPolygon", coordinates: byLabel.get(label) } : null);
    const match = matchSubgroups(labels, subs);
    const items = new Map();   // key -> { key, name, geometry }
    for (const s of subs || []) if (s?.id && s.name) items.set(String(s.id), { key: String(s.id), name: s.name, geometry: null });
    for (const label of labels) {
      const s = match.get(label), k = s ? String(s.id) : "label:" + label;
      const it = items.get(k) || { key: k, name: s ? s.name : label, geometry: null };
      const g = geom(label);
      if (g) it.geometry = it.geometry ? { type: "MultiPolygon", coordinates: [...it.geometry.coordinates, ...g.coordinates] } : g;
      items.set(k, it);
    }
    const byName = palette.subgroupColours([...items.values()]);
    return new Map(labels.map((label) => { const s = match.get(label); return [label, byName.get(s ? s.name : label)]; }));
  }
  // The background and reference layers a group's map opens with on a phone: the plain map, roads and waterways off, unless the person
  // has chosen otherwise on this device (the viewer remembers their own choices; these are set only for the start and taken away)
  // PH5: the background is the viewer's own default, the aerial (the owner: the plain map loads slow on a phone and looks busy); the
  // person's own choice in the viewer's Layers is still remembered by the viewer
  const PHONE_START = { "rv-ref-ww": "0", "rv-ref-rd": "0" };

  // CTX2: where the viewer remembers a context layer's switch on this device (its contextDefs: "rv-ctx-" and the key as it cleans it)
  const ctxStore = (key) => { const k = String(key || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80); return k ? "rv-ctx-" + k : null; };
  // CTX2: the viewer's reference layers for an owner: a group's map marks the layers that start on (startOn); a farm's map starts
  // every context layer off, as before. The internal startsOn mark is never passed on.
  function startOn(layers, owner) {
    const group = !!(owner && owner.org && !owner.farm);
    return (layers || []).map((r) => { const { startsOn, ...rest } = r; return startsOn && group ? { ...rest, startOn: true } : rest; });
  }
  // CTX2: run `start` (the viewer's mount) with each startOn layer's switch set on in `store` (localStorage) where the person has no
  // choice of their own remembered, then take away only what was set here. A store that cannot be used changes nothing.
  // PH2: on a phone a group's map is calm: `phoneGroup` seeds PHONE_START the same way and seeds no context layer on (the owner: "you
  // might use a map on your phone to find a site, but not turn on half a dozen layers"); each stays one tap away in Layers.
  // MV1 (review of #589, round 2): `showing`, a map made again (a WebKit re-make, the hourly renewal): its reference and context switches
  // start exactly as they were showing (store key -> "1" or "0", shownStores), whatever start the phone or the computer would give;
  // nothing turns itself on or off.
  function seedStartOn(store, layers, start, { phoneGroup = false, showing = null } = {}) {
    const seeded = [];
    const seed = (k, v) => { try { if (k && store && store.getItem(k) === null) { store.setItem(k, v); seeded.push([k, v]); } } catch {} };
    if (showing) for (const [k, v] of Object.entries(showing)) seed(k, v);
    else if (phoneGroup) for (const [k, v] of Object.entries(PHONE_START)) seed(k, v);
    else for (const r of layers || []) if (r && r.startOn === true && r.style) seed(ctxStore(r.key), "1");
    try { return start(); }
    finally { for (const [k, v] of seeded) try { if (store.getItem(k) === v) store.removeItem(k); } catch {} }
  }
  return { create, backgrounds, filesByPath, ctxStore, startOn, seedStartOn, areaWords, meta, wholeLabel, heard, choicesOf, withChoices, restoreSwitches, subgroupLayer, calmLayer, calmManifest, subgroupColoursOf, matchSubgroups, focusMap, shownStores, PHONE_START,
    BUCKET, MAX_MAPS, MAX_REFERENCE, LINK_SECONDS, RENEW_MS, NONE, UNAVAILABLE, RAN_OUT };
});
