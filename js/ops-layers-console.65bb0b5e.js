// Operations > Layers as a registry (OPS2a), RCL staff only: one dense table of every layer the platform keeps a record of, with a
// health strip of filters, saved views, a column chooser kept on this device, grouping, keyboard movement, CSV export and a
// read-only detail panel (About, Schema, Data, Visibility, Style, Notes). The one thing it writes is an advisor note, through
// the Layers page's own write path (FP.opsLayers.writeNote / removeNote, unchanged), from the Notes tab.
// Loaded on first use by js/ops-layers.js (never by the sign-in page or anyone else's start). The rules are
// js/ops-layers-console-model.js (FP.layerRegistry). Reads only through the normal client, under row-level security, every read
// counted first and capped, never a feature: the catalogues' own rows, their latest pull, their jobs, their looks and notes.
// Opened again, it reads again; closed, it takes its one document listener (the keyboard) away and drops what it drew.
(function () {
  const M = FP.layerRegistry, N = FP.layerNotes, { sb } = FP;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CAP = { maps: 500, mapVersions: 1000, sources: 500, statuses: 500, jobs: 500, versions: 500, styles: 1000, notes: 1000, core: 200, shared: 500, layers: 1000, history: 50, ids: 100 };
  const SOURCE_COLS = "key,name,theme,provider,service_url,service_kind,service_layer,licence,licence_status,attribution,serve_to_customers,id_field,id_derive_fields," +
    "drop_fields,keep_duplicate_ids,refreshed_at,feature_count,notes,epistemic_class,scale,accuracy,summary,fields,coverage,fetch_extent,fetch_where,fetch_tile_m,api_key_secret,context_buffer_m";
  const LAYER_COLS = "id,name,theme,org_id,farm_id,geometry_type,as_at,created_at,source,source_file,method,collection_slug,epistemic_class,scale";
  const STYLE_COLS = "id,layer_id,source_key,theme,classify_by,classes,symbol,label_field,label_min_zoom,min_zoom,max_zoom,purpose,status,proposed_at,reviewed_at,superseded_at,returned_note";
  const HISTORY_COLS = "id,started_at,finished_at,status,partial,first_pull,rights_changed,provider_copyright,previous_provider_copyright,n_added,n_changed,n_unchanged,n_removed," +
    "n_skipped,n_duplicate_ids,archive_status,removals_skipped,note";
  const TABS = [["overview", "About"], ["schema", "Schema"], ["data", "Data"], ["visibility", "Visibility"], ["style", "Style"], ["notes", "Notes"]];
  const COLS_KEY = "fp-ops-layers-cols:";

  let live = 0, root = null, phone = null, onKey = null, S = null, input = null, rows = [], order = [], scopes = [], cache = new Map(), host = null, readAt = null, SM = null, problems = { failed: [], capped: [], any: false }, failedReads = [];

  // ---- reads ----------------------------------------------------------------------------------------------------------------------
  // Counted first, then at most the cap (never past the API's 1,000 a request); `capped` says when there were more.
  async function counted(table, cols, apply, cap) {
    const head = await apply(sb.from(table).select(cols, { count: "exact", head: true }));
    if (head.error) throw head.error;
    const total = Number(head.count) || 0;
    if (!total) return { rows: [], total: 0, capped: false };
    const res = await apply(sb.from(table).select(cols)).limit(Math.min(total, cap));
    if (res.error) throw res.error;
    return { rows: res.data || [], total, capped: total > cap };
  }
  const soft = (p) => Promise.resolve().then(() => p).catch(() => ({ rows: [], total: 0, capped: false, failed: true }));
  const chunks = (ids) => { const out = []; for (let i = 0; i < ids.length; i += CAP.ids) out.push(ids.slice(i, i + CAP.ids)); return out; };
  async function byIds(table, cols, ids) {
    const got = [];
    for (const part of chunks([...new Set(ids.filter(Boolean))])) {
      const { data, error } = await sb.from(table).select(cols).in("id", part).limit(part.length);
      if (error) throw error;
      got.push(...(data || []));
    }
    return got;
  }

  // Every read, by its name in the model (M.READS): whether it failed and whether its cap cut it short. `track` records one; a read
  // made in batches (a farm's layers, 100 farms at a time) adds its batches up under one name.
  async function read() {
    const user = FP.ops.user(), reads = {};
    const track = async (key, p) => {
      const r = await soft(p), was = reads[key];
      reads[key] = { failed: !!(was?.failed || r.failed), capped: !!(was?.capped || r.capped), got: (was?.got || 0) + r.rows.length, total: (was?.total || 0) + r.total };
      return r;
    };
    const [sources, statuses, jobs, versions, styles, notes, core, shared, orgLayers, orgRoles, farmRoles] = await Promise.all([
      track("sources", counted("reference_sources", SOURCE_COLS, (q) => q.order("name"), CAP.sources)),
      track("statuses", counted("ops_reference_status", "*", (q) => q.order("name"), CAP.statuses)),
      track("jobs", counted("ops_job_status", "*", (q) => q.order("job_key"), CAP.jobs)),
      track("versions", counted("dataset_versions", "id,source_key,version_no,geometry_kind,as_at,loaded_at,coverage", (q) => q.is("superseded_at", null).is("layer_id", null), CAP.versions)),
      track("styles", counted("layer_styles", STYLE_COLS, (q) => q.is("superseded_at", null), CAP.styles)),
      track("notes", counted("layer_notes", "*", (q) => q, CAP.notes)),
      track("core", counted("core_layers", "key,title,style,tiles_path,as_at,created_at", (q) => q.order("key"), CAP.core)),
      track("shared", counted("group_shared_layers", "org_id,key,title,style,tiles_path,as_at,created_at", (q) => q.order("key"), CAP.shared)),
      track("orgLayers", counted("map_layers", LAYER_COLS, (q) => q.is("farm_id", null).order("name"), CAP.layers)),
      track("orgRoles", counted("org_members", "org_id,role", (q) => q.eq("user_id", user?.id), CAP.ids)),
      track("farmRoles", counted("farm_members", "farm_id,role", (q) => q.eq("user_id", user?.id), CAP.ids)),
    ]);
    // the layers of the farms this person is on (as the notes page lists them), and the names of every owner shown. Without the
    // person's farm roles, their farms' layers cannot be read: that catalogue is missing too.
    const farmIds = farmRoles.rows.map((m) => m.farm_id).filter(Boolean);
    const farmLayers = [];
    if (farmRoles.failed) reads.farmLayers = { failed: true, capped: false, got: 0, total: 0 };
    else reads.farmLayers = { failed: false, capped: false, got: 0, total: 0 };
    for (const part of chunks(farmIds)) farmLayers.push(...(await track("farmLayers", counted("map_layers", LAYER_COLS, (q) => q.in("farm_id", part).order("name"), CAP.layers))).rows);
    const orgIds = [...orgLayers.rows.map((l) => l.org_id), ...shared.rows.map((g) => g.org_id), ...orgRoles.rows.filter((m) => N.ORG_WRITERS.includes(m.role)).map((m) => m.org_id)];
    const farmNameIds = [...farmLayers.map((l) => l.farm_id), ...farmRoles.rows.filter((m) => N.FARM_WRITERS.includes(m.role)).map((m) => m.farm_id)];
    const named = await track("names", Promise.all([byIds("organisations", "id,name", orgIds), byIds("farms", "id,name", farmNameIds)])
      .then(([orgs, farms]) => ({ rows: [{ orgs, farms }], total: 0, capped: false })));
    reads.names.got = reads.names.total = 0;
    const { orgs = [], farms = [] } = named.rows[0] || {};
    const orgName = Object.fromEntries(orgs.map((o) => [o.id, o.name])), farmName = Object.fromEntries(farms.map((f) => [f.id, f.name]));
    const roleOf = (list, key, id) => list.find((m) => m[key] === id)?.role;
    scopes = N.writableScopes({ staff: FP.ops.isStaff(), orgs: orgs.filter((o) => N.ORG_WRITERS.includes(roleOf(orgRoles.rows, "org_id", o.id))).map((o) => ({ ...o, role: roleOf(orgRoles.rows, "org_id", o.id) })),
      farms: farms.filter((f) => N.FARM_WRITERS.includes(roleOf(farmRoles.rows, "farm_id", f.id))).map((f) => ({ ...f, role: roleOf(farmRoles.rows, "farm_id", f.id) })) });
    // a note cannot be written safely without the notes read: no scope is offered then
    if (notes.failed) scopes = [];
    problems = M.readProblems(reads);
    failedReads = problems.failed.map((p) => p.key);
    return { sources: sources.rows, statuses: statuses.rows, jobs: jobs.rows, versions: versions.rows, styles: styles.rows, notes: notes.rows, core: core.rows, shared: shared.rows,
      layers: [...orgLayers.rows, ...farmLayers], names: { orgs: orgName, farms: farmName } };
  }

  // ---- the device's column choice, per view ------------------------------------------------------------------------------------------
  function colsFor(view) {
    const preset = (M.VIEWS.find((v) => v.id === view) || M.VIEWS[0]).cols;
    try {
      const kept = JSON.parse(localStorage.getItem(COLS_KEY + view) || "null");
      if (Array.isArray(kept)) { const ok = kept.filter((id) => M.COL[id]); if (ok.length) return [...new Set(["status", "name", ...ok])]; }
    } catch { /* storage unreadable: the view's own columns */ }
    return [...preset];
  }
  function keepCols(view, cols) { try { localStorage.setItem(COLS_KEY + view, JSON.stringify(cols)); } catch { /* not kept; the choice holds for this visit */ } }

  // ---- drawing: pieces ---------------------------------------------------------------------------------------------------------------
  const ctxNow = () => ({ scoped: new Map(rows.map((r) => [r.id, M.noteAt(r, input.notes, S.scope)])) });
  const dim = (t) => '<span class="olc-dim">' + esc(t) + "</span>";
  const tag = (t, tone) => '<span class="olc-tag' + (tone ? " olc-" + tone : "") + '">' + esc(t) + "</span>";
  const mono = (t) => '<span class="olc-mono">' + esc(t) + "</span>";
  const mark = (r) => '<span class="olc-mark" data-mark="' + esc(r.status) + '" title="' + esc(M.STATUS_WORD[r.status]) + '" aria-hidden="true"></span><span class="olc-sr">' + esc(M.STATUS_WORD[r.status]) + "</span>";
  // OPS2b: whether a note cell can be written here: a scope offered, the notes read, and the layer takes a note at that scope
  const writable = (r, ctx) => !!(scopes.length && !failedReads.includes("notes") && ctx.scoped.get(r.id)?.editable);
  const markKey = (rowId, field) => rowId + "|" + field;
  function noteCell(c, r, ctx) {
    const t = c.text(r, ctx), e = S.edit, can = writable(r, ctx), mk = S.marks.get(markKey(r.id, c.note));
    if (e && e.row === r.id && e.col === c.id) {
      const label = (N.FIELDS.find(([k]) => k === c.note) || [])[1] || c.label;
      return '<td class="olc-editing" data-c="' + c.id + '"><textarea data-edit rows="1" aria-label="' + esc(label + ", " + r.name) + '"' +
        (e.state === "saving" ? " readonly" : "") + ">" + esc(e.draft) + '</textarea><span class="olc-cellmsg" role="status" data-cell-msg="' + e.state + '">' +
        esc(e.state === "saving" ? "Saving…" : e.state === "failed" ? "Not saved: " + String(e.error).replace(/([^.!?])$/, "$1.") + " The text is kept." : "Enter saves · Tab next · Esc cancels") + "</span></td>";
    }
    const body = r.unknown.has(c.id) ? tag("unknown", "line") : t ? esc(t) : can ? dim(c.id === "usenote" ? "add a line" : "empty") : dim("—");
    const markHtml = mk ? '<span class="olc-cellmark" data-cell-mark="' + mk.state + '" title="' + esc(mk.state === "saved" ? "Saved and read back" : "Not saved") + '">' + (mk.state === "saved" ? "✓" : "!") + "</span>" : "";
    const title = t || (can ? "Click or press e to write" : ctx.scoped.get(r.id)?.why || (failedReads.includes("notes") ? "The notes could not be read" : "Not written here"));
    return '<td class="olc-notecell' + (can ? " olc-can-edit" : "") + '" data-c="' + c.id + '"' + (can ? ' data-edit-cell="' + c.id + '"' : "") + ' title="' + esc(title) + '">' + markHtml + body + "</td>";
  }
  function cell(c, r, ctx) {
    if (c.note) return noteCell(c, r, ctx);
    const t = c.text(r, ctx);
    let html;
    if (r.unknown.has(c.id)) html = tag("unknown", "line");
    else if (c.id === "status") html = mark(r);
    else if (c.id === "name") html = '<button type="button" class="olc-namebtn" data-open-row>' + esc(t) + "</button>";
    else if (c.id === "cat") html = '<span class="olc-cat">' + esc(t) + "</span>";
    else if (c.id === "job") html = !r.job ? dim("—") : r.job.state === "failing" ? tag(t, "bad") : r.job.state === "late" ? tag(t, "warn") : r.job.state === "never_run" ? tag(t, "line") : dim(t);
    else if (c.id === "shown") html = r.shown === false ? tag(t, "warn") : t ? dim(t) : dim("—");
    else if (c.id === "look") html = r.look === "none" ? tag(t, "line") : r.look === "proposed" ? tag(t, "warn") : dim(t);
    else if (c.id === "lastload") html = !r.lastLoad ? dim("—") : r.lastLoad.result === "failed" ? mono(M.day(r.lastLoad.at)) + " " + tag("failed", "bad") : mono(t);
    else if (c.id === "note") html = r.noteKey ? mono(t) : dim("—");
    else if (c.id === "notestatus") html = t === "drafted" ? esc(t) : t ? tag(t, "line") : dim("—");
    else if (!t) html = dim("—");
    else html = c.mono || c.num ? mono(t) : esc(t);
    const cls = [c.num && "olc-num", c.id === "name" && "olc-name", c.note && "olc-notecell", c.id === "status" && "olc-mk", (c.id === "key" || c.id === "layer") && "olc-trunc"].filter(Boolean).join(" ");
    return "<td" + (cls ? ' class="' + cls + '"' : "") + ' data-c="' + c.id + '"' + (c.note || c.id === "key" || c.id === "layer" || c.id === "name" || c.id === "provider" || c.id === "theme" ? ' title="' + esc(t) + '"' : "") + ">" + html + "</td>";
  }

  // What could not be read, and what was cut short, by name, beside the counts; Try again reads everything again.
  function drawProblems() {
    const el = root.querySelector("[data-problems]");
    el.hidden = !problems.any;
    el.innerHTML = !problems.any ? "" : '<ul>' + [...problems.failed, ...problems.capped].map((p) => '<li data-read-problem="' + esc(p.key) + '"' + (problems.failed.includes(p) ? ' data-failed' : "") + ">" + esc(p.text) + "</li>").join("") + "</ul>" +
      (problems.failed.length ? '<button type="button" class="olc-btn" data-retry>Try again</button>' : "");
  }
  function drawChrome() {
    const counts = M.healthCounts(rows);
    root.querySelector("[data-health]").innerHTML = '<span class="olc-lab">Health</span>' + M.HEALTH.map((h) => h === "|" ? '<span class="olc-hsep" aria-hidden="true"></span>'
      : '<button type="button" class="olc-chip' + (counts[h.id] ? "" : " olc-zero") + '" data-h="' + h.id + '" aria-pressed="' + (S.f.health === h.id) + '"><b>' + counts[h.id] + "</b> " + esc(h.label) + "</button>").join("");
    root.querySelector("[data-views]").innerHTML = M.VIEWS.map((v) => '<button type="button" data-view="' + v.id + '" aria-pressed="' + (S.f.view === v.id) + '">' + esc(v.label) +
      (v.test ? '<span class="olc-n">' + rows.filter(v.test).length + "</span>" : "") + "</button>").join("");
    root.querySelector("[data-groups]").innerHTML = [["none", "None"], ["theme", "Theme"], ["provider", "Provider"], ["cat", "Catalogue"]].map(([g, l]) =>
      '<button type="button" data-group="' + g + '" aria-pressed="' + (S.group === g) + '">' + l + "</button>").join("");
    root.querySelector("[data-n]").textContent = String(rows.length);
    drawProblems();
    const notesView = M.VIEWS.find((v) => v.id === S.f.view)?.notes;
    root.querySelector("[data-notes-tools]").hidden = !notesView && !S.cols.some((id) => M.COL[id]?.note);
    root.querySelector("[data-show-wrap]").hidden = !notesView;
    drawBulk();
    root.querySelector("[data-cols-n]").textContent = S.cols.length + "/" + M.COLUMNS.length;
  }
  const selectHtml = (key, label, values, words) => '<label class="olc-sel"><span class="olc-sr">' + esc(label) + '</span><select data-f="' + key + '"><option value="">' + esc(label) + "</option>" +
    values.map((v) => '<option value="' + esc(v) + '"' + (S.f[key] === v ? " selected" : "") + ">" + esc(words ? words[v] || v : v) + "</option>").join("") + "</select></label>";
  const scopeOptions = () => scopes.map((o) => '<option value="' + esc(o.value) + '"' + (o.value === scopeValue(S.scope) ? " selected" : "") + ">" + esc(o.label) + "</option>").join("");
  const scopeValue = (s) => (s.scope === "global" ? "global" : s.scope === "group" ? "group:" + s.org_id : "farm:" + s.farm_id);

  function shell() {
    const uniq = (k) => [...new Set(rows.map((r) => r[k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "en-NZ"));
    return '<section class="olc" data-ops="registry" aria-label="Layer registry">' +
      '<div class="olc-bar"><h2 class="olc-sr">Operations, Layers</h2><div class="olc-ctabs" role="tablist" aria-label="Catalogues">' +
        '<button type="button" role="tab" data-ctab="registry" aria-selected="true">Layers <span class="olc-n" data-n></span></button>' +
        '<button type="button" role="tab" data-ctab="maps" aria-selected="false">Published maps <span class="olc-n" data-maps-n></span></button></div>' +
        '<p class="olc-count" data-countline aria-live="polite"></p></div>' +
      '<div class="olc-problems" data-problems role="alert" hidden></div>' +
      '<div class="olc-health" role="group" aria-label="Health: each is a filter" data-health></div>' +
      '<div class="olc-tools">' +
        '<label class="olc-search"><span class="olc-sr">Search</span><input type="search" data-q value="' + esc(S.f.q) + '" placeholder="Search name, key or field name (WELL_NO, ConsentNo…)" aria-keyshortcuts="/" autocomplete="off"><kbd aria-hidden="true">/</kbd></label>' +
        '<div class="olc-seg" role="group" aria-label="Saved views" data-views></div>' +
        '<span class="olc-lab">Filter</span>' +
        selectHtml("cat", "Catalogue", ["ref", "core", "group", "own"], M.CAT_WORD) + selectHtml("provider", "Provider", uniq("provider")) + selectHtml("theme", "Theme", uniq("theme")) +
        selectHtml("geom", "Geometry", ["point", "line", "polygon", "none"], { none: "no geometry" }) + selectHtml("status", "Status", M.STATUS, M.STATUS_WORD) +
        '<span class="olc-lab">Group</span><div class="olc-seg" role="group" aria-label="Group rows by" data-groups></div>' +
        '<span class="olc-notes-tools" data-notes-tools hidden><label class="olc-sel"><span class="olc-lab">Note for</span><select data-scope>' + scopeOptions() + "</select></label>" +
          '<label class="olc-sel" data-show-wrap><span class="olc-lab">Show</span><select data-show>' + [["all", "All layers"], ["empty", "Empty"], ["drafted", "Drafted"]].map(([v, l]) =>
            '<option value="' + v + '"' + (S.f.show === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label></span>" +
        '<span class="olc-spacer"></span>' +
        '<div class="olc-pop"><button type="button" class="olc-btn" data-cols aria-expanded="false" aria-controls="olc-cols">Columns <span class="olc-mono" data-cols-n></span></button>' +
          '<div class="olc-popover" id="olc-cols" data-cols-pop hidden></div></div>' +
        '<button type="button" class="olc-btn" data-csv title="The rows and columns shown, as a CSV file made here (keys and source facts; no notes)">Export CSV</button>' +
      "</div>" +
      '<div class="olc-bulk" data-bulk role="group" aria-label="Rows chosen" hidden></div>' +
      '<div class="olc-main"><div class="olc-tablewrap" data-wrap><table class="olc-grid" aria-label="Layer registry" data-grid><thead></thead><tbody></tbody></table></div>' +
        '<aside class="olc-detail" aria-label="Layer detail" data-detail hidden></aside></div>' +
      mapsShell() +
      '<p class="olc-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>[</kbd><kbd>]</kbd> detail tabs</span><span><kbd>x</kbd> choose</span><span><kbd>e</kbd> write a note</span><span><kbd>/</kbd> search</span><span><kbd>Esc</kbd> close</span>' +
        '<span class="olc-spacer"></span><span class="olc-said" role="status" data-said></span><span data-read></span></p>' +
      "</section>";
  }
  function phoneHtml() {
    return '<section class="olc-phone" data-ops="registry-phone" aria-label="Layers"><p class="ops-line">The full registry, its filters and each layer\'s detail are for a larger screen. ' +
      rows.length + ' layers, by name. Advisor notes can be written on a phone from <a href="' + esc(FP.href("#/layers")) + '">Layer notes</a>.</p><ul>' + M.sort(rows, "name", 1).map((r) => '<li><b>' + esc(r.name) + '</b><span class="olc-mono">' + esc(r.key) + "</span><span>" +
        esc(M.STATUS_WORD[r.status]) + (r.shown === false ? " · held back" : "") + "</span></li>").join("") + "</ul></section>";
  }

  function drawTable(focusEdit = false) {
    const ctx = ctxNow(), cols = S.cols.map((id) => M.COL[id]).filter(Boolean);
    const shown = M.sort(M.filter(rows, S.f, ctx), S.sort.col, S.sort.dir, ctx), groups = M.group(shown, S.group);
    order = groups.flatMap((g) => g.rows);
    const at = order.findIndex((r) => r.id === S.open);
    S.cursor = at >= 0 ? at : Math.min(S.cursor, Math.max(0, order.length - 1));
    const grid = root.querySelector("[data-grid]");
    const allChosen = order.length > 0 && order.every((r) => S.sel.has(r.id));
    grid.querySelector("thead").innerHTML = '<tr><th scope="col" class="olc-cb"><input type="checkbox" data-sel-all aria-label="Choose every row shown"' + (allChosen ? " checked" : "") + "></th>" + cols.map((c) => '<th scope="col" class="' + [c.num && "olc-num", c.id === "status" && "olc-mk"].filter(Boolean).join(" ") + '" aria-sort="' +
      (S.sort.col === c.id ? (S.sort.dir > 0 ? "ascending" : "descending") : "none") + '"' + (c.title ? ' title="' + esc(c.title) + '"' : "") + '><button type="button" data-sort="' + c.id + '">' +
      (c.id === "status" ? '<span class="olc-sr">Status</span>' : esc(c.label)) + '<span class="olc-arrow" aria-hidden="true">' + (S.sort.col === c.id ? (S.sort.dir > 0 ? "▲" : "▼") : "") + "</span></button></th>").join("") + "</tr>";
    let html = "", i = 0;
    for (const g of groups) {
      if (g.label !== null) html += '<tr class="olc-ghead"><th scope="rowgroup" colspan="' + (cols.length + 1) + '">' + esc(g.label) + '<span class="olc-roll">' + esc(M.rollText(g.roll)) + "</span></th></tr>";
      for (const r of g.rows) {
        html += '<tr data-id="' + esc(r.id) + '" tabindex="' + (i === S.cursor ? 0 : -1) + '" class="' + [i === S.cursor && "olc-cursor", S.open === r.id && "olc-open"].filter(Boolean).join(" ") + '"' +
          (S.open === r.id ? ' aria-current="true"' : "") + ">" + '<td class="olc-cb"><input type="checkbox" data-sel="' + esc(r.id) + '" aria-label="Choose ' + esc(r.name) + '"' + (S.sel.has(r.id) ? " checked" : "") + "></td>" + cols.map((c) => cell(c, r, ctx)).join("") + "</tr>";
        i++;
      }
    }
    grid.querySelector("tbody").innerHTML = html || '<tr><td colspan="' + (cols.length + 1) + '" class="olc-empty">No layer matches. Clear the search or a filter.</td></tr>';
    const line = root.querySelector("[data-countline]");
    line.textContent = M.countLine(rows, order.length, S.f, failedReads);
    line.setAttribute("data-shown", String(order.length));
    const ta = grid.querySelector("textarea[data-edit]");
    if (ta) { grow(ta); if (focusEdit) { ta.focus({ preventScroll: false }); ta.setSelectionRange(ta.value.length, ta.value.length); } }
  }
  const grow = (ta) => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 240) + "px"; };

  // ---- OPS2b: rows chosen, and what can be done with them (no write) ------------------------------------------------------------------------
  function drawBulk() {
    const el = root.querySelector("[data-bulk]"), n = S.sel.size;
    el.hidden = !n;
    el.innerHTML = !n ? "" : '<span class="olc-bulkn">' + n + (n === 1 ? " row" : " rows") + ' chosen</span><button type="button" class="olc-btn" data-bulk-copy>Copy notes as text</button>' +
      '<button type="button" class="olc-btn" data-bulk-csv title="The rows chosen, with their notes at the scope under Note for">Export CSV with notes</button><button type="button" class="link" data-bulk-clear>Clear</button>';
  }
  const chosen = () => rows.filter((r) => S.sel.has(r.id));
  function choose(id, on) { if (on) S.sel.add(id); else S.sel.delete(id); drawBulk(); const all = root.querySelector("[data-sel-all]"); if (all) all.checked = order.length > 0 && order.every((r) => S.sel.has(r.id)); }

  // ---- OPS2b: a note cell edited in place ----------------------------------------------------------------------------------------------------
  // Nothing is written until Enter or Tab; Esc cancels; a save that fails keeps the text and says why; a save that works reads the
  // note back and shows what is stored (another person's change to another part of it included). Last write wins, as on the notes page.
  function beginEdit(rowId, colId) {
    const r = rows.find((x) => x.id === rowId), c = M.COL[colId], ctx = ctxNow();
    if (!r || !c?.note || !writable(r, ctx)) return false;
    if (S.edit && S.edit.draft.trim() !== (S.edit.original || "").trim() && !(S.edit.row === rowId && S.edit.col === colId)) {
      const m = root.querySelector("[data-cell-msg]"); if (m) m.textContent = "Save (Enter) or cancel (Esc) this cell first.";
      return false;
    }
    S.edit = { ...M.startEdit(rowId, c.note, ctx.scoped.get(r.id)?.note?.[c.note], ++editSeq), col: colId };
    const at = order.findIndex((x) => x.id === rowId); if (at >= 0) S.cursor = at;
    drawTable(true);
    return true;
  }
  let editSeq = 0;
  function endEdit() { const e = S.edit; S.edit = null; drawTable(); if (e) focusRow(e.row); }
  function focusRow(id) { const tr = [...root.querySelectorAll("[data-grid] tbody tr[data-id]")].find((x) => x.getAttribute("data-id") === id); if (tr) { markRows(); tr.focus({ preventScroll: true }); } }
  const label = (field) => (N.FIELDS.find(([k]) => k === field) || [])[1] || field;
  async function saveEdit() {
    const e = S.edit;
    if (!e || e.state === "saving") return false;
    const out = M.commit(e);
    if (out.error) { S.edit = { ...M.failed(e, out.error), col: e.col }; drawTable(true); say("Not saved: " + out.error); return false; }
    if (!out.write) { S.edit = null; return true; }
    const r = rows.find((x) => x.id === e.row), mine = live;
    S.edit = { ...M.saving(e), col: e.col }; drawTable();
    try {
      const saved = await host.writeNote(M.noteTarget(r, input.notes, S.scope), S.scope, out.values);
      // read the note back: what the database holds now is what is shown
      let stored = saved;
      try { const back = await sb.from("layer_notes").select("*").eq("id", saved.id).maybeSingle(); if (!back.error && back.data) stored = back.data; } catch { /* the saved row stands */ }
      if (mine !== live) return false;
      input.notes = [...input.notes.filter((x) => x.id !== stored.id), stored];
      rebuild();
      S.marks.set(markKey(e.row, e.field), { state: "saved" });
      // a late result touches only its own cell: a cell opened since (after Esc) keeps its unsaved text and its focus
      const mineStill = M.sameEdit(S.edit, e);
      if (mineStill) S.edit = null;
      drawChrome(); drawTable(!!S.edit); drawDetail();
      say("Saved " + r.name + ": " + label(e.field) + ".");
      return mineStill;
    } catch (err) {
      if (mine !== live) return false;
      const why = String(err?.message || err || "That change wasn't saved.");
      S.marks.set(markKey(e.row, e.field), { state: "failed" });
      if (M.sameEdit(S.edit, e)) S.edit = { ...M.failed(S.edit, why), col: e.col };
      drawTable(!!S.edit);
      say("Not saved: " + r.name + ", " + label(e.field) + ": " + why.replace(/([^.!?])$/, "$1."));
      return false;
    }
  }

  // ---- OPS2d: the Published maps tab, read the first time it is opened --------------------------------------------------------------------------
  // published_maps, each map's current map_packages row (its manifest) and its versions, as row-level security returns them (staff
  // publishing in two-factor read every map); counted first and capped; never a map's files. Read only.
  function mapsShell() {
    return '<section class="olc-maps" data-maps aria-label="Published maps" hidden>' +
      '<div class="olc-problems" data-maps-problems role="alert" hidden></div>' +
      '<p class="olc-para olc-maps-intro">A published map (published_maps, its current map_packages manifest) carries its own layers as files built in QGIS. Nothing links a map\'s layer to a reference source: ' +
        'a match by title or theme is the console\'s <b>guess</b> and is marked as one. A layer the map takes from core_layers or group_shared_layers is named exactly.</p>' +
      '<div class="olc-tools"><label class="olc-search"><span class="olc-sr">Search maps</span><input type="search" data-maps-q placeholder="Search maps, owners and layer titles" autocomplete="off"></label>' +
        '<span class="olc-spacer"></span><span class="olc-count" data-maps-count aria-live="polite"></span></div>' +
      '<div class="olc-main"><div class="olc-tablewrap"><table class="olc-grid" aria-label="Published maps" data-maps-grid><thead></thead><tbody></tbody></table></div>' +
        '<aside class="olc-detail" aria-label="Map detail" data-map-detail hidden></aside></div></section>';
  }
  async function readMaps() {
    const problems = [], note = (what, r) => { if (r.failed) problems.push({ failed: true, text: "Couldn't read " + what + ": its rows are missing." });
      else if (r.capped) problems.push({ failed: false, text: "Cut short: " + what + ", the first " + M.num(r.rows.length) + " of " + M.num(r.total) + "." }); return r; };
    const maps = note("the published maps (published_maps)", await soft(counted("published_maps", "id,farm_id,org_id,slug,title,kind,archived_at,created_at", (q) => q.order("title"), CAP.maps)));
    const ids = maps.rows.map((m) => m.id), packages = [], versions = [];
    let pFailed = false, pCapped = false, vFailed = false, vCapped = false, pTotal = 0, vTotal = 0;
    for (const part of chunks(ids)) {
      const p = await soft(counted("map_packages", "id,map_id,version,manifest,storage_prefix,is_current,survey_date,published_at", (q) => q.eq("is_current", true).in("map_id", part), CAP.ids));
      packages.push(...p.rows); pFailed ||= !!p.failed; pCapped ||= p.capped; pTotal += p.total;
      const v = await soft(counted("map_packages", "map_id", (q) => q.in("map_id", part), CAP.mapVersions));
      versions.push(...v.rows); vFailed ||= !!v.failed; vCapped ||= v.capped; vTotal += v.total;
    }
    note("the maps' current packages (map_packages)", { failed: pFailed, capped: pCapped, rows: packages, total: pTotal });
    note("the maps' versions (map_packages)", { failed: vFailed, capped: vCapped, rows: versions, total: vTotal });
    const named = await soft(Promise.all([byIds("organisations", "id,name", maps.rows.map((m) => m.org_id)), byIds("farms", "id,name", maps.rows.map((m) => m.farm_id))])
      .then(([orgs, farms]) => ({ rows: [{ orgs, farms }], total: 1, capped: false })));
    if (named.failed) problems.push({ failed: true, text: "Couldn't read the owners' names (organisations, farms): Owner says only Group or Farm." });
    const { orgs = [], farms = [] } = named.rows[0] || {};
    return { rows: M.mapsRows(maps.rows, packages, versions, { orgs: Object.fromEntries(orgs.map((o) => [o.id, o.name])), farms: Object.fromEntries(farms.map((f) => [f.id, f.name])) }),
      problems, packagesFailed: pFailed };
  }
  function setCtab(tab) {
    S.ctab = tab;
    root.setAttribute("data-catalogue", tab);
    root.querySelectorAll("[data-ctab]").forEach((b) => { if (b.matches("button")) { b.setAttribute("aria-selected", String(b.getAttribute("data-ctab") === tab)); b.tabIndex = b.getAttribute("data-ctab") === tab ? 0 : -1; } });
    root.querySelector("[data-maps]").hidden = tab !== "maps";
    if (tab === "maps" && !SM.state) loadMapsTab();
    drawMaps();
  }
  async function loadMapsTab() {
    const mine = live;
    SM.state = "loading"; drawMaps();
    try { const got = await readMaps(); if (mine !== live) return; Object.assign(SM, got, { state: "done" }); }
    catch (e) { if (mine !== live) return; Object.assign(SM, { state: "error", error: e?.message || String(e) }); }
    drawMaps();
  }
  function drawMaps() {
    if (!root) return;
    const sec = root.querySelector("[data-maps]");
    root.querySelector("[data-maps-n]").textContent = SM.state === "done" ? String(SM.rows.length) : "";
    const band = sec.querySelector("[data-maps-problems]"), grid = sec.querySelector("[data-maps-grid]");
    const probs = SM.state === "error" ? [{ failed: true, text: "Couldn't read the published maps: " + SM.error + "." }] : SM.problems || [];
    band.hidden = !probs.length;
    band.innerHTML = !probs.length ? "" : "<ul>" + probs.map((p) => "<li" + (p.failed ? " data-failed" : "") + ">" + esc(p.text) + "</li>").join("") + "</ul>" +
      (probs.some((p) => p.failed) ? '<button type="button" class="olc-btn" data-maps-retry>Try again</button>' : "");
    if (SM.state !== "done") { grid.querySelector("thead").innerHTML = ""; grid.querySelector("tbody").innerHTML = SM.state === "loading" ? '<tr><td class="olc-empty">Reading the published maps…</td></tr>' : ""; drawMapDetail(); return; }
    const shown = M.sortMaps(M.filterMaps(SM.rows, SM.q), SM.sort.col, SM.sort.dir);
    grid.querySelector("thead").innerHTML = "<tr>" + M.MAP_COLUMNS.map((c) => '<th scope="col" class="' + (c.num ? "olc-num" : "") + '" aria-sort="' + (SM.sort.col === c.id ? (SM.sort.dir > 0 ? "ascending" : "descending") : "none") +
      '"><button type="button" data-msort="' + c.id + '">' + esc(c.label) + '<span class="olc-arrow" aria-hidden="true">' + (SM.sort.col === c.id ? (SM.sort.dir > 0 ? "▲" : "▼") : "") + "</span></button></th>").join("") + '<th scope="col"><span class="olc-sr">Marks</span></th></tr>';
    grid.querySelector("tbody").innerHTML = shown.map((m) => '<tr data-map-id="' + esc(m.id) + '" class="' + (SM.open === m.id ? "olc-open" : "") + '"' + (SM.open === m.id ? ' aria-current="true"' : "") + ">" +
      M.MAP_COLUMNS.map((c) => { const t = c.text(m); return '<td data-mc="' + c.id + '" class="' + (c.num ? "olc-num" : "") + (c.id === "title" ? " olc-name" : "") + '" title="' + esc(t) + '">' +
        (c.id === "title" ? '<button type="button" class="olc-namebtn" data-open-map>' + esc(t) + "</button>" : !t ? dim("—") : c.mono || c.num ? mono(t) : esc(t)) + "</td>"; }).join("") +
      "<td>" + (m.archived ? tag("archived", "line") + " " : "") + (m.noPackage ? tag("no current package", "warn") + " " : "") + (list2(m.manifest?.shared_layers).length ? tag("shares layers", "line") : "") + "</td></tr>").join("") ||
      '<tr><td colspan="' + (M.MAP_COLUMNS.length + 1) + '" class="olc-empty">' + (SM.rows.length ? "No map matches. Clear the search." : "No published map is readable here.") + "</td></tr>";
    sec.querySelector("[data-maps-count]").textContent = (SM.q.trim() ? "Showing " + M.num(shown.length) + " of " : "") + M.num(SM.rows.length) + (SM.rows.length === 1 ? " map" : " maps");
    drawMapDetail();
  }
  const list2 = (v) => (Array.isArray(v) ? v : []);
  function drawMapDetail() {
    const el = root.querySelector("[data-map-detail]"), m = SM.state === "done" ? SM.rows.find((x) => x.id === SM.open) : null;
    el.hidden = !m;
    if (!m) { el.innerHTML = ""; return; }
    const layers = M.manifestLayers(m.manifest, input.sources), groups = new Set(layers.map((L) => L.group).filter(Boolean));
    const regCell = (L) => L.registry.kind === "guess" ? tag(L.registry.text, "warn") + ' <span class="olc-sr">a guess</span>' : L.registry.kind === "exact" ? tag(L.registry.text) : dim(L.registry.text);
    el.innerHTML = '<div class="olc-dhead"><div class="olc-dtop"><h3 title="' + esc(m.title) + '">' + esc(m.slug || m.title) + " " + dim("· " + m.owner + (m.version ? " · package " + m.version : "")) + "</h3>" +
        '<button type="button" class="olc-btn" data-map-close aria-label="Close the map" title="Close (Esc)">✕</button></div></div>' +
      '<div class="olc-dbody" data-map-body>' + kv([["Title", esc(m.title)], ["Owner", esc(m.owner) + " " + dim("(" + m.ownerKind + ")")], ["Kind", m.kind ? esc(m.kind) : dim("—")],
        ["Storage prefix", m.prefix ? mono(m.prefix) : dim("—")], ["Published", m.published ? mono(M.day(m.published)) : dim("—")], ["Published by", notStored("(a package keeps when, not who)")],
        ["Survey", m.survey ? mono(M.day(m.survey) || m.survey) : dim("—")], ["Versions", mono(String(m.versions))],
        ["Manifest", m.noPackage ? dim("no current package") : mono(layers.length + (layers.length === 1 ? " layer" : " layers") + " · " + groups.size + (groups.size === 1 ? " group" : " groups"))]]) +
      (SM.packagesFailed ? para(dim("The maps' packages could not be read, so no layers are listed.")) : !layers.length ? para(dim(m.noPackage ? "This map has no current package." : "Its manifest lists no layers.")) :
        '<h3>Layers <span class="olc-srcnote">the current package\'s manifest, in its order</span></h3><div class="olc-scroll"><table class="olc-mini" data-map-layers><thead><tr><th scope="col">Layer</th><th scope="col">Panel group</th><th scope="col">Geometry</th>' +
        '<th scope="col">Style</th><th scope="col">Default</th><th scope="col">In the registry as</th></tr></thead><tbody>' +
        layers.map((L) => "<tr><td>" + esc(L.title) + "</td><td>" + (L.group ? esc(L.group) : dim("—")) + '</td><td class="olc-mono">' + esc(L.geom || "") + "</td><td>" + esc(L.style) + "</td><td>" + (L.on ? "on" : dim("off")) +
          "</td><td>" + regCell(L) + "</td></tr>").join("") + "</tbody></table></div>" +
        '<p class="olc-srcnote">A title or theme match is the console\'s guess, shown so a person can confirm it. Storing the match would need a source key on the manifest layer, written by the QGIS publish tool.</p>') + "</div>";
  }

  function colsPopover() {
    const pop = root.querySelector("[data-cols-pop]"), btn = root.querySelector("[data-cols]");
    pop.hidden = !S.colsOpen; btn.setAttribute("aria-expanded", String(S.colsOpen));
    if (!S.colsOpen) return;
    const view = M.VIEWS.find((v) => v.id === S.f.view);
    pop.innerHTML = '<p class="olc-pophead">Columns in ' + esc(view.label) + ", kept on this device · where each comes from</p>" + M.COLUMNS.filter((c) => !c.always).map((c) =>
      '<label><input type="checkbox" data-col="' + c.id + '"' + (S.cols.includes(c.id) ? " checked" : "") + "> " + esc(c.label) + ' <span class="olc-src">' + (c.src === "computed" ? "computed" : "stored") + "</span></label>").join("") +
      '<p class="olc-pophead">Status and name are always shown. Columns for values not stored today are left out.</p><button type="button" class="link" data-cols-reset>Back to this view\'s columns</button>';
  }

  // ---- the detail panel ------------------------------------------------------------------------------------------------------------------
  const kv = (pairs) => '<dl class="olc-kv">' + pairs.filter(Boolean).map(([k, v]) => "<dt>" + esc(k) + "</dt><dd>" + v + "</dd>").join("") + "</dl>";
  const copyBtn = (v, label) => '<button type="button" class="olc-copy" data-copy="' + esc(v) + '" data-copy-what="' + esc(label) + '">Copy' + (label ? " " + esc(label) : "") + "</button>";
  const urlbox = (u, label) => '<div class="olc-url"><code title="' + esc(u) + '">' + esc(u) + "</code>" + copyBtn(u, label) + "</div>";
  const para = (t) => '<p class="olc-para">' + t + "</p>";
  const notStored = (what) => '<span class="olc-need">not stored</span> <span class="olc-srcnote">' + esc(what) + "</span>";
  const stat = (v, l) => '<div class="olc-stat"><b>' + esc(v ?? "—") + "</b><span>" + esc(l) + "</span></div>";
  const v = (x) => (x === null || x === undefined || x === "" ? dim("—") : esc(x));
  const m = (x) => (x === null || x === undefined || x === "" ? dim("—") : mono(x));
  const EPSG = "EPSG:2193";
  const HEX = /^#[0-9a-f]{6}$/i;

  // Reads the open layer needs (its load history, its current version's extent, an owned layer's QGIS style), once each, kept for the visit
  function need(r, what) {
    const k = r.id + ":" + what;
    if (cache.has(k)) return cache.get(k);
    const entry = { state: "loading" }, mine = live;
    cache.set(k, entry);
    const fetch = {
      history: () => counted("reference_refreshes", HISTORY_COLS, (q) => q.eq("source_key", r.key).order("started_at", { ascending: false }), CAP.history),
      version: async () => {
        const { data, error } = await sb.from("dataset_versions").select("version_no,geometry_kind,as_at,loaded_at,coverage,extent_stated,extent")
          .eq(r.cat === "ref" ? "source_key" : "layer_id", r.cat === "ref" ? r.key : r.mapLayerId).is("superseded_at", null).limit(1);
        if (error) throw error;
        return (data || [])[0] || null;
      },
      qml: async () => {
        const { data, error } = await sb.from("map_layers").select("id,style").eq("id", r.mapLayerId).limit(1);
        if (error) throw error;
        const qml = (data || [])[0]?.style?.qml;
        return typeof qml === "string" && qml.trim() !== "";
      },
    }[what];
    Promise.resolve().then(fetch).then((val) => { entry.state = "done"; entry.value = val; }, (e) => { entry.state = "error"; entry.error = e?.message || String(e); })
      .then(() => { if (mine === live && S?.open === r.id) drawDetail(); });
    return entry;
  }
  const waiting = (entry, what) => (entry.state === "loading" ? para(dim("Reading " + what + "…")) : entry.state === "error" ? para(dim("Couldn't read " + what + ": " + entry.error)) : null);

  const T = {
    overview(r) {
      const catLine = { ref: "reference_sources · its features are held in reference_features", core: "core_layers · vector tiles offered on every published map",
        group: "group_shared_layers · a group's tiles, read by its members and member farms", own: "map_layers · " + (r.orgId ? "a group's" : "a farm's") + " layer loaded from QGIS" }[r.cat];
      const s = r.raw || {};
      if (r.cat === "ref") {
        const j = r.job, run = j && FP.opsModel?.runUrl?.(j.lastRunUrl), flow = j && FP.opsModel?.links?.workflow?.(j.workflow);
        return "<h3>Identity</h3>" + kv([["Name", esc(r.name)], ["Key", mono(r.key) + " " + copyBtn(r.key, "key")], ["Catalogue", esc(catLine)], ["Provider", v(r.provider)], ["Theme", m(r.theme)],
            ["Claim", [s.epistemic_class, s.scale, s.accuracy].filter(Boolean).map(esc).join(" · ") || dim("—")],
            ["Coverage held", m(r.coverage) + (s.fetch_extent ? " · pulled within " + mono(s.fetch_extent) : "")]]) +
          (s.summary ? "<h3>Summary</h3>" + para(esc(s.summary)) : "") +
          "<h3>Source</h3>" + (r.serviceUrl ? urlbox(r.serviceUrl, "address") : para(dim("No service address is recorded."))) +
          kv([["Service kind", m(r.service)], ["Layer id", r.layerId ? mono(r.layerId) + " " + copyBtn(r.layerId, "layer id") : dim("—")],
            ["Id", r.idField ? mono(r.idField) : r.idDerive.length ? "derived from " + r.idDerive.map(mono).join(", ") : dim("—")],
            s.keep_duplicate_ids && ["Repeated ids", "kept, each with a suffix (keep_duplicate_ids)"],
            s.fetch_where && ["Where", mono(s.fetch_where)], s.fetch_tile_m && ["Pulled in squares of", mono(M.num(s.fetch_tile_m) + " m")],
            s.api_key_secret && ["API key setting", mono(s.api_key_secret) + " " + dim("(the name of the setting; the key itself is never stored)")],
            ["Context distance", r.context === null ? dim("—") : mono(M.num(r.context) + " m") + " " + dim("beyond a farm (context_buffer_m)")],
            ["Refresh", j ? mono(j.key) + " · " + esc(M.JOB_WORD[j.state]) + (j.state === "off" ? " " + dim("(no timer: run by hand from Actions" + (j.workflow ? ", " + j.workflow : "") + ")") : "") +
              (j.cadence ? " · " + dim("expected every " + Math.round(j.cadence / 24) + " days + " + Math.round((j.grace || 0) / 24) + " days' grace while on a timer") : "") +
              (flow ? ' · <a href="' + esc(flow) + '" target="_blank" rel="noopener noreferrer">the workflow</a>' : "") + (run ? ' · <a href="' + esc(run) + '" target="_blank" rel="noopener noreferrer">the last run</a>' : "")
              : dim("no job is recorded for it: loaded by hand")]]) +
          "<h3>Licence</h3>" + kv([["Status", r.licenceStatus === "open" ? esc("open") : r.licenceStatus ? tag(r.licenceStatus.replace(/_/g, " "), "warn") : dim("—")], ["Licence", v(r.licence)],
            ["Attribution", v(r.attribution)], ["Provider's wording", r.rights ? tag("changed at the last pull: re-check the licence", "warn") : dim("unchanged at the last pull")]]);
      }
      if (r.cat === "core") return "<h3>Identity</h3>" + kv([["Title", esc(r.name)], ["Key", mono(r.key) + " " + copyBtn(r.key, "key")], ["Catalogue", esc(catLine)], ["Source", v(r.provider)],
          ["Panel group", v(r.theme)], ["As at", m(M.day(r.asAt))], ["Row written", m(M.day(r.raw.created_at))]]) +
        "<h3>Source</h3>" + kv([["Tiles", r.layerId ? mono(r.layerId) + " " + copyBtn(r.layerId, "path") : dim("—")], ["Drawn as", m(r.draw)], ["On every map", r.everyMap ? "yes" : dim("no")],
          ["Starts on", r.startsOn ? "yes, when a group's map first opens" : dim("no")], ["File hash", r.sha256 ? mono(r.sha256.slice(0, 12) + "…") : dim("—")],
          ["Refresh", esc("by hand: tools/build_core_layer.py, then tools/load_core_reference.py --batch")]]) +
        "<h3>Licence</h3>" + kv([["Licence", v(r.licence)], ["Credit", v(r.attribution)]]);
      if (r.cat === "group") return "<h3>Identity</h3>" + kv([["Title", esc(r.name)], ["Key", mono(r.key) + " " + copyBtn(r.key, "key")], ["Catalogue", esc(catLine)], ["Group", v(r.provider)],
          ["Panel group", v(r.theme)], ["As at", m(M.day(r.asAt))], ["Row written", m(M.day(r.raw.created_at))]]) +
        "<h3>Source</h3>" + kv([["Tiles", r.layerId ? mono(r.layerId) + " " + copyBtn(r.layerId, "path") : dim("—")], ["Refresh", esc("by hand: published from QGIS")]]) +
        "<h3>Licence</h3>" + para(dim("A group's own layer: no licence is recorded in the registry."));
      return "<h3>Identity</h3>" + kv([["Name", esc(r.name)], ["Key", mono(r.key) + " " + copyBtn(r.key, "key")], ["Layer id", mono(r.mapLayerId) + " " + copyBtn(r.mapLayerId, "id")], ["Catalogue", esc(catLine)],
          ["Owner", v(r.provider)], ["Theme", m(r.theme)], ["Claim", [s.epistemic_class, s.scale].filter(Boolean).map(esc).join(" · ") || dim("—")]]) +
        "<h3>Source</h3>" + kv([["Source", v(s.source)], ["File", m(s.source_file)], ["Method", v(s.method)], ["Loaded", m(M.day(s.created_at))], ["Refresh", esc("by hand: tools/load_layers.py from the QGIS file")]]);
    },
    schema(r) {
      if (r.cat === "core" || r.cat === "group") return para("The fields kept in the tiles are chosen when the tiles are built (" + (r.cat === "core" ? "tools/core_layers/layers.json" : "the QGIS publish") + "); the registry does not store them.");
      if (r.cat === "own") return para("An owned layer's fields are its features' own (map_features.props), as the QGIS file had them; the registry reads no features, and no field list is stored for the layer.");
      const derived = new Set(r.idDerive), dropped = r.dropped;
      const rowsHtml = r.fields.map((f) => '<tr><td class="olc-mono">' + esc(f.field) + (f.field === r.idField ? " " + tag("id field", "ok") : derived.has(f.field) ? " " + tag("part of the id", "line") : "") + "</td>" +
        '<td class="olc-mono">' + esc(f.type || "") + "</td><td>" + esc([f.label, f.meaning].filter(Boolean).join(": ")) + "</td><td>" + esc(f.unit || "") + "</td><td>kept</td></tr>").join("");
      const listed = new Set(r.fields.map((f) => f.field));
      const idOnly = [r.idField, ...r.idDerive].filter((f) => f && !listed.has(f)).map((f) => '<tr><td class="olc-mono">' + esc(f) + " " + tag(f === r.idField ? "id field" : "part of the id", f === r.idField ? "ok" : "line") +
        "</td><td></td><td>" + dim("not in the dictionary") + "</td><td></td><td>kept</td></tr>").join("");
      const dropRows = dropped.map((d) => '<tr class="olc-dropped"><td class="olc-mono">' + esc(d) + "</td><td></td><td>" + dim("never kept (drop_fields)") + "</td><td></td><td>dropped</td></tr>").join("");
      return para("The data dictionary (reference_sources.fields), merged from the service's own field list on each pull; the meanings are RCL's. Fields named in drop_fields are never kept. " +
          "The id field is the one that ties a feature from one pull to the next. Which other layer a field joins to is " + notStored("(only in notes and migration comments)") + ".") +
        (rowsHtml || idOnly || dropRows ? '<div class="olc-scroll"><table class="olc-mini"><thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Label and meaning</th><th scope="col">Unit</th><th scope="col">Kept</th></tr></thead><tbody>' +
          rowsHtml + idOnly + dropRows + "</tbody></table></div>" : para(dim("The dictionary is empty for this source.")));
    },
    data(r) {
      const crs = r.cat === "core" || r.cat === "group" ? "web tiles (PMTiles)" : EPSG;
      const stats = '<div class="olc-stats">' + stat(r.features === null ? "—" : M.num(r.features), r.features === null ? "features: not stored" : "features" + (r.cat === "ref" ? " (feature_count)" : "")) +
        stat(r.geom || "—", "geometry") + stat(crs, r.cat === "ref" || r.cat === "own" ? "CRS (NZTM, by the schema)" : "how it is served") + stat(M.day(r.asAt) || "—", r.cat === "ref" ? "as at: the last successful refresh" : "as at") + "</div>";
      if (r.cat === "core" || r.cat === "group") return stats + "<h3>File</h3>" + kv([["Tiles", m(r.layerId)], ["Size", r.size === null ? notStored("") : mono((r.size / 1048576).toFixed(1) + " MB")],
          r.cat === "core" && ["File hash", r.sha256 ? mono(r.sha256) : dim("—")]]) +
        "<h3>Load history</h3>" + para(notStored("a load log for tiles: the row keeps only the latest file and its as-at date"));
      return stats + extentBlock(r) + (r.cat === "ref" ? historyBlock(r) : "<h3>Load history</h3>" + para(notStored("a load log for owned layers: map_layers keeps when the row was written and its as-at date")));
    },
    visibility(r) {
      if (r.cat === "ref") {
        const s = r.raw || {};
        return "<h3>Customers</h3>" + (r.shown ? para("<b>Shown.</b> Anyone signed in reads its features on a map; a farm's map opens with those within " + (r.context === null ? "its context distance" : mono(M.num(r.context) + " m")) + " of the farm.")
            : para(tag("held back", "warn") + " While held back nobody reads its features in the app, staff included (the rule on reference_features); only the tools and named database functions do.")) +
          para(dim("The database refuses shown unless the licence status is open (a check on reference_sources). Who may change it is not on this page.")) +
          kv([["Licence status", r.licenceStatus ? esc(r.licenceStatus.replace(/_/g, " ")) : dim("—")], ["Recorded note", s.notes ? esc(s.notes) : dim("none")],
            ["Never kept", r.dropped.length ? r.dropped.map(mono).join(", ") : dim("no field is dropped")], ["Why held back, as a field", notStored("only in the recorded note")]]) +
          "<h3>Who reads what</h3>" + para("The catalogue row (its licence and dictionary) is read by anyone signed in, even while held back. Its advisor notes: RCL's by everyone signed in; a group's by the group and its member farms; a farm's by that farm's people.");
      }
      if (r.cat === "core") return "<h3>Customers</h3>" + para(r.shown ? "<b>Offered</b> on every published map, off until a person switches it on." + (r.startsOn ? " It starts on when a group's map first opens on a device." : "") : tag("withdrawn", "warn") + " Marked not offered (style.reference.offered): maps leave it out.") +
        para(dim("core_layers rows are read by anyone signed in; the tiles are signed with each map's own files."));
      if (r.cat === "group") return "<h3>Who reads it</h3>" + para("The group's members, and the people of its member farms (the policy on group_shared_layers); a parent group's members when it is shared up to them.");
      return "<h3>Who reads it</h3>" + para((r.orgId ? "The group's members" : "The farm's people") + " (the policies on map_layers and map_features); RCL staff where they are members. No customer setting is stored for an owned layer.");
    },
    style(r) {
      if (r.cat === "core" || r.cat === "group") return "<h3>Look</h3>" + para("It carries its own MapLibre style and legend (" + (r.cat === "core" ? "core_layers.style.reference.style, from tools/core_layers/layers.json" : "the QGIS publish") + "). Layer looks do not apply to tiles.") +
        "<h3>Legend</h3>" + legend(r.legend.map((e) => ({ label: e.label, colour: [e.fill, e.line, e.color, e.outline].find((c) => HEX.test(String(c || ""))) || null })), r.geom);
      const qml = r.cat === "own" ? need(r, "qml") : null;
      const win = r.look === "reviewed" ? 0 : r.look === "theme" ? 1 : qml?.state === "done" && qml.value ? 2 : 3;
      const ladder = [["Its reviewed look (layer_styles, reviewed, for this " + (r.cat === "own" ? "layer" : "source") + ")", true], ["The reviewed default for its theme" + (r.theme ? " (" + r.theme + ")" : ""), true],
        ["Its QGIS style (map_layers.style.qml)", r.cat === "own"], ["The app's own rule for its theme", true]];
      const rec = r.lookRecord;
      return "<h3>Which look applies</h3><ol class=\"olc-ladder\">" + ladder.map(([l, applies], i) => '<li class="' + (i === win ? "olc-win" : "") + (applies ? "" : " olc-na") + '">' + esc(l) +
          (i === 2 && r.cat === "own" && qml?.state === "loading" ? " " + dim("(reading…)") : "") + (!applies ? " " + dim("(owned layers only)") : "") + (i === win ? ' <span class="olc-applies">applies</span>' : "") + "</li>").join("") + "</ol>" +
        (r.lookProposed ? para(tag("proposed", "warn") + " A look was proposed" + (M.day(r.lookProposed.proposed_at) ? " on " + esc(M.day(r.lookProposed.proposed_at)) : "") + " and waits for a decision; it is not drawn. " +
          '<a href="' + esc(FP.href("#/ops/looks")) + '">Open Looks</a>') : "") +
        (rec ? "<h3>The record</h3>" + kv([["What it is the look of", rec.source_key ? "this source" : rec.layer_id ? "this layer" : "the theme " + mono(rec.theme)], ["Classified by", m(rec.classify_by)], ["Label", m(rec.label_field)],
            ["Zoom range", rec.min_zoom == null && rec.max_zoom == null ? dim("any") : mono((rec.min_zoom ?? 0) + " – " + (rec.max_zoom ?? 24))], ["Reviewed", m(M.day(rec.reviewed_at))], ["Purpose", v(rec.purpose)]]) +
          "<h3>Legend</h3>" + legend([...(Array.isArray(rec.classes) ? rec.classes : []).map((c) => ({ label: c?.label || c?.value, colour: [c?.fill, c?.line].find((x) => HEX.test(String(x || ""))) || null })),
            ...(rec.symbol && (HEX.test(String(rec.symbol.fill || "")) || HEX.test(String(rec.symbol.line || ""))) ? [{ label: rec.classes?.length ? "Everything else" : r.name, colour: HEX.test(String(rec.symbol.fill || "")) ? rec.symbol.fill : rec.symbol.line }] : [])], r.geom)
          : para(dim(r.look === "none" ? "No reviewed look: the map uses " + (win === 2 ? "its QGIS style." : "the app's own rule for its theme.") : "")));
    },
    notes(r) {
      const me = FP.ops.user()?.id, here = M.noteAt(r, input.notes, S.scope);
      const block = (n) => { const by = N.byline(n, me); const parts = N.FIELDS.filter(([k]) => typeof n[k] === "string" && n[k].trim());
        return '<div class="olc-noteblock"><p class="olc-notehead"><b>' + esc(by?.text || "A note") + "</b></p><dl class=\"olc-kv\">" + parts.map(([k, label]) => "<dt>" + esc(label) + "</dt><dd>" + esc(n[k]) + "</dd>").join("") + "</dl></div>"; };
      const readable = r.notes.all.slice().sort((a, b) => ({ global: 0, group: 1, farm: 2 }[a.scope] - { global: 0, group: 1, farm: 2 }[b.scope]));
      const editor = failedReads.includes("notes") ? para(dim("The notes could not be read, so none can be written here now: Try again above."))
        : !r.noteKey ? para(dim(here.why)) : !scopes.length ? para(dim("You can write no note here.")) :
        '<form class="olc-noteform" data-note-form><label class="olc-field"><span><b>Note for</b></span><select data-scope>' + scopeOptions() + "</select></label>" +
        (!here.editable ? para(dim(here.why || "Not at this scope.")) :
          N.FIELDS.map(([k, label, hint]) => '<label class="olc-field"><span><b>' + esc(label) + "</b> <small>" + esc(hint) + "</small></span>" +
            '<textarea name="' + k + '" rows="' + (k === "notes" ? 4 : 2) + '">' + esc(here.note?.[k] || "") + "</textarea></label>").join("") +
          '<p class="olc-actions"><button type="submit" class="primary">Save note</button>' + (here.note ? ' <button type="button" class="link" data-note-remove>Remove this note</button>' : "") + "</p>") +
        '<p class="msg" role="status" data-note-msg>' + (here.note ? esc(N.byline(here.note, me)?.text || "") : "") + "</p></form>";
      return para("What each layer is, what it is useful for, its caveats, and when to show it to a catchment group. The narrowest note applies: a farm's over its group's over RCL's. Ask reads them as advisor guidance.") +
        "<h3>Notes you can read</h3>" + (readable.length ? readable.map(block).join("") : para(dim(r.noteKey ? "None yet." : "Tiles take no note."))) +
        "<h3>Write</h3>" + editor;
    },
  };
  function legend(entries, geom) {
    const shown = entries.filter((e) => e && (e.label || e.colour)).slice(0, 40);
    if (!shown.length) return para(dim("No legend is stored."));
    return '<div class="olc-legend">' + shown.map((e) => '<div><span class="olc-sw' + (geom === "point" ? " olc-pt" : geom === "line" ? " olc-ln" : "") + '"' + (e.colour ? ' style="background:' + e.colour + '"' : "") + "></span>" + esc(e.label ?? "") + "</div>").join("") + "</div>";
  }
  function extentBlock(r) {
    const entry = need(r, "version"), wait = waiting(entry, "the current version");
    if (wait) return "<h3>Extent</h3>" + wait;
    const ver = entry.value;
    if (!ver) return "<h3>Extent</h3>" + para(dim("No dataset version is recorded for it, so its extent is not known here."));
    const pic = M.extentPicture(ver.extent, r.raw?.fetch_extent || null, 280, 200);
    const svg = pic ? '<svg class="olc-extent" viewBox="0 0 ' + pic.w + " " + pic.h + '" width="' + pic.w + '" height="' + pic.h + '" role="img" aria-label="The extent, north up' + (pic.fetch ? ", inside the pull extent" : "") + '">' +
      '<rect class="olc-ex-ground" x="0" y="0" width="' + pic.w + '" height="' + pic.h + '"></rect>' +
      (pic.fetch ? '<rect class="olc-ex-fetch" x="' + pic.fetch.x + '" y="' + pic.fetch.y + '" width="' + pic.fetch.w + '" height="' + pic.fetch.h + '"></rect>' : "") +
      pic.paths.map((d) => '<path class="olc-ex-shape" d="' + esc(d) + '"></path>').join("") + "</svg>" : para(dim("The extent could not be drawn."));
    return '<div class="olc-two"><div><h3>Extent</h3>' + svg + '<p class="olc-srcnote">dataset_versions.extent' + (pic?.fetch ? "; dashed: the pull extent (fetch_extent)" : "") + "</p></div><div><h3>Shape</h3>" +
      kv([["Box (NZTM)", pic?.bbox ? mono(pic.bbox.map((n) => M.num(n)).join(", ")) : dim("—")], ["Worked out", ver.extent_stated ? "stated" : "from the data"], ["Version", m(ver.version_no)],
        ["Loaded", m(M.day(ver.loaded_at))], ["Coverage", m(ver.coverage)], ["Pull extent", r.raw?.fetch_extent ? mono(r.raw.fetch_extent) : dim("the whole layer")], ["Size on disk", notStored("")]]) + "</div></div>";
  }
  function historyBlock(r) {
    const entry = need(r, "history"), wait = waiting(entry, "the load history");
    if (wait) return "<h3>Load history</h3>" + wait;
    const h = entry.value, list = h.rows;
    if (!list.length) return "<h3>Load history</h3>" + para(dim("No pull is recorded."));
    const n = (x) => '<td class="olc-num olc-mono">' + (x == null ? "" : esc(M.num(x))) + "</td>";
    const word = (x) => (x.status === "failed" ? tag("failed", "bad") : x.status === "unchanged" ? dim("unchanged") : esc(x.status)) + (x.partial ? " " + tag("part", "line") : "") + (x.first_pull ? " " + tag("first pull", "line") : "") +
      (x.rights_changed ? " " + tag("rights wording changed", "warn") : "");
    return "<h3>Load history <span class=\"olc-srcnote\">reference_refreshes, newest first" + (h.capped ? ": the latest " + list.length + " of " + h.total : "") + "</span></h3>" +
      '<div class="olc-scroll"><table class="olc-mini"><thead><tr><th scope="col">Started</th><th scope="col">Result</th><th scope="col" class="olc-num">Added</th><th scope="col" class="olc-num">Changed</th>' +
      '<th scope="col" class="olc-num">Removed</th><th scope="col" class="olc-num">Unchanged</th><th scope="col" class="olc-num">Skipped</th><th scope="col" class="olc-num">Repeated ids</th><th scope="col">Archive</th></tr></thead><tbody>' +
      list.map((x) => '<tr><td class="olc-mono">' + esc(M.day(x.started_at) || "") + "</td><td>" + word(x) + "</td>" + n(x.n_added) + n(x.n_changed) + n(x.n_removed) + n(x.n_unchanged) + n(x.n_skipped) + n(x.n_duplicate_ids) +
        '<td class="olc-mono">' + esc(x.archive_status || "") + "</td></tr>" + (x.note || x.removals_skipped ? '<tr><td></td><td colspan="8" class="olc-srcnote">' + esc([x.note, x.removals_skipped ? "removals skipped: " + x.removals_skipped : null].filter(Boolean).join(" · ")) + "</td></tr>" : "")).join("") +
      "</tbody></table></div>" + (list[0].provider_copyright ? kv([["Provider's wording, last pull", esc(list[0].provider_copyright)]]) : "");
  }

  function drawDetail() {
    const el = root.querySelector("[data-detail]"), r = rows.find((x) => x.id === S.open);
    el.hidden = !r;
    root.querySelector(".olc-main").classList.toggle("olc-split", !!r);
    if (!r) { el.innerHTML = ""; return; }
    const keepScroll = el.querySelector(".olc-dbody")?.scrollTop || 0, sameTab = el.getAttribute("data-shows") === r.id + ":" + S.tab;
    el.innerHTML = '<div class="olc-dhead"><div class="olc-dtop">' + mark(r) + '<h3 title="' + esc(r.name) + '">' + esc(r.name) + "</h3>" +
        '<button type="button" class="olc-btn" data-nav="-1" aria-label="Previous layer" title="Previous (↑)">↑</button><button type="button" class="olc-btn" data-nav="1" aria-label="Next layer" title="Next (↓)">↓</button>' +
        '<button type="button" class="olc-btn" data-close aria-label="Close the detail" title="Close (Esc)">✕</button></div>' +
      '<div class="olc-dkey">' + mono(r.key) + " " + copyBtn(r.key, "key") + '<span class="olc-cat">' + esc(M.CAT_WORD[r.cat]) + "</span>" + (r.theme ? tag(r.theme) : "") + (r.geom ? tag(r.geom) : "") +
        (r.shown === true ? tag(r.cat === "core" ? "offered" : "shown to customers", "ok") : r.shown === false ? tag(r.cat === "core" ? "withdrawn" : "held back", "warn") : "") + (r.job ? tag("job " + M.JOB_WORD[r.job.state], r.job.state === "failing" ? "bad" : r.job.state === "late" ? "warn" : "") : "") + "</div>" +
      '<div class="olc-dtabs" role="tablist" aria-label="Layer detail">' + TABS.map(([id, l]) => '<button type="button" role="tab" id="olc-tab-' + id + '" data-tab="' + id + '" aria-selected="' + (S.tab === id) + '" aria-controls="olc-dbody" tabindex="' + (S.tab === id ? 0 : -1) + '">' + l + "</button>").join("") + "</div></div>" +
      '<div class="olc-dbody" id="olc-dbody" role="tabpanel" aria-labelledby="olc-tab-' + S.tab + '" data-tab-body="' + S.tab + '">' + (T[S.tab] || T.overview)(r) + "</div>";
    el.setAttribute("data-shows", r.id + ":" + S.tab);
    if (sameTab) el.querySelector(".olc-dbody").scrollTop = keepScroll;
  }

  // ---- actions -------------------------------------------------------------------------------------------------------------------------
  const say = (t) => { const s = root?.querySelector("[data-said]"); if (s) s.textContent = t; };
  function rebuild() { rows = M.rows(input, { failed: failedReads }); }
  function openRow(id, tab) {
    S.open = id;
    if (tab) S.tab = tab;
    const at = order.findIndex((r) => r.id === id);
    if (at >= 0) S.cursor = at;
    markRows(); drawDetail();
  }
  function closeDetail() { S.open = null; markRows(); drawDetail(); focusCursor(); }
  function markRows() {
    root.querySelectorAll("[data-grid] tbody tr[data-id]").forEach((tr, i) => {
      const id = tr.getAttribute("data-id");
      tr.classList.toggle("olc-cursor", i === S.cursor); tr.tabIndex = i === S.cursor ? 0 : -1;
      tr.classList.toggle("olc-open", id === S.open);
      if (id === S.open) tr.setAttribute("aria-current", "true"); else tr.removeAttribute("aria-current");
    });
  }
  function focusCursor() { const tr = root.querySelectorAll("[data-grid] tbody tr[data-id]")[S.cursor]; if (tr) { tr.focus({ preventScroll: true }); tr.scrollIntoView?.({ block: "nearest" }); } }
  function move(by) {
    if (!order.length) return;
    S.cursor = Math.max(0, Math.min(order.length - 1, S.cursor + by));
    if (S.open) S.open = order[S.cursor].id;
    markRows(); focusCursor();
    if (S.open) drawDetail();
  }
  function setView(id) {
    S.f.view = id; S.cols = colsFor(id); S.colsOpen = false; S.edit = null;
    if (M.VIEWS.find((v) => v.id === id)?.notes) S.tab = "notes";
    drawChrome(); colsPopover(); drawTable(); markRows();
  }
  function setScope(value) {
    S.scope = scopes.find((o) => o.value === value)?.scope || S.scope;
    S.edit = null; S.marks.clear();
    root.querySelectorAll("[data-scope]").forEach((s) => { s.value = scopeValue(S.scope); });
    drawTable(); drawDetail();
  }
  // withNotes (OPS2b): the rows chosen, with their note columns at the scope under Note for; otherwise the rows and columns shown
  function exportCsv(withNotes = false) {
    const ctx = ctxNow(), shown = withNotes ? order.filter((r) => S.sel.has(r.id)).concat(chosen().filter((r) => !order.includes(r))) : order.length ? order : [];
    const text = M.csv(shown, S.cols, ctx, { notes: withNotes });
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
    a.href = url; a.download = "layers-" + (M.day(new Date().toISOString()) || "registry") + ".csv"; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say("Exported " + shown.length + (shown.length === 1 ? " row" : " rows") + " as CSV.");
  }
  async function saveNote(form) {
    const r = rows.find((x) => x.id === S.open), msg = form.querySelector("[data-note-msg]");
    if (!r) return;
    const d = N.draft(Object.fromEntries(N.FIELDS.map(([k]) => [k, form.elements[k]?.value ?? ""])));
    if (d.errors.length) { msg.textContent = d.errors.join(" "); return; }
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true; msg.textContent = "Saving…";
    const mine = live;
    try {
      const saved = await host.writeNote(M.noteTarget(r, input.notes, S.scope), S.scope, d.values);
      if (mine !== live) return;
      input.notes = [...input.notes.filter((x) => x.id !== saved.id), saved];
      rebuild(); drawChrome(); drawTable(); drawDetail();
      const m2 = root.querySelector("[data-note-msg]"); if (m2) m2.textContent = "Saved. " + (N.byline(saved, FP.ops.user()?.id)?.text || "");
    } catch (e) { if (mine === live) { msg.textContent = "Couldn't save: " + (e?.message || e); btn.disabled = false; } }
  }
  async function removeNote() {
    const r = rows.find((x) => x.id === S.open), here = r && M.noteAt(r, input.notes, S.scope);
    if (!here?.note) return;
    const mine = live;
    try {
      await host.removeNote(here.note);
      if (mine !== live) return;
      input.notes = input.notes.filter((x) => x.id !== here.note.id);
      rebuild(); drawChrome(); drawTable(); drawDetail();
      const m2 = root.querySelector("[data-note-msg]"); if (m2) m2.textContent = "Removed. The earlier text is kept in the note's history.";
    } catch (e) { const m2 = root.querySelector("[data-note-msg]"); if (m2 && mine === live) m2.textContent = "Couldn't remove it: " + (e?.message || e); }
  }
  function copy(value, what) {
    const done = () => say("Copied " + (what || "it") + ".");
    try { Promise.resolve(navigator.clipboard?.writeText(value)).then(done, () => say("Couldn't copy: select it and copy by hand.")); } catch { say("Couldn't copy: select it and copy by hand."); }
  }

  function wire() {
    root.addEventListener("click", (e) => {
      const t = e.target, at = (s) => t.closest?.(s);
      if (S.colsOpen && !at(".olc-pop")) { S.colsOpen = false; colsPopover(); }
      let b;
      if ((b = at("[data-ctab]")) && b.matches("button")) { setCtab(b.getAttribute("data-ctab")); return; }
      if ((b = at("[data-msort]"))) { const c = b.getAttribute("data-msort"); SM.sort = { col: c, dir: SM.sort.col === c ? -SM.sort.dir : 1 }; drawMaps(); return; }
      if ((b = at("[data-open-map]"))) { SM.open = b.closest("tr").getAttribute("data-map-id"); drawMaps(); return; }
      if ((b = at("[data-map-close]"))) { const id = SM.open; SM.open = null; drawMaps(); root.querySelector('[data-map-id="' + CSS.escape(id) + '"] [data-open-map]')?.focus(); return; }
      if ((b = at("[data-maps-retry]"))) { SM.state = null; SM.problems = []; setCtab("maps"); return; }
      if ((b = at("[data-h]"))) { const h = b.getAttribute("data-h"); S.f.health = S.f.health === h ? null : h; drawChrome(); drawTable(); return; }
      if ((b = at("[data-view]"))) { setView(b.getAttribute("data-view")); return; }
      if ((b = at("[data-group]"))) { S.group = b.getAttribute("data-group"); drawChrome(); drawTable(); return; }
      if ((b = at("[data-sort]"))) { const c = b.getAttribute("data-sort"); S.sort = { col: c, dir: S.sort.col === c ? -S.sort.dir : 1 }; drawTable(); return; }
      if ((b = at("[data-cols]"))) { S.colsOpen = !S.colsOpen; colsPopover(); return; }
      if ((b = at("[data-cols-reset]"))) { S.cols = [...(M.VIEWS.find((v) => v.id === S.f.view) || M.VIEWS[0]).cols]; try { localStorage.removeItem(COLS_KEY + S.f.view); } catch { /* fine */ } drawChrome(); colsPopover(); drawTable(); return; }
      if ((b = at("[data-csv]"))) { exportCsv(); return; }
      if ((b = at("[data-retry]"))) { b.disabled = true; host?.retry?.(); return; }
      if ((b = at("[data-copy]"))) { copy(b.getAttribute("data-copy"), b.getAttribute("data-copy-what")); return; }
      if ((b = at("[data-close]"))) { closeDetail(); return; }
      if ((b = at("[data-nav]"))) { move(Number(b.getAttribute("data-nav"))); return; }
      if ((b = at("[data-tab]"))) { S.tab = b.getAttribute("data-tab"); drawDetail(); root.querySelector('[data-tab="' + S.tab + '"]')?.focus(); return; }
      if ((b = at("[data-note-remove]"))) { removeNote(); return; }
      if ((b = at("[data-bulk-copy]"))) { copy(M.notesText(chosen(), ctxNow()), "the notes of " + S.sel.size + (S.sel.size === 1 ? " row" : " rows")); return; }
      if ((b = at("[data-bulk-csv]"))) { exportCsv(true); return; }
      if ((b = at("[data-bulk-clear]"))) { S.sel.clear(); drawTable(); drawBulk(); return; }
      if (at("[data-sel], [data-sel-all], textarea[data-edit]")) return;
      if ((b = at("[data-open-row]"))) { openRow(b.closest("tr").getAttribute("data-id"), M.VIEWS.find((v) => v.id === S.f.view)?.notes ? "notes" : null); return; }
      if ((b = at("[data-edit-cell]"))) { beginEdit(b.closest("tr").getAttribute("data-id"), b.getAttribute("data-edit-cell")); return; }
      const tr = at("[data-grid] tbody tr[data-id]");
      if (tr && !at("a, button, input, select, textarea")) { openRow(tr.getAttribute("data-id"), M.VIEWS.find((v) => v.id === S.f.view)?.notes ? "notes" : null); }
    });
    root.addEventListener("input", (e) => {
      if (e.target.matches?.("[data-q]")) { S.f.q = e.target.value; drawTable(); }
      else if (e.target.matches?.("[data-maps-q]")) { SM.q = e.target.value; drawMaps(); }
      else if (e.target.matches?.("textarea[data-edit]") && S.edit) { S.edit = { ...M.typed(S.edit, e.target.value), col: S.edit.col }; grow(e.target);
        const m = root.querySelector("[data-cell-msg]"); if (m && m.getAttribute("data-cell-msg") === "failed") { m.setAttribute("data-cell-msg", "editing"); m.textContent = "Enter saves · Tab next · Esc cancels"; } }
    });
    // the cell being edited: Enter saves, Shift+Enter a new line, Tab saves and goes to the next part (Shift+Tab the one before), Esc cancels
    root.addEventListener("keydown", (e) => {
      const t = e.target;
      if (!t.matches?.("textarea[data-edit]") || !S.edit) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endEdit(); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const row = S.edit.row; saveEdit().then((ok) => { if (ok) focusRow(row); }); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        const { row, field } = S.edit, dir = e.shiftKey ? -1 : 1, noteCols = S.cols.filter((id) => M.COL[id]?.note);
        const next = M.nextCell(field, noteCols.map((id) => M.COL[id].note), dir), col = noteCols.find((id) => M.COL[id].note === next);
        saveEdit().then((ok) => { if (!ok) return; if (!col || !beginEdit(row, col)) { drawTable(); focusRow(row); } });
      }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches?.("[data-f]")) { S.f[t.getAttribute("data-f")] = t.value; t.closest(".olc-sel")?.classList.toggle("olc-on", !!t.value); drawTable(); }
      else if (t.matches?.("[data-scope]")) setScope(t.value);
      else if (t.matches?.("[data-sel]")) choose(t.getAttribute("data-sel"), t.checked);
      else if (t.matches?.("[data-sel-all]")) { for (const r of order) choose(r.id, t.checked); drawTable(); }
      else if (t.matches?.("[data-show]")) { S.f.show = t.value; drawTable(); }
      else if (t.matches?.("[data-col]")) {
        const id = t.getAttribute("data-col"), cols = S.cols.filter((c) => c !== id);
        if (t.checked) { const want = M.COLUMNS.map((c) => c.id); cols.push(id); cols.sort((a, b) => want.indexOf(a) - want.indexOf(b)); }
        S.cols = cols; keepCols(S.f.view, cols.filter((c) => !M.COL[c].always)); drawChrome(); drawTable();
      }
    });
    root.addEventListener("submit", (e) => { if (e.target.matches?.("[data-note-form]")) { e.preventDefault(); saveNote(e.target); } });
    onKey = (e) => {
      if (!root?.isConnected || !root.offsetParent) return;
      const t = e.target, typing = !!t?.closest?.("input, textarea, select, [contenteditable='true']");
      // OPS2d: on the Published maps tab only / (its search) and Esc (close the map) apply; the registry's keys stand down
      if (S.ctab === "maps") {
        if (e.key === "Escape" && typing && t.matches?.("[data-maps-q]")) { if (t.value) { t.value = ""; SM.q = ""; drawMaps(); } else t.blur(); e.preventDefault(); }
        else if (e.key === "Escape" && SM.open && !typing) { root.querySelector("[data-map-close]")?.click(); e.preventDefault(); }
        else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); root.querySelector("[data-maps-q]")?.focus(); }
        return;
      }
      if (e.key === "Escape") {
        if (S.colsOpen) { S.colsOpen = false; colsPopover(); root.querySelector("[data-cols]")?.focus(); e.preventDefault(); return; }
        if (typing && t.matches?.("[data-q]")) { if (t.value) { t.value = ""; S.f.q = ""; drawTable(); } else t.blur(); e.preventDefault(); return; }
        if (S.open && !typing) { closeDetail(); e.preventDefault(); }
        return;
      }
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "/") { e.preventDefault(); root.querySelector("[data-q]")?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "j" || e.key === "k") {
        if (t?.closest?.("[role=tablist]") && (e.key === "j" || e.key === "k")) return;
        e.preventDefault(); move(e.key === "ArrowDown" || e.key === "j" ? 1 : -1); return;
      }
      if (e.key === "Enter" && (t === document.body || t?.matches?.("[data-grid] tbody tr[data-id]"))) { e.preventDefault(); if (order[S.cursor]) openRow(order[S.cursor].id, M.VIEWS.find((v) => v.id === S.f.view)?.notes ? "notes" : null); return; }
      if (e.key === "x" && order[S.cursor]) { const id = order[S.cursor].id; choose(id, !S.sel.has(id)); drawTable(); focusRow(id); e.preventDefault(); return; }
      if (e.key === "e" && order[S.cursor]) { const col = S.cols.find((id) => M.COL[id]?.note && writable(order[S.cursor], ctxNow())); if (col) { e.preventDefault(); beginEdit(order[S.cursor].id, col); } return; }
      if ((e.key === "[" || e.key === "]") && S.open) { const i = TABS.findIndex(([id]) => id === S.tab), n = TABS.length; S.tab = TABS[(i + (e.key === "]" ? 1 : n - 1)) % n][0]; drawDetail(); e.preventDefault(); }
    };
    document.addEventListener("keydown", onKey);
  }

  // ---- open and close ------------------------------------------------------------------------------------------------------------------
  // box: #ops-panels. env: { isCurrent(), writeNote(row, scope, values), removeNote(note) } from ops-layers.js.
  async function open(box, env) {
    close();
    const mine = ++live;
    host = env;
    const got = await read();
    if (mine !== live || !env.isCurrent()) return;
    input = got; readAt = new Date(); cache = new Map(); rebuild();
    S = { f: { q: "", view: "all", health: null, cat: "", provider: "", theme: "", geom: "", status: "", show: "all" }, group: "none", sort: { col: "name", dir: 1 }, cursor: 0, open: null, tab: "overview",
      ctab: "registry", cols: colsFor("all"), colsOpen: false, edit: null, marks: new Map(), sel: new Set(), scope: scopes[0]?.scope || { scope: "global" } };
    SM = { state: null, q: "", sort: { col: "title", dir: 1 }, open: null, rows: [], problems: [] };
    box.innerHTML = shell() + phoneHtml();
    root = box.querySelector(".olc"); phone = box.querySelector(".olc-phone");
    drawChrome(); drawTable(); drawDetail();
    root.querySelector("[data-read]").textContent = "Read " + readAt.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " · staff only" +
      "";
    wire();
    // GE1b: RCL staff's trials (the Shape editor's switch) stay on the Layers tab, below the registry; kept in this browser only
    if (FP.shapeEditor && box.insertAdjacentHTML) { box.insertAdjacentHTML("beforeend", FP.shapeEditor.trialsPanel()); FP.shapeEditor.wireTrials(box); }
  }
  function close() {
    live++;
    if (onKey) document.removeEventListener("keydown", onKey);
    onKey = null;
    root?.remove(); phone?.remove();
    root = null; phone = null; host = null; input = null; rows = []; order = []; cache = new Map(); S = null;
  }

  FP.opsLayersConsole = { open, close, state: () => (S ? { ...S, f: { ...S.f }, rows: rows.length, shown: order.length, listening: !!onKey } : { listening: !!onKey }) };
})();
