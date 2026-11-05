// The group's manage space (ON3b, docs/CATCHMENT-SPACE.md "Manage"): `#/group/<id>/manage[/members|gaps|sites|settings]`. One
// screen for a group's admins, advisors and facilitators, shaped as a queue a named person decides: a count line, then Members
// (the business register and its farm associations; invite by email through the `invite` function; request an association),
// Gaps (ON3a's proposals about the files and paddocks the group load set aside, grouped by proposed member, with Accept / Not
// this / Pick a member and a note, through public.proposals_decide only), Sites (WQ2's monitoring locations near the group, read
// only) and Settings (the admin's member-detail form). A plain member gets the count line and Members only. Every read is as the
// signed-in person (row-level security decides); no AI, no geometry editing, no email beyond the invite function's own.
(function (root) {
  const FP = root.FP;
  const M = () => FP.groupManageModel;
  const el = (...a) => FP.el(...a);
  const list = (v) => (Array.isArray(v) ? v : []);
  const PROPOSAL_COLUMNS = "id,kind,subject,subject_key,evidence,candidates,status,decision,decided_by,decided_at,applied_at,created_at";
  const ASSOC_COLUMNS = "id,farm_id,group_member_id,status,group_approved_at,farm_approved_at,ended_at,ended_side,created_at";
  const cache = new Map();   // group id -> { pending, data }, kept while the person moves between the tabs
  const decidedHere = new Set(), refusals = new Map();   // this visit's decisions and refusals, by proposal id

  async function read(query) { const { data, error } = await query; if (error) throw error; return data; }
  const optional = (query) => Promise.resolve(query).then((r) => (r.error ? null : r.data), () => null);
  // Every row of a read, a page at a time (the API returns at most 1,000 rows per request; HDLG alone has more than 1,000 open gap
  // rows): `make()` builds the query afresh, ordered by a unique column, and each page is asked for with range() until a short page.
  // A failed page fails the whole read (null), never a silent part of it.
  const PAGE = 1000, MAX_PAGES = 50;
  async function readAll(make) {
    const out = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const { data, error } = await make().range(p * PAGE, p * PAGE + PAGE - 1);
      if (error) return null;
      out.push(...list(data));
      if (list(data).length < PAGE) return out;
    }
    return out;
  }
  const optionalAll = (make) => readAll(make).catch(() => null);

  // ---- reads --------------------------------------------------------------------------------------------------------------
  async function counts(group) {
    const sb = FP.sb;
    // proposals_open_counts answers null to anyone who is neither a member of the group nor RCL staff: that is "no access", never zero
    const settle = (q) => Promise.resolve(q).then((r) => r, () => ({ error: true }));
    const [open, gaps] = await Promise.all([settle(sb.rpc("proposals_open_counts", { org_id: group.id })), settle(sb.rpc("group_load_gaps", { group_id: group.id }))]);
    const access = open?.error ? "error" : open?.data && typeof open.data === "object" ? "ok" : "none";
    // a failed gaps read is not "no load recorded": the count line and the Gaps tab say it could not be read
    const gapsAccess = gaps?.error ? "error" : "ok";
    return { counts: access === "ok" ? open.data : null, access, gapsAccess, gaps: gapsAccess === "ok" ? list(gaps.data).find((g) => g.group_id === group.id) || null : null };
  }
  async function load(group) {
    const sb = FP.sb, decide = M().canDecide(group.role), admin = M().canManage(group.role);
    const [head, register, associations, open, applied, gapRows, sites, locationSites] = await Promise.all([
      counts(group),
      optional(sb.from("group_members").select("id,member_number,business_name,ended_at,created_at").eq("org_id", group.id)),
      optional(sb.from("farm_group_associations").select(ASSOC_COLUMNS).eq("org_id", group.id)),
      // the proposals themselves: only a decider asks (row-level security gives anyone else no rows); every page of them
      decide ? optionalAll(() => sb.from("proposals").select(PROPOSAL_COLUMNS).eq("org_id", group.id).in("status", ["proposed", "ambiguous", "accepted"]).order("id")) : null,
      decide ? optionalAll(() => sb.from("proposals").select(PROPOSAL_COLUMNS).eq("org_id", group.id).eq("status", "applied").order("id")) : null,
      // the open gaps (a group admin reads them), so an applied proposal whose item the load has not placed yet still reads "placed
      // on the next group load"; open ones only, every page
      admin ? optionalAll(() => sb.from("group_load_gaps").select("id,kind,item_key").eq("org_id", group.id).is("resolved_at", null).order("id")) : null,
      decide ? optional(sb.rpc("group_wq_sites", { g: group.id })) : null,
      decide ? optionalAll(() => sb.from("monitoring_location_sites").select("id,location_id,site_id").order("id")) : null,
    ]);
    let locations = [];
    if (decide && sites) {
      const near = new Set(list(sites).map((s) => s.site_id));
      const ids = [...new Set(list(locationSites).filter((r) => near.has(r.site_id)).map((r) => r.location_id))].slice(0, 50);
      locations = (await Promise.all(ids.map((id) => optional(sb.rpc("monitoring_location", { p_location: id }))))).filter(Boolean);
    }
    return { ...head, register: register == null ? null : list(register), associations: list(associations),
      proposals: decide ? [...list(open), ...list(applied)] : [], proposalsRead: !decide || (open != null && applied != null),
      open: gapRows ? new Set(list(gapRows).map((g) => g.kind + ":" + g.item_key)) : null,
      sites: sites == null ? null : list(sites), locations };
  }
  function data(group) {
    let c = cache.get(group.id);
    if (!c || c.role !== group.role) { c = { role: group.role, pending: load(group) }; cache.set(group.id, c); c.pending.then((d) => { c.data = d; }, () => cache.delete(group.id)); }
    return c.data ? Promise.resolve(c.data) : c.pending;
  }

  // ---- the screen ---------------------------------------------------------------------------------------------------------
  // `settings` draws the existing member-detail form (group-space.js), for a group admin.
  async function view(group, route, { settings } = {}) {
    const wrap = el("section", { class: "group-manage", "data-view": "manage" }, el("h2", {}, "Manage the group"),
      el("p", { class: "manage-count group-status", role: "status" }, "Reading what is open…"));
    const tab = M().tabFor(group.role, route.tab);
    const nav = el("nav", { class: "manage-tabs", "aria-label": "Manage" }, ...M().tabs(group.role).map(([key, label]) =>
      el("a", { href: FP.href(FP.groupModel.href(group.id, "manage", key)), class: "manage-tab", "data-tab": key, ...(key === tab ? { "aria-current": "page" } : {}) }, label)));
    const body = el("div", { class: "manage-body", "data-tab": tab });
    wrap.append(nav, body);
    const d = await data(group);
    drawCount(wrap, group, d);
    if (tab === "settings") body.append(settings ? settings() : el("p", {}, "Only a group admin chooses how member farms are shown."));
    else if (tab === "gaps") drawGaps(body, group, d, wrap);
    else if (tab === "sites") drawSites(body, group, d, wrap);
    else drawMembers(body, group, d);
    return wrap;
  }
  function drawCount(wrap, group, d) {
    const waiting = M().canDecide(group.role) && d.proposalsRead ? M().waitingByGap(d.proposals, { open: d.open, checkedAt: d.gaps?.checked_at || null }) : null;
    const c = M().countLine(d.counts, d.gaps, { access: d.access, waiting, gapsAccess: d.gapsAccess }), node = wrap.querySelector(".manage-count");
    node.replaceChildren(el("b", {}, c.text));
    node.dataset.state = c.noAccess ? "no-access" : c.unknown ? "unknown" : c.empty ? "empty" : "open";
    if (!M().canDecide(group.role) && !c.empty && !c.noAccess) node.append(el("small", {}, " The group's admins, advisors and facilitators decide these."));
  }
  async function refreshCount(wrap, group, d) {
    Object.assign(d, await counts(group).catch(() => ({ counts: d.counts, access: d.access, gapsAccess: d.gapsAccess, gaps: d.gaps })));
    drawCount(wrap, group, d);
  }

  // ---- Gaps: the proposals a person decides -------------------------------------------------------------------------------------
  function drawGaps(body, group, d, wrap) {
    const v = M().gapsTab(d.proposals, { gaps: d.gaps, open: d.open, decidedHere });
    body.replaceChildren(el("p", { class: "group-fine" }, "What the group load set aside rather than guess (FEP files and paddocks it could not tie to a member), with the member RCL's reconciliation proposes and why. " +
      "Nothing is linked until a person accepts it; an accepted item is placed on the next group load."));
    if (!d.proposalsRead) body.append(el("p", { role: "alert" }, "Couldn't read the proposals."));
    if (d.gapsAccess === "error") body.append(el("p", { role: "alert", class: "manage-gaps-error" }, "Couldn't read what the group load set aside."));
    if (v.empty && d.proposalsRead && d.gapsAccess !== "error") { body.append(el("p", { class: "manage-empty" }, "Nothing open")); return; }
    if (!v.groups.length && d.proposalsRead) body.append(el("p", { class: "manage-empty" }, "Nothing to decide: no proposal is open. What the load set aside is below."));
    for (const g of v.groups) {
      body.append(el("section", { class: "manage-group", "data-group": g.key }, el("h3", {}, g.title, g.count ? el("small", {}, " · " + g.count) : null),
        el("ul", { class: "manage-lines" }, ...g.lines.map((l) => proposalItem(l, group, d, () => drawGaps(body, group, d, wrap), wrap)))));
    }
    if (v.setAside.length) body.append(el("section", { class: "manage-group", "data-group": "set-aside" }, el("h3", {}, "Set aside by the group load"),
      el("ul", { class: "group-lines" }, ...v.setAside.map((s) => el("li", { "data-kind": s.kind }, el("span", {}, s.text), s.resolve ? el("small", {}, "To place them: " + s.resolve) : null))),
      v.checked ? el("p", { class: "group-fine" }, v.checked + ".") : null));
  }
  function evidenceList(c) {
    return el("ul", { class: "manage-evidence" }, ...c.evidence.map((t) => el("li", {}, t)));
  }
  function proposalItem(l, group, d, redraw, wrap) {
    const li = el("li", { class: "manage-line", "data-proposal": l.id, "data-state": l.state },
      el("div", { class: "manage-item" }, el("b", {}, l.item.title), el("small", {}, [l.item.what, l.item.id, l.item.path && l.item.path !== l.item.title ? l.item.path : null].filter(Boolean).join(" · "))),
      el("p", { class: "manage-state", tabindex: "-1" }, l.text));
    if (l.because) li.append(el("small", { class: "manage-because" }, l.because));
    if (l.replaces) li.append(el("small", {}, l.replaces));
    // the evidence: the proposed (or chosen) member's, or every candidate's when more than one could fit
    const shown = l.state === "ambiguous" ? l.candidates : [l.proposed || l.chosen].filter(Boolean);
    for (const c of shown) li.append(el("div", { class: "manage-candidate" }, el("span", {}, c.label + (c.confidence != null ? " · confidence " + c.confidence : "") + (c.signals.length ? " (" + c.signals.join(", ") + ")" : "")), evidenceList(c)));
    if (l.decided && !l.open) li.append(el("small", {}, l.decided));
    // a decision the database refused (another decider got there first, a re-run superseded it, the role was lost): the refusal,
    // and the row as it is now, with no buttons
    if (refusals.has(l.id)) li.append(el("p", { class: "manage-msg manage-refused", role: "alert" }, refusals.get(l.id)));
    else if (l.open && M().canDecide(group.role)) li.append(controls(l, group, d, redraw, wrap));
    return li;
  }
  function controls(l, group, d, redraw, wrap) {
    const row = d.proposals.find((p) => p.id === l.id);
    const note = el("input", { type: "text", maxlength: "2000", class: "manage-note", "aria-label": "Note on " + l.item.title, placeholder: "Note (optional)" });
    const msg = el("p", { class: "manage-msg", role: "status" });
    const pick = l.canPick ? el("select", { class: "manage-pick", "aria-label": "Pick a member for " + l.item.title },
      el("option", { value: "" }, "Pick a member…"), ...l.candidates.filter((c) => c.member != null).map((c) => el("option", { value: String(c.member) }, c.label))) : null;
    const buttons = [];
    const go = async (action, button) => {
      const args = M().decision(row, action, { member: action === "pick" ? pick?.value || null : null, note: note.value });
      if (!args) { msg.textContent = "Pick one of the members first."; pick?.focus(); return; }
      for (const b of buttons) b.disabled = true;
      msg.textContent = "Saving…";
      const { data: saved, error } = await FP.sb.rpc("proposals_decide", args);
      if (error || !saved) {
        // refused: read the row again and show it as it is now (or drop it when it can no longer be read), with the refusal
        refusals.set(l.id, "Couldn't save the decision: " + (error?.message || "no reply") + ". It is shown as it is now.");
        const now = await optional(FP.sb.from("proposals").select(PROPOSAL_COLUMNS).eq("id", l.id));
        const row = list(now)[0];
        d.proposals = row ? M().replace(d.proposals, row) : d.proposals.filter((p) => p.id !== l.id);
        decidedHere.add(l.id);
        redraw();
        wrap.querySelector('[data-proposal="' + l.id + '"] .manage-state')?.focus?.();
        refreshCount(wrap, group, d);
        return;
      }
      d.proposals = M().replace(d.proposals, saved);
      decidedHere.add(saved.id);
      redraw();
      wrap.querySelector('[data-proposal="' + saved.id + '"] .manage-state')?.focus?.();
      refreshCount(wrap, group, d);
    };
    if (l.state === "proposed") buttons.push(el("button", { type: "button", class: "primary", "data-act": "accept", onclick: (e) => go("accept", e.target) }, "Accept"));
    buttons.push(el("button", { type: "button", class: "secondary", "data-act": "reject", onclick: (e) => go("reject", e.target) }, "Not this"));
    if (pick) buttons.push(el("button", { type: "button", class: l.state === "ambiguous" ? "primary" : "secondary", "data-act": "pick", onclick: (e) => go("pick", e.target) },
      l.state === "ambiguous" ? "Accept the member picked" : "Accept another member"));
    return el("div", { class: "manage-controls" }, ...(pick ? [pick] : []), note, el("div", { class: "manage-buttons" }, ...buttons), msg);
  }

  // ---- Members ----------------------------------------------------------------------------------------------------------------
  function drawMembers(body, group, d) {
    if (d.register == null) { body.replaceChildren(el("p", { role: "alert" }, "Couldn't read the group's register.")); return; }
    const v = M().membersTab({ register: d.register, associations: d.associations, gaps: d.gaps, canManage: M().canManage(group.role) });
    body.replaceChildren();
    if (v.summary) body.append(el("p", { class: "manage-summary" }, v.summary));
    if (v.noExtentNote) body.append(el("p", { class: "group-fine" }, v.noExtentNote));
    if (d.gapsAccess === "error") body.append(el("p", { role: "alert" }, "Couldn't read the group load's gaps, so members without a map extent are not shown."));
    if (v.empty) body.append(el("p", { class: "manage-empty" }, v.emptyText));
    else body.append(el("ul", { class: "manage-members" }, ...v.rows.map((r) => el("li", { "data-member": r.number, ...(r.retired ? { "data-retired": "" } : {}) },
      el("div", { class: "manage-item" }, el("b", {}, "Member " + r.number + " · " + r.name), r.retired ? el("small", {}, r.retired) : null),
      ...(r.associations.length ? r.associations.map((a) => el("small", { "data-association": a.state }, a.text)) : [el("small", {}, "No farm in the tool yet")]),
      r.noExtent ? el("small", { class: "manage-no-extent" }, r.noExtent) : null,
      v.canInvite && r.associations.some((a) => a.state !== "ended" && a.farm) ? inviteForm(r, r.associations.find((a) => a.state !== "ended" && a.farm)) : null))));
    if (v.noExtentResolve) body.append(el("p", { class: "group-fine" }, "No map extent: " + v.noExtentResolve));
    if (v.unlinked.length) body.append(el("h3", {}, "Associations not tied to a business"),
      el("ul", { class: "group-lines" }, ...v.unlinked.map((a) => el("li", { "data-association": a.state }, a.text))));
    if (v.canRequest) body.append(requestForm(group, d, body, v));
  }
  // Invite by email: the existing `invite` function adds the person to the member's farm, under the pilot rule (RCL colleagues and
  // Josh's named testers only) and only when the caller is that farm's owner or admin; its reply is shown as it is.
  function inviteForm(r, a) {
    const input = el("input", { type: "email", autocomplete: "off", "aria-label": "Email to invite to member " + r.number + "'s farm", placeholder: "Email" });
    const role = el("select", { "aria-label": "Their access" }, ...M().INVITE_ROLES.map(([k, label]) => el("option", { value: k }, label)));
    const msg = el("p", { class: "manage-msg", role: "status" });
    const button = el("button", { type: "submit", class: "secondary" }, "Invite");
    const form = el("form", { class: "manage-invite" }, input, role, button, msg);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = M().email(input.value);
      if (!email) { msg.textContent = "Enter their email address."; input.focus(); return; }
      button.disabled = true; msg.textContent = "Inviting " + email + "…";
      const { data: reply, error } = await FP.sb.functions.invoke("invite", { body: { farm_id: a.farm, email, role: role.value } });
      button.disabled = false;
      if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch { /* the message as it came */ } msg.textContent = m; return; }
      input.value = "";
      msg.textContent = reply?.resent ? reply.email + " hasn't signed in yet, so the email was sent again." : "Added " + (reply?.email || email) + " to the farm. Anyone new gets an email with a link to set a password.";
    });
    return el("details", { class: "manage-invite-box" }, el("summary", {}, "Invite someone to this member's farm"),
      el("p", { class: "group-fine" }, "For now only RCL colleagues and named testers can be added, and only by the farm's owner or admin."), form);
  }
  // Request an association with a farm (request_farm_group_association): a group admin names the business and the farm's id (the
  // farm's owner gives it to the group); the farm's owner then approves it in the farm space.
  function requestForm(group, d, body, v) {
    const farm = el("input", { type: "text", autocomplete: "off", spellcheck: "false", id: "manage-request-farm", placeholder: "Farm id (from the farm's owner)" });
    const business = el("select", { id: "manage-request-business" }, el("option", { value: "" }, "No business named"), ...v.businesses.map((b) => el("option", { value: b.id }, b.label)));
    const msg = el("p", { class: "manage-msg", role: "status" });
    const button = el("button", { type: "submit", class: "secondary" }, "Request the association");
    const form = el("form", { class: "manage-request" }, el("h3", {}, "Request an association with a farm"),
      el("p", { class: "group-fine" }, "The farm's owner or admin gives the group its farm id and approves the request in their farm space. Nothing is shared until they do."),
      el("label", { for: "manage-request-business" }, "Business"), business, el("label", { for: "manage-request-farm" }, "Farm id"), farm, button, msg);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const id = M().farmId(farm.value);
      if (!id) { msg.textContent = "Enter the farm's id as its owner gave it (36 characters)."; farm.focus(); return; }
      button.disabled = true; msg.textContent = "Requesting…";
      const { error } = await FP.sb.rpc("request_farm_group_association", { group_id: group.id, target_farm: id, business_id: business.value || null });
      button.disabled = false;
      if (error) { msg.textContent = "Couldn't request it: " + (error.message || "refused"); return; }
      farm.value = "";
      d.associations = list(await optional(FP.sb.from("farm_group_associations").select(ASSOC_COLUMNS).eq("org_id", group.id))) ;
      drawMembers(body, group, d);
      body.querySelector(".manage-request .manage-msg").textContent = "Requested. The farm's owner approves it in their farm space.";
    });
    return form;
  }

  // ---- Sites ----------------------------------------------------------------------------------------------------------------------
  function drawSites(body, group, d, wrap) {
    if (d.sites == null) { body.replaceChildren(el("p", { role: "alert" }, "Couldn't read the sites near the group.")); return; }
    const v = M().sitesTab({ sites: d.sites, locations: d.locations, proposals: d.proposals, groupId: group.id, gaps: d.gaps, open: d.open });
    body.replaceChildren(el("p", { class: "manage-scope" }, v.scope), el("p", { class: "group-fine" }, "Monitoring locations join the site ids one place has been sampled under (a site replaced by its successor, or a co-located record), with the dates each counts for. They are reviewed by RCL and read only here."));
    if (v.empty) body.append(el("p", { class: "manage-empty" }, v.emptyText));
    if (v.questions.length) body.append(el("section", { class: "manage-group", "data-group": "site-questions" }, el("h3", {}, "Site questions"),
      el("ul", { class: "manage-lines" }, ...v.questions.map((l) => proposalItem(l, group, d, () => drawSites(body, group, d, wrap), wrap)))));
    if (v.locations.length) body.append(el("h3", {}, "Monitoring locations"), el("ul", { class: "manage-locations" }, ...v.locations.map((l) => el("li", { "data-location": l.key },
      el("b", {}, l.name), l.note ? el("small", {}, l.note) : null,
      el("ul", { class: "group-lines" }, ...l.members.map((m) => el("li", { "data-role": m.role }, el("span", {}, m.id + (m.name ? " · " + m.name : "")), el("small", {}, m.role + " · " + m.dates + (m.note ? " · " + m.note : "")))))))));
    if (v.noLocations) body.append(el("p", {}, v.noLocations));
    if (v.own.length) body.append(el("h3", {}, "The group's own sites"), el("ul", { class: "group-lines" }, ...v.own.map((s) => el("li", {}, el("span", {}, s.id + " · " + s.name), el("small", {}, s.last)))));
    if (v.othersText) body.append(el("p", { class: "group-fine" }, v.othersText));
    body.append(el("p", { class: "group-fine manage-propose" }, v.propose));
  }

  // forget: the cache lasts only across tab switches (group-space.js drops it on entering Manage from another view, on a change of
  // group and on leaving the group space), so a later visit reads the queue again
  function forget(id) { if (id) cache.delete(id); else cache.clear(); decidedHere.clear(); refusals.clear(); }
  FP.groupManage = { view, load, readAll, forget };
})(typeof window === "undefined" ? globalThis : window);
