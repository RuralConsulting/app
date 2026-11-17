// GI1: a group's Insights page, "how the group is using the app": its pure parts. Who sees the page, the periods, the tiles' words,
// the visits by day (or by week over 12 months) from the days the database returned, the day-of-week by hour grid, the honest empty
// state, and the rule for when the app records a visit. No DOM, no reads: insights.js reads public.group_insights and
// public.group_insights_not_signed_in as the person and hands the answers here.
//
// The owner's ruling (16 Nov 2026, "Counts, plus who hasn't signed in"): the group's coordinators and RCL staff see group totals and
// charts, and the members who have never signed in; nothing about which member opened what or when. So everything here is a count
// of the group, and the only names are of members who have never signed in (member number and business name, as People shows them).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.insightsModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  // ---- who sees the page ----------------------------------------------------------------------------------------------------
  // The group's facilitators, advisors and admins (its coordinators), and RCL staff; never a plain member, an editor or a farm.
  // (The database decides too: public.group_insights returns null to anyone else.)
  const COORDINATORS = ["admin", "advisor", "facilitator"];
  const canSee = (role, staff = false) => COORDINATORS.includes(role) || !!staff;

  // ---- the periods ------------------------------------------------------------------------------------------------------------
  const PERIODS = [{ days: 30, label: "30 days" }, { days: 90, label: "90 days" }, { days: 365, label: "12 months" }];
  const periodOf = (days) => PERIODS.find((p) => p.days === Number(days)) || PERIODS[0];

  // ---- dates (New Zealand days, as the database gives them: "YYYY-MM-DD") ----------------------------------------------------------
  const DAY_MS = 86400000;
  const toTime = (d) => Date.parse(String(d).slice(0, 10) + "T00:00:00Z");
  const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, n) => isoOf(toTime(d) + n * DAY_MS);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dowOf = (d) => ((new Date(toTime(d)).getUTCDay() + 6) % 7) + 1;   // 1 Monday to 7 Sunday, as isodow
  function dateWords(d, { year = true } = {}) {
    if (!d) return "";
    const t = new Date(toTime(d));
    return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()] + (year ? " " + t.getUTCFullYear() : "");
  }
  const num = (n) => Number(n || 0).toLocaleString("en-NZ");
  const plural = (n, one, many) => num(n) + " " + (Number(n) === 1 ? one : many);
  function hourWords(h) {
    const at = (x) => { const hh = ((x % 24) + 24) % 24; return (hh % 12 === 0 ? 12 : hh % 12) + (hh < 12 ? " am" : " pm"); };
    return at(h) + " to " + at(h + 1);
  }

  // ---- what the period covers --------------------------------------------------------------------------------------------------
  // The first day counted: the period's start, or the day recording started when that is later (nothing before it was recorded, so
  // the page never draws those days as zeros).
  function from(data) {
    if (!data) return null;
    const since = String(data.since || "").slice(0, 10), started = String(data.recording_started || "").slice(0, 10);
    return started && started > since ? started : since;
  }
  // The last day counted: yesterday (the database ends every figure there: no live same-day figure); `until`, or today for an older answer
  const until = (data) => String(data?.until || data?.today || "").slice(0, 10);
  const partial = (data) => !!data && !!data.recording_started && String(data.recording_started) > String(data.since);
  // The heading's line: "Last 30 days" or "Since recording started on 17 Nov 2026 (the last 30 days ask for more)"
  function periodLine(data, days) {
    const p = periodOf(days);
    if (!data) return "";
    if (String(data.recording_started) > until(data)) return "Recording started on " + dateWords(data.recording_started) + "; figures end at yesterday";
    if (partial(data)) return "Since recording started on " + dateWords(data.recording_started) + ", " + plural(daysCounted(data), "day", "days") + " of the " + p.label + " asked for";
    return "Last " + p.label + ", to " + dateWords(until(data));
  }
  const daysCounted = (data) => Math.max(0, Math.round((toTime(until(data)) - toTime(from(data))) / DAY_MS) + 1);

  // The honest empty state: before anything is recorded for the group, say when recording started, never zeros as if nobody came.
  // null when there is something to show.
  function empty(data) {
    if (!data) return null;
    const total = Number(data.visits?.total) || 0;
    if (total > 0) return null;
    const started = data.recording_started, today = data.today, last = until(data);
    if (started && started > last) return { title: started === today ? "Recording started today" : "Recording started on " + dateWords(started),
      text: "The app began counting visits to the group on " + dateWords(started) + ". Figures end at yesterday, so they show here from the day after." };
    if (started && started > data.since) return { title: "Nothing recorded yet", text: "Recording started on " + dateWords(started) + ". No one has opened the group in the app since then." };
    return { title: "No visits in this period", text: "No one opened the group in the app in the " + periodOf(data.days).label + " to " + dateWords(last) + ". Recording started on " + dateWords(started) + "." };
  }

  // ---- the tiles: each says what it counts ----------------------------------------------------------------------------------
  // [{ key, label, figure, line, share? (0..1, a thin bar) }]; none unless the figures are shown (enough people: the database's rule)
  const weeklyOf = (data, days) => (data?.bucket ? data.bucket === "week" : Number(days) !== 30);
  function tiles(data, days) {
    if (!data || !enough(data)) return [];
    const v = data.visits || {}, m = data.members || {}, total = Number(v.total) || 0, phone = Number(v.phone) || 0;
    const given = Number(m.given) || 0, active = Number(m.active) || 0, never = Number(m.never) || 0;
    const weekly = weeklyOf(data, days);
    const span = (partial(data) ? "since " + dateWords(data.recording_started, { year: false }) : weekly ? "in whole weeks of the last " + periodOf(days).label : "in the last " + periodOf(days).label)
      + "; days with fewer than " + (data.min_bucket || 3) + " visitors left out";
    return [
      { key: "visits", label: "Visits", figure: num(total), line: "Times the group was opened in the app, " + span + (data.with_staff ? "; RCL staff included" : "") },
      m.active == null
        ? { key: "active", label: "Members active", figure: given ? "Not shown" : "None given access",
          line: given ? "Not shown for small groups: it shows once at least " + (data.min_people || 5) + " members with access have signed in" : "No member has a sign-in linked to them in People yet" }
        : { key: "active", label: "Members active", figure: num(active) + " of " + num(given), line: "Members given access whose people opened the group, in the last " + periodOf(days).label, share: given ? active / given : null },
      { key: "phone", label: "On a phone", figure: total ? Math.round((phone / total) * 100) + "%" : "–",
        line: total ? "Of the visits counted, from a phone-sized screen (" + num(phone) + " of " + num(total) + ")" : "No visits to count yet", share: total ? phone / total : null },
      { key: "never", label: "Not signed in yet", figure: num(never), line: given ? "Of " + plural(given, "member", "members") + " given access, none of their people has ever signed in" : "Members given access who have never signed in" },
    ];
  }
  // Anything about visits is shown only when enough people opened the group (the database's rule: at least 5 others than the caller);
  // the hours only when the last 30 days had enough too
  const enough = (data) => !!data && data.enough !== false && !!data.visits && Array.isArray(data.buckets);
  const gridShown = (data) => enough(data) && data.grid_shown !== false && Array.isArray(data.grid);
  const tooFewLine = (data) => "Too few people have used the group in this period to show anything about visits. Figures show once at least " + (data?.min_people || 5) + " people other than you have opened it.";
  const fewHoursLine = (data) => "The hours are shown once at least " + (data?.min_people || 5) + " people other than you have opened the group in the last 30 days.";
  // One quiet line about sign-ins that are not linked to a member in People (counts only, never names)
  function unlinkedLine(data) {
    const n = Number(data?.members?.unlinked) || 0, never = Number(data?.members?.unlinked_never) || 0;
    if (!n) return null;
    return plural(n, "person has", "people have") + " a sign-in to the group that is not linked to a member in People" + (never ? "; " + num(never) + " of them " + (never === 1 ? "has" : "have") + " not signed in yet." : ".");
  }

  // ---- visits by day (30 days) or by whole week (90 days, 12 months), as the database gives them ----------------------------------
  // Every bucket from the first to the last the database names (from the day, or the week, recording started), zeros filled, oldest
  // first: [{ start, end, phone, computer, label }]. Days left out (fewer than 3 people other than the viewer) are in no bucket and
  // have no date here: the database says only how many (leftOutLine)
  function series(data, days) {
    if (!data || !data.first || !data.last) return [];
    const weekly = weeklyOf(data, days), step = weekly ? 7 : 1;
    const got = new Map((data.buckets || []).map((b) => [String(b.start).slice(0, 10), b]));
    const started = String(data.recording_started || "").slice(0, 10);
    const out = [];
    for (let d = String(data.first).slice(0, 10); d <= String(data.last).slice(0, 10); d = addDays(d, step)) {
      const end = addDays(d, step - 1);
      if (started && end < started) continue;   // nothing was recorded then: not drawn as zeros
      const r = got.get(d) || {};
      out.push({ start: d, end, phone: Number(r.phone) || 0, computer: Number(r.computer) || 0,
        label: weekly ? "Week of " + dateWords(d, { year: false }) : DAYS_SHORT[dowOf(d) - 1] + " " + dateWords(d, { year: false }) });
    }
    return out;
  }
  // The chart's words for a screen reader (and the caption): the busiest bar and the total
  function seriesSummary(rows, weekly = false) {
    if (!rows.length) return "No visits.";
    const unit = (n) => plural(n, weekly ? "week" : "day", weekly ? "weeks" : "days");
    const total = rows.reduce((n, r) => n + r.phone + r.computer, 0);
    const top = rows.reduce((a, r) => (r.phone + r.computer > a.phone + a.computer ? r : a), rows[0]);
    if (!total) return "No visits counted in these " + unit(rows.length) + ".";
    return plural(total, "visit", "visits") + " over " + unit(rows.length) + ". The busiest " + (weekly ? "week" : "day") + " was " +
      top.label + ", with " + plural(top.phone + top.computer, "visit", "visits") + ".";
  }
  // How many days (and, by week, weeks) were left out: one plain line, never their dates; null when none
  function leftOutLine(data) {
    const days = Number(data?.left_out?.days) || 0, weeks = Number(data?.left_out?.weeks) || 0, k = data?.min_bucket || 3;
    if (!days) return null;
    return plural(days, "day", "days") + " with fewer than " + k + " visitors " + (days === 1 ? "is" : "are") + " left out of every figure here" +
      (weeks ? ", so " + plural(weeks, "week shows", "weeks show") + " nothing." : ".");
  }
  // A "nice" top for the axis, and its two gridlines
  function scale(rows) {
    const max = rows.reduce((n, r) => Math.max(n, r.phone + r.computer), 0);
    if (!max) return { top: 1, ticks: [] };
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => s * 2 >= max) || Math.ceil(max / 2);
    return { top: step * 2, ticks: [step, step * 2] };
  }

  // ---- when: day of week by hour --------------------------------------------------------------------------------------------
  // cells[dow-1][hour] = n; level 0 (none) to 4 (most), by the share of the busiest cell
  function grid(data) {
    const cells = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const c of data?.grid || []) { const d = Number(c.dow), h = Number(c.hour); if (d >= 1 && d <= 7 && h >= 0 && h <= 23) cells[d - 1][h] += Number(c.n) || 0; }
    const max = Math.max(0, ...cells.flat());
    const level = (n) => (!n || !max ? 0 : Math.min(4, Math.max(1, Math.ceil((n / max) * 4))));
    return { cells, max, level, days: DAYS, short: DAYS_SHORT };
  }
  function gridSummary(g) {
    if (!g.max) return "No visits to place in the week.";
    const byDay = g.cells.map((r) => r.reduce((a, b) => a + b, 0)), byHour = Array.from({ length: 24 }, (_, h) => g.cells.reduce((n, r) => n + r[h], 0));
    const d = byDay.indexOf(Math.max(...byDay)), h = byHour.indexOf(Math.max(...byHour));
    let cd = 0, ch = 0;
    g.cells.forEach((r, i) => r.forEach((n, j) => { if (n > g.cells[cd][ch]) { cd = i; ch = j; } }));
    return "Most visits on " + DAYS[d] + "s, and from " + hourWords(h) + ". The busiest hour of the week: " + DAYS[cd] + ", " + hourWords(ch) + ".";
  }

  // ---- recording a visit ------------------------------------------------------------------------------------------------------
  // One visit per group per 30 minutes from one browser tab (the app's rule; the database caps a group at 5,000 a day). A phone is the
  // app's own phone width (800 px and narrower).
  const VISIT_GAP_MS = 30 * 60 * 1000;
  const shouldRecord = (lastAt, now) => !(Number(lastAt) > 0) || now - Number(lastAt) >= VISIT_GAP_MS;
  const deviceOf = (width) => (Number(width) <= 800 ? "phone" : "computer");

  return { leftOutLine, until, enough, gridShown, tooFewLine, fewHoursLine, weeklyOf, COORDINATORS, canSee, PERIODS, periodOf, dateWords, hourWords, from, partial, periodLine, empty, tiles, unlinkedLine, series, seriesSummary, scale,
    grid, gridSummary, VISIT_GAP_MS, shouldRecord, deviceOf, addDays, dowOf };
});
