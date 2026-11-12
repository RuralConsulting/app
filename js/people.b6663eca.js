// PE1: a catchment group's People view (the start of a CRM): the directory of the businesses on the group's register and the
// people known to the group, a business's page, a person's page, the interaction log (log, edit, follow-ups, mark done), the
// people and business forms, and CSV exports for reporting. Personal information: only the group's facilitators, advisors and
// admins see the tab or read anything (public.crm_* and the PE1 tables, migration 20261112030000; the database decides, this
// file only stops asking). Every read and write is as the signed-in person. The words and the logic are in people-model.js.
// For the global Add button (UI1's registry): FP.groupPeople.addEntries, and the plain functions logInteraction(groupId) and
// addPerson(groupId), which open the log form or the person form from anywhere (route `/people/log`, `/people/add-person`).
// RV1: "To review" (route `/people/review`): questions about the register raised by RCL's tools for these same roles to answer when
// they can (review-items.js draws them; public.register_review_answer records the answer and applies nothing).
(function (root) {
  const FP = root.FP;
  const M = () => FP.peopleModel, G = () => FP.groupModel, R = () => FP.reviewItemsModel, RV = () => FP.reviewItems;   // RV1: review items
  const el = (...a) => FP.el(...a);
  const CAP = 2000;        // businesses and people read for a group (counted first)
  const PAGE = 100;        // feed rows read at a time (counted first)
  const EXPORT_CAP = 10000;
  const PERSON_COLS = "id,org_id,given_name,family_name,display_name,job_title,emails,phones,postal_address,physical_address,notes,user_id,source,archived_at,created_by,created_at,updated_at";

  async function rows(query) { const { data, error } = await query; if (error) throw error; return Array.isArray(data) ? data : []; }
  async function one(query) { const { data, error } = await query; if (error) throw error; return data ?? null; }
  async function counted(sb, table, org) {
    const head = await sb.from(table).select("id", { count: "exact", head: true }).eq("org_id", org);
    if (head.error) throw head.error;
    return typeof head.count === "number" ? Math.min(head.count, CAP) : CAP;
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), a = el("a", { href: url, download: name, hidden: true });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const message = (e) => e?.message || String(e);

  // RV1: the open review items per group, as People last read them this session (no read of its own): a small count on the People
  // tab, only when there are some. Drawn by group-space.js with the tabs, and kept up to date here when People reads or answers.
  const reviewOpen = new Map();
  function countBadge(groupId) {
    const n = reviewOpen.get(groupId) || 0;
    return n > 0 ? el("span", { class: "crm-badge due review-count", title: M().plural(n, "item", "items") + " to review" }, String(n)) : null;
  }
  function setReviewCount(groupId, n) {
    reviewOpen.set(groupId, n);
    const tab = typeof document === "undefined" ? null : document.querySelector('#group-nav a[data-tab="people"]');
    if (!tab) return;
    tab.querySelector(".review-count")?.remove();
    const badge = countBadge(groupId);
    if (badge) tab.append(badge);
  }

  // ---- the view ----------------------------------------------------------------------------------------------------------------------
  // opts: { sb, person: {id}, today: "YYYY-MM-DD", now: ISO instant, tab: null | "log" | "follow-ups" | "add-person" }
  function view(group, opts = {}) {
    const sb = opts.sb || FP.sb, me = opts.person?.id || null, g = group.id;
    const wrap = el("section", { class: "group-people", "data-view": "people" });
    if (!M().canSee(group.role)) {
      wrap.append(el("h2", {}, "People"), el("p", { class: "crm-empty" }, "People and interactions are kept for the group's facilitators, advisors and admins."));
      return wrap;
    }
    const today = () => String(opts.today || M().dayKey(Date.now())).slice(0, 10);
    const now = () => opts.now || new Date().toISOString();
    const st = { screen: "directory", stack: [], tab: "businesses", filters: { q: "", status: "current", label: "", due: false }, pq: "", archived: false,
      directory: [], people: [], team: [], failed: null, page: null, form: null, errors: [], notice: null,
      feed: { filters: { kinds: [], from: "", to: "", logger: "", followUp: "", topic: "" }, items: [], total: null, failed: null },
      // RV1: the register questions to review (public.proposals of kind register_review), the open one and its answer form
      review: { rows: [], failed: null, truncated: false, filter: "open", id: null, form: {}, busy: false } };
    const entryTab = opts.tab || null;

    async function loadLists() {
      try {
        const [nb, np] = await Promise.all([counted(sb, "group_members", g), counted(sb, "people", g)]);
        const [directory, people, team] = await Promise.all([
          rows(sb.rpc("crm_directory", { g, max_rows: nb })), rows(sb.rpc("crm_people", { g, max_rows: np })),
          rows(sb.rpc("crm_team", { g })).catch(() => []), loadReview()]);
        Object.assign(st, { directory, people, team, failed: null, truncated: nb >= CAP || np >= CAP });
      } catch (e) { st.failed = message(e); }
    }
    // RV1: counted first, then at most that many (newest first). Its own failure is said on its own screen, never the directory's.
    async function loadReview() {
      try {
        const head = await sb.from("proposals").select("id", { count: "exact", head: true }).eq("org_id", g).eq("kind", R().KIND).in("status", R().LISTED);
        if (head.error) throw head.error;
        const n = typeof head.count === "number" ? Math.min(head.count, R().CAP) : R().CAP;
        const got = n ? await rows(sb.from("proposals").select(R().COLUMNS).eq("org_id", g).eq("kind", R().KIND).in("status", R().LISTED)
          .order("created_at", { ascending: false }).limit(n)) : [];
        Object.assign(st.review, { rows: got, failed: null, truncated: typeof head.count === "number" && head.count > R().CAP });
        setReviewCount(g, R().openCount(R().items(got)));
      } catch (e) { st.review.failed = message(e); }
    }
    function draw() {
      const s = st.screen;
      RV().release();   // RV1: the item's map preview, if one was open
      const body = s === "business" ? businessScreen() : s === "person" ? personScreen() : s === "log" ? logScreen() : s === "person-form" ? personFormScreen()
        : s === "details-form" ? detailsFormScreen() : s === "feed" ? feedScreen() : s === "export" ? exportScreen()
        : s === "review" ? reviewScreen() : s === "review-item" ? reviewItemScreen() : directoryScreen();
      wrap.replaceChildren(el("h2", {}, "People"), ...(st.notice ? [el("p", { class: "crm-notice", role: "status" }, st.notice)] : []), body);
      st.notice = null;
    }
    // Screens stack: going forward remembers where the person was; back (and saving a form) returns there.
    function go(screen, extra = {}) { st.stack.push({ screen: st.screen, page: st.page }); Object.assign(st, { screen, errors: [] }, extra); draw(); wrap.scrollIntoView?.({ block: "start" }); }
    async function back(refresh = false) {
      const prev = st.stack.pop();
      if (!prev && entryTab && root.history?.length > 1) { root.history.back(); return; }
      Object.assign(st, prev || { screen: "directory", page: null }, { errors: [] });
      if (refresh) await refreshCurrent();
      draw();
    }
    async function refreshCurrent() {
      await loadLists();
      if (st.screen === "business" && st.page?.business) await openBusiness(st.page.business.id, false);
      else if (st.screen === "person" && st.page?.person) await openPerson(st.page.person.id, false);
      else if (st.screen === "feed") await readFeed(false);
    }

    // ---- RV1: review items (questions about the register that need someone who knows the farms) -------------------------------------
    const reviewLabel = () => "To review" + (st.review.failed ? "" : " (" + R().openCount(R().items(st.review.rows)) + ")");
    function openReview() { go("review"); }
    function reviewScreen() {
      return RV().listScreen({ all: R().items(st.review.rows), filter: st.review.filter, failed: st.review.failed, truncated: st.review.truncated,
        directory: st.directory, backButton, onFilter: (k) => { st.review.filter = k; draw(); },
        onOpen: (it) => { st.review.id = it.id; st.review.form = {}; go("review-item"); }, onMember: (id) => openBusiness(id) });
    }
    function reviewItemScreen() {
      const it = R().items(st.review.rows).find((x) => x.id === st.review.id);
      if (!it) return el("div", {}, backButton(), el("p", { class: "crm-empty" }, "This item is no longer listed."));
      return RV().itemScreen({ item: it, team: st.team, me, directory: st.directory, form: st.review.form, errors: st.errors, busy: st.review.busy,
        backButton, onMember: (id) => openBusiness(id), onAnswer: (form) => answerReview(it, form) });
    }
    async function answerReview(it, form) {
      st.review.form = form;
      const r = R().answerArgs(it, form);
      if (r.errors.length) { st.errors = r.errors; draw(); return; }
      st.errors = []; st.review.busy = true; draw();
      const { data, error } = await sb.rpc("register_review_answer", r.args);
      st.review.busy = false;
      if (error || !data) { st.errors = ["Couldn't save the answer: " + (error ? message(error) : "no reply") + "."]; draw(); return; }
      st.review.rows = st.review.rows.map((x) => (x.id === data.id ? data : x));
      setReviewCount(g, R().openCount(R().items(st.review.rows)));
      st.review.form = {};
      st.notice = "Answer saved. Nothing changes on the register by itself: RCL staff act on it.";
      draw();
    }
    const backButton = (label = "Back") => el("button", { type: "button", class: "link crm-back", onclick: () => back() }, label);

    // ---- the directory -----------------------------------------------------------------------------------------------------------
    function directoryScreen() {
      const box = el("div", { class: "crm-directory" });
      box.append(el("div", { class: "crm-actions" },
        el("button", { type: "button", class: "primary", "data-action": "log", onclick: () => openLog(null, []) }, "Log an interaction"),
        el("button", { type: "button", class: "secondary", "data-action": "add-person", onclick: () => openPersonForm(null, null) }, "Add a person"),
        el("button", { type: "button", class: "secondary", "data-action": "feed", onclick: () => openFeed({}) }, "Interactions"),
        el("button", { type: "button", class: "secondary", "data-action": "follow-ups", onclick: () => openFeed({ followUp: "open" }) }, "Follow-ups"),
        el("button", { type: "button", class: "secondary", "data-action": "review", onclick: () => openReview() }, reviewLabel()),
        el("button", { type: "button", class: "secondary", "data-action": "export", onclick: () => go("export") }, "Export")));
      if (st.failed) { box.append(el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the group's people just now: " + st.failed)); return box; }
      const tabs = el("div", { class: "crm-tabs", role: "tablist" }, ...[["businesses", "Businesses", M().searchDirectory(st.directory, { status: "current" }).length], ["people", "People", M().searchPeople(st.people).length]]
        .map(([k, label, n]) => el("button", { type: "button", role: "tab", "aria-selected": String(st.tab === k), onclick: () => { st.tab = k; draw(); } }, label + " (" + n + ")")));
      box.append(tabs);
      const list = el("div", { class: "crm-results" });
      const search = el("input", { id: "crm-search", type: "search", autocomplete: "off", placeholder: st.tab === "businesses" ? "Business, person, member number or label" : "Name, email, phone or business", "aria-label": "Search" });
      search.value = st.tab === "businesses" ? st.filters.q : st.pq;
      search.addEventListener("input", () => { if (st.tab === "businesses") st.filters.q = search.value; else st.pq = search.value; fill(); });
      box.append(el("div", { class: "crm-search" }, search));
      if (st.tab === "businesses") {
        const f = st.filters, chip = (label, pressed, on, attrs = {}) => el("button", { type: "button", class: "crm-chip", "aria-pressed": String(!!pressed), onclick: on, ...attrs }, label);
        box.append(el("div", { class: "crm-chips", role: "group", "aria-label": "Show" },
          ...[["current", "Current"], ["ended", "Ended"], ["all", "All"]].map(([k, label]) => chip(label, f.status === k, () => { f.status = k; draw(); }, { "data-status": k })),
          chip("Follow-up due", f.due, () => { f.due = !f.due; draw(); }, { "data-chip": "due" }),
          ...M().labels(st.directory).slice(0, 8).map(({ label }) => chip(label, f.label.toLowerCase() === label.toLowerCase(), () => { f.label = f.label === label ? "" : label; draw(); }, { "data-label": label }))));
      } else {
        const archived = el("input", { id: "crm-archived", type: "checkbox", ...(st.archived ? { checked: true } : {}) });
        archived.addEventListener("change", () => { st.archived = archived.checked; fill(); });
        box.append(el("div", { class: "crm-check" }, archived, el("label", { for: "crm-archived" }, "Show archived people")));
      }
      box.append(list);
      function fill() {
        if (st.tab === "businesses") {
          const shown = M().searchDirectory(st.directory, st.filters);
          list.replaceChildren(el("p", { class: "crm-count", role: "status" }, M().plural(shown.length, "business", "businesses")),
            shown.length ? el("ul", { class: "crm-list" }, ...shown.map(businessRow)) : el("p", { class: "crm-empty" }, st.directory.length ? "No business matches." : "The group's member register is empty."));
        } else {
          const shown = M().searchPeople(st.people, { q: st.pq, archived: st.archived });
          list.replaceChildren(el("p", { class: "crm-count", role: "status" }, M().plural(shown.length, "person", "people")),
            shown.length ? el("ul", { class: "crm-list" }, ...shown.map(personRow)) : el("p", { class: "crm-empty" }, st.people.length ? "Nobody matches." : "No people recorded yet. Add one, or import the Apptivo contacts."));
        }
      }
      fill();
      if (st.truncated) box.append(el("p", { class: "group-fine" }, "Only the first " + CAP.toLocaleString("en-NZ") + " are listed."));
      return box;
    }
    function businessRow(r) {
      const due = Number(r.due_follow_ups) || 0;
      return el("li", { class: "crm-row" + (r.ended_at ? " ended" : "") },
        el("button", { type: "button", "data-business": r.group_member_id, onclick: () => openBusiness(r.group_member_id) },
          el("span", { class: "crm-row-main" }, el("b", {}, r.business_name), r.ended_at ? el("span", { class: "crm-badge" }, "Ended") : null,
            due ? el("span", { class: "crm-badge due" }, M().plural(due, "follow-up", "follow-ups") + " due") : null),
          el("small", {}, ["Member " + r.member_number, r.primary_name || (r.people_count ? M().plural(r.people_count, "person", "people") : "No contact recorded"),
            r.last_interaction_at ? "Last contact " + M().ago(r.last_interaction_at, today()) : "No contact logged yet"].join(" · "))));
    }
    function personRow(p) {
      return el("li", { class: "crm-row" + (p.archived_at ? " ended" : "") },
        el("button", { type: "button", "data-person": p.person_id, onclick: () => openPerson(p.person_id) },
          el("span", { class: "crm-row-main" }, el("b", {}, p.display_name), p.archived_at ? el("span", { class: "crm-badge" }, "Archived") : null),
          el("small", {}, [p.job_title, (p.businesses || []).map((b) => b.business_name + (b.relationship ? " (" + b.relationship + ")" : "")).join(", ") || "No business",
            p.last_interaction_at ? "Last contact " + M().ago(p.last_interaction_at, today()) : "No contact logged yet"].filter(Boolean).join(" · "))));
    }

    // ---- a business ------------------------------------------------------------------------------------------------------------------
    async function openBusiness(id, push = true) {
      if (push) go("business", { page: { loading: true } });
      try {
        const page = await one(sb.rpc("crm_business", { b: id }));
        if (!page) throw new Error("not found, or not yours to read");
        st.page = page;
      } catch (e) { st.page = { failed: message(e) }; }
      if (push) draw();
    }
    function contactLines(d) {
      const out = [];
      for (const e of d?.emails || []) out.push(el("dt", {}, "Email"), el("dd", {}, el("a", { href: "mailto:" + e }, e)));
      for (const p of d?.phones || []) out.push(el("dt", {}, "Phone"), el("dd", {}, el("a", { href: "tel:" + p.replace(/[^\d+]/g, "") }, p)));
      if (d?.postal_address) out.push(el("dt", {}, "Postal"), el("dd", {}, d.postal_address));
      if (d?.physical_address) out.push(el("dt", {}, "Physical"), el("dd", {}, d.physical_address));
      return out;
    }
    function businessScreen() {
      const p = st.page || {};
      if (p.loading) return el("div", {}, backButton(), el("p", { class: "group-status", role: "status" }, "Reading the business…"));
      if (p.failed) return el("div", {}, backButton(), el("p", { role: "alert", class: "crm-failed" }, "Couldn't read this business: " + p.failed));
      const b = p.business, d = p.details || {}, people = p.people || [];
      const box = el("article", { class: "crm-page", "data-business": b.id }, backButton(),
        el("h3", {}, b.business_name, b.ended_at ? el("span", { class: "crm-badge" }, "Ended") : null),
        el("p", { class: "crm-sub" }, ["Member " + b.member_number, d.trading_name ? "trading as " + d.trading_name : null, d.status].filter(Boolean).join(" · ")),
        (d.labels || []).length ? el("ul", { class: "crm-labels" }, ...d.labels.map((l) => el("li", {}, l))) : null,
        el("div", { class: "crm-actions" },
          el("button", { type: "button", class: "primary", "data-action": "log", onclick: () => openLog(null, [{ kind: "business", id: b.id, name: b.business_name, member_number: b.member_number }]) }, "Log an interaction"),
          el("button", { type: "button", class: "secondary", "data-action": "edit-details", onclick: () => go("details-form", { form: M().detailsForm(p.details), target: b }) }, "Edit details"),
          el("button", { type: "button", class: "secondary", "data-action": "add-person", onclick: () => openPersonForm(null, b) }, "Add a person here")));
      const facts = contactLines(d);
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "Contact details"),
        facts.length ? el("dl", { class: "crm-facts" }, ...facts) : el("p", { class: "crm-empty" }, "No contact details recorded for the business."),
        d.notes ? el("p", { class: "crm-notes" }, d.notes) : null));
      const current = people.filter((x) => x.current), past = people.filter((x) => !x.current);
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "People (" + current.length + ")"),
        current.length ? el("ul", { class: "crm-people" }, ...current.map((x) => linkedPerson(x, b))) : el("p", { class: "crm-empty" }, "Nobody linked yet."),
        linkExisting(b, people),
        past.length ? el("details", { class: "crm-past" }, el("summary", {}, "Earlier (" + past.length + ")"), el("ul", { class: "crm-people" }, ...past.map((x) => linkedPerson(x, b)))) : null));
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "Interactions (" + p.interactions_total + ")"),
        timeline(p.interactions || [], p.interactions_total)));
      const links = [];
      if (p.held_files) links.push(el("a", { href: FP.href(G().href(g, "documents")) }, M().plural(Number(p.held_files), "file", "files") + " held for this member, in Files"));
      if (FP.groupManageModel?.showsLink?.(group.role) !== false) links.push(el("a", { href: FP.href(G().href(g, "manage", "members")) }, "Farm links and map extent, in Manage → Members"));
      // RV1: open register questions that name this member
      const asks = R().items(st.review.rows).filter((it) => it.open && it.members.includes(String(b.member_number))).length;
      if (asks) links.push(el("button", { type: "button", class: "link", "data-action": "review", onclick: () => openReview() }, M().plural(asks, "question to review names", "questions to review name") + " this member"));
      if (links.length) box.append(el("p", { class: "crm-quiet" }, ...links.flatMap((a, n) => (n ? [" · ", a] : [a]))));
      return box;
    }
    function linkedPerson(x, b) {
      return el("li", { "data-link": x.link_id },
        el("button", { type: "button", class: "crm-person", "data-person": x.person_id, onclick: () => openPerson(x.person_id) },
          el("span", { class: "crm-row-main" }, el("b", {}, x.display_name), x.is_primary ? el("span", { class: "crm-badge" }, "Primary") : null, x.archived ? el("span", { class: "crm-badge" }, "Archived") : null),
          el("small", {}, [x.relationship, x.job_title, (x.phones || [])[0], (x.emails || [])[0], x.current ? null : "until " + M().dateText(x.ended_on)].filter(Boolean).join(" · "))),
        x.current ? el("span", { class: "crm-link-actions" },
          x.is_primary ? null : el("button", { type: "button", class: "link", onclick: () => setLink(x.link_id, { is_primary: true }, "Primary contact set.") }, "Make primary"),
          el("button", { type: "button", class: "link", "aria-label": "End the link with " + x.display_name, onclick: () => setLink(x.link_id, { ended_on: today() }, x.display_name + " is no longer listed at " + b.business_name + " (kept under Earlier).") }, "No longer here")) : null);
    }
    function linkExisting(b, linked) {
      const have = new Set(linked.filter((x) => x.current).map((x) => x.person_id));
      const choices = M().searchPeople(st.people).filter((p) => !have.has(p.person_id));
      if (!choices.length) return null;
      const pick = el("select", { id: "link-person", "aria-label": "Someone already known" }, el("option", { value: "" }, "Someone already known…"), ...choices.map((p) => el("option", { value: p.person_id }, p.display_name)));
      const rel = el("input", { id: "link-relationship", type: "text", maxlength: "60", placeholder: "Relationship, for example accounts", autocomplete: "off", "aria-label": "Relationship" });
      const form = el("form", { class: "crm-link-form" }, pick, rel, el("button", { type: "submit", class: "secondary" }, "Link"));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!pick.value) return;
        const { error } = await sb.from("group_member_people").insert({ group_member_id: b.id, person_id: pick.value, relationship: rel.value.trim() || null });
        st.notice = error ? "Couldn't link them: " + error.message : "Linked.";
        await refreshCurrent(); draw();
      });
      return form;
    }
    async function setLink(id, values, done) {
      const { error } = await sb.from("group_member_people").update(values).eq("id", id);
      st.notice = error ? "Couldn't change the link: " + error.message : done;
      await refreshCurrent(); draw();
    }

    // ---- a person ----------------------------------------------------------------------------------------------------------------------
    async function openPerson(id, push = true) {
      if (push) go("person", { page: { loading: true } });
      try {
        const page = await one(sb.rpc("crm_person", { p: id }));
        if (!page) throw new Error("not found, or not yours to read");
        st.page = page;
      } catch (e) { st.page = { failed: message(e) }; }
      if (push) draw();
    }
    function personScreen() {
      const p = st.page || {};
      if (p.loading) return el("div", {}, backButton(), el("p", { class: "group-status", role: "status" }, "Reading the person…"));
      if (p.failed) return el("div", {}, backButton(), el("p", { role: "alert", class: "crm-failed" }, "Couldn't read this person: " + p.failed));
      const x = p.person, archived = !!x.archived_at, current = (p.businesses || []).filter((b) => b.current), past = (p.businesses || []).filter((b) => !b.current);
      const box = el("article", { class: "crm-page", "data-person": x.id }, backButton(),
        el("h3", {}, x.display_name, archived ? el("span", { class: "crm-badge" }, "Archived") : null),
        x.job_title ? el("p", { class: "crm-sub" }, x.job_title) : null);
      const actions = el("div", { class: "crm-actions" });
      if (!archived) actions.append(
        el("button", { type: "button", class: "primary", "data-action": "log", onclick: () => openLog(null, [{ kind: "person", id: x.id, name: x.display_name },
          ...current.filter((b) => b.is_primary || current.length === 1).map((b) => ({ kind: "business", id: b.group_member_id, name: b.business_name, member_number: b.member_number }))]) }, "Log an interaction"),
        el("button", { type: "button", class: "secondary", "data-action": "edit-person", onclick: () => openPersonForm(x, null) }, "Edit"));
      if (M().canArchive(group.role, x, me)) actions.append(el("button", { type: "button", class: "secondary", "data-action": archived ? "restore" : "archive", onclick: () => setArchived(x, !archived) }, archived ? "Restore" : "Archive"));
      box.append(actions);
      if (archived) box.append(el("p", { class: "group-fine" }, "Archived " + G().shortDate(x.archived_at) + ". An archived person stays on record with their interactions; restore them to change anything."));
      const facts = contactLines(x);
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "Contact details"),
        facts.length ? el("dl", { class: "crm-facts" }, ...facts) : el("p", { class: "crm-empty" }, "No contact details recorded."),
        x.notes ? el("p", { class: "crm-notes" }, x.notes) : null,
        x.user_id ? el("p", { class: "group-fine" }, "Has a sign-in to this platform.") : null,
        x.source && x.source !== "manual" ? el("p", { class: "group-fine" }, "First recorded from " + (x.source === "apptivo" ? "Apptivo" : x.source) + ".") : null));
      const bizItem = (b) => el("li", {}, el("button", { type: "button", class: "crm-person", "data-business": b.group_member_id, onclick: () => openBusiness(b.group_member_id) },
        el("span", { class: "crm-row-main" }, el("b", {}, b.business_name), b.is_primary ? el("span", { class: "crm-badge" }, "Primary") : null),
        el("small", {}, ["Member " + b.member_number, b.relationship, b.current ? null : "until " + M().dateText(b.ended_on)].filter(Boolean).join(" · "))));
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "Businesses (" + current.length + ")"),
        current.length ? el("ul", { class: "crm-people" }, ...current.map(bizItem)) : el("p", { class: "crm-empty" }, "Not linked to a business. Open a business and link them there."),
        past.length ? el("details", { class: "crm-past" }, el("summary", {}, "Earlier (" + past.length + ")"), el("ul", { class: "crm-people" }, ...past.map(bizItem))) : null));
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "Interactions (" + p.interactions_total + ")"), timeline(p.interactions || [], p.interactions_total)));
      return box;
    }
    async function setArchived(x, archive) {
      const { error } = await sb.from("people").update({ archived_at: archive ? new Date().toISOString() : null }).eq("id", x.id);
      st.notice = error ? "Couldn't " + (archive ? "archive" : "restore") + " them: " + error.message : archive ? x.display_name + " is archived. They stay on record and can be restored." : x.display_name + " is restored.";
      await refreshCurrent(); draw();
    }

    // ---- a timeline of interactions ---------------------------------------------------------------------------------------------------
    function timeline(items, total, by = "happened") {
      if (!items.length) return el("p", { class: "crm-empty" }, "No interactions logged yet.");
      const groups = M().groupByDay(items, today(), by);
      const box = el("div", { class: "crm-timeline" }, ...groups.map((d) => el("section", { class: "crm-day" }, el("h5", {}, d.label), el("ul", { class: "crm-items" }, ...d.items.map(itemNode)))));
      if (total > items.length) box.append(el("p", { class: "group-fine" }, "The newest " + items.length + " of " + total + " are shown here; Interactions lists them all."));
      return box;
    }
    function itemNode(it) {
      const fu = M().followUp(it, today()), mine = M().canArchive(group.role, it, me);
      const links = (it.links || []).map((l) => {
        const text = M().linkText(l);
        if (l.kind === "business" && l.group_member_id !== st.page?.business?.id) return el("button", { type: "button", class: "link", onclick: () => openBusiness(l.group_member_id) }, text);
        if (l.kind === "person" && l.person_id !== st.page?.person?.id) return el("button", { type: "button", class: "link", onclick: () => openPerson(l.person_id) }, text);
        return el("span", {}, text);
      });
      return el("li", { class: "crm-item" + (it.cancelled_at ? " cancelled" : ""), "data-interaction": it.id, "data-kind": it.kind },
        el("div", { class: "crm-item-head" }, el("b", {}, M().heading(it)), el("small", {}, M().whenText(it.happened_at)),
          it.cancelled_at ? el("span", { class: "crm-badge" }, "Cancelled") : null,
          fu ? el("span", { class: "crm-badge" + (fu === "due" ? " due" : "") }, M().FOLLOW_TEXT[fu] + " " + M().dateText(it.follow_up_on)) : null),
        it.subject ? el("p", { class: "crm-item-subject" }, it.subject) : null,
        (it.topics || []).length ? el("ul", { class: "crm-labels crm-topics" }, ...it.topics.map((t) => el("li", {}, t))) : null,
        it.summary ? el("p", { class: "crm-item-summary" }, it.summary) : null,
        el("p", { class: "crm-item-with" }, ...(links.length ? ["With ", ...links.flatMap((a, n) => (n ? [", ", a] : [a]))] : ["With nobody recorded"]), " · ", "Logged by " + M().loggedBy(it, st.team)),
        it.cancelled_at ? null : el("div", { class: "crm-item-actions" },
          fu === "due" || fu === "open" ? el("button", { type: "button", class: "secondary", "data-action": "done", onclick: () => markDone(it) }, "Mark done") : null,
          el("button", { type: "button", class: "link", "data-action": "edit", onclick: () => openLog(it, []) }, "Edit")),
        it.cancelled_at && mine ? el("div", { class: "crm-item-actions" }, el("button", { type: "button", class: "link", onclick: () => setCancelled(it, false) }, "Restore")) : null);
    }
    async function markDone(it) {
      const { error } = await sb.from("interactions").update({ follow_up_done_at: new Date().toISOString() }).eq("id", it.id);
      st.notice = error ? "Couldn't mark it done: " + error.message : "Follow-up marked done.";
      await refreshCurrent(); draw();
    }
    async function setCancelled(it, cancel) {
      const { error } = await sb.from("interactions").update({ cancelled_at: cancel ? new Date().toISOString() : null }).eq("id", it.id);
      st.notice = error ? "Couldn't " + (cancel ? "cancel" : "restore") + " it: " + error.message : cancel ? "Cancelled. It stays on record and can be restored." : "Restored.";
      return !error;
    }

    // ---- log an interaction --------------------------------------------------------------------------------------------------------------
    function openLog(it, preset) { go("log", { form: M().toForm(it, now(), preset), editing: it || null }); }
    function logScreen() {
      const f = st.form, it = st.editing;
      const seg = (name, choices, value, set) => el("div", { class: "crm-segments", role: "radiogroup", "aria-label": name, "data-field": name.toLowerCase() },
        ...choices.map(([k, label]) => el("button", { type: "button", role: "radio", "aria-checked": String(value === k), "data-value": k, onclick: () => { set(k); draw(); } }, label)));
      const input = (id, attrs = {}) => { const i = el("input", { id: "pe-" + id, name: id, ...attrs }); i.value = f[id] ?? ""; i.addEventListener("input", () => { f[id] = i.value; }); return i; };
      const field = (id, label, node, hint) => el("div", { class: "crm-field", "data-field": id }, el("label", { for: "pe-" + id }, label), node, hint ? el("small", {}, hint) : null);
      const quick = (id, choices) => el("div", { class: "crm-quick" }, ...choices.map(([v, label]) => el("button", { type: "button", class: "crm-chip", "aria-pressed": String(String(f[id]) === String(v)), onclick: () => { f[id] = String(v); draw(); } }, label)));
      // Who with: picked chips, and a search over the group's businesses and people.
      const picked = el("ul", { class: "crm-picked" }, ...f.links.map((l) => el("li", {}, M().linkText(l),
        el("button", { type: "button", class: "link", "aria-label": "Remove " + l.name, onclick: () => { f.links = f.links.filter((x) => !(x.kind === l.kind && x.id === l.id)); draw(); } }, "×"))));
      const results = el("ul", { class: "crm-who-results" });
      const who = el("input", { id: "pe-who", type: "search", autocomplete: "off", placeholder: "Search businesses and people" });
      const showResults = () => {
        const found = who.value.trim() ? M().whoWith(st.directory, st.people, who.value, f.links) : [];
        results.replaceChildren(...found.map((r) => el("li", {}, el("button", { type: "button", "data-who": r.kind + ":" + r.id, onclick: () => {
          f.links = [...f.links, { kind: r.kind, id: r.id, name: r.name, member_number: r.kind === "business" ? st.directory.find((x) => x.group_member_id === r.id)?.member_number : null }];
          draw(); document.getElementById("pe-who")?.focus();
        } }, el("b", {}, r.name), el("small", {}, (r.kind === "business" ? "Business · " : "Person · ") + r.note)))));
      };
      who.addEventListener("input", showResults);
      const summary = el("textarea", { id: "pe-summary", rows: "5", maxlength: "20000" }); summary.value = f.summary; summary.addEventListener("input", () => { f.summary = summary.value; });
      const errors = el("div", { class: "crm-errors", role: "alert" }, ...(st.errors || []).map((e) => el("p", {}, e)));
      const save = el("button", { type: "submit", class: "primary" }, it ? "Save changes" : "Save");
      const in7 = M().dayKey(Date.parse(today() + "T12:00:00Z") + 7 * 86400000), in30 = M().dayKey(Date.parse(today() + "T12:00:00Z") + 30 * 86400000);
      const form = el("form", { class: "crm-form crm-log", novalidate: true }, backButton(it ? "Back" : "Cancel"),
        el("h3", {}, it ? "Edit the interaction" : "Log an interaction"), errors,
        el("fieldset", {}, el("legend", {}, "What"), seg("Kind", M().KINDS, f.kind, (k) => { f.kind = k; })),
        M().DIRECTED.has(f.kind) ? el("fieldset", {}, el("legend", {}, "Direction"), seg("Direction", M().DIRECTIONS, f.direction, (k) => { f.direction = k; })) : null,
        el("div", { class: "crm-row-fields" }, field("date", "When", input("date", { type: "date", required: true })), field("time", "Time", input("time", { type: "time" }))),
        el("button", { type: "button", class: "link", onclick: () => { f.date = M().dayKey(now()); f.time = FP.eventsModel.timeKey(now()); draw(); } }, "Now"),
        field("duration", "How long (minutes, optional)", input("duration", { type: "number", min: "0", max: "10080", step: "1", inputmode: "numeric" })),
        quick("duration", [[5, "5 min"], [15, "15 min"], [30, "30 min"], [60, "1 hour"]]),
        el("div", { class: "crm-field", "data-field": "who" }, el("label", { for: "pe-who" }, "Who with"), picked, who, results),
        field("subject", "Subject", input("subject", { type: "text", maxlength: "300", autocomplete: "off" })),
        field("summary", "Summary", summary),
        field("topics", "Topics (optional)", input("topics", { type: "text", autocomplete: "off", list: "pe-topic-list" }), "Separated by commas, for example: FEP, nutrient budget."),
        el("datalist", { id: "pe-topic-list" }, ...M().topicsOf([...(st.page?.interactions || []), ...st.feed.items]).map((t) => el("option", { value: t }))),
        field("follow_up_on", "Follow up on (optional)", input("follow_up_on", { type: "date" })),
        quick("follow_up_on", [[in7, "In a week"], [in30, "In a month"], ["", "None"]]),
        el("p", { class: "group-fine" }, "New Zealand time. Only the group's facilitators, advisors and admins see this."),
        el("div", { class: "crm-save" }, save));
      if (it && M().canArchive(group.role, it, me)) form.append(el("p", {}, el("button", { type: "button", class: "link", "data-action": "cancel-interaction", onclick: async () => {
        if (await setCancelled(it, true)) back(true); else draw();
      } }, "Cancel this entry (it stays on record)")));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { errors: problems, fields, links } = M().toSave(f);
        if (problems.length) { st.errors = problems; draw(); return; }
        save.disabled = true;
        const { error } = await sb.rpc("crm_save_interaction", { g, fields, links, ...(it ? { interaction: it.id } : {}) });
        if (error) { st.errors = ["Couldn't save: " + error.message]; save.disabled = false; draw(); return; }
        st.notice = it ? "Saved." : "Logged.";
        await back(true);
      });
      return form;
    }

    // ---- a person: add or edit ------------------------------------------------------------------------------------------------------------
    function openPersonForm(x, business) { go("person-form", { form: M().personForm(x), target: { person: x, business } }); }
    function personFormScreen() {
      const f = st.form, { person: x, business: b } = st.target;
      const input = (id, attrs = {}) => { const i = el(attrs.rows ? "textarea" : "input", { id: "pf-" + id, name: id, ...attrs }); i.value = f[id] ?? ""; i.addEventListener("input", () => { f[id] = i.value; }); return i; };
      const field = (id, label, node, hint) => el("div", { class: "crm-field", "data-field": id }, el("label", { for: "pf-" + id }, label), node, hint ? el("small", {}, hint) : null);
      const errors = el("div", { class: "crm-errors", role: "alert" }, ...(st.errors || []).map((e) => el("p", {}, e)));
      const primary = el("input", { id: "pf-is_primary", type: "checkbox", ...(f.is_primary ? { checked: true } : {}) });
      primary.addEventListener("change", () => { f.is_primary = primary.checked; });
      const save = el("button", { type: "submit", class: "primary" }, x ? "Save changes" : "Add the person");
      const form = el("form", { class: "crm-form", novalidate: true }, backButton("Cancel"),
        el("h3", {}, x ? "Edit " + x.display_name : b ? "Add a person at " + b.business_name : "Add a person"), errors,
        el("div", { class: "crm-row-fields" }, field("given_name", "First name", input("given_name", { type: "text", maxlength: "100", autocomplete: "off" })),
          field("family_name", "Last name", input("family_name", { type: "text", maxlength: "100", autocomplete: "off" }))),
        field("display_name", "Name shown (optional)", input("display_name", { type: "text", maxlength: "200", autocomplete: "off" }), "Leave empty to use the first and last name."),
        field("job_title", "Job title or role", input("job_title", { type: "text", maxlength: "200", autocomplete: "off" })),
        b ? el("div", { class: "crm-row-fields" }, field("relationship", "Relationship to " + b.business_name, input("relationship", { type: "text", maxlength: "60", placeholder: "owner, manager, contact, accounts", autocomplete: "off" })),
          el("div", { class: "crm-check" }, primary, el("label", { for: "pf-is_primary" }, "Primary contact"))) : null,
        field("emails", "Emails", input("emails", { rows: "2", inputmode: "email" }), "One per line."),
        field("phones", "Phones", input("phones", { rows: "2", inputmode: "tel" }), "One per line."),
        field("postal_address", "Postal address", input("postal_address", { rows: "2" })),
        field("physical_address", "Physical address", input("physical_address", { rows: "2" })),
        field("notes", "Notes", input("notes", { rows: "3" })),
        el("div", { class: "crm-save" }, save));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { errors: problems, row, link } = M().toPerson(f);
        if (problems.length) { st.errors = problems; draw(); return; }
        save.disabled = true;
        const res = x ? await sb.from("people").update(row).eq("id", x.id).select("id").single() : await sb.from("people").insert({ org_id: g, ...row }).select("id").single();
        if (res.error) { st.errors = ["Couldn't save: " + res.error.message]; save.disabled = false; draw(); return; }
        if (!x && b) {
          const l = await sb.from("group_member_people").insert({ group_member_id: b.id, person_id: res.data.id, ...link });
          if (l.error) st.notice = "Added, but couldn't link them to " + b.business_name + ": " + l.error.message;
        }
        st.notice = st.notice || (x ? "Saved." : "Added " + (row.display_name || [row.given_name, row.family_name].filter(Boolean).join(" ")) + ".");
        await back(true);
      });
      return form;
    }

    // ---- a business's details ------------------------------------------------------------------------------------------------------------
    function detailsFormScreen() {
      const f = st.form, b = st.target, has = !!st.page?.details;
      const input = (id, attrs = {}) => { const i = el(attrs.rows ? "textarea" : "input", { id: "bd-" + id, name: id, ...attrs }); i.value = f[id] ?? ""; i.addEventListener("input", () => { f[id] = i.value; }); return i; };
      const field = (id, label, node, hint) => el("div", { class: "crm-field", "data-field": id }, el("label", { for: "bd-" + id }, label), node, hint ? el("small", {}, hint) : null);
      const errors = el("div", { class: "crm-errors", role: "alert" }, ...(st.errors || []).map((e) => el("p", {}, e)));
      const save = el("button", { type: "submit", class: "primary" }, "Save");
      const form = el("form", { class: "crm-form", novalidate: true }, backButton("Cancel"), el("h3", {}, "Details of " + b.business_name), errors,
        el("p", { class: "group-fine" }, "The business's name and member number are the group's register (Manage → Members); these are the extra details."),
        field("trading_name", "Trading name", input("trading_name", { type: "text", maxlength: "200", autocomplete: "off" })),
        field("emails", "Emails", input("emails", { rows: "2" }), "One per line."),
        field("phones", "Phones", input("phones", { rows: "2" }), "One per line."),
        field("postal_address", "Postal address", input("postal_address", { rows: "2" })),
        field("physical_address", "Physical address", input("physical_address", { rows: "2" })),
        field("labels", "Labels", input("labels", { type: "text", autocomplete: "off" }), "Separated by commas, for example: dairy, riparian, committee."),
        field("status", "Status", input("status", { type: "text", maxlength: "60", autocomplete: "off" })),
        field("notes", "Notes", input("notes", { rows: "3" })),
        el("div", { class: "crm-save" }, save));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { errors: problems, row } = M().toDetails(f);
        if (problems.length) { st.errors = problems; draw(); return; }
        save.disabled = true;
        const { error } = has ? await sb.from("group_member_details").update(row).eq("group_member_id", b.id) : await sb.from("group_member_details").insert({ group_member_id: b.id, ...row });
        if (error) { st.errors = ["Couldn't save: " + error.message]; save.disabled = false; draw(); return; }
        st.notice = "Saved.";
        await back(true);
      });
      return form;
    }

    // ---- the feed and follow-ups ------------------------------------------------------------------------------------------------------------
    async function readFeed(more) {
      const feed = st.feed, args = M().feedArgs(g, feed.filters);
      try {
        if (!more) { feed.total = Number(await one(sb.rpc("crm_feed_count", args))) || 0; feed.items = []; }
        const left = Math.max(0, feed.total - feed.items.length);
        if (left) feed.items = [...feed.items, ...await rows(sb.rpc("crm_feed", { ...args, max_rows: Math.min(left, PAGE), row_offset: feed.items.length }))];
        feed.failed = null;
      } catch (e) { feed.failed = message(e); }
    }
    async function openFeed(filters) {
      st.feed.filters = { kinds: [], from: "", to: "", logger: "", followUp: "", topic: "", ...filters };
      go("feed", { page: null });
      wrap.querySelector(".crm-feed-list")?.replaceChildren(el("p", { class: "group-status" }, "Reading…"));
      await readFeed(false); draw();
    }
    function feedScreen() {
      const feed = st.feed, f = feed.filters, followUps = f.followUp === "open" || f.followUp === "due";
      const change = async () => { await readFeed(false); draw(); };
      const kinds = el("div", { class: "crm-chips", role: "group", "aria-label": "Kinds" }, ...M().KINDS.map(([k, label]) =>
        el("button", { type: "button", class: "crm-chip", "aria-pressed": String(f.kinds.includes(k)), "data-kind": k, onclick: () => { f.kinds = f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k]; change(); } }, label)));
      const from = el("input", { id: "feed-from", type: "date", value: f.from }), to = el("input", { id: "feed-to", type: "date", value: f.to });
      from.addEventListener("change", () => { f.from = from.value; change(); }); to.addEventListener("change", () => { f.to = to.value; change(); });
      const logger = el("select", { id: "feed-logger" }, el("option", { value: "" }, "Anyone"), ...st.team.filter((m) => M().canSee(m.role)).map((m) => el("option", { value: m.user_id, ...(f.logger === m.user_id ? { selected: true } : {}) }, m.name || "A member without a name")));
      logger.addEventListener("change", () => { f.logger = logger.value; change(); });
      const topic = el("input", { id: "feed-topic", type: "search", value: f.topic || "", list: "feed-topic-list", autocomplete: "off", placeholder: "Any topic" });
      topic.addEventListener("change", () => { f.topic = topic.value.trim(); change(); });
      const fu = el("div", { class: "crm-tabs", role: "tablist", "aria-label": "Follow-ups" }, ...M().FOLLOW_UPS.map(([k, label]) =>
        el("button", { type: "button", role: "tab", "aria-selected": String(f.followUp === k), "data-follow-up": k, onclick: () => { f.followUp = k; change(); } }, k ? (k === "open" ? "Follow-ups" : label) : "Everything")));
      const box = el("div", { class: "crm-feed" }, backButton(), el("h3", {}, followUps ? "Follow-ups" : "Interactions"),
        el("div", { class: "crm-actions" }, el("button", { type: "button", class: "primary", "data-action": "log", onclick: () => openLog(null, []) }, "Log an interaction")),
        fu, kinds,
        el("div", { class: "crm-row-fields crm-filters" },
          el("div", { class: "crm-field" }, el("label", { for: "feed-from" }, "From"), from), el("div", { class: "crm-field" }, el("label", { for: "feed-to" }, "To"), to),
          el("div", { class: "crm-field" }, el("label", { for: "feed-logger" }, "Logged by"), logger),
          el("div", { class: "crm-field" }, el("label", { for: "feed-topic" }, "Topic"), topic,
            el("datalist", { id: "feed-topic-list" }, ...M().topicsOf(feed.items).map((t) => el("option", { value: t }))))));
      const list = el("div", { class: "crm-feed-list" });
      if (feed.failed) list.append(el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the interactions just now: " + feed.failed));
      else {
        list.append(el("p", { class: "crm-count", role: "status" }, feed.total == null ? "Reading…" : M().plural(feed.total, "interaction", "interactions") + (followUps ? ", soonest due first" : ", newest first")));
        if (feed.items.length) list.append(timeline(feed.items, feed.items.length, followUps ? "follow_up" : "happened"));
        else if (feed.total === 0) list.append(el("p", { class: "crm-empty" }, followUps ? "No follow-ups waiting." : "Nothing logged for these filters."));
        if (feed.total > feed.items.length) list.append(el("button", { type: "button", class: "secondary", "data-action": "more", onclick: async () => { await readFeed(true); draw(); } },
          "Show " + Math.min(PAGE, feed.total - feed.items.length) + " more"));
      }
      box.append(list);
      return box;
    }

    // ---- export ----------------------------------------------------------------------------------------------------------------------
    async function readRange(from, to) {
      const args = M().feedArgs(g, { from, to }), total = Math.min(Number(await one(sb.rpc("crm_feed_count", args))) || 0, EXPORT_CAP), out = [];
      while (out.length < total) {
        const page = await rows(sb.rpc("crm_feed", { ...args, max_rows: Math.min(1000, total - out.length), row_offset: out.length }));
        if (!page.length) break;
        out.push(...page);
      }
      return out;
    }
    function exportScreen() {
      const year = today().slice(0, 4);
      const from = el("input", { id: "crm-export-from", type: "date", value: year + "-01-01" }), to = el("input", { id: "crm-export-to", type: "date", value: today() });
      const msg = el("p", { class: "crm-msg", role: "status" });
      const run = (what) => async (e) => {
        const a = from.value || "", b = to.value || "";
        e.target.disabled = true; msg.textContent = "Reading the interactions…";
        try {
          const items = await readRange(a, b);
          download(M().fileName(group.name, what, a, b), what === "directory" ? M().directoryCsv(st.directory, items) : M().feedCsv(items, st.team));
          msg.textContent = what === "directory" ? M().plural(st.directory.length, "business", "businesses") + " exported." : M().plural(items.length, "interaction", "interactions") + " exported.";
        } catch (err) { msg.textContent = "Couldn't export: " + message(err); }
        e.target.disabled = false;
      };
      return el("div", { class: "crm-export" }, backButton(), el("h3", {}, "Export for reporting"),
        el("p", {}, "Download a spreadsheet (CSV) for a date range: the directory of businesses with how many interactions each had in the range, or every interaction in the range with who it was with."),
        el("div", { class: "crm-row-fields" }, el("div", { class: "crm-field" }, el("label", { for: "crm-export-from" }, "From"), from),
          el("div", { class: "crm-field" }, el("label", { for: "crm-export-to" }, "To"), to)),
        el("div", { class: "crm-actions" },
          el("button", { type: "button", class: "primary", "data-export": "directory", onclick: run("directory") }, "Directory (CSV)"),
          el("button", { type: "button", class: "secondary", "data-export": "interactions", onclick: run("interactions") }, "Interactions (CSV)")),
        msg,
        el("p", { class: "group-fine" }, "New Zealand dates. Cancelled entries are left out. A cell that starts with = + - or @ is written with an apostrophe in front, so a spreadsheet shows it as text. These files hold personal information: keep them where the group's records are kept."));
    }

    wrap.append(el("h2", {}, "People"), el("p", { class: "group-status", role: "status" }, "Reading the group's people…"));
    loadLists().then(() => {
      // From the Add button or an address: the form opens on its own, and Back or Save returns to where the person was
      if (entryTab === "log") openLog(null, []);
      else if (entryTab === "add-person") openPersonForm(null, null);
      else if (entryTab === "follow-ups") openFeed({ followUp: "open" });
      else if (entryTab === "review") openReview();   // RV1
      else return draw();
      st.stack = [];
    });
    return wrap;
  }

  // ---- entry points for the global Add button (UI1) ---------------------------------------------------------------------------------
  const go = (groupId, tab) => { root.location.hash = FP.href(G().href(groupId, "people", tab)); };
  const logInteraction = (groupId) => go(groupId, "log");
  const addPerson = (groupId) => go(groupId, "add-person");
  // Each: { key, label, shows(group) (the person's role allows it), run(group) }.
  const addEntries = [
    { key: "interaction", label: "Log an interaction", shows: (group) => M().canSee(group?.role), run: (group) => logInteraction(group.id) },
    { key: "person", label: "Add a person", shows: (group) => M().canSee(group?.role), run: (group) => addPerson(group.id) },
  ];

  FP.groupPeople = { view, logInteraction, addPerson, addEntries, CAP, PAGE, countBadge };
})(typeof window === "undefined" ? globalThis : window);
