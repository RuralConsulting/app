// Operations → Layers (#/ops/layers, LN1): every layer with its advisor note's status, a search and a filter, and an
// editor for the note at the scope chosen (RCL's global note, a group's, or a farm's). RCL staff reach the page from
// Operations; row-level security on layer_notes is the real gate on what is read and written (staff write global notes,
// a group's advisors its notes, a farm's editors its notes). The model is js/layer-notes-model.js.
(function () {
  const N = FP.layerNotes, { $, sb } = FP;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const day = (ts) => FP.opsModel?.day(ts) || null;
  let token = 0, data = null, scope = { scope: "global" }, selected = null, q = "", status = "all";

  async function read(query) { const { data: rows, error } = await query; if (error) throw error; return rows || []; }
  const optional = (query) => Promise.resolve(query).then((r) => (r.error ? [] : r.data || []), () => []);

  // The scopes this person can write: RCL's global note, the organisations they advise, the farms they edit.
  function scopes(d) {
    const out = [{ value: "global", label: "RCL — global note", scope: { scope: "global" } }];
    for (const o of d.orgs) out.push({ value: "group:" + o.id, label: (o.name || "Organisation") + " — group note", scope: { scope: "group", org_id: o.id } });
    for (const f of d.farms) out.push({ value: "farm:" + f.id, label: (f.name || "Farm") + " — farm note", scope: { scope: "farm", farm_id: f.id } });
    return out;
  }
  const scopeValue = (s) => (s.scope === "global" ? "global" : s.scope === "group" ? "group:" + s.org_id : "farm:" + s.farm_id);
  // Owned layers listed for the scope: every organisation layer read, and the chosen farm's own layers.
  const listedLayers = (d) => d.layers.filter((l) => l.org_id || (scope.scope === "farm" && l.farm_id === scope.farm_id));
  const rows = () => N.catalogue(data.sources, listedLayers(data), data.notes, scope);

  function listHtml(all) {
    const shown = N.filter(all, { q, status }), s = N.summary(all);
    const item = (r) => '<li class="ln-row' + (selected === r.key ? " selected" : "") + '" data-layer="' + esc(r.key) + '" data-status="' + r.status + '">' +
      '<button type="button" class="ln-pick" data-pick="' + esc(r.key) + '"' + (r.editable ? "" : " disabled") + '><span class="ln-name"><b>' + esc(r.name) + "</b>" +
      '<span class="ops-badge" data-status="' + r.status + '">' + (r.status === "drafted" ? "Drafted" : "Empty") + "</span></span>" +
      '<span class="ops-line">' + [r.source_key || "own layer", r.theme, r.provider].filter(Boolean).map(esc).join(" · ") + "</span>" +
      (r.others.length ? '<span class="ops-line">Also noted by ' + esc([...new Set(r.others.map((x) => N.SCOPE_WORD[x]))].join(", ")) + "</span>" : "") +
      "</button></li>";
    return '<p class="answer-sentence" id="ln-summary">' + esc(s.text + " — " + s.because) + "</p>" +
      '<p class="ops-line" id="ln-count">' + (shown.length === all.length ? "Showing all " + all.length : "Showing " + shown.length + " of " + all.length) + "</p>" +
      (shown.length ? '<ul class="ops-list ln-list">' + shown.map(item).join("") + "</ul>" : '<p class="ops-line">No layer matches.</p>');
  }

  function editorHtml(r) {
    if (!r) return '<h3 id="ln-editing">Note</h3><p class="answer-sentence">Choose a layer above to write its note.</p>';
    const n = r.note || {}, others = N.applicable((data?.notes || []).filter((x) => x !== r.note && N.keyOf(x) === r.key), r.key);
    const where = scope.scope === "global" ? "RCL's global note: everyone who sees this layer reads it" : scope.scope === "group" ? "This group's note: its members and its farms read it, over the global note" : "This farm's note: the farm's people read it, over the group's and the global note";
    return '<h3 id="ln-editing">' + esc(r.name) + "</h3>" + '<p class="answer-sentence">' + esc(where) + ".</p>" +
      (r.what ? '<p class="ops-line ln-what">' + esc(r.what) + "</p>" : "") +
      (others ? '<details class="ln-others"><summary>Other notes on this layer</summary><dl>' + others.parts.map((p) => "<dt>" + esc(p.label) + " (" + esc(p.from) + ")</dt><dd>" + esc(p.text) + "</dd>").join("") + "</dl></details>" : "") +
      '<form id="ln-form" class="ln-form">' + N.FIELDS.map(([k, label, hint]) => '<label class="ln-field"><span><b>' + esc(label) + "</b> <small>" + esc(hint) + "</small></span>" +
        '<textarea name="' + k + '" rows="' + (k === "notes" ? 4 : 2) + '" maxlength="' + N.MAX[k] + '">' + esc(n[k] || "") + "</textarea></label>").join("") +
      '<p class="ln-actions"><button type="submit" class="primary">Save note</button>' + (r.note ? ' <button type="button" class="link" id="ln-clear">Remove this note</button>' : "") + "</p>" +
      '<p class="msg" id="ln-msg" role="status">' + (r.note?.updated_at ? "Last saved " + esc(day(r.note.updated_at) || "") : "") + "</p></form>";
  }

  function draw() {
    const all = rows(), r = all.find((x) => x.key === selected) || null;
    $("#ln-listing").innerHTML = listHtml(all);
    $("#ln-editor").innerHTML = editorHtml(r);
    $("#ln-editor").hidden = false;
  }

  async function save(ev) {
    ev.preventDefault();
    const r = rows().find((x) => x.key === selected), form = ev.target, msg = $("#ln-msg");
    if (!r) return;
    const d = N.draft(Object.fromEntries(N.FIELDS.map(([k]) => [k, form.elements[k].value])));
    if (d.errors.length) { msg.textContent = d.errors.join(" "); return; }
    form.querySelector("button[type=submit]").disabled = true; msg.textContent = "Saving…";
    try {
      let res;
      if (r.note) res = await sb.from("layer_notes").update(d.values).eq("id", r.note.id).select("*").single();
      else res = await sb.from("layer_notes").insert({ ...d.values, scope: scope.scope, source_key: r.source_key || null, map_layer_id: r.map_layer_id || null,
        org_id: scope.org_id || null, farm_id: scope.farm_id || null }).select("*").single();
      if (res.error || !res.data) throw res.error || Error("That change wasn't allowed.");
      data.notes = [...data.notes.filter((x) => x.id !== res.data.id), res.data];
      draw(); $("#ln-msg").textContent = "Saved.";
    } catch (e) { msg.textContent = "Couldn't save: " + (e.message || e); form.querySelector("button[type=submit]").disabled = false; }
  }
  async function clear() {
    const r = rows().find((x) => x.key === selected), msg = $("#ln-msg");
    if (!r?.note) return;
    try {
      const { error } = await sb.from("layer_notes").delete().eq("id", r.note.id);
      if (error) throw error;
      data.notes = data.notes.filter((x) => x.id !== r.note.id);
      draw(); $("#ln-msg").textContent = "Removed. The earlier text is kept in the note's history.";
    } catch (e) { msg.textContent = "Couldn't remove it: " + (e.message || e); }
  }

  function shell(d) {
    const opts = scopes(d);
    return '<section class="answer-panel answer-compact ops-panel" data-ops="layers"><h2>Advisor notes on layers</h2>' +
      '<p class="ops-line">What each layer is, what it is useful for, its caveats, and when to show it to a catchment group. The narrowest note applies: a farm\'s over its group\'s over RCL\'s. Ask reads them as advisor guidance.</p>' +
      '<div class="ln-controls"><label><span>Note for</span><select id="ln-scope">' + opts.map((o) => '<option value="' + esc(o.value) + '"' + (o.value === scopeValue(scope) ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></label>" +
      '<label><span>Search</span><input id="ln-q" type="search" placeholder="Name, key, theme or words in a note" value="' + esc(q) + '"></label>' +
      '<label><span>Show</span><select id="ln-status">' + [["all", "All layers"], ["empty", "Empty"], ["drafted", "Drafted"]].map(([v, l]) => '<option value="' + v + '"' + (v === status ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label></div>" +
      '<div id="ln-listing"></div></section>' +
      '<section class="answer-panel answer-compact ops-panel" data-ops="layer-note" id="ln-editor" aria-live="polite" hidden></section>';
  }

  async function open() {
    const current = ++token, box = $("#ops-panels");
    document.body.classList.remove("farm-space-active", "farm-detail", "portfolio-active");
    FP.show("screen-ops");
    document.title = "Layers | " + FP.brand?.product;
    $("#ops-title").textContent = "Layers";
    $("#ops-back").setAttribute("href", FP.href(""));
    const tab = $("#ops-tab"); tab.textContent = "Operations"; tab.setAttribute("href", FP.href("#/ops"));
    box.innerHTML = '<p class="ops-wait">Reading the layers and their notes…</p>';
    try {
      const user = FP.ops.user();
      const [sources, layers, notes, orgRoles, farmRoles] = await Promise.all([
        read(sb.from("reference_sources").select("key,name,theme,provider,summary,serve_to_customers").order("name")),
        optional(sb.from("map_layers").select("id,name,theme,org_id,farm_id").order("name")),
        read(sb.from("layer_notes").select("*")),
        optional(sb.from("org_members").select("org_id,role").eq("user_id", user?.id)),
        optional(sb.from("farm_members").select("farm_id,role").eq("user_id", user?.id)),
      ]);
      const orgIds = orgRoles.filter((m) => ["facilitator", "advisor", "admin"].includes(m.role)).map((m) => m.org_id);
      const farmIds = farmRoles.filter((m) => ["edit", "admin", "owner"].includes(m.role)).map((m) => m.farm_id);
      const [orgs, farms] = await Promise.all([
        orgIds.length ? optional(sb.from("organisations").select("id,name").in("id", orgIds)) : [],
        farmIds.length ? optional(sb.from("farms").select("id,name").in("id", farmIds)) : [],
      ]);
      if (current !== token) return;
      const orgName = new Map(orgs.map((o) => [o.id, o.name]));
      data = { sources, notes, orgs, farms: [...farms].sort((a, b) => String(a.name).localeCompare(String(b.name))),
        layers: layers.map((l) => ({ ...l, owner_name: l.org_id ? orgName.get(l.org_id) || "Organisation layer" : "Farm layer" })) };
      if (!scopes(data).some((o) => o.value === scopeValue(scope))) scope = { scope: "global" };
      box.innerHTML = shell(data);
      draw();
      $("#ln-scope").addEventListener("change", (e) => { scope = scopes(data).find((o) => o.value === e.target.value)?.scope || { scope: "global" }; selected = null; draw(); });
      $("#ln-q").addEventListener("input", (e) => { q = e.target.value; $("#ln-listing").innerHTML = listHtml(rows()); });
      $("#ln-status").addEventListener("change", (e) => { status = e.target.value; $("#ln-listing").innerHTML = listHtml(rows()); });
      $("#ln-listing").addEventListener("click", (e) => {
        const b = e.target.closest("[data-pick]");
        if (!b) return;
        selected = b.dataset.pick; draw();
        $("#ln-editor").scrollIntoView?.({ block: "start", behavior: "smooth" });
        $("#ln-form")?.elements[0]?.focus({ preventScroll: true });
      });
      $("#ln-editor").addEventListener("submit", save);
      $("#ln-editor").addEventListener("click", (e) => { if (e.target.id === "ln-clear") clear(); });
    } catch (e) {
      if (current === token) box.innerHTML = '<p class="msg" role="alert">Couldn\'t read the layers: ' + esc(e.message || e) + "</p>";
    }
  }
  function close() { token++; }

  FP.opsLayers = { open, close, render: { listHtml, editorHtml }, state: () => ({ scope, selected, q, status }) };
})();
