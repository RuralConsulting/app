// WQV1: a group's Water quality page (`#/group/<id>/water`), for a group and for a sub-group. On a computer, top to bottom: one filter bar
// for the whole page (Surface water | Groundwater, the measure, the sub-group, the period, the older-and-sparse switch), the headline
// figures with LAWA's trend as a stacked bar and one sentence, then the same rows three ways: Map (one panel for the supporting layers and
// the legend; a site opens its chart in a column beside the map), Chart (the ticked sites, or the median of the sites' yearly medians) and
// Table (sortable, downloadable). On a phone a quick answer: the two water types, the sentence and bar for the first measure, the sites
// (the group's own first), each opening its chart, and the map one tap away.
// Every read is the signed-in person's own, through the existing policies and the security-invoker functions of migration 20261113071000:
// wq_area_sites (the group's area: every served water-quality site source and the group's own sites the person may read), places (the
// group's and its sub-groups' areas the person may read), subgroup_counts (the sub-groups' names), site_record_summary (WQ1, one family at a
// time), wq_site_figures and wq_state_trend_for_sites (at most 200 sites a call), and public.measurements for the ticked sites only, a
// page of 1,000 at a time. Nothing here widens what anyone can read; the words and the rules are wq-page-model.js's.
(function (root) {
  const FP = root.FP;
  const M = () => FP.wqPageModel, W = () => FP.wqModel, S = () => FP.wqSitesModel;
  const el = (...a) => FP.el(...a);
  const list = (v) => (Array.isArray(v) ? v : []);
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const BATCH = 200, LAWA_BATCH = 100, PAGE = 1000, MAX_PAGES = 20;
  const isPhone = () => !!root.matchMedia?.("(max-width: 800px)").matches;
  const fmt = (n) => Number(n || 0).toLocaleString("en-NZ");
  const href = (groupId) => FP.href(FP.groupModel.href(groupId, "water"));

  // ---- reads, kept per group for the session (a failed read is not kept) --------------------------------------------------------------
  const loaders = new Map();
  function loader(sb, groupId) {
    const hit = loaders.get(groupId);
    if (hit && hit.sb === sb) return hit;
    const cache = new Map();
    const once = (key, make) => {
      if (!cache.has(key)) { const p = make(); cache.set(key, p); p.catch(() => { if (cache.get(key) === p) cache.delete(key); }); }
      return cache.get(key);
    };
    const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data || []; };
    const soft = (p) => p.then((x) => x, () => null);
    // The group's sites (wq_area_sites: every served water-quality site source, ECan's rivers and wells and NIWA's network alike, and the
    // group's own, its sub-groups' own and datasets shared to it, as the person may read them), its area and its sub-groups' (those the person may read). Before that function is deployed, S5's
    // group_wq_sites (ECan's 'ecan-wq-sites' and the own sites only).
    const missing = (e) => ["PGRST202", "42883"].includes(e?.code);
    const sitesOf = () => rpc("wq_area_sites", { g: groupId }).catch((e) => (missing(e) ? rpc("group_wq_sites", { g: groupId }) : Promise.reject(e)));
    const base = () => once("base", async () => {
      const [rows, subs] = await Promise.all([sitesOf(), soft(rpc("subgroup_counts", { parent_org: groupId }))]);
      const subList = list(subs).map((s) => ({ id: s.subgroup_id, name: s.subgroup_name, member: !!s.is_member }));
      const ids = [groupId, ...subList.map((s) => s.id)];
      const areas = await soft(sb.from("places").select("org_id, geom").eq("kind", "area").is("valid_to", null).in("org_id", ids).limit(ids.length * 4)
        .then(({ data, error }) => { if (error) throw error; return data || []; }));
      const ringsOf = (id) => list(areas).filter((a) => a.org_id === id).flatMap((a) => M().rings(a.geom));
      return { rows: list(rows), area: ringsOf(groupId), subs: subList.map((s) => ({ ...s, rings: ringsOf(s.id) })) };
    });
    // WQ1's summary of one family for these sites: one row per site, BATCH ids a call, each paged (the API answers at most 1,000 rows).
    const summary = (family, ids) => once("summary|" + family, async () => {
      const out = {};
      for (let i = 0; i < ids.length; i += BATCH) {
        for (let page = 0; page < MAX_PAGES; page++) {
          const { data, error } = await sb.from("site_record_summary").select("site_id, family, n, first_sampled, last_sampled").in("site_id", ids.slice(i, i + BATCH)).eq("family", family)
            .order("site_id").range(page * PAGE, (page + 1) * PAGE - 1);
          if (error) throw error;
          for (const r of list(data)) out[r.site_id] = r;
          if (list(data).length < PAGE) break;
        }
      }
      return out;
    });
    // wq_site_figures for the sites asked (BATCH a call); each site is read once per family, period and field choice.
    const figureSets = new Map();
    async function figures(family, from, field, ids) {
      const key = family + "|" + (from || "all") + "|" + (field ? 1 : 0);
      const set = figureSets.get(key) || { rows: new Map(), asked: new Set() };
      figureSets.set(key, set);
      const missing = ids.filter((id) => !set.asked.has(id));
      for (let i = 0; i < missing.length; i += BATCH) {
        const part = missing.slice(i, i + BATCH);
        const rows = await rpc("wq_site_figures", { p_sites: part, p_family: family, p_from: from, p_include_field: !!field });
        for (const id of part) { set.asked.add(id); set.rows.set(id, []); }
        for (const r of list(rows)) set.rows.get(r.site_id)?.push(r);
      }
      return ids.flatMap((id) => set.rows.get(id) || []);
    }
    // LAWA's latest band and 10-year trend for the shared sites (LAWA_BATCH a call).
    const lawaRows = new Map();
    async function lawa(ids) {
      const missing = ids.filter((id) => !lawaRows.has(id));
      for (let i = 0; i < missing.length; i += LAWA_BATCH) {
        const part = missing.slice(i, i + LAWA_BATCH), rows = await rpc("wq_state_trend_for_sites", { p_sites: part, p_period_years: 10 });
        for (const id of part) lawaRows.set(id, []);
        for (const r of list(rows)) lawaRows.get(r.monitoring_site_id)?.push(r);
      }
      return Object.fromEntries(ids.map((id) => [id, lawaRows.get(id) || []]));
    }
    // One site's results of the keys, from a date, oldest first, a page at a time (bounded: MAX_PAGES pages).
    const series = (id, keys, from) => once(["series", id, keys.join(","), from || "all"].join("|"), async () => {
      const out = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        let q = sb.from("measurements").select("site_id, parameter, sampled_at, value, qualifier, value_text, unit, method, lab, source_parameter, source_key, replicate_no")
          .eq("site_id", id).in("parameter", keys).is("superseded_at", null).eq("aggregate", "");
        if (from) q = q.gte("sampled_at", from);
        const { data, error } = await q.order("sampled_at").range(page * PAGE, (page + 1) * PAGE - 1);
        if (error) throw error;
        out.push(...list(data));
        if (list(data).length < PAGE) break;
      }
      return out;
    });
    const L = { sb, base, summary, figures, lawa, series };
    loaders.set(groupId, L);
    return L;
  }

  // Everything one measure needs for one water type: the rows, from the summary and the bounded reads. figures: false (the overview
  // card) skips wq_site_figures: the rows, LAWA's classes and the sentence need only the summary and LAWA.
  async function rowsOf(L, st, now, { figures: withFigures = true } = {}) {
    const b = await L.base(), names = new Map([...b.subs.map((s) => [s.id, s.name]), ...(st.names || new Map())]);
    const all = M().sites(b.rows, { org: st.org, names });
    const m = M().measure(st.measure), family = m?.key || st.measure;
    const sub = st.sub ? b.subs.find((s) => s.id === st.sub) : null;
    const typeSites = M().filterSites(all, { type: st.type, sub: sub?.id || null, subRings: sub?.rings || null });
    const summary = await L.summary(family, all.map((s) => s.id));
    const ids = typeSites.filter((s) => s.own || summary[s.id]).map((s) => s.id);
    const from = M().periodFrom(st.period, now);
    const [figures, lawa] = await Promise.all([withFigures ? L.figures(family, from, st.includeField, ids) : [],
      L.lawa(typeSites.filter((s) => s.shared && s.sourceKey === "ecan-wq-sites" && summary[s.id]).map((s) => s.id)).catch(() => ({}))]);
    return { base: b, all, typeSites, rows: M().rowsFor(typeSites, { summary, figures, lawa, measureKey: st.measure, now }) };
  }

  // ---- the overview card's one call (MC1's Water quality card on a group's computer Home) -----------------------------------------------
  // One sentence, the stacked bar and how many sites LAWA's classes rest on, for a group (or one of its sub-groups, picked out of the
  // group's own sites exactly as the page's sub-group filter does), a water type and a measure, from the same rows as the page. A lighter
  // read than the page's: the sites, the summary of one family and LAWA, never wq_site_figures. A sub-group whose boundary the person
  // cannot read is said as such (noArea), never as having no sites.
  async function summary(sb, groupId, { measure = "nitrate", type = "surface", today = null, names = null, sub = null } = {}) {
    const now = today ? Date.parse(today + "T12:00:00+13:00") : Date.now();
    const L = loader(sb, groupId);
    if (sub) {
      const s = (await L.base()).subs.find((x) => x.id === sub);
      if (!s || !s.rings.length) return { sentence: null, bar: [], figures: null, basis: null, noArea: true, href: href(groupId) };
    }
    const st = { org: groupId, names: names || namesOf(), measure, type, sub, period: "all", includeField: false };
    const { rows } = await rowsOf(L, st, now, { figures: false });
    const h = M().headline(M().shownRows(rows, false));
    return { sentence: M().sentence(h, measure, type), bar: M().bar(h), figures: h, basis: M().basis(h, type), noArea: false, href: href(groupId) };
  }
  // The stacked bar, small: one element the card can place.
  function miniBar(parts, label = "LAWA's 10-year trends") {
    return el("div", { class: "wqp-bar", role: "img", "aria-label": label + ": " + list(parts).map((p) => p.n + " " + p.label.toLowerCase()).join(", ") },
      ...list(parts).map((p) => el("span", { class: "wqp-bar-part", style: "flex-grow: " + p.n + "; background: " + p.colour, title: p.label + ": " + p.n })));
  }
  const namesOf = () => new Map(list(FP.groupSpace?.groups?.()).map((g) => [g.id, g.name]));

  // ---- the page -----------------------------------------------------------------------------------------------------------------------
  // group: { id, name, role, parent_org_id }; opts: { sb, today ("YYYY-MM-DD"), groups (the person's groups) }.
  let live = null;
  function view(group, { sb = FP.sb, today = null, groups = [] } = {}) {
    live?.destroy();
    const now = today ? Date.parse(today + "T12:00:00+13:00") : Date.now();
    const names = new Map(list(groups).map((g) => [g.id, g.name]));
    const coordinator = ["facilitator", "advisor", "admin"].includes(group.role) || !!FP.ops?.isStaff?.();
    const st = { org: group.id, names, type: "surface", measure: "nitrate", sub: null, period: "all", showAll: false, view: "map", ticked: null, chosen: null,
      includeField: false, sort: { key: "own", dir: "asc" }, chartMode: "sites", layersOn: {} };
    const L = loader(sb, group.id);
    let token = 0, data = null, gone = false, phone = isPhone(), mapUi = null, chart = null, siteChart = null;
    const root_ = el("section", { class: "wqp", "aria-labelledby": "wqp-title", "data-type": st.type, "data-view": st.view });
    const status = el("p", { class: "wqp-status", role: "status", "aria-live": "polite" });

    // ---- the shell -------------------------------------------------------------------------------------------------------------
    const title = el("h1", { id: "wqp-title", tabindex: "-1" }, "Water quality");
    const sources = el("p", { class: "wqp-sources" });
    const typeSeg = segment("Water type", M().TYPES, () => st.type, (v) => { st.type = v; st.chosen = null; st.ticked = null; if (!M().measuresFor(v).first.concat(M().measuresFor(v).more).some((m) => m.key === st.measure)) st.measure = "nitrate"; draw(); }, "wqp-types");
    const measureBox = el("div", { class: "wqp-measures", role: "group", "aria-label": "Measure" });
    const subBox = el("label", { class: "wqp-field wqp-subgroup", hidden: true });
    const periodBox = select("Period", "wqp-period", M().PERIODS, () => st.period, (v) => { st.period = v; draw(); });
    const switchBox = el("label", { class: "wqp-switch" });
    const filters = el("div", { class: "wqp-filters", role: "group", "aria-label": "Filter the page" }, typeSeg.node, measureBox, el("span", { class: "wqp-break", "aria-hidden": "true" }), subBox, periodBox, switchBox);
    const figures = el("div", { class: "wqp-figures", "aria-live": "polite" });
    const notes = el("div", { class: "wqp-notes" });
    const viewSeg = segment("Show as", [["map", "Map"], ["chart", "Chart"], ["table", "Table"]], () => st.view, (v) => { st.view = v; drawView(); }, "wqp-views");
    const download = el("button", { type: "button", class: "wqp-quiet wqp-download", hidden: true, onclick: () => downloadCsv() }, FP.icon ? FP.icon("download", 18) : null, el("span", {}, "Download"));
    const viewBar = el("div", { class: "wqp-viewbar" }, viewSeg.node, download);
    const mapPane = el("div", { class: "wqp-pane wqp-mappane" }), chartPane = el("div", { class: "wqp-pane wqp-chartpane", hidden: true }), tablePane = el("div", { class: "wqp-pane wqp-tablepane", hidden: true });
    const credit = el("p", { class: "wqp-credit" });
    // SR1: for the group's coordinators, "Enter a round" and the latest rounds (wq-round.js), under the page's name
    const rounds = FP.wqRound?.entry(group, { sb }) || null;
    let phoneRounds = null;
    const desk = el("div", { class: "wqp-desk" }, el("header", { class: "wqp-head" }, title, sources), rounds, filters, figures, notes, viewBar, mapPane, chartPane, tablePane, credit);
    const phoneBox = el("div", { class: "wqp-phonebox" });
    root_.append(status, desk, phoneBox);

    // A segmented control (ink: the chosen one filled): [value, label] pairs.
    function segment(label, pairs, get, set, cls) {
      const node = el("div", { class: "wqp-seg " + cls, role: "group", "aria-label": label });
      const mark = () => { for (const b of node.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.value === String(get()))); };
      fill(node, pairs.map(([v, t]) => el("button", { type: "button", "data-value": v, "aria-pressed": "false", onclick: () => { if (String(get()) !== String(v)) { set(v); mark(); } } }, t)));
      mark();
      return { node, mark };
    }
    function select(label, cls, pairs, get, set) {
      const s = el("select", { class: cls }, ...pairs.map(([v, t]) => el("option", { value: v }, t)));
      s.value = String(get());
      s.addEventListener("change", () => set(s.value));
      return el("label", { class: "wqp-field" }, el("span", {}, label), s);
    }
    function drawMeasures() {
      const { first, more } = M().measuresFor(st.type), inMore = more.find((m) => m.key === st.measure);
      const pick = (k) => { st.measure = k; st.chosen = null; st.ticked = null; draw(); };
      const moreSel = el("select", { class: "wqp-more", "aria-label": "More measures" }, el("option", { value: "" }, inMore ? inMore.name : "More…"),
        ...more.map((m) => el("option", { value: m.key }, m.name)));
      if (inMore) moreSel.value = inMore.key;
      moreSel.addEventListener("change", () => { if (moreSel.value) pick(moreSel.value); });
      fill(measureBox, first.map((m) => el("button", { type: "button", class: "wqp-chip", "data-measure": m.key, "aria-pressed": String(m.key === st.measure), onclick: () => pick(m.key) }, m.short || m.name)),
        el("label", { class: "wqp-morebox" + (inMore ? " wqp-on" : "") }, moreSel));
    }
    function drawSub(b) {
      const subs = b.subs.filter((s) => s.rings.length || data?.all.some((x) => x.ownerOrg === s.id));
      subBox.hidden = !subs.length;
      if (!subs.length) return;
      const s = el("select", { class: "wqp-subsel" }, el("option", { value: "" }, "All of " + group.name), ...subs.map((x) => el("option", { value: x.id }, x.name)));
      s.value = st.sub || "";
      s.addEventListener("change", () => { st.sub = s.value || null; st.chosen = null; st.ticked = null; draw(); });
      fill(subBox, el("span", {}, "Sub-group"), s);
    }
    function drawSwitch(hidden) {
      const box = el("input", { type: "checkbox", role: "switch", class: "wqp-show-all", ...(st.showAll ? { checked: true } : {}) });
      box.addEventListener("change", () => { st.showAll = box.checked; draw(true); });
      fill(switchBox, box, el("span", {}, "Show older and sparse sites", el("small", {}, hidden ? " (" + fmt(hidden) + " hidden)" : " (none hidden)")));
      switchBox.title = M().HELD_WORDS;
    }

    // ---- drawing --------------------------------------------------------------------------------------------------------------
    // keep: only the switch changed (the reads are the same): no new reads
    async function draw(keep = false) {
      const t = ++token;
      root_.dataset.type = st.type;
      typeSeg.mark(); drawMeasures();
      if (!keep) status.textContent = "Loading the water quality sites…";
      try { data = await rowsOf(L, st, now); }
      catch (e) {
        if (t !== token || gone) return;
        status.textContent = "";
        fill(figures, el("p", { class: "wqp-error" }, "Couldn't load the water quality sites just now. ", el("button", { type: "button", class: "wqp-quiet", onclick: () => draw() }, "Try again")));
        return;
      }
      if (t !== token || gone) return;
      status.textContent = "";
      const shown = M().shownRows(data.rows, st.showAll), h = M().headline(shown);
      if (!st.ticked) st.ticked = M().defaultTicks(shown);
      st.ticked = st.ticked.filter((id) => shown.some((r) => r.id === id));
      data.shown = shown; data.h = h;
      drawSub(data.base); drawSwitch(M().hiddenCount(data.rows));
      sources.textContent = M().sourcesLine(data.all.filter((s) => s.view));
      drawFigures(h);
      drawNotes(h);
      credit.textContent = creditLine(shown);
      if (phone) return drawPhone();
      drawView();
    }
    const creditLine = (rows) => {
      const keys = new Set(list(rows).map((r) => r.sourceKey));
      return [keys.has("ecan-wq-sites") ? "Environment Canterbury's results are provisional until reviewed by ECan (CC BY 4.0)." : "",
        keys.has("niwa-nrwqn-sites") ? "NIWA's results: Earth Sciences New Zealand (NIWA)." : "",
        list(rows).some((r) => r.trend) ? "Trends: LAWA (Land, Air, Water Aotearoa), 27 Oct 2026 release, CC BY 4.0." : ""].filter(Boolean).join(" ");
    };
    function drawFigures(h) {
      const m = M().measure(st.measure), parts = M().bar(h);
      const fig = (n, label, cls = "") => el("div", { class: "wqp-fig " + cls }, el("b", {}, n), el("span", {}, label));
      fill(figures,
        fig(fmt(h.sites), h.sites === 1 ? "site monitored" : "sites monitored", "wqp-fig-sites"),
        fig(fmt(h.samples), (h.samples === 1 ? "sample" : "samples") + " of " + (m?.name || st.measure).replace(/^E\. coli$/, "E. coli"), "wqp-fig-samples"),
        fig(h.latest ? W().date(h.latest) : "–", "latest sample", "wqp-fig-latest"),
        el("div", { class: "wqp-fig wqp-fig-trend" }, parts.length ? miniBar(parts) : st.type === "groundwater" ? null : el("div", { class: "wqp-bar wqp-bar-empty", "aria-hidden": "true" }),
          parts.length ? el("ul", { class: "wqp-bar-key" }, ...parts.map((p) => el("li", {}, el("i", { style: "background: " + p.colour, "aria-hidden": "true" }), p.label + " " + p.n))) : null,
          el("p", { class: "wqp-sentence" }, M().sentence(h, st.measure, st.type))));
    }
    function drawNotes(h) {
      const unknown = M().needsType(data.all).length, hasSubsNotOn = data.base.subs.some((s) => !s.member) && !group.parent_org_id;
      fill(notes,
        M().fieldNote(h, st.includeField) ? el("p", {}, M().fieldNote(h, st.includeField), " ", el("button", { type: "button", class: "wqp-link", onclick: () => { st.includeField = !st.includeField; draw(); } }, st.includeField ? "Use laboratory results only" : "Include field readings")) : null,
        coordinator && unknown ? el("p", { class: "wqp-needs" }, fmt(unknown) + (unknown === 1 ? " site has" : " sites have") + " no water type recorded; " + (unknown === 1 ? "it is" : "they are") + " shown with surface water.") : null,
        hasSubsNotOn ? el("p", {}, M().NOT_SHARED) : null);
    }
    function drawView() {
      root_.dataset.view = st.view; viewSeg.mark();
      mapPane.hidden = st.view !== "map"; chartPane.hidden = st.view !== "chart"; tablePane.hidden = st.view !== "table"; download.hidden = st.view !== "table";
      if (!data) return;
      if (st.view === "map") drawMap(); else if (st.view === "chart") drawChart(); else drawTable();
    }

    // ---- the map -----------------------------------------------------------------------------------------------------------------
    function drawMap() {
      if (!mapUi) mapUi = makeMap(mapPane, { L, group, st, onSite: (id) => { st.chosen = id; drawSite(); }, phoneMode: false });
      mapUi.update(data, st);
      drawSite();
    }
    function drawSite() {
      siteChart?.destroy(); siteChart = null;
      const box = mapUi?.side;
      if (!box) return;
      const row = data?.shown.find((r) => r.id === st.chosen) || data?.rows.find((r) => r.id === st.chosen);
      box.hidden = !row; mapPane.classList.toggle("wqp-with-site", !!row);
      mapUi.choose(row?.id ?? null);
      if (!row) return;
      const host = el("div", { class: "block-host wqp-sitechart" });
      const ticked = st.ticked.includes(row.id);
      fill(box, el("div", { class: "wqp-sitehead" }, el("h2", { tabindex: "-1" }, row.name),
          el("button", { type: "button", class: "wqp-close", "aria-label": "Close " + row.name, onclick: () => { st.chosen = null; drawSite(); } }, "×")),
        el("p", { class: "wqp-meta" }, [row.source, M().TYPE_WORDS[row.type], M().tagsOf(row), row.externalId].filter(Boolean).join(" · ")),
        siteFacts(row), host,
        el("div", { class: "wqp-siteactions" }, el("button", { type: "button", class: "wqp-quiet", "aria-pressed": String(ticked), disabled: !ticked && st.ticked.length >= M().MAX_TICKED,
          onclick: () => { st.ticked = M().tick(st.ticked, row.id); drawSite(); } }, ticked ? "Ticked to compare" : "Tick to compare"),
          el("button", { type: "button", class: "wqp-link", onclick: () => { if (!st.ticked.includes(row.id)) st.ticked = M().tick(st.ticked, row.id); st.view = "chart"; drawView(); } }, "Compare in Chart")));
      box.querySelector("h2")?.focus({ preventScroll: true });
      siteSeries(row).then((series) => {
        if (gone || st.chosen !== row.id) return;
        siteChart = renderChart(host, siteData(row, series), "No results of this measure in the period.");
      }, () => fill(host, el("p", {}, "Couldn't read this site's results just now.")));
    }
    function siteFacts(r) {
      const line = (label, v) => (v ? el("p", {}, el("b", {}, label + ": "), v) : null);
      return el("div", { class: "wqp-facts" },
        line("Results", r.n ? fmt(r.n) + " in " + M().periodWords(st.period) + (M().methodsText(r) ? " (" + M().methodsText(r) + ")" : "") + (r.keyName ? ", as " + r.keyName : "") : "None of this measure in " + M().periodWords(st.period)),
        ...list(r.also).map((a) => line("Also as " + a.keyName, fmt(a.n) + (M().methodsText(a) ? " (" + M().methodsText(a) + ")" : "") + ": its own line on the chart, not in these figures")),
        line("Sampled", r.first ? W().date(r.first) + " to " + W().date(r.last) : null),
        line("Latest", r.latestText != null ? M().latestText(r) + ", " + W().date(r.latestAt) + " (" + M().METHOD_WORDS[r.latestMethod] + ")" : null),
        line("Median", r.median != null ? M().medianText(r) + " (" + fmt(r.medianN) + " results)" : null),
        r.type === "groundwater" ? null : line("LAWA", r.trendWords ? "10-year trend: " + r.trendWords + (r.bandWords ? "; " + r.bandWords : "") : r.shared && r.sourceKey === "ecan-wq-sites" ? "no 10-year trend published for this measure" : null),
        r.held ? el("p", { class: "wqp-held" }, "Older or sparse: " + M().HELD_WORDS.replace(/^Older or sparse: /, "")) : null);
    }
    // a site on its own: every key of the measure it holds (each its own line)
    const siteSeries = async (row) => (row.key ? L.series(row.id, M().measure(st.measure)?.keys || [row.key], M().periodFrom(st.period, now)) : []);
    const siteData = (row, series) => M().siteChartData({ row, series, measureKey: st.measure, period: st.period });
    function renderChart(host, d, empty) {
      if (!d.series.some((s) => s.points.length)) { fill(host, el("p", { class: "wqp-empty" }, empty)); return null; }
      return FP.blocks.render(host, { block: "chart", owner: { org: group.id } }, { read: () => d, level: 3, href: FP.href });
    }

    // ---- the chart ---------------------------------------------------------------------------------------------------------------
    function drawChart() {
      chart?.destroy(); chart = null;
      const host = el("div", { class: "block-host wqp-chart" }), ticks = el("div", { class: "wqp-ticks" });
      const mode = segment("Chart", [["sites", "Ticked sites"], ["median", "Median by year"]], () => st.chartMode, (v) => { st.chartMode = v; drawChart(); }, "wqp-chartmode");
      const tl = M().tickList(data.shown), full = st.ticked.length >= M().MAX_TICKED;
      fill(ticks, el("h2", { class: "wqp-h" }, "Sites"), el("p", { class: "wqp-hint" }, "Tick up to " + M().MAX_TICKED + " to compare."),
        tl.length ? el("ul", { class: "wqp-ticklist" }, ...tl.map((r) => {
          const box = el("input", { type: "checkbox", "data-site": r.id, ...(st.ticked.includes(r.id) ? { checked: true } : {}), ...(full && !st.ticked.includes(r.id) ? { disabled: true } : {}) });
          box.addEventListener("change", () => { st.ticked = M().tick(st.ticked, r.id); drawChart(); });
          return el("li", {}, el("label", {}, box, el("span", {}, el("b", {}, r.name), el("small", {}, [r.source, M().tagsOf(r), fmt(r.n) + " results", r.last ? "last " + W().date(r.last) : ""].filter(Boolean).join(" · ")))));
        })) : el("p", {}, "No site has results of this measure in the period."));
      fill(chartPane, el("div", { class: "wqp-chartmain" }, el("div", { class: "wqp-chartbar" }, mode.node), host), ticks);
      if (st.chartMode === "median") { chart = renderChart(host, M().medianChart(data.shown, st.measure, st.period), "Fewer than " + M().MIN_YEAR_SITES + " sites in any year: no yearly median to draw."); return; }
      const rows = st.ticked.map((id) => data.shown.find((r) => r.id === id)).filter(Boolean);
      if (!rows.length) { fill(host, el("p", { class: "wqp-empty" }, "Tick a site to see its results over time.")); return; }
      fill(host, el("p", { class: "wqp-status" }, "Loading the chart…"));
      const mine = token;
      Promise.all(rows.map(async (r) => [r.id, r.key ? await L.series(r.id, [r.key], M().periodFrom(st.period, now)) : []])).then((pairs) => {
        if (gone || mine !== token || st.view !== "chart" || st.chartMode !== "sites") return;
        chart = renderChart(host, M().chartData({ rows, seriesBySite: Object.fromEntries(pairs), measureKey: st.measure, period: st.period }), "No results of this measure in the period.");
      }, () => fill(host, el("p", {}, "Couldn't read these sites' results just now.")));
    }

    // ---- the table ---------------------------------------------------------------------------------------------------------------
    function drawTable() {
      const rows = M().sortRows(data.shown, st.sort.key, st.sort.dir);
      const head = M().COLUMNS.map(([k, label]) => {
        const on = st.sort.key === k, dir = on ? st.sort.dir : "none";
        return el("th", { scope: "col", "aria-sort": on ? (dir === "asc" ? "ascending" : "descending") : "none" },
          el("button", { type: "button", class: "wqp-sort", "data-sort": k, onclick: () => { st.sort = { key: k, dir: on && st.sort.dir === "asc" ? "desc" : "asc" }; drawTable(); } }, label, el("span", { "aria-hidden": "true" }, on ? (dir === "asc" ? " ▲" : " ▼") : "")));
      });
      const m = M().measure(st.measure);
      fill(tablePane, el("div", { class: "wqp-tablewrap" }, el("table", { class: "wqp-table" },
        el("caption", {}, (m?.name || st.measure) + ", " + M().periodWords(st.period) + ": " + fmt(rows.length) + (rows.length === 1 ? " site" : " sites")),
        el("thead", {}, el("tr", {}, ...head)),
        el("tbody", {}, ...rows.map((r) => el("tr", { "data-site": r.id, class: (r.own ? "wqp-own" : "") + (r.held ? " wqp-heldrow" : "") },
          el("th", { scope: "row" }, el("button", { type: "button", class: "wqp-link", onclick: () => { st.chosen = r.id; st.view = "map"; drawView(); } }, r.name), M().tagsOf(r) ? el("small", { class: "wqp-depth" }, M().tagsOf(r)) : null, r.held ? el("small", {}, "older or sparse") : null),
          el("td", {}, r.source), el("td", {}, M().TYPE_WORDS[r.type]),
          el("td", { class: "wqp-num" }, fmt(r.n), M().methodsText(r) && r.nField ? el("small", {}, M().methodsText(r)) : null),
          el("td", {}, r.first ? W().date(r.first) : "–"), el("td", {}, r.last ? W().date(r.last) : "–"),
          el("td", { class: "wqp-num" }, M().latestText(r), M().keyLine(r, st.measure) ? el("small", {}, M().keyLine(r, st.measure)) : null), el("td", { class: "wqp-num" }, M().medianText(r)), el("td", {}, r.trendWords || "–"))))),
        el("p", { class: "wqp-hint" }, "Results and medians are for " + M().periodWords(st.period) + ". A median marked ≈ could move with a result below or above a detection limit. LAWA trends are LAWA's, over 10 years. " + M().KEY_RULE)));
    }
    function downloadCsv() {
      const text = M().csv(M().sortRows(data.shown, st.sort.key, st.sort.dir), FP.peopleModel.toCsv);
      const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), download: M().fileName(group.name, st.measure, st.type, today || new Date(now).toISOString().slice(0, 10)) });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // ---- a phone: a quick answer --------------------------------------------------------------------------------------------------
    // PH2 (the owner, 13 Nov 2026: "The wq map on phone is way too cluttered and overwhelming"): the quick answer, then the plain map
    // with small dots only. The water type and the measure are one quiet control (a list to choose from); the sites are a list in a
    // sheet that opens on request ("Sites", or a dot, which opens its site with its chart); the layers and the legend are one button
    // on the map. Nothing is left out: every choice, site and chart is one tap away; the Table is the computer's.
    function chooseShown(opener) {
      const { first, more } = M().measuresFor(st.type);
      const setType = (v) => { if (st.type === v) return; st.type = v; st.chosen = null; st.ticked = null; if (!M().measuresFor(v).first.concat(M().measuresFor(v).more).some((x) => x.key === st.measure)) st.measure = "nitrate"; typeSeg.mark(); draw(); };
      FP.sheet?.menu(opener, "Show", [
        ...M().TYPES.map(([v, t]) => ({ label: t, current: st.type === v, icon: "water", run: () => setType(v) })),
        ...first.concat(more).map((x) => ({ label: x.name, current: st.measure === x.key, run: () => { st.measure = x.key; st.chosen = null; st.ticked = null; draw(); } })),
      ]);
    }
    function sitesSheet(opener, rows, open = null) {
      FP.sheet?.open({ opener, title: "Sites", where: (M().TYPES.find(([v]) => v === st.type)?.[1] || "") + " · " + fmt(rows.length) + (rows.length === 1 ? " site" : " sites"), className: "wqp-sitesheet",
        body: () => { const ul = siteList(rows); if (open != null) setTimeout(() => { const d = ul.querySelector('details[data-site="' + open + '"]'); if (d) { d.open = true; d.scrollIntoView?.({ block: "start" }); } }, 0); return ul; } });
    }
    function siteList(rows) {
      return el("ul", { class: "wqp-phonelist" }, ...rows.map((r) => {
        const body = el("div", { class: "wqp-phonesite" });
        const d = el("details", { "data-site": r.id }, el("summary", {}, el("b", {}, r.name), el("small", {}, [r.source, M().tagsOf(r), r.latestText != null ? "latest " + M().latestText(r) : "", r.last ? W().date(r.last) : ""].filter(Boolean).join(" · "))), body);
        d.addEventListener("toggle", () => {
          if (!d.open || body.childElementCount) return;
          const host = el("div", { class: "block-host" });
          fill(body, siteFacts(r), host);
          siteSeries(r).then((s) => renderChart(host, siteData(r, s), "No results of this measure in the period."),
            () => fill(host, el("p", {}, "Couldn't read this site's results just now.")));
        });
        return el("li", {}, d);
      }));
    }
    function drawPhone() {
      const h = data.h, m = M().measure(st.measure), rows = [...data.shown].sort((a, b) => (b.own - a.own) || String(b.last || "").localeCompare(String(a.last || "")));
      const typeWords = M().TYPES.find(([v]) => v === st.type)?.[1] || st.type;
      const choose = el("button", { type: "button", class: "wqp-choose", id: "wqp-choose", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: () => chooseShown(choose) },
        el("span", {}, typeWords + " · " + (m?.name || st.measure)), FP.icon ? FP.icon("chevron", 16) : null);
      const mapHost = el("div", { class: "wqp-phonemap" });
      const sitesBtn = el("button", { type: "button", class: "wqp-mapchip wqp-sitesbtn", id: "wqp-sites", "aria-haspopup": "dialog", onclick: () => sitesSheet(sitesBtn, rows) }, FP.icon ? FP.icon("files", 16) : null, el("span", {}, "Sites"));
      // review of #538, 10: above the map only the one quiet control, the sentence and the bar (the page's name is for a screen
      // reader; the bar's More already marks where you are); the count and the latest date go quietly under the map
      fill(phoneBox, el("h1", { class: "wqp-phonetitle visually-hidden" }, "Water quality"), choose,
        el("p", { class: "wqp-sentence" }, M().sentence(h, st.measure, st.type)), M().bar(h).length ? miniBar(M().bar(h)) : null, mapHost,
        el("p", { class: "wqp-phonelead" }, fmt(h.sites) + (h.sites === 1 ? " site" : " sites") + (h.latest ? " · latest " + W().date(h.latest) : "")),
        (phoneRounds = phoneRounds || FP.wqRound?.entry(group, { sb, compact: true }) || null),
        el("p", { class: "wqp-credit" }, creditLine(data.shown)));
      mapUi?.destroy(); mapUi = null;
      // a dot tapped opens its site in the sites' sheet, with its chart
      mapUi = makeMap(mapHost, { L, group, st, onSite: (id) => sitesSheet(sitesBtn, rows, id), phoneMode: true, extra: [sitesBtn] });
      mapUi.update(data, st);
    }

    // ---- start, and a phone turning into a computer -----------------------------------------------------------------------------
    const media = root.matchMedia?.("(max-width: 800px)");
    const onMedia = () => {
      const p = isPhone();
      if (p === phone) return;
      phone = p; root_.classList.toggle("wqp-is-phone", phone); mapUi?.destroy(); mapUi = null; chart?.destroy(); chart = null;
      if (!phone) { phoneBox.replaceChildren(); filters.prepend(typeSeg.node); }
      draw(true);
    };
    media?.addEventListener?.("change", onMedia);
    root_.classList.toggle("wqp-is-phone", phone);
    draw();
    const api = { node: root_, destroy() { gone = true; token++; chart?.destroy(); siteChart?.destroy(); mapUi?.destroy(); mapUi = null; media?.removeEventListener?.("change", onMedia); if (live === api) live = null; }, state: st };
    root_.wqp = api;
    live = api;
    return root_;
  }

  // ---- the map: the group's area, its sub-groups, the sites in one set of symbols, one panel of layers and legend ------------------
  const SUPPORT = {
    surface: [
      { id: "rivers", title: "Rivers and streams", kind: "rivers", on: true },
      { id: "catchments", title: "Catchment boundaries", kind: "core", key: "catchments", on: true, minzoom: 10, note: "from zoom 10" },
      { id: "lakes", title: "Lakes", kind: "ref", source: "linz-topo50-lake-polygons", on: false, colour: "#7fb6dc" },
      { id: "wetlands", title: "Wetlands", kind: "core", key: "wetlands", on: false },
      { id: "fresh", title: "Fresh water (theme)", kind: "theme", group: "Fresh water", on: false },
      { id: "biodiversity", title: "Biodiversity (theme)", kind: "theme", group: "Biodiversity", on: false },
    ],
    groundwater: [
      { id: "gwzones", title: "Groundwater allocation zones", kind: "ref", source: "ecan-gw-allocation-zones", on: true, colour: "#9c8fc4" },
      { id: "piezo", title: "Groundwater level contours", kind: "core", key: "piezometric-contours", on: true },
      { id: "wells", title: "Wells and bores", kind: "ref", source: "ecan-wells", on: false, minzoom: 13, colour: "#6b6b73", note: "from zoom 13" },
      { id: "nutrient", title: "Nutrient allocation zones", kind: "ref", source: "ecan-nutrient-zones", on: false, colour: "#c49a6c" },
      { id: "dwzones", title: "Drinking water protection zones", kind: "core", key: "drinking-water-zones", on: false },
      { id: "soils", title: "Soils (S-map)", kind: "ref", source: "smap", on: false, minzoom: 12, colour: "#b5a27a", note: "from zoom 12" },
    ],
  };
  let protocol = false;
  function makeMap(host, { L, group, st, onSite, phoneMode, extra = [] }) {
    const gl = root.maplibregl;
    const side = el("aside", { class: "wqp-site", hidden: true, "aria-label": "The site chosen" });
    const panel = el("aside", { class: "wqp-layers", "aria-label": "Layers and legend" });
    const canvas = el("div", { class: "wqp-map", role: "region", "aria-label": "Map of the water quality sites" });
    const bg = el("div", { class: "wqp-bgswitch maplibregl-ctrl", role: "group", "aria-label": "Background" });
    // PH2: on a phone the layers and the legend are one button on the map, opening them in a sheet; beside it whatever the page adds
    // (its Sites)
    const layersBtn = phoneMode ? el("button", { type: "button", class: "wqp-mapchip wqp-layersbtn", id: "wqp-layers", "aria-haspopup": "dialog",
      onclick: () => FP.sheet?.open({ opener: layersBtn, title: "Layers and legend", className: "wqp-layersheet", body: () => panel }) }, FP.icon ? FP.icon("layers", 16) : null, el("span", {}, "Layers")) : null;
    const chips = phoneMode ? el("div", { class: "wqp-mapchips" }, ...extra, layersBtn) : null;
    // (review of #538, 5: on a phone Map | Aerial is the last chip in the same row, which wraps on a narrow phone, so none sits on another)
    if (chips) chips.append(bg);
    fill(host, phoneMode ? null : panel, el("div", { class: "wqp-mapbox" }, canvas, ...(chips ? [chips] : [bg])), phoneMode ? null : side);
    if (!gl?.Map) { fill(canvas, el("p", { class: "wqp-empty" }, "The map can't be shown in this browser.")); return { side, update() {}, choose() {}, destroy() {} }; }
    if (!protocol && root.pmtiles?.Protocol) { try { gl.addProtocol("pmtiles", new root.pmtiles.Protocol().tile); } catch { /* already there */ } protocol = true; }
    try { gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js"); } catch { /* set already */ }
    // (PH2: on a phone the credit's "i" sits bottom left by the scale, clear of the + that floats bottom right)
    const map = new gl.Map({ container: canvas, style: FP.basemaps.style("aerial", { reliefOnAerial: false }), bounds: [[171.4, -43.6], [172.7, -42.7]], maxZoom: 18,
      attributionControl: phoneMode ? false : { compact: true, customAttribution: FP.brand?.org_legal || "" } });
    if (phoneMode) map.addControl(new gl.AttributionControl({ compact: true, customAttribution: FP.brand?.org_legal || "" }), "bottom-left");
    if (!phoneMode) map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");   // (a phone pinches)
    map.addControl(new gl.ScaleControl({ unit: "metric" }), "bottom-left");
    if (phoneMode) FP.basemaps.quietCredit?.(map);
    const ready = new Promise((res) => { map.once("load", res); const poll = () => (map.style?._loaded ? res() : setTimeout(poll, 50)); poll(); });
    // PH5: the aerial first, the plain map one tap away; the person's choice on an overview map on this device is kept (map-scene.js's key)
    const choices = (FP.basemaps.names || []).length >= 2 ? ["aerial", "topo"] : FP.demo?.active ? ["aerial", "topo"] : [];
    const BASE_KEY = "fp-overview-basemap";
    let stored = null; try { stored = root.localStorage.getItem(BASE_KEY); } catch { /* private mode */ }
    const start = FP.mapPalette?.startBackground ? FP.mapPalette.startBackground(stored, choices) : "aerial";
    let base = start;
    const markBg = () => { for (const b of bg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.base === base)); };
    const useBase = async (k) => { base = k; markBg(); await ready; if (!(FP.basemaps.names || []).includes(k)) return; if (k !== "aerial") FP.basemaps.ground(map); try { await FP.basemaps.pick(map, k); } catch { /* the plain ground stays */ } };
    if (choices.length) {
      fill(bg, ...[["aerial", "Aerial"], ["topo", "Topo"]].map(([k, t]) => el("button", { type: "button", "data-base": k, onclick: () => { try { root.localStorage.setItem(BASE_KEY, k); } catch { /* kept for this visit */ } useBase(k); } }, t)));
      useBase(start);
    } else bg.hidden = true;

    let rows = [], framed = false, chosen = null, layers = [], rowsByType = null, typeNow = null, coreRows = null;
    const SRC = "wqp-sites";
    ready.then(() => {
      for (const ic of M().ICONS) if (!map.hasImage(ic.icon)) map.addImage(ic.icon, iconImage(ic), { pixelRatio: 2 });
      map.addSource("wqp-mask", { type: "geojson", data: empty() });
      map.addSource("wqp-area", { type: "geojson", data: empty() });
      map.addSource("wqp-subs", { type: "geojson", data: empty() });
      map.addSource(SRC, { type: "geojson", data: empty() });
      map.addLayer({ id: "wqp-mask", type: "fill", source: "wqp-mask", paint: { "fill-color": "#000000", "fill-opacity": FP.mapPalette?.MASK_OPACITY ?? 0.35, "fill-antialias": false } });
      // PH5: no dashes at overview scale: the sub-groups' edges a plain hairline
      map.addLayer({ id: "wqp-subs-line", type: "line", source: "wqp-subs", paint: { "line-color": "#5f6670", "line-width": 0.75, "line-opacity": 0.8 } });
      map.addLayer({ id: "wqp-area-line", type: "line", source: "wqp-area", paint: { "line-color": "#2f3542", "line-width": 1.5, "line-opacity": 0.85 } });
      map.addLayer({ id: "wqp-chosen", type: "circle", source: SRC, filter: ["==", ["id"], -1], paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#1d1d1f", "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "wqp-sites", type: "symbol", source: SRC, layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 13, 1.1], "symbol-sort-key": ["get", "order"] } });
      paint();
      map.on("click", "wqp-sites", (e) => { const f = e.features?.[0]; if (f) onSite(Number(f.id)); });
      map.on("mouseenter", "wqp-sites", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "wqp-sites", () => { map.getCanvas().style.cursor = ""; });
      map.on("moveend", () => { for (const l of layers) if (l.on && l.def.kind === "ref") readRef(l); if (layers.some((l) => l.on && l.def.kind === "rivers")) readRivers(); });
      push();
    });
    const empty = () => ({ type: "FeatureCollection", features: [] });
    // the plain ground and the outlines follow the theme (light or dark), and change with it
    // (after the frame, so the theme's tokens are the new ones; dark: the person's choice, else the device's)
    const paint = () => requestAnimationFrame(paintNow);
    function paintNow() {
      if (!map.getLayer?.("wqp-area-line")) return;
      const theme = document.documentElement.dataset.theme, dark = theme === "dark" || (theme !== "light" && !!scheme?.matches);
      const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      if (map.getLayer("bm-blank") && css("--map-background")) map.setPaintProperty("bm-blank", "background-color", css("--map-background"));
      map.setPaintProperty("wqp-area-line", "line-color", dark ? "#d1d1d6" : "#2f3542");
      map.setPaintProperty("wqp-subs-line", "line-color", dark ? "#a1a1a8" : "#5f6670");
      map.setPaintProperty("wqp-chosen", "circle-stroke-color", dark ? "#f5f5f7" : "#1d1d1f");
    }
    const scheme = root.matchMedia?.("(prefers-color-scheme: dark)"), themeWatch = typeof MutationObserver === "undefined" ? null : new MutationObserver(paint);
    scheme?.addEventListener?.("change", paint); themeWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    function iconImage({ shape, cls, ring, faded }) {
      const size = 48, c = document.createElement("canvas"); c.width = c.height = size;
      const g = c.getContext("2d"), mid = size / 2, r = faded ? 8 : 11, colour = M().CLASS_COLOURS[cls] || M().CLASS_COLOURS.none;
      g.globalAlpha = faded ? 0.5 : 1;
      if (ring) { g.beginPath(); g.arc(mid, mid, r + 8, 0, Math.PI * 2); g.fillStyle = "#ffffff"; g.fill(); g.lineWidth = 3.5; g.strokeStyle = "#1d1d1f"; g.stroke(); }
      g.beginPath();
      if (shape === "square") g.rect(mid - r, mid - r, r * 2, r * 2); else g.arc(mid, mid, r, 0, Math.PI * 2);
      g.fillStyle = colour; g.fill(); g.lineWidth = 3; g.strokeStyle = "#ffffff"; g.stroke();
      const d = g.getImageData(0, 0, size, size);
      return { width: size, height: size, data: new Uint8Array(d.data.buffer) };
    }
    function push() {
      if (!map.getSource?.(SRC)) return;
      map.getSource(SRC).setData({ type: "FeatureCollection", features: rows.filter((r) => r.lngLat).map((r) => {
        const s = M().symbol(r);
        return { type: "Feature", id: r.id, geometry: { type: "Point", coordinates: r.lngLat }, properties: { icon: s.icon, name: r.name, order: (r.own ? 2 : 0) + (r.held ? 0 : 1) } };
      }) });
      map.setFilter("wqp-chosen", ["==", ["id"], chosen ?? -1]);
    }
    function frame(b, sub) {
      const pts = [...(sub?.rings?.length ? sub.rings.flat() : b.area.flat()), ...(b.area.length ? [] : rows.map((r) => r.lngLat).filter(Boolean))];
      if (!pts.length) return;
      const bounds = pts.reduce((bb, p) => bb.extend(p), new gl.LngLatBounds(pts[0], pts[0]));
      map.fitBounds(bounds, { padding: phoneMode ? 30 : 50, duration: 0, maxZoom: 13 });
    }
    // ---- the supporting layers, by water type ---------------------------------------------------------------------------------
    function drawPanel(type) {
      const legendItems = M().legend({ type, own: rows.some((r) => r.own), held: rows.some((r) => r.held) });
      fill(panel, el("h2", { class: "wqp-h" }, "Layers"),
        el("ul", { class: "wqp-layerlist" }, ...layers.filter((l) => !l.missing).map((l) => {
          const box = el("input", { type: "checkbox", "data-layer": l.def.id, ...(l.on ? { checked: true } : {}) });
          box.addEventListener("change", () => { l.on = box.checked; st.layersOn[l.def.id] = l.on; show(l); });
          return el("li", {}, el("label", {}, box, el("span", {}, l.def.title, el("small", { class: "wqp-layernote" }, l.say || l.def.note || ""))));
        })),
        el("h2", { class: "wqp-h" }, "Legend"),
        el("ul", { class: "wqp-legend" }, ...legendItems.map((x) => el("li", {}, swatch(x), el("span", {}, x.label)))),
        el("p", { class: "wqp-hint" }, type === "groundwater" ? "Groundwater sites are not graded: the river bands do not apply to wells." : "Colour is LAWA's published 10-year trend of the chosen measure; LAWA reports river sites only."));
    }
    async function setType(type) {
      if (typeNow === type) return;
      typeNow = type;
      for (const l of layers) hide(l);
      // (PH2: on a phone none is on until asked for: the plain map and the dots)
      layers = SUPPORT[type].map((def) => ({ def, on: st.layersOn[def.id] ?? (phoneMode ? false : def.on), ids: [], say: "" }));
      await ready;
      if (typeNow !== type) return;
      coreRows = coreRows || loadCore();
      const core = await coreRows.catch(() => []);
      if (typeNow !== type) return;
      for (const l of layers) {
        if (l.def.kind === "core") l.rows = core.filter((r) => r.key === l.def.key);
        if (l.def.kind === "theme") l.rows = core.filter((r) => r.style?.reference?.group === l.def.group);
        if ((l.def.kind === "core" || l.def.kind === "theme") && !l.rows.length) l.missing = true;
      }
      drawPanel(type);
      for (const l of layers) show(l);
    }
    // core layers: the register's rows (as maps-view.js reads them) and their tiles, signed for an hour from the one stored copy
    async function loadCore() {
      const { data, error } = await L.sb.from("core_layers").select("key, title, style, tiles_path").not("style->reference", "is", null).order("key").limit(60);
      if (error) throw error;
      const rows = list(data).filter((r) => typeof r.tiles_path === "string" && r.tiles_path.startsWith("core/") && r.style?.reference?.offered !== false);
      if (!rows.length) return [];
      const { data: urls, error: refused } = await L.sb.storage.from("map-packages").createSignedUrls(rows.map((r) => r.tiles_path), 3600);
      if (refused) throw refused;
      const byPath = new Map(list(urls).filter((u) => u.signedUrl).map((u) => [u.path, u.signedUrl]));
      return rows.filter((r) => byPath.has(r.tiles_path)).map((r) => ({ ...r, url: byPath.get(r.tiles_path) }));
    }
    function hide(l) { for (const id of l.ids) if (map.getLayer?.(id)) map.setLayoutProperty(id, "visibility", "none"); }
    function under() { return map.getLayer("wqp-subs-line") ? "wqp-subs-line" : undefined; }
    async function show(l) {
      if (!l.on) { hide(l); return; }
      if (l.ids.length) { for (const id of l.ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible"); if (l.def.kind === "ref") readRef(l); if (l.def.kind === "rivers") readRivers(); return; }
      if (l.def.kind === "rivers") {
        const sid = "wqp-rivers";
        if (!map.getSource(sid)) map.addSource(sid, { type: "geojson", data: empty() });
        for (const spec of FP.farmModel.riverLayers(sid, { labels: false })) {
          const id = "wqp-" + spec.id, casing = /casing$/.test(spec.id);
          if (!map.getLayer(id)) map.addLayer({ ...spec, id, paint: casing ? { ...spec.paint, "line-color": "#ffffff", "line-opacity": 0.7 } : { ...spec.paint, "line-color": "#6aaee6" } }, under());
          l.ids.push(id);
        }
        readRivers();
      } else if (l.def.kind === "ref") {
        const sid = "wqp-ref-" + l.def.id;
        if (!map.getSource(sid)) map.addSource(sid, { type: "geojson", data: empty() });
        const c = l.def.colour, z = l.def.minzoom ? { minzoom: l.def.minzoom } : {};
        const add = (spec) => { if (!map.getLayer(spec.id)) map.addLayer({ ...spec, ...z }, under()); l.ids.push(spec.id); };
        add({ id: sid + "-fill", type: "fill", source: sid, filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], paint: { "fill-color": c, "fill-opacity": 0.12 } });
        add({ id: sid + "-line", type: "line", source: sid, filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon", "LineString", "MultiLineString"]]], paint: { "line-color": c, "line-width": 1.2, "line-opacity": 0.9 } });
        add({ id: sid + "-pt", type: "circle", source: sid, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": c, "circle-radius": 3, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } });
        readRef(l);
      } else {
        for (const row of l.rows) {
          const sid = "wqp-core-" + row.key, st_ = row.style?.reference?.style || {};
          if (!map.getSource(sid)) map.addSource(sid, { type: "vector", url: "pmtiles://" + row.url });
          list(st_.layers).filter((x) => x && ["fill", "line", "circle"].includes(x.type)).forEach((x, j) => {
            const id = sid + "-" + j, minzoom = Math.max(Number(x.minzoom) || 0, l.def.minzoom || 0);
            if (!map.getLayer(id)) {
              try { map.addLayer({ id, type: x.type, source: sid, "source-layer": st_.source_layer, paint: x.paint || {}, layout: { ...(x.layout || {}), visibility: "visible" },
                ...(x.filter ? { filter: x.filter } : {}), ...(minzoom ? { minzoom } : {}), ...(x.maxzoom ? { maxzoom: x.maxzoom } : {}) }, under()); } catch { return; }
            }
            l.ids.push(id);
          });
        }
      }
    }
    // a reference layer by the box in view (reference_view_features: at most 1,000 features; over that, "zoom in")
    async function readRef(l) {
      if (!l.on || (l.def.minzoom && map.getZoom() < l.def.minzoom)) { l.say = l.def.note || ""; note(l); return; }
      const b = map.getBounds(), mine = (l.asked = (l.asked || 0) + 1);
      const { data, error } = await L.sb.rpc("reference_view_features", { source: l.def.source, x0: b.getWest(), y0: b.getSouth(), x1: b.getEast(), y1: b.getNorth(), max_features: 1000 });
      if (mine !== l.asked) return;
      const src = map.getSource("wqp-ref-" + l.def.id);
      if (error || !data) { l.say = "not available here"; note(l); src?.setData(empty()); return; }
      if (data.truncated) { l.say = "zoom in to see"; src?.setData(empty()); } else { l.say = data.total_in_box ? "" : "none in view"; src?.setData(data.features || empty()); }
      note(l);
    }
    const note = (l) => { const n = panel.querySelector('input[data-layer="' + l.def.id + '"]')?.closest("label")?.querySelector(".wqp-layernote"); if (n) n.textContent = l.say || l.def.note || ""; };
    let riverAsk = 0;
    async function readRivers() {
      const b = map.getBounds(), want = FP.farmModel.riverBox([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], map.getZoom()), mine = ++riverAsk;
      const l = layers.find((x) => x.def.kind === "rivers");
      if (!want) { if (l) { l.say = "from zoom 10"; note(l); } map.getSource("wqp-rivers")?.setData(empty()); return; }
      const { data, error } = await L.sb.rpc("waterways_in_view", want);
      if (mine !== riverAsk) return;
      if (l) { l.say = error ? "not available here" : ""; note(l); }
      map.getSource("wqp-rivers")?.setData(error ? empty() : FP.farmModel.riverFeatures(data));
    }

    let lastKey = null;
    return {
      side,
      async update(data, s) {
        rows = data.shown;
        await ready;
        const b = data.base, sub = s.sub ? b.subs.find((x) => x.id === s.sub) : null;
        map.getSource("wqp-area")?.setData({ type: "FeatureCollection", features: b.area.length ? [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: b.area } }] : [] });
        // PH5: outside the group's area under the mask
        map.getSource("wqp-mask")?.setData((b.area.length && FP.mapPalette?.outsideMask?.({ type: "MultiLineString", coordinates: b.area })) || empty());
        map.getSource("wqp-subs")?.setData({ type: "FeatureCollection", features: b.subs.filter((x) => x.rings.length).map((x) => ({ type: "Feature", properties: { id: x.id }, geometry: { type: "MultiLineString", coordinates: x.rings } })) });
        push(); paintNow();
        const key = (s.sub || "") + "|" + s.type;
        if (!framed || key !== lastKey) { frame(b, sub); framed = true; lastKey = key; }
        await setType(s.type);
        drawPanel(s.type);
        map.resize();
      },
      choose(id) { chosen = id; if (map.getLayer?.("wqp-chosen")) map.setFilter("wqp-chosen", ["==", ["id"], id ?? -1]); },
      destroy() { scheme?.removeEventListener?.("change", paint); themeWatch?.disconnect(); try { map.remove(); } catch { /* gone */ } },
    };
  }
  // A legend swatch: the map's symbol as a small picture (shape, colour, ring, faded).
  function swatch({ shape, cls, ring, faded }) {
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: 22, height: 22, "aria-hidden": "true", class: "wqp-swatch" })) svg.setAttribute(k, String(v));
    const colour = M().CLASS_COLOURS[cls] || M().CLASS_COLOURS.none, add = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); svg.append(n); };
    if (ring) add("circle", { cx: 12, cy: 12, r: 10, fill: "#ffffff", stroke: "#1d1d1f", "stroke-width": 1.75 });
    const r = faded ? 4 : 5.5, op = faded ? 0.5 : 1;
    if (shape === "square") add("rect", { x: 12 - r, y: 12 - r, width: 2 * r, height: 2 * r, fill: colour, stroke: "#ffffff", "stroke-width": 1.5, opacity: op });
    else add("circle", { cx: 12, cy: 12, r, fill: colour, stroke: "#ffffff", "stroke-width": 1.5, opacity: op });
    return svg;
  }

  // SR1: a saved sampling round changes the group's results: the next visit reads them again
  const forget = (groupId) => loaders.delete(groupId);
  FP.wqPage = { view, summary, miniBar, href, loader, forget, close: () => live?.destroy() };
})(typeof window === "undefined" ? globalThis : window);
