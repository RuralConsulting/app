// EV2: who is on a group event's list and where each person is with it, the pure parts. One status per person: invited (the
// coordinator invited them their own way: the app sends nothing), coming, apologies (not coming) or came. Rows written before EV2
// have no status in hand (an older read) and mean "came" (migration 20261113082000). The counts are each status's own number and
// the head count beside them, never added together. The people a coordinator can add (the group's register and sign-ins), a
// sub-group's businesses or all current members, without anyone already listed; the invite text to copy. No DOM, no reads.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.eventAttendanceModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const STATUSES = ["invited", "coming", "apologies", "came"];
  const WORD = { invited: "Invited", coming: "Coming", apologies: "Apologies", came: "Came" };
  // the longer words a choice shows (a select, a screen reader)
  const LONG = { invited: "Invited", coming: "Coming", apologies: "Not coming (apologies)", came: "Came" };
  const statusOf = (a) => (STATUSES.includes(a?.status) ? a.status : "came");

  // Each status's number, and the whole list's.
  function counts(attendees) {
    const n = { invited: 0, coming: 0, apologies: 0, came: 0, all: 0 };
    for (const a of attendees || []) { n[statusOf(a)]++; n.all++; }
    return n;
  }
  // Rows of { event_id, status } to event id -> counts.
  function tally(rows) {
    const by = new Map();
    for (const r of rows || []) { if (!by.has(r.event_id)) by.set(r.event_id, []); by.get(r.event_id).push(r); }
    return new Map([...by].map(([k, v]) => [k, counts(v)]));
  }
  const num = (n) => Number(n).toLocaleString("en-NZ");
  // The counts in words: "12 invited · 5 coming · 2 apologies · 8 came · head count 40". Only what there is; the head count is its
  // own part and is never added to the named ones. Null when there is nothing to say.
  function countsLine(c, head) {
    const parts = STATUSES.filter((s) => c && c[s] > 0).map((s) => num(c[s]) + " " + (s === "apologies" && c[s] === 1 ? "apology" : WORD[s].toLowerCase()));
    if (head != null && head !== "") parts.push("head count " + num(head));
    return parts.length ? parts.join(" · ") : null;
  }

  // While the database has no statuses yet (the minutes after the app goes live, before the migration): how many names, never a
  // status ("4 named · head count 40").
  function plainLine(named, head) {
    const parts = named ? [num(named) + " named"] : [];
    if (head != null && head !== "") parts.push("head count " + num(head));
    return parts.length ? parts.join(" · ") : null;
  }
  // The button that adds every current member not yet listed, saying what its number counts.
  function allMembersLabel(n, total) {
    if (n === total) return n === 1 ? "Add the 1 current member" : "Add all " + num(n) + " current members";
    return n === 1 ? "Add the 1 other current member" : "Add the other " + num(n) + " current members";
  }

  // The status a person added now starts with: invited before the event starts, came once it has.
  const defaultStatus = (ev, now) => (Date.parse(ev?.starts_at) <= Date.parse(now) ? "came" : "invited");
  const started = (ev, now) => Date.parse(ev?.starts_at) <= Date.parse(now);

  // Ticking someone off: came, or back to what they were (coming when that is not known).
  const tick = (a, before) => (statusOf(a) === "came" ? (before && before !== "came" ? before : "coming") : "came");

  // The order on the list: by name (as people look for a name), ties by id.
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), "en-NZ", { sensitivity: "base" }) || String(a.id).localeCompare(String(b.id));

  // Who can be added: register businesses (name, member number) and sign-ins (name), without anyone already on the list.
  // { register: [{ id, business_name, member_number }], people: [{ user_id, name }] } -> [{ key, kind, id, name, number }]
  function candidates({ register = [], people = [] } = {}, attendees = []) {
    const taken = new Set((attendees || []).flatMap((a) => [a.user_id && "u:" + a.user_id, a.group_member_id && "b:" + a.group_member_id]).filter(Boolean));
    const out = [
      ...register.map((b) => ({ key: "b:" + b.id, kind: "business", id: b.id, name: String(b.business_name || "").trim(), number: b.member_number ? String(b.member_number) : "" })),
      ...people.map((p) => ({ key: "u:" + p.user_id, kind: "member", id: p.user_id, name: String(p.name || "").trim(), number: "" })),
    ].filter((c) => c.name && !taken.has(c.key));
    return out.sort((a, b) => a.name.localeCompare(b.name, "en-NZ", { sensitivity: "base" }) || a.key.localeCompare(b.key));
  }
  const fold = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // A search by name or member number: every word typed is in the name or the number (macrons ignored). At most `max`.
  function search(list, q, max = 20) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const hit = words.length ? list.filter((c) => { const hay = fold(c.name + " " + c.number); return words.every((w) => hay.includes(w)); }) : list;
    return { shown: hit.slice(0, max), total: hit.length };
  }
  // The rows to insert for candidates added with one status.
  const rowsFor = (eventId, list, status) => list.map((c) => ({ event_id: eventId, name: c.name, status, ...(c.kind === "business" ? { group_member_id: c.id } : { user_id: c.id }) }));

  // The invite, in plain words, to paste into the coordinator's own email or message: what, when, where, topics; no notes.
  function inviteText(ev, { group = "", when = "" } = {}) {
    const topics = Array.isArray(ev?.topics) ? ev.topics.filter(Boolean) : [];
    return [
      (group ? group + ": " : "") + String(ev?.title || "").trim(),
      "When: " + when,
      ev?.place_name ? "Where: " + ev.place_name : null,
      topics.length ? "About: " + topics.join(", ") : null,
      "",
      "Please let us know if you can come.",
    ].filter((l) => l != null).join("\n");
  }

  // A head count as typed: a whole number 0 to 100,000, or empty (none). { value } or { error }.
  function readHead(v) {
    const s = String(v ?? "").trim().replace(/[,\s]/g, "");
    if (!s) return { value: null };
    if (!/^\d+$/.test(s) || Number(s) > 100000) return { error: "A head count is a whole number, like 40." };
    return { value: Number(s) };
  }

  return { STATUSES, WORD, LONG, statusOf, counts, tally, countsLine, plainLine, allMembersLabel, defaultStatus, started, tick, byName, candidates, search, rowsFor, inviteText, readHead };
});
