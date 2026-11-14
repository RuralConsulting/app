// PJ1: a group's Projects (under More) and one project's page (docs/PRODUCT.md "A list"; docs/architecture/access-rls.md, "Projects:
// who sees what"). The list: this group's projects, then those it takes part in, as rows (name, one quiet line, the status at the
// right); a coordinator's one action is New project. The page: what the project is; who sees it (the project's own switch and the rule
// in one sentence); who takes part; what is due and the funders (coordinators only, never shared: no switch); its files, map layers
// and events. Every row carries its label, "Only coordinators" or "Shared with members", and for the project's coordinators that label
// is a switch. A coordinator's one action on the page is Add (who takes part, a date due, a funder, a file, a layer, an event).
//
// Reads, all as the signed-in person (row-level security decides; nothing here widens it): public.group_projects(g) for the list;
// projects, project_participants, project_dates_due, project_funders, documents, map_layers and group_events by the project for the
// page, at most 200 of each. Writes, as the person: the four project tables (their policies: the owning group's facilitators, advisors
// and admins), and public.project_tag for putting an item in the project, sharing it and taking it out.
(function (root) {
  const FP = root.FP;
  const M = () => FP.projectsModel;
  const R = () => FP.formRows;
  const el = (...a) => FP.el(...a);
  const LIMIT = 200;
  const PROJECT_COLS = "id,org_id,name,purpose,status,starts_on,ends_on,shared_with_members";
  const PARTICIPANT_COLS = "id,project_id,org_id,kind,participant_org_id,group_member_id,name,role,joined_on,left_on,shared_with_members";
  const DUE_COLS = "id,project_id,title,due_on,done_on,document_id,releases_payment,note,archived_at";
  const FUNDER_COLS = "id,project_id,funder_name,agreement_ref,amount,note,archived_at";
  const ITEM_COLS = { file: "id,org_id,title,doc_type,date_prepared,project_id,project_shared", layer: "id,org_id,name,theme,geometry_type,project_id,project_shared",
    event: "id,org_id,title,starts_at,place_name,cancelled_at,project_id,project_shared" };
  const ITEM_TABLE = { file: "documents", layer: "map_layers", event: "group_events" };
  let shown = null;

  const rowsOf = async (q) => { try { const r = await q; return r?.error ? null : r?.data || []; } catch { return null; } };
  const href = (group, item = null) => FP.href(FP.groupModel.href(group.id, "projects", item));

  function view(group, { sb = FP.sb, item = null, groups = [], today = null } = {}) {
    close();
    const me = { alive: true };
    shown = me;
    const live = () => me.alive && shown === me;
    const day = today || M().nzDay(new Date().toISOString());
    const wrap = el("section", { class: "projects", "data-view": "projects", "data-group": group.id, "aria-labelledby": "pj-title" });
    const ctx = { group, sb, groups, today: day, live, wrap };
    if (item) drawProject(ctx, item); else drawList(ctx);
    return wrap;
  }
  function close() { if (shown) shown.alive = false; shown = null; }

  // ==== the list ======================================================================================================================
  async function drawList(ctx) {
    const { group, sb, wrap } = ctx;
    const coordinator = M().isCoordinator(group.role);
    const add = coordinator ? el("button", { type: "button", class: "primary pj-new", id: "pj-new" }, "New project") : null;
    add?.addEventListener("click", () => projectSheet(ctx, null, add));
    const status = el("p", { class: "pj-quiet pj-status", role: "status" }, "Loading…");
    const body = el("div", { class: "pj-sections" });
    wrap.replaceChildren(
      el("div", { class: "pj-head" }, el("div", {}, el("h2", { id: "pj-title" }, "Projects"),
        el("p", { class: "pj-quiet" }, coordinator ? "The group's projects, and those it takes part in. Each thing in a project says who sees it."
          : "Projects your groups take part in, as their coordinators share them.")), add),
      status, body);
    let rows;
    try { const r = await sb.rpc("group_projects", { g: group.id }); rows = r?.error ? null : r?.data || []; } catch { rows = null; }
    if (!ctx.live()) return;
    if (rows == null) { status.textContent = "The projects couldn't be read just now."; return; }
    const list = M().sortProjects(rows);
    const own = list.filter((p) => p.own !== false), other = list.filter((p) => p.own === false);
    status.textContent = list.length ? "" : coordinator ? "No projects yet. A project holds who takes part, what is due to the funder, and its files, layers and events." : "No projects are shared with you here.";
    status.hidden = !status.textContent;
    const section = (title, items, key) => (items.length ? el("section", { class: "pj-section", "data-section": key, "aria-label": title },
      el("h3", {}, title), el("ul", { class: "pj-list fs-set", "aria-label": title }, ...items.map((p) => listRow(ctx, p, coordinator)))) : null);
    body.replaceChildren(...[section(other.length ? "This group's projects" : "", own, "own"), section("Projects this group takes part in", other, "taking-part")].filter(Boolean));
    body.querySelector('[data-section="own"] h3:empty')?.remove();
  }
  function listRow(ctx, p, coordinator) {
    const seen = coordinator && p.own !== false ? M().label(p.shared_with_members) : null;
    return el("li", {}, el("a", { class: "pj-row pj-link", href: href(ctx.group, p.id), "data-project": p.id },
      el("span", { class: "pj-text" }, el("b", {}, p.name), el("small", {}, [M().projectLine(p), seen].filter(Boolean).join(" · "))),
      el("span", { class: "pj-side pj-status-word" }, M().STATUS[p.status] || ""),
      el("span", { class: "pj-chev", "aria-hidden": "true" }, FP.icon("chevron", 16))));
  }

  // ==== one project ===================================================================================================================
  async function drawProject(ctx, id) {
    const { sb, wrap } = ctx;
    const back = el("a", { class: "pj-back", href: href(ctx.group) }, FP.icon("back", 18), el("span", {}, "Projects"));
    const status = el("p", { class: "pj-quiet pj-status", role: "status" }, "Loading…");
    wrap.replaceChildren(back, status);
    const p = (await rowsOf(sb.from("projects").select(PROJECT_COLS).eq("id", id).limit(1)))?.[0] || null;
    if (!ctx.live()) return;
    if (!p) { status.textContent = "This project isn't shared with you, or it isn't there any more."; return; }
    const coordinator = M().coordinatorOf(p, ctx.group, ctx.groups);
    const by = (t, cols) => sb.from(t).select(cols).eq("project_id", p.id).range(0, LIMIT - 1);
    const [participants, due, funders, files, layers, events] = await Promise.all([
      rowsOf(by("project_participants", PARTICIPANT_COLS)),
      coordinator ? rowsOf(by("project_dates_due", DUE_COLS)) : Promise.resolve([]),
      coordinator ? rowsOf(by("project_funders", FUNDER_COLS)) : Promise.resolve([]),
      rowsOf(by("documents", ITEM_COLS.file).order("title")), rowsOf(by("map_layers", ITEM_COLS.layer).order("name")), rowsOf(by("group_events", ITEM_COLS.event).order("starts_at"))]);
    if (!ctx.live()) return;
    const st = { p, coordinator, participants: participants || [], due: due || [], funders: funders || [], file: files || [], layer: layers || [], event: events || [],
      failed: [participants, due, funders, files, layers, events].some((x) => x == null) };
    // the file each date due names (the coordinators read the group's files)
    if (coordinator) for (const d of st.due) d.document_title = st.file.find((f) => f.id === d.document_id)?.title || null;
    const reload = () => drawProject(ctx, id);
    const say = el("p", { class: "pj-say", role: "status", id: "pj-say" });
    ctx.say = (t) => { say.textContent = t || ""; };
    const today = ctx.today;

    // the head: name, the one line, the purpose; the coordinators' one action
    const addBtn = coordinator ? el("button", { type: "button", class: "primary pj-add", id: "pj-add", "aria-haspopup": "dialog", "aria-expanded": "false" }, FP.icon("plus", 18), el("span", {}, "Add")) : null;
    addBtn?.addEventListener("click", () => FP.sheet.menu(addBtn, "Add to " + p.name, [
      { label: "Who takes part", hint: "A sub-group, another group, a member, or a partner or funder", icon: "people", action: "add-participant", run: () => participantSheet(ctx, st, addBtn, reload) },
      { label: "A file", hint: "One of the group's files", icon: "files", action: "add-file", run: () => itemPicker(ctx, st, "file", addBtn, reload) },
      { label: "A map layer", hint: "One of the group's layers", icon: "layers", action: "add-layer", run: () => itemPicker(ctx, st, "layer", addBtn, reload) },
      { label: "An event", hint: "One of the group's events", icon: "events", action: "add-event", run: () => itemPicker(ctx, st, "event", addBtn, reload) },
      { label: "A date due", hint: "A milestone or report owed to the funder", icon: "due", action: "add-due", run: () => dueSheet(ctx, st, addBtn, reload) },
      { label: "A funder", hint: "With the agreement and amount", icon: "report", action: "add-funder", run: () => funderSheet(ctx, st, addBtn, reload) }]));
    const owner = p.org_id !== ctx.group.id ? ctx.groups.find((g) => g.id === p.org_id)?.name || null : null;
    const head = el("div", { class: "pj-head" },
      el("div", { class: "pj-title-block" }, el("h2", { id: "pj-title" }, p.name),
        el("p", { class: "pj-quiet", id: "pj-line" }, [M().STATUS[p.status], M().range(p.starts_on, p.ends_on), owner ? owner + "'s project" : null].filter(Boolean).join(" · "))),
      addBtn);
    // who sees it: the project's own switch, and the rule in one sentence
    const seenSet = el("div", { class: "fs-set pj-set" }, el("div", { class: "pj-row", "data-row": "project" },
      el("span", { class: "pj-text" }, el("b", {}, "This project"), el("small", {}, coordinator ? (p.shared_with_members ? "Its name, purpose and dates, and what is shared below" : "Shared with no one but the coordinators") : "Shared with you by its coordinators")),
      shareControl(st, { kind: "project", row: p, shared: p.shared_with_members, name: "this project",
        save: (on) => write(ctx, () => sb.from("projects").update({ shared_with_members: on }).eq("id", p.id).select("id").single(), on ? "The project is shared with members taking part." : "Only the coordinators see the project now.", reload) })));
    const parts = [back, head,
      p.purpose ? el("p", { class: "pj-purpose" }, p.purpose) : null,
      el("section", { class: "pj-section", "aria-label": "Who sees it" }, el("h3", {}, "Who sees it"), seenSet, el("p", { class: "pj-quiet pj-rule" }, M().RULE)),
      say];

    // who takes part
    const people = M().sortParticipants(st.participants, today);
    parts.push(section("Who takes part", "participants", people.length ? people.map((x) => itemRow(st, {
      key: x.id, kind: "participant", title: x.name, line: M().participantLine(x, today), shared: x.shared_with_members, left: !M().current(x, today),
      save: (on) => write(ctx, () => sb.from("project_participants").update({ shared_with_members: on }).eq("id", x.id).select("id").single(), on ? x.name + " is shared with members." : x.name + " is for the coordinators only.", reload),
      more: M().current(x, today) ? [{ label: "Mark as left today", hint: "They stop seeing what the project shares at once", action: "left-today",
        run: () => write(ctx, () => sb.from("project_participants").update({ left_on: today }).eq("id", x.id).select("id").single(), x.name + " has left the project.", reload) }] : null })) : null,
      coordinator ? "No one is listed yet." : "Nothing about who takes part is shared."));
    // what is due, and the funders: coordinators only, never shared
    if (coordinator) {
      const dues = M().sortDue(st.due, today);
      parts.push(section("What is due", "due", dues.length ? dues.map((d) => itemRow(st, {
        key: d.id, kind: "due", title: d.title, line: M().dueLine(d), side: M().dueWhen(d, today), state: M().dueState(d, today),
        more: [d.done_on ? null : { label: "Mark done today", action: "due-done", run: () => write(ctx, () => sb.from("project_dates_due").update({ done_on: today }).eq("id", d.id).select("id").single(), "Marked done.", reload) },
          { label: "Archive", hint: "It leaves the list. It is kept, not deleted", action: "due-archive", run: () => write(ctx, () => sb.from("project_dates_due").update({ archived_at: new Date().toISOString() }).eq("id", d.id).select("id").single(), "Archived.", reload) }].filter(Boolean) })) : null,
        "Nothing is due yet.", M().NEVER));
      const fs = st.funders.filter((f) => !f.archived_at);
      parts.push(section("Funders", "funders", fs.length ? fs.map((f) => itemRow(st, {
        key: f.id, kind: "funder", title: f.funder_name, line: M().funderLine(f),
        more: [{ label: "Archive", hint: "It leaves the list. It is kept, not deleted", action: "funder-archive", run: () => write(ctx, () => sb.from("project_funders").update({ archived_at: new Date().toISOString() }).eq("id", f.id).select("id").single(), "Archived.", reload) }] })) : null,
        "No funder is recorded yet.", M().NEVER));
    }
    // its files, layers and events
    const itemRows = (kind, rows, title, line) => rows.map((x) => itemRow(st, {
      key: x.id, kind, title: title(x), line: line(x), shared: x.project_shared,
      save: (on) => write(ctx, () => sb.rpc("project_tag", { p_kind: kind, p_item: x.id, p_project: p.id, p_shared: on }), on ? title(x) + " is shared with members." : title(x) + " is for the coordinators only.", reload),
      more: [{ label: "Take out of this project", hint: "It goes back to who could see it before", action: "untag", run: () => write(ctx, () => sb.rpc("project_tag", { p_kind: kind, p_item: x.id, p_project: null, p_shared: false }), title(x) + " is out of the project.", reload) }] }));
    parts.push(section("Files", "files", st.file.length ? itemRows("file", st.file, (x) => x.title, (x) => [x.date_prepared ? M().day(x.date_prepared) : null].filter(Boolean).join(" · ")) : null, "No files in this project" + (coordinator ? " yet." : " are shared with you.")));
    parts.push(section("Map layers", "layers", st.layer.length ? itemRows("layer", st.layer, (x) => x.name, () => "") : null, "No map layers in this project" + (coordinator ? " yet." : " are shared with you.")));
    parts.push(section("Events", "events", st.event.length ? itemRows("event", st.event, (x) => x.title, (x) => M().eventLine(x)) : null, "No events in this project" + (coordinator ? " yet." : " are shared with you.")));
    if (st.failed) parts.push(el("p", { class: "pj-quiet" }, "Some of the project couldn't be read just now."));
    wrap.replaceChildren(...parts.filter(Boolean));
    root.document.title = p.name + " · " + ctx.group.name + " | " + (FP.brand?.product || "");
  }

  // A section: its heading (and a quiet line), one outlined set of rows, or one sentence when it is empty
  function section(title, key, rows, empty, quiet = null) {
    return el("section", { class: "pj-section", "data-section": key, "aria-label": title },
      el("div", { class: "pj-section-head" }, el("h3", {}, title), quiet ? el("span", { class: "pj-never" }, FP.icon("lock", 14), el("span", {}, quiet)) : null),
      rows ? el("ul", { class: "fs-set pj-set pj-list", "aria-label": title }, ...rows) : el("p", { class: "pj-quiet pj-empty" }, empty));
  }
  // A row: the title and its one line; at the right the label (a switch for the coordinators), or the date; for the coordinators, "…"
  function itemRow(st, { key, kind, title, line, shared = null, save = null, side = null, state = null, left = false, more = null }) {
    const control = side != null ? el("span", { class: "pj-side pj-when" + (state ? " pj-" + state : "") }, side)
      : shareControl(st, { kind, row: { id: key }, shared, name: title, save });
    const dots = st.coordinator && more?.length ? FP.sheet.moreButton("More for " + title, more, title) : null;
    return el("li", { class: "pj-row" + (left ? " pj-left" : ""), "data-kind": kind, "data-id": key },
      el("span", { class: "pj-text" }, el("b", {}, title), line ? el("small", {}, line) : null), control, dots);
  }
  // "Only coordinators" or "Shared with members": the words for everyone, and for the coordinators a switch beside them
  function shareControl(st, { kind, row, shared, name, save }) {
    const words = el("span", { class: "pj-seen-words" }, M().label(shared));
    if (!st.coordinator || !save) return el("span", { class: "pj-seen" + (shared ? " pj-shared" : ""), "data-seen": shared ? "shared" : "coordinators" }, words);
    const id = "pj-share-" + kind + "-" + row.id;
    const box = el("input", { type: "checkbox", role: "switch", class: "fs-switch", id, ...(shared ? { checked: true } : {}), "aria-label": "Share " + name + " with members" });
    box.addEventListener("change", async () => {
      box.disabled = true;
      words.textContent = M().label(box.checked);
      const ok = await save(box.checked);
      if (!ok) { box.checked = !box.checked; words.textContent = M().label(box.checked); box.disabled = false; }
    });
    return el("label", { class: "pj-seen pj-share" + (shared ? " pj-shared" : ""), for: id, "data-seen": shared ? "shared" : "coordinators" }, words, box);
  }
  // A write as the person; the page is read again after it, and what the database said is said plainly when it is refused
  async function write(ctx, run, done, after) {
    let r;
    try { r = await run(); } catch (e) { r = { error: e }; }
    if (r?.error) { ctx.say?.(M().refusedWords(r.error)); return false; }
    ctx.say?.(done);
    if (after) await after();
    ctx.say?.(done);
    return true;
  }

  // ==== forms =========================================================================================================================
  function overlay(s, focus) {
    const back = root.document.activeElement;
    root.document.body.append(s.node);
    s.mounted();
    (focus || s.cancel)?.focus();
    return () => { s.close(); if (back?.isConnected) back.focus(); };
  }
  function problemsShown(rows, problems) {
    for (const [k, r] of Object.entries(rows)) R().say(r, problems[k] || "");
    return !Object.keys(problems).length;
  }
  function projectSheet(ctx, _p, opener) {
    const v = { status: "active" };
    let shut = null;
    const s = R().sheet({ id: "pj-form", title: "New project", saveId: "pj-form-save", cancelId: "pj-form-cancel", className: "pj-form", onCancel: () => shut(), onSave: async () => {
      const { row, problems } = M().projectForm({ ...v, name: rows.name._input.value, purpose: rows.purpose._input.value, starts_on: rows.starts_on._input.value, ends_on: rows.ends_on._input.value });
      if (!problemsShown(rows, problems)) return;
      s.save.disabled = true;
      let r;
      try { r = await ctx.sb.from("projects").insert({ org_id: ctx.group.id, ...row }).select("id").single(); } catch (e) { r = { error: e }; }
      s.save.disabled = false;
      if (r?.error) { R().say(rows.name, M().refusedWords(r.error)); return; }
      shut();
      root.location.hash = href(ctx.group, r.data.id);
    } });
    const rows = {
      name: R().text({ id: "pj-name", key: "name", label: "Name", placeholder: "Feral deer pilot", max: M().MAX.name }),
      purpose: R().long({ id: "pj-purpose", key: "purpose", label: "Purpose", placeholder: "One line: what it is for", max: M().MAX.purpose }),
      starts_on: R().text({ id: "pj-starts", key: "starts_on", label: "Starts", type: "date" }),
      ends_on: R().text({ id: "pj-ends", key: "ends_on", label: "Ends", type: "date" }),
    };
    const status = R().pick({ id: "pj-status", key: "status", label: "Status", options: Object.entries(M().STATUS).map(([value, label]) => ({ value, label })), value: () => v.status, onPick: (x) => { v.status = x; } });
    s.body.append(R().set(rows.name, rows.purpose, status, rows.starts_on, rows.ends_on),
      R().quiet("Only the group's coordinators see a new project until they share it."));
    shut = overlay(s, rows.name._input);
  }
  async function participantSheet(ctx, st, opener, after) {
    const g = st.p.org_id, v = { kind: "subgroup", role: "funder", which: null };
    // the choices: the owning group's sub-groups, the person's other groups, the group's current members (bounded)
    const [subs, members] = await Promise.all([
      (async () => { try { const r = await ctx.sb.rpc("subgroup_counts", { parent_org: g }); return (r?.data || []).map((x) => ({ value: x.subgroup_id, label: x.subgroup_name })); } catch { return []; } })(),
      rowsOf(ctx.sb.from("group_members").select("id,member_number,business_name").eq("org_id", g).is("ended_at", null).order("business_name").range(0, 1999))]);
    const others = (ctx.groups || []).filter((x) => x.id !== g && x.parent_org_id !== g).map((x) => ({ value: x.id, label: x.name }));
    const taken = new Set(st.participants.filter((x) => M().current(x, ctx.today)).map((x) => x.participant_org_id || x.group_member_id));
    const choices = () => (v.kind === "subgroup" ? subs : v.kind === "group" ? others
      : (members || []).map((m) => ({ value: m.id, label: m.business_name, hint: m.member_number ? "Member " + m.member_number : null }))).filter((o) => !taken.has(o.value));
    let shut = null;
    const s = R().sheet({ id: "pj-part-form", title: "Who takes part", saveId: "pj-part-save", cancelId: "pj-part-cancel", className: "pj-form", onCancel: () => shut(), onSave: async () => {
      const { row, problems } = M().participantForm({ kind: v.kind, participant_org_id: v.which, group_member_id: v.which, name: rows.name._input.value, role: v.role, joined_on: rows.joined_on._input.value });
      R().say(which, problems.which || problems.kind || "");
      problemsShown({ name: rows.name, joined_on: rows.joined_on }, problems);
      if (Object.keys(problems).length) return;
      s.save.disabled = true;
      let r;
      try { r = await ctx.sb.from("project_participants").insert({ project_id: st.p.id, org_id: g, ...row }).select("id").single(); } catch (e) { r = { error: e }; }
      s.save.disabled = false;
      if (r?.error) { R().say(which, M().refusedWords(r.error)); return; }
      shut(); ctx.say?.("Added. It is for the coordinators only until you share it."); await after();
    } });
    const draw = () => { which._draw?.(); rows.name.hidden = v.kind !== "partner"; roleRow.hidden = v.kind !== "partner"; which.hidden = v.kind === "partner"; };
    const kind = R().pick({ id: "pj-part-kind", key: "kind", label: "Who", options: Object.entries(M().KIND).map(([value, label]) => ({ value, label })), value: () => v.kind,
      onPick: (x) => { v.kind = x; v.which = null; draw(); } });
    const which = R().pick({ id: "pj-part-which", key: "which", label: "Which", title: "Which", options: () => choices(), value: () => v.which, onPick: (x) => { v.which = x; }, empty: "Choose" });
    const rows = { name: R().text({ id: "pj-part-name", key: "name", label: "Name", placeholder: "Regional council", max: M().MAX.name }),
      joined_on: R().text({ id: "pj-part-joined", key: "joined_on", label: "Joined", type: "date" }) };
    const roleRow = R().pick({ id: "pj-part-role", key: "role", label: "Role", options: [{ value: "funder", label: "Funder" }, { value: "partner", label: "Partner" }], value: () => v.role, onPick: (x) => { v.role = x; } });
    s.body.append(R().set(kind, which, rows.name, roleRow, rows.joined_on), R().quiet("A partner or funder has no sign-in: listing them shares nothing with them."));
    shut = overlay(s);
    draw();
  }
  function dueSheet(ctx, st, opener, after) {
    const v = { releases_payment: false };
    let shut = null;
    const s = R().sheet({ id: "pj-due-form", title: "A date due", saveId: "pj-due-save", cancelId: "pj-due-cancel", className: "pj-form", onCancel: () => shut(), onSave: async () => {
      const { row, problems } = M().dueForm({ title: rows.title._input.value, due_on: rows.due_on._input.value, note: rows.note._input.value, releases_payment: pay._input.checked });
      if (!problemsShown(rows, problems)) return;
      s.save.disabled = true;
      let r;
      try { r = await ctx.sb.from("project_dates_due").insert({ project_id: st.p.id, org_id: st.p.org_id, ...row }).select("id").single(); } catch (e) { r = { error: e }; }
      s.save.disabled = false;
      if (r?.error) { R().say(rows.title, M().refusedWords(r.error)); return; }
      shut(); ctx.say?.("Added."); await after();
    } });
    const rows = { title: R().text({ id: "pj-due-title", key: "title", label: "What", placeholder: "Milestone 3 report", max: M().MAX.name }),
      due_on: R().text({ id: "pj-due-on", key: "due_on", label: "Due", type: "date" }),
      note: R().long({ id: "pj-due-note", key: "note", label: "Note", placeholder: "Optional", max: M().MAX.note }) };
    const pay = R().toggle({ id: "pj-due-pay", key: "releases_payment", label: "Releases a payment", checked: v.releases_payment });
    s.body.append(R().set(rows.title, rows.due_on, pay, rows.note), R().quiet(M().NEVER + "."));
    shut = overlay(s, rows.title._input);
  }
  function funderSheet(ctx, st, opener, after) {
    let shut = null;
    const s = R().sheet({ id: "pj-funder-form", title: "A funder", saveId: "pj-funder-save", cancelId: "pj-funder-cancel", className: "pj-form", onCancel: () => shut(), onSave: async () => {
      const { row, problems } = M().funderForm({ funder_name: rows.funder_name._input.value, agreement_ref: rows.agreement_ref._input.value, amount: rows.amount._input.value, note: rows.note._input.value });
      if (!problemsShown(rows, problems)) return;
      s.save.disabled = true;
      let r;
      try { r = await ctx.sb.from("project_funders").insert({ project_id: st.p.id, org_id: st.p.org_id, ...row }).select("id").single(); } catch (e) { r = { error: e }; }
      s.save.disabled = false;
      if (r?.error) { R().say(rows.funder_name, M().refusedWords(r.error)); return; }
      shut(); ctx.say?.("Added."); await after();
    } });
    const rows = { funder_name: R().text({ id: "pj-funder-name", key: "funder_name", label: "Funder", max: M().MAX.name }),
      agreement_ref: R().text({ id: "pj-funder-ref", key: "agreement_ref", label: "Agreement", placeholder: "Its reference", max: M().MAX.ref }),
      amount: R().text({ id: "pj-funder-amount", key: "amount", label: "Amount", placeholder: "$", inputmode: "decimal" }),
      note: R().long({ id: "pj-funder-note", key: "note", label: "Note", placeholder: "Optional", max: M().MAX.note }) };
    s.body.append(R().set(rows.funder_name, rows.agreement_ref, rows.amount, rows.note), R().quiet(M().NEVER + "."));
    shut = overlay(s, rows.funder_name._input);
  }
  // A file, layer or event of the owning group that is in no project yet: a plain list to choose from (the newest 500)
  async function itemPicker(ctx, st, kind, opener, after) {
    let q = ctx.sb.from(ITEM_TABLE[kind]).select(ITEM_COLS[kind]).eq("org_id", st.p.org_id).is("project_id", null);
    if (kind === "event") q = q.is("cancelled_at", null).order("starts_at", { ascending: false });
    else q = q.order(kind === "file" ? "title" : "name");
    const rows = await rowsOf(q.range(0, 499));
    if (!ctx.live()) return;
    const options = (rows || []).map((x) => ({ value: x.id, label: x.title || x.name, hint: kind === "event" ? M().eventLine(x) : null }));
    if (!options.length) { ctx.say?.(rows == null ? "The group's " + M().KINDS_OF_ITEM[kind].toLowerCase() + " couldn't be read just now." : "Every one of the group's " + M().KINDS_OF_ITEM[kind].toLowerCase() + " is in a project already, or there are none."); return; }
    R().list({ opener, title: "Add " + M().KINDS_OF_ITEM[kind].toLowerCase().replace(/s$/, ""), options, value: null, multi: false,
      onPick: (id) => write(ctx, () => ctx.sb.rpc("project_tag", { p_kind: kind, p_item: id, p_project: st.p.id, p_shared: false }), "Added. It is for the coordinators only until you share it.", after) });
  }

  FP.projects = { view, close, LIMIT };
})(typeof window === "undefined" ? globalThis : window);
