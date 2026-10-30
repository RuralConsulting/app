// Answer block: one sentence -> up to three promoted lines, each with its reason -> All behind a tap.
// Data is an answer model (farm-model.js builds them): { key, title, answer: {text, because}, items, rank, empty,
// allLabel, href, groups, restricted, currency, total? }. Pure: data in, HTML out (APP-STRUCTURE §3.1–3.4).
(function (root, factory) {
  const blocks = typeof module === "object" && module.exports ? require("./registry.js") : root.FP.blocks;
  const api = factory(blocks);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "undefined" ? globalThis : window, function (blocks) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const text = (v) => typeof v === "string" && v.trim();
  const list = (v) => Array.isArray(v) ? v : [];
  function ranked(items, rank) {
    if (rank === "given") return [...items];
    return [...items].sort((a, b) => (rank === "receptor_weight" ? Number(b.receptor_weight || 0) - Number(a.receptor_weight || 0) :
      (a.due_date || "9999").localeCompare(b.due_date || "9999")) || String(a.id).localeCompare(String(b.id)));
  }
  const promoted = (items) => items.filter((i) => i.eligible === true && text(i.because)).slice(0, 3);
  const answered = (model) => !!(text(model.answer?.text) && text(model.answer?.because));

  // The one sentence of an answer. With exactly one promoted line, the sentence carries that line and its reason, and the
  // list under it is left out (APP-STRUCTURE §3.1); otherwise the model's own sentence stands and the lines follow it.
  function sentence(model) {
    const items = ranked(list(model.items), model.rank), lines = promoted(items), has = answered(model);
    if (has && lines.length === 1) return { text: model.answer.text + " — " + lines[0].text + ", " + lines[0].because, carried: lines[0] };
    return { text: has ? model.answer.text + " — " + model.answer.because : model.empty?.text || "Nothing recorded yet.", carried: null };
  }

  // empty: nothing to say and nothing recorded; sparse: something recorded but nothing promoted, or a single record.
  function state(model) {
    const items = list(model.items);
    if (!answered(model) && !items.length) return "empty";
    return !promoted(items).length || items.length < 2 ? "sparse" : "full";
  }

  function render(data, o, ctx) {
    const model = data || {}, h = ctx.level, sub = Math.min(h + 1, 6);
    // In-app links only; the host maps them to its own routes (the demo's, say) through ctx.href.
    const link = (href, label, attrs = "") => text(href) && /^#\//.test(href) ? '<a href="' + esc(ctx.href ? ctx.href(href) : href) + '" ' + attrs + ">" + esc(label) + "</a>" : esc(label);
    const items = ranked(list(model.items), model.rank), highlights = promoted(items), hasAnswer = answered(model);
    const said = sentence(model), lines = highlights.filter((i) => i !== said.carried);
    const selected = (item) => o.selected != null && o.selected === item.id;
    const row = (item, lead) => '<li tabindex="-1" data-item-id="' + esc(item.id) + '"' + (selected(item) ? ' class="selected-record"' : "") + ">" + link(item.href, item.text) +
      (lead ? '<span class="answer-reason"> — ' + esc(item.because) + "</span>" : item.detail ? '<p class="record-detail">' + esc(item.detail) + "</p>" : "") + "</li>";
    const card = (item) => '<details class="record-card' + (selected(item) ? " selected-record" : "") + '" tabindex="-1" data-item-id="' + esc(item.id) + '"' + (selected(item) ? " open" : "") +
      "><summary><span>" + esc(item.text) + "</span>" + (item.kind && !String(item.text).toLowerCase().includes(item.kind.toLowerCase()) ? "<small>" + esc(item.kind) + "</small>" : "") +
      '</summary><div class="record-card-body">' + (list(item.meta).length ? "<dl>" + item.meta.map((m) => "<div><dt>" + esc(m.label) + "</dt><dd>" + esc(m.value) + "</dd></div>").join("") + "</dl>" : "") +
      (item.note ? '<p class="record-note">' + esc(item.note) + "</p>" : "") + (item.open ? '<button type="button" data-open-document="' + esc(item.id) + '">Open</button>' : "") + "</div></details>";
    const cards = () => (list(model.groups).length ? model.groups : [["recorded", "Recorded"]]).map(([key, label]) => {
      const grouped = items.filter((i) => (i.group || "recorded") === key);
      return grouped.length ? '<section class="record-group" data-record-group="' + esc(key) + '"><h' + sub + ">" + esc(label) + " (" + grouped.length + ")</h" + sub +
        '><div class="record-cards">' + grouped.map(card).join("") + "</div></section>" : "";
    }).join("");
    // A model may hand its All to another block (the List for Documents, the Timeline for What's changed). It is
    // drawn without a title of its own, one heading level down; without that block loaded, All is the plain list.
    const body = () => {
      const b = model.body;
      if (!b || !blocks.list().includes(b.block)) return null;
      const opts = { ...(b.options || {}), ...(o.selected != null && "selected" in blocks.get(b.block).options ? { selected: o.selected } : {}) };
      return blocks.html(b.block, b.data, opts, { level: sub, nested: true, href: ctx.href }).html;
    };
    // A model whose promoted lines include a summary (What's due's practice line) gives its own count of records.
    const allLabel = (model.allLabel || "All records") + " (" + (Number.isInteger(model.total) ? model.total : items.length) + ")";
    const all = o.compact && text(model.href) ? link(model.href, allLabel, 'class="answer-all-link"') :
      '<details class="answer-all"' + (o.selected != null || o.open ? " open" : "") + "><summary>" + esc(allLabel) +
      "</summary>" + (items.length ? (body() || (o.cards ? cards() : "<ul>" + items.map((i) => row(i, false)).join("") + "</ul>")) : "<p>Nothing else recorded.</p>") + "</details>";
    return '<section class="answer-panel' + (o.compact ? " answer-compact" : "") + '" data-answer-key="' + esc(model.key) +
      '" data-answer-state="' + (!hasAnswer && !highlights.length ? "empty" : "recorded") + '">' +
      "<h" + h + ">" + link(o.compact ? model.href : null, model.title || "Records") + "</h" + h + '><p class="answer-sentence">' + (said.carried ? esc(model.answer.text) + " — " + link(said.carried.href, said.carried.text) + esc(", " + said.carried.because) : esc(said.text)) + "</p>" +
      (lines.length ? '<ul class="answer-highlights">' + lines.map((i) => row(i, true)).join("") + "</ul>" : "") +
      (model.restricted ? "" : all) +
      (text(model.currency) ? '<footer class="answer-currency">' + esc(model.currency) + "</footer>" : "") + "</section>";
  }

  const block = blocks.define({
    id: "answer", title: "Answer", empty: "Nothing recorded yet.",
    options: {
      compact: { type: "boolean", default: false },   // the standing answers beside the map: All becomes a link when there is somewhere to go
      cards: { type: "boolean", default: false },     // All as grouped record cards (Documents)
      open: { type: "boolean", default: false },      // All starts open
      selected: { type: "string", default: null },    // the record to open and mark (a route's ?item=)
    },
    state, render,
  });
  return { block, ranked, state, sentence };
});
