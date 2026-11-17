// GA1: a group's access page (`#/group/<id>/access`), "who can sign in and what they can do", for the group's admins. One calm
// column: the role cards, how everyone signs in, the people with a sign-in in the group (email, role, two-factor, last signed in: a
// table on a computer, rows on a phone), how someone is added today, and the recent changes to the group's people. Two reads as the
// person: public.group_access (the group's admins only; anyone else gets no rows) and public.change_log's org_members rows ("managers
// read the change log"). Nothing is written here: roles are shown as text and no one is removed, because no policy lets a group
// admin change org_members; adding someone is RCL's tools/add_person.py, under the pilot rule, as the page says.
(function (root) {
  const FP = root.FP;
  const M = () => FP.groupAccessModel;
  const el = (...a) => FP.el(...a);
  const CHANGES = 20;   // the newest changes shown (a bounded read)

  async function load(group, sb) {
    const settle = (q) => Promise.resolve(q).then((r) => (r.error ? { error: r.error } : { data: r.data }), (e) => ({ error: e }));
    const [people, log] = await Promise.all([
      settle(sb.rpc("group_access", { g: group.id })),
      settle(sb.from("change_log").select("id,op,actor,at,old_row,new_row").eq("org_id", group.id).eq("table_name", "org_members").order("at", { ascending: false }).limit(CHANGES)),
    ]);
    // group_access answers null to anyone who is not an admin of the group: nothing to list (the page is not drawn for them anyway)
    return { access: people.error || !people.data ? null : M().access(people.data), log: log.error ? null : log.data || [] };
  }

  // manage: the Manage space's Members tab, when it is drawn for this person (a client's simple view hides Manage)
  function view(group, { sb = FP.sb, me = null, manage = null } = {}) {
    const wrap = el("section", { class: "group-access", "data-view": "access", "aria-labelledby": "ga-title" }, el("h2", { id: "ga-title" }, "Who has access"));
    if (!M().canSee(group.role)) { wrap.append(el("p", { class: "ga-note", role: "status" }, M().NOT_ADMIN)); return wrap; }
    wrap.append(el("p", { class: "ga-lead" }, "The people with a sign-in in " + group.name + ", and what each role can do."));
    wrap.append(el("ul", { class: "ga-roles", "aria-label": "What each role can do" }, ...M().CARDS.map((c) =>
      el("li", { class: "ga-role", "data-role": c.key }, el("b", {}, c.name), el("p", {}, c.text)))));
    wrap.append(el("p", { class: "ga-signin" }, M().SIGN_IN));
    const status = el("p", { class: "ga-status", role: "status" }, "Reading who has access…");
    const people = el("div", { class: "ga-people", "aria-busy": "true" }, status);
    const add = el("section", { class: "ga-add", "aria-labelledby": "ga-add-title" }, el("h3", { id: "ga-add-title" }, "Add someone"), el("p", {}, M().ADD),
      manage ? el("p", { class: "ga-fine" }, M().ADD_FARM, el("a", { href: manage }, "Manage, Members"), ".") : null);
    const log = el("section", { class: "ga-log", "aria-labelledby": "ga-log-title", "aria-busy": "true" }, el("h3", { id: "ga-log-title" }, "Recent changes"));
    wrap.append(el("section", { class: "ga-list", "aria-labelledby": "ga-list-title" }, el("h3", { id: "ga-list-title" }, "People"), people), add, log);
    load(group, sb).then((d) => { drawPeople(people, d); drawLog(log, d, me); }, () => { drawPeople(people, { access: null }); drawLog(log, { access: null, log: null }, me); });
    return wrap;
  }

  function drawPeople(node, d) {
    node.setAttribute("aria-busy", "false");
    if (d.access == null) { node.replaceChildren(el("p", { class: "ga-status", role: "alert" }, "Couldn't read who has access. Try again later.")); return; }
    const { list, staffView, staffOthers } = d.access;
    const head = (t) => el("th", { scope: "col", role: "columnheader" }, t);
    // a phone shows each person as a row: the email, then a quiet line; the cells keep their names for a screen reader (the role
    // attributes keep the table's meaning when CSS draws it as rows), and the short labels show only there
    const cell = (label, text, extra = {}) => el("td", { role: "cell", ...extra }, label ? el("span", { class: "ga-k", "aria-hidden": "true" }, label) : null, text);
    // two-factor only for RCL staff viewers (clients are never asked for it); sign-in as "Signed in" or "Never", never when
    const staffLine = M().staffLine(staffOthers);
    node.replaceChildren(...[el("p", { class: "ga-summary" }, M().summary(list, { staffView })),
      list.length ? el("table", { class: "ga-table", role: "table", "aria-labelledby": "ga-list-title", "data-staff-view": staffView ? "yes" : "no" },
        el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, head("Email"), head("Role"), staffView ? head("Two-factor") : null, head("Sign-in"))),
        el("tbody", { role: "rowgroup" }, ...list.map((p) => el("tr", { role: "row", "data-person": p.id, "data-role": p.role, ...(p.you ? { "data-you": "" } : {}) },
          el("td", { role: "cell", class: "ga-email" }, el("b", {}, p.email), p.you ? el("small", {}, " (you)") : null),
          cell("", p.roleText, { class: "ga-rolecell" }),
          staffView ? cell("Two-factor: ", p.twoFactorText || "Not known", { class: "ga-2fa", "data-state": p.twoFactor ? "set" : "not-yet" }) : null,
          el("td", { role: "cell", class: "ga-last", "data-state": p.signedIn ? "signed-in" : "never" }, p.signedText,
            p.signedIn ? null : el("span", { class: "ga-k", "aria-hidden": "true" }, " signed in")))))) : null,   // a phone's quiet line: "Never signed in"
      staffLine ? el("p", { class: "ga-fine ga-staff" }, staffLine) : null].filter(Boolean));
  }

  function drawLog(node, d, me) {
    node.setAttribute("aria-busy", "false");
    const keep = node.querySelector("h3");
    if (d.log == null) { node.replaceChildren(keep, el("p", { class: "ga-status", role: "alert" }, "Couldn't read the recent changes.")); return; }
    const rows = M().changes(d.log, d.access?.list || [], { me });
    node.replaceChildren(keep, rows.length
      ? el("ul", { class: "ga-changes" }, ...rows.map((c) => el("li", {}, el("time", { datetime: c.at }, c.date), el("span", {}, c.text))))
      : el("p", { class: "ga-fine" }, M().NO_CHANGES));
  }

  FP.groupAccess = { view, load };
})(typeof window === "undefined" ? globalThis : window);
