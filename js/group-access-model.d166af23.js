// GA1: a group's access page, "who can sign in and what they can do" (`#/group/<id>/access`), its pure parts. The role cards (worded
// from what the database's policies let each role do, 16 Nov 2026), the people with a sign-in in the group as public.group_access
// returns them to one of the group's admins, and the recent changes to the group's people from public.change_log (org_members rows).
// No DOM and no reads: group-access.js reads as the person and hands the rows here.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.groupAccessModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  // Only a group's admins see the page (public.group_access answers nobody else); its tab is drawn for them only.
  const canSee = (role) => role === "admin";
  const NOT_ADMIN = "Only the group's admins see who has access.";

  // The roles, lowest first (public.org_role). Facilitator and advisor have the same powers in every policy today, so they share a card.
  const ROLE_WORD = { member: "Member", editor: "Editor", facilitator: "Facilitator", advisor: "Advisor", admin: "Admin" };
  const ORDER = ["admin", "advisor", "facilitator", "editor", "member"];
  // What each role can do, from the policies (app.can_view_org, can_edit_org, is_org_advisor, can_manage_org): plain words, no promise
  // the database does not keep.
  const CARDS = [
    { key: "member", name: "Member", text: "Opens the group's map, files and events, and what the group shares with everyone. Does not see People or other members' records." },
    { key: "editor", name: "Editor", text: "As a member, and adds and changes the group's events, attendance, files and logo." },
    { key: "coordinator", name: "Facilitator or advisor", roles: ["facilitator", "advisor"],
      text: "As an editor, and sees every member's records: People, calls and visits, member farms' maps and plans, and coordinators' notes. Decides the group's open questions." },
    { key: "admin", name: "Admin", text: "As a facilitator, and keeps the member register and farm links, chooses how member farms are shown, and sees this page." },
  ];
  const SIGN_IN = "Everyone signs in with their email address and a password. RCL staff also type a code from an authenticator app (two-factor); nobody else is asked for one.";
  const ADD = "For now RCL adds people to the group and sets their role: send RCL the person's email address and the role you want. "
    + "Until sign-ins open to everyone, only RCL colleagues and people RCL has named as testers can be added.";
  const ADD_FARM = "To give someone access to one member's farm instead, use Invite on that member under ";   // then a link: Manage, Members

  // ---- dates ------------------------------------------------------------------------------------------------------------------
  const TZ = "Pacific/Auckland";
  const valid = (t) => t != null && Number.isFinite(new Date(t).getTime());
  const day = (t) => (valid(t) ? new Date(t).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : null);

  // ---- the people -------------------------------------------------------------------------------------------------------------
  // public.group_access's answer: { staff_view, people: [{ user_id, email, role, is_you, signed_in, two_factor }], staff_others }, or null
  // for anyone who is not an admin of the group. Two-factor comes only to RCL staff (null otherwise: the page leaves the column out);
  // whether someone has ever signed in, never when (the build manager's default pending the owner's ruling, review of #588); a client
  // admin gets RCL staff in the group as a count (staff_others), never each one.
  function access(data) {
    const d = data && typeof data === "object" ? data : {};
    return { staffView: d.staff_view === true, staffOthers: Math.max(0, Number(d.staff_others) || 0), list: people(d.people) };
  }
  // Highest role first, then by email.
  function people(rows) {
    return (Array.isArray(rows) ? rows : []).filter((r) => r && r.user_id).map((r) => ({
      id: r.user_id, email: String(r.email || "No email on the sign-in"), role: r.role, roleText: ROLE_WORD[r.role] || String(r.role || ""), you: !!r.is_you,
      twoFactor: typeof r.two_factor === "boolean" ? r.two_factor : null, twoFactorText: r.two_factor === true ? "Set up" : r.two_factor === false ? "Not yet" : null,
      signedIn: r.signed_in === true, signedText: r.signed_in === true ? "Signed in" : "Never",
    })).sort((a, b) => (ORDER.indexOf(a.role) + 1 || 99) - (ORDER.indexOf(b.role) + 1 || 99) || a.email.localeCompare(b.email));
  }
  // "6 people · 1 has never signed in" (and, for RCL staff only, "· 2 with two-factor set up")
  function summary(list, { staffView = false } = {}) {
    const n = list.length, tf = list.filter((p) => p.twoFactor === true).length, never = list.filter((p) => !p.signedIn).length;
    if (!n) return "No one has a sign-in in this group.";
    return [n + (n === 1 ? " person" : " people"), ...(staffView ? [tf + " with two-factor set up"] : []), ...(never ? [never + (never === 1 ? " has" : " have") + " never signed in"] : [])].join(" · ");
  }
  // One quiet line for a client admin: RCL staff with access, as a count only
  const staffLine = (n) => (Number(n) > 0 ? "RCL staff (" + Number(n) + ") also have access." : null);

  // ---- recent changes ------------------------------------------------------------------------------------------------------------
  // public.change_log rows for org_members (GA1's trigger): { id, op, actor, at, old_row, new_row }. Who the person is comes from the people
  // read above (a removed person, or for a client admin an RCL staff account, is not in it); who made the change likewise, RCL when no signed-in person made it (actor null).
  function changes(rows, list, { me = null } = {}) {
    const byId = new Map((Array.isArray(list) ? list : []).map((p) => [p.id, p.email]));
    const who = (id) => byId.get(id) || "Someone not listed here";
    const by = (actor) => (actor == null ? "by RCL" : actor === me ? "by you" : byId.has(actor) ? "by " + byId.get(actor) : "by someone not listed here");
    const role = (r) => ROLE_WORD[r?.role] || String(r?.role || "");
    const out = [];
    for (const c of (Array.isArray(rows) ? rows : [])) {
      if (!c || !valid(c.at)) continue;
      const row = c.new_row || c.old_row || {};
      let text = null;
      if (c.op === "INSERT") text = who(row.user_id) + " added as " + role(c.new_row);
      else if (c.op === "DELETE") text = who(row.user_id) + " removed (was " + role(c.old_row) + ")";
      else if (c.op === "UPDATE" && c.old_row?.role !== c.new_row?.role) text = who(row.user_id) + ": " + role(c.old_row) + " to " + role(c.new_row);
      if (text) out.push({ id: c.id, at: c.at, date: day(c.at), text: text + ", " + by(c.actor) });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || (Number(b.id) || 0) - (Number(a.id) || 0));
  }
  const NO_CHANGES = "No changes recorded yet. When someone is added, has their role changed or is removed, it is listed here.";

  return { canSee, NOT_ADMIN, ROLE_WORD, CARDS, SIGN_IN, ADD, ADD_FARM, access, people, summary, staffLine, changes, NO_CHANGES, day };
});
