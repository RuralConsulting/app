// Checklist block: what must be done, from a farm's obligations (and later its actions), each item one plain line with
// its reason ("required by CRC251894, condition 4") and its state: ongoing practice, due on a date, a date that has
// passed with no record that it was done, done, or unknown until there is a record. Grouped "Unknown — needs a record",
// "Coming up", "Ongoing practice" (and "Done" when shown), in that order: by consequence, what needs a record first,
// said plainly (a missing record, never a verdict). No mark is drawn: nothing here is ticked. Data: { title?, today, items: [{ id, text, reason,
// state?, due?, basis?, verb?, repeats?, needs?, done_on?, note?, wording?, source?, parts?, href? }] } with dates as
// YYYY-MM-DD. A state is never taken on trust for a date: due and passed are worked out from `due` and `today`, so
// nothing reads as late that the dates don't say is. Pure: data in, HTML out (docs/BUILDING-BLOCKS.md §2).
(function (root, factory) {
  const blocks = typeof module === "object" && module.exports ? require("./registry.js") : root.FP.blocks;
  const api = factory(blocks);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "undefined" ? globalThis : window, function (blocks) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const list = (v) => Array.isArray(v) ? v : [];
  const text = (v) => typeof v === "string" && v.trim();
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10)));
  const dates = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const fmt = (d) => dates.format(new Date(d.slice(0, 10) + "T12:00:00Z"));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const STATES = ["ongoing", "due", "overdue", "unknown", "done"];
  // The groups, in the order they are shown: by consequence, as a specialist would read them out. A passed date with
  // no record that it was done sits with the other things that need a record: what is missing is the record, not a
  // verdict. A consent's own expiry or lapse date that has passed is simply an earlier date.
  const GROUPS = [["unknown", "Unknown — needs a record"], ["coming-up", "Coming up"], ["ongoing", "Ongoing practice"],
    ["earlier", "Earlier dates"], ["done", "Done"]];
  const groupOf = (item, s) => s === "done" ? "done" : s === "ongoing" ? "ongoing" : s === "due" ? "coming-up" :
    s === "overdue" && item.verb && item.verb !== "due" ? "earlier" : "unknown";
  // A verb for the date: "due" (the default), "expires" or "lapses". [future, past]
  // A consent lapses only if it was not used, so a passed lapse date says the date, not that it lapsed.
  const VERBS = { due: ["Due", "Was due"], expires: ["Expires", "Expired"], lapses: ["Lapses", "Lapse date was"] };

  // The state an item is in. Only ongoing, unknown and done may be given; a date always decides due or passed.
  function stateOf(item, today) {
    if (item.state === "done" || isDate(item.done_on)) return "done";
    if (isDate(item.due)) return isDate(today) && item.due.slice(0, 10) < today.slice(0, 10) ? "overdue" : "due";
    if (item.state === "ongoing") return "ongoing";
    return "unknown";
  }
  // Within a group: dated items nearest first, then by line, then id, so the order never jumps.
  const order = (a, b) => (isDate(a.due) !== isDate(b.due) ? (isDate(a.due) ? -1 : 1) : String(a.due || "").localeCompare(String(b.due || ""))) ||
    String(a.text || "").localeCompare(String(b.text || "")) || String(a.id).localeCompare(String(b.id));

  function sorted(data, o) {
    const today = data?.today;
    return list(data?.items).map((item) => ({ item, state: stateOf(item, today) }))
      .filter(({ state }) => o.show_done || state !== "done");
  }
  function state(data) {
    const n = list(data?.items).length;
    return n === 0 ? "empty" : n < 3 ? "sparse" : "full";
  }

  // The line under an item that says where it stands, in words (status is carried by words, never colour).
  function standing(item, s) {
    const verb = VERBS[item.verb] || VERBS.due, needs = text(item.needs);
    // A date the consent doesn't state (worked out from the grant) says so beside it; the note gives the basis.
    const calc = text(item.basis) ? ", calculated" : "";
    if (s === "due") return verb[0] + " " + fmt(item.due) + calc + (text(item.repeats) ? " · " + item.repeats : "");
    if (s === "overdue") return verb[1] + " " + fmt(item.due) + calc + (item.verb && item.verb !== "due" ? "" : needs ? " · needs a record of " + needs : " · no record yet");
    if (s === "unknown") return needs ? "Needs a record of " + needs : "Needs a record";
    if (s === "done") return isDate(item.done_on) ? "Done " + fmt(item.done_on) : "Done";
    return text(item.repeats) ? cap(item.repeats) : null;
  }

  function render(data, o, ctx) {
    const all = sorted(data, o);
    if (!all.length) return "";
    const h = ctx.level, sub = ctx.nested ? h : Math.min(h + 1, 6);
    const link = (item, label) => text(item.href) && /^#\//.test(item.href) ? '<a href="' + esc(ctx.href ? ctx.href(item.href) : item.href) + '">' + esc(label) + "</a>" : esc(label);
    const li = ({ item, state: s }) => {
      const where = standing(item, s), parts = list(item.parts).filter(text);
      const more = text(item.wording) || parts.length ? '<details class="checklist-more"><summary>' + (text(item.wording) ? "As written" : "What it covers") + "</summary>" +
        (parts.length ? '<ul class="checklist-parts">' + parts.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" : "") +
        (text(item.wording) ? '<blockquote class="checklist-wording">' + esc(item.wording) + "</blockquote>" : "") +
        (text(item.source) ? '<p class="checklist-source">' + esc(item.source) + "</p>" : "") + "</details>" : "";
      return '<li class="checklist-item" data-item-id="' + esc(item.id) + '" data-check-state="' + s + '" tabindex="-1">' +
        '<div class="checklist-body">' +
        '<p class="checklist-line">' + link(item, text(item.text) || "A recorded condition") + "</p>" +
        (text(item.reason) ? '<p class="checklist-reason">' + esc(item.reason) + "</p>" : "") +
        (where ? '<p class="checklist-standing">' + esc(where) + "</p>" : "") +
        (text(item.note) ? '<p class="checklist-note">' + esc(item.note) + "</p>" : "") + more + "</div></li>";
    };
    const ul = (items) => '<ul class="checklist-list">' + items.map(li).join("") + "</ul>";
    let shown = 0, total = all.length, sections;
    const take = (items) => { const room = o.limit ? Math.max(0, o.limit - shown) : items.length, kept = items.slice(0, room); shown += kept.length; return kept; };
    const rank = (x) => GROUPS.findIndex(([key]) => key === groupOf(x.item, x.state));
    if (o.group === "none") sections = ul(take([...all].sort((a, b) => rank(a) - rank(b) || order(a.item, b.item))));
    else {
      sections = GROUPS.map(([key, label]) => {
        const items = take(all.filter((x) => groupOf(x.item, x.state) === key).sort((a, b) => order(a.item, b.item)));
        return items.length ? '<section class="checklist-group" data-checklist-group="' + key + '"><h' + sub + ">" + esc(label) + " (" + items.length + ")</h" + sub + ">" + ul(items) + "</section>" : "";
      }).join("");
    }
    return '<section class="checklist-block" data-checklist-group-by="' + o.group + '">' +
      (ctx.nested ? "" : "<h" + h + ' class="block-title">' + esc(text(data.title) || "Checklist") + "</h" + h + ">") + sections +
      (shown < total ? '<p class="checklist-more-count">Showing ' + shown + " of " + total + "</p>" : "") + "</section>";
  }

  const block = blocks.define({
    id: "checklist", title: "Checklist", empty: "Nothing recorded yet.",
    options: {
      group: { type: "enum", values: ["state", "none"], default: "state" },   // by where each item stands, or one list
      limit: { type: "integer", default: null, min: 1, max: blocks.MAX_LIMIT },
      show_done: { type: "boolean", default: false },
    },
    state, render,
  });
  return { block, STATES, GROUPS, stateOf, groupOf };
});
