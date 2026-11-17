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
//   places (kind area, current)  the areas of the group and of the sub-groups the person is in (one request, at most 500; CO1b: asked
//                                beside subgroup_counts, from the person's own places, and drawn as they come)
//   group_wq_sites(org, 0)       the monitoring sites inside each of those areas (S5; at most 5,000 each)
//   wq_site_result_counts        MC1: per site, every result held and those of the five keys the card may ask about (150 sites a call,
//                                so an answer stays under the API's 1,000 rows)
//   analysis (preview, trend)    each surface-water site's indicative trend for the card's one measure, exactly as a site's panel
//                                in Maps asks (N2), only for sites whose record could make one; at most 4 at a time; nothing stored
//   group_members (head count)   the members, for the group's facilitators, advisors and admins only (People's roles)
//   For the group and every sub-group the person is in (`org_id in (...)`, one read per tile), or the one sub-group selected (CO1),
//   each read only while its tile is shown, once per set of places:
//   captures (the count with the first 1,000 times, at most 2,000)   records and photos this year, and how many a month
//   documents (head count; across several places, the count and each one's place, CO1b)   the files held, and where
//   group_events                 the next two, and head counts of those held this year (ended before now), for those with Events
//   proposals (as documents)     the open review questions, for People's roles only (as Home's waiting line counts them)
//   core_layers + map-packages   the context layers' themes (N1), read and signed only when one is switched on
// OV1: a number is shown only when its read came back. A read that fails is said in its own tile or in the list, in one calm line
// ("Couldn't read the samples just now."), with Try again, which reads what failed once more on the tap; never as 0, as none, as an
// empty list, or as a part counted as the whole. The page never shows an error message or a code.
(function (root) {
  const FP = root.FP;
  const O = () => FP.groupOverviewModel, S = () => FP.wqSitesModel;
  const el = (...a) => FP.el(...a);
  const list = (v) => (Array.isArray(v) ? v : []);
  const CONCURRENCY = 4, COUNT_BATCH = 150, AREA_CAP = 500, SITES_POOL = 4, LINK_SECONDS = 3600, BUCKET = "map-packages";
  const BASE_KEY = "fp-overview-basemap";   // the overview maps' background, remembered on this device (map-scene.js's own key)
  const LAYERS_KEY = "fp-overview-layers";  // CO1: the Layers panel open or folded, remembered on this device (MV1: open by default)
  const SHADE_KEY = "fp-overview-shade";    // MV1: "Shade outside the group" turned off on this device ("off"), else on
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
  // -> { subs, failed } (OV1: failed, the list couldn't be read: the person's own sub-groups only, never counted as the group's)
  async function readSubgroups(sb, group, groups) {
    if (group.parent_org_id) return { subs: [], failed: false };
    const got = await rows(sb.rpc("subgroup_counts", { parent_org: group.id }));
    const subs = got ? got.map((r) => ({ id: r.subgroup_id, name: r.subgroup_name, slug: r.subgroup_slug || null, member: !!r.is_member }))
      : list(groups).filter((g) => g.parent_org_id === group.id).map((g) => ({ id: g.id, name: g.name, slug: g.slug || null, member: true }));
    return { subs: subs.filter((s) => s.id && s.name).sort((a, b) => a.name.localeCompare(b.name, "en-NZ")), failed: !got };
  }
  // CO1b: one request, not a count and then the rows (one wait fewer before the map has its shapes): at most AREA_CAP rows, as before
  // (OV1: null when the read failed, never taken for "no boundary held")
  async function readAreas(sb, ids) {
    if (!ids.length) return [];
    const r = await Promise.resolve(sb.from("places").select("org_id,geom").eq("kind", "area").is("valid_to", null).in("org_id", ids).limit(AREA_CAP)).catch(() => null);
    return !r || r.error ? null : list(r.data).slice(0, AREA_CAP);
  }
  // (null when any batch failed: a part of the counts is never shown as the whole, OV1)
  async function readCounts(sb, ids, since) {
    const batches = [];
    for (let i = 0; i < ids.length; i += COUNT_BATCH) batches.push(ids.slice(i, i + COUNT_BATCH));
    // (OV1 review: no batch is started once one has failed, as #578's pool does: the answer is thrown away, and a database that has
    // just timed out is not sent more; those already under way run to their end)
    let failed = false;
    const got = await pool(batches.map((b) => async () => {
      if (failed) return null;
      const r = await rows(sb.rpc("wq_site_result_counts", { site_ids: b, parameter_keys: [...O().KEYS], ...(since ? { since } : {}) }));
      if (r === null) failed = true;
      return r;
    }), 2);
    return failed || got.some((g) => g === null) ? null : got.flat();
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
  // OV1: a read that failed, said in the tile's own place in one calm line, with the app's Try again (FU2's quiet link button, as the
  // farm's and the group's reference counts have it): one more read, on the tap only, of whatever on the page failed
  const again = (c) => el("button", { type: "button", class: "link ov-again", onclick: (e) => c.retry(e.currentTarget) }, "Try again");
  const couldNot = (c, what) => [quiet(c.O.FAILED[what]), again(c)];
  // (in the headline row, clamped to one line: the short line, the whole one on hover)
  const couldNotLead = (c, what) => [el("p", { class: "ov-quiet", "data-full": c.O.FAILED[what] }, c.O.FAILED_LEAD), again(c)];
  const isFailed = (d) => FP.groupOverviewModel.failed(d);
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
      if (c.filter.sub) return null;   // (a sub-group selected: its own numbers only)
      if (c.failed.subgroups) return couldNotLead(c, "subgroups");   // (OV1: the person's own sub-groups are not the group's count)
      const t = tileOf(c, "subgroups");
      if (!t) return null;
      // (OV1: the boundaries couldn't be read: nothing said of them)
      return [big(t.value), counted(c, (c.failed.areas ? null : t.note) || "Listed on the left")];
    } });
  cards.register({ id: "area", title: "Area", group: "About the group", order: 20, lead: true, line: "The area of the group, or of the sub-group selected",
    render(c) {
      // (OV1: the boundaries couldn't be read: no area, and no part of one summed as the whole)
      if (c.failed.areaHere) return couldNotLead(c, "areas");
      const t = tileOf(c, "area");
      if (!t) return null;
      return [big(t.value.replace(/ ha$/, ""), "ha"), counted(c, c.filter.sub || c.group.parent_org_id ? "The sub-group's boundary" : t.note || "From the boundaries held")];
    } });
  cards.register({ id: "members", title: "Members", group: "About the group", order: 30, lead: true, line: "The group's current members (coordinators)", can: (v) => !!v.coordinator,
    render(c) {
      if (c.filter.sub) return null;   // (members are not counted per sub-group: SG2 shows no sub-group's business count)
      if (c.failed.members) return couldNotLead(c, "members");
      const t = tileOf(c, "members");
      if (!t) return null;
      return [big(t.value), counted(c, "Current members")];
    } });
  cards.register({ id: "records", title: "Records and photos this year", group: "Activity", order: 40, wide: true,
    line: "How many were taken this year, month by month",   // (for anyone here: row-level security decides which they see)
    async load(c, orgs) {
      const from = nzYearStart(c);
      if (!from) return null;
      const where = (q) => q.in("org_id", orgs).is("archived_at", null).gte("taken_at", from);
      // (#544 review: the API gives at most 1,000 rows a request, so pages of 1,000 up to the cap; over the cap, or a short read, the
      // number alone, never a cut-off chart. CO1b: the first page comes with the count, so one request where there are 1,000 or fewer)
      const first = await Promise.resolve(where(c.sb.from("captures").select("taken_at", { count: "exact" })).order("taken_at", { ascending: true }).range(0, c.O.PAGE_ROWS - 1)).catch(() => null);
      const n = first && !first.error && Number.isInteger(first.count) ? first.count : null;
      if (n === null) return c.O.READ_FAILED;
      const pages = c.O.recordPages(n);
      if (!pages.length) return { n, series: null };
      const times = list(first.data).map((r) => r.taken_at);
      for (const [a, b] of pages.slice(1)) {
        const got = await rows(where(c.sb.from("captures").select("taken_at")).order("taken_at", { ascending: true }).range(a, b));
        if (!got) return { n, series: null };
        times.push(...got.map((r) => r.taken_at));
      }
      return { n, series: c.O.wholeSeries(times, n, c.today || new Date().toISOString()) };
    },
    render(c, d) {
      if (d === undefined) return [quiet("Counting…")];
      if (isFailed(d)) return couldNot(c, "records");
      if (!d || !d.n) return null;
      return [big(c.O.count(d.n)), d.series && d.series.length ? monthChart(d.series) : null, since1Jan(c, "Those you can see, taken")].filter(Boolean);
    } });
  // CO1b (the owner's walk: "Files 47" opened a Files page of 4; "Coming up" sat beside an Events page with none): a tile counts the
  // group's own and its sub-groups' (those the person is in), but each section's page lists one place's own. So where a number spans
  // places, the tile says so ("Across the group and 1 sub-group · 4 the group's own"), its link says it opens the group's own, and each
  // sub-group holding some is named with a link to its own page. Read in one request: the count, and the place of each item (org_id
  // only, of rows the person already reads) up to the API's 1,000; past that, or on a short read, the split is not said.
  const subHref = (id, view, tab) => FP.href(FP.groupModel.href(id, view, tab || null));
  // read(columns, options): the tile's own read across `orgs`, with those columns
  async function countHeld(c, orgs, read) {
    if (orgs.length < 2) { const n = await headCount(read("id", { count: "exact", head: true })); return n === null ? c.O.READ_FAILED : { n, held: null, multi: false }; }
    const r = await Promise.resolve(read("org_id", { count: "exact" }).limit(c.O.PAGE_ROWS)).catch(() => null);
    if (!r || r.error || !Number.isInteger(r.count)) return c.O.READ_FAILED;
    const got = list(r.data);
    return { n: r.count, held: got.length === r.count ? c.O.heldBy(got, c.group.id, c.subs) : null, multi: true };
  }
  // the quiet line and the links under such a number. open: (place id) -> href, or null where that place's page is not the person's
  const MAX_HELD = 3;
  function heldParts(c, d, { plain, own, open, word = "Held" }) {
    if (!d.multi || (d.held && !d.held.subs.length)) return [counted(c, word), cardLink(open(c.group.id) || c.href(), plain)];
    if (!d.held) return [quiet("Across the group and your sub-groups"), cardLink(open(c.group.id), own)];
    const subs = d.held.subs, shown = subs.slice(0, MAX_HELD);
    return [quiet(c.O.heldWords(d.held)), d.held.own ? cardLink(open(c.group.id), own) : null,
      el("ul", { class: "ov-held" }, ...shown.map((s) => { const href = open(s.id); return el("li", {}, href ? el("a", { class: "ov-card-link", href, "data-held": s.id }, s.name + ": " + c.O.count(s.n), FP.icon ? FP.icon("chevron", 14) : null) : el("span", {}, s.name + ": " + c.O.count(s.n))); })),
      subs.length > shown.length ? quiet("and " + c.O.plural(subs.length - shown.length, "more sub-group", "more sub-groups")) : null].filter(Boolean);
  }
  const TZ = "Pacific/Auckland";
  const eventDay = (t) => { const d = Date.parse(t); return Number.isFinite(d) ? new Date(d).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).replace(",", "") : ""; };
  cards.register({ id: "coming", title: "Coming up", group: "Activity", order: 50, line: "The next two events", can: (v) => v.sections.includes("events"),
    async load(c, orgs) {
      const from = FP.placeHomeModel?.nzDayStart?.(String(c.today || new Date().toISOString()).slice(0, 10)) || new Date().toISOString();
      const got = await rows(c.sb.from("group_events").select("id,org_id,title,starts_at,all_day,place_name,cancelled_at").in("org_id", orgs).is("cancelled_at", null).gte("starts_at", from)
        .order("starts_at", { ascending: true }).range(0, 1));
      return got === null ? c.O.READ_FAILED : got;
    },
    render(c, d) {
      if (d === undefined) return [quiet("Reading the calendar…")];
      if (isFailed(d)) return couldNot(c, "coming");   // (OV1: couldn't be read is said; only nothing coming is left out)
      if (!d || !d.length) return null;
      // CO1b: an event a sub-group holds names it, with a link to that sub-group's Events (the group's own page lists only its own)
      const subOf = (e) => (e.org_id && e.org_id !== c.group.id && !c.filter.sub ? c.subs.find((s) => s.id === e.org_id) || null : null);
      const anySub = d.some((e) => subOf(e));
      return [el("ul", { class: "ov-events" }, ...d.map((e) => { const s = subOf(e);
          return el("li", {}, el("b", {}, eventDay(e.starts_at)), el("span", {}, e.title || "Event", e.place_name ? el("small", {}, e.place_name) : null,
            s ? el("a", { class: "ov-event-sub", href: subHref(s.id, "events"), "data-held": s.id, title: "Open the events of " + s.name }, "In " + s.name) : null)); })),
        cardLink(c.href("events"), anySub ? "The group's own events" : "All events")];
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
      return ended === null || open === null ? c.O.READ_FAILED : ended + open;
    },
    render(c, d) {
      if (d === undefined) return [quiet("Counting…")];
      if (isFailed(d)) return couldNot(c, "held");
      if (!d) return null;
      return [big(c.O.count(d)), since1Jan(c, "Held")];
    } });
  cards.register({ id: "files", title: "Files", group: "About the group", order: 70, line: "How many files are held", can: (v) => v.sections.includes("documents"),
    load(c, orgs) { return countHeld(c, orgs, (cols, o) => c.sb.from("documents").select(cols, o).in("org_id", orgs)); },
    render(c, d) {
      if (d === undefined) return [quiet("Counting…")];
      if (isFailed(d)) return couldNot(c, "files");
      if (!d || !d.n) return null;
      return [big(c.O.count(d.n)), ...heldParts(c, d, { plain: "Open Files", own: "Open the group's own Files", open: (id) => (id === c.group.id ? c.href("documents") : subHref(id, "documents")) })];
    } });
  cards.register({ id: "review", title: "To review", group: "Activity", order: 80, line: "How many questions about the register wait for an answer (coordinators)",
    can: (v) => !!v.people && v.sections.includes("people"),
    async load(c, orgs) {
      const R = FP.reviewItemsModel;
      if (!R) return null;
      return countHeld(c, orgs, (cols, o) => c.sb.from("proposals").select(cols, o).in("org_id", orgs).in("kind", R.KINDS).eq("status", "proposed"));
    },
    render(c, d) {
      if (d === undefined) return [quiet("Counting…")];
      if (isFailed(d)) return couldNot(c, "review");
      if (!d || !d.n) return null;
      // (a sub-group's To review is linked only where the person sees that sub-group's People)
      const open = (id) => (id === c.group.id ? c.href("people", "review") : (() => { const g = c.groups.find((x) => x.id === id); return g && FP.peopleModel?.canSeeTab?.(g, c.groups) ? subHref(id, "people", "review") : null; })());
      return [big(c.O.count(d.n)), ...heldParts(c, d, { plain: "Open To review", own: "Open the group's own To review", open, word: d.n === 1 ? "Question waiting" : "Questions waiting" })];
    } });
  cards.register({ id: "wqsites", title: "Water quality sites", group: "Water", order: 90, off: true, line: "The monitoring sites inside the boundaries, and their samples",
    render(c) {
      if (!c.loaded) return [quiet("Reading the monitoring sites…")];
      // OV1: the sites not all read (a boundary or an area's sites): no number; the samples not read: the sites, and never "0 samples"
      const f = c.failed.water;
      if (f === "areas" || f === "sites") return couldNot(c, f);
      const w = c.O.wqCard({ scope: c.scope, classes: new Map(), filter: c.filter, plan: null });
      if (!w) return null;
      if (f === "counts") return [big(c.O.count(c.scope.length)), ...couldNot(c, "counts")];
      return [big(c.O.count(c.scope.length)), counted(c, w.line.replace(/^[\d,]+ sites? · /, ""))];
    } });
  cards.register({ id: "water", title: "Water quality", group: "Water", order: 100, off: true, wide: true,
    line: "The main trend in one sentence, and the way to the detail",
    render(c) {
      if (!c.loaded) return [quiet("Reading the monitoring sites…")];
      // OV1: what of the sites and samples couldn't be read is said in place of their line ("N sites · 0 samples" before), with Try again
      const f = c.failed.water, known = f !== "areas" && f !== "sites";
      const w = known ? c.O.wqCard({ scope: c.scope, classes: c.classes, filter: c.filter, plan: c.plan }) : null;
      const link = c.O.waterQualityLink(c.group.id, (id, view) => FP.href(FP.groupModel.href(id, view)));
      if (!w && known) return c.areas.size ? [quiet(c.sitesRead ? "No water quality monitoring sites lie inside the boundaries held." : "The monitoring sites will show here."), cardLink(link.href, "Open water quality", link.opensPanel ? c.waterQuality : null)]
        : [quiet("Once a boundary is held, the monitoring sites inside it show here.")];
      // WQV1, WQ2: the Water quality page's own headline (the group's own sampling first, then the other sources' sites with a good
      // record) and, last and quiet, LAWA's line; always read from this group, with the sub-group selected picked out as the page does
      const s = c.wqSummary(c.filter.sub || null);
      if (s !== null) return [s ? el("p", { class: "ov-sentence", id: "ov-wq-sentence" }, s.sentence) : el("p", { class: "ov-quiet ov-working", id: "ov-wq-sentence", role: "status" }, "Reading the water quality sites…"),
        s?.others ? quiet(s.others) : null, s?.noArea ? null : quiet(f ? c.O.FAILED[f] : w.line), s?.lawa ? quiet(s.lawa) : null,
        (f && !s?.noArea) || s?.failed || s?.lawaFailed ? again(c) : null,
        cardLink(s?.href || link.href, "Open water quality")].filter(Boolean);
      if (f) return [...couldNot(c, f), cardLink(link.href, "Open water quality", link.opensPanel ? c.waterQuality : null)];
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
  // opts: { group, groups (the person's), person, sb, today, home (place-home.js's options, for its search), sub (CO1b: the sub-group the
  // address names, `?item=`, chosen at the start when the person is in it) }
  function view(opts) {
    close();
    const { group, groups = [], person = null } = opts, sb = opts.sb || FP.sb;
    const me = { alive: true, map: null, offs: [] };
    shown = me;
    const live = () => me.alive && shown === me;
    const now = Date.parse(String(opts.today || "").slice(0, 10) + "T12:00:00Z") || Date.now();
    const P = FP.mapPalette;
    let subs = [], subsKnown = false, A = new Map(), all = [], sitesRead = true, members = null, loaded = false, classes = new Map(), plan = null, token = 0;
    // OV1: which of the page's own reads failed (each said where its numbers would be, never as 0 or none): the list of sub-groups, the
    // members' count, the boundaries, the sites inside an area (by the place whose read failed), the sites' result counts
    const failedReads = { subgroups: false, members: false, areas: false, sites: new Set(), counts: false };
    // the scope's sites unknown ("areas", "sites"), or only their samples ("counts"); null when every read it rests on came back
    const waterFailed = () => {
      const sub = filter.sub;
      if (sub ? areasMissing.has(sub) : areasMissing.size > 0) return "areas";
      if (sub ? failedReads.sites.has(sub) : failedReads.sites.size > 0) return "sites";
      return failedReads.counts ? "counts" : null;
    };
    const sitesKnownFor = (id) => !areasMissing.has(id) && !failedReads.sites.has(id);
    // (OV1 review: by the places whose boundary read failed, so a sub-group whose boundary came back as none is still said as none)
    const areasMissing = new Set();
    // the area shown unknown: the selected sub-group's boundary not read; else the group's own, or, with none of its own, any sub-group's
    const areaHere = () => (filter.sub ? areasMissing.has(filter.sub) : areasMissing.has(group.id) || (!A.has(group.id) && areasMissing.size > 0));
    const counts = new Map();   // period key -> rows of wq_site_result_counts (all time)
    const key = O().storeKey(person?.id, group.id);
    // CO1b (the owner: the overview "often opens filtered"): every visit opens on "All sub-groups", unless the address names one
    // (`?item=<sub-group>`); only the list's sort is remembered on this device. The period is always all time (CO1).
    let filter = O().startFilter(store.get(key), [], null);
    let codes = new Map();   // CO1b: sub-group id -> its marker's short code, never the same for two
    const hrefOf = (id) => FP.href(FP.groupModel.href(id, "home"));
    const subName = (id) => subs.find((s) => s.id === id)?.name || "";
    const isSub = !!group.parent_org_id;

    // -- the head: Home's search (compact)
    const search = FP.placeHome?.view ? FP.placeHome.view({ ...(opts.home || {}), compact: true }) : null;
    const head = el("div", { class: "ov-head" }, search || el("span"));
    // -- LEFT: the sub-groups (a group with sub-groups only)
    // (CO1b: a group's list keeps its place, under its heading, while the sub-groups are read)
    const listBox = el("nav", { class: "ov-list", "aria-label": "Sub-groups", hidden: isSub }, ...(isSub ? [] : [el("div", { class: "ov-list-head" }, el("h2", {}, "Sub-groups"))]));
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
      return lines.length ? [group.name + ". " + O().scopeWords({ name: group.name, isSub, subgroups: subs, selectedName: filter.sub ? subName(filter.sub) : null, known: !failedReads.subgroups }) + (when ? ", as at " + when : ""), ...lines].join("\n") : "";
    }
    async function copyNumbers() {
      const text = numbersText();
      if (!text) return;
      try { await root.navigator.clipboard.writeText(text); copyText.firstChild.textContent = "Copied"; setTimeout(() => { copyText.firstChild.textContent = "Copy as text"; }, 1600); } catch { /* the browser refused: nothing said */ }
    }
    // -- RIGHT: the map, with its one Layers panel (folded to a button by default)
    const mapHost = el("div", { class: "ov-map", id: "ov-map", role: "region", "aria-label": "Map of " + group.name });
    const mapNote = el("p", { class: "ov-map-note", role: "status", hidden: true });
    // CO1b (the owner: "it takes a few seconds to load the map properly. This leaves you thinking its missing something"): until the
    // group's shapes are on the map, a quiet "Loading map…" in its box. The map opens on the frame the overview last drew for this group
    // on this device; with none kept, the map stays hidden behind the box's own ground until it can open on the group (never the region)
    const frameStore = O().frameKey(person?.id, group.id);
    const keptFrame = O().frameFrom(store.get(frameStore));
    const mapWait = el("p", { class: "ov-map-wait", id: "ov-map-wait", role: "status" }, "Loading map…");
    const layersToggle = el("button", { type: "button", id: "ov-layers-toggle", class: "ov-layers-toggle", "aria-expanded": "false", "aria-controls": "ov-layers" }, FP.icon ? FP.icon("layers", 18) : null, el("span", {}, "Layers"),
      el("span", { class: "ov-layers-x", "aria-hidden": "true" }, FP.icon ? FP.icon("close", 14) : "×"));
    // MV1 (the owner, 16 Nov 2026: "I think i just prefer the look of the portal page"): the map's one panel in the shape of the Maps
    // tab's (the portal's): the place's name small, the map's title large, one line of facts; the map's layers as switches with what
    // their colours mean under each; a Reference group (the context themes, "Shade outside the group"); the background at its foot.
    const factsLine = el("p", { class: "ov-pfacts" });
    const panelHead = el("div", { class: "ov-phead" }, el("p", { class: "ov-pkicker" }, group.name), el("h2", { class: "ov-ptitle" }, "Map"), factsLine);
    const bgBox = el("div", { class: "ov-bg", role: "group", "aria-label": "Background" });
    const showBox = el("div", { class: "ov-shows" });
    const refBox = el("div", { class: "ov-ref", role: "group", "aria-labelledby": "ov-ref-head" });
    const legendBox = el("ul", { class: "ov-legend", "aria-label": "Key", hidden: true });   // (MV1: each layer's key is under its own switch)
    const layersBody = el("div", { id: "ov-layers", class: "ov-layers-body" }, panelHead, el("div", { class: "ov-pbody" }, showBox, refBox, legendBox), el("div", { class: "ov-pfoot" }, bgBox));
    const layersPanel = el("div", { class: "ov-layers mv-panel" }, layersToggle, layersBody);
    const mapBox = el("div", { class: "ov-mapbox loading" + (keptFrame ? " framed" : "") }, mapHost, layersPanel, mapNote, mapWait);
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
      // (OV1: a sub-group whose sites or samples couldn't be read has none said, and is never ranked by a zero; the list says why, once)
      const rowsOf = O().subgroupRows(subs, A, all, classes, null, sortBy, { sites: (id) => !loaded || sitesKnownFor(id), results: () => !loaded || !failedReads.counts });
      const total = O().hectares(A.get(group.id)?.ha);
      const why = failedReads.subgroups ? "subgroups" : failedReads.areas ? "areas" : failedReads.sites.size ? "sites" : failedReads.counts ? "counts" : null;
      // (#544 review: the list is drawn again on a choice; keyboard focus stays where it was, on the same row or control, so Enter
      // selects a row and Enter again opens it)
      const active = listBox.contains(document.activeElement) ? document.activeElement : null, hadRow = active?.dataset?.row || null, hadId = active?.id || null;
      const allRow = el("li", {}, el("button", { type: "button", class: "ov-row ov-all" + (filter.sub ? "" : " chosen"), id: "ov-all", "aria-pressed": String(!filter.sub), onclick: () => select(null) },
        el("span", { class: "ov-row-text" }, el("b", {}, "All sub-groups"), el("small", {}, [failedReads.subgroups ? null : O().plural(subs.length, "sub-group", "sub-groups"), total].filter(Boolean).join(" · ")))));
      listBox.replaceChildren(el("div", { class: "ov-list-head" }, el("h2", {}, "Sub-groups"), el("label", { class: "ov-field ov-sort" }, el("span", {}, "Sort"), sort)),
        ...(why ? [el("p", { class: "ov-failed", role: "status" }, el("span", { class: "ov-quiet" }, O().FAILED[why]), " ", again({ retry }))] : []),
        el("ol", { class: "ov-rows" }, allRow, ...rowsOf.map((x) => {
          const line = [x.area || (x.member ? (areasMissing.has(x.id) ? null : "No boundary held yet") : "Not one of your places"), x.sites ? O().plural(x.sites, "site", "sites") : null, x.results ? O().plural(x.results, "sample", "samples") : null].filter(Boolean).join(" · ");
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
    const save = () => store.set(key, O().startText(filter));   // (the sort only: CO1b)
    // choosing a sub-group (in the list or on the map): the tiles and the map follow it; a second click on it (or its row's Open) goes
    // into it; "All sub-groups" clears it (the owner, 14 Nov 2026: on a computer the first click filters, the second opens; a phone
    // goes straight in, PH5)
    const open = (id) => {
      if (!subs.some((s) => s.id === id && s.member)) return;
      const a = A.get(id);   // TR1: its outline handed to the overview it opens on (map-handoff.js)
      if (a?.shape) FP.mapHandoff?.entering({ id, kind: "subgroup", geometry: a.shape.geometry, bbox: a.shape.bbox });
      root.location.hash = hrefOf(id);
    };
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
    const ctx = () => ({ group, groups, subs, areas: A, sites: all, scope: scope(), classes, plan, filter, loaded, sitesRead, members, el, O: O(), bar, hrefOf, sb, today: opts.today || null, now,
      href: (view, tab) => FP.href(FP.groupModel.href(org(), view, tab || null)), waterQuality: () => { wqIntent = true; }, wqSummary,
      failed: { subgroups: failedReads.subgroups, members: failedReads.members, areas: failedReads.areas, areaHere: areaHere(), water: loaded ? waterFailed() : null }, retry: (button) => retry(button) });
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
      if (x === false) return { sentence: "The trends couldn't be read just now.", bar: [], basis: null, href: null, failed: true };
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
      for (const q of leadBox.querySelectorAll(".ov-quiet, h2")) q.title = q.dataset.full || q.textContent;   // (CO1b review: the row's lines are clamped; whole on hover)
      leadBox.hidden = !lead.length;
      cardsBox.replaceChildren(...nodes);
      cardsBox.parentElement.hidden = !nodes.length;
      copyText.hidden = !leadBox.querySelector(".ov-num") && !cardsBox.querySelector(".ov-num");
      const c0 = ctx();
      // (CO1b: said once the sub-groups are known, so the line never changes under the reader)
      scopeLine.textContent = !subsKnown ? "" : [O().scopeWords({ name: group.name, isSub, subgroups: subs, selectedName: filter.sub ? subName(filter.sub) : null, known: !failedReads.subgroups }), asAt(c0)].filter(Boolean).join(" · ");
      scopeLine.hidden = !scopeLine.textContent;
      scopeLine.title = scopeLine.textContent;   // (CO1b: at most three lines are shown; the whole line on hover)
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
        try { cardData.set(k, await d.load(c, set)); } catch { cardData.set(k, O().READ_FAILED); }
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
      return el("span", { class: "ov-badge", style: "--ring: " + hueOf(sub.id), "aria-hidden": "true" }, logo ? el("img", { src: logo.src, alt: "" }) : codes.get(sub.id) || FP.icons?.monogram(sub.name) || "");
    }
    // (PH5: a sub-group's own fill colour, the same on every map; CO1's list swatches use it too)
    const hueOf = (id) => (id !== group.id && P?.subgroupColours && subColour(id) ? subColour(id) : P ? P.look(P.hues(css)[P.hueIndex(id)], { sub: true, onDark: onDark() }).line : "currentColor");
    function drawNote() {
      // the calm line, on the map, when no boundary is held (CO1b review: never over "The map couldn't open here.")
      if (mapFailed) return;
      const line = loaded ? O().emptyLine({ areas: A, sites: all, filter, sitesRead, areasFailed: areaHere() }) : null, onMap = !!line && (/^No boundary/.test(line) || line === O().FAILED.areas);
      mapNote.textContent = onMap ? line : ""; mapNote.hidden = !onMap;
    }

    // ---- the map ---------------------------------------------------------------------------------------------------------
    const gl = root.maplibregl;
    let map = null, base = null, markers = [], hover = null, popup = null, framedKey = null;
    // WQ3 (the live walk's "Cannot read properties of undefined (reading 'getLayer')" on leaving Home for Maps): leaving the page removed
    // the map but this view still held it, and the pointer leaving a sub-group's row as Maps replaced the page lit the row's area on the
    // removed map (highlight -> map.getLayer -> this.style.getLayer, its style gone). The map is let go here, as it is removed, so every
    // `map?.` and `if (map)` below finds none; and nothing is lit once the page has closed.
    me.offs.push(() => { const m = map; map = me.map = null; for (const x of markers) { try { x.marker.remove(); } catch { /* gone */ } } markers = []; try { hover?.remove(); popup?.remove(); } catch { /* gone */ } try { m?.remove(); } catch { /* already gone */ } });
    const choices = () => { const n = FP.basemaps?.names || []; return n.length >= 2 ? n : FP.demo?.active ? ["aerial", "topo"] : []; };
    const onDark = () => (base === "aerial" && (FP.basemaps?.names || []).includes("aerial")) || darkTheme();
    // (MV1: "Shade outside the group", the 45% darkening, a switch in the panel, on unless the person has turned it off on this device)
    const show = { subs: true, sites: false, shade: store.get(SHADE_KEY) !== "off" };   // the water quality sites are off on the overview, on in the Layers panel
    const themes = { list: null, layersOn: new Set(), added: new Set() };
    // SE1: "Edit the outline" (shape-editor.js on the group's own area), offered to RCL staff in a two-factor session on a computer;
    // while it is open the map's clicks are the editor's (outlineTap) and the panel steps aside (group-overview.css)
    let outlineOK = false, outlineTap = null, outlineSaid = "";
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
        // TR1: the group's own edge drawn as Places draws the group (its hue's line; a sub-group's in its parent's hue, lighter), the same
        // as on its Home on a phone, so the move from Places reads as zooming into the same thing (it was a thin white line)
        const ownLook = own && P ? P.look(P.hues(css)[P.hueIndex(group.parent_org_id || group.id)], { sub: !!group.parent_org_id, onDark: onDark() }) : null;
        f.push({ type: "Feature", geometry: a.shape.geometry, properties: { id, own, name: own ? group.name : subName(id), line: sub ? sub.line : ownLook ? ownLook.line : onDark() ? "#ffffff" : look.line, fill: sub ? sub.fill : look.fill || hue, casing: look.casing,
          lw: own ? ownLook?.lineWidth ?? 1 : sub ? sub.lineWidth : 1.2, lo: own ? (ownLook ? 1 : 0.7) : 0.9, fo: own ? 0 : sub ? sub.fillOpacity : 0.07, dim: sc && !sc.includes(id) && !own ? 1 : 0 } });
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
      if (map.getLayer("ov-mask")) map.setLayoutProperty("ov-mask", "visibility", show.shade ? "visible" : "none");   // MV1
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
      spread();
      declutter();
    }
    // CO1b (the owner's walk: the GR marker sat under LW): markers never sit on each other. Each shown marker's round badge is moved the
    // least it takes (group-overview-model spreadMarks), worked out again as the map zooms; the name beside it follows
    function spread() {
      if (!map) return;
      const shownMarks = markers.filter((m) => !m.node.hidden), off = O().spreadMarks(shownMarks.map((m) => map.project(m.marker.getLngLat())), 32);
      shownMarks.forEach((m, i) => m.marker.setOffset([(m.group ? -20 : -14) + off[i].dx, off[i].dy]));
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
      if (!live()) return;
      if (map?.style && map.getLayer("ov-area-hi")) for (const l of ["ov-area-hi", "ov-area-hiline"]) map.setFilter(l, ["==", ["get", "id"], id || ""]);
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
      // (CO1b: with areas held, the sites arriving later never move the map: they are not part of the frame then)
      const fk = (filter.sub || "all") + "|" + A.size + "|" + (A.size ? "" : all.length);
      if (!force && fk === framedKey) return;
      framedKey = fk;
      const { bounds, padding, maxZoom } = frameOf();
      map.resize();
      map.fitBounds(bounds, { padding, maxZoom, duration: smooth && !reducedMotion() ? 750 : 0 });
    }
    function frameOf() {
      const boxes = filter.sub ? [A.get(filter.sub)?.shape.bbox].filter(Boolean) : [...A.values()].map((a) => a.shape.bbox);
      const pts = scope().map((s) => s.lngLat).filter(Boolean);
      if (!boxes.length && pts.length) boxes.push([[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]]);
      // (MV1: the panel sits at the left, the column of controls at the right)
      const left = layersBody.hidden ? 48 : Math.min(300, layersPanel.offsetWidth + 24);
      return { bounds: boxes.length ? FP.homeModel.union(boxes) : keptFrame || CANTERBURY, padding: { top: 40, bottom: 40, left, right: 56 }, maxZoom: boxes.length || keptFrame ? 13 : 8 };
    }
    // CO1b: the group's shapes are on the map (or it is known there are none): "Loading map…" goes and the map shows. The frame they
    // make is kept on this device for the next visit.
    function reveal() {
      if (!live() || !mapBox.classList.contains("loading")) return;
      mapBox.classList.remove("loading", "framed");
      mapWait.hidden = true;
      if (A.size) { const t = O().frameText(FP.homeModel.union([...A.values()].map((a) => a.shape.bbox))); if (t) store.set(frameStore, t); }
    }
    let areasKnown = false;
    // the shapes drawn once both the map and the areas are ready; shown once the map has the shapes' tiles (or after a moment)
    function shapesIn() {
      if (!map?.getSource("ov-areas") || !areasKnown) return;
      drawAreas(); drawSites();
      if (me.handoff && !me.arrived && !keepCamera) { arriveFrom(me.handoff); return; }   // TR1: arriving from another map
      if (keepCamera) { map.jumpTo(keepCamera); keepCamera = null; } else frame(true);   // (made again: where it was)
      if (!A.size) { reveal(); return; }
      // WQ3 (CI: "Cannot read properties of null (reading 'off')"): this map is held in `m`; the 1.5 s timer and the map's events can
      // come after the page closed (the map let go) or after the map was made again, so none of them reaches for `map`, and the timer
      // is cleared when the page closes
      const m = map;
      let done = false, timer = 0;
      const go = () => {
        if (done) return; done = true; clearTimeout(timer);
        try { m.off("sourcedata", check); } catch { /* the map is gone */ }
        reveal();
      };
      const check = () => { if (done || !live() || map !== m) return; if (m.isSourceLoaded?.("ov-areas")) m.once("render", go); };
      m.on("sourcedata", check);
      timer = setTimeout(go, 1500);
      me.offs.push(() => clearTimeout(timer));
      check();
    }
    // TR1: the shapes are in, on a map that took a hand-over: the picture fades once this map has drawn under it, then ONE ease to the
    // group's frame while the darkening, the sub-groups' fills and their marks fade in (map-handoff.js). Later arrivals (sites) never
    // move it.
    const ARRIVING = ["ov-mask", "ov-area-fill", "ov-area-line", "ov-area-casing"];
    async function arriveFrom(h) {
      me.arrived = true;
      const Hd = FP.mapHandoff, m = map;
      framedKey = (filter.sub || "all") + "|" + A.size + "|" + (A.size ? "" : all.length);
      for (const id of ARRIVING) Hd.setLevel(m, id, 0);
      for (const x of markers) x.node.classList.add("tr-in");
      reveal();
      await h.reveal(m);
      if (!live() || m !== map) return;
      Hd.fade(m, ARRIVING, { to: 1, ms: 500 });
      // (the areas may land well after the picture has gone: a map the person has moved meanwhile stays where they put it)
      if (h.mayMove(m)) await Hd.ease(m, frameOf());
    }
    async function useBase(k) {
      base = k; markBg();
      const names = FP.basemaps?.names || [];
      const m = map;
      // TR1: Aerial | Topo cross-faded (basemaps.js swap); WQ3: the same map throughout, or nothing more is done to it
      if (m && names.includes(k)) { try { await (FP.basemaps.swap || FP.basemaps.pick)(m, k); } catch { if (k !== "aerial" && live() && map === m) { try { await FP.basemaps.pick(m, "aerial"); base = "aerial"; markBg(); } catch { /* the plain ground */ } } } }
      if (!live() || map !== m) return;   // (the page closed, or the map was made again: its own ready step does this)
      if (map) { const first = ["ov-mask", "ov-area-fill"].find((l) => map.getLayer(l)); if (first && map.getLayer("ov-veil")) map.moveLayer("ov-veil", first); }
      paint();
    }
    function markBg() { for (const b of bgBox.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.base === base)); }
    // CO1b review: a map that cannot open says so, never "Loading map…" for good (the box leaves its loading state first)
    let mapFailed = false;
    function cannotOpen() { mapFailed = true; reveal(); mapNote.textContent = "The map couldn't open here."; mapNote.hidden = false; }
    // CO1b review: a map made again in place (FP.mapKeep, in a WebKit browser whose map went blank when its box changed size): the
    // same place and zoom, the same sub-group chosen, the same layers; its markers and shapes drawn again by the map's own ready step
    let keepCamera = null;
    function rebuild() {
      if (!live() || !map) return;
      keepCamera = { center: map.getCenter(), zoom: map.getZoom() };
      for (const m of markers) m.marker.remove();
      markers = [];
      hover?.remove(); popup?.remove();
      themes.added.clear();
      try { map.remove(); } catch { /* already gone */ }
      map = me.map = null;
      makeMap();
    }
    function makeMap() {
      if (!live() || map) return;
      if (!gl?.Map || !FP.basemaps?.style) { cannotOpen(); return; }
      if (!mapHost.isConnected || !mapHost.clientWidth || !mapHost.clientHeight) {
        // (no zero-size map: made once the box has a size)
        if (typeof ResizeObserver !== "undefined" && !me.sizeWatch) { me.sizeWatch = new ResizeObserver(() => { if (mapHost.clientWidth && mapHost.clientHeight) { me.sizeWatch.disconnect(); me.sizeWatch = null; makeMap(); } }); me.sizeWatch.observe(mapHost); }
        return;
      }
      try { gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js"); } catch { /* set already */ }
      // TR1: a hand-over not yet taken (the map is made before the first frame's check), and its background
      if (me.handoff === undefined) { me.handoff = FP.mapHandoff?.take({ box: mapHost, id: group.id }) || null; if (me.handoff) { me.handoff.cover(); mapWait.hidden = true; } }
      const h = !me.arrived && !keepCamera ? me.handoff : null;
      h?.refit();
      const start = base || (h?.base && choices().includes(h.base) ? h.base : null) || (P ? P.startBackground(store.get(BASE_KEY), choices()) : "aerial");
      base = start;
      // CO1b: opened on the group (its areas when they are read, else the frame kept from the last visit), never the whole region while
      // the group's shapes are on their way (the map is hidden behind "Loading map…" until then when no frame is kept); made again, where
      // it was. TR1: arriving from another map, where that map was (under its picture)
      const first = frameOf(), at = keepCamera ? { center: keepCamera.center, zoom: keepCamera.zoom } : h ? { center: h.camera.center, zoom: h.camera.zoom }
        : { bounds: first.bounds, fitBoundsOptions: { padding: first.padding, maxZoom: first.maxZoom } };
      try {
        map = me.map = new gl.Map({ container: mapHost, style: FP.basemaps.style(start, { reliefOnAerial: false }), ...at, maxZoom: 18,
          dragRotate: false, pitchWithRotate: false, attributionControl: { compact: true, ...(FP.brand?.org_legal ? { customAttribution: FP.brand.org_legal } : {}) } });
      } catch { map = me.map = null; cannotOpen(); return; }
      me.unhand?.(); me.unhand = FP.mapHandoff?.register(map, { kind: "overview", base: () => base, marks: () => mapHost.querySelectorAll(".ov-mark:not([hidden])") }) || null;
      h?.raise();   // (the picture stays over the map made under it)
      h?.watch(map);   // (and goes once this map has drawn, whatever the areas' read is doing)
      if (h) reveal();   // (the map shows under the picture; "Loading map…" is not needed)
      me.keep?.made();
      map.touchZoomRotate?.disableRotation?.();
      // MV1: one column of controls top right, as on the Maps tab: zoom, then "Whole group" (back to the group's own frame)
      map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
      const whole = el("button", { type: "button", class: "ov-whole", id: "ov-whole", onclick: () => { if (filter.sub) select(null); else frame(true, true); } }, isSub ? "Whole sub-group" : "Whole group");
      map.addControl({ onAdd: () => el("div", { class: "maplibregl-ctrl maplibregl-ctrl-group ov-whole-box" }, whole), onRemove: () => whole.parentElement?.remove() }, "top-right");
      map.addControl(new gl.ScaleControl({ unit: "metric" }), "bottom-right");   // (MV1: clear of the panel at the left)
      const made = map;
      const ready = () => {
        if (!live() || !map || map !== made || map.getSource("ov-areas")) return;   // (a late load of a map already replaced does nothing)
        map.addLayer({ id: "ov-veil", type: "background", paint: { "background-color": css("--map-background") || "#e4e6e2", "background-opacity": 0 } });
        map.addSource("ov-mask", { type: "geojson", data: maskData() });
        map.addSource("ov-areas", { type: "geojson", data: areaData() });
        map.addSource("ov-sites", { type: "geojson", data: siteData() });
        map.addLayer({ id: "ov-mask", type: "fill", source: "ov-mask", paint: { "fill-color": "#000000", "fill-opacity": P?.MASK_OPACITY ?? 0.45, "fill-antialias": false } });
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
          if (outlineTap) { hover.remove(); return; }   // (SE1: the outline editor has the pointer)
          if (onMark(e)) { hover.remove(); return; }
          const s = siteAt(e), f = s ? null : at(e);
          map.getCanvas().style.cursor = s || (f && subs.find((x) => x.id === f.properties.id)?.member) ? "pointer" : "";
          highlight(f?.properties.id || null);
          if (s) hover.setLngLat(e.lngLat).setText(s.properties.name).addTo(map); else if (f) hover.setLngLat(e.lngLat).setText(f.properties.name).addTo(map); else hover.remove();
        });
        map.on("mouseout", (e) => { hover.remove(); if (!onMark(e)) highlight(null); });
        map.on("click", (e) => {
          if (outlineTap) { outlineTap(e); return; }   // (SE1: a tap is the outline editor's: a + or a corner)
          if (onMark(e)) return;
          const s = siteAt(e);
          if (s) { const site = all.find((x) => x.id === s.properties.id); if (site) sitePopup(site); return; }
          const f = at(e), sub = f && subs.find((x) => x.id === f.properties.id);
          if (sub?.member) { if (sub.id === filter.sub) open(sub.id); else select(sub.id); }
        });
        map.on("moveend", declutter); map.on("zoom", () => { zoomMarks(); spread(); });
        if (areasKnown) shapesIn(); else drawSites();
        useBase(start);
        for (const t of themes.list || []) if (t.layers.some((L) => themes.layersOn.has(L.key))) showLayers(t);   // (made again: its layers back)
      };
      if (map.isStyleLoaded?.()) ready(); else { map.once("load", ready); map.once("style.load", ready); }
      if (me.watching) return;   // (the page's own watchers, once, whichever map is current)
      me.watching = true;
      me.keep = FP.mapKeep?.watch?.(mapBox, rebuild) || null;
      me.keep?.made();
      me.offs.push(() => me.keep?.stop());
      // the theme changed: the same places in the colours for it
      const scheme = root.matchMedia?.("(prefers-color-scheme: dark)"), recolour = () => paint();
      scheme?.addEventListener?.("change", recolour);
      const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(recolour);
      watch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      me.offs.push(() => scheme?.removeEventListener?.("change", recolour), () => watch?.disconnect());
      // a window resized (or the panel folded): the map keeps its frame. (CO1b: the map is made only once the page around it has its
      // final shape, so loading never resizes it; a browser built on WebKit, as the review rig's is, stopped showing a map whose canvas
      // changed size after it was first drawn: the overview's map was made at once and then squeezed as the list and numbers arrived)
      const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { map?.resize(); spread(); declutter(); });
      resize?.observe(mapHost); me.offs.push(() => resize?.disconnect());
    }

    // ---- the Layers panel ------------------------------------------------------------------------------------------------
    function drawLayers() {
      const ch = choices();
      bgBox.replaceChildren(...(ch.length >= 2 ? [["aerial", "Aerial"], ["topo", "Topo"]].filter(([k]) => ch.includes(k)).map(([k, t]) => el("button", { type: "button", "data-base": k, id: "ov-base-" + k,
        "aria-pressed": String(base === k), onclick: () => { store.set(BASE_KEY, k); useBase(k); } }, t)) : []));
      bgBox.hidden = ch.length < 2;
      // MV1: each a switch (a checkbox drawn as one), what its colours mean under it while it is on (maps.css hides the key while off)
      const box = (id, label, on, change, extra = {}) => el("label", { class: "ov-check" }, el("input", { type: "checkbox", class: "ov-switch", id, ...(on ? { checked: true } : {}), ...extra, onchange: (e) => change(e.target.checked) }), el("span", {}, label));
      const c = clsColours(), key = (cls, text, kind = "dot") => el("ul", { class: "ov-rowkey", "aria-label": "Key" }, el("li", {}, el("span", { class: "ov-key " + kind, "data-cls": cls, ...(kind === "dot" && c[cls] ? { style: "--key: " + c[cls] } : {}) }), text));
      // a theme (N1): its switch turns on the layers marked to start on (CTX2's starts_on; every layer when none is marked), and each
      // layer is one level down, folded
      const themeRow = (t, i) => {
        const on = t.layers.filter((L) => themes.layersOn.has(L.key)).length;
        return el("div", { class: "ov-theme" }, box("ov-theme-" + i, t.name, on > 0, (v) => theme(i, v)),
          t.layers.length > 1 ? el("details", { class: "ov-theme-layers" }, el("summary", {}, on ? on + " of " + t.layers.length + " on" : t.layers.length + " layers"),
            ...t.layers.map((L) => box("ov-layer-" + L.key, L.title, themes.layersOn.has(L.key), (v) => layer(i, L.key, v)))) : null);
      };
      showBox.replaceChildren(...[
        A.size ? el("div", { class: "ov-prow" }, box("ov-show-subgroups", subs.length ? "Sub-groups" : "The group's area", show.subs, (v) => { show.subs = v; drawAreas(); }),
          key("area", subs.length ? "Each sub-group in its own colour, as in the list" : "The group's area", "line")) : null,
        // (OV1: the map's dots are N2c's useful sites, which the sites and their counts decide: not all read, the switch is not offered
        // to show some or none of them; one quiet line says so)
        loaded && (failedReads.areas || failedReads.sites.size || failedReads.counts) ? el("p", { class: "ov-quiet ov-check" }, "Water quality sites couldn't be read just now.")
          : all.length ? el("div", { class: "ov-prow" }, box("ov-show-sites", "Water quality sites", show.sites, (v) => { show.sites = v; drawSites(); drawLegend(); }), key("quiet", "Water quality site")) : null].filter(Boolean));
      showBox.hidden = !showBox.childElementCount;
      // the Reference group: the context themes, then the darkening outside the group
      refBox.replaceChildren(el("p", { class: "ov-ref-head", id: "ov-ref-head", role: "heading", "aria-level": "3" }, "Reference"), ...(themes.list || []).map(themeRow),
        A.size ? el("div", { class: "ov-prow" }, box("ov-show-shade", isSub ? "Shade outside the sub-group" : "Shade outside the group", show.shade, (v) => { show.shade = v; store.set(SHADE_KEY, v ? "on" : "off"); drawAreas(); })) : null,
        // SE1: the group's own outline redrawn on this map (RCL staff, two-factor, a computer)
        outlineOK && A.has(group.id) ? el("div", { class: "ov-prow ov-outline" }, el("button", { type: "button", class: "ov-outline-edit", id: "ov-outline-edit", onclick: () => editOutline() }, isSub ? "Edit the sub-group's outline" : "Edit the group's outline"),
          outlineSaid ? el("p", { class: "ov-quiet", role: "status" }, outlineSaid) : null) : null);
      refBox.hidden = refBox.childElementCount < 2;
      factsLine.textContent = [subs.length && !failedReads.subgroups ? O().plural(subs.length, "sub-group", "sub-groups") : null, O().hectares(A.get(group.id)?.ha)].filter(Boolean).join(" · ");
      drawLegend();
    }
    // SE1: the editor on the group's own area. A save (or the earlier outline put back) is drawn at once: the outline, its fill and the
    // shading outside follow the new shape, and the facts line its area; Home on a phone, Places and the Maps tab read it next time.
    async function editOutline() {
      const m = map;
      if (!m || !FP.shapeEditor?.outline || !live()) return;
      const b = wrap.querySelector("#ov-outline-edit");
      if (b) { b.disabled = true; b.textContent = "Opening…"; }
      outlineSaid = "";
      const said = await FP.shapeEditor.outline({ space: "group", owner: group.id, role: group.role, sb,
        surface: { glMap: () => m, capture: (fn) => { outlineTap = fn || null; } },
        snaps: () => [...A].filter(([k]) => k !== group.id).map(([, a]) => a.shape.geometry),
        onSaved: (r) => outlineSaved(r) }, group.name);
      if (!live()) return;
      if (said !== true) outlineSaid = said || "";
      drawLayers();
    }
    function outlineSaved(r) {
      if (!live() || !r?.geometry) return;
      for (let i = areaRows.length - 1; i >= 0; i--) if (areaRows[i]?.org_id === group.id) areaRows.splice(i, 1);
      areaRows.push({ org_id: group.id, geom: r.geometry });
      A = O().areas(areaRows.filter((x) => visibleIds().includes(x?.org_id)));
      drawAreas(); drawLayers(); drawList(); drawCards();   // (the area's hectares in the list and the tiles follow too)
    }
    // (MV1: the key is under each switch; this box is kept, empty and hidden, for anything that still asks for it)
    function drawLegend() { legendBox.hidden = true; }
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
      const m = map;
      if (!m) return;
      for (const L of t.layers) {
        const want = themes.layersOn.has(L.key), src = "ov-ctx-" + L.key;
        if (want && !themes.added.has(L.key)) {
          themes.added.add(L.key);
          pmtilesProtocol(gl);
          try {
            const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(L.tiles_path, LINK_SECONDS);
            if (error || !data?.signedUrl || !live() || map !== m) continue;
            if (!m.getSource(src)) m.addSource(src, { type: "vector", url: "pmtiles://" + data.signedUrl });
            L.layers.forEach((d, j) => { try { m.addLayer({ id: src + "-" + j, source: src, "source-layer": L.source_layer, ...d, layout: { ...d.layout, visibility: "none" } }, "ov-area-fill"); } catch { /* a definition the map refuses is left out */ } });
          } catch { /* this layer is left out; the rest of the theme still draws */ }
        }
        if (!live() || map !== m) return;
        L.layers.forEach((_, j) => { const id = src + "-" + j; if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", want ? "visible" : "none"); });
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
    foldLayers(store.get(LAYERS_KEY) !== "folded");   // MV1: open, as the Maps tab's panel is, unless folded on this device

    // ---- the selection ---------------------------------------------------------------------------------------------------
    async function setFilter(next, smooth = false) {
      filter = { ...filter, ...next, period: "all" };
      save();
      ++token;   // (trends still being asked for the old selection are dropped)
      if (!live()) return;
      startTrends();
      drawList(); drawCards();
      if (smooth) redim(drawAreas); else drawAreas();
      drawSites(); drawLegend(); drawNote(); frame(false, smooth);
      loadCards();
    }
    // TR1: a sub-group chosen (or All): the others' dimming moves by fading, never a jump: the old dimming fades back to full, the new
    // selection is drawn, and its dimming fades in, while the camera eases to it (frame). At once where the device asks for less motion.
    const dimAt = (k) => {
      if (!live() || !map?.style || !map.getLayer("ov-area-fill")) return;   // (the page left mid-fade: nothing asked of its removed map)
      const mix = (dimmed, full) => (k >= 1 ? dimmed : ["+", ["*", k, dimmed], ["*", 1 - k, full]]);
      map.setPaintProperty("ov-area-fill", "fill-opacity", ["case", ["==", ["get", "dim"], 1], mix(0.08, ["get", "fo"]), ["get", "fo"]]);
      map.setPaintProperty("ov-area-line", "line-opacity", ["case", ["==", ["get", "dim"], 1], mix(0.35, ["get", "lo"]), ["get", "lo"]]);
    };
    let dimRun = 0;
    async function redim(change) {
      const Hd = FP.mapHandoff, mine = ++dimRun;
      if (!Hd?.tween || !map?.getLayer("ov-area-fill")) { change(); return; }
      await Hd.tween(140, (k) => { if (mine === dimRun) dimAt(1 - k); });
      if (mine !== dimRun || !live()) return;
      change();
      await Hd.tween(260, (k) => { if (mine === dimRun) dimAt(k); });
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
    // OV1: each step keeps what came back and notes what did not (failedReads), so a number is drawn only from a read that came back,
    // and Try again reads only what failed (and what it leads to), once, in the same requests and the same batches as the first time
    let siteReads = [], siteIds = [], stage = "subgroups";
    const areaRows = [], areaAsked = new Set(), counted = new Set();
    const visibleIds = () => [group.id, ...subs.filter((x) => x.member).map((x) => x.id)];
    const membersRead = () => headCount(sb.from("group_members").select("id", { count: "exact", head: true }).eq("org_id", group.id).is("ended_at", null));
    function takeAreas(ids, got) {
      for (const id of ids) areaAsked.add(id);
      for (const id of ids) if (got === null) areasMissing.add(id); else areasMissing.delete(id);
      if (got) areaRows.push(...got);
      failedReads.areas = areasMissing.size > 0;
      A = O().areas(areaRows.filter((r) => visibleIds().includes(r?.org_id)));
    }
    // the sites inside each area: the group's own (when it has one) and each sub-group's (to know which sub-group a site is in)
    const areaOrgs = () => [...(A.has(group.id) ? [group.id] : []), ...subs.filter((x) => A.has(x.id)).map((x) => x.id)];
    async function readSites(orgs) {
      const got = await pool(orgs.map((o) => async () => ({ org: o, rows: await rows(sb.rpc("group_wq_sites", { g: o, km: 0 })) })), SITES_POOL);
      for (const r of got) {
        siteReads = siteReads.filter((x) => x.org !== r.org);
        if (r.rows === null) failedReads.sites.add(r.org); else { failedReads.sites.delete(r.org); siteReads.push({ org: r.org, rows: r.rows }); }
      }
      siteIds = [...new Set(siteReads.flatMap((r) => r.rows.map((x) => Number(x.site_id))).filter(Number.isFinite))];
    }
    // the counts of the sites not yet counted (all of them the first time, or after a failure): all or nothing (readCounts)
    async function readSiteCounts() {
      const ids = siteIds.filter((id) => !counted.has(id));
      if (!ids.length) { failedReads.counts = false; return; }
      const got = await readCounts(sb, ids, null);
      if (got === null) { failedReads.counts = true; return; }
      counts.set("all", [...(counts.get("all") || []), ...got]);
      for (const id of ids) counted.add(id);
      failedReads.counts = false;
    }
    function settleSites() {
      sitesRead = !failedReads.areas && !failedReads.sites.size && !failedReads.counts;
      all = O().sites(siteReads, counts.get("all") || [], null, now);
    }
    // CO1b: the areas are asked for at once, beside the sub-groups (not after them): the group's own and those of its sub-groups the
    // person is in, known from their own places; any other sub-group the list says they are in is asked for when the list comes
    const firstIds = [group.id, ...(isSub ? [] : list(groups).filter((g) => g.parent_org_id === group.id).map((g) => g.id))];
    const areasAsked = readAreas(sb, firstIds).catch(() => null);
    (async () => {
      const [s, m] = await Promise.all([readSubgroups(sb, group, groups).catch(() => ({ subs: [], failed: true })), isCoordinator ? membersRead() : null]);
      if (!live()) return;
      subs = s.subs; failedReads.subgroups = s.failed; members = m; failedReads.members = isCoordinator && m === null; subsKnown = true;
      codes = O().distinctCodes(subs.map((x) => ({ key: x.id, name: x.name })), FP.icons?.monogram);
      layout = O().layoutFrom(store.get(O().cardsKey(person?.id, group.id)), cards.available(viewer));
      // (CO1b: All sub-groups, unless the address names one the person is in)
      filter = O().startFilter(store.get(key), subs, opts.sub || null);
      drawList(); drawCards(); loadCards();
      // the page has its final shape now (the list, the headline): the map is made at its own size, never squeezed afterwards
      (root.requestAnimationFrame || ((f) => setTimeout(f, 0)))(() => makeMap());
      stage = "areas";
      const more = visibleIds().filter((id) => !firstIds.includes(id));
      const first = await areasAsked, second = more.length ? await readAreas(sb, more).catch(() => null) : [];
      if (!live()) return;
      takeAreas(firstIds, first); takeAreas(more, second);
      areasKnown = true;
      drawList(); drawCards(); drawLayers(); shapesIn();
      // SE1: asked once the group's own area is known (only staff with a role that may change it, on a computer, ask the session's level)
      if (A.has(group.id)) FP.shapeEditor?.outlineOffered?.({ sb, role: group.role, hasArea: true }).then((ok) => { if (live() && ok) { outlineOK = true; drawLayers(); } }, () => {});
      stage = "sites";
      await readSites(areaOrgs());
      stage = "counts";
      await readSiteCounts();
      stage = "drawn";
      if (!live()) return;
      settleSites();
      loaded = true;
      wrap.setAttribute("aria-busy", "false");
      startTrends();
      drawList(); drawCards(); drawLayers(); drawNote();
      if (map?.getSource("ov-areas")) { drawSites(); frame(); }
    })().catch(() => {
      if (!live()) return;
      // (a step that threw is a read that failed, said as such)
      if (stage === "subgroups") failedReads.subgroups = true; else if (stage === "areas") { for (const id of visibleIds()) if (!A.has(id)) areasMissing.add(id); failedReads.areas = areasMissing.size > 0; }
      else if (stage === "sites") for (const o of areaOrgs()) failedReads.sites.add(o); else if (stage === "counts") failedReads.counts = true;
      settleSites();
      loaded = true; areasKnown = true; subsKnown = true; wrap.setAttribute("aria-busy", "false"); drawList(); drawCards(); drawLayers(); drawNote(); makeMap(); shapesIn();
    });

    // OV1: Try again (a tile's, or the list's): every read on the page that failed is made once more, on the person's tap only (never by
    // itself: a database that has just timed out is not asked again unasked), each in its own requests and batches as before; what
    // comes back is drawn, and what fails again is said again
    let retrying = false;
    async function retry() {
      if (retrying || !live() || !loaded) return;
      retrying = true;
      for (const b of wrap.querySelectorAll("button.ov-again")) { b.disabled = true; b.textContent = "Trying again…"; }
      try {
        const jobs = [];
        for (const [k, d] of [...cardData]) if (O().failed(d)) cardData.delete(k);
        jobs.push(loadCards());
        // (the Water quality page's summary: asked again where it failed; its loader keeps every read and batch that came back, and
        // lets go only of a sub-groups or boundaries read that failed, so only what is missing is asked again)
        let askAgain = false;
        for (const [k, x] of [...wqSums]) if (x === false || x?.lawaFailed) { wqSums.delete(k); askAgain = true; }
        if (askAgain) await FP.wqPage?.forgetFailed?.(group.id);
        if (failedReads.members) jobs.push(membersRead().then((n) => { members = n; failedReads.members = n === null; }));
        jobs.push((async () => {
          if (failedReads.subgroups) {
            const r = await readSubgroups(sb, group, groups).catch(() => null);
            if (r && !r.failed) { subs = r.subs; failedReads.subgroups = false; codes = O().distinctCodes(subs.map((x) => ({ key: x.id, name: x.name })), FP.icons?.monogram); }
          }
          const ask = visibleIds().filter((id) => areasMissing.has(id) || !areaAsked.has(id));
          if (ask.length) takeAreas(ask, await readAreas(sb, ask).catch(() => null));
          const orgs = areaOrgs().filter((o) => !siteReads.some((r) => r.org === o));
          if (orgs.length) await readSites(orgs);
          await readSiteCounts();
        })());
        await Promise.all(jobs);
      } catch { /* each read has said what it could */ }
      retrying = false;
      if (!live()) return;
      settleSites();
      startTrends();
      drawList(); drawCards(); drawLayers(); drawNote();
      if (map?.getSource("ov-areas")) { drawAreas(); drawSites(); frame(); }
    }

    // the context layers' themes (N1), listed in the Layers panel; their files are signed only when a theme is switched on
    const safe = (make) => { try { return rows(make()); } catch { return Promise.resolve(null); } };
    safe(() => sb.from("core_layers").select("key, title, style, tiles_path").not("style->reference", "is", null).order("key").limit(40))
      .then((r) => { if (!live() || !r) return; themes.list = O().contextThemes(r); drawLayers(); });

    drawLayers(); drawCards();
    me.wrap = wrap;
    // TR1: arriving from another map (Places, a sub-group's overview, Maps): its picture covers this map's box from the first frame the
    // page is drawn (no "Loading map…" between two maps); the map is made under it, at the camera that keeps the ground where it was
    // (map-handoff.js), and moves on once its shapes are in (arriveFrom)
    // (as soon as the overview is on the page, in the same task that put it there; else at the next frame)
    const takeHandoff = () => {
      if (!live() || me.handoff !== undefined || !mapHost.isConnected) return;
      me.handoff = FP.mapHandoff?.take({ box: mapHost, id: group.id }) || null;
      if (me.handoff) {
        me.handoff.cover(); mapWait.hidden = true;
        // (the picture gone before the map is made, its reads still on their way: "Loading map…" again)
        me.handoff.gone.then(() => { if (live() && !map) mapWait.hidden = false; });
      }
    };
    (root.queueMicrotask || ((f) => Promise.resolve().then(f)))(takeHandoff);
    (root.requestAnimationFrame || ((f) => setTimeout(f, 0)))(takeHandoff);
    return wrap;
  }

  function close() {
    if (!shown) return;
    const s = shown; shown = null; s.alive = false;
    try { s.handoff?.drop(); s.unhand?.(); } catch { /* already gone */ }   // TR1
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
