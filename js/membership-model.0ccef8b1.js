// M1b: a group's membership and its own fields in People, the pure parts. Membership types and terms, the fields a group defines
// for itself (a choice, a date, a tick, a short text) as list columns and filters, other contacts, and contacting members (the
// email addresses to copy, the list to download, with the spreadsheet formula guard). No DOM, no reads, no clock: membership.js and
// people.js read and write as the signed-in person (migration 20261113010000: group_membership_types, group_member_terms,
// group_fields, group_member_field_values, crm_directory's membership_type/joined_on/fields, crm_membership, crm_contacts,
// crm_email_list) and hand the rows here.
(function (root, factory) {
  const P = root.FP?.peopleModel || (typeof require === "function" ? require("./people-model.js") : null);
  const api = factory(P);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.membershipModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (P) {
  // ---- who ---------------------------------------------------------------------------------------------------------------------
  // Fields and types are defined by the group's admins (app.admin_org_ids); a membership is ended or reopened by them too (it
  // retires the business on the register, which only they may change). Values and type changes: facilitators, advisors, admins.
  const canDefine = (role) => role === "admin";
  const canEnd = (role) => role === "admin";
  const canEdit = (role) => P.canSee(role);

  const KINDS = [["choice", "A choice"], ["date", "A date"], ["tick", "A tick"], ["text", "A short text"]];
  const KIND_TEXT = Object.fromEntries(KINDS);
  const CONTACT_KINDS = ["council", "funder", "contractor", "supplier", "iwi", "community", "other"];
  const MAX_FIELDS = 40, MAX_CHOICES = 50, MAX_TYPES = 20;
  const ORPHAN = " (no longer a choice)";

  // ---- the group's fields ----------------------------------------------------------------------------------------------------------
  const byOrder = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.label).localeCompare(String(b.label)) || String(a.id).localeCompare(String(b.id));
  const active = (fields) => (fields || []).filter((f) => !f.archived_at).sort(byOrder);
  // The fields shown as columns in the list, and those that can filter it (a choice, a tick or a date).
  const listFields = (fields) => active(fields).filter((f) => f.shown_in_list);
  const filterFields = (fields) => active(fields).filter((f) => f.kind !== "text");
  const activeTypes = (types) => (types || []).filter((t) => !t.archived_at);

  // A value as words: a tick "Yes" or "No", a date as a New Zealand date, a choice that is no longer one marked so.
  function valueText(field, value) {
    if (value == null || value === "") return "";
    if (field?.kind === "tick") return value === true || value === "true" ? "Yes" : "No";
    if (field?.kind === "date") return P.dateText(String(value).slice(0, 10));
    const s = String(value);
    if (field?.kind === "choice" && !(field.choices || []).includes(s)) return s + ORPHAN;
    return s;
  }
  // A term's words: "Full · joined 1 Apr 2020", "Associate · 1 Apr 2020 to 30 Jun 2024".
  function termText(t) {
    if (!t) return "";
    const j = t.joined_on ? P.dateText(t.joined_on) : null, l = t.left_on ? P.dateText(t.left_on) : null;
    return [t.type, l ? (j ? j + " to " + l : "left " + l) : j ? "joined " + j : null].filter(Boolean).join(" · ");
  }

  // ---- the directory's filters for membership and fields ------------------------------------------------------------------------
  // f.types: [type name] (any); f.fieldf: { key: cond }, cond: { is: [choice] } | { ticked: true | false } | { before: day } |
  // { after: day } | { none: true }. Rows are crm_directory's (membership_type, fields {key: value}).
  function matches(row, f = {}) {
    const types = (f.types || []).map((x) => String(x).toLowerCase());
    if (types.length && !types.includes(String(row.membership_type || "").toLowerCase())) return false;
    for (const [key, c] of Object.entries(f.fieldf || {})) {
      const v = row.fields ? row.fields[key] : undefined, empty = v == null || v === "";
      if (c.none) { if (!empty) return false; continue; }
      if (c.is && !(c.is.length === 0 || (!empty && c.is.map((x) => String(x).toLowerCase()).includes(String(v).toLowerCase())))) return false;
      if (c.ticked != null && (v === true) !== !!c.ticked) return false;
      if (c.before && (empty || String(v).slice(0, 10) >= c.before)) return false;
      if (c.after && (empty || String(v).slice(0, 10) <= c.after)) return false;
    }
    return true;
  }
  const filterRows = (rows, f) => (rows || []).filter((r) => matches(r, f));
  // The chips for what is chosen here: [{ key, label }] (key "type:<name>" or "field:<key>").
  function chips(f = {}, fields = []) {
    const out = (f.types || []).map((t) => ({ key: "type:" + t, label: t }));
    for (const [key, c] of Object.entries(f.fieldf || {})) {
      const fd = (fields || []).find((x) => x.key === key), name = fd?.label || key;
      const what = c.none ? "none" : c.is ? c.is.join(" or ") : c.ticked != null ? (c.ticked ? "yes" : "no") : c.before ? "before " + P.dateText(c.before) : c.after ? "after " + P.dateText(c.after) : null;
      if (what) out.push({ key: "field:" + key, label: name + ": " + what });
    }
    return out;
  }
  // A chip removed (a new object).
  function remove(f = {}, key) {
    const next = { ...f, types: [...(f.types || [])], fieldf: { ...(f.fieldf || {}) } };
    if (String(key).startsWith("type:")) { const t = String(key).slice(5).toLowerCase(); next.types = next.types.filter((x) => x.toLowerCase() !== t); }
    else if (String(key).startsWith("field:")) delete next.fieldf[String(key).slice(6)];
    return next;
  }
  const clear = (f = {}) => ({ ...f, types: [], fieldf: {} });
  const toggleType = (f = {}, name) => {
    const have = (f.types || []).some((t) => t.toLowerCase() === String(name).toLowerCase());
    return { ...f, types: have ? f.types.filter((t) => t.toLowerCase() !== String(name).toLowerCase()) : [...(f.types || []), name] };
  };
  // One field's condition set (null clears it).
  const setField = (f = {}, key, cond) => { const fieldf = { ...(f.fieldf || {}) }; if (cond) fieldf[key] = cond; else delete fieldf[key]; return { ...f, fieldf }; };
  // A choice ticked or unticked in a choice field's condition.
  function toggleChoice(f = {}, key, choice) {
    const have = f.fieldf?.[key]?.is || [], on = have.some((x) => x.toLowerCase() === String(choice).toLowerCase());
    const is = on ? have.filter((x) => x.toLowerCase() !== String(choice).toLowerCase()) : [...have, choice];
    return setField(f, key, is.length ? { is } : null);
  }
  // The types in the filter: the group's active types, and any other type a member has now (an archived one).
  function typeChoices(types, rows) {
    const out = activeTypes(types).map((t) => t.name), seen = new Set(out.map((x) => x.toLowerCase()));
    for (const r of rows || []) if (r.membership_type && !seen.has(r.membership_type.toLowerCase())) { seen.add(r.membership_type.toLowerCase()); out.push(r.membership_type); }
    return out.map((name) => ({ name, count: (rows || []).filter((r) => String(r.membership_type || "").toLowerCase() === name.toLowerCase()).length }));
  }
  // The choices of a choice field in the filter: its choices, and values members have that are no longer choices.
  function choiceChoices(field, rows) {
    const out = [...(field.choices || [])], seen = new Set(out.map((x) => x.toLowerCase()));
    for (const r of rows || []) { const v = r.fields?.[field.key]; if (typeof v === "string" && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); } }
    return out;
  }
  // The table's columns on a computer, in the list pattern's order (the title first, quiet details, the date at the right):
  // Member, No., Type, each list field, Primary contact, Last contact (sortable).
  function columns(fields) {
    return [["name", "Member"], ["member", "No."], ["type", "Type"], ...listFields(fields).map((f) => ["field:" + f.key, f.label]), ["contact", "Primary contact"], ["last", "Last contact"]];
  }
  // The one column template the header and every row share (written in full: CSS repeat() refuses a count of 0, which made the
  // whole template invalid for a group with no list fields), and where each cell goes: 1 Member, 2 No., 3 Type, 4.. the n list
  // fields, then Primary contact, then Last contact.
  const COL = { name: "minmax(10em, 1.6fr)", member: "minmax(3.5em, .5fr)", type: "minmax(6em, .7fr)", field: "minmax(7em, .8fr)", contact: "minmax(8em, 1.2fr)", last: "minmax(6em, .8fr)" };
  function colTemplate(n) {
    const k = Math.max(0, Math.floor(Number(n) || 0));
    return [COL.name, COL.member, COL.type, ...Array.from({ length: k }, () => COL.field), COL.contact, COL.last].join(" ");
  }
  const colOf = (n) => ({ name: 1, member: 2, type: 3, field: (i) => 4 + i, contact: 4 + Math.max(0, n | 0), last: 5 + Math.max(0, n | 0) });
  // Sorted by Type or a field (as sortDirectory does the base columns): the empty ones last.
  function sortBy(rows, by, dir = 1, fields = []) {
    if (by !== "type" && !String(by || "").startsWith("field:")) return null;
    const key = by === "type" ? null : by.slice(6), fd = (fields || []).find((x) => x.key === key);
    const val = (r) => (by === "type" ? r.membership_type : r.fields?.[key]) ?? null;
    const name = (r) => String(r.business_name ?? "");
    return [...(rows || [])].sort((a, b) => {
      const x = val(a), y = val(b);
      if ((x == null || x === "") !== (y == null || y === "")) return x == null || x === "" ? 1 : -1;
      const c = fd?.kind === "tick" ? (x === y ? 0 : x ? -1 : 1) : String(x ?? "").localeCompare(String(y ?? ""), "en-NZ", { numeric: true, sensitivity: "base" });
      return c * dir || name(a).localeCompare(name(b), "en-NZ", { sensitivity: "base" });
    });
  }

  // ---- contacting members --------------------------------------------------------------------------------------------------------
  // ---- a member's Membership: what may be done here ------------------------------------------------------------------------------
  // role; cur: the current term or null; ended: the member has left the register; types: how many active types.
  // Change type (or record one): facilitators, advisors and admins, while there is a current term or the member is on the register.
  // End: the group's admins, whenever there is a current term (also when the member already left the register and its term was
  // left current: ending it then only closes the term). Reopen: admins, when the member left and nothing is current.
  function memberActions(role, cur, ended, types) {
    const out = [];
    if (canEdit(role) && types > 0 && (cur || !ended)) out.push(cur ? "change" : "record");
    if (canEnd(role) && cur) out.push("end");
    if (canEnd(role) && !cur && ended && types > 0) out.push("reopen");
    return out;
  }
  // The end form's quiet line: ending also retires the member on the register, unless it has left already.
  const endNote = (ended) => (ended ? "The member has already left the register: this closes the membership to match." : "This also marks the member as having left the register.");

  // crm_email_list rows for the members shown: the primary contact's emails (else the business's own), one of each, comma
  // separated; how many members have none.
  function emailText(rows) {
    const seen = new Set(), out = [];
    let missing = 0;
    for (const r of rows || []) {
      const list = (r.emails || []).length ? r.emails : r.business_emails || [];
      if (!list.length) { missing++; continue; }
      for (const e of list) { const k = String(e).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(e); } }
    }
    return { text: out.join(", "), emails: out.length, members: (rows || []).length, missing };
  }
  // What "Copy email addresses" says afterwards.
  function emailNotice(r) {
    if (!r.members) return "No members are shown, so nothing was copied.";
    if (!r.emails) return "None of the " + P.plural(r.members, "member", "members") + " shown has an email address.";
    return P.plural(r.emails, "email address", "email addresses") + " copied" + (r.missing ? "; " + P.plural(r.missing, "member has", "members have") + " no email address." : ".");
  }
  // The filtered list to download (CSV, with the spreadsheet formula guard): the directory's rows, the email list's emails, the
  // primary contact's phones (crm_people), the current sub-groups (names), and the list fields.
  function listCsv(rows, emailRows, people, fields, subgroupsOf = () => []) {
    const em = new Map((emailRows || []).map((r) => [r.group_member_id, r])), ph = new Map((people || []).map((p) => [p.person_id, p]));
    const shown = listFields(fields);
    const cols = [["member_number", "Member number"], ["business_name", "Member"], ["membership_type", "Membership type"], ["joined_on", "Joined"], ["primary_name", "Primary contact"],
      ["emails", "Emails"], ["business_emails", "Member's own emails"], ["phones", "Phones"], ["subgroups", "Sub-groups"], ["labels", "Labels"],
      ...shown.map((f) => ["field:" + f.key, f.label]), ["ended", "Ended"]];
    return P.toCsv(cols, (rows || []).map((r) => {
      const e = em.get(r.group_member_id) || {}, out = { ...r, emails: e.emails || [], business_emails: e.business_emails || [], phones: ph.get(r.primary_person_id)?.phones || [],
        subgroups: subgroupsOf(r.group_member_id), labels: r.labels || [], joined_on: r.joined_on || "", ended: r.ended_at ? P.dayKey(r.ended_at) : "" };
      for (const f of shown) out["field:" + f.key] = valueText(f, r.fields?.[f.key]);
      return out;
    }));
  }

  // ---- the forms -----------------------------------------------------------------------------------------------------------------
  // A field's form and its row (a new field: org_id added by the caller; the key is made by the database from the label).
  function fieldForm(f) {
    return { label: f?.label || "", kind: f?.kind || "choice", choices: (f?.choices || []).join("\n"), shown_in_list: !!f?.shown_in_list };
  }
  function toField(form, existing = null) {
    const errors = [], label = String(form?.label ?? "").trim().replace(/\s+/g, " "), kind = existing?.kind || form?.kind;
    if (!label) errors.push("Give the field a name.");
    if (label.length > 80) errors.push("A field's name is at most 80 characters.");
    if (!KIND_TEXT[kind]) errors.push("Choose what kind of field it is.");
    const seen = new Set(), choices = kind === "choice" ? P.splitList(String(form?.choices ?? "").replace(/,/g, "\n")).filter((c) => !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase())) : [];   // one of each, the first spelling kept
    if (kind === "choice" && !choices.length) errors.push("A choice field needs its choices, one per line.");
    if (choices.length > MAX_CHOICES || choices.some((c) => c.length > 80)) errors.push("At most 50 choices, each at most 80 characters.");
    if (errors.length) return { errors };
    return { errors: [], row: { label, ...(existing ? {} : { kind }), choices, shown_in_list: !!form?.shown_in_list } };
  }
  // A choice taken out of a field: how many members still have it (they keep it, shown as no longer a choice).
  function removedChoices(field, nextChoices, rows) {
    const keep = new Set((nextChoices || []).map((c) => c.toLowerCase()));
    return (field?.choices || []).filter((c) => !keep.has(c.toLowerCase())).map((c) => ({ choice: c, members: (rows || []).filter((r) => r.fields?.[field.key] === c).length }));
  }
  function toType(name, types = [], self = null) {
    const n = String(name ?? "").trim().replace(/\s+/g, " ");
    if (!n) return { errors: ["Give the type a name."] };
    if (n.length > 60) return { errors: ["A type's name is at most 60 characters."] };
    if ((types || []).some((t) => t.id !== self?.id && t.name.toLowerCase() === n.toLowerCase())) return { errors: ["The group has a type with that name."] };
    return { errors: [], name: n };
  }
  // A field's value as the form control gives it, to crm_set_field_value's text ("" clears it).
  function valueArg(field, v) {
    if (field.kind === "tick") return v === true ? "true" : v === false ? "false" : "";
    return v == null ? "" : String(v).trim();
  }

  // ---- other contacts ---------------------------------------------------------------------------------------------------------------
  // crm_contacts rows searched by name, organisation, kind, email or phone; archived ones only when asked.
  function searchContacts(rows, q = "", archived = false) {
    const words = P.fold(q).split(" ").filter(Boolean);
    return (rows || []).filter((c) => {
      if (!archived && c.archived_at) return false;
      if (!words.length) return true;
      const hay = P.fold([c.display_name, c.job_title, c.organisation_name, c.contact_kind, ...(c.emails || []), ...(c.phones || [])].join(" | "));
      return words.every((w) => hay.includes(w));
    });
  }
  const contactLine = (c) => [c.organisation_name, c.contact_kind ? c.contact_kind[0].toUpperCase() + c.contact_kind.slice(1) : null, c.job_title].filter(Boolean).join(" · ");

  return { canDefine, canEnd, canEdit, memberActions, endNote, colTemplate, colOf, KINDS, KIND_TEXT, CONTACT_KINDS, MAX_FIELDS, MAX_CHOICES, MAX_TYPES, ORPHAN, active, listFields, filterFields, activeTypes, valueText, termText,
    matches, filterRows, chips, remove, clear, toggleType, setField, toggleChoice, typeChoices, choiceChoices, columns, sortBy, emailText, emailNotice, listCsv,
    fieldForm, toField, removedChoices, toType, valueArg, searchContacts, contactLine };
});
