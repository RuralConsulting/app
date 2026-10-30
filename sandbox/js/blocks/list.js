// List / table block: rows of one record kind (documents, entries, actions, obligations) with the column set declared
// for that kind. Phone: stacked cards carrying the same information; wide hosts: a table with real headers. Both are
// in the markup and the host's width (a container query in css/blocks.css) picks one, so the block never asks the
// window how big it is. Data: { kind, title?, rows: [{id, title, group?, href?, open?, ...one field per column}],
// groups?: [[key, label]] }. Dates are YYYY-MM-DD and shown here. Pure: data in, HTML out (docs/BUILDING-BLOCKS.md §2).
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
  const shown = new Map();
  const fmt = (d) => { const k = d.slice(0, 10); if (!shown.has(k)) shown.set(k, dates.format(new Date(k + "T12:00:00Z"))); return shown.get(k); };
  const collator = new Intl.Collator("en-NZ", { numeric: true, sensitivity: "base" });

  // The columns declared for each record kind: [key, header, type, what a missing value reads as]. The first column
  // is always the record's name and is always shown; `standard` are the others, in order, unless `columns` says otherwise.
  const KINDS = {
    documents: { label: "Document", sort: "date:desc", standard: ["type", "author", "date", "pages"], columns: [
      ["title", "Document", "text"], ["type", "Type", "text"], ["author", "Prepared by", "text", "Not recorded"],
      ["date", "Date", "date", "Not recorded"], ["pages", "Pages", "number"]] },
    entries: { label: "Entry", sort: "date:desc", standard: ["type", "by", "date", "place"], columns: [
      ["title", "Entry", "text"], ["type", "Type", "text"], ["by", "Captured by", "text"], ["date", "Captured", "date", "Not recorded"], ["place", "Place", "text"]] },
    actions: { label: "Action", sort: "due:asc", standard: ["status", "owner", "due"], columns: [
      ["title", "Action", "text"], ["status", "Status", "text"], ["owner", "Owner", "text"], ["due", "Due", "date", "No date"], ["place", "Place", "text"]] },
    obligations: { label: "Condition", sort: "due:asc", standard: ["source", "due", "recurrence"], columns: [
      ["title", "Condition", "text"], ["source", "Required by", "text"], ["due", "Due", "date", "No date"], ["recurrence", "Repeats", "text"]] },
  };
  const EXTRA = [...new Set(Object.values(KINDS).flatMap((k) => k.columns.slice(1).map(([key]) => key)))];
  function fail(message) { throw new blocks.BlockError(message); }

  function columnsFor(kind, o) {
    const def = KINDS[kind], keys = def.columns.map(([k]) => k);
    const wanted = o.columns.length ? o.columns : def.standard;
    const odd = wanted.filter((k) => k === "title" || !keys.includes(k));
    if (odd.length) fail('A list of ' + kind + ' has no column "' + odd[0] + '". Its columns are: ' + keys.slice(1).join(", "));
    return [def.columns[0], ...wanted.map((k) => def.columns.find(([key]) => key === k))];
  }
  function sorting(kind, o) {
    const def = KINDS[kind], m = String(o.sort || def.sort).match(/^([a-z]+)(?::(asc|desc))?$/);
    const col = m && def.columns.find(([k]) => k === m[1]);
    if (!col) fail('A list of ' + kind + ' cannot be sorted by "' + o.sort + '". Sort by one of: ' + def.columns.map(([k]) => k).join(", ") + " (add :asc or :desc)");
    return { col, dir: m[2] || (o.sort ? "asc" : def.sort.split(":")[1]) };
  }
  // Missing values always last, whichever way it runs; ties by name, then id, so the order never jumps.
  function sorted(rows, { col: [key, , type], dir }) {
    const sign = dir === "desc" ? -1 : 1, empty = (v) => v == null || v === "" || (type === "date" && !isDate(v));
    return [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      if (empty(x) !== empty(y)) return empty(x) ? 1 : -1;
      const c = empty(x) ? 0 : type === "number" ? Number(x) - Number(y) : type === "date" ? String(x).slice(0, 10).localeCompare(String(y).slice(0, 10)) : collator.compare(String(x), String(y));
      return sign * c || collator.compare(String(a.title ?? ""), String(b.title ?? "")) || String(a.id).localeCompare(String(b.id));
    });
  }

  function state(data) {
    const n = list(data?.rows).length;
    return n === 0 ? "empty" : n < 3 ? "sparse" : "full";
  }

  function render(data, o, ctx) {
    const kind = data?.kind, none = !list(data?.rows).length;
    if (none && !kind) return "";
    if (!KINDS[kind]) fail('A list needs a kind: ' + Object.keys(KINDS).join(", "));
    const columns = columnsFor(kind, o), order = sorting(kind, o);   // refused even when there is nothing to show
    if (none) return "";
    const all = sorted(list(data.rows), order);
    const rows = o.limit ? all.slice(0, o.limit) : all, h = ctx.level;
    const link = (row, label) => text(row.href) && /^#\//.test(row.href) ? '<a href="' + esc(ctx.href ? ctx.href(row.href) : row.href) + '">' + esc(label) + "</a>" : esc(label);
    const value = ([key, , type, missing], row) => {
      const v = row[key];
      if (v == null || v === "" || (type === "date" && !isDate(v))) return missing || null;
      return type === "date" ? fmt(v) : String(v);
    };
    const mark = (row, cls) => {
      const names = [cls, o.selected != null && o.selected === row.id ? "selected-record" : null].filter(Boolean);
      return ' data-item-id="' + esc(row.id) + '" tabindex="-1"' + (names.length ? ' class="' + names.join(" ") + '"' : "");
    };
    const open = (row) => row.open ? '<button type="button" data-open-document="' + esc(row.id) + '">Open</button>' : "";
    const hasOpen = rows.some((r) => r.open), numeric = (c) => (c[2] === "number" ? ' class="list-number"' : "");
    const card = (row) => {
      const parts = columns.slice(1).map((c) => [c[1], value(c, row)]).filter(([, v]) => v);
      return "<li" + mark(row, "list-card") + '><p class="list-card-title">' + link(row, row.title || KINDS[kind].label) + "</p>" +
        (parts.length ? "<dl>" + parts.map(([k, v]) => "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>").join("") + "</dl>" : "") + open(row) + "</li>";
    };
    const tr = (row) => "<tr" + mark(row) + '><th scope="row">' + link(row, row.title || KINDS[kind].label) + "</th>" +
      columns.slice(1).map((c) => "<td" + numeric(c) + ">" + (value(c, row) ? esc(value(c, row)) : '<span aria-hidden="true">–</span>') + "</td>").join("") +
      (hasOpen ? '<td class="list-act">' + open(row) + "</td>" : "") + "</tr>";
    const table = (group) => '<div class="list-table-wrap"><table class="list-table"><thead><tr>' +
      columns.map((c, i) => '<th scope="col"' + (i ? numeric(c) : "") + ">" + esc(c[1]) + "</th>").join("") + (hasOpen ? '<th scope="col" class="list-act"><span class="visually-hidden">Open</span></th>' : "") +
      "</tr></thead><tbody>" + group.map(tr).join("") + "</tbody></table></div>";
    const body = (group) => '<ul class="list-cards">' + group.map(card).join("") + "</ul>" + table(group);
    // Groups the data names (Documents: by who prepared them), in that order; anything outside them goes last.
    const named = list(data.groups).filter((g) => Array.isArray(g) && g.length === 2);
    let groups = [[null, null, rows]];
    if (named.length) {
      const by = new Map(named.map(([k]) => [k, []])), rest = [];
      for (const r of rows) (by.get(r.group) || rest).push(r);
      groups = [...named.map(([k, label]) => [k, label, by.get(k)]), ["", "Not recorded", rest]].filter(([, , g]) => g.length);
    }
    const sub = ctx.nested ? h : Math.min(h + 1, 6);
    const title = ctx.nested ? "" : "<h" + h + ' class="block-title">' + esc(text(data.title) || "List") + "</h" + h + ">";
    return '<section class="list-block' + (o.dense ? " list-dense" : "") + '" data-list-kind="' + esc(kind) + '">' + title +
      groups.map(([key, label, g]) => label == null ? body(g) : '<section class="list-group" data-list-group="' + esc(key) + '"><h' + sub + ">" + esc(label) + " (" + g.length + ")</h" + sub + ">" + body(g) + "</section>").join("") +
      (rows.length < all.length ? '<p class="list-more">Showing ' + rows.length + " of " + all.length + "</p>" : "") + "</section>";
  }

  const block = blocks.define({
    id: "list", title: "List", empty: "Nothing recorded yet.",
    options: {
      columns: { type: "list", default: [], values: EXTRA },     // the kind's other columns, in order; none = its standard set
      dense: { type: "boolean", default: false },
      limit: { type: "integer", default: null, min: 1, max: blocks.MAX_LIMIT },
      sort: { type: "string", default: null },                   // "date:desc"; none = the kind's own order
      selected: { type: "string", default: null },               // the row to mark (a route's ?item=)
    },
    state, render,
  });
  return { block, KINDS, state, sorted };
});
