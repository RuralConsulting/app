// APP-STRUCTURE §0: one bounded answer -> highlights -> all pattern, independent of plans or the DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.answer = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const text = (v) => typeof v === "string" && v.trim();
  function ranked(items, rank) {
    return [...items].sort((a, b) => {
      const order = rank === "receptor_weight" ? Number(b.receptor_weight || 0) - Number(a.receptor_weight || 0) :
        (a.due_date || "9999").localeCompare(b.due_date || "9999");
      return order || String(a.id).localeCompare(String(b.id));
    });
  }
  function render(model) {
    const items = ranked(model.items || [], model.rank);
    // The caller supplies eligibility from its checked/attributed data. Reasons are mandatory for promotion.
    const highlights = items.filter((i) => i.eligible === true && text(i.because)).slice(0, 3);
    const hasAnswer = text(model.answer?.text) && text(model.answer?.because);
    const empty = !highlights.length && !hasAnswer;
    const answer = hasAnswer ? model.answer.text : model.empty?.text || "Nothing has been looked at yet.";
    const because = hasAnswer ? model.answer.because : model.empty?.because || "No recorded item meets the criteria for this summary.";
    const row = (item, promoted) => {
      const label = text(item.href) && /^#\//.test(item.href) ? '<a href="' + esc(item.href) + '">' + esc(item.text) + "</a>" : esc(item.text);
      return '<li data-item-id="' + esc(item.id) + '">' + label + (promoted ?
        '<details class="answer-because"><summary>Why this is shown</summary><p>' + esc(item.because) + "</p></details>" : "") + "</li>";
    };
    return '<section class="answer-panel" data-answer-key="' + esc(model.key) + '" data-answer-state="' + (empty ? "empty" : "recorded") + '">' +
      "<h2>" + esc(model.question) + '</h2><p class="answer-sentence">' + esc(answer) + "</p>" +
      '<details class="answer-because"><summary>Why this is shown</summary><p>' + esc(because) + "</p></details>" +
      '<p class="answer-currency">' + esc(model.currency || "Last updated: not recorded") + "</p>" +
      '<p class="answer-coverage">' + esc(model.coverage || "As far as what is recorded; not yet looked at.") + "</p>" +
      '<div class="answer-highlights">' + (highlights.length ? "<ul>" + highlights.map((i) => row(i, true)).join("") + "</ul>" : '<p class="answer-empty">No highlights to show yet.</p>') + "</div>" +
      (empty && model.isAdvisor && text(model.empty?.startBy) ? '<p class="answer-start">Start by ' + esc(model.empty.startBy) + "</p>" : "") +
      '<details class="answer-all"><summary>' + esc(model.allLabel || "Everything recorded") + " (" + items.length + ")" +
      (items.length > highlights.length && highlights.length ? " · and " + (items.length - highlights.length) + " more" : "") +
      "</summary>" + (items.length ? "<ul>" + items.map((i) => row(i, false)).join("") + "</ul>" : "<p>Nothing else recorded.</p>") + "</details></section>";
  }
  return { render };
});

