// The catchment group's space (S5, docs/CATCHMENT-SPACE.md): the farm space's shape at catchment scale. Map (the group's
// own layers, member farms at the level the group and each farm allow, shared reference areas and sites) with the group's
// standing answers (members, what's due, what's changed, water quality nearby); Documents (the group's own, tiered, and
// what member farms shared); Create → Monthly update (drafted by code, edited here, stored as a group document); Settings
// (a group admin chooses how member farms are shown). Every read is as the signed-in person, through row-level security
// and the group functions (group_map, group_member_summary, group_member_farms, group_shared_entries/documents,
// group_wq_sites); nothing needs AI. Group use of the water-quality analysis (X1) is X1b's: `groupAnalysisPreset` is
// where its preset plugs in.
(function (root) {
  const FP = root.FP;
  const G = () => FP.groupModel, U = () => FP.groupUpdate;
  const el = (...a) => FP.el(...a), $ = (s) => FP.$(s);
  const DOC_COLUMNS = "id,title,doc_type,author,author_org,date_prepared,period_start,period_end,storage_path,original_name,sha256,status,created_at,tier,tiered_at,visibility";
  const groupAnalysisPreset = null;   // X1b: the group's "our sites compared with ECan's" analysis preset, when it lands
  let groups = [], person = null, ctx = null, token = 0, mapHandle = null, mapReady = null, surface = null, entries = [], wq = null, draft = null, notice = null;

  async function read(query) { const { data, error } = await query; if (error) throw error; return data; }
  const optional = (query) => Promise.resolve(query).then((r) => (r.error ? null : r.data), () => null);
  const list = (v) => (Array.isArray(v) ? v : []);

  function setGroups(rows, user) { groups = rows || []; person = user; }
  const find = (id) => groups.find((g) => g.id === id) || null;

  // ---- reads -------------------------------------------------------------------------------------------------------------
  async function load(group) {
    const sb = FP.sb, today = typeof sb.today === "function" ? await sb.today() : G().isoDay(Date.now());
    const since = new Date(Date.parse(String(today).slice(0, 10) + "T00:00:00Z") - 30 * 86400000).toISOString();
    const [map, summary, members, own, documents, shared, sharedDocs, obligations, types, sources, readiness] = await Promise.all([
      read(sb.rpc("group_map", { g: group.id })),
      optional(sb.rpc("group_member_summary", { g: group.id })),
      optional(sb.rpc("group_member_farms", { g: group.id })),
      optional(sb.from("entries").select("id,type_id,body,captured_at,visibility").eq("org_id", group.id).order("captured_at", { ascending: false })),
      optional(sb.from("documents").select(DOC_COLUMNS).eq("org_id", group.id).order("title")),
      optional(sb.rpc("group_shared_entries", { group_id: group.id })),
      optional(sb.rpc("group_shared_documents", { group_id: group.id })),
      optional(sb.from("obligations").select("id,code,summary,kind,due_date,recurrence").eq("org_id", group.id)),
      optional(sb.from("record_types").select("id,key,label")),
      // PROV1: where the reference layers came from (the popups' provenance line and the Layers card's Sources entry)
      optional(sb.from("reference_sources").select(FP.provenance.COLUMNS).eq("serve_to_customers", true)),
      // ON2: onboarding readiness of member farms, for group admins only (the database returns null to anyone else)
      G().canManage(group.role) ? optional(sb.rpc("group_readiness", { g: group.id })) : null,
    ]);
    if (map) map.sources = list(sources);
    const typeKey = new Map(list(types).map((t) => [t.id, t.key])), label = new Map(list(types).map((t) => [t.key, t.label]));
    return { group, today: String(today).slice(0, 10), since, map, summary: summary || {}, members: list(members), types: list(types),
      typeLabel: (k) => label.get(k) || String(k || "record").replace(/_/g, " "),
      ownEntries: list(own).map((e) => ({ ...e, record_type: typeKey.get(e.type_id) || "note" })), documents: list(documents),
      sharedEntries: list(shared), sharedDocuments: list(sharedDocs), obligations: list(obligations), readiness: readiness || null };
  }

  // ---- the screen ----------------------------------------------------------------------------------------------------------
  function close() {
    token++;
    wq?.destroy(); wq = null;
    mapHandle?.destroy(); mapHandle = null; surface = null; entries = [];
    ctx = null; draft = null;
    document.body.classList.remove("group-space-active");
  }
  function header(group, route) {
    $("#group-name").textContent = group.name;
    $("#group-kind").textContent = "Catchment group" + (group.role ? " · you are " + (/^[aeiou]/.test(group.role) ? "an " : "a ") + group.role : "");
    const nav = $("#group-nav");
    nav.replaceChildren(...G().views.filter(([k]) => k !== "settings" || G().canManage(group.role)).map(([key, label]) =>
      el("a", { href: FP.href(G().href(group.id, key)), class: "group-tab", ...(route.view === key ? { "aria-current": "page" } : {}) }, label)));
    $("#group-back").hidden = !(FP.groupSpace.hasPortfolio?.());
    $("#group-back").setAttribute("href", FP.href("") || "#/");
  }
  async function open(group, route) {
    const current = ++token;
    document.body.classList.add("group-space-active");
    FP.show("screen-group");
    header(group, route);
    if (ctx?.group.id !== group.id) {
      wq?.destroy(); wq = null; mapHandle?.destroy(); mapHandle = null; surface = null; entries = []; draft = null;
      ctx = { group, pending: load(group) };
    }
    const panel = $("#group-panel");
    panel.replaceChildren(el("p", { class: "group-status", role: "status" }, "Loading the group…"));
    try {
      const data = ctx.data || (ctx.data = await ctx.pending);
      if (current !== token) return;
      document.title = group.name + (route.view === "map" ? "" : " · " + G().viewLabel(route.view)) + " | " + (FP.brand?.product || "");
      // The panel does not wait for the map: the standing answers show at once, the map's own cards when it is drawn.
      const mapped = drawMap(data, current).catch(() => null);
      panel.replaceChildren();
      const home = !["documents", "create"].includes(route.view) && !(route.view === "settings" && G().canManage(group.role));
      if (route.view === "documents") panel.append(documentsView(data));
      else if (route.view === "create") panel.append(createView(data));
      else if (!home) panel.append(settingsView(data));
      else panel.append(...mapView(data));
      panel.scrollTop = 0;
      await mapped;
      if (current !== token || !home) return;
      if (wq) { const box = card("Water quality"); box.append(wq.node); panel.append(box); }
      if (entries.length) panel.append(layersCard());
    } catch (e) {
      if (current === token) panel.replaceChildren(el("p", { class: "group-status", role: "alert" }, "Couldn't load the group: " + (e.message || e)));
    }
  }

  // The map: its own surface in the space (the group is never drawn on a farm's map).
  async function drawMap(data, current) {
    const host = $("#group-map");
    if (!data.map?.extent) {
      mapHandle?.destroy(); mapHandle = null;
      host.replaceChildren(el("div", { class: "group-map-empty" }, el("p", {}, "Nothing is mapped for this group yet. Its own layers and the member farms it may show appear here once they are added.")));
      return;
    }
    if (mapHandle) return mapReady;   // already drawn, or being drawn: wait for it
    host.replaceChildren();
    const show = ["extent", "member_farms", "rivers", ...list(data.map.layers).map((l) => l.theme)];
    const handle = mapHandle = FP.blocks.render(host, { block: "map-scene", owner: { org: data.group.id }, options: { show } }, { read: () => data.map, level: 2 });
    mapReady = handle.ready.catch(() => null);
    const drawn = await mapReady;
    // the map belongs to the group, not the view: kept for later views unless the group itself changed meanwhile
    if (mapHandle !== handle || !drawn) return;
    surface = drawn.surface || null; entries = drawn.entries || [];
    if (!wq && FP.wq && surface) {
      wq = FP.wq.create({ sb: FP.sb, farm: { id: data.group.id }, extent: data.map.extent, map: surface, provenance: (key, at) => FP.provenance.lineFor(data.map.sources, key, null, at),
        sitesRead: () => FP.sb.rpc("group_wq_sites", { g: data.group.id }).then((r) => { if (r.error) throw r.error; return r.data || []; }) });
      wq.ready.then(() => {
        const slot = document.querySelector(".group-sources");
        if (!slot) return;
        const open = slot.querySelector("details")?.open, node = sourcesNode();
        if (node && open) node.open = true;
        slot.replaceChildren(...(node ? [node] : []));
      });
    }
  }

  // ---- Map view: the standing answers -------------------------------------------------------------------------------------
  function card(title, ...body) { return el("section", { class: "group-card" }, el("h2", {}, title), ...body); }
  function mapView(data) {
    const ownLayers = list(data.map?.layers).filter((l) => l.group_own);
    const members = card("Member farms", el("ul", { class: "group-lines" }, ...G().memberLines(data.summary, { hasOwnLayers: ownLayers.length > 0 }).map((t) => el("li", {}, t))),
      data.members.length ? el("p", { class: "group-fine" }, "Shown in detail: " + data.members.map((m) => m.name || "a member farm (not named)").join(", ") + ".") : null);
    const due = G().due(data.obligations, data.today);
    const dueCard = card("What's due", due.length
      ? el("ul", { class: "group-lines" }, ...due.map((d) => el("li", { class: d.overdue ? "overdue" : "" }, el("span", {}, d.text), el("small", {}, d.when))))
      : el("p", {}, "No obligations are recorded for the group itself. Member farms' obligations stay with each farm."));
    const changes = G().changed({ ownEntries: data.ownEntries, ownDocuments: data.documents, sharedEntries: data.sharedEntries, sharedDocuments: data.sharedDocuments,
      members: data.members, typeLabel: data.typeLabel, since: data.since });
    const changedCard = card("What's changed (30 days)", changes.length
      ? el("ul", { class: "group-lines" }, ...changes.slice(0, 12).map((c) => el("li", {}, el("span", {}, c.text), el("small", {}, c.date + " · " + c.who))))
      : el("p", {}, "Nothing new from the group or shared by member farms in the last 30 days."));
    const out = [members, dueCard, changedCard];
    if (G().canManage(data.group.role) && data.readiness) out.push(readinessCard(data.readiness));
    // DQ1's hook: what the last group load set aside, for the group's admins (the database decides what each person sees)
    if (G().canManage(data.group.role) && FP.ops?.groupGaps) { const gaps = el("div", { class: "group-gaps" }); FP.ops.groupGaps(gaps, data.group.id); out.push(gaps); }
    return out;
  }
  // ON2: the onboarding readiness of member farms (group admins). Counts by readiness state and by finding type, as the
  // database returned them; a farm listed only at the level the group and the farm both allow.
  function readinessCard(result) {
    const r = G().readiness(result);
    const box = el("section", { class: "group-card group-readiness", "data-card": "readiness" }, el("h2", {}, "Onboarding readiness"),
      el("p", { class: "group-fine" }, "The onboarding report's checks, run on each member farm in group totals. Counts of farms; a farm is listed only where both the group and its owner allow it. Figures from fewer than " + G().K + " farms are never shown, and no farm's private documents are read."),
      el("p", {}, r.summary));
    if (r.empty) return box;
    box.append(el("h3", {}, "By readiness"), r.statesHeld
      ? el("p", {}, "Not shown: a state would count fewer than " + G().K + " farms, and the other states would give it away.")
      : el("ul", { class: "group-lines" }, ...r.states.map((s) => el("li", { "data-state": s.key }, s.text))));
    box.append(el("h3", {}, "What the checks found"), r.findings.length
      ? el("ul", { class: "group-lines" }, ...r.findings.map((f) => el("li", { "data-rule": f.rule }, f.text)))
      : el("p", {}, "Nothing open on any farm in group totals."));
    if (r.rows.length) box.append(el("h3", {}, "Farms shown in detail"), el("ul", { class: "group-lines readiness-farms" }, ...r.rows.map((f) =>
      el("li", {}, el("span", {}, f.label + " · " + f.readiness), el("small", {}, f.findings.join("; ") || "Nothing open")))));
    return box;
  }
  function layersCard() {
    const own = new Set(list(ctx?.data?.map?.layers).filter((l) => l.group_own).map((l) => l.theme));
    return card("Layers", el("ul", { class: "group-layers" }, ...entries.filter((e) => e.key !== "titles").map((e) => {   // a group has no titles of its own
      const input = el("input", { type: "checkbox", role: "switch", ...(e.on ? { checked: true } : {}), onchange: (ev) => surface?.setVisible(e, ev.target.checked) });
      const sub = e.key === "member_farms" ? "shared by each farm, at the level both allow" : e.section === "farm" && own.has(e.key) ? "the group's own map" : e.section === "reference" ? "shared reference" : null;
      return el("li", {}, el("label", {}, input, el("span", {}, e.name), sub ? el("small", {}, sub) : null));
    })), el("div", { class: "group-sources" }, sourcesNode()));
  }
  // The Sources entry (PROV1): the same call the farm's drawer makes. A results dataset is judged by the results the group's water-quality
  // line holds (heldBy), so the entry is drawn again once those sites are known.
  function sourcesNode() {
    const held = FP.provenance.heldBy(wq?.sites?.() || []);
    return FP.provenance.section(ctx?.data?.map?.sources, { keys: [...entries.filter((e) => e.section === "reference").map((e) => e.key), ...held.keys],
      loadedKeys: held.loadedKeys, asAt: held.asAt, region: ctx?.data?.group?.region });
  }

  // ---- Documents ---------------------------------------------------------------------------------------------------------------
  function documentsView(data) {
    const wrap = el("section", { class: "group-documents", "data-view": "documents" }, el("h2", {}, "Documents"));
    const own = el("div", { class: "block-host documents-host" });
    wrap.append(el("h3", {}, "The group's documents"), own);
    FP.blocks.render(own, { block: "documents", owner: { org: data.group.id }, options: {} }, { read: () => ({ documents: data.documents, canEdit: false, canAdd: false, notice }), level: 3, nested: true, href: FP.href });
    notice = null;
    wrap.append(el("h3", {}, "Shared by member farms"));
    if (data.sharedDocuments.length) {
      wrap.append(el("ul", { class: "group-lines" }, ...data.sharedDocuments.map((d) => el("li", {},
        d.storage_path ? el("button", { type: "button", class: "doc-open", "data-open-document": d.id }, d.title || "Untitled") : el("span", {}, d.title || "Untitled"),
        el("small", {}, G().attribution(d, data.members) + " · shared " + G().shortDate(d.created_at))))));
    } else wrap.append(el("p", {}, "No member farm has shared a document with the group."));
    wrap.addEventListener("click", async (e) => {
      const button = e.target.closest("[data-open-document]");
      const doc = button && [...data.documents, ...data.sharedDocuments].find((d) => d.id === button.dataset.openDocument);
      if (!doc?.storage_path) return;
      button.disabled = true;
      const { data: url, error } = await FP.sb.storage.from("documents").createSignedUrl(doc.storage_path, 3600);
      button.disabled = false;
      if (error || !url?.signedUrl) { button.textContent = "Couldn't open it"; return; }
      window.open(url.signedUrl, "_blank", "noopener");
    });
    return wrap;
  }

  // ---- Create → Monthly update ------------------------------------------------------------------------------------------------
  async function monitoringResults(data, period) {
    const sites = await optional(FP.sb.rpc("group_wq_sites", { g: data.group.id }));
    const out = [];
    for (const s of list(sites).slice(0, 8)) {
      const latest = await optional(FP.sb.rpc("wq_site_latest", { site: s.site_id }));
      for (const r of list(latest)) if (G().within(r.sampled_at, period)) out.push({ site_id: s.site_id, site: s.name, parameter: r.parameter, parameter_name: r.parameter_name,
        value_text: r.value_text ?? String(r.value), unit: r.unit, sampled_at: r.sampled_at, source_key: r.source_key, attribution: r.attribution, provisional: !!r.provisional });
    }
    return out;
  }
  // What member farms share, and how each may be attributed, read fresh (not the space's copy from when it opened).
  async function sharedNow(data) {
    const [shared, sharedDocs, members] = await Promise.all([read(FP.sb.rpc("group_shared_entries", { group_id: data.group.id })),
      read(FP.sb.rpc("group_shared_documents", { group_id: data.group.id })), read(FP.sb.rpc("group_member_farms", { g: data.group.id }))]);
    return { shared: list(shared), sharedDocs: list(sharedDocs), members: list(members) };
  }
  async function makeDraft(data, ym) {
    const period = G().monthPeriod(ym);
    const [summary, results, now] = await Promise.all([optional(FP.sb.rpc("group_member_summary", { g: data.group.id, p_from: period.from, p_to: period.to })),
      monitoringResults(data, period), sharedNow(data)]);
    return U().assemble({ group: { ...data.group, member_detail: summary?.member_detail || data.summary.member_detail }, period, members: now.members, summary: summary || {},
      ownEntries: data.ownEntries, sharedEntries: now.shared, ownDocuments: data.documents, sharedDocuments: now.sharedDocs, results,
      typeLabel: data.typeLabel, now: new Date().toISOString(), by: person?.email || null });
  }
  function createView(data) {
    const wrap = el("section", { class: "group-create", "data-view": "create" }, el("h2", {}, "Create"));
    if (!G().canWrite(data.group.role)) {
      wrap.append(el("p", {}, "A group facilitator, editor or admin makes the monthly update. Saved updates are in Documents."));
      return wrap;
    }
    const month = el("input", { type: "month", id: "update-month", value: draft?.period.key || G().lastMonth(data.today), max: data.today.slice(0, 7) });
    const body = el("div", { class: "update-body", "aria-live": "polite" });
    const make = el("button", { type: "button", class: "primary", onclick: async () => {
      make.disabled = true; body.replaceChildren(el("p", { class: "group-status", role: "status" }, "Drafting from the month's records…"));
      try { draft = await makeDraft(data, month.value || G().lastMonth(data.today)); drawDraft(body, data); }
      catch (e) { body.replaceChildren(el("p", { role: "alert" }, "Couldn't draft the update: " + (e.message || e))); }
      make.disabled = false;
    } }, draft ? "Draft again" : "Draft the update");
    wrap.append(el("h3", {}, "Monthly update"),
      el("p", { class: "group-fine" }, "Drafted by code from the month's group records, what member farms shared with the group and the group's monitoring results. Every line shows its sources. Edit it here, then save it to the group's Documents. Nothing is emailed and no AI is used."),
      el("div", { class: "update-controls" }, el("label", { for: "update-month" }, "Month "), month, make), body);
    if (draft) drawDraft(body, data);
    return wrap;
  }
  function drawDraft(body, data, stale = []) {
    const staleIds = new Set(stale.map((s) => s.id));
    const sections = draft.sections.map((s) => el("section", { class: "update-section" }, el("h4", {}, s.heading),
      el("ol", { class: "update-lines" }, ...s.lines.map((l) => {
        const text = el("textarea", { rows: "2", "aria-label": s.heading + " line", oninput: (ev) => U().edit(draft, l.id, ev.target.value) });
        text.value = l.text;
        return el("li", { class: "update-line" + (staleIds.has(l.id) ? " stale" : ""), "data-line": l.id }, text,
          el("small", {}, staleIds.has(l.id) ? "No longer shared with the group as drafted: remove or rewrite this line before saving." :
            (l.sources || []).length ? "Sources: " + l.sources.map((x) => x.kind.replace("_", " ")).join(", ") : l.own ? "Your own line." : "No source: a note."),
          el("button", { type: "button", class: "link", onclick: () => { U().remove(draft, l.id); drawDraft(body, data); } }, "Remove"));
      })),
      el("button", { type: "button", class: "link", onclick: () => { U().add(draft, s.key, ""); drawDraft(body, data); } }, "Add a line")));
    const save = el("button", { type: "button", class: "primary", onclick: () => saveDraft(body, data, save) }, "Save to Documents");
    body.replaceChildren(el("h4", { class: "update-title" }, draft.title), ...sections,
      el("p", { class: "group-fine update-sharing" }, U().sharingNote(draft)), save);
  }
  // Save: read what is delivered now; a line whose source is no longer shared must go first; then the HTML file is stored
  // and registered as the group's document (org members only).
  async function saveDraft(body, data, button) {
    button.disabled = true;
    try {
      const [own, docs, now] = await Promise.all([
        read(FP.sb.from("entries").select("id").eq("org_id", data.group.id)), read(FP.sb.from("documents").select("id").eq("org_id", data.group.id)), sharedNow(data)]);
      const live = { entry: new Set(list(own).map((r) => r.id)), document: new Set(list(docs).map((r) => r.id)),
        shared_entry: new Map(now.shared.map((r) => [r.id, r.farm_id || null])), shared_document: new Map(now.sharedDocs.map((r) => [r.id, r.farm_id || null])),
        members: now.members };
      const stale = U().recheck(draft, live);
      if (stale.length) { drawDraft(body, data, stale); body.prepend(el("p", { role: "alert", class: "update-alert" }, stale.length + (stale.length === 1 ? " line relies" : " lines rely") + " on records no longer shared with the group as they were when drafted (a record withdrawn, or a farm no longer named). Remove or rewrite them, then save.")); return; }
      const author = person?.email || null, savedAt = new Date().toISOString();
      const html = U().render(draft, { savedAt, savedBy: person?.id || null, author });
      const bytes = new TextEncoder().encode(html), sha = await FP.documentsBlock.sha256Hex(bytes.buffer);
      const path = "org/" + data.group.id + "/" + sha + ".html";
      const up = await FP.sb.storage.from("documents").upload(path, new Blob([bytes], { type: "text/html" }), { contentType: "text/html", upsert: false });
      if (up.error && !/exist|duplicate|409/i.test(String(up.error.message || "") + (up.error.statusCode || ""))) throw up.error;
      const row = U().documentRow(draft, { sha256: sha, path, size: bytes.length, author, savedAt });
      const saved = await read(FP.sb.from("documents").insert(row).select("id").single());
      data.documents = [...data.documents, { ...row, id: saved?.id || "saved", created_at: savedAt }];
      notice = "Saved “" + draft.title + "” to the group's Documents.";
      draft = null;
      location.hash = FP.href(G().href(data.group.id, "documents"));
    } catch (e) {
      body.append(el("p", { role: "alert", class: "update-alert" }, "Couldn't save the update: " + (e.message || e)));
    } finally { button.disabled = false; }
  }

  // ---- Settings (group admins): how member farms are shown ---------------------------------------------------------------------
  function settingsView(data) {
    const current = data.summary.member_detail || "aggregated";
    const form = el("form", { class: "group-settings" },
      el("fieldset", {}, el("legend", {}, "How member farms are shown to the group"),
        ...G().LEVELS.map((lv) => el("label", { class: "group-choice" }, el("input", { type: "radio", name: "member-detail", value: lv, ...(lv === current ? { checked: true } : {}) }),
          el("span", {}, G().LEVEL_TEXT[lv])))),
      el("p", { class: "group-fine" }, "This is the most the group shows. Each farm's owner chooses the most their farm allows, and a farm is shown at the lower of the two. Figures from fewer than " + G().K + " farms are never shown."),
      el("p", { class: "group-fine" }, "A record a farm owner shares with the group always shows its content and its exact location, whatever this setting; the setting decides only whether the group can tell which farm it came from."),
      el("p", { class: "group-fine" }, "The group's own layers, such as its member blocks layer, are the group's own map and are always shown."),
      el("button", { type: "submit", class: "primary" }, "Save"), el("p", { class: "group-status", role: "status" }));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const level = form.querySelector("input[name=member-detail]:checked")?.value, status = form.querySelector(".group-status");
      if (!level) return;
      const { error } = await FP.sb.rpc("set_group_member_detail", { g: data.group.id, level });
      if (error) { status.textContent = "Couldn't save: " + error.message; return; }
      status.textContent = "Saved. Member farms are now shown " + level + " where each farm allows it.";
      // the map and figures are read again at the new level, and the map is drawn again in place
      const current = token;
      ctx = { group: data.group, pending: load(data.group) };
      mapHandle?.destroy(); mapHandle = null; mapReady = null; wq?.destroy(); wq = null;
      try { ctx.data = await ctx.pending; if (current === token) await drawMap(ctx.data, current); } catch { /* the next view reads again */ }
    });
    return form;
  }

  FP.groupSpace = { setGroups, find, open, close, load, groupAnalysisPreset, groups: () => groups, hasPortfolio: null };
})(typeof window === "undefined" ? globalThis : window);
