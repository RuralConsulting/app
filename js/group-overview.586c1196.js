// MC1, CO1: a group's overview on a computer (docs/PRODUCT.md, "Home"; docs/CATCHMENT-SPACE.md, "The overview"). On a computer a
// group's Home is this page: what the group's data says when it is brought together. A phone keeps Home as it is (place-home.js).
// CO1 (the owner, 14 Nov 2026: "way too much grey area", "I should be able to click on any of the subgroups", "the sub group, all sub
// groups is a bit of a duplication", "water quality is not a default"): the page fills the screen. Under Home's search, three zones fill
// the rest of the height, each scrolling inside itself: on the LEFT the group's sub-groups (all of them; one click selects one and the
// tiles and the map follow it, "Open" goes into it, "All sub-groups" clears it; the old Sub-group filter is gone); in the MIDDLE a tidy
// grid of tiles (numbers, one small chart where there is a real series, the next events), chosen per person under "Add a tile"; on the
// RIGHT the map, at least half the width, with its Layers folded to one button. A sub-group's own overview has no list: tiles and map.
// The words, the numbers and every choice are group-overview-model.js; this file reads and draws.
//
// Reads, each the signed-in person's own (row-level security and the functions' own rules decide what comes back), each bounded:
//   subgroup_counts(parent)      the group's current sub-groups, by name, and which the person is in (SG2; any member of the
//                                group). The number of businesses in each is NOT shown, to anyone.
//   places (kind area, current)  the areas of the group and of the sub-groups the person is in (counted, then at most that many)
//   group_wq_sites(org, 0)       the monitoring sites inside each of those areas (S5; at most 5,000 each)
//   wq_site_result_counts        MC1: per site, every result held and those of the five keys the card may ask about (150 sites a call,
//                                so an answer stays under the API's 1,000 rows)
//   analysis (preview, trend)    each surface-water site's indicative trend for the card's one measure, exactly as a site's panel
//                                in Maps asks (N2), only for sites whose record could make one; at most 4 at a time; nothing stored
//   group_members (head count)   the members, for the group's facilitators, advisors and admins only (People's roles)
//   For the group and every sub-group the person is in (`org_id in (...)`, one read per tile), or the one sub-group selected (CO1),
//   each read only while its tile is shown, once per set of places:
//   captures (head count, then at most 2,000 times, 1,000 a request)   records and photos this year, and how many a month
//   documents (head count)       the files held
//   group_events                 the next two, and head counts of those held this year (ended before now), for those with Events
//   proposals (head count)       the open review questions, for People's roles only (as Home's waiting line counts them)
//   core_layers + map-packages   the context layers' themes (N1), read and signed only when one is switched on
// A read that fails leaves its part out: the page never says "not available" and never shows an error.
(function (root) {
  const FP = root.FP;
  const O = () => FP.groupOverviewModel, S = () => FP.wqSitesModel;
  const el = (...a) => FP.el(...a);
  const list = (v) => (Array.isArray(v) ? v : []);
  const CONCURRENCY = 4, COUNT_BATCH = 150, AREA_CAP = 500, SITES_POOL = 4, LINK_SECONDS = 3600, BUCKET = "map-packages";
  const BASE_KEY = "fp-overview-basemap";   // the overview maps' background, remembered on this device (map-scene.js's own key)
  const LAYERS_KEY = "fp-overview-layers";  // CO1: the Layers panel open or folded, remembered on this device (folded by default)
  const CANTERBURY = [[170.6, -44.6], [174.1, -41.9]];
  const trendCache = new Map();   // analysis request -> Promise<class>, for this visit to the app (nothing is stored anywhere)
  let shown = null;

  const store = { get(k) { try { return root.localStorage?.getItem(k) ?? null; } catch { return null; } }, set(k, v) { try { root.localStorage?.setItem(k, v); } catch { /* kept for this visit */ } } };
  const rows = (q) => Promise.resolve(q).then((r) => (r?.error ? null : list(r?.data)), () => null);   // null: the read failed
  const headCount = (q) => Promise.resolve(q).then((r) => (r?.error ? null : Number.isInteger(r?.count) ? r.count : null), () => null);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const darkTheme = () => /dark/.test(getComputedStyle(document.documentElement).colorScheme || "") || !!root.matchMedia?.("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
  const reducedMotion = () => !!root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  async function pool(tasks, n) {
    const out = new Array(tasks.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
    return out;
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------------
  async function readSubgroups(sb, group, groups) {
    if (group.parent_org_id) return [];
    const got = await rows(sb.rpc("subgroup_counts", { parent_org: group.id }));
    const subs = got ? got.map((r) => ({ id: r.subgroup_id, name: r.subgroup_name, slug: r.subgroup_slug || null, member: !!r.is_member }))
      : list(groups).filter((g) => g.parent_org_id === group.id).map((g) => ({ id: g.id, name: g.name, slug: g.slug || null, member: true }));
    return subs.filter((s) => s.id && s.name).sort((a, b) => a.name.localeCompare(b.name, "en-NZ"));
  }
  async function readAreas(sb, ids) {
    if (!ids.length) return [];
    const where = (q) => q.eq("kind", "area").is("valid_to", null).in("org_id", ids);
    const n = await headCount(where(sb.from("places").select("id", { count: "exact", head: true })));
    if (n === 0) return [];
    return (await rows(where(sb.from("places").select("org_id,geom")).limit(Math.min(n ?? AREA_CAP, AREA_CAP)))) || [];
  }
  async function readCounts(sb, ids, since) {
    const batches = [];
    for (let i = 0; i < ids.length; i += COUNT_BATCH) batches.push(ids.slice(i, i + COUNT_BATCH));
    const got = await pool(batches.map((b) => () => rows(sb.rpc("wq_site_result_counts", { site_ids: b, parameter_keys: [...O().KEYS], ...(since ? { since } : {}) }))), 2);
    return got.some((g) => g === null) ? null : got.flat();
  }
  function askTrend(sb, body) {
    const k = S().requestKey(body);
    if (!trendCache.has(k)) {
      const p = Promise.resolve(FP.wqAnalysis.request(sb, body)).then((r) => S().trendClass(r), () => "failed");
      trendCache.set(k, p);
      p.then((c) => { if (c === "failed" && trendCache.get(k) === p) trendCache.delete(k); });   // a failure is asked again next time
    }
    return trendCache.get(k);
  }
  let pmtilesAdded = false;
  function pmtilesProtocol(gl) {
    if (pmtilesAdded || !root.pmtiles?.Protocol || !gl.addProtocol) return;
    gl.addProtocol("pmtiles", new root.pmtiles.Protocol().tile); pmtilesAdded = true;
  }

  // ---- the tiles (MC1's cards, CO1's tiles): a curated menu of ready-made tiles in one small registry (group-overview-model.js
  // createCards), like the Add registry. A tile is { id, title, group, line, order, off (not shown until added), wide (two columns),
  // can(viewer), load?(ctx, org), render(ctx, data) }: render gives the tile's body (its title is drawn for it), or null to leave the
  // tile out (a tile with nothing to show is not drawn). load reads for one place: the group, or the sub-group selected.
  // viewer: { group, groups, sections (the person's tabs here), coordinator, people, sub }.
  const cards = FP.groupOverviewModel.createCards();
  const quiet = (text) => el("p", { class: "ov-quiet" }, text);
  const cardLink = (href, text, onclick) => el("a", { class: "ov-card-link", href, ...(onclick ? { onclick } : {}) }, text, FP.icon ? FP.icon("chevron", 14) : null);
  const big = (value, unit) => el("p", { class: "ov-num" }, value, unit ? el("span", { class: "ov-unit" }, " " + unit) : null);
  const tileOf = (c, key) => c.O.tiles({ group: c.group, subgroups: c.subs, areas: c.areas, filter: c.filter, members: c.members }).find((t) => t.key === key) || null;
  // CO1 (the groups' own reports: headline numbers rebuilt for each audience did not agree): the tiles are one dated "group in
  // numbers". Each says what it counts and "as at" the day, so everyone quotes the same figure.
  const dayWords = (day) => { const t = Date.parse(String(day || "").slice(0, 10) + "T12:00:00Z"); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ""; };
  const asAt = (c) => { const d = dayWords(c.today || new Date().toISOString()); return d ? "as at " + d : ""; };
  const counted = (c, what) => quiet(what);   // (the day is said once, above the tiles: "... in numbers · as at 29 Oct 2026")
  const since1Jan = (c, what) => quiet(what + " 1 Jan to " + (dayWords(c.today || new Date().toISOString()) || "today"));
  const nzYearStart = (c) => FP.placeHomeModel?.nzDayStart?.(String(c.today || new Date().toISOString()).slice(0, 4) + "-01-01") || null;
  cards.register({ id: "subgroups", title: "Sub-groups", group: "About the group", order: 10, lead: true, line: "How many sub-groups the group has", can: (v) => !v.sub,
    render(c) {
      const t = tileOf(c, "subgroups");
      if (!t || c.filter.sub) return null;   // (a sub-group selected: its own numbers only)
      return [big(t.value), counted(c, t.note || "Listed on the left")];
    } });
  cards.register({ id: "area", title: "Area", group: "About the group", order: 20, lead: true, line: "The area of the group, or of the sub-group selected",
    render(c) {
      const t = tileOf(c, "area");
      if (!t) return null;
      return [big(t.value.replace(/ ha$/, ""), "ha"), counted(c, c.filter.sub || c.group.parent_org_id ? "The sub-group's boundary" : t.note || "From the boundaries held")];
    } });
  cards.register({ id: "members", title: "Members", group: "About the group", order: 30, lead: true, line: "The group's current members (coordinators)", can: (v) => !!v.coordinator,
    render(c) {
      const t = tileOf(c, "members");
      if (!t || c.filter.sub) return null;   // (members are not counted per sub-group: SG2 shows no sub-group's business count)
      return [big(t.value), counted(c, "Current members")];
    } });
  cards.register({ id: "records", title: "Records and photos this year", group: "Activity", order: 40, wide: true,
    line: "How many were taken this year, month by month",   // (for anyone here: row-level security decides which they see)
    async load(c, orgs) {
      const from = nzYearStart(c);
      if (!from) return null;
      const where = (q) => q.in("org_id", orgs).is("archived_at", null).gte("taken_at", from);
      const n = await headCount(where(c.sb.from("captures").select("id", { count: "exact", head: true })));
      if (n === null) return null;
      // (#544 review: the API gives at most 1,000 rows a request, so pages of 1,000 up to the cap; over the cap, or a short read, the
      // number alone, never a cut-off chart)
      const times = [];
      for (const [a, b] of c.O.recordPages(n)) {
        const got = await rows(where(c.sb.from("captures").select("taken_at")).order("taken_at", { ascending: true }).range(a, b));
        if (!got) return { n, series: null };
        times.push(...got.map((r) => r.taken_at));
      }
      return { n, series: c.O.wholeSeries(times, n, c.today || new Date().toISOString()) };
    },
    render(c, d) {
      if (d === undefined) return [quiet("Counting…")];
      if (!d || !d.n) return null;
      return [big(c.O.count(d.n)), d.series && d.series.length ? monthChart(d.series) : null, since1Jan(c, "Those you can see, taken")].filter(Boolean);
    } });
  const TZ = "Pacific/Auckland";
  const eventDay = (t) => { const d = Date.parse(t); return Number.isFinite(d) ? new Date(d).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).replace(",", "") : ""; };
  cards.register({ id: "coming", title: "Coming up", group: "Activity", order: 50, line: "The next two events", can: (v) => v.sections.includes("events"),
    async load(c, orgs) {
      const from = FP.placeHomeModel?.nzDayStart?.(String(c.today || new Date().toISOString()).slice(0, 10)) || new Date().toISOString();
      return rows(c.sb.from("group_events").select("id,title,starts_at,all_day,place_name,cancelled_at").in("org_id", orgs).is("cancelled_at", null).gte("starts_at", from)
        .order("starts_at", { ascending: true }).range(0, 1));
    },
    render(c, d) {
      if (d === undefined) return [quiet("Reading the calendar…")];
      if (!d || !d.length) return null;   // couldn't be read, or nothing coming: left out, never an error
      return [el("ul", { class: "ov-events" }, ...d.map((e) => el("li", {}, el("b", {}, eventDay(e.starts_at)), el("span", {}, e.title || "Event", e.place_name ? el("small", {}, e.place_name) : null)))),
        cardLink(c.href("events"), "All events")];
    } });
  cards.register({ id: "held", title: "Events this year", group: "Activity", order: 60, line: "How many events were held since 1 January", can: (v) => v.sections.includes("events"),
    // (#544 review: held means ended before now; an event with no end is held once its day is over)
    async load(c, orgs) {
      const day = String(c.today || new Date().toISOString()).slice(0, 10), next = new Date(Date.parse(day + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
      const from = nzYearStart(c), today = FP.placeHomeModel?.nzDayStart?.(day) || null, tomorrow = FP.placeHomeModel?.nzDayStart?.(next) || null;
      if (!from || !today || !tomorrow) return null;
      // (now, but never past the end of the page's day, so a page's numbers all speak of the same day)
      const now = new Date(Math.min(Date.now(), Date.parse(tomorrow))).toISOString();
      const base = () => c.sb.from("group_events").select("id", { count: "exact", head: true }).in("org_id", orgs).is("cancelled_at", null).gte("starts_at", from);
      const [ended, open] = await Promise.all([headCount(base().lt("ends_at", now)), headCount(base().is("ends_at", null).lt("starts_at", today))]);
      return ended === null || open === null ? null : ended + open;
    },
    render(c, d) {
      if (d === undefined) return [quiet("Counting…")];
      if (!d) return null;
      return [big(c.O.count(d)), since1Jan(c, "Held")];
    } });
  cards.register({ id: "files", title: "Files", group: "About the group", order: 70, line: "How many files are held", can: (v) => v.sections.includes("documents"),
    async load(c, orgs) { return headCount(c.sb.from("documents").select("id", { count: "exact", head: true }).in("org_id", orgs)); },
    render(c, d) {
      if (d === undefined) return [quiet("Counting…")];
      if (!d) return null;
      return [big(c.O.count(d)), counted(c, "Held"), cardLink(c.href("documents"), "Open Files")];
    } });
  cards.register({ id: "review", title: "To review", group: "Activity", order: 80, line: "How many questions about the register wait for an answer (coordinators)",
    can: (v) => !!v.people && v.sections.includes("people"),
    async load(c, orgs) {
      const R = FP.reviewItemsModel;
      if (!R) return null;
      return headCount(c.sb.from("proposals").select("id", { count: "exact", head: true }).in("org_id", orgs).in("kind", R.KINDS).eq("status", "proposed"));
    },
    render(c, d) {
      if (d === undefined) return [quiet("Counting…")];
      if (!d) return null;
      return [big(c.O.count(d)), counted(c, d === 1 ? "Question waiting" : "Questions waiting"), cardLink(c.href("people", "review"), "Open To review")];
    } });
  cards.register({ id: "wqsites", title: "Water quality sites", group: "Water", order: 90, off: true, line: "The monitoring sites inside the boundaries, and their samples",
    render(c) {
      if (!c.loaded) return [quiet("Reading the monitoring sites…")];
      const w = c.O.wqCard({ scope: c.scope, classes: new Map(), filter: c.filter, plan: null });
      if (!w) return null;
      return [big(c.O.count(c.scope.length)), counted(c, w.line.replace(/^[\d,]+ sites? · /, ""))];
    } });
  cards.register({ id: "water", title: "Water quality", group: "Water", order: 100, off: true, wide: true,
    line: "The main trend in one sentence, and the way to the detail",
    render(c) {
      if (!c.loaded) return [quiet("Reading the monitoring sites…")];
      const w = c.O.wqCard({ scope: c.scope, classes: c.classes, filter: c.filter, plan: c.plan });
      const link = c.O.waterQualityLink(c.group.id, (id, view) => FP.href(FP.groupModel.href(id, view)));
      if (!w) return c.areas.size ? [quiet(c.sitesRead ? "No water quality monitoring sites lie inside the boundaries held." : "The monitoring sites will show here."), cardLink(link.href, "Open water quality", link.opensPanel ? c.waterQuality : null)]
        : [quiet("Once a boundary is held, the monitoring sites inside it show here.")];
      // WQV1: the Water quality page's own sentence and bar (LAWA's 10-year trends, the one class it shows), always read from this group,
      // with the sub-group selected picked out as the page does
      const s = c.wqSummary(c.filter.sub || null);
      if (s !== null) return [s ? el("p", { class: "ov-sentence", id: "ov-wq-sentence" }, s.sentence) : el("p", { class: "ov-quiet ov-working", id: "ov-wq-sentence", role: "status" }, "Reading LAWA's trends…"),
        s && s.bar.length ? FP.wqPage.miniBar(s.bar) : null, s?.basis ? quiet(s.basis) : null, s?.noArea ? null : quiet(w.line),
        cardLink(s?.href || link.href, "Open water quality")].filter(Boolean);
      // (without the page's code, MC1's own indicative trends)
      return [w.pending ? el("p", { class: "ov-quiet ov-working", id: "ov-wq-sentence", role: "status" }, w.sentence) : el("p", { class: "ov-sentence", id: "ov-wq-sentence" }, w.sentence),
        !w.pending && w.band && w.band.assessed ? c.bar(w.band) : null, quiet(w.line),
        ...(!w.pending && w.band ? [quiet("Indicative trends over the last " + w.years + " years, worked out as on each site's page."), ...w.notes.map(quiet)] : []),
        cardLink(link.href, "Open water quality", link.opensPanel ? c.waterQuality : null)].filter(Boolean);
    } });
  // A small column chart of a real monthly series: one quiet ink tone, thin columns with rounded tops on one baseline, the months under
  // it, each column's count on hover (its title) and for a screen reader (the list's own words)
  function monthChart(series) {
    const most = Math.max(1, ...series.map((m) => m.n));
    return el("ol", { class: "ov-chart", "aria-label": "By month: " + series.map((m) => m.label + " " + m.n).join(", ") },
      ...series.map((m) => el("li", { title: m.label + ": " + m.n },
        el("i", { style: "height: " + (m.n ? Math.max(4, Math.round((m.n / most) * 100)) : 0) + "%", "aria-hidden": "true" }), el("span", { "aria-hidden": "true" }, m.label.slice(0, 1)))));
  }

  // ---- the page ------------------------------------------------------------------------------------------------------------
  // opts: { group, groups (the person's), person, sb, today, home (place-home.js's options, for its search) }
  function view(opts) {
    close();
    const { group, groups = [], person = null } = opts, sb = opts.sb || FP.sb;
    const me = { alive: true, map: null, offs: [] };
    shown = me;
    const live = () => me.alive && shown === me;
    const now = Date.parse(String(opts.today || "").slice(0, 10) + "T12:00:00Z") || Date.now();
    const P = FP.mapPalette;
    let subs = [], A = new Map(), all = [], sitesRead = true, members = null, loaded = false, classes = new Map(), plan = null, token = 0;
    const counts = new Map();   // period key -> rows of wq_site_result_counts (all time)
    const key = O().storeKey(person?.id, group.id);
    // CO1: the selection (the sub-group chosen in the list or on the map) is remembered as the old filter was; the period is no longer
    // offered (nothing on the page by default used it, and the Water quality page has its own), so it is always all time
    let filter = { ...O().filterFrom(store.get(key), []), period: "all" };
    const hrefOf = (id) => FP.href(FP.groupModel.href(id, "home"));
    const subName = (id) => subs.find((s) => s.id === id)?.name || "";
    const isSub = !!group.parent_org_id;

    // -- the head: Home's search (compact)
    const search = FP.placeHome?.view ? FP.placeHome.view({ ...(opts.home || {}), compact: true }) : null;
    const head = el("div", { class: "ov-head" }, search || el("span"));
    // -- LEFT: the sub-groups (a group with sub-groups only)
    const listBox = el("nav", { class: "ov-list", "aria-label": "Sub-groups", hidden: true });
    // -- MIDDLE: the tiles
    const cardsBox = el("div", { class: "ov-cards ov-tiles-grid", "aria-label": "Tiles" });
    const addCard = el("button", { type: "button", class: "ov-add-card", id: "ov-add-card", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: () => picker() },
      FP.icon ? FP.icon("plus", 16) : "+", el("span", {}, "Add a tile"));
    // "Copy as text": the numbers shown, with their day, ready to paste into a report (the research: one set of numbers for everyone)
    const copyText = el("button", { type: "button", class: "ov-add-card", id: "ov-copy", onclick: () => copyNumbers() }, el("span", {}, "Copy as text"));
    const scopeLine = el("p", { class: "ov-scope", role: "status" });
    // the headline (the owner: "The top looks okay"): the group's own numbers, Sub-groups, Area and Members, in one row across the top
    // of the tiles and the map, as MC1's top row spanned the page; with a sub-group selected, its name and its own figures
    const leadBox = el("div", { class: "ov-lead", role: "group", "aria-label": "The group in numbers" });
    const headline = el("div", { class: "ov-headline" }, scopeLine, leadBox);
    const side = el("div", { class: "ov-side" }, el("div", { class: "ov-tiles-box" }, cardsBox), el("div", { class: "ov-tools" }, addCard, copyText));
    function numbersText() {
      const day = String(opts.today || "").slice(0, 10), when = day ? new Date(day + "T12:00:00Z").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
      const lines = [...leadBox.querySelectorAll(".ov-card"), ...cardsBox.querySelectorAll(".ov-card")].map((n) => {
        const v = n.querySelector(".ov-num"), what = n.querySelector(".ov-quiet")?.textContent.trim();
        return v ? n.querySelector("h2").textContent + ": " + v.textContent.replace(/\s+/g, " ").trim() + (what ? " (" + what + ")" : "") : null;
      }).filter(Boolean);
      return lines.length ? [group.name + ". " + O().scopeWords({ name: group.name, isSub, subgroups: subs, selectedName: filter.sub ? subName(filter.sub) : null }) + (when ? ", as at " + when : ""), ...lines].join("\n") : "";
    }
    async function copyNumbers() {
      const text = numbersText();
      if (!text) return;
      try { await root.navigator.clipboard.writeText(text); copyText.firstChild.textContent = "Copied"; setTimeout(() => { copyText.firstChild.textContent = "Copy as text"; }, 1600); } catch { /* the browser refused: nothing said */ }
    }
    // -- RIGHT: the map, with its one Layers panel (folded to a button by default)
    const mapHost = el("div", { class: "ov-map", id: "ov-map", role: "region", "aria-label": "Map of " + group.name });
    const mapNote = el("p", { class: "ov-map-note", role: "status", hidden: true });
    const layersToggle = el("button", { type: "button", id: "ov-layers-toggle", class: "ov-layers-toggle", "aria-expanded": "false", "aria-controls": "ov-layers" }, FP.icon ? FP.icon("layers", 18) : null, el("span", {}, "Layers"),
      el("span", { class: "ov-layers-x", "aria-hidden": "true" }, FP.icon ? FP.icon("close", 14) : "×"));
    const bgBox = el("div", { class: "ov-bg", role: "group", "aria-label": "Background" });
    const showBox = el("div", { class: "ov-shows" });
    const legendBox = el("ul", { class: "ov-legend", "aria-label": "Key" });
    const layersBody = el("div", { id: "ov-layers", class: "ov-layers-body" }, bgBox, showBox, legendBox);
    const layersPanel = el("div", { class: "ov-layers" }, layersToggle, layersBody);
    const mapBox = el("div", { class: "ov-mapbox" }, mapHost, layersPanel, mapNote);
    const main = el("div", { class: "ov-main" + (isSub ? " no-list" : "") }, listBox, headline, side, mapBox);
    const wrap = el("section", { class: "group-overview", "data-view": "home", "aria-label": "Home", "aria-busy": "true" }, head, main);

    // ---- drawing ---------------------------------------------------------------------------------------------------------
    const scope = () => O().inScope(all, filter);
    // the sub-groups down the left: "All sub-groups" first, then each one (one the person is in selects on a click, and, selected, shows
    // "Open"; one they are not in is quieter and not clickable, as on a phone), sorted as chosen
    function drawList() {
      listBox.hidden = isSub || !subs.length;
      main.classList.toggle("no-list", listBox.hidden);
      if (listBox.hidden) return;
      const sortBy = ["name", "area", "results"].includes(filter.sort) ? filter.sort : "name";
      const sort = el("select", { id: "ov-sort", "aria-label": "Sort the sub-groups by", onchange: (e) => { filter.sort = e.target.value; save(); drawList(); } },
        ...[["name", "Name"], ["area", "Area"], ["results", "Samples"]].map(([k, t]) => el("option", { value: k, ...(k === sortBy ? { selected: true } : {}) }, t)));
      const rowsOf = O().subgroupRows(subs, A, all, classes, null, sortBy);
      const total = O().hectares(A.get(group.id)?.ha);
      // (#544 review: the list is drawn again on a choice; keyboard focus stays where it was, on the same row or control, so Enter
      // selects a row and Enter again opens it)
      const active = listBox.contains(document.activeElement) ? document.activeElement : null, hadRow = active?.dataset?.row || null, hadId = active?.id || null;
      const allRow = el("li", {}, el("button", { type: "button", class: "ov-row ov-all" + (filter.sub ? "" : " chosen"), id: "ov-all", "aria-pressed": String(!filter.sub), onclick: () => select(null) },
        el("span", { class: "ov-row-text" }, el("b", {}, "All sub-groups"), el("small", {}, [O().plural(subs.length, "sub-group", "sub-groups"), total].filter(Boolean).join(" · ")))));
      listBox.replaceChildren(el("div", { class: "ov-list-head" }, el("h2", {}, "Sub-groups"), el("label", { class: "ov-field ov-sort" }, el("span", {}, "Sort"), sort)),
        el("ol", { class: "ov-rows" }, allRow, ...rowsOf.map((x) => {
          const line = [x.area || (x.member ? "No boundary held yet" : "Not one of your places"), x.sites ? O().plural(x.sites, "site", "sites") : null, x.results ? O().plural(x.results, "sample", "samples") : null].filter(Boolean).join(" · ");
          const chosen = filter.sub === x.id;
          const hover = { onmouseenter: () => highlight(x.id), onmouseleave: () => highlight(null), onfocus: () => highlight(x.id), onblur: () => highlight(null) };
          const inner = [el("span", { class: "ov-swatch", style: "--sw: " + hueOf(x.id), "aria-hidden": "true" }), el("span", { class: "ov-row-text" }, el("b", {}, x.name), el("small", {}, line))];
          if (!x.member) return el("li", {}, el("div", { class: "ov-row off", "data-row": x.id, "aria-disabled": "true", ...hover }, ...inner));
          return el("li", { class: chosen ? "chosen" : "" }, el("button", { type: "button", class: "ov-row" + (chosen ? " chosen" : ""), "data-row": x.id, "aria-pressed": String(chosen), onclick: () => (chosen ? open(x.id) : select(x.id)), ...hover }, ...inner),
            chosen ? el("a", { class: "ov-open", id: "ov-open", href: hrefOf(x.id), "aria-label": "Open " + x.name }, "Open", FP.icon ? FP.icon("chevron", 14) : null) : null);
        })));
      const back = hadRow ? listBox.querySelector('button[data-row="' + hadRow + '"]') : hadId ? listBox.querySelector("#" + hadId) : null;
      if (back) back.focus({ preventScroll: true });
    }
    // Escape in the list clears the choice ("All sub-groups"), as on the map
    listBox.addEventListener("keydown", (e) => { if (e.key === "Escape" && filter.sub) { e.preventDefault(); select(null); listBox.querySelector("#ov-all")?.focus(); } });
    const save = () => store.set(key, O().filterText(filter));
    // choosing a sub-group (in the list or on the map): the tiles and the map follow it; a second click on it (or its row's Open) goes
    // into it; "All sub-groups" clears it (the owner, 14 Nov 2026: on a computer the first click filters, the second opens; a phone
    // goes straight in, PH5)
    const open = (id) => { if (subs.some((s) => s.id === id && s.member)) root.location.hash = hrefOf(id); };
    function select(id) {
      const sub = id ? subs.find((s) => s.id === id && s.member) : null;
      if (id && !sub) return;
      setFilter({ sub: sub ? sub.id : null }, true);
    }
    // ---- the tiles ---------------------------------------------------------------------------------------------------------
    const isCoordinator = !group.parent_org_id && !!FP.peopleModel?.canSee?.(group.role);
    const sections = (opts.home?.sections || []).map((x) => (Array.isArray(x) ? x[0] : x));
    const viewer = { group, groups, sections, coordinator: isCoordinator, people: !!FP.peopleModel?.canSeeTab?.(group, groups), sub: isSub };
    const cardData = new Map();   // "tile|place" -> what its load gave (read once per place)
    const org = () => filter.sub || group.id;
    // the places the tiles read for (#544 review): one selected sub-group's own, else the group and every sub-group the person is in
    const orgs = () => O().orgsInScope(group.id, subs, filter.sub || null);
    const ctx = () => ({ group, subs, areas: A, sites: all, scope: scope(), classes, plan, filter, loaded, sitesRead, members, el, O: O(), bar, hrefOf, sb, today: opts.today || null, now,
      href: (view, tab) => FP.href(FP.groupModel.href(org(), view, tab || null)), waterQuality: () => { wqIntent = true; }, wqSummary });
    // WQV1: the Water quality page's summary for this group, or for one of its sub-groups picked out of this group's sites, once per choice
    const wqSums = new Map();
    function wqSummary(sub) {
      if (!FP.wqPage?.summary) return null;
      const k = sub || "";
      if (!wqSums.has(k)) {
        wqSums.set(k, undefined);
        FP.wqPage.summary(sb, group.id, { sub, today: String(opts.today || "").slice(0, 10) || null }).then((x) => x, () => false).then((x) => { wqSums.set(k, x); if (live()) drawCards(); });
      }
      const x = wqSums.get(k);
      if (x === false) return { sentence: "The trends couldn't be read just now.", bar: [], basis: null, href: null };
      return x?.noArea ? { ...x, sentence: "This sub-group's boundary is not one you can see, so its sites are not picked out here." } : x;
    }
    let layout = O().layoutFrom(store.get(O().cardsKey(person?.id, group.id)), cards.available(viewer));
    const saveLayout = () => store.set(O().cardsKey(person?.id, group.id), O().layoutText(layout));
    function drawCards() {
      const c = ctx(), nodes = [], lead = [];
      for (const id of O().shownCards(layout)) {
        const def = cards.get(id);
        if (!def || !cards.available(viewer).includes(def)) continue;
        let body = null;
        try { body = def.render(c, def.load ? cardData.get(id + "|" + orgs().join(",")) : undefined); } catch { body = null; }
        if (!body) continue;   // a tile with nothing to say right now is left out, never an error
        (def.lead ? lead : nodes).push(el("section", { class: "ov-card" + (def.wide ? " wide" : ""), "data-card": id, "aria-labelledby": "ov-card-h-" + id }, el("h2", { id: "ov-card-h-" + id }, def.title), ...[].concat(body)));
      }
      leadBox.replaceChildren(...lead);
      leadBox.hidden = !lead.length;
      cardsBox.replaceChildren(...nodes);
      cardsBox.parentElement.hidden = !nodes.length;
      copyText.hidden = !leadBox.querySelector(".ov-num") && !cardsBox.querySelector(".ov-num");
      const c0 = ctx();
      scopeLine.textContent = [O().scopeWords({ name: group.name, isSub, subgroups: subs, selectedName: filter.sub ? subName(filter.sub) : null }), asAt(c0)].filter(Boolean).join(" · ");
      scopeLine.hidden = !scopeLine.textContent;
    }
    function picker() {
      const holder = el("div", { class: "ov-picker" });
      const draw = () => {
        const groupsOf = O().pickerGroups(cards.available(viewer), layout), order = O().shownCards({ order: layout.order, hidden: [] });
        holder.replaceChildren(...groupsOf.map((g) => el("section", { class: "ov-picker-group" }, el("h3", {}, g.name),
          el("ul", { class: "ov-picker-list" }, ...g.cards.map((c) => {
            const at = order.indexOf(c.id);
            return el("li", { "data-pick": c.id },
              el("label", { class: "ov-pick" }, el("input", { type: "checkbox", id: "ov-pick-" + c.id, ...(c.shown ? { checked: true } : {}),
                onchange: (e) => { layout = O().toggleCard(layout, c.id, e.target.checked); saveLayout(); drawCards(); draw(); holder.querySelector("#ov-pick-" + c.id)?.focus();
                  if (e.target.checked) { loadCards(); if (c.id === "water" && loaded && !plan) startTrends(); } } }),
                el("span", {}, el("b", {}, c.title), el("small", {}, c.line))),
              el("span", { class: "ov-pick-move" },
                el("button", { type: "button", class: "ov-move", title: "Move up", "aria-label": "Move " + c.title + " up", ...(at <= 0 ? { disabled: true } : {}),
                  onclick: () => { layout = O().moveCard(layout, c.id, -1); saveLayout(); drawCards(); draw(); holder.querySelector('[aria-label="Move ' + c.title + ' up"]:not([disabled])')?.focus(); } }, "↑"),
                el("button", { type: "button", class: "ov-move", title: "Move down", "aria-label": "Move " + c.title + " down", ...(at >= order.length - 1 ? { disabled: true } : {}),
                  onclick: () => { layout = O().moveCard(layout, c.id, 1); saveLayout(); drawCards(); draw(); holder.querySelector('[aria-label="Move ' + c.title + ' down"]:not([disabled])')?.focus(); } }, "↓")));
          })))), el("p", { class: "ov-quiet" }, "Saved for you on this device. A tile with nothing to show is left out."));
      };
      draw();
      const node = FP.sheet?.open({ opener: addCard, title: "Tiles on this overview", className: "ov-picker-sheet", body: () => holder });
      const panel = node?.querySelector(".add-panel"), r = panel?.getBoundingClientRect();
      if (panel && r && r.bottom > root.innerHeight - 12) panel.style.top = Math.max(12, root.innerHeight - r.height - 12) + "px";
    }
    // a tile's own read is made only while the tile is shown, once per place (the group, or the sub-group selected)
    const isShown = (id) => O().shownCards(layout).includes(id) && cards.available(viewer).some((d) => d.id === id);
    async function loadCards() {
      const c = ctx(), set = orgs(), at = set.join(",");
      await Promise.all(cards.available(viewer).filter((d) => typeof d.load === "function" && isShown(d.id) && !cardData.has(d.id + "|" + at)).map(async (d) => {
        const k = d.id + "|" + at;
        cardData.set(k, undefined);
        try { cardData.set(k, await d.load(c, set)); } catch { cardData.set(k, null); }
        if (live()) drawCards();
      }));
    }
    // A stacked bar of a band's classes (the assessed sites; too little data is said in words, not drawn)
    function bar(b, small = false) {
      const parts = O().BAR.filter((k) => b[k] > 0);
      return el("span", { class: "ov-bar" + (small ? " small" : ""), "aria-hidden": "true" },
        ...(parts.length ? parts.map((k) => el("i", { "data-cls": k, style: "flex-grow: " + b[k] })) : [el("i", { "data-cls": "none", style: "flex-grow: 1" })]));
    }
    function badge(sub) {
      const logo = FP.groupModel?.groupLogo?.(sub);
      return el("span", { class: "ov-badge", style: "--ring: " + hueOf(sub.id), "aria-hidden": "true" }, logo ? el("img", { src: logo.src, alt: "" }) : FP.icons?.monogram(sub.name) || "");
    }
    // (PH5: a sub-group's own fill colour, the same on every map; CO1's list swatches use it too)
    const hueOf = (id) => (id !== group.id && P?.subgroupColours && subColour(id) ? subColour(id) : P ? P.look(P.hues(css)[P.hueIndex(id)], { sub: true, onDark: onDark() }).line : "currentColor");
    function drawNote() {
      // the calm line, on the map, when no boundary is held
      const line = loaded ? O().emptyLine({ areas: A, sites: all, filter, sitesRead }) : null, onMap = !!line && /^No boundary/.test(line);
      mapNote.textContent = onMap ? line : ""; mapNote.hidden = !onMap;
    }

    // ---- the map ---------------------------------------------------------------------------------------------------------
    const gl = root.maplibregl;
    let map = null, base = null, markers = [], hover = null, popup = null, framedKey = null;
    const choices = () => { const n = FP.basemaps?.names || []; return n.length >= 2 ? n : FP.demo?.active ? ["aerial", "topo"] : []; };
    const onDark = () => (base === "aerial" && (FP.basemaps?.names || []).includes("aerial")) || darkTheme();
    const show = { subs: true, sites: false };   // the water quality sites are off on the overview, on in the Layers panel
    const themes = { list: null, layersOn: new Set(), added: new Set() };
    // PH5: the sub-groups told apart by fill (map-palette.js subgroupColours: the same colours as Home on a phone and the Maps tab), a
    // hairline of the same hue, no casing; the group's own edge quiet, as the mask shows it
    let colourKey = null, colours = new Map();
    const subColour = (id) => {
      const key = [...A.keys()].join() + "|" + subs.map((s) => s.id).join();
      // (every sub-group, with an area or not, keyed by its id, as Home and the Maps tab colour them)
      if (key !== colourKey && P?.subgroupColours) {
        colourKey = key;
        const list = subs.length ? subs.map((s) => ({ key: s.id, name: s.name, geometry: A.get(s.id)?.shape.geometry || null }))
          : [...A].filter(([k]) => k !== group.id).map(([k, a]) => ({ key: k, name: subName(k) || k, geometry: a.shape.geometry }));
        colours = P.subgroupColours(list);
      }
      return colours.get(subName(id) || id) || null;
    };
    function areaData() {
      const sc = filter.sub ? [filter.sub] : null, f = [];
      for (const [id, a] of A) {
        const own = id === group.id, hue = P ? P.hues(css)[P.hueIndex(id)] : "#888888", look = P ? P.look(hue, { sub: !own, onDark: onDark() }) : { line: hue, casing: "#ffffff", lineWidth: 1.2 };
        const sub = !own && P?.subgroupLook ? P.subgroupLook(subColour(id) || hue, { onDark: onDark() }) : null;
        f.push({ type: "Feature", geometry: a.shape.geometry, properties: { id, own, name: own ? group.name : subName(id), line: sub ? sub.line : onDark() ? "#ffffff" : look.line, fill: sub ? sub.fill : look.fill || hue, casing: look.casing,
          lw: own ? 1 : sub ? sub.lineWidth : 1.2, lo: own ? 0.7 : 0.9, fo: own ? 0 : sub ? sub.fillOpacity : 0.07, dim: sc && !sc.includes(id) && !own ? 1 : 0 } });
      }
      return { type: "FeatureCollection", features: f };
    }
    // PH5: the outside of the group under the mask (its own area's outer edge; else all its sub-groups' together)
    function maskData() {
      const own = A.get(group.id), geoms = own ? [own.shape.geometry] : [...A.values()].map((a) => a.shape.geometry);
      const polys = geoms.flatMap((g) => (g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : []));
      if (!polys.length || !FP.phoneModel?.outlineFor || !P?.outsideMask) return { type: "FeatureCollection", features: [] };
      return P.outsideMask(FP.phoneModel.outlineFor({ type: "MultiPolygon", coordinates: polys }, { key: "ov-" + group.id })) || { type: "FeatureCollection", features: [] };
    }
    function siteData() {
      const sel = scope().filter((s) => s.lngLat && s.current);   // N2c's useful sites
      return { type: "FeatureCollection", features: sel.map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: s.lngLat }, properties: { id: s.id, name: s.name, cls: "plain" } })) };
    }
    const clsColours = () => ({ improving: css("--map-hue-2") || "#3fae8c", indeterminate: css("--map-hue-7") || "#8f9bb3", degrading: css("--map-hue-6") || "#d98879", quiet: css("--map-wq") || "#0a8fd6", older: css("--map-wq-older") || "#7f95a3" });
    function paint() {
      if (!map?.getLayer("ov-sites")) return;
      const c = clsColours();
      map.setPaintProperty("ov-sites", "circle-color", ["match", ["get", "cls"], "improving", c.improving, "indeterminate", c.indeterminate, "degrading", c.degrading, "plain", c.quiet, c.older]);
      map.setPaintProperty("ov-sites", "circle-stroke-color", onDark() ? "#1c1c1e" : "#ffffff");
      if (map.getLayer("bm-blank")) map.setPaintProperty("bm-blank", "background-color", css("--map-background") || "#e4e6e2");
      if (map.getLayer("ov-veil")) {
        map.setPaintProperty("ov-veil", "background-color", css("--map-background") || "#e4e6e2");
        map.setPaintProperty("ov-veil", "background-opacity", base === "aerial" ? 0 : 0);
      }
      map.getSource("ov-areas")?.setData(areaData());
      for (const m of markers) m.node.style.setProperty("--ring", hueOf(m.id));
      for (const s of listBox.querySelectorAll(".ov-swatch")) s.style.setProperty("--sw", hueOf(s.closest("[data-row]")?.dataset.row));
    }
    function drawSites() { map?.getSource("ov-sites")?.setData(siteData()); if (map?.getLayer("ov-sites")) map.setLayoutProperty("ov-sites", "visibility", show.sites ? "visible" : "none"); }
    function drawAreas() {
      if (!map?.getSource("ov-areas")) return;
      map.getSource("ov-areas").setData(areaData());
      map.getSource("ov-mask")?.setData(maskData());
      for (const id of ["ov-area-fill", "ov-area-casing", "ov-area-line", "ov-area-hi", "ov-area-hiline"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", show.subs ? "visible" : "none");
      for (const m of markers) m.marker.remove();
      markers = [];
      if (!show.subs) return;
      for (const s of subs) {
        const a = A.get(s.id);
        if (!a?.at) continue;
        // CO1: a click on a sub-group's marker selects it, as its row does ("Open" in the list goes in)
        const node = el(s.member ? "a" : "span", { class: "ov-mark" + (filter.sub && filter.sub !== s.id ? " dim" : "") + (filter.sub === s.id ? " chosen" : ""), "data-sub": s.id, style: "--ring: " + hueOf(s.id),
          ...(s.member ? { href: hrefOf(s.id), "aria-label": "Select " + s.name, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); if (filter.sub === s.id) open(s.id); else select(s.id); } } : { "aria-hidden": "true" }),
          onmouseenter: () => highlight(s.id), onmouseleave: () => highlight(null), onfocus: () => highlight(s.id), onblur: () => highlight(null) },
          badge(s), el("span", { class: "ov-name" }, s.name));
        markers.push({ id: s.id, node, ha: a.ha, marker: new gl.Marker({ element: node, anchor: "left", offset: [-14, 0] }).setLngLat(a.at).addTo(map) });
      }
      // the group as a whole: its own mark (its logo, else its initials in a ring) at its area's middle, shown at the widest zoom
      // (below GROUP_ZOOM) in place of the sub-groups' marks, and always when no sub-group has a boundary
      const own = A.get(group.id);
      if (own?.at) {
        const node = el("span", { class: "ov-mark ov-group", "data-group": group.id, "aria-hidden": "true", style: "--ring: " + hueOf(group.id) }, badge(group), el("span", { class: "ov-name" }, group.name));
        markers.push({ id: group.id, group: true, node, ha: own.ha, marker: new gl.Marker({ element: node, anchor: "left", offset: [-20, 0] }).setLngLat(own.at).addTo(map) });
      }
      zoomMarks();
      declutter();
    }
    const GROUP_ZOOM = 8;
    function zoomMarks() {
      if (!map) return;
      const wide = map.getZoom() < GROUP_ZOOM, subsShown = markers.some((m) => !m.group);
      for (const m of markers) m.node.hidden = m.group ? subsShown && !wide : wide && markers.some((x) => x.group);
    }
    // names that would touch another are hidden (the larger sub-group keeps its name); the round marker always shows
    function declutter() {
      const shownMarks = markers.filter((x) => !x.node.hidden), boxes = shownMarks.map((m) => m.node.querySelector(".ov-badge").getBoundingClientRect());
      for (const m of [...shownMarks].sort((a, b) => b.ha - a.ha)) {
        const name = m.node.querySelector(".ov-name");
        name.classList.remove("off");
        const r = name.getBoundingClientRect(), hit = boxes.some((b) => r.left < b.right + 4 && r.right + 4 > b.left && r.top < b.bottom + 2 && r.bottom + 2 > b.top);
        if (hit) name.classList.add("off"); else boxes.push(r);
      }
    }
    function highlight(id) {
      if (map?.getLayer("ov-area-hi")) for (const l of ["ov-area-hi", "ov-area-hiline"]) map.setFilter(l, ["==", ["get", "id"], id || ""]);
      for (const m of markers) m.node.classList.toggle("hi", m.id === id);
      for (const r of listBox.querySelectorAll("[data-row]")) r.classList.toggle("hi", r.dataset.row === id);
    }
    function sitePopup(s) {
      popup?.remove();
      popup = new gl.Popup({ closeButton: true, offset: 8, className: "ov-popup" }).setLngLat(s.lngLat)
        .setDOMContent(el("div", {}, el("b", {}, s.name), el("small", {}, [O().plural(s.periodResults || 0, "sample", "samples"), s.last ? "latest " + FP.wqModel.date(s.last) : null].filter(Boolean).join(" · ")))).addTo(map);
    }
    // the map framed on the group, or on the sub-group selected (a selection moves there smoothly, unless the person asks for less motion)
    function frame(force = false, smooth = false) {
      if (!map) return;
      const fk = (filter.sub || "all") + "|" + A.size + "|" + all.length;
      if (!force && fk === framedKey) return;
      framedKey = fk;
      const boxes = filter.sub ? [A.get(filter.sub)?.shape.bbox].filter(Boolean) : [...A.values()].map((a) => a.shape.bbox);
      const pts = scope().map((s) => s.lngLat).filter(Boolean);
      if (!boxes.length && pts.length) boxes.push([[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]]);
      const b = boxes.length ? FP.homeModel.union(boxes) : CANTERBURY;
      const right = layersBody.hidden ? 48 : Math.min(300, layersPanel.offsetWidth + 40);
      map.resize();
      map.fitBounds(b, { padding: { top: 48, bottom: 48, left: 48, right }, maxZoom: boxes.length ? 13 : 8, duration: smooth && !reducedMotion() ? 750 : 0 });
    }
    async function useBase(k) {
      base = k; markBg();
      const names = FP.basemaps?.names || [];
      if (map && names.includes(k)) { try { await FP.basemaps.pick(map, k); } catch { if (k !== "aerial") { try { await FP.basemaps.pick(map, "aerial"); base = "aerial"; markBg(); } catch { /* the plain ground */ } } } }
      if (map) { const first = ["ov-mask", "ov-area-fill"].find((l) => map.getLayer(l)); if (first && map.getLayer("ov-veil")) map.moveLayer("ov-veil", first); }
      paint();
    }
    function markBg() { for (const b of bgBox.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.base === base)); }
    function makeMap() {
      if (!live() || map || !gl?.Map || !FP.basemaps?.style) return;
      if (!mapHost.isConnected || !mapHost.clientWidth || !mapHost.clientHeight) {
        // (no zero-size map: made once the box has a size)
        if (typeof ResizeObserver !== "undefined" && !me.sizeWatch) { me.sizeWatch = new ResizeObserver(() => { if (mapHost.clientWidth && mapHost.clientHeight) { me.sizeWatch.disconnect(); me.sizeWatch = null; makeMap(); } }); me.sizeWatch.observe(mapHost); }
        return;
      }
      gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js");
      const start = P ? P.startBackground(store.get(BASE_KEY), choices()) : "aerial";
      base = start;
      try {
        map = me.map = new gl.Map({ container: mapHost, style: FP.basemaps.style(start, { reliefOnAerial: false }), bounds: CANTERBURY, maxZoom: 18,
          dragRotate: false, pitchWithRotate: false, attributionControl: { compact: true, ...(FP.brand?.org_legal ? { customAttribution: FP.brand.org_legal } : {}) } });
      } catch { mapNote.textContent = "The map couldn't open here."; mapNote.hidden = false; return; }
      map.touchZoomRotate?.disableRotation?.();
      map.addControl(new gl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new gl.ScaleControl({ unit: "metric" }), "bottom-left");
      const ready = () => {
        if (!live() || !map || map.getSource("ov-areas")) return;
        map.addLayer({ id: "ov-veil", type: "background", paint: { "background-color": css("--map-background") || "#e4e6e2", "background-opacity": 0 } });
        map.addSource("ov-mask", { type: "geojson", data: maskData() });
        map.addSource("ov-areas", { type: "geojson", data: areaData() });
        map.addSource("ov-sites", { type: "geojson", data: siteData() });
        map.addLayer({ id: "ov-mask", type: "fill", source: "ov-mask", paint: { "fill-color": "#000000", "fill-opacity": P?.MASK_OPACITY ?? 0.35, "fill-antialias": false } });
        map.addLayer({ id: "ov-area-fill", type: "fill", source: "ov-areas", paint: { "fill-color": ["get", "fill"], "fill-opacity": ["case", ["==", ["get", "dim"], 1], 0.08, ["get", "fo"]] } });
        map.addLayer({ id: "ov-area-hi", type: "fill", source: "ov-areas", filter: ["==", ["get", "id"], ""], paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.2 } });
        // PH5: no casing round the sub-groups (the owner: no dotted or dashed lines at overview scale); kept, empty, for the switches below
        map.addLayer({ id: "ov-area-casing", type: "line", source: "ov-areas", filter: ["==", ["get", "id"], ""], layout: { "line-join": "round" }, paint: { "line-color": ["get", "casing"], "line-width": ["+", ["get", "lw"], 2] } });
        map.addLayer({ id: "ov-area-line", type: "line", source: "ov-areas", layout: { "line-join": "round" }, paint: { "line-color": ["get", "line"], "line-width": ["get", "lw"], "line-opacity": ["case", ["==", ["get", "dim"], 1], 0.35, ["get", "lo"]] } });
        map.addLayer({ id: "ov-area-hiline", type: "line", source: "ov-areas", filter: ["==", ["get", "id"], ""], layout: { "line-join": "round" }, paint: { "line-color": ["get", "line"], "line-width": 2.6 } });
        map.addLayer({ id: "ov-site-hi", type: "circle", source: "ov-sites", filter: ["==", ["get", "id"], -1], paint: { "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2, "circle-stroke-color": css("--ink") || "#1d1d1f" } });
        map.addLayer({ id: "ov-sites", type: "circle", source: "ov-sites", paint: {
          // quiet and scale-aware: small at the whole area's scale, larger as the map comes in
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, ["match", ["get", "cls"], "plain", 2.2, "little", 2, "pending", 2, 4], 11, ["match", ["get", "cls"], "plain", 3.5, "little", 3, "pending", 3, 6], 14, ["match", ["get", "cls"], "plain", 5, "little", 4, "pending", 4, 7.5]], "circle-opacity": ["match", ["get", "cls"], "little", 0.45, "pending", 0.45, "unavailable", 0.45, "failed", 0.45, 1],
          "circle-stroke-width": 1.2, "circle-stroke-color": "#ffffff", "circle-color": "#48484d" } });
        // the sub-groups' areas: hover names and lights them, a click selects one (the smallest under the pointer; CO1)
        const at = (e) => map.queryRenderedFeatures(e.point, { layers: ["ov-area-fill"] }).filter((f) => !f.properties.own).sort((a, b) => (A.get(a.properties.id)?.ha || 0) - (A.get(b.properties.id)?.ha || 0))[0];
        const siteAt = (e) => map.queryRenderedFeatures(e.point, { layers: ["ov-sites"] })[0];
        hover = new gl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "ov-hover" });
        // (a sub-group's marker sits over the map: the pointer on it is the marker's, which lights its own sub-group)
        const onMark = (e) => !!(e.originalEvent?.target?.closest?.(".ov-mark") || e.originalEvent?.relatedTarget?.closest?.(".ov-mark"));
        map.on("mousemove", (e) => {
          if (onMark(e)) { hover.remove(); return; }
          const s = siteAt(e), f = s ? null : at(e);
          map.getCanvas().style.cursor = s || (f && subs.find((x) => x.id === f.properties.id)?.member) ? "pointer" : "";
          highlight(f?.properties.id || null);
          if (s) hover.setLngLat(e.lngLat).setText(s.properties.name).addTo(map); else if (f) hover.setLngLat(e.lngLat).setText(f.properties.name).addTo(map); else hover.remove();
        });
        map.on("mouseout", (e) => { hover.remove(); if (!onMark(e)) highlight(null); });
        map.on("click", (e) => {
          if (onMark(e)) return;
          const s = siteAt(e);
          if (s) { const site = all.find((x) => x.id === s.properties.id); if (site) sitePopup(site); return; }
          const f = at(e), sub = f && subs.find((x) => x.id === f.properties.id);
          if (sub?.member) { if (sub.id === filter.sub) open(sub.id); else select(sub.id); }
        });
        map.on("moveend", declutter); map.on("zoom", zoomMarks);
        drawAreas(); drawSites(); frame(true);
        useBase(start);
      };
      if (map.isStyleLoaded?.()) ready(); else { map.once("load", ready); map.once("style.load", ready); }
      // the theme changed: the same places in the colours for it
      const scheme = root.matchMedia?.("(prefers-color-scheme: dark)"), recolour = () => paint();
      scheme?.addEventListener?.("change", recolour);
      const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(recolour);
      watch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      me.offs.push(() => scheme?.removeEventListener?.("change", recolour), () => watch?.disconnect());
      // a window resized (or the panel folded): the map keeps its frame
      const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { map?.resize(); declutter(); });
      resize?.observe(mapHost); me.offs.push(() => resize?.disconnect());
    }

    // ---- the Layers panel ------------------------------------------------------------------------------------------------
    function drawLayers() {
      const ch = choices();
      bgBox.replaceChildren(...(ch.length >= 2 ? [["aerial", "Aerial"], ["topo", "Topo"]].filter(([k]) => ch.includes(k)).map(([k, t]) => el("button", { type: "button", "data-base": k, id: "ov-base-" + k,
        "aria-pressed": String(base === k), onclick: () => { store.set(BASE_KEY, k); useBase(k); } }, t)) : []));
      bgBox.hidden = ch.length < 2;
      const box = (id, label, on, change, extra = {}) => el("label", { class: "ov-check" }, el("input", { type: "checkbox", id, ...(on ? { checked: true } : {}), ...extra, onchange: (e) => change(e.target.checked) }), el("span", {}, label));
      // a theme (N1): its switch turns on the layers marked to start on (CTX2's starts_on; every layer when none is marked), and each
      // layer is one level down, folded
      const themeRow = (t, i) => {
        const on = t.layers.filter((L) => themes.layersOn.has(L.key)).length;
        return el("div", { class: "ov-theme" }, box("ov-theme-" + i, t.name, on > 0, (v) => theme(i, v)),
          t.layers.length > 1 ? el("details", { class: "ov-theme-layers" }, el("summary", {}, on ? on + " of " + t.layers.length + " on" : t.layers.length + " layers"),
            ...t.layers.map((L) => box("ov-layer-" + L.key, L.title, themes.layersOn.has(L.key), (v) => layer(i, L.key, v)))) : null);
      };
      showBox.replaceChildren(...[
        A.size ? box("ov-show-subgroups", subs.length ? "Sub-groups" : "The group's area", show.subs, (v) => { show.subs = v; drawAreas(); }) : null,
        all.length ? box("ov-show-sites", "Water quality sites", show.sites, (v) => { show.sites = v; drawSites(); drawLegend(); }) : null,
        ...(themes.list || []).map(themeRow)].filter(Boolean));
      showBox.hidden = !showBox.childElementCount;
      drawLegend();
    }
    function drawLegend() {
      const c = clsColours(), item = (cls, text, kind = "dot") => el("li", {}, el("span", { class: "ov-key " + kind, "data-cls": cls, ...(kind === "dot" && c[cls] ? { style: "--key: " + c[cls] } : {}) }), text);
      legendBox.replaceChildren(...[
        A.size ? item("area", subs.length ? "Sub-group boundary" : "The group's area", "line") : null,
        all.length && show.sites ? item("quiet", "Water quality site") : null,
      ].filter(Boolean));
      legendBox.hidden = !legendBox.childElementCount;
    }
    // a theme switched on: its starting layers (or all, when none is marked); off: all of its layers
    function theme(i, on) {
      const t = themes.list?.[i];
      if (!t) return;
      const start = t.layers.filter((L) => L.startsOn);
      for (const L of on ? (start.length ? start : t.layers) : t.layers) on ? themes.layersOn.add(L.key) : themes.layersOn.delete(L.key);
      return showLayers(t).then(drawLayers);
    }
    function layer(i, key, on) {
      const t = themes.list?.[i];
      if (!t) return;
      if (on) themes.layersOn.add(key); else themes.layersOn.delete(key);
      return showLayers(t).then(drawLayers);
    }
    // each layer's file is signed and added the first time it is switched on
    async function showLayers(t) {
      if (!map) return;
      for (const L of t.layers) {
        const want = themes.layersOn.has(L.key), src = "ov-ctx-" + L.key;
        if (want && !themes.added.has(L.key)) {
          themes.added.add(L.key);
          pmtilesProtocol(gl);
          try {
            const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(L.tiles_path, LINK_SECONDS);
            if (error || !data?.signedUrl || !live()) continue;
            if (!map.getSource(src)) map.addSource(src, { type: "vector", url: "pmtiles://" + data.signedUrl });
            L.layers.forEach((d, j) => { try { map.addLayer({ id: src + "-" + j, source: src, "source-layer": L.source_layer, ...d, layout: { ...d.layout, visibility: "none" } }, "ov-area-fill"); } catch { /* a definition the map refuses is left out */ } });
          } catch { /* this layer is left out; the rest of the theme still draws */ }
        }
        L.layers.forEach((_, j) => { const id = src + "-" + j; if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", want ? "visible" : "none"); });
      }
    }
    // CO1: the panel never sits over the map by itself: folded to one "Layers" button until opened, and remembered either way
    function foldLayers(open, remember = false) {
      layersBody.hidden = !open; layersToggle.setAttribute("aria-expanded", String(open));
      layersToggle.setAttribute("aria-label", open ? "Close Layers" : "Layers");
      layersPanel.classList.toggle("open", open);
      if (remember) store.set(LAYERS_KEY, open ? "open" : "folded");
    }
    layersToggle.addEventListener("click", () => foldLayers(layersBody.hidden, true));
    foldLayers(store.get(LAYERS_KEY) === "open");

    // ---- the selection ---------------------------------------------------------------------------------------------------
    async function setFilter(next, smooth = false) {
      filter = { ...filter, ...next, period: "all" };
      save();
      ++token;   // (trends still being asked for the old selection are dropped)
      if (!live()) return;
      startTrends();
      drawList(); drawCards(); drawAreas(); drawSites(); drawLegend(); drawNote(); frame(false, smooth);
      loadCards();
    }

    // ---- the trends: asked site by site, the band filled in as they come -------------------------------------------------------
    let redraw = 0;
    const soon = () => { if (redraw) return; redraw = (root.requestAnimationFrame || ((f) => setTimeout(f, 16)))(() => { redraw = 0; if (live()) drawCards(); }); };
    function startTrends() {
      // the Water quality tile's one measure, at the surface-water sites in scope only (N2's method, a site at a time), at most
      // TREND_CAP sites; nothing is asked while the tile is hidden
      if (!isShown("water") || FP.wqPage?.summary) { plan = null; classes = new Map(); return; }   // (WQV1: the tile shows the page's own trends)
      const sc = scope(), m = O().headlineMeasure(sc);
      const t = token, p = O().trendPlan(sc.filter((s) => s.kind === "surface"), { org: group.id }, filter.period, now, m ? [m] : []);
      plan = p; classes = new Map(p.known);
      pool(p.asks.map((a) => async () => {
        if (t !== token || !live()) return;
        const c = await askTrend(sb, a.body);
        if (t !== token || !live()) return;
        classes.set(a.site + "|" + a.measure, c ?? "unavailable"); soon();
      }), CONCURRENCY);
    }

    // ---- load ------------------------------------------------------------------------------------------------------------
    let siteReads = [], siteIds = [];
    (async () => {
      const [s, m] = await Promise.all([readSubgroups(sb, group, groups).catch(() => []),
        isCoordinator ? headCount(sb.from("group_members").select("id", { count: "exact", head: true }).eq("org_id", group.id).is("ended_at", null)) : null]);
      if (!live()) return;
      subs = s; members = m;
      layout = O().layoutFrom(store.get(O().cardsKey(person?.id, group.id)), cards.available(viewer));
      // a remembered selection holds only while it is still one of the group's sub-groups the person is in
      filter = { ...O().filterFrom(store.get(key), subs.filter((x) => x.member)), period: "all" };
      drawList(); drawCards(); loadCards();
      const visible = [group.id, ...subs.filter((x) => x.member).map((x) => x.id)];
      A = O().areas(await readAreas(sb, visible).catch(() => []));
      if (!live()) return;
      drawList(); drawCards();
      // the sites inside each area: the group's own (when it has one) and each sub-group's (to know which sub-group a site is in)
      const orgs = [...(A.has(group.id) ? [group.id] : []), ...subs.filter((x) => A.has(x.id)).map((x) => x.id)];
      siteReads = await pool(orgs.map((o) => async () => ({ org: o, rows: await rows(sb.rpc("group_wq_sites", { g: o, km: 0 })) })), SITES_POOL);
      sitesRead = siteReads.every((r) => r.rows !== null);
      siteReads = siteReads.map((r) => ({ org: r.org, rows: r.rows || [] }));
      siteIds = [...new Set(siteReads.flatMap((r) => r.rows.map((x) => Number(x.site_id))).filter(Number.isFinite))];
      const allCounts = siteIds.length ? await readCounts(sb, siteIds, null) : [];
      if (!live()) return;
      if (allCounts === null) sitesRead = false;
      counts.set("all", allCounts || []);
      all = O().sites(siteReads, counts.get("all"), null, now);
      loaded = true;
      wrap.setAttribute("aria-busy", "false");
      startTrends();
      drawList(); drawCards(); drawLayers(); drawNote();
      if (map?.getSource("ov-areas")) { drawAreas(); drawSites(); frame(true); }
    })().catch(() => { if (live()) { loaded = true; wrap.setAttribute("aria-busy", "false"); drawList(); drawCards(); drawLayers(); drawNote(); } });

    // the context layers' themes (N1), listed in the Layers panel; their files are signed only when a theme is switched on
    const safe = (make) => { try { return rows(make()); } catch { return Promise.resolve(null); } };
    safe(() => sb.from("core_layers").select("key, title, style, tiles_path").not("style->reference", "is", null).order("key").limit(40))
      .then((r) => { if (!live() || !r) return; themes.list = O().contextThemes(r); drawLayers(); });

    drawLayers(); drawCards();
    (root.requestAnimationFrame || ((f) => setTimeout(f, 0)))(() => makeMap());
    me.wrap = wrap;
    return wrap;
  }

  function close() {
    if (!shown) return;
    const s = shown; shown = null; s.alive = false;
    for (const off of s.offs) { try { off(); } catch { /* already gone */ } }
    s.sizeWatch?.disconnect();
    try { s.map?.remove(); } catch { /* already gone */ }
    FP.placeHome?.close();
  }

  // (map: the overview's MapLibre map, for the browser walk)
  // "Open water quality": the group's Maps opens with the water quality sites panel (maps-view's `waterQuality`), once
  let wqIntent = false;
  const takeWaterQuality = () => { const v = wqIntent; wqIntent = false; return v; };
  FP.groupOverview = { view, close, cards, takeWaterQuality, map: () => shown?.map || null };
})(typeof window === "undefined" ? globalThis : window);
