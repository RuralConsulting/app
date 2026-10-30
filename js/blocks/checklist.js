// Checklist block: what must be done, from a farm's obligations (and later its actions). Each item is one line ("Have the
// first FEP audit done · due 15 Jan 2026 · no record"; "… · done 31 Oct 2026"; "… · record: <title>"; an ongoing
// practice is its words alone) and the line is the control: one tap opens its fold, which holds the reason ("required by
// CRC251894, condition 8a"), where it stands with the basis of a worked-out date, what record it needs, the wording as
// written and its source, and, when the host allows, Done and Add the record. Grouped "Needs a record", "Coming up",
// "Ongoing practice" (and "Done" when shown), in that order: by consequence, what needs a record first, said plainly
// (a missing record, never a verdict). Data: { title?, today, items: [{ id, text, reason, state?, due?, basis?, verb?,
// repeats?, needs?, done_on?, record?: { title, href? }, obligation_id?, note?, wording?, source?, parts?, href? }] }
// with dates as YYYY-MM-DD. A state is never taken on trust for a date: due and passed are worked out from `due` and
// `today`, so nothing reads as late that the dates don't say is. Done and Add the record are buttons the host wires
// ([data-check-done], [data-check-file]); the block only draws them. Pure: data in, HTML out (docs/BUILDING-BLOCKS.md §2).
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
  const GROUPS = [["unknown", "Needs a record"], ["coming-up", "Coming up"], ["ongoing", "Ongoing practice"],
    ["earlier", "Earlier dates"], ["done", "Done"]];
  const groupOf = (item, s) => s === "done" ? "done" : s === "ongoing" ? "ongoing" : s === "due" ? "coming-up" :
    s === "overdue" && item.verb && item.verb !== "due" ? "earlier" : "unknown";
  // A verb for the date: "due" (the default), "expires" or "lapses". [future, past]
  // A consent lapses only if it was not used, so a passed lapse date says the date, not that it lapsed.
  const VERBS = { due: ["Due", "Was due"], expires: ["Expires", "Expired"], lapses: ["Lapses", "Lapse date was"] };

  // The state an item is in. Only ongoing, unknown and done may be given; a date always decides due or passed.
  function stateOf(item, today) {
    if (item.state === "done" || isDate(item.done_on) || text(item.record?.title)) return "done";
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
    const link = (item, label) => text(item?.href) && /^#\//.test(item.href) ? '<a href="' + esc(ctx.href ? ctx.href(item.href) : item.href) + '">' + esc(label) + "</a>" : esc(label);
    // The one line: the item's words, then where it stands in a few (the date, done, the record, or no record yet).
    const line = (item, s) => {
      const verb = VERBS[item.verb] || VERBS.due, rec = item.record && text(item.record.title) ? item.record : null;
      const tail = rec ? " · record: " + link(rec, rec.title) :
        s === "done" ? esc(isDate(item.done_on) ? " · done " + fmt(item.done_on) : " · done") :
        s === "due" ? esc(" · " + verb[0].toLowerCase() + " " + fmt(item.due)) :
        s === "overdue" ? esc(item.verb && item.verb !== "due" ? " · " + verb[1].toLowerCase() + " " + fmt(item.due) : " · due " + fmt(item.due) + " · no record") :
        s === "unknown" ? esc(" · no record") : "";
      return link(item, text(item.text) || "A recorded condition") + tail;
    };
    // Done and Add the record: on a condition that is dated or needs a record and has neither yet, when the host says
    // the reader may record (a view-only member never sees them).
    const acts = (item, s) => {
      if (!text(item.obligation_id) || !["due", "overdue", "unknown"].includes(s) || (item.verb && item.verb !== "due") || !(o.can_tick || o.can_attach)) return "";
      const id = esc(item.id);
      return '<div class="checklist-actions">' + (o.can_tick ? '<button type="button" data-check-done="' + id + '">Done</button>' : "") +
        (o.can_attach ? '<label class="checklist-attach"><input type="file" class="visually-hidden" data-check-file="' + id + '"><span>Add the record</span></label>' : "") +
        '</div><div class="checklist-upload" hidden></div><p class="checklist-msg" role="status" aria-live="polite"></p>';
    };
    const li = ({ item, state: s }) => {
      const where = standing(item, s), parts = list(item.parts).filter(text);
      const fold = (text(item.reason) ? '<p class="checklist-reason">' + esc(item.reason) + "</p>" : "") +
        (where ? '<p class="checklist-standing">' + esc(where) + "</p>" : "") +
        (text(item.note) ? '<p class="checklist-note">' + esc(item.note) + "</p>" : "") +
        (parts.length ? '<ul class="checklist-parts">' + parts.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" : "") +
        (text(item.wording) ? '<p class="checklist-sub">As written</p><blockquote class="checklist-wording">' + esc(item.wording) + "</blockquote>" : "") +
        (text(item.source) ? '<p class="checklist-source">' + esc(item.source) + "</p>" : "") + acts(item, s);
      // the line is a real control (a summary: keyboard and touch) when there is anything behind it
      return '<li class="checklist-item" data-item-id="' + esc(item.id) + '" data-check-state="' + s + '" tabindex="-1">' +
        (fold ? '<details class="checklist-fold"><summary class="checklist-line">' + line(item, s) + '</summary><div class="checklist-body">' + fold + "</div></details>"
          : '<p class="checklist-line">' + line(item, s) + "</p>") + "</li>";
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
      can_tick: { type: "boolean", default: false },     // Done on a condition that is dated or needs a record
      can_attach: { type: "boolean", default: false },   // Add the record (an upload linked to the condition)
    },
    state, render,
  });
  return { block, STATES, GROUPS, stateOf, groupOf };
});
