// FEP1, FEP2: a farm's Plan page (#/farm/<id>/plan) and its row on the farm's Home. What the plan said, as at its date, read only. The
// words and the rules are farm-plan-model.js; this file reads and draws.
//
// FEP2 (the owner, 19 Nov 2026): the actions first, one row each (a small mark for the plan's progress word, the action in the plan's
// words, its land unit and By when at the right), grouped by topic with a sort by land unit or By when; a tap opens the row in place
// (its progress and By when as the plan wrote them, its comment, its plan page) and lights its land unit on the map. Then the ratings in
// one small table (land units down, the risks across, one dot each: green Low, orange Medium, red High); a risk's heading shades the
// land units on the map by it, with a key that is there only then, and Runoff or Erosion eases the map into 3D. One quiet line at the
// foot. A computer has the list and the map side by side (the map stays in view); a phone has the list, under a short strip of the
// map that opens to full size. Still read only: an action row is a place its state could later change (FEP3), and the + stays.
//
// Who: RCL staff, a coordinator (facilitator, advisor, admin) of a catchment group the farm is actively associated with (HV1), and
// (FEP2) the farm's own people; decided here, in the app, by who the person is, before anything of the plan is read. The database has
// always let a farm's own people read these rows (app.can_view); no policy was changed for FEP2.
//
// Reads (as the signed-in person; row-level security decides what comes back; nothing is written):
//   farm_group_associations  org_id, status: this farm's active associations, only for a person who coordinates a group (at most 50)
//   risks, actions, activities  a head count each, for the Home row
//   the page, in one wave: land_units (the view: id, code, name, description, area_ha), activities, risks, actions (never their
//   status or due date), action_places, action_risks, and the farm's plan files (documents of a plan type), each by farm_id and capped
//   (farm-plan-model.js CAPS: one more row than the cap is asked for, so the page can say when a farm has more)
//   the map, after the list is drawn: farm_map (the read the farm's own map makes): its boundary and land units only are drawn, on the
//   app's map scene (blocks/map-scene.js engine), in a box of its own that is removed with the page
(function (root) {
  const FP = root.FP;
  const P = () => FP.farmPlanModel;
  const el = (...a) => FP.el(...a);
  let shown = null;   // the page drawn now: { alive, host, surface }

  // ---- who ------------------------------------------------------------------------------------------------------------------------
  // who: a promise of { role (the person's farm role, or null), staff, groups (the person's catchment groups with their role) }.
  // Fails closed: a who that could not be worked out (the farm-role read failed: "no role" and "couldn't read" are never the same), or
  // an association read that failed, THROWS ("couldn't be read just now"); null means this person may not see the page.
  async function audienceFor(sb, farm, who) {
    const w = await Promise.resolve(who);
    if (!w) throw new Error("who the person is could not be read");
    if (w.staff === true) return "staff";
    if (w.role) return "farm";   // FEP2: one of the farm's own people
    // (the staff flag not read: a "no" here is not certain, since the person may be RCL staff; so it is "couldn't be read")
    const no = () => { if (w.staffKnown === false) throw new Error("the staff flag could not be read"); return null; };
    if (!P().coordinatedGroupIds(w.groups).size) return no();   // coordinates no group: nothing is read
    const r = await Promise.resolve(sb.from("farm_group_associations").select("org_id,status").eq("farm_id", farm.id).eq("status", "active").limit(50));
    if (!r || r.error) throw r?.error || new Error("the farm's groups could not be read");
    return P().audience({ staff: false, farmRole: null, groups: w.groups, associations: r.data || [] }) || no();
  }
  // (a head read's count; the demo's stand-in gives it as the API does)
  const headCount = (q) => Promise.resolve(q).then((r) => (r?.error ? null : Number.isInteger(r?.count) ? r.count : Array.isArray(r?.data) ? r.data.length : null), () => null);
  // Whether the farm has plan records the person can read: ratings, actions or land-unit uses
  async function hasRecords(sb, farmId) {
    const n = await Promise.all(["risks", "actions", "activities"].map((t) => headCount(sb.from(t).select("id", { count: "exact", head: true }).eq("farm_id", farmId))));
    return n.some((x) => Number(x) > 0);
  }
  // The row on the farm's Home, beside Maps and Files: a promise of the row, or null (not this person, or no plan records)
  async function homeRow(farm, { sb = FP.sb, who } = {}) {
    try {
      if (!(await audienceFor(sb, farm, who))) return null;
      if (!(await hasRecords(sb, farm.id))) return null;
      return { key: "plan", label: P().WORDS.rowLabel, line: P().WORDS.rowLine, icon: "plan", href: FP.href(FP.farmModel.href(farm.id, "plan")), after: "documents" };
    } catch { return null; }
  }

  // ---- the reads ------------------------------------------------------------------------------------------------------------------
  // Each capped read asks for one row more than its cap: more back means the farm has more, and only the cap is used.
  function capped(query, cap) {
    return Promise.resolve(query.limit(cap + 1)).then((r) => {
      if (r?.error) throw r.error;
      const rows = Array.isArray(r?.data) ? r.data : [];
      return { rows: rows.slice(0, cap), more: rows.length > cap };
    });
  }
  const soft = (p) => p.catch(() => ({ rows: [], more: false }));
  function readPlan(sb, farmId) {
    const C = P().CAPS, by = (t, cols) => sb.from(t).select(cols).eq("farm_id", farmId);
    const reads = {
      landUnits: capped(by("land_units", "id,code,name,description,area_ha").order("code"), C.landUnits),
      activities: capped(by("activities", "id,place_id,name,description"), C.activities),
      risks: capped(by("risks", "id,place_id,activity_id,pathway,contaminants,description"), C.risks),
      actions: capped(by("actions", "id,title,description,rationale,place_id,source_document_id,source_page"), C.actions),
      // the links and the plan file are a help, not the page: if they can't be read, the page still says what the plan said
      actionPlaces: soft(capped(by("action_places", "action_id,place_id"), C.actionPlaces)),
      actionRisks: soft(capped(by("action_risks", "action_id,risk_id"), C.actionRisks)),
      files: soft(capped(by("documents", "id,title,original_name,doc_type,date_prepared,storage_path,status").in("doc_type", P().PLAN_TYPES), C.files)),
    };
    const keys = Object.keys(reads);
    return Promise.all(keys.map((k) => reads[k])).then((got) => {
      const out = { capped: {} };
      keys.forEach((k, i) => { out[k] = got[i].rows; if (got[i].more) out.capped[k] = true; });
      return out;
    });
  }
  // FEP2: the farm's map (farm_map, a read), or null when it can't be read (the page is the list without its map)
  const readMap = (sb, farmId) => Promise.resolve(sb.rpc("farm_map", { f: farmId })).then((r) => (r?.error ? null : r?.data || null), () => null);

  // ---- opening the plan file ------------------------------------------------------------------------------------------------------
  // As Files opens a file (FL2): inside the app, read with the person's sign-in, never at a signed storage link; at a page where one is
  // given (the PDF viewer's #page=, on the file's own blob: address)
  function openFile(sb, file, page, button) {
    if (!file?.path) return;
    FP.fileView.open({ sb, path: file.path, name: file.name, page: Number.isInteger(page) && page > 0 ? page : null, opener: button });
  }

  // ---- drawing the list -----------------------------------------------------------------------------------------------------------
  const W = () => P().WORDS;
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the progress mark: the plan's word, in a small circle (empty, half, full); the word itself for a screen reader
  function mark(word) {
    const k = P().progressMark(word);
    return el("span", { class: "fp-mark", "data-mark": k || "none", "aria-hidden": "true" });
  }
  function detail(me, a, id) {
    const words = a.said === "read"
      ? [a.progress != null ? el("p", {}, el("span", { class: "fp-label" }, P().progressLabel + ": "), el("span", { "data-plan-words": "progress" }, a.progress)) : null,
        a.byWhen != null ? el("p", {}, el("span", { class: "fp-label" }, "By when: "), el("span", { "data-plan-words": "by-when" }, a.byWhen)) : null]
      : [el("p", { "data-said": a.said }, a.said === "none" ? W().noWords : W().seePlan)];
    const units = a.landUnits.map((u) => [u.code, u.name].filter(Boolean).join(" · "));
    const page = me.file?.path && a.page ? el("button", { type: "button", class: "fp-link", "data-pdf-page": String(a.page), onclick: (e) => openFile(me.sb, me.file, a.page, e.currentTarget) }, "Plan page " + a.page)
      : a.page ? el("p", {}, el("span", { class: "fp-label" }, "In the plan: "), "page " + a.page) : null;
    return el("div", { class: "fp-detail", id, hidden: true },
      ...words,
      units.length ? el("p", {}, el("span", { class: "fp-label" }, units.length === 1 ? "Land unit: " : "Land units: "), units.join(", ")) : null,
      a.risks.length ? el("p", {}, el("span", { class: "fp-label" }, "For the rating: "), a.risks.join("; ")) : null,
      a.comment ? el("p", {}, el("span", { class: "fp-label" }, "Comment in the plan: "), el("span", { "data-plan-words": "comment" }, a.comment)) : null,
      page);
  }
  // One action: one row (a button that opens its detail in place); the li is where its state could later change (FEP3)
  function actionRow(me, a, n) {
    const meta = P().rowMeta(a), id = "fp-d-" + n, k = P().progressMark(a.progress);
    const said = [k ? P().MARK_WORDS[k] + " at the plan date" : null, meta.units ? "land unit " + meta.units : null, meta.byWhen ? "by when " + meta.byWhen : null].filter(Boolean).join(", ");
    const row = el("button", { type: "button", class: "fp-act-row", "aria-expanded": "false", "aria-controls": id, onclick: () => choose(me, a, li) },
      mark(a.progress),
      el("span", { class: "fp-act-title", "data-plan-words": "title" }, a.title),
      el("span", { class: "fp-act-meta", "aria-hidden": "true" }, [meta.units, meta.byWhen].filter(Boolean).join(" · ")),
      said ? el("span", { class: "visually-hidden" }, " (" + said + ")") : null);
    const li = el("li", { class: "fp-act", "data-action": a.id || "" }, row, detail(me, a, id));
    return li;
  }
  // A row chosen: its detail opens (any other closes) and its land unit is lit on the map; chosen again, it closes
  function choose(me, a, li) {
    const was = li.classList.contains("open");
    for (const x of me.list.querySelectorAll(".fp-act.open")) { x.classList.remove("open"); x.querySelector(".fp-act-row").setAttribute("aria-expanded", "false"); x.querySelector(".fp-detail").hidden = true; }
    if (!was) { li.classList.add("open"); li.querySelector(".fp-act-row").setAttribute("aria-expanded", "true"); li.querySelector(".fp-detail").hidden = false; }
    me.unit = !was ? a.landUnits[0]?.id || null : null;
    me.map?.light();
  }
  function drawActions(me) {
    const groups = P().arrange(me.m, me.sort);
    let n = 0;
    me.list.replaceChildren(...groups.map((g) => el("div", { class: "fp-group" },
      g.title && groups.length > 1 || (g.title && me.sort !== "topic") ? el("h3", {}, g.title) : null,
      el("ul", { class: "fp-acts" }, ...g.items.map((a) => actionRow(me, a, n++))))));
    me.unit = null; me.map?.light();
  }
  function sortControl(me) {
    const box = el("div", { class: "fp-seg", role: "group", "aria-label": W().sortLabel });
    for (const [key, label] of P().SORTS) box.append(el("button", { type: "button", "data-sort": key, "aria-pressed": String(key === me.sort), onclick: () => {
      if (me.sort === key) return;
      me.sort = key;
      for (const b of box.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.sort === key));
      drawActions(me);
    } }, label));
    return box;
  }
  // The ratings table: land units down (with the one-line use under each), the risks across; a heading shades the map by its risk
  function ratingsTable(me) {
    const t = me.table, said = el("p", { class: "fp-said", role: "status" });
    const dot = (row, c, cell) => {
      const where = [row.code, row.name].filter(Boolean).join(" · ");
      const word = cell.state === "rated" ? cell.word : cell.state === "unread" ? W().unreadCell : W().noneCell;
      const label = c.name + " on " + where + ": " + word;
      if (cell.state === "none") return el("span", { class: "fp-dot", "data-level": "none", "aria-hidden": "true" });
      return el("button", { type: "button", class: "fp-dot", "data-level": cell.level || (cell.state === "rated" ? "word" : "unread"), title: word, "aria-label": label,
        onclick: () => { said.textContent = label + (cell.state === "rated" ? ", as the plan's author rated the land." : "."); } },
        cell.state === "rated" && !cell.level ? el("span", { class: "fp-dot-word" }, cell.word) : cell.state === "unread" ? el("span", { class: "fp-dot-word" }, "–") : null);
    };
    const head = el("tr", {}, el("th", { scope: "col", class: "fp-th-unit" }, "Land unit"),
      ...t.columns.map((c) => el("th", { scope: "col" }, el("button", { type: "button", class: "fp-risk", "data-risk": c.key, "aria-pressed": "false", title: c.name + ": shade the map by it",
        onclick: () => chooseRisk(me, c.key) }, el("span", { class: "fp-risk-name" }, c.head)))));
    const body = t.rows.map((r) => el("tr", { "data-land-unit": r.id || "" },
      el("th", { scope: "row", class: "fp-th-unit" }, el("b", {}, [r.code, r.name].filter(Boolean).join(" · ")),
        // (the use, as the plan said it, on one line; whole in the folded list below)
        r.uses.length ? el("small", { title: r.uses.map((u) => u.text).join("; ") }, r.uses.map((u) => u.text).join("; ")) : null),
      ...(r.rated ? r.cells.map((cell, i) => el("td", {}, dot(r, t.columns[i], cell)))
        : [el("td", { colspan: String(Math.max(1, t.columns.length)), class: "fp-td-none" }, W().noRatingsRow)])));
    const unread = t.rows.some((r) => r.cells.some((c) => c.state === "unread"));
    return [el("div", { class: "fp-table-wrap" }, el("table", { class: "fp-table" }, el("caption", { class: "visually-hidden" }, W().ratingsHead), el("thead", {}, head), el("tbody", {}, ...body))),
      unread ? el("p", { class: "fp-quiet" }, "– " + W().unreadCell + ".") : null, said];
  }
  // What the farm already does, where the plan held it: each land unit's use in the plan's words, with its mapped area, folded away
  function usesList(me) {
    const units = me.m.landUnits.filter((u) => u.uses.length);
    if (!units.length) return null;
    return el("details", { class: "fp-uses" }, el("summary", {}, W().usesHead),
      el("ul", {}, ...units.map((u) => el("li", {}, el("b", {}, [u.code, u.name].filter(Boolean).join(" · ") + ": "),
        el("span", { "data-plan-words": "use" }, u.uses.map((w) => w.text).join("; ")), u.area ? el("span", { class: "fp-label" }, " (" + P().areaText(u.area) + ")") : null))));
  }
  function chooseRisk(me, key) {
    me.risk = me.risk === key ? null : key;
    for (const b of me.article.querySelectorAll(".fp-risk")) b.setAttribute("aria-pressed", String(b.dataset.risk === me.risk));
    me.map?.shade();
    // Runoff and Erosion are about slope: the map eases into 3D; any other choice leaves the view as the person had it
    if (me.risk && /^(?:runoff|erosion)$/.test(me.risk)) me.map?.view3d(true);
  }

  function draw(host, me) {
    const { farm, m } = me;
    me.sort = "topic"; me.risk = null; me.unit = null;
    me.table = P().table(m);
    me.facts = el("p", { class: "fp-facts" }, P().factsLine({ landUnits: m.landUnits.length, dateText: m.dateText }));
    const head = el("header", { class: "fp-head" },
      el("h1", { id: "fp-title" }, farm.name),
      me.facts,
      m.file?.path ? el("button", { type: "button", class: "fp-open", onclick: (e) => openFile(me.sb, m.file, null, e.currentTarget) }, FP.icon("plan", 18), el("span", {}, W().openPlan))
        : m.file ? el("p", { class: "fp-quiet" }, m.file.name) : null);
    const cap = P().cappedLine(m.capped);
    me.list = el("div", { class: "fp-groups" });
    const listCol = el("div", { class: "fp-listcol" }, head,
      cap ? el("p", { class: "fp-note fp-capped", role: "note" }, cap) : null,
      m.items.length ? el("section", { class: "fp-section", "aria-labelledby": "fp-actions" },
        el("div", { class: "fp-section-head" }, el("h2", { id: "fp-actions" }, W().actionsHead), m.items.length > 1 ? sortControl(me) : null), me.list) : null,
      me.table.rows.length ? el("section", { class: "fp-section", "aria-labelledby": "fp-ratings" }, el("h2", { id: "fp-ratings" }, W().ratingsHead), ...ratingsTable(me), usesList(me)) : null,
      el("p", { class: "fp-foot" }, P().footLine(m.dateText)));
    const mapBox = el("div", { class: "fp-mapbox" }), clip = el("div", { class: "fp-mapclip" }, mapBox);
    const toggle = el("button", { type: "button", class: "fp-map-toggle", "aria-expanded": "false", onclick: () => me.map?.openFull(!me.mapCol.classList.contains("open")) }, W().mapOpen);
    me.mapCol = el("div", { class: "fp-mapcol", "data-map": "loading", role: "region", "aria-label": "Map of the plan's land units" }, clip, toggle);
    me.mapBox = mapBox; me.toggle = toggle;
    me.article = el("article", { class: "farm-plan", "aria-labelledby": "fp-title" }, me.mapCol, listCol);
    host.replaceChildren(me.article);
    drawActions(me);
  }
  function message(host, farm, text) {
    host.replaceChildren(el("article", { class: "farm-plan farm-plan-message" },
      el("div", { class: "fp-listcol" }, el("header", { class: "fp-head" }, el("h1", {}, farm.name), el("p", { class: "fp-asat", role: "status" }, text)))));
  }

  // ---- the map ----------------------------------------------------------------------------------------------------------------------
  // The app's map scene (blocks/map-scene.js) in the page's own box: the farm's boundary (the outside dimmed) and its land units with
  // their names, on the aerial. Over it, this page's two layers: the land units shaded by the risk chosen, and the land unit of the
  // action chosen, outlined. The box never changes size: on a phone the strip is a window onto the full-size map, and opening it
  // widens the window (the map moves, eased, to frame the farm in what shows). Everything goes with the page (close: surface.remove).
  const NONE = { type: "FeatureCollection", features: [] };
  // (this page's moves are measured from the middle of the box: the engine's own frame may have left a padding on the camera)
  const ZERO = { top: 0, bottom: 0, left: 0, right: 0 };
  const token =(n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function bboxOf(geom) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const walk = (c) => { if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
    if (geom?.coordinates) walk(geom.coordinates);
    return Number.isFinite(w) ? [[w, s], [e, n]] : null;
  }
  async function drawMap(me) {
    const col = me.mapCol, say = (s, text) => { col.dataset.map = s; if (text) col.append(el("p", { class: "fp-map-note" }, text)); };
    if (typeof root.maplibregl === "undefined" || !FP.mapScene?.engine) { say("unavailable", W().mapUnavailable); return; }
    const data = await readMap(me.sb, me.farm.id);
    if (!live(me)) return;
    if (!data?.extent) { say("failed", W().mapFailed); return; }
    if (Number.isFinite(Number(data.extent_ha))) me.facts.textContent = P().factsLine({ areaHa: Number(data.extent_ha), landUnits: me.m.landUnits.length, dateText: me.m.dateText });
    const units = data.land_units?.features ? data.land_units : NONE;
    const matched = P().mapUnits(me.m.landUnits, units.features);
    // only the boundary and the land units: the plan's map, calm (the farm's other layers are on its Maps)
    const scene = { farm: data.farm || { id: me.farm.id, name: me.farm.name }, extent: data.extent, extent_ha: data.extent_ha ?? null, extent_label: "Farm boundary",
      titles: NONE, land_units: units, reference: [], sources: [], styles: Array.isArray(data.styles) ? data.styles : [],
      layers: units.features.length ? [{ id: "fp-plan-units", name: "Land units", theme: "land_units", geometry_type: "polygon", features: units }] : [] };
    const surface = FP.mapScene.engine(me.mapBox);
    me.surface = surface;
    let opened = null;
    // (the camera on the farm at once, its outline sketched until the map paints its own: no flight in from all of New Zealand)
    try { surface.sketch?.(data.extent); opened = await surface.open(me.farm.id, scene, { show: ["extent", "land_units"] }); } catch { opened = null; }
    if (!live(me) || me.surface !== surface) { try { surface.remove(); } catch { /* gone */ } return; }
    if (!opened) { dropMap(me); say("failed", W().mapFailed); return; }
    const gl = surface.glMap();
    const byUnit = new Map([...matched].map(([id, f]) => [id, f]));
    const features = [...byUnit].map(([id, f]) => ({ type: "Feature", geometry: f.geometry, properties: { fp_id: id, fp_level: "" } }));
    gl.addSource("fp-plan", { type: "geojson", data: { type: "FeatureCollection", features } });
    const colours = () => ({ low: token("--plan-low"), medium: token("--plan-medium"), high: token("--plan-high"), none: token("--plan-none"), noneLine: token("--plan-none-line"), line: token("--map-label"), halo: token("--map-halo") });
    const c = colours();
    // a land unit with no rating read for the chosen risk: a plain neutral grey with a thin outline, never a colour of the scale
    gl.addLayer({ id: "fp-plan-shade", type: "fill", source: "fp-plan", paint: { "fill-color": ["match", ["get", "fp_level"], "low", c.low, "medium", c.medium, "high", c.high, c.none],
      "fill-opacity": 0, "fill-opacity-transition": { duration: reduced() ? 0 : 400, delay: 0 } } });
    gl.addLayer({ id: "fp-plan-none-line", type: "line", source: "fp-plan", filter: ["==", ["get", "fp_level"], "none"], paint: { "line-color": c.noneLine, "line-width": 1.5, "line-dasharray": [2, 1.5] } });
    gl.addLayer({ id: "fp-plan-chosen-casing", type: "line", source: "fp-plan", filter: ["==", ["get", "fp_id"], ""], paint: { "line-color": c.halo, "line-opacity": 0.6, "line-width": 6 } });
    gl.addLayer({ id: "fp-plan-chosen", type: "line", source: "fp-plan", filter: ["==", ["get", "fp_id"], ""], paint: { "line-color": c.line, "line-width": 3 } });
    // the key, there only while a risk is chosen; the 2D / 3D switch, always
    // (over the map's window, not its canvas: on a phone's strip the canvas reaches past what shows)
    const key = el("div", { class: "fp-key", hidden: true });
    const seg = el("div", { class: "fp-seg fp-seg-map", role: "group", "aria-label": "Map view" },
      el("button", { type: "button", "data-view": "2d", "aria-pressed": "true", onclick: () => view3d(false) }, "2D"),
      el("button", { type: "button", "data-view": "3d", "aria-pressed": "false", onclick: () => view3d(true) }, "3D"));
    col.append(seg, key);
    const markSeg = (on) => { for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String((b.dataset.view === "3d") === on)); };
    const ms = () => (reduced() ? 0 : 900);
    function view3d(on) {
      if (!live(me)) return;
      markSeg(on);
      const was = gl.getPitch() > 1;
      // (the hills as the person had them before 3D: back off when the map is laid flat again, if they were off)
      if (on && !was) me.hillsBefore = !!gl.getTerrain?.();
      if (on) surface.terrain(true);
      else if (was && me.hillsBefore === false) surface.terrain(false);
      // (about the same place, tilted or flat: what the person framed stays in the middle of what shows, a little further off when tilted)
      gl.easeTo({ pitch: on ? 60 : 0, bearing: on ? (gl.getBearing() || -12) : 0, zoom: gl.getZoom() + (on === was ? 0 : on ? -0.6 : 0.6), padding: ZERO, duration: ms() });
    }
    // what part of the box shows (a phone's strip: a band across its middle), as padding for a frame
    const STRIP = () => parseFloat(getComputedStyle(col).getPropertyValue("--fp-strip")) || 0;
    function shownPadding(full) {
      const h = me.mapBox.clientHeight, base = { top: 48, bottom: 48, left: 32, right: 32 };
      const strip = !full && col.classList.contains("strip") ? STRIP() : 0;
      if (!strip || strip >= h) return base;
      const off = (h - strip) / 2;
      return { top: off + 4, bottom: off + 4, left: 12, right: 12, strip: true };
    }
    // (the owner's look round: on a phone's strip the farm fills the strip's width; a farm taller than the strip's shape is framed on
    // its middle band, and the rest shows when the map is opened)
    function stripBounds(bounds, pad) {
      const [[w, s], [e, n]] = bounds, width = me.mapBox.clientWidth - pad.left - pad.right, height = me.mapBox.clientHeight - pad.top - pad.bottom;
      if (width <= 0 || height <= 0) return bounds;
      const mid = (s + n) / 2, want = (e - w) * Math.cos((mid * Math.PI) / 180) * (height / width);
      return n - s > want ? [[w, mid - want / 2], [e, mid + want / 2]] : bounds;
    }
    function frame(bounds, full) {
      if (!bounds) return;
      const { strip, ...padding } = shownPadding(full);
      const cam = gl.cameraForBounds(strip ? stripBounds(bounds, padding) : bounds, { padding, maxZoom: 17 });
      // (tilted, the near side of the farm is drawn larger: a little further off, so the whole of it shows)
      if (cam) gl.easeTo({ center: cam.center, zoom: cam.zoom - (gl.getPitch() > 1 ? 0.6 : 0), pitch: gl.getPitch(), bearing: gl.getBearing(), padding: ZERO, duration: ms() });
    }
    const farmBounds = bboxOf(data.extent);
    me.map = {
      // the action's land unit outlined; brought into what shows when it is out of it (the zoom is kept)
      light() {
        const id = me.unit && byUnit.has(me.unit) ? me.unit : "";
        for (const l of ["fp-plan-chosen-casing", "fp-plan-chosen"]) gl.setFilter(l, ["==", ["get", "fp_id"], id]);
        if (!id) return;
        const b = bboxOf(byUnit.get(id).geometry), mid = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
        const p = gl.project(mid), pad = shownPadding(col.classList.contains("open")), w = me.mapBox.clientWidth, h = me.mapBox.clientHeight;
        if (p.x < pad.left || p.x > w - pad.right || p.y < pad.top || p.y > h - pad.bottom) gl.easeTo({ center: mid, padding: ZERO, duration: ms() });
      },
      shade() {
        const levels = P().shading(me.table, me.risk);
        // a land unit the plan's rating can't colour is shown as not rated (neutral grey, dashed edge): never a guess
        gl.getSource("fp-plan")?.setData({ type: "FeatureCollection", features: features.map((f) => ({ ...f, properties: { ...f.properties, fp_level: me.risk ? levels[f.properties.fp_id] || "none" : "" } })) });
        gl.setPaintProperty("fp-plan-shade", "fill-opacity", me.risk ? ["case", ["==", ["get", "fp_level"], "none"], 0.8, 0.55] : 0);
        const colName = me.table.columns.find((x) => x.key === me.risk)?.name;
        key.hidden = !me.risk;
        if (me.risk) key.replaceChildren(el("b", {}, W().keyLine(colName)),
          ...["low", "medium", "high"].map((k) => el("span", { class: "fp-key-item" }, el("span", { class: "fp-dot", "data-level": k, "aria-hidden": "true" }), P().LEVEL_WORDS[k])),
          el("small", { class: "fp-key-item" }, el("span", { class: "fp-dot", "data-level": "unrated", "aria-hidden": "true" }), W().keyNone));
      },
      view3d,
      // a phone: the strip opens to the full map (or back), and the farm is framed in what shows
      openFull(on) {
        col.classList.toggle("open", on);
        me.toggle.setAttribute("aria-expanded", String(on)); me.toggle.textContent = on ? W().mapClose : W().mapOpen;
        frame(farmBounds, on);
      },
    };
    col.dataset.map = "drawn";
    // (the farm framed into what shows: on a phone, the strip's band)
    if (col.classList.contains("strip")) frame(farmBounds, false);
    if (me.unit) me.map.light();
    if (me.risk) me.map.shade();
  }
  function dropMap(me) {
    const s = me.surface;
    me.surface = null; me.map = null;
    if (s) { try { s.closePopup?.(); } catch { /* gone */ } try { s.remove(); } catch { /* gone */ } }
  }
  const live = (me) => me.alive && shown === me;

  // host: the screen; opts: { farm, sb, who (as homeRow) }
  async function open(host, { farm, sb = FP.sb, who } = {}) {
    close();
    const me = { alive: true, host, farm, sb, surface: null, map: null };
    shown = me;
    message(host, farm, W().loading);
    host.scrollTop = 0;
    let rows;
    try {
      if (!(await audienceFor(sb, farm, who))) { if (live(me)) message(host, farm, W().notYours); return; }
      rows = await readPlan(sb, farm.id);
    } catch { if (live(me)) message(host, farm, W().failed); return; }
    if (!live(me)) return;
    const m = P().build(rows);
    if (m.empty) { message(host, farm, W().none); return; }
    me.m = m; me.file = m.file;
    draw(host, me);
    // a phone: the map is a strip over the list (a computer: the column beside it)
    me.mapCol.classList.toggle("strip", root.innerWidth <= 800);
    return drawMap(me).catch(() => { if (live(me)) { dropMap(me); me.mapCol.dataset.map = "failed"; } });
  }
  // (and nothing of a plan stays in the hidden page once it is left; the map goes with its listeners and its WebGL context)
  function close() { if (shown) { shown.alive = false; dropMap(shown); shown.host?.replaceChildren(); } shown = null; }

  // (for the browser walk: what the page has chosen, and the map's camera and the land unit outlined on it)
  function state() {
    const me = shown, gl = me?.map && me.surface?.glMap?.();
    return me ? { sort: me.sort, unit: me.unit, risk: me.risk, map: me.mapCol?.dataset.map || null, camera: me.surface?.camera?.() || null,
      outlined: gl?.getLayer("fp-plan-chosen") ? gl.getFilter("fp-plan-chosen")?.[2] || null : null, open: !!me.mapCol?.classList.contains("open") } : null;
  }
  FP.farmPlan = { open, close, homeRow, audienceFor, readPlan, readMap, hasRecords, state };
})(typeof window === "undefined" ? globalThis : window);
