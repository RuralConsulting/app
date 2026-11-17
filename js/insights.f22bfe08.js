// GI1: a group's Insights (under More), "how the group is using the app": a period switch (30 days, 90 days, 12 months) and an
// "Include RCL staff" tick (off at first); four tiles that say what they count (visits, members active, on a phone, not signed in
// yet); visits by day, phone and computer; when people look (day of week by hour); and the members given access who have never
// signed in, each a link to People with that member found, for the follow-up. Charts are plain SVG drawn here (no library), each
// with a table beside it for a screen reader or anyone who prefers numbers.
//
// The owner's ruling (16 Nov 2026, "Counts, plus who hasn't signed in"): group totals and charts, and who has never signed in;
// nothing about which member opened what or when. Reads, as the person: public.group_insights(g, days, with_staff) and
// public.group_insights_not_signed_in(g), both null or empty for anyone but the group's facilitators, advisors and admins and RCL staff.
// The page is drawn only for them (insights-model.js canSee); anyone else who reaches its address is told it is for coordinators,
// and nothing is read.
//
// Recording (FP.insights.record): after a group's place is opened, one call to public.record_group_visit(g, phone|computer), when the
// browser is idle and never before the first screen; at most once per group in 30 minutes from one tab; any failure is ignored.
// Never in the demo, never from the sign-in page (this file loads only after sign-in).
(function (root) {
  const FP = root.FP;
  const M = () => FP.insightsModel;
  const el = (...a) => FP.el(...a);
  const NS = "http://www.w3.org/2000/svg";
  let shown = null;

  const svg = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    for (const k of kids) if (k != null) n.append(k);
    return n;
  };
  const prefs = { days: 30, staff: false };   // kept while the app is open (a remembered period, not saved anywhere)

  function view(group, { sb = FP.sb, staff = false, search = null } = {}) {
    close();
    const me = { alive: true };
    shown = me;
    const live = () => me.alive && shown === me;
    const wrap = el("section", { class: "insights", "data-view": "insights", "data-group": group.id, "aria-labelledby": "gi-title" });
    if (!M().canSee(group.role, staff)) {
      wrap.append(el("h2", { id: "gi-title" }, "Insights"), el("p", { class: "gi-quiet", id: "gi-none" }, "This page is for the group's coordinators."));
      return wrap;
    }
    const ctx = { group, sb, live, wrap, search, staffCaller: !!staff };
    draw(ctx);
    return wrap;
  }
  function close() { if (shown) shown.alive = false; shown = null; }

  // ---- the page -------------------------------------------------------------------------------------------------------------
  function controls(ctx) {
    const seg = el("div", { class: "gi-seg", role: "group", "aria-label": "Period" }, ...M().PERIODS.map((p) =>
      el("button", { type: "button", class: "gi-seg-btn", "data-days": String(p.days), "aria-pressed": String(prefs.days === p.days),
        onclick: () => { if (prefs.days !== p.days) { prefs.days = p.days; draw(ctx); } } }, p.label)));
    const tick = el("input", { type: "checkbox", id: "gi-staff", ...(prefs.staff ? { checked: true } : {}) });
    tick.addEventListener("change", () => { prefs.staff = tick.checked; draw(ctx); });
    return el("div", { class: "gi-controls" }, seg, el("label", { class: "gi-tick", for: "gi-staff" }, tick, el("span", {}, "Include RCL staff")));
  }
  async function draw(ctx) {
    const { group, sb, wrap } = ctx, days = prefs.days, withStaff = prefs.staff;
    const status = el("p", { class: "gi-quiet gi-status", role: "status" }, "Reading the figures…");
    wrap.replaceChildren(
      el("div", { class: "gi-head" },
        el("div", { class: "gi-title" }, el("h2", { id: "gi-title" }, "Insights"),
          el("p", { class: "gi-quiet" }, "How the group is using the app: counts for the whole group, never who opened what.")),
        controls(ctx)),
      status);
    let data, never;
    try {
      const [a, b] = await Promise.all([sb.rpc("group_insights", { g: group.id, days, with_staff: withStaff }), sb.rpc("group_insights_not_signed_in", { g: group.id })]);
      data = a?.error ? undefined : a?.data ?? null;
      never = b?.error ? null : b?.data || [];
    } catch { data = undefined; never = null; }
    if (!ctx.live() || days !== prefs.days || withStaff !== prefs.staff) return;
    if (data === undefined) { status.textContent = "The figures couldn't be read just now. Try again in a moment."; status.dataset.state = "error"; return; }
    if (data === null) { status.textContent = "This page is for the group's coordinators."; status.dataset.state = "none"; return; }
    status.textContent = M().periodLine(data, days);
    status.dataset.state = "ok";
    const blank = M().empty(data), notYet = !!data.recording_started && String(data.recording_started) > M().until(data);
    const parts = [];
    // before anything is counted: when recording started, never zeros as if nobody came
    if (notYet) parts.push(emptyBlock(blank));
    // a small group: nothing about visits at all (any figure could be one person's), only the line and who has not signed in
    else if (!M().enough(data)) parts.push(el("p", { class: "gi-empty gi-few", id: "gi-few" }, M().tooFewLine(data)));
    else {
      parts.push(tilesBlock(data, days));
      if (blank) parts.push(emptyBlock(blank));
      else parts.push(byDayBlock(data, days), M().gridShown(data) ? whenBlock(data) : el("p", { class: "gi-empty gi-few", id: "gi-few-hours" }, M().fewHoursLine(data)));
    }
    parts.push(neverBlock(ctx, data, never));
    wrap.append(...parts);
  }

  const emptyBlock = (blank) => el("div", { class: "gi-empty", id: "gi-empty" }, el("b", {}, blank.title), el("p", {}, blank.text));
  function tilesBlock(data, days) {
    return el("ul", { class: "gi-tiles", "aria-label": "The group in numbers" }, ...M().tiles(data, days).map((t) =>
      el("li", { class: "gi-tile", "data-tile": t.key },
        el("span", { class: "gi-tile-label" }, t.label),
        el("b", { class: "gi-tile-figure" }, t.figure),
        t.share != null ? el("span", { class: "gi-bar", "aria-hidden": "true" }, el("span", { style: "width:" + Math.round(Math.max(0, Math.min(1, t.share)) * 100) + "%" })) : null,
        el("small", { class: "gi-tile-line" }, t.line))));
  }

  // Visits by day (by week over 12 months): stacked bars, computer below and phone above, a 2 px gap between, rounded tops
  function byDayBlock(data, days) {
    const weekly = M().weeklyOf(data, days), rows = M().series(data, days), sc = M().scale(rows), leftOut = M().leftOutLine(data);
    const W = 640, H = 160, padL = 28, padB = 18, padT = 6, inner = W - padL, plotH = H - padB - padT;
    const step = inner / Math.max(1, rows.length), bw = Math.max(1.5, Math.min(18, step * 0.7));
    const y = (n) => padT + plotH - (n / sc.top) * plotH;
    const chart = svg("svg", { class: "gi-chart", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", role: "img", "aria-labelledby": "gi-byday-sum" });
    for (const t of sc.ticks) chart.append(svg("line", { class: "gi-grid", x1: padL, x2: W, y1: y(t), y2: y(t) }));
    chart.append(svg("line", { class: "gi-axis", x1: padL, x2: W, y1: y(0), y2: y(0) }));
    rows.forEach((r, i) => {
      const x = padL + i * step + (step - bw) / 2, total = r.phone + r.computer;
      const g = svg("g", { class: "gi-bar-g" }, svg("title", {}, r.label + ": " + total + (total === 1 ? " visit" : " visits") + " (" + r.computer + " computer, " + r.phone + " phone)"));
      if (r.computer) g.append(svg("rect", { class: "gi-computer", x, width: bw, y: y(r.computer), height: Math.max(0.5, y(0) - y(r.computer)), rx: Math.min(2, bw / 3) }));
      if (r.phone) { const gap = r.computer ? 1.5 : 0; g.append(svg("rect", { class: "gi-phone", x, width: bw, y: y(total), height: Math.max(0.5, y(r.computer) - y(total) - gap), rx: Math.min(2, bw / 3) })); }
      g.append(svg("rect", { class: "gi-hit", x: padL + i * step, width: step, y: padT, height: plotH }));
      chart.append(g);
    });
    const ticks = el("div", { class: "gi-yticks", "aria-hidden": "true" }, ...sc.ticks.map((t) => el("span", { style: "bottom:" + ((t / sc.top) * (plotH / H) * 100 + (padB / H) * 100) + "%" }, String(t))));
    const first = rows[0], last = rows[rows.length - 1];
    const xlab = el("div", { class: "gi-xlabels", "aria-hidden": "true" }, el("span", {}, first ? M().dateWords(first.start, { year: false }) : ""), el("span", {}, last ? M().dateWords(last.end, { year: false }) : ""));
    const key = el("div", { class: "gi-key" }, el("span", {}, el("i", { class: "gi-sw gi-sw-computer", "aria-hidden": "true" }), "Computer"), el("span", {}, el("i", { class: "gi-sw gi-sw-phone", "aria-hidden": "true" }), "Phone"));
    const table = el("table", { class: "gi-table" }, leftOut ? el("caption", { class: "gi-left-out" }, leftOut) : null, el("thead", {}, el("tr", {}, el("th", { scope: "col" }, weekly ? "Week" : "Day"), el("th", { scope: "col" }, "Computer"), el("th", { scope: "col" }, "Phone"), el("th", { scope: "col" }, "All"))),
      el("tbody", {}, ...rows.filter((r) => r.phone + r.computer).map((r) => el("tr", {}, el("th", { scope: "row" }, r.label), el("td", {}, String(r.computer)), el("td", {}, String(r.phone)), el("td", {}, String(r.phone + r.computer))))));
    return el("section", { class: "gi-panel gi-byday", "aria-labelledby": "gi-byday-h" },
      el("div", { class: "gi-panel-head" }, el("h3", { id: "gi-byday-h" }, weekly ? "Visits by week" : "Visits by day"), key),
      el("p", { class: "gi-quiet", id: "gi-byday-sum" }, M().seriesSummary(rows, weekly)),
      el("div", { class: "gi-plot" }, ticks, chart), xlab,
      leftOut ? el("p", { class: "gi-quiet gi-left-out", id: "gi-left-out" }, leftOut) : null,
      el("details", { class: "gi-details" }, el("summary", {}, "As a table"), table));
  }

  // When people look: seven rows (Monday first) by 24 hours, darker = more
  function whenBlock(data) {
    const g = M().grid(data);
    const cells = el("div", { class: "gi-heat", role: "img", "aria-labelledby": "gi-when-sum" },
      el("span", { class: "gi-heat-corner", "aria-hidden": "true" }),
      ...[0, 6, 12, 18].map((h) => el("span", { class: "gi-heat-hour", style: "grid-column:" + (h + 2) + " / span 6", "aria-hidden": "true" }, h === 0 ? "12 am" : h === 12 ? "12 pm" : (h % 12) + (h < 12 ? " am" : " pm"))),
      ...g.cells.flatMap((row, d) => [el("span", { class: "gi-heat-day", "aria-hidden": "true" }, g.short[d]),
        ...row.map((n, h) => el("span", { class: "gi-cell", "data-level": String(g.level(n)), title: g.days[d] + ", " + M().hourWords(h) + ": " + n + (n === 1 ? " visit" : " visits") }))]));
    const table = el("table", { class: "gi-table" }, el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Day"), el("th", { scope: "col" }, "Hour"), el("th", { scope: "col" }, "Visits"))),
      el("tbody", {}, ...g.cells.flatMap((row, d) => row.map((n, h) => (n ? el("tr", {}, el("th", { scope: "row" }, g.days[d]), el("td", {}, M().hourWords(h)), el("td", {}, String(n))) : null)).filter(Boolean))));
    return el("section", { class: "gi-panel gi-when", "aria-labelledby": "gi-when-h" },
      el("div", { class: "gi-panel-head" }, el("h3", { id: "gi-when-h" }, "When people look"),
        el("span", { class: "gi-scale", "aria-hidden": "true" }, "Fewer", ...[1, 2, 3, 4].map((l) => el("i", { class: "gi-cell", "data-level": String(l) })), "More")),
      el("p", { class: "gi-quiet", id: "gi-when-sum" }, M().gridSummary(g)),
      cells,
      el("details", { class: "gi-details" }, el("summary", {}, "As a table"), table));
  }

  // Members given access who have never signed in: a list, each opening People with that member found
  function neverBlock(ctx, data, rows) {
    const { group } = ctx, given = Number(data?.members?.given) || 0;
    const head = el("div", { class: "gi-panel-head" }, el("h3", { id: "gi-never-h" }, "Not signed in yet"));
    const out = el("section", { class: "gi-panel gi-never", "aria-labelledby": "gi-never-h" }, head);
    if (rows == null) { out.append(el("p", { class: "gi-quiet" }, "The list couldn't be read just now.")); return out; }
    if (!rows.length) out.append(el("p", { class: "gi-quiet", id: "gi-never-none" }, given ? "Every member given access has signed in at least once." : "No member has a sign-in linked to them in People, so there is no one to list."));
    else {
      out.append(el("p", { class: "gi-quiet" }, "Members given access none of whose people has ever signed in. Open one in People to follow up."),
        el("ul", { class: "gi-list" }, ...rows.map((r) => el("li", {},
          el("a", { class: "gi-row", href: FP.href(FP.groupModel.href(group.id, "people")), "data-member": r.member_number,
            onclick: () => ctx.search?.("people", r.member_number) },
            el("span", { class: "gi-num" }, r.member_number), el("span", { class: "gi-name" }, r.business_name), FP.icon ? FP.icon("chevron", 14) : null)))));
    }
    const extra = M().unlinkedLine(data);
    if (extra) out.append(el("p", { class: "gi-quiet gi-unlinked" }, extra));
    return out;
  }

  // ---- recording a visit ------------------------------------------------------------------------------------------------------
  const KEY = "fp-gi1-visit:";
  const lastAt = (id) => { try { return Number(root.sessionStorage.getItem(KEY + id)) || 0; } catch { return mem.get(id) || 0; } };
  const mark = (id, t) => { mem.set(id, t); try { root.sessionStorage.setItem(KEY + id, String(t)); } catch { /* memory only */ } };
  const mem = new Map();
  function record(group, { sb = FP.sb } = {}) {
    try {
      if (!group?.id || FP.demo?.active || !sb?.rpc) return false;
      const now = Date.now();
      if (!M().shouldRecord(Math.max(lastAt(group.id), mem.get(group.id) || 0), now)) return false;
      mark(group.id, now);
      const device = M().deviceOf(root.innerWidth);
      const send = () => { try { Promise.resolve(sb.rpc("record_group_visit", { g: group.id, device })).catch(() => {}); } catch { /* never mind */ } };
      // after the first screen: when the browser is idle (at most 5 s), never in the way of drawing
      if (root.requestIdleCallback) root.requestIdleCallback(send, { timeout: 5000 }); else root.setTimeout(send, 2000);
      return true;
    } catch { return false; }
  }

  FP.insights = { view, close, record };
})(typeof window === "undefined" ? globalThis : window);
