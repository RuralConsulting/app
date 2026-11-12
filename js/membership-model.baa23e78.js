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
    // M2: the subscription that year (f.sub = { year, status: [...] })
    return subMatches(row, f.sub);
  }
  const filterRows = (rows, f) => (rows || []).filter((r) => matches(r, f));
  // The chips for what is chosen here: [{ key, label }] (key "type:<name>", "field:<key>" or, M2, "sub:<year id>"; years names them).
  function chips(f = {}, fields = [], years = []) {
    const out = (f.types || []).map((t) => ({ key: "type:" + t, label: t }));
    for (const [key, c] of Object.entries(f.fieldf || {})) {
      const fd = (fields || []).find((x) => x.key === key), name = fd?.label || key;
      const what = c.none ? "none" : c.is ? c.is.join(" or ") : c.ticked != null ? (c.ticked ? "yes" : "no") : c.before ? "before " + P.dateText(c.before) : c.after ? "after " + P.dateText(c.after) : null;
      if (what) out.push({ key: "field:" + key, label: name + ": " + what });
    }
    if (f.sub?.year && (f.sub.status || []).length) {
      const y = (years || []).find((x) => x.id === f.sub.year);
      out.push({ key: "sub:" + f.sub.year, label: "Subscription " + (y?.label || "") + ": " + f.sub.status.map((k) => (STATUS_TEXT[k] || k).toLowerCase()).join(" or ") });
    }
    return out;
  }
  // A chip removed (a new object).
  function remove(f = {}, key) {
    const next = { ...f, types: [...(f.types || [])], fieldf: { ...(f.fieldf || {}) } };
    if (String(key).startsWith("type:")) { const t = String(key).slice(5).toLowerCase(); next.types = next.types.filter((x) => x.toLowerCase() !== t); }
    else if (String(key).startsWith("field:")) delete next.fieldf[String(key).slice(6)];
    else if (String(key).startsWith("sub:")) next.sub = null;
    return next;
  }
  const clear = (f = {}) => { const { sub, ...rest } = f; return { ...rest, types: [], fieldf: {} }; };
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

  // ---- M2: subscriptions year by year, and agreements -------------------------------------------------------------------------------
  // (migration 20261113020000: group_subscription_years, group_agreements, crm_directory's subscriptions {year id: status},
  // crm_subscriptions_agreements, crm_save_subscription, crm_mark_subscriptions, crm_save_member_agreement)
  const MAX_YEARS = 30, MAX_AGREEMENTS = 20;
  const STATUS = [["not_invoiced", "Not invoiced"], ["invoiced", "Invoiced, unpaid"], ["paid", "Paid"], ["not_required", "Not required"]];
  const STATUS_TEXT = Object.fromEntries(STATUS);
  // A row's status, as the database derives it: paid, else not required, else invoiced, else not invoiced (also no row at all).
  const subStatus = (s) => (!s ? "not_invoiced" : s.paid_on ? "paid" : s.not_required ? "not_required" : s.invoiced_on ? "invoiced" : "not_invoiced");
  // A member's status for a year from the directory row ({year id: status}; no entry: not invoiced).
  const statusIn = (row, year) => (row?.subscriptions && row.subscriptions[year]) || "not_invoiced";
  // An amount in dollars: "$150", "$150.50" (NZD; no tax logic).
  function money(n) {
    if (n == null || n === "" || !Number.isFinite(Number(n))) return "";
    const v = Number(n);
    return "$" + v.toLocaleString("en-NZ", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  // A year's quiet line: "Paid 20 Jul 2025 · invoiced 1 Jul 2025 · INV-0101 · $150", "Not required · Life member".
  function subLine(s) {
    const st = s?.status || subStatus(s), parts = [];
    if (st === "paid") parts.push("Paid " + P.dateText(s.paid_on), s.invoiced_on ? "invoiced " + P.dateText(s.invoiced_on) : null);
    else if (st === "invoiced") parts.push("Invoiced " + P.dateText(s.invoiced_on));
    else if (st === "not_required") parts.push("Not required this year");
    else parts.push("Not invoiced");
    if (st !== "not_required") parts.push(s?.invoice_ref || null, money(s?.amount ?? (st === "not_invoiced" ? s?.default_amount : null)) || null);
    parts.push(s?.note || null);
    return parts.filter(Boolean).join(" · ");
  }
  // What a facilitator, advisor or admin may do with a year on a member's page: mark it invoiced, mark it paid, change it.
  function subActions(role, s) {
    if (!canEdit(role) || !s) return [];
    const st = s.status || subStatus(s);
    if (st === "not_invoiced") return s.archived ? ["edit"] : ["invoiced", "paid", "edit"];
    if (st === "invoiced") return ["paid", "edit"];
    return ["edit"];
  }
  // The years in the order shown (newest label first) and the open ones (not archived).
  const byLabel = (a, b) => String(b.label).toLowerCase().localeCompare(String(a.label).toLowerCase()) || String(a.id).localeCompare(String(b.id));
  const openYears = (years) => (years || []).filter((y) => !y.archived_at).sort(byLabel);
  const activeAgreements = (list) => (list || []).filter((a) => !a.archived_at).sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.name).localeCompare(String(b.name)));

  // A year's form (amount, invoiced on and reference, paid on, not required, note) to crm_save_subscription's arguments.
  function toSubscription(form) {
    const errors = [], day = (v) => (String(v ?? "").trim() ? String(v).trim().slice(0, 10) : null);
    const a = String(form?.amount ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
    const amount = a === "" ? null : Number(a);
    if (amount != null && !(Number.isFinite(amount) && amount >= 0 && amount <= 1000000)) errors.push("The amount is a number of dollars, 0 to 1,000,000.");
    const invoiced_on = day(form?.invoiced_on), paid_on = day(form?.paid_on), not_required = !!form?.not_required;
    for (const [d, w] of [[invoiced_on, "invoiced"], [paid_on, "paid"]]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push("Give the " + w + " date as a date.");
    if (not_required && paid_on) errors.push("A year marked not required has no paid date: clear one of them.");
    const invoice_ref = String(form?.invoice_ref ?? "").trim().replace(/\s+/g, " ") || null, note = String(form?.note ?? "").trim() || null;
    if (invoice_ref && invoice_ref.length > 60) errors.push("An invoice reference is at most 60 characters.");
    if (note && note.length > 500) errors.push("A note is at most 500 characters.");
    if (errors.length) return { errors };
    return { errors: [], args: { amount: amount == null ? null : Math.round(amount * 100) / 100, invoiced_on, invoice_ref, paid_on, not_required, note } };
  }
  // "Mark invoiced" or "Mark paid" on one year: the row kept as it is, with that date (and the year's default amount where none).
  function markArgs(s, what, day) {
    const keep = { amount: s?.amount ?? s?.default_amount ?? null, invoiced_on: s?.invoiced_on || null, invoice_ref: s?.invoice_ref || null, paid_on: s?.paid_on || null,
      not_required: false, note: s?.note || null };
    return { ...keep, [what === "paid" ? "paid_on" : "invoiced_on"]: String(day || "").slice(0, 10) || null };
  }
  // Marking many at once (crm_mark_subscriptions): of the rows shown, those it changes for that year (invoiced: not invoiced yet;
  // paid: not invoiced or invoiced and unpaid), and only their ids are sent, so the database never touches a member the sheet said
  // would stay as they are (a row paid with no invoice date included). A year not required is passed over.
  function markPlan(rows, year, what) {
    const all = rows || [];
    const ids = all.filter((r) => {
      const st = statusIn(r, year);
      return what === "paid" ? st === "not_invoiced" || st === "invoiced" : st === "not_invoiced";
    }).map((r) => r.group_member_id);
    return { ids, changes: ids.length, unchanged: all.length - ids.length };
  }

  // The directory's subscription filter: f.sub = { year, status: [status ...] } (any of those listed; no row is not invoiced).
  const subMatches = (row, sub) => !sub?.year || !(sub.status || []).length || sub.status.includes(statusIn(row, sub.year));
  const setSubYear = (f = {}, year) => ({ ...f, sub: year ? { year, status: [...(f.sub?.status || [])] } : null });
  function toggleSubStatus(f = {}, year, status) {
    const have = f.sub?.year === year ? f.sub.status || [] : [], on = have.includes(status);
    return { ...f, sub: { year, status: on ? have.filter((x) => x !== status) : [...have, status] } };
  }
  const subFilterArg = (sub) => (sub?.year && (sub.status || []).length ? { year: sub.year, status: [...sub.status] } : null);
  // The counts beside each status in the filter, for the members shown before this filter.
  const subCounts = (rows, year) => Object.fromEntries(STATUS.map(([k]) => [k, (rows || []).filter((r) => statusIn(r, year) === k).length]));

  // An agreement's quiet line: "Signed 1 Apr 2024 by Aroha", "Not signed".
  function agreementLine(a) {
    if (!a?.signed_on) return a?.note || "";   // ("Not signed" is the status at the right)
    return ["Signed " + P.dateText(a.signed_on) + (a.signed_by ? " by " + a.signed_by : ""), a.note || null].filter(Boolean).join(" · ");
  }
  function toAgreement(form) {
    const errors = [], signed_on = String(form?.signed_on ?? "").trim().slice(0, 10) || null;
    if (signed_on && !/^\d{4}-\d{2}-\d{2}$/.test(signed_on)) errors.push("Give the signed date as a date.");
    const signed_by = String(form?.signed_by ?? "").trim().replace(/\s+/g, " ") || null, note = String(form?.note ?? "").trim() || null;
    if (signed_by && signed_by.length > 120) errors.push("Who signed is at most 120 characters.");
    if (note && note.length > 500) errors.push("A note is at most 500 characters.");
    if (!signed_on && form?.file) errors.push("Give the date it was signed, or save it without the file.");
    return errors.length ? { errors } : { errors: [], args: { signed_on, signed_by, note } };
  }
  // The signed copy's title in Files: "Membership form, Kowhai Downs (signed 1 Apr 2026)".
  const copyTitle = (agreement, member, signedOn) => (agreement + ", " + member + (signedOn ? " (signed " + P.dateText(signedOn) + ")" : "")).slice(0, 300);
  function toYear(form, years = [], self = null) {
    const label = String(form?.label ?? "").trim().replace(/\s+/g, " "), a = String(form?.default_amount ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
    if (!label) return { errors: ["Give the year a label, such as 2026 or 2026/27."] };
    if (label.length > 20) return { errors: ["A year's label is at most 20 characters."] };
    if ((years || []).some((y) => y.id !== self?.id && String(y.label).toLowerCase() === label.toLowerCase())) return { errors: ["The group has a year with that label."] };
    const amount = a === "" ? null : Number(a);
    if (amount != null && !(Number.isFinite(amount) && amount >= 0 && amount <= 1000000)) return { errors: ["The default amount is a number of dollars, 0 to 1,000,000."] };
    return { errors: [], row: { label, default_amount: amount } };
  }
  function toAgreementName(name, list = [], self = null) {
    const n = String(name ?? "").trim().replace(/\s+/g, " ");
    if (!n) return { errors: ["Give the agreement a name."] };
    if (n.length > 80) return { errors: ["An agreement's name is at most 80 characters."] };
    if ((list || []).some((a) => a.id !== self?.id && String(a.name).toLowerCase() === n.toLowerCase())) return { errors: ["The group has an agreement with that name."] };
    return { errors: [], name: n };
  }

  return { canDefine, canEnd, canEdit, memberActions, endNote, colTemplate, colOf, KINDS, KIND_TEXT, CONTACT_KINDS, MAX_FIELDS, MAX_CHOICES, MAX_TYPES, ORPHAN, active, listFields, filterFields, activeTypes, valueText, termText,
    matches, filterRows, chips, remove, clear, toggleType, setField, toggleChoice, typeChoices, choiceChoices, columns, sortBy, emailText, emailNotice, listCsv,
    fieldForm, toField, removedChoices, toType, valueArg, searchContacts, contactLine,
    // M2
    MAX_YEARS, MAX_AGREEMENTS, STATUS, STATUS_TEXT, subStatus, statusIn, money, subLine, subActions, openYears, activeAgreements, toSubscription, markArgs, markPlan,
    subMatches, setSubYear, toggleSubStatus, subFilterArg, subCounts, agreementLine, toAgreement, copyTitle, toYear, toAgreementName };
});
