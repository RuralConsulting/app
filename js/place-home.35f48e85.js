// J2: Home, the first section of a farm, a group and a sub-group, for everyone who can open the place (docs/PRODUCT.md): search,
// the add actions shown openly, the place's sections with one quiet line each, and anything waiting as one quiet line. No map, no
// to-do list, no feed, no chart. The words and the choices are place-home-model.js; this file reads and draws.
//
// Reads: none new, and none wider. Each is a read the section it belongs to already makes, as the signed-in person (row-level
// security and the functions' own rules decide what comes back), and only for a section the person can open:
//   documents             a head count for the Files line; the list (document-files.js readRows: counted, then at most that many,
//                         never over the API's 1,000) when the person first searches; a group's shared files (group_shared_documents)
//   published maps        maps-view.js listMaps (kept for a minute, so Maps opened next reads nothing again)
//   group_events          the next one (one row), and the group's events (events.js readEvents, counted and capped) when searched
//   People's lists        people.js openingLists (crm_directory, crm_people), only for People's roles, when searched
//   crm_feed_count, proposals   the follow-ups due and the items to review, only for People's roles (as the People tab counts them)
// A read that fails leaves its line or its kind out: Home never says "not available" or shows an error.
(function (root) {
  const FP = root.FP;
  const H = () => FP.placeHomeModel;
  const el = (...a) => FP.el(...a);
  const DOC_COLUMNS = "id,title,doc_type,date_prepared,original_name,status,tier";
  let places = { farms: [], groups: [] };
  let shown = null;   // the Home drawn now: { alive }
  function setPlaces(p) { places = { farms: Array.isArray(p?.farms) ? p.farms : [], groups: Array.isArray(p?.groups) ? p.groups : [] }; }
  const rows = (q) => Promise.resolve(q).then((r) => (r?.error ? [] : Array.isArray(r?.data) ? r.data : []), () => []);
  // (a head read's count; the demo's stand-in returns the rows instead)
  const headCount = (q) => Promise.resolve(q).then((r) => (r?.error ? null : Number.isInteger(r?.count) ? r.count : Array.isArray(r?.data) ? r.data.length : null), () => null);

  // opts: { space: "farm" | "group", place: { id, name, role, parent_org_id }, sections: [[key, label]] (the person's tabs here),
  //   people: whether People's lists are this person's (people-model canSeeTab), addCtx: the Add context or a promise of it,
  //   sb, today: "YYYY-MM-DD", search(view, q): the host fills that section's own search when it opens }
  function view(opts) {
    close();
    const { space, place } = opts, sb = opts.sb || FP.sb, group = space === "group";
    const model = group ? FP.groupModel : FP.farmModel, owner = group ? { org: place.id } : { farm: place.id }, match = group ? { org_id: place.id } : { farm_id: place.id };
    const sections = (opts.sections || []).filter(([k]) => k), keys = sections.map(([k]) => k), me = { alive: true };
    shown = me;
    const live = () => me.alive && shown === me;
    // the places the person could open from here: a group's sub-groups they are in (from the person's own groups, read at sign-in).
    // (Member farms are not offered: the group's functions name a member farm by an opaque reference, never its id.)
    const subgroups = group ? places.groups.filter((g) => g.parent_org_id === place.id) : [];
    const hasPlaces = subgroups.length > 0;
    const people = group && !!opts.people && keys.includes("people");
    const facts = {}, counts = {};
    const wrap = el("section", { class: "place-home", "data-view": "home", "data-space": space, "aria-label": "Home" });

    // ---- search -----------------------------------------------------------------------------------------------------------------
    const kinds = H().searchKinds({ space, sections, people, places: hasPlaces });
    let lists = null;
    function loadLists() {
      if (lists) return lists;
      const want = new Set(kinds);
      const files = want.has("files") ? Promise.all([
        FP.documentFiles.readRows(sb, match, DOC_COLUMNS).catch(() => []),
        group ? rows(sb.rpc("group_shared_documents", { group_id: place.id })) : [],
      ]).then(([own, shared]) => [...own, ...shared.map((d) => ({ ...d, shared: true }))]) : Promise.resolve([]);
      const maps = want.has("maps") ? Promise.resolve().then(() => FP.mapsView?.listMaps?.(owner) || []).catch(() => []) : Promise.resolve([]);
      const events = want.has("events") && FP.groupEvents ? FP.groupEvents.readEvents(sb, place.id).then((r) => r.events, () => []) : Promise.resolve([]);
      const ppl = want.has("people") && FP.groupPeople?.openingLists ? (() => {
        const l = FP.groupPeople.openingLists(sb, place.id);
        return Promise.all([Promise.resolve(l.directory).catch(() => []), Promise.resolve(l.people).catch(() => [])]).then(([directory, people]) => ({ directory, people }));
      })() : Promise.resolve(null);
      const plc = Promise.resolve(want.has("places") ? subgroups.map((g) => ({ kind: "group", id: g.id, name: g.name, note: "Sub-group" })) : []);
      lists = Promise.all([files, maps, events, ppl, plc]).then(([f, m, e, p, x]) => ({ files: f, maps: m, events: e, people: p, places: x }));
      return lists;
    }
    function go(open) {
      if (open.place) { root.location.hash = FP.href((open.place.kind === "farm" ? FP.farmModel : FP.groupModel).href(open.place.id, "home")); return; }
      if (open.view === "events" && open.event && FP.groupEvents?.open) { FP.groupEvents.open(place.id, open.event); return; }
      if (open.q != null) opts.search?.(open.view, open.q);
      root.location.hash = FP.href(group ? model.href(place.id, open.view, open.view === "maps" ? open.item || null : null) : model.href(place.id, open.view, open.item || null));
    }
    let searchBox = null, results = null, input = null;
    if (kinds.length) {
      input = el("input", { type: "search", id: "place-search", autocomplete: "off", spellcheck: "false", enterkeyhint: "search", placeholder: H().placeholder(space),
        "aria-label": H().searchLabel(kinds, place.name), "aria-controls": "place-results" });
      results = el("div", { id: "place-results", class: "ph-results", "aria-live": "polite", hidden: true });
      searchBox = el("div", { class: "ph-search", role: "search" }, FP.icon("search", 18), input);
      let asked = 0;
      const find = async () => {
        const q = input.value.trim(), mine = ++asked;
        wrap.classList.toggle("searching", !!q);
        results.hidden = !q;
        if (!q) { results.replaceChildren(); return; }
        if (!results.childElementCount) results.replaceChildren(el("p", { class: "ph-quiet", role: "status" }, "Looking…"));
        const got = await loadLists();
        if (!live() || mine !== asked) return;
        const found = H().search(got, q, kinds, { space, today: opts.today || null });
        results.replaceChildren(...(found.length ? found.map((g) => el("section", { class: "ph-group", "data-kind": g.kind },
          el("h2", {}, g.label, g.total > g.items.length ? el("small", {}, " · " + g.total) : null),   // (under the place's h1)
          el("ul", { class: "ph-rows" }, ...g.items.map((it) => el("li", {}, el("button", { type: "button", class: "ph-row", "data-result": g.kind, onclick: () => go(it.open) },
            el("span", { class: "ph-row-icon", "aria-hidden": "true" }, FP.icon(g.icon, 18)),
            el("span", { class: "ph-row-text" }, el("b", {}, it.title), it.note ? el("small", {}, it.note) : null),
            FP.icon("chevron", 16))))))) : [el("p", { class: "ph-quiet", role: "status" }, H().nothingFound(q))]));
      };
      const run = H().debounce(find, 180);
      input.addEventListener("input", run);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; run(); }
        // Enter: the search now (not after the pause), then the first thing found opens
        if (e.key === "Enter" && input.value.trim()) { e.preventDefault(); run.cancel(); find().then(() => results.querySelector(".ph-row")?.click()); }
      });
      // (a person who comes to search: the lists are asked for as soon as the field is touched, not per keystroke)
      input.addEventListener("focus", () => { loadLists(); }, { once: true });
    }

    // ---- the add actions (add.js's registry: what the + offers here) ----------------------------------------------------------------
    const addsBox = el("div", { class: "ph-adds", role: "group", "aria-label": "Add", hidden: true });
    Promise.resolve(opts.addCtx).then((ctx) => {
      if (!live() || !ctx) return;
      const items = H().adds(FP.add?.available?.(ctx) || []);
      addsBox.hidden = !items.length;
      addsBox.replaceChildren(...items.map((a) => el("button", { type: "button", class: "ph-add", "data-add-action": a.id, onclick: () => a.action.run(ctx) },
        el("span", { class: "ph-add-icon", "aria-hidden": "true" }, FP.icon(a.icon, 20)), el("span", {}, a.text))));
      if (!items.length) addsBox.remove();
    }, () => addsBox.remove());

    // ---- the sections, each with a quiet line ---------------------------------------------------------------------------------------
    const list = el("ul", { class: "ph-rows ph-sections-list" });
    const sectionsBox = el("nav", { class: "ph-sections", "aria-label": "Sections" }, list);
    function drawSections() {
      if (!live()) return;
      const items = H().shortcuts(sections, facts);
      list.replaceChildren(...items.map((s) => el("li", {}, el("a", { class: "ph-row", href: FP.href(model.href(place.id, s.key)), "data-section": s.key },
        el("span", { class: "ph-row-icon", "aria-hidden": "true" }, FP.icon(FP.icons?.forView(s.key) || "file", 18)),
        el("span", { class: "ph-row-text" }, el("b", {}, s.label), s.line ? el("small", {}, s.line) : null),
        FP.icon("chevron", 16)))));
      if (!items.length) sectionsBox.remove();
    }
    drawSections();
    if (keys.includes("maps")) Promise.resolve().then(() => FP.mapsView?.listMaps?.(owner) || null).then((m) => { if (Array.isArray(m)) { facts.maps = m.length; drawSections(); } }, () => {});
    if (keys.includes("documents")) headCount(sb.from("documents").select("id", { count: "exact", head: true }).eq(Object.keys(match)[0], place.id)).then((n) => { if (n != null) { facts.files = n; drawSections(); } });
    if (group && keys.includes("events")) {
      rows(sb.from("group_events").select("id,title,starts_at,ends_at,all_day,cancelled_at").eq("org_id", place.id).is("cancelled_at", null)
        .gte("starts_at", H().nzDayStart(opts.today || H().nzDay())).order("starts_at", { ascending: true }).range(0, 0))
        .then((r) => { facts.nextEvent = r[0] || null; drawSections(); });
    }

    // ---- anything waiting: one quiet line, for People's roles only, absent when empty -----------------------------------------------
    const waitingBox = el("p", { class: "ph-waiting", hidden: true });
    if (people) {
      const R = FP.reviewItemsModel;
      Promise.all([
        Promise.resolve(sb.rpc("crm_feed_count", FP.peopleModel.feedArgs(place.id, { followUp: "due" }))).then((r) => (r?.error ? null : Number(r?.data) || 0), () => null),
        R ? Promise.resolve(sb.from("proposals").select("id", { count: "exact", head: true }).eq("org_id", place.id).eq("kind", R.KIND).eq("status", "proposed"))
          .then((r) => (r?.error ? null : typeof r?.count === "number" ? r.count : Array.isArray(r?.data) ? R.openCount(R.items(r.data)) : null), () => null) : null,
      ]).then(([followUps, review]) => {
        if (!live()) return;
        Object.assign(counts, { followUps, review });
        const w = H().waiting(counts);
        if (!w) return;
        waitingBox.replaceChildren(...w.items.flatMap((it, i) => [...(i ? [el("span", { "aria-hidden": "true" }, " · ")] : []),
          el("a", { href: FP.href(model.href(place.id, it.view, it.tab)), "data-waiting": it.key }, it.text)]));
        waitingBox.hidden = false;
      });
    }

    wrap.append(...[searchBox, results, addsBox, sectionsBox, waitingBox].filter(Boolean));
    me.wrap = wrap;
    return wrap;
  }
  function close() { if (shown) shown.alive = false; shown = null; }

  FP.placeHome = { view, close, setPlaces };
})(typeof window === "undefined" ? globalThis : window);
