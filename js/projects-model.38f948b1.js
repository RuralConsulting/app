// PJ1: a group's Projects, the pure parts (docs/PRODUCT.md; docs/architecture/access-rls.md, "Projects: who sees what"). The words,
// who counts as one of a project's coordinators, the one line of detail each row shows, the label every item carries ("Only
// coordinators" or "Shared with members"), dates in New Zealand's way, and the checks a form makes before it asks the database. No
// DOM and no reads: projects.js reads as the signed-in person and hands the rows here. The database decides what each person reads;
// nothing here widens it.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.projectsModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const COORDINATOR_ROLES = ["facilitator", "advisor", "admin"];
  const STATUS = { proposed: "Proposed", active: "Active", finished: "Finished", not_funded: "Not funded" };
  const STATUS_ORDER = ["active", "proposed", "finished", "not_funded"];
  const KIND = { subgroup: "Sub-group", group: "Another group", member: "Member", partner: "Partner or funder" };
  const ROLE = { taking_part: "Taking part", partner: "Partner", funder: "Funder" };
  // the one label every item carries, and what it means (said once, under the project's own switch)
  const SHARED = "Shared with members", PRIVATE = "Only coordinators";
  const label = (shared) => (shared ? SHARED : PRIVATE);
  const NEVER = "Never shared with members";
  const RULE = "Members of the groups and farms taking part see what is shared, once the project is shared. Everything else, and what is due to the funder, stays with the coordinators.";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MAX = { name: 200, purpose: 1000, note: 2000, ref: 100 };

  const isCoordinator = (role) => COORDINATOR_ROLES.includes(role);
  // Is the person one of this project's coordinators (its own group's facilitators, advisors and admins)? From the place they are in
  // (its role) or, for a project of another group they read in this place, their role in that group, when they are in it.
  function coordinatorOf(project, place, groups = []) {
    if (!project) return false;
    if (place && project.org_id === place.id) return isCoordinator(place.role);
    const owner = (groups || []).find((g) => g.id === project.org_id);
    return !!owner && isCoordinator(owner.role);
  }

  // ---- dates ------------------------------------------------------------------------------------------------------------------------
  const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
  function day(iso) {
    const m = ISO.exec(String(iso || ""));
    if (!m) return "";
    return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1];
  }
  const dayOnly = (iso) => (ISO.exec(String(iso || "")) || [""])[0];
  function range(from, to) {
    const a = day(from), b = day(to);
    if (a && b) return a + " to " + b;
    if (a) return "From " + a;
    if (b) return "To " + b;
    return "";
  }
  // An event's day in New Zealand (the stored time is UTC; the app shows the day the event is on there)
  function nzDay(ts) {
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) return "";
    const parts = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
    const get = (k) => parts.find((p) => p.type === k)?.value;
    return get("year") + "-" + get("month") + "-" + get("day");
  }
  const money = (n) => (n == null || n === "" || !Number.isFinite(Number(n)) ? "" : "$" + Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 2 }));

  // ---- taking part ------------------------------------------------------------------------------------------------------------------
  // Current: joined on or before today (or no date), and not yet left (the database's rule: app.project_reader_ids)
  const current = (x, today) => (!x.joined_on || dayOnly(x.joined_on) <= today) && (!x.left_on || dayOnly(x.left_on) > today);
  function participantLine(x, today) {
    const bits = x.kind === "partner" ? [ROLE[x.role] || KIND.partner] : [KIND[x.kind] || "", x.role && x.role !== "taking_part" ? ROLE[x.role] : null];
    if (x.left_on && dayOnly(x.left_on) <= today) bits.push("Left " + day(x.left_on));
    else if (x.joined_on && dayOnly(x.joined_on) > today) bits.push("Joins " + day(x.joined_on));
    else if (x.left_on) bits.push("Leaves " + day(x.left_on));
    else if (x.joined_on) bits.push("Since " + day(x.joined_on));
    return bits.filter(Boolean).join(" · ");
  }
  // current first (by name), then those who have left
  function sortParticipants(rows, today) {
    return (rows || []).slice().sort((a, b) => (current(a, today) === current(b, today) ? String(a.name).localeCompare(String(b.name), "en-NZ") : current(a, today) ? -1 : 1));
  }

  // ---- what is due ----------------------------------------------------------------------------------------------------------------------
  function dueState(d, today) {
    if (d.done_on) return "done";
    const due = dayOnly(d.due_on);
    if (due && due < today) return "overdue";
    return "open";
  }
  function dueWhen(d, today) {
    const s = dueState(d, today);
    if (s === "done") return "Done " + day(d.done_on);
    return (s === "overdue" ? "Was due " : "Due ") + day(d.due_on);
  }
  const dueLine = (d) => [d.releases_payment ? "Releases a payment" : null, d.document_title ? "Sent: " + d.document_title : null].filter(Boolean).join(" · ");
  // still to do first (soonest first), then done (latest first); archived ones are not listed
  function sortDue(rows, today) {
    const live = (rows || []).filter((d) => !d.archived_at);
    const open = live.filter((d) => dueState(d, today) !== "done").sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
    const done = live.filter((d) => dueState(d, today) === "done").sort((a, b) => String(b.done_on).localeCompare(String(a.done_on)));
    return [...open, ...done];
  }
  // The next thing due, for the list's quiet line ("M3 report due 1 Dec 2026")
  function nextDue(rows, today) {
    const open = sortDue(rows, today).filter((d) => dueState(d, today) !== "done");
    return open[0] || null;
  }
  const funderLine = (f) => [f.agreement_ref, money(f.amount)].filter(Boolean).join(" · ");

  // ---- the project --------------------------------------------------------------------------------------------------------------------
  // The list's quiet line: the dates, and whose it is when it is another group's (the status is at the right)
  function projectLine(p) {
    return [range(p.starts_on, p.ends_on), p.own === false && p.owner_name ? p.owner_name + "'s project" : null].filter(Boolean).join(" · ");
  }
  function sortProjects(rows) {
    const rank = (p) => { const i = STATUS_ORDER.indexOf(p.status); return i < 0 ? 9 : i; };
    return (rows || []).slice().sort((a, b) => (a.own === false) - (b.own === false) || rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), "en-NZ"));
  }
  // The words for an event row: its day and place
  const eventLine = (e) => [day(nzDay(e.starts_at)), e.place_name, e.cancelled_at ? "Cancelled" : null].filter(Boolean).join(" · ");

  // ---- forms --------------------------------------------------------------------------------------------------------------------------
  const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  // A new or changed project: { name, purpose, status, starts_on, ends_on } -> { row, problems: { field: words } }
  function projectForm(v) {
    const row = { name: tidy(v.name), purpose: tidy(v.purpose) || null, status: STATUS[v.status] ? v.status : "active",
      starts_on: v.starts_on || null, ends_on: v.ends_on || null };
    const problems = {};
    if (!row.name) problems.name = "Give the project a name.";
    else if (row.name.length > MAX.name) problems.name = "At most " + MAX.name + " characters.";
    if (row.purpose && row.purpose.length > MAX.purpose) problems.purpose = "At most " + MAX.purpose + " characters.";
    for (const k of ["starts_on", "ends_on"]) if (row[k] && !DATE.test(row[k])) problems[k] = "Choose a date.";
    if (!problems.starts_on && !problems.ends_on && row.starts_on && row.ends_on && row.ends_on < row.starts_on) problems.ends_on = "It ends after it starts.";
    return { row, problems };
  }
  // Who takes part: { kind, participant_org_id, group_member_id, name, role, joined_on }
  function participantForm(v) {
    const kind = KIND[v.kind] ? v.kind : null;
    const row = { kind, participant_org_id: kind === "subgroup" || kind === "group" ? v.participant_org_id || null : null,
      group_member_id: kind === "member" ? v.group_member_id || null : null, name: tidy(v.name) || null,
      role: kind === "partner" ? (v.role === "partner" ? "partner" : "funder") : "taking_part", joined_on: v.joined_on || null };
    const problems = {};
    if (!kind) problems.kind = "Choose who it is.";
    else if ((kind === "subgroup" || kind === "group") && !row.participant_org_id) problems.which = "Choose the group.";
    else if (kind === "member" && !row.group_member_id) problems.which = "Choose the member.";
    else if (kind === "partner" && !row.name) problems.name = "Give their name.";
    if (row.name && row.name.length > MAX.name) problems.name = "At most " + MAX.name + " characters.";
    if (row.joined_on && !DATE.test(row.joined_on)) problems.joined_on = "Choose a date.";
    if (kind !== "partner") row.name = null;   // (the database names a group or member as the register has it)
    return { row, problems };
  }
  function dueForm(v) {
    const row = { title: tidy(v.title), due_on: v.due_on || null, releases_payment: !!v.releases_payment, note: tidy(v.note) || null };
    const problems = {};
    if (!row.title) problems.title = "Say what is due.";
    else if (row.title.length > MAX.name) problems.title = "At most " + MAX.name + " characters.";
    if (!row.due_on || !DATE.test(row.due_on)) problems.due_on = "Choose the date it is due.";
    if (row.note && row.note.length > MAX.note) problems.note = "At most " + MAX.note + " characters.";
    return { row, problems };
  }
  function funderForm(v) {
    const amount = String(v.amount ?? "").replace(/[$,\s]/g, "");
    const row = { funder_name: tidy(v.funder_name), agreement_ref: tidy(v.agreement_ref) || null, amount: amount === "" ? null : Number(amount), note: tidy(v.note) || null };
    const problems = {};
    if (!row.funder_name) problems.funder_name = "Give the funder's name.";
    if (row.agreement_ref && row.agreement_ref.length > MAX.ref) problems.agreement_ref = "At most " + MAX.ref + " characters.";
    if (row.amount != null && !(Number.isFinite(row.amount) && row.amount >= 0)) problems.amount = "A whole amount in dollars, or leave it empty.";
    return { row, problems };
  }
  // What the database said, in plain words
  function refusedWords(error) {
    const code = error?.code, m = String(error?.message || "");
    if (code === "42501" || /row-level security|permission denied|Only the group/.test(m)) return "Only the group's facilitators, advisors and admins change a project.";
    if (code === "23505") return "That is already listed.";
    if (code === "23514" && m) return m.replace(/\.?$/, ".");
    return "That couldn't be saved just now. Try again.";
  }
  const KINDS_OF_ITEM = { file: "Files", layer: "Map layers", event: "Events" };

  return { COORDINATOR_ROLES, STATUS, STATUS_ORDER, KIND, ROLE, SHARED, PRIVATE, NEVER, RULE, MAX, KINDS_OF_ITEM, label, isCoordinator, coordinatorOf,
    day, dayOnly, range, nzDay, money, current, participantLine, sortParticipants, dueState, dueWhen, dueLine, sortDue, nextDue, funderLine,
    projectLine, sortProjects, eventLine, tidy, projectForm, participantForm, dueForm, funderForm, refusedWords };
});
