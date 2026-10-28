// The one answer component: sentence -> up to three highlights -> all. Pure: a model in, HTML out.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.answer = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const text = (v) => typeof v === "string" && v.trim();
  const link = (href, label, attrs = "") => text(href) && /^#\//.test(href) ? '<a href="' + esc(href) + '" ' + attrs + ">" + esc(label) + "</a>" : esc(label);
  function ranked(items, rank) {
    if (rank === "given") return [...items];
    return [...items].sort((a, b) => (rank === "receptor_weight" ? Number(b.receptor_weight || 0) - Number(a.receptor_weight || 0) :
      (a.due_date || "9999").localeCompare(b.due_date || "9999")) || String(a.id).localeCompare(String(b.id)));
  }
  function render(model) {
    const items = ranked(model.items || [], model.rank);
    const highlights = items.filter((i) => i.eligible === true && text(i.because)).slice(0, 3);
    const hasAnswer = text(model.answer?.text) && text(model.answer?.because);
    const sentence = hasAnswer ? model.answer.text + " — " + model.answer.because : model.empty?.text || "Nothing recorded yet.";
    const selected = (item) => model.selectedId === item.id;
    const row = (item, promoted) => '<li tabindex="-1" data-item-id="' + esc(item.id) + '"' + (selected(item) ? ' class="selected-record"' : "") + ">" + link(item.href, item.text) +
      (promoted ? '<span class="answer-reason"> — ' + esc(item.because) + "</span>" : item.detail ? '<p class="record-detail">' + esc(item.detail) + "</p>" : "") + "</li>";
    const card = (item) => '<details class="record-card' + (selected(item) ? " selected-record" : "") + '" tabindex="-1" data-item-id="' + esc(item.id) + '"' + (selected(item) ? " open" : "") +
      "><summary><span>" + esc(item.text) + "</span>" + (item.kind && !item.text.toLowerCase().includes(item.kind.toLowerCase()) ? "<small>" + esc(item.kind) + "</small>" : "") +
      '</summary><div class="record-card-body">' + ((item.meta || []).length ? "<dl>" + item.meta.map((m) => "<div><dt>" + esc(m.label) + "</dt><dd>" + esc(m.value) + "</dd></div>").join("") + "</dl>" : "") +
      (item.note ? '<p class="record-note">' + esc(item.note) + "</p>" : "") + (item.open ? '<button type="button" data-open-document="' + esc(item.id) + '">Open</button>' : "") + "</div></details>";
    const cards = () => (model.groups || [["recorded", "Recorded"]]).map(([key, label]) => {
      const grouped = items.filter((i) => (i.group || "recorded") === key);
      return grouped.length ? '<section class="record-group" data-record-group="' + esc(key) + '"><h3>' + esc(label) + " (" + grouped.length + ')</h3><div class="record-cards">' + grouped.map(card).join("") + "</div></section>" : "";
    }).join("");
    const allLabel = (model.allLabel || "All records") + (model.noCount ? "" : " (" + items.length + ")");
    const all = model.compact && text(model.href) ? link(model.href, allLabel, 'class="answer-all-link"') :
      '<details class="answer-all"' + (model.selectedId || model.openAll ? " open" : "") + "><summary>" + esc(allLabel) +
      "</summary>" + (items.length ? (model.cards ? cards() : "<ul>" + items.map((i) => row(i, false)).join("") + "</ul>") : "<p>Nothing else recorded.</p>") + "</details>";
    return '<section class="answer-panel' + (model.compact ? " answer-compact" : "") + '" data-answer-key="' + esc(model.key) +
      '" data-answer-state="' + (!hasAnswer && !highlights.length ? "empty" : "recorded") + '">' +
      "<h2>" + link(model.compact ? model.href : null, model.title || "Records") + '</h2><p class="answer-sentence">' + esc(sentence) + "</p>" +
      (highlights.length ? '<ul class="answer-highlights">' + highlights.map((i) => row(i, true)).join("") + "</ul>" : "") +
      (model.restricted ? "" : all) +
      (text(model.currency) ? '<footer class="answer-currency">' + esc(model.currency) + "</footer>" : "") + "</section>";
  }
  return { render, ranked };
});
