// SG2: sub-groups a member business belongs to, as People shows them. Three small parts, each reading only when it is drawn:
//   * chips(business, ctx): on a parent group's business page, the sub-groups the business is in (each a link to the sub-group's
//     space when the person is a member of it, plain text otherwise), and for the parent's facilitators, advisors and admins an
//     add and a remove (public.business_subgroups, public.subgroup_counts; writes to public.subgroup_businesses);
//   * readFilter(sb, g): the directory's "Sub-group" filter: the parent's sub-groups with their counts (subgroup_counts), then one
//     bounded read of which business is in which (subgroup_businesses, at most the sum of the counts). Read when the filter is
//     opened, never when People opens;
//   * roster(group, ctx) and view(group, ctx): in a sub-group's own space, its members (businesses on the parent's register) by
//     name and member number (public.subgroup_business_list), for the sub-group's facilitators, advisors and admins and the parent's
//     (docs/PRODUCT.md: People is for coordinators). Contact details and interactions belong to the parent's register (PE1): one of
//     the parent's facilitators, advisors or admins opens the parent's page for a member here; one of those roles who can read the
//     parent's register adds and ends members here.
// Every read and write is as the signed-in person; the database decides (migration 20261112060000). Words and logic: people-model.js.
(function (root) {
  const FP = root.FP;
  const M = () => FP.peopleModel, G = () => FP.groupModel;
  const el = (...a) => FP.el(...a);
  const message = (e) => e?.message || String(e);
  async function rows(query) { const { data, error } = await query; if (error) throw error; return Array.isArray(data) ? data : []; }

  // ---- a business's sub-groups (the parent's business page) -------------------------------------------------------------------------
  // ctx: { sb, group (the parent: id, role), today: "YYYY-MM-DD" }
  function chips(business, ctx) {
    const sb = ctx.sb || FP.sb, write = M().canWriteSubgroups(ctx.group?.role);
    const box = el("section", { class: "crm-section sg-chips", "data-subgroups": business.id, "aria-busy": "true" });
    let state = { list: null, counts: null, failed: null, notice: null, busy: false };
    async function load() {
      try {
        const [list, counts] = await Promise.all([rows(sb.rpc("business_subgroups", { b: business.id })), write ? rows(sb.rpc("subgroup_counts", { parent_org: ctx.group.id })) : Promise.resolve([])]);
        state = { ...state, list, counts, failed: null };
      } catch (e) { state = { ...state, failed: message(e) }; }
      draw();
    }
    function link(c) {
      const href = c.member && FP.href ? FP.href(G().href(c.id)) : null;
      return href ? el("a", { href, class: "sg-name" }, c.name) : el("span", { class: "sg-name" }, c.name);
    }
    function draw() {
      box.setAttribute("aria-busy", String(state.list == null && !state.failed));
      if (state.failed) { box.replaceChildren(el("h4", {}, "Sub-groups"), el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the sub-groups just now: " + state.failed)); return; }
      if (state.list == null) { box.replaceChildren(); return; }
      const c = M().subgroupChips(state.list), choices = write ? M().addChoices(state.counts, c) : [];
      // a group with no sub-groups, and a business in none that cannot be added to one: nothing to show
      if (!c.current.length && !c.past.length && !choices.length) { box.hidden = true; box.replaceChildren(); return; }
      box.hidden = false;
      const chip = (x) => el("li", { class: "crm-chip sg-chip", "data-subgroup": x.id },
        link(x),
        write ? el("button", { type: "button", class: "link sg-remove", "aria-label": "Remove " + business.business_name + " from " + x.name, disabled: state.busy, onclick: () => end(x) }, "×") : null);
      const parts = [el("h4", {}, "Sub-groups (" + c.current.length + ")"),
        ...(state.notice ? [el("p", { class: "crm-notice", role: "status" }, state.notice)] : []),
        c.current.length ? el("ul", { class: "crm-labels sg-list" }, ...c.current.map(chip)) : el("p", { class: "crm-empty" }, "Not in a sub-group.")];
      if (choices.length) {
        const pick = el("select", { id: "sg-add", "aria-label": "Add to a sub-group" }, el("option", { value: "" }, "Add to a sub-group…"), ...choices.map((x) => el("option", { value: x.id }, x.name)));
        const form = el("form", { class: "crm-link-form sg-add" }, pick, el("button", { type: "submit", class: "secondary", disabled: state.busy }, "Add"));
        form.addEventListener("submit", (e) => { e.preventDefault(); if (pick.value) add(choices.find((x) => x.id === pick.value)); });
        parts.push(form);
      }
      if (c.past.length) parts.push(el("details", { class: "crm-past" }, el("summary", {}, "Earlier (" + c.past.length + ")"),
        el("ul", { class: "crm-people" }, ...c.past.map((x) => el("li", { "data-subgroup": x.id }, link(x), el("small", {}, " until " + M().dateText(x.left_on)))))));
      box.replaceChildren(...parts);
    }
    async function add(x) {
      state.busy = true; draw();
      const { error } = await sb.from("subgroup_businesses").insert({ org_id: x.id, group_member_id: business.id, source: "manual" });
      state.busy = false;
      state.notice = error ? "Couldn't add it: " + message(error) : business.business_name + " is now in " + x.name + ".";
      await load();
    }
    async function end(x) {
      state.busy = true; draw();
      const { error } = await sb.from("subgroup_businesses").update({ left_on: ctx.today }).eq("id", x.rowId);
      state.busy = false;
      state.notice = error ? "Couldn't remove it: " + message(error) : business.business_name + " is no longer in " + x.name + " (kept under Earlier).";
      await load();
    }
    load();
    return box;
  }

  // ---- the directory's filter (read when it is opened) ---------------------------------------------------------------------------------
  // { counts: subgroup_counts rows, index: business id -> Set of sub-group ids, truncated }
  async function readFilter(sb, g) {
    const counts = await rows(sb.rpc("subgroup_counts", { parent_org: g }));
    const n = M().subgroupMapSize(counts);
    const map = n ? await rows(sb.from("subgroup_businesses").select("org_id,group_member_id,left_on").eq("parent_org_id", g).is("left_on", null)
      .order("group_member_id", { ascending: true }).limit(n)) : [];
    return { counts, index: M().subgroupIndex(map), truncated: n >= M().SUBGROUP_CAP };
  }

  // ---- a sub-group's own members (businesses on the parent's register) ------------------------------------------------------------------
  // ctx: { sb, parent (the person's record of the parent group, when they are a member of it: id, name, role), person, today, now }
  // Shown only to the sub-group's facilitators, advisors and admins and to the parent's (people.js, group-space.js). Who may add and
  // end here: one of those, who can also read the parent's register (a member of the parent; the HDLG case). Anyone else: the lines.
  function roster(group, ctx = {}) {
    const sb = ctx.sb || FP.sb, parent = ctx.parent || null;
    const adviser = !!parent && M().canSee(parent.role);    // one of the parent's facilitators, advisors or admins: opens the parent's page
    const writer = !!parent && (M().canSee(group.role) || adviser);   // may add and end, and can read the parent's register to choose from
    const box = el("section", { class: "sg-roster", "data-subgroup": group.id, "aria-busy": "true" },
      el("h3", {}, "Members in " + group.name), el("p", { class: "crm-count", role: "status" }, "Reading the sub-group's members…"));
    let ids = new Map();       // member number -> the parent's register id (read only by those who may read the register)
    let rowIds = new Map();    // the parent's register id -> its current subgroup_businesses row (writers)
    let list = [], notice = null, adding = null;   // adding: null, or { register: [...] | null, failed }
    async function load() {
      try {
        list = await rows(sb.rpc("subgroup_business_list", { sub_org: group.id }));
        if ((adviser || writer) && list.length) ids = await registerIds(sb, parent.id, list.map((r) => r.member_number)).catch(() => new Map());
        if (writer) {
          const current = list.filter((r) => !r.left_on).length;
          rowIds = current ? new Map((await rows(sb.from("subgroup_businesses").select("id,group_member_id").eq("org_id", group.id).is("left_on", null).limit(current)))
            .map((r) => [r.group_member_id, r.id])) : new Map();
        }
        draw(M().roster(list), null);
      } catch (e) { draw(null, message(e)); }
    }
    function line(r) {
      const id = ids.get(r.member_number), body = [el("b", {}, r.business_name), el("small", {}, M().rosterLine(r))];
      const row = rowIds.get(id);
      return el("li", { class: "crm-row" + (r.left_on ? " ended" : ""), "data-member": r.member_number },
        id && adviser ? el("button", { type: "button", "data-business": id, onclick: () => openInParent(id) }, ...body) : el("div", { class: "sg-row" }, ...body),
        writer && row && !r.left_on ? el("button", { type: "button", class: "link sg-remove", "aria-label": "Remove " + r.business_name + " from " + group.name, onclick: () => end(r, row) }, "Remove") : null);
    }
    function addForm() {
      if (!writer) return null;
      if (!adding) return el("div", { class: "crm-actions" }, el("button", { type: "button", class: "secondary", "data-action": "sg-add", onclick: openAdd }, "Add a member"));
      if (adding.failed) return el("p", { role: "alert", class: "crm-failed" }, "Couldn't read " + (parent.name || "the parent group") + "'s members just now: " + adding.failed);
      if (!adding.register) return el("p", { class: "crm-count", role: "status" }, "Reading " + (parent.name || "the parent group") + "'s members…");
      const have = new Set(list.filter((r) => !r.left_on).map((r) => r.member_number));
      const choices = adding.register.filter((b) => !have.has(b.member_number));
      if (!choices.length) return el("p", { class: "crm-empty" }, "Every current member of " + (parent.name || "the parent group") + " is in this sub-group.");
      const pick = el("select", { id: "sg-roster-add", "aria-label": "A member of " + (parent.name || "the parent group") }, el("option", { value: "" }, "Choose a member…"),
        ...choices.map((b) => el("option", { value: b.id }, b.business_name + " (member " + b.member_number + ")")));
      const form = el("form", { class: "crm-link-form sg-add" }, pick, el("button", { type: "submit", class: "secondary" }, "Add"));
      form.addEventListener("submit", (e) => { e.preventDefault(); const b = choices.find((x) => x.id === pick.value); if (b) add(b); });
      return form;
    }
    function draw(r, failed) {
      box.setAttribute("aria-busy", "false");
      const head = [el("h3", {}, "Members in " + group.name)];
      if (failed) { box.replaceChildren(...head, el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the sub-group's members just now: " + failed)); return; }
      const note = el("p", { class: "crm-quiet sg-note" }, M().contactsNote(parent?.name), adviser ? " Open a member to see them, as " + (parent.name || "the parent group") + "'s " + parent.role + "." : "");
      box.replaceChildren(...[...head, ...(notice ? [el("p", { class: "crm-notice", role: "status" }, notice)] : []),
        el("p", { class: "crm-count", role: "status" }, M().plural(r.current.length, "member", "members")), note, addForm(),
        r.current.length ? el("ul", { class: "crm-list sg-list" }, ...r.current.map(line)) : el("p", { class: "crm-empty" }, "No members are listed in this sub-group yet."),
        r.past.length ? el("details", { class: "crm-past" }, el("summary", {}, "Earlier (" + r.past.length + ")"), el("ul", { class: "crm-list" }, ...r.past.map(line))) : null].filter(Boolean));
    }
    // The parent's current members to choose from, read as the person when they first ask to add (counted first, at most 5,000).
    async function openAdd() {
      adding = { register: null, failed: null }; draw(M().roster(list), null);
      try {
        const head = await sb.from("group_members").select("id", { count: "exact", head: true }).eq("org_id", parent.id).is("ended_at", null);
        if (head.error) throw head.error;
        const n = Math.min(typeof head.count === "number" ? head.count : M().SUBGROUP_CAP, M().SUBGROUP_CAP);
        adding.register = n ? await rows(sb.from("group_members").select("id,member_number,business_name").eq("org_id", parent.id).is("ended_at", null)
          .order("business_name", { ascending: true }).limit(n)) : [];
      } catch (e) { adding.failed = message(e); }
      draw(M().roster(list), null);
    }
    async function add(b) {
      const { error } = await sb.from("subgroup_businesses").insert({ org_id: group.id, group_member_id: b.id, source: "manual" });
      notice = error ? "Couldn't add them: " + message(error) : b.business_name + " is now in " + group.name + ".";
      adding = null;
      await load();
    }
    async function end(r, rowId) {
      const { error } = await sb.from("subgroup_businesses").update({ left_on: ctx.today }).eq("id", rowId);
      notice = error ? "Couldn't remove them: " + message(error) : r.business_name + " is no longer in " + group.name + " (kept under Earlier).";
      await load();
    }
    // The parent's People page for one member, in place of this list; Back returns here.
    function openInParent(id) {
      const kept = [...box.childNodes];
      const page = FP.groupPeople.view(parent, { sb, person: ctx.person, today: ctx.today, now: ctx.now, business: id, onBack: () => box.replaceChildren(...kept) });
      box.replaceChildren(page);
      page.scrollIntoView?.({ block: "start" });
    }
    load();
    return box;
  }
  // The parent's register ids for these member numbers, read as the person (the parent's members read the register), in pieces.
  async function registerIds(sb, parentId, numbers) {
    const out = new Map(), uniq = [...new Set(numbers)];
    for (let i = 0; i < uniq.length; i += 200) {
      const part = uniq.slice(i, i + 200);
      for (const r of await rows(sb.from("group_members").select("id,member_number").eq("org_id", parentId).in("member_number", part).limit(part.length))) out.set(r.member_number, r.id);
    }
    return out;
  }
  // People in a sub-group's space for one of its parent's facilitators, advisors or admins who holds no such role in the sub-group:
  // its members only.
  function view(group, ctx = {}) {
    const wrap = el("section", { class: "group-people sg-people", "data-view": "people", "data-group": group.id });
    wrap.append(el("h2", {}, "People"), roster(group, ctx));
    return wrap;
  }

  FP.subgroups = { chips, readFilter, roster, view, registerIds };
})(typeof window === "undefined" ? globalThis : window);
