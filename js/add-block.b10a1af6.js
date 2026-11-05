// FB1 "I've bought a block": the guided panel over the farm's map. The command bar ("I've bought a block", "add land")
// or Ask (its block.add verb) opens it; the person taps the LINZ primary parcels that are now the farm's, says whether
// the farmed area needs adjusting (and adjusts or redraws it), saves, and can then add a note or a document about the
// block. The parcels are the shared layer read for the map in view (a filter, nothing copied); only Save writes (one
// add_block call), so Cancel at any step leaves nothing written. The flow's state and calls are FP.blockModel's.
(function (root) {
  const B = () => root.FP.blockModel;
  const $ = (s) => root.FP.$(s), el = (...a) => root.FP.el(...a);
  const NONE = { type: "FeatureCollection", features: [] };
  const LAYERS = ["fb-parcels-fill", "fb-parcels-line", "fb-chosen-line", "fb-shape-fill", "fb-shape-line", "fb-middles", "fb-vertices", "fb-drawing-line", "fb-drawing-points"];
  const SOURCES = ["fb-parcels", "fb-shape", "fb-middles", "fb-vertices", "fb-drawing"];
  // The parcels are read for a view up to this size (degrees: about 30 km by 30 km, as parcels_in_view); wider, "zoom in".
  const MAX_SPAN = [0.4, 0.3];
  const close_ = () => { const b = map.getBounds(); return b.getEast() - b.getWest() <= MAX_SPAN[0] && b.getNorth() - b.getSouth() <= MAX_SPAN[1]; };
  let flow = null, ui = null, map = null, parcels = NONE, asked = 0, picked = null, dragging = null, saved = false;
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const phone = () => !window.matchMedia("(min-width: 801px)").matches;

  // ---- the map: the parcels in view, the chosen ones, the farmed area being adjusted ---------------------------------
  function addLayers() {
    for (const id of SOURCES) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: NONE });
    const accent = token("--accent"), line = token("--map-label");
    const add = (spec) => { if (!map.getLayer(spec.id)) map.addLayer(spec); };
    add({ id: "fb-parcels-fill", type: "fill", source: "fb-parcels", paint: { "fill-color": ["case", ["boolean", ["get", "held"], false], line, accent],
      "fill-opacity": ["case", ["boolean", ["get", "chosen"], false], 0.4, ["boolean", ["get", "held"], false], 0.18, 0.04] } });
    add({ id: "fb-parcels-line", type: "line", source: "fb-parcels", paint: { "line-color": line, "line-width": 1.2, "line-opacity": 0.85 } });
    add({ id: "fb-chosen-line", type: "line", source: "fb-parcels", filter: ["==", ["get", "chosen"], true], paint: { "line-color": accent, "line-width": 3 } });
    add({ id: "fb-shape-fill", type: "fill", source: "fb-shape", paint: { "fill-color": accent, "fill-opacity": 0.3 } });
    add({ id: "fb-shape-line", type: "line", source: "fb-shape", paint: { "line-color": accent, "line-width": 3 } });
    add({ id: "fb-middles", type: "circle", source: "fb-middles", paint: { "circle-radius": phone() ? 7 : 5, "circle-color": line, "circle-opacity": 0.85, "circle-stroke-color": accent, "circle-stroke-width": 1.5 } });
    add({ id: "fb-vertices", type: "circle", source: "fb-vertices", paint: { "circle-radius": ["case", ["boolean", ["get", "picked"], false], phone() ? 12 : 9, phone() ? 9 : 7],
      "circle-color": accent, "circle-stroke-color": line, "circle-stroke-width": 2 } });
    add({ id: "fb-drawing-line", type: "line", source: "fb-drawing", paint: { "line-color": accent, "line-width": 3, "line-dasharray": [2, 1] } });
    add({ id: "fb-drawing-points", type: "circle", source: "fb-drawing", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": accent, "circle-stroke-color": line, "circle-stroke-width": 2 } });
  }
  function removeLayers() {
    if (!map) return;
    for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  }
  const setData = (id, data) => map?.getSource(id)?.setData(data || NONE);
  // The parcels drawn: those in view, and every chosen one (even once panned away), each marked chosen or held.
  // Once chosen, the block is drawn as one shape (its union, then the farmed area being adjusted), not parcel by parcel.
  function drawParcels() {
    const sel = flow.state.selection, seen = new Set(), features = [], picking = flow.state.step === "pick";
    for (const f of parcels.features) { seen.add(f.id); features.push({ ...f, properties: { ...f.properties, chosen: picking && sel.ids.includes(f.id) } }); }
    for (const id of sel.ids) if (!seen.has(id) && sel.features[id]) features.push({ ...sel.features[id], properties: { ...sel.features[id].properties, chosen: picking } });
    setData("fb-parcels", { type: "FeatureCollection", features });
  }
  function drawShape() {
    const s = flow.state, adjusting = s.step === "adjust";
    // the block's shape: its union while confirming, the points while adjusting, and what was saved afterwards
    const shape = adjusting ? B().geometryOf(s.shape) : s.step === "confirm" ? s.union : ["saved", "note"].includes(s.step) ? (s.shape ? B().geometryOf(s.shape) : s.union) : null;
    setData("fb-shape", shape ? { type: "Feature", geometry: shape, properties: {} } : NONE);
    if (adjusting && !s.drawing) {
      const h = B().handles(s.shape);
      for (const v of h.vertices.features) v.properties.picked = !!picked && picked.join() === [v.properties.p, v.properties.r, v.properties.v].join();
      setData("fb-vertices", h.vertices); setData("fb-middles", h.middles);
    } else { setData("fb-vertices", NONE); setData("fb-middles", NONE); }
    const d = s.drawing || [];
    setData("fb-drawing", d.length ? { type: "FeatureCollection", features: [
      ...(d.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: d.length > 2 ? [...d, d[0]] : d }, properties: {} }] : []),
      ...d.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} }))] } : NONE);
  }
  // Read the parcels for the map in view (while choosing), once it has come to rest; a read overtaken is dropped.
  async function readParcels() {
    if (!flow || !map || !["pick", "confirm"].includes(flow.state.step)) return;
    if (!close_()) { parcels = NONE; drawParcels(); say(flow.state.step === "pick" ? "Zoom in to see the parcels." : ""); return; }
    const b = map.getBounds(), mine = ++asked;
    try {
      const fc = await flow.parcelsIn([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]]);
      if (mine !== asked || !flow) return;
      parcels = fc; drawParcels();
      if (flow.state.step === "pick") say(fc.features.length ? "" : "No parcels are held for this part of the map.");
    } catch (e) { if (mine === asked && flow) say("The parcels couldn't be read: " + e.message); }
  }
  // Frame the farm with room round it for the land next door, clear of the panel, flat (no tilt) for tapping.
  function frame(geom) {
    if (!map || !geom) return;
    const coords = [];
    const walk = (c) => (typeof c[0] === "number" ? coords.push(c) : c.forEach(walk));
    walk(geom.coordinates || geom.geometry?.coordinates || []);
    if (!coords.length) return;
    const xs = coords.map((c) => c[0]), ys = coords.map((c) => c[1]);
    let [w, s, e, n] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const dx = (e - w) * 0.35, dy = (n - s) * 0.35;
    [w, s, e, n] = [w - dx, s - dy, e + dx, n + dy];
    const panel = ui?.getBoundingClientRect(), box = map.getContainer().getBoundingClientRect();
    const pad = { top: 56, left: 24, right: 24, bottom: 24 };
    if (panel && phone()) pad.bottom = Math.max(24, box.bottom - panel.top + 16);
    else if (panel) pad.right = Math.max(24, box.right - panel.left + 16);
    map.fitBounds([[w, s], [e, n]], { padding: pad, pitch: 0, bearing: 0, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600, maxZoom: 17 });
  }

  // ---- taps and drags --------------------------------------------------------------------------------------------------
  const hit = (e, layers) => map.queryRenderedFeatures(e.point, { layers: layers.filter((id) => map.getLayer(id)) });
  function onTap(e) {
    const s = flow?.state;
    if (!s) return;
    if (s.step === "pick") {
      const f = hit(e, ["fb-parcels-fill"])[0];
      if (!f) return;
      const id = Number(f.id ?? f.properties.reference_id);
      // the whole parcel (the rendered one is cut at tile edges)
      const full = parcels.features.find((x) => x.id === id) || s.selection.features[id];
      if (!full) return;
      if (full.properties.held) { say((B().parcelRow(full).appellation) + " is already part of the farm."); return; }
      flow.toggle(full);
      return;
    }
    if (s.step !== "adjust") return;
    if (s.drawing) { flow.tapDrawing(e.lngLat.toArray()); return; }
    const m = hit(e, ["fb-middles"])[0];
    if (m) { const p = m.properties; flow.reshape(B().insertVertex(s.shape, [p.p, p.r, p.v])); picked = [p.p, p.r, p.v + 1]; drawShape(); render(); return; }
    const v = hit(e, ["fb-vertices"])[0];
    picked = v ? [v.properties.p, v.properties.r, v.properties.v] : null;
    drawShape(); render();
  }
  function startDrag(e) {
    const s = flow?.state;
    if (!s || s.step !== "adjust" || s.drawing) return;
    const v = hit(e, ["fb-vertices"])[0];
    if (!v || (e.originalEvent?.touches && e.originalEvent.touches.length > 1)) return;
    e.preventDefault();
    dragging = [v.properties.p, v.properties.r, v.properties.v]; picked = dragging;
    map.dragPan.disable();
    map.getCanvas().style.cursor = "grabbing";
  }
  function moveDrag(e) {
    if (!dragging) return;
    flow.reshape(B().moveVertex(flow.state.shape, dragging, e.lngLat.toArray()));
  }
  function endDrag() {
    if (!dragging) return;
    dragging = null; map.dragPan.enable(); map.getCanvas().style.cursor = "";
    render();
  }
  const hover = (e) => { if (!dragging && map) map.getCanvas().style.cursor = hit(e, flow?.state.step === "pick" ? ["fb-parcels-fill"] : ["fb-vertices", "fb-middles"]).length ? "pointer" : ""; };

  // ---- the panel -------------------------------------------------------------------------------------------------------
  let said = "";   // a line about the map (zoom in, already the farm's), until the next step or action
  const say = (text) => { said = text || ""; const m = ui?.querySelector(".block-msg"); if (m) m.textContent = flow?.state.error || said; };
  const button = (label, attrs = {}) => el("button", { type: "button", ...attrs }, label);
  const STEP_LABEL = { pick: "1 of 3 · Parcels", confirm: "2 of 3 · Farmed area", adjust: "2 of 3 · Farmed area", saved: "3 of 3 · Notes", note: "3 of 3 · Notes" };
  function render() {
    if (!ui || !flow) return;
    const s = flow.state, B_ = B(), sum = B_.summary(s.selection);
    ui.dataset.step = s.step;
    const head = ui.querySelector(".block-step"), lead = ui.querySelector(".block-lead"), body = ui.querySelector(".block-body"), acts = ui.querySelector(".block-actions");
    head.textContent = STEP_LABEL[s.step] || "";
    body.replaceChildren(); acts.replaceChildren();
    ui.querySelector(".block-msg").textContent = s.error || (s.busy ? (s.step === "pick" ? "One moment…" : "Saving…") : said);
    const cancel = button(saved ? "Done" : "Cancel", { class: "link", "data-block": saved ? "done" : "cancel" });
    if (s.step === "pick") {
      lead.textContent = "Tap the parcels that are now part of the farm.";
      body.append(el("p", { class: "block-total", "data-block-total": "" }, sum.text),
        el("ul", { class: "block-parcels" }, ...sum.rows.map((r) => el("li", { "data-parcel": String(r.id) },
          el("span", { class: "block-parcel-name" }, r.appellation), el("span", { class: "block-parcel-area" }, B_.ha(r.area_ha)),
          button("Remove", { class: "link", "data-block-remove": String(r.id), "aria-label": "Remove " + r.appellation })))));
      acts.append(button("Next", { class: "primary", "data-block": "next", disabled: !sum.count || s.busy ? "" : null }), cancel);
    } else if (s.step === "confirm") {
      lead.textContent = "Does the farmed area need adjusting?";
      body.append(el("p", {}, "The farm's boundary will take in all of " + sum.rows.map((r) => r.appellation).join(", ") + (s.union_ha != null ? " (" + B_.ha(s.union_ha) + ")" : "") + "."),
        el("label", { class: "block-field" }, el("span", {}, "Bought on (optional)"), el("input", { type: "date", name: "acquired", value: s.acquired || "", max: new Date().toISOString().slice(0, 10) })));
      acts.append(button("No, farm all of it", { class: "primary", "data-block": "save", disabled: s.busy ? "" : null }), button("Yes, adjust it", { "data-block": "adjust" }),
        button("Back", { class: "link", "data-block": "back" }), cancel);
    } else if (s.step === "adjust" && s.drawing) {
      lead.textContent = "Tap the corners of the farmed area.";
      body.append(el("p", { class: "block-total" }, s.drawing.length ? s.drawing.length + (s.drawing.length === 1 ? " corner" : " corners") : "No corners yet"));
      acts.append(button("Finish", { class: "primary", "data-block": "finish", disabled: s.drawing.length < 3 ? "" : null }),
        button("Undo last", { "data-block": "undo-corner", disabled: s.drawing.length ? null : "" }), button("Back to the points", { class: "link", "data-block": "reset" }), cancel);
    } else if (s.step === "adjust") {
      const g = flow.farmed();
      lead.textContent = "Drag the points to where the farmed area runs.";
      body.append(el("p", { class: "block-hint" }, "Tap + to add a point. Tap a point, then Remove point."),
        el("p", { class: "block-total", "data-block-total": "" }, "Farmed area " + (g ? B_.ha(B_.areaHa(g)) : "")));
      acts.append(button("Save", { class: "primary", "data-block": "save", disabled: s.busy ? "" : null }),
        button("Remove point", { "data-block": "remove-point", disabled: picked ? null : "" }), button("Redraw", { "data-block": "draw" }),
        button("Start again", { "data-block": "reset" }), button("Back", { class: "link", "data-block": "back" }), cancel);
    } else if (s.step === "saved") {
      lead.textContent = s.noted ? "Saved with the block." : "Added to the farm.";
      body.append(el("p", {}, sum.rows.map((r) => r.appellation).join(", ") + (sum.area_ha != null ? " · " + B_.ha(sum.area_ha) : "") + ". The farm's boundary now takes it in."));
      if (s.noted && s.note) body.append(el("p", { class: "block-note" }, s.note));
      acts.append(...(s.noted ? [] : [button("Add a note or document about this block", { class: "primary", "data-block": "note" })]), button("Done", { class: s.noted ? "primary" : "link", "data-block": "done" }));
    } else if (s.step === "note") {
      lead.textContent = "A note or document about this block.";
      body.append(el("label", { class: "block-field" }, el("span", {}, "Note"), el("textarea", { name: "note", rows: "3", maxlength: "4000", placeholder: "Bought from the neighbour; the river flat floods in winter." })),
        el("label", { class: "block-field" }, el("span", {}, "Document (optional)"), el("input", { type: "file", name: "document" })));
      acts.append(button("Save", { class: "primary", "data-block": "save-note", disabled: s.busy ? "" : null }), button("Skip", { class: "link", "data-block": "skip" }));
    }
  }
  async function act(what, node) {
    const s = flow?.state;
    if (!s) return;
    say("");
    if (what === "cancel") return close();
    if (what === "done") return close(true);
    if (what === "next") { await flow.next(); frame(flow.state.union); return; }
    if (what === "back") { picked = null; flow.back(); return; }
    if (what === "adjust") { picked = null; flow.adjust(); return; }
    if (what === "reset") { picked = null; flow.reset(); return; }
    if (what === "draw") { picked = null; flow.startDrawing(); return; }
    if (what === "finish") { flow.finishDrawing(); return; }
    if (what === "undo-corner") { flow.undoCorner(); return; }
    if (what === "remove-point") { if (picked) { const next = B().removeVertex(s.shape, picked); if (next === s.shape) say("A shape needs three points at least."); picked = null; flow.reshape(next); } return; }
    if (what === "save") {
      if (s.step === "confirm") flow.setAcquired(ui.querySelector("input[name=acquired]")?.value);
      const r = await flow.save();
      if (r.step === "saved") { saved = true; root.FP.farmMap.capture(null); setData("fb-vertices", NONE); setData("fb-middles", NONE); opts.onSaved?.(r.result); render(); }
      return;
    }
    if (what === "note") { flow.noteStep(); ui.querySelector("textarea[name=note]")?.focus(); return; }
    if (what === "skip") { close(true); return; }
    if (what === "save-note") {
      const text = ui.querySelector("textarea[name=note]")?.value || "", file = ui.querySelector("input[name=document]")?.files?.[0] || null;
      let doc = null;
      if (file) {
        node.disabled = true; say("Adding the document…");
        try { doc = await opts.uploadDocument(file); } catch (e) { node.disabled = false; say("The document wasn't added: " + (e.message || e)); return; }
      }
      await flow.saveNote(text, doc);
    }
  }
  let opts = {};
  // Open the flow on the farm (context: the farm space's; options: onSaved(result), onClose(saved), uploadDocument(file) -> id).
  async function open(context, options = {}) {
    if (flow) { ui?.querySelector("button")?.focus(); return; }
    opts = options; saved = false; picked = null; parcels = NONE;
    flow = B().createFlow({ sb: root.FP.sb, farm: context.farm.id, onChange: () => { drawParcels(); drawShape(); render(); } });
    ui = el("section", { id: "block-flow", class: "block-flow", role: "dialog", "aria-modal": "false", "aria-labelledby": "block-flow-title" },
      el("header", { class: "block-head" }, el("h2", { id: "block-flow-title" }, "Add a block"), el("span", { class: "block-step" })),
      el("p", { class: "block-lead" }), el("div", { class: "block-body" }), el("p", { class: "block-msg", role: "status", "aria-live": "polite" }), el("div", { class: "block-actions" }));
    ui.addEventListener("click", (e) => {
      const b = e.target.closest("[data-block]"), r = e.target.closest("[data-block-remove]");
      if (r) { const id = Number(r.dataset.blockRemove), f = flow.state.selection.features[id]; if (f) flow.toggle(f); return; }
      if (b && !b.disabled) act(b.dataset.block, b);
    });
    ui.addEventListener("change", (e) => { if (e.target.name === "acquired") flow.setAcquired(e.target.value); });
    ui.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!saved) close(); else close(true); } });
    $("#screen-map").append(ui);
    document.body.classList.add("block-flow-active");
    root.FP.farmMap.closePhoto?.();
    map = root.FP.farmMap.glMap();
    await root.FP.farmMap.loaded();
    if (!flow) return;
    addLayers();
    root.FP.farmMap.unmask(true);
    root.FP.farmMap.capture(onTap);
    map.on("moveend", readParcels);
    map.on("mousedown", "fb-vertices", startDrag); map.on("touchstart", "fb-vertices", startDrag);
    map.on("mousemove", moveDrag); map.on("touchmove", moveDrag);
    map.on("mouseup", endDrag); map.on("touchend", endDrag); map.on("touchcancel", endDrag);
    map.on("mousemove", hover);
    render();
    frame(context.maps?.extent);
    ui.querySelector(".block-lead").setAttribute("tabindex", "-1");
    ui.querySelector(".block-lead").focus({ preventScroll: true });
    readParcels();
  }
  // Close: nothing is written that wasn't saved. The map is given back as it was.
  function close(wasSaved = saved) {
    if (!flow) return;
    const s = flow;
    s.cancel(); flow = null; asked++;
    if (map) {
      map.off("moveend", readParcels);
      map.off("mousedown", "fb-vertices", startDrag); map.off("touchstart", "fb-vertices", startDrag);
      map.off("mousemove", moveDrag); map.off("touchmove", moveDrag);
      map.off("mouseup", endDrag); map.off("touchend", endDrag); map.off("touchcancel", endDrag);
      map.off("mousemove", hover);
      if (dragging) { dragging = null; map.dragPan.enable(); }
      removeLayers();
    }
    root.FP.farmMap.capture(null); root.FP.farmMap.unmask(false);
    ui?.remove(); ui = null; map = null; parcels = NONE; picked = null;
    document.body.classList.remove("block-flow-active");
    const done = opts.onClose; opts = {};
    done?.(!!wasSaved, s);
  }
  root.FP = root.FP || {};
  root.FP.addBlock = { open, close, get open_() { return !!flow; }, flow: () => flow, parcels: () => parcels };
})(typeof window === "undefined" ? globalThis : window);
