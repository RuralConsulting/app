// FP2: "Plans to place", a group's plan questions (public.proposals of kind plan_choice): its pure parts. Who sees the list, the
// question in plain words, why it is asked, each file's line, an answer in words, the status, and the answer as plan_choice_answer
// takes it. No DOM, no reads: plans-place.js reads as the person and hands the rows here.
//
// The owner's rulings: the group's coordinator picks each member's current plan (16 Nov 2026), with the file and the place in view and
// any answer allowed (one of the files, none of these, or a note); the answer can be changed until RCL applies it (18 Nov 2026). A
// farm plan is not a to-do list: nothing here shows a plan's ratings or actions, only which file is the plan.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.plansPlaceModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  // ---- who ----------------------------------------------------------------------------------------------------------------------
  // The group's facilitators, advisors and admins: they read and answer these questions (app.can_decide_proposal). The database
  // decides too: anyone else reads no row and cannot answer.
  const DECIDERS = ["admin", "advisor", "facilitator"];
  const canSee = (role) => DECIDERS.includes(role);

  // ---- words ----------------------------------------------------------------------------------------------------------------------
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function day(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] : null;
  }
  // Why the question is asked, in a sentence (the tool's reason codes)
  const WHY = {
    competing_versions: "There are several versions of this member's plan, and it isn't clear which is current.",
    newer_other_kind: "A newer plan of another kind (an NZFAP+ or Word plan) was saved after the workbook.",
    no_pdf: "There is a plan workbook but no printed plan.",
    no_date: "The plan has no date, so it can't be told whether it is current.",
    already_linked: "The member is already linked to a farm record, so RCL wants to be sure before loading a plan.",
    areas_differ: "The land-unit areas written in the plan don't match the member's blocks on the map.",
    same_ratings: "Every land unit in the plan has the same ratings, which may be a copy.",
    different_workbook: "The group holds a different plan workbook for this member from the one RCL read.",
    no_boundary: "There is no farm boundary on the map for this member.",
  };
  const whyLine = (why) => WHY[why] || "RCL couldn't tell which file is this member's current plan.";
  const memberName = (row, members) => {
    const m = (members || []).find((x) => x.id === row?.subject?.group_member_id) || (members || []).find((x) => String(x.member_number) === String(row?.subject?.member));
    return m ? m.business_name : null;
  };
  const title = (row, members) => { const n = memberName(row, members); return "Member " + (row?.subject?.member ?? "") + (n ? " · " + n : ""); };
  const question = (row) => "Which is member " + (row?.subject?.member ?? "") + "'s current farm plan?";
  const KIND = { pdf: "Printed plan (PDF)", workbook: "Plan workbook", word: "Word plan", nzfap: "NZFAP+ plan", other: "Other file" };
  function fileLine(f) {
    const parts = [KIND[f?.kind] || "File"];
    parts.push(f?.plan_date ? "plan dated " + day(f.plan_date) : "no plan date");
    if (f?.saved_on) parts.push("saved " + day(f.saved_on));
    return parts.join(" · ");
  }
  const files = (row) => (Array.isArray(row?.candidates) ? row.candidates.filter((c) => c && c.file).map((c) => c.file) : []);
  // The answer as plan_choice_answer takes it: 'file:<id>', 'none' or 'other'
  const pickOf = (c) => (c?.file ? "file:" + c.file.document_id : c?.choice === "none" ? "none" : c?.choice === "other" ? "other" : null);
  function answerText(decision) {
    const c = decision?.candidate;
    if (!c) return null;
    if (c.file) return c.file.title;
    if (c.choice === "none") return "None of these";
    if (c.choice === "other") return "Something else: " + (decision?.note || "");
    return null;
  }
  // Who answered: "you", the person's name from the group's team list, or "a coordinator"
  const who = (decidedBy, me, team) => (decidedBy && decidedBy === me ? "you" : (team || []).find((t) => t.user_id === decidedBy)?.name || "a coordinator");
  function statusOf(row) {
    if (row?.status === "applied") return { key: "applied", text: "Loaded by RCL" };
    if (row?.status === "accepted") return { key: "answered", text: "Picked" };
    return { key: "open", text: "To pick" };
  }
  const changeable = (row) => row?.status === "accepted";
  // Open first, then answered, then applied; by member number within each
  const ORDER = { open: 0, answered: 1, applied: 2 };
  const memberKey = (v) => { const s = String(v ?? ""); return /^\d+$/.test(s) ? s.padStart(10, "0") : s; };
  const sortRows = (rows) => [...(rows || [])].sort((a, b) => ORDER[statusOf(a).key] - ORDER[statusOf(b).key] || memberKey(a.subject?.member).localeCompare(memberKey(b.subject?.member)));
  // The member's place on the group's map: its bbox (and outline) when the tool found blocks for it; null otherwise
  function placeOf(row) {
    const p = row?.evidence?.place;
    const b = Array.isArray(p?.bbox) && p.bbox.length === 4 && p.bbox.every((n) => Number.isFinite(Number(n))) ? p.bbox.map(Number) : null;
    if (!b) return null;
    const [w, s, e, n] = b;
    return { bbox: b, geometry: p.geometry && p.geometry.type ? p.geometry : { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
  }
  const summary = (rows) => {
    const n = (rows || []).filter((r) => statusOf(r).key === "open").length;
    return n ? n + (n === 1 ? " plan to pick" : " plans to pick") : "Nothing to pick";
  };
  return { DECIDERS, canSee, WHY, whyLine, title, question, fileLine, files, pickOf, answerText, who, statusOf, changeable, sortRows, placeOf, summary, day, KIND };
});
