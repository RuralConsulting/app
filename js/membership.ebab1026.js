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
    // The two are read apart, so a failure of one never empties the other; a failure is kept (and said on the list), never hidden.
    const out = { fields: [], types: [], failed: null };
    const [f, t] = await Promise.all([
      Promise.resolve(sb.from("group_fields").select(FIELD_COLS).eq("org_id", g).order("sort_order").limit(200)).catch((e) => ({ error: e })),
      Promise.resolve(sb.rpc("crm_membership_types", { g })).catch((e) => ({ error: e }))]);
    if (f.error) out.failed = "the group's fields: " + message(f.error); else out.fields = f.data || [];
    if (t.error) out.failed = (out.failed ? out.failed + "; " : "") + "the membership types: " + message(t.error); else out.types = t.data || [];
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
        chain = chain.catch(() => {}).then(async () => {
          const { error } = await Promise.resolve(ctx.sb.rpc("crm_set_field_value", { b: b.id, field: f.field_id, value: MM().valueArg(f, v) })).catch((e) => ({ error: e }));
          if (!error) { f.value = v === "" ? null : v; f.orphaned = false; ctx.changed?.(f); }
          if (n !== latest) return;
          status.textContent = error ? "Couldn't save: " + message(error) : "Saved";
          if (error) status.setAttribute("role", "alert");
        });
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

  // ---- M2: a member's Subscriptions and Agreements and forms ---------------------------------------------------------------------
  // (migration 20261113020000; the group's facilitators, advisors and admins read and record; its admins list the years and agreements)
  const YEAR_COLS = "id,org_id,label,default_amount,archived_at", AGREEMENT_COLS = "id,org_id,name,sort_order,archived_at";
  // The group's years and agreements (read beside the fields; a failure is said, never hidden). Never fails.
  async function readM2(sb, g) {
    const out = { years: [], agreements: [], failed: null };
    const [y, a] = await Promise.all([
      Promise.resolve(sb.from("group_subscription_years").select(YEAR_COLS).eq("org_id", g).order("label").limit(500)).catch((e) => ({ error: e })),
      Promise.resolve(sb.from("group_agreements").select(AGREEMENT_COLS).eq("org_id", g).order("sort_order").limit(500)).catch((e) => ({ error: e }))]);
    if (y.error) out.failed = "the subscription years: " + message(y.error); else out.years = y.data || [];
    if (a.error) out.failed = (out.failed ? out.failed + "; " : "") + "the agreements: " + message(a.error); else out.agreements = a.data || [];
    return out;
  }
  async function readSubs(sb, b) {
    const { data, error } = await sb.rpc("crm_subscriptions_agreements", { b });
    if (error) throw error;
    return data || { subscriptions: [], agreements: [] };
  }
  // One save at a time per section, in the order made; only the latest one's outcome is said and redraws the page, and "Saved" only
  // when the database gave a row back.
  function saver(ctx, status) {
    let chain = Promise.resolve(), latest = 0;
    return (run, notice, focus) => {
      const n = ++latest;
      status.removeAttribute("role"); status.setAttribute("role", "status"); status.textContent = "Saving…";
      chain = chain.catch(() => {}).then(async () => {
        let got;
        try { got = await run(); } catch (e) { got = { error: e }; }
        if (n !== latest) return;
        if (got?.error) { status.textContent = "Couldn't save: " + message(got.error); status.setAttribute("role", "alert"); return; }
        if (!got?.data) { status.textContent = "Couldn't save: nothing was changed (it may no longer be yours to change)."; status.setAttribute("role", "alert"); return; }
        ctx.done(notice, focus);   // focus: the ids to put the focus back on once the page is drawn again (the first that is there)
      });
      return chain;
    };
  }
  const dateInput = (id, label, value) => { const i = el("input", { id, type: "date", "aria-label": label }); i.value = value || ""; return i; };
  const field = (id, label, control) => el("div", { class: "crm-field" }, el("label", { for: id }, label), control);

  function subscriptionsSection(ctx) {
    const { group, page, today } = ctx, years = page?.subscriptions || [];
    const box = el("section", { class: "crm-section ms-subs", "data-section": "subscriptions" }, el("h4", {}, "Subscriptions"));
    if (!years.length) {
      box.append(el("p", { class: "crm-empty" }, "The group has no subscription years yet." + (MM().canDefine(group.role) ? "" : " Its admins add them.")));
      if (MM().canDefine(group.role) && ctx.openSettings) box.append(el("button", { type: "button", class: "link", id: "ms-add-years", "data-action": "sub-settings", onclick: ctx.openSettings }, "Add the group's years"));
      return box;
    }
    const status = el("p", { class: "mf-status", role: "status" }), save = saver(ctx, status);
    const list = el("ul", { class: "ms-list" });
    for (const s of years) {
      const key = String(s.year_id), form = el("div", { class: "mf-inline ms-form" }), actions = el("div", { class: "ms-actions" });
      const close = (back) => { form.replaceChildren(); (back && box.querySelector("#" + CSS.escape(back)))?.focus(); };
      const go = (what) => {
        form.replaceChildren();
        const opener = "ms-" + what + "-" + key, cancel = el("button", { type: "button", class: "link", "data-action": "cancel", onclick: () => close(opener) }, "Cancel");
        if (what === "invoiced" || what === "paid") {
          const d = dateInput("ms-" + what + "-on-" + key, what === "paid" ? "Paid on" : "Invoiced on", today);
          const ref = what === "invoiced" ? el("input", { id: "ms-ref-" + key, type: "text", maxlength: "60", autocomplete: "off", placeholder: "Invoice number (optional)", "aria-label": "Invoice number" }) : null;
          if (ref) ref.value = s.invoice_ref || "";
          form.append(el("label", { for: d.id }, what === "paid" ? "Paid on" : "Invoiced on"), d, ref,
            el("button", { type: "button", class: "secondary", "data-action": "save-" + what, onclick: () => {
              if (!d.value) { status.textContent = "Give the date."; return; }
              const args = { ...MM().markArgs(s, what, d.value), ...(ref ? { invoice_ref: ref.value.trim() || null } : {}) };
              save(() => ctx.sb.rpc("crm_save_subscription", { b: ctx.business.id, yr: s.year_id, ...args }), s.label + (what === "paid" ? " marked paid." : " marked invoiced."), ["ms-paid-" + key, "ms-edit-" + key]);
            } }, "Save"), cancel);
        } else {
          const amount = el("input", { id: "ms-amount-" + key, type: "text", inputmode: "decimal", autocomplete: "off", placeholder: s.default_amount != null ? String(s.default_amount) : "" });
          amount.value = s.amount != null ? String(s.amount) : "";
          const inv = dateInput("ms-inv-" + key, "Invoiced on", s.invoiced_on), ref = el("input", { id: "ms-eref-" + key, type: "text", maxlength: "60", autocomplete: "off" });
          ref.value = s.invoice_ref || "";
          const paid = dateInput("ms-paid-" + key, "Paid on", s.paid_on), note = el("input", { id: "ms-note-" + key, type: "text", maxlength: "500", autocomplete: "off" });
          note.value = s.note || "";
          const nr = el("input", { id: "ms-nr-" + key, type: "checkbox", ...(s.not_required ? { checked: true } : {}) });
          form.append(el("div", { class: "crm-form ms-edit" },
            el("div", { class: "crm-row-fields" }, field(amount.id, "Amount ($)", amount), field(inv.id, "Invoiced on", inv), field(ref.id, "Invoice number", ref), field(paid.id, "Paid on", paid)),
            el("label", { class: "crm-check", for: nr.id }, nr, el("span", {}, "Not required this year (waived or exempt)")),
            field(note.id, "Note", note),
            el("div", { class: "ms-form-actions" }, el("button", { type: "button", class: "secondary", "data-action": "save-year", onclick: () => {
              const r = MM().toSubscription({ amount: amount.value, invoiced_on: inv.value, invoice_ref: ref.value, paid_on: paid.value, not_required: nr.checked, note: note.value });
              if (r.errors.length) { status.textContent = r.errors.join(" "); status.setAttribute("role", "alert"); return; }
              save(() => ctx.sb.rpc("crm_save_subscription", { b: ctx.business.id, yr: s.year_id, ...r.args }), s.label + " saved.", ["ms-edit-" + key]);
            } }, "Save"), cancel)));
        }
        form.querySelector("input, select")?.focus();
      };
      for (const a of MM().subActions(group.role, s)) {
        actions.append(el("button", { type: "button", class: "link", id: "ms-" + a + "-" + key, "data-action": a === "edit" ? "edit-year" : "mark-" + a, onclick: () => go(a) },
          a === "invoiced" ? "Mark invoiced" : a === "paid" ? "Mark paid" : "Change"));
      }
      const st = s.status || MM().subStatus(s);
      list.append(el("li", { class: "ms-row", "data-year": s.label, "data-status": st },
        el("div", { class: "ms-row-main" }, el("b", {}, s.label, s.archived ? el("span", { class: "crm-badge" }, "Archived") : null), el("small", {}, MM().subLine(s))),
        el("span", { class: "ms-status ms-" + st }, MM().STATUS_TEXT[st]),
        actions.childElementCount ? actions : null, form));
    }
    box.append(list, status);
    return box;
  }

  // The signed copy: the bytes to the group's content address, then one documents row held for this member (VIS1's 'held': the
  // group's coordinators, RCL staff and the member's own farm people read it; no other member). The same file already held for this
  // member is used again; the same file anywhere else in the group's Files is refused, so it is never linked where every member reads it.
  async function addSignedCopy(sb, g, b, file, title, signedOn) {
    const D = FP.documentsBlock, bytes = await file.arrayBuffer(), sha = await D.sha256Hex(bytes);
    const same = await sb.from("documents").select("id,title,visibility,group_member_id").eq("org_id", g).eq("sha256", sha).limit(1);
    const have = (same.data || [])[0];
    if (have) {
      if (have.visibility === "held" && have.group_member_id === b) return have.id;
      throw Error("this file is already in the group's Files as \"" + have.title + "\". Attach a copy held for this member only.");
    }
    const path = D.storagePath("org/" + g, sha, file.name), mime = file.type || "application/octet-stream";
    const up = await sb.storage.from("documents").upload(path, file, { contentType: mime, upsert: false });
    if (up.error && !/exist|duplicate|409/i.test(String(up.error.message || "") + (up.error.statusCode || ""))) throw up.error;
    const { data, error } = await sb.from("documents").insert({ org_id: g, title, doc_type: "agreement", original_name: file.name, mime_type: mime, sha256: sha, size_bytes: file.size,
      storage_path: path, tier: "primary", tiered_at: new Date().toISOString(), date_prepared: signedOn || null, visibility: "held", group_member_id: b }).select("id").single();
    if (error) throw error;
    return data.id;
  }

  function agreementsSection(ctx) {
    const { group, page, today, business: b } = ctx, list = page?.agreements || [];
    const box = el("section", { class: "crm-section ms-agreements", "data-section": "agreements" }, el("h4", {}, "Agreements and forms"));
    if (!list.length) {
      box.append(el("p", { class: "crm-empty" }, "The group has no agreements or forms listed yet." + (MM().canDefine(group.role) ? "" : " Its admins add them.")));
      if (MM().canDefine(group.role) && ctx.openSettings) box.append(el("button", { type: "button", class: "link", id: "ms-add-agreements", "data-action": "sub-settings", onclick: ctx.openSettings }, "Add the group's agreements"));
      return box;
    }
    const status = el("p", { class: "mf-status", role: "status" }), save = saver(ctx, status);
    const ul = el("ul", { class: "ms-list" });
    for (const a of list) {
      const key = String(a.agreement_id), form = el("div", { class: "mf-inline ms-form" }), actions = el("div", { class: "ms-actions" });
      const opener = "ms-sign-" + key;
      const close = () => { form.replaceChildren(); box.querySelector("#" + CSS.escape(opener))?.focus(); };
      const open = () => {
        form.replaceChildren();
        const on = dateInput("ms-signed-on-" + key, "Signed on", a.signed_on || today), by = el("input", { id: "ms-signed-by-" + key, type: "text", maxlength: "120", autocomplete: "off" });
        by.value = a.signed_by || "";
        const note = el("input", { id: "ms-ag-note-" + key, type: "text", maxlength: "500", autocomplete: "off" });
        note.value = a.note || "";
        const file = el("input", { id: "ms-file-" + key, type: "file", accept: "application/pdf,image/*,.pdf,.doc,.docx" });
        form.append(el("div", { class: "crm-form ms-edit" },
          el("div", { class: "crm-row-fields" }, field(on.id, "Signed on (empty: not signed)", on), field(by.id, "Signed by", by)),
          field(note.id, "Note", note),
          el("div", { class: "crm-field" }, el("label", { for: file.id }, a.document ? "Replace the signed copy" : "Attach the signed copy"), file,
            el("small", {}, "Kept in Files, held for this member: the group's coordinators and the member's own people see it, other members do not.")),
          el("div", { class: "ms-form-actions" }, el("button", { type: "button", class: "secondary", "data-action": "save-agreement", onclick: () => {
            const picked = file.files?.[0] || null, r = MM().toAgreement({ signed_on: on.value, signed_by: by.value, note: note.value, file: picked });
            if (r.errors.length) { status.textContent = r.errors.join(" "); status.setAttribute("role", "alert"); return; }
            save(async () => {
              const doc = picked ? await addSignedCopy(ctx.sb, group.id, b.id, picked, MM().copyTitle(a.name, b.business_name, r.args.signed_on), r.args.signed_on) : a.document_id || null;
              return ctx.sb.rpc("crm_save_member_agreement", { b: b.id, agreement: a.agreement_id, ...r.args, document: doc });
            }, a.name + (r.args.signed_on ? " recorded as signed." : " saved as not signed.") + (picked ? " The signed copy is in Files, held for this member." : ""), [opener]);
          } }, "Save"), el("button", { type: "button", class: "link", "data-action": "cancel", onclick: close }, "Cancel"))));
        on.focus();
      };
      if (MM().canEdit(group.role)) actions.append(el("button", { type: "button", class: "link", id: opener, "data-action": a.signed_on ? "edit-agreement" : "record-signed", onclick: open }, a.signed_on ? "Change" : "Record signed"));
      if (a.document) {
        const doc = a.document;
        actions.append(el("button", { type: "button", class: "link", id: "ms-open-" + key, "data-action": "open-copy", onclick: async (e) => {
          try { const l = await FP.documentFiles.downloadLink(ctx.sb, doc); root.open(l.url, "_blank", "noopener"); }
          catch (err) { status.textContent = "Couldn't open the signed copy: " + message(err); status.setAttribute("role", "alert"); e.target.focus(); }
        } }, "Open the signed copy"));
      }
      ul.append(el("li", { class: "ms-row", "data-agreement": a.name, "data-signed": String(!!a.signed_on) },
        el("div", { class: "ms-row-main" }, el("b", {}, a.name, a.archived ? el("span", { class: "crm-badge" }, "Archived") : null),
          (() => { const line = [MM().agreementLine(a), a.document ? "copy attached" : a.document_id ? "copy not readable here" : null].filter(Boolean).join(" · "); return line ? el("small", {}, line) : null; })()),
        el("span", { class: "ms-status " + (a.signed_on ? "ms-signed" : "ms-not_invoiced") }, a.signed_on ? "Signed" : "Not signed"),
        actions.childElementCount ? actions : null, form));
    }
    box.append(ul, status);
    return box;
  }

  // ---- M2: marking many members invoiced or paid at once (the members shown) -------------------------------------------------------
  // ctx: { sb, group, rows (the members shown), years, year (chosen in the filter, if any), today, opener, done(notice) }
  function markSheet(ctx) {
    const years = MM().openYears(ctx.years);
    FP.sheet.open({ opener: ctx.opener, title: "Mark invoiced or paid", where: P().plural(ctx.rows.length, "member", "members"), className: "ms-mark-sheet", body: (closeSheet) => {
      if (!years.length) return [el("p", { class: "crm-empty" }, "The group has no open subscription years." + (MM().canDefine(ctx.group.role) ? " Add one in Subscriptions and agreements." : " Its admins add them."))];
      let what = "invoiced";
      const year = el("select", { id: "ms-mark-year", "aria-label": "Year" }, ...years.map((y) => el("option", { value: y.id, ...(y.id === ctx.year ? { selected: true } : {}) }, y.label)));
      const day = dateInput("ms-mark-on", "On", ctx.today), plan = el("p", { class: "group-fine", role: "status", id: "ms-mark-plan" }), status = el("p", { class: "mf-status", role: "status" });
      const go = el("button", { type: "button", class: "primary", id: "ms-mark-go", "data-action": "mark-many" });
      const seg = el("div", { class: "crm-seg", role: "group", "aria-label": "Mark them" }), dayLabel = el("label", { for: "ms-mark-on" }, "Invoiced on");
      const redraw = () => {
        const p = MM().markPlan(ctx.rows, year.value, what), label = years.find((y) => y.id === year.value)?.label || "";
        plan.textContent = p.changes ? p.changes + " of the " + P().plural(ctx.rows.length, "member", "members") + " shown will be marked " + what + " for " + label + "."
            + (p.unchanged ? (p.unchanged === 1 ? " The other 1 stays as it is (" : " The other " + p.unchanged + " stay as they are (") + (what === "paid" ? "paid already, or not required" : "invoiced or paid already, or not required") + ")." : "")
          : "None of the " + P().plural(ctx.rows.length, "member", "members") + " shown would change: for " + label + " they are all " + (what === "paid" ? "paid or not required" : "invoiced, paid or not required") + ".";
        go.textContent = "Mark " + P().plural(p.changes, "member", "members") + " " + what;
        go.disabled = !p.changes;
        dayLabel.textContent = what === "paid" ? "Paid on" : "Invoiced on";
        day.setAttribute("aria-label", dayLabel.textContent);
        // two plain toggle buttons (aria-pressed), each reached with Tab
        seg.replaceChildren(...[["invoiced", "Invoiced"], ["paid", "Paid"]].map(([k, t]) => el("button", { type: "button", id: "ms-mark-" + k, "aria-pressed": String(what === k), onclick: () => { what = k; redraw(); seg.querySelector("#ms-mark-" + k)?.focus(); } }, t)));
      };
      year.addEventListener("change", redraw);
      go.addEventListener("click", async () => {
        if (!day.value) { status.textContent = "Give the date."; return; }
        const p = MM().markPlan(ctx.rows, year.value, what), label = years.find((y) => y.id === year.value)?.label || "";
        go.disabled = true; status.textContent = "Saving…";
        const { data, error } = await Promise.resolve(ctx.sb.rpc("crm_mark_subscriptions", { g: ctx.group.id, yr: year.value, ids: p.ids, what, on_date: day.value })).catch((e) => ({ error: e }));
        if (error) { status.textContent = "Couldn't save: " + message(error); status.setAttribute("role", "alert"); go.disabled = false; return; }
        closeSheet();
        ctx.done(P().plural(Number(data) || 0, "member", "members") + " marked " + what + " for " + label + ".");
      });
      redraw();
      return [el("div", { class: "crm-form ms-mark" }, field("ms-mark-year", "Year", year), el("div", { class: "crm-field" }, el("span", { class: "crm-filter-h" }, "Mark them"), seg),
        el("div", { class: "crm-field" }, dayLabel, day), plan, el("div", { class: "ms-form-actions" }, go), status)];
    } });
  }

  // ---- M2: Subscriptions and agreements (the group's admins) ---------------------------------------------------------------------------
  // ctx: { sb, group, m2: { years, agreements }, back, backButton, reload() -> m2 }
  function m2SettingsScreen(ctx) {
    const { sb, group } = ctx, g = group.id;
    const box = el("div", { class: "mf-settings", "data-view": "subscriptions-and-agreements" }, ctx.backButton("Back to People"), el("h3", {}, "Subscriptions and agreements"));
    if (!MM().canDefine(group.role)) { box.append(el("p", { class: "crm-empty" }, "The group's admins list its subscription years and agreements.")); return box; }
    const status = el("p", { class: "crm-notice", role: "status", tabindex: "-1" });
    if (ctx.notice) status.textContent = ctx.notice;
    // after a save the screen is drawn again; the focus goes back to the same control (or where an archived row now is), else the notice
    const redraw = async (notice, focus) => {
      const m2 = await ctx.reload(), next = m2SettingsScreen({ ...ctx, m2, notice });
      box.replaceWith(next);
      const n = (focus && next.querySelector("#" + CSS.escape(focus))) || next.querySelector(".crm-notice");
      n?.closest("details")?.setAttribute("open", "");
      n?.focus();
    };
    const fail = (e) => { status.textContent = "Couldn't save: " + message(e); };
    const wrote = (r) => !r.error && (Array.isArray(r.data) ? r.data.length > 0 : !!r.data);
    const write = async (q, notice, focus) => { const r = await q.select("id"); if (r.error) fail(r.error); else if (!wrote(r)) status.textContent = "Couldn't save: nothing was changed (it may no longer be yours to change)."; else await redraw(notice, focus); };
    // the years, newest first
    const all = ctx.m2.years || [], years = MM().openYears(all), oldYears = all.filter((y) => y.archived_at);
    const yearRow = (y) => {
      const label = el("input", { type: "text", id: "ms-y-label-" + y.id, maxlength: "20", "aria-label": "Label of the year", value: y.label });
      const amount = el("input", { type: "text", id: "ms-y-amount-" + y.id, inputmode: "decimal", "aria-label": "Default amount for " + y.label, placeholder: "Default amount", value: y.default_amount != null ? String(y.default_amount) : "" });
      return el("li", { class: "mf-def", "data-year": y.label }, el("div", { class: "mf-def-head" }, label, amount),
        el("div", { class: "mf-def-actions" },
          el("button", { type: "button", class: "secondary", id: "ms-y-save-" + y.id, "data-action": "save-year-def", onclick: () => { const r = MM().toYear({ label: label.value, default_amount: amount.value }, all, y); if (r.errors.length) status.textContent = r.errors[0]; else write(sb.from("group_subscription_years").update(r.row).eq("id", y.id), y.label + " saved.", "ms-y-save-" + y.id); } }, "Save"),
          el("button", { type: "button", class: "link", id: "ms-y-archive-" + y.id, "data-action": "archive-year", onclick: () => write(sb.from("group_subscription_years").update({ archived_at: new Date().toISOString() }).eq("id", y.id), y.label + " archived: members who have it keep it; it is no longer offered.", "ms-y-restore-" + y.id) }, "Archive")));
    };
    const newLabel = el("input", { id: "ms-new-year", type: "text", maxlength: "20", autocomplete: "off", placeholder: "For example: 2026/27" });
    const newAmount = el("input", { id: "ms-new-amount", type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "For example: 150" });
    const addYear = el("form", { class: "crm-form mf-add", novalidate: true }, el("h4", {}, "Add a year"),
      el("div", { class: "crm-row-fields" }, field("ms-new-year", "Label", newLabel), field("ms-new-amount", "Default amount ($, optional)", newAmount)),
      el("div", { class: "crm-save" }, el("button", { type: "submit", class: "primary", "data-action": "add-year", disabled: years.length >= MM().MAX_YEARS }, "Add the year")));
    addYear.addEventListener("submit", (e) => {
      e.preventDefault();
      const r = MM().toYear({ label: newLabel.value, default_amount: newAmount.value }, all);
      if (r.errors.length) { status.textContent = r.errors[0]; return; }
      write(sb.from("group_subscription_years").insert({ org_id: g, ...r.row }), r.row.label + " added. It is on every member's page now.", "ms-new-year");
    });
    box.append(status, el("section", { class: "crm-section" }, el("h4", {}, "Subscription years (" + years.length + " of " + MM().MAX_YEARS + ")"),
      el("p", { class: "group-fine" }, "Each year is on every member's page under Subscriptions, newest first. The default amount is filled in when members are marked invoiced or paid."),
      years.length ? el("ul", { class: "mf-defs" }, ...years.map(yearRow)) : el("p", { class: "crm-empty" }, "No years yet."),
      oldYears.length ? el("details", { class: "crm-past" }, el("summary", {}, "Archived (" + oldYears.length + ")"), el("ul", { class: "mf-defs" }, ...oldYears.map((y) => el("li", { class: "mf-def" }, el("span", {}, y.label),
        el("button", { type: "button", class: "link", id: "ms-y-restore-" + y.id, "data-action": "restore-year", onclick: () => write(sb.from("group_subscription_years").update({ archived_at: null }).eq("id", y.id), y.label + " restored.", "ms-y-archive-" + y.id) }, "Restore"))))) : null),
      addYear);
    // the agreements, in the group's order
    const allAg = ctx.m2.agreements || [], ags = MM().activeAgreements(allAg), oldAgs = allAg.filter((a) => a.archived_at);
    const move = (i, by, focus) => {
      const a = ags[i], b = ags[i + by];
      if (!a || !b) return;
      const sa = Number(a.sort_order) || i + 1, sb2 = Number(b.sort_order) || i + by + 1;
      Promise.all([sb.from("group_agreements").update({ sort_order: sa === sb2 ? sb2 + by : sb2 }).eq("id", a.id).select("id"), sb.from("group_agreements").update({ sort_order: sa }).eq("id", b.id).select("id")])
        .then((r) => { const e = r.find((x) => x.error); if (e) fail(e.error); else if (!r.every(wrote)) status.textContent = "Couldn't save: nothing was changed."; else redraw("Order saved.", focus); });
    };
    const agRow = (a, i) => {
      const name = el("input", { type: "text", id: "ms-a-name-" + a.id, maxlength: "80", "aria-label": "Name of the agreement", value: a.name });
      return el("li", { class: "mf-def", "data-agreement": a.name }, el("div", { class: "mf-def-head" }, name),
        el("div", { class: "mf-def-actions" },
          el("button", { type: "button", class: "link", id: "ms-a-up-" + a.id, "aria-label": "Move " + a.name + " up", disabled: i === 0, onclick: () => move(i, -1, "ms-a-up-" + a.id) }, "↑"),
          el("button", { type: "button", class: "link", id: "ms-a-down-" + a.id, "aria-label": "Move " + a.name + " down", disabled: i === ags.length - 1, onclick: () => move(i, 1, "ms-a-down-" + a.id) }, "↓"),
          el("button", { type: "button", class: "secondary", id: "ms-a-save-" + a.id, "data-action": "save-agreement-def", onclick: () => { const r = MM().toAgreementName(name.value, allAg, a); if (r.errors.length) status.textContent = r.errors[0]; else write(sb.from("group_agreements").update({ name: r.name }).eq("id", a.id), "Renamed.", "ms-a-save-" + a.id); } }, "Save"),
          el("button", { type: "button", class: "link", id: "ms-a-archive-" + a.id, "data-action": "archive-agreement", onclick: () => write(sb.from("group_agreements").update({ archived_at: new Date().toISOString() }).eq("id", a.id), a.name + " archived: members who signed it keep it; it is no longer offered.", "ms-a-restore-" + a.id) }, "Archive")));
    };
    const newAg = el("input", { id: "ms-new-agreement", type: "text", maxlength: "80", autocomplete: "off", placeholder: "For example: Data sharing agreement" });
    box.append(el("section", { class: "crm-section" }, el("h4", {}, "Agreements and forms (" + ags.length + " of " + MM().MAX_AGREEMENTS + ")"),
      el("p", { class: "group-fine" }, "Each is on every member's page under Agreements and forms, signed or not, with the signed copy attached."),
      ags.length ? el("ul", { class: "mf-defs" }, ...ags.map(agRow)) : el("p", { class: "crm-empty" }, "No agreements yet."),
      oldAgs.length ? el("details", { class: "crm-past" }, el("summary", {}, "Archived (" + oldAgs.length + ")"), el("ul", { class: "mf-defs" }, ...oldAgs.map((a) => el("li", { class: "mf-def" }, el("span", {}, a.name),
        el("button", { type: "button", class: "link", id: "ms-a-restore-" + a.id, "data-action": "restore-agreement", onclick: () => write(sb.from("group_agreements").update({ archived_at: null }).eq("id", a.id), a.name + " restored.", "ms-a-archive-" + a.id) }, "Restore"))))) : null,
      el("div", { class: "crm-link-form" }, newAg, el("button", { type: "button", class: "secondary", "data-action": "add-agreement", disabled: ags.length >= MM().MAX_AGREEMENTS, onclick: () => {
        const r = MM().toAgreementName(newAg.value, allAg);
        if (r.errors.length) { status.textContent = r.errors[0]; return; }
        const next = Math.max(0, ...allAg.map((a) => Number(a.sort_order) || 0)) + 1;
        write(sb.from("group_agreements").insert({ org_id: g, name: r.name, sort_order: next }), r.name + " added.", "ms-new-agreement");
      } }, "Add the agreement"))));
    return box;
  }

  FP.membership = { readDefinitions, readMember, membershipSection, fieldsSection, settingsScreen, FIELD_COLS,
    readM2, readSubs, subscriptionsSection, agreementsSection, markSheet, m2SettingsScreen, addSignedCopy };
})(typeof window === "undefined" ? globalThis : window);
