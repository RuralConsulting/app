// RV1: review items a group can come back to, their pure parts. A review item is a question about the group's member register that
// only someone who knows the farms can answer ("this block was split between three owners: which are members?"), raised by RCL's
// tools (tools/load_review_items.py) as a public.proposals row of kind register_review (migration 20261112040000). Who may see
// them; the rows to list items; the open / answered filter; the facts as short lines; the answer form to the arguments of
// public.register_review_answer, with plain reasons. No DOM, no reads, no clock: review-items.js draws, people.js reads and writes.
// Answering records the answer and applies nothing: staff act on it.
(function (root, factory) {
  const P = root.FP?.peopleModel || (typeof require === "function" ? require("./people-model.js") : null);
  const api = factory(P);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.reviewItemsModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (P) {
  // The group's facilitators, advisors and admins only (app.is_org_advisor; the same people who see People). Anyone else is never
  // offered the list and nothing is read for them.
  const ROLES = ["facilitator", "advisor", "admin"];
  const canSee = (role) => ROLES.includes(role);
  const KIND = "register_review";
  const PREFIX = "register:";
  const COLUMNS = "id,org_id,kind,subject,subject_key,evidence,candidates,status,decision,decided_by,decided_at,created_at";
  const LISTED = ["proposed", "accepted", "rejected", "applied"];   // superseded rows have a successor and are never listed
  const CAP = 500;                                                     // items read at a time (counted first)
  const MAX_TEXT = 2000;
  const FILTERS = [["open", "Open"], ["answered", "Answered"], ["all", "All"]];
  const SPECIAL = { other: "Something else", not_needed: "Not needed" };

  const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  // The facts as short lines: a list of texts as given; an object as "name: value" (true/false as yes/no; empty values left out).
  function factLines(e) {
    if (Array.isArray(e)) return e.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 30);
    if (e && typeof e === "object") {
      return Object.entries(e).filter(([, v]) => v != null && v !== "").slice(0, 30)
        .map(([k, v]) => k + ": " + (v === true ? "yes" : v === false ? "no" : str(v)));
    }
    return [];
  }

  // A valid WGS84 point or null.
  function placeOf(p) {
    const lon = Number(p?.lon), lat = Number(p?.lat);
    if (!p || typeof p !== "object" || typeof p.lon !== "number" || typeof p.lat !== "number") return null;
    return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 ? { lon, lat } : null;
  }
  const placeText = (p) => (p ? Math.abs(p.lat).toFixed(5) + "° " + (p.lat < 0 ? "S" : "N") + ", " + Math.abs(p.lon).toFixed(5) + "° " + (p.lon < 0 ? "W" : "E") : "");

  // One row of public.proposals (kind register_review) to what the list and the item show.
  function item(p) {
    const s = p?.subject && typeof p.subject === "object" ? p.subject : {}, d = p?.decision && typeof p.decision === "object" ? p.decision : {};
    const answers = (Array.isArray(p?.candidates) ? p.candidates : []).filter((c) => c && typeof c.action === "string")
      .map((c) => ({ action: c.action, label: str(c.label) || SPECIAL[c.action] || c.action }));
    const open = p?.status === "proposed" || p?.status === "ambiguous";
    const action = typeof d.action === "string" ? d.action : p?.status === "rejected" ? "not_needed" : d.candidate?.action || null;
    const chosen = answers.find((a) => a.action === action);
    const state = open ? "open" : p?.status === "rejected" ? "not_needed" : "answered";
    return {
      id: p?.id ?? null, key: str(p?.subject_key).startsWith(PREFIX) ? str(p.subject_key).slice(PREFIX.length) : str(p?.subject_key),
      topic: str(s.topic).trim() || "Review item", question: str(s.question).trim(),
      members: (Array.isArray(s.member_numbers) ? s.member_numbers : []).filter((m) => typeof m === "string" && m.trim()),
      place: placeOf(s.place), facts: factLines(p?.evidence), answers, open, state, status: p?.status || null,
      action, answerLabel: action ? (chosen?.label || SPECIAL[action] || action) : null,
      typed: typeof d.answer === "string" && d.answer.trim() ? d.answer.trim() : null,
      note: typeof d.note === "string" && d.note.trim() ? d.note.trim() : null,
      decided_by: p?.decided_by || null, decided_at: p?.decided_at || null, created_at: p?.created_at || null,
    };
  }

  // Newest first; open ones before answered ones when both are shown.
  function items(rows) {
    return (Array.isArray(rows) ? rows : []).filter((p) => p && p.kind === KIND && LISTED.includes(p.status)).map(item)
      .sort((a, b) => (Number(b.open) - Number(a.open)) || str(b.created_at).localeCompare(str(a.created_at)) || (Number(b.id) - Number(a.id)));
  }
  const openCount = (list) => (list || []).filter((i) => i.open).length;
  function filter(list, which = "open") {
    return (list || []).filter((i) => which === "all" || (which === "open" ? i.open : !i.open));
  }
  // PF1: whether an item matches what was typed in the list's search: every word is a member number it names (or the start of
  // one), or is in its topic or question (ignoring case and accents).
  const foldText = (v) => (P?.fold ? P.fold(v) : str(v).toLowerCase());
  function matches(it, q) {
    const words = foldText(q).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const text = " " + foldText(it.topic + " " + it.question) + " ", numbers = (it.members || []).map((m) => foldText(m));
    return words.every((w) => numbers.some((m) => m === w || m.startsWith(w)) || text.includes(w));
  }
  // PF1: the list in the order a person works through it, as sections. Open items first: an item naming more than one member, or
  // the only one with its topic, comes first (newest first); then the rest by topic, so items with the same topic sit together
  // under one heading with their count (newest first within it), folded when there are more than FOLD of them and nothing is
  // searched for. Answered items, when shown, come after (newest first). Each section: { topic (null for a plain list), items,
  // folded }.
  const FOLD = 5;
  const newest = (a, b) => str(b.created_at).localeCompare(str(a.created_at)) || (Number(b.id) - Number(a.id));
  function arrange(list, { filter: which = "open", q = "" } = {}) {
    const shown = filter(list, which).filter((it) => matches(it, q));
    const open = shown.filter((it) => it.open), done = shown.filter((it) => !it.open).sort(newest);
    const byTopic = new Map();
    for (const it of open) byTopic.set(it.topic, (byTopic.get(it.topic) || 0) + 1);
    const lead = open.filter((it) => it.members.length > 1 || byTopic.get(it.topic) === 1).sort(newest);
    const groups = new Map();
    for (const it of open) if (!lead.includes(it)) groups.set(it.topic, [...(groups.get(it.topic) || []), it]);
    const sections = [];
    if (lead.length) sections.push({ topic: null, items: lead, folded: false });
    for (const topic of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const items = groups.get(topic).sort(newest);
      if (items.length === 1) sections.push({ topic: null, items, folded: false });   // the rest of its topic was put first
      else sections.push({ topic, items, folded: items.length > FOLD && !foldText(q) });
    }
    if (done.length) sections.push({ topic: null, answered: true, items: done, folded: false });
    return sections;
  }
  const arrangedCount = (sections) => sections.reduce((n, s) => n + s.items.length, 0);
  const countText = (n, which) => which === "open" ? plural(n, "item to review", "items to review")
    : which === "answered" ? plural(n, "item answered", "items answered") : plural(n, "item", "items");
  const emptyText = (which, total) => !total ? "Nothing to review. Questions about the member register that need someone who knows the farms show here."
    : which === "open" ? "Nothing open: every item has an answer." : which === "answered" ? "Nothing answered yet." : "Nothing here.";

  // Member numbers to the businesses in the People directory (crm_directory rows), so each can open that business's page:
  // [{ number, business: {group_member_id, business_name, ended} | null }].
  function memberLinks(members, directory) {
    const by = new Map();
    for (const r of directory || []) if (r?.member_number != null && !by.has(String(r.member_number))) by.set(String(r.member_number), r);
    return (members || []).map((n) => {
      const r = by.get(String(n));
      return { number: String(n), business: r ? { group_member_id: r.group_member_id, business_name: r.business_name, ended: !!r.ended_at } : null };
    });
  }

  // When it was raised, and who answered when: "Raised 12 Nov 2026"; "Answered by Mere Example, 13 Nov 2026".
  const day = (t) => (t ? P.dateText(P.dayKey(t)) : "");
  const raisedText = (i) => (i.created_at ? "Raised " + day(i.created_at) : "");
  function whoText(i, team, me) {
    if (!i.decided_by) return "";
    const name = i.decided_by === me ? "you" : (team || []).find((m) => m.user_id === i.decided_by)?.name || "someone no longer in the group";
    return (i.state === "not_needed" ? "Marked not needed by " : "Answered by ") + name + (i.decided_at ? ", " + day(i.decided_at) : "");
  }

  // The form: the answer picked (an action of the item's), the typed answer for "other", and a note. To the arguments of
  // public.register_review_answer, or the plain reasons it can't be sent.
  function answerArgs(it, form = {}) {
    const errors = [], action = str(form.action).trim(), typed = str(form.answer).trim(), note = str(form.note).trim();
    if (!it?.open) errors.push("This item already has an answer.");
    if (!action) errors.push("Choose an answer.");
    else if (action !== "not_needed" && !(it?.answers || []).some((a) => a.action === action)) errors.push("Choose one of the answers shown.");
    if (action === "other" && !typed) errors.push("Type the answer for \"Something else\".");
    if (typed.length > MAX_TEXT) errors.push("The answer is longer than 2,000 characters.");
    if (note.length > MAX_TEXT) errors.push("The note is longer than 2,000 characters.");
    if (errors.length) return { errors };
    return { errors: [], args: { id: it.id, action, answer: action === "other" ? typed : null, note: note || null } };
  }

  // The suggested answers drawn as buttons (not "other" or "not_needed", which have their own controls).
  const suggested = (it) => (it?.answers || []).filter((a) => a.action !== "other" && a.action !== "not_needed");
  const otherLabel = (it) => (it?.answers || []).find((a) => a.action === "other")?.label || SPECIAL.other;

  return { ROLES, canSee, KIND, PREFIX, COLUMNS, LISTED, CAP, MAX_TEXT, FILTERS, SPECIAL, factLines, placeOf, placeText, item, items, openCount, filter,
    countText, emptyText, memberLinks, matches, arrange, arrangedCount, FOLD, raisedText, whoText, answerArgs, suggested, otherLabel };
});
