// Operations > Layers as a registry (OPS2a): every layer the platform keeps a record of, one row each, from what is already
// stored. No DOM, network or clock (the time is passed in). The page is js/ops-layers-console.js; it is loaded on first use by
// js/ops-layers.js for RCL staff on #/ops/layers.
// Four catalogues, one row each: reference sources (reference_sources, features held in the database and refreshed from a public
// service), context layers (core_layers, tiles offered on every map), group shared layers (group_shared_layers, a group's tiles its
// member farms read) and owned layers (map_layers, a group's or a farm's layer loaded from QGIS). Every value is a stored column or
// worked out from stored rows; a value that is not stored is left out, never guessed (docs: _claude look round OPS2, notes (i)).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(root, node ? require("./layer-notes-model.js") : null);
  if (node) module.exports = api; else root.FP.layerRegistry = api;
})(typeof window === "undefined" ? globalThis : window, function (root, notesModel) {
  const N = () => notesModel || root.FP?.layerNotes;
  const list = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const int = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  // The workflows that run on a timer (a `schedule:` in .github/workflows). A data job whose workflow has none is run by hand: it is
  // "off", never late or failing, whatever its cadence says (CONTEXT decision 9 switched the data timers off; ops_jobs still holds
  // their cadence). tests/app/ops2a-registry.test.cjs keeps this list in step with the workflow files.
  const TIMED_WORKFLOWS = ["addresses-monthly.yml", "auto-merge.yml"];

  // A data job's state, from its ops_job_status row: none (no job), off (switched off, or its workflow has no timer), or the view's
  // own health when it is on: failing, late, never_run, ok. Off wins: a job nobody expects to run is never late or failing.
  function jobState(j, timed = TIMED_WORKFLOWS) {
    if (!j || typeof j !== "object") return "none";
    if (j.enabled === false) return "off";
    // no workflow recorded: nothing is known to run it, so it is off (its view's health is kept as a fact, never shown as its state)
    if (typeof j.workflow !== "string" || !j.workflow || !list(timed).includes(j.workflow)) return "off";
    return ["failing", "late", "never_run", "ok"].includes(j.health) ? j.health : "ok";
  }

  const CAT_WORD = { ref: "reference", core: "tiles", group: "group", own: "own" };
  const CAT_NAME = { ref: "Reference sources (reference_sources)", core: "Context layers (core_layers)", group: "Group shared layers (group_shared_layers)", own: "Owned layers (map_layers)" };
  const JOB_WORD = { none: "no job", off: "off", failing: "failing", late: "late", never_run: "never run", ok: "ok" };
  const LOOK_WORD = { reviewed: "reviewed", theme: "theme default", proposed: "proposed", none: "none", own: "its own style" };
  const RESULT_WORD = { updated: "updated", unchanged: "unchanged", failed: "failed", running: "running", loaded: "loaded" };
  // The mark at the start of a row: the first that holds.
  const STATUS = ["failing", "late", "loadfailed", "never", "unknown", "off", "manual", "ok"];
  const STATUS_WORD = { failing: "Job failing", late: "Job late", loadfailed: "Last load failed", never: "Never loaded", unknown: "Not known: a read failed", off: "Job off: no timer, run by hand",
    manual: "Loaded by hand: no job", ok: "OK" };
  const GEOMS = ["point", "line", "polygon"];

  // "2026-11-13" in New Zealand time, from a timestamp or a date (a date is kept as it is).
  function day(ts) {
    if (typeof ts !== "string" || !ts) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) return null;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return p.year + "-" + p.month + "-" + p.day;
  }
  const num = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-NZ"));

  // A reference source's layer id at its service: the WFS layer (layer-50772), else the trailing MapServer/45 or FeatureServer/1.
  function layerIdOf(s) {
    if (str(s?.service_layer)) return s.service_layer.trim();
    const m = /\/((?:Map|Feature)Server\/\d+)\/?$/i.exec(String(s?.service_url || ""));
    return m ? m[1] : null;
  }
  // A context layer's geometry from its MapLibre layer types (fill: polygon, line: line, circle: point; labels say nothing).
  function geomOfStyle(layers) {
    const types = list(layers).map((l) => obj(l).type);
    return types.includes("fill") ? "polygon" : types.includes("line") ? "line" : types.includes("circle") ? "point" : null;
  }
  const geomOf = (v) => (GEOMS.includes(v) ? v : v === "multipolygon" ? "polygon" : null);

  // Which look applies, from the layer_styles rows read (in force: never superseded): a reviewed record for the layer or source,
  // then the reviewed default for its theme; a proposed one waits for a decision and is not drawn.
  function lookOf(target, styles) {
    const inForce = list(styles).filter((s) => s && !s.superseded_at);
    const mine = (s) => (target.layerId ? s.layer_id === target.layerId : target.sourceKey ? s.source_key === target.sourceKey : false);
    const own = inForce.filter(mine), theme = target.theme ? inForce.filter((s) => !s.layer_id && !s.source_key && s.theme === target.theme) : [];
    const reviewed = own.find((s) => s.status === "reviewed");
    if (reviewed) return { look: "reviewed", record: reviewed, proposed: own.find((s) => s.status === "proposed") || null };
    const themeReviewed = theme.find((s) => s.status === "reviewed");
    const proposed = own.find((s) => s.status === "proposed") || null;
    if (themeReviewed) return { look: "theme", record: themeReviewed, proposed };
    return { look: proposed ? "proposed" : "none", record: null, proposed };
  }

  // The advisor notes on a layer that this person can read (layer_notes, as row-level security returns them).
  function notesOf(key, notes) {
    const M = N(), mine = M ? list(notes).filter((n) => M.keyOf(n) === key && !M.isEmpty(n)) : [];
    return { all: mine, rcl: mine.find((n) => n.scope === "global") || null, group: mine.filter((n) => n.scope === "group").length, farm: mine.filter((n) => n.scope === "farm").length };
  }

  function finish(r, notes, failed) {
    r.notes = r.noteKey ? notesOf(r.noteKey, notes) : { all: [], rcl: null, group: 0, farm: 0 };
    // a supporting read that failed makes the columns it feeds unknown for the rows it covers: never a blank, a zero or a guess
    r.unknown = new Set();
    for (const key of failed) for (const [cats, cols] of READS[key]?.unknown || []) if (cats.includes(r.cat)) for (const c of cols) r.unknown.add(c);
    if (r.unknown.has("lastload")) r.rights = false;
    const u = (c) => r.unknown.has(c), js = u("job") ? null : r.job?.state, failedLoad = !u("lastload") && r.lastLoad?.result === "failed", never = r.never && !u("lastload");
    r.status = js === "failing" ? "failing" : js === "late" ? "late" : failedLoad ? "loadfailed" : never ? "never"
      : u("job") || u("lastload") ? "unknown" : js === "off" ? "off" : r.cat !== "ref" || !r.job ? "manual" : "ok";
    r.flags = [
      js === "failing" && "failing", js === "late" && "late", failedLoad && "loadfailed", never && "never",
      r.shown === false && "held", r.cat === "ref" && r.licenceStatus !== "open" && "licence", r.rights && "rights",
      (r.cat === "ref" || r.cat === "own") && !u("look") && (r.look === "none" || r.look === "proposed") && "unstyled",
      r.cat === "ref" && !u("note") && !r.notes.rcl && "nonote",
    ].filter(Boolean);
    r.fieldNames = [...r.fields.map((f) => obj(f).field), ...r.dropped, r.idField, ...r.idDerive].filter((x) => typeof x === "string");
    return r;
  }

  // Every row, from the reads (each a list, [] when it could not be read):
  //   sources (reference_sources), statuses (ops_reference_status), jobs (ops_job_status), versions (dataset_versions, current,
  //   sources only), styles (layer_styles in force), notes (layer_notes), core (core_layers), shared (group_shared_layers),
  //   layers (map_layers), names ({ orgs: {id: name}, farms: {id: name} }).
  // The reads the page makes, what each one is, and what is missing when it fails: a catalogue's rows, or the columns a supporting
  // read feeds (unknown: [[catalogues, columns]]). A cap reached is reported by the same names.
  const READS = {
    sources: { label: "reference sources (reference_sources)", cat: "ref" },
    core: { label: "context layers (core_layers)", cat: "core" },
    shared: { label: "group shared layers (group_shared_layers)", cat: "group" },
    orgLayers: { label: "groups' own layers (map_layers)", cat: "own" },
    farmLayers: { label: "the layers of your farms (map_layers)", cat: "own" },
    statuses: { label: "the sources' last pulls (ops_reference_status)", effect: "Last load is unknown", unknown: [[["ref"], ["lastload"]]] },
    jobs: { label: "the data jobs (ops_job_status)", effect: "Job is unknown", unknown: [[["ref"], ["job"]]] },
    versions: { label: "the current dataset versions (dataset_versions)", effect: "a reference source's Geometry is unknown", unknown: [[["ref"], ["geom"]]] },
    styles: { label: "the looks (layer_styles)", effect: "Look is unknown", unknown: [[["ref", "own"], ["look"]]] },
    notes: { label: "the layer notes (layer_notes)", effect: "Notes are unknown", unknown: [[["ref", "own"], ["note", "notestatus", "notewhat", "noteuseful", "notecaveats", "noteshow", "noteupdated"]]] },
    orgRoles: { label: "your group roles (org_members)", effect: "group notes cannot be offered for writing" },
    farmRoles: { label: "your farm roles (farm_members)", effect: "the layers of your farms and farm notes are missing" },
    names: { label: "the owners' names (organisations, farms)", effect: "a group's or farm's layer's Provider is unknown", unknown: [[["group", "own"], ["provider"]]] },
  };
  // What went wrong with the reads, in words: reads = { key: { failed, capped, got, total } }.
  function readProblems(reads = {}) {
    const keys = Object.keys(READS).filter((k) => reads[k]);
    const failed = keys.filter((k) => reads[k].failed).map((k) => ({ key: k, label: READS[k].label, catalogue: !!READS[k].cat,
      text: "Couldn't read " + READS[k].label + (READS[k].cat ? ": its rows are missing from the table" : ": " + READS[k].effect) + "." }));
    const capped = keys.filter((k) => !reads[k].failed && reads[k].capped).map((k) => ({ key: k, label: READS[k].label,
      text: "Cut short: " + READS[k].label + ", the first " + num(reads[k].got) + " of " + num(reads[k].total) + "." }));
    return { failed, capped, any: failed.length + capped.length > 0 };
  }
  // The line of counts: always the total; with a filter, search or view on, how many show of it. A catalogue that could not be read
  // says so, never a zero.
  const isFiltered = (f = {}) => !!(String(f.q || "").trim() || f.health || f.cat || f.provider || f.theme || f.geom || f.status || (f.view && f.view !== "all"));
  function countLine(all, shown, f = {}, failed = []) {
    const n = list(all).length, cats = [["ref", "reference", ["sources"]], ["core", "tiles", ["core"]], ["group", "group", ["shared"]], ["own", "own", ["orgLayers", "farmLayers"]]];
    const off = list(all).filter((r) => r.job?.state === "off" && !r.unknown?.has("job")).length;
    const parts = cats.map(([cat, word, keys]) => { const c = list(all).filter((r) => r.cat === cat).length, bad = keys.filter((k) => failed.includes(k));
      return !bad.length ? c + " " + word : bad.length === keys.length ? word + " not read" : c + " " + word + " (some not read)"; });
    return [(isFiltered(f) ? "Showing " + num(shown) + " of " + num(n) : num(n)) + (n === 1 ? " layer" : " layers"), ...parts, ...(off ? [off + (off === 1 ? " job" : " jobs") + " off"] : [])].join(" · ");
  }

  function rows(input = {}, opts = {}) {
    const timed = opts.timed || TIMED_WORKFLOWS;
    const statusBy = new Map(list(input.statuses).map((s) => [s.source_key, s]));
    const jobBy = new Map(list(input.jobs).map((j) => [j.job_key, j]));
    const versionBy = new Map(list(input.versions).filter((v) => v && v.source_key && !v.superseded_at).map((v) => [v.source_key, v]));
    const names = { orgs: obj(input.names?.orgs), farms: obj(input.names?.farms) };
    const out = [];
    for (const s of list(input.sources)) {
      if (!s || typeof s.key !== "string") continue;
      const st = statusBy.get(s.key) || {}, j = jobBy.get("refresh-reference:" + s.key) || null, v = versionBy.get(s.key) || null;
      const lastLoad = st.last_pull_at ? { at: st.last_pull_at, result: st.last_pull_status || null, partial: !!st.last_pull_partial, note: str(st.last_pull_note) } : null;
      const refreshed = s.refreshed_at || st.refreshed_at || null, features = int(s.feature_count ?? st.feature_count);
      const look = lookOf({ sourceKey: s.key, theme: s.theme }, input.styles);
      out.push({
        id: "ref:" + s.key, cat: "ref", key: s.key, name: str(s.name) || s.key, provider: str(s.provider), theme: str(s.theme), noteKey: "source:" + s.key,
        geom: geomOf(v?.geometry_kind), features, asAt: refreshed, lastLoad,
        never: !refreshed && features === null && !["updated", "unchanged"].includes(lastLoad?.result),
        job: j ? { key: j.job_key, state: jobState(j, timed), health: j.health || null, enabled: j.enabled !== false, workflow: j.workflow || null, cadence: int(j.cadence_hours),
          grace: int(j.grace_hours), lastRunUrl: j.last_run_url || null, lastSuccess: j.last_success_at || null, lastRunStatus: j.last_run_status || null, lastEvent: j.last_event || null } : null,
        shown: s.serve_to_customers === true ? true : s.serve_to_customers === false ? false : st.serve_to_customers === false ? false : st.serve_to_customers === true ? true : null,
        licenceStatus: s.licence_status || st.licence_status || null, licence: str(s.licence), attribution: str(s.attribution), rights: !!st.rights_changed,
        service: str(s.service_kind) || (s.service_url ? "arcgis" : null), serviceUrl: str(s.service_url), layerId: layerIdOf(s),
        idField: str(s.id_field), idDerive: list(s.id_derive_fields).filter((x) => typeof x === "string"), dropped: list(s.drop_fields).filter((x) => typeof x === "string"),
        fields: list(s.fields).filter((f) => f && typeof f === "object" && typeof f.field === "string"),
        context: int(s.context_buffer_m), coverage: str(s.coverage), size: null, look: look.look, lookRecord: look.record, lookProposed: look.proposed,
        version: v, raw: s,
      });
    }
    for (const c of list(input.core)) {
      if (!c || typeof c.key !== "string") continue;
      const ref = obj(obj(c.style).reference), layer = obj(obj(c.style).layer), st = obj(ref.style);
      out.push({
        id: "core:" + c.key, cat: "core", key: c.key, name: str(c.title) || c.key, provider: str(ref.source) || str(layer.source) || null, theme: str(ref.group) || str(layer.group) || null, noteKey: null,
        geom: geomOfStyle(st.layers) || geomOf(layer.geometry), features: int(layer.feature_count), asAt: c.as_at || null, lastLoad: null, never: false, job: null,
        shown: ref.offered === false ? false : true, licenceStatus: null, licence: str(ref.licence), attribution: str(ref.credit), rights: false,
        service: "pmtiles", serviceUrl: null, layerId: str(c.tiles_path), idField: null, idDerive: [], dropped: [], fields: [], context: null, coverage: null,
        size: int(ref.bytes), look: "own", lookRecord: null, lookProposed: null, legend: list(st.legend).length ? list(st.legend) : list(layer.legend),
        everyMap: ref.every_map === true, startsOn: ref.starts_on === true, sha256: str(ref.sha256), draw: str(ref.draw), raw: c,
      });
    }
    for (const g of list(input.shared)) {
      if (!g || typeof g.key !== "string") continue;
      const layer = obj(obj(g.style).layer);
      out.push({
        id: "group:" + g.org_id + ":" + g.key, cat: "group", key: g.key, name: str(g.title) || g.key, provider: names.orgs[g.org_id] || "Group", theme: str(layer.group), noteKey: null,
        geom: geomOf(layer.geometry), features: int(layer.feature_count), asAt: g.as_at || null, lastLoad: null, never: false, job: null, shown: null,
        licenceStatus: null, licence: null, attribution: null, rights: false, service: "pmtiles", serviceUrl: null, layerId: str(g.tiles_path), idField: null, idDerive: [], dropped: [], fields: [],
        context: null, coverage: null, size: null, look: "own", lookRecord: null, lookProposed: null, legend: list(layer.legend), orgId: g.org_id, raw: g,
      });
    }
    for (const l of list(input.layers)) {
      if (!l || !l.id) continue;
      const id = String(l.id).toLowerCase(), look = lookOf({ layerId: l.id, theme: l.theme }, input.styles);
      out.push({
        id: "own:" + id, cat: "own", key: str(l.collection_slug) || "map_layers:" + id.slice(0, 8), name: str(l.name) || "Layer",
        provider: l.org_id ? names.orgs[l.org_id] || "Group layer" : names.farms[l.farm_id] || "Farm layer", theme: str(l.theme), noteKey: "layer:" + id,
        geom: geomOf(l.geometry_type), features: null, asAt: l.as_at || null, lastLoad: l.created_at ? { at: l.created_at, result: "loaded", partial: false, note: null } : null,
        never: false, job: null, shown: null, licenceStatus: null, licence: null, attribution: null, rights: false, service: "qgis-file", serviceUrl: null, layerId: str(l.source_file),
        idField: null, idDerive: [], dropped: [], fields: [], context: null, coverage: null, size: null, look: look.look, lookRecord: look.record, lookProposed: look.proposed,
        mapLayerId: l.id, orgId: l.org_id || null, farmId: l.farm_id || null, raw: l,
      });
    }
    const failed = list(opts.failed).filter((k) => READS[k]);
    return out.map((r) => finish(r, input.notes, failed));
  }

  // ---- the note at the scope being written (the Notes view and the Notes tab) -------------------------------------------------
  // scope: { scope: "global" } | { scope: "group", org_id } | { scope: "farm", farm_id }. A reference source takes a note at any scope;
  // an owned layer only at its owner's (layer_notes_global_is_reference: RCL's global note is for reference sources); tiles take none.
  function noteAt(r, notes, scope) {
    const s = scope || { scope: "global" };
    if (!r.noteKey) return { note: null, status: "none", editable: false, why: "Notes are kept for reference sources and owned layers only." };
    const at = (n) => n.scope === s.scope && (s.scope === "global" || (s.scope === "group" ? n.org_id === s.org_id : n.farm_id === s.farm_id));
    const note = list(notes).find((n) => N().keyOf(n) === r.noteKey && at(n)) || null;
    const editable = r.cat === "ref" ? true : s.scope === "group" ? r.orgId === s.org_id : s.scope === "farm" ? r.farmId === s.farm_id : false;
    return { note, status: note && !N().isEmpty(note) ? "drafted" : "empty", editable,
      why: editable ? null : r.cat === "own" ? "An owned layer's note is written at its owner's scope: choose " + (r.orgId ? "its group" : "its farm") + " under Note for." : null };
  }
  // The shape the shared write path takes (ops-layers.js writeNote): the note-catalogue row of LN1.
  const noteTarget = (r, notes, scope) => ({ note: noteAt(r, notes, scope).note, source_key: r.cat === "ref" ? r.key : null, map_layer_id: r.cat === "own" ? r.mapLayerId : null });

  // ---- columns ------------------------------------------------------------------------------------------------------------------
  // get: the value sorted on (null sorts last); text: what the cell and the CSV say. src: stored, or computed from stored rows.
  // def: false keeps a column out of the default set; csv: false keeps it out of an export (the notes are RCL's working words).
  const noteField = (k) => (r, ctx) => ctx?.scoped?.get(r.id)?.note?.[k] || "";
  const COLUMNS = [
    { id: "status", label: "Status", always: true, src: "computed", get: (r) => STATUS.indexOf(r.status), text: (r) => STATUS_WORD[r.status], title: "The first of: job failing, job late, last load failed, never loaded, job off, loaded by hand" },
    { id: "name", label: "Name", always: true, src: "stored", get: (r) => r.name, text: (r) => r.name },
    { id: "key", label: "Key", mono: true, src: "stored", get: (r) => r.key, text: (r) => r.key, title: "reference_sources.key, core_layers.key, group_shared_layers.key, or map_layers.collection_slug (else the layer's id)" },
    { id: "cat", label: "Catalogue", src: "computed", get: (r) => CAT_WORD[r.cat], text: (r) => CAT_WORD[r.cat], title: "Which table the row is from: reference = reference_sources, tiles = core_layers, group = group_shared_layers, own = map_layers" },
    // OPS2b: the use note, one line on every row: the useful_for part of the note at the scope chosen under Note for (RCL's by
    // default), the part that says what a layer is used for. Edited in the cell; nothing new is stored.
    { id: "usenote", label: "Use note", csv: false, note: "useful_for", src: "stored", get: noteField("useful_for"), text: noteField("useful_for"),
      title: "layer_notes.useful_for of the note at the scope under Note for (RCL's unless another is chosen): what it is used for" },
    { id: "provider", label: "Provider", src: "stored", get: (r) => r.provider, text: (r) => r.provider || "", title: "reference_sources.provider; a context layer's style.reference.source; a group's or farm's layer: its owner" },
    { id: "theme", label: "Theme", mono: true, src: "stored", get: (r) => r.theme, text: (r) => r.theme || "", title: "reference_sources.theme and map_layers.theme; a context or group layer's panel group as stored in its style" },
    { id: "geom", label: "Geometry", src: "stored", get: (r) => r.geom, text: (r) => r.geom || "", title: "dataset_versions.geometry_kind (the current version); map_layers.geometry_type; a tile layer's style" },
    { id: "features", label: "Features", num: true, src: "stored", get: (r) => r.features, text: (r) => (r.features === null ? "" : num(r.features)), title: "reference_sources.feature_count; a published layer's feature_count in its style. Not stored for other layers" },
    { id: "asat", label: "As at", mono: true, src: "stored", get: (r) => day(r.asAt), text: (r) => day(r.asAt) || "", title: "reference_sources.refreshed_at (the last successful refresh); core_layers, group_shared_layers and map_layers as_at" },
    { id: "lastload", label: "Last load", src: "stored", get: (r) => r.lastLoad?.at || null, text: (r) => (r.lastLoad ? [day(r.lastLoad.at), RESULT_WORD[r.lastLoad.result] || r.lastLoad.result || "", r.lastLoad.partial ? "(part)" : ""].filter(Boolean).join(" ") : ""),
      title: "The latest reference_refreshes row and its result (ops_reference_status); an owned layer's row written (map_layers.created_at). Not stored for tiles" },
    { id: "job", label: "Job", src: "stored", get: (r) => (r.job ? r.job.state : null), text: (r) => (r.job ? JOB_WORD[r.job.state] : ""), title: "ops_job_status for refresh-reference:<key>; off when switched off or its workflow has no timer (never late or failing)" },
    { id: "shown", label: "Customers", src: "stored", get: (r) => (r.shown === null ? null : r.shown ? 1 : 0), text: (r) => (r.shown === null ? "" : r.cat === "core" ? (r.shown ? "offered" : "withdrawn") : r.shown ? "shown" : "held back"),
      title: "reference_sources.serve_to_customers; a context layer's style.reference.offered. A group's or farm's layer is its members' only" },
    { id: "look", label: "Look", src: "stored", get: (r) => r.look, text: (r) => LOOK_WORD[r.look] || "", title: "layer_styles: reviewed for this source or layer, else the reviewed default for its theme; proposed waits for a decision. Tiles carry their own style" },
    { id: "note", label: "Notes", csv: false, src: "stored", get: (r) => (r.notes.rcl ? 100 : 0) + r.notes.group * 10 + r.notes.farm, text: (r) => (r.noteKey ? [r.notes.rcl ? "R" : "·", r.notes.group ? "G" + r.notes.group : "·", r.notes.farm ? "F" + r.notes.farm : "·"].join(" ") : ""),
      title: "layer_notes you can read: R = RCL's global note, G = group notes, F = farm notes (staff read group and farm notes only where they are members)" },
    { id: "service", label: "Service", def: false, mono: true, src: "stored", get: (r) => r.service, text: (r) => r.service || "", title: "reference_sources.service_kind; tiles are PMTiles; an owned layer came from a QGIS file" },
    { id: "layer", label: "Layer id", def: false, mono: true, src: "stored", get: (r) => r.layerId, text: (r) => r.layerId || "", title: "reference_sources.service_layer or the service address's MapServer/<n>; a tile layer's tiles_path; an owned layer's source_file" },
    { id: "idfield", label: "Id field", def: false, mono: true, src: "stored", get: (r) => r.idField || (r.idDerive.length ? "derived" : null), text: (r) => r.idField || (r.idDerive.length ? "derived from " + r.idDerive.join(", ") : ""), title: "reference_sources.id_field or id_derive_fields" },
    { id: "dropped", label: "Dropped", def: false, num: true, src: "stored", get: (r) => (r.cat === "ref" ? r.dropped.length : null), text: (r) => (r.cat === "ref" ? String(r.dropped.length) : ""), title: "reference_sources.drop_fields: fields never kept" },
    { id: "licence", label: "Licence", def: false, src: "stored", get: (r) => r.licenceStatus || r.licence, text: (r) => (r.licenceStatus ? r.licenceStatus.replace(/_/g, " ") : r.licence || ""), title: "reference_sources.licence_status; a context layer's licence as written in its style" },
    { id: "context", label: "Context m", def: false, num: true, src: "stored", get: (r) => r.context, text: (r) => (r.context === null ? "" : num(r.context)), title: "reference_sources.context_buffer_m: how far beyond a farm it opens" },
    { id: "coverage", label: "Coverage", def: false, mono: true, src: "stored", get: (r) => r.coverage, text: (r) => r.coverage || "", title: "reference_sources.coverage" },
    { id: "size", label: "Size", def: false, num: true, src: "stored", get: (r) => r.size, text: (r) => (r.size === null ? "" : (r.size / 1048576).toFixed(1) + " MB"), title: "core_layers style.reference.bytes (the tiles file). Not stored for other layers" },
    { id: "notewhat", label: "What it is", def: false, csv: false, note: "what_it_is", src: "stored", get: noteField("what_it_is"), text: noteField("what_it_is") },
    { id: "noteuseful", label: "Useful for", def: false, csv: false, note: "useful_for", src: "stored", get: noteField("useful_for"), text: noteField("useful_for") },
    { id: "notecaveats", label: "Caveats", def: false, csv: false, note: "caveats", src: "stored", get: noteField("caveats"), text: noteField("caveats") },
    { id: "noteshow", label: "When to show a group", def: false, csv: false, note: "show_to_group", src: "stored", get: noteField("show_to_group"), text: noteField("show_to_group") },
    { id: "notestatus", label: "Note here", def: false, csv: false, src: "stored", get: (r, ctx) => ctx?.scoped?.get(r.id)?.status || null, text: (r, ctx) => ({ drafted: "drafted", empty: "empty", none: "" })[ctx?.scoped?.get(r.id)?.status] ?? "",
      title: "The note at the scope chosen under Note for: drafted or empty" },
    { id: "noteupdated", label: "Note updated", def: false, csv: false, mono: true, src: "stored", get: (r, ctx) => ctx?.scoped?.get(r.id)?.note?.updated_at || null, text: (r, ctx) => day(ctx?.scoped?.get(r.id)?.note?.updated_at) || "" },
  ];
  // a column a failed read feeds says "unknown" for the rows it covers, and sorts last
  for (const c of COLUMNS) { const text = c.text, get = c.get; c.text = (r, ctx) => (r.unknown?.has(c.id) ? "unknown" : text(r, ctx)); c.get = (r, ctx) => (r.unknown?.has(c.id) ? null : get(r, ctx)); }
  const COL = Object.fromEntries(COLUMNS.map((c) => [c.id, c]));
  const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.def !== false).map((c) => c.id);

  const isStale = (r) => r.flags.includes("failing") || r.flags.includes("late") || r.flags.includes("loadfailed");
  // Saved views: a test and the columns they open with (the column chooser changes them, remembered per view on the device).
  const VIEWS = [
    { id: "all", label: "All", cols: DEFAULT_COLUMNS },
    { id: "stale", label: "Stale", test: isStale, cols: ["status", "name", "key", "provider", "features", "asat", "lastload", "job", "service", "layer"] },
    { id: "held", label: "Held back", test: (r) => r.shown === false, cols: ["status", "name", "key", "cat", "provider", "theme", "features", "licence", "shown", "note"] },
    { id: "unstyled", label: "Unstyled", test: (r) => r.flags.includes("unstyled"), cols: ["status", "name", "key", "cat", "theme", "geom", "features", "look"] },
    { id: "licence", label: "Licence", test: (r) => r.flags.includes("licence") || r.flags.includes("rights"), cols: ["status", "name", "key", "provider", "licence", "shown", "service", "lastload"] },
    { id: "manage", label: "Manage", cols: ["status", "name", "key", "cat", "theme", "usenote", "provider", "service", "asat", "shown", "look", "note"] },
    { id: "notes", label: "Notes", test: (r) => !!r.noteKey, notes: true, cols: ["status", "name", "key", "cat", "notestatus", "notewhat", "noteuseful", "notecaveats", "noteshow", "note", "noteupdated"] },
  ];
  const HEALTH = [
    { id: "failing", label: "failing" }, { id: "late", label: "late" }, { id: "loadfailed", label: "last load failed" }, { id: "never", label: "never loaded" }, "|",
    { id: "held", label: "held back" }, { id: "licence", label: "licence to check" }, { id: "rights", label: "rights wording changed" }, "|",
    { id: "unstyled", label: "no reviewed look" }, { id: "nonote", label: "no RCL note" },
  ];
  const healthCounts = (all) => Object.fromEntries(HEALTH.filter((h) => h !== "|").map((h) => [h.id, list(all).filter((r) => r.flags.includes(h.id)).length]));

  // ---- filter, sort, group ------------------------------------------------------------------------------------------------------
  const FIELDS = () => N()?.FIELDS || [];
  function searchText(r) {
    const notes = r.notes.all.flatMap((n) => FIELDS().map(([k]) => n[k]));
    return [r.name, r.key, r.theme, r.provider, ...r.fieldNames, ...notes].filter((v) => typeof v === "string").join(" ").toLowerCase();
  }
  // f: { q, view, health, cat, provider, theme, geom ("none" for no geometry), status, show ("all" | "empty" | "drafted", the Notes view) }
  function filter(all, f = {}, ctx = {}) {
    const words = String(f.q || "").toLowerCase().split(/\s+/).filter(Boolean);
    const view = VIEWS.find((v) => v.id === f.view);
    return list(all).filter((r) => (!view?.test || view.test(r)) && (!f.health || r.flags.includes(f.health))
      && (!f.cat || r.cat === f.cat) && (!f.provider || r.provider === f.provider) && (!f.theme || r.theme === f.theme)
      && (!f.geom || (r.geom || "none") === f.geom) && (!f.status || r.status === f.status)
      && (!view?.notes || !f.show || f.show === "all" || ctx.scoped?.get(r.id)?.status === f.show)
      && (!words.length || (() => { const t = searchText(r); return words.every((w) => t.includes(w)); })()));
  }
  // Nulls last in either direction; numbers as numbers; words by the reader's order; ties by name.
  function sort(rowsIn, colId = "name", dir = 1, ctx = {}) {
    const c = COL[colId] || COL.name, d = dir < 0 ? -1 : 1;
    const val = (r) => { const v = c.get(r, ctx); return v === "" || v === undefined ? null : v; };
    return [...list(rowsIn)].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      const by = x === null ? 0 : typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en-NZ", { numeric: true, sensitivity: "base" });
      return by * d || String(a.name).localeCompare(String(b.name), "en-NZ") || a.id.localeCompare(b.id);
    });
  }
  const GROUPS = { none: null, theme: (r) => r.theme || "(no theme)", provider: (r) => r.provider || "(no provider)", cat: (r) => CAT_NAME[r.cat] };
  // Groups in name order, each keeping the rows' sorted order, with a roll-up of what it holds.
  function group(rowsIn, by) {
    const key = GROUPS[by];
    if (!key) return [{ key: null, label: null, rows: list(rowsIn) }];
    const map = new Map();
    for (const r of list(rowsIn)) { const k = key(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "en-NZ")).map(([k, rs]) => ({ key: k, label: k, rows: rs, roll: rollup(rs) }));
  }
  function rollup(rs) {
    const counted = rs.filter((r) => r.features !== null);
    return { layers: rs.length, features: counted.reduce((n, r) => n + r.features, 0), counted: counted.length, stale: rs.filter(isStale).length,
      held: rs.filter((r) => r.shown === false).length, never: rs.filter((r) => r.never).length };
  }
  const rollText = (g) => [g.layers + (g.layers === 1 ? " layer" : " layers"), g.counted ? num(g.features) + " features" + (g.counted < g.layers ? " where stored" : "") : null,
    g.stale ? g.stale + " stale" : null, g.held ? g.held + " held back" : null, g.never ? g.never + " never loaded" : null].filter(Boolean).join(" · ");

  // ---- the note cells, edited in place (OPS2b) --------------------------------------------------------------------------------------
  // The four note parts the Notes view shows as columns, in Tab order; the fifth (Notes, long) stays in the Notes tab.
  const NOTE_CELLS = ["what_it_is", "useful_for", "caveats", "show_to_group"];
  // The next cell Tab (dir 1) or Shift+Tab (dir -1) goes to, among the note cells shown (in their column order): null past the ends.
  function nextCell(field, shown, dir = 1) {
    const order = list(shown).filter((f) => NOTE_CELLS.includes(f)), i = order.indexOf(field);
    return i < 0 ? null : order[i + dir] ?? null;
  }
  // A cell being edited: which row and part, what was stored and what is typed. Nothing is written until commit.
  // seq: which opening of a cell this is, so a save that returns late touches only the edit it belongs to (sameEdit)
  const startEdit = (rowId, field, stored, seq = 0) => ({ row: rowId, field, seq, original: typeof stored === "string" ? stored : "", draft: typeof stored === "string" ? stored : "", state: "editing", error: null });
  const sameEdit = (a, b) => !!a && !!b && a.row === b.row && a.field === b.field && a.seq === b.seq;
  const typed = (e, text) => ({ ...e, draft: String(text ?? ""), state: e.state === "failed" ? "editing" : e.state });
  // What a save would write: only the part edited (trimmed, blank as null), refused when it is too long; nothing when unchanged.
  function commit(e) {
    const M2 = N(), d = M2.draft({ [e.field]: e.draft }), v = d.values[e.field] ?? null, was = (e.original || "").trim() || null;
    const label = (M2.FIELDS.find(([k]) => k === e.field) || [])[1] || e.field;
    if (d.errors.length) return { write: false, error: d.errors.find((x) => x.startsWith(label)) || d.errors[0] };
    return v === was ? { write: false, unchanged: true } : { write: true, values: { [e.field]: v } };
  }
  const saving = (e) => ({ ...e, state: "saving", error: null });
  // A save that failed keeps the text and says why; one that worked shows what the database now holds (read back).
  const failed = (e, why) => ({ ...e, state: "failed", error: String(why || "That change wasn't saved.") });
  const saved = (e, storedRow) => ({ ...e, state: "saved", original: storedRow?.[e.field] ?? "", draft: storedRow?.[e.field] ?? "", error: null });

  // The notes of the rows chosen, as plain text to paste: each layer's name and key, then each part of its note at the scope shown.
  function notesText(rowsIn, ctx = {}) {
    const fields = N()?.FIELDS || [], NL = String.fromCharCode(10);
    return list(rowsIn).map((r) => {
      const n = ctx.scoped?.get(r.id)?.note, parts = fields.filter(([k]) => n && typeof n[k] === "string" && n[k].trim()).map(([k, label]) => "  " + label + ": " + n[k].trim().replace(/\s+/g, " "));
      return r.name + " (" + r.key + ")" + NL + (parts.length ? parts.join(NL) : "  No note" + (r.noteKey ? " at this scope" : ": tiles take none"));
    }).join(NL + NL) + NL;
  }

  // ---- CSV ----------------------------------------------------------------------------------------------------------------------
  // The rows and columns shown, made in the browser: keys and public source facts only (the notes columns are left out). A cell that
  // begins with = + - @ (or a tab or a carriage return) is written with an apostrophe in front, so a spreadsheet never runs it.
  const guard = (v) => (/^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  const quote = (v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  // opts.notes: the rows a person chose, with their note columns too (the note at the scope shown, the counts left out)
  function csv(rowsIn, colIds, ctx = {}, opts = {}) {
    const ids = opts.notes ? [...new Set([...list(colIds), "usenote", "notewhat", "notecaveats", "noteshow", "noteupdated"])].filter((id) => id !== "noteuseful") : list(colIds);
    const cols = ids.map((id) => COL[id]).filter((c) => c && (c.csv !== false || (opts.notes && (c.note || c.id === "noteupdated"))));
    const out = [cols.map((c) => quote(c.id === "status" ? "Status" : c.label)).join(",")];
    for (const r of list(rowsIn)) out.push(cols.map((c) => quote(guard(String(c.text(r, ctx) ?? "")))).join(","));
    return out.join("\r\n") + "\r\n";
  }

  // ---- the small extent picture --------------------------------------------------------------------------------------------------
  // dataset_versions.extent (NZTM metres, GeoJSON as the API returns it) and the source's fetch_extent, drawn into a w x h box with
  // north up: SVG path data and the box in numbers. At most 60 rings of at most 300 points each (every nth point kept).
  function extentPicture(geo, fetchExtent, w = 280, h = 200, pad = 10) {
    const polys = !geo || typeof geo !== "object" ? [] : geo.type === "Polygon" ? [geo.coordinates] : geo.type === "MultiPolygon" ? list(geo.coordinates) : [];
    const rings = polys.flatMap((p) => list(p)).filter((r) => Array.isArray(r) && r.length > 2);
    const fe = typeof fetchExtent === "string" ? fetchExtent.split(",").map(Number) : null;
    const box = fe && fe.length === 4 && fe.every(Number.isFinite) ? fe : null;
    const pts = rings.flat().filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pts.length && !box) return null;
    const xs = [...pts.map((p) => p[0]), ...(box ? [box[0], box[2]] : [])], ys = [...pts.map((p) => p[1]), ...(box ? [box[1], box[3]] : [])];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of xs) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    for (const y of ys) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const k = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1), (h - 2 * pad) / Math.max(y1 - y0, 1));
    const ox = (w - (x1 - x0) * k) / 2, oy = (h - (y1 - y0) * k) / 2;
    const X = (x) => +(ox + (x - x0) * k).toFixed(1), Y = (y) => +(h - oy - (y - y0) * k).toFixed(1);
    const largest = [...rings].sort((a, b) => b.length - a.length).slice(0, 60);
    const paths = largest.map((ring) => { const step = Math.max(1, Math.ceil(ring.length / 300)); const kept = ring.filter((_, i) => i % step === 0);
      return "M" + kept.map((p) => X(p[0]) + " " + Y(p[1])).join("L") + "Z"; });
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const p of pts) { if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0]; if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1]; }
    return { w, h, paths, bbox: pts.length ? [bx0, by0, bx1, by1].map((v) => Math.round(v)) : null,
      fetch: box ? { x: X(box[0]), y: Y(box[3]), w: +((box[2] - box[0]) * k).toFixed(1), h: +((box[3] - box[1]) * k).toFixed(1) } : null };
  }

  return { TIMED_WORKFLOWS, READS, readProblems, isFiltered, countLine, jobState, CAT_WORD, CAT_NAME, JOB_WORD, LOOK_WORD, RESULT_WORD, STATUS, STATUS_WORD, day, num, layerIdOf, geomOfStyle, lookOf, notesOf, rows,
    noteAt, noteTarget, NOTE_CELLS, nextCell, startEdit, sameEdit, typed, commit, saving, failed, saved, notesText, COLUMNS, COL, DEFAULT_COLUMNS, VIEWS, HEALTH, healthCounts, isStale, filter, sort, group, rollText, csv, extentPicture };
});
