// PE1: a group's People (the start of a CRM), its pure parts. Who may see it; the directory's search and filters; the feed's
// filters as the read functions take them, and its grouping by New Zealand day; follow-ups; the forms (an interaction, a person,
// a business's details) to rows and back with plain reasons; and the CSV exports with the spreadsheet formula guard. No DOM, no
// reads, no clock: people.js reads and writes as the signed-in person (public.crm_* functions and the PE1 tables, migration
// 20261112030000) and hands the rows here, with "now" when it matters. New Zealand time throughout (events-model.js's helpers).
(function (root, factory) {
  const E = root.FP?.eventsModel || (typeof require === "function" ? require("./events-model.js") : null);
  const api = factory(E);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.peopleModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (E) {
  // ---- who ---------------------------------------------------------------------------------------------------------------------
  // People is personal information: the organisation's facilitators, advisors and admins only (app.is_org_advisor).
  const ROLES = ["facilitator", "advisor", "admin"];
  const canSee = (role) => ROLES.includes(role);
  // Archive or restore a person, cancel or restore an interaction: the organisation's admins or whoever created it.
  const canArchive = (role, row, me) => role === "admin" || (!!me && !!row && (row.created_by === me || row.logged_by === me));

  const KINDS = [["call", "Call"], ["meeting", "Meeting"], ["email", "Email"], ["visit", "Visit"], ["message", "Message"], ["note", "Note"]];
  const KIND_TEXT = Object.fromEntries(KINDS);
  const DIRECTIONS = [["outgoing", "Outgoing"], ["incoming", "Incoming"], ["none", "Neither"]];
  const DIRECTED = new Set(["call", "email", "message"]);   // the kinds that have a direction worth asking
  const FOLLOW_UPS = [["", "Any"], ["open", "Open"], ["due", "Due now"], ["done", "Done"]];

  // ---- text ----------------------------------------------------------------------------------------------------------------------
  // For search: case, spacing, punctuation and macrons ignored.
  const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9@.]+/g, " ").trim();
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  // A list typed one per line, or separated by commas or semicolons.
  const splitList = (s) => (Array.isArray(s) ? s : String(s ?? "").split(/[\n,;]+/)).map((x) => String(x).trim().replace(/\s+/g, " ")).filter(Boolean);
  function uniq(list, lower = false) {
    const seen = new Set(), out = [];
    for (const raw of list) { const v = lower ? raw.toLowerCase() : raw; if (!seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); } }
    return out;
  }
  const EMAIL = /^[^@\s]+@[^@\s]+$/;
  // A real calendar day written YYYY-MM-DD, 1990 to 2099.
  const safeDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= "1990-01-01" && s < "2100-01-01" && !Number.isNaN(Date.parse(s + "T00:00:00Z"))
    && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

  // ---- dates ----------------------------------------------------------------------------------------------------------------------
  const dayKey = (t) => E.dayKey(t);
  const whenText = (t) => E.dateText(E.dayKey(t)) + ", " + E.clock(E.timeKey(t));
  const dateText = (key) => (key ? E.dateText(String(key).slice(0, 10)) : "");
  // "today", "yesterday", "3 days ago", "5 weeks ago", else the date.
  function ago(t, today) {
    if (!t) return "never";
    const days = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(dayKey(t) + "T00:00:00Z")) / 86400000);
    if (days <= 0) return days === 0 ? "today" : dateText(dayKey(t));
    if (days === 1) return "yesterday";
    if (days < 14) return days + " days ago";
    if (days < 63) return Math.floor(days / 7) + " weeks ago";
    return dateText(dayKey(t));
  }
  // A follow-up's state on a New Zealand day: "due" (its date has come and it is not done), "open", "done", or null (none).
  function followUp(item, today) {
    if (!item?.follow_up_on) return null;
    if (item.follow_up_done_at) return "done";
    if (item.cancelled_at) return null;
    return String(item.follow_up_on).slice(0, 10) <= today ? "due" : "open";
  }
  const FOLLOW_TEXT = { due: "Follow-up due", open: "Follow-up", done: "Followed up" };

  // ---- the directory -------------------------------------------------------------------------------------------------------------
  // Rows from crm_directory. filters: { q, status: "current" | "ended" | "all", label, due }.
  function searchDirectory(rows, filters = {}) {
    const words = fold(filters.q).split(" ").filter(Boolean), status = filters.status || "current";
    return (rows || []).filter((r) => {
      if (status === "current" && r.ended_at) return false;
      if (status === "ended" && !r.ended_at) return false;
      if (filters.label && !(r.labels || []).some((l) => l.toLowerCase() === filters.label.toLowerCase())) return false;
      // UI2: several labels chosen: a business with any of them
      const want = (filters.labels || []).map((l) => String(l).toLowerCase());
      if (want.length && !(r.labels || []).some((l) => want.includes(l.toLowerCase()))) return false;
      if (filters.due && !(Number(r.due_follow_ups) > 0)) return false;
      if (filters.subgroups?.length && !inSubgroups(filters.subgroupIndex, r.group_member_id, filters.subgroups)) return false;   // SG2
      if (!words.length) return true;
      const hay = fold([r.business_name, r.trading_name, r.member_number, "member " + r.member_number, ...(r.people_names || []), ...(r.labels || []), r.status].join(" | "));
      return words.every((w) => hay.includes(w));
    });
  }
  // The labels in use, most used first (the directory's label chips).
  function labels(rows) {
    const n = new Map(), spelt = new Map();
    for (const r of rows || []) for (const l of r.labels || []) { const k = l.toLowerCase(); n.set(k, (n.get(k) || 0) + 1); if (!spelt.has(k)) spelt.set(k, l); }
    return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b)).map((k) => ({ label: spelt.get(k), count: n.get(k) }));
  }
  // ---- UI2: the directory's filters, behind one Filter button and shown as small removable chips -------------------------------
  // The default (current businesses, no label, any follow-up state; people not archived) is the quiet default: never a chip.
  const DEFAULT_FILTERS = Object.freeze({ q: "", status: "current", labels: [], due: false });
  const STATUS_TEXT = { current: "Current", ended: "Ended", all: "All, current and ended" };
  // The chips for what is chosen: [{ key, label }] (key: "status", "due", "label:<label>", "subgroup:<id>", "archived").
  // names: sub-group id -> name (SG2's Sub-group filter), for its chips.
  function filterChips(f = {}, tab = "businesses", names = null) {
    if (tab === "people") return f.archived ? [{ key: "archived", label: "Archived shown" }] : [];
    const out = [];
    if (f.status && f.status !== "current") out.push({ key: "status", label: f.status === "ended" ? "Ended" : "Current and ended" });
    if (f.due) out.push({ key: "due", label: "Follow-up due" });
    for (const l of f.labels || []) out.push({ key: "label:" + l, label: l });
    for (const id of f.subgroups || []) out.push({ key: "subgroup:" + id, label: names?.get?.(id) || names?.[id] || "A sub-group" });
    return out;
  }
  // A chip removed: that filter back to its default (a new object; q, the search, is kept).
  function removeFilter(f = {}, key) {
    const next = { ...f, labels: [...(f.labels || [])], subgroups: [...(f.subgroups || [])] };
    if (key === "status") next.status = "current";
    else if (key === "due") next.due = false;
    else if (key === "archived") next.archived = false;
    else if (String(key).startsWith("subgroup:")) next.subgroups = next.subgroups.filter((x) => String(x) !== String(key).slice(9));
    else if (String(key).startsWith("label:")) { const l = String(key).slice(6).toLowerCase(); next.labels = next.labels.filter((x) => x.toLowerCase() !== l); }
    return next;
  }
  // Clear: every filter back to the default; the search typed is kept.
  const clearFilters = (f = {}) => ({ ...f, status: DEFAULT_FILTERS.status, labels: [], subgroups: [], due: false, label: "", archived: false });
  // A label chosen or not (case ignored; the spelling first chosen is kept).
  function toggleLabel(f = {}, label) {
    const have = (f.labels || []).some((l) => l.toLowerCase() === String(label).toLowerCase());
    return { ...f, labels: have ? f.labels.filter((l) => l.toLowerCase() !== String(label).toLowerCase()) : [...(f.labels || []), label] };
  }
  // The directory sorted by a column (the computer's table): name, member number (as numbers where they are), primary contact,
  // last contact (the most recent first when descending); ties by name. by null keeps the order the database gave.
  function sortDirectory(rows, by = null, dir = 1) {
    if (!by) return [...(rows || [])];
    const name = (r) => String(r.business_name ?? r.display_name ?? "");
    const val = { name, member: (r) => r.member_number ?? "", contact: (r) => r.primary_name ?? (r.businesses || []).map((b) => b.business_name).join(", ") ?? "", last: (r) => r.last_interaction_at || "" }[by];
    if (!val) return [...(rows || [])];
    const cmp = (a, b) => {
      const x = val(a), y = val(b);
      if (by === "last") { if (!x !== !y) return x ? -1 : 1; return String(x).localeCompare(String(y)) * dir; }
      if (!String(x) !== !String(y)) return String(x) ? -1 : 1;   // the empty ones last, either way
      return String(x).localeCompare(String(y), "en-NZ", { numeric: true, sensitivity: "base" }) * dir;
    };
    return [...(rows || [])].sort((a, b) => cmp(a, b) || name(a).localeCompare(name(b), "en-NZ", { sensitivity: "base" }));
  }
  // ---- PH3: People as a contact list -----------------------------------------------------------------------------------------------
  // The letter a name is listed under: its first letter without its macron or accent, in capitals ("Ōtira" under O, "de Lacy" under
  // D); a name that starts with no letter (a number, a bracket) under "#", which comes last. Words in brackets are not read.
  const bare = (name) => String(name ?? "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").trim();
  function letterOf(name) {
    const c = fold(bare(name) || name).charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }
  // Two letters for a round avatar: the first letters of the first two words ("Aroha Example (synthetic)" AE), or the first two of a
  // single word; company words (Ltd, Limited, Trust, The) are left out; macrons kept as written. "" when the name has no letters.
  const COMPANY = /^(ltd|limited|trust|the|and|&|inc|co|company|partnership)$/i;
  function initials(name) {
    const words = bare(name).normalize("NFC").replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, " ").split(/\s+/).filter((w) => w && !COMPANY.test(w) && /[\p{L}\p{N}]/u.test(w));
    const first = (w) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, "").normalize("NFC"))[0] || "";
    const letters = (w) => Array.from(w.normalize("NFC")).filter((ch) => /[\p{L}\p{N}]/u.test(ch));   // punctuation never counts ("'Quoted' Co" QU)
    const out = words.length > 1 ? first(words[0]) + first(words[1]) : letters(words[0] || "").slice(0, 2).join("");
    return out.toLocaleUpperCase("en-NZ");
  }
  // Names in the order a phone's contacts lists them: by letter (A to Z, then "#"), then by name with case, macrons and accents
  // ignored (Ā sorts with A), numbers read as numbers. nameOf(row) gives the name.
  function byName(nameOf = (r) => r.display_name ?? r.business_name) {
    return (a, b) => {
      const x = String(nameOf(a) ?? ""), y = String(nameOf(b) ?? ""), lx = letterOf(x), ly = letterOf(y);
      return (lx === "#") - (ly === "#") || lx.localeCompare(ly) || bare(x).localeCompare(bare(y), "en-NZ", { sensitivity: "base", numeric: true }) || x.localeCompare(y, "en-NZ");
    };
  }
  // The rows with a letter heading before each new letter: [{ letter }, row, row, { letter }, row ...] (the rows already in name order).
  function withLetters(rows, nameOf = (r) => r.display_name ?? r.business_name) {
    const out = [];
    let at = null;
    for (const r of rows || []) { const l = letterOf(nameOf(r)); if (l !== at) { out.push({ letter: l }); at = l; } out.push(r); }
    return out;
  }
  // The last contact, short, for the right of a row: "today", "yesterday", "5 days ago", "3 weeks ago", else the date; "None yet".
  const lastShort = (t, today) => (t ? ago(t, today) : "None yet");

  // Rows from crm_people. filters: { q, archived: boolean }.
  function searchPeople(rows, filters = {}) {
    const words = fold(filters.q).split(" ").filter(Boolean);
    return (rows || []).filter((p) => {
      if (!filters.archived && p.archived_at) return false;
      if (!words.length) return true;
      const hay = fold([p.display_name, p.job_title, ...(p.emails || []), ...(p.phones || []).map((x) => x.replace(/\D/g, "")),
        ...(p.businesses || []).flatMap((b) => [b.business_name, b.member_number])].join(" | "));
      return words.every((w) => hay.includes(w) || hay.replace(/\s/g, "").includes(w));
    });
  }
  // "Who with" choices: businesses and people matching the words, current first, at most `max`.
  function whoWith(directory, people, q, taken = [], max = 8) {
    const have = new Set(taken.map((t) => t.kind + ":" + t.id));
    const b = searchDirectory(directory, { q, status: "all" }).map((r) => ({ kind: "business", id: r.group_member_id, name: r.business_name,
      note: "Member " + r.member_number + (r.ended_at ? " · ended" : "") + (r.primary_name ? " · " + r.primary_name : ""), ended: !!r.ended_at }));
    const p = searchPeople(people, { q }).map((x) => ({ kind: "person", id: x.person_id, name: x.display_name,
      note: (x.businesses || []).map((y) => y.business_name).join(", ") || x.job_title || "Person" }));
    return [...b.filter((r) => !r.ended), ...p, ...b.filter((r) => r.ended)].filter((r) => !have.has(r.kind + ":" + r.id)).slice(0, max);
  }
  // A link's words: "Kowhai Downs (member 7)", a person's name, an event's title.
  const linkText = (l) => l.kind === "business" ? l.name + (l.member_number ? " (member " + l.member_number + ")" : "") : l.kind === "event" ? "Event: " + l.name : l.name;

  // ---- the feed ----------------------------------------------------------------------------------------------------------------------
  // The feed's filters to crm_feed's arguments. f: { kinds: [], from: "YYYY-MM-DD", to: "YYYY-MM-DD" (inclusive), business, person,
  // logger, followUp: "" | open | due | done }. Dates are New Zealand days.
  function feedArgs(g, f = {}) {
    const a = { g };
    if (f.kinds?.length) a.kinds = [...f.kinds];
    if (f.from) a.from_at = E.midnight(f.from).toISOString();
    if (f.to) a.to_at = E.midnight(E.addDays(f.to, 1)).toISOString();
    if (f.business) a.business = f.business;
    if (f.person) a.person = f.person;
    if (f.logger) a.logger = f.logger;
    if (f.followUp) a.follow_up = f.followUp;
    if (String(f.topic || "").trim()) a.topic = String(f.topic).trim();
    return a;
  }
  // Interactions grouped by New Zealand day, in the order given: [{ key, label, items }]. Follow-up lists group by their due day.
  function groupByDay(items, today, by = "happened") {
    const out = [], at = new Map();
    for (const it of items || []) {
      const key = by === "follow_up" ? String(it.follow_up_on || "").slice(0, 10) : dayKey(it.happened_at);
      if (!at.has(key)) {
        const label = key === today ? "Today" : key === E.addDays(today, -1) ? "Yesterday" : key === E.addDays(today, 1) ? "Tomorrow" : dateText(key);
        at.set(key, { key, label: by === "follow_up" ? (key < today ? "Overdue · " : "Due ") + label.replace(/^(?=[A-Z][a-z]{2} )/, "") : label, items: [] });
        out.push(at.get(key));
      }
      at.get(key).items.push(it);
    }
    return out;
  }
  // One interaction's heading words: "Call, outgoing · 15 min".
  function heading(it) {
    const parts = [KIND_TEXT[it.kind] || "Interaction"];
    if (it.direction && it.direction !== "none") parts[0] += ", " + it.direction;
    if (it.duration_minutes != null) parts.push(it.duration_minutes >= 60 ? Math.floor(it.duration_minutes / 60) + " h" + (it.duration_minutes % 60 ? " " + (it.duration_minutes % 60) + " min" : "") : it.duration_minutes + " min");
    return parts.join(" · ");
  }
  // Who logged it: the team's name for them, the import's named coordinator, or plain words.
  function loggedBy(it, team) {
    const name = (team || []).find((m) => m.user_id === it.logged_by)?.name;
    if (name) return name + (it.on_behalf_of ? " for " + it.on_behalf_of : "");
    if (it.on_behalf_of) return it.on_behalf_of + (it.source && it.source !== "manual" ? " (imported)" : "");
    return it.logged_by ? "Someone no longer in the group" : it.source && it.source !== "manual" ? "Imported" : "Unknown";
  }

  // The topics used before, most used first (what the log form and the feed's topic filter suggest).
  function topicsOf(items) {
    const n = new Map(), spelt = new Map();
    for (const it of items || []) for (const t of it.topics || []) { const k = t.toLowerCase(); n.set(k, (n.get(k) || 0) + 1); if (!spelt.has(k)) spelt.set(k, t); }
    return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b)).map((k) => spelt.get(k));
  }

  // ---- the interaction form -----------------------------------------------------------------------------------------------------------
  // An interaction (or nothing, for a new one) and the moment it is opened to the form's values. links: [{ kind, id, name, member_number }].
  function toForm(it, now, links = []) {
    const at = it?.happened_at || now;
    return { id: it?.id || null, kind: it?.kind || "call", direction: it?.direction || (it ? "none" : "outgoing"), date: dayKey(at), time: E.timeKey(at),
      duration: it?.duration_minutes == null ? "" : String(it.duration_minutes), subject: it?.subject || "", summary: it?.summary || "",
      follow_up_on: it?.follow_up_on ? String(it.follow_up_on).slice(0, 10) : "", topics: (it?.topics || []).join(", "),
      links: (it?.links || links || []).map((l) => ({ kind: l.kind, id: l.group_member_id || l.person_id || l.event_id || l.id, name: l.name, member_number: l.member_number || null })) };
  }
  // The form's values to crm_save_interaction's fields and links, or the plain reasons it can't be saved.
  function toSave(f) {
    const errors = [], s = (k) => String(f?.[k] ?? "").trim();
    if (!KIND_TEXT[f?.kind]) errors.push("Choose what kind of interaction it was.");
    const t = /^(\d{1,2}):(\d{2})$/.exec(s("time") || "00:00");
    let when = null;
    if (!safeDay(s("date")) || !t || Number(t[1]) > 23 || Number(t[2]) > 59) errors.push("Give the date and time it happened (for example 2026-11-05 and 14:30).");
    else { const [y, m, d] = s("date").split("-").map(Number); when = E.nzInstant(y, m, d, Number(t[1]), Number(t[2])); }
    let duration = null;
    if (s("duration")) { duration = Number(s("duration")); if (!/^\d+$/.test(s("duration")) || duration > 10080) { errors.push("The length is whole minutes (at most a week)."); duration = null; } }
    const subject = s("subject"), summary = s("summary");
    if (!subject && !summary) errors.push("Say what it was about: a subject or a summary.");
    if (subject.length > 300) errors.push("The subject is longer than 300 characters.");
    if (summary.length > 20000) errors.push("The summary is longer than 20,000 characters.");
    const fu = s("follow_up_on");
    if (fu && !safeDay(fu)) errors.push("The follow-up date should be like 2026-11-20.");
    const topics = uniq(splitList(f?.topics));
    if (topics.length > 20 || topics.some((x) => x.length > 60)) errors.push("At most 20 topics, each at most 60 characters.");
    const links = uniq((f?.links || []).map((l) => l.kind + ":" + l.id)).map((k) => { const [kind, id] = k.split(":"); return kind === "business" ? { group_member_id: id } : kind === "person" ? { person_id: id } : { event_id: id }; });
    if (links.length > 100) errors.push("At most 100 members, people and events.");
    if (errors.length) return { errors };
    return { errors: [], fields: { kind: f.kind, direction: DIRECTED.has(f.kind) ? (f.direction || "none") : "none", happened_at: when.toISOString(),
      duration_minutes: duration, subject: subject || null, summary: summary || null, follow_up_on: fu || null, topics }, links };
  }

  // ---- a person ---------------------------------------------------------------------------------------------------------------------
  const PERSON_FIELDS = ["given_name", "family_name", "display_name", "job_title", "emails", "phones", "postal_address", "physical_address", "notes"];
  function personForm(p) {
    return { given_name: p?.given_name || "", family_name: p?.family_name || "", display_name: p?.display_name || "", job_title: p?.job_title || "",
      emails: (p?.emails || []).join("\n"), phones: (p?.phones || []).join("\n"), postal_address: p?.postal_address || "", physical_address: p?.physical_address || "",
      notes: p?.notes || "", relationship: "", is_primary: false };
  }
  function toPerson(f) {
    const errors = [], s = (k) => String(f?.[k] ?? "").trim().replace(/[ \t]+/g, " ");
    const given = s("given_name"), family = s("family_name"), shown = s("display_name") || [given, family].filter(Boolean).join(" ");
    if (!shown) errors.push("Give the person a name.");
    if (given.length > 100 || family.length > 100 || shown.length > 200) errors.push("A name is too long.");
    const emails = uniq(splitList(f?.emails), true), phones = uniq(splitList(f?.phones));
    const bad = emails.filter((e) => !EMAIL.test(e) || e.length > 254);
    if (bad.length) errors.push("These don't look like email addresses: " + bad.join(", ") + ".");
    if (emails.length > 10) errors.push("At most 10 email addresses.");
    if (phones.length > 10) errors.push("At most 10 phone numbers.");
    if (phones.some((p) => p.length > 40)) errors.push("A phone number is at most 40 characters.");
    for (const [k, max, label] of [["job_title", 200, "job title"], ["postal_address", 500, "postal address"], ["physical_address", 500, "physical address"], ["notes", 10000, "notes"]])
      if (String(f?.[k] ?? "").trim().length > max) errors.push("The " + label + " is longer than " + max.toLocaleString("en-NZ") + " characters.");
    const relationship = s("relationship");
    if (relationship.length > 60) errors.push("The relationship is at most 60 characters.");
    if (errors.length) return { errors };
    const t = (k) => String(f?.[k] ?? "").trim() || null;
    return { errors: [], row: { given_name: given || null, family_name: family || null, display_name: shown, job_title: t("job_title"),
      emails, phones, postal_address: t("postal_address"), physical_address: t("physical_address"), notes: t("notes") }, link: { relationship: relationship || null, is_primary: !!f?.is_primary } };
  }

  // ---- a business's details --------------------------------------------------------------------------------------------------------------
  function detailsForm(d) {
    return { trading_name: d?.trading_name || "", emails: (d?.emails || []).join("\n"), phones: (d?.phones || []).join("\n"), postal_address: d?.postal_address || "",
      physical_address: d?.physical_address || "", labels: (d?.labels || []).join(", "), status: d?.status || "", notes: d?.notes || "" };
  }
  function toDetails(f) {
    const errors = [], t = (k) => String(f?.[k] ?? "").trim() || null;
    const emails = uniq(splitList(f?.emails), true), phones = uniq(splitList(f?.phones)), labelList = uniq(splitList(f?.labels));
    const bad = emails.filter((e) => !EMAIL.test(e) || e.length > 254);
    if (bad.length) errors.push("These don't look like email addresses: " + bad.join(", ") + ".");
    if (emails.length > 10 || phones.length > 10) errors.push("At most 10 email addresses and 10 phone numbers.");
    if (labelList.length > 30 || labelList.some((l) => l.length > 60)) errors.push("At most 30 labels, each at most 60 characters.");
    if ((t("trading_name") || "").length > 200) errors.push("The trading name is longer than 200 characters.");
    if ((t("status") || "").length > 60) errors.push("The status is at most 60 characters.");
    if ((t("notes") || "").length > 10000) errors.push("The notes are longer than 10,000 characters.");
    if (errors.length) return { errors };
    return { errors: [], row: { trading_name: t("trading_name"), emails, phones, postal_address: t("postal_address"), physical_address: t("physical_address"),
      labels: labelList, status: t("status"), notes: t("notes") } };
  }

  // ---- CSV -----------------------------------------------------------------------------------------------------------------------------------
  // The spreadsheet formula guard: a cell that begins with = + - @ (or a tab or carriage return) is written with an apostrophe in
  // front, so a spreadsheet shows it as text and never runs it. Then RFC 4180 quoting; a byte order mark first so macrons open as
  // written; CRLF line ends.
  function cell(v) {
    let s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCsv = (columns, rows) => "﻿" + [columns.map(([, h]) => cell(h)).join(","), ...rows.map((r) => columns.map(([k]) => cell(r[k])).join(","))].join("\r\n") + "\r\n";
  const DIRECTORY_COLUMNS = [["member_number", "Member number"], ["business_name", "Member"], ["trading_name", "Trading name"], ["status", "Status"], ["ended", "Ended"],
    ["labels", "Labels"], ["primary_name", "Primary contact"], ["people", "People"], ["people_count", "People (count)"], ["last_contact", "Last contact"],
    ["in_range", "Interactions in the range"], ["open_follow_ups", "Open follow-ups"], ["due_follow_ups", "Follow-ups due"]];
  // The directory as a spreadsheet; inRange: the feed's items for the range, to count each business's interactions in it.
  function directoryCsv(rows, inRange = []) {
    const n = new Map();
    for (const it of inRange) for (const l of it.links || []) if (l.group_member_id) n.set(l.group_member_id, (n.get(l.group_member_id) || 0) + 1);
    return toCsv(DIRECTORY_COLUMNS, (rows || []).map((r) => ({ ...r, ended: r.ended_at ? dayKey(r.ended_at) : "", labels: r.labels || [], people: r.people_names || [],
      last_contact: r.last_interaction_at ? dayKey(r.last_interaction_at) : "", in_range: n.get(r.group_member_id) || 0 })));
  }
  const FEED_COLUMNS = [["date", "Date"], ["time", "Time"], ["kind", "Kind"], ["direction", "Direction"], ["duration_minutes", "Minutes"], ["businesses", "Members"],
    ["member_numbers", "Member numbers"], ["people", "People"], ["events", "Events"], ["topics", "Topics"], ["subject", "Subject"], ["summary", "Summary"], ["follow_up_on", "Follow-up on"],
    ["follow_up_done", "Followed up"], ["logged_by", "Logged by"], ["source", "Source"], ["cancelled", "Cancelled"], ["id", "Id"]];
  function feedCsv(items, team) {
    return toCsv(FEED_COLUMNS, (items || []).map((it) => {
      const of = (k) => (it.links || []).filter((l) => l.kind === k);
      return { date: dayKey(it.happened_at), time: E.timeKey(it.happened_at), kind: KIND_TEXT[it.kind] || it.kind, direction: it.direction === "none" ? "" : it.direction,
        duration_minutes: it.duration_minutes, businesses: of("business").map((l) => l.name), member_numbers: of("business").map((l) => l.member_number).filter(Boolean),
        people: of("person").map((l) => l.name), events: of("event").map((l) => l.name), topics: it.topics || [], subject: it.subject, summary: it.summary, follow_up_on: it.follow_up_on || "",
        follow_up_done: it.follow_up_done_at ? dayKey(it.follow_up_done_at) : "", logged_by: loggedBy(it, team), source: it.source, cancelled: it.cancelled_at ? "yes" : "", id: it.id };
    }));
  }
  const fileName = (group, what, from, to) => E.fileName(group, what, from, to, "csv");

  // ---- SG2: sub-groups a member business belongs to ------------------------------------------------------------------------------
  // public.subgroup_businesses (migration 20261112060000): a business on a parent group's register in one or more of its
  // sub-groups. The parent's members read them; the parent's and the sub-group's facilitators, advisors and admins add and end them.
  const isSubgroup = (group) => !!group?.parent_org_id;
  // The People tab: the place's facilitators, advisors and admins (PE1; docs/PRODUCT.md, People is for coordinators). In a sub-group,
  // also a person who holds one of those roles in its parent (found among the person's own groups). Plain members and editors never.
  const parentOf = (group, groups) => (isSubgroup(group) ? (groups || []).find((g) => g.id === group.parent_org_id) || null : null);
  const canSeeTab = (group, groups) => canSee(group?.role) || canSee(parentOf(group, groups)?.role);
  // Who adds a business to a sub-group, or ends it, on a parent's business page: the parent's facilitators, advisors and admins.
  const canWriteSubgroups = (role) => canSee(role);
  const SUBGROUP_CAP = 5000;   // rows of the business-to-sub-group map read for the directory's filter (subgroup_counts first)
  // The map read for the filter is at most the sum of the sub-groups' current counts (and the cap).
  const subgroupMapSize = (counts) => Math.min(SUBGROUP_CAP, (counts || []).reduce((n, c) => n + (Number(c.current_businesses) || 0), 0));
  // subgroup_businesses rows ({ org_id, group_member_id, left_on }) to: business id -> Set of the sub-groups it is currently in.
  function subgroupIndex(rows) {
    const m = new Map();
    for (const r of rows || []) {
      if (r.left_on) continue;
      if (!m.has(r.group_member_id)) m.set(r.group_member_id, new Set());
      m.get(r.group_member_id).add(r.org_id);
    }
    return m;
  }
  // Whether a business is in any of the chosen sub-groups.
  const inSubgroups = (index, id, chosen) => { const s = index?.get(id); return !!s && chosen.some((x) => s.has(x)); };
  // A business's sub-groups (business_subgroups rows) as chips: the current ones (A-Z), then the ones it left.
  function subgroupChips(rows) {
    const chip = (r) => ({ rowId: r.id, id: r.subgroup_id, name: r.subgroup_name, member: !!r.is_member, current: !r.left_on, joined_on: r.joined_on || null, left_on: r.left_on || null, source: r.source || null });
    const all = (rows || []).map(chip), by = (a, b) => String(a.name).localeCompare(String(b.name));
    return { current: all.filter((c) => c.current).sort(by), past: all.filter((c) => !c.current).sort(by) };
  }
  // The sub-groups (subgroup_counts rows) a business may be added to: those it is not currently in.
  function addChoices(counts, chips) {
    const have = new Set((chips?.current || []).map((c) => c.id));
    return (counts || []).filter((c) => !have.has(c.subgroup_id)).map((c) => ({ id: c.subgroup_id, name: c.subgroup_name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  // The directory filter's choices: "Blythe (12)".
  const subgroupLabel = (c) => c.subgroup_name + " (" + (Number(c.current_businesses) || 0) + ")";
  // A sub-group's own list (subgroup_business_list rows): the businesses in it now (A-Z), then those that left (most recent first).
  function roster(rows) {
    const list = (rows || []).map((r) => ({ member_number: r.member_number, business_name: r.business_name, joined_on: r.joined_on || null, left_on: r.left_on || null }));
    return { current: list.filter((r) => !r.left_on).sort((a, b) => a.business_name.localeCompare(b.business_name)),
      past: list.filter((r) => r.left_on).sort((a, b) => String(b.left_on).localeCompare(String(a.left_on)) || a.business_name.localeCompare(b.business_name)) };
  }
  // One roster line's quiet words: "Member 12 · joined 1 Apr 2025" or "Member 12 · left 30 Jun 2025".
  const rosterLine = (r) => ["Member " + r.member_number, r.left_on ? "left " + dateText(r.left_on) : r.joined_on ? "joined " + dateText(r.joined_on) : null].filter(Boolean).join(" · ");
  // Whose contact details these are: a sub-group's People shows names and numbers only.
  const contactsNote = (parentName) => "Contact details are kept by " + (parentName || "the parent group") + ".";

  return { DEFAULT_FILTERS, STATUS_TEXT, filterChips, removeFilter, clearFilters, toggleLabel, sortDirectory, lastShort, letterOf, initials, byName, withLetters, ROLES, canSee, canArchive, KINDS, KIND_TEXT, DIRECTIONS, DIRECTED, FOLLOW_UPS, FOLLOW_TEXT, fold, plural, splitList, dayKey, whenText, dateText, ago,
    followUp, topicsOf, searchDirectory, labels, searchPeople, whoWith, linkText, feedArgs, groupByDay, heading, loggedBy, toForm, toSave, PERSON_FIELDS, personForm, toPerson,
    detailsForm, toDetails, cell, toCsv, DIRECTORY_COLUMNS, FEED_COLUMNS, directoryCsv, feedCsv, fileName,
    isSubgroup, parentOf, canSeeTab, canWriteSubgroups, SUBGROUP_CAP, subgroupMapSize, subgroupIndex, inSubgroups, subgroupChips, addChoices, subgroupLabel, roster, rosterLine, contactsNote };
});
