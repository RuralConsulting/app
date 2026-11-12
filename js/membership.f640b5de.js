// M1b: a member's Membership and "Where they are at" on their People page, and the group admins' "Fields and types" screen.
// Every read and write is as the signed-in person (migration 20261113010000; the database decides who may: the group's
// facilitators, advisors and admins fill in fields and change a type; its admins define fields and types and end or reopen a
// membership). The words and the rules are in membership-model.js. Drawn by people.js; nothing here is shown to anyone else.
(function (root) {
  const FP = root.FP;
  const MM = () => FP.membershipModel, P = () => FP.peopleModel;
  const el = (...a) => FP.el(...a);
  const message = (e) => e?.message || String(e);
  const FIELD_COLS = "id,org_id,key,label,kind,choices,sort_order,shown_in_list,archived_at";

  // The group's fields (its facilitators, advisors and admins read them) and membership types (the defaults are added the first
  // time a group needs them). Never fails: a failure is an empty list and its reason.
  async function readDefinitions(sb, g) {
    const out = { fields: [], types: [], failed: null };
    try {
      const f = await sb.from("group_fields").select(FIELD_COLS).eq("org_id", g).order("sort_order").limit(200);
      if (f.error) throw f.error;
      const t = await sb.rpc("crm_membership_types", { g });
      if (t.error) throw t.error;
      Object.assign(out, { fields: f.data || [], types: t.data || [] });
    } catch (e) { out.failed = message(e); }
    return out;
  }
  async function readMember(sb, b) {
    const { data, error } = await sb.rpc("crm_membership", { b });
    if (error) throw error;
    return data || { terms: [], fields: [] };
  }

  // ---- a member's Membership --------------------------------------------------------------------------------------------------------
  // ctx: { sb, group, business, page: crm_membership's json, types, today, done(notice) (redraws the page afresh) }
  function membershipSection(ctx) {
    const { group, business: b, page, today } = ctx;
    const terms = page?.terms || [], cur = terms.find((t) => t.current) || null, past = terms.filter((t) => !t.current);
    const types = MM().activeTypes(ctx.types);
    const box = el("section", { class: "crm-section mf-membership", "data-section": "membership" }, el("h4", {}, "Membership"));
    box.append(cur ? el("p", { class: "mf-term" }, el("b", {}, cur.type), cur.joined_on ? " · joined " + P().dateText(cur.joined_on) : " · joined date not recorded")
      : el("p", { class: "crm-empty" }, b.ended_at ? "Left the register " + P().dateText(P().dayKey(b.ended_at)) + "." : "No membership recorded yet."));
    if (cur && b.ended_at) box.append(el("p", { class: "group-fine" }, "This member left the register on " + P().dateText(P().dayKey(b.ended_at)) + " while this membership is still current: end it to match."));
    if (past.length) box.append(el("details", { class: "crm-past mf-history" }, el("summary", {}, "History (" + past.length + ")"),
      el("ul", { class: "mf-terms" }, ...past.map((t) => el("li", {}, MM().termText(t), t.note ? el("small", {}, t.note) : null)))));
    if (cur?.note) box.append(el("p", { class: "group-fine" }, cur.note));
    const actions = el("div", { class: "mf-actions" }), form = el("div", { class: "mf-inline" });
    const status = el("p", { class: "mf-status", role: "status" });
    const dateIn = (id) => { const i = el("input", { id, type: "date", "aria-label": "From" }); i.value = today; return i; };
    const typeSelect = (id, keep) => el("select", { id, "aria-label": "Type" }, ...types.filter((t) => t.id !== keep).map((t) => el("option", { value: t.id }, t.name)));
    async function call(fn, args, done) {
      status.textContent = "Saving…";
      const { error } = await ctx.sb.rpc(fn, args);
      if (error) { status.textContent = "Couldn't save: " + message(error); return; }
      ctx.done(done);
    }
    function open(kind) {
      form.replaceChildren();
      if (kind === "change") {
        const t = typeSelect("mf-type", cur?.membership_type_id), d = dateIn("mf-from");
        form.append(el("label", { for: "mf-type" }, cur ? "New type" : "Type"), t, el("label", { for: "mf-from" }, cur ? "From" : "Joined"), d,
          el("button", { type: "button", class: "secondary", "data-action": "save-type", onclick: () => call("crm_change_membership_type", { b: b.id, type_id: t.value, on_date: d.value || null },
            cur ? "Type changed. The earlier type is kept in the history." : "Membership recorded.") }, "Save"));
      } else if (kind === "end") {
        const d = dateIn("mf-left"), why = el("input", { id: "mf-why", type: "text", maxlength: "300", autocomplete: "off", placeholder: "Why (optional, for the group only)" });
        form.append(el("label", { for: "mf-left" }, "Left on"), d, el("label", { for: "mf-why" }, "Reason"), why,
          el("p", { class: "group-fine" }, MM().endNote(!!b.ended_at)),
          el("button", { type: "button", class: "secondary", "data-action": "end-membership", onclick: () => call("crm_end_membership", { b: b.id, on_date: d.value || null, reason: why.value.trim() || null },
            "Membership ended. It is kept in the history.") }, "End membership"));
      } else if (kind === "reopen") {
        const t = typeSelect("mf-type"), d = dateIn("mf-from");
        form.append(el("label", { for: "mf-type" }, "Type"), t, el("label", { for: "mf-from" }, "From"), d,
          el("p", { class: "group-fine" }, "This puts the member back on the register."),
          el("button", { type: "button", class: "secondary", "data-action": "reopen", onclick: () => call("crm_reopen_membership", { b: b.id, type_id: t.value, on_date: d.value || null },
            "Membership reopened.") }, "Reopen"));
      }
      form.querySelector("select, input")?.focus();
    }
    for (const a of MM().memberActions(group.role, cur, !!b.ended_at, types.length)) {
      if (a === "change" || a === "record") actions.append(el("button", { type: "button", class: "link", "data-action": "change-type", onclick: () => open("change") }, a === "change" ? "Change type" : "Record membership"));
      else if (a === "end") actions.append(el("button", { type: "button", class: "link", "data-action": "end", onclick: () => open("end") }, "End membership"));
      else actions.append(el("button", { type: "button", class: "link", "data-action": "reopen-open", onclick: () => open("reopen") }, "Reopen"));
    }
    if (actions.childElementCount) box.append(actions, form, status);
    return box;
  }

  // ---- a member's "Where they are at" -----------------------------------------------------------------------------------------------
  // Each of the group's fields, edited in place by its facilitators, advisors and admins and saved on change, with a quiet "Saved".
  function fieldsSection(ctx) {
    const { group, business: b, page } = ctx, fields = page?.fields || [];
    const box = el("section", { class: "crm-section mf-fields", "data-section": "fields" }, el("h4", {}, "Where they are at"));
    if (!fields.length) {
      box.append(el("p", { class: "crm-empty" }, "The group has no fields of its own yet." + (MM().canDefine(group.role) ? "" : " Its admins add them.")));
      if (MM().canDefine(group.role) && ctx.openSettings) box.append(el("button", { type: "button", class: "link", "data-action": "fields", onclick: ctx.openSettings }, "Add the group's fields"));
      return box;
    }
    const list = el("div", { class: "mf-grid" });
    for (const f of fields) {
      const id = "mf-f-" + f.key, status = el("small", { class: "mf-saved", role: "status" });
      let control, chain = Promise.resolve(), latest = 0;
      // Saves of one field go to the database in the order they were made (each waits for the one before), and only the latest
      // one's outcome is said, so "Saved" never refers to an older value.
      const save = (v) => {
        const n = ++latest;
        status.removeAttribute("role"); status.setAttribute("role", "status"); status.textContent = "Saving…";
        chain = chain.then(async () => {
          const { error } = await ctx.sb.rpc("crm_set_field_value", { b: b.id, field: f.field_id, value: MM().valueArg(f, v) });
          if (!error) { f.value = v === "" ? null : v; f.orphaned = false; ctx.changed?.(f); }
          if (n !== latest) return;
          status.textContent = error ? "Couldn't save: " + message(error) : "Saved";
          if (error) status.setAttribute("role", "alert");
        }, () => {});
        return chain;
      };
      if (f.kind === "choice") {
        control = el("select", { id }, el("option", { value: "" }, "Not set"),
          ...(f.orphaned ? [el("option", { value: f.value, selected: true }, f.value + MM().ORPHAN)] : []),
          ...(f.choices || []).map((c) => el("option", { value: c, ...(c === f.value ? { selected: true } : {}) }, c)));
        control.addEventListener("change", () => save(control.value));
      } else if (f.kind === "date") {
        control = el("input", { id, type: "date" }); control.value = f.value ? String(f.value).slice(0, 10) : "";
        control.addEventListener("change", () => save(control.value));
      } else if (f.kind === "tick") {
        control = el("input", { id, type: "checkbox", ...(f.value === true ? { checked: true } : {}) });
        control.addEventListener("change", () => save(control.checked));
      } else {
        control = el("input", { id, type: "text", maxlength: "200", autocomplete: "off" }); control.value = f.value || "";
        control.addEventListener("change", () => save(control.value));
      }
      if (!MM().canEdit(group.role)) control.disabled = true;
      list.append(el("div", { class: "mf-field" + (f.kind === "tick" ? " mf-tick" : ""), "data-field": f.key }, el("label", { for: id }, f.label), control, status));
    }
    box.append(list);
    return box;
  }

  // ---- Fields and types (the group's admins) ------------------------------------------------------------------------------------------
  // ctx: { sb, group, defs: { fields, types }, rows (the directory, to say who keeps a removed choice), back, reload() -> defs }
  function settingsScreen(ctx) {
    const { sb, group } = ctx, g = group.id;
    const box = el("div", { class: "mf-settings", "data-view": "fields-and-types" }, ctx.backButton("Back to People"), el("h3", {}, "Fields and types"));
    if (!MM().canDefine(group.role)) { box.append(el("p", { class: "crm-empty" }, "The group's admins define its fields and membership types.")); return box; }
    const status = el("p", { class: "crm-notice", role: "status" });
    const redraw = async (notice) => { const defs = await ctx.reload(); ctx.defs = defs; box.replaceWith(settingsScreen({ ...ctx, notice })); };
    if (ctx.notice) status.textContent = ctx.notice;
    const fail = (e) => { status.textContent = "Couldn't save: " + message(e); };
    const fields = MM().active(ctx.defs.fields), archived = (ctx.defs.fields || []).filter((f) => f.archived_at);
    // A write is "saved" only when the database says a row was written (row-level security changes nothing for someone who may
    // not, without an error): each write asks for the written row's id back.
    const wrote = (r) => !r.error && (Array.isArray(r.data) ? r.data.length > 0 : !!r.data);
    const notWritten = "Couldn't save: nothing was changed (it may no longer be yours to change).";
    const write = async (q, notice) => { const r = await q.select("id"); if (r.error) fail(r.error); else if (!wrote(r)) status.textContent = notWritten; else await redraw(notice); };
    const move = (list, i, by, table) => {
      const a = list[i], b = list[i + by];
      if (!a || !b) return;
      // two writes: swap the two sort orders (each its own number, so a tie never decides)
      const sa = Number(a.sort_order) || i + 1, sb2 = Number(b.sort_order) || i + by + 1;
      Promise.all([sb.from(table).update({ sort_order: sa === sb2 ? sb2 + by : sb2 }).eq("id", a.id).select("id"), sb.from(table).update({ sort_order: sa }).eq("id", b.id).select("id")])
        .then((r) => { const e = r.find((x) => x.error); if (e) fail(e.error); else if (!r.every(wrote)) status.textContent = notWritten; else redraw("Order saved."); });
    };
    // the fields
    const fieldRow = (f, i) => {
      const form = MM().fieldForm(f), label = el("input", { type: "text", maxlength: "80", "aria-label": "Name of the field", value: form.label });
      const choices = f.kind === "choice" ? el("textarea", { rows: "3", "aria-label": "Choices of " + f.label }) : null;
      if (choices) choices.value = form.choices;
      const shown = el("input", { type: "checkbox", id: "mf-show-" + f.key, ...(f.shown_in_list ? { checked: true } : {}) });
      const save = el("button", { type: "button", class: "secondary", "data-action": "save-field", onclick: () => {
        const r = MM().toField({ label: label.value, choices: choices?.value, shown_in_list: shown.checked }, f);
        if (r.errors.length) { status.textContent = r.errors.join(" "); return; }
        const gone = MM().removedChoices(f, r.row.choices, ctx.rows).filter((x) => x.members);
        write(sb.from("group_fields").update(r.row).eq("id", f.id), "Saved." + (gone.length ? " " + gone.map((x) => P().plural(x.members, "member keeps", "members keep") + " \"" + x.choice + "\", shown as no longer a choice.").join(" ") : ""));
      } }, "Save");
      return el("li", { class: "mf-def", "data-field": f.key },
        el("div", { class: "mf-def-head" }, label, el("small", {}, MM().KIND_TEXT[f.kind])),
        choices ? el("label", { class: "mf-choices" }, el("span", {}, "Choices, one per line"), choices) : null,
        el("div", { class: "mf-def-actions" },
          el("label", { class: "crm-check", for: "mf-show-" + f.key }, shown, el("span", {}, "Show in the list")),
          el("button", { type: "button", class: "link", "aria-label": "Move " + f.label + " up", disabled: i === 0, onclick: () => move(fields, i, -1, "group_fields") }, "↑"),
          el("button", { type: "button", class: "link", "aria-label": "Move " + f.label + " down", disabled: i === fields.length - 1, onclick: () => move(fields, i, 1, "group_fields") }, "↓"),
          save,
          el("button", { type: "button", class: "link", "data-action": "archive-field", onclick: () => write(sb.from("group_fields").update({ archived_at: new Date().toISOString() }).eq("id", f.id), f.label + " archived. Its values are kept; restore it to show them again.") }, "Archive")));
    };
    // adding a field
    const add = { label: el("input", { id: "mf-new-label", type: "text", maxlength: "80", autocomplete: "off", placeholder: "For example: Farm plan status" }),
      kind: el("select", { id: "mf-new-kind" }, ...MM().KINDS.map(([k, t]) => el("option", { value: k }, t))),
      choices: el("textarea", { id: "mf-new-choices", rows: "3", placeholder: "Draft\nFinal" }), shown: el("input", { id: "mf-new-shown", type: "checkbox", checked: true }) };
    const choicesRow = el("div", { class: "crm-field" }, el("label", { for: "mf-new-choices" }, "Choices, one per line"), add.choices);
    add.kind.addEventListener("change", () => { choicesRow.hidden = add.kind.value !== "choice"; });
    const addForm = el("form", { class: "crm-form mf-add", novalidate: true },
      el("h4", {}, "Add a field"),
      el("div", { class: "crm-row-fields" }, el("div", { class: "crm-field" }, el("label", { for: "mf-new-label" }, "Name"), add.label),
        el("div", { class: "crm-field" }, el("label", { for: "mf-new-kind" }, "Kind"), add.kind)),
      choicesRow,
      el("label", { class: "crm-check", for: "mf-new-shown" }, add.shown, el("span", {}, "Show in the members list")),
      el("div", { class: "crm-save" }, el("button", { type: "submit", class: "primary", "data-action": "add-field", disabled: fields.length >= MM().MAX_FIELDS }, "Add the field")));
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const r = MM().toField({ label: add.label.value, kind: add.kind.value, choices: add.choices.value, shown_in_list: add.shown.checked });
      if (r.errors.length) { status.textContent = r.errors.join(" "); return; }
      const next = Math.max(0, ...(ctx.defs.fields || []).map((f) => Number(f.sort_order) || 0)) + 1;
      write(sb.from("group_fields").insert({ org_id: g, ...r.row, sort_order: next }), r.row.label + " added. It is on every member's page now.");
    });
    box.append(status, el("section", { class: "crm-section" }, el("h4", {}, "The group's fields (" + fields.length + " of " + MM().MAX_FIELDS + ")"),
      el("p", { class: "group-fine" }, "Each field is on every member's page, under Where they are at. Choice, tick and date fields can filter the members list; a field shown in the list is a column there."),
      fields.length ? el("ul", { class: "mf-defs" }, ...fields.map(fieldRow)) : el("p", { class: "crm-empty" }, "No fields yet."),
      archived.length ? el("details", { class: "crm-past" }, el("summary", {}, "Archived (" + archived.length + ")"), el("ul", { class: "mf-defs" }, ...archived.map((f) => el("li", { class: "mf-def" },
        el("span", {}, f.label + " · " + MM().KIND_TEXT[f.kind]), el("button", { type: "button", class: "link", onclick: () => write(sb.from("group_fields").update({ archived_at: null }).eq("id", f.id), f.label + " restored.") }, "Restore"))))) : null),
      addForm);
    // the membership types
    const types = MM().activeTypes(ctx.defs.types), oldTypes = (ctx.defs.types || []).filter((t) => t.archived_at);
    const typeRow = (t, i) => {
      const name = el("input", { type: "text", maxlength: "60", "aria-label": "Name of the type", value: t.name });
      return el("li", { class: "mf-def", "data-type": t.name }, name,
        el("button", { type: "button", class: "link", "aria-label": "Move " + t.name + " up", disabled: i === 0, onclick: () => move(types, i, -1, "group_membership_types") }, "↑"),
        el("button", { type: "button", class: "link", "aria-label": "Move " + t.name + " down", disabled: i === types.length - 1, onclick: () => move(types, i, 1, "group_membership_types") }, "↓"),
        el("button", { type: "button", class: "secondary", onclick: () => { const r = MM().toType(name.value, ctx.defs.types, t); if (r.errors.length) status.textContent = r.errors[0]; else write(sb.from("group_membership_types").update({ name: r.name }).eq("id", t.id), "Renamed. Every membership of this type shows the new name."); } }, "Save"),
        el("button", { type: "button", class: "link", onclick: () => write(sb.from("group_membership_types").update({ archived_at: new Date().toISOString() }).eq("id", t.id), t.name + " archived: members who have it keep it; it is no longer offered.") }, "Archive"));
    };
    const newType = el("input", { id: "mf-new-type", type: "text", maxlength: "60", autocomplete: "off", placeholder: "For example: Honorary" });
    box.append(el("section", { class: "crm-section" }, el("h4", {}, "Membership types"),
      el("ul", { class: "mf-defs" }, ...types.map(typeRow)),
      oldTypes.length ? el("details", { class: "crm-past" }, el("summary", {}, "Archived (" + oldTypes.length + ")"), el("ul", { class: "mf-defs" }, ...oldTypes.map((t) => el("li", { class: "mf-def" }, el("span", {}, t.name),
        el("button", { type: "button", class: "link", onclick: () => write(sb.from("group_membership_types").update({ archived_at: null }).eq("id", t.id), t.name + " restored.") }, "Restore"))))) : null,
      el("div", { class: "crm-link-form" }, newType, el("button", { type: "button", class: "secondary", "data-action": "add-type", disabled: types.length >= MM().MAX_TYPES, onclick: () => {
        const r = MM().toType(newType.value, ctx.defs.types);
        if (r.errors.length) { status.textContent = r.errors[0]; return; }
        const next = Math.max(0, ...(ctx.defs.types || []).map((t) => Number(t.sort_order) || 0)) + 1;
        write(sb.from("group_membership_types").insert({ org_id: g, name: r.name, sort_order: next }), r.name + " added.");
      } }, "Add a type"))));
    return box;
  }

  FP.membership = { readDefinitions, readMember, membershipSection, fieldsSection, settingsScreen, FIELD_COLS };
})(typeof window === "undefined" ? globalThis : window);
