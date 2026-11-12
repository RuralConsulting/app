// N4: a catchment group's Events view: a calendar (a month grid, or Upcoming and Past lists: the list first on a phone), an
// event with its attendance, the event form, export (events and attendance as CSV, a calendar file) and import (a CSV in the
// export's columns, previewed row by row, nothing written until the person says so). Every read and write is as the signed-in
// person through row-level security (public.group_events, public.group_event_attendees; migration 20261112020000): any member of
// the group reads, its editors write, its admins or the person who added an event cancel it. The words and the logic are in
// events-model.js; this file reads, writes and draws.
(function (root) {
  const FP = root.FP;
  const M = () => FP.eventsModel, G = () => FP.groupModel;
  const el = (...a) => FP.el(...a);
  const COLS = "id,org_id,title,starts_at,ends_at,all_day,place_name,latitude,longitude,topics,notes,head_count,cancelled_at,cancelled_by,created_by,created_at,updated_at";
  const ATT_COLS = "id,event_id,user_id,group_member_id,name,note,added_at";
  const CAP = 2000;          // at most this many events are read for a group (counted first)
  const ATT_CAP = 1000;      // attendees read for one event
  const NARROW = 760;

  async function rows(query) { const { data, error } = await query; if (error) throw error; return Array.isArray(data) ? data : []; }
  const optional = (p) => Promise.resolve(p).then((r) => (r?.error ? [] : Array.isArray(r?.data) ? r.data : []), () => []);
  // Counted first, then at most that many (CAP): the group's events in start order.
  async function readEvents(sb, org) {
    const head = await sb.from("group_events").select("id", { count: "exact", head: true }).eq("org_id", org);
    if (head.error) throw head.error;
    const total = typeof head.count === "number" ? head.count : null;
    if (total === 0) return { events: [], total: 0, truncated: false };
    const want = Math.min(total ?? CAP, CAP);
    const events = await rows(sb.from("group_events").select(COLS).eq("org_id", org).order("starts_at", { ascending: true }).range(0, want - 1));
    return { events, total: total ?? events.length, truncated: (total ?? 0) > CAP };
  }
  const readAttendees = (sb, id) => rows(sb.from("group_event_attendees").select(ATT_COLS).eq("event_id", id).order("name", { ascending: true }).range(0, ATT_CAP - 1));
  async function readAttendeesOf(sb, ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) out.push(...await rows(sb.from("group_event_attendees").select(ATT_COLS).in("event_id", ids.slice(i, i + 100)).range(0, 9999)));
    return out;
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })), a = el("a", { href: url, download: name, hidden: true });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const narrow = () => (typeof matchMedia === "function" ? matchMedia("(max-width: " + NARROW + "px)").matches : false);

  // The view for one group: a node that redraws itself. opts: { sb, person: {id}, today: "YYYY-MM-DD", now: ISO instant }
  function view(group, opts = {}) {
    const sb = opts.sb || FP.sb, person = opts.person || null;
    const canWrite = G().canWrite(group.role), isAdmin = G().canManage(group.role);
    const wrap = el("section", { class: "group-events", "data-view": "events" });
    const st = { events: [], total: 0, truncated: false, mode: narrow() ? "list" : "month", month: String(opts.today || M().dayKey(Date.now())).slice(0, 7),
      tab: "upcoming", screen: "calendar", current: null, attendees: [], people: null, register: null, notice: null, preview: null, failed: null };
    const today = () => String(opts.today || M().dayKey(Date.now())).slice(0, 10);
    const now = () => opts.now || new Date().toISOString();
    const canCancel = (ev) => isAdmin || (!!person?.id && ev.created_by === person.id);

    async function reload() {
      try { Object.assign(st, await readEvents(sb, group.id)); st.failed = null; }
      catch (e) { st.failed = e?.message || String(e); }
    }
    function draw() {
      const body = st.screen === "event" ? eventScreen() : st.screen === "form" ? formScreen() : st.screen === "export" ? exportScreen() : st.screen === "import" ? importScreen() : calendarScreen();
      wrap.replaceChildren(el("h2", {}, "Events"), ...(st.notice ? [el("p", { class: "events-notice", role: "status" }, st.notice)] : []), body);
      st.notice = null;
    }
    const go = (screen, extra = {}) => { Object.assign(st, { screen }, extra); draw(); wrap.scrollIntoView?.({ block: "start" }); };
    const back = (label = "Back to the calendar") => el("button", { type: "button", class: "link events-back", onclick: () => go("calendar") }, label);

    // ---- the calendar ------------------------------------------------------------------------------------------------------------
    function calendarScreen() {
      const box = el("div", { class: "events-calendar" });
      const toggle = el("div", { class: "events-toggle", role: "group", "aria-label": "Show the events as" },
        ...[["list", "List"], ["month", "Month"]].map(([k, label]) => el("button", { type: "button", "aria-pressed": String(st.mode === k), onclick: () => { st.mode = k; draw(); } }, label)));
      // UI2: Add an event is quiet (the + offers Event too); Export and Import are tucked under "…"
      const actions = el("div", { class: "events-actions" }, toggle,
        canWrite ? el("button", { type: "button", class: "primary", "data-action": "add", onclick: () => openForm(null, today()) }, FP.icon("plus", 16), el("span", {}, "Add an event")) : null,
        FP.sheet.moreButton("More actions", [
          { label: "Export", hint: "A spreadsheet or a calendar file", icon: "download", action: "export", run: () => go("export") },
          ...(canWrite ? [{ label: "Import", hint: "Events from a spreadsheet", icon: "file", action: "import", run: () => go("import", { preview: null }) }] : [])]));
      box.append(actions);
      if (st.failed) { box.append(el("p", { role: "alert", class: "events-failed" }, "Couldn't read the group's events just now: " + st.failed)); return box; }
      if (st.truncated) box.append(el("p", { class: "group-fine" }, "The group has " + st.total.toLocaleString("en-NZ") + " events; the earliest " + CAP.toLocaleString("en-NZ") + " are shown."));
      box.append(st.mode === "month" ? monthNode() : listNode());
      if (!st.events.length) box.append(el("p", { class: "events-empty" }, "No events yet."));
      return box;
    }
    function chip(ev) {
      return el("button", { type: "button", class: "events-chip" + (ev.cancelled_at ? " cancelled" : ""), "data-event": ev.id, title: ev.title + " · " + M().whenText(ev), onclick: () => openEvent(ev.id) },
        ev.all_day ? "" : el("span", { class: "events-chip-time" }, M().clock(M().timeKey(ev.starts_at)) + " "), ev.title);
    }
    function monthNode() {
      const g = M().monthGrid(st.month, st.events, today());
      const nav = el("div", { class: "events-month-nav" },
        el("button", { type: "button", class: "secondary", "aria-label": "Previous month", onclick: () => { st.month = g.prev; draw(); } }, "‹"),
        el("h3", { "aria-live": "polite" }, g.label),
        el("button", { type: "button", class: "secondary", "aria-label": "Next month", onclick: () => { st.month = g.next; draw(); } }, "›"),
        el("button", { type: "button", class: "link", onclick: () => { st.month = today().slice(0, 7); draw(); } }, "This month"));
      const grid = el("div", { class: "events-grid", role: "table", "aria-label": g.label },
        el("div", { class: "events-grid-head", role: "row" }, ...M().DAYS.map((d) => el("div", { role: "columnheader" }, d))),
        ...g.weeks.map((week) => el("div", { class: "events-week", role: "row" }, ...week.map((day) => {
          const label = M().dateText(day.date);
          const num = canWrite
            ? el("button", { type: "button", class: "events-day-num", "aria-label": "Add an event on " + label, title: "Add an event on " + label, onclick: () => openForm(null, day.date) }, String(day.day))
            : el("span", { class: "events-day-num", "aria-label": label }, String(day.day));
          return el("div", { class: "events-day" + (day.inMonth ? "" : " other") + (day.today ? " today" : ""), role: "cell", "data-date": day.date }, num, ...day.events.map(chip));
        }))));
      return el("div", { class: "events-month" }, nav, grid);
    }
    function item(ev) {
      const topics = M().cleanTopics(ev.topics);
      const first = M().span(ev).first, [, , d] = first.split("-").map(Number);
      return el("li", { class: "events-item" + (ev.cancelled_at ? " cancelled" : "") },
        el("button", { type: "button", "data-event": ev.id, onclick: () => openEvent(ev.id) },
          el("span", { class: "events-date", "aria-hidden": "true" }, el("b", {}, String(d)), el("small", {}, M().dateText(first).split(" ")[0])),
          el("span", { class: "events-item-text" }, el("b", {}, ev.title, ev.cancelled_at ? el("span", { class: "events-badge" }, "Cancelled") : null),
            el("small", {}, M().whenText(ev) + (ev.place_name ? " · " + ev.place_name : "")),
            topics.length ? el("small", { class: "events-topics-line" }, topics.join(" · ")) : null)));
    }
    function listNode() {
      const l = M().lists(st.events, now());
      const tabs = el("div", { class: "events-tabs", role: "tablist" }, ...[["upcoming", "Upcoming", l.upcoming.length], ["past", "Past", l.past.length]].map(([k, label, n]) =>
        el("button", { type: "button", role: "tab", "aria-selected": String(st.tab === k), onclick: () => { st.tab = k; draw(); } }, label + " (" + n + ")")));
      const shown = st.tab === "past" ? l.past : l.upcoming;
      if (!shown.length) return el("div", { class: "events-list-wrap" }, tabs, el("p", { class: "events-empty-tab" }, st.tab === "past" ? "No past events." : "Nothing coming up."));
      // UI2: an agenda: the events under their month, with a slim strip of the months along the top to jump to one
      const months = [];
      for (const ev of shown) { const key = M().span(ev).first.slice(0, 7); if (!months.length || months[months.length - 1].key !== key) months.push({ key, events: [] }); months[months.length - 1].events.push(ev); }
      const label = (key) => { const [y, m] = key.split("-").map(Number); return M().MONTHS[m - 1] + (y === Number(today().slice(0, 4)) ? "" : " " + y); };
      const strip = months.length > 1 ? el("nav", { class: "events-strip", "aria-label": "Months" }, ...months.map((g) => el("button", { type: "button", "data-month": g.key,
        onclick: () => wrap.querySelector('[data-month-head="' + g.key + '"]')?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) },
        el("span", {}, label(g.key).replace(/^(\w{3})\w*/, "$1")), el("small", {}, String(g.events.length))))) : null;
      return el("div", { class: "events-list-wrap" }, tabs, strip, ...months.map((g) => el("section", { class: "events-agenda-month" },
        el("h4", { class: "events-month-head", "data-month-head": g.key }, label(g.key)), el("ul", { class: "events-list" }, ...g.events.map(item)))));
    }

    // ---- one event, with its attendance --------------------------------------------------------------------------------------------
    async function openEvent(id) {
      st.current = st.events.find((e) => e.id === id) || null; st.attendees = [];
      if (!st.current) return go("calendar");
      go("event");
      try {
        st.attendees = await readAttendees(sb, id);
        if (canWrite && !st.current.cancelled_at) await pickers();
      } catch (e) { st.notice = "Couldn't read the attendance just now: " + (e?.message || e); }
      if (st.screen === "event" && st.current?.id === id) draw();
    }
    async function pickers() {
      if (st.people == null) st.people = await optional(sb.rpc("group_event_people", { g: group.id }));
      if (st.register == null) st.register = (await optional(sb.from("group_members").select("id,member_number,business_name,ended_at").eq("org_id", group.id).range(0, 1999)))
        .filter((b) => !b.ended_at).sort((a, b) => String(a.business_name).localeCompare(String(b.business_name)));
    }
    const KIND = { member: "Person with a sign-in", business: "Member", name: "Name only" };
    function eventScreen() {
      const ev = st.current, topics = M().cleanTopics(ev.topics);
      const box = el("article", { class: "events-event", "data-event": ev.id }, back(),
        el("h3", { class: "events-title" }, ev.title, ev.cancelled_at ? el("span", { class: "events-badge" }, "Cancelled") : null),
        el("dl", { class: "events-facts" },
          el("dt", {}, "When"), el("dd", {}, M().whenText(ev)),
          el("dt", {}, "Where"), el("dd", {}, ev.place_name || "No place recorded", ev.latitude != null ? el("small", {}, " (" + Number(ev.latitude).toFixed(5) + ", " + Number(ev.longitude).toFixed(5) + ")") : null),
          ...(topics.length ? [el("dt", {}, "Topics"), el("dd", {}, el("ul", { class: "events-topic-chips" }, ...topics.map((t) => el("li", {}, t))))] : []),
          ...(ev.head_count != null ? [el("dt", {}, "Head count"), el("dd", {}, String(ev.head_count))] : [])),
        ev.notes ? el("div", { class: "events-notes" }, el("h4", {}, "Notes"), el("p", {}, ev.notes)) : null);
      if (ev.cancelled_at) box.append(el("p", { class: "group-fine" }, "Cancelled " + G().shortDate(ev.cancelled_at) + ". A cancelled event stays on record; it can't be changed until it is restored."));
      const buttons = el("div", { class: "events-actions" });
      if (canWrite && !ev.cancelled_at) buttons.append(el("button", { type: "button", class: "secondary", "data-action": "edit", onclick: () => openForm(ev) }, "Edit"));
      if (canWrite && canCancel(ev)) buttons.append(el("button", { type: "button", class: "secondary", "data-action": ev.cancelled_at ? "restore" : "cancel", onclick: () => setCancelled(ev, !ev.cancelled_at) }, ev.cancelled_at ? "Restore the event" : "Cancel the event"));
      if (buttons.childNodes.length) box.append(buttons);
      box.append(el("h4", {}, "Attendance (" + st.attendees.length + (ev.head_count != null ? " named, head count " + ev.head_count : "") + ")"));
      box.append(st.attendees.length ? el("ul", { class: "events-attendees" }, ...st.attendees.map((a) => el("li", { "data-kind": M().ATTENDEE_KIND(a) },
        el("span", {}, el("b", {}, a.name), el("small", {}, KIND[M().ATTENDEE_KIND(a)] + (a.note ? " · " + a.note : ""))),
        canWrite && !ev.cancelled_at ? el("button", { type: "button", class: "link", "aria-label": "Remove " + a.name, onclick: () => removeAttendee(a) }, "Remove") : null)))
        : el("p", { class: "events-empty-tab" }, "No names recorded." + (ev.head_count == null ? "" : " The head count is " + ev.head_count + ".")));
      if (canWrite && !ev.cancelled_at) box.append(attendeeForm(ev));
      return box;
    }
    function attendeeForm(ev) {
      const taken = new Set(st.attendees.map((a) => a.user_id || a.group_member_id).filter(Boolean));
      const who = el("select", { id: "attendee-who", "aria-label": "Who" }, el("option", { value: "" }, "Someone without a sign-in (type their name)"),
        (st.people || []).length ? el("optgroup", { label: "People with a sign-in" }, ...st.people.filter((p) => !taken.has(p.user_id)).map((p) => el("option", { value: "u:" + p.user_id, "data-name": p.name }, p.name))) : null,
        (st.register || []).length ? el("optgroup", { label: "Members" }, ...st.register.filter((b) => !taken.has(b.id)).map((b) => el("option", { value: "b:" + b.id, "data-name": b.business_name }, b.business_name + (b.member_number ? " (" + b.member_number + ")" : "")))) : null);
      const name = el("input", { id: "attendee-name", type: "text", maxlength: "200", autocomplete: "off" });
      const note = el("input", { id: "attendee-note", type: "text", maxlength: "200", placeholder: "For example: committee, regional council", autocomplete: "off" });
      const msg = el("p", { class: "events-msg", role: "status" });
      who.addEventListener("change", () => { const o = who.selectedOptions[0]; if (o?.dataset.name) name.value = o.dataset.name; });
      const form = el("form", { class: "events-attendee-form" }, el("h4", {}, "Add someone"),
        el("label", { for: "attendee-who" }, "Who"), who, el("label", { for: "attendee-name" }, "Name"), name, el("label", { for: "attendee-note" }, "Role or organisation (optional)"), note,
        el("button", { type: "submit", class: "primary" }, "Add"), msg,
        el("p", { class: "group-fine" }, "Names only: no phone numbers or emails are kept. People with a sign-in are listed once their sign-in has a name."));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!name.value.trim()) { msg.textContent = "Type their name."; return; }
        const [kind, id] = (who.value || ":").split(":");
        const row = { event_id: ev.id, name: name.value.trim(), note: note.value.trim() || null, ...(kind === "u" ? { user_id: id } : kind === "b" ? { group_member_id: id } : {}) };
        form.querySelector("button[type=submit]").disabled = true;
        const { data, error } = await sb.from("group_event_attendees").insert(row).select(ATT_COLS).single();
        if (error) { msg.textContent = "Couldn't add them: " + error.message; form.querySelector("button[type=submit]").disabled = false; return; }
        st.attendees = [...st.attendees, { org_id: group.id, ...row, ...(data || {}) }].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        draw(); document.getElementById("attendee-name")?.focus();
      });
      return form;
    }
    async function removeAttendee(a) {
      const { error } = await sb.from("group_event_attendees").delete().eq("id", a.id);
      if (error) st.notice = "Couldn't remove " + a.name + ": " + error.message;
      else st.attendees = st.attendees.filter((x) => x.id !== a.id);
      draw();
    }
    async function setCancelled(ev, cancel) {
      const { data, error } = await sb.from("group_events").update({ cancelled_at: cancel ? new Date().toISOString() : null }).eq("id", ev.id).select(COLS).single();
      if (error) { st.notice = "Couldn't " + (cancel ? "cancel" : "restore") + " the event: " + error.message; return draw(); }
      Object.assign(ev, data || { cancelled_at: cancel ? new Date().toISOString() : null });
      st.notice = cancel ? "The event is cancelled. It stays on record and can be restored." : "The event is restored.";
      draw();
    }

    // ---- the form ------------------------------------------------------------------------------------------------------------------
    function openForm(ev, date) {
      const f = M().toForm(ev);
      if (!ev && date) f.start_date = date;
      if (!ev) f.start_time = "";
      go("form", { current: ev, form: f, errors: [] });
    }
    function formScreen() {
      const ev = st.current, f = st.form;
      const field = (id, label, input, hint) => el("div", { class: "events-field", "data-field": id }, el("label", { for: "ev-" + id }, label), input, hint ? el("small", {}, hint) : null);
      const input = (id, attrs = {}) => { const i = el("input", { id: "ev-" + id, name: id, ...attrs }); i.value = f[id] ?? ""; i.addEventListener("input", () => { f[id] = i.value; }); return i; };
      const allDay = el("input", { id: "ev-all_day", type: "checkbox", ...(f.all_day ? { checked: true } : {}) });
      const times = [field("start_time", "Starts at", input("start_time", { type: "time" })), field("end_time", "Ends at", input("end_time", { type: "time" }))];
      allDay.addEventListener("change", () => { f.all_day = allDay.checked; for (const t of times) t.hidden = allDay.checked; });
      for (const t of times) t.hidden = !!f.all_day;
      const lat = input("latitude", { inputmode: "decimal", placeholder: "-43.5" }), lon = input("longitude", { inputmode: "decimal", placeholder: "172.6" });
      const topicBox = el("div", { class: "events-topics-edit" });
      const drawTopics = () => {
        const used = new Set(f.topics.map((t) => t.toLowerCase()));
        const suggest = M().topicSuggestions(st.events).filter((t) => !used.has(t.toLowerCase())).slice(0, 10);
        const add = el("input", { id: "ev-topic", type: "text", maxlength: "40", list: "ev-topic-list", placeholder: "Type a topic, then Add", autocomplete: "off" });
        const addIt = () => { const t = add.value.trim(); if (!t) return; f.topics = M().cleanTopics([...f.topics, t]); drawTopics(); topicBox.querySelector("#ev-topic")?.focus(); };
        add.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addIt(); } });
        topicBox.replaceChildren(
          // (UI1: no chips draws nothing; replaceChildren would print a null as the word "null")
          ...(f.topics.length ? [el("ul", { class: "events-topic-chips" }, ...f.topics.map((t) => el("li", {}, t, el("button", { type: "button", class: "link", "aria-label": "Remove topic " + t, onclick: () => { f.topics = f.topics.filter((x) => x !== t); drawTopics(); } }, "×"))))] : []),
          el("div", { class: "events-topic-add" }, add, el("button", { type: "button", class: "secondary", onclick: addIt }, "Add")),
          el("datalist", { id: "ev-topic-list" }, ...M().topicSuggestions(st.events).map((t) => el("option", { value: t }))),
          ...(suggest.length ? [el("p", { class: "events-suggest" }, el("small", {}, "Used before: "), ...suggest.map((t) => el("button", { type: "button", class: "events-suggestion", onclick: () => { f.topics = M().cleanTopics([...f.topics, t]); drawTopics(); } }, t)))] : []));
      };
      drawTopics();
      const notes = el("textarea", { id: "ev-notes", rows: "4", maxlength: "10000" }); notes.value = f.notes || ""; notes.addEventListener("input", () => { f.notes = notes.value; });
      const mapSlot = el("div", { class: "events-pick-map", hidden: true });
      const pick = typeof root.maplibregl === "object" || typeof root.maplibregl === "function"
        ? el("button", { type: "button", class: "link", "aria-expanded": "false", onclick: () => togglePick(mapSlot, pick, lat, lon, f) }, "Pick the point on a map") : null;
      const errors = el("div", { class: "events-errors", role: "alert" }, ...(st.errors || []).map((e) => el("p", {}, e)));
      const save = el("button", { type: "submit", class: "primary" }, ev ? "Save changes" : "Add the event");
      const form = el("form", { class: "events-form", novalidate: true },
        el("button", { type: "button", class: "link events-back", onclick: () => (ev ? go("event") : go("calendar")) }, ev ? "Back to the event" : "Back to the calendar"),
        el("h3", {}, ev ? "Edit the event" : "Add an event"), errors,
        field("title", "Title", input("title", { type: "text", maxlength: "200", required: true, autocomplete: "off" })),
        el("div", { class: "events-field events-check" }, allDay, el("label", { for: "ev-all_day" }, "All day")),
        el("div", { class: "events-row" }, field("start_date", "Date", input("start_date", { type: "date", required: true })), times[0]),
        el("div", { class: "events-row" }, field("end_date", "Ends on (if not the same day)", input("end_date", { type: "date" })), times[1]),
        el("p", { class: "group-fine" }, "New Zealand time."),
        field("place_name", "Place", input("place_name", { type: "text", maxlength: "200", placeholder: "For example: the ford on Ford Road", autocomplete: "off" })),
        el("fieldset", { class: "events-point" }, el("legend", {}, "Map point (optional)"), el("div", { class: "events-row" }, field("latitude", "Latitude", lat), field("longitude", "Longitude", lon)), pick, mapSlot),
        el("div", { class: "events-field", "data-field": "topics" }, el("label", { for: "ev-topic" }, "Topics"), topicBox),
        field("notes", "Notes", notes),
        field("head_count", "Head count (optional)", input("head_count", { type: "number", min: "0", step: "1", inputmode: "numeric" }), "For when names aren't recorded."),
        el("div", { class: "events-actions" }, save, el("button", { type: "button", class: "secondary", onclick: () => (ev ? go("event") : go("calendar")) }, "Cancel")));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { errors: problems, row } = M().toRow(f);
        if (problems.length) { st.errors = problems; draw(); return; }
        save.disabled = true;
        const q = ev ? sb.from("group_events").update(row).eq("id", ev.id) : sb.from("group_events").insert({ org_id: group.id, ...row });
        const { data, error } = await q.select(COLS).single();
        if (error) { st.errors = ["Couldn't save: " + error.message]; save.disabled = false; draw(); return; }
        const saved = { ...(ev || { org_id: group.id, created_by: person?.id || null }), ...row, ...(data || {}) };
        st.events = ev ? st.events.map((x) => (x.id === ev.id ? saved : x)) : [...st.events, saved];
        st.notice = ev ? "Saved." : "Added “" + saved.title + "”.";
        st.current = saved; st.attendees = ev ? st.attendees : [];
        if (!ev) openEvent(saved.id); else go("event");
      });
      return form;
    }
    // A small map to pick the point: a tap or click sets it (the latitude and longitude fields show it and can be typed instead).
    let pickMap = null;
    function togglePick(slot, button, lat, lon, f) {
      const open = slot.hidden;
      slot.hidden = !open; button.setAttribute("aria-expanded", String(open));
      if (!open) { pickMap?.remove(); pickMap = null; return; }
      const gl = root.maplibregl;
      try {
        gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js");
        const has = f.latitude !== "" && f.longitude !== "" && Number.isFinite(Number(f.latitude)) && Number.isFinite(Number(f.longitude));
        pickMap = new gl.Map({ container: slot, style: FP.basemaps.style("aerial"), ...(has ? { center: [Number(f.longitude), Number(f.latitude)], zoom: 13 } : { bounds: [[166.3, -47.4], [178.6, -34.3]] }),
          attributionControl: { compact: true } });
        let marker = has ? new gl.Marker().setLngLat([Number(f.longitude), Number(f.latitude)]).addTo(pickMap) : null;
        pickMap.on("click", (e) => {
          const p = e.lngLat;
          f.latitude = lat.value = p.lat.toFixed(6); f.longitude = lon.value = p.lng.toFixed(6);
          if (marker) marker.setLngLat(p); else marker = new gl.Marker().setLngLat(p).addTo(pickMap);
        });
      } catch { slot.replaceChildren(el("p", { class: "group-fine" }, "The map couldn't open here: type the latitude and longitude instead.")); }
    }

    // ---- export ----------------------------------------------------------------------------------------------------------------------
    function exportScreen() {
      const year = today().slice(0, 4);
      const from = el("input", { id: "export-from", type: "date", value: year + "-01-01" }), to = el("input", { id: "export-to", type: "date", value: year + "-12-31" });
      const msg = el("p", { class: "events-msg", role: "status" });
      const range = () => ({ a: from.value || "", b: to.value || "" });
      const count = () => { const { a, b } = range(); const n = M().inRange(st.events, a, b).length; msg.textContent = n === 1 ? "1 event in this range." : n + " events in this range."; return n; };
      from.addEventListener("change", count); to.addEventListener("change", count);
      const name = (what, ext) => { const { a, b } = range(); return M().fileName(group.name, what, a, b, ext); };
      const box = el("div", { class: "events-export" }, back(), el("h3", {}, "Export"),
        el("p", {}, "Download the group's events as a spreadsheet (CSV) or a calendar file that Outlook, Google Calendar and phones can open. Only what you can see here is included."),
        el("div", { class: "events-row" }, el("div", { class: "events-field" }, el("label", { for: "export-from" }, "From"), from), el("div", { class: "events-field" }, el("label", { for: "export-to" }, "To"), to)),
        msg,
        el("div", { class: "events-actions events-export-buttons" },
          el("button", { type: "button", class: "primary", "data-export": "events", onclick: () => { const { a, b } = range(); download(name("events", "csv"), M().eventsCsv(st.events, a, b), "text/csv;charset=utf-8"); } }, "Events (CSV)"),
          el("button", { type: "button", class: "secondary", "data-export": "attendance", onclick: async (e) => {
            const { a, b } = range(), evs = M().inRange(st.events, a, b);
            e.target.disabled = true; msg.textContent = "Reading the attendance…";
            try { download(name("attendance", "csv"), M().attendanceCsv(evs, await readAttendeesOf(sb, evs.map((x) => x.id)), a, b), "text/csv;charset=utf-8"); count(); }
            catch (err) { msg.textContent = "Couldn't read the attendance: " + (err?.message || err); }
            e.target.disabled = false;
          } }, "Attendance (CSV)"),
          el("button", { type: "button", class: "secondary", "data-export": "ics", onclick: () => { const { a, b } = range(); download(name("calendar", "ics"), M().ics(M().inRange(st.events, a, b), { name: group.name + " events", now: now() }), "text/calendar;charset=utf-8"); } }, "Calendar file (.ics)")),
        el("p", { class: "group-fine" }, "Times are New Zealand time. The events spreadsheet has the same columns the import takes, so it can be edited and imported again: a row keeps its id to update that event."));
      count();
      return box;
    }

    // ---- import ----------------------------------------------------------------------------------------------------------------------
    function importScreen() {
      const box = el("div", { class: "events-import" }, back(), el("h3", {}, "Import events"),
        el("p", {}, "Add or update events from a spreadsheet saved as CSV, in the columns of the template. You'll see what each row will do before anything is saved. At most " + M().MAX_IMPORT + " rows at a time."),
        el("ul", { class: "group-fine events-import-rules" },
          el("li", {}, "A row with an empty id is added as a new event. A row that keeps an event's id (from an export) updates that event."),
          el("li", {}, "Dates as 2026-10-14 or 14/10/2026; times as 09:30 or 9:30 am, New Zealand time. Topics are separated by semicolons."),
          el("li", {}, "Attendance and the cancelled column are not imported.")),
        el("p", {}, el("button", { type: "button", class: "link", "data-action": "template", onclick: () => download("events-template.csv", M().template(), "text/csv;charset=utf-8") }, "Download the template")));
      const file = el("input", { id: "import-file", type: "file", accept: ".csv,text/csv" });
      file.addEventListener("change", async () => {
        const f = file.files?.[0];
        if (!f) return;
        const text = await f.text();
        st.preview = { name: f.name, ...M().importPreview(text, st.events) };
        draw();
      });
      box.append(el("div", { class: "events-field" }, el("label", { for: "import-file" }, "Choose a CSV file"), file));
      if (st.preview) box.append(previewNode(st.preview));
      return box;
    }
    function previewNode(p) {
      const wrapP = el("div", { class: "events-preview", "data-state": p.error ? "error" : "ready" }, el("h4", {}, "Preview of " + p.name));
      if (p.error) { wrapP.append(el("p", { role: "alert" }, p.error)); return wrapP; }
      const c = p.counts, writes = c.add + c.update;
      wrapP.append(el("p", { class: "events-preview-counts" }, [c.add + " to add", c.update + " to update", c.same ? c.same + " unchanged" : null, c.reject ? c.reject + " rejected" : null].filter(Boolean).join(" · ") + "."));
      if (p.unknown?.length) wrapP.append(el("p", { class: "group-fine" }, "Columns not used: " + p.unknown.join(", ") + "."));
      wrapP.append(el("div", { class: "events-table-wrap" }, el("table", { class: "events-preview-table" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Line"), el("th", { scope: "col" }, "Event"), el("th", { scope: "col" }, "What happens"))),
        el("tbody", {}, ...p.rows.map((r) => el("tr", { "data-action": r.action }, el("td", {}, String(r.line)),
          el("td", {}, r.title || "(no title)", r.row ? el("small", {}, M().whenText(r.row)) : null),
          el("td", {}, el("b", {}, M().ACTION_TEXT[r.action]), r.reason ? el("small", {}, r.reason) : null)))))));
      const msg = el("p", { class: "events-msg", role: "status" });
      const confirm = el("button", { type: "button", class: "primary", "data-action": "confirm", ...(writes ? {} : { disabled: true }), onclick: () => runImport(p, confirm, msg) },
        writes ? "Import " + writes + (writes === 1 ? " event" : " events") : "Nothing to import");
      wrapP.append(el("div", { class: "events-actions" }, confirm, el("button", { type: "button", class: "secondary", onclick: () => go("import", { preview: null }) }, "Choose another file")), msg,
        c.reject ? el("p", { class: "group-fine" }, "Rejected rows are left out. Fix them in the spreadsheet and import the file again: rows already added would then be added twice, so remove those first or keep their ids from an export.") : null);
      return wrapP;
    }
    async function runImport(p, button, msg) {
      button.disabled = true; msg.textContent = "Saving…";
      const adds = p.rows.filter((r) => r.action === "add"), updates = p.rows.filter((r) => r.action === "update");
      let added = 0, updated = 0; const failed = [];
      for (let i = 0; i < adds.length; i += 100) {
        const part = adds.slice(i, i + 100);
        const { data, error } = await sb.from("group_events").insert(part.map((r) => ({ org_id: group.id, ...r.row }))).select("id");
        if (error) failed.push("Lines " + part[0].line + "–" + part[part.length - 1].line + ": " + error.message); else added += Array.isArray(data) ? data.length : part.length;
      }
      for (const r of updates) {
        const { error } = await sb.from("group_events").update(r.row).eq("id", r.id);
        if (error) failed.push("Line " + r.line + ": " + error.message); else updated++;
      }
      await reload();
      st.notice = "Imported: " + added + " added, " + updated + " updated." + (failed.length ? " Not saved: " + failed.join("; ") : "");
      go("calendar", { preview: null });
    }

    wrap.append(el("h2", {}, "Events"), el("p", { class: "group-status", role: "status" }, "Reading the group's events…"));
    // UI1: Add → Event (add.js) opens the new event form here, once the events are read (a writer only: the form is theirs)
    shown = { group: group.id, wrap, openNew: () => { if (canWrite) openForm(null, today()); }, openEvent: (id) => openEvent(id) };
    reload().then(() => {
      draw();
      if (pendingNew === group.id) { pendingNew = null; shown.wrap === wrap && shown.openNew(); }
      if (pendingEvent?.group === group.id) { const id = pendingEvent.id; pendingEvent = null; if (shown.wrap === wrap) shown.openEvent(id); }   // J2: from Home's search
    });
    return wrap;
  }
  // UI1: Add → Event. On the group's Events already: the form opens at once; anywhere else: Events opens, then the form.
  let shown = null, pendingNew = null, pendingEvent = null;
  function openNew(groupId) {
    if (shown?.group === groupId && shown.wrap.isConnected && shown.wrap.querySelector(".events-calendar, .events-form, .events-event, .events-export, .events-import")) { shown.openNew(); return; }
    pendingNew = groupId;
    root.location.hash = FP.href(G().href(groupId, "events"));
  }

  // J2: an event found by Home's search: Events opens at it (once its events are read; one not read just shows the calendar)
  function open(groupId, eventId) {
    if (shown?.group === groupId && shown.wrap.isConnected && shown.wrap.querySelector(".events-calendar, .events-event")) { shown.openEvent(eventId); return; }
    pendingEvent = { group: groupId, id: eventId };
    root.location.hash = FP.href(G().href(groupId, "events"));
  }

  FP.groupEvents = { view, readEvents, CAP, openNew, open };
})(typeof window === "undefined" ? globalThis : window);
