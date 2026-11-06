// GE1b (#417 slice GE1): the shape editor over a map surface (the farm's map, or a group's): select a block, paddock or land
// unit, drag, add and remove its corners, snap them to neighbours, parcels, waterways and the boundary, undo and redo until
// Save, save as a new version (GE1a), and undo the save. The model, the rules and every call are FP.shapeEditModel's; this
// is the map and the panel. The corner handles are drawn as the add-block editor draws its own (add-block.js, unchanged).
// Hosts (farm-space.js, group-space.js) hand the surface a tools(hit) function: Edit shape in the feature's popup, or why
// it can't be, for a person Q27 lets edit that space, on a wide screen, with the trial switched on (the Operations Layers
// tab's "Shape editor (trial)", RCL staff only, kept in this browser). Switched off, tools() gives nothing and the popup is as it
// was. Edit shape asks the database first (the session's probe): a refusal is said in the popup and no editor opens.
(function (root) {
  const M = () => root.FP.shapeEditModel, B = () => root.FP.blockModel;
  const el = (...a) => root.FP.el(...a);
  const NONE = { type: "FeatureCollection", features: [] };
  const SOURCES = ["se-before", "se-shape", "se-middles", "se-vertices", "se-drag", "se-snap"];
  const LAYERS = ["se-before-line", "se-shape-fill", "se-shape-line", "se-middles", "se-vertices", "se-drag", "se-snap"];
  const TRIAL_KEY = "fp.trial.shape-editor";
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const wideNow = () => root.innerWidth || document.documentElement.clientWidth || 0;
  // a mouse or pen as the main pointer (a touch-first tablet is not offered the tools: corners are dragged with a pointer)
  const fineNow = () => { try { return root.matchMedia("(pointer: fine)").matches; } catch { return false; } };

  // ---- the trial switch: this browser only (the Operations Layers tab sets it, for RCL staff) -------------------------------
  function trialOn() { try { return root.localStorage?.getItem(TRIAL_KEY) === "on"; } catch { return false; } }
  function setTrial(on) { try { if (on) root.localStorage.setItem(TRIAL_KEY, "on"); else root.localStorage.removeItem(TRIAL_KEY); } catch {} close(); return trialOn(); }
  const staff = () => !!root.FP.ops?.isStaff?.();
  // The switch's panel on the Operations Layers tab (ops-layers.js adds it for staff, below the layer notes), and its wiring.
  function trialsPanel(on = trialOn()) {
    return '<section class="answer-panel answer-compact ops-panel" data-ops="trials"><h2>Trials</h2>' +
      '<p class="answer-sentence">Tools still being tried, for you alone and in this browser only.</p>' +
      '<label class="ops-line ops-trial"><input type="checkbox" role="switch" id="ops-trial-shape-editor"' + (on ? " checked" : "") + "> <span>Shape editor (trial)</span></label>" +
      '<p class="ops-line">Edit shape in the popup of a block, paddock or land unit on a farm or group map you edit, with a mouse, on a larger screen.</p></section>';
  }
  function wireTrials(box) {
    const sw = box?.querySelector?.("#ops-trial-shape-editor");
    if (sw) sw.addEventListener("change", () => { sw.checked = setTrial(sw.checked); });
    return !!sw;
  }

  let ed = null;   // the editor open: { surface, map, session, editor, host, ui, index, dragging, snapped, closing }

  // ---- the popup's tools -------------------------------------------------------------------------------------------------
  // host: { space, owner, role, surface, boundary() } -> a node for the popup, or null (nothing changes in the popup)
  function tools(hit, at, host) {
    const pick = M().pickTarget(hit, (t) => M().offer({ space: host.space, role: host.role, width: wideNow(), fine: fineNow(), target: t, trial: trialOn(), staff: staff() }));
    if (!pick) return null;
    const { target, offer: o, under } = pick;
    if (!o.edit) return el("p", { class: "pop-q pop-edit-why", "data-edit": "why" }, o.why);
    const msg = el("p", { class: "pop-q pop-edit-why", "data-edit": "refused", role: "status", hidden: "" });
    const button = el("button", { type: "button", class: "pop-edit", "data-edit": "open" }, under ? "Edit shape: " + (String(target.layer.name || "").trim() || "the shape under it") : "Edit shape");
    button.addEventListener("click", async () => {
      button.disabled = true; button.textContent = "Opening…";
      const opened = await open(host, target, { at: at?.lngLat, closePopup: at?.close });
      if (opened === true || opened === null) return;   // null: the person moved on meanwhile (nothing to say)
      button.remove(); msg.hidden = false; msg.textContent = opened || "The shape couldn't be opened.";
    });
    return el("div", { class: "pop-edit-tools" }, button, msg);
  }

  // ---- the map -------------------------------------------------------------------------------------------------------------
  function addLayers(map) {
    for (const id of SOURCES) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: NONE });
    const accent = token("--accent") || "#2e7d32", line = token("--map-label") || "#ffffff";
    const add = (spec) => { if (!map.getLayer(spec.id)) map.addLayer(spec); };
    add({ id: "se-before-line", type: "line", source: "se-before", paint: { "line-color": line, "line-width": 2, "line-opacity": 0.8, "line-dasharray": [2, 2] } });
    add({ id: "se-shape-fill", type: "fill", source: "se-shape", paint: { "fill-color": accent, "fill-opacity": 0.3 } });
    add({ id: "se-shape-line", type: "line", source: "se-shape", paint: { "line-color": accent, "line-width": 3 } });
    add({ id: "se-middles", type: "circle", source: "se-middles", paint: { "circle-radius": 5, "circle-color": line, "circle-opacity": 0.85, "circle-stroke-color": accent, "circle-stroke-width": 1.5 } });
    add({ id: "se-vertices", type: "circle", source: "se-vertices", paint: { "circle-radius": ["case", ["boolean", ["get", "picked"], false], 9, 7],
      "circle-color": accent, "circle-stroke-color": line, "circle-stroke-width": 2 } });
    add({ id: "se-drag", type: "circle", source: "se-drag", paint: { "circle-radius": 9, "circle-color": accent, "circle-stroke-color": line, "circle-stroke-width": 2 } });
    add({ id: "se-snap", type: "circle", source: "se-snap", paint: { "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffeb3b", "circle-stroke-width": 3 } });
  }
  function removeLayers(map) {
    for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  }
  const setData = (id, data) => ed?.map?.getSource(id)?.setData(data || NONE);
  function draw() {
    if (!ed) return;
    const s = ed.session.state, editing = ["editing", "saving"].includes(s.status), shape = ed.editor.shape;
    // (a later version found on save: the person's unsaved edit stays drawn until they reload)
    const g = (editing || (s.status === "stale" && ed.editor.dirty)) ? ed.editor.geometry() : s.feature?.geometry;
    setData("se-shape", g ? { type: "Feature", geometry: g, properties: {} } : NONE);
    setData("se-before", ed.before && editing && ed.editor.dirty ? { type: "Feature", geometry: ed.before, properties: {} } : NONE);
    if (editing) {
      const h = B().handles(shape), p = ed.editor.picked;
      for (const v of h.vertices.features) v.properties.picked = !!p && p.join() === [v.properties.p, v.properties.r, v.properties.v].join();
      setData("se-vertices", h.vertices); setData("se-middles", h.middles);
    } else { setData("se-vertices", NONE); setData("se-middles", NONE); }
    setData("se-snap", ed.snapped ? { type: "Feature", geometry: { type: "Point", coordinates: ed.snapped.lngLat }, properties: {} } : NONE);
  }
  const hit = (e, layers) => ed.map.queryRenderedFeatures(e.point, { layers: layers.filter((id) => ed.map.getLayer(id)) });
  const whereOf = (f) => [f.properties.p, f.properties.r, f.properties.v];
  const editingNow = () => ed && ed.session.state.status === "editing";
  function onTap(e) {
    if (!editingNow() || ed.dragging) return;
    const m = hit(e, ["se-middles"])[0];
    if (m) { ed.editor.insert(whereOf(m)); say(""); refresh(); return; }
    const v = hit(e, ["se-vertices"])[0];
    ed.editor.pick(v ? whereOf(v) : null);
    refresh();
  }
  function startDrag(e) {
    if (!editingNow()) return;
    const v = hit(e, ["se-vertices"])[0];
    if (!v || (e.originalEvent?.touches && e.originalEvent.touches.length > 1)) return;
    e.preventDefault();
    ed.dragging = whereOf(v); ed.editor.begin(ed.dragging);
    ed.map.dragPan.disable(); ed.map.getCanvas().style.cursor = "grabbing";
    handlesShown(false);
  }
  // The corner follows the pointer, snapped to the nearest target within the tolerance (Alt, or the switch off: free).
  function moveDrag(e) {
    if (!ed?.dragging) return;
    const raw = e.lngLat.toArray(), free = !ed.snapOn || e.originalEvent?.altKey;
    let to = raw;
    ed.snapped = null;
    if (!free && ed.index?.size) {
      const map = ed.map, p = e.point, t = M().SNAP_PX;
      const a = map.unproject([p.x - t, p.y + t]), b = map.unproject([p.x + t, p.y - t]);
      const s = M().snap(ed.index, raw, (c) => { const q = map.project(c); return [q.x, q.y]; },
        { box: [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)] });
      if (s) { to = s.lngLat; ed.snapped = s; }
    }
    ed.editor.move(ed.dragging, to);
    drawDrag(to);
  }
  // While a corner is dragged only the shape and that corner are drawn (the other handles are hidden, and drawn again when the
  // drag ends), so a move costs one blockModel edit and the outline, never every handle again.
  function handlesShown(on) { for (const id of ["se-vertices", "se-middles"]) if (ed?.map?.getLayer(id)) ed.map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }
  function drawDrag(at) {
    const g = ed.editor.geometry();
    setData("se-shape", g ? { type: "Feature", geometry: g, properties: {} } : NONE);
    setData("se-drag", { type: "Feature", geometry: { type: "Point", coordinates: at }, properties: {} });
    setData("se-snap", ed.snapped ? { type: "Feature", geometry: { type: "Point", coordinates: ed.snapped.lngLat }, properties: {} } : NONE);
  }
  function endDrag() {
    if (!ed?.dragging) return;
    ed.dragging = null; ed.editor.end();
    ed.map.dragPan.enable(); ed.map.getCanvas().style.cursor = "";
    setData("se-drag", NONE); handlesShown(true);
    say(ed.snapped ? ed.snapped.text : "");
    ed.snapped = null;
    refresh();
  }
  const hover = (e) => { if (ed && !ed.dragging && editingNow()) ed.map.getCanvas().style.cursor = hit(e, ["se-vertices", "se-middles"]).length ? "pointer" : ""; };

  // ---- the panel -----------------------------------------------------------------------------------------------------------
  let said = "";
  const say = (t) => { said = t || ""; const m = ed?.ui?.querySelector(".se-msg"); if (m) m.textContent = said; };
  const button = (label, attrs = {}) => el("button", { type: "button", ...attrs }, label);
  const ha = (v) => (v == null ? "" : B().ha(Number(v)));
  function refresh() { draw(); render(); }
  function render() {
    if (!ed?.ui) return;
    const s = ed.session.state, E = ed.editor, ui = ed.ui;
    ui.dataset.state = s.status;
    const lead = ui.querySelector(".se-lead"), body = ui.querySelector(".se-body"), acts = ui.querySelector(".se-actions");
    body.replaceChildren(); acts.replaceChildren();
    const refusalText = s.refusal?.text || "";
    ui.querySelector(".se-msg").textContent = s.status === "editing" ? (refusalText || said) : "";
    if (s.status === "loading") { lead.textContent = "Opening the shape…"; return; }
    if (s.status === "failed" || s.status === "refused") {
      lead.textContent = s.error || refusalText;
      acts.append(button("Close", { class: "primary", "data-se": "close" }));
      return;
    }
    if (s.status === "stale") {
      lead.textContent = refusalText;
      if (E.dirty) body.append(el("p", { class: "se-hint" }, "Reloading sets your unsaved change aside."));
      acts.append(button("Reload the shape", { class: "primary", "data-se": "reload" }), button("Cancel", { class: "link", "data-se": "close" }));
      return;
    }
    if (s.status === "saved" || s.status === "restored") {
      const r = s.saved || {};
      lead.textContent = s.status === "saved" ? "Saved as version " + r.version + "." : "The earlier shape is back, saved as version " + r.version + ".";
      body.append(el("p", { class: "se-total", "data-se-total": "" }, [r.area_ha != null ? "Area " + ha(r.area_ha) : null, r.vertices != null ? r.vertices + " corners" : null].filter(Boolean).join(" · ")));
      if (r.repaired) body.append(el("p", { class: "se-hint" }, "Crossing edges were tidied as it was saved."));
      if (s.refusal?.text) body.append(el("p", { class: "se-hint", role: "alert" }, s.refusal.text));
      if (s.status === "saved") acts.append(button("Undo the save", { "data-se": "undo-save" }));
      acts.append(button("Keep editing", { "data-se": "keep" }), button("Done", { class: "primary", "data-se": "close" }));
      return;
    }
    // editing (or saving)
    const busy = s.status === "saving";
    lead.textContent = "Drag a corner to move it.";
    body.append(el("p", { class: "se-hint" }, "Tap + to add a corner. Tap a corner, then Remove corner (or press Delete)."),
      el("p", { class: "se-total", "data-se-total": "" }, E.corners + " corners · area " + ha(E.areaHa()) + (E.dirty ? " · not saved" : "")),
      el("label", { class: "se-snap" }, el("input", { type: "checkbox", name: "snap", ...(ed.snapOn ? { checked: "" } : {}) }), el("span", {}, M().snapLine(s.kinds))));
    acts.append(button(busy ? "Saving…" : "Save", { class: "primary", "data-se": "save", ...(busy || !E.dirty ? { disabled: "" } : {}) }),
      button("Undo", { "data-se": "undo", ...(E.canUndo && !busy ? {} : { disabled: "" }), "aria-keyshortcuts": "Control+Z" }),
      button("Redo", { "data-se": "redo", ...(E.canRedo && !busy ? {} : { disabled: "" }), "aria-keyshortcuts": "Control+Y" }),
      button("Remove corner", { "data-se": "remove", ...(E.picked && !busy ? {} : { disabled: "" }) }),
      button("Cancel", { class: "link", "data-se": "close" }));
  }
  async function act(what) {
    if (!ed) return;
    const E = ed.editor, S = ed.session;
    ed.closing = false;
    if (what === "close") return close();
    if (what === "undo") { if (E.undo()) say(""); return refresh(); }
    if (what === "redo") { if (E.redo()) say(""); return refresh(); }
    if (what === "remove") { const p = E.picked; if (p && !E.remove(p)) say("An area needs three corners at least."); else say(""); return refresh(); }
    if (what === "save") {
      say(""); render();
      const st = await S.save(E.geometry());
      if (!ed) return;
      if (st.status === "saved") savedShape(st);
      return refresh();
    }
    if (what === "undo-save") { const st = await S.undoSave(); if (!ed) return; if (st.status === "restored") savedShape(st); return refresh(); }
    if (what === "keep") { S.keepEditing(); E.reset(B().shapeOf(S.state.feature.geometry)); ed.before = S.state.feature.geometry; say(""); return refresh(); }
    if (what === "reload") {
      E.reset([]); render();
      const st = await S.reload();
      if (!ed) return;
      if (st.status === "editing") { E.reset(B().shapeOf(st.feature.geometry)); ed.before = st.feature.geometry; ed.index = indexOf(st); }
      return refresh();
    }
  }
  // A saved (or restored) shape is drawn in place on the map at once (the layer's own source), and stays so as the person pans.
  function savedShape(st) {
    ed.surface.patchFeature?.(ed.layerIndex, ed.id, st.feature.geometry);
    ed.host.onSaved?.(st.saved);
  }
  const indexOf = (st) => M().snapIndex(st.snaps, { skip: ed?.id });
  function onKey(e) {
    if (!ed) return;
    const t = e.target, typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== "checkbox";
    if (e.key === "Escape") { e.preventDefault(); if (ed.editor.dirty && editingNow() && !ed.closing) { ed.closing = true; say("Press Escape again to close without saving."); return; } return close(); }
    if (typing || !editingNow()) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); act("undo"); }
    else if (mod && ((e.shiftKey && e.key.toLowerCase() === "z") || e.key.toLowerCase() === "y")) { e.preventDefault(); act("redo"); }
    else if ((e.key === "Delete" || e.key === "Backspace") && ed.editor.picked) { e.preventDefault(); act("remove"); }
  }

  // ---- open and close ------------------------------------------------------------------------------------------------------
  // host: { space, owner, role, surface, boundary() -> [geometry | Feature], onSaved(result) }; target: hit.edit ({layer,
  // layerIndex, id}); at: the point tapped. Returns true when the editor opened, else the reason in plain words (said in the
  // popup by the caller); nothing is drawn or captured until the database's checks have passed.
  let opening = 0;
  async function open(host, target, { at = null, closePopup = null } = {}) {
    if (M().isPhone(wideNow())) return "Shapes are edited on a larger screen.";
    if (!fineNow()) return "Shapes are edited with a mouse or pen.";
    if (ed) close();
    const mine = ++opening, route = root.location?.hash;
    const surface = host.surface, map = surface?.glMap?.();
    if (!map || !target?.layer?.id) return "The shape couldn't be opened here.";
    const drawnF = surface.featureData?.(target.layerIndex, target.id);
    const box = drawnF ? M().bboxOf(drawnF.geometry) : null;
    const session = M().createSession({ sb: root.FP.sb, space: host.space, owner: host.owner, layer: target.layer, id: target.id, box, at,
      boundary: typeof host.boundary === "function" ? host.boundary() : [] });
    const st = await session.open();
    // the reads take a moment: if the person went to another view, or another shape was opened, or the map went, nothing opens
    if (mine !== opening || root.location?.hash !== route || !map.getContainer()?.isConnected || !map.getStyle?.()) return null;
    if (st.status !== "editing") return st.refusal?.text || st.error || "The shape couldn't be opened.";
    if (ed) close();
    closePopup?.();
    const editor = M().createEditor(B().shapeOf(st.feature.geometry));
    ed = { surface, map, session, editor, host, layerIndex: target.layerIndex, id: target.id, before: st.feature.geometry, index: null, dragging: null, snapped: null, snapOn: true, closing: false };
    ed.index = indexOf(st);
    said = "";
    const name = String(target.layer.name || "").trim();
    ed.ui = el("section", { id: "shape-editor", class: "shape-editor", role: "dialog", "aria-modal": "false", "aria-labelledby": "shape-editor-title", "data-state": "editing" },
      el("header", { class: "se-head" }, el("h2", { id: "shape-editor-title" }, "Edit shape"), el("span", { class: "se-layer" }, [name, st.feature.properties?.name].filter(Boolean).join(" · "))),
      el("p", { class: "se-lead", tabindex: "-1" }), el("div", { class: "se-body" }), el("p", { class: "se-msg", role: "status", "aria-live": "polite" }), el("div", { class: "se-actions" }));
    ed.ui.addEventListener("click", (e) => { const b = e.target.closest("[data-se]"); if (b && !b.disabled) act(b.dataset.se); });
    ed.ui.addEventListener("change", (e) => { if (e.target.name === "snap") { ed.snapOn = !!e.target.checked; } });
    document.addEventListener("keydown", onKey, true);
    map.getContainer().append(ed.ui);
    document.body.classList.add("shape-editor-active");
    addLayers(map);
    surface.capture?.(onTap);
    map.on("mousedown", "se-vertices", startDrag);
    map.on("mousemove", moveDrag); map.on("mouseup", endDrag); map.on("mousemove", hover);
    map.once("remove", close);
    refresh();
    ed.ui.querySelector(".se-lead").focus({ preventScroll: true });
    return true;
  }
  // Close: nothing that wasn't saved is written; the map is given back as it was (a saved shape stays drawn).
  function close() {
    opening++;   // an open still reading gives way
    if (!ed) return;
    const { map, surface, ui } = ed;
    ed = null; said = "";
    document.removeEventListener("keydown", onKey, true);
    try {
      map.off("mousedown", "se-vertices", startDrag);
      map.off("mousemove", moveDrag); map.off("mouseup", endDrag); map.off("mousemove", hover); map.off("remove", close);
      map.dragPan.enable(); map.getCanvas().style.cursor = "";
      removeLayers(map);
    } catch {}
    surface.capture?.(null);
    ui?.remove();
    document.body.classList.remove("shape-editor-active");
  }

  root.FP = root.FP || {};
  root.FP.shapeEditor = { tools, open, close, trialOn, setTrial, trialsPanel, wireTrials, TRIAL_KEY, get open_() { return !!ed; }, state: () => (ed ? { status: ed.session.state.status, shape: ed.editor.shape, said, snapped: ed.snapped?.text || null, corners: ed.editor.corners, dirty: ed.editor.dirty, picked: ed.editor.picked, canUndo: ed.editor.canUndo, canRedo: ed.editor.canRedo, version: ed.session.state.version, kinds: ed.session.state.kinds, writes: ed.session.writes.length } : null) };
})(typeof window === "undefined" ? globalThis : window);
