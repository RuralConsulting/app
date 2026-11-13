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
  const MM = () => FP.membershipModel, MS = () => FP.membership;   // M1b: membership and the group's own fields
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
    if (!tab) { if (typeof document !== "undefined") FP.spaceNav?.refresh(document.querySelector("#group-nav")); return; }   // UI2: under More: its dot
    tab.querySelector(".review-count")?.remove();
    const badge = countBadge(groupId);
    if (badge) tab.append(badge);
  }

  // PF1: the lists People reads (counted first): the directory as soon as it is in, the people and the team after it.
  function readLists(sb, g) {
    const nb = counted(sb, "group_members", g), np = counted(sb, "people", g);
    const lists = {
      directory: nb.then((n) => rows(sb.rpc("crm_directory", { g, max_rows: n }))),
      people: np.then((n) => rows(sb.rpc("crm_people", { g, max_rows: n }))),
      team: rows(sb.rpc("crm_team", { g })).catch(() => []),
      truncated: Promise.all([nb, np]).then(([a, b]) => a >= CAP || b >= CAP),
      review: readReview(sb, g),
    };
    for (const p of Object.values(lists)) p.catch(() => {});   // each is awaited by the view; none is left unhandled
    return lists;
  }
  // RV1: the open review items, counted first, then at most that many (newest first). Never fails: a failure is its answer.
  async function readReview(sb, g) {
    try {
      const head = await sb.from("proposals").select("id", { count: "exact", head: true }).eq("org_id", g).in("kind", R().KINDS).in("status", R().LISTED);
      if (head.error) throw head.error;
      const n = typeof head.count === "number" ? Math.min(head.count, R().CAP) : R().CAP;
      const got = n ? await rows(sb.from("proposals").select(R().COLUMNS).eq("org_id", g).in("kind", R().KINDS).in("status", R().LISTED)
        .order("created_at", { ascending: false }).limit(n)) : [];
      return { rows: got, failed: null, truncated: typeof head.count === "number" && head.count > R().CAP };
    } catch (e) { return { rows: [], failed: message(e), truncated: false }; }
  }
  // PF1: one read per opening. A second view of the same group made while the first read is still on its way (the route drawn
  // again as the app starts) shares that read instead of asking the database twice. A refresh after a change always reads afresh.
  let opening = null;
  function openingLists(sb, g) {
    if (opening && opening.sb === sb && opening.g === g) return opening.lists;
    const lists = readLists(sb, g), mine = { sb, g, lists };
    opening = mine;
    const done = () => { if (opening === mine) opening = null; };
    Promise.allSettled(Object.values(lists)).then(done);
    return lists;
  }
  const FIRST = 60;        // rows drawn at once; the rest on the next frame
  const later = (f) => (typeof root.requestAnimationFrame === "function" ? root.requestAnimationFrame(f) : setTimeout(f, 0));

  // ---- the view ----------------------------------------------------------------------------------------------------------------------
  // opts: { sb, person: {id}, today: "YYYY-MM-DD", now: ISO instant, tab: null | "log" | "follow-ups" | "add-person" }
  function view(group, opts = {}) {
    const sb = opts.sb || FP.sb, me = opts.person?.id || null, g = group.id;
    // SG2: in a sub-group, one of its parent's facilitators, advisors or admins (who does not hold that role here) sees its members (subgroups.js)
    if (!M().canSee(group.role) && M().isSubgroup(group) && M().canSee(opts.parent?.role) && FP.subgroups) return FP.subgroups.view(group, opts);
    const wrap = el("section", { class: "group-people", "data-view": "people", "data-group": group.id });
    if (!M().canSee(group.role)) {
      wrap.append(el("h2", {}, "People"), el("p", { class: "crm-empty" }, "People and interactions are kept for the group's facilitators, advisors and admins."));
      return wrap;
    }
    const today = () => String(opts.today || M().dayKey(Date.now())).slice(0, 10);
    const now = () => opts.now || new Date().toISOString();
    const st = { screen: "directory", stack: [], tab: "businesses", filters: { q: String(opts.q || ""), status: "current", label: "", labels: [], due: false, types: [], fieldf: {}, sub: null }, pq: "", archived: false, sort: { by: null, dir: 1 },
      // M1b: the group's own fields and membership types (read with the lists), and other contacts (read when first shown)
      defs: { fields: [], types: [], years: [], agreements: [], failed: null }, contacts: { rows: null, failed: null, q: "" },
      directory: [], people: [], team: [], failed: null, loading: "all", page: null, form: null, errors: [], notice: null,
      feed: { filters: { kinds: [], from: "", to: "", logger: "", followUp: "", topic: "" }, items: [], total: null, failed: null },
      // RV1: the register questions to review (public.proposals of kind register_review), the open one and its answer form
      review: { rows: [], failed: null, truncated: false, filter: "open", id: null, form: {}, busy: false },
      // SG2: the directory's Sub-group filter (read when first opened) and, in a sub-group, its businesses (read once)
      sg: { open: false, loading: false, counts: null, index: null, failed: null, truncated: false, chosen: [] }, roster: null };
    const entryTab = opts.tab || null;
    let fills = 0;

    // opening: the first read (shared, see openingLists), drawn in two steps: the businesses as soon as they are in, then the rest.
    async function loadLists(opening = false) {
      const lists = opening ? openingLists(sb, g) : readLists(sb, g);
      // M1b and M2: the fields and types, the subscription years and agreements (never fail: a failure is said on the list)
      const defs = FP.membership ? Promise.all([FP.membership.readDefinitions(sb, g), FP.membership.readM2(sb, g)])
        .then(([a, b]) => ({ ...a, years: b.years, agreements: b.agreements, failed: [a.failed, b.failed].filter(Boolean).join("; ") || null })) : Promise.resolve(st.defs);
      try {
        const directory = await lists.directory;
        st.defs = await defs;
        if (opening) { Object.assign(st, { directory, failed: null, loading: "people" }); redrawDirectory(); }
        const [people, team, truncated, review] = await Promise.all([lists.people, lists.team, lists.truncated, lists.review]);
        Object.assign(st, { directory, people, team, failed: null, truncated, loading: null });
        if (st.contacts.rows) st.contacts.rows = null;   // M1b: read again when next shown
        takeReview(review);
      } catch (e) { Object.assign(st, { failed: message(e), loading: null }); }
    }
    // Draws the directory again (when it is the screen shown), keeping the place in the search box.
    function redrawDirectory() {
      if (st.screen !== "directory") return;
      const a = root.document?.activeElement, id = a && wrap.contains(a) ? a.id : null;
      const at = id && typeof a.selectionStart === "number" ? a.selectionStart : null;
      draw();
      const n = id ? wrap.querySelector("#" + id) : null;
      if (n) { n.focus(); if (at != null) try { n.setSelectionRange(at, at); } catch { /* not a text field */ } }
    }
    // RV1: the review items read with the lists (readReview); their own failure is said on their own screen, never the directory's.
    function takeReview(r) {
      Object.assign(st.review, r);
      if (!r.failed) setReviewCount(g, R().openCount(R().items(r.rows)));
    }
    function draw() {
      const s = st.screen;
      RV().release();   // RV1: the item's map preview, if one was open
      const body = s === "business" ? businessScreen() : s === "person" ? personScreen() : s === "log" ? logScreen() : s === "person-form" ? personFormScreen()
        : s === "details-form" ? detailsFormScreen() : s === "feed" ? feedScreen() : s === "export" ? exportScreen()
        : s === "review" ? reviewScreen() : s === "review-item" ? reviewItemScreen() : s === "fields" ? fieldsScreen() : s === "sub-settings" ? subSettingsScreen() : directoryScreen();
      // UI2: on the directory the title row carries the one primary action and a "…" menu for the quieter ones
      // M1b: add a contact; copy the email addresses or download the list of the members shown; the admins' Fields and types
      const title = s === "directory" ? el("div", { class: "crm-titlebar" }, el("h2", {}, "People"),
        el("div", { class: "crm-title-actions" },
          el("button", { type: "button", class: "primary", "data-action": "log", onclick: () => openLog(null, []) }, "Log an interaction"),
          FP.sheet.moreButton("More actions", [
            { label: "Add a person", icon: "person", action: "add-person", run: () => openPersonForm(null, null) },
            { label: "Add a contact", hint: "Someone the group works with who is not a member", icon: "person", action: "add-contact", run: () => openPersonForm(null, null, true) },
            { label: "Copy email addresses", hint: "Of the members shown, for your own email program", icon: "note", action: "copy-emails", run: () => copyEmails() },
            { label: "Download list", hint: "The members shown, as a spreadsheet", icon: "download", action: "download-list", run: () => downloadList() },
            // M2: the members shown marked invoiced or paid for one year, at once
            ...(FP.membership ? [{ label: "Mark invoiced or paid", hint: "The members shown, for one subscription year", icon: "note", action: "mark-subscriptions", run: () => openMark() }] : []),
            { label: "Export", hint: "A spreadsheet for reporting", icon: "download", action: "export", run: () => go("export") },
            ...(FP.membership && FP.membershipModel?.canDefine(group.role) ? [{ label: "Fields and types", hint: "The group's own fields and membership types", icon: "manage", action: "fields", run: () => go("fields") },
              { label: "Subscriptions and agreements", hint: "The group's subscription years and agreements", icon: "manage", action: "sub-settings", run: () => go("sub-settings") }] : [])]))) : el("h2", {}, "People");
      wrap.replaceChildren(title, ...(st.notice ? [el("p", { class: "crm-notice", role: "status", tabindex: "-1" }, st.notice)] : []), body);
      st.notice = null;
    }
    // Screens stack: going forward remembers where the person was; back (and saving a form) returns there.
    // PF1: a screen that has an address (people/review, people/log, people/add-person, people/follow-ups) is entered by changing the
    // address when the person asks for it here; group-space.js then hands the address to this same view (route below), which opens
    // the screen and remembers that it came with an address, so Back (here or the browser's) returns to where the person was.
    let byAddress = false;
    function go(screen, extra = {}) {
      st.stack.push({ screen: st.screen, page: st.page, address: byAddress }); byAddress = false;
      Object.assign(st, { screen, errors: [] }, extra); draw(); wrap.scrollIntoView?.({ block: "start" });
    }
    const SCREEN_OF = { review: ["review", "review-item"], log: ["log"], "add-person": ["person-form"], "add-contact": ["person-form"], "follow-ups": ["feed"] };
    function route(tab) {
      if (!tab) {   // the bare People address: back to the screen the last address was opened from
        const i = st.stack.map((f) => f.address).lastIndexOf(true);
        if (i < 0) return;
        Object.assign(st, st.stack[i], { errors: [] }); st.stack.length = i; draw();
        return;
      }
      if (SCREEN_OF[tab]?.includes(st.screen)) return;
      byAddress = true;
      if (tab === "review") openReviewHere(); else if (tab === "log") openLog(null, []); else if (tab === "add-person") openPersonForm(null, null);
      else if (tab === "add-contact") openPersonForm(null, null, true);   // M1b
      else if (tab === "follow-ups") openFeed({ followUp: "open" });
      byAddress = false;
    }
    async function back(refresh = false) {
      if (st.stack.at(-1)?.address && root.history?.length > 1) { root.history.back(); return; }   // the address goes back with the screen
      const prev = st.stack.pop(), leaving = st.screen;
      // M2 (#522 review): back from the group's settings (years, agreements, fields) to a member's page: that page is read again, so what
      // was just added there shows (the first years and agreements are added from a member's empty state)
      if ((leaving === "sub-settings" || leaving === "fields") && prev?.screen === "business" && prev.page?.business && !refresh) {
        Object.assign(st, prev, { errors: [] });
        await openBusiness(prev.page.business.id, false);
        draw();
        return;
      }
      if (!prev && opts.onBack) { opts.onBack(); return; }   // SG2: opened on one business from a sub-group's list
      if (!prev && entryTab && root.history?.length > 1) { root.history.back(); return; }
      // opened from an address with nowhere to go back to: the directory, and the address with it (no new step in the history)
      if (!prev && entryTab && FP.href && root.history?.replaceState) root.history.replaceState(null, "", FP.href(G().href(g, "people")));
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
    const reviewLabel = () => "To review" + (st.review.failed ? "" : " (" + (st.loading ? "…" : R().openCount(R().items(st.review.rows))) + ")");
    // PF1: the list has an address (people/review): asking for it here changes the address, and the view opens it from there
    function openReview() {
      const to = FP.href?.(G().href(g, "people", "review"));
      if (to && root.location && wrap.isConnected) root.location.hash = to; else openReviewHere();
    }
    function openReviewHere() { go("review"); }
    function reviewScreen() {
      if (st.loading) return el("div", { class: "rv-list", "data-view": "review", "aria-busy": "true" }, backButton("Back to People"), el("h3", {}, "To review"),
        el("p", { class: "crm-count", role: "status" }, "Reading the items to review…"));
      return RV().listScreen({ all: R().items(st.review.rows), filter: st.review.filter, q: st.review.q || "", onSearch: (q) => { st.review.q = q; }, failed: st.review.failed, truncated: st.review.truncated,
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
    // UI2 (Attio's list first): one switch for the views, the search with one Filter button (its choices shown as small removable
    // chips), then the list: a table on a computer (sortable columns, the header stays), compact rows on a phone.
    function directoryScreen() {
      const box = el("div", { class: "crm-directory" });
      const waiting = (k) => st.loading === "all" || (st.loading === "people" && k === "people");
      const count = (k) => (waiting(k) ? "…" : k === "businesses" ? M().searchDirectory(st.directory, { status: "current" }).length : M().searchPeople(st.people).length);
      const view = (label, attrs, on) => el("button", { type: "button", ...attrs, ...(on ? { "aria-current": "true" } : {}) }, label);
      // the two lists as one switch (Members | People); the interaction log, follow-ups and To review (with its count) as one quiet row.
      // PH3: on a phone all of these sit behind one quiet control (the list shown, with its count), opened in place as plain rows; the
      // A to Z jump beside it for a long list. A computer shows them openly, as before.
      const shownLabel = st.tab === "businesses" ? "Members (" + count("businesses") + ")" : st.tab === "people" ? "People (" + count("people") + ")"
        : "Contacts" + (st.contacts.rows ? " (" + MM().searchContacts(st.contacts.rows).length + ")" : "");
      const nav = el("nav", { class: "crm-views", "aria-label": "People views" });
      const toggle = el("button", { type: "button", class: "crm-views-toggle", "aria-expanded": "false", "aria-controls": "crm-views-panel",
        onclick: () => { const open = nav.classList.toggle("open"); toggle.setAttribute("aria-expanded", String(open)); } },
        el("span", {}, shownLabel), FP.icon("down", 16));
      const jump = el("button", { type: "button", class: "crm-jump", hidden: true, "aria-haspopup": "dialog", "aria-expanded": "false", "aria-label": "Jump to a letter" }, "A–Z");
      box.append(nav);
      nav.append(el("div", { class: "crm-views-bar" }, toggle, jump), el("div", { class: "crm-views-panel", id: "crm-views-panel" },
        el("div", { class: "crm-switch", role: "group", "aria-label": "Show" },
          view("Members (" + count("businesses") + ")", { "data-tab": "businesses", onclick: () => { st.tab = "businesses"; draw(); } }, st.tab === "businesses"),
          view("People (" + count("people") + ")", { "data-tab": "people", onclick: () => { st.tab = "people"; draw(); } }, st.tab === "people"),
          // M1b: other contacts, people the group works with who are not members (read when first shown)
          FP.membershipModel ? view("Contacts" + (st.contacts.rows ? " (" + MM().searchContacts(st.contacts.rows).length + ")" : ""), { "data-tab": "contacts", onclick: () => { st.tab = "contacts"; draw(); readContacts(); } }, st.tab === "contacts") : null),
        el("div", { class: "crm-also" },
          view("Interactions", { "data-action": "feed", onclick: () => openFeed({}) }),
          view("Follow-ups", { "data-action": "follow-ups", onclick: () => openFeed({ followUp: "open" }) }),
          view(reviewLabel(), { "data-action": "review", onclick: () => openReview() }))));
      // the letters a long name-ordered list has, each one tap to its heading (set by fill)
      let letters = [];
      jump.addEventListener("click", () => FP.sheet.open({ opener: jump, title: "Jump to", className: "crm-jump-sheet", body: (done) => el("div", { class: "crm-letters" },
        ...letters.map((l) => el("button", { type: "button", "data-letter": l, onclick: () => { done(); const h = wrap.querySelector("#crm-letter-" + (l === "#" ? "num" : l)); h?.scrollIntoView({ block: "start" }); h?.focus?.(); } }, l))) }));
      // SG2: a sub-group's businesses (from its parent's register), above the sub-group's own records
      if (M().isSubgroup(group) && FP.subgroups) box.append(st.roster ||= FP.subgroups.roster(group, { sb, parent: opts.parent || null, person: opts.person, today: today(), now: opts.now || null }));
      if (st.failed) { box.append(el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the group's people just now: " + st.failed)); return box; }
      // PF1: while the lists are read, the frame and controls are here at once, with a placeholder list in place of each list not yet in
      box.setAttribute("aria-busy", String(!!st.loading));
      const list = el("div", { class: "crm-results" });
      const search = el("input", { id: "crm-search", type: "search", autocomplete: "off", placeholder: st.tab === "businesses" ? "Member, person, number or label" : st.tab === "contacts" ? "Name, organisation, email or phone" : "Name, email, phone or member", "aria-label": "Search" });
      search.value = st.tab === "businesses" ? st.filters.q : st.tab === "contacts" ? st.contacts.q : st.pq;
      search.addEventListener("input", () => { if (st.tab === "businesses") st.filters.q = search.value; else if (st.tab === "contacts") st.contacts.q = search.value; else st.pq = search.value; fill(); });
      const current = () => (st.tab === "businesses" ? { ...st.filters, subgroups: st.sg.chosen } : { archived: st.archived });
      // M1b: the membership type and field chips beside PE1's and SG2's
      const allChips = () => [...M().filterChips(current(), st.tab === "contacts" ? "people" : st.tab, sgNames()), ...(st.tab === "businesses" && FP.membershipModel ? MM().chips(st.filters, st.defs.fields, st.defs.years) : [])];
      const removeChip = (key) => (/^(type|field|sub):/.test(key) ? MM().remove(current(), key) : M().removeFilter(current(), key));
      const sgNames = () => new Map((st.sg.counts || []).map((c) => [c.subgroup_id, c.subgroup_name]));
      const filterButton = el("button", { type: "button", class: "crm-filter", "data-action": "filter", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: () => openFilters(filterButton) },
        FP.icon("filter", 18), el("span", {}, "Filter"));
      const chips = el("div", { class: "crm-active", role: "group", "aria-label": "Filters chosen" });
      box.append(el("div", { class: "crm-searchbar" }, el("div", { class: "crm-search" }, search), filterButton), chips);
      // the chosen filters as chips, each with its own remove; Clear when any is set (the default, current businesses, is never a chip)
      function drawChips() {
        const on = allChips();
        filterButton.classList.toggle("on", on.length > 0);
        filterButton.querySelector(".crm-filter-n")?.remove();
        if (on.length) filterButton.append(el("span", { class: "crm-filter-n" }, el("span", { class: "visually-hidden" }, ", chosen: "), String(on.length)));
        chips.hidden = !on.length;
        chips.replaceChildren(...on.map((c) => el("button", { type: "button", class: "crm-chip-on", "data-remove": c.key, "aria-label": "Remove the filter " + c.label, onclick: () => setFilters(removeChip(c.key)) },
          el("span", {}, c.label), FP.icon("close", 14))), ...(on.length ? [el("button", { type: "button", class: "link crm-clear", "data-action": "clear", onclick: () => setFilters(FP.membershipModel ? { ...MM().clear(M().clearFilters(current())), sub: null } : M().clearFilters(current())) }, "Clear")] : []));
      }
      let sheetBody = null;
      function setFilters(f) {
        if (st.tab === "businesses") { const { subgroups, ...rest } = f; st.filters = { ...st.filters, ...rest, labels: [...(f.labels || st.filters.labels || [])] }; if (subgroups) st.sg.chosen = [...subgroups]; }
        else st.archived = !!f.archived;
        drawChips(); fill(); sheetBody?.();
      }
      // The Filter sheet (a phone) or popover (a computer): Status, Follow-up due and the labels (a searchable list) for businesses;
      // archived people for people. Each choice applies at once; Done (or the backdrop) closes it.
      function openFilters(opener) {
        const holder = el("div", { class: "crm-filter-body" });
        let find = null;
        sheetBody = () => {
          // (a choice redraws the sheet: the focus stays on the same control)
          const was = root.document?.activeElement, key = holder.contains(was) ? [was.dataset.label ? "[data-label=\"" + CSS.escape(was.dataset.label) + "\"]" : was.dataset.status ? "[data-status=\"" + was.dataset.status + "\"]" : was.id ? "#" + was.id : null] : [null];
          queueMicrotask(() => { const n = key[0] && holder.querySelector(key[0]); if (n) n.focus(); });
          const f = st.filters;
          if (st.tab === "people" || st.tab === "contacts") {
            const sw = el("input", { type: "checkbox", role: "switch", id: "crm-archived", ...(st.archived ? { checked: true } : {}), onchange: () => setFilters({ archived: sw.checked }) });
            holder.replaceChildren(el("label", { class: "crm-switch-row", for: "crm-archived" }, el("span", {}, "Show archived people"), sw));
            return;
          }
          const status = el("div", { class: "crm-seg", role: "radiogroup", "aria-label": "Status" }, ...[["current", "Current"], ["ended", "Ended"], ["all", "All"]].map(([k, label]) =>
            el("button", { type: "button", role: "radio", "aria-checked": String((f.status || "current") === k), "data-status": k, onclick: () => setFilters({ status: k }) }, label)));
          const due = el("input", { type: "checkbox", role: "switch", id: "crm-due", "data-chip": "due", ...(f.due ? { checked: true } : {}), onchange: () => setFilters({ due: due.checked }) });
          const all = M().labels(st.directory), typed = find?.value || "";
          find = el("input", { type: "search", id: "crm-label-find", placeholder: "Find a label", autocomplete: "off", "aria-label": "Find a label" });
          find.value = typed;
          const labelList = el("ul", { class: "crm-label-list" });
          const drawLabels = () => {
            const q = M().fold(find.value);
            labelList.replaceChildren(...all.filter((l) => !q || M().fold(l.label).includes(q)).map((l) => {
              const on = (st.filters.labels || []).some((x) => x.toLowerCase() === l.label.toLowerCase());
              return el("li", {}, el("label", { class: "crm-label-row" }, el("input", { type: "checkbox", "data-label": l.label, ...(on ? { checked: true } : {}), onchange: () => setFilters(M().toggleLabel(st.filters, l.label)) }),
                el("span", {}, l.label), el("small", {}, String(l.count))));
            }));
            if (!labelList.childElementCount) labelList.append(el("li", { class: "crm-empty" }, all.length ? "No label matches." : "No labels recorded yet."));
          };
          find.addEventListener("input", drawLabels);
          drawLabels();
          holder.replaceChildren(el("h3", { class: "crm-filter-h" }, "Status"), status,
            el("label", { class: "crm-switch-row", for: "crm-due" }, el("span", {}, "Follow-up due"), due),
            el("h3", { class: "crm-filter-h" }, "Labels"), ...(all.length > 6 ? [find] : []), labelList, ...subgroupSection((id) => setFilters({ subgroups: st.sg.chosen.includes(id) ? st.sg.chosen.filter((x) => x !== id) : [...st.sg.chosen, id] })),
            ...membershipFilters(), ...subscriptionFilter());
        };
        // M2: Subscription <year>: not invoiced / invoiced, unpaid / paid / not required (any of those chosen), each with its count
        function subscriptionFilter() {
          if (!FP.membershipModel) return [];
          const years = MM().openYears(st.defs.years);
          if (!years.length) return [];
          // the counts are of the members the list shows with every other filter (current members by default), so a tick gives that many
          const f = st.filters, year = f.sub?.year || years[0].id;
          const counts = MM().subCounts(MM().filterRows(M().searchDirectory(st.directory, { ...f, subgroups: st.sg.chosen, subgroupIndex: st.sg.index }), { ...f, sub: null }), year);
          const pick = el("select", { id: "ms-filter-year", "aria-label": "Subscription year", onchange: () => setFilters(MM().setSubYear(st.filters, pick.value)) },
            ...years.map((y) => el("option", { value: y.id, ...(y.id === year ? { selected: true } : {}) }, y.label)));
          return [el("h3", { class: "crm-filter-h" }, "Subscription"), pick,
            el("ul", { class: "crm-label-list ms-filter-status" }, ...MM().STATUS.map(([k, label]) => el("li", {}, el("label", { class: "crm-label-row" },
              el("input", { type: "checkbox", id: "ms-filter-" + k, "data-sub": k, ...(f.sub?.year === year && (f.sub.status || []).includes(k) ? { checked: true } : {}), onchange: () => setFilters(MM().toggleSubStatus(st.filters, year, k)) }),
              el("span", {}, label), el("small", {}, String(counts[k])))))) ];
        }
        // M1b: Membership type (any of those chosen), and each of the group's choice, tick and date fields
        function membershipFilters() {
          if (!FP.membershipModel) return [];
          const f = st.filters, out = [];
          const types = MM().typeChoices(st.defs.types, st.directory);
          if (types.length) out.push(el("h3", { class: "crm-filter-h" }, "Membership type"), el("ul", { class: "crm-label-list mf-filter-types" }, ...types.map((t, ti) => el("li", {}, el("label", { class: "crm-label-row" },
            el("input", { type: "checkbox", id: "mf-type-" + ti, "data-type": t.name, ...((f.types || []).some((x) => x.toLowerCase() === t.name.toLowerCase()) ? { checked: true } : {}), onchange: () => setFilters(MM().toggleType(st.filters, t.name)) }),
            el("span", {}, t.name), el("small", {}, String(t.count)))))));
          for (const fd of MM().filterFields(st.defs.fields)) {
            const c = f.fieldf?.[fd.key] || {}, id = "mf-filter-" + fd.key;
            out.push(el("h3", { class: "crm-filter-h" }, fd.label));
            if (fd.kind === "choice") {
              out.push(el("ul", { class: "crm-label-list", "data-filter-field": fd.key }, ...[...MM().choiceChoices(fd, st.directory), null].map((ch, ci) => el("li", {}, el("label", { class: "crm-label-row" },
                el("input", { type: "checkbox", id: "mf-c-" + fd.key + "-" + (ch == null ? "none" : ci), "data-choice": ch ?? "", ...((ch == null ? c.none : (c.is || []).some((x) => x.toLowerCase() === ch.toLowerCase())) ? { checked: true } : {}),
                  onchange: () => setFilters(ch == null ? MM().setField(st.filters, fd.key, c.none ? null : { none: true }) : MM().toggleChoice(st.filters, fd.key, ch)) }),
                el("span", {}, ch == null ? "Not set" : ch + ((fd.choices || []).includes(ch) ? "" : MM().ORPHAN)))))));
            } else if (fd.kind === "tick") {
              const now = c.ticked == null ? "any" : c.ticked ? "yes" : "no";
              out.push(el("div", { class: "crm-seg", role: "radiogroup", "aria-label": fd.label, "data-filter-field": fd.key }, ...[["any", "Any"], ["yes", "Ticked"], ["no", "Not ticked"]].map(([k, label]) =>
                el("button", { type: "button", role: "radio", "aria-checked": String(now === k), id: "mf-tick-" + fd.key + "-" + k, "data-tick": k, onclick: () => setFilters(MM().setField(st.filters, fd.key, k === "any" ? null : { ticked: k === "yes" })) }, label))));
            } else {
              const how = c.none ? "none" : c.before ? "before" : c.after ? "after" : "any", day = el("input", { type: "date", id, "aria-label": fd.label + " date", value: c.before || c.after || "" });
              const apply = (k) => setFilters(MM().setField(st.filters, fd.key, k === "any" ? null : k === "none" ? { none: true } : day.value ? { [k]: day.value } : null));
              day.addEventListener("change", () => { if (how === "before" || how === "after") apply(how); });
              out.push(el("div", { class: "crm-seg", role: "radiogroup", "aria-label": fd.label, "data-filter-field": fd.key }, ...[["any", "Any"], ["before", "Before"], ["after", "After"], ["none", "None"]].map(([k, label]) =>
                el("button", { type: "button", role: "radio", "aria-checked": String(how === k), id: "mf-date-" + fd.key + "-" + k, "data-date": k, onclick: () => { if ((k === "before" || k === "after") && !day.value) day.value = today(); apply(k); } }, label))),
                how === "before" || how === "after" ? day : null);
            }
          }
          return out;
        }
        sheetBody();
        // SG2: the sub-groups and who is in them are read the first time the filter is opened (subgroups.js readFilter)
        if (!M().isSubgroup(group) && FP.subgroups && !st.sg.counts && !st.sg.loading) {
          st.sg.loading = true;
          Promise.resolve(FP.subgroups.readFilter(sb, g)).then((r) => Object.assign(st.sg, r, { failed: null }), (e) => { st.sg.failed = message(e); })
            .then(() => { st.sg.loading = false; sheetBody?.(); });
        }
        FP.sheet.open({ opener, title: "Filter", where: st.tab === "businesses" ? "Members" : "People", className: "crm-filter-sheet", body: () => holder, onClose: () => { sheetBody = null; } });
      }
      // M1d: when the group's fields or types could not be read, say so (the list then has no field columns or filters)
      if (st.tab === "businesses" && st.defs.failed && !st.loading) box.append(el("p", { class: "group-fine", role: "status", "data-defs-failed": "" }, "Couldn't read " + st.defs.failed + ". Reload to try again."));
      box.append(list);
      // The first screenful is drawn at once and the rest of a long list on the next frame (a newer fill drops an older one's rest).
      // PH3: in name order, a letter heading before each new letter once the list is long enough to need them (a phone's contacts; a
      // computer's table has its sortable header instead); the A to Z jump for a long one
      const LETTERED = 12, LONG = 30;
      function listOf(shown, row, by = null) {
        const nameOf = by && shown.length >= LETTERED ? by : null;
        const items = nameOf ? M().withLetters(shown, nameOf) : shown;
        const node = (x) => (x && x.letter && Object.keys(x).length === 1 ? el("li", { class: "crm-letter", id: "crm-letter-" + (x.letter === "#" ? "num" : x.letter), tabindex: "-1" }, x.letter) : row(x));
        const ul = el("ul", { class: "crm-list" + (nameOf ? " crm-lettered" : "") }, ...items.slice(0, FIRST).map(node)), run = ++fills;
        if (items.length > FIRST) later(() => { if (run === fills && ul.isConnected) ul.append(...items.slice(FIRST).map(node)); });
        letters = nameOf ? items.filter((x) => x && x.letter && Object.keys(x).length === 1).map((x) => x.letter) : [];
        jump.hidden = !(nameOf && shown.length > LONG && letters.length > 1);
        return ul;
      }
      const byName = () => (st.sort.by || "name") === "name";
      // a computer's table header: each column sorts (again: the other way); the header stays as the list scrolls
      function head(cols) {
        return el("div", { class: "crm-thead" }, ...cols.map(([by, label]) => {
          const on = (st.sort.by || "name") === by;   // PH3: opened in name order, the Name column says so
          return el("button", { type: "button", class: "crm-th", "data-sort": by, ...(on ? { "aria-sort": st.sort.dir > 0 ? "ascending" : "descending" } : {}),
            onclick: () => { st.sort = on ? { by, dir: -st.sort.dir } : { by, dir: by === "last" ? -1 : 1 }; fill(); } },
            el("span", {}, label), on ? el("span", { class: "crm-sort", "aria-hidden": "true" }, st.sort.dir > 0 ? "↑" : "↓") : null);
        }));
      }
      function fill() {
        if (waiting(st.tab)) {
          fills++;
          list.replaceChildren(el("p", { class: "crm-count", role: "status" }, "Reading the group's people…"),
            el("ul", { class: "crm-list crm-skeleton", "aria-hidden": "true" }, ...Array.from({ length: 8 }, () => el("li", { class: "crm-skeleton-row" }, el("span"), el("span")))));
        } else if (st.tab === "businesses") {
          const shown = shownMembers();
          // M1b: Type and the fields shown in the list as more columns on a computer (the table scrolls sideways inside itself, the
          // member's name column staying put); on a phone the type is quiet words on the row's second line
          const cols = FP.membershipModel ? MM().columns(st.defs.fields) : [["name", "Member"], ["member", "No."], ["contact", "Primary contact"], ["last", "Last contact"]];
          const extra = FP.membershipModel ? MM().listFields(st.defs.fields).length : 0;
          // one column template for the header and every row (set here in full, whatever the number of list fields)
          const table = el("div", { class: "crm-table" + (FP.membershipModel ? " mf-table" : "") + (extra > 0 ? " mf-wide" : ""),
            ...(FP.membershipModel ? { style: "--cols: " + MM().colTemplate(extra) + "; --mf-extra: " + extra } : {}) },
            head(cols), listOf(shown, businessRow, byName() ? (r) => r.business_name : null));
          list.replaceChildren(el("p", { class: "crm-count", role: "status" }, M().plural(shown.length, "member", "members")),
            shown.length ? (extra > 0 ? el("div", { class: "mf-scroll" }, table) : table)
              : el("p", { class: "crm-empty" }, st.directory.length ? "No member matches." : "The group's member register is empty."));
        } else if (st.tab === "contacts") {
          if (st.contacts.failed) { list.replaceChildren(el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the contacts just now: " + st.contacts.failed)); return; }
          if (!st.contacts.rows) { list.replaceChildren(el("p", { class: "crm-count", role: "status" }, "Reading the group's other contacts…")); readContacts(); return; }
          const shown = ordered(MM().searchContacts(st.contacts.rows, st.contacts.q, st.archived), st.sort.by === "member" ? null : st.sort.by);
          list.replaceChildren(el("p", { class: "crm-count", role: "status" }, M().plural(shown.length, "contact", "contacts")),
            shown.length ? el("div", { class: "crm-table crm-table-people" }, head([["name", "Name"], ["contact", "Organisation"], ["last", "Last contact"]]), listOf(shown, contactRow, byName() ? (r) => r.display_name : null))
              : el("p", { class: "crm-empty" }, st.contacts.rows.length ? "Nobody matches." : "No other contacts yet. Add council staff, funders and contractors the group works with from the … menu."));
        } else {
          const shown = ordered(M().searchPeople(st.people, { q: st.pq, archived: st.archived }), st.sort.by === "member" ? null : st.sort.by);
          list.replaceChildren(el("p", { class: "crm-count", role: "status" }, M().plural(shown.length, "person", "people")),
            shown.length ? el("div", { class: "crm-table crm-table-people" }, head([["name", "Name"], ["contact", "Members"], ["last", "Last contact"]]), listOf(shown, personRow, byName() ? (r) => r.display_name : null))
              : el("p", { class: "crm-empty" }, st.people.length ? "Nobody matches." : "No people recorded yet. Add one, or import the Apptivo contacts."));
        }
      }
      drawChips();
      fill();
      if (st.truncated) box.append(el("p", { class: "group-fine" }, "Only the first " + CAP.toLocaleString("en-NZ") + " are listed."));
      return box;
    }
    // SG2: the Sub-group filter, a section of the Filter sheet (for a group that may have sub-groups): read the first time the sheet
    // opens; several may be chosen, each then a chip
    function subgroupSection(toggle) {
      if (M().isSubgroup(group) || !FP.subgroups) return [];
      const s = st.sg, head = el("h3", { class: "crm-filter-h" }, "Sub-groups");
      if (s.loading || (!s.counts && !s.failed)) return [head, el("p", { class: "crm-count", role: "status" }, "Reading the sub-groups…")];
      if (s.failed) return [head, el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the sub-groups just now: " + s.failed)];
      if (!(s.counts || []).length) return [head, el("p", { class: "crm-empty" }, "This group has no sub-groups yet.")];
      return [head, el("ul", { class: "crm-label-list sg-filter" }, ...s.counts.map((c) => el("li", {}, el("label", { class: "crm-label-row" },
        el("input", { type: "checkbox", "data-subgroup": c.subgroup_id, ...(s.chosen.includes(c.subgroup_id) ? { checked: true } : {}),
          onchange: () => toggle(c.subgroup_id) }),
        el("span", {}, c.subgroup_name), el("small", {}, String(Number(c.current_businesses) || 0)))))),
        ...(s.truncated ? [el("p", { class: "group-fine" }, "Only the first " + M().SUBGROUP_CAP.toLocaleString("en-NZ") + " sub-group places are read.")] : [])];
    }
    // PH3: a round avatar with the initials (a member business's is a rounded square, so members and people read apart); for sight only
    const avatar = (name, org = false) => el("span", { class: "crm-avatar" + (org ? " crm-avatar-org" : ""), "aria-hidden": "true" }, M().initials(name) || "·");
    // A business: its name (a dot before it when a follow-up is due), member number and primary contact, the last contact at the right
    function businessRow(r) {
      const due = Number(r.due_follow_ups) || 0, last = M().lastShort(r.last_interaction_at, today());
      return el("li", { class: "crm-row" + (r.ended_at ? " ended" : "") },
        el("button", { type: "button", "data-business": r.group_member_id, onclick: () => openBusiness(r.group_member_id) },
          el("span", { class: "crm-c-name" }, avatar(r.business_name, true), due ? el("span", { class: "crm-due-dot", title: M().plural(due, "follow-up", "follow-ups") + " due" }) : null,
            el("b", {}, r.business_name), due ? el("span", { class: "visually-hidden" }, " " + M().plural(due, "follow-up", "follow-ups") + " due") : null,
            r.ended_at ? el("span", { class: "crm-badge" }, "Ended") : null),
          // (a computer's table heads the column "No.": the word Member is for a phone's row and for screen readers)
          el("span", { class: "crm-c-member" }, el("span", { class: "crm-member-word" }, "Member "), r.member_number),
          // M1b: the membership type (quiet words; a computer's "Type" column)
          FP.membershipModel && r.membership_type ? el("span", { class: "crm-c-type" }, el("span", { class: "visually-hidden" }, "Type "), r.membership_type) : null,
          // M1b: the fields shown in the list, each its own column on a computer (hidden on a phone, so their inline column never
          // applies there); in the order the computer shows them, before Primary contact
          ...(FP.membershipModel ? MM().listFields(st.defs.fields).map((f, i) => el("span", { class: "crm-c-field", "data-field": f.key, style: "grid-column: " + MM().colOf(0).field(i) },
            el("span", { class: "visually-hidden" }, f.label + " "), MM().valueText(f, r.fields?.[f.key]))) : []),
          // (no contact recorded: nothing, rather than a line saying so). Its column on a computer is set in people.css (second to
          // last), never inline: a phone places it by its grid area.
          r.primary_name || r.people_count ? el("span", { class: "crm-c-contact" }, r.primary_name || M().plural(r.people_count, "person", "people")) : null,
          el("span", { class: "crm-c-last" }, el("span", { class: "visually-hidden" }, "Last contact "), last)));
    }
    // M1b: the directory as it is shown (search, PE1's and SG2's filters, then membership type and fields; sorted)
    // PH3: by name unless a column was chosen, as a phone's contacts are (letters first, macrons and case ignored)
    function shownMembers() {
      let rows = M().searchDirectory(st.directory, { ...st.filters, subgroups: st.sg.chosen, subgroupIndex: st.sg.index });
      if (FP.membershipModel) rows = MM().filterRows(rows, st.filters);
      if ((st.sort.by || "name") === "name") return ordered(rows, "name", (r) => r.business_name);
      return (FP.membershipModel && MM().sortBy(rows, st.sort.by, st.sort.dir, st.defs.fields)) || M().sortDirectory(rows, st.sort.by, st.sort.dir);
    }
    function ordered(rows, by, nameOf = (r) => r.display_name) {
      if ((by || "name") !== "name") return M().sortDirectory(rows, by, st.sort.dir);
      const cmp = M().byName(nameOf), dir = st.sort.by === "name" ? st.sort.dir : 1;
      return [...rows].sort((a, b) => cmp(a, b) * dir);
    }
    // M1b: an other contact: name, organisation and kind, last contact
    function contactRow(c) {
      return el("li", { class: "crm-row" + (c.archived_at ? " ended" : "") },
        el("button", { type: "button", "data-person": c.person_id, onclick: () => openPerson(c.person_id) },
          el("span", { class: "crm-c-name" }, avatar(c.display_name), el("b", {}, c.display_name), c.archived_at ? el("span", { class: "crm-badge" }, "Archived") : null),
          el("span", { class: "crm-c-contact" }, MM().contactLine(c) || "No organisation recorded"),
          el("span", { class: "crm-c-last" }, el("span", { class: "visually-hidden" }, "Last contact "), M().lastShort(c.last_interaction_at, today()))));
    }
    // M1b: a set-returning read a page at a time (the API returns at most 1,000 rows a request), each read ordered by the database,
    // until a short page; a failed page fails the whole read, never a silent part of it. (A client without range(): one read.)
    async function pagedRpc(name, args) {
      const out = [], PAGE_ROWS = 1000;
      for (let n = 0; n < 10; n++) {
        const q = sb.rpc(name, args);
        if (typeof q?.range !== "function") return rows(q);
        const got = await rows(q.range(n * PAGE_ROWS, n * PAGE_ROWS + PAGE_ROWS - 1));
        out.push(...got);
        if (got.length < PAGE_ROWS) break;
      }
      return out;
    }
    async function readContacts() {
      if (st.contacts.rows || st.contacts.reading) return;
      st.contacts.reading = true;
      try { st.contacts.rows = await pagedRpc("crm_contacts", { g, max_rows: CAP }); st.contacts.failed = null; } catch (e) { st.contacts.failed = message(e); }
      st.contacts.reading = false;
      if (st.screen === "directory") redrawDirectory();
    }
    // M1b: contacting members. The platform sends nothing: the addresses go to the clipboard, the list to a file.
    async function membersShownEmails() {
      const shown = shownMembers();
      if (!shown.length) return { shown, rows: [] };
      // (M2: the subscription filter goes too, so the database picks the same members)
      const sub = FP.membershipModel ? MM().subFilterArg(st.filters.sub) : null;
      return { shown, rows: await pagedRpc("crm_email_list", { g, filter: { ids: shown.map((r) => r.group_member_id), ...(sub ? { subscription: sub } : {}) } }) };
    }
    async function copyEmails() {
      try {
        const { rows: got } = await membersShownEmails(), r = MM().emailText(got);
        if (r.text) await root.navigator.clipboard.writeText(r.text);
        st.notice = MM().emailNotice(r);
      } catch (e) { st.notice = "Couldn't copy the email addresses: " + message(e); }
      draw();
    }
    async function downloadList() {
      try {
        const { shown, rows: got } = await membersShownEmails();
        // the sub-groups each member is in (SG2's map, read here when the Filter has not read it yet)
        if (!st.sg.counts && FP.subgroups && !M().isSubgroup(group)) { try { Object.assign(st.sg, await FP.subgroups.readFilter(sb, g)); } catch { /* the list without sub-groups */ } }
        const names = new Map((st.sg.counts || []).map((c) => [c.subgroup_id, c.subgroup_name]));
        const subgroupsOf = (id) => [...(st.sg.index?.get(id) || [])].map((s) => names.get(s)).filter(Boolean);
        download(M().fileName(group.name, "members", today(), "").replace(/-end\.csv$/, ".csv"), MM().listCsv(shown, got, st.people, st.defs.fields, subgroupsOf));
        st.notice = M().plural(shown.length, "member", "members") + " downloaded. The file holds personal information: keep it where the group's records are kept.";
      } catch (e) { st.notice = "Couldn't download the list: " + message(e); }
      draw();
    }
    function personRow(p) {
      return el("li", { class: "crm-row" + (p.archived_at ? " ended" : "") },
        el("button", { type: "button", "data-person": p.person_id, onclick: () => openPerson(p.person_id) },
          el("span", { class: "crm-c-name" }, avatar(p.display_name), el("b", {}, p.display_name), p.archived_at ? el("span", { class: "crm-badge" }, "Archived") : null),
          el("span", { class: "crm-c-contact" }, [p.job_title, (p.businesses || []).map((b) => b.business_name + (b.relationship ? " (" + b.relationship + ")" : "")).join(", ") || "No member"].filter(Boolean).join(" · ")),
          el("span", { class: "crm-c-last" }, el("span", { class: "visually-hidden" }, "Last contact "), M().lastShort(p.last_interaction_at, today()))));
    }

    // ---- a business ------------------------------------------------------------------------------------------------------------------
    async function openBusiness(id, push = true) {
      if (push) go("business", { page: { loading: true } });
      try {
        // M1b: the membership and the group's fields are read beside the page (their failure is said in their own place)
        const member = MS() ? MS().readMember(sb, id).catch((e) => ({ failed: message(e) })) : Promise.resolve(null);
        const subs = MS()?.readSubs ? MS().readSubs(sb, id).catch((e) => ({ failed: message(e) })) : Promise.resolve(null);   // M2
        const page = await one(sb.rpc("crm_business", { b: id }));
        if (!page) throw new Error("not found, or not yours to read");
        page.membership = await member;
        page.subs = await subs;
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
    // PH3: the head of a member's or a person's page, like a phone's contact card: a round avatar (a member's is a rounded square), the
    // name, and one quiet line
    // (review of #537: lighter) the avatar beside the name, its one line and Call · Text · Email as plain quiet words, in one band
    function cardHead(name, line, org, badge, ways = null) {
      return el("div", { class: "crm-card-head" }, el("span", { class: "crm-avatar crm-avatar-big" + (org ? " crm-avatar-org" : ""), "aria-hidden": "true" }, M().initials(name) || "·"),
        el("div", { class: "crm-card-name" }, el("h3", {}, name, badge || null), line ? el("p", { class: "crm-sub" }, line) : null, ways));
    }
    // Call, text and email as plain actions, from the first phone and email recorded (what this page already read; nothing more)
    function reach(d) {
      const phone = (d?.phones || [])[0], email = (d?.emails || [])[0], dial = phone ? phone.replace(/[^\d+]/g, "") : "";
      const links = [dial ? el("a", { href: "tel:" + dial, class: "crm-reach-link", "data-reach": "call" }, "Call") : null,
        dial ? el("a", { href: "sms:" + dial, class: "crm-reach-link", "data-reach": "text" }, "Text") : null,
        email ? el("a", { href: "mailto:" + email, class: "crm-reach-link", "data-reach": "email" }, "Email") : null].filter(Boolean);
      return links.length ? el("div", { class: "crm-reach", role: "group", "aria-label": "Get in touch" }, ...links.flatMap((a, n) => (n ? [el("span", { class: "crm-reach-sep", "aria-hidden": "true" }, "·"), a] : [a]))) : null;
    }
    function businessScreen() {
      const p = st.page || {};
      if (p.loading) return el("div", {}, backButton(), el("p", { class: "group-status", role: "status" }, "Reading the member…"));
      if (p.failed) return el("div", {}, backButton(), el("p", { role: "alert", class: "crm-failed" }, "Couldn't read this member: " + p.failed));
      const b = p.business, d = p.details || {}, people = p.people || [], mem = p.membership;
      // PH3: a contact card's head: the avatar and name, one quiet line, call, text and email as plain actions, then the one filled
      // button with the quieter actions under "…"
      const box = el("article", { class: "crm-page", "data-business": b.id }, backButton(),
        cardHead(b.business_name, ["Member " + b.member_number, d.trading_name ? "trading as " + d.trading_name : null, d.status].filter(Boolean).join(" · "), true,
          b.ended_at ? el("span", { class: "crm-badge" }, "Ended") : null, reach(d)),
        el("div", { class: "crm-actions" },
          el("button", { type: "button", class: "primary", "data-action": "log", onclick: () => openLog(null, [{ kind: "business", id: b.id, name: b.business_name, member_number: b.member_number }]) }, "Log an interaction"),
          FP.sheet.moreButton("More for " + b.business_name, [
            { label: "Edit details", icon: "create", action: "edit-details", run: () => go("details-form", { form: M().detailsForm(p.details), target: b }) },
            { label: "Add a person here", icon: "person", action: "add-person", run: () => openPersonForm(null, b) }])));
      // M1b: in the product page's order: contact details (and the people linked), membership, tags (sub-groups and labels), where
      // they are at (the group's own fields), notes, interactions, then its land, files and records
      const facts = contactLines(d);
      box.append(el("section", { class: "crm-section", "data-section": "contact" }, el("h4", {}, "Contact details"),
        facts.length ? el("dl", { class: "crm-facts" }, ...facts) : el("p", { class: "crm-empty" }, "No contact details recorded for the member.")));
      const current = people.filter((x) => x.current), past = people.filter((x) => !x.current);
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "People (" + current.length + ")"),
        current.length ? el("ul", { class: "crm-people" }, ...current.map((x) => linkedPerson(x, b))) : el("p", { class: "crm-empty" }, "Nobody linked yet."),
        linkExisting(b, people),
        past.length ? el("details", { class: "crm-past" }, el("summary", {}, "Earlier (" + past.length + ")"), el("ul", { class: "crm-people" }, ...past.map((x) => linkedPerson(x, b)))) : null));
      const memberCtx = { sb, group, business: b, page: mem, types: st.defs.types, today: today(), openSettings: () => go("fields"),
        // focus (M2): the ids to put the focus back on once the page is drawn again (the first that is there), else the notice
        done: async (notice, focus) => {
          const here = () => st.screen === "business" && st.page?.business?.id === b.id;   // still on this member's page
          if (!here()) return;
          st.notice = notice; await loadLists();
          if (!here()) return;
          await openBusiness(b.id, false);
          if (!here()) return;
          draw();
          if (focus) (([].concat(focus).map((id) => wrap.querySelector("#" + CSS.escape(id))).find(Boolean)) || wrap.querySelector(".crm-notice"))?.focus();
        },
        changed: (f) => { const r = st.directory.find((x) => x.group_member_id === b.id); if (r) r.fields = { ...(r.fields || {}), [f.key]: f.value }; } };
      if (MS() && mem && !mem.failed) box.append(MS().membershipSection(memberCtx));
      else if (mem?.failed) box.append(el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the membership just now: " + mem.failed));
      // SG2: the sub-groups this business is in (read when the page is drawn first; kept with the page), with its labels
      // (one heading: the sub-groups' own, with the labels under it; "Labels" when there are no sub-groups here)
      const tags = el("section", { class: "crm-section", "data-section": "tags" });
      const chips = !M().isSubgroup(group) && FP.subgroups ? (p.subgroups ||= FP.subgroups.chips(b, { sb, group, today: today() })) : null;
      if (chips) tags.append(chips);
      if ((d.labels || []).length) tags.append(...(chips ? [] : [el("h4", {}, "Labels")]), el("ul", { class: "crm-labels" }, ...d.labels.map((l) => el("li", {}, l))));
      if (tags.childElementCount) box.append(tags);
      if (MS() && mem && !mem.failed) box.append(MS().fieldsSection(memberCtx));
      // M2: subscriptions year by year, then agreements and forms (after Where they are at, before Notes)
      if (MS()?.subscriptionsSection && p.subs && !p.subs.failed) {
        const subCtx = { ...memberCtx, page: p.subs, openSettings: () => go("sub-settings") };
        box.append(MS().subscriptionsSection(subCtx), MS().agreementsSection(subCtx));
      } else if (p.subs?.failed) box.append(el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the subscriptions and agreements just now: " + p.subs.failed));
      box.append(el("section", { class: "crm-section", "data-section": "notes" }, el("h4", {}, "Notes"),
        d.notes ? el("p", { class: "crm-notes" }, d.notes) : el("p", { class: "crm-empty" }, "No notes. Add them with Edit details.")));
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
        el("button", { type: "button", class: "crm-person", "data-person": x.person_id, onclick: () => openPerson(x.person_id) }, avatar(x.display_name),
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
        cardHead(x.display_name, [x.job_title, FP.membershipModel ? MM().contactLine({ organisation_name: x.organisation_name, contact_kind: x.contact_kind }) : null].filter(Boolean).join(" · "), false,
          archived ? el("span", { class: "crm-badge" }, "Archived") : null, archived ? null : reach(x)));
      // PH3: the one filled button; Edit and Archive (or Restore) under "…"
      const actions = el("div", { class: "crm-actions" }), more = [];
      if (!archived) {
        actions.append(el("button", { type: "button", class: "primary", "data-action": "log", onclick: () => openLog(null, [{ kind: "person", id: x.id, name: x.display_name },
          ...current.filter((b) => b.is_primary || current.length === 1).map((b) => ({ kind: "business", id: b.group_member_id, name: b.business_name, member_number: b.member_number }))]) }, "Log an interaction"));
        more.push({ label: "Edit", icon: "create", action: "edit-person", run: () => openPersonForm(x, null) });
      }
      if (M().canArchive(group.role, x, me)) {
        if (archived) actions.append(el("button", { type: "button", class: "secondary", "data-action": "restore", onclick: () => setArchived(x, false) }, "Restore"));
        else more.push({ label: "Archive", hint: "They stay on record and can be restored", icon: "close", action: "archive", run: () => setArchived(x, true) });
      }
      if (more.length) actions.append(FP.sheet.moreButton("More for " + x.display_name, more));
      if (actions.childElementCount) box.append(actions);
      if (archived) box.append(el("p", { class: "group-fine" }, "Archived " + G().shortDate(x.archived_at) + ". An archived person stays on record with their interactions; restore them to change anything."));
      const facts = contactLines(x);
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "Contact details"),
        facts.length ? el("dl", { class: "crm-facts" }, ...facts) : el("p", { class: "crm-empty" }, "No contact details recorded."),
        x.notes ? el("p", { class: "crm-notes" }, x.notes) : null,
        x.user_id ? el("p", { class: "group-fine" }, "Has a sign-in to this platform.") : null,
        x.source && x.source !== "manual" ? el("p", { class: "group-fine" }, "First recorded from " + (x.source === "apptivo" ? "Apptivo" : x.source) + ".") : null));
      const bizItem = (b) => el("li", {}, el("button", { type: "button", class: "crm-person", "data-business": b.group_member_id, onclick: () => openBusiness(b.group_member_id) }, avatar(b.business_name, true),
        el("span", { class: "crm-row-main" }, el("b", {}, b.business_name), b.is_primary ? el("span", { class: "crm-badge" }, "Primary") : null),
        el("small", {}, ["Member " + b.member_number, b.relationship, b.current ? null : "until " + M().dateText(b.ended_on)].filter(Boolean).join(" · "))));
      box.append(el("section", { class: "crm-section" }, el("h4", {}, "Members (" + current.length + ")"),
        current.length ? el("ul", { class: "crm-people" }, ...current.map(bizItem)) : el("p", { class: "crm-empty" }, "Not linked to a member. Open a member and link them there."),
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
    // PH4: the one pattern for add forms (js/form-rows.js), and PRODUCT.md's "three taps and a line": who with, what it was, one line
    // (and when, prefilled with now) first; the subject, how long, topics and a follow-up under More details. Plain rows, no boxes.
    function logScreen() {
      const f = st.form, it = st.editing, R = FP.formRows;
      const s = R.sheet({ form: true, page: true, title: it ? "Edit the interaction" : "Log an interaction", saveLabel: "Save", className: "crm-form crm-log", onCancel: () => back() });
      const form = s.node, save = s.save;
      s.cancel.classList.add("crm-back");
      const input = (id, attrs = {}) => { const i = R.input({ id: "pe-" + id, name: id, ...attrs }); i.value = f[id] ?? ""; i.addEventListener("input", () => { f[id] = i.value; }); return i; };
      const row = (id, label, node, hint) => R.row({ key: id, label, forId: "pe-" + id, control: node, hint });
      // quick choices: small plain words after the field, no pill round them
      const quick = (id, choices) => el("span", { class: "crm-quick fs-quick" }, ...choices.map(([v, label]) => el("button", { type: "button", class: "fs-quick-word", "aria-pressed": String(String(f[id]) === String(v)), onclick: () => { f[id] = String(v); draw(); } }, label)));
      // Who with: the picked, each removable, and a search over the group's members and people
      const picked = el("ul", { class: "crm-picked fs-picked" }, ...f.links.map((l) => el("li", {}, M().linkText(l),
        el("button", { type: "button", class: "fs-unpick", "aria-label": "Remove " + l.name, onclick: () => { f.links = f.links.filter((x) => !(x.kind === l.kind && x.id === l.id)); draw(); } }, FP.icon("close", 14)))));
      const results = el("div", { class: "crm-who-results fs-results" });
      const who = R.input({ id: "pe-who", type: "search", placeholder: f.links.length ? "Add someone" : "Search members and people", enterkeyhint: "search" });
      const showResults = () => {
        const found = who.value.trim() ? M().whoWith(st.directory, st.people, who.value, f.links) : [];
        results.hidden = !found.length;
        results.replaceChildren(...found.map((r) => el("button", { type: "button", class: "fs-option", "data-who": r.kind + ":" + r.id, onclick: () => {
          f.links = [...f.links, { kind: r.kind, id: r.id, name: r.name, member_number: r.kind === "business" ? st.directory.find((x) => x.group_member_id === r.id)?.member_number : null }];
          draw(); document.getElementById("pe-who")?.focus();
        } }, el("span", { class: "fs-lead", "aria-hidden": "true" }, FP.icon(r.kind === "business" ? "people" : "person", 18)),
          el("span", { class: "fs-option-words" }, el("span", {}, r.name), el("small", {}, (r.kind === "business" ? "Member · " : "Person · ") + r.note)))));
      };
      results.hidden = true;
      who.addEventListener("input", showResults);
      const withRow = el("div", { class: "fs-row crm-with", "data-field": "who", "data-row": "who" }, el("label", { class: "fs-label", for: "pe-who" }, "With"),
        el("div", { class: "fs-value fs-wrap" }, f.links.length ? picked : null, who));
      const kind = R.pick({ id: "pe-kind", key: "kind", label: "What", title: "What it was", options: M().KINDS.map(([v, label]) => ({ value: v, label })), value: () => f.kind, onPick: (k) => { f.kind = k; draw(); } });
      const direction = M().DIRECTED.has(f.kind) ? R.pick({ id: "pe-direction", key: "direction", label: "Direction", title: "Direction", options: M().DIRECTIONS.map(([v, label]) => ({ value: v, label })), value: () => f.direction, onPick: (k) => { f.direction = k; } }) : null;
      const summary = R.long({ id: "pe-summary", key: "summary", label: "Summary", value: f.summary, placeholder: "One line is enough", max: 20000, onInput: (v) => { f.summary = v; } });
      const whenRow = R.row({ key: "date", label: "When", forId: "pe-date", control: input("date", { type: "date", required: true }) });
      const timeRow = R.row({ key: "time", label: "Time", forId: "pe-time", control: [input("time", { type: "time" }), el("button", { type: "button", class: "fs-quick-word", onclick: () => { f.date = M().dayKey(now()); f.time = FP.eventsModel.timeKey(now()); draw(); } }, "Now")] });
      const errors = el("div", { class: "crm-errors fs-say", role: "alert" }, ...(st.errors || []).map((e) => el("p", {}, e)));
      if (!(st.errors || []).length) errors.hidden = true;
      const in7 = M().dayKey(Date.parse(today() + "T12:00:00Z") + 7 * 86400000), in30 = M().dayKey(Date.parse(today() + "T12:00:00Z") + 30 * 86400000);
      const moreBox = R.more({ label: "More details", open: !!st.logMore || !!it, rows: [
        row("subject", "Subject", input("subject", { type: "text", maxlength: "300" })),
        row("duration", "How long", [input("duration", { type: "number", min: "0", max: "10080", step: "1", inputmode: "numeric", placeholder: "min" }), quick("duration", [[5, "5 min"], [15, "15"], [30, "30"], [60, "1 h"]])]),
        row("topics", "Topics", input("topics", { type: "text", list: "pe-topic-list", placeholder: "FEP, nutrient budget" }), "Separated by commas."),
        row("follow_up_on", "Follow up", [input("follow_up_on", { type: "date", "aria-label": "Follow up on" })]),
        el("div", { class: "fs-row fs-quick-row" }, el("span", { class: "fs-label" }, ""), el("div", { class: "fs-value" }, quick("follow_up_on", [[in7, "In a week"], [in30, "In a month"], ["", "None"]]))),
      ] });
      moreBox.querySelector(".fs-more").addEventListener("click", () => { st.logMore = !moreBox._box.hidden; });
      s.body.append(errors, R.set(withRow, results, kind, direction, summary, whenRow, timeRow), moreBox,
        el("datalist", { id: "pe-topic-list" }, ...M().topicsOf([...(st.page?.interactions || []), ...st.feed.items]).map((t) => el("option", { value: t }))),
        R.quiet("New Zealand time. Only the group's facilitators, advisors and admins see this."));
      if (it && M().canArchive(group.role, it, me)) s.body.append(el("p", {}, el("button", { type: "button", class: "link", "data-action": "cancel-interaction", onclick: async () => {
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
    // M1b: contact = true for "Add a contact" (someone the group works with who is not a member: their organisation and kind)
    function openPersonForm(x, business, contact = false) {
      go("person-form", { form: { ...M().personForm(x), organisation_name: x?.organisation_name || "", contact_kind: x?.contact_kind || "" }, target: { person: x, business, contact } });
    }
    // M1b: the Fields and types screen (the group's admins)
    function fieldsScreen() {
      return MS().settingsScreen({ sb, group, defs: st.defs, rows: st.directory, backButton: (label) => backButton(label),
        reload: async () => { const d = await MS().readDefinitions(sb, g); st.defs = d; await loadLists(); return d; } });
    }
    // M2: the Subscriptions and agreements screen (the group's admins), and marking the members shown invoiced or paid at once
    function subSettingsScreen() {
      return MS().m2SettingsScreen({ sb, group, m2: { years: st.defs.years, agreements: st.defs.agreements }, backButton: (label) => backButton(label),
        reload: async () => { await loadLists(); return { years: st.defs.years, agreements: st.defs.agreements }; } });
    }
    function openMark() {
      MS().markSheet({ sb, group, rows: shownMembers(), years: st.defs.years, year: st.filters.sub?.year || null, today: today(),
        opener: wrap.querySelector(".crm-title-actions .more-button"),
        done: async (notice) => {
          st.notice = notice; await loadLists();
          if (st.screen !== "directory") return;
          redrawDirectory();
          wrap.querySelector(".crm-title-actions .more-button")?.focus();   // back on the control that opened the sheet
        } });
    }
    // PH4: the one pattern for add forms: the name, an email and a phone first; the rest under More details
    function personFormScreen() {
      const f = st.form, { person: x, business: b, contact } = st.target, R = FP.formRows;
      // a contact (someone linked to no member): who they work for and what kind of contact; never for a member's person
      const asContact = !b && !!FP.membershipModel && (contact || (!!x && !(st.page?.person?.id === x.id && (st.page.businesses || []).some((y) => y.current))));
      const s = R.sheet({ form: true, page: true, title: x ? "Edit " + x.display_name : b ? "Add a person at " + b.business_name : contact ? "Add a contact" : "Add a person", saveLabel: x ? "Save" : "Add",
        className: "crm-form crm-person-form", onCancel: () => back() });
      const form = s.node, save = s.save;
      s.cancel.classList.add("crm-back");
      const one = (id, label, attrs = {}, hint = null) => (attrs.rows
        ? R.long({ id: "pf-" + id, key: id, label, value: f[id] ?? "", placeholder: attrs.placeholder || "", hint, attrs: { name: id, ...(attrs.inputmode ? { inputmode: attrs.inputmode } : {}) }, onInput: (v) => { f[id] = v; } })
        : R.text({ id: "pf-" + id, key: id, label, value: f[id] ?? "", placeholder: attrs.placeholder || "", max: attrs.maxlength || null, hint, attrs: { name: id, ...(attrs.list ? { list: attrs.list } : {}) }, onInput: (v) => { f[id] = v; } }));
      const errors = el("div", { class: "crm-errors fs-say", role: "alert" }, ...(st.errors || []).map((e) => el("p", {}, e)));
      if (!(st.errors || []).length) errors.hidden = true;
      const primary = b ? R.toggle({ id: "pf-is_primary", key: "is_primary", label: "Primary contact", checked: !!f.is_primary, onChange: (on) => { f.is_primary = on; } }) : null;
      const moreBox = R.more({ label: "More details", open: !!x, rows: [
        one("display_name", "Name shown", { maxlength: "200", placeholder: "Optional" }, "Leave empty to use the first and last name."),
        one("job_title", "Job title", { maxlength: "200", placeholder: "Or role" }),
        asContact ? one("organisation_name", "Organisation", { maxlength: "200", placeholder: "Environment Canterbury" }) : null,
        asContact ? one("contact_kind", "Kind", { maxlength: "40", list: "pf-kinds", placeholder: "Kind of contact" }) : null,
        b ? one("relationship", "Relationship", { maxlength: "60", placeholder: "owner, manager, contact" }) : null,
        primary,
        one("postal_address", "Postal", { rows: "2", placeholder: "Postal address" }),
        one("physical_address", "Physical", { rows: "2", placeholder: "Physical address" }),
        one("notes", "Notes", { rows: "3", placeholder: "Optional" }),
      ] });
      s.body.append(...[errors,
        contact ? R.quiet("Someone the group works with who is not a member, such as council staff, a funder or a contractor. Link them to a member later if that changes.", { class: "fs-quiet fs-lead-note" }) : null,
        R.set(one("given_name", "First name", { maxlength: "100" }), one("family_name", "Last name", { maxlength: "100" }),
          one("emails", "Email", { rows: "1", inputmode: "email", placeholder: "One per line" }), one("phones", "Phone", { rows: "1", inputmode: "tel", placeholder: "One per line" })),
        moreBox, asContact ? el("datalist", { id: "pf-kinds" }, ...MM().CONTACT_KINDS.map((k) => el("option", { value: k }))) : null].filter(Boolean));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { errors: problems, row, link } = M().toPerson(f);
        if (asContact && !problems.length) {   // M1b
          const org = String(f.organisation_name ?? "").trim().replace(/\s+/g, " "), kind = String(f.contact_kind ?? "").trim().replace(/\s+/g, " ").toLowerCase();
          if (org.length > 200) problems.push("The organisation is longer than 200 characters.");
          if (kind.length > 40) problems.push("The kind of contact is at most 40 characters.");
          Object.assign(row, { organisation_name: org || null, contact_kind: kind || null });
        }
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
        el("p", { class: "group-fine" }, "The member's name and number are the group's register (Manage → Members); these are the extra details."),
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
      const logger = el("select", { id: "feed-logger" }, el("option", { value: "" }, "Anyone"), ...st.team.filter((m) => M().canSee(m.role)).map((m) => el("option", { value: m.user_id, ...(f.logger === m.user_id ? { selected: true } : {}) }, m.name || "Someone without a name")));
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
          msg.textContent = what === "directory" ? M().plural(st.directory.length, "member", "members") + " exported." : M().plural(items.length, "interaction", "interactions") + " exported.";
        } catch (err) { msg.textContent = "Couldn't export: " + message(err); }
        e.target.disabled = false;
      };
      return el("div", { class: "crm-export" }, backButton(), el("h3", {}, "Export for reporting"),
        el("p", {}, "Download a spreadsheet (CSV) for a date range: the directory of members with how many interactions each had in the range, or every interaction in the range with who it was with."),
        el("div", { class: "crm-row-fields" }, el("div", { class: "crm-field" }, el("label", { for: "crm-export-from" }, "From"), from),
          el("div", { class: "crm-field" }, el("label", { for: "crm-export-to" }, "To"), to)),
        el("div", { class: "crm-actions" },
          el("button", { type: "button", class: "primary", "data-export": "directory", onclick: run("directory") }, "Directory (CSV)"),
          el("button", { type: "button", class: "secondary", "data-export": "interactions", onclick: run("interactions") }, "Interactions (CSV)")),
        msg,
        el("p", { class: "group-fine" }, "New Zealand dates. Cancelled entries are left out. A cell that starts with = + - or @ is written with an apostrophe in front, so a spreadsheet shows it as text. These files hold personal information: keep them where the group's records are kept."));
    }

    // PF1: the frame and controls at once, the lists filled in as they arrive (one read, however often the view is made).
    // From the Add button or an address: the form opens on its own at once (the lists come in behind it), and Back or Save
    // returns to where the person was.
    draw();
    if (entryTab === "log") openLog(null, []);
    else if (entryTab === "add-person") openPersonForm(null, null);
    else if (entryTab === "add-contact") openPersonForm(null, null, true);   // M1b
    else if (entryTab === "follow-ups") openFeed({ followUp: "open" });
    else if (entryTab === "review") openReviewHere();   // RV1
    if (entryTab) st.stack = [];
    if (opts.business) { openBusiness(opts.business); st.stack = []; }   // SG2: one business, opened from a sub-group's list
    loadLists(true).then(() => { if (st.screen === "review") draw(); else redrawDirectory(); });
    wrap.peopleRoute = route;   // PF1: group-space.js hands a later People address of the same group to this view
    return wrap;
  }

  // ---- entry points for the global Add button (UI1) ---------------------------------------------------------------------------------
  const go = (groupId, tab) => { root.location.hash = FP.href(G().href(groupId, "people", tab)); };
  const logInteraction = (groupId) => go(groupId, "log");
  const addPerson = (groupId) => go(groupId, "add-person");
  const addContact = (groupId) => go(groupId, "add-contact");   // M1b
  // Each: { key, label, shows(group) (the person's role allows it), run(group) }.
  const addEntries = [
    { key: "interaction", label: "Log an interaction", shows: (group) => M().canSee(group?.role), run: (group) => logInteraction(group.id) },
    { key: "person", label: "Add a person", shows: (group) => M().canSee(group?.role), run: (group) => addPerson(group.id) },
    { key: "contact", label: "Add a contact", shows: (group) => M().canSee(group?.role), run: (group) => addContact(group.id) },
  ];

  FP.groupPeople = { view, logInteraction, addPerson, addContact, addEntries, CAP, PAGE, countBadge, openingLists };
})(typeof window === "undefined" ? globalThis : window);
