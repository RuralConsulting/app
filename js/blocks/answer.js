// Answer block: one sentence -> up to three promoted lines, each with its reason -> All behind a tap.
// Data is an answer model (farm-model.js builds them): { key, title, answer: {text, because}, items, rank, empty,
// allLabel, href, body?, lines?, folds?, restricted, currency, total? }. A model may hand its promoted lines to another
// block (lines: What's due draws them with the Checklist, one line each that opens on a tap) and add quiet folds under
// them (folds: [{ key, label, body }]). Pure: data in, HTML out (APP-STRUCTURE §3.1–3.4).
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
    if (has && lines.length === 1 && !model.lines) return { text: model.answer.text + " — " + lines[0].text + ", " + lines[0].because, carried: lines[0] };
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
    // An empty answer may say where to look (empty.link: { text, href }): that word of its sentence is the link.
    const emptyLinked = (said) => {
      const l = !hasAnswer && model.empty?.link, at = l && text(l.text) ? said.indexOf(l.text) : -1;
      return at < 0 ? esc(said) : esc(said.slice(0, at)) + link(l.href, l.text) + esc(said.slice(at + l.text.length));
    };
    const selected = (item) => o.selected != null && o.selected === item.id;
    const row = (item, lead) => {
      const said = link(item.href, item.text) + (lead ? '<span class="answer-reason"> — ' + esc(item.because) + "</span>" : item.detail ? '<p class="record-detail">' + esc(item.detail) + "</p>" : "");
      return '<li tabindex="-1" data-item-id="' + esc(item.id) + '"' + (selected(item) ? ' class="selected-record"' : "") + ">" + said + "</li>";
    };
    // A model may hand its All to another block (the List for Documents, the Timeline for What's changed), and its
    // promoted lines and folds too (What's due: the Checklist). Each is drawn without a title of its own, one heading
    // level down; without that block loaded, All is the plain list and the lines are the plain lines.
    const nested = (b) => {
      if (!b || !blocks.list().includes(b.block)) return null;
      return blocks.html(b.block, b.data, b.options || {}, { level: sub, nested: true, href: ctx.href }).html;
    };
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
      "</summary>" + (items.length ? (body() || "<ul>" + items.map((i) => row(i, false)).join("") + "</ul>") : "<p>Nothing else recorded.</p>") + "</details>";
    return '<section class="answer-panel' + (o.compact ? " answer-compact" : "") + '" data-answer-key="' + esc(model.key) +
      '" data-answer-state="' + (!hasAnswer && !highlights.length ? "empty" : "recorded") + '">' +
      "<h" + h + ">" + link(o.compact ? model.href : null, model.title || "Records") + "</h" + h + '><p class="answer-sentence">' + (said.carried ? esc(model.answer.text) + " — " + link(said.carried.href, said.carried.text) + esc(", " + said.carried.because) : emptyLinked(said.text)) + "</p>" +
      (lines.length ? (model.lines && nested(model.lines) ? '<div class="answer-highlights answer-lines">' + nested(model.lines) + "</div>" :
        '<ul class="answer-highlights">' + lines.map((i) => row(i, true)).join("") + "</ul>") : "") +
      list(model.folds).map((f) => { const inner = nested(f.body); return inner && text(f.label) ? '<details class="answer-fold" data-fold="' + esc(f.key) + '"><summary>' + esc(f.label) + "</summary>" + inner + "</details>" : ""; }).join("") +
      (model.restricted ? "" : all) +
      (text(model.currency) ? '<footer class="answer-currency">' + esc(model.currency) + "</footer>" : "") + "</section>";
  }

  const block = blocks.define({
    id: "answer", title: "Answer", empty: "Nothing recorded yet.",
    options: {
      compact: { type: "boolean", default: false },   // the standing answers beside the map: All becomes a link when there is somewhere to go
      open: { type: "boolean", default: false },      // All starts open
      selected: { type: "string", default: null },    // the record to open and mark (a route's ?item=)
    },
    state, render,
  });
  return { block, ranked, state, sentence };
});
