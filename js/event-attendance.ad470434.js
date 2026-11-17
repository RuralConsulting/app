// EV2: an event's "Who's coming" (before it starts) or "Attendance" (once it has): one block on the event itself, for the group's
// editors, facilitators, advisors and admins (those who read and write the list, NP3). Three ways in, each usable alone:
//   * Head count: just a number, saved as soon as it is typed (group_events.head_count; members see this number);
//   * the list: people from the group's People (the member register by name or member number, sign-ins), a whole sub-group or all
//     current members in one go, or a typed name; each with one status: Invited, Coming, Not coming (apologies), Came;
//   * Mark who came: the list as big rows to tick at the door, with a search and a quick name for someone who just turned up.
// The app sends nothing: Invited records that the coordinator invited them their own way. "Email the invitation" (EV3, event-invite.js) and the event's
// calendar file are there to paste or attach. Every read and write is as the signed-in person (public.group_event_attendees, status
// from migration 20261113082000); the words and logic are in event-attendance-model.js.
(function (root) {
  const FP = root.FP;
  const A = () => FP.eventAttendanceModel, E = () => FP.eventsModel;
  const el = (...a) => FP.el(...a);
  const KIND = { member: "Person with a sign-in", business: "Member", name: "Name only" };
  const CHUNK = 200;          // rows inserted in one request when adding many
  const MAX_LIST = 1000;      // the list read for one event (events.js ATT_CAP): adding stops there

  // ctx: { sb, group: {id, name}, ev, attendees, register, people, notesToo, readOnly, now: () => ISO, attCols,
  //        onAttendees(list), onEvent(row), download(name, text, type) }
  function block(ctx) {
    const sb = ctx.sb || FP.sb, ev = ctx.ev, notesToo = !!ctx.notesToo, readOnly = !!ctx.readOnly;
    // statuses: false while the database has no status column yet (events.js); the list is then plain, nothing that writes a status
    // is offered, and the block says the statuses are on their way
    const statuses = ctx.statuses !== false, writes = !readOnly && statuses;
    const st = { list: [...(ctx.attendees || [])].sort(A().byName), mode: "list", filter: "all", q: "", addQ: "", addStatus: A().defaultStatus(ev, ctx.now()),
      msg: null, busy: false, before: new Map(), subgroups: null, headMsg: null };
    const box = el("section", { class: "ea", "data-attendance": ev.id, "aria-labelledby": "ea-title-" + ev.id });
    const startedNow = () => A().started(ev, ctx.now());
    const changed = () => ctx.onAttendees?.(st.list);

    function draw() {
      // keep the focus on the same control across a redraw (a tick, a status, an add)
      const keep = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute("data-key") : null;
      const c = A().counts(st.list);
      const title = startedNow() ? "Attendance" : "Who's coming";
      const parts = [el("div", { class: "ea-head" }, el("h4", { id: "ea-title-" + ev.id }, title),
        el("p", { class: "ea-sum", "data-counts": "" }, (statuses ? A().countsLine(c, ev.head_count) : A().plainLine(c.all, ev.head_count)) || "No one on the list yet."))];
      if (st.msg) parts.push(el("p", { class: "ea-msg", role: "status" }, st.msg));
      if (st.mode === "tick") parts.push(...tickView());
      else if (st.mode === "add") parts.push(...addView());
      else parts.push(...listView(c));
      box.replaceChildren(...parts);
      if (keep) box.querySelector('[data-key="' + CSS.escape(keep) + '"]')?.focus();
    }

    // ---- the list, with the head count and the ways in ---------------------------------------------------------------------------------
    function listView(c) {
      const out = [headField()];
      if (!readOnly && !statuses) out.push(el("p", { class: "ea-msg ea-wait", role: "status" }, "Statuses arrive in a few minutes."),
        el("div", { class: "ea-actions" }, ...inviteButtons()));
      if (writes) {
        // one filled button: Mark who came once the event has started and someone is listed; Add people before
        const tickFirst = startedNow() && st.list.length > 0;
        const add = el("button", { type: "button", class: tickFirst ? "secondary" : "primary", "data-action": "ea-add", onclick: () => { st.mode = "add"; st.msg = null; draw(); box.querySelector("#ea-search")?.focus(); } },
          FP.icon("plus", 16), el("span", {}, "Add people"));
        const tickB = st.list.length ? el("button", { type: "button", class: tickFirst ? "primary" : "secondary", "data-action": "ea-tick", onclick: () => { st.mode = "tick"; st.q = ""; st.msg = null; draw(); } },
          FP.icon("check", 16), el("span", {}, "Mark who came")) : null;
        out.push(el("div", { class: "ea-actions" }, tickFirst ? tickB : add, tickFirst ? add : tickB, ...inviteButtons()));
      }
      if (!st.list.length) {
        out.push(el("p", { class: "ea-empty" }, readOnly ? "No one was listed." : statuses ? "Add the people you invited, or just type the head count above." : "No one on the list yet."));
        return out;
      }
      // the counts are the filter: All, and each status there is (none while the statuses are on their way)
      if (statuses) {
      const shown = st.filter === "all" ? st.list : st.list.filter((a) => A().statusOf(a) === st.filter);
      out.push(el("div", { class: "ea-filter", role: "group", "aria-label": "Show" },
        ...[["all", "All", c.all], ...A().STATUSES.filter((s) => c[s] > 0).map((s) => [s, A().WORD[s], c[s]])].map(([k, label, n]) =>
          el("button", { type: "button", "aria-pressed": String(st.filter === k), "data-filter": k, onclick: () => { st.filter = k; draw(); } }, label + " ", el("span", { class: "ea-n" }, String(n))))));
      out.push(el("ul", { class: "ea-list" }, ...shown.map(row)));
      } else out.push(el("ul", { class: "ea-list" }, ...st.list.map(row)));
      out.push(el("p", { class: "ea-fine" }, "Only the group's editors and coordinators see this list. Members see the event and the head count."));
      return out;
    }
    function inviteButtons() {
      // EV3: the invitation goes from the coordinator's own email (event-invite.js); the app sends nothing
      return [el("button", { type: "button", class: "link", "data-action": "ei-email", "aria-haspopup": "dialog", onclick: (e) => FP.eventInvite.open(e.currentTarget,
          { sb, group: ctx.group, ev, attendees: statuses ? st.list : [], register: ctx.register || [], now: ctx.now }) }, "Email the invitation"),
        el("button", { type: "button", class: "link", "data-action": "ea-ics", onclick: () => ctx.download?.(E().fileName(ev.title, "calendar", E().span(ev).first, "", "ics").replace(/-end\.ics$/, ".ics"),
          E().ics([{ ...ev, notes: null }], { name: ev.title, now: ctx.now() }), "text/calendar;charset=utf-8") }, "Calendar file")];
    }
    function detail(a) {
      return [KIND[E().ATTENDEE_KIND(a)], a.role || null].filter(Boolean).join(" · ");
    }
    function row(a) {
      const s = A().statusOf(a);
      const status = !statuses ? null : readOnly ? el("span", { class: "ea-status", "data-status": s }, A().WORD[s])
        : el("select", { class: "ea-status", "data-status": s, "data-key": "s:" + a.id, "aria-label": "Status for " + a.name, onchange: (e) => setStatus(a, e.target.value) },
          ...A().STATUSES.map((k) => el("option", { value: k, ...(k === s ? { selected: true } : {}) }, A().LONG[k])));
      return el("li", { class: "ea-row", "data-id": a.id, "data-kind": E().ATTENDEE_KIND(a), ...(statuses ? { "data-status": s } : {}) },
        el("span", { class: "ea-text" }, el("b", {}, a.name), el("small", {}, detail(a)),
          notesToo && a.note ? el("small", { class: "events-private ea-note" }, "Note: " + a.note + " (not shown to members)") : null),
        status,
        readOnly ? null : el("button", { type: "button", class: "link ea-remove", "data-key": "r:" + a.id, "aria-label": "Remove " + a.name + " from the list", onclick: () => remove(a) }, "Remove"));
    }

    // ---- the head count: just a number -----------------------------------------------------------------------------------------------------
    function headField() {
      const id = "ea-head-" + ev.id;
      const input = el("input", { id, type: "text", inputmode: "numeric", autocomplete: "off", value: ev.head_count == null ? "" : String(ev.head_count), placeholder: "None", "data-key": "head",
        ...(readOnly ? { readonly: true } : {}), "aria-describedby": id + "-hint" });
      const say = el("small", { class: "ea-head-msg", role: "status" }, st.headMsg || "");
      if (!readOnly) {
        const save = async () => {
          const r = A().readHead(input.value);
          if (r.error) { st.headMsg = r.error; say.textContent = r.error; return; }
          if (r.value === (ev.head_count ?? null)) return;
          say.textContent = "Saving…";
          const { data, error } = await sb.from("group_events").update({ head_count: r.value }).eq("id", ev.id).select("id,head_count,updated_at").single();
          if (error) { st.headMsg = "Couldn't save the head count: " + error.message; say.textContent = st.headMsg; return; }
          ev.head_count = data?.head_count ?? r.value; if (data?.updated_at) ev.updated_at = data.updated_at;
          ctx.onEvent?.(ev);
          st.headMsg = r.value == null ? "Head count cleared." : "Saved.";
          draw();
        };
        input.addEventListener("change", save);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
      }
      return el("div", { class: "ea-number" },
        el("label", { for: id }, "Head count"), input, say,
        el("small", { id: id + "-hint", class: "ea-hint" }, "Just a number, for when names aren't taken. Shown beside the names, never added to them."));
    }

    // ---- writes ---------------------------------------------------------------------------------------------------------------------------
    async function setStatus(a, status) {
      const was = A().statusOf(a);
      if (status === was) return;
      a.status = status; draw();
      const { error } = await sb.from("group_event_attendees").update({ status }).eq("id", a.id);
      if (error) { a.status = was; st.msg = "Couldn't change " + a.name + ": " + error.message; ctx.recheck?.(); }
      else changed();
      draw();
    }
    async function remove(a) {
      const { error } = await sb.from("group_event_attendees").delete().eq("id", a.id);
      if (error) { st.msg = "Couldn't remove " + a.name + ": " + error.message; ctx.recheck?.(); }
      else { st.list = st.list.filter((x) => x.id !== a.id); st.msg = a.name + " is off the list."; changed(); }
      draw();
    }
    // Insert rows (many in a few requests); the saved rows join the list. Returns how many were added.
    async function insert(rows) {
      const room = MAX_LIST - st.list.length;
      const take = rows.slice(0, Math.max(0, room));
      let added = 0; const failed = [];
      for (let i = 0; i < take.length; i += CHUNK) {
        const { data, error } = await sb.from("group_event_attendees").insert(take.slice(i, i + CHUNK)).select(ctx.attCols);
        if (error) { failed.push(error.message); continue; }
        const saved = Array.isArray(data) ? data : [];
        st.list.push(...saved.map((r) => ({ note: null, ...r })));
        added += saved.length;
      }
      st.list.sort(A().byName);
      if (added) changed();
      if (failed.length) ctx.recheck?.();
      const over = rows.length - take.length;
      return { added, failed, over };
    }
    const report = ({ added, failed, over }, status) => [
      added ? (added === 1 ? "1 person" : added + " people") + " added as " + A().WORD[status].toLowerCase() + "." : "No one added.",
      over > 0 ? over + " not added: an event's list holds at most " + MAX_LIST + "." : null,
      failed.length ? "Not saved: " + failed.join("; ") : null].filter(Boolean).join(" ");

    // ---- adding people ------------------------------------------------------------------------------------------------------------------------
    function addView() {
      const pool = A().candidates({ register: ctx.register || [], people: ctx.people || [] }, st.list);
      const statusPick = el("select", { id: "ea-add-status", "data-key": "add-status", onchange: (e) => { st.addStatus = e.target.value; } },
        ...A().STATUSES.map((k) => el("option", { value: k, ...(k === st.addStatus ? { selected: true } : {}) }, A().LONG[k])));
      const q = el("input", { id: "ea-search", type: "search", autocomplete: "off", placeholder: "Name or member number", value: st.addQ, "data-key": "add-q" });
      const results = el("ul", { class: "ea-results", "aria-label": "People to add" });
      const more = el("p", { class: "ea-fine" });
      const fill = () => {
        const r = A().search(pool, q.value, 20);
        results.replaceChildren(...r.shown.map((c) => el("li", {}, el("button", { type: "button", class: "ea-pick", "data-key": "p:" + c.key, "data-pick": c.key, disabled: st.busy,
          "aria-label": "Add " + c.name + (c.number ? ", member " + c.number : "") + " as " + A().WORD[st.addStatus].toLowerCase(), onclick: () => addSome([c]) },
          el("span", { class: "ea-text" }, el("b", {}, c.name), el("small", {}, [KIND[c.kind], c.number ? "no. " + c.number : null].filter(Boolean).join(" · "))),
          el("span", { class: "ea-plus", "aria-hidden": "true" }, FP.icon("plus", 16))))));
        more.textContent = !pool.length ? "Every member and sign-in is on the list." : r.total > r.shown.length ? (r.total - r.shown.length) + " more: type more of a name." : r.total ? "" : "No member or sign-in matches.";
      };
      q.addEventListener("input", () => { st.addQ = q.value; fill(); });
      fill();
      const allMembers = pool.filter((c) => c.kind === "business");
      const groupWide = el("div", { class: "ea-many" });
      if (allMembers.length) groupWide.append(el("button", { type: "button", class: "secondary", "data-action": "ea-all", disabled: st.busy, onclick: () => addSome(allMembers) },
        A().allMembersLabel(allMembers.length, (ctx.register || []).length)));
      const subs = st.subgroups;
      if (subs && subs.counts.length) {
        const pick = el("select", { id: "ea-sub", "aria-label": "A sub-group" }, el("option", { value: "" }, "A sub-group…"),
          ...subs.counts.map((s) => el("option", { value: s.subgroup_id }, s.subgroup_name + " (" + s.current_businesses + ")")));
        groupWide.append(el("span", { class: "ea-sub" }, pick, el("button", { type: "button", class: "secondary", "data-action": "ea-sub", disabled: st.busy, onclick: () => {
          if (!pick.value) return;
          const ids = new Set([...subs.index].filter(([, set]) => set.has(pick.value)).map(([b]) => b));
          addSome(pool.filter((c) => c.kind === "business" && ids.has(c.id)), subs.counts.find((s) => s.subgroup_id === pick.value)?.subgroup_name);
        } }, "Add the sub-group")));
      } else if (subs == null) loadSubgroups();
      // someone not among them: a typed name (with the shared role and, for coordinators, the private note)
      const name = el("input", { id: "ea-name", type: "text", maxlength: "200", autocomplete: "off", "data-key": "add-name" });
      const role = el("input", { id: "ea-role", type: "text", maxlength: "200", autocomplete: "off", placeholder: "For example: committee, regional council" });
      const note = notesToo ? el("input", { id: "ea-note", type: "text", maxlength: "200", autocomplete: "off" }) : null;
      const typed = el("form", { class: "ea-typed" }, el("h5", {}, "Someone not listed here"),
        el("label", { for: "ea-name" }, "Name"), name, el("label", { for: "ea-role" }, "Role or organisation"), role,
        ...(note ? [el("label", { for: "ea-note" }, "Note (not shown to members)"), note] : []),
        el("button", { type: "submit", class: "secondary" }, "Add"));
      typed.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!name.value.trim()) { st.msg = "Type their name."; draw(); return; }
        const r = { event_id: ev.id, name: name.value.trim(), status: st.addStatus, ...(role.value.trim() ? { role: role.value.trim() } : {}), ...(note && note.value.trim() ? { note: note.value.trim() } : {}) };
        st.busy = true;
        const res = await insert([r]);
        st.busy = false;
        st.msg = res.added ? r.name + " added as " + A().WORD[st.addStatus].toLowerCase() + "." : report(res, st.addStatus);
        draw(); box.querySelector("#ea-name")?.focus();
      });
      return [
        el("div", { class: "ea-add-head" }, el("h5", {}, "Add people"), el("button", { type: "button", class: "primary", "data-action": "ea-done", "data-key": "done", onclick: () => { st.mode = "list"; st.msg = null; draw(); } }, "Done")),
        el("div", { class: "ea-field" }, el("label", { for: "ea-add-status" }, "Add them as"), statusPick),
        el("div", { class: "ea-field" }, el("label", { for: "ea-search" }, "From the members and sign-ins"), q), results, more,
        groupWide.childNodes.length ? el("div", { class: "ea-field" }, el("span", { class: "ea-label" }, "Or many at once"), groupWide) : null,
        typed,
        el("p", { class: "ea-fine" }, "Nothing is sent from here: Invited means you invited them your own way. Names only: no phone numbers or emails are kept."),
      ].filter(Boolean);
    }
    async function addSome(list, what) {
      if (!list.length) { st.msg = what ? "Everyone in " + what + " is on the list already." : "Everyone is on the list already."; draw(); return; }
      st.busy = true; draw();
      const status = st.addStatus;
      const res = await insert(A().rowsFor(ev.id, list, status));
      st.busy = false;
      st.msg = (list.length === 1 && res.added === 1 ? list[0].name + " added as " + A().WORD[status].toLowerCase() + "." : report(res, status));
      draw();
    }
    async function loadSubgroups() {
      st.subgroups = { counts: [], index: new Map() };    // (asked once; an empty answer hides the choice)
      try {
        const r = await FP.subgroups?.readFilter?.(sb, ctx.group.id);
        if (r && Array.isArray(r.counts)) st.subgroups = { counts: r.counts.filter((s) => s.current_businesses > 0), index: r.index || new Map() };
      } catch { /* no sub-groups to offer */ }
      if (st.mode === "add" && st.subgroups.counts.length) draw();
    }

    // ---- marking who came (at the door, on a phone) ------------------------------------------------------------------------------------------
    function tickView() {
      const c = A().counts(st.list);
      const q = el("input", { id: "ea-find", type: "search", autocomplete: "off", placeholder: "Find a name", value: st.q, "data-key": "find", "aria-label": "Find a name" });
      const list = el("ul", { class: "ea-ticks" });
      const fill = () => {
        const words = st.q.trim() ? A().search(st.list.map((a) => ({ ...a, number: "" })), st.q, MAX_LIST).shown.map((a) => a.id) : null;
        const shown = words ? st.list.filter((a) => words.includes(a.id)) : st.list;
        list.replaceChildren(...shown.map((a) => {
          const came = A().statusOf(a) === "came";
          return el("li", {}, el("button", { type: "button", class: "ea-tick", "aria-pressed": String(came), "data-key": "t:" + a.id, "data-id": a.id, onclick: () => toggle(a) },
            el("span", { class: "ea-box", "aria-hidden": "true" }, came ? FP.icon("check", 18) : null),
            el("span", { class: "ea-text" }, el("b", {}, a.name), el("small", {}, came ? "Came" : A().WORD[A().statusOf(a)] + (detail(a) ? " · " + detail(a) : "")))));
        }), ...(shown.length ? [] : [el("li", { class: "ea-empty" }, "No one on the list matches.")]));
      };
      q.addEventListener("input", () => { st.q = q.value; fill(); });
      fill();
      const name = el("input", { id: "ea-walkin", type: "text", maxlength: "200", autocomplete: "off", placeholder: "Someone not on the list", "data-key": "walkin", "aria-label": "Name of someone who came" });
      const walkIn = el("form", { class: "ea-walkin" }, name, el("button", { type: "submit", class: "secondary" }, "Add as came"));
      walkIn.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!name.value.trim()) return;
        const n = name.value.trim();
        const res = await insert([{ event_id: ev.id, name: n, status: "came" }]);
        st.msg = res.added ? n + " added as came." : report(res, "came");
        draw(); box.querySelector("#ea-walkin")?.focus();
      });
      return [
        el("div", { class: "ea-add-head" }, el("p", { class: "ea-came", "aria-live": "polite" }, el("b", {}, String(c.came)), " of " + c.all + " came"),
          el("button", { type: "button", class: "primary", "data-action": "ea-done", "data-key": "done", onclick: () => { st.mode = "list"; st.msg = null; draw(); } }, "Done")),
        q, list, walkIn];
    }
    async function toggle(a) {
      const was = A().statusOf(a), next = A().tick(a, st.before.get(a.id));
      if (was !== "came") st.before.set(a.id, was);
      a.status = next; draw();
      const { error } = await sb.from("group_event_attendees").update({ status: next }).eq("id", a.id);
      if (error) { a.status = was; st.msg = "Couldn't mark " + a.name + ": " + error.message; draw(); ctx.recheck?.(); }
      else changed();
    }

    draw();
    return box;
  }

  FP.eventAttendance = { block };
})(typeof window === "undefined" ? globalThis : window);
