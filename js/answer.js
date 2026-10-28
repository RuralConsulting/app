// APP-STRUCTURE §0 corrected in #27. One sentence -> highlights -> all component.
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
    const sentence = hasAnswer ? model.answer.text + " — " + model.answer.because : model.empty?.text || "Not yet looked at.";
    const row = (item, promoted) => '<li tabindex="-1" data-item-id="' + esc(item.id) + '"' +
      (model.selectedId === item.id ? ' class="selected-record"' : "") + ">" + link(item.href, item.text) +
      (promoted ? '<span class="answer-reason"> — ' + esc(item.because) + "</span>" : item.detail ? '<p class="record-detail">' + esc(item.detail) + "</p>" : "") + "</li>";
    const action = (a) => '<li>' + link(a.href, a.text) + "</li>";
    const obligation = (o) => '<section class="record-obligation"><h4>' + esc(o.title || "Recorded obligation") + '</h4><p class="record-check">' +
      esc(o.check || "No check recorded.") + "</p>" + ((o.actions || []).length ? '<p class="record-actions-label">Actions recorded against this condition</p><ul class="record-actions">' +
      o.actions.map(action).join("") + "</ul>" : '<p class="record-empty">No action is linked to this condition.</p>') + "</section>";
    const section = (s) => '<section class="record-section"><h4>' + esc(s.title) + '</h4><ul>' + (s.items || []).map(action).join("") + "</ul></section>";
    const card = (item) => '<details class="record-card' + (model.selectedId === item.id ? " selected-record" : "") + '" tabindex="-1" data-management-area="' +
      esc(item.managementArea || "") + '" data-place-ids="' + esc((item.placeIds || []).join(" ")) + '" data-item-id="' + esc(item.id) + '"' + (model.selectedId === item.id ? " open" : "") + "><summary><span>" + esc(item.text) + "</span>" +
      (item.kind && !item.text.toLowerCase().endsWith(item.kind.toLowerCase()) ? "<small>" + esc(item.kind) + "</small>" : "") + "</summary><div class=\"record-card-body\">" + ((item.meta || []).length ? "<dl>" + item.meta.map((m) => "<div><dt>" + esc(m.label) + "</dt><dd>" + esc(m.value) + "</dd></div>").join("") + "</dl>" : "") +
      (item.cardType === "authorisation" ? ((item.obligations || []).length ? '<div class="record-obligations">' + item.obligations.map(obligation).join("") + "</div>" : '<p class="record-empty">No obligations recorded.</p>') :
        (item.sections || []).map(section).join("") + (item.note ? '<p class="record-note">' + esc(item.note) + "</p>" : "")) + reviewForm(item.review) + "</div></details>";
    const reviewForm = (r) => {
      if (!r) return "";
      const note = (label) => '<label>' + label + '<input name="note" autocomplete="off"></label>';
      if (r.source === "conflict" && !(r.candidates || []).length) return "";
      const fields = r.source === "conflict" ? '<fieldset><legend>Which value should be used?</legend>' + r.candidates.map((c) => '<label class="review-choice"><input type="radio" name="fact" value="' + esc(c.factId) + '"> ' + esc(c.label) + "</label>").join("") + "</fieldset>" + note("Why this one?") :
        r.source === "unchecked_fact" ? '<label>Corrected value' + (r.unit ? " (" + esc(r.unit) + ")" : "") + '<input name="value" autocomplete="off" ' + (r.numeric ? 'inputmode="decimal" ' : "") + "></label>" + note("Note (needed to reject)") :
        r.source === "unconfirmed_check" ? '<label>Your reading<select name="status"><option value="">Choose a reading</option>' + r.readings.map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + "</option>").join("") + "</select></label>" + note("Why (needed to read it differently)") : note("Note (optional)");
      return '<form class="review-form" data-review-source="' + esc(r.source) + '" data-review-id="' + esc(r.refId) + '">' + fields + '<div class="review-buttons">' +
        r.decisions.map(([v, l]) => '<button type="submit" name="decision" value="' + esc(v) + '">' + esc(l) + "</button>").join("") + '</div><p class="review-error" role="alert" hidden></p></form>';
    };
    const cards = () => (model.groups || [["recorded", "Recorded"]]).map(([key, label]) => {
      const grouped = items.filter((i) => (i.group || "recorded") === key);
      return grouped.length ? '<section class="record-group" data-record-group="' + esc(key) + '"><h3>' + esc(label) + " (" + grouped.length + ')</h3><div class="record-cards">' + grouped.map(card).join("") + "</div></section>" : "";
    }).join("");
    const options = (rows) => (rows || []).map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>").join("");
    const filters = model.filters && items.length ? '<div class="record-filters"><label>Management area<select data-record-filter="management"><option value="">All management areas</option>' + options(model.filters.managementAreas) + '</select></label><label>Land unit<select data-record-filter="place"><option value="">All land units</option>' + options(model.filters.landUnits) + '</select></label><p class="record-filter-count" aria-live="polite">Showing all ' + items.length + " records.</p></div>" : "";
    const allLabel = (model.allLabel || "All records") + (model.noCount ? "" : " (" + items.length + ")");
    const all = model.compact ? link(model.href, allLabel, 'class="answer-all-link"') :
      '<details class="answer-all"' + (model.selectedId || model.openAll ? " open" : "") + "><summary>" + esc(allLabel) +
      "</summary>" + (items.length ? (model.cards ? filters + cards() : "<ul>" + items.map((i) => row(i, false)).join("") + "</ul>") : "<p>Nothing else recorded.</p>") + "</details>";
    return '<section class="answer-panel' + (model.compact ? " answer-compact" : "") + '" data-answer-key="' + esc(model.key) +
      '" data-answer-state="' + (!hasAnswer && !highlights.length ? "empty" : "recorded") + '">' +
      "<h2>" + link(model.compact ? model.href : null, model.title || "Records") + '</h2><p class="answer-sentence">' + esc(sentence) + "</p>" +
      (highlights.length ? '<ul class="answer-highlights">' + highlights.map((i) => row(i, true)).join("") + "</ul>" : "") +
      (!model.compact && !hasAnswer && model.isAdvisor && text(model.empty?.startBy) ? '<p class="answer-start">Start by ' + esc(model.empty.startBy) + "</p>" : "") +
      (model.restricted ? "" : all) + (!model.compact && model.startAction ? '<button type="button" data-start-plan>' + esc(model.startAction) + "</button>" : "") +
      (text(model.currency) ? '<footer class="answer-currency">' + esc(model.currency) + "</footer>" : "") + "</section>";
  }
  return { render, ranked };
});

