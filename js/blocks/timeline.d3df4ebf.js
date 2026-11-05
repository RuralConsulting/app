// Timeline block: what changed, newest first. Entries, documents, actions (and the consents and conditions a farm
// holds) interleave by date; at scale they fold under their day or month. Each item is one plain sentence (what, what
// happened, by whom) with its date and its source. Data: { title?, today?, items: [{ id, kind, date, what, did?, by?,
// source?, href? }] } with date as YYYY-MM-DD. Pure: data in, HTML out (docs/BUILDING-BLOCKS.md §2).
(function (root, factory) {
  const blocks = typeof module === "object" && module.exports ? require("./registry.js") : root.FP.blocks;
  const api = factory(blocks);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "undefined" ? globalThis : window, function (blocks) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const list = (v) => Array.isArray(v) ? v : [];
  const text = (v) => typeof v === "string" && v.trim();
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10)));
  const utc = (d) => new Date(d.slice(0, 10) + "T12:00:00Z");
  const formats = {
    date: new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    short: new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" }),
    day: new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    month: new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
  const when = (style, d) => formats[style].format(utc(d));
  const addDays = (d, n) => new Date(utc(d).getTime() + n * 86400000).toISOString().slice(0, 10);

  const KINDS = ["entries", "documents", "actions", "obligations", "authorisations"];
  const PERIODS = { all: null, "30-days": 30, "90-days": 90, "12-months": 365 };
  const GROUPS = ["auto", "day", "month", "none"];
  // Beyond this many items, or this many days, a day-by-day heading list stops helping and months take over.
  const DAY_ITEMS = 24, DAY_SPAN = 62;

  const newestFirst = (a, b) => (isDate(a.date) !== isDate(b.date) ? (isDate(a.date) ? -1 : 1) : String(b.date || "").slice(0, 10).localeCompare(String(a.date || "").slice(0, 10))) || String(a.id).localeCompare(String(b.id));

  function state(data) {
    const n = list(data?.items).length;
    return n === 0 ? "empty" : n < 3 ? "sparse" : "full";
  }

  function render(data, o, ctx) {
    let items = list(data?.items).filter((i) => !o.kinds.length || o.kinds.includes(i.kind));
    if (PERIODS[o.period] && isDate(data?.today)) {
      const from = addDays(data.today, -PERIODS[o.period]);
      items = items.filter((i) => isDate(i.date) && i.date.slice(0, 10) >= from);
    }
    items.sort(newestFirst);
    if (!items.length) return "";
    const dated = items.filter((i) => isDate(i.date)), span = dated.length ? (utc(dated[0].date) - utc(dated[dated.length - 1].date)) / 86400000 : 0;
    const group = o.group !== "auto" ? o.group : items.length > DAY_ITEMS || span > DAY_SPAN ? "month" : "day";
    const link = (item, label) => text(item.href) && /^#\//.test(item.href) ? '<a href="' + esc(ctx.href ? ctx.href(item.href) : item.href) + '">' + esc(label) + "</a>" : esc(label);
    // The date beside an item says what its group heading doesn't: nothing under a day, the day under a month, the whole date when ungrouped.
    const stamp = (item) => !isDate(item.date) ? "" : group === "day" ? "" :
      '<time class="timeline-when" datetime="' + esc(item.date.slice(0, 10)) + '">' + esc(when(group === "month" ? "short" : "date", item.date)) + "</time>";
    const li = (item) => '<li class="timeline-item" data-item-id="' + esc(item.id) + '" data-kind="' + esc(item.kind) + '" tabindex="-1">' + stamp(item) +
      '<p class="timeline-sentence">' + link(item, item.what || "A record") + " " + esc(text(item.did) || "was added") + (text(item.by) ? " by " + esc(item.by) : "") + ".</p>" +
      (text(item.source) ? '<p class="timeline-source">' + esc(item.source) + "</p>" : "") + "</li>";
    const ol = (group_) => '<ol class="timeline-list">' + group_.map(li).join("") + "</ol>";
    const h = ctx.level, sub = ctx.nested ? h : Math.min(h + 1, 6);
    let sections;
    if (group === "none") sections = ol(items);
    else {
      const folds = new Map();
      for (const i of items) {
        const key = !isDate(i.date) ? "" : group === "month" ? i.date.slice(0, 7) : i.date.slice(0, 10);
        if (!folds.has(key)) folds.set(key, []);
        folds.get(key).push(i);
      }
      sections = [...folds].map(([key, g]) => {
        const label = !key ? "Date not recorded" : group === "month" ? when("month", key + "-01") : when("day", key);
        return '<section class="timeline-group" data-timeline-group="' + esc(key) + '"><h' + sub + ">" + esc(label) + " (" + g.length + ")</h" + sub + ">" + ol(g) + "</section>";
      }).join("");
    }
    return '<section class="timeline-block" data-timeline-group-by="' + group + '">' +
      (ctx.nested ? "" : "<h" + h + ' class="block-title">' + esc(text(data.title) || "Timeline") + "</h" + h + ">") + sections + "</section>";
  }

  const block = blocks.define({
    id: "timeline", title: "Timeline", empty: "Nothing recorded yet.",
    options: {
      period: { type: "enum", values: Object.keys(PERIODS), default: "all" },   // measured back from the data's own "today"
      kinds: { type: "list", default: [], values: KINDS },                      // none = every kind
      group: { type: "enum", values: GROUPS, default: "auto" },                 // auto: days for a few items, months for many
    },
    state, render,
  });
  return { block, KINDS, state };
});
